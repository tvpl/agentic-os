import type { EventBus } from "../events.js";
import {
  SENTINEL_IDS,
  type SentinelFiredPayload,
  type SentinelId,
  type SentinelSeverity,
} from "@mordomo/contracts";

export { SENTINEL_IDS, type SentinelFiredPayload, type SentinelId, type SentinelSeverity };

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
