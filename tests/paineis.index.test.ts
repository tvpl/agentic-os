import fs from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { FRONT_MATTER_FIELDS } from "../core/src/memory/frontMatter.js";
import * as safeFs from "../core/src/security/safeFs.js";
import { auditFiles } from "./fsReadAudit.js";
import { notesViewWorld, type Json, type NotesViewWorld } from "./helpers/notesViewWorld.js";

/**
 * .specs/features/cerebro-paineis, batch A, S2: what the index learns about the tasks of a note (door 3) and its `due`
 * (amendment 2), through real index passes over a real home and a folder outside it, read back from the rows the pass
 * wrote. The parser, one case per form, is in `paineis.layer.test.ts`.
 */

vi.mock("../core/src/security/safeFs.js", async (importOriginal) => {
  const actual = await importOriginal<typeof safeFs>();
  return { ...actual, readWorkspaceText: vi.fn(actual.readWorkspaceText) };
});

const repoRoot = path.resolve(import.meta.dirname, "..");
let w: NotesViewWorld;
let root: string;
let seq = 0;

beforeAll(async () => {
  w = await notesViewWorld("mordomo-paineis-index-");
  root = w.indexedRoot("tarefas");
});
afterAll(async () => {
  await w.close();
});

const idOf = (world: NotesViewWorld, file: string) =>
  (world.ctx.db.prepare("SELECT id FROM files WHERE path = ?").get(file) as { id: number } | undefined)?.id;
const tasksOf = (world: NotesViewWorld, file: string) =>
  world.ctx.db
    .prepare(
      "SELECT line, done, due, priority, text FROM note_tasks WHERE src_id = (SELECT id FROM files WHERE path = ?) ORDER BY line",
    )
    .all(file) as Json[];
const fieldsOf = (world: NotesViewWorld, file: string) =>
  JSON.parse(
    (world.ctx.db.prepare("SELECT fields FROM files WHERE path = ?").get(file) as { fields: string }).fields,
  );
const file = (name: string) => path.join(root, `${name}-${++seq}.md`);

describe("C20 a task in the index", () => {
  it("C20 line 4 `- [ ] Mandar a proposta 📅 2026-10-30 ⏫` is the row line 4, open, due 2026-10-30, priority 2, its text", async () => {
    const f = w.put(file("c20"), "# Nota\n\ntexto\n- [ ] Mandar a proposta 📅 2026-10-30 ⏫\n");
    await w.index();
    expect(tasksOf(w, f)).toEqual([
      { line: 4, done: 0, due: "2026-10-30", priority: 2, text: "Mandar a proposta" },
    ]);
  });

  const forms: Array<[string, string, Json]> = [
    ["[due:: 2026-10-30]", "- [ ] Ligar [due:: 2026-10-30]", { due: "2026-10-30", text: "Ligar" }],
    ["* [x]", "* [x] Feito", { done: 1 }],
    ["- [X]", "- [X] Feito", { done: 1 }],
    ["🔼", "- [ ] Revisar 🔼", { priority: 1 }],
    ["no marker", "- [ ] Nada", { priority: 0, due: null }],
    ["indented", "    - [ ] Sub", { text: "Sub" }],
    ["320 characters", `- [ ] ${"b".repeat(320)}`, { text: "b".repeat(300) }],
    ["2026-02-30", "- [ ] Data ruim 📅 2026-02-30", { due: null, text: "Data ruim 📅 2026-02-30" }],
  ];
  for (const [name, line, want] of forms) {
    it(`C20 ${name}`, async () => {
      const f = w.put(file("c20-form"), `# Nota\n\n${line}\n`);
      await w.index();
      const rows = tasksOf(w, f);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ line: 3, ...want });
    });
  }
});

