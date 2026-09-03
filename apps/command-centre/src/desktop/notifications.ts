/**
 * Notification centre for the desktop (Inbox widget + top-bar bell).
 *
 * Contract: `useNotifications()` → { items, unread, markAllRead, markRead }.
 * F-SHELL may ship `hooks/useNotifications.ts` with the same shape; until it
 * exists this module is the implementation: a tiny module-level store seeded
 * from `/api/approvals` (pending approvals are always "unread work") and fed
 * live by a dedicated `/api/events` subscription (run.finished,
 * routine.fired, approval.requested/resolved, index.finished). Read state is
 * kept in localStorage so a reload does not re-notify.
 */
import { useCallback, useEffect, useSyncExternalStore } from "react";
import { api, type ApprovalRecord, type NotificationItem, type NotificationKind, type OsEvent } from "../api";
import { qk, useApiQuery } from "../queries";

const MAX_ITEMS = 60;
const READ_KEY = "mordomo.desktop.notifications.read";
const EVENT_TYPES = ["run.finished", "routine.fired", "approval.requested", "approval.resolved", "index.finished"] as const;

let items: NotificationItem[] = [];
let readIds = new Set<string>();
const listeners = new Set<() => void>();
let subscribers = 0;
let closeStream: (() => void) | null = null;
let reconnectTimer: number | undefined;

const loadRead = () => {
  try {
    const raw = localStorage.getItem(READ_KEY);
    if (raw) readIds = new Set(JSON.parse(raw) as string[]);
  } catch {
    /* private mode / quota: read state is a convenience only */
  }
};
const saveRead = () => {
  try {
    localStorage.setItem(READ_KEY, JSON.stringify([...readIds].slice(-200)));
  } catch {
    /* ignore */
  }
};
const emit = () => {
  for (const l of listeners) l();
};

function upsert(next: NotificationItem) {
  const idx = items.findIndex((i) => i.id === next.id);
  const merged = { ...next, read: readIds.has(next.id) || next.read };
  items = idx === -1 ? [merged, ...items] : items.map((i, k) => (k === idx ? { ...i, ...merged, read: i.read || merged.read } : i));
  items = items.sort((a, b) => b.ts - a.ts).slice(0, MAX_ITEMS);
  emit();
}

function remove(id: string) {
  const before = items.length;
  items = items.filter((i) => i.id !== id);
  if (items.length !== before) emit();
}

const str = (v: unknown): string | undefined => (typeof v === "string" && v ? v : undefined);

/** Map an OS event into a notification (exported for tests / the shell). */
export function notificationFromEvent(event: OsEvent): NotificationItem | null {
  const p = (event.payload ?? {}) as Record<string, unknown>;
  const ts = typeof event.ts === "number" ? event.ts : Date.now();
  switch (event.type) {
    case "run.finished": {
      const id = str(p.id) ?? str(p.runId) ?? `run-${ts}`;
      const status = str(p.status) ?? "done";
      const skill = str(p.skillSlug);
      return {
        id: `run:${id}`,
        kind: "run",
        title: skill ? `/${skill} · ${status}` : `run · ${status}`,
        body: str(p.promptSummary) ?? str(p.error),
        ts,
        read: false,
        href: `/runs/${id}`,
      };
    }
    case "routine.fired": {
      const id = str(p.routineId) ?? str(p.id) ?? `routine-${ts}`;
      return { id: `routine:${id}:${ts}`, kind: "routine", title: str(p.name) ?? id, body: str(p.runId) ? `run ${str(p.runId)}` : undefined, ts, read: false, href: "/routines" };
    }
    case "approval.requested": {
      const id = str(p.id) ?? `approval-${ts}`;
      return { id: `approval:${id}`, kind: "approval", title: str(p.kind) ?? "approval", body: str(p.description), ts, read: false, approvalId: id };
    }
    case "index.finished":
      return { id: `index:${ts}`, kind: "index", title: "index", body: typeof p.total === "number" ? `${p.total} files` : undefined, ts, read: false, href: "/brain" };
    default:
      return null;
  }
}

function onEvent(event: OsEvent) {
  if (event.type === "approval.resolved") {
    const id = str((event.payload as Record<string, unknown> | undefined)?.id);
    if (id) remove(`approval:${id}`);
    return;
  }
  const n = notificationFromEvent(event);
  if (n) upsert(n);
}

function connect() {
  if (closeStream) return;
  closeStream = api.streamEvents(onEvent, {
    types: EVENT_TYPES,
    onError: () => {
      closeStream = null;
      if (subscribers > 0) reconnectTimer = window.setTimeout(connect, 5000);
    },
  });
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  if (subscribers === 0) {
    loadRead();
    connect();
  }
  subscribers += 1;
  return () => {
    listeners.delete(listener);
    subscribers -= 1;
    if (subscribers === 0) {
      window.clearTimeout(reconnectTimer);
      closeStream?.();
      closeStream = null;
    }
  };
}
const getSnapshot = () => items;

/** Seed / reconcile pending approvals from the query cache (they are always actionable). */
function syncApprovals(pending: ApprovalRecord[]) {
  const ids = new Set(pending.map((a) => `approval:${a.id}`));
  let changed = false;
  for (const a of pending) {
    if (!items.some((i) => i.id === `approval:${a.id}`)) {
      items = [{ id: `approval:${a.id}`, kind: "approval", title: a.kind, body: a.description, ts: a.createdAt, read: false, approvalId: a.id }, ...items];
      changed = true;
    }
  }
  const before = items.length;
  items = items.filter((i) => i.kind !== "approval" || ids.has(i.id));
  if (changed || items.length !== before) {
    items = items.sort((a, b) => b.ts - a.ts).slice(0, MAX_ITEMS);
    emit();
  }
}

export interface Notifications {
  items: NotificationItem[];
  unread: number;
  markAllRead: () => void;
  markRead: (id: string) => void;
}

export function useNotifications(): Notifications {
  const list = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  const approvals = useApiQuery<ApprovalRecord[]>(qk.approvals, "/api/approvals", { refetchInterval: 60_000 });
  useEffect(() => {
    if (approvals.data) syncApprovals(approvals.data);
  }, [approvals.data]);

  const markRead = useCallback((id: string) => {
    readIds.add(id);
    saveRead();
    items = items.map((i) => (i.id === id ? { ...i, read: true } : i));
    emit();
  }, []);
  const markAllRead = useCallback(() => {
    for (const i of items) readIds.add(i.id);
    saveRead();
    items = items.map((i) => ({ ...i, read: true }));
    emit();
  }, []);

  return { items: list, unread: list.filter((i) => !i.read).length, markAllRead, markRead };
}

export const NOTIFICATION_KINDS: readonly NotificationKind[] = ["approval", "run", "routine", "index", "system"];
