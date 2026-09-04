/**
 * Notifications (analysis item 21): a bounded in-memory feed fed by the OS
 * event stream (approvals, runs, routines, index, backups, settings) plus
 * local pushes, with unread count and read-state persisted in localStorage.
 *
 *   const { items, unread, markRead, markAllRead, notify } = useNotifications();
 *
 * `NotificationsProvider` is mounted once in App.tsx and subscribes to the
 * single SSE connection through `subscribeOsEvents`. The reducer and the
 * event mapper are pure and tested (useNotifications.test.ts).
 */
import {
  createContext,
  createElement,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  type ReactNode,
} from "react";
import {
  api,
  type ApprovalRequestedPayload,
  type ApprovalResolvedPayload,
  type OsEvent,
  type RoutineFiredPayload,
  type RunFinishedPayload,
} from "../api";
import { useT } from "../i18n";
import { subscribeOsEvents } from "./useEventStream";

export type NotificationKind = "approval" | "run" | "routine" | "index" | "system";
export type NotificationTone = "ok" | "warn" | "danger" | "info";

export interface NotificationItem {
  id: string;
  kind: NotificationKind;
  title: string;
  body?: string;
  ts: number;
  read: boolean;
  href?: string;
  approvalId?: string;
  runId?: string;
  tone?: NotificationTone;
  /** Items sharing a key within `DEDUPE_MS` replace each other (settings saves). */
  dedupeKey?: string;
}

export type NotificationInput = Omit<NotificationItem, "id" | "ts" | "read"> & {
  id?: string;
  ts?: number;
  read?: boolean;
};

export const MAX_NOTIFICATIONS = 200;
export const MAX_READ_IDS = 400;
export const DEDUPE_MS = 3_000;
export const READ_STORAGE_KEY = "mordomo.notifications.read";
export const SOUND_STORAGE_KEY = "mordomo.notifications.sound";

export interface NotificationsState {
  items: NotificationItem[];
  readIds: ReadonlySet<string>;
}

export type NotificationsAction =
  | { type: "push"; item: NotificationItem }
  /** Items the server kept (oldest first); existing ids win, read flags merge. */
  | { type: "seed"; items: NotificationItem[] }
  | { type: "markRead"; id: string }
  | { type: "markAllRead" }
  | { type: "resolveApproval"; approvalId: string };

export const initialNotificationsState: NotificationsState = { items: [], readIds: new Set() };

/** Pure reducer: newest first, bounded, deduped by id and by `dedupeKey`. */
export function notificationsReducer(
  state: NotificationsState,
  action: NotificationsAction,
): NotificationsState {
  switch (action.type) {
    case "push": {
      const incoming = { ...action.item, read: action.item.read || state.readIds.has(action.item.id) };
      if (state.items.some((i) => i.id === incoming.id)) return state;
      let items = state.items;
      if (incoming.dedupeKey) {
        const prev = items.find(
          (i) => i.dedupeKey === incoming.dedupeKey && Math.abs(incoming.ts - i.ts) <= DEDUPE_MS,
        );
        if (prev) items = items.filter((i) => i !== prev);
      }
      items = [incoming, ...items].slice(0, MAX_NOTIFICATIONS);
      return { ...state, items };
    }
    case "seed": {
      if (action.items.length === 0) return state;
      const known = new Set(state.items.map((i) => i.id));
      const fresh = action.items
        .filter((i) => !known.has(i.id))
        .map((i) => ({ ...i, read: i.read || state.readIds.has(i.id) }));
      if (fresh.length === 0) return state;
      const items = [...state.items, ...fresh].sort((a, b) => b.ts - a.ts).slice(0, MAX_NOTIFICATIONS);
      return { ...state, items };
    }
    case "markRead": {
      const item = state.items.find((i) => i.id === action.id);
      if (!item || item.read) return state;
      const readIds = new Set(state.readIds);
      readIds.add(action.id);
      return {
        items: state.items.map((i) => (i.id === action.id ? { ...i, read: true } : i)),
        readIds: bound(readIds),
      };
    }
    case "markAllRead": {
      if (state.items.every((i) => i.read)) return state;
      const readIds = new Set(state.readIds);
      for (const i of state.items) readIds.add(i.id);
      return { items: state.items.map((i) => (i.read ? i : { ...i, read: true })), readIds: bound(readIds) };
    }
    case "resolveApproval": {
      const hit = state.items.filter(
        (i) => i.approvalId === action.approvalId && i.kind === "approval" && !i.read,
      );
      if (hit.length === 0) return state;
      const readIds = new Set(state.readIds);
      for (const i of hit) readIds.add(i.id);
      return {
        items: state.items.map((i) => (hit.includes(i) ? { ...i, read: true } : i)),
        readIds: bound(readIds),
      };
    }
    default:
      return state;
  }
}

