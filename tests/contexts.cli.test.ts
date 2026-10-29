import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { AppContext } from "../apps/api/src/context.js";
import { buildServer } from "../apps/api/src/server.js";
import { httpApi, mordomoTools } from "../apps/api/src/mcp/mordomo.js";
import { generateRouters } from "../core/src/memory/routers.js";
import { FAKE_BIN, makeTempHome, withFakeBinPath } from "./helpers.js";

/**
 * .specs/features/cerebro-contextos, batch B, S6: the work contexts from the command line (the BUILT cli, over a real
 * home and a real index) and from an MCP client (the tools over real HTTP against a real server).
 */

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CLI = path.join(repoRoot, "apps", "api", "dist", "cli.js");
const distReady = fs.existsSync(CLI);
if (!distReady)
  console.warn(`[contexts.cli] skipping the CLI proof: ${CLI} is missing, run npm run build:server`);

const SKILL = "contexto-cli";
type Json = Record<string, any>;
const under = (folder: string, file: string) => file === folder || file.startsWith(folder + path.sep);
const put = (file: string, text: string): string => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
  return file;
};

/** A home with an indexed folder holding a project, a folder outside it, and two contexts over them. */
interface World {
  home: ReturnType<typeof makeTempHome>;
  work: string;
  app: string;
  gone: string;
  fora: string;
  appNote: string;
  foraNote: string;
}
async function makeWorld(prefix: string, keepOpen: boolean): Promise<World & { ctx: AppContext }> {
  const home = makeTempHome(prefix);
  const work = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), `${prefix}work-`)));
  const app = path.join(work, "app");
  const gone = path.join(work, "sumiu");
  const fora = path.join(work, "fora");
  for (const folder of [app, gone, fora]) fs.mkdirSync(folder, { recursive: true });
  const appNote = put(
    path.join(app, "ameixa-app.md"),
    "# Ameixa do app\n\n## Ameixa\n\nameixa roxa no projeto\n",
  );
  const foraNote = put(
    path.join(fora, "ameixa-fora.md"),
    "# Ameixa de fora\n\n## Ameixa\n\nameixa roxa fora\n",
  );
  put(
    path.join(home.paths.skills, SKILL, "SKILL.md"),
    "---\nname: Contexto CLI\ndescription: Say what is in the working folder.\nmode: read_only\nproviders: [claude]\n---\n\n# Contexto CLI\n\nSay what is in the working folder.\n",
  );
  const ctx = new AppContext(home.paths.home);
  const settings = ctx.settings();
  settings.setupCompleted = true;
  settings.indexedFolders = [{ path: work, area: "Projetos", enabled: true }];
  settings.providers.claude.enabled = true;
  settings.providers.claude.binaryPath = path.join(FAKE_BIN, "claude");
  settings.contexts = [
    { id: "app-x", name: "App X", paths: [app, gone] },
    { id: "outro", name: "Outro projeto", paths: [fora] },
  ];
  ctx.settingsStore.save(settings);
  ctx.reloadAdapters();
  fs.rmSync(gone, { recursive: true, force: true });
  await ctx.indexer.indexAllAsync();
  generateRouters(ctx.db, ctx.paths, ctx.settings());
  if (!keepOpen) ctx.close();
  return { home, work, app, gone, fora, appNote, foraNote, ctx };
}

