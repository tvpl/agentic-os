import { Link } from "react-router-dom";
import { useT } from "../../i18n";
import { qk, useApiQuery, useOsMetrics, useOsSettings } from "../../queries";
import { budgetState } from "../budget";
import { StatusBadge } from "../../components/ui";
import { useDesktopRoutines, useDesktopRuns } from "../data";
import { WidgetGate } from "./WidgetGate";

interface Approval {
  id: string;
  kind: string;
  reason?: string;
}

export default function AttentionWidget() {
  const t = useT();
  const routines = useDesktopRoutines();
  const runs = useDesktopRuns();
  // Approvals are optional: a failure here only hides the approvals chip.
  const approvals = useApiQuery<Approval[]>(qk.approvals, "/api/approvals", { refetchInterval: 300_000 });

  const failures = (runs.data ?? [])
    .filter((r) => r.status === "failed" || r.status === "timed_out")
    .slice(0, 3);
  const unhealthy = (routines.data ?? []).filter((r) => !r.healthy);
  // Runs in progress live in the Now panel: attention means failure,
  // approval or an unhealthy routine — never "something is happening".
  const pending = approvals.data?.length ?? 0;
  const metrics = useOsMetrics({ refetchInterval: 300_000 });
  const settings = useOsSettings();
  const budget = budgetState(settings.data?.limits?.dailyBudgetUsd, metrics.data?.cost?.todayUsd);
  const budgetHot = budget.tone === "warn" || budget.tone === "over";

  const clear = failures.length === 0 && unhealthy.length === 0 && pending === 0 && !budgetHot;
  // The prototype's rows: a tag, the thing, and the way in. Links for now;
  // G3 makes "trace" open the run as a panel on the stage.
  return (
    <WidgetGate queries={[routines, runs]} lines={1}>
      {clear ? (
        <p className="attention-clear">{t("dash.allClear")}</p>
      ) : (
        <div className="attention-rows">
          {pending > 0 && (
            <div className="rw">
              <span className="tg t">{t("desktop.core.waiting")}</span>
              <span className="truncate">{t("dash.pendingApprovals", { n: pending })}</span>
              <span className="sp" />
              <Link to="/settings" className="go">
                {t("desktop.prompt.approve")}
              </Link>
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
              <span className="tg f">{r.recentFailures}×</span>
              <span className="truncate">{r.name}</span>
              <span className="sp" />
              <Link to="/routines" className="go">
                {t("desktop.widget.routines")}
              </Link>
            </div>
          ))}
          {failures.map((r) => (
            <div className="rw" key={r.id}>
              <StatusBadge status={r.status} />
              <span className="truncate">{r.skillSlug ?? r.promptSummary.slice(0, 42)}</span>
              <span className="sp" />
              <Link to={`/runs/${r.id}`} className="go">
                trace
              </Link>
            </div>
          ))}
        </div>
      )}
    </WidgetGate>
  );
}