function bound(ids: Set<string>): ReadonlySet<string> {
  if (ids.size <= MAX_READ_IDS) return ids;
  return new Set(Array.from(ids).slice(ids.size - MAX_READ_IDS));
}

export function unreadCount(items: readonly NotificationItem[]): number {
  let n = 0;
  for (const i of items) if (!i.read) n += 1;
  return n;
}

/* ---- persistence ---------------------------------------------------------- */
function storage(): Storage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

export function loadReadIds(store: Pick<Storage, "getItem"> | null = storage()): Set<string> {
  try {
    const raw = store?.getItem(READ_STORAGE_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return new Set(Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === "string") : []);
  } catch {
    return new Set();
  }
}

export function saveReadIds(
  ids: ReadonlySet<string>,
  store: Pick<Storage, "setItem"> | null = storage(),
): void {
  try {
    store?.setItem(READ_STORAGE_KEY, JSON.stringify(Array.from(ids).slice(-MAX_READ_IDS)));
  } catch {
    /* quota / private mode */
  }
}

export function getNotifySound(): boolean {
  return storage()?.getItem(SOUND_STORAGE_KEY) === "1";
}

export function setNotifySound(on: boolean): void {
  try {
    storage()?.setItem(SOUND_STORAGE_KEY, on ? "1" : "0");
  } catch {
    /* ignore */
  }
}

/* ---- event → notification ------------------------------------------------- */
export type NotificationTextKey =
  | "shell.notif.approvalTitle"
  | "shell.notif.approvalApproved"
  | "shell.notif.approvalDenied"
  | "shell.notif.runDone"
  | "shell.notif.runFailed"
  | "shell.notif.runTimedOut"
  | "shell.notif.runCancelled"
  | "shell.notif.routineFired"
  | "shell.notif.indexFinished"
  | "shell.notif.indexBody"
  | "shell.notif.backupCreated"
  | "shell.notif.settingsChanged";
export type NotificationTranslate = (
  key: NotificationTextKey,
  vars?: Record<string, string | number>,
) => string;

const FAILED = new Set(["failed", "timed_out"]);

function shortDuration(ms: number | null | undefined): string {
  if (ms == null) return "";
  if (ms < 1000) return `${ms} ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)} s`;
  return `${Math.floor(ms / 60000)}m ${Math.round((ms % 60000) / 1000)}s`;
}

