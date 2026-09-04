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
}
