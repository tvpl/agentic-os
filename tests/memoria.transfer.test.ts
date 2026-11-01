import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { API, routeKey } from "@mordomo/contracts";
import { EXPECTED_ROUTE_SCOPES } from "./helpers/routeScopes.js";
import { code, memoriaWorld, type Json, type MemoriaWorld } from "./helpers/memoriaWorld.js";
import { movingClock } from "./helpers/movingClock.js";

/**
 * .specs/features/cerebro-memoria-confiavel S5 (batch B2): exporting a folder to `artifacts/exports/` with its manifest
 * (C132, door 14), the copy limits and the suffixes (C133, G20), the export's refusals (C134), importing a folder into a
 * new `memory/notes/<folder>/` with an `import` version of each note (C135, door 15), its refusals (C136, C137, G21) and
 * who may call the two (C138). The export folder's local minute under a pinned zone is in `memoria.localday.test.ts`.
 */

const MiB = 1024 * 1024;
let w: MemoriaWorld;
beforeAll(async () => {
  w = await memoriaWorld("mordomo-memoria-transfer-");
}, 60_000);
afterAll(async () => {
  await w.close();
});
afterEach(() => {
  vi.useRealTimers();
});

const exportsRoot = () => path.join(w.home, "artifacts", "exports");
const exportsNow = () => (fs.existsSync(exportsRoot()) ? fs.readdirSync(exportsRoot()).sort() : []);
const hex = (bytes: Buffer) => crypto.createHash("sha256").update(bytes).digest("hex");
/** Every file under `dir`, relative with `/`, sorted. */
const filesUnder = (dir: string): string[] =>
  fs
    .readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((e) => e.isFile())
    .map((e) => path.relative(dir, path.join(e.parentPath, e.name)).split(path.sep).join("/"))
    .sort();
/** The clock's reading just before and just after the latest `exportAt` (the export's "now" lies between). */
let window: [number, number] = [0, 0];
/**
 * Export `folder` with `Date.now()` at `at` and moving (`movingClock`: an index pass waits for the clock to move, so a
 * frozen `Date` would hang it), within the same minute.
 */
