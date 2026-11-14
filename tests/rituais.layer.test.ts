import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type Database from "better-sqlite3";
import { MIGRATIONS } from "../core/src/db/migrations.js";
import { openDb } from "../core/src/db/db.js";
import { ensureDirs, resolvePaths } from "../core/src/paths.js";
import {
  collectLoops,
  decideLoop,
  hidesLoop,
  loopKey,
  loopLists,
  sectionBullets,
  type LoopDecisionInput,
} from "../core/src/memory/loops.js";
import { appendTask, withTaskAppended } from "../core/src/memory/notes.js";
import { parseTasks } from "../core/src/memory/tasks.js";
import {
  archiveWeek,
  compareProjects,
  finishWeek,
  nextAction,
  projectList,
  projectReviewBy,
  weekCounts,
  weeklyReview,
  type ProjectItem,
} from "../core/src/memory/weeklyReview.js";
import { checkWeeklyReview, weeklyReviewDue } from "../core/src/sentinels/weeklyReview.js";
import { accessSettings, resolveFolderAccess } from "../core/src/memory/folderAccess.js";
import { fileRowFromDb } from "../core/src/memory/indexer.js";
import {
  findMention,
  linkMention,
  mentionLines,
  mentionTerms,
  mentionsOf,
} from "../core/src/memory/mentions.js";
import { API } from "@mordomo/contracts";
import { RestoreInProgressError } from "../core/src/errors.js";
import { RestoreLock } from "../core/src/restoreLock.js";
import { MONDAY, keyOf, rituaisWorld, sha, type Json, type RituaisWorld } from "./helpers/rituaisWorld.js";

