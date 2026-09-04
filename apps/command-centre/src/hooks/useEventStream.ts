/**
 * One `/api/events` SSE connection for the whole shell (audit item 27).
 * Every event invalidates the query keys listed in `invalidationMap`, so
 * views stop polling. Reconnects with exponential backoff (1 s → 30 s).
 */
import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { api, type OsEvent } from "../api";
import { OS_EVENT_TYPES, invalidationMap } from "../queries";

const MAX_BACKOFF_MS = 30_000;

/* ---- fan-out: one connection, many consumers (notifications, widgets) ---- */
export type OsEventListener = (event: OsEvent) => void;
const listeners = new Set<OsEventListener>();

/** Subscribe to every OS event the shell stream receives. Returns the unsubscribe. */
export function subscribeOsEvents(fn: OsEventListener): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

function fanOut(event: OsEvent) {
  for (const fn of listeners) {
    try {
      fn(event);
    } catch (err) {
      console.error("[events] listener threw", err);
    }
  }
}

/**
 * React to specific OS event types. The handler is read through a ref, so an
 * inline arrow is fine and never re-subscribes.
 */
export function useOsEvent(types: string | readonly string[], handler: OsEventListener): void {
  const ref = useRef(handler);
  ref.current = handler;
  const key = Array.isArray(types) ? types.join("|") : String(types);
  useEffect(() => {
    const wanted = new Set(key.split("|"));
    return subscribeOsEvents((event) => {
      if (wanted.has(event.type)) ref.current(event);
    });
  }, [key]);
}

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
          fanOut(event);
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
