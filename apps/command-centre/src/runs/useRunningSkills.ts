/**
 * `skillSlug → runId` for every run still in flight. The desktop deck and the
 * launcher use it to show a "running now" indicator that links to the run;
 * the map comes from the shared runs cache, so it costs no extra request.
 */
import { useMemo } from "react";
import { useOsRuns } from "../queries";
import { runningSkillMap } from "./runningSkills";

export function useRunningSkills(): Map<string, string> {
  const runs = useOsRuns({ limit: 50 }, { refetchInterval: 300_000 });
  return useMemo(() => runningSkillMap(runs.data), [runs.data]);
}

export default useRunningSkills;
