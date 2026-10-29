/**
 * Shared TanStack Query contract for the Command Centre.
 *
 * Every view reads server state through these keys so that one cache is
 * shared across the desktop and the apps, and so the `/api/events` stream can
 * invalidate precisely. Add new keys here, never inline in a view.
 */
import { useCallback } from "react";
import { useQuery, useQueryClient, type UseQueryOptions } from "@tanstack/react-query";
import type * as Contracts from "@mordomo/contracts";
import { api, type SettingsDoc, type UiPreferencesDoc, type UiPreferencesPatch } from "./api";
import { apiCall, type CallArgs } from "./apiCall";

export const qk = {
  meta: ["meta"] as const,
  settings: ["settings"] as const,
  uiPreferences: ["uiPreferences"] as const,
  providers: ["providers"] as const,
  skills: ["skills"] as const,
  skill: (slug: string) => ["skills", slug] as const,
  routines: ["routines"] as const,
  routineHistory: (id: string) => ["routines", id, "history"] as const,
  runs: (params?: Record<string, string | number | undefined>) => ["runs", params ?? {}] as const,
  run: (id: string) => ["run", id] as const,
  sessions: ["sessions"] as const,
  devices: ["devices"] as const,
  runChildren: (id: string) => ["run", id, "children"] as const,
  skillRegistry: ["skills", "registry"] as const,
  skillNotes: (slug: string) => ["skills", slug, "notes"] as const,
  telegramStatus: ["channels", "telegram", "status"] as const,
  pushSubscriptions: ["push", "subscriptions"] as const,
  session: (id: string) => ["sessions", id] as const,
  metrics: ["metrics"] as const,
  artifacts: ["artifacts"] as const,
  connectors: ["connectors"] as const,
  memoryStatus: ["memory", "status"] as const,
  contexts: ["contexts"] as const,
  memoryGraph: (params?: Record<string, string | number | undefined>) =>
    ["memory", "graph", params ?? {}] as const,
  approvals: ["approvals"] as const,
  backups: ["backups"] as const,
  doctor: ["doctor"] as const,
  objectives: ["objectives"] as const,
};