describe.skipIf(!distReady)("S6 mordomo context, recall and run", () => {
  let w: World;
  const mordomo = (args: string[]) => {
    const res = spawnSync(process.execPath, [CLI, ...args], {
      cwd: repoRoot,
      encoding: "utf8",
      timeout: 60_000,
      env: {
        ...process.env,
        MORDOMO_HOME: w.home.paths.home,
        NO_COLOR: "1",
        FORCE_COLOR: "0",
        PATH: `${FAKE_BIN}${path.delimiter}${process.env.PATH ?? ""}`,
      },
    });
    return { status: res.status, stdout: res.stdout ?? "", stderr: res.stderr ?? "" };
  };
  const active = (): string | null =>
    (JSON.parse(fs.readFileSync(w.home.paths.uiPreferencesFile, "utf8")) as { activeContext: string | null })
      .activeContext;
  const recallPaths = (args: string[]) => {
    const res = mordomo(["recall", "ameixa", "roxa", "--json", ...args]);
    expect(res.status, res.stderr).toBe(0);
    const answer = JSON.parse(res.stdout) as Json;
    return [
      ...(answer.candidates as Json[]).map((c) => c.path as string),
      ...(answer.answerContext as Json[]).map((c) => c.path as string),
    ];
  };
  const runOf = (args: string[]) => {
    const res = mordomo(["run", SKILL, "--json", ...args]);
    expect(res.status, `${res.stdout}\n${res.stderr}`).toBe(0);
    return JSON.parse(res.stdout.trim().split("\n").at(-1)!) as Json;
  };

  beforeAll(async () => {
    w = await makeWorld("mordomo-contexts-cli-", false);
  });
  afterAll(() => {
    fs.rmSync(w.work, { recursive: true, force: true });
    w.home.cleanup();
  });

  it("C41 mordomo context list prints one line per context with id, name, file count and the state of each path, * on the active one, and exits 0", () => {
    const listed = mordomo(["context", "list"]);
    expect(listed.status, listed.stderr).toBe(0);
    const lines = listed.stdout.trimEnd().split("\n");
    expect(lines).toHaveLength(2);
    const [app, outro] = lines as [string, string];
    expect(app).toBe(`  app-x  App X  1 files  ${w.app} (ok), ${w.gone} (missing)`);
    expect(outro).toBe(`  outro  Outro projeto  1 files  ${w.fora} (ok)`);

    expect(mordomo(["context", "use", "outro"]).status).toBe(0);
    const marked = mordomo(["context", "list"]);
    expect(marked.status).toBe(0);
    const again = marked.stdout.trimEnd().split("\n");
    expect(again[0]!.startsWith("  app-x ")).toBe(true);
    expect(again[1]!.startsWith("* outro ")).toBe(true);
    expect(again.filter((l) => l.startsWith("*"))).toHaveLength(1);
    expect(mordomo(["context", "use", "--none"]).status).toBe(0);
  });

  it("C42 mordomo context use <id> sets activeContext, --none sets it to null, an unknown id prints context_not_found on stderr and exits 1", () => {
    const used = mordomo(["context", "use", "app-x"]);
    expect(used.status, used.stderr).toBe(0);
    expect(active()).toBe("app-x");
    const none = mordomo(["context", "use", "--none"]);
    expect(none.status, none.stderr).toBe(0);
    expect(active()).toBeNull();
    mordomo(["context", "use", "outro"]);
    const before = fs.readFileSync(w.home.paths.uiPreferencesFile, "utf8");
    const unknown = mordomo(["context", "use", "nao-existe"]);
    expect(unknown.status).toBe(1);
    expect(unknown.stderr).toContain("context_not_found");
    expect(fs.readFileSync(w.home.paths.uiPreferencesFile, "utf8")).toBe(before);
    expect(active()).toBe("outro");
    // usage errors
    expect(mordomo(["context"]).status).toBe(2);
    expect(mordomo(["context", "use"]).status).toBe(2);
    expect(mordomo(["context", "dance"]).status).toBe(2);
    mordomo(["context", "use", "--none"]);
  });

  it("C43 mordomo context show <id> prints the body of memory/contexts/<id>.md", () => {
    const map = path.join(w.home.paths.memory, "contexts", "app-x.md");
    const body = fs.readFileSync(map, "utf8");
    expect(body).toContain("App X");
    const shown = mordomo(["context", "show", "app-x"]);
    expect(shown.status, shown.stderr).toBe(0);
    expect(shown.stdout).toBe(body.endsWith("\n") ? body : `${body}\n`);
    const unknown = mordomo(["context", "show", "nao-existe"]);
    expect(unknown.status).toBe(1);
    expect(unknown.stderr).toContain("context_not_found");
  });

  it("C44 recall and run with --context scope as the API does, without it follow the active context, and with all use the whole index", () => {
    mordomo(["context", "use", "--none"]);
    // recall
    const whole = recallPaths([]);
    expect(whole).toEqual(expect.arrayContaining([w.appNote, w.foraNote]));
    const scoped = recallPaths(["--context", "app-x"]);
    expect(scoped).toContain(w.appNote);
    for (const p of scoped) expect(under(w.app, p), p).toBe(true);
    expect(mordomo(["context", "use", "app-x"]).status).toBe(0);
    const followed = recallPaths([]);
    expect(followed).toContain(w.appNote);
    for (const p of followed) expect(under(w.app, p), p).toBe(true);
    expect(recallPaths(["--context", "all"])).toEqual(expect.arrayContaining([w.appNote, w.foraNote]));
    expect(recallPaths(["--context", "outro"])).not.toContain(w.appNote);
    const unknown = mordomo(["recall", "ameixa", "--json", "--context", "nao-existe"]);
    expect(unknown.status).toBe(1);
    expect(unknown.stderr).toContain("context_not_found");

    // run (the active context is still app-x)
    const followedRun = runOf([]);
    expect(followedRun.contextId).toBe("app-x");
    expect(followedRun.cwd).toBe(w.app);
    const named = runOf(["--context", "outro"]);
    expect(named.contextId).toBe("outro");
    expect(named.cwd).toBe(w.fora);
    const all = runOf(["--context", "all"]);
    expect(all.contextId).toBeNull();
    expect(mordomo(["context", "use", "--none"]).status).toBe(0);
    expect(runOf([]).contextId).toBeNull();
  });
});

