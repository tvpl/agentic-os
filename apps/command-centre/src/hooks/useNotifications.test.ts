// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import type { OsEventMap, OsEventType } from "@mordomo/contracts";
import type { OsEvent } from "../api";
import {
  DEDUPE_MS,
  MAX_NOTIFICATIONS,
  eventToNotification,
  initialNotificationsState,
  loadReadIds,
  notificationsReducer,
  saveReadIds,
  unreadCount,
  type NotificationItem,
  type NotificationsState,
} from "./useNotifications";

const t = (key: string, vars?: Record<string, string | number>) =>
  vars ? `${key}:${JSON.stringify(vars)}` : key;

function item(id: string, extra: Partial<NotificationItem> = {}): NotificationItem {
  return { id, kind: "system", title: id, ts: 1000, read: false, ...extra };
}

describe("notifications reducer", () => {
  it("pushes newest first, dedupes by id and stays bounded", () => {
    let s: NotificationsState = initialNotificationsState;
    for (let i = 0; i < MAX_NOTIFICATIONS + 25; i++)
      s = notificationsReducer(s, { type: "push", item: item(`n${i}`, { ts: i }) });
    expect(s.items).toHaveLength(MAX_NOTIFICATIONS);
    expect(s.items[0]!.id).toBe(`n${MAX_NOTIFICATIONS + 24}`);
    const before = s;
    s = notificationsReducer(s, { type: "push", item: item(`n${MAX_NOTIFICATIONS + 24}`) });
    expect(s).toBe(before);
  });

  it("replaces items sharing a dedupeKey inside the window", () => {
    let s = notificationsReducer(initialNotificationsState, {
      type: "push",
      item: item("a", { dedupeKey: "settings", ts: 1000 }),
    });
    s = notificationsReducer(s, {
      type: "push",
      item: item("b", { dedupeKey: "settings", ts: 1000 + DEDUPE_MS - 1 }),
    });
    expect(s.items.map((i) => i.id)).toEqual(["b"]);
    s = notificationsReducer(s, {
      type: "push",
      item: item("c", { dedupeKey: "settings", ts: 1000 + DEDUPE_MS * 3 }),
    });
    expect(s.items.map((i) => i.id)).toEqual(["c", "b"]);
  });

  it("tracks unread, markRead, markAllRead and remembers read ids", () => {
    let s = notificationsReducer(initialNotificationsState, { type: "push", item: item("a") });
    s = notificationsReducer(s, { type: "push", item: item("b") });
    s = notificationsReducer(s, { type: "push", item: item("c", { read: true }) });
    expect(unreadCount(s.items)).toBe(2);
    s = notificationsReducer(s, { type: "markRead", id: "a" });
    expect(unreadCount(s.items)).toBe(1);
    expect(s.readIds.has("a")).toBe(true);
    const unchanged = notificationsReducer(s, { type: "markRead", id: "missing" });
    expect(unchanged).toBe(s);
    s = notificationsReducer(s, { type: "markAllRead" });
    expect(unreadCount(s.items)).toBe(0);
    expect(notificationsReducer(s, { type: "markAllRead" })).toBe(s);
  });

  it("applies persisted read state to new pushes", () => {
    const s0: NotificationsState = { items: [], readIds: new Set(["seen"]) };
    const s = notificationsReducer(s0, { type: "push", item: item("seen") });
    expect(s.items[0]!.read).toBe(true);
  });

  it("marks the matching approval request read when it resolves", () => {
    let s = notificationsReducer(initialNotificationsState, {
      type: "push",
      item: item("req", { kind: "approval", approvalId: "ap1" }),
    });
    s = notificationsReducer(s, { type: "resolveApproval", approvalId: "ap1" });
    expect(s.items[0]!.read).toBe(true);
    expect(notificationsReducer(s, { type: "resolveApproval", approvalId: "nope" })).toBe(s);
  });
});

/** A contract event for the mapper; `id`/`ts` default to 0 like an event the stream replayed. */
const ev = <K extends OsEventType>(
  type: K,
  payload: OsEventMap[K],
  extra: { id?: number; ts?: number } = {},
): OsEvent => ({ id: extra.id ?? 0, ts: extra.ts ?? 0, v: 1, type, payload }) as OsEvent;