/** Which query keys an OS event should invalidate (consumed by useEventStream). */
export const invalidationMap: Record<string, readonly (readonly unknown[])[]> = {
  "run.created": [["runs"], ["metrics"]],
  "run.started": [["runs"], ["run"], ["sessions"]],
  // Streams many times a second while a reply arrives: the stream coalesces these.
  "run.event": [["run"], ["sessions"]],
  "run.finished": [["runs"], ["run"], ["metrics"], ["artifacts"], ["routines"], ["sessions"]],
  "session.created": [["sessions"]],
  "session.updated": [["sessions"]],
  "routine.fired": [["routines"], ["runs"]],
  "routine.alert": [["routines"], ["notifications"]],
  "routine.changed": [["routines"]],
  "index.progress": [["memory", "status"]],
  "index.finished": [["memory"], ["metrics"]],
  "index.failed": [["memory"]],
  "approval.requested": [["approvals"], ["run"], ["notifications"]],
  "approval.resolved": [["approvals"], ["run"], ["runs"], ["settings"], ["connectors"], ["notifications"]],
  "approval.expired": [["approvals"], ["run"], ["runs"]],
  // The work contexts live in settings.json (cerebro-contextos): another window that changes them refreshes the selector.
  "settings.changed": [["settings"], ["meta"], ["providers"], ["uiPreferences"], ["contexts"]],
  "backup.created": [["backups"]],
  "notification.read": [["notifications"]],
  "notification.created": [["notifications"], ["metrics"]],
  "budget.crossed": [["metrics"], ["notifications"]],
  "sentinel.fired": [["notifications"]],
  "objective.changed": [["objectives"]],
  // The service restarted and event ids started over: anything may have been missed. The empty key matches every query.
  "stream.reset": [[]],
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

/** The routes a query can read: the `GET`s of the contract table. */
export type GetRouteKey = Extract<Contracts.RouteKey, `GET ${string}`>;

/** What `useRouteQuery` takes after the key and the route: the route's parts (required when it has `params`), then the query options. */
export type RouteQueryArgs<K extends GetRouteKey> =
  Record<never, never> extends Contracts.ApiCallInput<K>
    ? [input?: Contracts.ApiCallInput<K>, options?: ApiQueryOptions<Contracts.ApiCallResult<K>>]
    : [input: Contracts.ApiCallInput<K>, options?: ApiQueryOptions<Contracts.ApiCallResult<K>>];

/**
 * `useApiQuery` for a route of the contract: the parameters, the query and the result are typed by the route's
 * entry (`apiCall`), so the data a view reads has the shape the server answers, not one the view guessed.
 */
export function useRouteQuery<K extends GetRouteKey>(
  key: readonly unknown[],
  route: K,
  ...args: RouteQueryArgs<K>
) {
  const [input, options] = args as [
    Contracts.ApiCallInput<K> | undefined,
    ApiQueryOptions<Contracts.ApiCallResult<K>> | undefined,
  ];
  return useQuery<Contracts.ApiCallResult<K>, Error, Contracts.ApiCallResult<K>, readonly unknown[]>({
    queryKey: key,
    // The query is cancelled with the request: the signal rides in the options slot of `apiCall`.
    queryFn: ({ signal }) => apiCall(route, ...([input, { signal }] as unknown as CallArgs<K>)),
    ...options,
  });
}

export function useInvalidate() {
  const qc = useQueryClient();
  return (...keys: readonly (readonly unknown[])[]) =>
    Promise.all(keys.map((k) => qc.invalidateQueries({ queryKey: k })));
}

/* ---- shared "useOs*" hooks: one cache entry per resource ------------------ */
type Result<K extends GetRouteKey> = Contracts.ApiCallResult<K>;
export const useOsMeta = (o?: ApiQueryOptions<Result<"GET /api/meta">>) =>
  useRouteQuery(qk.meta, "GET /api/meta", undefined, o);
export const useOsProviders = (o?: ApiQueryOptions<Result<"GET /api/providers">>) =>
  useRouteQuery(qk.providers, "GET /api/providers", undefined, o);
/** The work contexts (.specs/features/cerebro-contextos), with the state of each path and their file counts. */
export const useOsContexts = (o?: ApiQueryOptions<Result<"GET /api/contexts">>) =>
  useRouteQuery(qk.contexts, "GET /api/contexts", undefined, o);
export const useOsSkills = (o?: ApiQueryOptions<Result<"GET /api/skills">>) =>
  useRouteQuery(qk.skills, "GET /api/skills", undefined, o);
export const useOsRoutines = (o?: ApiQueryOptions<Result<"GET /api/routines">>) =>
  useRouteQuery(qk.routines, "GET /api/routines", undefined, o);
export const useOsRuns = (
  params: { limit?: number; status?: Contracts.RunStatus; provider?: string } = {},
  o?: ApiQueryOptions<Result<"GET /api/runs">>,
) => useRouteQuery(qk.runs(params), "GET /api/runs", { query: params }, o);
export const useOsMetrics = (o?: ApiQueryOptions<Result<"GET /api/metrics">>) =>
  useRouteQuery(qk.metrics, "GET /api/metrics", undefined, o);
export const useOsArtifacts = (o?: ApiQueryOptions<Result<"GET /api/artifacts/recent">>) =>
  useRouteQuery(qk.artifacts, "GET /api/artifacts/recent", undefined, o);
export const useOsConnectors = (o?: ApiQueryOptions<Result<"GET /api/connectors">>) =>
  useRouteQuery(qk.connectors, "GET /api/connectors", undefined, o);
export const useOsObjectives = (o?: ApiQueryOptions<Result<"GET /api/objectives">>) =>
  useRouteQuery(qk.objectives, "GET /api/objectives", undefined, o);
/**
 * The settings document exactly as `GET /api/settings` returns it. It has no key
 * that moved to the UI preferences and no index signature, so reading one
 * (`settings.data?.themePreset`, a copy of `data`, a destructuring) does not
 * compile: read it from `useOsUiPreferences`.
 */
export type SettingsView = SettingsDoc;
export const useOsSettings = (o?: ApiQueryOptions<SettingsView>) =>
  useApiQuery<SettingsView>(qk.settings, "/api/settings", o);
/** What only the Command Centre reads and writes; refreshed on `settings.changed`. */
export const useOsUiPreferences = (o?: ApiQueryOptions<UiPreferencesDoc>) =>
  useApiQuery<UiPreferencesDoc>(qk.uiPreferences, "/api/ui-preferences", o);

/** Save part of the UI preferences and put the answer straight into the cache. */
export function useSaveUiPreferences() {
  const qc = useQueryClient();
  return useCallback(
    async (patch: UiPreferencesPatch): Promise<UiPreferencesDoc> => {
      const doc = await api.putUiPreferences(patch);
      qc.setQueryData(qk.uiPreferences, doc);
      return doc;
    },
    [qc],
  );
}
