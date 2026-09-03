/** Typed-ish fetch layer for the local MordomoOS API. */

const TOKEN =
  document.querySelector<HTMLMetaElement>('meta[name="mordomo-token"]')?.content ?? "";

/** Local token (injected into the page by the API server / the Vite dev plugin). */
export function getToken(): string {
  return TOKEN;
}

export interface ApiIssue {
  path?: Array<string | number>;
  message: string;
  code?: string;
}

/**
 * Error thrown for non-2xx responses, timeouts ("timeout") and network
 * failures ("network"). `code` comes from the API envelope
 * `{ error: { code, message, issues? }, message }`; the legacy
 * `{ error: string }` shape is still accepted (code "error").
 */
export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly code: string = "error",
    public readonly issues: ApiIssue[] = [],
  ) {
    super(message);
    this.name = "ApiError";
  }
  /** True for network / timeout failures where the service could not be reached. */
  get unreachable(): boolean {
    return this.status === 0;
  }
}

export interface RequestOptions {
  signal?: AbortSignal;
  /** Milliseconds before the request is aborted (default 30 s). */
  timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 30_000;

interface ErrorEnvelope {
  error?: string | { code?: string; message?: string; issues?: ApiIssue[] };
  message?: string;
}

async function parseError(res: Response): Promise<ApiError> {
  let message = res.statusText || `HTTP ${res.status}`;
  let code = "error";
  let issues: ApiIssue[] = [];
  try {
    const body = (await res.json()) as ErrorEnvelope;
    if (body && typeof body.error === "object" && body.error) {
      message = body.error.message ?? body.message ?? message;
      code = body.error.code ?? code;
      issues = Array.isArray(body.error.issues) ? body.error.issues : [];
    } else if (typeof body?.error === "string") {
      message = body.error;
    } else if (typeof body?.message === "string") {
      message = body.message;
    }
  } catch {
    /* non-JSON error body */
  }
  return new ApiError(res.status, message, code, issues);
}

async function request<T>(method: string, url: string, body?: unknown, opts: RequestOptions = {}): Promise<T> {
  const controller = new AbortController();
  let timedOut = false;
  const timer = window.setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, opts.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  const forward = () => controller.abort();
  if (opts.signal) {
    if (opts.signal.aborted) controller.abort();
    else opts.signal.addEventListener("abort", forward, { once: true });
  }
  let res: Response;
  try {
    res = await fetch(url, {
      method,
      headers: {
        "x-mordomo-token": TOKEN,
        ...(body !== undefined ? { "content-type": "application/json" } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });
  } catch (err) {
    if (timedOut) throw new ApiError(0, "Request timed out", "timeout");
    if (err instanceof DOMException && err.name === "AbortError") throw err; // caller aborted
    throw new ApiError(0, err instanceof Error ? err.message : String(err), "network");
  } finally {
    window.clearTimeout(timer);
    opts.signal?.removeEventListener("abort", forward);
  }
  if (!res.ok) throw await parseError(res);
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

/** One event from `/api/events` (mirrors core/src/events.ts `OsEvent`). */
export interface OsEvent<T = unknown> {
  id?: number;
  type: string;
  ts?: number;
  payload: T;
}

export interface StreamOptions {
  /** Named SSE event types to subscribe to in addition to unnamed `message` events. */
  types?: readonly string[];
  onOpen?: () => void;
  /** Called when the browser gives up (readyState CLOSED) or on a hard error. */
  onError?: () => void;
}

export const api = {
  get: <T>(url: string, opts?: RequestOptions) => request<T>("GET", url, undefined, opts),
  post: <T>(url: string, body?: unknown, opts?: RequestOptions) => request<T>("POST", url, body, opts),
  put: <T>(url: string, body?: unknown, opts?: RequestOptions) => request<T>("PUT", url, body, opts),
  del: <T>(url: string, opts?: RequestOptions) => request<T>("DELETE", url, undefined, opts),

  /** SSE stream of run events; EventSource cannot set headers → token in query. */
  streamRun(runId: string, onEvent: (data: Record<string, unknown>) => void): () => void {
    const source = new EventSource(`/api/runs/${encodeURIComponent(runId)}/stream?token=${TOKEN}`);
    source.onmessage = (e) => {
      try {
        onEvent(JSON.parse(e.data as string) as Record<string, unknown>);
      } catch {
        /* ignore malformed */
      }
    };
    source.onerror = () => {
      if (source.readyState === EventSource.CLOSED) source.close();
    };
    return () => source.close();
  },

  /**
   * SSE stream of OS events (`/api/events`). The browser handles
   * `Last-Event-ID` on its automatic reconnects; `onError` fires when the
   * connection is closed for good so callers can back off and reopen.
   */
  streamEvents(onEvent: (event: OsEvent) => void, opts: StreamOptions = {}): () => void {
    const source = new EventSource(`/api/events?token=${TOKEN}`);
    const handle = (raw: MessageEvent, fallbackType?: string) => {
      try {
        const parsed = JSON.parse(raw.data as string) as Partial<OsEvent> | null;
        if (!parsed || typeof parsed !== "object") return;
        const type = typeof parsed.type === "string" ? parsed.type : fallbackType;
        if (!type) return;
        onEvent({ id: parsed.id, type, ts: parsed.ts, payload: parsed.payload });
      } catch {
        /* ignore malformed */
      }
    };
    source.onmessage = (e) => handle(e);
    for (const type of opts.types ?? []) {
      source.addEventListener(type, (e) => handle(e as MessageEvent, type));
    }
    source.onopen = () => opts.onOpen?.();
    source.onerror = () => {
      if (source.readyState === EventSource.CLOSED) {
        source.close();
        opts.onError?.();
      }
    };
    return () => source.close();
  },
};
// ---- shared shapes (mirror the API responses we rely on) --------------------
export type ProviderId = "claude" | "cursor" | "codex";

export interface Meta {
  name: string;
  theme: "dark" | "light" | "system";
  accentColor: string;
  language: "en" | "pt-BR";
  setupCompleted: boolean;
  version: string;
}

export interface ModelishOption {
  id: string;
  label: string;
  recommendedFor?: string;
}

export interface ProviderCapabilities {
  enforcesReadOnly: boolean;
  supportsEffort: boolean;
  promptTransport: "stdin" | "argv";
  streaming: boolean;
}

export interface ProviderSnapshot {
  id: ProviderId;
  /** From the provider manifest (older servers omit these). */
  displayName?: string;
  capabilities?: ProviderCapabilities;
  installHint?: string;
  enabled: boolean;
  isDefault: boolean;
  defaultModel: string | null;
  defaultEffort: string;
  health: {
    ok: boolean;
    installed: boolean;
    authenticated: boolean | "unknown";
    version: string | null;
    detail: string;
  };
}

export interface Skill {
  slug: string;
  name: string;
  description: string;
  triggers: string[];
  inputs: Array<{ name: string; label: string; type: string; required: boolean; placeholder?: string; options?: string[] }>;
  providers: ProviderId[];
  recommendedModel: string | null;
  recommendedEffort: string;
  mode: "read_only" | "write";
  enabled: boolean;
  version: string;
  guardrails: string[];
  successCriteria: string[];
  resources: string[];
  /** Rich resource entries (kind + size); older servers omit it. */
  resourceFiles?: SkillResource[];
  bodyLineCount: number;
  thick: boolean;
  favorite?: boolean;
  body: string;
  skillFile: string;
}

export interface RunRecord {
  id: string;
  createdAt: number;
  startedAt?: number | null;
  finishedAt: number | null;
  origin: string;
  provider: ProviderId;
  model: string | null;
  effort?: string;
  status: string;
  durationMs: number | null;
  cwd?: string | null;
  promptSummary: string;
  skillSlug: string | null;
  routineId: string | null;
  parentRunId?: string | null;
  pid?: number | null;
  error: string | null;
  artifacts: string[];
  /** Absolute paths the run's write tools touched (from the RunManager). */
  filesChanged?: string[];
  exitCode: number | null;
  attempts?: number;
  timeoutMs?: number | null;
  /** `read_only` for read-only runs, else the security profile the run ran under. */
  permissionProfile?: string | null;
  /** Token usage and provider-reported cost (null until a provider reports it). */
  usage?: RunUsage | null;
}

/** Token usage persisted on a run (F-RUNS contract). */
export interface RunUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  /** null = tokens known but the provider gives no price. */
  costUsd?: number | null;
  model?: string;
}

export interface RoutineStatus {
  id: string;
  name: string;
  skillSlug: string | null;
  prompt: string | null;
  schedule: string;
  timezone: string;
  provider: ProviderId;
  model: string | null;
  effort: string;
  missedPolicy: string;
  enabled: boolean;
  nextRunAt: number | null;
  lastFiredAt: number | null;
  lastStatus: string | null;
  recentFailures: number;
  healthy: boolean;
  timeoutMs: number;
  maxAttempts: number;
  profile: string;
  inputs: Record<string, string>;
  notify: boolean;
  backoffMs: number;
  workingDir: string | null;
  artifactsSubdir: string | null;
  createdAt: number;
}

export interface Connector {
  id: string;
  name: string;
  kind: string;
  origin: string;
  maintainer: string;
  official: boolean;
  authMethod: string;
  permissions: string[];
  readOperations: string[];
  writeOperations: string[];
  writeEnabled: boolean;
  risks: string[];
  status: string;
  notes: string;
  compatibleProviders: ProviderId[];
}

export interface GraphNode {
  id: number;
  name: string;
  rel: string;
  path: string;
  ext: string;
  area: string | null;
  dir: string;
  size: number;
  mtime: number;
  title: string | null;
  tags: string[];
}

export interface GraphData {
  nodes: GraphNode[];
  edges: Array<{ source: number; target: number; kind: string; why: string }>;
  truncated: boolean;
  totalFiles: number;
}

export interface ArtifactEntry {
  runId: string;
  file: string;
  path: string;
  createdAt: number;
  origin: string;
  skillSlug: string | null;
  provider: string;
  sizeBytes: number | null;
}

export interface DoctorReport {
  checks: Array<{ id: string; label: string; status: "ok" | "warn" | "fail" | "skip"; detail: string }>;
  ok: number;
  warn: number;
  fail: number;
}

export interface Metrics {
  total: number;
  last7d: number;
  successRate: number | null;
  avgDurationMs: number | null;
  byProvider: Array<{ provider: string; count: number; success: number }>;
  running: number;
  failedRecent: number;
  /** Spend and token throughput (F-RUNS); older servers omit it. */
  cost?: MetricsCost;
  /** Last 24 hourly buckets, oldest first (tokens sparkline). */
  usageSeries?: UsageSeriesPoint[];
}

// ---- desktop ----
export type ArtifactKind = "image" | "video" | "html" | "markdown" | "code" | "other";

/** One row of `/api/artifacts/list` (gallery, search mode, Generations). */
export interface ArtifactListItem {
  id: string;
  file: string;
  path: string;
  runId: string | null;
  skillSlug: string | null;
  createdAt: number;
  kind: ArtifactKind;
  title: string;
  /** Folder under artifacts/ (first path segment), e.g. the run id or "pixel-studio". */
  folder: string;
  sizeBytes: number;
  /** True when `/api/artifacts/raw?p=` can render it inline (png/jpg/svg/webp/gif/mp4/webm). */
  thumbnail: boolean;
}

export interface ArtifactListResponse {
  items: ArtifactListItem[];
  total: number;
  skills: string[];
  folders: string[];
}

/** `GET /api/connectors/:id/data` (F-BACKEND contract; the desktop copes with its absence). */
export interface ConnectorDataItem {
  id: string;
  title: string;
  subtitle?: string;
  ts?: number;
  flagged?: boolean;
  tag?: string;
  href?: string;
}
export interface ConnectorData {
  status: "not_configured" | "ok" | "error";
  syncedAt: number | null;
  message?: string;
  items: ConnectorDataItem[];
  summary?: Record<string, number>;
}

/** `Metrics.cost` (F-RUNS contract), read defensively by the Cost widget. */
export interface MetricsCost {
  todayUsd: number;
  weekUsd: number;
  tokensToday: number;
  burnRatePerHour: number;
  block5h?: { usedPct: number; resetsAt: number };
}

export type NotificationKind = "approval" | "run" | "routine" | "index" | "system";
export interface NotificationItem {
  id: string;
  kind: NotificationKind;
  title: string;
  body?: string;
  ts: number;
  read: boolean;
  href?: string;
  approvalId?: string;
}

/** A pending approval as returned by `GET /api/approvals`. */
export interface ApprovalRecord {
  id: string;
  createdAt: number;
  kind: string;
  description: string;
  payload: Record<string, unknown>;
  status: "pending" | "approved" | "denied" | "expired";
  resolvedAt: number | null;
}

/** Micro app entry persisted in `settings.microApps` when the schema has it (else route-only list). */
export interface MicroAppEntry {
  id: string;
  name: string;
  url: string;
  description?: string;
}

// ---- apps ----
export type SkillResourceKind = "markdown" | "html" | "image" | "pdf" | "other";

/** One file inside a skill folder other than SKILL.md (served by `GET /api/skills/:slug/resource?rel=`). */
export interface SkillResource {
  name: string;
  rel: string;
  kind: SkillResourceKind;
  size: number;
}

/** A user-defined micro app persisted in `settings.microApps`. */
export interface MicroApp {
  id: string;
  name: string;
  description: string;
  /** Internal route ("/pixel") or an http(s) URL. */
  href: string;
}

/** Response of `POST /api/skills/:slug/run` (202 when an approval is pending). */
export interface SkillRunResponse {
  runId: string | null;
  status: "queued" | "waiting_approval";
  pendingApproval?: ApprovalRecord | null;
}

// ---- shell ----
/** `/api/memory/search` hit (the palette's Files section uses only these fields). */
export interface MemorySearchHit {
  id: number;
  name: string;
  rel: string;
  path?: string;
  ext?: string;
  area?: string | null;
  mtime?: number;
}

/** `POST /api/skills/:slug/run` and `POST /api/runs` response. */
export interface RunLaunchResponse {
  runId: string | null;
  status: "queued" | "waiting_approval" | string;
  pendingApproval?: { id: string; kind: string; description: string } | null;
}

/** `POST /api/backups` response (mirrors core BackupInfo). */
export interface BackupCreated {
  name: string;
  path: string;
  createdAt: number;
  sizeBytes: number;
}

/** Payloads of the OS events the notification store understands. */
export interface ApprovalRequestedPayload {
  id: string;
  kind: string;
  description: string;
}
export interface ApprovalResolvedPayload {
  id: string;
  kind: string;
  status: "approved" | "denied" | string;
  runId: string | null;
}
export interface RunFinishedPayload {
  runId: string;
  status: string;
  durationMs: number | null;
}
export interface RoutineFiredPayload {
  routineId: string;
  runId: string;
}

// ---- memory ----
// F-MEMORY: layered recall, daily journal, hygiene, bi-temporal facts, inline fields.
// `GraphNode` gains optional inline fields through declaration merging (append-only).
export interface GraphNode {
  fields?: Record<string, string>;
}

export interface RecallContext {
  path: string;
  section: string;
  excerpt: string;
  score: number;
  why: string;
  via?: string;
}

export interface RecallResult {
  question: string;
  keywords: string[];
  answerContext: RecallContext[];
  tokensEstimate: number;
  candidatesConsidered: number;
  opened: number;
  candidates: Array<{ path: string; score: number; why: string }>;
  durationMs: number;
}

export interface RecallStats {
  totalRecalls: number;
  totalTokens: number;
  paths: Array<{ path: string; count: number; lastAt: number }>;
  lastAt: number | null;
}

export type JournalSection = "Today" | "Decisions" | "Open loops" | "Runs";

export interface JournalDay {
  date: string;
  path: string;
  content: string;
  created: boolean;
  sections: Array<{ name: string; lines: string[] }>;
  /** Present on the single-day response. */
  dates?: string[];
}

export type HygieneKind = "orphan" | "dangling-link" | "stale" | "skill-never-run" | "silent-routine" | "unused-connector";
export type HygieneAction = "open" | "disconnect" | "archive" | "link";

export interface HygieneItem {
  kind: HygieneKind;
  id: string;
  name: string;
  detail: string;
  action: HygieneAction;
}

export interface HygieneReport {
  generatedAt: number;
  counts: Record<HygieneKind, number>;
  items: HygieneItem[];
  thresholds: { staleDays: number; silentRoutineDays: number; unusedConnectorDays: number };
}

export interface Fact {
  id: number;
  subject: string;
  predicate: string;
  object: string;
  validFrom: number;
  validTo: number | null;
  sourceRunId: string | null;
  sourcePath: string | null;
  createdAt: number;
}

export interface FactsResponse {
  facts: Fact[];
  stats: { open: number; expired: number; subjects: number };
}

export interface FieldQueryResponse {
  where: string;
  files: Array<GraphNode & { root: string; indexedAt: number; fields: Record<string, string> }>;
}

// ---- runs ----
/** One hourly bucket of `Metrics.usageSeries`. */
export interface UsageSeriesPoint {
  ts: number;
  tokens: number;
  usd: number;
}

/** `usage` frame of `/api/runs/:id/stream` (mirrors core `RunUsageEvent`). */
export interface RunUsageEvent extends RunUsage {
  type: "usage";
  ts: number;
  /** `total` replaces the sum of previous `turn` events. */
  scope?: "turn" | "total";
}

/** `GET /api/runs/:id/diff?file=` */
export type RunDiffResult =
  | { kind: "git"; file: string; repoRoot: string; diff: string; truncated: boolean; unchanged: boolean }
  | { kind: "snapshot"; file: string; content: string | null; truncated: boolean; untracked: boolean; message: string | null }
  | { kind: "unavailable"; file: string; message: string };

/** `POST /api/runs` and `POST /api/skills/:slug/run` */
export interface LaunchRunResponse {
  runId: string | null;
  status: "queued" | "waiting_approval";
  pendingApproval?: ApprovalRecord | null;
}

/** `POST /api/approvals/:id/resolve` */
export type ResolveApprovalResponse = ApprovalRecord & { runId: string | null };

// ---- brain ----
/** Second Brain preferences persisted in `settings.brain` (validated client-side by brain/state.ts). */
export interface BrainSettingsPayload {
  layout?: string;
  view?: string;
  spin?: number;
  showNames?: boolean;
  linkSpring?: number;
  nodeScale?: number;
  clusterSize?: number;
  edgeKinds?: string[];
  localHops?: number;
  focusMode?: boolean;
  workspace?: { pinned: Array<{ id: number; x: number; y: number }>; collapsed: string[] };
}

/** Payload of the `index.progress` SSE event (mirrors core/src/memory/indexer.ts IndexProgress). */
export interface IndexProgressPayload {
  scanned: number;
  total?: number;
  added: number;
  updated: number;
  removed: number;
}

export interface MemoryPreview {
  kind: "text" | "binary" | "blocked" | "too-large";
  content: string | null;
  message: string | null;
}
