import type { EffortLevel, ProviderId, SecurityProfile } from "../config/schema.js";
import type { ProviderManifest } from "./registry.js";
import type { RunEvent, RunMode, RunUsage, RunUsageEvent } from "@mordomo/contracts";

export type { RunEvent, RunMode, RunUsage, RunUsageEvent };

export interface DetectionResult {
  installed: boolean;
  binaryPath: string | null;
  version: string | null;
  /** Flags confirmed against the installed CLI's --help output. */
  supportedFlags: string[];
  notes: string[];
}

export interface AuthStatus {
  authenticated: boolean | "unknown";
  method: string | null; // e.g. "session", "api-key" — never the credential itself
  detail: string;
}

export interface ModelOption {
  /** Concrete model id passed to the CLI. */
  id: string;
  label: string;
  recommendedFor?: string;
  /**
   * Short names the provider accepts for this same model (e.g. "sonnet").
   * They are attached here instead of being listed as separate models so the
   * UI shows one row per family; runs may still pass an alias as `model`.
   */
  aliases?: string[];
}

export interface ValidationResult {
  ok: boolean;
  issues: string[];
}

export interface HealthStatus {
  ok: boolean;
  installed: boolean;
  authenticated: boolean | "unknown";
  version: string | null;
  detail: string;
  checkedAt: number;
}

/** Command line of the permission MCP server (spawned by the provider CLI, not by us). */
export interface PermissionBroker {
  command: string;
  args: string[];
  env: Record<string, string>;
}

export interface AgentRun {
  runId: string;
  prompt: string;
  cwd: string;
  model: string | null;
  effort: EffortLevel;
  mode: RunMode;
  timeoutMs: number;
  profile: SecurityProfile;
  /** Directory where the run should place produced artifacts. */
  artifactsDir: string;
  /**
   * Folders outside the working directory the run reads (a skill run reads its own `SKILL.md`). Set by the
   * RunManager, never by a request. A provider that confines reads to the working directory lets these in too;
   * one that does not, ignores them.
   */
  readDirs?: string[];
  /**
   * Folders among `readDirs` the run must not edit (the skill's own folder: its SKILL.md is the definition the next
   * run trusts). The Claude adapter denies its edit tools there; a provider that cannot, ignores it.
   */
  protectedDirs?: string[];
  /** Variables added to the provider process on top of what it inherits (the run-scoped API credential). */
  extraEnv?: Record<string, string>;
  /**
   * Environment the provider process must not inherit from the service:
   * exact names and name prefixes (MordomoOS's own secrets, set by the RunManager).
   */
  dropEnv?: { names: string[]; prefixes: string[] };
  /**
   * Conversation this run belongs to (`sessions.id`). Set by the RunManager
   * from the run row; adapters use it only to decide whether the provider's
   * own session id is worth pinning down.
   */
  sessionId?: string;
  /**
   * Provider-side conversation to continue. Absent on the first run of a
   * session (nothing to resume yet) and whenever the provider cannot resume.
   */
  resume?: { providerSessionId: string };
  /**
   * How the provider CLI can ask a human before a tool runs (plan Onda 1 §3):
   * an MCP server command the CLI spawns, which turns each prompt into a
   * MordomoOS approval. Absent when the profile answers prompts itself.
   */
  permissionBroker?: PermissionBroker;
  /**
   * Cancellation signal owned by the RunManager. When aborted before the
   * provider process is spawned, nothing is spawned; when aborted later, the
   * whole process group is terminated. Adapters just pass the run through to
   * `executeInvocation`, which honours it.
   */
  signal?: AbortSignal;
}

export interface SafeInvocation {
  executable: string;
  args: string[];
  env: Record<string, string>;
  stdin?: string;
  description: string;
}

/**
 * Provider adapter. Cancellation is not part of this contract: the RunManager
 * owns the cancel registry and delivers it through `AgentRun.signal`.
 */
export interface AgentAdapter {
  readonly id: ProviderId;
  /** Static description of the provider (capabilities, native layout, write tools). */
  readonly manifest: ProviderManifest;
  detect(): Promise<DetectionResult>;
  authenticate(): Promise<AuthStatus>;
  listModels(): Promise<ModelOption[]>;
  validateConfig(): Promise<ValidationResult>;
  buildInvocation(run: AgentRun): Promise<SafeInvocation>;
  execute(run: AgentRun): AsyncIterable<RunEvent>;
  healthCheck(): Promise<HealthStatus>;
  /**
   * Whether the installed CLI can resume a provider conversation natively.
   * Absent means "as the manifest says" (`capabilities.resume !== "none"`);
   * an adapter whose answer depends on the installed version overrides it.
   * When false, the run manager emulates the session by folding the earlier
   * turns into the prompt.
   */
  supportsResume?(): Promise<boolean>;
}