describe("C22 the task writer", () => {
  it("C22 one task is one row; three on lines 2, 5 and 9 are three in line order; none after an edit is none; a deleted file leaves no row of its id", async () => {
    const one = w.put(file("c22-one"), "# A\n- [ ] Única\n");
    const three = w.put(file("c22-three"), "# B\n- [ ] Um\n\n\n- [ ] Dois\n\n\n\n- [x] Três\n");
    const gone = w.put(file("c22-gone"), "# C\n- [ ] x\n- [ ] y\n");
    await w.index();
    expect(tasksOf(w, one).map((t) => t.line)).toEqual([2]);
    expect(tasksOf(w, three).map((t) => [t.line, t.text])).toEqual([
      [2, "Um"],
      [5, "Dois"],
      [9, "Três"],
    ]);
    w.put(three, "# B\nsem tarefas agora, e mais longo\n");
    const goneId = idOf(w, gone)!;
    expect(w.ctx.db.prepare("SELECT COUNT(*) c FROM note_tasks WHERE src_id = ?").get(goneId)).toEqual({
      c: 2,
    });
    fs.rmSync(gone);
    await w.index();
    expect(tasksOf(w, three)).toEqual([]);
    expect(idOf(w, gone)).toBeUndefined();
    expect(w.ctx.db.prepare("SELECT COUNT(*) c FROM note_tasks WHERE src_id = ?").get(goneId)).toEqual({
      c: 0,
    });
  });
});

describe("C23 the tasks and the due of files indexed before migration 26", () => {
  it("C23 the next pass fills them from the stored text without opening a file, writes the marker and adds due only; again the same rows; a pass stopped after the first slice is done again by the next", async () => {
    const v = await notesViewWorld("mordomo-paineis-backfill-");
    try {
      const dir = v.indexedRoot("c23");
      const project = v.put(
        path.join(dir, "a.md"),
        "---\ntype: project\nstatus: active\ndue: 2026-11-02\n---\n# Projeto\n\n- [ ] Primeira 📅 2026-10-30\n",
      );
      const plain = v.put(path.join(dir, "b.md"), "# B\n\nsem tarefa\n");
      const other = v.put(path.join(dir, "c.md"), "# C\n\n- [x] Feita\n- [ ] Aberta ⏫\n");
      await v.index();
      const want = { project: tasksOf(v, project), other: tasksOf(v, other) };
      expect(want.project).toHaveLength(1);
      expect(want.other).toHaveLength(2);
      const fieldsBefore = fieldsOf(v, project);
      expect(fieldsBefore.due).toBe("2026-11-02");

      // What a database migrated to 26 holds for files indexed before it: no task, no marker, no due in fields.
      const reset = () => {
        v.ctx.db.prepare("DELETE FROM note_tasks").run();
        v.ctx.db.prepare("DELETE FROM meta WHERE key = 'index.note_tasks'").run();
        v.ctx.db.prepare("UPDATE files SET fields = json_remove(fields, '$.due')").run();
      };
      reset();
      const { due: _due, ...others } = fieldsBefore;
      expect(fieldsOf(v, project)).toEqual(others);
      const marker = () => v.ctx.db.prepare("SELECT value FROM meta WHERE key = 'index.note_tasks'").get();

      const opened: string[] = [];
      const realOpen = fs.openSync;
      const openSpy = vi.spyOn(fs, "openSync").mockImplementation(((
        target: fs.PathLike,
        ...rest: unknown[]
      ) => {
        if (String(target).startsWith(dir)) opened.push(String(target));
        return (realOpen as (...a: unknown[]) => number)(target, ...rest);
      }) as typeof fs.openSync);
      const textReads = vi.mocked(safeFs.readWorkspaceText);
      textReads.mockClear();
      const readOfDir = () => textReads.mock.calls.filter(([, f]) => String(f).startsWith(dir));
      try {
        await v.index();
        expect(tasksOf(v, project)).toEqual(want.project);
        expect(tasksOf(v, other)).toEqual(want.other);
        expect(tasksOf(v, plain)).toEqual([]);
        expect(marker()).toEqual({ value: "1" });
        expect(fieldsOf(v, project)).toEqual({ ...others, due: "2026-11-02" });
        expect(fieldsOf(v, other)).toEqual({});

        await v.index();
        expect(tasksOf(v, project)).toEqual(want.project);
        expect(tasksOf(v, other)).toEqual(want.other);

        // A pass stopped after the first slice: the second write of the backfill fails.
        reset();
        const db = v.ctx.db;
        const realPrepare = db.prepare.bind(db);
        let inserts = 0;
        const prepareSpy = vi.spyOn(db, "prepare").mockImplementation(((sql: string) => {
          if (sql.startsWith("INSERT OR IGNORE INTO note_tasks") && ++inserts === 2)
            throw new Error("stopped");
          return realPrepare(sql);
        }) as typeof db.prepare);
        try {
          await expect(v.index()).rejects.toThrow("stopped");
        } finally {
          prepareSpy.mockRestore();
        }
        expect(marker()).toBeUndefined();
        expect([tasksOf(v, project).length > 0, tasksOf(v, other).length > 0].filter(Boolean)).toHaveLength(
          1,
        );
        await v.index();
        expect(tasksOf(v, project)).toEqual(want.project);
        expect(tasksOf(v, other)).toEqual(want.other);
        expect(marker()).toEqual({ value: "1" });
        expect(fieldsOf(v, project)).toEqual({ ...others, due: "2026-11-02" });
      } finally {
        openSpy.mockRestore();
      }
      expect(opened).toEqual([]);
      expect(readOfDir()).toEqual([]);
      expect(auditFiles(repoRoot, [path.join(repoRoot, "core", "src", "memory", "tasks.ts")])).toEqual([]);
    } finally {
      await v.close();
    }
  });
});