/** Map an OS event to a notification; null for events that are not user-facing. */
export function eventToNotification(event: OsEvent, t: NotificationTranslate): NotificationItem | null {
  const ts = event.ts ?? Date.now();
  const id = `${event.type}:${event.id ?? ts}`;
  const base = { id, ts, read: false } as const;
  switch (event.type) {
    case "approval.requested": {
      const p = (event.payload ?? {}) as Partial<ApprovalRequestedPayload>;
      return {
        ...base,
        kind: "approval",
        tone: "warn",
        title: t("shell.notif.approvalTitle"),
        body: p.description,
        approvalId: p.id,
        href: "/settings?tab=security",
      };
    }
    case "approval.resolved": {
      const p = (event.payload ?? {}) as Partial<ApprovalResolvedPayload>;
      const approved = p.status === "approved";
      return {
        ...base,
        kind: "approval",
        tone: approved ? "ok" : "info",
        title: approved ? t("shell.notif.approvalApproved") : t("shell.notif.approvalDenied"),
        body: p.kind,
        approvalId: p.id,
        runId: p.runId ?? undefined,
        href: p.runId ? `/runs/${p.runId}` : "/settings?tab=security",
        read: true,
      };
    }
    case "run.finished": {
      const p = (event.payload ?? {}) as Partial<RunFinishedPayload>;
      const status = p.status ?? "done";
      const failed = FAILED.has(status);
      const title =
        status === "timed_out"
          ? t("shell.notif.runTimedOut")
          : status === "failed"
            ? t("shell.notif.runFailed")
            : status === "cancelled" || status === "interrupted"
              ? t("shell.notif.runCancelled")
              : t("shell.notif.runDone");
      const dur = shortDuration(p.durationMs);
      return {
        ...base,
        kind: "run",
        tone: failed ? "danger" : status === "done" ? "ok" : "info",
        title,
        body: [p.runId?.slice(0, 8), dur].filter(Boolean).join(" · ") || undefined,
        runId: p.runId,
        href: p.runId ? `/runs/${p.runId}` : "/runs",
        read: !failed && status !== "done",
      };
    }
    case "routine.fired": {
      const p = (event.payload ?? {}) as Partial<RoutineFiredPayload>;
      return {
        ...base,
        kind: "routine",
        tone: "info",
        title: t("shell.notif.routineFired"),
        body: p.routineId,
        runId: p.runId,
        href: p.runId ? `/runs/${p.runId}` : "/routines",
      };
    }
    case "index.finished": {
      const stats = ((event.payload as { stats?: Record<string, unknown> } | null)?.stats ?? {}) as Record<
        string,
        unknown
      >;
      const n =
        typeof stats.files === "number"
          ? stats.files
          : typeof stats.indexed === "number"
            ? stats.indexed
            : typeof stats.total === "number"
              ? stats.total
              : null;
      return {
        ...base,
        kind: "index",
        tone: "ok",
        title: t("shell.notif.indexFinished"),
        body: n == null ? undefined : t("shell.notif.indexBody", { n }),
        href: "/brain",
        read: true,
      };
    }
    case "backup.created": {
      const p = (event.payload ?? {}) as { name?: string };
      return {
        ...base,
        kind: "system",
        tone: "ok",
        title: t("shell.notif.backupCreated"),
        body: p.name,
        href: "/settings?tab=backups",
      };
    }
    case "settings.changed":
      return {
        ...base,
        kind: "system",
        tone: "info",
        title: t("shell.notif.settingsChanged"),
        href: "/settings",
        read: true,
        dedupeKey: "settings.changed",
      };
    default:
      return null;
  }
}

/* ---- sound ---------------------------------------------------------------- */
let audio: AudioContext | null = null;

/** A soft two-note blip (WebAudio, no assets). Silent unless the toggle is on. */
export function playBlip(tone: NotificationTone = "info"): void {
  if (!getNotifySound()) return;
  try {
    const Ctx =
      window.AudioContext ??
      (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    audio ??= new Ctx();
    if (audio.state === "suspended") void audio.resume();
    const now = audio.currentTime;
    const notes = tone === "danger" ? [440, 330] : tone === "warn" ? [660, 880] : [880, 1320];
    notes.forEach((freq, i) => {
      const osc = audio!.createOscillator();
      const gain = audio!.createGain();
      osc.type = "sine";
      osc.frequency.value = freq;
      const t0 = now + i * 0.09;
      gain.gain.setValueAtTime(0.0001, t0);
      gain.gain.exponentialRampToValueAtTime(0.08, t0 + 0.012);
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.12);
      osc.connect(gain).connect(audio!.destination);
      osc.start(t0);
      osc.stop(t0 + 0.14);
    });
  } catch {
    /* no audio */
  }
}