describe("S6 the MCP tools", () => {
  let w: World & { ctx: AppContext };
  let app: FastifyInstance;
  let tools: ReturnType<typeof mordomoTools>;
  let restorePath: () => void;
  const tool = (name: string, args: Record<string, unknown>): Promise<string> => {
    const found = tools.find((t) => t.name === name);
    if (!found) throw new Error(`no tool ${name}`);
    return found.handler(args);
  };

  beforeAll(async () => {
    restorePath = withFakeBinPath();
    w = await makeWorld("mordomo-contexts-mcp-", true);
    app = await buildServer(w.ctx);
    await app.listen({ port: 0, host: "127.0.0.1" });
    const addr = app.server.address();
    const port = typeof addr === "object" && addr ? addr.port : 0;
    tools = mordomoTools(httpApi(`http://127.0.0.1:${port}`, w.ctx.token()));
  });
  afterAll(async () => {
    await w.ctx.runs.shutdown(2000);
    await app.close();
    w.ctx.close();
    restorePath();
    fs.rmSync(w.work, { recursive: true, force: true });
    w.home.cleanup();
  });

  it("C45 recall and skills_run accept context and pass it to the route; without it the answer is the whole index", async () => {
    const recallTool = tools.find((t) => t.name === "recall")!;
    const runTool = tools.find((t) => t.name === "skills_run")!;
    expect(Object.keys((recallTool.inputSchema as Json).properties)).toContain("context");
    expect(Object.keys((runTool.inputSchema as Json).properties)).toContain("context");

    const whole = await tool("recall", { question: "ameixa roxa" });
    expect(whole).toContain(w.appNote);
    expect(whole).toContain(w.foraNote);
    const scoped = await tool("recall", { question: "ameixa roxa", context: "app-x" });
    expect(scoped).toContain(w.appNote);
    expect(scoped).not.toContain(w.foraNote);
    expect(await tool("recall", { question: "ameixa roxa", context: "all" })).toContain(w.foraNote);
    // the route's refusal comes back as the tool's error
    await expect(tool("recall", { question: "ameixa", context: "nao-existe" })).rejects.toThrow(
      /context_not_found/,
    );

    const started = JSON.parse(await tool("skills_run", { slug: SKILL, context: "app-x" })) as {
      runId: string;
    };
    const run = await w.ctx.execution.wait(started.runId);
    expect(run.contextId).toBe("app-x");
    expect(run.cwd).toBe(w.app);
    const plain = JSON.parse(await tool("skills_run", { slug: SKILL })) as { runId: string };
    const plainRun = await w.ctx.execution.wait(plain.runId);
    expect(plainRun.contextId).toBeNull();
    await expect(tool("skills_run", { slug: SKILL, context: "nao-existe" })).rejects.toThrow(
      /context_not_found/,
    );
  });
});
