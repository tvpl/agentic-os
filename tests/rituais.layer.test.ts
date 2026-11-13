import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type Database from "better-sqlite3";
import { MIGRATIONS } from "../core/src/db/migrations.js";
import { openDb } from "../core/src/db/db.js";
import { ensureDirs, resolvePaths } from "../core/src/paths.js";
import {
  collectLoops,
  decideLoop,
  hidesLoop,
  loopKey,
  sectionBullets,
  type LoopDecisionInput,
} from "../core/src/memory/loops.js";
import { appendTask, withTaskAppended } from "../core/src/memory/notes.js";
import { parseTasks } from "../core/src/memory/tasks.js";
import {
  compareProjects,
  nextAction,
  projectList,
  projectReviewBy,
  weeklyReview,
  type ProjectItem,
} from "../core/src/memory/weeklyReview.js";
import { MONDAY, keyOf, rituaisWorld, sha, type Json, type RituaisWorld } from "./helpers/rituaisWorld.js";

/**
 * The deciding code of .specs/features/cerebro-rituais at its own layer, with no HTTP (`Test policy` rows 1 and 2): the
 * loop collector and its key, the window, the decision rules, the project list's filter, `nextAction`, `reviewBy`, the
 * order, door 3's tails and migration 33. The world gives a real home and its index; no route is called.
 */

const DAY = 86_400_000;
let w: RituaisWorld;

beforeAll(async () => {
  w = await rituaisWorld("mordomo-rituais-layer-");
});
afterAll(async () => {
  await w.close();
});
beforeEach(async () => {
  w.at(MONDAY);
  w.update((s) => {
    s.contexts = [];
    s.indexedFolders = [];
    s.memory.weeklyReview = { projectEvery: "7d", loopsWindowDays: 90, maxItems: 50 };
  });
  await w.reset();
});

const env = () => ({ db: w.ctx.db, paths: w.ctx.paths, settings: w.ctx.settings() });
const loops = () => collectLoops(env(), Date.now());
const decide = (input: LoopDecisionInput) => decideLoop(env(), input, Date.now());
const ANA = keyOf("ligar para a ana");

// ---- S1 ----------------------------------------------------------------------------------------------------------

describe("C1 the collector and the key", () => {
  it("C1 a journal loop on line 12 is { key, text, day, ageDays, sources }, and only the level-2 ## Open loops counts", async () => {
    const file = w.journal(
      "2026-11-04",
      ["09:15 Ligar para a Ana"],
      "## Today\n\n- 08:00 café\n\n## Decisions\n\n- 09:00 Decidi algo\n",
    );
    w.put(path.join(w.memory, "journal", "2026-11-05.md"), "# x\n\n### Open loops\n\n- 10:00 Sub laço\n");
    w.put(path.join(w.memory, "notes", "x.md"), "# X\n\n## Open loops\n\n- Laço de nota\n");
    await w.index();
    expect(loops()).toEqual([
      {
        key: ANA,
        text: "Ligar para a Ana",
        day: "2026-11-04",
        ageDays: 5,
        sources: [{ path: file, line: 12 }],
      },
    ]);
    expect(loopKey("Ligar para a Ana")).toBe(ANA);
    expect(
      sectionBullets(
        "## Open loops\n- a\n### Open loops\n- b\n## Decisions\n- c\n## Open loops\n- d\n",
        "Open loops",
      ),
    ).toEqual([
      { body: "a", line: 2 },
      { body: "d", line: 8 },
    ]);
  });
});

describe("C2 the window at the layer", () => {
  it("C2 89 days back listed with ageDays 89, 90 days back and after today not; loopsWindowDays 7 reaches the collector", async () => {
    w.journal("2026-08-12", ["09:00 Oitenta e nove"]);
    w.journal("2026-08-11", ["09:00 Noventa"]);
    w.journal("2026-11-10", ["09:00 Amanhã"]);
    w.journal("2026-11-03", ["09:00 Seis"]);
    w.journal("2026-11-02", ["09:00 Sete"]);
    await w.index();
    expect(loops().map((l) => [l.text, l.ageDays])).toEqual([
      ["Oitenta e nove", 89],
      ["Sete", 7],
      ["Seis", 6],
    ]);
    w.update((s) => {
      s.memory.weeklyReview.loopsWindowDays = 7;
    });
    expect(loops().map((l) => l.text)).toEqual(["Seis"]);
  });
});