/**
 * The deciding code of .specs/features/cerebro-rituais at its own layer, with no HTTP (`Test policy` rows 1 and 2): the
 * loop collector and its key, the window, the decision rules, the project list's filter, `nextAction`, `reviewBy`, the
 * order, door 3's tails and migration 33, (batch B) the archive's path check, the finish counts and the sentinel's
 * rule, and (batch C) the mention terms, the matcher and its exclusion zones, the audience `agents` and the link
 * rewrite. The world gives a real home and its index; no route is called.
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

// ---- batch B: the archive's path check, the finish counts and the sentinel's rule ----------------------------------

describe("C38 the archive's path check at the layer", () => {
  it("C38 archiveWeek takes only paths of archive or inbox of the uncontexted list, and refuses a week that is not the current one, moving nothing", async () => {
    const done = w.note(path.join(w.memory, "notes", "feito.md"), { type: "project", status: "done" });
    const active = w.note(path.join(w.memory, "notes", "ativo.md"), { type: "project", status: "active" });
    const inbox = w.put(path.join(w.memory, "inbox", "a.md"), "# A\n");
    await w.index();
    const deps = { ...env(), indexer: w.ctx.indexer };
    expect(() => archiveWeek(deps, { week: "2026-11-09", paths: [active] }, Date.now())).toThrow(
      expect.objectContaining({ statusCode: 400, code: "validation" }),
    );
    expect(() => archiveWeek(deps, { week: "2026-11-02", paths: [done] }, Date.now())).toThrow(
      expect.objectContaining({ statusCode: 409, code: "week_mismatch" }),
    );
    expect(fs.existsSync(done) && fs.existsSync(inbox)).toBe(true);
    const result = archiveWeek(deps, { week: "2026-11-09", paths: [done, inbox] }, Date.now());
    expect(result.moved.map((m) => m.from)).toEqual([done, inbox]);
  });
});

describe("C45 the finish counts at the layer", () => {
  const note = (name: string, fields: Record<string, string>) =>
    w.note(path.join(w.memory, "notes", name), { type: "project", status: "active", ...fields });
  it("C45 loops: the decisions stored with this week only; projects: by the local review day in the week, mtime included (G28), outside memory/archive/; archived: the row's", async () => {
    const insert = w.ctx.db.prepare(
      "INSERT INTO loop_decisions (key, text, action, week, target, decided_at) VALUES (?, ?, ?, ?, NULL, 1)",
    );
    insert.run("a", "a", "closed", "2026-11-09");
    insert.run("b", "b", "keep", "2026-11-09");
    insert.run("c", "c", "someday", "2026-11-02");
    const old = MONDAY - 30 * DAY;
    const counted = [
      note("cabeca.md", { last_reviewed: "2026-11-15" }),
      note("pausado.md", { status: "paused", last_reviewed: "2026-11-09" }),
      note("mtime.md", {}),
      note("estado.md", { last_reviewed: "2026-10-01" }),
    ];
    const notCounted = [
      note("domingo.md", { last_reviewed: "2026-11-08" }),
      note("depois.md", { last_reviewed: "2026-11-16" }),
      note("velho.md", {}),
      w.note(path.join(w.memory, "archive", "2026-11-09-ab12cd34", "notes", "arq.md"), {
        type: "project",
        status: "done",
        last_reviewed: "2026-11-10",
      }),
      w.note(path.join(w.memory, "notes", "status.md"), { type: "status", last_reviewed: "2026-11-10" }),
    ];
    for (const f of [...counted, ...notCounted]) w.touch(f, old);
    w.touch(counted[2]!, MONDAY + 2 * DAY);
    await w.index();
    w.ctx.db
      .prepare(
        "INSERT INTO review_state (path, last_reviewed, snooze_until, never, updated_at) VALUES (?, ?, NULL, 0, 1)",
      )
      .run(counted[3], MONDAY + DAY);
    w.ctx.db.prepare("INSERT INTO weekly_reviews (week, archived) VALUES ('2026-11-09', 4)").run();
    expect(weekCounts(env(), "2026-11-09")).toEqual({ loops: 2, projects: 4, archived: 4 });
    expect(weekCounts(env(), "2026-11-02")).toEqual({ loops: 1, projects: 1, archived: 0 });
  });

  it("C45 finishWeek writes the bullet of now once and answers what was stored after; another week is week_mismatch", async () => {
    const night = new Date(2026, 10, 9, 23, 30).getTime();
    const first = finishWeek(env(), { week: "2026-11-09" }, night);
    expect(first).toEqual({
      week: "2026-11-09",
      finishedAt: night,
      counts: { loops: 0, projects: 0, archived: 0 },
      journal: {
        path: path.join(w.memory, "journal", "2026-11-09.md"),
        line: "- 23:30 Revisão semanal de 2026-11-09: 0 laços decididos, 0 projetos revisados, 0 arquivados.",
      },
    });
    expect(finishWeek(env(), { week: "2026-11-09" }, night + 60 * 60_000)).toEqual(first);
    const text = fs.readFileSync(first.journal.path, "utf8");
    expect(text.split(first.journal.line).length - 1).toBe(1);
    expect(() => finishWeek(env(), { week: "2026-11-16" }, night)).toThrow(
      expect.objectContaining({ statusCode: 409, code: "week_mismatch" }),
    );
  });
});

describe("C50 the sentinel's rule at the layer", () => {
  const cfg = { enabled: true, weekday: 5, hour: 16 };
  const at = (d: number, h: number, m = 0) => new Date(2026, 10, d, h, m).getTime();
  it("C50 one row per case: before the hour, at the hour, later that week, the next Monday, the week recorded, the week finished", () => {
    expect(weeklyReviewDue(w.ctx.db, cfg, at(13, 15, 59))).toBe(false);
    expect(weeklyReviewDue(w.ctx.db, cfg, at(13, 16))).toBe(true);
    expect(weeklyReviewDue(w.ctx.db, cfg, at(15, 23, 59))).toBe(true);
    expect(weeklyReviewDue(w.ctx.db, cfg, at(16, 0, 30))).toBe(false);
    w.ctx.db
      .prepare("INSERT INTO meta (key, value) VALUES ('sentinel.weeklyReview.week', '\"2026-11-09\"')")
      .run();
    expect(weeklyReviewDue(w.ctx.db, cfg, at(14, 10))).toBe(false);
    expect(weeklyReviewDue(w.ctx.db, cfg, at(20, 16))).toBe(true);
    w.ctx.db.prepare("INSERT INTO weekly_reviews (week, finished_at) VALUES ('2026-11-16', 1)").run();
    expect(weeklyReviewDue(w.ctx.db, cfg, at(20, 16))).toBe(false);
  });

  it("C50 checkWeeklyReview at 15:59 emits none and at 16:00 one payload with the counts, and records the week", async () => {
    w.journal("2026-11-10", ["09:00 Primeiro", "09:00 Segundo"]);
    w.note(path.join(w.memory, "notes", "vencido.md"), {
      type: "project",
      status: "active",
      last_reviewed: "2026-11-01",
    });
    await w.index();
    const seen: Json[] = [];
    const off = w.ctx.events.subscribe((e) => {
      if (e.type === "sentinel.fired" && (e.payload as Json).sentinel === "weeklyReview")
        seen.push(e.payload as Json);
    });
    try {
      const deps = (now: number) => ({
        db: w.ctx.db,
        paths: w.ctx.paths,
        getSettings: () => w.ctx.settings(),
        bus: w.ctx.events,
        now: () => now,
      });
      expect(checkWeeklyReview(deps(at(13, 15, 59)))).toEqual([]);
      const fired = checkWeeklyReview(deps(at(13, 16)));
      expect(fired).toEqual([
        {
          sentinel: "weeklyReview",
          title: expect.stringMatching(/\S/),
          body: expect.stringMatching(/\S/),
          severity: "info",
          href: "/brain/weekly",
          dedupeKey: "sentinel:weeklyReview:2026-11-09:all",
          messageParams: { loops: 2, projects: 1 },
        },
      ]);
      expect(seen).toEqual(fired);
      expect(checkWeeklyReview(deps(at(13, 17)))).toEqual([]);
    } finally {
      off();
    }
  });
});

// ---- S8 (batch C) ------------------------------------------------------------------------------------------------

const term = (name: string, title: string | null, fields: Record<string, string> = {}) =>
  mentionTerms({ name, title, fields });
/** The first term of `terms` that `text` (one line of prose) holds, as findMention reads it, or null. */
const matched = (text: string, terms: string[]): string | null => {
  const [line] = mentionLines(text);
  return terms.find((t) => findMention(line!, t) !== null) ?? null;
};

