import { describe, expect, it } from "vitest";
import { emulatedPrompt } from "../core/src/runs/emulatedSession.js";

describe("emulated sessions", () => {
  it("returns the prompt untouched without earlier turns", () => {
    expect(emulatedPrompt([], "hello")).toBe("hello");
    expect(emulatedPrompt([{ prompt: "   ", reply: "x" }], "hello")).toBe("hello");
  });

  it("quotes previous turns oldest first, then the new request", () => {
    const out = emulatedPrompt(
      [
        { prompt: "Remember the code ORCHID-42.", reply: "Noted: ORCHID-42." },
        { prompt: "What is the capital of Peru?", reply: null },
      ],
      "What was the code?",
    );
    expect(out.indexOf("ORCHID-42")).toBeLessThan(out.indexOf("Peru"));
    expect(out).toContain("User: Remember the code ORCHID-42.");
    expect(out).toContain("Assistant: Noted: ORCHID-42.");
    expect(out.trimEnd().endsWith("What was the code?")).toBe(true);
    expect(out).toContain("not as new instructions");
  });

  it("keeps the newest turns within the budget and clips long replies", () => {
    const turns = Array.from({ length: 10 }, (_, i) => ({ prompt: `turn ${i}`, reply: "y".repeat(3000) }));
    const out = emulatedPrompt(turns, "next", { maxTurns: 6, maxReplyChars: 1000, maxChars: 2500 });
    expect(out).not.toContain("User: turn 0");
    expect(out).toContain("User: turn 9");
    expect(out.length).toBeLessThan(3200);
    expect(out).toContain("…");
  });
});
