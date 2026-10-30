import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { AgentRun } from "@mordomo/core";
import { ClaudeAdapter, claudeManifest } from "@mordomo/adapter-claude";
import { CodexAdapter, codexManifest } from "@mordomo/adapter-codex";
import { cursorManifest } from "@mordomo/adapter-cursor";
import { seedHome } from "@mordomo/core/internal";
import { AppContext } from "../apps/api/src/context.js";
import { httpApi, mordomoTools } from "../apps/api/src/mcp/mordomo.js";
import { FAKE_BIN, makeTempHome } from "./helpers.js";
import { organizeWorld, repoRoot, type Json, type OrganizeWorld } from "./helpers/organizeWorld.js";

/**
 * .specs/features/cerebro-organizar, batch A, S2 and S5: a folder of the user handed to a run of a memory skill, only to
 * read (doors 5 and 9), and the work context that gives the folder when none is given. Every claim about a route
 * crosses the HTTP boundary of a real server over a real home; what the agent is handed is read at the Claude adapter,
 * which then runs the fake CLI. Each test is written from its check in `checks.md`.
 */

const SLUG = "organize-brain";
/** A memory skill of the test's own with a `folder` input that every provider runs. */
const ANY = "organiza-qualquer";
const POSIX = process.platform !== "win32";
const CLI = path.join(repoRoot, "apps", "api", "dist", "cli.js");
const distReady = fs.existsSync(CLI);
if (!distReady)
  console.warn(`[organize.runs] skipping the CLI proof: ${CLI} is missing, run npm run build:server`);

const real = (p: string) => fs.realpathSync(p);
const errorCode = (r: { body: Json }) => r.body?.error?.code as string | undefined;