describe("C4 the key's normalization, one case per transform", () => {
  for (const [name, text] of [
    ["trim", "  Ligar para a Ana  "],
    ["whitespace collapsed", "Ligar  para\ta Ana"],
    ["case", "LIGAR PARA A ANA"],
  ] as const)
    it(`C4 ${name} gives the key of ligar para a ana`, () => {
      expect(loopKey(text)).toBe(ANA);
    });
  it("C4 accents folded: Revisar orçamento and revisar orcamento are one key (G1)", () => {
    expect(loopKey("Revisar orçamento")).toBe(loopKey("revisar orcamento"));
    expect(loopKey("revisar orcamento")).toBe(keyOf("revisar orcamento"));
  });
  it("C4 Ligar para o Ana gives another key", () => {
    expect(loopKey("Ligar para o Ana")).not.toBe(ANA);
  });
});

describe("C5 one loop from the journal and MEMORY.md", () => {
  it("C5 three days and a MEMORY.md line (journal 2026-10-30) are one item of 2026-10-30 with four places, oldest first; an origin older than the window is kept", async () => {
    const j = ["2026-11-02", "2026-11-04", "2026-11-06"].map((d) => w.journal(d, ["10:00 Ligar para a Ana"]));
    const mem = w.memoryMd(["Ligar para a Ana (journal 2026-10-30)", "Velho (journal 2026-01-05)"]);
    await w.index();
    const got = loops();
    expect(got.map((l) => [l.text, l.day])).toEqual([
      ["Velho", "2026-01-05"],
      ["Ligar para a Ana", "2026-10-30"],
    ]);
    expect(got[1]!.sources).toEqual([{ path: mem, line: 9 }, ...j.map((p) => ({ path: p, line: 5 }))]);
  });
});

describe("C6 the MEMORY.md line kinds", () => {
  it("C6 no origin takes the mtime's local day; → closed with or without an origin is out; the marks are neither text nor key", async () => {
    const mem = w.memoryMd([
      "Sem origem",
      "Fechado → closed 2026-11-05",
      "Fechado com origem (journal 2026-11-02) → closed 2026-11-05",
      "Ligar para a Ana (fonte:: memory/journal/2026-11-04.md:12) (autor:: agente) (em:: 2026-11-04)",
    ]);
    w.touch(mem, new Date(2026, 10, 3, 23, 30).getTime());
    await w.index();
    expect(loops().map((l) => [l.text, l.day, l.key])).toEqual([
      ["Ligar para a Ana", "2026-11-03", ANA],
      ["Sem origem", "2026-11-03", keyOf("sem origem")],
    ]);
  });
});

describe("C9 keep at the layer", () => {
  it("C9 keep of week W hides in W and not in W + 7 days", () => {
    expect(hidesLoop({ action: "keep", week: "2026-11-09" }, "2026-11-09")).toBe(true);
    expect(hidesLoop({ action: "keep", week: "2026-11-09" }, "2026-11-16")).toBe(false);
    expect(hidesLoop(undefined, "2026-11-09")).toBe(false);
  });
});

describe("C14 restore at the layer", () => {
  const rows = () => w.ctx.db.prepare("SELECT * FROM loop_decisions").all() as Json[];
  async function project(): Promise<{ file: string; version: string }> {
    const file = w.note(path.join(w.memory, "notes", "app.md"), { type: "project" }, "# App\n");
    await w.index();
    return { file, version: sha(fs.readFileSync(file)) };
  }
  it("C14 from none: restore with previous null removes the row", async () => {
    w.journal("2026-11-04", ["09:15 Ligar para a Ana"]);
    await w.index();
    const closed = decide({ key: ANA, action: "close" });
    expect(closed.previous).toBeNull();
    expect(decide({ key: ANA, action: "restore", previous: null }).state).toBeNull();
    expect(rows()).toEqual([]);
  });
  it("C14 from an earlier decision: restore puts back action, week, target and decided_at", async () => {
    w.journal("2026-11-04", ["09:15 Ligar para a Ana"]);
    await w.index();
    decide({ key: ANA, action: "someday" });
    const stored = rows();
    w.at(MONDAY + DAY);
    const closed = decide({ key: ANA, action: "close" });
    decide({ key: ANA, action: "restore", previous: closed.previous });
    expect(rows()).toEqual(stored);
  });
  it("C14 after project the note stays; after task the line stays", async () => {
    const app = await project();
    w.journal("2026-11-04", ["09:15 Ligar para a Ana", "09:16 Pagar a conta"]);
    await w.index();
    const made = decide({ key: ANA, action: "project" });
    const note = fs.readFileSync(made.created!.path);
    decide({ key: ANA, action: "restore", previous: made.previous });
    expect(fs.readFileSync(made.created!.path).equals(note)).toBe(true);
    const task = decide({
      key: keyOf("pagar a conta"),
      action: "task",
      project: app.file,
      baseVersion: app.version,
    });
    decide({ key: keyOf("pagar a conta"), action: "restore", previous: task.previous });
    expect(fs.readFileSync(app.file, "utf8")).toContain("- [ ] Pagar a conta\n");
    expect(rows()).toEqual([]);
  });
});

