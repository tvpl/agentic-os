/**
 * The failure's cause and its one action (refino item 43), shared by the
 * run's outcome card and the console's failed turn.
 */
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { api } from "../api";
import { useT } from "../i18n";
import { qk, useOsProviders } from "../queries";
import { useToast } from "../components/ui";
import { useDesktopActions } from "../desktop/actions";
import { failureFix } from "./failureFix";

export function FailureFixCard({
  runId,
  failure,
  provider,
  status,
  compact = false,
}: {
  runId: string;
  failure: { code: string; message?: string; recoverable?: boolean } | null | undefined;
  provider: string | null | undefined;
  status: string;
  compact?: boolean;
}) {
  const t = useT();
  const toast = useToast();
  const qc = useQueryClient();
  const { openRun, openPanel } = useDesktopActions();
  const providers = useOsProviders();
  const fix = failureFix(failure, provider, status, providers.data);
  const retry = useMutation({
    mutationFn: () =>
      api.post<{ runId: string | null }>(`/api/runs/${encodeURIComponent(runId)}/retry`, {
        submissionId: crypto.randomUUID(),
      }),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ["runs"] }).catch(() => undefined);
      qc.invalidateQueries({ queryKey: ["sessions"] }).catch(() => undefined);
      if (res.runId) openRun(res.runId);
      else {
        qc.invalidateQueries({ queryKey: qk.approvals }).catch(() => undefined);
        toast(t("runs.approve.queued"), "info");
      }
    },
    onError: (err: Error) => toast(err.message, "danger"),
  });
  if (!fix) return null;
  const action = fix.action;
  return (
    <div className={`failure-fix${compact ? " compact" : ""}`} role="note">
      <p className="failure-cause">{t(fix.causeKey)}</p>
      <div className="failure-actions">
        {action.kind === "login" && (
          <>
            {action.command && <code className="mono">{action.command}</code>}
            <Link to="/settings?tab=providers" className="go">
              {t("runs.fix.login")}
            </Link>
          </>
        )}
        {action.kind === "budget" && (
          <Link to="/settings?tab=security" className="go">
            {t("runs.fix.raise")}
          </Link>
        )}
        {action.kind === "approvals" && (
          <button type="button" className="go" onClick={() => openPanel("approvals")}>
            {t("runs.fix.approvals")}
          </button>
        )}
        {action.kind === "provider" && (
          <Link to="/settings?tab=providers" className="go">
            {t("runs.fix.providerSettings")}
          </Link>
        )}
        {(action.kind === "retry" || action.kind === "provider" || action.kind === "login") && (
          <button type="button" className="go" disabled={retry.isPending} onClick={() => retry.mutate()}>
            {t("runs.fix.retry")}
          </button>
        )}
      </div>
    </div>
  );
}
