import { describe, expect, it } from "vitest";
import type { ApprovalRecord, RunRecord } from "../api";
import { approvalForRun, approvalLabel, approvalTarget, writeRunApprovals } from "./approvals";

const approval = (over: Partial<ApprovalRecord> = {}): ApprovalRecord => ({
  id: "a1",
  createdAt: 1,
  kind: "write_run",
  description: "Write-mode prompt run",
  payload: {},
  status: "pending",
  resolvedAt: null,
  resolvedBy: null,
  requestedBy: null,
  expiresAt: 0,
  ...over,
});

const run = (over: Partial<RunRecord> = {}): RunRecord =>
  ({
    id: "r1",
    createdAt: 1,
    finishedAt: null,
    origin: "manual",
    provider: "claude",
    model: null,
    status: "waiting_approval",
    durationMs: null,
    promptSummary: "Rewrite the README",
    skillSlug: null,
    routineId: null,
    error: null,
    artifacts: [],
    exitCode: null,
    ...over,
  }) as RunRecord;

describe("approval payloads", () => {
  it("reads the launch input defensively", () => {
    expect(
      approvalTarget(
        approval({ payload: { kind: "prompt", input: { prompt: "hi", cwd: "/w", provider: "claude" } } }),
      ),
    ).toEqual({
      kind: "prompt",
      skillSlug: null,
      prompt: "hi",
      cwd: "/w",
      provider: "claude",
      model: null,
      effort: null,
      mode: null,
      inputs: [],
      requestedByName: null,
    });
    expect(approvalTarget(approval({ payload: { kind: "skill", input: { slug: "tidy" } } })).skillSlug).toBe(
      "tidy",
    );
    expect(approvalTarget(approval({ payload: { kind: 7, input: 3 } }))).toEqual({
      kind: "other",
      skillSlug: null,
      prompt: null,
      cwd: null,
      provider: null,
      model: null,
      effort: null,
      mode: null,
      inputs: [],
      requestedByName: null,
    });
    // A skill held for approval writes, and says so though its input does not carry a mode; the name is kept.
    expect(
      approvalTarget(
        approval({ payload: { kind: "skill", requestedByName: "Pixel", input: { slug: "tidy" } } }),
      ),
    ).toMatchObject({ mode: "write", requestedByName: "Pixel" });
    // A skill's inputs keep their order; a value that is not text is shown as JSON, never dropped.
    expect(
      approvalTarget(
        approval({
          payload: {
            kind: "skill",
            input: {
              slug: "s",
              inputs: { b: "two", a: 1, c: { x: true } },
              model: "m",
              effort: "low",
              mode: "write",
            },
          },
        }),
      ),
    ).toMatchObject({
      inputs: [
        ["b", "two"],
        ["a", "1"],
        ["c", '{"x":true}'],
      ],
      model: "m",
      effort: "low",
      mode: "write",
    });
  });

  it("keeps only pending write-run approvals", () => {
    const list = [
      approval(),
      approval({ id: "a2", kind: "expose_port" }),
      approval({ id: "a3", status: "approved" }),
    ];
    expect(writeRunApprovals(list).map((a) => a.id)).toEqual(["a1"]);
    expect(writeRunApprovals(undefined)).toEqual([]);
  });
});

describe("approvalForRun", () => {
  const skillApproval = approval({ id: "as", payload: { kind: "skill", input: { slug: "tidy" } } });
  const promptApproval = approval({
    id: "ap",
    payload: { kind: "prompt", input: { prompt: "Rewrite the README please" } },
  });

  it("matches by skill slug and by prompt head", () => {
    expect(approvalForRun([skillApproval, promptApproval], run({ skillSlug: "tidy" }))?.id).toBe("as");
    expect(approvalForRun([promptApproval], run({ promptSummary: "Rewrite the README please" }))?.id).toBe(
      "ap",
    );
    expect(approvalForRun([promptApproval], run({ promptSummary: "Something else" }))).toBeNull();
  });

  it("ignores runs that are not waiting", () => {
    expect(approvalForRun([skillApproval], run({ skillSlug: "tidy", status: "running" }))).toBeNull();
  });

  it("labels rows", () => {
    expect(approvalLabel(skillApproval, "?")).toBe("/tidy");
    expect(
      approvalLabel(approval({ payload: { kind: "prompt", input: { prompt: "line one\nline two" } } }), "?"),
    ).toBe("line one");
    expect(approvalLabel(approval({ description: "" }), "fallback")).toBe("fallback");
  });
});

describe("which approvals are a device's write", () => {
  it("is a write run with a device behind it, and nothing else", async () => {
    const { isDeviceWriteApproval } = await import("./approvals");
    expect(isDeviceWriteApproval({ kind: "write_run", requestedBy: "device:abc" })).toBe(true);
    for (const requestedBy of ["owner", null, "telegram:42", "broker:r1"]) {
      expect(isDeviceWriteApproval({ kind: "write_run", requestedBy }), String(requestedBy)).toBe(false);
    }
    expect(isDeviceWriteApproval({ kind: "tool_use", requestedBy: "device:abc" })).toBe(false);
  });
});