describe("C59 the terms at the layer", () => {
  it("C59 the title", () => {
    expect(term("cm.md", "Curso de Março")).toEqual(["Curso de Março"]);
  });
  it("C59 the file name with - and _ as spaces", () => {
    expect(term("plano_de-vendas.md", null)).toEqual(["plano de vendas"]);
  });
  it("C59 each aliases item", () => {
    expect(term("cm.md", "Curso de Março", { aliases: JSON.stringify(["CM 2026", "Curso Março"]) })).toEqual([
      "Curso de Março",
      "CM 2026",
      "Curso Março",
    ]);
  });
  it("C59 a term of exactly 4 characters is kept and one of 3 dropped", () => {
    expect(term("x.md", "Rede")).toEqual(["Rede"]);
    expect(term("x.md", "Ana")).toEqual([]);
  });
  it("C59 terms that fold equal are one, the first of title, file name, aliases, in that order", () => {
    expect(term("cafe.md", "Café", { aliases: JSON.stringify(["CAFÉ", "Cafezinho"]) })).toEqual([
      "Café",
      "Cafezinho",
    ]);
    expect(term("plano-beta.md", "Plano Alfa", { aliases: JSON.stringify(["Plano Gama"]) })).toEqual([
      "Plano Alfa",
      "plano beta",
      "Plano Gama",
    ]);
  });
});

describe("C60 whole words after the fold at the layer", () => {
  for (const line of ["a rede caiu", "Rede: ok", "caiu a REDE", "(rede)"])
    it(`C60 '${line}' holds Rede`, () => {
      expect(matched(line, ["Rede"])).toBe("Rede");
    });
  for (const line of ["as redes", "a parede", "Redenção"])
    it(`C60 '${line}' does not hold Rede`, () => {
      expect(matched(line, ["Rede"])).toBeNull();
    });
  for (const line of ["um cafe", "CAFÉ!"])
    it(`C60 '${line}' holds Café`, () => {
      expect(matched(line, ["Café"])).toBe("Café");
    });
  it("C60 'a cafeteria' does not hold Café", () => {
    expect(matched("a cafeteria", ["Café"])).toBeNull();
  });
});

describe("C61 the exclusion zones at the layer", () => {
  const nothingIn = (text: string) => mentionLines(text).filter((line) => findMention(line, "Rede") !== null);
  const cases: Array<[string, string]> = [
    ["the front matter", "---\ntitle: Rede\n---\nnada\n"],
    ["a ``` block", "```\na rede\n```\n"],
    ["a ~~~ block", "~~~\na rede\n~~~\n"],
    ["inline code", "o `rede` aqui\n"],
    ["the text of a Markdown link", "[a rede](x.md)\n"],
    ["the URL of a Markdown link", "[x](https://rede.example/rede)\n"],
    ["a wikilink", "[[Rede]]\n"],
    ["a wikilink alias", "[[x|rede]]\n"],
  ];
  for (const [name, text] of cases)
    it(`C61 ${name} holds no match`, () => {
      expect(nothingIn(text)).toEqual([]);
    });
  it("C61 '`rede` e a rede' matches the plain one", () => {
    const [line] = mentionLines("`rede` e a rede");
    expect(findMention(line!, "Rede")).toEqual({ start: 11, end: 15 });
  });
  it("C61 a line with Rede and Café is one match, the first term that matches", () => {
    expect(matched("a rede e o café", ["Rede", "Café"])).toBe("Rede");
  });
});

