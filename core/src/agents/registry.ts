/**
 * Provider registry (audit item 36).
 *
 * A provider is described by a *manifest* (data: identity, binary, capabilities,
 * native file layout, home config files, write-tool pattern) and created by a
 * *factory* (code: the adapter class). Everything in the core that used to
 * hard-code "claude / cursor / codex" — the sync compiler, the connector
 * auditor, the run manager's write detection, the API's adapter composition,
 * the executable allowlist — iterates the registered manifests, so adding a
 * provider is: ship an adapter package with its manifest + factory and
 * register it in `apps/api/src/providers.ts`. `ProviderId` is only the shape
 * of an id; the core knows no provider by name.
 */
import { ProviderId } from "../config/schema.js";
import type { AgentAdapter } from "./types.js";
import type { ProviderCapabilities, TestedVersions, VersionStatus } from "@mordomo/contracts";
import type { SpawnPolicy } from "../spawn/policy.js";

export type { ProviderCapabilities, TestedVersions, VersionStatus };

/** Where the compiled views of the canonical skills/routers live for a provider (paths relative to the target dir). */
export interface ProviderNativeLayout {
  /** Top-level instructions file compiled from routers + skills. Providers may share one (e.g. `AGENTS.md`). */
  instructionsFile: string;
  /** Directory receiving one `<slug>/SKILL.md` (+ resources) per skill, or null when the provider has no skill folders. */
  skillsDir: string | null;
  /** Always-on rules file (Cursor `.mdc`), or null. */
  rulesFile: string | null;
  /** Directory receiving one `<slug>.md` command per skill, or null. */
  commandsDir: string | null;
}

/** A provider as data: identity, executable, capabilities and native file layout. */
export interface ProviderManifest {
  id: ProviderId;
  displayName: string;
  /** Executable basename looked up on PATH (also the allowlist entry). */
  binary: string;
  /** One-line install instruction shown when the binary is missing. */
  installHint: string;
  /** What a person runs in a terminal to sign the CLI in (shown after an authentication failure). */
  loginCommand: string;
  capabilities: ProviderCapabilities;
  layout: ProviderNativeLayout;
  /** Config files under the user's home dir that the connector auditor may scan (names/commands only, never credentials). */
  homeConfigFiles: string[];
  /** Tool names (case-insensitive prefix match) that mean "a file was written", for `filesChanged` detection. */
  writeToolPattern: RegExp;
  /**
   * The CLI versions this MordomoOS release was developed against (see
   * `TestedVersions`). Optional: a provider without a range reads as `unknown`.
   * The provider snapshot compares the installed CLI with it (`versionStatus`).
   */
  testedVersions?: TestedVersions;
}

const SEMVER = /(\d+)\.(\d+)\.(\d+)/;

function semverOf(text: string | null | undefined): [number, number, number] | null {
  const m = text ? SEMVER.exec(text) : null;
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

function compareSemver(a: [number, number, number], b: [number, number, number]): number {
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i]! - b[i]!;
  return 0;
}

/**
 * The `major.minor.patch` a CLI's `--version` output starts with (the first one
 * found: the contract is that the CLI names its own version before anything
 * else), or null when there is none. A pre-release tag (`2.1.0-beta.1`) is
 * ignored, so it reads as the release.
 */
export function installedVersion(versionOutput: string | null | undefined): string | null {
  const v = semverOf(versionOutput);
  return v ? v.join(".") : null;
}

/**
 * Where the installed CLI falls in the range this release was developed
 * against (`min` and `max` included). This is a version check, not a
 * certification: `unknown` when the output has no version, or the provider
 * declares no range, or the range is malformed. The one place this is computed
 * (the provider snapshot); a pre-release compares equal to its release.
 */
export function versionStatus(
  range: TestedVersions | undefined,
  versionOutput: string | null,
): VersionStatus {
  const installed = semverOf(versionOutput);
  const min = semverOf(range?.min);
  const max = semverOf(range?.max);
  if (!installed || !min || !max) return "unknown";
  if (compareSemver(installed, min) < 0) return "older";
  if (compareSemver(installed, max) > 0) return "newer";
  return "tested";
}

/** What the engine gives an adapter factory. */
export interface AdapterFactoryOptions {
  binaryPath: string | null;
  homeDir?: string;
  /**
   * The engine's spawn policy (the executables it allows, what its probes do not inherit). A factory hands it to
   * the adapter it builds; without one the adapter allows only `node` and its own binary.
   */
  spawn?: SpawnPolicy;
}
/** Builds the adapter of one provider for one engine. */
export type AdapterFactory = (opts: AdapterFactoryOptions) => AgentAdapter;

interface Entry {
  manifest: ProviderManifest;
  factory: AdapterFactory;
}

/** A rule of the registry was broken: a malformed or repeated id, an unknown id, a factory that built another provider's adapter. */
export class ProviderRegistryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProviderRegistryError";
  }
}

/** The providers an engine can run: one manifest and one adapter factory each. */
export class ProviderRegistry {
  private readonly entries = new Map<ProviderId, Entry>();

  register(manifest: ProviderManifest, factory: AdapterFactory): this {
    const parsed = ProviderId.safeParse(manifest.id);
    if (!parsed.success) {
      throw new ProviderRegistryError(
        `Provider id "${manifest.id}" is not a valid provider id (2-32 lowercase letters, digits or dashes).`,
      );
    }
    if (this.entries.has(manifest.id))
      throw new ProviderRegistryError(`Provider "${manifest.id}" is already registered.`);
    this.entries.set(manifest.id, { manifest, factory });
    return this;
  }

  has(id: string): id is ProviderId {
    return this.entries.has(id as ProviderId);
  }

  ids(): ProviderId[] {
    return [...this.entries.keys()];
  }

  manifests(): ProviderManifest[] {
    return [...this.entries.values()].map((e) => e.manifest);
  }

  manifest(id: ProviderId): ProviderManifest {
    const entry = this.entries.get(id);
    if (!entry) throw new ProviderRegistryError(`Unknown provider "${id}".`);
    return entry.manifest;
  }

  create(id: ProviderId, opts: AdapterFactoryOptions): AgentAdapter {
    const entry = this.entries.get(id);
    if (!entry) throw new ProviderRegistryError(`Unknown provider "${id}".`);
    const adapter = entry.factory(opts);
    if (adapter.id !== id)
      throw new ProviderRegistryError(
        `The factory of provider "${id}" created an adapter for "${adapter.id}".`,
      );
    return adapter;
  }

  /** Create one adapter per registered provider from a `binaryPath` lookup. */
  createAll(
    binaryPathOf: (id: ProviderId) => string | null,
    homeDir?: string,
    spawn?: SpawnPolicy,
  ): Record<ProviderId, AgentAdapter> {
    const out = {} as Record<ProviderId, AgentAdapter>;
    for (const id of this.ids())
      out[id] = this.create(id, { binaryPath: binaryPathOf(id), homeDir, ...(spawn ? { spawn } : {}) });
    return out;
  }
}
