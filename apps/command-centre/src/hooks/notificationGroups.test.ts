import { describe, expect, it } from "vitest";
import type { NotificationItem } from "./useNotifications";
import { DECISION_FRESH_MS, needsDecision, triageNotifications } from "./notificationGroups";

const NOW = 10 * DECISION_FRESH_MS;
let seq = 0;
const item = (over: Partial<NotificationItem>): NotificationItem => ({
  id: `n${++seq}`,
  kind: "system",
  title: "Index finished",
  ts: NOW - seq,
  read: false,
  ...over,
});

describe("triageNotifications", () => {
  it("collapses consecutive repeats into one line with a count", () => {
    const rows = [
      item({ title: "Settings saved", read: true }),
      item({ title: "Settings saved", read: true }),
      item({ title: "Settings saved" }),
      item({ kind: "run", title: "Run finished", tone: "ok" }),
      item({ title: "Settings saved" }),
    ];
    const { decide, inform } = triageNotifications(rows, new Set(), NOW);
    expect(decide).toHaveLength(0);
    expect(inform.map((g) => [g.head.title, g.items.length, g.unread])).toEqual([
      ["Settings saved", 3, 1],
      ["Run finished", 1, 1],
      ["Settings saved", 1, 1],
    ]);
  });

  it("groups by message key when the title is user text", () => {
    const rows = [
      item({ kind: "routine", title: "Nightly", messageKey: "shell.notif.routineFired" }),
      item({ kind: "routine", title: "Digest", messageKey: "shell.notif.routineFired" }),
      item({ kind: "routine", title: "Digest", messageKey: "shell.notif.routineFailed" }),
    ];
    expect(triageNotifications(rows, new Set(), NOW).inform.map((g) => g.items.length)).toEqual([2, 1]);
  });

  it("puts a pending approval and an unread danger under 'decide', never grouped", () => {
    const rows = [
      item({ kind: "approval", title: "Approval requested", approvalId: "a1" }),
      item({ kind: "approval", title: "Approval requested", approvalId: "a2" }),
      item({ kind: "approval", title: "Approval requested", approvalId: "old", read: true }),
      item({ kind: "run", title: "Run failed", tone: "danger" }),
      item({ kind: "run", title: "Run failed", tone: "danger", read: true }),
    ];
    const { decide, inform } = triageNotifications(rows, new Set(["a1", "a2"]), NOW);
    expect(decide.map((g) => g.head.id)).toEqual([rows[0]!.id, rows[1]!.id, rows[3]!.id]);
    expect(decide.every((g) => g.items.length === 1)).toBe(true);
    // The resolved approval and the seen failure are information now.
    expect(inform.map((g) => g.head.kind)).toEqual(["approval", "run"]);
  });

  it("keeps runs of the same line apart when their bodies differ", () => {
    const rows = [
      item({ kind: "run", title: "Run failed", body: "consolidate-memory", read: true }),
      item({ kind: "run", title: "Run failed", body: "consolidate-memory", read: true }),
      item({ kind: "run", title: "Run failed", body: "smoke test", read: true }),
    ];
    expect(
      triageNotifications(rows, new Set(), NOW).inform.map((g) => [g.head.body, g.items.length]),
    ).toEqual([
      ["consolidate-memory", 2],
      ["smoke test", 1],
    ]);
  });

  it("needsDecision follows the pending set and the age, not the row's own state", () => {
    const a = item({ kind: "approval", approvalId: "x" });
    expect(needsDecision(a, new Set(["x"]), NOW)).toBe(true);
    expect(needsDecision(a, new Set(), NOW)).toBe(false);
    expect(needsDecision(item({ tone: "danger" }), new Set(), NOW)).toBe(true);
    expect(needsDecision(item({ tone: "danger", read: true }), new Set(), NOW)).toBe(false);
    // A failure from last week is history, however red it was.
    expect(needsDecision(item({ tone: "danger", ts: NOW - DECISION_FRESH_MS - 1 }), new Set(), NOW)).toBe(
      false,
    );
  });
});