describe("C19 migration 33", () => {
  const columns = (db: Database.Database, table: string) =>
    (db.pragma(`table_info(${table})`) as Json[]).map((c) => ({
      name: c.name,
      type: c.type,
      notnull: c.notnull,
      dflt_value: c.dflt_value,
      pk: c.pk,
    }));
  it("C19 the two tables' columns, the action CHECK, the key unique, empty tables over rows of 32 kept, nothing applied again, and the last migration", () => {
    expect(MIGRATIONS.at(-1)).toMatchObject({ version: 33, name: "rituais" });
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "mordomo-rituais-m33-"));
    const paths = resolvePaths(home);
    ensureDirs(paths);
    try {
      const old = openDb(
        paths,
        MIGRATIONS.filter((m) => m.version <= 32),
      ).db;
      expect(old.pragma("user_version", { simple: true })).toBe(32);
      const id = Number(
        old
          .prepare(
            "INSERT INTO files (root, path, rel, name, ext, dir, area, size, mtime, indexed_at, title, tags, fields) VALUES ('/r', '/r/a.md', 'a.md', 'a.md', '.md', '/r', NULL, 3, 5, 7, 'A', '[]', '{}')",
          )
          .run().lastInsertRowid,
      );
      old
        .prepare(
          "INSERT INTO note_links (src_id, kind, target, label, line) VALUES (?, 'wikilink', 'b', NULL, 2)",
        )
        .run(id);
      old
        .prepare(
          "INSERT INTO note_tasks (src_id, line, done, text, due, priority) VALUES (?, 3, 0, 'x', NULL, 0)",
        )
        .run(id);
      old
        .prepare(
          "INSERT INTO review_state (path, last_reviewed, snooze_until, never, updated_at) VALUES ('/r/a.md', 1, NULL, 0, 2)",
        )
        .run();
      const snapshot = (db: Database.Database) =>
        ["files", "note_links", "note_tasks", "review_state"].map((t) =>
          db.prepare(`SELECT * FROM ${t}`).all(),
        );
      const before = snapshot(old);
      old.close();
      const { db, migration } = openDb(paths);
      try {
        expect(migration).toMatchObject({ fromVersion: 32, toVersion: 33 });
        expect(snapshot(db)).toEqual(before);
        expect(columns(db, "loop_decisions")).toEqual([
          { name: "key", type: "TEXT", notnull: 0, dflt_value: null, pk: 1 },
          { name: "text", type: "TEXT", notnull: 1, dflt_value: null, pk: 0 },
          { name: "action", type: "TEXT", notnull: 1, dflt_value: null, pk: 0 },
          { name: "week", type: "TEXT", notnull: 1, dflt_value: null, pk: 0 },
          { name: "target", type: "TEXT", notnull: 0, dflt_value: null, pk: 0 },
          { name: "decided_at", type: "INTEGER", notnull: 1, dflt_value: null, pk: 0 },
        ]);
        expect(columns(db, "weekly_reviews")).toEqual([
          { name: "week", type: "TEXT", notnull: 0, dflt_value: null, pk: 1 },
          { name: "archived", type: "INTEGER", notnull: 1, dflt_value: "0", pk: 0 },
          { name: "finished_at", type: "INTEGER", notnull: 0, dflt_value: null, pk: 0 },
          { name: "counts", type: "TEXT", notnull: 0, dflt_value: null, pk: 0 },
        ]);
        expect(db.prepare("SELECT COUNT(*) AS n FROM loop_decisions").get()).toEqual({ n: 0 });
        expect(db.prepare("SELECT COUNT(*) AS n FROM weekly_reviews").get()).toEqual({ n: 0 });
        const insert = db.prepare(
          "INSERT INTO loop_decisions (key, text, action, week, target, decided_at) VALUES (?, 't', ?, '2026-11-09', NULL, 1)",
        );
        for (const action of ["closed", "keep", "someday", "project", "task"])
          insert.run(`k-${action}`, action);
        expect(() => insert.run("k-restore", "restore")).toThrow(
          expect.objectContaining({ code: "SQLITE_CONSTRAINT_CHECK" }),
        );
        expect(() => insert.run("k-closed", "keep")).toThrow(
          expect.objectContaining({ code: "SQLITE_CONSTRAINT_PRIMARYKEY" }),
        );
      } finally {
        db.close();
      }
      const again = openDb(paths);
      try {
        expect(again.migration).toEqual({ fromVersion: 33, toVersion: 33, backupPath: null });
      } finally {
        again.db.close();
      }
    } finally {
      fs.rmSync(home, { recursive: true, force: true });
    }
  });
});

