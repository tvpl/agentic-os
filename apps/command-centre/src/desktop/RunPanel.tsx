/**
 * A run on the stage (redesign G3). The body is the run's own detail — the
 * live timeline, the files it changed, its cost — inside a plate rather
 * than on a page, so the console can point the agent at it (`@run-41`) and
 * the desktop stays where it was.
 *
 * When the run finishes, the artifacts it produced open as panels of their
 * own and land in the console's tray: the result is on the desk before you
 * go looking for it. Done once per run, whatever re-renders after.
 */
import { useEffect, useRef } from "react";
import RunDetail from "../runs/RunDetail";
import { isRunActive, useRunQuery } from "../runs/useRunStream";
import { qk, useInvalidate, useOsArtifacts } from "../queries";
import { useDesktopActions } from "./actions";

/** More than this and the desk is buried; the rest stays in the Artifacts app. */
const OPEN_AT_MOST = 3;

export default function RunPanel({ runId }: { runId: string }) {
  const { openDoc } = useDesktopActions();
  const invalidate = useInvalidate();
  const detail = useRunQuery(runId);
  const artifacts = useOsArtifacts();
  const status = detail.data?.run.status;
  const finished = status !== undefined && !isRunActive(status);
  const opened = useRef(false);
  const settledAt = useRef<number | null>(null);

  // The artifact list is a separate query: ask for it again once, when the
  // run settles, so the files this run just wrote are in it.
  useEffect(() => {
    if (!finished || settledAt.current !== null) return;
    settledAt.current = Date.now();
    void invalidate(qk.artifacts);
  }, [finished, invalidate]);

  useEffect(() => {
    if (!finished || opened.current || !artifacts.data || artifacts.isFetching) return;
    // Only what this run wrote after it started: an older artifact from the
    // same run id (a resumed session) is not a result of this turn.
    const mine = artifacts.data.filter((a) => a.runId === runId);
    if (mine.length === 0) return;
    opened.current = true;
    for (const a of mine.slice(0, OPEN_AT_MOST)) openDoc(a.path);
  }, [finished, artifacts.data, artifacts.isFetching, runId, openDoc]);

  return (
    <div className="run-panel" data-run-status={status ?? "loading"}>
      <RunDetail id={runId} />
    </div>
  );
}