describe("C24 due in fields", () => {
  it("C24 FRONT_MATTER_FIELDS is the eight of before, then due", () => {
    expect([...FRONT_MATTER_FIELDS]).toEqual([
      "type",
      "status",
      "updated",
      "last_reviewed",
      "natureza",
      "escopo",
      "review_every",
      "abandoned",
      "due",
    ]);
  });

  it("C24 a header due is kept, a body due:: wins, and one of 65 characters is left out", async () => {
    const header = w.put(file("c24-header"), "---\ndue: 2026-11-02\n---\n# A\n");
    const body = w.put(file("c24-body"), "---\ndue: 2026-11-02\n---\n# B\n\ndue:: 2026-11-03\n");
    const long = w.put(file("c24-long"), `---\ndue: ${"d".repeat(65)}\n---\n# C\n`);
    await w.index();
    expect(fieldsOf(w, header).due).toBe("2026-11-02");
    expect(fieldsOf(w, body).due).toBe("2026-11-03");
    expect("due" in fieldsOf(w, long)).toBe(false);
  });
});

// ---- after round 3: amendment 1's 200 000-character bound (C104) -------------------------------------------------

describe("C104 tasks are read from the first 200 000 characters", () => {
  it("C104 after a first pass, a note whose second task starts past character 200 000 stores only its first, and the backfill of it stores the same rows", async () => {
    // The first pass of a home also runs the backfill, which reads the stored (cut) text: it would hide a normal pass
    // that reads the whole file. So the home is indexed once first, and the note is indexed by a second, normal pass.
    await w.index();
    const marker = () => w.ctx.db.prepare("SELECT value FROM meta WHERE key = 'index.note_tasks'").get();
    expect(marker()).toEqual({ value: "1" });
    const long = file("longa");
    const head = "# Longa\n\n- [ ] Cedo\n";
    const text = `${head}${"a".repeat(200_100 - head.length)}\n- [ ] Tarde\n`;
    expect(text.indexOf("- [ ] Tarde")).toBeGreaterThan(200_000);
    w.put(long, text);
    await w.index();
    const early = [{ line: 3, done: 0, due: null, priority: 0, text: "Cedo" }];
    expect(tasksOf(w, long)).toEqual(early);
    // The backfill of the same file (its rows and the marker gone) reads the stored text and gives the same rows.
    w.ctx.db.prepare("DELETE FROM note_tasks WHERE src_id = ?").run(idOf(w, long));
    w.ctx.db.prepare("DELETE FROM meta WHERE key = 'index.note_tasks'").run();
    await w.index();
    expect(marker()).toEqual({ value: "1" });
    expect(tasksOf(w, long)).toEqual(early);
  });
});