// ---- S2 ----------------------------------------------------------------------------------------------------------

describe("C20 the project list's filter at the layer", () => {
  for (const [status, list] of [
    [null, "projects"],
    ["active", "projects"],
    ["draft", "projects"],
    ["paused", "someday"],
    ["done", "archive"],
    ["archived", null],
  ] as const)
    it(`C20 status ${status ?? "absent"} → ${list ?? "none"}`, () => {
      expect(projectList(status)).toBe(list);
    });
  it("C20 type: Project is a project, type: status and type: projects are not, and memory/archive/ is out", async () => {
    const notes = path.join(w.memory, "notes");
    const capital = w.note(path.join(notes, "c.md"), { type: "Project", status: "active" });
    w.note(path.join(notes, "s.md"), { type: "status" });
    w.note(path.join(notes, "p.md"), { type: "projects" });
    w.note(path.join(w.memory, "archive", "2026-10-01-ab12cd34", "notes", "a.md"), {
      type: "project",
      status: "active",
    });
    await w.index();
    const review = weeklyReview(env(), { now: Date.now() });
    expect(review.projects.items.map((i) => i.path)).toEqual([capital]);
    expect(review.projects.total).toBe(1);
  });
});

describe("C22 nextAction at the layer", () => {
  it("C22 the first unchecked task by line; fenced and front matter tasks out; the due marker off; null for only checked and none; the stored row", async () => {
    expect(
      parseTasks(
        "---\nx: 1\n- [ ] fm\n---\n```\n- [ ] in\n```\n- [x] feito\n\n- [ ] Ligar\n\n- [ ] Depois\n",
      ).filter((t) => t.done === 0),
    ).toEqual([
      { line: 10, done: 0, text: "Ligar", due: null, priority: 0 },
      { line: 12, done: 0, text: "Depois", due: null, priority: 0 },
    ]);
    const file = w.put(
      path.join(w.memory, "notes", "a.md"),
      "---\ntype: project\n---\n# A\n- [x] feito\n\n- [ ] Ligar\n\n- [ ] Depois\n",
    );
    const due = w.put(
      path.join(w.memory, "notes", "d.md"),
      "---\ntype: project\n---\n- [ ] Enviar 📅 2026-11-20\n",
    );
    const checked = w.put(path.join(w.memory, "notes", "e.md"), "---\ntype: project\n---\n- [x] a\n");
    await w.index();
    const id = (p: string) =>
      (w.ctx.db.prepare("SELECT id FROM files WHERE path = ?").get(p) as { id: number }).id;
    expect(nextAction(w.ctx.db, id(file))).toEqual({ line: 7, text: "Ligar" });
    expect(nextAction(w.ctx.db, id(due))).toEqual({ line: 4, text: "Enviar" });
    expect(nextAction(w.ctx.db, id(checked))).toBeNull();
    expect(nextAction(w.ctx.db, 999_999)).toBeNull();
    fs.writeFileSync(file, "# mudou\n- [ ] Outra\n");
    expect(nextAction(w.ctx.db, id(file))).toEqual({ line: 7, text: "Ligar" });
  });
});

describe("C23 reviewBy at the layer", () => {
  const at = (
    fields: Record<string, string>,
    opts: { state?: number; mtime?: number; every?: string } = {},
  ) =>
    projectReviewBy(
      fields,
      opts.state !== undefined ? { lastReviewed: opts.state, snoozeUntil: null, never: 0 } : null,
      opts.mtime ?? 0,
      opts.every ?? "7d",
    );
  it("C23 one case per row", () => {
    expect(at({ last_reviewed: "2026-11-02" })).toBe("2026-11-09");
    expect(at({ last_reviewed: "2026-11-03" })).toBe("2026-11-10");
    expect(at({ last_reviewed: "2026-10-01" }, { state: new Date(2026, 10, 5, 12).getTime() })).toBe(
      "2026-11-12",
    );
    expect(at({}, { mtime: new Date(2026, 10, 2, 23, 30).getTime() })).toBe("2026-11-09");
    expect(at({ review_every: "3d", last_reviewed: "2026-11-06" })).toBe("2026-11-09");
    expect(at({ review_every: "3d", last_reviewed: "2026-11-07" })).toBe("2026-11-10");
    expect(at({ review_every: "never", last_reviewed: "2026-11-01" })).toBeNull();
    expect(at({ last_reviewed: "2026-11-02" }, { every: "14d" })).toBe("2026-11-16");
  });
});