/* ---- context -------------------------------------------------------------- */
export interface NotificationsApi {
  items: NotificationItem[];
  unread: number;
  markRead: (id: string) => void;
  markAllRead: () => void;
  notify: (input: NotificationInput) => string;
}

/** Row shape of `GET /api/notifications` (servers since 0.6; older servers 404 and the feed stays local). */
export interface ServerNotification {
  id: string;
  kind: NotificationKind;
  title: string;
  body?: string | null;
  ts: number;
  read: boolean;
  href?: string | null;
  approvalId?: string | null;
  runId?: string | null;
  tone?: NotificationTone | null;
}

export function fromServer(row: ServerNotification): NotificationItem {
  return {
    id: row.id,
    kind: row.kind,
    title: row.title,
    body: row.body ?? undefined,
    ts: row.ts,
    read: row.read,
    href: row.href ?? undefined,
    approvalId: row.approvalId ?? undefined,
    runId: row.runId ?? undefined,
    tone: row.tone ?? undefined,
  };
}

const SERVER_PATH = "/api/notifications";
/** Ids the server minted (`n_…`) vs. ids derived from live events / local pushes. */
const isServerId = (id: string) => id.startsWith("n_");

const noop = () => undefined;
const NotificationsContext = createContext<NotificationsApi>({
  items: [],
  unread: 0,
  markRead: noop,
  markAllRead: noop,
  notify: () => "",
});

let localSeq = 0;

export function NotificationsProvider({ children }: { children: ReactNode }) {
  const t = useT();
  const tRef = useRef(t);
  tRef.current = t;
  const [state, dispatch] = useReducer(notificationsReducer, undefined, () => ({
    items: [],
    readIds: loadReadIds(),
  }));

  useEffect(() => saveReadIds(state.readIds), [state.readIds]);

  // Seed from the server so the feed survives a closed tab; live events keep it current.
  useEffect(() => {
    const ctrl = new AbortController();
    api
      .get<{ items: ServerNotification[] }>(`${SERVER_PATH}?limit=${MAX_NOTIFICATIONS}`, {
        signal: ctrl.signal,
      })
      .then((res) => {
        if (Array.isArray(res?.items)) dispatch({ type: "seed", items: res.items.map(fromServer) });
      })
      .catch(() => undefined);
    return () => ctrl.abort();
  }, []);

  useEffect(
    () =>
      subscribeOsEvents((event) => {
        const item = eventToNotification(event, (key, vars) => tRef.current(key, vars));
        if (!item) return;
        if (event.type === "approval.resolved" && item.approvalId)
          dispatch({ type: "resolveApproval", approvalId: item.approvalId });
        dispatch({ type: "push", item });
        if (!item.read && (item.tone === "danger" || (item.kind === "approval" && item.tone === "warn")))
          playBlip(item.tone);
      }),
    [],
  );

  const notify = useCallback((input: NotificationInput) => {
    const id = input.id ?? `local:${Date.now()}:${++localSeq}`;
    const item: NotificationItem = { ...input, id, ts: input.ts ?? Date.now(), read: input.read ?? false };
    dispatch({ type: "push", item });
    if (!item.read && item.tone === "danger") playBlip("danger");
    return id;
  }, []);
  const markRead = useCallback((id: string) => {
    dispatch({ type: "markRead", id });
    if (isServerId(id)) api.post(`${SERVER_PATH}/read`, { ids: [id] }).catch(() => undefined);
  }, []);
  const markAllRead = useCallback(() => {
    dispatch({ type: "markAllRead" });
    api.post(`${SERVER_PATH}/read`, { all: true }).catch(() => undefined);
  }, []);

  const value = useMemo<NotificationsApi>(
    () => ({ items: state.items, unread: unreadCount(state.items), markRead, markAllRead, notify }),
    [state.items, markRead, markAllRead, notify],
  );
  return createElement(NotificationsContext.Provider, { value }, children);
}

export function useNotifications(): NotificationsApi {
  return useContext(NotificationsContext);
}
