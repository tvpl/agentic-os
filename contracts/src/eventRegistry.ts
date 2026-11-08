/**
 * Which events exist and which versions of each there have been: the part of the event contract a browser can import
 * without zod (`@mordomo/contracts/events`). The schemas of the payloads live in `eventSchemas.ts`.
 *
 * Evolution policy (docs/events.md):
 *  - A field added to an envelope or a payload is compatible: the version stays. Readers ignore a key they do not know.
 *  - A change a reader of the old version cannot survive (a field removed, renamed, retyped, or given another meaning)
 *    adds `version + 1` to the type's list; the old schema stays in `EVENT_SCHEMAS` for as long as any release that
 *    emits or stores it exists, and an emitter keeps sending the version its clients understand.
 *  - A client ignores an event whose type it does not know, or whose version is above the highest it knows for that
 *    type (`classifyEvent`), without throwing and without closing the stream.
 */

import { deepFreeze } from "./freeze.js";

/** Every event the bus emits and `GET /api/events` relays, in the order of `OsEventMap`. */
export const OS_EVENT_TYPES = [
  "run.created",
  "run.started",
  "run.event",
  "run.finished",
  "routine.fired",
  "routine.alert",
  "routine.changed",
  "index.started",
  "index.progress",
  "index.finished",
  "index.failed",
  "index.cancelled",
  "cleanup.progress",
  "cleanup.finished",
  "cleanup.failed",
  "dashboard.refreshed",
  "approval.requested",
  "approval.resolved",
  "approval.expired",
  "session.created",
  "session.updated",
  "objective.changed",
  "settings.changed",
  "backup.created",
  "notification.created",
  "notification.read",
  "budget.crossed",
  "sentinel.fired",
  "stream.reset",
] as const;

export type OsEventTypeName = (typeof OS_EVENT_TYPES)[number];

/** The frames `GET /api/runs/:id/stream` sends: the events of a run and the final `run_state`. */
export const RUN_FRAME_TYPES = [
  "started",
  "text",
  "assistant",
  "tool_use",
  "permission",
  "session",
  "result",
  "error",
  "usage",
  "run_state",
] as const;

export type RunFrameType = (typeof RUN_FRAME_TYPES)[number];

/** The versions each event type has had, oldest first and contiguous from 1; the current version is the last. */
export const EVENT_VERSIONS = deepFreeze({
  "run.created": [1],
  "run.started": [1],
  "run.event": [1],
  "run.finished": [1],
  "routine.fired": [1],
  "routine.alert": [1],
  "routine.changed": [1],
  "index.started": [1],
  "index.progress": [1],
  "index.finished": [1],
  "index.failed": [1],
  "index.cancelled": [1],
  "cleanup.progress": [1],
  "cleanup.finished": [1],
  "cleanup.failed": [1],
  "dashboard.refreshed": [1],
  "approval.requested": [1],
  "approval.resolved": [1],
  "approval.expired": [1],
  "session.created": [1],
  "session.updated": [1],
  "objective.changed": [1],
  "settings.changed": [1],
  "backup.created": [1],
  "notification.created": [1],
  "notification.read": [1],
  "budget.crossed": [1],
  "sentinel.fired": [1],
  "stream.reset": [1],
} as const satisfies { readonly [K in OsEventTypeName]: readonly number[] });

/** The versions an event of this type may carry in its envelope. */
export type EventVersionOf<K extends OsEventTypeName> = (typeof EVENT_VERSIONS)[K][number];

/** The same for the frames of a run's stream. */
export const RUN_FRAME_VERSIONS: { readonly [K in RunFrameType]: readonly number[] } = deepFreeze({
  started: [1],
  text: [1],
  assistant: [1],
  tool_use: [1],
  permission: [1],
  session: [1],
  result: [1],
  error: [1],
  usage: [1],
  run_state: [1],
});

/** The version an emitter stamps on an event of this type. */
export function currentEventVersion<K extends OsEventTypeName>(type: K): EventVersionOf<K> {
  const versions: readonly number[] = EVENT_VERSIONS[type];
  return versions[versions.length - 1] as EventVersionOf<K>;
}

/** The version a server stamps on a frame of this type. */
export function currentRunFrameVersion(type: RunFrameType): number {
  const versions = RUN_FRAME_VERSIONS[type];
  return versions[versions.length - 1]!;
}

export type EventClass =
  | { readonly kind: "known"; readonly type: string; readonly v: number }
  | { readonly kind: "unknown_type"; readonly type: unknown }
  | { readonly kind: "unsupported_version"; readonly type: string; readonly v: unknown };

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

function classify(
  raw: unknown,
  versions: { readonly [type: string]: readonly number[] },
  absentVersion: number | null,
): EventClass {
  if (!isRecord(raw)) return { kind: "unknown_type", type: undefined };
  const { type } = raw;
  if (typeof type !== "string" || !Object.prototype.hasOwnProperty.call(versions, type)) {
    return { kind: "unknown_type", type };
  }
  const v = raw.v === undefined && absentVersion !== null ? absentVersion : raw.v;
  if (typeof v !== "number" || !Number.isInteger(v) || !versions[type]!.includes(v)) {
    return { kind: "unsupported_version", type, v };
  }
  return { kind: "known", type, v };
}

/**
 * Can this client read this event of the bus? `known` when its type is in `OS_EVENT_TYPES` and its `v` is one of the
 * versions the type has had; otherwise the event is to be dropped, and the reason says why. Never throws.
 */
export function classifyEvent(raw: unknown): EventClass {
  return classify(raw, EVENT_VERSIONS, null);
}

/**
 * The same for a frame of a run's stream. A frame without `v` was sent by a server that predates the version on
 * frames, and reads as version 1.
 */
export function classifyRunFrame(raw: unknown): EventClass {
  return classify(raw, RUN_FRAME_VERSIONS, 1);
}
