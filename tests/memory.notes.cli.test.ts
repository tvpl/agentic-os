import { afterAll, beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import type { FastifyInstance } from "fastify";
import { AppContext } from "../apps/api/src/context.js";
import { buildServer } from "../apps/api/src/server.js";
import { httpApi, mordomoTools } from "../apps/api/src/mcp/mordomo.js";
import { makeTempHome } from "./helpers.js";

/**
 * .specs/features/cerebro-v2, S1: the notes from the command line (the BUILT cli, a real home) and from an MCP
 * client (the tools over real HTTP against a real server).
 */

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CLI = path.join(repoRoot, "apps", "api", "dist", "cli.js");
const distReady = fs.existsSync(CLI);
if (!distReady)
  console.warn(`[memory.notes.cli] skipping the CLI proof: ${CLI} is missing, run npm run build:server`);

function mordomo(home: string, args: string[], input?: string) {
  const res = spawnSync(process.execPath, [CLI, ...args], {
    cwd: repoRoot,
    encoding: "utf8",
    timeout: 60_000,
    ...(input !== undefined ? { input } : {}),
    env: {
      ...process.env,
      MORDOMO_HOME: home,
      NO_COLOR: "1",
      FORCE_COLOR: "0",
      PATH: path.dirname(process.execPath),
    },
  });
  return { status: res.status, stdout: res.stdout ?? "", stderr: res.stderr ?? "" };
}

describe.skipIf(!distReady)("C16 mordomo note", () => {
  it("C16 new, show and save print the path and the version, and a stale --base exits 1 with edit_conflict", () => {
    const { paths, cleanup } = makeTempHome("mordomo-note-cli-");
    try {
      const made = mordomo(paths.home, ["note", "new", "Ideia", "de", "projeto", "--tag", "ideia"]);
      expect(made.status, made.stderr).toBe(0);
      const [file, version] = made.stdout.trim().split("\n");
      expect(file).toBe(path.join(paths.memory, "notes", "ideia-de-projeto.md"));
      expect(version).toMatch(/^sha256:[0-9a-f]{64}$/);
      expect(fs.readFileSync(file!, "utf8")).toBe("# Ideia de projeto\n\n");

      const shown = mordomo(paths.home, ["note", "show", file!]);
      expect(shown.status, shown.stderr).toBe(0);
      expect(shown.stdout).toBe("# Ideia de projeto\n\n");
      expect(shown.stderr).toContain(version!);
      const json = JSON.parse(mordomo(paths.home, ["note", "show", file!, "--json"]).stdout) as {
        version: string;
        content: string;
        editable: boolean;
      };
      expect(json).toMatchObject({ version, content: "# Ideia de projeto\n\n", editable: true });

      const saved = mordomo(
        paths.home,
        ["note", "save", file!, "--base", version!],
        "# Ideia de projeto\n\nmais\n",
      );
      expect(saved.status, saved.stderr).toBe(0);
      const [savedPath, savedVersion] = saved.stdout.trim().split("\n");
      expect(savedPath).toBe(file);
      expect(savedVersion).not.toBe(version);
      expect(fs.readFileSync(file!, "utf8")).toBe("# Ideia de projeto\n\nmais\n");

      // the version named is the old one now
      const stale = mordomo(paths.home, ["note", "save", file!, "--base", version!], "perdido\n");
      expect(stale.status).toBe(1);
      expect(stale.stderr).toContain("edit_conflict");
      expect(fs.readFileSync(file!, "utf8")).toBe("# Ideia de projeto\n\nmais\n");

      // the index learned about the notes (the command indexes the path it wrote)
      const found = mordomo(paths.home, ["recall", "mais", "--json"]);
      expect(found.status, found.stderr).toBe(0);

      // usage errors
      expect(mordomo(paths.home, ["note"]).status).toBe(2);
      expect(mordomo(paths.home, ["note", "new"]).status).toBe(2);
      expect(mordomo(paths.home, ["note", "save", file!], "x").status).toBe(2);
      expect(mordomo(paths.home, ["note", "dance"]).status).toBe(2);
      const outside = mordomo(
        paths.home,
        ["note", "save", path.join(paths.config, "token"), "--base", version!],
        "x",
      );
      expect(outside.status).toBe(1);
      expect(outside.stderr).toMatch(/forbidden|outside|private|config/i);
    } finally {
      cleanup();
    }
  }, 120_000);
});

describe("C17 the MCP note tools", () => {
  let temp: ReturnType<typeof makeTempHome>;
  let ctx: AppContext;
  let app: FastifyInstance;
  let tools: ReturnType<typeof mordomoTools>;
  const run = async (name: string, args: Record<string, unknown>): Promise<string> => {
    const tool = tools.find((t) => t.name === name);
    if (!tool) throw new Error(`no tool ${name}`);
    return tool.handler(args);
  };

  beforeAll(async () => {
    temp = makeTempHome("mordomo-note-mcp-");
    ctx = new AppContext(temp.paths.home);
    app = await buildServer(ctx);
    await app.listen({ port: 0, host: "127.0.0.1" });
    const addr = app.server.address();
    const port = typeof addr === "object" && addr ? addr.port : 0;
    tools = mordomoTools(httpApi(`http://127.0.0.1:${port}`, ctx.token()));
  });
  afterAll(async () => {
    await app.close();
    ctx.close();
    temp.cleanup();
  });

  it("C17 note_create, note_read and note_save return the route's result; a stale save is an error naming edit_conflict", async () => {
    const created = await run("note_create", { title: "Pelo agente", content: "primeira versão" });
    const file = path.join(temp.paths.memory, "notes", "pelo-agente.md");
    expect(created).toContain(`Created ${file}`);
    const version = /version: (sha256:[0-9a-f]{64})/.exec(created)![1]!;
    expect(fs.readFileSync(file, "utf8")).toBe("# Pelo agente\n\nprimeira versão\n");

    const read = await run("note_read", { path: file });
    expect(read).toContain(`version: ${version}`);
    expect(read).toContain("primeira versão");

    const saved = await run("note_save", {
      path: file,
      content: "# Pelo agente\n\nsegunda\n",
      baseVersion: version,
    });
    expect(saved).toContain(`Saved ${file}`);
    expect(fs.readFileSync(file, "utf8")).toBe("# Pelo agente\n\nsegunda\n");

    await expect(run("note_save", { path: file, content: "perdida", baseVersion: version })).rejects.toThrow(
      /edit_conflict/,
    );
    expect(fs.readFileSync(file, "utf8")).toBe("# Pelo agente\n\nsegunda\n");

    await expect(run("note_create", { title: "" })).rejects.toThrow(/title is required/);
    await expect(run("note_save", { path: file, baseVersion: version })).rejects.toThrow(
      /content is required/,
    );
    const outside = await run("note_read", { path: path.join(temp.paths.workspace, "..", "x.md") }).catch(
      (e: Error) => e.message,
    );
    expect(outside).toMatch(/404|403/);
  });
});