describe.skipIf(!POSIX)("S2 and S5 a folder of the user, only to read", () => {
  let w: OrganizeWorld;
  let skillDir: string;
  let workspace: string;

  beforeAll(async () => {
    w = await organizeWorld("mordomo-organize-runs-");
    skillDir = real(path.join(w.ctx.paths.skills, SLUG));
    w.put(
      path.join(w.ctx.paths.skills, ANY, "SKILL.md"),
      [
        "---",
        "name: Organiza qualquer",
        "description: A memory skill with a folder, for every provider.",
        "mode: read_only",
        "providers: [claude, codex, cursor]",
        "inputs:",
        "  - name: folder",
        "    label: Folder",
        "    type: path",
        "---",
        "",
        "# Organiza qualquer",
        "",
        "Read the folder.",
        "",
      ].join("\n"),
    );
    w.update((s) => {
      s.memorySkills = [...s.memorySkills, ANY];
    });
    w.ctx.runs.defaultCwd();
    workspace = real(path.join(w.home, "workspace"));
  });
  afterAll(async () => {
    await w.close();
  });

  const start = (body: Json, slug = SLUG) => w.call("POST", `/api/skills/${slug}/run`, body);
  async function handedFor(body: Json, slug = SLUG): Promise<{ run: Json; agent: AgentRun }> {
    const res = await start(body, slug);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const { run, agent } = await w.finished(res.body.runId as string);
    expect(agent, "the agent was handed the run").toBeDefined();
    return { run, agent: agent! };
  }
  async function refused(body: Json, status: number, code: string, slug = SLUG): Promise<Json> {
    const before = w.runCount();
    const listed = await w.call("GET", "/api/runs");
    const res = await start(body, slug);
    expect(res.status, JSON.stringify(res.body)).toBe(status);
    expect(errorCode(res), JSON.stringify(res.body)).toBe(code);
    expect(w.runCount(), "no run is recorded").toBe(before);
    expect((await w.call("GET", "/api/runs")).body).toEqual(listed.body);
    return res.body;
  }

  it("C13 a folder of an indexed folder is read-only to the run, which starts in <home>/workspace whatever cwd it sends", async () => {
    const clientes = w.dir("clientes");
    const { agent, run } = await handedFor({ inputs: { etapa: "indexar", folder: clientes }, cwd: clientes });
    expect(agent.cwd).toBe(workspace);
    expect(run.cwd).toBe(workspace);
    expect(agent.readDirs).toEqual(
      expect.arrayContaining([skillDir, real(w.ctx.paths.memory), real(clientes)]),
    );
    expect(agent.protectedDirs).toEqual(expect.arrayContaining([skillDir, real(clientes)]));
    expect(agent.protectedDirs).not.toContain(real(w.ctx.paths.memory));
  });

  it("C14 a folder outside every indexed folder, and one in a disabled indexed folder, is 400 folder_not_indexed naming it, and records no run", async () => {
    const away = w.dir("longe", w.outside);
    const outsideBody = await refused({ inputs: { folder: away } }, 400, "folder_not_indexed");
    expect(outsideBody.error.message).toContain(away);

    const off = w.dir("desligada", w.outside);
    const inside = w.dir("dentro", off);
    w.update((s) => {
      s.indexedFolders = [...s.indexedFolders, { path: off, area: null, enabled: false }];
    });
    try {
      const disabled = await refused({ inputs: { folder: inside } }, 400, "folder_not_indexed");
      expect(disabled.error.message).toContain(inside);
    } finally {
      w.update((s) => {
        s.indexedFolders = s.indexedFolders.filter((f) => f.path !== off);
      });
    }
  });

  it("C15 the home's config/ and logs/, a user exclude, a secret name and a folder holding a link into config/ are each 400 folder_not_indexed", async () => {
    const excluded = w.dir("excluida");
    const secret = path.join(w.work, ".ssh");
    fs.mkdirSync(secret, { recursive: true });
    const linked = w.dir("com-link");
    fs.symlinkSync(path.join(w.home, "config"), path.join(linked, "cfg"));
    w.update((s) => {
      s.excludes = [...s.excludes, path.basename(excluded)];
    });
    try {
      for (const folder of [
        path.join(w.home, "config"),
        path.join(w.home, "logs"),
        excluded,
        secret,
        linked,
      ]) {
        const body = await refused({ inputs: { folder } }, 400, "folder_not_indexed");
        expect(body.error.message, folder).toContain(folder);
      }
    } finally {
      w.update((s) => {
        s.excludes = s.excludes.filter((e) => e !== path.basename(excluded));
      });
      fs.rmSync(path.join(linked, "cfg"));
    }
  });

  it("C16 a provider that does not protect folders is 409 folder_protection_unsupported with a folder, 200 without; organize-brain on codex is 400", async () => {
    const pasta = w.dir("qualquer");
    for (const provider of ["codex", "cursor"]) {
      await refused({ provider, inputs: { folder: pasta } }, 409, "folder_protection_unsupported", ANY);
      const plain = await start({ provider, inputs: {} }, ANY);
      expect(plain.status, `${provider}: ${JSON.stringify(plain.body)}`).toBe(200);
      await w.ctx.execution.wait(plain.body.runId as string);
    }
    await refused({ provider: "codex", inputs: { folder: pasta } }, 400, "bad_request");
  });

  it("C17 the Claude invocation of that run adds the folder and denies each edit tool under it, read-only and write", async () => {
    const pasta = w.dir("c17");
    const { agent: run } = await handedFor({ inputs: { etapa: "indexar", folder: pasta } });
    const folder = real(pasta);
    expect(run.protectedDirs).toContain(folder);
    const claude = new ClaudeAdapter({ binaryPath: "claude" });
    for (const mode of ["read_only", "write"] as const) {
      const inv = await claude.buildInvocation({
        ...run,
        mode,
        profile: mode === "write" ? "controlled_write" : "read_only",
      });
      const added = inv.args.flatMap((a, i) => (a === "--add-dir" ? [inv.args[i + 1]!] : []));
      expect(added, mode).toContain(folder);
      const denied = inv.args
        .flatMap((a, i) => (a === "--disallowedTools" ? [inv.args[i + 1]!] : []))
        .join(",");
      for (const tool of ["Edit", "Write", "MultiEdit"])
        expect(denied, `${mode} ${tool}`).toContain(`${tool}(/${folder}/**)`);
    }
  });

  it("C18 without organize-brain in memorySkills the folder is only a line of the prompt, and the run gets only its skill folder", async () => {
    const pasta = w.dir("so-texto");
    w.update((s) => {
      s.memorySkills = s.memorySkills.filter((m) => m !== SLUG);
    });
    try {
      const { agent } = await handedFor({ inputs: { folder: pasta } });
      const lines = agent.prompt.split("\n");
      expect(lines.filter((l) => /^- .* \(folder\): /.test(l))).toEqual([
        expect.stringMatching(
          new RegExp(`^- .* \\(folder\\): ${pasta.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`),
        ),
      ]);
      expect(lines.some((l) => l.startsWith("Folder to organize"))).toBe(false);
      expect(agent.readDirs).toEqual([skillDir]);
      expect(agent.protectedDirs).toEqual([skillDir]);
    } finally {
      w.update((s) => {
        s.memorySkills = [...s.memorySkills, SLUG];
      });
    }
  });

  it("C19 the manifests declare protectsDirs, true for claude only, and GET /api/providers carries it for each", async () => {
    expect(claudeManifest.capabilities.protectsDirs).toBe(true);
    expect(codexManifest.capabilities.protectsDirs).toBe(false);
    expect(cursorManifest.capabilities.protectsDirs).toBe(false);
    const res = await w.call("GET", "/api/providers");
    expect(res.status).toBe(200);
    const byId = new Map((res.body as unknown as Json[]).map((p) => [p.id, p.capabilities.protectsDirs]));
    expect(byId.get("claude")).toBe(true);
    expect(byId.get("codex")).toBe(false);
    expect(byId.get("cursor")).toBe(false);
  });

  it("C20 a parked run whose indexed folder is disabled before the approval ends failed with folder_not_indexed, and the agent never starts", async () => {
    const other = w.dir("outra-raiz", w.outside);
    const folder = w.dir("projeto", other);
    w.update((s) => {
      s.securityProfile = "review_before_write";
      s.indexedFolders = [...s.indexedFolders, { path: other, area: null, enabled: true }];
    });
    try {
      const parked = await start({ inputs: { folder } });
      expect(parked.status, JSON.stringify(parked.body)).toBe(202);
      const runId = parked.body.runId as string;
      w.update((s) => {
        s.indexedFolders = s.indexedFolders.map((f) => (f.path === other ? { ...f, enabled: false } : f));
      });
      const approval = parked.body.pendingApproval.id as string;
      const resolved = await w.call("POST", `/api/approvals/${approval}/resolve`, { decision: "approved" });
      expect(resolved.status, JSON.stringify(resolved.body)).toBe(200);
      const { run, agent } = await w.finished(runId);
      expect(run.status).toBe("failed");
      expect(run.failure.code).toBe("folder_not_indexed");
      expect(run.failure.recoverable, "door 11: nothing to retry").toBe(false);
      expect(agent, "the adapter was never called").toBeUndefined();
    } finally {
      w.update((s) => {
        s.securityProfile = "controlled_write";
        s.indexedFolders = s.indexedFolders.filter((f) => f.path !== other);
      });
    }
  });

  it("C21 a folder under <home>/memory/notes/ is accepted, memory/ is handed once, and only the skill folder is protected", async () => {
    const notes = path.join(w.ctx.paths.memory, "notes", "projetos");
    fs.mkdirSync(notes, { recursive: true });
    const { agent } = await handedFor({ inputs: { folder: notes } });
    const memory = real(w.ctx.paths.memory);
    expect((agent.readDirs ?? []).filter((d) => d === memory)).toHaveLength(1);
    expect(agent.protectedDirs).toEqual([skillDir]);
  });

  it("C23 a routine of organize-brain with a folder, fired under approved_automation, hands the folders of C13", async () => {
    const pasta = w.dir("rotina");
    const id = "organizar-rotina";
    w.put(
      path.join(w.ctx.paths.routines, `${id}.json`),
      JSON.stringify({
        id,
        name: "Organizar pela rotina",
        skillSlug: SLUG,
        prompt: null,
        inputs: { etapa: "indexar", folder: pasta },
        kind: "cron",
        schedule: "0 3 * * *",
        timezone: "UTC",
        provider: "claude",
        profile: "approved_automation",
        workingDir: pasta,
        enabled: false,
        createdAt: Date.now(),
      }),
    );
    w.update((s) => {
      s.securityProfile = "approved_automation";
    });
    try {
      const fired = await w.call("POST", `/api/routines/${id}/run`);
      expect(fired.status, JSON.stringify(fired.body)).toBe(200);
      const runId = fired.body.runId as string;
      expect(runId).toBeTruthy();
      const { agent } = await w.finished(runId);
      expect(agent, "the agent was handed the routine's run").toBeDefined();
      expect(agent!.cwd).toBe(workspace);
      expect(agent!.readDirs).toEqual(
        expect.arrayContaining([skillDir, real(w.ctx.paths.memory), real(pasta)]),
      );
      expect(agent!.protectedDirs).toEqual(expect.arrayContaining([skillDir, real(pasta)]));
    } finally {
      w.update((s) => {
        s.securityProfile = "controlled_write";
      });
    }
  });

  it("C52 a retry of a run of organize-brain with a folder starts in <home>/workspace with the folder read-only, as C13", async () => {
    const pasta = w.dir("repetir");
    const { run: source } = await handedFor({ inputs: { etapa: "indexar", folder: pasta } });
    expect(source.status, JSON.stringify(source)).toBe("done");
    const retried = await w.call("POST", `/api/runs/${source.id as string}/retry`, {
      submissionId: crypto.randomUUID(),
    });
    expect(retried.status, JSON.stringify(retried.body)).toBe(200);
    const runId = retried.body.runId as string;
    expect(runId).not.toBe(source.id);
    const { agent } = await w.finished(runId);
    expect(agent, "the agent was handed the retry").toBeDefined();
    expect(agent!.cwd).toBe(workspace);
    expect(agent!.readDirs).toEqual(
      expect.arrayContaining([skillDir, real(w.ctx.paths.memory), real(pasta)]),
    );
    expect(agent!.protectedDirs).toEqual(expect.arrayContaining([skillDir, real(pasta)]));
  });

  it("C52 an objective's step running organize-brain with a folder, dispatched with that folder as cwd, starts in <home>/workspace with the folder read-only, as C13", async () => {
    const pasta = w.dir("objetivo");
    const created = await w.call("POST", "/api/objectives", {
      title: "Organizar pelo objetivo",
      steps: [
        {
          title: "Indexar a pasta",
          request: {
            version: 1,
            kind: "skill",
            skillSlug: SLUG,
            inputs: { etapa: "indexar", folder: pasta },
            mode: "write",
          },
        },
      ],
    });
    expect(created.status, JSON.stringify(created.body)).toBe(200);
    const dispatched = await w.call("POST", `/api/objectives/${created.body.id as string}/dispatch`, {
      provider: "claude",
      cwd: pasta,
    });
    expect(dispatched.status, JSON.stringify(dispatched.body)).toBe(200);
    const [step] = dispatched.body.dispatched as Json[];
    expect(step?.status, JSON.stringify(dispatched.body)).toBe("queued");
    const { agent } = await w.finished(step!.runId as string);
    expect(agent, "the agent was handed the step's run").toBeDefined();
    expect(agent!.cwd).toBe(workspace);
    expect(agent!.readDirs).toEqual(
      expect.arrayContaining([skillDir, real(w.ctx.paths.memory), real(pasta)]),
    );
    expect(agent!.protectedDirs).toEqual(expect.arrayContaining([skillDir, real(pasta)]));
  });

  it("C53 a routine of a memory skill with a folder on codex ends failed with folder_protection_unsupported and recoverable false, and codex is never called", async () => {
    const pasta = w.dir("rotina-codex");
    const id = "organizar-rotina-codex";
    w.put(
      path.join(w.ctx.paths.routines, `${id}.json`),
      JSON.stringify({
        id,
        name: "Organizar pela rotina no Codex",
        skillSlug: ANY,
        prompt: null,
        inputs: { folder: pasta },
        kind: "cron",
        schedule: "0 3 * * *",
        timezone: "UTC",
        provider: "codex",
        profile: "approved_automation",
        workingDir: pasta,
        enabled: false,
        createdAt: Date.now(),
      }),
    );
    const codex = vi.spyOn(CodexAdapter.prototype, "execute");
    w.update((s) => {
      s.securityProfile = "approved_automation";
    });
    try {
      const fired = await w.call("POST", `/api/routines/${id}/run`);
      expect(fired.status, JSON.stringify(fired.body)).toBe(200);
      const runId = fired.body.runId as string;
      expect(runId).toBeTruthy();
      const { run } = await w.finished(runId);
      expect(run.provider).toBe("codex");
      expect(run.status).toBe("failed");
      expect(run.failure.code).toBe("folder_protection_unsupported");
      expect(run.failure.recoverable).toBe(false);
      expect(codex, "the codex adapter was never called").not.toHaveBeenCalled();
    } finally {
      codex.mockRestore();
      w.update((s) => {
        s.securityProfile = "controlled_write";
      });
    }
  });

  it("C44 with contextId and no folder the folder is the first ok path, every ok path is protected, the notes folder only read", async () => {
    const gone = w.dir("sumiu");
    const second = w.dir("segunda");
    const third = w.dir("terceira");
    const created = await w.call("POST", "/api/contexts", {
      name: "Contexto C44",
      paths: [gone, second, third],
    });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    const id = created.body.id as string;
    fs.rmSync(gone, { recursive: true, force: true });
    const notes = path.join(w.ctx.paths.memory, "notes", id);
    fs.mkdirSync(notes, { recursive: true });

    const { agent, run } = await handedFor({ contextId: id, inputs: { etapa: "indexar" } });
    expect(agent.prompt.split("\n")).toContain(`Folder to organize (read-only): ${real(second)}`);
    expect(agent.cwd).toBe(workspace);
    expect(agent.readDirs).toEqual(expect.arrayContaining([real(second), real(third), real(notes)]));
    expect(agent.protectedDirs).toEqual(expect.arrayContaining([skillDir, real(second), real(third)]));
    expect(agent.protectedDirs).not.toContain(real(notes));
    expect(run.contextId).toBe(id);
  });

  it("C45 with contextId a folder outside the context is 400 validation; one inside its second path is kept as the folder", async () => {
    const first = w.dir("c45-a");
    const second = w.dir("c45-b");
    const inner = w.dir("dentro", second);
    const elsewhere = w.dir("c45-fora");
    const created = await w.call("POST", "/api/contexts", { name: "Contexto C45", paths: [first, second] });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    const id = created.body.id as string;
    await refused({ contextId: id, inputs: { folder: elsewhere } }, 400, "validation");
    const { agent } = await handedFor({ contextId: id, inputs: { folder: inner } });
    expect(agent.prompt.split("\n")).toContain(`Folder to organize (read-only): ${real(inner)}`);
    expect(agent.protectedDirs).toEqual(expect.arrayContaining([skillDir, real(inner)]));
  });

  it("C46 an unknown contextId is 404 context_not_found and a context with no ok path 409 context_unavailable, before any folder check", async () => {
    const away = w.dir("c46-longe", w.outside);
    await refused({ contextId: "nao-existe", inputs: { folder: away } }, 404, "context_not_found");
    const lost = w.dir("c46-sumiu");
    const created = await w.call("POST", "/api/contexts", { name: "Contexto C46", paths: [lost] });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    fs.rmSync(lost, { recursive: true, force: true });
    await refused({ contextId: created.body.id, inputs: { folder: away } }, 409, "context_unavailable");
  });

  it("C22 the MCP tool skills_run returns folder_not_indexed for a folder outside, and with an indexed one hands the folders of C13", async () => {
    await w.app.listen({ port: 0, host: "127.0.0.1" });
    const addr = w.app.server.address();
    const port = typeof addr === "object" && addr ? addr.port : 0;
    const tools = mordomoTools(httpApi(`http://127.0.0.1:${port}`, w.ctx.token()));
    const run = tools.find((t) => t.name === "skills_run")!;
    const away = w.dir("mcp-longe", w.outside);
    await expect(run.handler({ slug: SLUG, inputs: { folder: away } })).rejects.toThrow(/folder_not_indexed/);
    const pasta = w.dir("mcp-dentro");
    const started = JSON.parse(await run.handler({ slug: SLUG, inputs: { folder: pasta } })) as {
      runId: string;
    };
    const { agent } = await w.finished(started.runId);
    expect(agent!.cwd).toBe(workspace);
    expect(agent!.readDirs).toEqual(
      expect.arrayContaining([skillDir, real(w.ctx.paths.memory), real(pasta)]),
    );
    expect(agent!.protectedDirs).toEqual(expect.arrayContaining([skillDir, real(pasta)]));
  });
});