const exportAt = async (folder: string, at: number, headers?: Record<string, string>) => {
  const clock = movingClock(at);
  try {
    const from = Date.now();
    const res = await w.call("POST", "/api/memory/export", { folder }, headers);
    window = [from, Date.now()];
    return res;
  } finally {
    clock.restore();
  }
};
const pad = (n: number) => String(n).padStart(2, "0");
/** The local minute as the export folder spells it (door 14). */
const minute = (at: number) => {
  const d = new Date(at);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`;
};
/** A folder of `n` small files (and `folders` empty folders, and a chain `depth` deep) under `dir`. */
function tree(dir: string, shape: { files?: number; folders?: number; depth?: number; bytes?: number[] }) {
  fs.mkdirSync(dir, { recursive: true });
  for (let i = 0; i < (shape.files ?? 0); i++) fs.writeFileSync(path.join(dir, `f${i}.txt`), "x");
  for (let i = 0; i < (shape.folders ?? 0); i++) fs.mkdirSync(path.join(dir, `d${i}`));
  if (shape.depth) {
    const deep = path.join(dir, ...Array.from({ length: shape.depth }, (_, i) => `n${i}`));
    fs.mkdirSync(deep, { recursive: true });
    fs.writeFileSync(path.join(deep, "fundo.md"), "# Fundo\n");
  }
  (shape.bytes ?? []).forEach((size, i) =>
    fs.writeFileSync(path.join(dir, `b${i}.bin`), Buffer.alloc(size, 7)),
  );
  return dir;
}

// ---- export (door 14) ---------------------------------------------------------------------------------------------

describe("C132 an export and its manifest", () => {
  it("C132 the folder is copied to artifacts/exports/projetos-<local minute> with mordomo-export.json listing path, sha256 and size of each copied file; .env is neither copied nor listed; the same minute again is -2; an indexed folder and a one-file folder export the same way", async () => {
    const projetos = path.join(w.memory, "notes", "projetos");
    const files: Record<string, string> = {
      "plano.md": "# Plano\r\n\r\nSem quebra final",
      "sub/tarefa.md": "---\ntype: tarefa\n---\n# Tarefa\n",
      "anexo.txt": "anexo\n",
    };
    for (const [rel, text] of Object.entries(files)) w.put(path.join(projetos, ...rel.split("/")), text);
    w.put(path.join(projetos, ".env"), "TOKEN=segredo\n");
    const at = Date.UTC(2026, 9, 15, 13, 7, 0);
    const res = await exportAt(projetos, at);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const out = path.join(fs.realpathSync(w.home), "artifacts", "exports", `projetos-${minute(at)}`);
    const bytes = Object.values(files).reduce((n, t) => n + Buffer.byteLength(t), 0);
    expect(res.body).toEqual({ path: out, files: 3, bytes });
    // the files byte for byte, the .env left behind
    expect(filesUnder(out)).toEqual(["anexo.txt", "mordomo-export.json", "plano.md", "sub/tarefa.md"]);
    for (const [rel, text] of Object.entries(files))
      expect(fs.readFileSync(path.join(out, ...rel.split("/"))).equals(Buffer.from(text)), rel).toBe(true);
    const manifest = JSON.parse(fs.readFileSync(path.join(out, "mordomo-export.json"), "utf8")) as Json;
    const listed = (manifest.files as Json[]).slice().sort((a, b) => String(a.path).localeCompare(b.path));
    expect(manifest.exportedAt).toBeGreaterThanOrEqual(window[0]);
    expect(manifest.exportedAt).toBeLessThanOrEqual(window[1]);
    expect(window[1] - at).toBeLessThan(60_000);
    expect({ ...manifest, files: listed }).toEqual({
      v: 1,
      exportedAt: manifest.exportedAt,
      source: fs.realpathSync(projetos),
      files: ["anexo.txt", "plano.md", "sub/tarefa.md"].map((rel) => {
        const read = fs.readFileSync(path.join(out, ...rel.split("/")));
        return { path: rel, sha256: hex(read), size: read.byteLength };
      }),
    });
    expect(JSON.stringify(manifest)).not.toContain(".env");

    // the same minute again: -2
    const again = await exportAt(projetos, at + 20_000);
    expect(again.status, JSON.stringify(again.body)).toBe(200);
    expect(again.body.path).toBe(`${out}-2`);
    expect(filesUnder(`${out}-2`)).toEqual(filesUnder(out));

    // an enabled indexed folder exports the same way
    const vault = w.indexedRoot("vault-c132");
    w.put(path.join(vault, "nota.md"), "# Nota do vault\n");
    w.put(path.join(vault, "outra.md"), "# Outra\n");
    const indexed = await exportAt(vault, at);
    expect(indexed.status, JSON.stringify(indexed.body)).toBe(200);
    expect(path.basename(indexed.body.path as string)).toBe(`${path.basename(vault)}-${minute(at)}`);
    expect(indexed.body.files).toBe(2);
    expect(filesUnder(indexed.body.path as string)).toEqual(["mordomo-export.json", "nota.md", "outra.md"]);

    // a one-file folder: one entry (L-050)
    const one = path.join(w.memory, "notes", "uma");
    w.put(path.join(one, "so.md"), "# Só\n");
    const single = await exportAt(one, at);
    expect(single.status, JSON.stringify(single.body)).toBe(200);
    expect(single.body).toEqual({
      path: expect.stringMatching(/uma-\d{4}-\d{2}-\d{2}-\d{4}$/),
      files: 1,
      bytes: 6,
    });
    const m = JSON.parse(
      fs.readFileSync(path.join(single.body.path as string, "mordomo-export.json"), "utf8"),
    );
    expect(m.files).toEqual([{ path: "so.md", sha256: hex(Buffer.from("# Só\n")), size: 6 }]);
  });
});

describe("C133 the copy limits and the suffixes", () => {
  const at = Date.UTC(2026, 9, 16, 15, 0, 0);
  const refused = async (name: string, shape: Parameters<typeof tree>[1], reason: string) => {
    const dir = tree(path.join(w.memory, "notes", name), shape);
    const before = exportsNow();
    const res = await exportAt(dir, at);
    expect(code(res), name).toEqual([413, "folder_too_large"]);
    expect(String(res.body.error.message), name).toContain(reason);
    expect(exportsNow(), `${name} leaves nothing`).toEqual(before);
  };
  const accepted = async (name: string, shape: Parameters<typeof tree>[1], files: number) => {
    const dir = tree(path.join(w.memory, "notes", name), shape);
    const res = await exportAt(dir, at);
    expect(res.status, `${name} ${JSON.stringify(res.body).slice(0, 300)}`).toBe(200);
    expect(res.body.files, name).toBe(files);
    fs.rmSync(res.body.path as string, { recursive: true });
  };

  it("C133 2 001 files, 501 folders, 64 MiB + 1 byte, 13 levels and one file of 8 MiB + 1 byte are each 413 folder_too_large for their own reason, and leave no folder under artifacts/exports/", async () => {
    await refused("lim-files", { files: 2001 }, "more than 2000 files");
    await refused("lim-folders", { folders: 501 }, "more than 500 folders");
    await refused("lim-total", { bytes: [...Array(8).fill(8 * MiB), 1] }, `more than ${64 * MiB} bytes`);
    await refused("lim-depth", { depth: 13 }, "more than 12 levels deep");
    await refused("lim-file", { bytes: [8 * MiB + 1] }, `larger than ${8 * MiB} bytes`);
  }, 120_000);

  it("C133 the accepted edges export: exactly 2 000 files, 500 folders, 64 MiB and 12 levels", async () => {
    await accepted("edge-files", { files: 2000 }, 2000);
    await accepted("edge-folders", { folders: 500 }, 0);
    await accepted("edge-total", { bytes: Array(8).fill(8 * MiB) }, 8);
    await accepted("edge-depth", { depth: 12 }, 1);
  }, 120_000);

  it("C133 with the name and -2 to -99 taken, the export answers 409 exists and copies nothing (G20)", async () => {
    const dir = path.join(w.memory, "notes", "cheia");
    w.put(path.join(dir, "a.md"), "# A\n");
    const name = `cheia-${minute(at)}`;
    fs.mkdirSync(path.join(exportsRoot(), name), { recursive: true });
    for (let n = 2; n <= 98; n++) fs.mkdirSync(path.join(exportsRoot(), `${name}-${n}`));
    // -99 is still free: it is taken
    const last = await exportAt(dir, at);
    expect(last.status, JSON.stringify(last.body)).toBe(200);
    expect(path.basename(last.body.path as string)).toBe(`${name}-99`);
    const before = exportsNow();
    const full = await exportAt(dir, at);
    expect(code(full)).toEqual([409, "exists"]);
    expect(exportsNow()).toEqual(before);
    expect(exportsNow().filter((n) => n.startsWith(name))).toHaveLength(99);
  });
});

describe("C134 what an export refuses", () => {
  it("C134 outside the home and every indexed folder 403 forbidden_path; the home 403 forbidden_path; a folder that is not there 404 not_found; a file 400 validation; none leaves anything under artifacts/exports/", async () => {
    const outside = w.outside("fora-c134");
    w.put(path.join(outside, "a.md"), "# Fora\n");
    const file = w.put(path.join(w.memory, "notes", "arquivo-c134.md"), "# Arquivo\n");
    const before = exportsNow();
    const at = Date.UTC(2026, 9, 17, 10, 0, 0);
    expect(code(await exportAt(outside, at))).toEqual([403, "forbidden_path"]);
    expect(code(await exportAt(w.home, at))).toEqual([403, "forbidden_path"]);
    expect(code(await exportAt(path.join(w.memory, "notes", "nao-existe"), at))).toEqual([404, "not_found"]);
    expect(code(await exportAt(file, at))).toEqual([400, "validation"]);
    expect(exportsNow()).toEqual(before);
  });
});

describe("the exports are never served to a device (G11, over a real export)", () => {
  it("a device lists, finds and reads nothing of a real export, its manifest included; the owner sees it", async () => {
    const dir = path.join(w.memory, "notes", "servida");
    w.put(path.join(dir, "exportada.md"), "# Exportada\n");
    const res = await exportAt(dir, Date.UTC(2026, 9, 18, 9, 0, 0));
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const note = path.join(res.body.path as string, "exportada.md");
    const manifest = path.join(res.body.path as string, "mordomo-export.json");
    const device = w.device(["content", "monitor", "run", "approve"]);
    const owner = await w.call("GET", "/api/artifacts/list");
    expect(JSON.stringify(owner.body)).toContain(note);
    for (const url of ["/api/artifacts/list", "/api/artifacts/recent"]) {
      const seen = await w.call("GET", url, undefined, device);
      expect(seen.status, url).toBe(200);
      expect(JSON.stringify(seen.body), url).not.toContain("exports");
    }
    for (const p of [note, manifest])
      for (const route of ["file", "raw"]) {
        const read = await w.call(
          "GET",
          `/api/artifacts/${route}?p=${encodeURIComponent(p)}`,
          undefined,
          device,
        );
        expect(read.status, `${route} ${p}`).not.toBe(200);
        expect(JSON.stringify(read.body)).not.toContain("Exportada");
      }
  });
});

// ---- import (door 15) ---------------------------------------------------------------------------------------------

const versionsOf = async (rel: string) =>
  (await w.call("GET", `/api/memory/history?path=${encodeURIComponent(rel)}`)).body.versions as Json[];
const allVersions = async () =>
  (await w.call("GET", "/api/memory/history?limit=100")).body.versions as Json[];

describe("C135 an import", () => {
  it("C135 an indexed folder's vault lands in memory/notes/vault-antigo byte for byte, skipped names the .env and the link, each note has one import version by the owner; 'Vault Antigo!' and no folder follow the slug rule; a one-file source imports one", async () => {
    const root = w.indexedRoot("indexado-c135");
    const vault = path.join(root, "vault");
    // non-canonical bytes (L-025): CRLF, no final newline, a BOM, front matter as written
    const notes: Record<string, string> = {
      "a.md": "﻿# A\r\n\r\nlinha  com  espaços",
      "pasta/b.md": "---\ntags: [x,y]\n---\n#B sem espaço\n\n\n",
    };
    for (const [rel, text] of Object.entries(notes)) w.put(path.join(vault, ...rel.split("/")), text);
    w.put(path.join(vault, "dados.csv"), "a,b\n1,2\n");
    w.put(path.join(vault, ".env"), "TOKEN=segredo\n");
    fs.symlinkSync(path.join(root, "fora.md"), path.join(vault, "atalho.md"));
    const res = await w.call("POST", "/api/memory/import", { sourceDir: vault, folder: "vault-antigo" });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const target = path.join(fs.realpathSync(w.memory), "notes", "vault-antigo");
    const bytes = [...Object.values(notes), "a,b\n1,2\n"].reduce((n, t) => n + Buffer.byteLength(t), 0);
    expect({ ...res.body, skipped: (res.body.skipped as string[]).slice().sort() }).toEqual({
      folder: target,
      files: 3,
      bytes,
      skipped: [".env", "atalho.md"],
    });
    expect(filesUnder(target)).toEqual(["a.md", "dados.csv", "pasta/b.md"]);
    for (const [rel, text] of Object.entries(notes)) {
      expect(fs.readFileSync(path.join(target, ...rel.split("/"))).equals(Buffer.from(text)), rel).toBe(true);
      const versions = await versionsOf(`notes/vault-antigo/${rel}`);
      expect(
        versions.map((v) => [v.origin, v.author, v.size]),
        rel,
      ).toEqual([["import", "owner", Buffer.byteLength(text)]]);
    }
    expect(await versionsOf("notes/vault-antigo/dados.csv")).toEqual([]);

    // "Vault Antigo!" by the slug rule
    fs.rmSync(target, { recursive: true });
    const named = await w.call("POST", "/api/memory/import", { sourceDir: vault, folder: "Vault Antigo!" });
    expect(named.status, JSON.stringify(named.body)).toBe(200);
    expect(named.body.folder).toBe(target);

    // no folder: the source's own name, by the slug rule
    const meu = path.join(root, "Meu Vault");
    w.put(path.join(meu, "c.md"), "# C\n");
    const bare = await w.call("POST", "/api/memory/import", { sourceDir: meu });
    expect(bare.status, JSON.stringify(bare.body)).toBe(200);
    expect(bare.body.folder).toBe(path.join(fs.realpathSync(w.memory), "notes", "meu-vault"));

    // a one-file source imports one (L-050)
    const one = path.join(root, "uma");
    w.put(path.join(one, "so.md"), "# Só\n");
    const single = await w.call("POST", "/api/memory/import", { sourceDir: one, folder: "uma-nota" });
    expect(single.status, JSON.stringify(single.body)).toBe(200);
    expect(single.body).toEqual({
      folder: path.join(fs.realpathSync(w.memory), "notes", "uma-nota"),
      files: 1,
      bytes: 6,
      skipped: [],
    });
    expect((await versionsOf("notes/uma-nota/so.md")).map((v) => v.origin)).toEqual(["import"]);
  });
});

describe("C136 an import over a folder that exists", () => {
  it("C136 memory/notes/vault-antigo/ existing answers 409 exists, and its listing and the history are unchanged", async () => {
    const target = path.join(w.memory, "notes", "existente");
    w.put(path.join(target, "minha.md"), "# Minha\n");
    const root = w.indexedRoot("indexado-c136");
    w.put(path.join(root, "existente", "minha.md"), "# Outra\n");
    w.put(path.join(root, "existente", "nova.md"), "# Nova\n");
    const listing = filesUnder(target);
    const history = await allVersions();
    const res = await w.call("POST", "/api/memory/import", {
      sourceDir: path.join(root, "existente"),
      folder: "existente",
    });
    expect(code(res)).toEqual([409, "exists"]);
    expect(filesUnder(target)).toEqual(listing);
    expect(fs.readFileSync(path.join(target, "minha.md"), "utf8")).toBe("# Minha\n");
    expect(await allVersions()).toEqual(history);
  });
});

describe("C137 what an import refuses", () => {
  it("C137 a source inside memory/ 400 validation; outside the home and every indexed folder 403 forbidden_path; not there 404 not_found; past the copy limits 413 folder_too_large with no memory/notes/<folder>/ and no version (G21); each copies nothing", async () => {
    const notes = path.join(w.memory, "notes");
    const inside = path.join(notes, "dentro");
    w.put(path.join(inside, "a.md"), "# Dentro\n");
    const outside = w.outside("fora-c137");
    w.put(path.join(outside, "a.md"), "# Fora\n");
    const root = w.indexedRoot("indexado-c137");
    const big = tree(path.join(root, "grande"), { files: 2001 });
    w.put(path.join(big, "nota.md"), "# Nota\n");
    const listing = () => fs.readdirSync(notes).sort();
    const before = listing();
    const history = await allVersions();
    const ask = (sourceDir: string, folder: string) =>
      w.call("POST", "/api/memory/import", { sourceDir, folder });
    expect(code(await ask(inside, "c137-dentro"))).toEqual([400, "validation"]);
    expect(code(await ask(outside, "c137-fora"))).toEqual([403, "forbidden_path"]);
    expect(code(await ask(path.join(root, "nao-existe"), "c137-nada"))).toEqual([404, "not_found"]);
    const over = await ask(big, "c137-grande");
    expect(code(over)).toEqual([413, "folder_too_large"]);
    expect(fs.existsSync(path.join(notes, "c137-grande"))).toBe(false);
    expect(listing()).toEqual(before);
    expect(await allVersions()).toEqual(history);
  }, 60_000);
});

describe("C138 who may export and import", () => {
  it("C138 a device with every scope gets 403 owner_only and a run's credential 403 forbidden from both, and nothing is written; the API table has both with scope owner and their named errors; they are in EXPECTED_ROUTE_SCOPES and docs/security.md", async () => {
    const dir = path.join(w.memory, "notes", "c138");
    w.put(path.join(dir, "a.md"), "# A\n");
    const root = w.indexedRoot("indexado-c138");
    w.put(path.join(root, "fonte", "b.md"), "# B\n");
    const device = w.device(["content", "monitor", "run", "approve"]);
    const run = w.run("write").headers;
    const before = exportsNow();
    for (const [who, headers, want] of [
      ["device", device, "owner_only"],
      ["run", run, "forbidden"],
    ] as const) {
      expect(code(await w.call("POST", "/api/memory/export", { folder: dir }, headers)), who).toEqual([
        403,
        want,
      ]);
      expect(
        code(
          await w.call(
            "POST",
            "/api/memory/import",
            { sourceDir: path.join(root, "fonte"), folder: "c138-importada" },
            headers,
          ),
        ),
        who,
      ).toEqual([403, want]);
    }
    expect(exportsNow()).toEqual(before);
    expect(fs.existsSync(path.join(w.memory, "notes", "c138-importada"))).toBe(false);

    const entry = (k: string) => Object.values(API).find((e) => routeKey(e) === k)!;
    const own = (k: string) => [...(entry(k).errors ?? [])].map((e) => `${e.status} ${e.code}`).sort();
    expect([entry("POST /api/memory/export").scope, entry("POST /api/memory/import").scope]).toEqual([
      "owner",
      "owner",
    ]);
    expect(own("POST /api/memory/export")).toEqual([
      "403 forbidden_path",
      "404 not_found",
      "409 exists",
      "413 folder_too_large",
    ]);
    expect(own("POST /api/memory/import")).toEqual([
      "403 forbidden_path",
      "404 not_found",
      "409 exists",
      "413 folder_too_large",
    ]);
    expect(EXPECTED_ROUTE_SCOPES["POST /api/memory/export"]).toBe("owner");
    expect(EXPECTED_ROUTE_SCOPES["POST /api/memory/import"]).toBe("owner");
    const security = fs.readFileSync(path.join(import.meta.dirname, "..", "docs", "security.md"), "utf8");
    const ownerRow = security.split("\n").find((l) => l.startsWith("| `owner` (")) ?? "";
    expect(ownerRow).toContain("`POST /api/memory/export`");
    expect(ownerRow).toContain("`POST /api/memory/import`");
  });
});
