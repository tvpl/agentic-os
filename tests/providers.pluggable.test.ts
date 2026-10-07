import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import type { FastifyInstance } from "fastify";
import ts from "typescript";
import * as core from "@mordomo/core";
import {
  ConnectorRegistry,
  ConnectorSchema,
  ExecutableNotAllowedError,
  ProviderId,
  ProviderRegistry,
  ProviderRegistryError,
  RoutineSchema,
  RoutineStore,
  SettingsStore,
  SkillCatalog,
  assertAllowed,
  createEngine,
  homeConfigFilesOf,
  resolvePaths,
  runAudit,
  type AdapterFactory,
  type AgentAdapter,
  type MordomoEngine,
  type ProviderManifest,
  type RunRecord,
  type RunRequestSpec,
} from "@mordomo/core";
import { claudeManifest, createClaudeAdapter } from "@mordomo/adapter-claude";
import { codexManifest, createCodexAdapter } from "@mordomo/adapter-codex";
import { cursorManifest, createCursorAdapter } from "@mordomo/adapter-cursor";
import { AppContext } from "../apps/api/src/context.js";
import { buildServer } from "../apps/api/src/server.js";
import { FAKE_BIN, FAKE_CLIS_RUNNABLE, makeTempHome, withFakeBinPath } from "./helpers.js";

/**
 * Pluggable providers (.specs/features/provedores-plugaveis): a provider id is
 * a format, the providers are the registered ones, and a new one is a
 * manifest + factory, never an edit to the core.
 */

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CLI = path.join(repoRoot, "apps", "api", "dist", "cli.js");

