import { describe, expect, it, beforeEach, afterEach } from "vitest";
import {
  EventBus,
  NotificationStore,
  checkRepeatedFailure,
  checkSilentRoutines,
  diffConnectorItems,
  expectedIntervalMs,
  failureKey,
  openDb,
  parseTriageDecision,
  repeatedFailureAlert,
  silentRoutineAlerts,
  toNotification,
  triageNotification,
  type Db,
  type FailureRun,
  type MordomoPaths,
  type RoutineStatus,
  type SentinelFiredPayload,
  type SilentRoutineCandidate,
} from "@mordomo/core";
import { makeTempHome } from "./helpers.js";

/**
 * Sentinels (Onda 2): the rules that decide when the OS speaks up, and the
 * mapping that turns a finding into an inbox row. Everything here runs on
 * fake data — no provider, no network, no timers.
 */

const HOUR = 3_600_000;
const DAY = 86_400_000;
const NOW = Date.UTC(2026, 8, 4, 12, 0, 0);

let tmp: { paths: MordomoPaths; cleanup: () => void };
let db: Db;

beforeEach(() => {
  tmp = makeTempHome();
  db = openDb(tmp.paths).db;
});
afterEach(() => {
  db.close();
  tmp.cleanup();
});

function insertRun(row: {
  id: string;
  status: string;
  createdAt: number;
  skillSlug?: string | null;
  prompt?: string;
  origin?: string;
}): void {
  db.prepare(
    `INSERT INTO runs (id, created_at, origin, provider, status, prompt_summary, skill_slug, effort)
     VALUES (?, ?, ?, 'claude', ?, ?, ?, 'default')`,
  ).run(
    row.id,
    row.createdAt,
    row.origin ?? "skill",
    row.status,
    row.prompt ?? "do the thing",
    row.skillSlug ?? null,
  );
}

describe("repeatedFailure sentinel", () => {
  it("groups by skill slug, and by the prompt head when there is no skill", () => {
    expect(failureKey({ skillSlug: "digest", promptSummary: "whatever" })).toBe("skill:digest");
    // Only the head decides: the same intent with a different tail is one key.
    expect(
      failureKey({ skillSlug: null, promptSummary: "Summarise MY inbox and my calendar, please!" }),
    ).toBe(failureKey({ skillSlug: null, promptSummary: "summarise my inbox and my calendar -- again" }));
    expect(failureKey({ skillSlug: null, promptSummary: "rename the files" })).not.toBe(
      failureKey({ skillSlug: null, promptSummary: "book a flight" }),
    );
  });

  it("stays quiet below the threshold and fires warn+triage at it", () => {
    const trigger = { skillSlug: "digest", promptSummary: "(skill: digest)" };
    const one: FailureRun[] = [{ id: "r1", skillSlug: "digest", promptSummary: "x", createdAt: NOW }];
    expect(repeatedFailureAlert(trigger, one, { now: NOW })).toBeNull();
    const two = [...one, { id: "r2", skillSlug: "digest", promptSummary: "x", createdAt: NOW - HOUR }];
    const payload = repeatedFailureAlert(trigger, two, { now: NOW })!;
    expect(payload.sentinel).toBe("repeatedFailure");
    expect(payload.severity).toBe("warn");
    expect(payload.triage).toBe(true);
    expect(payload.title).toContain("digest");
    expect(payload.dedupeKey).toBe("sentinel:repeatedFailure:2026-09-04:skill:digest");
    // A different skill failing twice does not count towards this one.
    const mixed = [...one, { id: "r3", skillSlug: "other", promptSummary: "x", createdAt: NOW }];
    expect(repeatedFailureAlert(trigger, mixed, { now: NOW })).toBeNull();
  });

  it("reads the window from the runs table and emits once a day", () => {
    const bus = new EventBus();
    const store = new NotificationStore(db);
    const fired: SentinelFiredPayload[] = [];
    bus.subscribe((e) => {
      if (e.type === "sentinel.fired") fired.push(e.payload as SentinelFiredPayload);
    });
    insertRun({ id: "old", status: "failed", createdAt: NOW - 2 * DAY, skillSlug: "digest" });
    insertRun({ id: "f1", status: "failed", createdAt: NOW - 2 * HOUR, skillSlug: "digest" });
    insertRun({ id: "f2", status: "timed_out", createdAt: NOW - HOUR, skillSlug: "digest" });
    const deps = { db, bus, dedupe: store, now: () => NOW };

    // A successful run is never a finding.
    expect(checkRepeatedFailure(deps, { runId: "f2", status: "done" })).toBeNull();
    // Failures outside the 24 h window do not count towards the threshold.
    expect(checkRepeatedFailure(deps, { runId: "old", status: "failed" })).toBeNull();

    const payload = checkRepeatedFailure(deps, { runId: "f2", status: "timed_out" })!;
    expect(payload.title).toBe("digest failed 2 times");
    expect(fired).toHaveLength(1);

    // Once the inbox has the row, the same day stays quiet.
    store.add({ kind: "system", title: payload.title, dedupeKey: payload.dedupeKey });
    expect(checkRepeatedFailure(deps, { runId: "f2", status: "timed_out" })).toBeNull();
    expect(fired).toHaveLength(1);
  });
});

