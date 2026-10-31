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
import { dashboardHighlights } from "../core/src/dashboards/highlights.js";
import { kpiDelta } from "../core/src/dashboards/kpi.js";
import { checkQuestionResult } from "../core/src/dashboards/question.js";
import { exportStamp, renderDashboardHtml } from "../core/src/dashboards/export.js";
import { resolveCleanupScope } from "../core/src/memory/cleanup.js";
import { refreshDue, snapshotStale } from "../core/src/dashboards/schedule.js";
import { dashboardSources, projectHealth, type DashboardSourceMap } from "../core/src/dashboards/sources.js";
import { parseTasks } from "../core/src/memory/tasks.js";
import { makeTempHome } from "./helpers.js";
import { assertFact } from "../core/src/memory/facts.js";
import { runRow } from "./helpers/paineisWorld.js";
import { ACCEPTED, REFUSALS, valid } from "./helpers/paineisDefinitions.js";

/**
 * .specs/features/cerebro-paineis, batch A (S1 and S2), the deciding code at its own layer (checks.md, Test policy rows
 * 1 and 2), with no HTTP: door 1's validator (`DashboardSpecSchema`), the evaluator over a source map, the scheduling
 * and `stale` maths, migration 26, the task parser and a project's health. The claims that name a local day are in
 * `paineis.localday.test.ts`; the HTTP side of each is in `paineis.routes.test.ts` and `paineis.refresh.test.ts`.
 * Batch B (S3) adds the delta rules (C40), the highlight rules (C43) and migration 27 (C98).
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
    // batch B adds migration 27 (door 8, the reminder kind of the inbox) after it
    expect(MIGRATIONS.slice(-2).map((m) => [m.version, m.name])).toEqual([
      [26, "dashboards"],
      [27, "notification-reminder"],
    ]);
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
        // to the latest, 27 (batch B, door 8), through 26
        expect(migration).toMatchObject({ fromVersion: 25, toVersion: 27 });
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

// ---- batch B: the KPI's delta (C40) ------------------------------------------------------------------------------

describe("C40 the delta rules at their own layer", () => {
  const H = 3_600_000;
  const D = 24 * H;
  const pts = (...list: Array<[number, number]>) => list.map(([at, value]) => ({ at: NOW + at, value }));

  it("C40 period week compares with the oldest point of the last 7 days: 10 at -8 d, 4 at -6 d, 6 now → delta 2", () => {
    expect(kpiDelta(pts([-8 * D, 10], [-6 * D, 4], [0, 6]), "week")).toMatchObject({
      delta: 2,
      direction: "up",
    });
    // the same points over a day compare with the newest one alone (nothing else is within 24 h)
    expect(kpiDelta(pts([-8 * D, 10], [-6 * D, 4], [0, 6]), "day")).toMatchObject({ delta: 0 });
  });
  it("C40 upIsGood false with direction up → good false", () => {
    expect(kpiDelta(pts([-H, 1], [0, 2]), "day", false)).toMatchObject({ direction: "up", good: false });
  });
  it("C40 upIsGood absent, up → good true; down → good false", () => {
    expect(kpiDelta(pts([-H, 1], [0, 2]))).toMatchObject({ direction: "up", good: true });
    expect(kpiDelta(pts([-H, 2], [0, 1]))).toMatchObject({ direction: "down", good: false });
  });
  it("C40 base 0 → deltaPct null", () => {
    expect(kpiDelta(pts([-H, 0], [0, 3]))).toEqual({ delta: 3, deltaPct: null, direction: "up", good: true });
  });
  it("C40 equal values → direction flat, delta 0", () => {
    expect(kpiDelta(pts([-H, 4], [0, 4]))).toMatchObject({ delta: 0, direction: "flat" });
  });
  it("C40 base 20, now 23 → deltaPct 15", () => {
    expect(kpiDelta(pts([-H, 20], [0, 23]))).toEqual({ delta: 3, deltaPct: 15, direction: "up", good: true });
  });
  it("C40 fewer than two points → no delta", () => {
    expect(kpiDelta(pts([0, 5]))).toBeNull();
    expect(kpiDelta([])).toBeNull();
  });
});

// ---- batch B: the highlight rules (C43) --------------------------------------------------------------------------

describe("C43 the highlight rules at their own layer", () => {
  /** The local day `offset` days from NOW's, as `AAAA-MM-DD`. */
  const day = (offset: number) => {
    const d = new Date(NOW);
    const at = new Date(d.getFullYear(), d.getMonth(), d.getDate() + offset);
    return `${at.getFullYear()}-${String(at.getMonth() + 1).padStart(2, "0")}-${String(at.getDate()).padStart(2, "0")}`;
  };
  let n = 0;
  const widget = (source: Json): Json => ({ id: `w${++n}`, kind: "list", title: "W", source });
  /** The highlights of one widget per `[source, items]`, at NOW. */
  const run = (parts: Array<[Json, Json[]]>, since?: number) => {
    const widgets = parts.map(([source]) => widget(source));
    const snapshot = {
      v: 1 as const,
      dashboardId: "t",
      generatedAt: NOW,
      sources: [],
      widgets: widgets.map((w, i) => ({
        id: w.id,
        kind: "list" as const,
        status: "ok" as const,
        data: { items: parts[i]![1] },
      })),
    };
    return dashboardHighlights({ widgets: widgets as never }, snapshot, { now: NOW, since });
  };
  const TASKS = { kind: "tasks", window: "week" };
  const DECISIONS = { kind: "decisions", window: "week" };
  const task = (id: number, due: string, extra: Json = {}): Json => ({
    path: `/m/t${id}.md`,
    line: 3,
    fileId: id,
    text: `Tarefa ${id}`,
    done: false,
    due,
    mtime: 1,
    ...extra,
  });
  const decision = (id: number, state: string, day: string): Json => ({
    text: `Decisão ${id}`,
    state,
    day,
    path: `/m/d${id}.md`,
    fileId: id,
    line: null,
    mtime: 1,
  });
  const rules = (out: Json[]) => out.map((h) => [h.rule, h.title]);

  it("C43 overdue: due yesterday → in, today → out (it is due_today)", () => {
    expect(rules(run([[TASKS, [task(1, day(-1))]]]))).toEqual([["overdue", "Tarefa 1"]]);
    expect(run([[TASKS, [task(1, day(0))]]]).map((h) => h.rule)).not.toContain("overdue");
  });
  it("C43 due_today: today → in, tomorrow → out", () => {
    expect(rules(run([[TASKS, [task(1, day(0))]]]))).toEqual([["due_today", "Tarefa 1"]]);
    expect(run([[TASKS, [task(1, day(1))]]])).toEqual([]);
  });
  it("C43 decided_this_week: a decided decision of the week → in, an open one → out", () => {
    expect(rules(run([[DECISIONS, [decision(1, "decided", day(0))]]]))).toEqual([
      ["decided_this_week", "Decisão 1"],
    ]);
    expect(run([[DECISIONS, [decision(1, "open", day(0))]]])).toEqual([]);
  });
  it("C43 open_decision_7d: an open decision 8 local days old → in, 7 → out", () => {
    expect(rules(run([[DECISIONS, [decision(1, "open", day(-8))]]]))).toEqual([
      ["open_decision_7d", "Decisão 1"],
    ]);
    expect(run([[DECISIONS, [decision(1, "open", day(-7))]]])).toEqual([]);
  });
  it("C43 project_behind: a behind project → in, an on_track one → out", () => {
    const project = (health: string): Json => ({
      fileId: 5,
      path: "/m/p.md",
      title: "Site novo",
      health,
      mtime: 1,
    });
    expect(run([[{ kind: "projects" }, [project("behind")]]])).toEqual([
      { rule: "project_behind", title: "Site novo", tone: "danger", target: "/brain?sel=5" },
    ]);
    expect(run([[{ kind: "projects" }, [project("on_track")]]])).toEqual([]);
  });
  it("C43 review_due: an item of the review queue → in, with its target", () => {
    expect(run([[{ kind: "reviews" }, [{ path: "/m/r a.md", name: "r a.md", mtime: 1 }]]])).toEqual([
      { rule: "review_due", title: "r a.md", tone: "info", target: "/brain/reviews?path=%2Fm%2Fr%20a.md" },
    ]);
  });
  it("C43 connector_flagged: flagged true → in (its href), false → out", () => {
    const source = { kind: "connector", id: "mail", read: "list" };
    expect(
      run([[source, [{ id: "e1", title: "Urgente", flagged: true, href: "https://m/e1", ts: 1 }]]]),
    ).toEqual([{ rule: "connector_flagged", title: "Urgente", tone: "info", target: "https://m/e1" }]);
    expect(run([[source, [{ id: "e1", title: "Urgente", flagged: false, ts: 1 }]]])).toEqual([]);
  });
  it("C43 new_since_visit: an item whose time is after since → in, equal → out, no time → out, no since → none", () => {
    const source = { kind: "connector", id: "mail", read: "list" };
    const items = [
      { id: "a", title: "Depois", ts: 101 },
      { id: "b", title: "Igual", ts: 100 },
      { id: "c", title: "Sem hora" },
    ];
    expect(rules(run([[source, items]], 100))).toEqual([["new_since_visit", "Depois"]]);
    expect(run([[source, items]])).toEqual([]);
    const note = { fileId: 9, path: "/m/n.md", title: "Nota", mtime: 101 };
    expect(rules(run([[{ kind: "notes" }, [note]]], 100))).toEqual([["new_since_visit", "Nota"]]);
  });
  it("C43 the output follows the order of door 5 whatever the order of the input, an item once under its first rule, at most 8", () => {
    const parts: Array<[Json, Json[]]> = [
      [
        { kind: "connector", id: "mail", read: "list" },
        [{ id: "e", title: "Marcado", flagged: true, ts: 500 }],
      ],
      [{ kind: "reviews" }, [{ path: "/m/r.md", name: "r.md", mtime: 500 }]],
      [
        { kind: "projects" },
        [{ fileId: 1, path: "/m/t1.md", title: "Projeto da tarefa", health: "behind", mtime: 500 }],
      ],
      [DECISIONS, [decision(7, "open", day(-9)), decision(8, "decided", day(0))]],
      [TASKS, [task(2, day(0)), task(1, day(-2), { mtime: 500 })]],
    ];
    expect(rules(run(parts, 100))).toEqual([
      ["overdue", "Tarefa 1"],
      ["due_today", "Tarefa 2"],
      ["decided_this_week", "Decisão 8"],
      ["open_decision_7d", "Decisão 7"],
      // the project of the overdue task is the same note: it is not given again
      ["review_due", "r.md"],
      ["connector_flagged", "Marcado"],
    ]);
    const many: Json[] = Array.from({ length: 10 }, (_, i) => task(100 + i, day(-1)));
    expect(run([[TASKS, many]])).toHaveLength(8);
  });
});

