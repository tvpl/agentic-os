import { describe, expect, it } from "vitest";
import { spokenSummary } from "./voice";

describe("spokenSummary", () => {
  it("keeps the first two sentences and drops code", () => {
    const text =
      "Pronto. Atualizei `src/a.ts` e rodei os testes.\n\n```ts\nconst x = 1;\n```\nTudo verde. Quer que eu commite?";
    expect(spokenSummary(text)).toBe("Pronto. Atualizei e rodei os testes.");
  });

  it("cuts a long single sentence at the cap", () => {
    const long = "a".repeat(400);
    const out = spokenSummary(long, 50);
    expect(out.length).toBeLessThanOrEqual(50);
    expect(out.endsWith("…")).toBe(true);
  });

  it("is empty for an empty reply", () => {
    expect(spokenSummary("   ")).toBe("");
  });
});
