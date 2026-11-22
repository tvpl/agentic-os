// @vitest-environment jsdom
/**
 * Configurações › Notificações › Sentinelas and the reviews that fell due (.specs/features/cerebro-natureza, C88;
 * plan.md amendment 16): the row "Revisões vencidas" with its hint after "Folder watch" and before the weekly review's
 * row (cerebro-rituais G25; the triage row until then), and its button sending `PUT /api/settings` with every current
 * sentinel and `reviewDue: { enabled: false }` (the route replaces `sentinels` whole). The weekly review's row
 * (cerebro-rituais, C95; design.md "Lista de sentinelas"): nine rows, "Revisão semanal" right after "Revisões vencidas"
 * and right before the triage row, and its button. The save is the one the Settings screen makes: `api.putSettings`,
 * spied on.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { api } from "../../api";
import { ToastProvider } from "../../components/ui";
import { I18nContext, type Lang } from "../../i18n";
import { SentinelsCard } from "./notifications";
import type { SettingsShape } from "./shared";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const SENTINELS = {
  fsWatch: { enabled: false, debounceMs: 4000 },
  repeatedFailure: { enabled: true, threshold: 2 },
  silentRoutine: { enabled: true, factor: 2 },
  connectorDelta: { enabled: true },
  repeatDetector: { enabled: true, similarity: 0.6 },
  reviewDue: { enabled: true },
  weeklyReview: { enabled: true, weekday: 5, hour: 16 },
  triage: { enabled: false, model: "haiku", dailyBudgetUsd: 0.5 },
};
/** Every sentinel the settings hold (`SENTINEL_IDS` and the triage), as the service answers them. */
const NINE = { ...SENTINELS, proposalsPending: { enabled: true } };

function setup(lang: Lang = "pt-BR", sentinels: Record<string, unknown> = SENTINELS) {
  const put = vi
    .spyOn(api, "putSettings")
    .mockResolvedValue({ settings: {}, pendingApproval: null } as never);
  const s = {
    sentinels: structuredClone(sentinels),
    channels: {
      telegram: { enabled: false, chatId: "", botTokenEnv: "TELEGRAM_BOT_TOKEN", minTone: "warn" },
      push: { enabled: false, minTone: "warn" },
    },
  } as unknown as SettingsShape;
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <I18nContext.Provider value={{ lang, setLang: () => undefined }}>
      <QueryClientProvider client={qc}>
        <ToastProvider>
          <SentinelsCard s={s} put={(patch) => api.putSettings(patch).then(() => ({ ok: true as const }))} />
        </ToastProvider>
      </QueryClientProvider>
    </I18nContext.Provider>,
  );
  return put;
}

describe("C88 the settings row of the reviews that fell due", () => {
  it("C88 Revisões vencidas with its hint sits after Folder watch and before the weekly review's row (G25)", () => {
    setup();
    const rows = [...document.querySelectorAll(".apps-sound strong")].map((s) => s.textContent);
    const at = rows.indexOf("Revisões vencidas");
    expect(at).toBeGreaterThan(0);
    expect(rows[at - 1]).toBe("Vigiar pastas");
    // cerebro-rituais G25: the weekly review's row sits between it and "Triagem com modelo"
    expect(rows[at + 1]).toBe("Revisão semanal");
    const strong = [...document.querySelectorAll(".apps-sound strong")][at]!;
    const hint = strong.closest(".apps-sound")!.querySelector(".hint")!;
    expect(hint.textContent).toBe("Uma vez por dia, as notas que venceram a revisão.");
  });

  it("C88 in en the row reads Reviews due after Folder watch", () => {
    setup("en");
    const rows = [...document.querySelectorAll(".apps-sound strong")].map((s) => s.textContent);
    expect(rows[rows.indexOf("Reviews due") - 1]).toBe("Folder watch");
  });

  it("C88 its button sends PUT /api/settings with every current sentinel and reviewDue { enabled: false }", async () => {
    const put = setup();
    const strong = [...document.querySelectorAll(".apps-sound strong")].find(
      (s) => s.textContent === "Revisões vencidas",
    )!;
    const button = strong.closest(".apps-sound")!.querySelector("button")!;
    expect(button.getAttribute("aria-pressed")).toBe("true");
    await userEvent.setup().click(button);
    await waitFor(() => expect(put).toHaveBeenCalledTimes(1));
    expect(put.mock.calls[0]![0]).toEqual({ sentinels: { ...SENTINELS, reviewDue: { enabled: false } } });
    expect(screen.getAllByRole("button").length).toBeGreaterThan(0);
  });
});

describe("C95 the settings row of the weekly review", () => {
  // the sentinel card's own rows (the Telegram and push cards below it have rows of the same class)
  const rows = () =>
    [...document.querySelector(".card")!.querySelectorAll(":scope > .apps-sound strong")].map(
      (s) => s.textContent,
    );

  it("C95 nine rows, and Revisão semanal with its hint right after Revisões vencidas and right before Triagem com modelo", () => {
    setup("pt-BR", NINE);
    expect(rows()).toHaveLength(9);
    const at = rows().indexOf("Revisão semanal");
    expect(rows()[at - 1]).toBe("Revisões vencidas");
    expect(rows()[at + 1]).toBe("Triagem com modelo");
    const strong = [...document.querySelector(".card")!.querySelectorAll(":scope > .apps-sound strong")][at]!;
    expect(strong.closest(".apps-sound")!.querySelector(".hint")!.textContent).toBe(
      "Lembra uma vez por semana, no dia e hora escolhidos, se a revisão ainda não foi feita.",
    );
  });

  it("C95 in en the row reads Weekly review, after Reviews due", () => {
    setup("en", NINE);
    expect(rows()).toHaveLength(9);
    expect(rows()[rows().indexOf("Weekly review") - 1]).toBe("Reviews due");
  });

  it("C95 its switch sends PUT /api/settings with every current sentinel and weeklyReview { enabled: false, weekday: 5, hour: 16 }", async () => {
    const put = setup("pt-BR", NINE);
    const strong = [...document.querySelectorAll(".apps-sound strong")].find(
      (s) => s.textContent === "Revisão semanal",
    )!;
    const button = strong.closest(".apps-sound")!.querySelector("button")!;
    expect(button.getAttribute("aria-pressed")).toBe("true");
    await userEvent.setup().click(button);
    await waitFor(() => expect(put).toHaveBeenCalledTimes(1));
    expect(put.mock.calls[0]![0]).toEqual({
      sentinels: { ...NINE, weeklyReview: { enabled: false, weekday: 5, hour: 16 } },
    });
  });
});
