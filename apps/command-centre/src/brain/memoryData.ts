/**
 * The one data module of the brain screens (.specs/features/cerebro-vista-notas, AC 47, AC 48, amendment 8): the graph
 * a screen draws, the search as you type and the related files of a note are asked here, and only here, by the Second
 * Brain (`views/SecondBrain.tsx`), the Núcleo's brain scene (`nucleo/scenes/BrainScene.tsx`) and the notes view
 * (`brain/notes/`). Each read takes the active work context (`useWorkContext().query`): `undefined` is the whole brain.
 *
 * A failed search or related request is a state of its own, never an empty result: the hits of an earlier request are
 * dropped with it, and `retry` asks again (.specs/features/cerebro-correcoes, S4).
 */
import { useCallback, useEffect, useState } from "react";
import type { ApiCallResult } from "@mordomo/contracts";
import { apiCall } from "../apiCall";
import { qk } from "../queries";

/** The graph a screen reads: in the active context when there is one (`context=<id>`), else the whole index. */
export function graphRequest(maxNodes: number, context: string | undefined) {
  const params = context ? { maxNodes, context } : { maxNodes };
  return {
    key: qk.memoryGraph(params),
    path: `/api/memory/graph?maxNodes=${maxNodes}${context ? `&context=${encodeURIComponent(context)}` : ""}`,
  };
}

/** One server hit of the brain's search box: the fields the screens show. */
export interface BrainHit {
  id: number;
  name: string;
  rel: string;
  path?: string;
  title?: string | null;
}

/**
 * Search-as-you-type over `/api/memory/search`, shared by the three screens. A failed request is a state of its own:
 * the hits of an earlier query are dropped with it, and `retry` asks again for the current text.
 */
export function useBrainSearch(
  query: string,
  limit = 8,
  /** The active work context (cerebro-contextos AC 32): the hits are its files only. */
  context?: string,
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
      void apiCall("GET /api/memory/search", { query: { q, limit, ...(context ? { context } : {}) } })
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
  }, [query, limit, context, attempt]);
  const retry = useCallback(() => setAttempt((n) => n + 1), []);
  return { hits, failed, retry };
}

export type RelatedFile = ApiCallResult<"GET /api/memory/related">[number];

/**
 * The files related to one indexed file (`/api/memory/related`), in the active context when there is one. `pending`
 * while the answer is on its way; a failure drops the earlier answer and `retry` asks again.
 */
export function useRelatedFiles(
  id: number | null,
  context?: string,
): { related: RelatedFile[]; pending: boolean; failed: boolean; retry: () => void } {
  const [related, setRelated] = useState<RelatedFile[]>([]);
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    setRelated([]);
    setFailed(false);
    if (id === null) {
      setPending(false);
      return;
    }
    setPending(true);
    let cancelled = false;
    void apiCall("GET /api/memory/related", { query: { id, ...(context ? { context } : {}) } })
      .then((res) => {
        if (cancelled) return;
        setRelated(res);
        setPending(false);
      })
      .catch(() => {
        if (cancelled) return;
        setFailed(true);
        setPending(false);
      });
    return () => {
      cancelled = true;
    };
  }, [id, context, attempt]);
  const retry = useCallback(() => setAttempt((n) => n + 1), []);
  return { related, pending, failed, retry };
}
