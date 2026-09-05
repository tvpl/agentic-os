/**
 * Notification centre (analysis item 21): the shell's notification feed with
 * an unread count, inline Approve / Deny for pending approvals (`GET
 * /api/approvals` + `POST /api/approvals/:id/resolve`) and "mark all read".
 * The same list backs the top-bar bell.
 */
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { BellOff, Check, ExternalLink, X } from "lucide-react";
import { api, type ApprovalRecord } from "../../api";
import { useLocale, useT } from "../../i18n";
import { qk, useApiQuery } from "../../queries";
import { EmptyState } from "../../components/primitives";
import { timeAgo, useToast } from "../../components/ui";
import { useNotifications, type NotificationItem } from "../../hooks/useNotifications";
import { useOsNavigate } from "../../hooks/useViewTransition";
import { cfgBool, cfgNumber, type WidgetProps } from "../widgetTypes";

export interface InboxListProps {
  limit: number;
  unreadOnly?: boolean;
}

export function InboxList({ limit, unreadOnly = false }: InboxListProps) {
  const t = useT();
  const locale = useLocale();
  const toast = useToast();
  const qc = useQueryClient();
  const navigate = useOsNavigate();
  const { items, unread, markRead, markAllRead } = useNotifications();
  // Pending approvals decide which items still deserve the inline buttons.
  const approvals = useApiQuery<ApprovalRecord[]>(qk.approvals, "/api/approvals", {
    refetchInterval: 300_000,
    retry: false,
  });
  const pending = new Set((approvals.data ?? []).map((a) => a.id));

  const resolve = useMutation({
    mutationFn: ({ id, decision }: { id: string; decision: "approved" | "denied" }) =>
      api.post(`/api/approvals/${encodeURIComponent(id)}/resolve`, { decision }),
    onSuccess: (_data, vars) => {
      toast(
        vars.decision === "approved" ? t("desktop.prompt.approved") : t("desktop.prompt.denied"),
        vars.decision === "approved" ? "ok" : "info",
      );
      qc.invalidateQueries({ queryKey: qk.approvals }).catch(() => undefined);
      qc.invalidateQueries({ queryKey: ["runs"] }).catch(() => undefined);
    },
    onError: (err: Error) => toast(err.message, "danger"),
  });

  const shown = (unreadOnly ? items.filter((i) => !i.read) : items).slice(0, limit);

  if (shown.length === 0) {
    return (
      <EmptyState
        className="compact"
        icon={<BellOff aria-hidden />}
        title={t("desktop.inbox.empty")}
        body={t("desktop.inbox.emptyBody")}
      />
    );
  }

  const open = (item: NotificationItem) => {
    markRead(item.id);
    if (item.href) navigate(item.href);
  };

  return (
    <div className="inbox">
      <div className="inbox-head">
        <span className="hud-label accent">{t("desktop.inbox.unread", { n: unread })}</span>
        <button type="button" className="btn sm ghost" onClick={markAllRead} disabled={unread === 0}>
          {t("desktop.inbox.markAll")}
        </button>
      </div>
      {shown.map((item) => {
        const actionable = item.kind === "approval" && item.approvalId && pending.has(item.approvalId);
        return (
          <div
            key={item.id}
            className={`inbox-row${item.read ? " read" : ""}${item.tone ? ` tone-${item.tone}` : ""}`}
          >
            <span className="inbox-dot" aria-hidden />
            <button type="button" className="inbox-main" onClick={() => open(item)}>
              <span className="inbox-title truncate">{item.title}</span>
              {item.body && <span className="inbox-body truncate">{item.body}</span>}
            </button>
            <span className="inbox-age mono">{timeAgo(item.ts, locale)}</span>
            {actionable ? (
              <span className="inbox-actions">
                <button
                  type="button"
                  className="btn sm outline-accent icon-only"
                  aria-label={t("desktop.inbox.approve")}
                  title={t("desktop.inbox.approve")}
                  disabled={resolve.isPending}
                  onClick={() => resolve.mutate({ id: item.approvalId!, decision: "approved" })}
                >
                  <Check aria-hidden />
                </button>
                <button
                  type="button"
                  className="btn sm ghost icon-only"
                  aria-label={t("desktop.inbox.deny")}
                  title={t("desktop.inbox.deny")}
                  disabled={resolve.isPending}
                  onClick={() => resolve.mutate({ id: item.approvalId!, decision: "denied" })}
                >
                  <X aria-hidden />
                </button>
              </span>
            ) : (
              item.href && (
                <button
                  type="button"
                  className="btn sm ghost icon-only"
                  aria-label={t("desktop.inbox.open")}
                  title={t("desktop.inbox.open")}
                  onClick={() => open(item)}
                >
                  <ExternalLink aria-hidden />
                </button>
              )
            )}
          </div>
        );
      })}
    </div>
  );
}

export default function InboxWidget({ config }: WidgetProps) {
  return (
    <InboxList limit={cfgNumber(config, "limit", 8)} unreadOnly={cfgBool(config, "unreadOnly", false)} />
  );
}
