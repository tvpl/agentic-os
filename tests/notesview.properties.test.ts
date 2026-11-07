import fs from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { notesViewWorld, sha, type Json, type NotesViewWorld } from "./helpers/notesViewWorld.js";

/**
 * .specs/features/cerebro-vista-notas, batch A, S2 at the HTTP boundary: the properties `GET /api/memory/note` reads
 * and `PUT /api/memory/notes/properties` writes (doors 2 and 3). The file on disk is read back with `fs`; each test is
 * written from its check, and the format is also proven at its own layer in `notesview.layer.test.ts`.
 */

const POSIX = process.platform !== "win32";
let w: NotesViewWorld;
let notes: string;
let seq = 0;

beforeAll(async () => {
  w = await notesViewWorld("mordomo-notes-props-");
  notes = path.join(w.memory, "notes", "props");
});
afterAll(async () => {
  await w?.close();
});

const note = (text: string, name = `n${++seq}.md`): string => w.put(path.join(notes, name), text);
const read = (p: string) => w.call("GET", `/api/memory/note?p=${encodeURIComponent(p)}`);
const write = (body: Json, headers?: Record<string, string>) =>
  w.call("PUT", "/api/memory/notes/properties", body, headers);
const bytes = (p: string) => fs.readFileSync(p);

const PRINT = [
  "---",
  "type: context",
  "status: active",
  "tags: [offer, accelerator]",
  "updated: 2026-10-14",
  "---",
];

