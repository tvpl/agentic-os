/**
 * skillSlug → runId for the runs that are still in flight (pure, tested).
 * Consumed by `useRunningSkills()` and, through it, by the desktop deck so a
 * card can link straight to the run it started.
 */
import type { RunRecord } from "../api";
import { ACTIVE_RUN_STATUSES } from "./status";

/** Newest active run wins when a skill was started twice. */
export function runningSkillMap(runs: readonly RunRecord[] | undefined): Map<string, string> {
  const out = new Map<string, string>();
  const active = (runs ?? []).filter((r) => r.skillSlug && ACTIVE_RUN_STATUSES.includes(r.status));
  for (const run of [...active].sort((a, b) => a.createdAt - b.createdAt)) out.set(run.skillSlug!, run.id);
  return out;
}
