import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppContext } from "../apps/api/src/context.js";
import { httpApi, mordomoTools } from "../apps/api/src/mcp/mordomo.js";
import { CURRENT_SETTINGS_VERSION } from "../core/src/config/schema.js";
import { makeTempHome } from "./helpers.js";
import { notesViewWorld, type Json, type NotesViewWorld } from "./helpers/notesViewWorld.js";

/**
 * .specs/features/cerebro-vista-notas, batch A, S3: a new note's `folder` (door 2) and the fixed structure (door 5)
 * through the API, the built CLI and the MCP tool over real HTTP, and the setting that turns it on. The disk is read
 * back with `fs`; the rules are also proven at their own layer in `notesview.layer.test.ts`.
 */

const POSIX = process.platform !== "win32";
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CLI = path.join(repoRoot, "apps", "api", "dist", "cli.js");
const distReady = fs.existsSync(CLI);
if (!distReady) console.warn(`[notesview.create] the CLI proof needs ${CLI}: run npm run build:server`);

let w: NotesViewWorld;
let notesDir: string;

beforeAll(async () => {
  w = await notesViewWorld("mordomo-notes-create-");
  notesDir = path.join(w.memory, "notes");
  fs.mkdirSync(notesDir, { recursive: true });
});
afterAll(async () => {
  await w?.close();
});

const create = (body: Json) => w.call("POST", "/api/memory/notes", body);
/** Every file and folder under memory/notes/ (and the targets a test names), to see that nothing was made. */
function listing(...also: string[]): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      out.push(full);
      if (entry.isDirectory()) walk(full);
    }
  };
  for (const dir of [notesDir, ...also]) if (fs.existsSync(dir)) walk(dir);
  return out.sort();
}
function fixed(on: boolean): void {
  w.update((s) => {
    s.memory.notes.fixedStructure = on;
  });
}

