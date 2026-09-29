import { describe, expect, it } from "vitest";
import { tf, type TKey, type TVars } from "../../i18n";
import type { RunEventView } from "../../runs/useRunStream";
import { compactSteps, extractSteps, isGap, resultSummary, type TraceRun, type TraceStep } from "./runsTrace";

const t = (key: TKey, vars?: TVars) => tf("en", key, vars);
const T0 = 1_790_000_000_000;
const ev = (type: string, extra: Record<string, unknown> = {}, ts = T0): RunEventView => ({
  type,
  ts,
  ...extra,
});
const base: TraceRun = { status: "done", error: null, failure: null, createdAt: T0, startedAt: T0 };

describe("extractSteps", () => {
  it("turns events into plain-word steps and skips the noise", () => {
    const steps = extractSteps(
      [
        ev("session", { providerSessionId: "x" }),
        ev("started", { pid: 1 }),
        ev("usage", { inputTokens: 1, outputTokens: 1 }),
        ev("tool_use", { tool: "Read", detail: '{"file_path":"/repo/src/app.ts"}' }),
        ev("tool_use", { tool: "Bash", detail: '{"command":"npm test"}' }),
        ev("text", { stream: "stdout", text: "noise" }),
        ev("assistant", { text: "All green." }),
        ev("result", { exitCode: 0, summary: "All green.", durationMs: 4000, timedOut: false }),
      ],
      base,
      t,
      "/repo",
    );
    expect(steps.map((s) => [s.text, s.subject, s.tone])).toEqual([
      ["started", null, "ok"],
      ["read", "src/app.ts", "ok"],
      ["ran", "npm test", "ok"],
      ["said", "All green.", "ok"],
      ["finished", null, "ok"],
    ]);
  });

  it("folds repeats and merges a call's end into its start", () => {
    const steps = extractSteps(
      [
        ev("tool_use", { tool: "Bash", detail: '{"command":"ls"}', callId: "c1", phase: "start" }),
        ev("tool_use", {
          tool: "Bash",
          detail: "",
          callId: "c1",
          phase: "end",
          durationMs: 1200,
          outcome: "error",
        }),
        ev("tool_use", { tool: "Grep", detail: '{"pattern":"foo"}' }),
        ev("tool_use", { tool: "Grep", detail: '{"pattern":"foo"}' }),
        ev("tool_use", { tool: "tool_result", detail: "boom", outcome: "error" }),
      ],
      base,
      t,
    );
    expect(steps).toHaveLength(2);
    expect(steps[0]).toMatchObject({ text: "ran", tone: "warn", durationMs: 1200 });
    expect(steps[1]).toMatchObject({ text: "searched for", subject: "foo", count: 2, tone: "warn" });
  });

  it("lights the failing step with the run's error", () => {
    const run: TraceRun = {
      ...base,
      status: "failed",
      error: "Failed to authenticate",
      failure: { message: "OAuth session expired" },
    };
    const steps = extractSteps(
      [ev("started"), ev("result", { exitCode: 1, summary: "x", durationMs: 1, timedOut: false })],
      run,
      t,
    );
    const failing = steps.filter((s) => s.tone === "fail");
    expect(failing).toHaveLength(1);
    expect(failing[0]).toMatchObject({ text: "failed", error: "OAuth session expired" });
  });

  it("prefers an explicit error event as the failing step", () => {
    const steps = extractSteps(
      [
        ev("started"),
        ev("error", { message: "EBUSY: index locked" }),
        ev("result", { exitCode: null, summary: "", durationMs: 1, timedOut: true }),
      ],
      { ...base, status: "timed_out", error: "timeout" },
      t,
    );
    expect(steps.find((s) => s.tone === "fail")).toMatchObject({
      text: "hit an error",
      error: "EBUSY: index locked",
    });
    expect(steps[steps.length - 1]).toMatchObject({ text: "ran out of time", tone: "fail", error: null });
  });

  it("marks a run with no events as failed on its only step", () => {
    const steps = extractSteps([], { ...base, status: "failed", error: "spawn ENOENT" }, t);
    expect(steps).toEqual([expect.objectContaining({ tone: "fail", error: "spawn ENOENT" })]);
  });

  it("ends a live run on a step in motion, and a queued one on the queue", () => {
    const live = extractSteps([ev("started")], { ...base, status: "running" }, t);
    expect(live[live.length - 1]).toMatchObject({ tone: "run", text: tf("en", "scene.runs.step.working") });
    const waiting = extractSteps([ev("started")], { ...base, status: "waiting_approval" }, t);
    expect(waiting[waiting.length - 1]).toMatchObject({ tone: "warn" });
    expect(extractSteps([], { ...base, status: "queued" }, t)).toEqual([
      expect.objectContaining({ tone: "run", text: tf("en", "scene.runs.step.queued") }),
    ]);
  });

  it("reads a cancelled result as stopped", () => {
    const steps = extractSteps(
      [
        ev("started"),
        ev("result", { exitCode: 143, summary: "", durationMs: 1, timedOut: false, cancelled: true }),
      ],
      { ...base, status: "cancelled" },
      t,
    );
    expect(steps[1]).toMatchObject({ tone: "skip", text: tf("en", "scene.runs.step.stopped") });
  });
});

describe("compactSteps", () => {
  const mk = (n: number, failAt = -1): TraceStep[] =>
    Array.from({ length: n }, (_, i) => ({
      key: `s${i}`,
      text: `step ${i}`,
      subject: null,
      tone: i === failAt ? "fail" : "ok",
      ts: T0 + i,
      durationMs: null,
      count: 1,
      error: null,
    }));

  it("leaves a short chain alone", () => {
    expect(compactSteps(mk(5), 7)).toHaveLength(5);
  });

  it("keeps the first, the failure and its neighbours, and the latest", () => {
    const out = compactSteps(mk(20, 6), 7);
    const kept = out.filter((x) => !isGap(x)).map((x) => (x as TraceStep).key);
    expect(kept).toEqual(["s0", "s5", "s6", "s7", "s17", "s18", "s19"]);
    const gaps = out.filter(isGap).map((g) => g.gap);
    expect(gaps).toEqual([4, 9]);
  });

  it("without a failure keeps the start and the end", () => {
    const out = compactSteps(mk(12), 5);
    const kept = out.filter((x) => !isGap(x)).map((x) => (x as TraceStep).key);
    expect(kept).toEqual(["s0", "s8", "s9", "s10", "s11"]);
  });
});

describe("resultSummary", () => {
  it("is the last result's summary", () => {
    expect(resultSummary([ev("result", { summary: "  done it " })])).toBe("done it");
    expect(resultSummary([ev("assistant", { text: "x" })])).toBeNull();
  });
});