describe("C64 the audience agents at the layer", () => {
  it("C64 the agents' answer equals the owner's with fin excluded; a target under fin is no answer; two more hidden folders change nothing", async () => {
    const fin = path.join(w.memory, "notes", "fin");
    const extra1 = path.join(w.memory, "notes", "extra1");
    const extra2 = path.join(w.memory, "notes", "extra2");
    const target = w.put(path.join(w.memory, "notes", "outra", "Rede.md"), "---\ntitle: Rede\n---\nx\n");
    const hiddenTarget = w.put(path.join(fin, "Cofre.md"), "---\ntitle: Cofre\n---\nx\n");
    w.put(path.join(fin, "segredo.md"), "a rede do segredo\no cofre\n");
    w.put(path.join(w.memory, "notes", "outra", "v1.md"), "a rede visível\n");
    w.put(path.join(w.memory, "notes", "outra", "v2.md"), "x\nde novo a Rede\n");
    w.put(path.join(extra1, "nada.md"), "nada a ver\n");
    w.put(path.join(extra2, "ligada.md"), "[[Rede]] e a rede\n");
    await w.index();
    const idOf = (file: string) =>
      (w.ctx.db.prepare("SELECT id FROM files WHERE path = ?").get(file) as { id: number }).id;
    const id = idOf(target);
    const hiddenId = idOf(hiddenTarget);
    const asAgents = (ids: number) => {
      const env = { paths: w.ctx.paths, settings: w.ctx.settings() };
      const settings = accessSettings(env, "agents", resolveFolderAccess(env));
      return mentionsOf(
        { db: w.ctx.db, paths: w.ctx.paths, settings, index: w.ctx.indexer.audienceTable("agents") },
        { id: ids },
      );
    };
    const json = (v: unknown) => JSON.parse(JSON.stringify(v)) as unknown;

    try {
      w.update((s) => {
        s.folderAccess = [{ path: fin, agents: "hide", devices: "write" }];
      });
      await w.index();
      const agents = json(asAgents(id)) as Json;
      expect((agents.items as Json[]).map((i) => i.file.path).sort()).toEqual(
        [
          path.join(w.memory, "notes", "outra", "v1.md"),
          path.join(w.memory, "notes", "outra", "v2.md"),
        ].sort(),
      );
      expect(JSON.stringify(agents)).not.toContain("segredo");
      expect(asAgents(hiddenId)).toBeNull();
      // the owner, before the twin, does see the hidden source (the case is not empty)
      const owner = mentionsOf({ db: w.ctx.db, paths: w.ctx.paths, settings: w.ctx.settings() }, { id })!;
      expect(owner.total).toBe(3);

      // two more folders hidden from the agents, holding no visible item: every answer stays equal, total included
      w.update((s) => {
        s.folderAccess = [
          { path: fin, agents: "hide", devices: "write" },
          { path: extra1, agents: "hide", devices: "write" },
          { path: extra2, agents: "hide", devices: "write" },
        ];
      });
      await w.index();
      expect(json(asAgents(id))).toEqual(agents);

      // the twin: no access of folders, fin excluded, the index passed again
      w.update((s) => {
        s.folderAccess = [];
        s.excludes = [...s.excludes, "fin"];
      });
      await w.index();
      const twin = mentionsOf({ db: w.ctx.db, paths: w.ctx.paths, settings: w.ctx.settings() }, { id });
      expect(json(twin)).toEqual(agents);
    } finally {
      w.update((s) => {
        s.folderAccess = [];
        s.excludes = s.excludes.filter((e) => e !== "fin");
      });
    }
  });
});

describe("C67 the rewrite at the layer", () => {
  const linkEnv = () => ({ db: w.ctx.db, paths: w.ctx.paths, settings: w.ctx.settings() });
  async function rewrite(line: string): Promise<{ link: string; text: string }> {
    const target = w.put(
      path.join(w.memory, "notes", "Curso de Março.md"),
      "---\ntitle: Curso de Março\n---\nx\n",
    );
    const before = `um\n${line}\ntrês\n`;
    const source = w.put(path.join(w.memory, "notes", "fonte.md"), before);
    await w.index();
    const id = (w.ctx.db.prepare("SELECT id FROM files WHERE path = ?").get(target) as { id: number }).id;
    const done = linkMention(linkEnv(), {
      source,
      line: 2,
      term: "Curso de Março",
      target: id,
      baseVersion: sha(before),
    });
    expect(done.version).toBe(sha(fs.readFileSync(source)));
    return { link: done.link, text: fs.readFileSync(source, "utf8") };
  }
  it("C67 the alias form [[name|as written]] when the written text differs from the name after foldName", async () => {
    expect(await rewrite("o curso de marco atrasou, o curso de marco")).toEqual({
      link: "[[Curso de Março|curso de marco]]",
      text: "um\no [[Curso de Março|curso de marco]] atrasou, o curso de marco\ntrês\n",
    });
  });
  it("C67 the name form [[name]] when it is equal after foldName", async () => {
    expect(await rewrite("o curso de março atrasou")).toEqual({
      link: "[[Curso de Março]]",
      text: "um\no [[Curso de Março]] atrasou\ntrês\n",
    });
  });
});

