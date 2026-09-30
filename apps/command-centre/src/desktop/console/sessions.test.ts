import { describe, expect, it } from "vitest";
import { shortTitle } from "./sessions";

describe("shortTitle", () => {
  it("keeps six words and marks the cut", () => {
    expect(shortTitle("revise o plano de onboarding e escreva um resumo curto")).toBe(
      "revise o plano de onboarding e…",
    );
    expect(shortTitle("teste")).toBe("teste");
    expect(shortTitle("  muitos   espaços   aqui.  ")).toBe("muitos espaços aqui.");
    expect(shortTitle("")).toBe("");
  });
});
