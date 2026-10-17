import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { slugify } from "../core/src/memory/notes.js";
import { AppContext } from "../apps/api/src/context.js";
import { buildServer } from "../apps/api/src/server.js";
import { makeTempHome } from "./helpers.js";

/**
 * .specs/features/cerebro-v2, slice S1: the notes a person, a CLI or an agent creates and edits under memory/.
 * Every test calls the HTTP routes of a real server over a real home; the file on disk is read back with `fs` (the
 * test's own eyes, not the engine's).
 */

let temp: ReturnType<typeof makeTempHome>;
let ctx: AppContext;
let app: FastifyInstance;
let token: string;
const cleanups: Array<() => Promise<unknown> | unknown> = [];
const memory = () => temp.paths.memory;
const sha = (bytes: string | Buffer) => `sha256:${crypto.createHash("sha256").update(bytes).digest("hex")}`;
const owner = () => ({ "x-mordomo-token": token, "content-type": "application/json" });

beforeAll(async () => {
  temp = makeTempHome("mordomo-notes-");
  ctx = new AppContext(temp.paths.home);
  const settings = ctx.settings();
  settings.setupCompleted = true;
  settings.remote.enabled = true;
  ctx.settingsStore.save(settings);
  token = ctx.token();
  app = await buildServer(ctx);
});

afterAll(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
  await app.close();
  ctx.close();
  temp.cleanup();
});

async function create(body: Record<string, unknown>) {
  const res = await app.inject({ method: "POST", url: "/api/memory/notes", headers: owner(), payload: body });
  return { status: res.statusCode, body: res.json() as Record<string, any> };
}
async function save(body: Record<string, unknown>, headers: Record<string, string> = owner()) {
  const res = await app.inject({ method: "PUT", url: "/api/memory/notes", headers, payload: body });
  return { status: res.statusCode, body: res.json() as Record<string, any> };
}
async function read(p: string, headers: Record<string, string> = owner()) {
  const res = await app.inject({
    method: "GET",
    url: `/api/memory/note?p=${encodeURIComponent(p)}`,
    headers,
  });
  return { status: res.statusCode, body: res.json() as Record<string, any> };
}
async function preview(p: string, headers: Record<string, string> = owner()) {
  const res = await app.inject({
    method: "GET",
    url: `/api/memory/preview?p=${encodeURIComponent(p)}`,
    headers,
  });
  return { status: res.statusCode, body: res.json() as Record<string, any> };
}
const errorCode = (r: { body: Record<string, any> }) => r.body.error?.code;

