/** Typed-ish fetch layer for the local MordomoOS API. */

const token =
  document.querySelector<HTMLMetaElement>('meta[name="mordomo-token"]')?.content ?? "";

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

async function request<T>(method: string, url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method,
    headers: {
      "x-mordomo-token": token,
      ...(body !== undefined ? { "content-type": "application/json" } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    let message = res.statusText;
    try {
      message = ((await res.json()) as { error?: string }).error ?? message;
    } catch {
      /* non-JSON error */
    }
    throw new ApiError(res.status, message);
  }
  return (await res.json()) as T;
}

export const api = {
  get: <T>(url: string) => request<T>("GET", url),
  post: <T>(url: string, body?: unknown) => request<T>("POST", url, body),
  put: <T>(url: string, body?: unknown) => request<T>("PUT", url, body),
  del: <T>(url: string) => request<T>("DELETE", url),
  /** SSE stream of run events; EventSource cannot set headers → token in query. */
  streamRun(runId: string, onEvent: (data: Record<string, unknown>) => void): () => void {
    const source = new EventSource(`/api/runs/${runId}/stream?token=${token}`);
    source.onmessage = (e) => {
      try {
        onEvent(JSON.parse(e.data as string) as Record<string, unknown>);
      } catch {
        /* ignore malformed */
      }
    };
    source.onerror = () => source.close();
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

export interface ProviderSnapshot {
  id: ProviderId;
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
  bodyLineCount: number;
  thick: boolean;
  favorite?: boolean;
  body: string;
  skillFile: string;
}

export interface RunRecord {
  id: string;
  createdAt: number;
  finishedAt: number | null;
  origin: string;
  provider: ProviderId;
  model: string | null;
  status: string;
  durationMs: number | null;
  promptSummary: string;
  skillSlug: string | null;
  routineId: string | null;
  error: string | null;
  artifacts: string[];
  exitCode: number | null;
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
}