describe("silentRoutine sentinel", () => {
  const routine = (over: Partial<SilentRoutineCandidate>): SilentRoutineCandidate => ({
    id: "digest",
    name: "Daily digest",
    enabled: true,
    lastFiredAt: NOW - 3 * HOUR,
    createdAt: NOW - 30 * DAY,
    expectedIntervalMs: HOUR,
    ...over,
  });

  it("reports an enabled routine overdue by more than 2× its interval", () => {
    const alerts = silentRoutineAlerts([routine({})], { now: NOW });
    expect(alerts).toHaveLength(1);
    expect(alerts[0]!.sentinel).toBe("silentRoutine");
    expect(alerts[0]!.severity).toBe("warn");
    expect(alerts[0]!.href).toBe("/routines");
    expect(alerts[0]!.dedupeKey).toBe("sentinel:silentRoutine:2026-09-04:digest");
  });

  it("ignores a routine still inside the window, a disabled one and one with no rhythm", () => {
    expect(silentRoutineAlerts([routine({ lastFiredAt: NOW - HOUR })], { now: NOW })).toEqual([]);
    expect(silentRoutineAlerts([routine({ enabled: false })], { now: NOW })).toEqual([]);
    expect(silentRoutineAlerts([routine({ expectedIntervalMs: null })], { now: NOW })).toEqual([]);
    // The factor is configurable: 4 intervals of slack keeps this one quiet.
    expect(silentRoutineAlerts([routine({})], { now: NOW, factor: 4 })).toEqual([]);
  });

  it("treats a routine that never fired as overdue from its creation", () => {
    const never = routine({ lastFiredAt: null, createdAt: NOW - 5 * HOUR });
    expect(silentRoutineAlerts([never], { now: NOW })[0]!.body).toContain("never run");
    expect(silentRoutineAlerts([routine({ lastFiredAt: null, createdAt: NOW })], { now: NOW })).toEqual([]);
  });

  it("derives the expected interval from the schedule kind", () => {
    const base = { schedule: "", timezone: "UTC", every: null, heartbeat: null };
    expect(
      expectedIntervalMs({ ...base, kind: "every", every: { value: 15, unit: "minutes" } } as RoutineStatus),
    ).toBe(15 * 60_000);
    expect(
      expectedIntervalMs({
        ...base,
        kind: "heartbeat",
        heartbeat: { intervalMinutes: 30, activeHours: null, quiet: true, okToken: "OK" },
      } as RoutineStatus),
    ).toBe(30 * 60_000);
    expect(
      expectedIntervalMs({ ...base, kind: "cron", schedule: "0 * * * *" } as RoutineStatus, "UTC", NOW),
    ).toBe(HOUR);
    expect(expectedIntervalMs({ ...base, kind: "at" } as RoutineStatus)).toBeNull();
    expect(expectedIntervalMs({ ...base, kind: "on-exit" } as RoutineStatus)).toBeNull();
  });

  it("emits through the scheduler and skips what the inbox already carries", () => {
    const bus = new EventBus();
    const store = new NotificationStore(db);
    const status = {
      id: "digest",
      name: "Daily digest",
      enabled: true,
      kind: "every",
      every: { value: 60, unit: "minutes" },
      heartbeat: null,
      schedule: "",
      timezone: "UTC",
      createdAt: NOW - 10 * DAY,
      lastFiredAt: NOW - 6 * HOUR,
    } as unknown as RoutineStatus;
    const scheduler = { status: () => [status], silent: () => [] };
    const deps = { bus, scheduler, dedupe: store, now: () => NOW };
    const fired = checkSilentRoutines(deps);
    expect(fired).toHaveLength(1);
    store.add({ kind: "system", title: fired[0]!.title, dedupeKey: fired[0]!.dedupeKey });
    expect(checkSilentRoutines(deps)).toEqual([]);
  });
});

