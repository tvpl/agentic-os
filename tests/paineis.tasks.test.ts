import fs from "node:fs";
import path from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type * as client from "../core/src/connectors/client.js";
import { sha } from "./helpers/notesViewWorld.js";
import {
  calendarItems,
  dayOf,
  fakeConnectorFetch,
  paineisWorld,
  type Json,
  type PaineisWorld,
} from "./helpers/paineisWorld.js";

/**
 * .specs/features/cerebro-paineis, batch B, S5: `PUT /api/memory/tasks` checks or unchecks one task of a note under
 * `memory/` (AC 48 to AC 50, amendment 17), through `app.inject` against `buildServer` over a real home; the test's own
 * eyes on the bytes are `fs`.
 */

vi.mock("../core/src/connectors/client.js", async (importOriginal) => {
  const actual = await importOriginal<typeof client>();
  return { ...actual, fetchConnectorData: vi.fn(actual.fetchConnectorData) };
});

const NOW = new Date(2026, 9, 30, 12, 0, 0).getTime();
let w: PaineisWorld;
let seq = 0;

beforeAll(async () => {
  w = await paineisWorld("mordomo-paineis-tasks-");
  fakeConnectorFetch(calendarItems(NOW));
});
afterAll(async () => {
  await w.close();
});
afterEach(() => {
  vi.useRealTimers();
});

const put = (body: Json) => w.call("PUT", "/api/memory/tasks", body);
const notes = (name: string) => path.join(w.memory, "notes", `${name}-${++seq}.md`);
const write = (file: string, text: string | Buffer) => w.put(file, text);

describe("C47 one box of one line", () => {
  // CRLF line ends, a tab before the marker and no final newline (L-025).
  const TEXT = "# Nota\r\n\r\n\t- [ ] Mandar a proposta 📅 2026-10-30\r\n- [x] Feito\r\n- [X] Também";

  it("C47 done: true on line 3 changes only the three bytes [ ] of that line to [x], and answers path, the version of the bytes read back and the task", async () => {
    const file = write(notes("crlf"), TEXT);
    const old = fs.readFileSync(file);
    const res = await put({ path: file, line: 3, done: true, baseVersion: sha(old) });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const now = fs.readFileSync(file);
    expect(res.body).toEqual({
      path: file,
      version: sha(now),
      task: { line: 3, done: true, text: "Mandar a proposta" },
    });
    const box = old.indexOf(Buffer.from("[ ]"));
    expect(box).toBe(old.indexOf(Buffer.from("\t- [ ]")) + 3);
    expect(now.length).toBe(old.length);
    expect(now.subarray(box, box + 3).toString()).toBe("[x]");
    expect(Buffer.concat([now.subarray(0, box), now.subarray(box + 3)])).toEqual(
      Buffer.concat([old.subarray(0, box), old.subarray(box + 3)]),
    );
  });

  it("C47 done: false on an [x] line and on an [X] line writes [ ] there and nothing else", async () => {
    for (const [line, mark] of [
      [4, "[x]"],
      [5, "[X]"],
    ] as const) {
      const file = write(notes("desmarca"), TEXT);
      const old = fs.readFileSync(file);
      const res = await put({ path: file, line, done: false, baseVersion: sha(old) });
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      expect(res.body.task).toEqual({ line, done: false, text: line === 4 ? "Feito" : "Também" });
      const at = old.indexOf(Buffer.from(mark));
      expect(fs.readFileSync(file)).toEqual(
        Buffer.concat([old.subarray(0, at), Buffer.from("[ ]"), old.subarray(at + 3)]),
      );
    }
  });

  it("C47 done: true on a line already [x] answers 200 with the bytes unchanged", async () => {
    const file = write(notes("ja"), TEXT);
    const old = fs.readFileSync(file);
    const mtime = fs.statSync(file).mtimeMs;
    const res = await put({ path: file, line: 4, done: true, baseVersion: sha(old) });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body).toEqual({ path: file, version: sha(old), task: { line: 4, done: true, text: "Feito" } });
    expect(fs.readFileSync(file)).toEqual(old);
    expect(fs.statSync(file).mtimeMs).toBe(mtime);
  });
});

describe("C48 where a task is not editable", () => {
  const BODY = "# N\n\n- [ ] Tarefa\n";
  const refused = async (file: string) => {
    write(file, BODY);
    const before = fs.readFileSync(file);
    const res = await put({ path: file, line: 3, done: true, baseVersion: sha(before) });
    expect([res.status, res.body?.error?.code], file).toEqual([403, "note_not_editable"]);
    expect(fs.readFileSync(file)).toEqual(before);
  };

  it("C48 a note outside memory/ (an indexed folder) is 403 note_not_editable and keeps its bytes", async () => {
    await refused(path.join(w.indexedRoot("c48"), "fora.md"));
  });
  it("C48 memory/journal/2026-10-30.md, memory/ROUTER.md, memory/areas/a.md and memory/contexts/c.md are 403 note_not_editable", async () => {
    for (const rel of ["journal/2026-10-30.md", "ROUTER.md", "areas/a.md", "contexts/c.md"])
      await refused(path.join(w.memory, rel));
  });
  it("C48 the same body on memory/notes/a.md answers 200", async () => {
    const file = write(path.join(w.memory, "notes", "a.md"), BODY);
    const res = await put({ path: file, line: 3, done: true, baseVersion: sha(fs.readFileSync(file)) });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(fs.readFileSync(file, "utf8")).toBe("# N\n\n- [x] Tarefa\n");
  });
});