describe.skipIf(!POSIX || !distReady)("S2 mordomo run with a folder", () => {
  let home: ReturnType<typeof makeTempHome>;
  let work: string;
  let outside: string;
  let argsFile: string;

  beforeAll(() => {
    home = makeTempHome("mordomo-organize-cli-");
    work = real(fs.mkdtempSync(path.join(path.dirname(home.paths.home), "mordomo-organize-cli-work-")));
    outside = real(fs.mkdtempSync(path.join(path.dirname(home.paths.home), "mordomo-organize-cli-outside-")));
    seedHome(home.paths, repoRoot);
    // A claude that writes down the arguments it was given, then behaves as the fake CLI.
    const bin = path.join(outside, "bin");
    fs.mkdirSync(bin, { recursive: true });
    argsFile = path.join(outside, "args.txt");
    fs.writeFileSync(
      path.join(bin, "claude"),
      `#!/usr/bin/env bash\nif [[ "$1" != "--version" && "$1" != "--help" && "$1" != "auth" ]]; then printf '%s\\n' "$@" > "${argsFile}"; fi\nexec "${path.join(FAKE_BIN, "claude")}" "$@"\n`,
      { mode: 0o755 },
    );
    const ctx = new AppContext(home.paths.home);
    const settings = ctx.settings();
    settings.setupCompleted = true;
    settings.securityProfile = "controlled_write";
    settings.indexedFolders = [{ path: work, area: null, enabled: true }];
    settings.providers.claude.enabled = true;
    settings.providers.claude.binaryPath = path.join(bin, "claude");
    ctx.settingsStore.save(settings);
    ctx.close();
  });
  afterAll(() => {
    home.cleanup();
    fs.rmSync(work, { recursive: true, force: true });
    fs.rmSync(outside, { recursive: true, force: true });
  });

  const mordomo = (args: string[]) => {
    const res = spawnSync(process.execPath, [CLI, ...args], {
      cwd: repoRoot,
      encoding: "utf8",
      timeout: 60_000,
      env: { ...process.env, MORDOMO_HOME: home.paths.home, NO_COLOR: "1", FORCE_COLOR: "0" },
    });
    return { status: res.status, stdout: res.stdout ?? "", stderr: res.stderr ?? "" };
  };

  it("C22 mordomo run prints folder_not_indexed and exits 1 for a folder outside, and with an indexed one hands the folders of C13", () => {
    const away = path.join(outside, "longe");
    fs.mkdirSync(away, { recursive: true });
    const refusedRun = mordomo(["run", SLUG, "--input", `folder=${away}`]);
    expect(refusedRun.status, refusedRun.stdout).toBe(1);
    expect(refusedRun.stderr).toContain("folder_not_indexed");
    expect(fs.existsSync(argsFile), "no agent was started").toBe(false);

    const pasta = path.join(work, "clientes");
    fs.mkdirSync(pasta, { recursive: true });
    const ran = mordomo(["run", SLUG, "--json", "--input", `folder=${pasta}`, "--input", "etapa=indexar"]);
    expect(ran.status, `${ran.stdout}\n${ran.stderr}`).toBe(0);
    const record = JSON.parse(ran.stdout.trim().split("\n").at(-1)!) as Json;
    expect(record.status).toBe("done");
    expect(record.cwd).toBe(real(path.join(home.paths.home, "workspace")));
    const args = fs.readFileSync(argsFile, "utf8").split("\n");
    const added = args.flatMap((a, i) => (a === "--add-dir" ? [args[i + 1]!] : []));
    expect(added).toEqual(
      expect.arrayContaining([
        real(path.join(home.paths.skills, SLUG)),
        real(home.paths.memory),
        real(pasta),
      ]),
    );
    const denied = args.flatMap((a, i) => (a === "--disallowedTools" ? [args[i + 1]!] : [])).join(",");
    expect(denied).toContain(`Edit(/${real(pasta)}/**)`);
  });
});
