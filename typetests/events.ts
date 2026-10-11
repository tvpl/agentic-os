/**
 * Contracts (.specs/features/contratos, C8, C9): the bus only accepts the
 * payload the event map names, and the map covers every event type exactly.
 */
import { EventBus } from "@mordomo/core/internal";
import type { OsEvent, OsEventMap, OsEventType } from "@mordomo/contracts";

const bus = new EventBus();

// C8 — a right payload compiles…
bus.emit("run.finished", { runId: "x", status: "done", durationMs: 1 });
// …a wrong one does not.
// @ts-expect-error runId must be a string
bus.emit("run.finished", { runId: 1, status: "done", durationMs: 1 });
// @ts-expect-error settings.changed carries the settings document
bus.emit("settings.changed", { nope: true });

// C8 — each shape of the four events emitted from more than one place is accepted.
bus.emit("routine.alert", {
  routineId: "r",
  runId: null,
  summary: "s",
  reason: "budget",
  spentUsd: 1,
  budgetUsd: 2,
});
bus.emit("routine.alert", { routineId: "r", runId: "x", status: "failed", summary: "s" });
bus.emit("routine.changed", { id: "r", action: "ended", reason: "done" });
bus.emit("routine.changed", { id: "r", action: "updated" });
bus.emit("session.updated", { sessionId: "s", providerSessionId: "p" });
bus.emit("session.updated", { sessionId: "s", lastRunId: null, turns: 1, costUsd: 0 });
bus.emit("session.updated", { sessionId: "s", title: "t" });
bus.emit("session.updated", { sessionId: "s", deleted: true, runsKept: 2 });
bus.emit("objective.changed", { objectiveId: "o", status: "running" });
bus.emit("objective.changed", { objectiveId: "o", deleted: true });
bus.emit("objective.changed", { objectiveId: "o", stepId: "st" });
bus.emit("objective.changed", { objectiveId: "o", stepId: "st", status: "done" });

// C9 — the map has exactly one entry per event type.
type Missing = Exclude<OsEventType, keyof OsEventMap>;
type Extra = Exclude<keyof OsEventMap, OsEventType>;
export const noMissing: [Missing] extends [never] ? true : false = true;
export const noExtra: [Extra] extends [never] ? true : false = true;

// Security P1, C14 — `stream.reset` carries the process's last id, in envelope version 1.
type ResetEvent = OsEvent<"stream.reset">;
export const resetPayload: ResetEvent["payload"] = { lastId: 3 };
// @ts-expect-error lastId is a number
export const resetBadId: ResetEvent["payload"] = { lastId: "3" };
// @ts-expect-error the payload has nothing but lastId
export const resetExtra: ResetEvent["payload"] = { lastId: 3, more: true };
export const resetVersion: ResetEvent["v"] = 1;
// @ts-expect-error the envelope is version 1
export const resetWrongVersion: ResetEvent["v"] = 2;
