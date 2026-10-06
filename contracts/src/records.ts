/** Approvals, inbox rows, conversations and provider capabilities as they cross the wire. */
import type { ApprovalKind } from "./policy.js";
import type { ProviderId, SecurityProfile } from "./settings.js";

export interface Approval {
  id: string;
  createdAt: number;
  kind: ApprovalKind;
  description: string;
  payload: Record<string, unknown>;
  status: "pending" | "approved" | "denied" | "expired";
  resolvedAt: number | null;
  /** When a still-pending approval is swept to `expired` (createdAt + TTL). */
  expiresAt: number;
}

export type NotificationKind = "approval" | "run" | "routine" | "index" | "system";
export type NotificationTone = "ok" | "warn" | "danger" | "info";

export const NOTIFICATION_KINDS: readonly NotificationKind[] = [
  "approval",
  "run",
  "routine",
  "index",
  "system",
];

export interface NotificationRecord {
  /** `n_<uuid>` — the prefix is what tells the UI a row came from the server. */
  id: string;
  kind: NotificationKind;
  tone: NotificationTone | null;
  messageKey?: string | null;
  messageParams?: Record<string, string | number | boolean> | null;
  title: string;
  body: string | null;
  href: string | null;
  approvalId: string | null;
  runId: string | null;
  ts: number;
  read: boolean;
  /** Rows sharing a key within `DEDUPE_MS` replace each other. */
  dedupeKey: string | null;
}

export interface SessionRecord {
  id: string;
  provider: ProviderId;
  /** Id the provider CLI resumes; null until the first run of the session reports one. */
  providerSessionId: string | null;
  cwd: string | null;
  profile: SecurityProfile | null;
  /** Short, redacted label (the first prompt of the conversation). */
  title: string;
  createdAt: number;
  updatedAt: number;
  lastRunId: string | null;
  /** Finished runs folded into this conversation. */
  turns: number;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
}

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
  /**
   * How a write run is kept in bounds: `broker` — every tool that is not a
   * pre-approved edit asks a human (Claude's permission prompt tool);
   * `sandbox` — the CLI confines writes to the working directory (Codex
   * `--sandbox workspace-write`); `none` — nothing does (`cursor-agent --force`).
   * The engine parks an unconfined write for approval unless the profile is
   * `approved_automation`.
   */
  writeConfinement: "broker" | "sandbox" | "none";
}

/** One hourly snapshot of the live numbers (Settings › Trends). */
export interface MetricsSample {
  /** Hour bucket (ms since epoch, floored to the hour). */
  ts: number;
  runsTotal: number;
  runs24h: number;
  failed24h: number;
  costTodayUsd: number;
  tokensToday: number;
  spendWeekUsd: number;
  inboxUnread: number;
  approvalsPending: number;
  /** Mean time pending → resolved over the last 24 h; null when nothing resolved. */
  approvalWaitAvgMs: number | null;
}
