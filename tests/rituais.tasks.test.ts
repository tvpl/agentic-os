import fs from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { MONDAY, code, rituaisWorld, sha, type Json, type RituaisWorld } from "./helpers/rituaisWorld.js";

/** Door 3 of .specs/features/cerebro-rituais through `POST /api/memory/tasks`: a project's next action, appended. */

let w: RituaisWorld;
let seq = 0;

beforeAll(async () => {
  w = await rituaisWorld("mordomo-rituais-tasks-");
});
afterAll(async () => {
  await w.close();
});
beforeEach(() => {
  w.at(MONDAY);
});

const add = (body: Json) => w.call("POST", "/api/memory/tasks", body);
const fresh = (text: string | Buffer, name = `n${++seq}.md`) =>
  w.put(path.join(w.memory, "notes", "tarefas", name), text);
const versionsOf = (file: string) =>
  w.ctx.db
    .prepare("SELECT author, origin FROM memory_versions WHERE path = ? ORDER BY id")
    .all(path.relative(w.memory, file).split(path.sep).join("/")) as Json[];

describe("C27 the tails of door 3", () => {
  const tails: Array<[string, string, string, number]> = [
    ["a last line neither task nor blank", "texto\n", "texto\n\n- [ ] Ligar\n", 3],
    ["a last task line", "- [ ] a\n", "- [ ] a\n- [ ] Ligar\n", 2],
    ["a last blank line", "texto\n\n", "texto\n\n- [ ] Ligar\n", 3],
    ["a task line with no final newline", "- [ ] a", "- [ ] a\n- [ ] Ligar\n", 2],
    ["CRLF line ends", "texto\r\n", "texto\r\n\r\n- [ ] Ligar\r\n", 3],
  ];
  for (const [name, before, after, line] of tails)
    it(`C27 ${name}: the old bytes plus the line, the version of the bytes read back, the task's line`, async () => {
      const file = fresh(before);
      const res = await add({ path: file, text: "Ligar", baseVersion: sha(before) });
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      const bytes = fs.readFileSync(file);
      expect(bytes.toString("utf8")).toBe(after);
      expect(res.body).toEqual({
        path: file,
        version: sha(bytes),
        task: { line, done: false, text: "Ligar" },
      });
    });

  it("C27 a text of exactly 300 characters and one of 1 character are accepted", async () => {
    for (const text of ["x".repeat(300), "y"]) {
      const file = fresh("# N\n");
      const res = await add({ path: file, text, baseVersion: sha("# N\n") });
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      expect(fs.readFileSync(file, "utf8")).toBe(`# N\n\n- [ ] ${text}\n`);
    }
  });

  it("C27 the history holds one version with origin task and author owner, and the project then has that nextAction", async () => {
    const before = "---\ntype: project\nstatus: active\n---\n# Projeto\n\n- [x] feito\n";
    const file = fresh(before);
    await w.index();
    const prior = versionsOf(file).length;
    const res = await add({ path: file, text: "Ligar", baseVersion: sha(before) });
    expect(res.status).toBe(200);
    expect(versionsOf(file).slice(prior)).toEqual([{ author: "owner", origin: "task" }]);
    await w.index();
    const item = ((await w.review()).projects.items as Json[]).find((i) => i.path === file)!;
    expect(item.nextAction).toEqual({ line: 8, text: "Ligar" });
  });
});

describe("C28 the refusals of POST /api/memory/tasks", () => {
  async function refused(file: string, body: Json, want: [number, string]) {
    const bytes = fs.readFileSync(file);
    expect(code(await add({ path: file, text: "Ligar", baseVersion: sha(bytes), ...body })), file).toEqual(
      want,
    );
    expect(fs.readFileSync(file).equals(bytes)).toBe(true);
  }
  it("C28 a note of an indexed folder outside memory/ answers 403 note_not_editable", async () => {
    const root = w.indexedRoot("fora");
    await refused(w.put(path.join(root, "x.md"), "# X\n"), {}, [403, "note_not_editable"]);
  });
  for (const rel of ["journal/2026-11-09.md", "ROUTER.md", "areas/vendas.md", "contexts/x.md"])
    it(`C28 memory/${rel} answers 403 note_not_editable`, async () => {
      await refused(w.put(path.join(w.memory, rel), "# Gerado\n"), {}, [403, "note_not_editable"]);
    });
  it("C28 a path through a link out of the granted folders answers 403 forbidden_path", async () => {
    const out = w.outside("alvo");
    const target = w.put(path.join(out, "x.md"), "# Fora\n");
    const link = path.join(w.memory, "notes", `link-${++seq}`);
    fs.mkdirSync(path.dirname(link), { recursive: true });
    fs.symlinkSync(out, link);
    const bytes = fs.readFileSync(target);
    expect(
      code(await add({ path: path.join(link, "x.md"), text: "Ligar", baseVersion: sha(bytes) })),
    ).toEqual([403, "forbidden_path"]);
    expect(fs.readFileSync(target).equals(bytes)).toBe(true);
  });
  it("C28 a stale baseVersion answers 409 edit_conflict", async () => {
    await refused(fresh("# N\n"), { baseVersion: sha("antes") }, [409, "edit_conflict"]);
  });
  for (const [name, text] of [
    ["an empty text", ""],
    ["a text of 301 characters", "x".repeat(301)],
    ["a text with \\n", "a\nb"],
    ["a text with \\r", "a\rb"],
  ] as const)
    it(`C28 ${name} answers 400 validation`, async () => {
      await refused(fresh("# N\n"), { text }, [400, "validation"]);
    });
  it("C28 a note that does not exist answers 404 note_missing", async () => {
    const file = path.join(w.memory, "notes", "tarefas", "nao-existe.md");
    expect(code(await add({ path: file, text: "Ligar", baseVersion: sha("x") }))).toEqual([
      404,
      "note_missing",
    ]);
    expect(fs.existsSync(file)).toBe(false);
  });
  it("C28 a note above the editing limit answers 413 note_too_large", async () => {
    const limit = Math.min(w.ctx.settings().limits.maxIndexedFileBytes, 1024 * 1024);
    await refused(fresh(Buffer.alloc(limit + 1, "a")), {}, [413, "note_too_large"]);
  });
});