describe("S2 the properties of a note", () => {
  it("C13 GET /api/memory/note reads type, status, tags and updated in file order with their kinds, otherProperties null, and bodyStart at the first character after the closing ---", async () => {
    const text = `${PRINT.join("\n")}\n# Oferta\n\ncorpo\n`;
    const p = note(text);
    const res = await read(p);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.properties).toEqual([
      { key: "type", kind: "text", value: "context" },
      { key: "status", kind: "status", value: "active" },
      { key: "tags", kind: "list", value: ["offer", "accelerator"] },
      { key: "updated", kind: "date", value: "2026-10-14" },
    ]);
    expect(res.body.otherProperties).toBeNull();
    const after = `${PRINT.join("\n")}\n`.length;
    expect(res.body.bodyStart).toBe(after);
    expect(res.body.content.slice(res.body.bodyStart)).toBe("# Oferta\n\ncorpo\n");
  });

  it("C15 a nested map, a multi-line string and a comment are answered in otherProperties exactly as in the file and none is a property; a note with no header answers [], null and 0", async () => {
    const header = ["---", "title: Nota", "meta:", "  a: 1", "desc: |", "  x", "# c", "status: draft", "---"];
    const p = note(`${header.join("\n")}\ncorpo\n`);
    const res = await read(p);
    expect(res.status).toBe(200);
    expect(res.body.otherProperties).toBe(["meta:", "  a: 1", "desc: |", "  x", "# c"].join("\n"));
    expect(res.body.properties).toEqual([
      { key: "title", kind: "text", value: "Nota" },
      { key: "status", kind: "status", value: "draft" },
    ]);
    for (const key of ["meta", "desc"])
      expect(res.body.properties.map((x: Json) => x.key)).not.toContain(key);

    const bare = await read(note("# Sem cabeçalho\n\ntexto\n"));
    expect(bare.status).toBe(200);
    expect(bare.body.properties).toEqual([]);
    expect(bare.body.otherProperties).toBeNull();
    expect(bare.body.bodyStart).toBe(0);
  });

  it("C16 set status archived with the current baseVersion answers 200 with the new version and properties, changes only the status line, reaches fields.status through the index pass it asks for, and the same request again changes no byte", async () => {
    const text = `${PRINT.join("\n")}\n# Oferta\n\ncorpo com status: active no texto\n`;
    const p = note(text);
    const res = await write({ path: p, baseVersion: sha(text), set: { status: "archived" } });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const after = bytes(p);
    expect(res.body.version).toBe(sha(after));
    expect(res.body.path).toBe(p);
    expect(res.body.size).toBe(after.length);
    expect(res.body.properties).toContainEqual({ key: "status", kind: "status", value: "archived" });
    const was = text.split("\n");
    const now = after.toString("utf8").split("\n");
    expect(now).toHaveLength(was.length);
    const changed = was.flatMap((line, i) => (line === now[i] ? [] : [i]));
    expect(changed).toEqual([2]);
    expect(now[2]).toBe("status: archived");

    const deadline = Date.now() + 20_000;
    let status: string | undefined;
    while (Date.now() < deadline) {
      const row = w.ctx.db.prepare("SELECT fields FROM files WHERE path = ?").get(p) as
        { fields: string } | undefined;
      status = row ? (JSON.parse(row.fields) as Record<string, string>).status : undefined;
      if (status === "archived") break;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    expect(status).toBe("archived");

    const again = await write({ path: p, baseVersion: res.body.version, set: { status: "archived" } });
    expect(again.status).toBe(200);
    expect(again.body.version).toBe(res.body.version);
    expect(bytes(p).equals(after)).toBe(true);
  });

  it("C17 new keys are added right before the closing --- in request order, and a note with no header gets ---, the lines, --- and its old content byte for byte", async () => {
    const text = `${PRINT.join("\n")}\ncorpo\n`;
    const p = note(text);
    const res = await write({
      path: p,
      baseVersion: sha(text),
      set: { last_reviewed: "2026-10-30", due: "2026-11-01" },
    });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(bytes(p).toString("utf8")).toBe(
      [...PRINT.slice(0, -1), "last_reviewed: 2026-10-30", "due: 2026-11-01", "---", "corpo", ""].join("\n"),
    );

    const old = "# Sem cabeçalho\n\nlinha um\nlinha dois\n";
    const bare = note(old);
    const made = await write({
      path: bare,
      baseVersion: sha(old),
      set: { last_reviewed: "2026-10-30", due: "2026-11-01" },
    });
    expect(made.status, JSON.stringify(made.body)).toBe(200);
    expect(bytes(bare).toString("utf8")).toBe(`---\nlast_reviewed: 2026-10-30\ndue: 2026-11-01\n---\n${old}`);
  });

  it("C18 remove deletes the type line, and on a block list deletes tags and its three item lines; every other byte is kept", async () => {
    const lines = [
      "---",
      "type: context",
      "tags:",
      "  - um",
      "  - dois",
      "  - tres",
      "status: active",
      "---",
      "corpo",
      "",
    ];
    const text = lines.join("\n");
    const p = note(text);
    const first = await write({ path: p, baseVersion: sha(text), remove: ["type"] });
    expect(first.status, JSON.stringify(first.body)).toBe(200);
    const noType = lines.filter((l) => l !== "type: context").join("\n");
    expect(bytes(p).toString("utf8")).toBe(noType);
    const second = await write({ path: p, baseVersion: first.body.version, remove: ["tags"] });
    expect(second.status, JSON.stringify(second.body)).toBe(200);
    expect(bytes(p).toString("utf8")).toBe(["---", "status: active", "---", "corpo", ""].join("\n"));
  });

  it("C19 each refused key or value answers 400 validation and leaves the file byte for byte", async () => {
    const text = `${PRINT.join("\n")}\ncorpo\n`;
    const p = note(text);
    const before = bytes(p);
    const tags21 = Array.from({ length: 21 }, (_, i) => `tag${i}`);
    const cases: Array<[string, Json]> = [
      ["updated 14/10/2026", { set: { updated: "14/10/2026" } }],
      ["status blocked", { set: { status: "blocked" } }],
      ["text with a line break", { set: { title: "linha\nquebrada" } }],
      ["text of 501 characters", { set: { title: "a".repeat(501) } }],
      ["list of 21 entries", { set: { tags: tags21 } }],
      ["tag a", { set: { tags: ["a"] } }],
      ["tag com espaço", { set: { tags: ["com espaço"] } }],
      ["key Status", { set: { Status: "active" } }],
      ["key 1x", { set: { "1x": "valor" } }],
      ["key of 41 characters", { set: { [`a${"b".repeat(40)}`]: "valor" } }],
      ["natureza certeza", { set: { natureza: "certeza" } }],
      ["escopo publico", { set: { escopo: "publico" } }],
      ["review_every 0d", { set: { review_every: "0d" } }],
      ["review_every 1000d", { set: { review_every: "1000d" } }],
      ["review_every 30", { set: { review_every: "30" } }],
    ];
    for (const [what, change] of cases) {
      const res = await write({ path: p, baseVersion: sha(before), ...change });
      expect(res.status, what).toBe(400);
      expect(res.body.error.code, what).toBe("validation");
      expect(bytes(p).equals(before), what).toBe(true);
    }
  });

  it("C20 a header longer than 4 096 bytes, and one with no closing ---, answer 409 front_matter_unreadable and leave the file byte for byte", async () => {
    const long = [
      "---",
      ...Array.from({ length: 100 }, (_, i) => `campo${i}: ${"x".repeat(45)}`),
      "---",
      "corpo",
      "",
    ].join("\n");
    expect(Buffer.byteLength(long)).toBeGreaterThan(4096);
    const open = "---\ntype: context\nstatus: active\n\ncorpo sem fechamento\n";
    for (const [what, text] of [
      ["longer than 4 096 bytes", long],
      ["no closing ---", open],
    ] as const) {
      const p = note(text);
      const res = await write({ path: p, baseVersion: sha(text), set: { status: "archived" } });
      expect(res.status, what).toBe(409);
      expect(res.body.error.code, what).toBe("front_matter_unreadable");
      expect(bytes(p).toString("utf8"), what).toBe(text);
    }
  });

  it("C21 a file changed on disk after baseVersion answers 409 edit_conflict and keeps the bytes of that change", async () => {
    const text = `${PRINT.join("\n")}\ncorpo\n`;
    const p = note(text);
    const theirs = `${PRINT.join("\n")}\ncorpo mudado por outro editor\n`;
    fs.writeFileSync(p, theirs);
    const res = await write({ path: p, baseVersion: sha(text), set: { status: "archived" } });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("edit_conflict");
    expect(bytes(p).toString("utf8")).toBe(theirs);
  });

  it.skipIf(!POSIX)(
    "C22 ROUTER.md, memory/contexts/<id>.md and a file outside memory/ are 403 note_not_editable; a link on the way is 403 forbidden_path; a deleted note 404 note_missing; one above the limit 413 note_too_large; none is written",
    async () => {
      const text = `${PRINT.join("\n")}\ncorpo\n`;
      const router = w.put(path.join(w.memory, "ROUTER.md"), text);
      const map = w.put(path.join(w.memory, "contexts", "c22.md"), text);
      const r = w.indexedRoot("c22");
      const outside = w.put(path.join(r, "fora.md"), text);
      for (const p of [router, map, outside]) {
        const res = await write({ path: p, baseVersion: sha(text), set: { status: "archived" } });
        expect(res.status, p).toBe(403);
        expect(res.body.error.code, p).toBe("note_not_editable");
        expect(bytes(p).toString("utf8"), p).toBe(text);
      }

      const target = w.outside("c22-alvo");
      const real = w.put(path.join(target, "x.md"), text);
      fs.mkdirSync(notes, { recursive: true });
      fs.symlinkSync(target, path.join(notes, "c22-link"));
      const linked = await write({
        path: path.join(notes, "c22-link", "x.md"),
        baseVersion: sha(text),
        set: { status: "archived" },
      });
      expect(linked.status).toBe(403);
      expect(linked.body.error.code).toBe("forbidden_path");
      expect(bytes(real).toString("utf8")).toBe(text);

      const gone = note(text);
      fs.rmSync(gone);
      const missing = await write({ path: gone, baseVersion: sha(text), set: { status: "archived" } });
      expect(missing.status).toBe(404);
      expect(missing.body.error.code).toBe("note_missing");
      expect(fs.existsSync(gone)).toBe(false);

      const big = `${PRINT.join("\n")}\n${"x".repeat(1024 * 1024 + 10)}\n`;
      const large = note(big);
      const tooLarge = await write({ path: large, baseVersion: sha(big), set: { status: "archived" } });
      expect(tooLarge.status).toBe(413);
      expect(tooLarge.body.error.code).toBe("note_too_large");
      expect(bytes(large).toString("utf8")).toBe(big);
    },
  );

  it("C23 GET /api/memory/note answers 200 with the three new fields, 400 validation for an empty p, 403 forbidden_path under the home's config/, 404 note_missing for a deleted note and 413 note_too_large above the limit", async () => {
    const ok = await read(note(`${PRINT.join("\n")}\ncorpo\n`));
    expect(ok.status).toBe(200);
    for (const key of ["properties", "otherProperties", "bodyStart"])
      expect(ok.body, key).toHaveProperty(key);

    const empty = await w.call("GET", "/api/memory/note?p=");
    expect(empty.status).toBe(400);
    expect(empty.body.error.code).toBe("validation");

    const config = await read(path.join(w.home, "config", "settings.json"));
    expect(config.status).toBe(403);
    expect(config.body.error.code).toBe("forbidden_path");

    const gone = note("# Some\n");
    fs.rmSync(gone);
    const missing = await read(gone);
    expect(missing.status).toBe(404);
    expect(missing.body.error.code).toBe("note_missing");

    const large = await read(note(`# Grande\n${"x".repeat(1024 * 1024 + 10)}\n`));
    expect(large.status).toBe(413);
    expect(large.body.error.code).toBe("note_too_large");
  });
});

