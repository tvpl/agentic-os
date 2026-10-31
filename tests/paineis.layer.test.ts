import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type Database from "better-sqlite3";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DashboardSpecSchema } from "@mordomo/contracts";
import { AppContext } from "../apps/api/src/context.js";
import { openDb } from "../core/src/db/db.js";
import { MIGRATIONS } from "../core/src/db/migrations.js";
import { ensureDirs, resolvePaths } from "../core/src/paths.js";
import { DashboardEvaluator, snapshotStatus } from "../core/src/dashboards/evaluator.js";
import { refreshDue, snapshotStale } from "../core/src/dashboards/schedule.js";
import { dashboardSources, projectHealth, type DashboardSourceMap } from "../core/src/dashboards/sources.js";
import { parseTasks } from "../core/src/memory/tasks.js";
import { makeTempHome } from "./helpers.js";
import { ACCEPTED, REFUSALS, valid } from "./helpers/paineisDefinitions.js";

/**
 * .specs/features/cerebro-paineis, batch A (S1 and S2), the deciding code at its own layer (checks.md, Test policy rows
 * 1 and 2), with no HTTP: door 1's validator (`DashboardSpecSchema`), the evaluator over a source map, the scheduling
 * and `stale` maths, migration 26, the task parser and a project's health. The claims that name a local day are in
 * `paineis.localday.test.ts`; the HTTP side of each is in `paineis.routes.test.ts` and `paineis.refresh.test.ts`.
 */

type Json = Record<string, any>;

let temp: ReturnType<typeof makeTempHome>;
let ctx: AppContext;
let work: string;

beforeAll(() => {
  temp = makeTempHome("mordomo-paineis-layer-");
  ctx = new AppContext(temp.paths.home);
  work = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "mordomo-paineis-layer-work-")));
  const s = ctx.settings();
  s.indexedFolders = [{ path: work, area: null, enabled: true }];
  ctx.settingsStore.save(s);
});
afterAll(() => {
  ctx.close();
  temp.cleanup();
  fs.rmSync(work, { recursive: true, force: true });
});

// ---- door 1 ------------------------------------------------------------------------------------------------------

describe("C5 door 1's validator", () => {
  it("C5 the base definition is accepted", () => {
    expect(DashboardSpecSchema.safeParse(valid()).success).toBe(true);
  });

  for (const [name, change, at] of REFUSALS) {
    it(`C5 refuses ${name}, for that reason alone`, () => {
      const def = valid();
      change(def);
      const result = DashboardSpecSchema.safeParse(def);
      expect(result.success).toBe(false);
      const issues = result.success ? [] : result.error.issues;
      expect(issues.map((i) => i.path)).toEqual([at]);
    });
  }

  for (const [name, change] of ACCEPTED) {
    it(`C5 accepts ${name}`, () => {
      const def = valid();
      change(def);
      const result = DashboardSpecSchema.safeParse(def);
      expect(result.success ? [] : result.error.issues).toEqual([]);
    });
  }
});

// ---- the evaluator -----------------------------------------------------------------------------------------------

const NOW = new Date(2026, 9, 30, 12, 0, 0).getTime();
const ok = (items: unknown[]) => ({ status: "ok" as const, data: { items, total: items.length } });

/** A map that answers every source with one item, `kind` its name. */
function fullMap(): DashboardSourceMap {
  const map: DashboardSourceMap = {};
  for (const kind of [
    "notes",
    "tasks",
    "decisions",
    "openLoops",
    "projects",
    "reviews",
    "facts",
    "runs",
    "approvals",
    "connector",
  ] as const) {
    map[kind] = () => ok([{ kind }]);
  }
  map.metrics = () => ({ status: "ok", data: { value: 3, points: [] } });
  return map;
}

