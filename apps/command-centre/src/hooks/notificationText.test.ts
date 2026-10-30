import { describe, expect, it } from "vitest";
import { notificationText } from "./notificationText";
describe("persisted notification language", () => {
  it("translates legacy system text and retains names", () => {
    expect(
      notificationText(
        'Routine "Minha rotina" went quiet',
        "It has never run, 12 h after it was created, and its schedule expects every 24h.",
        "pt-BR",
      ),
    ).toEqual({
      title: "A rotina “Minha rotina” parou de executar",
      body: "Nunca executou, mesmo após 12 h da criação. Intervalo previsto: 24h.",
    });
    expect(notificationText("Run failed", "Smoke test", "pt-BR")).toEqual({
      title: "A execução falhou",
      body: "Smoke test",
    });
  });
  it("localizes index recovery without promising preservation on unknown failures", () => {
    expect(
      notificationText("Index failed", "Index update interrupted. Check diagnostics and retry.", "pt-BR"),
    ).toEqual({
      title: "A indexação falhou",
      body: "Atualização do índice interrompida. Verifique o diagnóstico e tente novamente.",
    });
  });
  it("preserves arbitrary user content and English", () => {
    expect(notificationText("Meu aviso", "3 scanned", "pt-BR")).toEqual({
      title: "Meu aviso",
      body: "3 scanned",
    });
    expect(notificationText("Run failed", undefined, "en-US").title).toBe("Run failed");
  });
});

it("localizes structured events without interpreting an authored title", () => {
  expect(
    notificationText("Customized failure title", "my task", "pt-BR", {
      messageKey: "run.finished",
      messageParams: { status: "timed_out" },
    }).title,
  ).toBe("A execução excedeu o tempo limite");
  expect(notificationText("Run failed", "authored text", "pt-BR", { messageKey: "custom.message" })).toEqual({
    title: "Run failed",
    body: "authored text",
  });
});

describe("C88 the reviewDue row (cerebro-natureza, amendment 16)", () => {
  const row = (count: number, display: string) =>
    ({ messageKey: "sentinel.reviewDue", messageParams: { count, display } }) as const;
  it("C88 3 itens para revisar in pt-BR and 3 items to review in en, and 20+ itens para revisar with display 20+", () => {
    expect(
      notificationText("3 items to review", "Notes whose review date has passed…", "pt-BR", row(3, "3"))
        .title,
    ).toBe("3 itens para revisar");
    expect(
      notificationText("3 items to review", "Notes whose review date has passed…", "en", row(3, "3")).title,
    ).toBe("3 items to review");
    expect(notificationText("20+ items to review", "…", "pt-BR", row(27, "20+")).title).toBe(
      "20+ itens para revisar",
    );
  });
});
