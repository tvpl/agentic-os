import { afterEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  BUILTIN_MANIFESTS,
  ProviderRegistry,
  SettingsStore,
  createEngine,
  resolvePaths,
  type MordomoEngine,
  type ProviderId,
  type RunRecord,
  type SecurityProfile,
  type Settings,
} from "@mordomo/core";
import { claudeManifest, createClaudeAdapter } from "@mordomo/adapter-claude";
import { codexManifest, createCodexAdapter } from "@mordomo/adapter-codex";
import { cursorManifest, createCursorAdapter } from "@mordomo/adapter-cursor";
import { FAKE_BIN, FAKE_CLIS_RUNNABLE, withFakeBinPath } from "./helpers.js";

/**
 * Applied capabilities (.specs/features/capacidades-aplicadas): an unattended
 * read-only run needs a provider that enforces read-only, an unconfined write
 * needs a human, and provider processes never inherit MordomoOS's secrets.
 */

const homes: string[] = [];
const engines: MordomoEngine[] = [];
let restorePath: (() => void) | null = null;

afterEach(async () => {
  for (const engine of engines.splice(0)) await engine.stop(500).catch(() => undefined);
  for (const home of homes.splice(0)) fs.rmSync(home, { recursive: true, force: true });
  restorePath?.();
  restorePath = null;
});

function engine(patch: (s: Settings) => void = () => undefined): MordomoEngine {
  restorePath = withFakeBinPath();
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "mordomo-cap-"));
  homes.push(home);
  const store = new SettingsStore(resolvePaths(home));
  const settings = store.load();
  settings.providers.claude.enabled = true;
  settings.providers.claude.binaryPath = path.join(FAKE_BIN, "claude");
  settings.providers.cursor.enabled = true;
  settings.providers.cursor.binaryPath = path.join(FAKE_BIN, "cursor-agent");
  settings.providers.codex.enabled = true;
  settings.providers.codex.binaryPath = path.join(FAKE_BIN, "codex");
  patch(settings);
  store.save(settings);
  const e = createEngine({
    home,
    seedDir: null,
    providers: new ProviderRegistry()
      .register(claudeManifest, createClaudeAdapter)
      .register(cursorManifest, createCursorAdapter)
      .register(codexManifest, createCodexAdapter),
  });
  engines.push(e);
  return e;
}

async function run(
  e: MordomoEngine,
  provider: ProviderId,
  origin: "manual" | "routine" | "sentinel",
  prompt = "Say OK",
): Promise<RunRecord> {
  const record = e.runs.create({
    origin,
    provider,
    prompt,
    cwd: e.paths.home,
    model: null,
    effort: "default",
    mode: "read_only",
    timeoutMs: 20_000,
    profile: "read_only",
  });
  return e.runs.execute(record.id, prompt, "read_only");
}

const types = (e: MordomoEngine, id: string) => e.runs.eventsFor(id).map((x) => x.event.type);
const permissions = (e: MordomoEngine, id: string) =>
  e.runs
    .eventsFor(id)
    .map((x) => x.event)
    .filter((ev) => ev.type === "permission")
    .map((ev) => (ev as { detail: string }).detail);

describe.skipIf(!FAKE_CLIS_RUNNABLE)("S1 unattended read-only needs a provider that enforces it", () => {
  it("C1 an unattended read-only run refuses a provider that cannot enforce it", async () => {
    const e = engine();
    const done = await run(e, "cursor", "routine");
    expect(done.status).toBe("failed");
    expect(done.error).toContain("cannot enforce read-only");
    expect(types(e, done.id)).not.toContain("started");
  });

  it("C2 a sentinel read-only run refuses it too", async () => {
    const e = engine();
    const done = await run(e, "cursor", "sentinel");
    expect(done.status).toBe("failed");
    expect(done.error).toContain("cannot enforce read-only");
    expect(types(e, done.id)).not.toContain("started");
  });

  it("C3 a manual read-only run on cursor runs with a warning", async () => {
    const e = engine();
    const done = await run(e, "cursor", "manual");
    expect(done.status).toBe("done");
    expect(permissions(e, done.id).some((d) => d.includes("only requested in the prompt"))).toBe(true);
  });

  it("C4 an unattended read-only run on claude runs normally", async () => {
    const e = engine();
    const done = await run(e, "claude", "routine");
    expect(done.status).toBe("done");
    expect(permissions(e, done.id).some((d) => d.includes("only requested in the prompt"))).toBe(false);
  });
});

