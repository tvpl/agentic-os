/**
 * Triage for the bell (refino item 20). Two questions decide where a row
 * goes and whether it stands alone:
 *
 * - **Does it need me?** A pending approval, or a danger the user has not
 *   seen yet, is a decision. Everything else is information.
 * - **Is it a repeat?** Rows of the same kind and title that follow each
 *   other collapse into one line with a count, so "Index finished ×7" takes
 *   one row and the failure under it stays visible.
 *
 * Pure: the widget renders what this returns, the tests pin the rules.
 */
import type { NotificationItem } from "./useNotifications";

export interface NotificationGroup {
  /** The newest row: what the line shows. */
  head: NotificationItem;
  /** Every row folded into the line, newest first. */
  items: NotificationItem[];
  /** How many rows are still unread. */
  unread: number;
}

export interface NotificationTriage {
  /** Needs a decision from a human. Never grouped. */
  decide: NotificationGroup[];
  /** Worth knowing; repeats collapsed. */
  inform: NotificationGroup[];
}

/** A danger older than this is history: it stays on the list, not under "needs you". */
export const DECISION_FRESH_MS = 24 * 60 * 60 * 1000;

export function needsDecision(
  item: NotificationItem,
  pendingApprovals: ReadonlySet<string>,
  now: number = Date.now(),
): boolean {
  if (item.kind === "approval") return Boolean(item.approvalId && pendingApprovals.has(item.approvalId));
  return item.tone === "danger" && !item.read && now - item.ts < DECISION_FRESH_MS;
}

/**
 * Rows that read the same collapse: same kind, same line (message key or
 * title) and the same body — five failures of one routine fold into
 * "failed ×5"; failures of different runs stay apart.
 */
function sameLine(a: NotificationItem, b: NotificationItem): boolean {
  if (a.kind !== b.kind) return false;
  if ((a.body ?? "") !== (b.body ?? "")) return false;
  if (a.messageKey || b.messageKey) return a.messageKey === b.messageKey;
  return a.title === b.title;
}

export function triageNotifications(
  items: readonly NotificationItem[],
  pendingApprovals: ReadonlySet<string> = new Set(),
  now: number = Date.now(),
): NotificationTriage {
  const decide: NotificationGroup[] = [];
  const inform: NotificationGroup[] = [];
  for (const item of items) {
    if (needsDecision(item, pendingApprovals, now)) {
      decide.push({ head: item, items: [item], unread: item.read ? 0 : 1 });
      continue;
    }
    const last = inform[inform.length - 1];
    if (last && sameLine(last.head, item)) {
      last.items.push(item);
      if (!item.read) last.unread += 1;
    } else {
      inform.push({ head: item, items: [item], unread: item.read ? 0 : 1 });
    }
  }
  return { decide, inform };
}
