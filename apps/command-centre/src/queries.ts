/**
 * Shared TanStack Query contract for the Command Centre.
 *
 * Every view reads server state through these keys so that one cache is
 * shared across the desktop and the apps, and so the `/api/events` stream can
 * invalidate precisely. Add new keys here, never inline in a view.
 */
import { useQuery, useQueryClient, type UseQueryOptions } from "@tanstack/react-query";
import { api } from "./api";

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
  metrics: ["metrics"] as const,
  artifacts: ["artifacts"] as const,
  connectors: ["connectors"] as const,
  memoryStatus: ["memory", "status"] as const,
  memoryGraph: (params?: Record<string, string | number | undefined>) => ["memory", "graph", params ?? {}] as const,
  approvals: ["approvals"] as const,
  backups: ["backups"] as const,
  doctor: ["doctor"] as const,
};

/** Which query keys an OS event should invalidate (consumed by useEventStream). */
export const invalidationMap: Record<string, readonly (readonly unknown[])[]> = {
  "run.created": [["runs"], ["metrics"]],
  "run.started": [["runs"], ["run"]],
  "run.event": [["run"]],
  "run.finished": [["runs"], ["run"], ["metrics"], ["artifacts"], ["routines"]],
  "routine.fired": [["routines"], ["runs"]],
  "routine.changed": [["routines"]],
  "index.finished": [["memory"]],
  "approval.requested": [["approvals"]],
  "approval.resolved": [["approvals"], ["settings"], ["connectors"]],
  "settings.changed": [["settings"], ["meta"], ["providers"]],
  "backup.created": [["backups"]],
};

/** Thin wrapper: GET an API path into the cache under a key. */
export function useApiQuery<T>(
  key: readonly unknown[],
  path: string,
  options: Omit<UseQueryOptions<T, Error, T, readonly unknown[]>, "queryKey" | "queryFn"> = {},
) {
  return useQuery<T, Error, T, readonly unknown[]>({
    queryKey: key,
    queryFn: () => api.get<T>(path),
    ...options,
  });
}

export function useInvalidate() {
  const qc = useQueryClient();
  return (...keys: readonly (readonly unknown[])[]) => Promise.all(keys.map((k) => qc.invalidateQueries({ queryKey: k })));
}