describe("S2 an unconfined write needs a human", () => {
  it("C5 every builtin manifest declares its write confinement", () => {
    expect(BUILTIN_MANIFESTS.claude.capabilities.writeConfinement).toBe("broker");
    expect(BUILTIN_MANIFESTS.codex.capabilities.writeConfinement).toBe("sandbox");
    expect(BUILTIN_MANIFESTS.cursor.capabilities.writeConfinement).toBe("none");
  });

  const gate = (e: MordomoEngine, provider: ProviderId) =>
    e.gateWrite("write", "manual", "change it", {
      kind: "prompt",
      input: {
        prompt: "change it",
        provider,
        model: null,
        effort: "default",
        mode: "write",
        cwd: e.paths.home,
        timeoutMs: 60_000,
      },
    });
  const withProfile = (profile: SecurityProfile) =>
    engine((s) => {
      s.securityProfile = profile;
    });

  it("C6 controlled_write parks an unconfined write", () => {
    const e = withProfile("controlled_write");
    const g = gate(e, "cursor");
    expect(g.pendingApproval?.kind).toBe("write_run");
    expect(e.runs.get(g.runId!)!.status).toBe("waiting_approval");
  });

  it("C7 controlled_write lets confined writes through", () => {
    const e = withProfile("controlled_write");
    expect(gate(e, "claude")).toEqual({ pendingApproval: null, runId: null });
    expect(gate(e, "codex")).toEqual({ pendingApproval: null, runId: null });
  });

  it("C8 approved_automation lets an unconfined write through", () => {
    const e = withProfile("approved_automation");
    expect(gate(e, "cursor")).toEqual({ pendingApproval: null, runId: null });
  });

  it("C9 the API answers 202 for an unconfined write", async () => {
    restorePath = withFakeBinPath();
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "mordomo-cap-api-"));
    homes.push(home);
    const { AppContext } = await import("../apps/api/src/context.js");
    const { buildServer } = await import("../apps/api/src/server.js");
    const ctx = new AppContext(home);
    const settings = ctx.settings();
    settings.setupCompleted = true;
    settings.securityProfile = "controlled_write";
    settings.providers.cursor.enabled = true;
    settings.providers.cursor.binaryPath = path.join(FAKE_BIN, "cursor-agent");
    ctx.settingsStore.save(settings);
    ctx.reloadAdapters();
    const app = await buildServer(ctx);
    try {
      const res = await app.inject({
        method: "POST",
        url: "/api/runs",
        headers: { "x-mordomo-token": ctx.token(), "content-type": "application/json" },
        payload: { prompt: "change something", mode: "write", provider: "cursor" },
      });
      expect(res.statusCode).toBe(202);
      expect(res.json().status).toBe("waiting_approval");
      expect(res.json().pendingApproval.kind).toBe("write_run");
    } finally {
      await ctx.runs.shutdown(1000);
      await app.close();
      ctx.close();
    }
  });
});

describe.skipIf(!FAKE_CLIS_RUNNABLE)("S3 provider processes never inherit MordomoOS secrets", () => {
  const saved: Record<string, string | undefined> = {};
  const setEnv = (vars: Record<string, string>) => {
    for (const [k, v] of Object.entries(vars)) {
      saved[k] = process.env[k];
      process.env[k] = v;
    }
  };
  afterEach(() => {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
      delete saved[k];
    }
  });

  async function envNames(e: MordomoEngine): Promise<string[]> {
    const done = await run(e, "claude", "manual", "[[env]]");
    expect(done.status).toBe("done");
    const text = e.runs.lastAssistantText(done.id) ?? "";
    expect(text.startsWith("ENV: ")).toBe(true);
    return text.slice(5).trim().split(/\s+/);
  }

  it("C10 no MORDOMO_ variable reaches the provider", async () => {
    setEnv({ MORDOMO_SECRET_X: "s3cret", MORDOMO_TELEGRAM_TOKEN: "123:abc" });
    const names = await envNames(engine());
    expect(names.filter((n) => n.startsWith("MORDOMO_"))).toEqual([]);
  });

  it("C11 the configured bot token variable never reaches the provider", async () => {
    setEnv({ TG_BOT_TOKEN: "123:abc" });
    const e = engine((s) => {
      s.channels.telegram.botTokenEnv = "TG_BOT_TOKEN";
    });
    expect(await envNames(e)).not.toContain("TG_BOT_TOKEN");
  });

  it("C12 the provider keeps the rest of the environment", async () => {
    setEnv({ ANTHROPIC_API_KEY: "sk-ant-test" });
    const names = await envNames(engine());
    expect(names).toContain("PATH");
    expect(names).toContain("HOME");
    expect(names).toContain("ANTHROPIC_API_KEY");
  });
});