describe("S3 a folder for a new note", () => {
  it("C24 POST /api/memory/notes with folder clientes/acme answers 201 at memory/notes/clientes/acme/proposta.md, making both folders", async () => {
    expect(fs.existsSync(path.join(notesDir, "clientes"))).toBe(false);
    const res = await create({ title: "Proposta", folder: "clientes/acme" });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const file = path.join(w.memory, "notes", "clientes", "acme", "proposta.md");
    expect(res.body.path).toBe(file);
    expect(fs.readFileSync(file, "utf8")).toBe("# Proposta\n\n");
    expect(fs.statSync(path.join(notesDir, "clientes")).isDirectory()).toBe(true);
  });

  it.skipIf(!POSIX)(
    "C25 a folder of 5 levels, a//b, ../x, .., !!! and /etc are 400 validation; a folder that is a link is 403 forbidden_path; a content past the limit with a new folder is 413 note_too_large; nothing is made",
    async () => {
      const target = w.outside("c25-alvo");
      fs.symlinkSync(target, path.join(notesDir, "c25-link"));
      const before = listing(target, path.join(w.memory, "x"));
      for (const folder of ["a/b/c/d/e", "a//b", "../x", "..", "!!!", "/etc"]) {
        const res = await create({ title: "Recusada", folder });
        expect(res.status, folder).toBe(400);
        expect(res.body.error.code, folder).toBe("validation");
      }
      for (const folder of ["c25-link", "c25-link/nova"]) {
        const res = await create({ title: "Pelo link", folder });
        expect(res.status, folder).toBe(403);
        expect(res.body.error.code, folder).toBe("forbidden_path");
      }
      const big = await create({
        title: "Grande",
        folder: "c25-grande",
        content: "x".repeat(1024 * 1024 + 10),
      });
      expect(big.status).toBe(413);
      expect(big.body.error.code).toBe("note_too_large");
      expect(listing(target, path.join(w.memory, "x"))).toEqual(before);
      expect(fs.existsSync(path.join(notesDir, "c25-grande"))).toBe(false);
      expect(fs.readdirSync(target)).toEqual([]);
    },
  );

  it("C83 area and folder together answer 400 validation and nothing is written; folder alone gives the folder and area alone the area's folder, as before", async () => {
    fixed(false);
    w.update((s) => {
      s.areas = [...s.areas, "Área C83"];
    });
    const before = listing();
    const both = await create({ title: "Ambas", area: "Área C83", folder: "c83-pasta" });
    expect(both.status, JSON.stringify(both.body)).toBe(400);
    expect(both.body.error.code).toBe("validation");
    expect(listing()).toEqual(before);
    const inFolder = await create({ title: "Só pasta", folder: "c83-pasta" });
    expect(inFolder.status, JSON.stringify(inFolder.body)).toBe(201);
    expect(path.dirname(inFolder.body.path)).toBe(path.join(notesDir, "c83-pasta"));
    const inArea = await create({ title: "Só área", area: "Área C83" });
    expect(inArea.status, JSON.stringify(inArea.body)).toBe(201);
    expect(path.dirname(inArea.body.path)).toBe(path.join(notesDir, "area-c83"));
  });

  it("C26 with fixedStructure on, a folder that does not exist, an area whose folder does not exist and neither answer 409 structure_fixed and write nothing; a folder that exists answers 201", async () => {
    w.update((s) => {
      s.areas = [...s.areas, "Área C26"];
    });
    fs.mkdirSync(path.join(notesDir, "c26-existe"), { recursive: true });
    fixed(true);
    try {
      const before = listing();
      for (const [what, body] of [
        ["a new folder", { title: "Na nova", folder: "c26-nova" }],
        ["an area without its folder", { title: "Na área", area: "Área C26" }],
        ["straight into memory/notes/", { title: "Solta" }],
      ] as const) {
        const res = await create(body);
        expect(res.status, what).toBe(409);
        expect(res.body.error.code, what).toBe("structure_fixed");
      }
      expect(listing()).toEqual(before);
      const ok = await create({ title: "Dentro", folder: "c26-existe" });
      expect(ok.status, JSON.stringify(ok.body)).toBe(201);
      expect(ok.body.path).toBe(path.join(notesDir, "c26-existe", "dentro.md"));
      expect(fs.existsSync(ok.body.path)).toBe(true);
    } finally {
      fixed(false);
    }
  });

  it.skipIf(!distReady)(
    "C27 with fixedStructure on, mordomo note new Solta prints structure_fixed: on stderr, exits 1 and writes nothing, and the MCP tool note_create answers an error naming structure_fixed",
    async () => {
      const { paths, cleanup } = makeTempHome("mordomo-notes-create-cli-");
      try {
        const setup = new AppContext(paths.home);
        const s = setup.settings();
        s.memory.notes.fixedStructure = true;
        setup.settingsStore.save(s);
        setup.close();
        const res = spawnSync(process.execPath, [CLI, "note", "new", "Solta"], {
          cwd: repoRoot,
          encoding: "utf8",
          timeout: 60_000,
          env: {
            ...process.env,
            MORDOMO_HOME: paths.home,
            NO_COLOR: "1",
            FORCE_COLOR: "0",
            PATH: path.dirname(process.execPath),
          },
        });
        expect(res.status, res.stderr).toBe(1);
        expect(res.stderr).toContain("structure_fixed:");
        expect(fs.existsSync(path.join(paths.memory, "notes", "solta.md"))).toBe(false);
        const notes = path.join(paths.memory, "notes");
        expect(fs.existsSync(notes) ? fs.readdirSync(notes) : []).toEqual([]);
      } finally {
        cleanup();
      }

      fixed(true);
      try {
        await w.app.listen({ port: 0, host: "127.0.0.1" });
        const addr = w.app.server.address();
        const port = typeof addr === "object" && addr ? addr.port : 0;
        const tools = mordomoTools(httpApi(`http://127.0.0.1:${port}`, w.ctx.token()));
        const tool = tools.find((t) => t.name === "note_create")!;
        const before = listing();
        await expect(tool.handler({ title: "Solta" })).rejects.toThrow(/structure_fixed/);
        expect(listing()).toEqual(before);
        expect(fs.existsSync(path.join(notesDir, "solta.md"))).toBe(false);
      } finally {
        fixed(false);
      }
    },
    120_000,
  );

  it('C28 memory.notes.fixedStructure reads false without it and with "sim"; PUT /api/settings {memory:{notes:{fixedStructure:true}}} stores true and keeps the journal budget, the agent stance and the embeddings', async () => {
    for (const [what, memory] of [
      ["without it", {}],
      ['as "sim"', { notes: { fixedStructure: "sim" } }],
    ] as const) {
      const { paths, cleanup } = makeTempHome("mordomo-notes-create-settings-");
      try {
        fs.writeFileSync(paths.settingsFile, JSON.stringify({ version: CURRENT_SETTINGS_VERSION, memory }));
        const ctx = new AppContext(paths.home);
        try {
          expect(ctx.settings().memory.notes.fixedStructure, what).toBe(false);
        } finally {
          ctx.close();
        }
      } finally {
        cleanup();
      }
    }

    w.update((s) => {
      s.memory.journalBudgetTokens = 2345;
      s.memory.agentStance = "contest-conflicts";
      s.memory.embeddings = { enabled: false, provider: "hash", model: "modelo-c28", sendRemote: false };
    });
    const before = w.ctx.settings().memory;
    const res = await w.call("PUT", "/api/settings", { memory: { notes: { fixedStructure: true } } });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const stored = JSON.parse(fs.readFileSync(w.ctx.paths.settingsFile, "utf8")) as Json;
    expect(stored.memory.notes.fixedStructure).toBe(true);
    const after = w.ctx.settings().memory;
    expect(after.notes.fixedStructure).toBe(true);
    expect(after.journalBudgetTokens).toBe(2345);
    expect(after.agentStance).toBe("contest-conflicts");
    expect(after.embeddings).toEqual(before.embeddings);
    expect(after.embeddings.model).toBe("modelo-c28");
    fixed(false);
  });
});
