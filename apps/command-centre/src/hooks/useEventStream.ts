/**
 * One `/api/events` SSE connection for the whole shell (audit item 27).
 * Every event invalidates the query keys listed in `invalidationMap`, so
 * views stop polling. Reconnects with exponential backoff (1 s → 30 s).
 */
import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import { OS_EVENT_TYPES, invalidationMap } from "../queries";

const MAX_BACKOFF_MS = 30_000;

export function useEventStream(enabled = true): { connected: boolean } {
  const qc = useQueryClient();
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    if (!enabled) return;
    let stopped = false;
    let attempt = 0;
    let close: (() => void) | null = null;
    let timer: number | undefined;

    const connect = () => {
      if (stopped) return;
      close = api.streamEvents(
        (event) => {
          const keys = invalidationMap[event.type];
          if (!keys) return;
          for (const key of keys) {
            qc.invalidateQueries({ queryKey: key }).catch(() => {
              /* invalidation never rejects in practice */
            });
          }
        },
        {
          types: OS_EVENT_TYPES,
          onOpen: () => {
            attempt = 0;
            setConnected(true);
          },
          onError: () => {
            setConnected(false);
            close?.();
            close = null;
            if (stopped) return;
            const delay = Math.min(MAX_BACKOFF_MS, 1000 * 2 ** attempt);
            attempt += 1;
            timer = window.setTimeout(connect, delay);
          },
        },
      );
    };
    connect();

    return () => {
      stopped = true;
      window.clearTimeout(timer);
      close?.();
    };
  }, [enabled, qc]);

  return { connected };
}