describe("C24 the order at the layer", () => {
  const item = (p: string, title: string, due: string | null, reviewDue: boolean): ProjectItem => ({
    path: p,
    title,
    status: "active",
    due,
    health: "on_track",
    nextAction: null,
    lastReviewed: null,
    reviewBy: null,
    reviewDue,
    editable: true,
    version: null,
  });
  it("C24 reviewDue first; due ascending; any due before none; title; then path", () => {
    const sorted = [
      item("/b", "B", "2026-11-10", false),
      item("/z", "Gama", null, false),
      item("/y", "Gama", null, false),
      item("/beta", "Beta", "2026-11-25", false),
      item("/alfa", "Alfa", "2026-11-25", false),
      item("/d20", "X", "2026-11-20", false),
      item("/d12", "Y", "2026-11-12", false),
      item("/a", "A", "2026-12-01", true),
    ].sort(compareProjects);
    expect(sorted.map((i) => i.path)).toEqual(["/a", "/b", "/d12", "/d20", "/alfa", "/beta", "/y", "/z"]);
  });
});

describe("C27 door 3's tails at the layer", () => {
  for (const [name, before, after, line] of [
    ["a text line", "texto\n", "texto\n\n- [ ] Ligar\n", 3],
    ["a task line", "- [ ] a\n", "- [ ] a\n- [ ] Ligar\n", 2],
    ["a blank line", "texto\n\n", "texto\n\n- [ ] Ligar\n", 3],
    ["no final newline", "- [ ] a", "- [ ] a\n- [ ] Ligar\n", 2],
    ["CRLF", "texto\r\n", "texto\r\n\r\n- [ ] Ligar\r\n", 3],
  ] as const)
    it(`C27 ${name}`, () => {
      expect(withTaskAppended(before, "Ligar")).toEqual({ text: after, line });
    });
  it("C27 the text edges: 1 and 300 accepted, empty, 301 and a line break refused", () => {
    const ctx = { paths: w.ctx.paths, settings: w.ctx.settings() };
    for (const text of ["y", "x".repeat(300)]) {
      const file = w.put(path.join(w.memory, "notes", `t${text.length}.md`), "# N\n");
      expect(appendTask(ctx, { path: file, text, baseVersion: sha("# N\n") }).task.text).toBe(text);
    }
    const file = w.put(path.join(w.memory, "notes", "refused.md"), "# N\n");
    for (const text of ["", "x".repeat(301), "a\nb", "a\rb"])
      expect(
        () => appendTask(ctx, { path: file, text, baseVersion: sha("# N\n") }),
        JSON.stringify(text),
      ).toThrow(expect.objectContaining({ statusCode: 400, code: "validation" }));
    expect(fs.readFileSync(file, "utf8")).toBe("# N\n");
  });
});

describe("C31 the context at the layer", () => {
  it("C31 the context keeps its paths and its notes folder, never the look-alike prefix; loops and inbox stay the whole brain's", async () => {
    const root = w.indexedRoot("r");
    const app = path.join(root, "projetos", "app");
    fs.mkdirSync(app, { recursive: true });
    w.update((s) => {
      s.contexts = [{ id: "app", name: "App", paths: [app] }];
    });
    const inApp = w.note(path.join(app, "a.md"), { type: "project" });
    const inNotes = w.note(path.join(w.memory, "notes", "app", "b.md"), { type: "project" });
    w.note(path.join(root, "projetos", "app-antigo", "c.md"), { type: "project" });
    w.journal("2026-11-04", ["09:00 Laço"]);
    w.put(path.join(w.memory, "inbox", "i.md"), "# I\n");
    await w.index();
    const context = w.ctx.settings().contexts[0]!;
    const all = weeklyReview(env(), { now: Date.now() });
    const narrowed = weeklyReview(env(), { context, now: Date.now() });
    expect(narrowed.projects.items.map((i) => i.path).sort()).toEqual([inApp, inNotes].sort());
    expect(all.projects.total).toBe(3);
    expect(narrowed.loops).toEqual(all.loops);
    expect(narrowed.inbox).toEqual(all.inbox);
  });
});
