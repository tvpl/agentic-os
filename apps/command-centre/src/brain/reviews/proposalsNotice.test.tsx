// @vitest-environment jsdom
/**
 * The inbox row of the agent's proposals and its switch (.specs/features/cerebro-memoria-confiavel, C103; door 11; G19):
 * the `proposalsPending` row as the sentinel writes it reads "3 propostas do agente para revisar" (en "3 agent
 * proposals to review") and opens `/brain/reviews?tab=agent` on "Do agente"; Configurações › Notificações lists
 * "Propostas do agente" with its hint and a switch that sends `PUT /api/settings` with
 * `sentinels.proposalsPending.enabled` (every current sentinel kept: the route replaces `sentinels` whole).
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type * as ApiModule from "../../api";
import { api } from "../../api";
import { installPage } from "../../ui/testkit";
import { mountShell } from "../../commands/testkit";
import { ToastProvider } from "../../components/ui";
import { I18nContext, type Lang } from "../../i18n";
import { SentinelsCard } from "../../views/settings/notifications";
import type { SettingsShape } from "../../views/settings/shared";
import { net, resetNet, type Asked } from "../notes/testnet";
import { detailOf, pending, proposal, resetProposals, resetReviews } from "./testkit";

vi.mock("../../api", async (importOriginal) =>
  (await import("../notes/testnet")).mockApi(await importOriginal<typeof ApiModule>()),
);
vi.mock("../../nucleo/scenes/BrainSceneCanvas", () => ({ BrainSceneCanvas: () => null }));
vi.mock("../BrainCanvas", () => ({ BrainCanvas: () => null }));
vi.setConfig({ testTimeout: 30_000 });

beforeAll(() => {
  const noop = () => undefined;
  const ctx = new Proxy(
    {},
    { get: (_t, p) => (p === "measureText" ? () => ({ width: 0 }) : noop), set: () => true },
  );
  HTMLCanvasElement.prototype.getContext = function () {
    return ctx;
  } as unknown as typeof HTMLCanvasElement.prototype.getContext;
});
installPage();
beforeEach(() => {
  resetNet();
  resetReviews();
  resetProposals();
  globalThis.IntersectionObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
    takeRecords() {
      return [];
    }
  } as unknown as typeof IntersectionObserver;
  Element.prototype.scrollIntoView ??= () => undefined;
  Element.prototype.scrollTo ??= () => undefined;
  window.localStorage.setItem(
    "mordomo.onboarding.v1",
    JSON.stringify({ version: 1, status: "completed", step: 12, visited: [], practiced: false }),
  );
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  window.localStorage.clear();
  window.location.hash = "";
});

/** The row the recorder writes for the sentinel's `sentinel.fired` (the v1 fixture's payload). */
function inboxRow() {
  net.overrides.push((u: Asked) =>
    u.pathname === "/api/notifications"
      ? Promise.resolve({
          items: [
            {
              id: "n_proposals",
              kind: "system",
              title: "3 agent proposals to review",
              body: "What agents proposed to write to the memory waits in Reviews › From the agent: accept all, part or none.",
              ts: Date.now(),
              read: false,
              href: "/brain/reviews?tab=agent",
              messageKey: "sentinel.proposalsPending",
              messageParams: { count: 3 },
              tone: "info",
            },
          ],
        })
      : undefined,
  );
}

describe("C103 the inbox row of the agent's proposals", () => {
  for (const [lang, text] of [
    ["pt-BR", "3 propostas do agente para revisar"],
    ["en", "3 agent proposals to review"],
  ] as const)
    it(`C103 in ${lang} the row reads ${text}`, async () => {
      inboxRow();
      await mountShell("/", "moldura", lang);
      fireEvent.click(document.querySelector(".mold-bell")!);
      const rows = await screen.findAllByRole("button", { name: new RegExp(text) });
      expect(rows.length).toBeGreaterThan(0);
    });

  it("C103 activating it navigates to /brain/reviews?tab=agent with Do agente selected", async () => {
    inboxRow();
    const p = proposal({ kind: "note_create", summary: "Reunião" });
    pending([p, proposal(), proposal()]);
    detailOf(p, { diff: "@@ -0,0 +1 @@\n+x\n" });
    await mountShell("/", "moldura", "pt-BR");
    fireEvent.click(document.querySelector(".mold-bell")!);
    const rows = await screen.findAllByRole("button", { name: /3 propostas do agente para revisar/ });
    fireEvent.click(rows[0]!);
    await waitFor(() => expect(window.location.hash).toBe("#/brain/reviews?tab=agent"), { timeout: 10_000 });
    const tab = await screen.findByRole("tab", { name: "Do agente (3)" }, { timeout: 10_000 });
    expect(tab.getAttribute("aria-selected")).toBe("true");
  });
});

const SENTINELS = {
  fsWatch: { enabled: false, debounceMs: 4000 },
  repeatedFailure: { enabled: true, threshold: 2 },
  silentRoutine: { enabled: true, factor: 2 },
  connectorDelta: { enabled: true },
  repeatDetector: { enabled: true, similarity: 0.6 },
  reviewDue: { enabled: true },
  triage: { enabled: false, model: "haiku", dailyBudgetUsd: 0.5 },
  proposalsPending: { enabled: true },
};

function settings(lang: Lang = "pt-BR") {
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

describe("C103 the switch in Configurações › Notificações", () => {
  it("C103 Propostas do agente with its hint, and its switch sends PUT /api/settings with sentinels.proposalsPending.enabled", async () => {
    const put = settings();
    const strong = [...document.querySelectorAll(".apps-sound strong")].find(
      (s) => s.textContent === "Propostas do agente",
    )!;
    expect(strong).toBeTruthy();
    const row = strong.closest(".apps-sound")!;
    expect(row.querySelector(".hint")!.textContent).toBe(
      "Uma vez por dia, as propostas do agente esperando revisão.",
    );
    const toggle = row.querySelector("button")!;
    expect(toggle.getAttribute("aria-pressed")).toBe("true");
    await userEvent.setup().click(toggle);
    await waitFor(() => expect(put).toHaveBeenCalledTimes(1));
    expect(put.mock.calls[0]![0]).toEqual({
      sentinels: { ...SENTINELS, proposalsPending: { enabled: false } },
    });
  });

  it("C103 in en the row reads Agent proposals, Once a day, the agent proposals waiting for review.", () => {
    settings("en");
    const strong = [...document.querySelectorAll(".apps-sound strong")].find(
      (s) => s.textContent === "Agent proposals",
    )!;
    expect(strong.closest(".apps-sound")!.querySelector(".hint")!.textContent).toBe(
      "Once a day, the agent proposals waiting for review.",
    );
  });
});
