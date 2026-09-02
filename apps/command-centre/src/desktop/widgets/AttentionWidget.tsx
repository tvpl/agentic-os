import { Link } from "react-router-dom";
import { useT } from "../../i18n";
import { qk, useApiQuery } from "../../queries";
import { StatusBadge } from "../../components/ui";
import { isActiveStatus, useDesktopRoutines, useDesktopRuns } from "../data";
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
  const approvals = useApiQuery<Approval[]>(qk.approvals, "/api/approvals", { refetchInterval: 60_000 });

  const failures = (runs.data ?? []).filter((r) => r.status === "failed" || r.status === "timed_out").slice(0, 3);
  const unhealthy = (routines.data ?? []).filter((r) => !r.healthy);
  const running = (runs.data ?? []).filter((r) => isActiveStatus(r.status));
  const pending = approvals.data?.length ?? 0;

  return (
    <WidgetGate queries={[routines, runs]} lines={1}>
      {failures.length === 0 && unhealthy.length === 0 && running.length === 0 && pending === 0 ? (
        <p className="attention-clear">{t("dash.allClear")}</p>
      ) : (
        <div className="attention-row">
          {pending > 0 && (
            <Link to="/settings" className="badge warn plain">
              {t("dash.pendingApprovals", { n: pending })}
            </Link>
          )}
          {running.map((r) => (
            <Link key={r.id} to={`/runs/${r.id}`} className="badge info plain">
              <span className="spinner sm" aria-hidden /> {r.skillSlug ?? r.provider}
            </Link>
          ))}
          {unhealthy.map((r) => (
            <Link key={r.id} to="/routines" className="badge danger plain">
              {r.name} · {r.recentFailures}×
            </Link>
          ))}
          {failures.map((r) => (
            <Link key={r.id} to={`/runs/${r.id}`} className="attention-failure">
              <StatusBadge status={r.status} /> <span className="truncate">{r.skillSlug ?? r.promptSummary.slice(0, 42)}</span>
            </Link>
          ))}
        </div>
      )}
    </WidgetGate>
  );
}