const temps: string[] = [];
const engines: MordomoEngine[] = [];
afterEach(async () => {
  for (const engine of engines.splice(0)) await engine.stop(500).catch(() => undefined);
});
afterAll(() => {
  for (const dir of temps.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

function tempDir(prefix: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  temps.push(dir);
  return dir;
}

/** A third-party provider: the fake Claude CLI installed as `acme-cli`, with a manifest of its own. */
const acmeManifest: ProviderManifest = {
  ...claudeManifest,
  id: "acme",
  displayName: "Acme Agent",
  binary: "acme-cli",
  installHint: "npm install -g acme-cli",
  loginCommand: "acme login",
  layout: { instructionsFile: "ACME.md", skillsDir: ".acme/skills", rulesFile: null, commandsDir: null },
  homeConfigFiles: [".acme/config.json"],
};
/** The acme adapter speaks the fake CLI's protocol (Claude's stream-json) under its own id and manifest. */
const createAcmeAdapter: AdapterFactory = (opts) =>
  Object.assign(Object.create(createClaudeAdapter(opts)) as AgentAdapter, {
    id: "acme",
    manifest: acmeManifest,
  });

let acmeBinCache: string | null = null;
function acmeBin(): string {
  if (acmeBinCache) return acmeBinCache;
  const file = path.join(tempDir("mordomo-acme-bin-"), "acme-cli");
  fs.copyFileSync(path.join(FAKE_BIN, "claude"), file);
  fs.chmodSync(file, 0o755);
  return (acmeBinCache = file);
}

function builtinRegistry(): ProviderRegistry {
  return new ProviderRegistry()
    .register(claudeManifest, createClaudeAdapter)
    .register(cursorManifest, createCursorAdapter)
    .register(codexManifest, createCodexAdapter);
}

function engineWith(
  registry: ProviderRegistry,
  patch: (s: core.Settings) => void = () => undefined,
): MordomoEngine {
  const home = tempDir("mordomo-plug-");
  const store = new SettingsStore(resolvePaths(home));
  const settings = store.load();
  settings.providers.claude.enabled = true;
  settings.providers.claude.binaryPath = path.join(FAKE_BIN, "claude");
  patch(settings);
  store.save(settings);
  const e = createEngine({ home, seedDir: null, providers: registry });
  engines.push(e);
  return e;
}

describe("S1 an open provider id that never drops what is stored", () => {
  it("C1 a provider id is a format, not a list", () => {
    for (const id of ["gemini", "acme-2", "claude"]) expect(ProviderId.safeParse(id).success, id).toBe(true);
    for (const id of ["Claude", "", "a", "1x", "a".repeat(33)])
      expect(ProviderId.safeParse(id).success, id).toBe(false);
  });

  it("C2 an unknown provider in settings keeps the file and the builtins", () => {
    const { paths, cleanup } = makeTempHome("mordomo-plug-settings-");
    try {
      fs.mkdirSync(paths.config, { recursive: true });
      fs.writeFileSync(
        paths.settingsFile,
        JSON.stringify({ version: 2, defaultProvider: "gemini", providers: { gemini: { enabled: true } } }),
      );
      const store = new SettingsStore(paths);
      const settings = store.load();
      expect(settings.defaultProvider).toBe("gemini");
      expect(settings.providers.gemini?.enabled).toBe(true);
      for (const id of ["claude", "cursor", "codex"]) expect(settings.providers[id]?.enabled, id).toBe(false);
      // A save keeps the unknown entry (nothing stored is dropped) and the engine still builds.
      store.save(settings);
      expect(new SettingsStore(paths).load().providers.gemini?.enabled).toBe(true);
      const e = createEngine({ home: paths.home, seedDir: null, providers: builtinRegistry() });
      engines.push(e);
      expect(e.settings().defaultProvider).toBe("gemini");
    } finally {
      cleanup();
    }
  });

  it("C3 records naming an unregistered provider still load", () => {
    const { paths, cleanup } = makeTempHome("mordomo-plug-records-");
    try {
      fs.mkdirSync(paths.routines, { recursive: true });
      fs.writeFileSync(
        path.join(paths.routines, "gemini-check.json"),
        JSON.stringify(
          RoutineSchema.parse({
            id: "gemini-check",
            name: "Gemini check",
            prompt: "hi",
            schedule: "0 9 * * *",
            provider: "gemini",
          }),
        ),
      );
      fs.mkdirSync(path.join(paths.skills, "gemini-skill"), { recursive: true });
      fs.writeFileSync(
        path.join(paths.skills, "gemini-skill", "SKILL.md"),
        "---\nname: Gemini skill\ndescription: Runs on Gemini.\nproviders: [gemini]\n---\n\nSay hi.\n",
      );
      fs.mkdirSync(paths.connectors, { recursive: true });
      fs.writeFileSync(
        path.join(paths.connectors, "gemini-tool.json"),
        JSON.stringify(
          ConnectorSchema.parse({
            id: "gemini-tool",
            name: "Gemini tool",
            kind: "mcp",
            origin: "https://example.com",
            maintainer: "Example",
            compatibleProviders: ["gemini"],
          }),
        ),
      );

      const routines = new RoutineStore(paths);
      expect(routines.list().map((r) => [r.id, r.provider])).toContainEqual(["gemini-check", "gemini"]);
      expect(routines.lastProblems()).toEqual([]);
      const skills = new SkillCatalog(paths);
      expect(skills.list().find((s) => s.slug === "gemini-skill")?.providers).toEqual(["gemini"]);
      expect(skills.lastProblems()).toEqual([]);
      const connectors = new ConnectorRegistry(paths);
      expect(connectors.list().find((c) => c.id === "gemini-tool")?.compatibleProviders).toEqual(["gemini"]);
      expect(connectors.lastProblems()).toEqual([]);
    } finally {
      cleanup();
    }
  });

  it("C6 a routine on an unregistered provider fails without a process", async () => {
    const e = engineWith(builtinRegistry());
    e.routines.save(
      RoutineSchema.parse({
        id: "gemini-check",
        name: "Gemini check",
        prompt: "hi",
        schedule: "0 9 * * *",
        provider: "gemini",
      }),
    );
    const { runId } = await e.scheduler.fire("gemini-check", { reason: "manual" });
    let run: RunRecord | null = null;
    await vi.waitFor(
      () => {
        run = e.runs.get(runId);
        expect(run?.status).toBe("failed");
      },
      { timeout: 10_000 },
    );
    expect(run!.error).toContain("unknown provider");
    expect(run!.pid).toBeNull();
    expect(e.runs.eventsFor(runId).map((x) => x.event.type)).not.toContain("started");
  });

  describe.skipIf(!FAKE_CLIS_RUNNABLE || !fs.existsSync(CLI))("the CLI", () => {
    function homeWithSkill(defaultProvider = "claude"): string {
      const home = tempDir("mordomo-plug-cli-");
      const paths = resolvePaths(home);
      fs.mkdirSync(path.join(paths.skills, "say-hi"), { recursive: true });
      fs.writeFileSync(
        path.join(paths.skills, "say-hi", "SKILL.md"),
        "---\nname: Say hi\ndescription: Says hi.\n---\n\nSay hi.\n",
      );
      const store = new SettingsStore(paths);
      const settings = store.load();
      settings.defaultProvider = defaultProvider;
      settings.providers.claude.enabled = true;
      settings.providers.claude.binaryPath = path.join(FAKE_BIN, "claude");
      settings.setupCompleted = true;
      store.save(settings);
      return home;
    }
    const runCli = (home: string, args: string[]) =>
      spawnSync(process.execPath, [CLI, ...args], {
        cwd: repoRoot,
        encoding: "utf8",
        timeout: 60_000,
        env: { ...process.env, MORDOMO_HOME: home, NO_COLOR: "1" },
      });

    it("C7 the CLI refuses an unregistered provider with exit 2", () => {
      const res = runCli(homeWithSkill(), ["run", "say-hi", "--provider", "gemini"]);
      expect(res.status, res.stderr).toBe(2);
      expect(res.stderr).toContain('Invalid --provider "gemini"');
    });

    it("refuses an unregistered default provider with exit 2 too", () => {
      const home = homeWithSkill("gemini");
      const res = runCli(home, ["run", "say-hi"]);
      expect(res.status, res.stderr).toBe(2);
      expect(res.stderr).toContain('Unknown provider "gemini"');
    });
  });
});

describe("S2 each adapter carries its own manifest", () => {
  it("C9 manifests live in the adapter packages", () => {
    for (const id of ["claude", "cursor", "codex"]) {
      const source = fs.readFileSync(path.join(repoRoot, "adapters", id, "src", "manifest.ts"), "utf8");
      expect(source, id).toContain(`id: "${id}"`);
      const pkg = JSON.parse(
        fs.readFileSync(path.join(repoRoot, "adapters", id, "package.json"), "utf8"),
      ) as {
        name: string;
      };
      expect(pkg.name).toBe(`@mordomo/adapter-${id}`);
    }
    expect([claudeManifest.id, cursorManifest.id, codexManifest.id]).toEqual(["claude", "cursor", "codex"]);
    expect("BUILTIN_MANIFESTS" in core).toBe(false);
    expect("builtinManifests" in core).toBe(false);
  });

  it("C10 a registered provider is seen by the auditor and the compiler", () => {
    const registry = builtinRegistry().register(acmeManifest, createAcmeAdapter);
    expect(registry.ids().at(-1)).toBe("acme");

    const e = engineWith(registry, (s) => {
      s.providers.acme = {
        enabled: true,
        defaultModel: null,
        defaultEffort: "default",
        binaryPath: acmeBin(),
      };
    });
    const fakeHome = tempDir("mordomo-plug-home-");
    fs.mkdirSync(path.join(fakeHome, ".acme"));
    fs.writeFileSync(
      path.join(fakeHome, ".acme", "config.json"),
      JSON.stringify({ mcpServers: { "acme-files": { command: "acme-files-mcp", type: "stdio" } } }),
    );
    const report = runAudit(e.connectors, fakeHome, homeConfigFilesOf(e.providers.manifests()));
    expect(report.scannedFiles).toContain(path.join(fakeHome, ".acme", "config.json"));
    expect(report.discovered.map((d) => d.name)).toContain("acme-files");

    e.skills.save(
      core.SkillFrontmatterSchema.parse({
        name: "Acme skill",
        slug: "acme-skill",
        description: "d",
        providers: ["acme"],
      }),
      "Do it.",
    );
    const target = tempDir("mordomo-plug-sync-");
    const plan = e.sync.plan(target);
    const acme = plan.actions
      .filter((a) => a.provider === "acme")
      .map((a) => path.relative(target, a.filePath));
    expect(acme).toContain(path.join(".acme", "skills", "acme-skill", "SKILL.md"));
    expect(acme).toContain("ACME.md");
  });

  it.skipIf(!FAKE_CLIS_RUNNABLE)("C11 a run on a registered third-party provider executes", async () => {
    const e = engineWith(builtinRegistry().register(acmeManifest, createAcmeAdapter), (s) => {
      s.providers.acme = {
        enabled: true,
        defaultModel: null,
        defaultEffort: "default",
        binaryPath: acmeBin(),
      };
    });
    const record = e.runs.create({
      origin: "manual",
      provider: "acme",
      prompt: "Say OK",
      cwd: e.paths.home,
      model: null,
      effort: "default",
      mode: "read_only",
      timeoutMs: 20_000,
      profile: "read_only",
    });
    const done = await e.runs.execute(record.id, "Say OK", "read_only");
    expect(done.status, done.error ?? "").toBe("done");
    expect(done.provider).toBe("acme");
    const texts = e.runs
      .eventsFor(done.id)
      .map((x) => x.event)
      .filter((ev) => ev.type === "assistant")
      .map((ev) => (ev as { text: string }).text);
    expect(texts).toContain("Working on it.");
  });

  it("C12 a factory must create the adapter its manifest names", () => {
    const registry = new ProviderRegistry().register(acmeManifest, createClaudeAdapter);
    expect(() => registry.create("acme", { binaryPath: null })).toThrow(ProviderRegistryError);
    expect(() => registry.createAll(() => null)).toThrow(ProviderRegistryError);
  });
});

describe("S3 the allowlist comes from the manifests", () => {
  it("C14 the allowlist follows the registered manifests", () => {
    const e = engineWith(builtinRegistry());
    expect(() => assertAllowed("/tmp/x/acme-cli")).toThrow(ExecutableNotAllowedError);
    expect(() => assertAllowed(process.execPath)).not.toThrow();
    e.providers.register(acmeManifest, createAcmeAdapter);
    e.reloadAdapters();
    expect(() => assertAllowed("/tmp/x/acme-cli")).not.toThrow();
    expect(() => assertAllowed("/usr/bin/node")).not.toThrow();
  });

  it("C15 an unregistered binary is not allowed", () => {
    engineWith(new ProviderRegistry().register(claudeManifest, createClaudeAdapter));
    expect(() => assertAllowed("/usr/bin/claude")).not.toThrow();
    expect(() => assertAllowed("/usr/bin/cursor-agent")).toThrow(ExecutableNotAllowedError);
    expect(() => assertAllowed("/usr/bin/codex")).toThrow(ExecutableNotAllowedError);
  });

  it("names a Windows executable without its extension", () => {
    expect(core.executableName("C:\\tools\\Claude.EXE", "win32")).toBe("claude");
    expect(core.executableName("C:\\tools\\codex.cmd", "win32")).toBe("codex");
    expect(core.executableName("/opt/x/claude.exe", "linux")).toBe("claude.exe");
  });
});

describe("the API with an unregistered provider", () => {
  let ctx: AppContext;
  let app: FastifyInstance;
  let token: string;
  let restorePath: () => void;
  let cleanup: () => void;
  const auth = () => ({ "x-mordomo-token": token });
  const runCount = () => (ctx.db.prepare("SELECT COUNT(*) AS n FROM runs").get() as { n: number }).n;

  beforeAll(async () => {
    restorePath = withFakeBinPath();
    const tmp = makeTempHome("mordomo-plug-api-");
    cleanup = tmp.cleanup;
    fs.mkdirSync(path.join(tmp.paths.skills, "say-hi"), { recursive: true });
    fs.writeFileSync(
      path.join(tmp.paths.skills, "say-hi", "SKILL.md"),
      "---\nname: Say hi\ndescription: Says hi.\n---\n\nSay hi.\n",
    );
    fs.mkdirSync(path.join(tmp.paths.skills, "say-write"), { recursive: true });
    fs.writeFileSync(
      path.join(tmp.paths.skills, "say-write", "SKILL.md"),
      "---\nname: Say write\ndescription: Writes hi.\nmode: write\n---\n\nWrite hi.\n",
    );
    ctx = new AppContext(tmp.paths.home);
    const settings = ctx.settings();
    settings.providers.claude.enabled = true;
    settings.providers.claude.binaryPath = path.join(FAKE_BIN, "claude");
    settings.setupCompleted = true;
    ctx.settingsStore.save(settings);
    ctx.reloadAdapters();
    token = ctx.token();
    app = await buildServer(ctx);
  });

  afterAll(async () => {
    await app.close();
    ctx.close();
    restorePath();
    cleanup();
  });

  const expectUnknown = (res: { statusCode: number; json: () => { error: { code: string } } }) => {
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe("unknown_provider");
  };

  it("C4 a run on an unregistered provider is refused", async () => {
    const before = runCount();
    const res = await app.inject({
      method: "POST",
      url: "/api/runs",
      headers: auth(),
      payload: { prompt: "hi", provider: "gemini" },
    });
    expectUnknown(res);
    expect(runCount()).toBe(before);
  });

  it("C5 every route taking a provider refuses an unregistered one", async () => {
    const before = runCount();
    expectUnknown(
      await app.inject({
        method: "POST",
        url: "/api/skills/say-hi/run",
        headers: auth(),
        payload: { provider: "gemini" },
      }),
    );
    // A conversation recorded on a provider that is no longer registered cannot be continued.
    const session = ctx.runs.sessions.create({
      provider: "gemini",
      cwd: ctx.paths.home,
      profile: "read_only",
      title: "old",
    });
    expectUnknown(
      await app.inject({
        method: "POST",
        url: `/api/sessions/${session.id}/continue`,
        headers: auth(),
        payload: { prompt: "hi" },
      }),
    );
    expectUnknown(
      await app.inject({
        method: "POST",
        url: "/api/routines",
        headers: auth(),
        payload: {
          id: "gemini-check",
          name: "Gemini check",
          prompt: "hi",
          schedule: "0 9 * * *",
          provider: "gemini",
        },
      }),
    );
    expect(ctx.routines.get("gemini-check")).toBeNull();
    expect(runCount()).toBe(before);
  });

  it("C8 provider routes answer 400 for an unregistered id", async () => {
    expectUnknown(await app.inject({ method: "POST", url: "/api/providers/gemini/detect", headers: auth() }));
    expectUnknown(await app.inject({ method: "GET", url: "/api/providers/gemini/models", headers: auth() }));
  });

  const receiptCount = () =>
    (ctx.db.prepare("SELECT COUNT(*) AS n FROM run_action_receipts").get() as { n: number }).n;
  /** A run recorded on `gemini` (a provider since removed), with the complete request a retry repeats. */
  const recordedOnGemini = (request: RunRequestSpec) =>
    ctx.runs.create({
      origin: request.kind === "skill" ? "skill" : "manual",
      provider: "gemini",
      prompt: "recorded",
      request,
      cwd: ctx.paths.home,
      model: null,
      effort: "default",
      mode: request.mode,
      timeoutMs: 10_000,
      profile: "review_before_write",
      skillSlug: request.kind === "skill" ? request.skillSlug : null,
    });

  it("C22 a retry of a run recorded on an unregistered provider is refused", async () => {
    const shapes: Array<[string, RunRequestSpec]> = [
      ["skill write", { version: 1, kind: "skill", skillSlug: "say-write", inputs: {}, mode: "write" }],
      ["skill read_only", { version: 1, kind: "skill", skillSlug: "say-hi", inputs: {}, mode: "read_only" }],
      ["plain prompt", { version: 1, kind: "prompt", prompt: "hi", mode: "read_only" }],
    ];
    for (const [shape, request] of shapes) {
      const source = recordedOnGemini(request);
      const runs = runCount();
      const receipts = receiptCount();
      const res = await app.inject({
        method: "POST",
        url: `/api/runs/${source.id}/retry`,
        headers: auth(),
        payload: { submissionId: crypto.randomUUID() },
      });
      expect(res.statusCode, `${shape}: ${res.body}`).toBe(400);
      expect(res.json().error.code, shape).toBe("unknown_provider");
      // Refused before anything is queued: no run, no receipt.
      expect(runCount(), shape).toBe(runs);
      expect(receiptCount(), shape).toBe(receipts);
    }
  });

  it("C23 each remaining route taking a provider refuses an unregistered one", async () => {
    ctx.routines.save(
      RoutineSchema.parse({ id: "claude-check", name: "Claude check", prompt: "hi", schedule: "0 9 * * *" }),
    );
    ctx.routines.save(
      RoutineSchema.parse({
        id: "gemini-stored",
        name: "Gemini stored",
        prompt: "hi",
        schedule: "0 9 * * *",
        provider: "gemini",
      }),
    );
    const parent = ctx.runs.create({
      origin: "manual",
      provider: "claude",
      prompt: "parent",
      cwd: ctx.paths.home,
      model: null,
      effort: "default",
      mode: "read_only",
      timeoutMs: 10_000,
      profile: "read_only",
    });
    const objective = await app.inject({
      method: "POST",
      url: "/api/objectives",
      headers: auth(),
      payload: {
        title: "Gemini objective",
        steps: [{ title: "Step", request: { version: 1, kind: "prompt", prompt: "hi", mode: "read_only" } }],
      },
    });
    expect(objective.statusCode, objective.body).toBe(200);
    const objectiveId = objective.json().id as string;
    const settingsBefore = fs.readFileSync(ctx.paths.settingsFile);
    const runs = runCount();

    const routes: Array<{ method: "POST" | "PUT"; url: string; payload?: unknown }> = [
      {
        method: "PUT",
        url: "/api/routines/claude-check",
        payload: { name: "Claude check", prompt: "hi", schedule: "0 9 * * *", provider: "gemini" },
      },
      { method: "POST", url: "/api/routines/gemini-stored/run" },
      {
        method: "POST",
        url: `/api/runs/${parent.id}/children`,
        payload: { prompts: ["hi"], provider: "gemini" },
      },
      { method: "POST", url: `/api/objectives/${objectiveId}/dispatch`, payload: { provider: "gemini" } },
      { method: "PUT", url: "/api/providers/default", payload: { provider: "gemini" } },
      { method: "POST", url: "/api/providers/gemini/smoke" },
      {
        method: "PUT",
        url: "/api/settings",
        payload: { providers: { gemini: { binaryPath: "/opt/x/gemini" } } },
      },
    ];
    for (const route of routes) {
      const res = await app.inject({ ...route, headers: auth() } as Parameters<typeof app.inject>[0]);
      const label = `${route.method} ${route.url}`;
      expect(res.statusCode, `${label}: ${res.body}`).toBe(400);
      expect(res.json().error.code, label).toBe("unknown_provider");
    }
    // Nothing was created or changed by any of them.
    expect(ctx.routines.get("claude-check")?.provider).toBe("claude");
    expect(runCount()).toBe(runs);
    expect(ctx.objectives.get(objectiveId)?.steps.every((step) => step.runId == null)).toBe(true);
    expect(fs.readFileSync(ctx.paths.settingsFile).equals(settingsBefore)).toBe(true);
  });

  it("C24 the write gate refuses an unregistered provider with a mapped error", () => {
    let thrown: unknown = null;
    try {
      ctx.gateWrite("write", "skill", "Write-mode skill run: /say-write with gemini", {
        kind: "skill",
        input: {
          slug: "say-write",
          inputs: {},
          provider: "gemini",
          model: null,
          effort: "default",
          cwd: ctx.paths.home,
          timeoutMs: 10_000,
        },
      });
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(Error);
    expect(thrown).not.toBeInstanceOf(ProviderRegistryError);
    expect(thrown).toMatchObject({ statusCode: 400, code: "unknown_provider" });
  });

  it("C13 each snapshot carries the login command", async () => {
    const res = await app.inject({ method: "GET", url: "/api/providers", headers: auth() });
    expect(res.statusCode).toBe(200);
    const byId = Object.fromEntries(
      (res.json() as Array<{ id: string; loginCommand: string }>).map((s) => [s.id, s.loginCommand]),
    );
    expect(byId).toEqual({ claude: "claude auth login", cursor: "cursor-agent login", codex: "codex login" });
  });

  it("C16 a binary path of another program is refused", async () => {
    const before = fs.readFileSync(ctx.paths.settingsFile);
    const res = await app.inject({
      method: "PUT",
      url: "/api/settings",
      headers: auth(),
      payload: { providers: { claude: { binaryPath: "/bin/sh" } } },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe("binary_mismatch");
    expect(fs.readFileSync(ctx.paths.settingsFile).equals(before)).toBe(true);
  });

  it("C17 a binary path of the right program is accepted", async () => {
    const put = (binaryPath: string | null) =>
      app.inject({
        method: "PUT",
        url: "/api/settings",
        headers: auth(),
        payload: { providers: { claude: { binaryPath } } },
      });
    const posix = await put("/opt/x/claude");
    expect(posix.statusCode, posix.body).toBe(200);
    expect(ctx.settings().providers.claude.binaryPath).toBe("/opt/x/claude");

    const platform = Object.getOwnPropertyDescriptor(process, "platform")!;
    Object.defineProperty(process, "platform", { ...platform, value: "win32" });
    let windows;
    try {
      windows = await put("C:\\tools\\claude.exe");
    } finally {
      Object.defineProperty(process, "platform", platform);
    }
    expect(windows.statusCode, windows.body).toBe(200);
    expect(ctx.settings().providers.claude.binaryPath).toBe("C:\\tools\\claude.exe");

    const cleared = await put(null);
    expect(cleared.statusCode, cleared.body).toBe(200);
    expect(ctx.settings().providers.claude.binaryPath).toBeNull();
  });
});

describe.skipIf(!FAKE_CLIS_RUNNABLE)("a stored binary path of another program", () => {
  let ctx: AppContext | null = null;
  let app: FastifyInstance | null = null;
  let restorePath: (() => void) | null = null;
  afterAll(async () => {
    await app?.close();
    ctx?.close();
    restorePath?.();
  });

  it("C25 a stored mismatched binary path is never executed and doctor names it", async () => {
    restorePath = withFakeBinPath();
    const home = tempDir("mordomo-plug-stored-");
    const bin = tempDir("mordomo-plug-notclaude-");
    const marker = path.join(bin, "notclaude-ran");
    const notclaude = path.join(bin, "notclaude");
    fs.writeFileSync(notclaude, `#!/bin/sh\ntouch "${marker}"\n`);
    fs.chmodSync(notclaude, 0o755);
    // Written straight to settings.json, as a value stored before the check existed (or edited by hand).
    const paths = resolvePaths(home);
    fs.mkdirSync(paths.config, { recursive: true });
    fs.writeFileSync(
      paths.settingsFile,
      JSON.stringify({
        version: 2,
        setupCompleted: true,
        providers: { claude: { enabled: true, binaryPath: notclaude } },
      }),
    );
    ctx = new AppContext(home);
    app = await buildServer(ctx);
    const auth = { "x-mordomo-token": ctx.token() };

    const runOnce = async () => {
      const record = ctx!.runs.create({
        origin: "manual",
        provider: "claude",
        prompt: "Say OK",
        cwd: home,
        model: null,
        effort: "default",
        mode: "read_only",
        timeoutMs: 20_000,
        profile: "read_only",
      });
      return ctx!.runs.execute(record.id, "Say OK", "read_only");
    };
    const assistantTexts = (runId: string) =>
      ctx!.runs
        .eventsFor(runId)
        .map((x) => x.event)
        .filter((ev) => ev.type === "assistant")
        .map((ev) => (ev as { text: string }).text);
    const ignoredWarning = async () => {
      const res = await app!.inject({ method: "GET", url: "/api/doctor?audit=0", headers: auth });
      expect(res.statusCode).toBe(200);
      return (res.json() as { checks: Array<{ status: string; label: string; detail: string }> }).checks.find(
        (c) => c.status === "warn" && c.label.includes("claude") && c.detail.includes(notclaude),
      );
    };

    // The fake claude on PATH runs instead of the stored path.
    const first = await runOnce();
    expect(first.status, first.error ?? "").toBe("done");
    expect(assistantTexts(first.id)).toContain("Working on it.");
    expect(fs.existsSync(marker)).toBe(false);
    expect(await ignoredWarning()).toBeDefined();

    // The UI re-sends every provider on save: the stored value unchanged is accepted, and stays ignored.
    const resend = await app.inject({
      method: "PUT",
      url: "/api/settings",
      headers: auth,
      payload: { providers: { claude: { enabled: true, binaryPath: notclaude } } },
    });
    expect(resend.statusCode, resend.body).toBe(200);
    const second = await runOnce();
    expect(second.status, second.error ?? "").toBe("done");
    expect(fs.existsSync(marker)).toBe(false);
    expect(await ignoredWarning()).toBeDefined();

    // A new mismatched value is still refused.
    const fresh = await app.inject({
      method: "PUT",
      url: "/api/settings",
      headers: auth,
      payload: { providers: { claude: { binaryPath: "/bin/sh" } } },
    });
    expect(fresh.statusCode).toBe(400);
    expect(fresh.json().error.code).toBe("binary_mismatch");
  });

  it("C29 the stored binary path check follows the platform's executable names", () => {
    const registry = new core.ProviderRegistry()
      .register(claudeManifest, createClaudeAdapter)
      .register(codexManifest, createCodexAdapter);
    const ignored = (binaryPath: string | null, platform: NodeJS.Platform) =>
      core
        .ignoredBinaryPaths(
          registry,
          core.SettingsSchema.parse({ providers: { claude: { binaryPath } } }),
          platform,
        )
        .map((i) => i.provider);
    // Windows: the suffix and the case are not part of the name.
    expect(ignored("C:\\tools\\claude.exe", "win32")).toEqual([]);
    expect(ignored("C:\\tools\\CLAUDE.CMD", "win32")).toEqual([]);
    expect(ignored("C:\\tools\\sh.exe", "win32")).toEqual(["claude"]);
    // POSIX: the name is exact.
    expect(ignored("/opt/x/claude", "linux")).toEqual([]);
    expect(ignored("/opt/x/claude.exe", "linux")).toEqual(["claude"]);
    expect(ignored("/bin/sh", "darwin")).toEqual(["claude"]);
    // Nothing stored, nothing ignored.
    expect(ignored(null, "linux")).toEqual([]);
    expect(ignored(null, "win32")).toEqual([]);
  });

  it("C30 doctor says nothing about binary paths when none is ignored", async () => {
    // One context per test: close the one the previous test left.
    await app?.close();
    ctx?.close();
    const home = tempDir("mordomo-plug-doctor-");
    ctx = new AppContext(home);
    app = await buildServer(ctx);
    const res = await app.inject({
      method: "GET",
      url: "/api/doctor?audit=0",
      headers: { "x-mordomo-token": ctx.token() },
    });
    expect(res.statusCode).toBe(200);
    const checks = (res.json() as { checks: Array<{ id: string }> }).checks;
    expect(checks.filter((c) => /^provider-.*-binary-path$/.test(c.id))).toEqual([]);
  });

  it("C31 approving a parked write on a removed provider is refused and stays pending", async () => {
    // One context per test: close the one the previous test left.
    await app?.close();
    ctx?.close();
    const home = tempDir("mordomo-plug-approve-");
    ctx = new AppContext(home);
    app = await buildServer(ctx);
    const approval = ctx.approvals.request("write_run", "Write with a provider that was removed", {
      kind: "prompt",
      input: {
        prompt: "x",
        provider: "gemini",
        model: null,
        effort: "default",
        mode: "write",
        cwd: home,
        timeoutMs: 1000,
      },
    });
    const res = await app.inject({
      method: "POST",
      url: `/api/approvals/${approval.id}/resolve`,
      headers: { "x-mordomo-token": ctx.token() },
      payload: { decision: "approved" },
    });
    expect(res.statusCode, res.body).toBe(400);
    expect(res.json().error.code).toBe("unknown_provider");
    expect(ctx.approvals.get(approval.id)?.status).toBe("pending");
    expect(ctx.runs.list({ limit: 10 })).toHaveLength(0);
  });
});

/** The Command Centre sources a hard-coded provider list could hide in (no tests, no gallery). */
function uiSources(): Array<{ rel: string; source: string }> {
  const root = path.join(repoRoot, "apps", "command-centre", "src");
  const out: Array<{ rel: string; source: string }> = [];
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name !== "gallery") walk(full);
        continue;
      }
      if (!/\.(ts|tsx)$/.test(entry.name) || /\.test\./.test(entry.name)) continue;
      out.push({ rel: path.relative(root, full), source: fs.readFileSync(full, "utf8") });
    }
  };
  walk(root);
  return out;
}

const BUILTIN_IDS = new Set(["claude", "cursor", "codex"]);

/**
 * Maps of the built-in providers in disguise, read from the syntax tree (so text
 * in strings and comments never counts): object literals with at least two
 * built-in ids among their own keys (plain, quoted, computed `["claude"]`,
 * shorthand `{ claude, cursor }`, methods), and arrays of `[id, value]` pairs
 * naming at least two (what `new Map(…)` and `Object.fromEntries(…)` take).
 * Destructuring patterns and types are not values and are not flagged.
 */
function builtinKeyedObjects(source: string, fileName = "source.tsx"): string[] {
  const file = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const literalText = (node: ts.Node | undefined): string | null =>
    node && (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) ? node.text : null;
  const keyOf = (name: ts.PropertyName): string | null => {
    if (ts.isIdentifier(name) || ts.isPrivateIdentifier(name)) return name.text;
    if (ts.isComputedPropertyName(name)) return literalText(name.expression);
    return literalText(name);
  };
  const found: string[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isObjectLiteralExpression(node)) {
      const keys = new Set<string>();
      for (const prop of node.properties) {
        const name = ts.isShorthandPropertyAssignment(prop)
          ? prop.name.text
          : prop.name
            ? keyOf(prop.name)
            : null;
        if (name && BUILTIN_IDS.has(name)) keys.add(name);
      }
      if (keys.size >= 2) found.push(node.getText(file));
    } else if (ts.isArrayLiteralExpression(node)) {
      const ids = new Set(
        node.elements
          .map((el) => (ts.isArrayLiteralExpression(el) ? literalText(el.elements[0]) : null))
          .filter((id): id is string => id !== null && BUILTIN_IDS.has(id)),
      );
      if (ids.size >= 2) found.push(node.getText(file));
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return found;
}

describe("S4 the UI lists the registered providers", () => {
  it("C18 the UI has no hard-coded provider list", () => {
    const offenders: string[] = [];
    for (const { rel, source } of uiSources()) {
      for (const literal of source.match(/\[[^[\]]*\]/g) ?? []) {
        if (["claude", "cursor", "codex"].every((id) => new RegExp(`["'\`]${id}["'\`]`).test(literal)))
          offenders.push(`${rel}: ${literal.replace(/\s+/g, " ").slice(0, 80)}`);
      }
      if (/Record<\s*ProviderId\s*,/.test(source)) offenders.push(`${rel}: Record<ProviderId, …>`);
    }
    expect(offenders).toEqual([]);
  });

  it("C28 the UI has no map keyed by the built-in provider ids", () => {
    // The detector itself: it must see the shapes it is meant to refuse.
    expect(builtinKeyedObjects('const m = { claude: "claude auth login", cursor: "x" };')).toHaveLength(1);
    expect(builtinKeyedObjects('({ "codex": { a: 1 }, claude: 2 })[id]')).toHaveLength(1);
    expect(builtinKeyedObjects("const one = { claude: 1, other: 2 };")).toEqual([]);
    // Round-2 false negatives: computed keys, shorthand, a comment before the key, methods, pairs.
    expect(builtinKeyedObjects('const m = { ["claude"]: 1, ["codex"]: 2 };')).toHaveLength(1);
    expect(builtinKeyedObjects("const m = { claude, cursor };")).toHaveLength(1);
    expect(builtinKeyedObjects("const m = { /* login */ claude: 1, // x\n cursor: 2 };")).toHaveLength(1);
    expect(builtinKeyedObjects("const m = { claude() { return 1; }, codex() { return 2; } };")).toHaveLength(
      1,
    );
    expect(builtinKeyedObjects('new Map([["claude", "a"], ["cursor", "b"]]);')).toHaveLength(1);
    expect(builtinKeyedObjects('Object.fromEntries([["codex", 1], ["claude", 2]]);')).toHaveLength(1);
    // Round-2 false positives: text in strings and comments, destructuring, types.
    expect(builtinKeyedObjects('const s = "{ claude: 1, cursor: 2 }"; // { claude: 1, codex: 2 }')).toEqual(
      [],
    );
    expect(builtinKeyedObjects("const { claude: a, cursor: b } = snapshots;")).toEqual([]);
    expect(
      builtinKeyedObjects("function f({ claude, codex }: { claude: string; codex: string }) {}"),
    ).toEqual([]);
    const offenders = uiSources().flatMap(({ rel, source }) =>
      builtinKeyedObjects(source, rel).map((obj) => `${rel}: ${obj.replace(/\s+/g, " ").slice(0, 80)}`),
    );
    expect(offenders).toEqual([]);
  });
});
