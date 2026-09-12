import type { CoreState } from "./Wallpaper";

/** Persistent state shown by the core between transient stream events. */
export function baseCoreState(runs: ReadonlyArray<{ status: string }>): CoreState {
  if (runs.some((run) => run.status === "running")) return "thinking";
  if (runs.some((run) => run.status === "waiting_approval")) return "waiting";
  if (runs.some((run) => run.status === "queued")) return "queued";
  return "idle";
}
