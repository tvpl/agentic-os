/**
 * The runs the river shows: newest first, a page of 200 at a time (the API's
 * cap), fetched until the page reaches past the start of the range. The key
 * sits under `["runs", …]`, so every run change the event stream announces
 * refreshes it like the rest of the app. Older pages are the list's "load
 * older".
 */
import { useEffect, useMemo } from "react";
import { useInfiniteQuery } from "@tanstack/react-query";
import { type RunSummary } from "../../api";
import { apiCall } from "../../apiCall";

export const RIVER_PAGE = 200;
/** Never more than this many pages on the scene's own (1 000 runs). */
const MAX_AUTO_PAGES = 5;

export function useRiverRuns(since: number, provider: string | null) {
  const q = useInfiniteQuery({
    queryKey: ["runs", "river", { provider: provider ?? "all" }] as const,
    initialPageParam: 0,
    queryFn: ({ pageParam, signal }) => {
      return apiCall(
        "GET /api/runs",
        { query: { limit: RIVER_PAGE, offset: pageParam, order: "desc", provider: provider || undefined } },
        { signal },
      );
    },
    getNextPageParam: (last, pages) => (last.length < RIVER_PAGE ? undefined : pages.length * RIVER_PAGE),
    refetchInterval: 300_000,
  });
  const pages = q.data?.pages;
  const oldest = pages?.[pages.length - 1]?.at(-1)?.createdAt;
  const needMore = oldest !== undefined && oldest > since && (pages?.length ?? 0) < MAX_AUTO_PAGES;
  const { hasNextPage, isFetchingNextPage, fetchNextPage } = q;
  useEffect(() => {
    if (needMore && hasNextPage && !isFetchingNextPage) void fetchNextPage();
  }, [needMore, hasNextPage, isFetchingNextPage, fetchNextPage]);
  // A run that started between two page loads shifts the offsets: the same run can land on two pages.
  const runs = useMemo(() => {
    const seen = new Map<string, RunSummary>();
    for (const r of pages?.flat() ?? []) if (!seen.has(r.id)) seen.set(r.id, r);
    return [...seen.values()];
  }, [pages]);
  return { ...q, runs };
}