describe.skipIf(!FAKE_CLIS_RUNNABLE)("round 2: members the first verification found unproven", () => {
  it("C13 a skill read-only run on cursor runs with a warning", async () => {
    const e = engine();
    const record = e.runs.create({
      origin: "skill",
      provider: "cursor",
      prompt: "Say OK",
      cwd: e.paths.home,
      model: null,
      effort: "default",
      mode: "read_only",
      timeoutMs: 20_000,
      profile: "read_only",
    });
    const done = await e.runs.execute(record.id, "Say OK", "read_only");
    expect(done.status).toBe("done");
    expect(permissions(e, done.id).some((d) => d.includes("only requested in the prompt"))).toBe(true);
  });

  it("C14 provider probes do not inherit MordomoOS secrets", async () => {
    const dump = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "mordomo-dump-")), "env.txt");
    homes.push(path.dirname(dump));
    const vars = { FAKE_ENV_DUMP: dump, MORDOMO_SECRET_X: "s3cret", TG_BOT_TOKEN: "123:abc" };
    const saved = Object.fromEntries(Object.keys(vars).map((k) => [k, process.env[k]]));
    Object.assign(process.env, vars);
    try {
      const e = engine((s) => {
        s.channels.telegram.botTokenEnv = "TG_BOT_TOKEN";
      });
      e.reloadAdapters();
      await e.adapters.claude.detect();
      await e.adapters.claude.authenticate();
    } finally {
      for (const [k, v] of Object.entries(saved)) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      }
    }
    const names = fs.readFileSync(dump, "utf8").split("\n").filter(Boolean);
    expect(names.length).toBeGreaterThan(0);
    expect(names.filter((n) => n.startsWith("MORDOMO_"))).toEqual([]);
    expect(names).not.toContain("TG_BOT_TOKEN");
    expect(names).toContain("PATH");
  });

  it("C15 the skill route answers 202 for an unconfined write skill", async () => {
    restorePath = withFakeBinPath();
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "mordomo-cap-skill-"));
    homes.push(home);
    const skillDir = path.join(resolvePaths(home).skills, "tidy-notes");
    fs.mkdirSync(skillDir, { recursive: true });
    fs.writeFileSync(
      path.join(skillDir, "SKILL.md"),
      "---\nname: Tidy notes\ndescription: Rename notes to the house style.\nmode: write\nproviders: [claude, cursor]\n---\n\n# Tidy notes\n\nRename the notes.\n",
    );
    const { AppContext } = await import("../apps/api/src/context.js");
    const { buildServer } = await import("../apps/api/src/server.js");
    const ctx = new AppContext(home);
    const settings = ctx.settings();
    settings.setupCompleted = true;
    settings.securityProfile = "controlled_write";
    settings.providers.cursor.enabled = true;
    settings.providers.cursor.binaryPath = path.join(FAKE_BIN, "cursor-agent");
    ctx.settingsStore.save(settings);
    ctx.reloadAdapters();
    const app = await buildServer(ctx);
    try {
      const res = await app.inject({
        method: "POST",
        url: "/api/skills/tidy-notes/run",
        headers: { "x-mordomo-token": ctx.token(), "content-type": "application/json" },
        payload: { provider: "cursor", inputs: {} },
      });
      expect(res.statusCode).toBe(202);
      expect(res.json().status).toBe("waiting_approval");
      expect(res.json().pendingApproval.kind).toBe("write_run");
      expect(res.json().pendingApproval.payload.kind).toBe("skill");
    } finally {
      await ctx.runs.shutdown(1000);
      await app.close();
      ctx.close();
    }
  });
});