describe("C68 the first valid occurrence at the layer", () => {
  it("C68 code and a link are skipped: only the third is rewritten", async () => {
    const target = w.put(
      path.join(w.memory, "notes", "Curso de Março.md"),
      "---\ntitle: Curso de Março\n---\nx\n",
    );
    const before = "`curso de marco` e [curso de marco](x.md) e curso de marco\n";
    const source = w.put(path.join(w.memory, "notes", "fonte.md"), before);
    await w.index();
    const row = fileRowFromDb(
      w.ctx.db.prepare("SELECT * FROM files WHERE path = ?").get(target) as Record<string, unknown>,
    );
    linkMention(
      { db: w.ctx.db, paths: w.ctx.paths, settings: w.ctx.settings() },
      { source, line: 1, term: "Curso de Março", target: row.id, baseVersion: sha(before) },
    );
    expect(fs.readFileSync(source, "utf8")).toBe(
      "`curso de marco` e [curso de marco](x.md) e [[Curso de Março|curso de marco]]\n",
    );
  });
});

// ---- round 1 of the verification: Test policy row 1 at its own layer ----------------------------------------------

describe("C109 the loop decision rules at the layer", () => {
  const rows = () => w.ctx.db.prepare("SELECT * FROM loop_decisions ORDER BY key").all() as Json[];
  const row = (key: string) => rows().find((r) => r.key === key);
  async function appNote(fields: Record<string, string> = { type: "project" }) {
    const file = w.note(path.join(w.memory, "notes", "app.md"), fields, "# App\n");
    await w.index();
    return { file, version: sha(fs.readFileSync(file)) };
  }

  it("C109 each action stores its own state: close closed, keep keep, someday someday, project and task with their target, restore the previous", async () => {
    const app = await appNote();
    w.journal("2026-11-04", ["09:00 Um", "09:01 Dois", "09:02 Três", "09:03 Quatro", "09:04 Cinco"]);
    await w.index();
    const [um, dois, tres, quatro, cinco] = ["um", "dois", "três", "quatro", "cinco"].map((t) => loopKey(t));
    expect(decide({ key: um!, action: "close" }).state).toBe("closed");
    expect(decide({ key: dois!, action: "keep" }).state).toBe("keep");
    expect(decide({ key: tres!, action: "someday" }).state).toBe("someday");
    const made = decide({ key: quatro!, action: "project" });
    const task = decide({ key: cinco!, action: "task", project: app.file, baseVersion: app.version });
    expect(
      [um, dois, tres, quatro, cinco].map((k) => [row(k!)!.action, row(k!)!.week, row(k!)!.target]),
    ).toEqual([
      ["closed", "2026-11-09", null],
      ["keep", "2026-11-09", null],
      ["someday", "2026-11-09", null],
      ["project", "2026-11-09", made.created!.path],
      ["task", "2026-11-09", app.file],
    ]);
    expect(task.created!.path).toBe(app.file);
    expect(decide({ key: um!, action: "restore", previous: null })).toEqual({
      key: um,
      state: null,
      previous: expect.objectContaining({ action: "closed" }),
    });
    expect(row(um!)).toBeUndefined();
  });

  it("C109 G7: a key listed nowhere but stored (closed) is accepted by a repeated close and by restore", async () => {
    w.journal("2026-11-04", ["09:15 Ligar para a Ana"]);
    await w.index();
    decide({ key: ANA, action: "close" });
    const stored = rows();
    // the decision took it out of both lists; the stored row is what makes it known
    const lists = loopLists(env(), Date.now());
    expect([...lists.open, ...lists.someday].map((l) => l.key)).toEqual([]);
    expect(decide({ key: ANA, action: "close" })).toMatchObject({ key: ANA, state: "closed" });
    expect(rows()).toEqual(stored);
    expect(decide({ key: ANA, action: "restore", previous: null }).state).toBeNull();
    expect(rows()).toEqual([]);
  });

  it("C109 G7: a key in neither list and with no row is 404 loop_not_found, one case each: 64 hex of no loop, and the key of a non-generated note's ## Open loops bullet; nothing is stored", async () => {
    w.put(path.join(w.memory, "notes", "x.md"), "# X\n\n## Open loops\n\n- Laço de nota\n");
    await w.index();
    for (const key of ["f".repeat(64), loopKey("Laço de nota")])
      expect(() => decide({ key, action: "close" }), key).toThrow(
        expect.objectContaining({ statusCode: 404, code: "loop_not_found" }),
      );
    expect(rows()).toEqual([]);
  });

  for (const action of ["close", "keep", "someday"] as const)
    it(`C109 G8: ${action} twice leaves the row as it was, the first decided_at kept, and the second answers the first's row as previous`, async () => {
      w.journal("2026-11-04", ["09:15 Ligar para a Ana"]);
      await w.index();
      const t0 = Date.now();
      const first = decide({ key: ANA, action });
      const t1 = Date.now();
      expect(first.previous).toBeNull();
      const stored = rows();
      w.at(MONDAY + 60 * 60_000);
      const again = decide({ key: ANA, action });
      expect(again.state).toBe(first.state);
      expect(rows()).toEqual(stored);
      expect(again.previous).toEqual({
        action: stored[0]!.action,
        week: stored[0]!.week,
        target: stored[0]!.target,
        decidedAt: stored[0]!.decided_at,
      });
      // the clock moves: the first decision's instant, not the second's (an hour later)
      expect(stored[0]!.decided_at).toBeGreaterThanOrEqual(t0);
      expect(stored[0]!.decided_at).toBeLessThanOrEqual(t1);
    });

  it("C109 G8: keep stored last week and keep again this week updates week (and decided_at)", async () => {
    w.journal("2026-11-04", ["09:15 Ligar para a Ana"]);
    await w.index();
    w.at(MONDAY - 7 * DAY);
    w.journal("2026-10-30", ["09:15 Ligar para a Ana"]);
    await w.index();
    decide({ key: ANA, action: "keep" });
    expect(row(ANA)).toMatchObject({ action: "keep", week: "2026-11-02" });
    const before = row(ANA)!.decided_at as number;
    w.at(MONDAY);
    decide({ key: ANA, action: "keep" });
    expect(row(ANA)).toMatchObject({ action: "keep", week: "2026-11-09" });
    expect(row(ANA)!.decided_at).toBeGreaterThanOrEqual(MONDAY);
    expect(before).toBeLessThan(MONDAY - 6 * DAY);
  });

  it("C109 the four refusals, each storing nothing and writing nothing: 400 validation, 404 loop_not_found, 403 note_not_editable, 409 edit_conflict", async () => {
    const status = w.note(path.join(w.memory, "notes", "estado.md"), { type: "status" }, "# Estado\n");
    const app = await appNote();
    w.journal("2026-11-04", ["09:15 Ligar para a Ana"]);
    await w.index();
    const bytes = () => [fs.readFileSync(status, "utf8"), fs.readFileSync(app.file, "utf8")];
    const before = bytes();
    const refused: Array<[string, LoopDecisionInput, number, string]> = [
      ["an action it does not take", { key: ANA, action: "delete" as never }, 400, "validation"],
      ["task without baseVersion", { key: ANA, action: "task", project: app.file }, 400, "validation"],
      ["restore without previous", { key: ANA, action: "restore" }, 400, "validation"],
      ["a key of no loop", { key: "0".repeat(64), action: "close" }, 404, "loop_not_found"],
      [
        "a task to a type: status note",
        { key: ANA, action: "task", project: status, baseVersion: sha(fs.readFileSync(status)) },
        403,
        "note_not_editable",
      ],
      [
        "a task with a stale baseVersion",
        { key: ANA, action: "task", project: app.file, baseVersion: sha("antes") },
        409,
        "edit_conflict",
      ],
    ];
    for (const [name, input, statusCode, code] of refused)
      expect(() => decide(input), name).toThrow(expect.objectContaining({ statusCode, code }));
    expect(rows()).toEqual([]);
    expect(bytes()).toEqual(before);
  });
});

