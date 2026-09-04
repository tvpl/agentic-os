/**
 * Shared TanStack Query contract for the Command Centre.
 *
 * Every view reads server state through these keys so that one cache is
 * shared across the desktop and the apps, and so the `/api/events` stream can
 * invalidate precisely. Add new keys here, never inline in a view.
 */
import { useQuery, useQueryClient, type UseQueryOptions } from "@tanstack/react-query";
import {
  api,
  type SettingsDoc,
  type ArtifactEntry,
  type Connector,
  type Meta,
  type Metrics,
  type ProviderSnapshot,
  type RoutineStatus,
  type RunRecord,
  type Skill,
} from "./api";

export const qk = {
  meta: ["meta"] as const,
  settings: ["settings"] as const,
  providers: ["providers"] as const,
  skills: ["skills"] as const,
  skill: (slug: string) => ["skills", slug] as const,
  routines: ["routines"] as const,
  routineHistory: (id: string) => ["routines", id, "history"] as const,
  runs: (params?: Record<string, string | number | undefined>) => ["runs", params ?? {}] as const,
  run: (id: string) => ["run", id] as const,
  sessions: ["sessions"] as const,
  devices: ["devices"] as const,
  session: (id: string) => ["sessions", id] as const,
  metrics: ["metrics"] as const,
  artifacts: ["artifacts"] as const,
  connectors: ["connectors"] as const,
  memoryStatus: ["memory", "status"] as const,
  memoryGraph: (params?: Record<string, string | number | undefined>) =>
    ["memory", "graph", params ?? {}] as const,
  approvals: ["approvals"] as const,
  backups: ["backups"] as const,
  doctor: ["doctor"] as const,
};

/** Which query keys an OS event should invalidate (consumed by useEventStream). */
export const invalidationMap: Record<string, readonly (readonly unknown[])[]> = {
  "run.created": [["runs"], ["metrics"]],
  "run.started": [["runs"], ["run"]],
  "run.event": [["run"]],
  "run.finished": [["runs"], ["run"], ["metrics"], ["artifacts"], ["routines"], ["sessions"]],
  "session.created": [["sessions"]],
  "session.updated": [["sessions"]],
  "routine.fired": [["routines"], ["runs"]],
  "routine.alert": [["routines"]],
  "routine.changed": [["routines"]],
  "index.progress": [["memory", "status"]],
  "index.finished": [["memory"]],
  "approval.requested": [["approvals"]],
  "approval.resolved": [["approvals"], ["settings"], ["connectors"]],
  "settings.changed": [["settings"], ["meta"], ["providers"]],
  "backup.created": [["backups"]],
};

/** Named SSE event types the stream subscribes to. */
export const OS_EVENT_TYPES: readonly string[] = Object.keys(invalidationMap);

export type ApiQueryOptions<T> = Omit<
  UseQueryOptions<T, Error, T, readonly unknown[]>,
  "queryKey" | "queryFn"
>;

/** Thin wrapper: GET an API path into the cache under a key (request is aborted when the query is cancelled). */
export function useApiQuery<T>(key: readonly unknown[], path: string, options: ApiQueryOptions<T> = {}) {
  return useQuery<T, Error, T, readonly unknown[]>({
    queryKey: key,
    queryFn: ({ signal }) => api.get<T>(path, { signal }),
    ...options,
  });
}

export function useInvalidate() {
  const qc = useQueryClient();
  return (...keys: readonly (readonly unknown[])[]) =>
    Promise.all(keys.map((k) => qc.invalidateQueries({ queryKey: k })));
}

/* ---- shared "useOs*" hooks: one cache entry per resource ------------------ */
export const useOsMeta = (o?: ApiQueryOptions<Meta>) => useApiQuery<Meta>(qk.meta, "/api/meta", o);
export const useOsProviders = (o?: ApiQueryOptions<ProviderSnapshot[]>) =>
  useApiQuery<ProviderSnapshot[]>(qk.providers, "/api/providers", o);
export const useOsSkills = (o?: ApiQueryOptions<Skill[]>) =>
  useApiQuery<Skill[]>(qk.skills, "/api/skills", o);
export const useOsRoutines = (o?: ApiQueryOptions<RoutineStatus[]>) =>
  useApiQuery<RoutineStatus[]>(qk.routines, "/api/routines", o);
export const useOsRuns = (
  params: { limit?: number; status?: string; origin?: string } = {},
  o?: ApiQueryOptions<RunRecord[]>,
) => {
  const qs = Object.entries(params)
    .filter(([, v]) => v !== undefined && v !== "")
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
    .join("&");
  return useApiQuery<RunRecord[]>(qk.runs(params), `/api/runs${qs ? `?${qs}` : ""}`, o);
};
export const useOsRun = (id: string, o?: ApiQueryOptions<RunRecord>) =>
  useApiQuery<RunRecord>(qk.run(id), `/api/runs/${encodeURIComponent(id)}`, o);
export const useOsMetrics = (o?: ApiQueryOptions<Metrics>) =>
  useApiQuery<Metrics>(qk.metrics, "/api/metrics", o);
export const useOsArtifacts = (o?: ApiQueryOptions<ArtifactEntry[]>) =>
  useApiQuery<ArtifactEntry[]>(qk.artifacts, "/api/artifacts/recent", o);
export const useOsConnectors = (o?: ApiQueryOptions<Connector[]>) =>
  useApiQuery<Connector[]>(qk.connectors, "/api/connectors", o);
/** Every settings field, optional (an older server may omit some), plus room for fields this build does not know. */
export type SettingsView = Partial<SettingsDoc> & { [key: string]: unknown };
export const useOsSettings = (o?: ApiQueryOptions<SettingsView>) =>
  useApiQuery<SettingsView>(qk.settings, "/api/settings", o);
