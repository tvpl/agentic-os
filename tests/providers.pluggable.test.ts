import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import type { FastifyInstance } from "fastify";
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

describe("S4 the UI lists the registered providers", () => {
  it("C18 the UI has no hard-coded provider list", () => {
    const root = path.join(repoRoot, "apps", "command-centre", "src");
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          if (entry.name !== "gallery") walk(full);
          continue;
        }
        if (!/\.(ts|tsx)$/.test(entry.name) || /\.test\./.test(entry.name)) continue;
        const source = fs.readFileSync(full, "utf8");
        const rel = path.relative(root, full);
        for (const literal of source.match(/\[[^[\]]*\]/g) ?? []) {
          if (["claude", "cursor", "codex"].every((id) => new RegExp(`["'\`]${id}["'\`]`).test(literal)))
            offenders.push(`${rel}: ${literal.replace(/\s+/g, " ").slice(0, 80)}`);
        }
        if (/Record<\s*ProviderId\s*,/.test(source)) offenders.push(`${rel}: Record<ProviderId, …>`);
      }
    };
    walk(root);
    expect(offenders).toEqual([]);
  });
});
