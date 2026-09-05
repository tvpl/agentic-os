import type { EffortLevel, ProviderId, SecurityProfile } from "../config/schema.js";
import type { ProviderManifest } from "./registry.js";

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

export type RunMode = "read_only" | "write";

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
  extraEnv?: Record<string, string>;
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

export type RunEvent =
  | { type: "started"; ts: number; pid: number | null }
  | { type: "text"; ts: number; stream: "stdout" | "stderr"; text: string }
  | { type: "assistant"; ts: number; text: string }
  | { type: "tool_use"; ts: number; tool: string; detail: string }
  | { type: "permission"; ts: number; detail: string }
  /**
   * The provider told us which conversation this run belongs to (Claude's
   * `session_id`, Codex's `thread_id`). Emitted up front when the adapter
   * chose the id itself and again from the stream as confirmation — the last
   * one wins, which is also how a resumed conversation that forks into a new
   * provider session gets recorded.
   */
  | { type: "session"; ts: number; providerSessionId: string }
  | {
      type: "result";
      ts: number;
      exitCode: number | null;
      summary: string;
      durationMs: number;
      timedOut: boolean;
      /** True when the process ended because cancellation was requested (or was never spawned because of it). */
      cancelled?: boolean;
    }
  | { type: "error"; ts: number; message: string }
  | ({ type: "usage"; ts: number } & RunUsageEvent);

/**
 * Token/cost usage reported by a provider. `scope` tells the RunManager how to
 * fold several events into the run's usage: a `total` snapshot replaces
 * everything seen so far (Claude's `result`, Codex's `turn.completed`),
 * while `turn` events (one per assistant message) are summed until a total
 * arrives. Missing scope means `turn`.
 */
export interface RunUsageEvent {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  /** Provider-reported cost in USD; null when the provider gives tokens but no price. */
  costUsd?: number | null;
  model?: string;
  scope?: "turn" | "total";
}

/** Usage persisted on the run row (sum of turns, or the provider's total). */
export interface RunUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  costUsd?: number | null;
  model?: string;
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