// ---- batch B: migration 27 (C98, door 8) -------------------------------------------------------------------------

describe("C98 migration 27, the reminder kind of the inbox", () => {
  const columns = (db: Database.Database) =>
    (db.pragma("table_info(notifications)") as Json[]).map(({ name, type, notnull, dflt_value, pk }) => ({
      name,
      type,
      notnull,
      dflt_value,
      pk,
    }));
  const indexes = (db: Database.Database) =>
    (
      db
        .prepare(
          "SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'notifications' ORDER BY name",
        )
        .all() as Json[]
    ).map((r) => r.name);
  const insert = (db: Database.Database, id: string, kind: string, extra: Json = {}) =>
    db
      .prepare(
        "INSERT INTO notifications (id, kind, tone, title, body, href, approval_id, run_id, ts, read, dedupe_key, message_key, message_params) VALUES (@id, @kind, @tone, @title, NULL, @href, NULL, NULL, @ts, @read, @dedupe, @key, @params)",
      )
      .run({
        id,
        kind,
        tone: "warn",
        title: `T ${id}`,
        href: null,
        ts: 5,
        read: 0,
        dedupe: null,
        key: null,
        params: null,
        ...extra,
      });

  it("C98 MIGRATIONS ends with 26 dashboards and 27 notification-reminder; a database migrated from 26 keeps its rows, columns and indexes, takes kind reminder and refuses lembrete; again leaves the same schema", () => {
    expect(MIGRATIONS.slice(-2).map((m) => [m.version, m.name])).toEqual([
      [26, "dashboards"],
      [27, "notification-reminder"],
    ]);
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "mordomo-paineis-m27-"));
    const paths = resolvePaths(home);
    ensureDirs(paths);
    try {
      const old = openDb(
        paths,
        MIGRATIONS.filter((m) => m.version <= 26),
      ).db;
      expect(old.pragma("user_version", { simple: true })).toBe(26);
      insert(old, "n_a", "run");
      insert(old, "n_b", "system", {
        href: "/x",
        read: 1,
        dedupe: "k",
        key: "sentinel.reviewDue",
        params: '{"count":2}',
      });
      expect(() => insert(old, "n_c", "reminder")).toThrow(/CHECK/);
      const rows = (db: Database.Database) => db.prepare("SELECT * FROM notifications ORDER BY id").all();
      const before = { rows: rows(old), columns: columns(old), indexes: indexes(old) };
      expect(before.indexes).toEqual(
        expect.arrayContaining(["idx_notifications_read", "idx_notifications_ts"]),
      );
      old.close();
      const { db, migration } = openDb(paths);
      try {
        expect(migration).toMatchObject({ fromVersion: 26, toVersion: 27 });
        expect(rows(db)).toEqual(before.rows);
        expect(columns(db)).toEqual(before.columns);
        expect(indexes(db)).toEqual(
          expect.arrayContaining(["idx_notifications_read", "idx_notifications_ts"]),
        );
        insert(db, "n_r", "reminder");
        expect(db.prepare("SELECT kind FROM notifications WHERE id = 'n_r'").get()).toEqual({
          kind: "reminder",
        });
        expect(() => insert(db, "n_l", "lembrete")).toThrow(/CHECK/);
        const schema = db.prepare("SELECT sql FROM sqlite_master WHERE name = 'notifications'").get();
        db.exec(
          MIGRATIONS.find((m) => m.version === 27)!.sql!.replace(/notifications_v27/g, "notifications_again"),
        );
        expect(db.prepare("SELECT sql FROM sqlite_master WHERE name = 'notifications'").get()).toEqual(
          schema,
        );
        expect(columns(db)).toEqual(before.columns);
      } finally {
        db.close();
      }
    } finally {
      fs.rmSync(home, { recursive: true, force: true });
    }
  });
});