describe("C110 the archive's check at the layer", () => {
  const deps = () => ({ ...env(), indexer: w.ctx.indexer });
  const archive = (paths: string[]) => archiveWeek(deps(), { week: "2026-11-09", paths }, Date.now());
  const done = (file: string) => w.note(file, { type: "project", status: "done" }, "# Feito\n");
  const body = API["memory.weeklyReview.archive"].body!;
  const weeks = () => w.ctx.db.prepare("SELECT week, archived FROM weekly_reviews").all() as Json[];
  let spy: { mockRestore(): void } | null = null;
  afterEach(() => {
    spy?.mockRestore();
    spy = null;
  });

  it("C110 the seven path kinds: a listed done project and a listed inbox file move; one of projects, one of someday.projects, one listed nowhere and one under memory/archive/ are 400 validation alone and move nothing; a done project outside memory/ is a proposal and stays", async () => {
    const root = w.indexedRoot("fora");
    const feito = done(path.join(w.memory, "notes", "feito.md"));
    const caixa = w.put(path.join(w.memory, "inbox", "a.md"), "# A\n");
    const ativo = w.note(path.join(w.memory, "notes", "ativo.md"), { type: "project", status: "active" });
    const pausado = w.note(path.join(w.memory, "notes", "pausado.md"), { type: "project", status: "paused" });
    const solto = w.put(path.join(w.memory, "notes", "solto.md"), "# Solto\n");
    const arquivado = done(path.join(w.memory, "archive", "2026-10-01-ab12cd34", "notes", "velho.md"));
    const fora = done(path.join(root, "fora.md"));
    await w.index();
    for (const p of [ativo, pausado, solto, arquivado])
      expect(() => archive([feito, p]), p).toThrow(
        expect.objectContaining({ statusCode: 400, code: "validation" }),
      );
    expect([feito, caixa, ativo, pausado, solto, arquivado, fora].every((p) => fs.existsSync(p))).toBe(true);
    expect(weeks()).toEqual([]);
    const outside = archive([fora]);
    expect(outside).toMatchObject({ manifest: null, moved: [], skipped: [] });
    expect(fs.readFileSync(outside.proposals!, "utf8")).toContain(fora);
    expect(fs.existsSync(fora)).toBe(true);
    const res = archive([feito, caixa]);
    expect(res.moved.map((m) => m.from)).toEqual([feito, caixa]);
    expect([feito, caixa].some((p) => fs.existsSync(p))).toBe(false);
    expect(weeks()).toEqual([{ week: "2026-11-09", archived: 2 }]);
  });

  it("C110 the paths edges at the body the route parses: none and 101 refused, 1 and exactly 100 accepted; 100 listed inbox files all move", async () => {
    const files = Array.from({ length: 100 }, (_, i) =>
      w.put(path.join(w.memory, "inbox", `f${String(i).padStart(3, "0")}.md`), `# ${i}\n`),
    );
    await w.index();
    const ok = (n: number) =>
      body.safeParse({ week: "2026-11-09", paths: files.concat("x").slice(0, n) }).success;
    expect([ok(0), ok(1), ok(100), ok(101)]).toEqual([false, true, true, false]);
    expect(archive(files).moved).toHaveLength(100);
  });

  it("C110 the week: another Monday is 409 week_mismatch and moves nothing", async () => {
    const feito = done(path.join(w.memory, "notes", "feito.md"));
    await w.index();
    expect(() => archiveWeek(deps(), { week: "2026-11-16", paths: [feito] }, Date.now())).toThrow(
      expect.objectContaining({ statusCode: 409, code: "week_mismatch" }),
    );
    expect(fs.existsSync(feito)).toBe(true);
  });

  it("C110 under the exclusive restore lock it is 409 restore_in_progress and moves nothing", async () => {
    const feito = done(path.join(w.memory, "notes", "feito.md"));
    await w.index();
    const held = RestoreLock.acquire(w.ctx.paths, 0, "exclusive");
    try {
      expect(() => archive([feito])).toThrow(RestoreInProgressError);
    } finally {
      held.release();
    }
    expect(fs.existsSync(feito)).toBe(true);
    expect(weeks()).toEqual([]);
  });

  /** One listed file skipped for `reason` while the other moves. */
  const skips: Array<[string, (a: string) => void]> = [
    ["missing", (a) => fs.rmSync(a)],
    [
      "exists",
      (a) => {
        const real = crypto.randomBytes.bind(crypto);
        spy = vi
          .spyOn(crypto, "randomBytes")
          .mockImplementation(((n: number, ...rest: unknown[]) =>
            n === 4
              ? Buffer.from("c110c110", "hex")
              : (real as (...x: unknown[]) => Buffer)(n, ...rest)) as typeof crypto.randomBytes);
        w.put(
          path.join(w.memory, "archive", "2026-11-09-c110c110", "inbox", "sub", path.basename(a)),
          "já\n",
        );
      },
    ],
    [
      "forbidden_path",
      () => {
        const sub = path.join(w.memory, "inbox", "sub");
        fs.renameSync(sub, `${sub}-real`);
        fs.symlinkSync(`${sub}-real`, sub);
      },
    ],
    [
      "changed",
      (a) => {
        fs.rmSync(a);
        fs.mkdirSync(a);
      },
    ],
  ];
  for (const [reason, make] of skips)
    it(`C110 the skip ${reason}: that file is skipped with its reason and the other moves`, async () => {
      const a = w.put(path.join(w.memory, "inbox", "sub", "a.md"), "# A\n");
      const b = w.put(path.join(w.memory, "inbox", "b.md"), "# B\n");
      await w.index();
      make(a);
      const res = archive([a, b]);
      expect(res.skipped).toEqual([{ path: a, reason }]);
      expect(res.moved.map((m) => m.from)).toEqual([b]);
      expect(fs.existsSync(b)).toBe(false);
    });
});

