/**
 * The decision, where the agent is (refino item 5). While anything waits for
 * a human — a tool call the running agent paused on, a write run the
 * profile held — this card sits on the console, above the field, with the
 * ask in one line, the change itself when it is a file edit (item 38), and
 * three ways out: approve (⌘⇧A), deny (⌘⇧D), open the trace. Never inside
 * a panel you have to find first.
 */
import { useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { ChevronDown, ChevronUp, ShieldAlert, ShieldCheck, ShieldX } from "lucide-react";
import { useLocale, useT } from "../i18n";
import { timeAgo } from "../components/ui";
import { Button } from "../components/primitives";
import { qk } from "../queries";
import { useOsEvent } from "../hooks/useEventStream";
import { useApprovals, useResolveApproval } from "../runs/ApprovalCards";
import { useDesktopActions } from "./actions";
import { describeDecision, editPreview, pendingDecisions, previewLines } from "./decision";

export default function DecisionDock({ cwd }: { cwd?: string | null }) {
  const t = useT();
  const locale = useLocale();
  const qc = useQueryClient();
  const { openRun } = useDesktopActions();
  const approvals = useApprovals({ refetchInterval: 15_000 });
  useOsEvent(["approval.requested", "approval.resolved"], () => {
    qc.invalidateQueries({ queryKey: qk.approvals }).catch(() => undefined);
  });
  const pending = useMemo(() => pendingDecisions(approvals.data), [approvals.data]);
  const first = pending[0];
  const resolve = useResolveApproval((runId) => runId && openRun(runId));
  const [showDiff, setShowDiff] = useState(true);

  // ⌘⇧A approves, ⌘⇧D denies the first decision — from anywhere on the desk.
  useEffect(() => {
    if (!first) return;
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || !e.shiftKey || e.altKey) return;
      const key = e.key.toLowerCase();
      if (key !== "a" && key !== "d") return;
      e.preventDefault();
      if (resolve.isPending) return;
      resolve.mutate({ id: first.id, decision: key === "a" ? "approved" : "denied" });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [first, resolve]);

  if (!first) return null;
  const text = describeDecision(first, t, t("runs.approve.title"));
  const preview = editPreview(first, cwd);
  const lines = preview ? previewLines(preview) : [];
  const busy = resolve.isPending && resolve.variables?.id === first.id;
  const isTool = first.kind === "tool_use";

  return (
    <div
      className="decision spring-in"
      role="alertdialog"
      aria-label={t("desktop.decide.title")}
      data-testid="decision-dock"
    >
      <div className="decision-head">
        <ShieldAlert aria-hidden />
        <span className="decision-title">
          {isTool ? t("desktop.decide.paused") : t("desktop.decide.held")}
        </span>
        <span className="decision-when mono">{timeAgo(first.createdAt, locale)}</span>
        {pending.length > 1 && (
          <span className="decision-more mono" title={t("desktop.decide.more", { n: pending.length - 1 })}>
            +{pending.length - 1}
          </span>
        )}
      </div>
      <p className="decision-ask">
        <span className="decision-verb">{text.headline}</span>
        {text.subject && <code className="mono">{text.subject}</code>}
        {text.where && <code className="mono dim">{text.where}</code>}
      </p>
      {preview && lines.length > 0 && (
        <div className="decision-diff">
          <button
            type="button"
            className="decision-diff-head"
            aria-expanded={showDiff}
            onClick={() => setShowDiff((v) => !v)}
          >
            <code className="mono">{preview.file}</code>
            <span className="dim">
              {t(preview.kind === "write" ? "desktop.decide.newFile" : "desktop.decide.change")}
            </span>
            {showDiff ? <ChevronUp aria-hidden /> : <ChevronDown aria-hidden />}
          </button>
          {showDiff && (
            <pre className="decision-diff-body mono">
              {lines.map((l, i) => (
                <span key={i} className={`dl ${l.kind}`}>
                  {l.kind === "del" ? "− " : "+ "}
                  {l.text}
                  {"\n"}
                </span>
              ))}
            </pre>
          )}
        </div>
      )}
      <div className="decision-actions">
        <Button
          size="sm"
          variant="primary"
          icon={<ShieldCheck aria-hidden />}
          loading={busy && resolve.variables?.decision === "approved"}
          disabled={busy}
          title="⌘⇧A"
          onClick={() => resolve.mutate({ id: first.id, decision: "approved" })}
        >
          {t("runs.approve.approve")}
        </Button>
        <Button
          size="sm"
          variant="danger"
          icon={<ShieldX aria-hidden />}
          loading={busy && resolve.variables?.decision === "denied"}
          disabled={busy}
          title="⌘⇧D"
          onClick={() => resolve.mutate({ id: first.id, decision: "denied" })}
        >
          {t("runs.approve.deny")}
        </Button>
        {text.runId && (
          <button type="button" className="console-link" onClick={() => openRun(text.runId!)}>
            {t("desktop.console.open")} →
          </button>
        )}
        <span className="sp" />
        <span className="decision-keys mono" aria-hidden>
          ⌘⇧A · ⌘⇧D
        </span>
      </div>
    </div>
  );
}