describe("S1 create and edit a note", () => {
  it("C1 creates memory/notes/<slug>.md and answers 201 with the version of the bytes on disk", async () => {
    const res = await create({ title: "Reunião de planejamento" });
    expect(res.status).toBe(201);
    const file = path.join(memory(), "notes", "reuniao-de-planejamento.md");
    expect(res.body.path).toBe(file);
    expect(fs.readFileSync(file, "utf8")).toBe("# Reunião de planejamento\n\n");
    expect(res.body.version).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(res.body.version).toBe(sha(fs.readFileSync(file)));
    expect(res.body.size).toBe(fs.statSync(file).size);
    expect(res.body.name).toBe("reuniao-de-planejamento.md");
  });

  it("C2 a name that exists gets -2 … -99 and the existing file is not touched; the hundredth is 409", async () => {
    const first = await create({ title: "Repetida" });
    const file = first.body.path as string;
    fs.writeFileSync(file, "# Repetida\n\nminha edição\n");
    const before = fs.readFileSync(file);
    const second = await create({ title: "Repetida" });
    expect(second.status).toBe(201);
    expect(path.basename(second.body.path)).toBe("repetida-2.md");
    expect(fs.readFileSync(file).equals(before)).toBe(true);
    for (let n = 3; n <= 99; n++) {
      const next = await create({ title: "Repetida" });
      expect(path.basename(next.body.path)).toBe(`repetida-${n}.md`);
    }
    const hundredth = await create({ title: "Repetida" });
    expect(hundredth.status).toBe(409);
    expect(errorCode(hundredth)).toBe("note_exists");
    expect(fs.readFileSync(file).equals(before)).toBe(true);
    expect(fs.readdirSync(path.join(memory(), "notes")).filter((f) => f.startsWith("repetida")).length).toBe(
      99,
    );
  });

  it("C3 the file name follows the slug rule for every row, the 22 Windows device names included", () => {
    const device = [
      "con",
      "prn",
      "aux",
      "nul",
      ...[1, 2, 3, 4, 5, 6, 7, 8, 9].flatMap((n) => [`com${n}`, `lpt${n}`]),
    ];
    expect(device).toHaveLength(22);
    const rows: Array<[string, string]> = [
      ["Reunião de planejamento", "reuniao-de-planejamento"],
      ["  Ação & Reação!  ", "acao-reacao"],
      ["ÀÉÎÕÜ ç", "aeiou-c"],
      ["a---b___c", "a-b-c"],
      ["---", "nota"],
      ["日本語", "nota"],
      ["", "nota"],
      ["x".repeat(120), "x".repeat(80)],
      [`${"ab ".repeat(40)}`, "ab-".repeat(26) + "ab"],
      ["2026-10-12", "2026-10-12"],
      ["Con", "con-nota"],
      ["COM1", "com1-nota"],
      ["Notas.", "notas"],
    ];
    for (const [title, slug] of rows) expect(slugify(title), JSON.stringify(title)).toBe(slug);
    for (const name of device) {
      expect(slugify(name), name).toBe(`${name}-nota`);
      expect(slugify(name.toUpperCase()), name.toUpperCase()).toBe(`${name}-nota`);
    }
    // not a device name: com0 and com10 are ordinary
    expect(slugify("com0")).toBe("com0");
    expect(slugify("com10")).toBe("com10");
    // the 80th character is a dash: it is trimmed after the cut
    expect(slugify(`${"a".repeat(79)} b`)).toBe("a".repeat(79));
  });

  it("C4 an area of the settings gives the note a folder; an unknown area is 400 and creates nothing", async () => {
    const area = ctx.settings().areas[0]!;
    const ok = await create({ title: "Nota de área", area });
    expect(ok.status).toBe(201);
    expect(path.dirname(ok.body.path)).toBe(path.join(memory(), "notes", "worker"));
    const before = fs.readdirSync(path.join(memory(), "notes"), { recursive: true }).sort();
    const bad = await create({ title: "Nota órfã", area: "Inexistente" });
    expect(bad.status).toBe(400);
    expect(errorCode(bad)).toBe("unknown_area");
    expect(fs.readdirSync(path.join(memory(), "notes"), { recursive: true }).sort()).toEqual(before);
  });

  it("C5 front matter is written on request and the index takes its title and tags", async () => {
    const res = await create({
      title: "Com cabeçalho",
      frontMatter: true,
      tags: ["projeto", "ideia"],
      content: "corpo",
    });
    expect(res.status).toBe(201);
    const text = fs.readFileSync(res.body.path, "utf8");
    const lines = text.split("\n");
    expect(lines[0]).toBe("---");
    expect(lines[1]).toBe('title: "Com cabeçalho"');
    expect(lines[2]).toBe("tags: [projeto, ideia]");
    expect(lines[3]).toMatch(/^created: \d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    expect(lines[4]).toBe("---");
    expect(text).toContain("# Com cabeçalho\n\ncorpo\n");
    // A note whose header title differs from its heading, and a tag in both places
    const own = path.join(memory(), "notes", "cabecalho-proprio.md");
    fs.writeFileSync(
      own,
      '---\ntitle: "Título do cabeçalho"\ntags: [alfa, "beta"]\n---\n# Outro título\n\ntexto #beta #gama\n',
    );
    await ctx.indexer.indexAllAsync();
    const rows = ctx.db
      .prepare("SELECT path, title, tags FROM files WHERE path IN (?, ?)")
      .all(res.body.path, own) as Array<{
      path: string;
      title: string;
      tags: string;
    }>;
    const byPath = new Map(rows.map((r) => [r.path, r]));
    expect(byPath.get(res.body.path)!.title).toBe("Com cabeçalho");
    expect(JSON.parse(byPath.get(res.body.path)!.tags)).toEqual(["projeto", "ideia"]);
    expect(byPath.get(own)!.title).toBe("Título do cabeçalho");
    expect(JSON.parse(byPath.get(own)!.tags)).toEqual(["alfa", "beta", "gama"]);
  });

  it("C6 an empty title, a long title, too many tags and a bad tag are 400 and write nothing", async () => {
    // its own folder: the proof line runs this test alone (`-t "C6 "`), with no earlier test to have made it
    fs.mkdirSync(path.join(memory(), "notes"), { recursive: true });
    const before = () => fs.readdirSync(path.join(memory(), "notes"), { recursive: true }).sort();
    const snapshot = before();
    const bad: Array<Record<string, unknown>> = [
      { title: "" },
      { title: "   " },
      { title: "x".repeat(201) },
      { title: "duas\nlinhas" },
      { title: "ok", tags: Array.from({ length: 21 }, (_, i) => `tag${i}`) },
      { title: "ok", tags: ["a"] },
      { title: "ok", tags: ["a".repeat(31)] },
      { title: "ok", tags: ["com espaço"] },
    ];
    for (const body of bad) {
      const res = await create(body);
      expect([res.status, errorCode(res)], JSON.stringify(body).slice(0, 60)).toEqual([400, "validation"]);
    }
    expect(before()).toEqual(snapshot);
    // the edges that are valid
    expect((await create({ title: "y".repeat(200), tags: ["ab", "a".repeat(30)] })).status).toBe(201);
    expect(
      (await create({ title: "tags", tags: Array.from({ length: 20 }, (_, i) => `tag${i}`) })).status,
    ).toBe(201);
  });

  it("C7 PUT with the version on disk replaces the file; a second PUT with the old version is 409", async () => {
    const made = await create({ title: "Para salvar" });
    const first = await save({
      path: made.body.path,
      content: "# Para salvar\n\nv2\n",
      baseVersion: made.body.version,
    });
    expect(first.status).toBe(200);
    expect(fs.readFileSync(made.body.path, "utf8")).toBe("# Para salvar\n\nv2\n");
    expect(first.body.version).toBe(sha("# Para salvar\n\nv2\n"));
    expect(first.body.path).toBe(made.body.path);
    const stale = await save({ path: made.body.path, content: "outra", baseVersion: made.body.version });
    expect([stale.status, errorCode(stale)]).toEqual([409, "edit_conflict"]);
    expect(fs.readFileSync(made.body.path, "utf8")).toBe("# Para salvar\n\nv2\n");
    // the new version saves again
    const second = await save({ path: made.body.path, content: "v3", baseVersion: first.body.version });
    expect(second.status).toBe(200);
    expect(fs.readFileSync(made.body.path, "utf8")).toBe("v3");
  });

  it("C6 a PUT with a malformed baseVersion is 400 validation and writes nothing", async () => {
    const made = await create({ title: "Versão torta" });
    const file = made.body.path as string;
    const before = fs.readFileSync(file);
    const bad = [
      "",
      "sha256:",
      "sha256:abc",
      "sha256:" + "g".repeat(64),
      "sha256:" + "A".repeat(64),
      "sha1:" + "0".repeat(40),
      made.body.version.slice("sha256:".length),
      made.body.version + "0",
    ];
    for (const baseVersion of bad) {
      const res = await save({ path: file, content: "trocado", baseVersion });
      expect([res.status, errorCode(res)], baseVersion).toEqual([400, "validation"]);
    }
    expect((await save({ path: file, content: "trocado" } as Record<string, unknown>)).status).toBe(400);
    expect(fs.readFileSync(file).equals(before)).toBe(true);
    // the well-formed one still saves
    expect((await save({ path: file, content: "trocado", baseVersion: made.body.version })).status).toBe(200);
  });

  it("C8 a PUT over a file that changed outside keeps its bytes and its mtime, even in the same millisecond", async () => {
    const made = await create({ title: "Conflito" });
    const file = made.body.path as string;
    fs.writeFileSync(file, "# Conflito\n\nescrito por fora\n");
    const stampMs = fs.statSync(file).mtimeMs;
    const before = fs.readFileSync(file);
    const res = await save({ path: file, content: "meu texto", baseVersion: made.body.version });
    expect([res.status, errorCode(res)]).toEqual([409, "edit_conflict"]);
    expect(fs.readFileSync(file).equals(before)).toBe(true);
    expect(fs.statSync(file).mtimeMs).toBe(stampMs);
    // same size, same mtime, other bytes: a version made of size and mtime would let this through
    const same = "# Conflito\n\nescrito por fora\n".replace("fora", "foro");
    fs.writeFileSync(file, same);
    fs.utimesSync(file, new Date(stampMs), new Date(stampMs));
    const tricky = await save({ path: file, content: "meu texto", baseVersion: sha(before) });
    expect([tricky.status, errorCode(tricky)]).toEqual([409, "edit_conflict"]);
    expect(fs.readFileSync(file, "utf8")).toBe(same);
  });

  it("C9 a PUT on a path that does not exist is 404 and does not create it", async () => {
    const ghost = path.join(memory(), "notes", "fantasma.md");
    const res = await save({ path: ghost, content: "x", baseVersion: sha("") });
    expect([res.status, errorCode(res)]).toEqual([404, "note_missing"]);
    expect(fs.existsSync(ghost)).toBe(false);
    const inNewFolder = path.join(memory(), "notes", "pasta-nova", "fantasma.md");
    const nested = await save({ path: inNewFolder, content: "x", baseVersion: sha("") });
    expect([nested.status, errorCode(nested)]).toEqual([404, "note_missing"]);
    expect(fs.existsSync(path.dirname(inNewFolder))).toBe(false);
  });

  it("C10 the limit is min(maxIndexedFileBytes, 1 MiB) in UTF-8 bytes, for PUT and POST", async () => {
    const withLimit = async (maxIndexedFileBytes: number, expected: number) => {
      const settings = ctx.settings();
      settings.limits.maxIndexedFileBytes = maxIndexedFileBytes;
      ctx.settingsStore.save(settings);
      const made = await create({ title: `Limite ${maxIndexedFileBytes}` });
      const file = made.body.path as string;
      // multi-byte characters: 3 bytes each
      const fits = "é".repeat(Math.floor(expected / 2)) + (expected % 2 ? "a" : "");
      expect(Buffer.byteLength(fits)).toBe(expected);
      const ok = await save({ path: file, content: fits, baseVersion: made.body.version });
      expect(ok.status, `${expected} bytes`).toBe(200);
      const tooBig = await save({ path: file, content: `${fits}a`, baseVersion: ok.body.version });
      expect([tooBig.status, errorCode(tooBig)], `${expected + 1} bytes`).toEqual([413, "note_too_large"]);
      expect(Buffer.byteLength(fs.readFileSync(file, "utf8"))).toBe(expected);
      // POST: the heading and the body count
      const post = await create({ title: "grande", content: "a".repeat(expected) });
      expect([post.status, errorCode(post)]).toEqual([413, "note_too_large"]);
      return file;
    };
    await withLimit(2048, 2048);
    await withLimit(4 * 1024 * 1024, 1024 * 1024);
    const settings = ctx.settings();
    settings.limits.maxIndexedFileBytes = 2 * 1024 * 1024;
    ctx.settingsStore.save(settings);
  });

  it("C11 a file that is not an editable note is read-only and a PUT is 403 note_not_editable", async () => {
    const outside = path.join(temp.paths.workspace, "fora.md");
    fs.writeFileSync(outside, "# fora\n");
    fs.mkdirSync(path.join(memory(), "areas"), { recursive: true });
    fs.mkdirSync(path.join(memory(), "journal"), { recursive: true });
    const cases: Record<string, string> = {
      "outside memory/": outside,
      "ROUTER.md": path.join(memory(), "ROUTER.md"),
      "areas/": path.join(memory(), "areas", "worker.md"),
      "journal/": path.join(memory(), "journal", "2026-01-01.md"),
      ".txt": path.join(memory(), "notes", "plain.txt"),
      "no extension": path.join(memory(), "notes", "semextensao"),
    };
    for (const [name, file] of Object.entries(cases)) {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, "original\n");
      const info = fs.statSync(file);
      const got = await read(file);
      expect(got.status, `${name} read`).toBe(200);
      expect(got.body.editable, name).toBe(false);
      expect(typeof got.body.reason, name).toBe("string");
      const res = await save({ path: file, content: "trocado", baseVersion: got.body.version });
      expect([res.status, errorCode(res)], name).toEqual([403, "note_not_editable"]);
      expect(fs.readFileSync(file, "utf8"), name).toBe("original\n");
      expect(fs.statSync(file).mtimeMs, name).toBe(info.mtimeMs);
    }
    const mine = await create({ title: "Editável" });
    expect((await read(mine.body.path)).body.editable).toBe(true);
  });

  it("C11 the preview says editable: true for a note and false for each of the six paths that are not one", async () => {
    const outside = path.join(temp.paths.workspace, "fora-do-preview.md");
    fs.writeFileSync(outside, "# fora\n");
    fs.mkdirSync(path.join(memory(), "areas"), { recursive: true });
    fs.mkdirSync(path.join(memory(), "journal"), { recursive: true });
    const cases: Record<string, string> = {
      "outside memory/": outside,
      "ROUTER.md": path.join(memory(), "ROUTER.md"),
      "areas/": path.join(memory(), "areas", "preview.md"),
      "journal/": path.join(memory(), "journal", "2026-02-02.md"),
      ".txt": path.join(memory(), "notes", "preview.txt"),
      "no extension": path.join(memory(), "notes", "previewsemextensao"),
    };
    for (const [name, file] of Object.entries(cases)) {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, "texto\n");
      const got = await preview(file);
      expect(got.status, `${name} status`).toBe(200);
      expect(got.body.kind, `${name} kind`).toBe("text");
      expect(got.body.editable, name).toBe(false);
    }
    const mine = await create({ title: "Editável no preview" });
    const got = await preview(mine.body.path);
    expect([got.status, got.body.kind, got.body.editable]).toEqual([200, "text", true]);
    // a file that is not text is never offered for editing, whatever its name
    const image = path.join(memory(), "notes", "imagem.md");
    fs.writeFileSync(image, Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 0]));
    const binary = await preview(image);
    expect(binary.status).toBe(200);
    expect(binary.body.editable).toBe(false);
  });

  it("C12 PUT and POST do not write through a link, a linked folder or a hard link of the token", async () => {
    const outside = path.join(temp.paths.workspace, "alvo.md");
    fs.writeFileSync(outside, "alvo\n");
    const tokenFile = path.join(temp.paths.config, "token");
    const tokenBytes = fs.readFileSync(tokenFile);
    fs.mkdirSync(path.join(memory(), "notes"), { recursive: true });
    const toToken = path.join(memory(), "notes", "para-o-token.md");
    const toOutside = path.join(memory(), "notes", "para-fora.md");
    const folderLink = path.join(memory(), "notes", "pasta-ligada");
    const hard = path.join(memory(), "notes", "dura.md");
    fs.symlinkSync(tokenFile, toToken);
    fs.symlinkSync(outside, toOutside);
    fs.symlinkSync(temp.paths.config, folderLink);
    fs.linkSync(tokenFile, hard);
    for (const file of [toToken, toOutside, hard, path.join(folderLink, "token")]) {
      const res = await save({ path: file, content: "trocado", baseVersion: sha("") });
      expect(res.status, file).toBe(403);
      expect(errorCode(res), file).toBe("forbidden_path");
    }
    expect(fs.readFileSync(tokenFile).equals(tokenBytes)).toBe(true);
    expect(fs.readFileSync(outside, "utf8")).toBe("alvo\n");
    // POST onto a name that is a link: refused (create never follows) and the link target is untouched
    fs.symlinkSync(tokenFile, path.join(memory(), "notes", "armadilha.md"));
    const made = await create({ title: "Armadilha" });
    expect([made.status, errorCode(made)]).toEqual([403, "forbidden_path"]);
    expect(fs.readFileSync(tokenFile).equals(tokenBytes)).toBe(true);
    // POST into a folder that is a link to config/
    const area = ctx.settings().areas[1]!;
    fs.symlinkSync(temp.paths.config, path.join(memory(), "notes", "documentos"));
    const viaFolder = await create({ title: "Pela pasta", area });
    expect(viaFolder.status).toBe(403);
    expect(errorCode(viaFolder)).toBe("forbidden_path");
    expect(fs.existsSync(path.join(temp.paths.config, "pela-pasta.md"))).toBe(false);
    expect(fs.readFileSync(tokenFile).equals(tokenBytes)).toBe(true);
  });

  it("C13 a path with a NUL byte or a 300-character name answers the 403 forbidden_path of the preview on GET note and PUT notes", async () => {
    // its own folder: the proof line runs this test alone (`-t "C13 "`); without memory/notes the long names are 404
    fs.mkdirSync(path.join(memory(), "notes"), { recursive: true });
    const strict = await buildServer(ctx, { validateResponses: true }); // an answer the contract does not declare is a 500
    cleanups.push(() => strict.close());
    const version = sha("x");
    const probes: Record<string, string> = {
      "a NUL byte": path.join(memory(), "notes", "a\0b.md"),
      "a NUL byte, relative": "notes/a\0b.md",
      "a 300-character name": path.join(memory(), "notes", `${"y".repeat(300)}.md`),
      "a 300-character folder": path.join(memory(), "notes", "d".repeat(300), "a.md"),
      "a 256-character name": path.join(memory(), "notes", `${"z".repeat(253)}.md`),
      "a very deep path": path.join(memory(), `${"q/".repeat(2500)}a.md`),
    };
    for (const [name, p] of Object.entries(probes)) {
      const asked = [
        await strict.inject({
          method: "GET",
          url: `/api/memory/preview?p=${encodeURIComponent(p)}`,
          headers: owner(),
        }),
        await strict.inject({
          method: "GET",
          url: `/api/memory/note?p=${encodeURIComponent(p)}`,
          headers: owner(),
        }),
        await strict.inject({
          method: "PUT",
          url: "/api/memory/notes",
          headers: owner(),
          payload: { path: p, content: "x", baseVersion: version },
        }),
      ];
      expect(
        asked.map((r) => [r.statusCode, r.json().error?.code]),
        name,
      ).toEqual([
        [403, "forbidden_path"],
        [403, "forbidden_path"],
        [403, "forbidden_path"],
      ]);
    }
    // the longest name a file system takes is a missing note, as before
    const longest = path.join(memory(), "notes", `${"z".repeat(252)}.md`);
    expect((await read(longest)).status).toBe(404);
  });

  it("C13 GET /api/memory/note answers the whole text and the version, and the refusals of the route", async () => {
    const made = await create({ title: "Para ler", content: "um texto com acentuação: ção" });
    const text = fs.readFileSync(made.body.path, "utf8");
    const got = await read(made.body.path);
    expect(got.status).toBe(200);
    expect(got.body).toMatchObject({
      path: made.body.path,
      name: "para-ler.md",
      content: text,
      version: sha(text),
      size: Buffer.byteLength(text),
      editable: true,
    });
    // a relative path is under memory/
    expect((await read("notes/para-ler.md")).body.content).toBe(text);
    const big = path.join(memory(), "notes", "enorme.md");
    fs.writeFileSync(big, "x".repeat(2 * 1024 * 1024 + 1));
    const tooBig = await read(big);
    expect([tooBig.status, errorCode(tooBig)]).toEqual([413, "note_too_large"]);
    const missing = await read(path.join(memory(), "notes", "nao-existe.md"));
    expect([missing.status, errorCode(missing)]).toEqual([404, "note_missing"]);
    const secret = await read(path.join(temp.paths.config, "token"));
    expect([secret.status, errorCode(secret)]).toEqual([403, "forbidden_path"]);
    const folder = await read(path.join(memory(), "notes"));
    expect([folder.status, errorCode(folder)]).toEqual([404, "not_a_file"]);
    expect((await read("")).status).toBe(400);
    // not UTF-8: readable as bytes elsewhere, never editable here
    const latin = path.join(memory(), "notes", "latin1.md");
    fs.writeFileSync(latin, Buffer.from([0x63, 0x61, 0x66, 0xe9]));
    const odd = await read(latin);
    expect(odd.body.editable).toBe(false);
    expect(odd.body.reason).toMatch(/UTF-8/);
  });

  it("C14 only the owner writes: a device and a run credential are refused; a device with content reads", async () => {
    const made = await create({ title: "Dono escreve" });
    const device = (scopes: string[]) => {
      const { code } = ctx.devices.startPairing("phone", scopes as never);
      return ctx.devices.claim(code, "phone")!.token;
    };
    const everything = device(["monitor", "content", "run", "approve"]);
    const asDevice = (t: string) => ({ "x-mordomo-token": t, "content-type": "application/json" });
    const before = fs.readFileSync(made.body.path);
    for (const [method, url, payload] of [
      ["POST", "/api/memory/notes", { title: "pelo celular" }],
      ["PUT", "/api/memory/notes", { path: made.body.path, content: "x", baseVersion: made.body.version }],
    ] as const) {
      const res = await app.inject({ method, url, headers: asDevice(everything), payload });
      expect([res.statusCode, (res.json() as any).error.code], `${method} ${url}`).toEqual([
        403,
        "owner_only",
      ]);
    }
    expect(fs.existsSync(path.join(memory(), "notes", "pelo-celular.md"))).toBe(false);
    expect(fs.readFileSync(made.body.path).equals(before)).toBe(true);

    const run = ctx.runs.create({
      origin: "skill",
      provider: "claude",
      prompt: "go",
      cwd: temp.paths.workspace,
      model: null,
      effort: "default",
      mode: "write",
      timeoutMs: 30_000,
      profile: "review_before_write",
      skillSlug: "recall",
      status: "queued",
    } as never);
    const credential = ctx.runApiAccessFor(run, "write")!.token;
    for (const [method, url, payload] of [
      ["POST", "/api/memory/notes", { title: "pelo agente" }],
      ["PUT", "/api/memory/notes", { path: made.body.path, content: "x", baseVersion: made.body.version }],
      ["GET", `/api/memory/note?p=${encodeURIComponent(made.body.path)}`, undefined],
    ] as const) {
      const res = await app.inject({
        method,
        url,
        headers: asDevice(credential),
        ...(payload ? { payload } : {}),
      });
      expect([res.statusCode, (res.json() as any).error.code], `${method} ${url}`).toEqual([
        403,
        "forbidden",
      ]);
    }
    expect(fs.existsSync(path.join(memory(), "notes", "pelo-agente.md"))).toBe(false);

    const reader = device(["content"]);
    const ok = await read(made.body.path, asDevice(reader));
    expect(ok.status).toBe(200);
    const monitorOnly = device(["monitor"]);
    const refused = await read(made.body.path, asDevice(monitorOnly));
    expect([refused.status, errorCode(refused)]).toEqual([403, "scope_required"]);
  });

  it("C15 a created or saved note is indexed by a pass over its path only and then found by search", async () => {
    await ctx.indexer.indexAllAsync();
    const finished: unknown[] = [];
    const stop = ctx.events.subscribe((e) => {
      if (e.type === "index.finished") finished.push(e);
    });
    const made = await create({ title: "Indexada", content: "palavraunicaxyz está aqui" });
    await ctx.indexer.requestIndexPaths([]);
    for (let i = 0; i < 50 && finished.length === 0; i++) await new Promise((r) => setTimeout(r, 20));
    expect(finished.length).toBeGreaterThanOrEqual(1);
    const hit = await app.inject({ url: "/api/memory/search?q=palavraunicaxyz", headers: owner() });
    expect((hit.json() as Array<{ path: string }>).map((h) => h.path)).toEqual([made.body.path]);

    finished.length = 0;
    const saved = await save({
      path: made.body.path,
      content: "# Indexada\n\noutrapalavraqwe agora\n",
      baseVersion: made.body.version,
    });
    expect(saved.status).toBe(200);
    for (let i = 0; i < 50 && finished.length === 0; i++) await new Promise((r) => setTimeout(r, 20));
    const again = await app.inject({ url: "/api/memory/search?q=outrapalavraqwe", headers: owner() });
    expect((again.json() as Array<{ path: string }>).map((h) => h.path)).toEqual([made.body.path]);
    const gone = await app.inject({ url: "/api/memory/search?q=palavraunicaxyz", headers: owner() });
    expect(gone.json()).toEqual([]);
    // the pass read only this file: a file written behind its back is not in the index yet
    const stray = path.join(memory(), "notes", "fora-do-indice.md");
    fs.writeFileSync(stray, "# stray\n\npalavraperdidaabc\n");
    await create({ title: "Outra" });
    await ctx.indexer.requestIndexPaths([]);
    for (let i = 0; i < 25; i++) await new Promise((r) => setTimeout(r, 20));
    const missed = await app.inject({ url: "/api/memory/search?q=palavraperdidaabc", headers: owner() });
    expect(missed.json()).toEqual([]);
    stop();
  });
});