// ---- batch B: the answer of a question dashboard (C54, C55) ------------------------------------------------------

describe("the host's check of a question dashboard's answer, at its own layer", () => {
  let proj: string;
  let lookalike: string;
  const files: Record<string, string> = {};
  beforeAll(() => {
    proj = path.join(work, "proj");
    lookalike = path.join(work, "proj-old");
    fs.mkdirSync(proj, { recursive: true });
    fs.mkdirSync(lookalike, { recursive: true });
    const row = (root: string, rel: string, fields: Json = {}) => {
      const full = path.join(root, rel);
      ctx.db
        .prepare(
          "INSERT INTO files (root, path, rel, name, ext, dir, area, size, mtime, indexed_at, title, tags, fields) VALUES (?, ?, ?, ?, '.md', ?, NULL, 1, 1, 1, NULL, '[]', ?)",
        )
        .run(root, full, rel, path.basename(full), path.dirname(full), JSON.stringify(fields));
      return full;
    };
    files.ok = row(proj, "metricas.md");
    files.plano = row(proj, "metas.md", { natureza: "plano" });
    files.excluded = row(work, "privado/segredo.md");
    files.outside = row(lookalike, "velho.md");
    const s = ctx.settings();
    s.excludes = [...s.excludes, "privado"];
    s.contexts = [{ id: "projeto-x", name: "Projeto X", paths: [proj] }];
    ctx.settingsStore.save(s);
  });
  const env = (scoped = false) => ({
    db: ctx.db,
    paths: ctx.paths,
    settings: ctx.settings(),
    scope: scoped
      ? resolveCleanupScope({ paths: ctx.paths, settings: ctx.settings() }, { context: "projeto-x" })
      : null,
  });
  const valid = (): Json => ({
    v: 1,
    widgets: [
      { id: "a", kind: "kpi", title: "A", data: { value: 1 }, citations: [{ path: files.ok, section: "S" }] },
      {
        id: "b",
        kind: "list",
        title: "B",
        data: { items: [{ title: "x", path: files.ok }] },
        citations: [{ path: files.ok, section: "S" }],
      },
    ],
  });
  const check = (answer: unknown, scoped = false) =>
    checkQuestionResult(Buffer.isBuffer(answer) ? answer : Buffer.from(JSON.stringify(answer)), env(scoped));
  const reasonOf = (answer: unknown, scoped = false) => {
    const verdict = check(answer, scoped);
    return verdict.ok ? null : verdict.reason;
  };

  it("C54 a valid answer of two widgets, each with one citation, is accepted (also inside the context)", () => {
    for (const scoped of [false, true]) {
      const verdict = check(valid(), scoped);
      expect(verdict.ok, String(scoped)).toBe(true);
      if (verdict.ok) expect(verdict.widgets.map((w) => w.id)).toEqual(["a", "b"]);
    }
  });
  const cases: Array<[string, (a: Json) => unknown, RegExp, boolean?]> = [
    [
      "it does not validate against the snapshot schema",
      (a) => ({ ...a, widgets: [{ ...a.widgets[0], kind: "pie" }] }),
      /schema/,
    ],
    [
      "a widget has no citation",
      (a) => ({ ...a, widgets: [{ ...a.widgets[0], citations: [] }, a.widgets[1]] }),
      /no citation/,
    ],
    [
      "a citation names a path the index does not have",
      (a) => ({
        ...a,
        widgets: [
          { ...a.widgets[0], citations: [{ path: path.join(proj, "nao.md"), section: "S" }] },
          a.widgets[1],
        ],
      }),
      /index does not have/,
    ],
    [
      "a path today's policy excludes",
      (a) => ({
        ...a,
        widgets: [{ ...a.widgets[0], citations: [{ path: files.excluded, section: "S" }] }, a.widgets[1]],
      }),
      /policy excludes/,
    ],
    [
      "a path outside the context's scope at the look-alike proj-old",
      (a) => ({
        ...a,
        widgets: [{ ...a.widgets[0], citations: [{ path: files.outside, section: "S" }] }, a.widgets[1]],
      }),
      /outside the dashboard's context/,
      true,
    ],
    [
      "an item of natureza plano without its label",
      (a) => ({
        ...a,
        widgets: [a.widgets[0], { ...a.widgets[1], data: { items: [{ title: "Meta", path: files.plano }] } }],
      }),
      /natureza plano and lacks its label/,
    ],
    [
      "7 widgets",
      (a) => ({ ...a, widgets: Array.from({ length: 7 }, (_, i) => ({ ...a.widgets[0], id: `w${i}` })) }),
      /7 widgets; at most 6/,
    ],
    ["256 KB + 1 byte", () => Buffer.alloc(262_145, " "), /larger than 262144 bytes/],
  ];
  for (const [name, change, reason, scoped] of cases) {
    it(`C54 refuses: ${name}, for that reason alone`, () => {
      expect(reasonOf(change(valid()), scoped)).toMatch(reason);
    });
  }
  it("C54 the same refusals pass once their one fault is gone: the plano item with its label, the look-alike file without a context", () => {
    expect(
      check({
        ...valid(),
        widgets: [
          valid().widgets[0],
          {
            ...valid().widgets[1],
            data: { items: [{ title: "Meta", path: files.plano, natureza: "plano" }] },
          },
        ],
      }).ok,
    ).toBe(true);
    expect(
      check({
        ...valid(),
        widgets: [
          { ...valid().widgets[0], citations: [{ path: files.outside, section: "S" }] },
          valid().widgets[1],
        ],
      }).ok,
    ).toBe(true);
  });

  it("C55 an excluded file refuses the answer on each path a file arrives by: citations[], a list item's path, a table row's path", () => {
    const viaCitation = valid();
    viaCitation.widgets[0].citations = [{ path: files.excluded, section: "S" }];
    const viaItem = valid();
    viaItem.widgets[1].data.items = [{ title: "x", path: files.excluded }];
    const viaRow = valid();
    viaRow.widgets.push({
      id: "t",
      kind: "table",
      title: "T",
      data: { columns: ["n"], rows: [{ cells: ["1"], path: files.excluded }] },
      citations: [{ path: files.ok, section: "S" }],
    });
    for (const [name, answer] of [
      ["citations[]", viaCitation],
      ["a list item's path", viaItem],
      ["a table row's path", viaRow],
    ] as const) {
      expect(reasonOf(answer), name).toMatch(/policy excludes/);
    }
    // the same answer with the file nowhere passes
    const clean = valid();
    clean.widgets.push({
      ...viaRow.widgets[2],
      data: { columns: ["n"], rows: [{ cells: ["1"], path: files.ok }] },
    });
    expect(check(clean).ok).toBe(true);
  });
});