describe("C49 the note changed", () => {
  const BODY = "# N\n\ntexto\n- [ ] Tarefa\n";
  const conflict = async (file: string, body: Json) => {
    const before = fs.readFileSync(file);
    const res = await put({ path: file, ...body });
    expect([res.status, res.body?.error?.code], JSON.stringify(body)).toEqual([409, "edit_conflict"]);
    expect(fs.readFileSync(file)).toEqual(before);
  };

  it("C49 a baseVersion the file no longer has is 409 edit_conflict and changes no byte", async () => {
    const file = write(notes("versao"), BODY);
    const read = sha(fs.readFileSync(file));
    write(file, `${BODY}- [ ] Outra\n`);
    await conflict(file, { line: 4, done: true, baseVersion: read });
  });
  it("C49 a line that holds text but no task is 409 edit_conflict", async () => {
    const file = write(notes("texto"), BODY);
    await conflict(file, { line: 3, done: true, baseVersion: sha(fs.readFileSync(file)) });
  });
  it("C49 a line past the end of the file is 409 edit_conflict", async () => {
    const file = write(notes("fim"), BODY);
    await conflict(file, { line: 40, done: true, baseVersion: sha(fs.readFileSync(file)) });
  });
});

describe("C50 the other refusals", () => {
  const BODY = "# N\n\n- [ ] Tarefa\n";

  it('C50 400 validation for line 0, for no baseVersion and for done "yes", writing nothing', async () => {
    const file = write(notes("valida"), BODY);
    const before = fs.readFileSync(file);
    const version = sha(before);
    for (const [body, field] of [
      [{ path: file, line: 0, done: true, baseVersion: version }, "line"],
      [{ path: file, line: 3, done: true }, "baseVersion"],
      [{ path: file, line: 3, done: "yes", baseVersion: version }, "done"],
    ] as const) {
      const res = await put(body);
      expect([res.status, res.body?.error?.code], field).toEqual([400, "validation"]);
      expect(JSON.stringify(res.body.error), field).toContain(field);
      expect(fs.readFileSync(file)).toEqual(before);
    }
  });

  it("C50 403 forbidden_path for a path through a link out of the granted folders", async () => {
    const away = path.join(w.outside("c50"), "longe.md");
    write(away, BODY);
    const link = path.join(w.memory, "notes", `link-${++seq}.md`);
    fs.symlinkSync(away, link);
    const res = await put({ path: link, line: 3, done: true, baseVersion: sha(fs.readFileSync(away)) });
    expect([res.status, res.body?.error?.code]).toEqual([403, "forbidden_path"]);
    expect(fs.readFileSync(away, "utf8")).toBe(BODY);
  });

  it("C50 404 note_missing for a note that does not exist, 404 not_a_file for a folder", async () => {
    const version = sha(BODY);
    const missing = await put({
      path: path.join(w.memory, "notes", "nao-existe.md"),
      line: 3,
      done: true,
      baseVersion: version,
    });
    expect([missing.status, missing.body?.error?.code]).toEqual([404, "note_missing"]);
    expect(fs.existsSync(path.join(w.memory, "notes", "nao-existe.md"))).toBe(false);
    const folder = path.join(w.memory, "notes", "pasta.md");
    fs.mkdirSync(folder, { recursive: true });
    const dir = await put({ path: folder, line: 3, done: true, baseVersion: version });
    expect([dir.status, dir.body?.error?.code]).toEqual([404, "not_a_file"]);
  });

  it("C50 413 note_too_large for a note above the editing limit, writing nothing", async () => {
    const file = notes("grande");
    const big = Buffer.concat([Buffer.from("# G\n\n- [ ] Tarefa\n"), Buffer.alloc(1024 * 1024, "a")]);
    write(file, big);
    const res = await put({ path: file, line: 3, done: true, baseVersion: sha(big) });
    expect([res.status, res.body?.error?.code]).toEqual([413, "note_too_large"]);
    expect(fs.readFileSync(file).equals(big)).toBe(true);
  });
});

describe("C51 the dashboard after a task is checked", () => {
  it("C51 after PUT marks done the only task due today, the next refresh answers the checklist without it and the KPI value 1 of 1", async () => {
    const world = await paineisWorld("mordomo-paineis-tasks-c51-");
    try {
      const file = world.note(
        path.join(world.memory, "notes", "hoje.md"),
        {},
        `# Hoje\n\n- [ ] Mandar a proposta 📅 ${dayOf(NOW)}\n`,
      );
      await world.index();
      expect((await world.create({ template: "overview" })).status).toBe(201);
      const at = async () => {
        vi.useFakeTimers({ toFake: ["Date"], now: NOW });
        try {
          const res = await world.refresh("visao-geral");
          expect(res.status).toBe(200);
          const byId = (id: string) => res.body.snapshot.widgets.find((x: Json) => x.id === id);
          return { list: byId("prioridades"), kpi: byId("prioridades-kpi").data };
        } finally {
          vi.useRealTimers();
        }
      };
      const before = await at();
      expect(before.list.data.items.map((i: Json) => i.text)).toEqual(["Mandar a proposta"]);
      expect({ value: before.kpi.value, of: before.kpi.of }).toEqual({ value: 0, of: 1 });

      // the version the box sends is the one GET /api/memory/note answers (amendment 17)
      const note = await world.call("GET", `/api/memory/note?p=${encodeURIComponent(file)}`);
      expect(note.status).toBe(200);
      const res = await world.call("PUT", "/api/memory/tasks", {
        path: file,
        line: 3,
        done: true,
        baseVersion: note.body.version,
      });
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      // the index pass the route asked for
      await world.ctx.indexer.requestIndexPaths([]);
      const after = await at();
      expect(after.list.status).toBe("empty");
      expect(after.list.data.items).toEqual([]);
      expect({ value: after.kpi.value, of: after.kpi.of }).toEqual({ value: 1, of: 1 });
    } finally {
      await world.close();
    }
  });
});
