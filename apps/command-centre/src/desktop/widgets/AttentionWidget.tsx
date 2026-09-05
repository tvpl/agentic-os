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

  return (
    <WidgetGate queries={[routines, runs]} lines={1}>
      {failures.length === 0 && unhealthy.length === 0 && pending === 0 && !budgetHot ? (
        <p className="attention-clear">{t("dash.allClear")}</p>
      ) : (
        <div className="attention-row">
          {pending > 0 && (
            <Link to="/settings" className="badge warn plain">
              {t("dash.pendingApprovals", { n: pending })}
            </Link>
          )}
          {budgetHot && (
            <Link
              to="/settings?tab=security"
              className={`badge ${budget.tone === "over" ? "danger" : "warn"} plain`}
            >
              {t(budget.tone === "over" ? "dash.budgetOver" : "dash.budgetWarn", {
                pct: Math.round(budget.ratio * 100),
              })}
            </Link>
          )}
          {unhealthy.map((r) => (
            <Link key={r.id} to="/routines" className="badge danger plain">
              {r.name} · {r.recentFailures}×
            </Link>
          ))}
          {failures.map((r) => (
            <Link key={r.id} to={`/runs/${r.id}`} className="attention-failure">
              <StatusBadge status={r.status} />{" "}
              <span className="truncate">{r.skillSlug ?? r.promptSummary.slice(0, 42)}</span>
            </Link>
          ))}
        </div>
      )}
    </WidgetGate>
  );
}
