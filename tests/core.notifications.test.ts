import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { NotificationStore, openDb, type Db, type MordomoPaths } from "@mordomo/core";
import { makeTempHome } from "./helpers.js";

/** The persisted inbox store: append, dedupe, read state, prune. */

let ctx: { paths: MordomoPaths; cleanup: () => void };
let db: Db;
let store: NotificationStore;

beforeEach(() => {
  ctx = makeTempHome();
  db = openDb(ctx.paths).db;
  store = new NotificationStore(db);
});
afterEach(() => {
  db.close();
  ctx.cleanup();
});

describe("NotificationStore", () => {
  it("adds rows newest first with server ids", () => {
    const a = store.add({ kind: "run", tone: "danger", title: "Run failed", runId: "r1", ts: 1000 });
    const b = store.add({
      kind: "approval",
      tone: "warn",
      title: "Approval requested",
      approvalId: "ap",
      ts: 2000,
    });
    expect(a.id.startsWith("n_")).toBe(true);
    expect(store.list().map((r) => r.id)).toEqual([b.id, a.id]);
    expect(store.unreadCount()).toBe(2);
    expect(store.count()).toBe(2);
  });

  it("replaces a row with the same dedupe key inside the window", () => {
    const first = store.add({ kind: "system", title: "Settings saved", dedupeKey: "settings", ts: 5000 });
    const second = store.add({
      kind: "system",
      title: "Settings saved again",
      dedupeKey: "settings",
      ts: 6000,
    });
    expect(store.get(first.id)).toBeNull();
    expect(store.get(second.id)?.title).toBe("Settings saved again");
    // Outside the window both survive.
    store.add({ kind: "system", title: "Later", dedupeKey: "settings", ts: 60_000 });
    expect(store.list().filter((r) => r.dedupeKey === "settings")).toHaveLength(2);
    expect(store.hasDedupeKey("settings")).toBe(true);
    expect(store.hasDedupeKey("nope")).toBe(false);
  });

  it("marks rows read one by one and all at once", () => {
    const a = store.add({ kind: "run", title: "A" });
    store.add({ kind: "run", title: "B" });
    store.add({ kind: "index", title: "Index", read: true });
    expect(store.unreadCount()).toBe(2);
    expect(store.markRead([a.id])).toBe(1);
    expect(store.markRead([a.id])).toBe(0);
    expect(store.list({ unreadOnly: true })).toHaveLength(1);
    expect(store.markAllRead()).toBe(1);
    expect(store.unreadCount()).toBe(0);
  });

  it("deletes and prunes to the newest N", () => {
    const rows = Array.from({ length: 6 }, (_, i) =>
      store.add({ kind: "run", title: `R${i}`, ts: 1000 + i }),
    );
    expect(store.delete(rows[0]!.id)).toBe(true);
    expect(store.delete(rows[0]!.id)).toBe(false);
    expect(store.prune(3)).toBe(2);
    expect(store.list().map((r) => r.title)).toEqual(["R5", "R4", "R3"]);
  });
});
