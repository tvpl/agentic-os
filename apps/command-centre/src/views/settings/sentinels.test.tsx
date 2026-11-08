// @vitest-environment jsdom
/**
 * Configurações › Notificações › Sentinelas and the reviews that fell due (.specs/features/cerebro-natureza, C88;
 * plan.md amendment 16): the row "Revisões vencidas" with its hint after "Folder watch" and before the triage row, and
 * its button sending `PUT /api/settings` with every current sentinel and `reviewDue: { enabled: false }` (the route
 * replaces `sentinels` whole). The save is the one the Settings screen makes: `api.putSettings`, spied on.
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
  triage: { enabled: false, model: "haiku", dailyBudgetUsd: 0.5 },
};

function setup(lang: Lang = "pt-BR") {
  const put = vi
    .spyOn(api, "putSettings")
    .mockResolvedValue({ settings: {}, pendingApproval: null } as never);
  const s = {
    sentinels: structuredClone(SENTINELS),
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
  it("C88 Revisões vencidas with its hint sits after Folder watch and before the triage row", () => {
    setup();
    const rows = [...document.querySelectorAll(".apps-sound strong")].map((s) => s.textContent);
    const at = rows.indexOf("Revisões vencidas");
    expect(at).toBeGreaterThan(0);
    expect(rows[at - 1]).toBe("Vigiar pastas");
    expect(rows[at + 1]).toBe("Triagem com modelo");
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
