import { describe, expect, it } from "vitest";
import { factsFromEvents, recallFromEvents } from "./recallFromEvents";

const ev = (type: string, extra: Record<string, unknown>) => ({ type, ts: 1, ...extra });

describe("recallFromEvents", () => {
  it("pairs a recall question with the sections its result listed", () => {
    const events = [
      ev("tool_use", {
        tool: "mcp__mordomo__recall",
        callId: "c1",
        phase: "start",
        detail: '{"question":"budget rules"}',
      }),
      ev("tool_use", {
        tool: "tool_result",
        callId: "c1",
        phase: "end",
        detail: JSON.stringify(
          "## memory/areas/financas.md § Budget (score 7.5)\ntext\n\n## docs/security.md § (top) (score 2)\nmore",
        ),
      }),
    ];
    expect(recallFromEvents(events)).toEqual([
      {
        question: "budget rules",
        paths: [
          { path: "memory/areas/financas.md", section: "Budget", score: 7.5 },
          { path: "docs/security.md", section: "(top)", score: 2 },
        ],
      },
    ]);
  });

  it("reads a learned fact and its id", () => {
    const events = [
      ev("tool_use", {
        tool: "mcp__mordomo__facts_assert",
        callId: "f1",
        phase: "start",
        detail: '{"subject":"user","predicate":"prefers","object":"pt-BR commits"}',
      }),
      ev("tool_use", {
        tool: "tool_result",
        callId: "f1",
        phase: "end",
        detail: JSON.stringify("Remembered fact #12: user prefers pt-BR commits"),
      }),
    ];
    expect(factsFromEvents(events)).toEqual([{ id: 12, text: "user prefers pt-BR commits" }]);
    expect(recallFromEvents(events)).toEqual([]);
  });
});
