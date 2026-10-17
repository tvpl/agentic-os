import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  ProviderRegistry,
  createEngine,
  type AdapterFactory,
  type AdapterFactoryOptions,
  type AgentAdapter,
  type AgentRun,
  type Engine,
  type EngineOptions,
  type ProviderCapabilities,
  type ProviderManifest,
  type RunEvent,
  type SecurityProfile,
} from "@mordomo/core";
import type { MordomoEngine } from "@mordomo/core/internal";

/**
 * Support for the SDK tests (.specs/features/sdk-core): an adapter that runs in this process, so a test needs no CLI,
 * and the homes and engines a test builds. Only the public surface of `@mordomo/core` is used to build and drive an
 * engine; `internals()` is for the assertions about what an engine left behind.
 */

export interface EchoOptions {
  id?: string;
  /** The binary the manifest names (the spawn allowlist is built from it). */
  binary?: string;
  /** What the provider answers. */
  reply?: string;
  readConfinement?: ProviderCapabilities["readConfinement"];
  writeConfinement?: ProviderCapabilities["writeConfinement"];
}

export interface EchoState {
  /** How many times the engine handed a run to the provider. */
  calls: number;
  /** The runs it was handed, in order. */
  runs: AgentRun[];
  /** While true a run waits (until `release()` or until it is cancelled). */
  hold: boolean;
  /** Set to make the next `execute` throw this message. */
  failWith: string | null;
  /** The options the engine gave the factory, one entry per adapter it built. */
  factoryOptions: AdapterFactoryOptions[];
  release(): void;
}

export interface EchoProvider {
  manifest: ProviderManifest;
  factory: AdapterFactory;
  state: EchoState;
}

/** A provider that answers in this process: three events (`text`, `text`, `result`); it waits between the first two while `state.hold`. */
export function echoProvider(options: EchoOptions = {}): EchoProvider {
  const id = options.id ?? "echo";
  let wake: (() => void) | null = null;
  const state: EchoState = {
    calls: 0,
    runs: [],
    hold: false,
    failWith: null,
    factoryOptions: [],
    release() {
      state.hold = false;
      wake?.();
    },
  };
  const manifest: ProviderManifest = {
    id,
    displayName: `Echo ${id}`,
    binary: options.binary ?? `${id}-cli`,
    installHint: "nothing to install: the provider runs in this process",
    loginCommand: `${id} login`,
    capabilities: {
      enforcesReadOnly: true,
      supportsEffort: false,
      promptTransport: "stdin",
      streaming: true,
      resume: "none",
      writeConfinement: options.writeConfinement ?? "broker",
      readConfinement: options.readConfinement ?? "workdir",
    },
    layout: { instructionsFile: "AGENTS.md", skillsDir: null, rulesFile: null, commandsDir: null },
    homeConfigFiles: [],
    writeToolPattern: /^write/i,
  };
  const adapter: AgentAdapter = {
    id,
    manifest,
    detect: async () => ({
      installed: true,
      binaryPath: null,
      version: "1.0.0",
      supportedFlags: [],
      notes: [],
    }),
    authenticate: async () => ({ authenticated: true, method: "none", detail: "in-process" }),
    listModels: async () => [],
    validateConfig: async () => ({ ok: true, issues: [] }),
    buildInvocation: async () => ({ executable: "node", args: [], env: {}, description: "in-process" }),
    healthCheck: async () => ({
      ok: true,
      installed: true,
      authenticated: true,
      version: "1.0.0",
      detail: "in-process",
      checkedAt: Date.now(),
    }),
    async *execute(run: AgentRun): AsyncIterable<RunEvent> {
      state.calls += 1;
      state.runs.push(run);
      const started = Date.now();
      if (state.failWith !== null) {
        const message = state.failWith;
        state.failWith = null;
        throw new Error(message);
      }
      yield { type: "text", ts: Date.now(), stream: "stdout", text: "working" };
      while (state.hold && !run.signal?.aborted) {
        await new Promise<void>((resolve) => {
          wake = resolve;
          run.signal?.addEventListener("abort", () => resolve(), { once: true });
        });
      }
      if (run.signal?.aborted) {
        yield {
          type: "result",
          ts: Date.now(),
          exitCode: null,
          summary: "cancelled",
          durationMs: Date.now() - started,
          timedOut: false,
          cancelled: true,
        };
        return;
      }
      const reply = options.reply ?? "MORDOMO_OK";
      yield { type: "text", ts: Date.now(), stream: "stdout", text: reply };
      yield {
        type: "result",
        ts: Date.now(),
        exitCode: 0,
        summary: reply,
        durationMs: Date.now() - started,
        timedOut: false,
      };
    },
  };
  const factory: AdapterFactory = (factoryOptions) => {
    state.factoryOptions.push(factoryOptions);
    return adapter;
  };
  return { manifest, factory, state };
}

export function registryOf(...providers: EchoProvider[]): ProviderRegistry {
  const registry = new ProviderRegistry();
  for (const provider of providers) registry.register(provider.manifest, provider.factory);
  return registry;
}

const homes: string[] = [];
const engines: Engine[] = [];

export function tempHome(prefix = "mordomo-sdk-"): string {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  homes.push(home);
  return home;
}

/** A started or unstarted engine over a fresh home, closed by `closeAll()`. */
export function buildEngine(
  providers: EchoProvider[],
  options: Partial<EngineOptions> & { profile?: SecurityProfile; enable?: boolean } = {},
): Engine {
  const { profile, enable, ...engineOptions } = options;
  const engine = createEngine({
    home: engineOptions.home ?? tempHome(),
    seedDir: null,
    providers: registryOf(...providers),
    ...engineOptions,
  });
  engines.push(engine);
  if (enable !== false) {
    engine.updateSettings({
      defaultProvider: providers[0]?.manifest.id ?? "echo",
      ...(profile ? { securityProfile: profile } : {}),
      providers: Object.fromEntries(providers.map((p) => [p.manifest.id, { enabled: true }])),
    });
  } else if (profile) {
    engine.updateSettings({ securityProfile: profile });
  }
  return engine;
}

/** The engine's internals, for assertions about what it stored: tests only. */
export function internals(engine: Engine): MordomoEngine {
  return engine as unknown as MordomoEngine;
}

export function rowCount(engine: Engine, table: string): number {
  return (internals(engine).db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n;
}

export async function closeAll(): Promise<void> {
  for (const engine of engines.splice(0)) {
    await engine.stop(500).catch(() => undefined);
  }
  for (const home of homes.splice(0)) fs.rmSync(home, { recursive: true, force: true });
}

/** Write a skill into a home (the catalog reads `skills/<slug>/SKILL.md`). */
export function writeSkill(
  home: string,
  slug: string,
  frontmatter: string,
  body = "# Skill\n\nDo the thing.\n",
): void {
  const dir = path.join(home, "skills", slug);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "SKILL.md"), `---\n${frontmatter.trim()}\n---\n\n${body}`);
}
