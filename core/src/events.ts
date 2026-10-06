/**
 * Process-wide typed event bus.
 *
 * One place where the core announces what is happening (runs, routines,
 * indexing, approvals) so the API can fan it out over SSE (`/api/events`)
 * and the Command Centre can stop polling. Emitters never await listeners;
 * a throwing listener is isolated and reported on the "error" channel.
 */

import { OS_EVENT_VERSION, type OsEvent, type OsEventMap, type OsEventType } from "@mordomo/contracts";

export { OS_EVENT_VERSION, type OsEvent, type OsEventMap, type OsEventType };

export type OsEventListener = (event: OsEvent) => void;

export class EventBus {
  private listeners = new Set<OsEventListener>();
  private seq = 0;
  private readonly ring: OsEvent[] = [];
  private readonly pending: OsEvent[] = [];
  private dispatching = false;
  constructor(private readonly ringSize = 500) {}

  /** Announce an event; the payload type is the one `OsEventMap` names for `type`. */
  emit<K extends OsEventType>(type: K, payload: OsEventMap[K]): OsEvent<K> {
    const event = { id: ++this.seq, type, ts: Date.now(), v: OS_EVENT_VERSION, payload } as OsEvent<K>;
    const stored = event as OsEvent;
    this.ring.push(stored);
    if (this.ring.length > this.ringSize) this.ring.shift();
    this.pending.push(stored);
    if (this.dispatching) return event;
    this.dispatching = true;
    try {
      while (this.pending.length) {
        const next = this.pending.shift()!;
        for (const fn of this.listeners) {
          try {
            fn(next);
          } catch (err) {
            console.error("[events] listener threw", err);
          }
        }
      }
    } finally {
      this.dispatching = false;
    }
    return event;
  }

  subscribe(fn: OsEventListener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /** Events emitted after the given id (for SSE resume). */
  since(id: number): OsEvent[] {
    return this.ring.filter((e) => e.id > id);
  }

  get lastId(): number {
    return this.seq;
  }
}

/** Shared bus for the process. Tests may construct their own `EventBus`. */
export const events = new EventBus();
