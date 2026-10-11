/**
 * The mission (refino items 6 and 31): the objective in progress, step by
 * step, with the run behind each step one click away and a retry for the
 * ones that stalled. The core carries its progress while it runs.
 */
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Play, RotateCcw, Target } from "lucide-react";
import { type Objective, type ObjectiveStep } from "../../api";
import { apiCall } from "../../apiCall";
import { useT, type TKey } from "../../i18n";
import { qk, useOsObjectives } from "../../queries";
import { EmptyState } from "../../components/primitives";
import { useToast } from "../../components/ui";
import { useDesktopActions } from "../actions";
import { WidgetGate } from "./WidgetGate";
import type { WidgetProps } from "../widgetTypes";
import { Tooltip } from "../../ui";

const STEP_KEY: Record<string, TKey> = {
  pending: "desktop.objectives.pending",
  dispatched: "desktop.objectives.dispatched",
  waiting_approval: "desktop.objectives.waiting_approval",
  verifying: "desktop.objectives.verifying",
};

export function missionProgress(o: Objective): { done: number; total: number } {
  return { done: o.steps.filter((s) => s.status === "verified").length, total: o.steps.length };
}

export default function MissionWidget(_props: WidgetProps) {
  const t = useT();
  const toast = useToast();
  const qc = useQueryClient();
  const { openRun } = useDesktopActions();
  const objectives = useOsObjectives({ refetchInterval: 20_000 });
  const live = (objectives.data ?? []).filter((o) => o.status === "active" || o.status === "blocked");
  const recent = (objectives.data ?? []).filter((o) => o.status === "completed").slice(0, 2);
  const refresh = () => {
    qc.invalidateQueries({ queryKey: qk.objectives }).catch(() => undefined);
    qc.invalidateQueries({ queryKey: ["runs"] }).catch(() => undefined);
  };
  const dispatch = useMutation({
    mutationFn: (id: string) =>
      apiCall("POST /api/objectives/:id/dispatch", { params: { id }, body: { limit: 3 } }),
    onSuccess: (r) => {
      toast(t("desktop.objectives.dispatchedCount", { n: r.dispatched.length }), "ok");
      refresh();
    },
    onError: (err: Error) => toast(err.message, "danger"),
  });
  const retry = useMutation({
    mutationFn: ({ id, step }: { id: string; step: string }) =>
      apiCall("POST /api/objectives/:id/steps/:stepId/retry", { params: { id, stepId: step }, body: {} }),
    onSuccess: refresh,
    onError: (err: Error) => toast(err.message, "danger"),
  });
  const stepLabel = (s: ObjectiveStep) => (STEP_KEY[s.status] ? t(STEP_KEY[s.status]!) : s.status);
  return (
    <WidgetGate queries={[objectives]} lines={3}>
      {live.length === 0 && recent.length === 0 ? (
        <EmptyState
          className="compact"
          icon={<Target aria-hidden />}
          title={t("desktop.mission.empty")}
          body={t("desktop.mission.emptyBody")}
        />
      ) : (
        <div className="mission">
          {[...live, ...recent].map((o) => {
            const p = missionProgress(o);
            return (
              <div key={o.id} className={`mission-card ${o.status}`}>
                <div className="mission-head">
                  <span className="mission-title truncate" title={o.description}>
                    {o.title}
                  </span>
                  <span className="mono dm">
                    {p.done}/{p.total}
                  </span>
                  {o.status !== "completed" && (
                    <Tooltip label={t("desktop.objectives.continue")}>
                      <button
                        type="button"
                        className="go icon"
                        aria-label={t("desktop.objectives.continue")}
                        disabled={dispatch.isPending}
                        onClick={() => dispatch.mutate(o.id)}
                      >
                        <Play aria-hidden />
                      </button>
                    </Tooltip>
                  )}
                </div>
                <div className="mission-bar" aria-hidden>
                  <span style={{ width: `${p.total ? (p.done / p.total) * 100 : 0}%` }} />
                </div>
                <ol className="mission-steps">
                  {o.steps.map((s) => (
                    <li key={s.id} className={`step-${s.status}`}>
                      <span className="mission-step-dot" aria-hidden />
                      <span className="truncate">{s.title}</span>
                      <span className="sp" />
                      <span className="dm">
                        {s.status === "verified" ? "✓" : s.status === "blocked" ? "!" : stepLabel(s)}
                      </span>
                      {s.runId && (
                        <button type="button" className="go" onClick={() => openRun(s.runId!)}>
                          {t("desktop.console.open")}
                        </button>
                      )}
                      {s.status === "blocked" && (
                        <Tooltip label={t("desktop.attention.rerun")}>
                          <button
                            type="button"
                            className="go icon"
                            aria-label={t("desktop.attention.rerun")}
                            disabled={retry.isPending}
                            onClick={() => retry.mutate({ id: o.id, step: s.id })}
                          >
                            <RotateCcw aria-hidden />
                          </button>
                        </Tooltip>
                      )}
                    </li>
                  ))}
                </ol>
              </div>
            );
          })}
        </div>
      )}
    </WidgetGate>
  );
}
