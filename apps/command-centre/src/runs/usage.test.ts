import { describe, expect, it } from "vitest";
import { contextUsed, foldUsage, formatTokens, formatUsd, latestTurnUsage, totalTokens } from "./usage";

describe("usage formatting", () => {
  it("formats dollars with sensible precision", () => {
    expect(formatUsd(null)).toBe("—");
    expect(formatUsd(0)).toBe("$0");
    expect(formatUsd(1.5)).toBe("$1.5");
    expect(formatUsd(12.345)).toBe("$12.35");
    expect(formatUsd(0.0421)).toBe("$0.042");
    expect(formatUsd(0.00123)).toBe("$0.0012");
  });

  it("formats tokens compactly", () => {
    expect(formatTokens(undefined)).toBe("—");
    expect(formatTokens(950)).toBe("950");
    expect(formatTokens(12_345)).toBe("12.3k");
    expect(formatTokens(1000)).toBe("1k");
    expect(formatTokens(4_200_000)).toBe("4.2M");
  });

  it("sums every token bucket", () => {
    expect(totalTokens({ inputTokens: 1, outputTokens: 2, cacheReadTokens: 3, cacheWriteTokens: 4 })).toBe(10);
    expect(totalTokens(null)).toBe(0);
  });
});

describe("context meter and live folding", () => {
  const events = [
    { type: "started", ts: 1 },
    { type: "usage", ts: 2, scope: "turn", inputTokens: 10, outputTokens: 5, cacheReadTokens: 1000, cacheWriteTokens: 50, model: "claude-sonnet-5" },
    { type: "usage", ts: 3, scope: "turn", inputTokens: 20, outputTokens: 7, cacheReadTokens: 1100, cacheWriteTokens: 0 },
    { type: "usage", ts: 4, scope: "total", inputTokens: 30, outputTokens: 12, cacheReadTokens: 2100, cacheWriteTokens: 50, costUsd: 0.2 },
  ];

  it("uses the last turn for the context window", () => {
    expect(latestTurnUsage(events)).toEqual({ inputTokens: 20, cacheReadTokens: 1100, cacheWriteTokens: 0, outputTokens: 7, model: null });
    expect(contextUsed(events)).toBe(1120);
    expect(contextUsed([{ type: "started", ts: 1 }])).toBeNull();
    expect(contextUsed([events[3]!])).toBeNull();
  });

  it("folds turns until a total replaces them", () => {
    expect(foldUsage(events.slice(0, 3))).toEqual({ inputTokens: 30, outputTokens: 12, cacheReadTokens: 2100, cacheWriteTokens: 50, costUsd: null, model: "claude-sonnet-5" });
    expect(foldUsage(events)).toEqual({ inputTokens: 30, outputTokens: 12, cacheReadTokens: 2100, cacheWriteTokens: 50, costUsd: 0.2, model: "claude-sonnet-5" });
    expect(foldUsage([])).toBeNull();
  });
});