describe("C111 the mentions' order and limit at the layer", () => {
  const owner = () => ({ db: w.ctx.db, paths: w.ctx.paths, settings: w.ctx.settings() });
  async function world(sources: number): Promise<{ id: number; files: string[] }> {
    const target = w.put(path.join(w.memory, "notes", "Rede.md"), "---\ntitle: Rede\n---\nx\n");
    const files = Array.from({ length: sources }, (_, i) =>
      w.put(path.join(w.memory, "notes", "fontes", `s${String(i).padStart(2, "0")}.md`), `a rede ${i}\n`),
    );
    files.forEach((f, i) => w.touch(f, MONDAY - (i + 1) * DAY));
    await w.index();
    const id = (w.ctx.db.prepare("SELECT id FROM files WHERE path = ?").get(target) as { id: number }).id;
    return { id, files };
  }

  it("C111 newest source first, then by path for the same mtime, then by line within a source (G12)", async () => {
    const target = w.put(path.join(w.memory, "notes", "Rede.md"), "---\ntitle: Rede\n---\nx\n");
    const old = w.put(path.join(w.memory, "notes", "a-velha.md"), "a rede\n");
    const zeta = w.put(path.join(w.memory, "notes", "z.md"), "a rede\n");
    const beta = w.put(path.join(w.memory, "notes", "b.md"), "x\na rede\ny\nde novo a rede\n");
    w.touch(old, MONDAY - 9 * DAY);
    w.touch(zeta, MONDAY - DAY);
    w.touch(beta, MONDAY - DAY);
    await w.index();
    const id = (w.ctx.db.prepare("SELECT id FROM files WHERE path = ?").get(target) as { id: number }).id;
    const got = mentionsOf(owner(), { id })!;
    expect(got.items.map((i) => [i.file.path, i.line])).toEqual([
      [beta, 2],
      [beta, 4],
      [zeta, 1],
      [old, 1],
    ]);
  });

  it("C111 the limit: 25 sources and none gives 20 items and total 25; 1 gives the newest; 50 gives 25", async () => {
    const { id, files } = await world(25);
    const of = (limit?: number) => {
      const got = mentionsOf(owner(), limit === undefined ? { id } : { id, limit })!;
      return [got.items.length, got.total, got.items[0]!.file.path];
    };
    expect(of()).toEqual([20, 25, files[0]]);
    expect(of(1)).toEqual([1, 25, files[0]]);
    expect(of(50)).toEqual([25, 25, files[0]]);
  });

  it("C111 the limit edges at the query the route parses: 0 and 51 refused, 1 and 50 accepted, none accepted", () => {
    const query = API["memory.mentions.list"].query!;
    const ok = (q: Record<string, string>) => query.safeParse({ id: "1", ...q }).success;
    expect([
      ok({}),
      ok({ limit: "0" }),
      ok({ limit: "1" }),
      ok({ limit: "50" }),
      ok({ limit: "51" }),
    ]).toEqual([true, false, true, true, false]);
  });
});

describe("C61 the matched term is the first of terms, not the leftmost in the line (round 1)", () => {
  it("C61 a line holding Café before Rede, with terms [Rede, Café], is one item whose term is Rede (G35: the entry of terms, in their order)", async () => {
    const target = w.put(
      path.join(w.memory, "notes", "rede.md"),
      `---\ntitle: Rede\naliases: [Café]\n---\nx\n`,
    );
    const source = w.put(path.join(w.memory, "notes", "fonte.md"), "o café antes e a rede depois\n");
    await w.index();
    const id = (w.ctx.db.prepare("SELECT id FROM files WHERE path = ?").get(target) as { id: number }).id;
    const got = mentionsOf({ db: w.ctx.db, paths: w.ctx.paths, settings: w.ctx.settings() }, { id })!;
    expect(got.terms).toEqual(["Rede", "Café"]);
    expect(got.items.map((i) => [i.file.path, i.line, i.term])).toEqual([[source, 1, "Rede"]]);
    expect(got.total).toBe(1);
  });
});