/** One widget of each source kind, the reviews one titled as the overview's. */
function everySource(): Json {
  return {
    id: "todas",
    v: 1,
    title: "Todas",
    kind: "overview",
    refresh: "15m",
    widgets: [
      { id: "notes", kind: "list", title: "N", source: { kind: "notes" } },
      { id: "tasks", kind: "checklist", title: "T", source: { kind: "tasks", window: "today" } },
      { id: "decisions", kind: "list", title: "D", source: { kind: "decisions", window: "week" } },
      { id: "loops", kind: "list", title: "L", source: { kind: "openLoops", window: "week" } },
      { id: "projects", kind: "list", title: "P", source: { kind: "projects" } },
      {
        id: "reviews",
        kind: "kpi",
        title: "Revisões vencidas",
        source: { kind: "reviews" },
        options: { measure: "count" },
      },
      { id: "facts", kind: "list", title: "F", source: { kind: "facts" } },
      { id: "runs", kind: "list", title: "R", source: { kind: "runs" } },
      { id: "approvals", kind: "list", title: "A", source: { kind: "approvals" } },
      {
        id: "metrics",
        kind: "kpi",
        title: "M",
        source: { kind: "metrics", series: "runs24h" },
        options: { measure: "latest" },
      },
      {
        id: "agenda",
        kind: "agenda",
        title: "C",
        source: { kind: "connector", id: "calendar-google", read: "list" },
      },
    ],
  };
}

const evaluator = (map: DashboardSourceMap) =>
  new DashboardEvaluator(map, { paths: ctx.paths, settings: () => ctx.settings() });

describe("C8 a failing source marks only its widgets", () => {
  it("C8 (b) a reviews source that throws puts only the Revisões vencidas widget in error, its source in error", async () => {
    const map = fullMap();
    map.reviews = () => {
      throw new Error("a fila caiu");
    };
    const snap = await evaluator(map).evaluate(everySource() as never, { now: NOW, context: null });
    const failed = snap.widgets.filter((w) => w.status === "error");
    expect(failed).toEqual([{ id: "reviews", kind: "kpi", status: "error", error: "a fila caiu" }]);
    expect(snap.widgets.filter((w) => w.id !== "reviews").every((w) => w.status === "ok")).toBe(true);
    expect(snap.sources.find((s) => s.id === "reviews")).toEqual({
      id: "reviews",
      kind: "reviews",
      status: "error",
      syncedAt: null,
      message: "a fila caiu",
    });
    expect(snapshotStatus(snap)).toBe("partial");
  });

  it("C8 (c) every source throws: every widget is in error and the status is error", async () => {
    const map: DashboardSourceMap = {};
    for (const kind of Object.keys(fullMap()) as Array<keyof DashboardSourceMap>) {
      map[kind] = () => {
        throw new Error(`${kind} caiu`);
      };
    }
    const snap = await evaluator(map).evaluate(everySource() as never, { now: NOW, context: null });
    expect(snap.widgets.map((w) => w.status)).toEqual(Array(11).fill("error"));
    expect(snap.sources.every((s) => s.status === "error")).toBe(true);
    expect(snapshotStatus(snap)).toBe("error");
  });
});

describe("C17 a source absent from this build", () => {
  it("C17 a map with no reviews entry: that widget is in error with the text of AC 25, the source unavailable, every other ok", async () => {
    const map = fullMap();
    delete map.reviews;
    const snap = await evaluator(map).evaluate(everySource() as never, { now: NOW, context: null });
    expect(snap.widgets.find((w) => w.id === "reviews")).toEqual({
      id: "reviews",
      kind: "kpi",
      status: "error",
      error: "Esta fonte ainda não existe nesta versão.",
    });
    expect(snap.sources.find((s) => s.id === "reviews")?.status).toBe("unavailable");
    expect(snap.widgets.filter((w) => w.id !== "reviews").map((w) => w.status)).toEqual(Array(10).fill("ok"));
  });

  it("C17 with the full map of the engine no source of the eleven is unavailable", async () => {
    const map = dashboardSources({
      db: ctx.db,
      paths: ctx.paths,
      settings: () => ctx.settings(),
      metricsHistory: ctx.metricsHistory,
      connectors: ctx.connectors,
      connectorCache: ctx.connectorCache,
    });
    expect(Object.keys(map).sort()).toEqual([
      "approvals",
      "connector",
      "decisions",
      "facts",
      "metrics",
      "notes",
      "openLoops",
      "projects",
      "reviews",
      "runs",
      "tasks",
    ]);
    const snap = await evaluator(map).evaluate(everySource() as never, { now: NOW, context: null });
    expect(snap.sources.map((s) => s.status)).not.toContain("unavailable");
    expect(snap.sources.map((s) => s.kind).sort()).toEqual([
      "approvals",
      "connector",
      "decisions",
      "facts",
      "metrics",
      "notes",
      "openLoops",
      "projects",
      "reviews",
      "runs",
      "tasks",
    ]);
  });
});

