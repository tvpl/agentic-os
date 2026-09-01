/**
 * Process-wide typed event bus.
 *
 * One place where the core announces what is happening (runs, routines,
 * indexing, approvals) so the API can fan it out over SSE (`/api/events`)
 * and the Command Centre can stop polling. Emitters never await listeners;
 * a throwing listener is isolated and reported on the "error" channel.
 */

export type OsEventType =
  | "run.created"
  | "run.started"
  | "run.event"
  | "run.finished"
  | "routine.fired"
  | "routine.changed"
  | "index.progress"
  | "index.finished"
  | "approval.requested"
  | "approval.resolved"
  | "settings.changed"
  | "backup.created";

export interface OsEvent<T = unknown> {
  /** Monotonic id (per process) so SSE clients can resume with Last-Event-ID. */
  id: number;
  type: OsEventType;
  ts: number;
  payload: T;
}

export type OsEventListener = (event: OsEvent) => void;

export class EventBus {
  private listeners = new Set<OsEventListener>();
  private seq = 0;
  private readonly ring: OsEvent[] = [];
  constructor(private readonly ringSize = 500) {}

  emit<T>(type: OsEventType, payload: T): OsEvent<T> {
    const event: OsEvent<T> = { id: ++this.seq, type, ts: Date.now(), payload };
    this.ring.push(event);
    if (this.ring.length > this.ringSize) this.ring.shift();
    for (const fn of this.listeners) {
      try {
        fn(event);
      } catch (err) {
        // A misbehaving listener must never break the emitter.
        // eslint-disable-next-line no-console
        console.error("[events] listener threw", err);
      }
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
