import { describe, expect, it } from "vitest";
import { ARRANGE_VERBS, arrangeFor } from "./arrange";

describe("arrangeFor", () => {
  it("maps an intent to panels in both languages", () => {
    expect(arrangeFor("revisar código do PR")).toMatchObject({
      theme: "review",
      panels: ["app:runs", "attention", "app:artifacts"],
    });
    expect(arrangeFor("review the diff")).toMatchObject({ theme: "review" });
    expect(arrangeFor("ver os custos de hoje")?.theme).toBe("cost");
    expect(arrangeFor("minha manhã")?.theme).toBe("morning");
    expect(arrangeFor("gerar imagens")?.theme).toBe("images");
  });

  it("prefers the theme with more matching words", () => {
    expect(arrangeFor("rotina noturna de memória")?.theme).toBe("routines");
  });

  it("is null for an intent it does not know", () => {
    expect(arrangeFor("xyzzy")).toBeNull();
  });

  it("recognises the verbs the palette accepts", () => {
    expect(ARRANGE_VERBS.exec("organizar revisar código")?.[1]).toBe("revisar código");
    expect(ARRANGE_VERBS.exec("arrange my morning")?.[1]).toBe("my morning");
    expect(ARRANGE_VERBS.test("organizar")).toBe(false);
  });
});