// ---- the clock (the daily form is in paineis.localday.test.ts) ---------------------------------------------------

describe("C10 the scheduling rule", () => {
  const MIN = 60_000;
  const at = (refresh: string, kind = "overview") => ({ kind: kind as "overview", refresh });
  const cases: Array<[string, { kind: "overview"; refresh: string }, number | null, boolean]> = [
    ["15m at 14 min 59 s", at("15m"), 14 * MIN + 59_000, false],
    ["15m at 15 min", at("15m"), 15 * MIN, true],
    ["1h at 59 min", at("1h"), 59 * MIN, false],
    ["1h at 60 min", at("1h"), 60 * MIN, true],
    ["6h at 5 h 59 min", at("6h"), 359 * MIN, false],
    ["6h at 6 h", at("6h"), 360 * MIN, true],
    ["manual 30 days old", at("manual"), 30 * 1440 * MIN, false],
    ["a question whose file says 15m", at("15m", "question"), 30 * MIN, false],
    ["15m with no snapshot", at("15m"), null, true],
    ["1h with no snapshot", at("1h"), null, true],
    ["6h with no snapshot", at("6h"), null, true],
    ["daily@08:30 with no snapshot", at("daily@08:30"), null, true],
    ["manual with no snapshot", at("manual"), null, false],
    ["a question with no snapshot", at("manual", "question"), null, false],
  ];
  for (const [name, def, age, due] of cases) {
    it(`C10 ${name} → ${due ? "due" : "not due"}`, () => {
      expect(refreshDue(def, age === null ? null : NOW - age, NOW)).toBe(due);
    });
  }
});

describe("C12 the stale rule at its own layer", () => {
  const MIN = 60_000;
  const def = (refresh: string) => ({ kind: "overview" as const, refresh });
  const cases: Array<[string, string, number | null, boolean]> = [
    ["15m at exactly 15 min", "15m", 15 * MIN, false],
    ["15m at 15 min + 1 ms", "15m", 15 * MIN + 1, true],
    ["1h at 60 min + 1 ms", "1h", 60 * MIN + 1, true],
    ["6h at 6 h", "6h", 360 * MIN, false],
    ["daily@08:30 at 48 h", "daily@08:30", 2880 * MIN, false],
    ["daily@08:30 at 48 h + 1 ms", "daily@08:30", 2880 * MIN + 1, true],
    ["manual at 30 days", "manual", 30 * 1440 * MIN, false],
    ["no snapshot", "15m", null, false],
  ];
  for (const [name, refresh, age, stale] of cases) {
    it(`C12 ${name} → stale ${stale}`, () => {
      expect(snapshotStale(def(refresh), age === null ? null : NOW - age, NOW)).toBe(stale);
    });
  }
});

// ---- migration 26 ------------------------------------------------------------------------------------------------

