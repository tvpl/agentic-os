import { describe, expect, it } from "vitest";
import type { ApprovalRecord, ProviderSnapshot, RoutineStatus, RunRecord } from "../../api";
import type { NotificationItem } from "../../hooks/useNotifications";
import { FRESH_MS, buildPending, loudest, pendingCount } from "./model";

const NOW = 1_800_000_000_000;
const approval = (id: string, at: number, runId?: string): ApprovalRecord => ({
  id,
  createdAt: at,
  kind: "tool_use",
  description: "Edit file",
  payload: runId ? { runId } : {},
  status: "pending",
  resolvedAt: null,
});
const run = (id: string, status: string, at: number): RunRecord =>
  ({ id, status, createdAt: at, finishedAt: at, promptSummary: id, skillSlug: null }) as unknown as RunRecord;
const notice = (id: string, tone: NotificationItem["tone"], extra: Partial<NotificationItem> = {}) =>
  ({ id, kind: "run", title: id, ts: NOW - 1000, read: false, tone, ...extra }) as NotificationItem;

describe("pendências", () => {
  it("orders decisions first, then fixes, then looks, newest first within a level", () => {
    const items = buildPending({
      approvals: [approval("a1", NOW - 5000), approval("a2", NOW - 1000)],
      runs: [run("r1", "failed", NOW - 2000), run("r2", "done", NOW - 100)],
      notifications: [notice("n1", "warn"), notice("n2", "info")],
      now: NOW,
    });
    expect(items.map((i) => i.id)).toEqual([
      "decision:a2",
      "decision:a1",
      "failure:r1",
      "notice:n1",
      "notice:n2",
    ]);
    expect(pendingCount(items)).toBe(4);
    expect(loudest(items)).toBe("decide");
  });

  it("never lists the same thing twice: an approval covers its run and its notice", () => {
    const items = buildPending({
      approvals: [approval("a1", NOW - 5000, "r1")],
      runs: [run("r1", "failed", NOW - 2000)],
      notifications: [notice("n1", "warn", { approvalId: "a1" }), notice("n2", "danger", { runId: "r1" })],
      now: NOW,
    });
    expect(items.map((i) => i.id)).toEqual(["decision:a1"]);
  });

  it("does not keep an approval's notice once its decision is gone from the list", () => {
    const items = buildPending({
      approvals: [],
      notifications: [
        notice("n1", "warn", { kind: "approval", approvalId: "resolved-elsewhere" }),
        notice("n2", "warn"),
      ],
      now: NOW,
    });
    expect(items.map((i) => i.id)).toEqual(["notice:n2"]);
    expect(pendingCount(items)).toBe(1);
  });

  it("forgets failures older than a day and the ones the user silenced", () => {
    const items = buildPending({
      runs: [
        run("old", "failed", NOW - FRESH_MS - 1),
        run("hush", "timed_out", NOW - 10),
        run("x", "timed_out", NOW - 20),
      ],
      muted: new Set(["hush"]),
      now: NOW,
    });
    expect(items.map((i) => i.id)).toEqual(["failure:x"]);
  });

  it("raises a provider that cannot run, but not an unverified one", () => {
    const snapshot = { id: "claude" } as ProviderSnapshot;
    expect(buildPending({ provider: { snapshot, problem: "login_required" }, now: NOW })[0]?.level).toBe(
      "fix",
    );
    expect(buildPending({ provider: { snapshot, problem: "unverified" }, now: NOW })).toEqual([]);
  });

  it("an exhausted budget is a decision; a warm one is a look", () => {
    expect(buildPending({ budget: { tone: "over", ratio: 1.1 }, now: NOW })[0]?.level).toBe("decide");
    expect(buildPending({ budget: { tone: "warn", ratio: 0.85 }, now: NOW })[0]?.level).toBe("look");
    expect(buildPending({ budget: { tone: "ok", ratio: 0.1 }, now: NOW })).toEqual([]);
  });

  it("lists unhealthy routines that are still enabled", () => {
    const routines = [
      { id: "a", healthy: false, enabled: true, lastFiredAt: NOW - 50 },
      { id: "b", healthy: false, enabled: false, lastFiredAt: NOW - 50 },
      { id: "c", healthy: true, enabled: true, lastFiredAt: NOW - 50 },
    ] as unknown as RoutineStatus[];
    expect(buildPending({ routines, now: NOW }).map((i) => i.id)).toEqual(["routine:a"]);
  });

  it("an old loud notice is history, not a look", () => {
    const old = notice("old", "danger", { ts: NOW - FRESH_MS - 5 });
    expect(buildPending({ notifications: [old], now: NOW })[0]?.level).toBe("info");
  });

  it("a question the agent asked is a question, not a decision to approve", () => {
    const q = {
      ...approval("q1", NOW - 10),
      payload: { toolName: "AskUserQuestion", input: { questions: [] } },
    };
    expect(buildPending({ approvals: [q], now: NOW })[0]).toMatchObject({
      id: "question:q1",
      kind: "question",
      level: "decide",
    });
  });

  it("is quiet when nothing waits", () => {
    const items = buildPending({ notifications: [notice("n", "info")], now: NOW });
    expect(pendingCount(items)).toBe(0);
    expect(loudest(items)).toBe("info");
    expect(loudest([])).toBeNull();
  });
});
