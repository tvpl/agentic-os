import type { EventBus } from "../events.js";

/**
 * Sentinels (Onda 2, item 1).
 *
 * A sentinel is an observer that costs nothing: no LLM, no provider process,
 * no network beyond what the connector client already does. It watches one
 * cheap signal (the file system, the runs table, the routine history, a
 * connector read) and, when something is worth a human's attention, emits a
 * single `sentinel.fired` event on the bus.
 *
 * Everything downstream is somebody else's job:
 *  - the notification recorder turns the event into an inbox row;
 *  - the triage listener (`triage.ts`) may spend a few cents on a short,
 *    read-only run when the payload asks for it (`triage: true`).
 *
 * The split matters: a sentinel that decided what to do with its own finding
 * would need an LLM, and then it would no longer be free.
 */

export type SentinelId = "fsWatch" | "repeatedFailure" | "silentRoutine" | "connectorDelta";

export const SENTINEL_IDS: readonly SentinelId[] = [
  "fsWatch",
  "repeatedFailure",
  "silentRoutine",
  "connectorDelta",
];

export type SentinelSeverity = "info" | "warn" | "danger";

/** Payload of `sentinel.fired`. */
export interface SentinelFiredPayload {
  sentinel: SentinelId;
  title: string;
  body: string;
  severity: SentinelSeverity;
  /** Where the Command Centre should send the reader. */
  href?: string;
  /** Rows sharing this key collapse (see `NotificationStore.hasDedupeKey`). */
  dedupeKey?: string;
  /** Ask the triage run to decide what this means (costs money — see `triage.ts`). */
  triage?: boolean;
}

/** Emit a finding. Kept in one place so every sentinel announces the same way. */
export function emitSentinel(bus: EventBus, payload: SentinelFiredPayload): SentinelFiredPayload {
  bus.emit("sentinel.fired", payload);
  return payload;
}

/** Local `YYYY-MM-DD`, the granularity every "once a day" dedupe key uses. */
export function sentinelDay(at = Date.now()): string {
  const d = new Date(at);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** `sentinel:<id>:<day>:<subject>` — the shape of every daily dedupe key. */
export function sentinelDedupeKey(sentinel: SentinelId, subject: string, at = Date.now()): string {
  return `sentinel:${sentinel}:${sentinelDay(at)}:${subject}`;
}

/** What a sentinel needs to know whether it already said this today. */
export interface DedupeLookup {
  hasDedupeKey(key: string, since?: number): boolean;
}