describe("C19 migration 26", () => {
  const columns = (db: Database.Database, table: string) =>
    (db.pragma(`table_info(${table})`) as Json[]).map(({ name, type, notnull, dflt_value, pk }) => ({
      name,
      type,
      notnull,
      dflt_value,
      pk,
    }));
  const NOTE_TASKS = [
    { name: "src_id", type: "INTEGER", notnull: 1, dflt_value: null, pk: 1 },
    { name: "line", type: "INTEGER", notnull: 1, dflt_value: null, pk: 2 },
    { name: "done", type: "INTEGER", notnull: 1, dflt_value: null, pk: 0 },
    { name: "text", type: "TEXT", notnull: 1, dflt_value: null, pk: 0 },
    { name: "due", type: "TEXT", notnull: 0, dflt_value: null, pk: 0 },
    { name: "priority", type: "INTEGER", notnull: 1, dflt_value: "0", pk: 0 },
  ];
  const SNAPSHOTS = [
    { name: "dashboard_id", type: "TEXT", notnull: 0, dflt_value: null, pk: 1 },
    { name: "generated_at", type: "INTEGER", notnull: 1, dflt_value: null, pk: 0 },
    { name: "json", type: "TEXT", notnull: 1, dflt_value: null, pk: 0 },
  ];
  const SERIES = [
    { name: "dashboard_id", type: "TEXT", notnull: 1, dflt_value: null, pk: 1 },
    { name: "widget_id", type: "TEXT", notnull: 1, dflt_value: null, pk: 2 },
    { name: "at", type: "INTEGER", notnull: 1, dflt_value: null, pk: 3 },
    { name: "value", type: "REAL", notnull: 1, dflt_value: null, pk: 0 },
  ];
  const schema = (db: Database.Database) => ({
    tasks: columns(db, "note_tasks"),
    index: (db.pragma("index_info(idx_note_tasks_due)") as Json[]).map((c) => c.name),
    snapshots: columns(db, "dashboard_snapshots"),
    series: columns(db, "dashboard_series"),
  });

  it("C19 makes note_tasks, its index, dashboard_snapshots and dashboard_series as doors 3 and 4 write them, again leaves them so, and keeps 22 to 25", () => {
    const want = { tasks: NOTE_TASKS, index: ["done", "due"], snapshots: SNAPSHOTS, series: SERIES };
    expect(schema(ctx.db)).toEqual(want);
    const m26 = MIGRATIONS.find((m) => m.version === 26)!;
    expect(m26.name).toBe("dashboards");
    expect(m26.up).toBeUndefined();
    ctx.db.exec(m26.sql!);
    expect(schema(ctx.db)).toEqual(want);
    expect(
      MIGRATIONS.filter((m) => m.version >= 22 && m.version <= 25).map((m) => [m.version, m.name]),
    ).toEqual([
      [22, "drop-file-links"],
      [23, "run-context"],
      [24, "cleanup"],
      [25, "natureza"],
    ]);
    expect(MIGRATIONS.at(-1)!.version).toBe(26);
  });

  it("C19 a database migrated from 25 keeps its files, note_links, note_passages and review_state rows", () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "mordomo-paineis-m26-"));
    const paths = resolvePaths(home);
    ensureDirs(paths);
    try {
      const old = openDb(
        paths,
        MIGRATIONS.filter((m) => m.version <= 25),
      ).db;
      expect(old.pragma("user_version", { simple: true })).toBe(25);
      const fileId = Number(
        old
          .prepare(
            "INSERT INTO files (root, path, rel, name, ext, dir, area, size, mtime, indexed_at, title, tags, fields) VALUES ('/r', '/r/a.md', 'a.md', 'a.md', '.md', '/r', NULL, 3, 5, 7, 'A', '[\"x\"]', '{\"natureza\":\"plano\"}')",
          )
          .run().lastInsertRowid,
      );
      old
        .prepare(
          "INSERT INTO note_links (src_id, kind, target, label, line) VALUES (?, 'wikilink', 'b', NULL, 2)",
        )
        .run(fileId);
      old
        .prepare(
          "INSERT INTO note_passages (file_id, natureza, start_line, end_line) VALUES (?, 'plano', 3, 4)",
        )
        .run(fileId);
      old
        .prepare(
          "INSERT INTO review_state (path, last_reviewed, snooze_until, never, updated_at) VALUES ('/r/a.md', 1, NULL, 0, 2)",
        )
        .run();
      const rows = (db: Database.Database) => ({
        files: db.prepare("SELECT * FROM files ORDER BY id").all(),
        links: db.prepare("SELECT * FROM note_links ORDER BY src_id, line").all(),
        passages: db.prepare("SELECT * FROM note_passages ORDER BY file_id, start_line").all(),
        reviews: db.prepare("SELECT * FROM review_state ORDER BY path").all(),
      });
      const before = rows(old);
      old.close();
      const { db, migration } = openDb(paths);
      try {
        expect(migration).toMatchObject({ fromVersion: 25, toVersion: 26 });
        expect(rows(db)).toEqual(before);
        expect(db.prepare("SELECT COUNT(*) c FROM note_tasks").get()).toEqual({ c: 0 });
      } finally {
        db.close();
      }
    } finally {
      fs.rmSync(home, { recursive: true, force: true });
    }
  });
});

// ---- the task parser ---------------------------------------------------------------------------------------------

