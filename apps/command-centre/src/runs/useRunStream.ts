/**
 * Run record query + the per-run SSE stream (audit item 15: the stop
 * function is returned from the effect, a cancelled flag drops late
 * events, and a new run id closes the previous stream).
 */
import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { api, ApiError, type RunRecord } from "../api";
import { qk, useApiQuery, type ApiQueryOptions } from "../queries";

export interface RunEventView {
  type: string;
  ts: number;
  [key: string]: unknown;
}

/** Fields the API returns that `api.ts` does not declare yet. */
export type RunRecordFull = RunRecord & {
  effort?: string;
  cwd?: string | null;
  startedAt?: number | null;
  parentRunId?: string | null;
  pid?: number | null;
  filesChanged?: string[];
};

export interface RunDetailPayload {
  run: RunRecordFull;
  events: RunEventView[];
}

export { ACTIVE_RUN_STATUSES, isRunActive, isRunFailed } from "./status";

export function isNotFound(err: unknown): boolean {
  return err instanceof ApiError && err.status === 404;
}

/** `GET /api/runs/:id` → `{ run, events }` under `qk.run(id)`. */
export function useRunQuery(id: string, options: ApiQueryOptions<RunDetailPayload> = {}) {
  return useApiQuery<RunDetailPayload>(qk.run(id), `/api/runs/${encodeURIComponent(id)}`, {
    retry: (count, err) => !isNotFound(err) && count < 1,
    ...options,
  });
}

export interface RunStream {
  events: RunEventView[];
  /** True while the EventSource is open for the current id. */
  live: boolean;
}

/**
 * Opens `/api/runs/:id/stream` while `enabled`; the server replays history
 * first, so `events` is the complete log. Events are batched per animation
 * frame to keep a chatty run from re-rendering per line.
 */
export function useRunStream(id: string, enabled: boolean): RunStream {
  const qc = useQueryClient();
  const [events, setEvents] = useState<RunEventView[]>([]);
  const [live, setLive] = useState(false);
  const idRef = useRef(id);

  useEffect(() => {
    if (idRef.current !== id) {
      idRef.current = id;
      setEvents([]);
    }
  }, [id]);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    let pending: RunEventView[] = [];
    let flush = 0;
    setEvents([]);
    setLive(true);

    const stop = api.streamRun(id, (raw) => {
      if (cancelled) return;
      if (raw.type === "run_state") {
        qc.invalidateQueries({ queryKey: qk.run(id) }).catch(() => undefined);
        qc.invalidateQueries({ queryKey: ["runs"] }).catch(() => undefined);
        setLive(false);
        return;
      }
      pending.push(raw as RunEventView);
      if (!flush) {
        flush = requestAnimationFrame(() => {
          flush = 0;
          if (cancelled) return;
          const batch = pending;
          pending = [];
          setEvents((prev) => prev.concat(batch));
        });
      }
    });

    return () => {
      cancelled = true;
      cancelAnimationFrame(flush);
      stop();
      setLive(false);
    };
  }, [id, enabled, qc]);

  return { events, live };
}
