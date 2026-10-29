import { useCallback, useEffect, useState } from "react";
import { apiCall } from "../apiCall";

/** One server hit of the brain's search box: the fields both screens show. */
export interface BrainHit {
  id: number;
  name: string;
  rel: string;
}

/**
 * Search-as-you-type over `/api/memory/search`, shared by the Second Brain screen and the Núcleo brain scene
 * (.specs/features/cerebro-correcoes, S4). A failed request is a state of its own, never an empty result: the hits of
 * an earlier query are dropped with it, and `retry` asks again for the current text.
 */
export function useBrainSearch(
  query: string,
  limit = 8,
): { hits: BrainHit[]; failed: boolean; retry: () => void } {
  const [hits, setHits] = useState<BrainHit[]>([]);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const q = query.trim();
    if (!q) {
      setHits([]);
      setFailed(false);
      return;
    }
    let cancelled = false;
    const id = window.setTimeout(() => {
      void apiCall("GET /api/memory/search", { query: { q, limit } })
        .then((res) => {
          if (cancelled) return;
          setHits(res);
          setFailed(false);
        })
        .catch(() => {
          if (cancelled) return;
          setHits([]);
          setFailed(true);
        });
    }, 180);
    return () => {
      cancelled = true;
      window.clearTimeout(id);
    };
  }, [query, limit, attempt]);
  const retry = useCallback(() => setAttempt((n) => n + 1), []);
  return { hits, failed, retry };
}
