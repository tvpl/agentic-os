/** Approvals, inbox rows, conversations and provider capabilities as they cross the wire. */
import type { ApprovalKind } from "./policy.js";
import type { ProviderId, SecurityProfile } from "./settings.js";

/** A decision a human has to take (a write, a tool, a change of settings), with who asked and who decided. */
export interface Approval {
  id: string;
  createdAt: number;
  kind: ApprovalKind;
  description: string;
  payload: Record<string, unknown>;
  status: "pending" | "approved" | "denied" | "expired";
  resolvedAt: number | null;
  /**
   * Who decided: `"owner"`, `"device:<deviceId>"`, `"broker:<runId>"`,
   * `"telegram:<userId>"` or `"system"` (expired). Null while pending and on
   * approvals decided before this was recorded.
   */
  resolvedBy: string | null;
  /**
   * Who asked for it, by the same names: `"owner"`, `"device:<deviceId>"`, or null for what no request caused (a
   * routine, a sentinel, the CLI) and for approvals raised before this was recorded. A device cannot approve
   * what it asked for itself.
   */
  requestedBy: string | null;
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

/** A row of the inbox: an approval, a failed run, an alert, a budget warning. */
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

/** A conversation: the runs that continue one provider-side thread. */
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

/**
 * The CLI versions (`major.minor.patch`, both ends included) this MordomoOS
 * release was developed against: the range its parser and fixtures follow.
 * It is a version check, not a certification that every version inside works.
 */
export interface TestedVersions {
  min: string;
  max: string;
}

/**
 * Where the installed CLI falls in its provider's `TestedVersions`: `tested`
 * inside, `older` below `min`, `newer` above `max`, `unknown` when no version
 * could be read or the provider declares no range. It only informs: a run
 * never depends on it.
 */
export type VersionStatus = "tested" | "older" | "newer" | "unknown";

/** What a provider can do and where it stops. */
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
  /**
   * Where the CLI's own reads stop: `workdir` - outside the working folder (and the folders added to the run) a
   * read needs a permission a headless run is denied; `none` - the CLI reads whatever the operating-system user
   * reads, whatever its read-only mode says (Codex's `--sandbox read-only` limits writes, Cursor has no sandbox).
   * A run started by a paired device is only accepted on a provider that declares `workdir`, because the owner
   * token sits in a file the folder does not contain (`docs/security.md`, T3).
   */
  readConfinement: "workdir" | "none";
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
