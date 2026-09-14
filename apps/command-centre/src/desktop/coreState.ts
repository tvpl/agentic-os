/**
 * What the agent is doing, as seen from the event stream, and the persistent
 * state shown between transient events.
 *
 * `thinking` is any active run without a finer signal; `tool` / `responding`
 * are short-lived overrides fired by `run.event`; `alert` and `done` are
 * terminal flashes. The desktop publishes it as `data-core` and the agent
 * presence behind the console breathes with it.
 */
export type CoreState =
  | "idle"
  | "listening"
  | "queued"
  | "thinking"
  | "tool"
  | "responding"
  | "waiting"
  | "alert"
  | "done"
  | "cancelled"
  | "interrupted";

/** Persistent state shown between transient stream events. */
export function baseCoreState(runs: ReadonlyArray<{ status: string }>): CoreState {
  if (runs.some((run) => run.status === "running")) return "thinking";
  if (runs.some((run) => run.status === "waiting_approval")) return "waiting";
  if (runs.some((run) => run.status === "queued")) return "queued";
  return "idle";
}
