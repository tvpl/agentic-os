/**
 * Inline approve/deny for write runs that the security profile put on hold.
 * Before this, `waiting_approval` only produced a toast and a jump to
 * Settings › Security; the decision now happens where the run lives.
 */
import { ShieldCheck, ShieldX } from "lucide-react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api, type ApprovalRecord } from "../api";
import { useLocale, useT } from "../i18n";
import { qk, useApiQuery, type ApiQueryOptions } from "../queries";
import { timeAgo, useToast } from "../components/ui";
import { Badge, Button } from "../components/primitives";
import { approvalLabel, approvalTarget, writeRunApprovals } from "./approvals";

/** Pending approvals (shared cache key with Settings › Security). */
export function useApprovals(options: ApiQueryOptions<ApprovalRecord[]> = {}) {
  return useApiQuery<ApprovalRecord[]>(qk.approvals, "/api/approvals", { refetchInterval: 30_000, ...options });
}

export interface ResolveResult extends ApprovalRecord {
  /** Id of the run the API launched when the approval was granted. */
  runId?: string | null;
}

/** `POST /api/approvals/:id/resolve` — same payload as Settings › Security. */
export function useResolveApproval(onLaunched?: (runId: string | null) => void) {
  const t = useT();
  const toast = useToast();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, decision }: { id: string; decision: "approved" | "denied" }) =>
      api.post<ResolveResult>(`/api/approvals/${encodeURIComponent(id)}/resolve`, { decision }),
    onSuccess: (res, vars) => {
      toast(vars.decision === "approved" ? t("runs.approve.approved") : t("runs.approve.denied"), "ok");
      qc.invalidateQueries({ queryKey: qk.approvals }).catch(() => undefined);
      qc.invalidateQueries({ queryKey: ["runs"] }).catch(() => undefined);
      qc.invalidateQueries({ queryKey: ["run"] }).catch(() => undefined);
      if (vars.decision === "approved") onLaunched?.(res.runId ?? null);
    },
    onError: (err: Error) => toast(err.message, "danger"),
  });
}

export interface ApprovalCardProps {
  approval: ApprovalRecord;
  /** Called with the run the API started, after an approval is granted. */
  onLaunched?: (runId: string | null) => void;
  /** `compact` drops the description block (used inside a run's detail page). */
  compact?: boolean;
}

export function ApprovalCard({ approval, onLaunched, compact = false }: ApprovalCardProps) {
  const t = useT();
  const locale = useLocale();
  const resolve = useResolveApproval(onLaunched);
  const target = approvalTarget(approval);
  const pending = resolve.isPending && resolve.variables?.id === approval.id;
  return (
    <div className="approval-inline" role="group" aria-label={t("runs.approve.title")}>
      <div className="approval-inline-main">
        <div className="approval-inline-head">
          <Badge kind="state" tone="warn">
            {t("runs.approve.badge")}
          </Badge>
          <span className="mono truncate">{approvalLabel(approval, t("runs.approve.title"))}</span>
          <span className="approval-inline-when">{timeAgo(approval.createdAt, locale)}</span>
        </div>
        {!compact && <p className="approval-inline-desc">{approval.description}</p>}
        {target.cwd && (
          <p className="approval-inline-cwd mono truncate" title={target.cwd}>
            {target.cwd}
          </p>
        )}
      </div>
      <div className="approval-inline-actions">
        <Button size="sm" variant="primary" icon={<ShieldCheck aria-hidden />} loading={pending && resolve.variables?.decision === "approved"} onClick={() => resolve.mutate({ id: approval.id, decision: "approved" })}>
          {t("runs.approve.approve")}
        </Button>
        <Button size="sm" variant="danger" icon={<ShieldX aria-hidden />} loading={pending && resolve.variables?.decision === "denied"} onClick={() => resolve.mutate({ id: approval.id, decision: "denied" })}>
          {t("runs.approve.deny")}
        </Button>
      </div>
    </div>
  );
}

/** Every pending write-run approval, as a card above the run table. */
export function ApprovalsCard({ approvals, onLaunched }: { approvals: readonly ApprovalRecord[] | undefined; onLaunched?: (runId: string | null) => void }) {
  const t = useT();
  const pending = writeRunApprovals(approvals);
  if (pending.length === 0) return null;
  return (
    <div className="card approvals-card">
      <h2>{t("runs.approve.title")}</h2>
      <p className="hint">{t("runs.approve.hint")}</p>
      {pending.map((a) => (
        <ApprovalCard key={a.id} approval={a} onLaunched={onLaunched} />
      ))}
    </div>
  );
}