// ---- batch B: the export renderer (C57) --------------------------------------------------------------------------

describe("C57 the export renderer at its own layer", () => {
  const at = new Date(2026, 9, 30, 14, 7).getTime();
  const snapshot = (widgets: Json[]): Json => ({
    v: 1,
    dashboardId: "t",
    generatedAt: at,
    sources: [{ id: "notes", kind: "notes", status: "ok", syncedAt: at }],
    widgets,
  });
  const render = (definition: Json, widgets: Json[]) =>
    renderDashboardHtml(definition as never, snapshot(widgets) as never, at);

  it("C57 no script and no outside resource; every text escaped; each chart an SVG then the table of the same values; the footer's date; the stamp is local", () => {
    const html = render(
      {
        title: `<script>alert("x")</script>`,
        kind: "overview",
        widgets: [
          { id: "k", kind: "kpi", title: "<b>x</b>", source: { kind: "metrics", series: "runs24h" } },
          { id: "b", kind: "bars", title: "Barras", source: { kind: "notes", groupBy: "status" } },
          { id: "l", kind: "list", title: "Lista", source: { kind: "connector", id: "c", read: "list" } },
        ],
      },
      [
        {
          id: "k",
          kind: "kpi",
          status: "ok",
          data: {
            value: 3,
            series: [
              { at: at - 3_600_000, value: 2 },
              { at, value: 3 },
            ],
          },
        },
        {
          id: "b",
          kind: "bars",
          status: "ok",
          data: {
            categories: [
              { label: "active", count: 5 },
              { label: "draft", count: 2 },
            ],
          },
        },
        {
          id: "l",
          kind: "list",
          status: "ok",
          data: {
            items: [
              { id: "a", title: "url(x) & @import <link>", href: "https://ex.example/a" },
              { id: "b", title: "Mal", href: "javascript:alert(1)" },
            ],
          },
        },
      ],
    );
    for (const banned of ["<script", "src=", "url(", "@import", "<link"])
      expect(html, banned).not.toContain(banned);
    expect(html).toContain("&lt;script&gt;alert&#40;&quot;x&quot;)&lt;/script&gt;");
    // text that spells a resource is written so that it no longer does
    expect(html).toContain("url&#40;x) &amp; &#64;import &lt;link&gt;");
    expect(html).toContain("&lt;b&gt;x&lt;/b&gt;");
    expect(html).toContain('<a href="https://ex.example/a">');
    expect(html).not.toContain("javascript:");
    const charts = [...html.matchAll(/<svg[\s\S]*?<\/svg>(<table>[\s\S]*?<\/table>)/g)];
    expect(charts).toHaveLength(2);
    expect(charts[0]![1]).toContain("<td>2</td>");
    expect(charts[0]![1]).toContain("<td>3</td>");
    expect(charts[1]![1]).toContain("<td>active</td><td>5</td>");
    expect(charts[1]![1]).toContain("<td>draft</td><td>2</td>");
    expect(html).toContain("Exportado do MordomoOS em 30/10/2026");
    expect(html).toContain("Atualizado às 14:07");
    expect(exportStamp(at)).toBe("2026-10-30T1407");
  });

  it("C57 a question dashboard's citations read nome § seção", () => {
    const html = render({ title: "Pergunta", kind: "question", widgets: [] }, [
      {
        id: "metas",
        kind: "note",
        status: "ok",
        data: {
          text: "Crescer",
          title: "Metas",
          citations: [{ path: "/m/plano.md", section: "Metas", name: "plano.md", fileId: 4 }],
        },
      },
    ]);
    expect(html).toContain("<li>plano.md § Metas</li>");
  });
});

