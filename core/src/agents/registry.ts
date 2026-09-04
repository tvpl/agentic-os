/**
 * Provider registry (audit item 36).
 *
 * A provider is described by a *manifest* (data: identity, binary, capabilities,
 * native file layout, home config files, write-tool pattern) and created by a
 * *factory* (code: the adapter class). Everything in the core that used to
 * hard-code "claude / cursor / codex" — the sync compiler, the connector
 * auditor, the run manager's write detection, the API's adapter composition —
 * now iterates manifests, so adding a provider is: add its id to `ProviderId`
 * (settings validation), ship an adapter package with a manifest + factory,
 * and register it in `apps/api/src/providers.ts`.
 */
import { ProviderId } from "../config/schema.js";
import type { AgentAdapter } from "./types.js";

export interface ProviderCapabilities {
  /** `read_only` is enforced by the CLI itself (sandbox / permission rules), not just asked for in the prompt. */
  enforcesReadOnly: boolean;
  /** The provider accepts an effort / reasoning budget. */
  supportsEffort: boolean;
  /** How the prompt reaches the CLI. `argv` is visible in `ps` and bounded by ARG_MAX. */
  promptTransport: "stdin" | "argv";
  /** The CLI streams structured events (tool calls, results) rather than plain text. */
  streaming: boolean;
  /**
   * How the CLI continues a previous conversation:
   * `flag` — an option on the normal invocation (`claude --resume <id>`);
   * `subcommand` — a dedicated verb (`codex exec resume <id>`);
   * `none` — the CLI cannot resume, so every run starts a fresh conversation.
   * Adapters treat anything but `none` as best effort: when the installed CLI
   * does not advertise it, the run starts fresh and says so in a text event.
   */
  resume: "flag" | "subcommand" | "none";
}

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

export interface ProviderManifest {
  id: ProviderId;
  displayName: string;
  /** Executable basename looked up on PATH (also the allowlist entry). */
  binary: string;
  /** One-line install instruction shown when the binary is missing. */
  installHint: string;
  capabilities: ProviderCapabilities;
  layout: ProviderNativeLayout;
  /** Config files under the user's home dir that the connector auditor may scan (names/commands only, never credentials). */
  homeConfigFiles: string[];
  /** Tool names (case-insensitive prefix match) that mean "a file was written", for `filesChanged` detection. */
  writeToolPattern: RegExp;
}

export interface AdapterFactoryOptions {
  binaryPath: string | null;
  homeDir?: string;
}
export type AdapterFactory = (opts: AdapterFactoryOptions) => AgentAdapter;

interface Entry {
  manifest: ProviderManifest;
  factory: AdapterFactory;
}

export class ProviderRegistryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProviderRegistryError";
  }
}

export class ProviderRegistry {
  private readonly entries = new Map<ProviderId, Entry>();

  register(manifest: ProviderManifest, factory: AdapterFactory): this {
    const parsed = ProviderId.safeParse(manifest.id);
    if (!parsed.success) {
      throw new ProviderRegistryError(
        `Provider id "${manifest.id}" is not declared in ProviderId (core/src/config/schema.ts).`,
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
    return entry.factory(opts);
  }

  /** Create one adapter per registered provider from a `binaryPath` lookup. */
  createAll(
    binaryPathOf: (id: ProviderId) => string | null,
    homeDir?: string,
  ): Record<ProviderId, AgentAdapter> {
    const out = {} as Record<ProviderId, AgentAdapter>;
    for (const id of this.ids()) out[id] = this.create(id, { binaryPath: binaryPathOf(id), homeDir });
    return out;
  }
}

/** Every declared provider must have a manifest; the compiler and auditor rely on this table when no registry is wired. */
export const BUILTIN_MANIFESTS: Record<ProviderId, ProviderManifest> = {
  claude: {
    id: "claude",
    displayName: "Claude Code",
    binary: "claude",
    installHint: "npm install -g @anthropic-ai/claude-code",
    capabilities: {
      enforcesReadOnly: true,
      supportsEffort: true,
      promptTransport: "stdin",
      streaming: true,
      resume: "flag",
    },
    layout: {
      instructionsFile: "CLAUDE.md",
      skillsDir: ".claude/skills",
      rulesFile: null,
      commandsDir: null,
    },
    homeConfigFiles: [".claude.json", ".claude/settings.json"],
    writeToolPattern: /^(write|edit|multiedit|notebookedit|create_file)/i,
  },
  cursor: {
    id: "cursor",
    displayName: "Cursor Agent",
    binary: "cursor-agent",
    installHint: "curl https://cursor.com/install -fsS | bash",
    capabilities: {
      enforcesReadOnly: false,
      supportsEffort: false,
      promptTransport: "argv",
      streaming: true,
      // No resume flag is documented for cursor-agent -p; runs always start fresh.
      resume: "none",
    },
    layout: {
      instructionsFile: "AGENTS.md",
      skillsDir: null,
      rulesFile: ".cursor/rules/mordomo.mdc",
      commandsDir: ".cursor/commands",
    },
    homeConfigFiles: [".cursor/mcp.json"],
    writeToolPattern: /^(write|edit|multiedit|create_file|str_replace)/i,
  },
  codex: {
    id: "codex",
    displayName: "OpenAI Codex",
    binary: "codex",
    installHint: "npm install -g @openai/codex",
    capabilities: {
      enforcesReadOnly: true,
      supportsEffort: true,
      promptTransport: "argv",
      streaming: true,
      resume: "subcommand",
    },
    layout: {
      instructionsFile: "AGENTS.md",
      skillsDir: ".agents/skills",
      rulesFile: null,
      commandsDir: null,
    },
    homeConfigFiles: [".codex/config.toml"],
    writeToolPattern: /^(apply_patch|write|edit|create_file)/i,
  },
};

export const builtinManifests = (): ProviderManifest[] =>
  ProviderId.options.map((id) => BUILTIN_MANIFESTS[id]);
