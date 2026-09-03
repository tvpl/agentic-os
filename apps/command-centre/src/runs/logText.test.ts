import { describe, expect, it } from "vitest";
import { eventBody, eventsToText, relativeOffset, searchIndices, splitMatches } from "./logText";

describe("log text", () => {
  it("renders every event type readably", () => {
    expect(eventBody({ type: "text", ts: 1, stream: "stderr", text: "boom" })).toBe("stderr: boom");
    expect(eventBody({ type: "tool_use", ts: 1, tool: "Read", detail: "{}" })).toBe("tool Read {}");
    expect(eventBody({ type: "result", ts: 1, exitCode: 0, summary: "done" })).toBe("result exit=0\ndone");
    expect(eventBody({ type: "usage", ts: 1, inputTokens: 5, outputTokens: 6, costUsd: 0.1, model: "m" })).toBe("usage in=5 out=6 $0.1 m");
    expect(eventBody({ type: "weird", ts: 1 })).toContain("weird");
  });

  it("joins events with timestamps and indents continuation lines", () => {
    const text = eventsToText([
      { type: "started", ts: 1_700_000_000_000, pid: 7 },
      { type: "result", ts: 1_700_000_001_500, exitCode: 0, summary: "line1\nline2" },
    ]);
    const lines = text.split("\n");
    expect(lines).toHaveLength(3);
    expect(lines[0]).toContain("+0.0s");
    expect(lines[0]).toContain("started pid=7");
    expect(lines[1]).toContain("+1.5s");
    expect(lines[2]!.trim()).toBe("line2");
    expect(lines[2]!.startsWith("   ")).toBe(true);
    expect(relativeOffset(2500, 1000)).toBe("+1.5s");
  });

  it("searches case-insensitively and splits matches", () => {
    expect(searchIndices(["Hello", "world", "HELLO world"], "hello")).toEqual([0, 2]);
    expect(searchIndices(["a"], "  ")).toEqual([]);
    expect(splitMatches("foo Bar foo", "bar")).toEqual(["foo ", "Bar", " foo"]);
    expect(splitMatches("aaa", "a")).toEqual(["", "a", "", "a", "", "a", ""]);
    expect(splitMatches("none", "zz")).toEqual(["none"]);
    expect(splitMatches("x", "")).toEqual(["x"]);
  });
});