describe("eventToNotification", () => {
  it("maps approvals with the approval id and a security link", () => {
    const n = eventToNotification(
      ev("approval.requested", { id: "ap1", kind: "write_run", description: "Write run" }, { id: 7, ts: 5 }),
      t,
    );
    expect(n).toMatchObject({
      id: "approval.requested:7",
      kind: "approval",
      approvalId: "ap1",
      body: "Write run",
      href: "/settings?tab=security",
      read: false,
      tone: "warn",
    });
    const r = eventToNotification(
      ev(
        "approval.resolved",
        { id: "ap1", kind: "write_run", status: "approved", runId: "run-1" },
        { id: 8 },
      ),
      t,
    );
    expect(r).toMatchObject({ title: "shell.notif.approvalApproved", href: "/runs/run-1", read: true });
  });

  it("maps run.finished by status (failures unread + danger, cancelled quiet)", () => {
    const failed = eventToNotification(
      ev("run.finished", { runId: "abcdefgh-1234", status: "failed", durationMs: 61_000 }, { ts: 1 }),
      t,
    )!;
    expect(failed).toMatchObject({
      kind: "run",
      tone: "danger",
      read: false,
      href: "/runs/abcdefgh-1234",
      title: "shell.notif.runFailed",
    });
    expect(failed.body).toBe("abcdefgh · 1m 1s");
    const done = eventToNotification(
      ev("run.finished", { runId: "r", status: "done", durationMs: 800 }, { ts: 1 }),
      t,
    )!;
    expect(done).toMatchObject({ tone: "ok", read: false, title: "shell.notif.runDone" });
    const cancelled = eventToNotification(
      ev("run.finished", { runId: "r", status: "cancelled", durationMs: null }, { ts: 1 }),
      t,
    )!;
    expect(cancelled).toMatchObject({ tone: "info", read: true, title: "shell.notif.runCancelled" });
  });

  it("maps routine, index, backup and settings; ignores the rest", () => {
    expect(
      eventToNotification(ev("routine.fired", { routineId: "digest", runId: "r9" }, { ts: 1 }), t),
    ).toMatchObject({ kind: "routine", href: "/runs/r9", body: "digest" });
    const stats = {
      scanned: 156,
      added: 3,
      updated: 1,
      removed: 0,
      skippedExcluded: 0,
      skippedBinary: 0,
      related: 0,
      durationMs: 10,
    };
    expect(eventToNotification(ev("index.finished", { stats }, { ts: 1 }), t)).toMatchObject({
      kind: "index",
      read: true,
      body: 'shell.notif.indexBody:{"n":156}',
    });
    expect(
      eventToNotification(
        ev("backup.created", { name: "2026-09-03.zip", path: "/b", createdAt: 1, sizeBytes: 1 }, { ts: 1 }),
        t,
      ),
    ).toMatchObject({ kind: "system", body: "2026-09-03.zip", href: "/settings?tab=backups" });
    // A saved setting never reaches the bell.
    expect(
      eventToNotification(ev("settings.changed", {} as OsEventMap["settings.changed"], { ts: 1 }), t),
    ).toBeNull();
    expect(eventToNotification(ev("run.event", {} as OsEventMap["run.event"], { ts: 1 }), t)).toBeNull();
    expect(
      eventToNotification(ev("index.progress", {} as OsEventMap["index.progress"], { ts: 1 }), t),
    ).toBeNull();
  });
});

describe("read-state persistence", () => {
  it("round-trips through a storage-like object and tolerates garbage", () => {
    const store = new Map<string, string>();
    const fake = {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
    };
    saveReadIds(new Set(["a", "b"]), fake);
    expect(Array.from(loadReadIds(fake))).toEqual(["a", "b"]);
    store.set("mordomo.notifications.read", "{not json");
    expect(loadReadIds(fake).size).toBe(0);
    store.set("mordomo.notifications.read", JSON.stringify([1, "x", null]));
    expect(Array.from(loadReadIds(fake))).toEqual(["x"]);
    expect(loadReadIds(null).size).toBe(0);
  });
});