describe("door 8 at the boundary: the details of the property writer", () => {
  const version = async (p: string) => (await read(p)).body.version as string;

  it("C84 the same key in set and remove is 400 validation; a set value written as a JSON string when it does not read the same unquoted; a value set to what it holds keeps its line; a block list stays a block; a repeated key's later lines and a value's trailing comment are read as door 8 says; an unreadable header reads as none", async () => {
    // the same key set and removed
    const both = note(`${PRINT.join("\n")}\ncorpo\n`);
    const was = bytes(both);
    const refused = await write({
      path: both,
      baseVersion: await version(both),
      set: { status: "done" },
      remove: ["status"],
    });
    expect(refused.status, JSON.stringify(refused.body)).toBe(400);
    expect(refused.body.error.code).toBe("validation");
    expect(bytes(both).equals(was)).toBe(true);

    // a trailing comment is not part of an unquoted value; set to what it holds, the line is kept; a text that does
    // not read the same unquoted is a JSON string, one that does is written plain
    const p = note("---\nstatus: active # revisto\nowner: Ana\n---\ncorpo\n");
    const got = await read(p);
    expect(got.body.properties).toEqual([
      { key: "status", kind: "status", value: "active" },
      { key: "owner", kind: "text", value: "Ana" },
    ]);
    let res = await write({
      path: p,
      baseVersion: got.body.version,
      set: { status: "active", owner: "a: b" },
    });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(bytes(p).toString("utf8")).toBe('---\nstatus: active # revisto\nowner: "a: b"\n---\ncorpo\n');
    res = await write({ path: p, baseVersion: res.body.version, set: { owner: "Ana (sócia), v.2" } });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(bytes(p).toString("utf8")).toBe(
      "---\nstatus: active # revisto\nowner: Ana (sócia), v.2\n---\ncorpo\n",
    );

    // a block list stays a block, its items at the first one's indentation
    const b = note("---\ntags:\n    - um\n    - dois\n---\ncorpo\n");
    res = await write({ path: b, baseVersion: await version(b), set: { tags: ["um", "dois", "tres"] } });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(bytes(b).toString("utf8")).toBe("---\ntags:\n    - um\n    - dois\n    - tres\n---\ncorpo\n");

    // a repeated key: the first line is the property, the later ones other properties
    const r = note("---\ntype: um\ntype: dois\n---\ncorpo\n");
    const repeated = await read(r);
    expect(repeated.body.properties).toEqual([{ key: "type", kind: "text", value: "um" }]);
    expect(repeated.body.otherProperties).toBe("type: dois");

    // an unreadable header (no closing ---) reads as none
    const u = note("---\ntype: context\n\ncorpo\n");
    const unreadable = await read(u);
    expect(unreadable.status).toBe(200);
    expect([unreadable.body.properties, unreadable.body.otherProperties, unreadable.body.bodyStart]).toEqual([
      [],
      null,
      0,
    ]);
  });
});
