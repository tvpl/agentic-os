import { describe, expect, it } from "vitest";
import { failureFix } from "./failureFix";

describe("failureFix", () => {
  it("names the cause and the one action per code", () => {
    expect(failureFix({ code: "authentication" }, "claude")).toEqual({
      causeKey: "runs.fix.auth",
      action: { kind: "login", command: "claude auth login" },
    });
    expect(failureFix({ code: "budget" }, "claude")?.action).toEqual({ kind: "budget" });
    expect(failureFix({ code: "timeout" }, null)?.action).toEqual({ kind: "retry" });
    expect(failureFix({ code: "unknown", recoverable: false }, null)?.action).toEqual({ kind: "none" });
    expect(failureFix(null, null, "timed_out")?.causeKey).toBe("runs.fix.timeout");
    expect(failureFix(null, null, "done")).toBeNull();
  });
});