describe("connectorDelta diff", () => {
  it("says nothing on the first check and counts only unseen ids afterwards", () => {
    const first = diffConnectorItems([{ id: "a" }, { id: "b" }], null);
    expect(first.first).toBe(true);
    expect(first.newIds).toEqual([]);
    const mark = { hash: first.hash, ids: first.digests, at: NOW };
    expect(diffConnectorItems([{ id: "a" }, { id: "b" }], mark).newIds).toEqual([]);
    expect(diffConnectorItems([{ id: "b" }, { id: "c" }], mark).newIds).toHaveLength(1);
    // Ids are stored hashed: the raw id never reaches the meta table.
    const secret = diffConnectorItems([{ id: "invoice-from-zoe@example.com" }], null);
    expect(secret.digests.join(" ")).not.toContain("zoe");
  });
});

describe("recorder mapping for sentinel.fired", () => {
  const event = (payload: unknown) => ({ id: 1, type: "sentinel.fired" as const, ts: NOW, payload });

  it("becomes a system row whose tone follows the severity", () => {
    const row = toNotification(
      event({
        sentinel: "repeatedFailure",
        title: "digest failed 2 times",
        body: "The same work failed twice.",
        severity: "warn",
        href: "/runs?status=failed",
        dedupeKey: "sentinel:repeatedFailure:2026-09-04:skill:digest",
      }),
    )!;
    expect(row.kind).toBe("system");
    expect(row.tone).toBe("warn");
    expect(row.title).toBe("digest failed 2 times");
    expect(row.href).toBe("/runs?status=failed");
    expect(row.dedupeKey).toBe("sentinel:repeatedFailure:2026-09-04:skill:digest");
    expect(row.ts).toBe(NOW);
  });

  it("maps info and danger, and refuses a payload with no title", () => {
    expect(toNotification(event({ title: "New mail", body: "3 items", severity: "info" }))!.tone).toBe(
      "info",
    );
    expect(toNotification(event({ title: "Disk full", body: "…", severity: "danger" }))!.tone).toBe("danger");
    expect(toNotification(event({ severity: "info", body: "no title" }))).toBeNull();
  });

  it("reaches the store through the bus and dedupes on the key", () => {
    const store = new NotificationStore(db);
    const payload: SentinelFiredPayload = {
      sentinel: "connectorDelta",
      title: "3 new items in Gmail",
      body: "Three unseen ids.",
      severity: "info",
      dedupeKey: "sentinel:connectorDelta:gmail:1",
    };
    const input = toNotification(event(payload))!;
    store.add({ ...input, ts: NOW });
    store.add({ ...input, ts: NOW + 1000 });
    expect(store.list().filter((r) => r.title === payload.title)).toHaveLength(1);
  });
});

describe("triage decisions", () => {
  it("parses strict JSON, fenced JSON and prose around it", () => {
    expect(parseTriageDecision('{"action":"ignore","summary":"noise","proposal":""}')).toEqual({
      action: "ignore",
      summary: "noise",
      proposal: "",
    });
    expect(
      parseTriageDecision('Here you go:\n```json\n{"action":"notify","summary":"Mail piled up"}\n```')!,
    ).toEqual({ action: "notify", summary: "Mail piled up", proposal: "" });
    expect(parseTriageDecision('{"action":"maybe"}')).toBeNull();
    expect(parseTriageDecision("not json at all")).toBeNull();
    expect(parseTriageDecision(null)).toBeNull();
  });

  it("writes nothing for ignore and an inbox row linking to the run otherwise", () => {
    const payload: SentinelFiredPayload = {
      sentinel: "repeatedFailure",
      title: "digest failed 2 times",
      body: "…",
      severity: "warn",
      dedupeKey: "sentinel:repeatedFailure:2026-09-04:skill:digest",
    };
    expect(triageNotification(payload, { action: "ignore", summary: "s", proposal: "" }, "run-1")).toBeNull();
    const notify = triageNotification(
      payload,
      { action: "notify", summary: "It broke", proposal: "" },
      "run-1",
    )!;
    expect(notify.tone).toBe("info");
    expect(notify.href).toBe("/runs/run-1");
    expect(notify.runId).toBe("run-1");
    const propose = triageNotification(
      payload,
      { action: "propose", summary: "It broke", proposal: "Re-authenticate the connector" },
      "run-1",
    )!;
    expect(propose.tone).toBe("warn");
    expect(propose.body).toBe("It broke → Re-authenticate the connector");
    expect(propose.dedupeKey).toBe("triage:sentinel:repeatedFailure:2026-09-04:skill:digest");
  });
});