// ---- round 1, F5 and F1: the source rules at their own layer, with no HTTP ---------------------------------------

describe("Test policy row 1: the sources' rules at their own layer (round 1)", () => {
  let home2: ReturnType<typeof makeTempHome>;
  let ctx2: AppContext;
  let w2: string;
  const MIN = 60_000;
  const HOUR = 60 * MIN;
  const DAY = 24 * HOUR;
  const call = (over: Json = {}) => ({
    now: NOW,
    limit: 50,
    scope: null,
    context: null,
    fresh: false,
    ...over,
  });
  const deps = (over: Json = {}) => ({
    db: ctx2.db,
    paths: ctx2.paths,
    settings: () => ctx2.settings(),
    metricsHistory: ctx2.metricsHistory,
    connectors: ctx2.connectors,
    connectorCache: ctx2.connectorCache,
    ...over,
  });
  const put = (file: string, text: string, mtime?: number) => {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, text);
    if (mtime !== undefined) fs.utimesSync(file, mtime / 1000, mtime / 1000);
    return file;
  };
  const fm = (fields: Record<string, string>) =>
    `---\n${Object.entries(fields)
      .map(([k, v]) => `${k}: ${v}`)
      .join("\n")}\n---\n# N\n`;
  const ok = async (out: unknown) => {
    const got = (await out) as Json;
    expect(got.status).toBe("ok");
    return got.data as Json;
  };

  beforeAll(async () => {
    home2 = makeTempHome("mordomo-paineis-layer-sources-");
    ctx2 = new AppContext(home2.paths.home);
    w2 = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "mordomo-paineis-layer-sources-work-")));
    const s = ctx2.settings();
    s.indexedFolders = [{ path: w2, area: null, enabled: true }];
    s.contexts = [{ id: "projeto-x", name: "Projeto X", paths: [path.join(w2, "proj")] }];
    ctx2.settingsStore.save(s);
    const notes = path.join(ctx2.paths.memory, "notes", "f5");
    put(
      path.join(notes, "decisao-velha.md"),
      fm({ type: "decision", status: "draft", updated: "2026-10-01" }),
      NOW - 2 * DAY,
    );
    put(
      path.join(notes, "decisao-nova.md"),
      fm({ type: "decision", status: "active", updated: "2026-10-20" }),
      NOW - 3 * DAY,
    );
    put(path.join(notes, "projeto.md"), fm({ type: "project", status: "active" }), NOW - DAY);
    put(path.join(notes, "sem-status.md"), fm({ type: "project" }), NOW - 4 * DAY);
    put(path.join(w2, "proj", "fonte.md"), "# Fonte\n");
    put(path.join(w2, "proj-old", "fonte.md"), "# Velha\n");
    put(path.join(w2, "fechado", "segredo.md"), "# Segredo\n");
    await ctx2.indexer.indexAllAsync();
  });
  afterAll(() => {
    ctx2.close();
    home2.cleanup();
    fs.rmSync(w2, { recursive: true, force: true });
  });

  it("C29 notes, at its layer: a type filter, the limit with the total, updated then mtime descending, groupBy status in the vocabulary's order then none", async () => {
    const { notes } = dashboardSources(deps() as never);
    const folder = path.join(ctx2.paths.memory, "notes", "f5");
    const decisions = await ok(notes!({ kind: "notes", type: ["decision"], folder }, call()));
    expect(decisions.items.map((i: Json) => path.basename(i.path))).toEqual([
      "decisao-nova.md",
      "decisao-velha.md",
    ]);
    const one = await ok(notes!({ kind: "notes", folder }, call({ limit: 1 })));
    expect([one.items.length, one.total]).toEqual([1, 4]);
    const grouped = await ok(notes!({ kind: "notes", folder, groupBy: "status" }, call()));
    expect(grouped.categories).toEqual([
      { label: "active", count: 2 },
      { label: "draft", count: 1 },
      { label: null, count: 1 },
    ]);
  });

  // Round 2, finding 5: the other filter rows of `notes` at their layer (`changed: "week"` names a local week: it is in the
  // pinned tests/paineis.localday.test.ts).
  it("C29 notes, at its layer: status, tags, natureza, escopo, and a folder and not its look-alike, one asserted case each", async () => {
    const base = path.join(ctx2.paths.memory, "notes", "f5b");
    const note = (rel: string, fields: Record<string, string>) => put(path.join(base, rel), fm(fields));
    const status = note("status-sim.md", { status: "draft" });
    note("status-nao.md", { status: "active" });
    const tags = put(path.join(base, "tags-sim.md"), "---\ntags: [cliente, x]\n---\n# Sim\n");
    put(path.join(base, "tags-nao.md"), "---\ntags: [fornecedor]\n---\n# Não\n");
    const natureza = note("nat-sim.md", { natureza: "plano" });
    note("nat-nao.md", { natureza: "fato" });
    const escopo = note("esc-sim.md", { escopo: "equipe" });
    note("esc-nao.md", { escopo: "pessoal" });
    const inA = note("a/um.md", {});
    note("a-b/dois.md", {});
    await ctx2.indexer.indexAllAsync();
    const { notes } = dashboardSources(deps() as never);
    const only = async (filter: Json) =>
      ((await ok(notes!({ kind: "notes", folder: base, ...filter }, call()))).items as Json[]).map(
        (i) => i.path,
      );
    expect(await only({ status: ["draft"] })).toEqual([status]);
    expect(await only({ tags: ["cliente"] })).toEqual([tags]);
    expect(await only({ natureza: ["plano"] })).toEqual([natureza]);
    expect(await only({ escopo: ["equipe"] })).toEqual([escopo]);
    const folder = (
      (await ok(notes!({ kind: "notes", folder: path.join(base, "a") }, call()))).items as Json[]
    ).map((i) => i.path);
    expect(folder).toEqual([inA]);
  });

  it("C34 reviews, at its layer: the items and the total are C6's queue's, handed the context and the widget's limit", async () => {
    const asked: Json[] = [];
    const stub = ((_db: unknown, _env: unknown, query: Json) => {
      asked.push(query);
      return { items: [{ path: "/x/a.md" }], total: 9, nextDue: null };
    }) as never;
    const { reviews } = dashboardSources(deps({ reviewsDue: stub }) as never);
    const context = ctx2.settings().contexts[0]!;
    const got = await ok(reviews!({ kind: "reviews" }, call({ limit: 3, context })));
    expect(got).toEqual({ items: [{ path: "/x/a.md" }], total: 9 });
    expect(asked).toEqual([{ kind: "due", context, limit: 3, now: NOW }]);
  });

  it("C35 facts, at its layer: open facts newest first; never one whose source today's policy excludes or the index has no row of; in a context only those inside", async () => {
    const at = (rel: string) => path.join(w2, rel);
    const fact = (subject: string, validFrom: number, sourcePath: string | null) =>
      assertFact(ctx2.db, {
        subject,
        predicate: "é",
        object: "x",
        validFrom,
        ...(sourcePath ? { sourcePath } : {}),
      }).fact;
    fact("Dentro", NOW - 3 * DAY, at("proj/fonte.md"));
    fact("Parecida", NOW - 2 * DAY, at("proj-old/fonte.md"));
    fact("Excluída", NOW - DAY, at("fechado/segredo.md"));
    fact("Sem linha", NOW - HOUR, at("proj/nunca-indexada.md"));
    fact("Sem fonte", NOW - 4 * DAY, null);
    // the folder is excluded after it was indexed: its row is still in files, only today's policy hides it
    const s = ctx2.settings();
    s.excludes = [...s.excludes, "fechado"];
    ctx2.settingsStore.save(s);
    expect(
      ctx2.db.prepare("SELECT COUNT(*) c FROM files WHERE path = ?").get(at("fechado/segredo.md")),
    ).toEqual({ c: 1 });
    const { facts } = dashboardSources(deps() as never);
    const all = await ok(facts!({ kind: "facts" }, call()));
    expect(all.items.map((i: Json) => i.subject)).toEqual(["Parecida", "Dentro", "Sem fonte"]);
    const scope = resolveCleanupScope(
      { paths: ctx2.paths, settings: ctx2.settings() },
      { context: "projeto-x" },
    );
    const scoped = await ok(facts!({ kind: "facts" }, call({ scope })));
    expect(scoped.items.map((i: Json) => i.subject)).toEqual(["Dentro"]);
  });

  it("C30 runs and approvals, at their layer: active first then finished in 24 h newest first; pending approvals oldest first with ageMs", async () => {
    runRow(
      { ctx: ctx2 },
      {
        id: "r-fim-1h",
        status: "done",
        createdAt: NOW - 2 * HOUR,
        startedAt: NOW - 2 * HOUR,
        finishedAt: NOW - HOUR,
        durationMs: HOUR,
      },
    );
    runRow(
      { ctx: ctx2 },
      { id: "r-fim-velho", status: "done", createdAt: NOW - 2 * DAY, finishedAt: NOW - DAY - MIN },
    );
    runRow(
      { ctx: ctx2 },
      {
        id: "r-rodando",
        status: "running",
        skill: "recall",
        createdAt: NOW - 10 * MIN,
        startedAt: NOW - 10 * MIN,
      },
    );
    runRow({ ctx: ctx2 }, { id: "r-fila", status: "queued", createdAt: NOW - MIN });
    const { runs, approvals } = dashboardSources(deps() as never);
    const r = await ok(runs!({ kind: "runs" }, call()));
    expect(r.items.map((i: Json) => [i.id, i.state])).toEqual([
      ["r-fila", "queued"],
      ["r-rodando", "running"],
      ["r-fim-1h", "done"],
    ]);
    expect(r.items[2].durationMs).toBe(HOUR);
    const add = ctx2.db.prepare(
      "INSERT INTO approvals (id, created_at, kind, description, status) VALUES (?, ?, 'run_write', 'x', ?)",
    );
    add.run("a-nova", NOW - 5 * MIN, "pending");
    add.run("a-antiga", NOW - 2 * HOUR, "pending");
    add.run("a-feita", NOW - 3 * HOUR, "approved");
    const a = await ok(approvals!({ kind: "approvals" }, call()));
    expect(a.items.map((i: Json) => [i.id, i.ageMs])).toEqual([
      ["a-antiga", 2 * HOUR],
      ["a-nova", 5 * MIN],
    ]);
  });

  it("C31 metrics, at its layer: no sample is a null value; the newest sample's field and the daily points", async () => {
    const { metrics } = dashboardSources(deps() as never);
    expect((await ok(metrics!({ kind: "metrics", series: "runs24h" }, call()))).value).toBeNull();
    const sample = (at: number, runs: number) =>
      ctx2.metricsHistory.sample(
        {
          runs: {
            total: runs,
            last24h: runs,
            failed24h: 0,
            costTodayUsd: 0,
            tokensToday: 0,
            spendWeekUsd: 0,
          },
          inboxUnread: 0,
          approvalsPending: 0,
          approvalWaitAvgMs: null,
        },
        at,
      );
    sample(NOW - 3 * HOUR, 7);
    sample(NOW - HOUR, 5);
    const got = await ok(metrics!({ kind: "metrics", series: "runs24h" }, call()));
    expect(got.value).toBe(5);
    expect(got.points.at(-1).value).toBe(5);
  });

  // Round 2, finding 5: every series name and the daily rule of `dailyPoints` (the day's highest for cost and tokens,
  // the day's last sample for the others), at the layer.
  it("C31 metrics, at its layer: each of the six names is the newest sample's field, and today's point is the day's highest cost and tokens and the last value of the others", async () => {
    const sample = (at: number, v: Record<string, number>) =>
      ctx2.metricsHistory.sample(
        {
          runs: {
            total: v.runs24h!,
            last24h: v.runs24h!,
            failed24h: v.failed24h!,
            costTodayUsd: v.costTodayUsd!,
            tokensToday: v.tokensToday!,
            spendWeekUsd: 0,
          },
          inboxUnread: v.inboxUnread!,
          approvalsPending: v.approvalsPending!,
          approvalWaitAvgMs: null,
        },
        at,
      );
    const earlier = {
      runs24h: 9,
      failed24h: 4,
      costTodayUsd: 0.4,
      tokensToday: 900,
      inboxUnread: 8,
      approvalsPending: 2,
    };
    const newest = {
      runs24h: 6,
      failed24h: 3,
      costTodayUsd: 0.25,
      tokensToday: 600,
      inboxUnread: 5,
      approvalsPending: 1,
    };
    sample(NOW - 2 * HOUR, earlier);
    sample(NOW - 30 * MIN, newest);
    const today = { ...newest, costTodayUsd: 0.4, tokensToday: 900 };
    const { metrics } = dashboardSources(deps() as never);
    for (const series of Object.keys(newest) as Array<keyof typeof newest>) {
      const got = await ok(metrics!({ kind: "metrics", series }, call()));
      expect(got.value, series).toBe(newest[series]);
      expect(got.points.at(-1).value, series).toBe(today[series]);
    }
  });

  it("C32 connector, at its layer: list cut at the limit with the six keys, flagged, a summary key, no mapping and not in the registry are not_configured", async () => {
    const repoConnector = JSON.parse(
      fs.readFileSync(
        path.join(path.resolve(import.meta.dirname, ".."), "connectors", "calendar-google.json"),
        "utf8",
      ),
    );
    const mapped = { ...repoConnector, id: "agenda", name: "Agenda" };
    const bare = { ...repoConnector, id: "cru", name: "Cru" };
    delete bare.dataMapping;
    const registry = { get: (id: string) => (id === "agenda" ? mapped : id === "cru" ? bare : undefined) };
    const items = Array.from({ length: 5 }, (_, i) => ({
      id: `e${i}`,
      title: `T${i}`,
      ts: NOW + i,
      flagged: i % 2 === 0,
      body: "raw",
      href: `https://x/${i}`,
    }));
    const cache = { read: async () => ({ status: "ok", syncedAt: NOW, items, summary: { unread: 4 } }) };
    const { connector } = dashboardSources(deps({ connectors: registry, connectorCache: cache }) as never);
    const list = await ok(connector!({ kind: "connector", id: "agenda", read: "list" }, call({ limit: 3 })));
    expect(list.items).toEqual(items.slice(0, 3).map(({ body: _b, ...rest }) => rest));
    expect(list.total).toBe(5);
    const flagged = await ok(connector!({ kind: "connector", id: "agenda", read: "flagged" }, call()));
    expect(flagged.items.map((i: Json) => i.id)).toEqual(["e0", "e2", "e4"]);
    const summary = await ok(
      connector!({ kind: "connector", id: "agenda", read: "summary", key: "unread" }, call()),
    );
    expect(summary.value).toBe(4);
    const none = (await connector!({ kind: "connector", id: "cru", read: "list" }, call())) as Json;
    expect(none.status).toBe("not_configured");
    expect(none.data.connector).toEqual({ id: "cru", name: "Cru" });
    const missing = (await connector!({ kind: "connector", id: "nenhum", read: "list" }, call())) as Json;
    expect([missing.status, missing.data.connector]).toEqual([
      "not_configured",
      { id: "nenhum", name: "nenhum" },
    ]);
  });
});
