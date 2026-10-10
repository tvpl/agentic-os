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
import { useNotifications } from "../../hooks/useNotifications";
import { useOsNavigate } from "../../hooks/useViewTransition";
import { notificationText } from "../../hooks/notificationText";
import { triageNotifications, type NotificationGroup } from "../../hooks/notificationGroups";
import type { WidgetProps } from "../widgetTypes";
import { Tooltip } from "../../ui";

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

  const visible = unreadOnly ? items.filter((i) => !i.read) : items;
  // Triage (refino item 20): decisions first, then information with repeats
  // folded. The limit counts lines, not rows, so seven identical saves never
  // push the one failure off the list.
  const triage = triageNotifications(visible, pending);
  const decide = triage.decide.slice(0, limit);
  const inform = triage.inform.slice(0, Math.max(0, limit - decide.length));

  if (decide.length === 0 && inform.length === 0) {
    return (
      <EmptyState
        className="compact"
        icon={<BellOff aria-hidden />}
        title={t("desktop.inbox.empty")}
        body={t("desktop.inbox.emptyBody")}
      />
    );
  }

  const open = (group: NotificationGroup) => {
    for (const item of group.items) markRead(item.id);
    if (group.head.href) navigate(group.head.href);
  };

  const row = (group: NotificationGroup) => {
    const item = group.head;
    const text = notificationText(item.title, item.body, locale, item);
    const actionable = item.kind === "approval" && item.approvalId && pending.has(item.approvalId);
    const read = group.unread === 0;
    return (
      <div
        key={item.id}
        className={`inbox-row${read ? " read" : ""}${item.tone ? ` tone-${item.tone}` : ""}`}
      >
        <span className="inbox-dot" aria-hidden />
        <button type="button" className="inbox-main" onClick={() => open(group)}>
          <span className="inbox-title">
            {text.title}
            {group.items.length > 1 && (
              <span
                className="inbox-count mono"
                title={t("desktop.inbox.repeats", { n: group.items.length })}
              >
                ×{group.items.length}
              </span>
            )}
          </span>
          {text.body && <span className="inbox-body">{text.body}</span>}
        </button>
        <span className="inbox-age mono">{timeAgo(item.ts, locale)}</span>
        {actionable ? (
          <span className="inbox-actions">
            <Tooltip label={t("desktop.inbox.approve")}>
              <button
                type="button"
                className="btn sm outline-accent icon-only"
                aria-label={t("desktop.inbox.approve")}
                disabled={resolve.isPending}
                onClick={() => resolve.mutate({ id: item.approvalId!, decision: "approved" })}
              >
                <Check aria-hidden />
              </button>
            </Tooltip>
            <Tooltip label={t("desktop.inbox.deny")}>
              <button
                type="button"
                className="btn sm ghost icon-only"
                aria-label={t("desktop.inbox.deny")}
                disabled={resolve.isPending}
                onClick={() => resolve.mutate({ id: item.approvalId!, decision: "denied" })}
              >
                <X aria-hidden />
              </button>
            </Tooltip>
          </span>
        ) : (
          item.href && (
            <Tooltip label={t("desktop.inbox.open")}>
              <button
                type="button"
                className="btn sm ghost icon-only"
                aria-label={t("desktop.inbox.open")}
                onClick={() => open(group)}
              >
                <ExternalLink aria-hidden />
              </button>
            </Tooltip>
          )
        )}
      </div>
    );
  };

  return (
    <div className="inbox">
      <div className="inbox-head">
        <span className="hud-label accent">{t("desktop.inbox.unread", { n: unread })}</span>
        <button type="button" className="btn sm ghost" onClick={markAllRead} disabled={unread === 0}>
          {t("desktop.inbox.markAll")}
        </button>
      </div>
      {decide.length > 0 && (
        <>
          <p className="inbox-section decide">{t("desktop.inbox.decide")}</p>
          {decide.map(row)}
        </>
      )}
      {inform.length > 0 && (
        <>
          {decide.length > 0 && <p className="inbox-section">{t("desktop.inbox.inform")}</p>}
          {inform.map(row)}
        </>
      )}
    </div>
  );
}

export default function InboxWidget(_props: WidgetProps) {
  return <InboxList limit={8} unreadOnly={false} />;
}
