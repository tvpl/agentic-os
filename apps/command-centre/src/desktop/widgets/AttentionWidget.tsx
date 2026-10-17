/**
 * What needs a look (refino item 21). Same definition as the pod and the
 * strip (`signal.ts`): an approval or an exhausted budget is a decision,
 * a fresh failure or an unhealthy routine is worth a look, and a failure
 * older than a day is history — listed under a fold, never counted.
 *
 * Every row carries a way out: open the trace, run it again, or silence it.
 */
import { useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { BellOff, RotateCcw } from "lucide-react";
import { type RunSummary } from "../../api";
import { apiCall } from "../../apiCall";
import { useDesktopActions } from "../actions";
import { useT } from "../../i18n";
import { qk, useApiQuery, useOsMetrics, useOsSettings } from "../../queries";
import { StatusBadge, useToast } from "../../components/ui";
import { budgetState } from "../budget";
import { useDesktopRoutines, useDesktopRuns } from "../data";
import { isFreshFailure } from "../signal";
import { mute, readMuted } from "../attentionMute";
import { WidgetGate } from "./WidgetGate";
import { Tooltip } from "../../ui";

interface Approval {
  id: string;
  kind: string;
  reason?: string;
}

export default function AttentionWidget() {
  const t = useT();
  const toast = useToast();
  const qc = useQueryClient();
  const { openPanel, openRun } = useDesktopActions();
  const routines = useDesktopRoutines();
  const runs = useDesktopRuns();
  // Approvals are optional: a failure here only hides the approvals chip.
  const approvals = useApiQuery<Approval[]>(qk.approvals, "/api/approvals", { refetchInterval: 300_000 });
  const metrics = useOsMetrics({ refetchInterval: 300_000 });
  const settings = useOsSettings();
  const [muted, setMuted] = useState(() => readMuted());
  const [showStale, setShowStale] = useState(false);

  const now = Date.now();
  const failed = (runs.data ?? []).filter(
    (r) => (r.status === "failed" || r.status === "timed_out") && !muted.has(r.id),
  );
  const fresh = failed.filter((r) => isFreshFailure(r.finishedAt ?? r.createdAt, now)).slice(0, 5);
  const stale = failed.filter((r) => !isFreshFailure(r.finishedAt ?? r.createdAt, now));
  const unhealthy = (routines.data ?? []).filter((r) => !r.healthy);
  const pending = approvals.data?.length ?? 0;
  const budget = budgetState(settings.data?.limits?.dailyBudgetUsd, metrics.data?.cost?.todayUsd);
  const budgetHot = budget.tone === "warn" || budget.tone === "over";

  const retry = useMutation({
    mutationFn: (id: string) =>
      apiCall("POST /api/runs/:id/retry", {
        params: { id },
        body: {
          submissionId: crypto.randomUUID(),
        },
      }),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ["runs"] }).catch(() => undefined);
      if (res.runId) openRun(res.runId);
      else {
        qc.invalidateQueries({ queryKey: qk.approvals }).catch(() => undefined);
        toast(t("runs.approve.queued"), "info");
      }
    },
    onError: (err: Error) => toast(err.message, "danger"),
  });

  const silence = (id: string) => setMuted((cur) => mute(cur, id));

  const clear = fresh.length === 0 && unhealthy.length === 0 && pending === 0 && !budgetHot;

  const failureRow = (r: RunSummary, dim: boolean) => (
    <div className={`rw${dim ? " stale" : ""}`} key={r.id}>
      <StatusBadge status={r.status} />
      <span className="truncate">{r.skillSlug ?? r.promptSummary.slice(0, 42)}</span>
      <span className="sp" />
      <button type="button" className="go" onClick={() => openRun(r.id)}>
        {t("desktop.attention.open")}
      </button>
      <Tooltip label={t("desktop.attention.rerun")}>
        <button
          type="button"
          className="go icon"
          aria-label={t("desktop.attention.rerun")}
          disabled={retry.isPending}
          onClick={() => retry.mutate(r.id)}
        >
          <RotateCcw aria-hidden />
        </button>
      </Tooltip>
      <Tooltip label={t("desktop.attention.mute")}>
        <button
          type="button"
          className="go icon quiet"
          aria-label={t("desktop.attention.mute")}
          onClick={() => silence(r.id)}
        >
          <BellOff aria-hidden />
        </button>
      </Tooltip>
    </div>
  );

  return (
    <WidgetGate queries={[routines, runs]} lines={1}>
      {clear ? (
        <p className="attention-clear">{t("dash.allClear")}</p>
      ) : (
        <div className="attention-rows">
          {pending > 0 && (
            <div className="rw">
              <span className="tg f">{t("desktop.core.waiting")}</span>
              <span className="truncate">{t("dash.pendingApprovals", { n: pending })}</span>
              <span className="sp" />
              <button type="button" className="go" onClick={() => openPanel("approvals")}>
                {t("desktop.prompt.approve")}
              </button>
            </div>
          )}
          {budgetHot && (
            <div className="rw">
              <span className={`tg ${budget.tone === "over" ? "f" : "t"}`}>{t("desktop.widget.cost")}</span>
              <span className="truncate">
                {t(budget.tone === "over" ? "dash.budgetOver" : "dash.budgetWarn", {
                  pct: Math.round(budget.ratio * 100),
                })}
              </span>
              <span className="sp" />
              <Link to="/settings?tab=security" className="go">
                {t("nav.settings")}
              </Link>
            </div>
          )}
          {unhealthy.map((r) => (
            <div className="rw" key={r.id}>
              <span className="tg t">{r.recentFailures}×</span>
              <span className="truncate">{r.name}</span>
              <span className="sp" />
              <Link to="/routines" className="go">
                {t("desktop.widget.routines")}
              </Link>
            </div>
          ))}
          {fresh.map((r) => failureRow(r, false))}
        </div>
      )}
      {stale.length > 0 && (
        <div className="attention-stale" data-open={showStale || undefined}>
          <button
            type="button"
            className="attention-stale-head"
            aria-expanded={showStale}
            title={t("desktop.attention.staleHint")}
            onClick={() => setShowStale((v) => !v)}
          >
            <span className="cp">{t("desktop.attention.stale", { n: stale.length })}</span>
            <span className="sp" />
            <span className="dm">
              {showStale ? t("desktop.attention.hideStale") : t("desktop.attention.showStale")}
            </span>
          </button>
          {showStale && (
            <div className="attention-rows">{stale.slice(0, 8).map((r) => failureRow(r, true))}</div>
          )}
        </div>
      )}
    </WidgetGate>
  );
}