describe("C20 the tasks a note holds", () => {
  const one = (line: string) => parseTasks(`# Nota\n\n${line}\n`);
  it("C20 line 4 of `- [ ] Mandar a proposta 📅 2026-10-30 ⏫` is that task", () => {
    expect(parseTasks("# Nota\n\ntexto\n- [ ] Mandar a proposta 📅 2026-10-30 ⏫\n")).toEqual([
      { line: 4, done: 0, due: "2026-10-30", priority: 2, text: "Mandar a proposta" },
    ]);
  });
  const forms: Array<[string, string, Json]> = [
    ["[due:: 2026-10-30]", "- [ ] Ligar [due:: 2026-10-30]", { due: "2026-10-30", text: "Ligar" }],
    ["* [x]", "* [x] Feito", { done: 1, text: "Feito" }],
    ["- [X]", "- [X] Feito", { done: 1, text: "Feito" }],
    ["🔼", "- [ ] Revisar 🔼", { priority: 1, text: "Revisar" }],
    ["no marker", "- [ ] Sem nada", { priority: 0, due: null, text: "Sem nada" }],
    ["indented", "    - [ ] Sub", { done: 0, text: "Sub" }],
    ["320 characters", `- [ ] ${"a".repeat(320)}`, { text: "a".repeat(300) }],
    ["2026-02-30", "- [ ] Data ruim 📅 2026-02-30", { due: null, text: "Data ruim 📅 2026-02-30" }],
  ];
  for (const [name, line, want] of forms) {
    it(`C20 ${name}`, () => {
      const tasks = one(line);
      expect(tasks).toHaveLength(1);
      expect(tasks[0]).toMatchObject({ line: 3, ...want });
    });
  }
});

describe("C21 what is no task", () => {
  const forms: Array<[string, string]> = [
    ["inside a ``` fence", "```\n- [ ] x\n```"],
    ["inside a ~~~ fence", "~~~\n- [ ] x\n~~~"],
    ["`- [] x`", "- [] x"],
    ["`-[ ] x`", "-[ ] x"],
    ["`- [ ]` with nothing after it", "- [ ]"],
    ["`+ [ ] x`", "+ [ ] x"],
    ["`1. [ ] x`", "1. [ ] x"],
  ];
  for (const [name, body] of forms) {
    it(`C21 ${name}`, () => {
      expect(parseTasks(`# Nota\n\n${body}\n`)).toEqual([]);
    });
  }
  it("C21 inside the front matter", () => {
    expect(parseTasks("---\n- [ ] x\ntype: note\n---\n# Nota\n")).toEqual([]);
  });

  it("C21 `- [ ] x` in a .txt file of an indexed folder stores no row, where the same text in a .md does", () => {
    const dir = fs.mkdtempSync(path.join(work, "c21-"));
    fs.writeFileSync(path.join(dir, "a.txt"), "- [ ] x\n");
    fs.writeFileSync(path.join(dir, "a.md"), "- [ ] x\n");
    ctx.indexer.indexAll();
    const rows = (file: string) =>
      ctx.db
        .prepare("SELECT line, text FROM note_tasks WHERE src_id = (SELECT id FROM files WHERE path = ?)")
        .all(path.join(dir, file));
    expect(rows("a.txt")).toEqual([]);
    expect(rows("a.md")).toEqual([{ line: 1, text: "x" }]);
  });
});

// ---- a project's health ------------------------------------------------------------------------------------------

describe("C28 a project's health at its own layer", () => {
  const TODAY = "2026-10-30";
  const cases: Array<[string | null, string | null, string]> = [
    ["done", null, "done"],
    ["paused", null, "paused"],
    ["active", "2026-10-29", "behind"],
    ["active", "2026-10-30", "due_today"],
    ["draft", null, "in_review"],
    ["active", "2026-10-31", "on_track"],
    ["active", null, "on_track"],
    ["draft", "2026-10-29", "behind"],
    ["done", "2026-10-29", "done"],
    [null, null, "on_track"],
  ];
  for (const [status, due, health] of cases) {
    it(`C28 status ${status}, due ${due} → ${health}`, () => {
      expect(projectHealth(status, due, TODAY)).toBe(health);
    });
  }
});
