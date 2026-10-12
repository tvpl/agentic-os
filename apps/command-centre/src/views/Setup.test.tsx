// @vitest-environment jsdom
/**
 * The in-UI Setup without the HUD step (.specs/features/limpeza-legado, C10, C11): five steps whose last one is
 * the look of the app, no instrument toggle, and a finish that saves the look and nothing about a HUD.
 */
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import type { ReactNode } from "react";
import type * as ApiModule from "../api";
import { api } from "../api";
import { I18nContext, type Lang } from "../i18n";
import Setup from "./Setup";

const SETTINGS = {
  version: 2,
  systemName: "Casa",
  language: "en",
  theme: "dark",
  accentColor: "#ff7a1a",
  defaultProvider: "claude",
  providers: {
    claude: { enabled: true, defaultModel: null, defaultEffort: "default", binaryPath: null },
  },
  indexedFolders: [],
};

vi.mock("../api", async (importOriginal) => {
  const mod = await importOriginal<typeof ApiModule>();
  const answer = (url: string): Promise<unknown> => {
    if (url === "/api/settings") return Promise.resolve(structuredClone(SETTINGS));
    if (url.startsWith("/api/providers"))
      return Promise.resolve([
        {
          id: "claude",
          displayName: "Claude",
          enabled: true,
          isDefault: true,
          health: { installed: true, ok: true, authenticated: true },
        },
      ]);
    if (url.startsWith("/api/connectors")) return Promise.resolve([]);
    return new Promise(() => undefined);
  };
  return {
    ...mod,
    api: {
      ...mod.api,
      get: vi.fn((url: string) => answer(url)),
      post: vi.fn(() => Promise.resolve({})),
      put: vi.fn(() => Promise.resolve({})),
      patch: vi.fn(() => Promise.resolve({})),
      putSettings: vi.fn(() => Promise.resolve({ settings: SETTINGS, pendingApproval: null })),
      putUiPreferences: vi.fn((patch: object) => Promise.resolve(patch)),
    },
  };
});

beforeAll(() => {
  window.matchMedia ??= ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => undefined,
    removeListener: () => undefined,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  document.documentElement.removeAttribute("data-preset");
});

function open(lang: Lang = "en") {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <I18nContext.Provider value={{ lang, setLang: () => undefined }}>
      <MemoryRouter>
        <QueryClientProvider client={qc}>{children}</QueryClientProvider>
      </MemoryRouter>
    </I18nContext.Provider>
  );
  return render(<Setup onDone={() => undefined} />, { wrapper });
}

const NEXT: Record<Lang, string> = { en: "Next", "pt-BR": "Avançar" };
const FINISH: Record<Lang, string> = { en: "Finish setup", "pt-BR": "Concluir setup" };
const STEPS: Record<Lang, string[]> = {
  en: ["Providers", "Identity", "Folders", "Connect data", "Appearance"],
  "pt-BR": ["Provedores", "Identidade", "Pastas", "Conectar dados", "Aparência"],
};
const PROGRESS: Record<Lang, string> = { en: "Setup progress", "pt-BR": "Progresso do setup" };

async function toTheLastStep(lang: Lang) {
  for (let i = 0; i < 4; i++) fireEvent.click(await screen.findByRole("button", { name: NEXT[lang] }));
  await screen.findByRole("button", { name: FINISH[lang] });
}

describe("C10 the steps of the Setup", () => {
  it.each(["en", "pt-BR"] as const)(
    "C10 five steps ending in the appearance, no HUD anywhere (%s)",
    async (lang) => {
      open(lang);
      const stepper = await screen.findByRole("list", { name: PROGRESS[lang] });
      const labels = within(stepper)
        .getAllByRole("listitem")
        .map((li) => li.textContent?.replace(/^\d+/, "").trim());
      expect(labels).toEqual(STEPS[lang]);

      await toTheLastStep(lang);
      // The look: the five presets, each a toggle button, and nothing else that toggles.
      const pressed = screen
        .getAllByRole("button", { pressed: true })
        .concat(screen.getAllByRole("button", { pressed: false }));
      expect(pressed).toHaveLength(5);
      expect(pressed.map((b) => b.textContent)).toEqual(
        expect.arrayContaining([expect.stringContaining("JARVIS"), expect.stringContaining("Forest")]),
      );
      expect(document.querySelector("[data-hud]")).toBeNull();
      expect(screen.queryByRole("group", { name: /arc/i })).toBeNull();
      // The words of the screen: the step labels, the hint and the controls. (The name of a look, "HUD Orange", is a look.)
      const page = document.body.cloneNode(true) as HTMLElement;
      page.querySelector(".apps-presets")?.remove();
      expect(page.textContent ?? "").not.toMatch(/\bHUD\b/i);
      expect(page.textContent ?? "").not.toMatch(/Left arc|Right arc|Arco da/);
    },
  );

  it("C10 choosing a look applies it at once", async () => {
    open("en");
    await toTheLastStep("en");
    fireEvent.click(screen.getByRole("button", { name: /JARVIS/ }));
    expect(document.documentElement.dataset.preset).toBe("jarvis");
    expect(screen.getByRole("button", { name: /JARVIS/ }).getAttribute("aria-pressed")).toBe("true");
  });
});

describe("C11 what finishing saves", () => {
  it("C11 saves the look and nothing about a HUD, then the settings", async () => {
    open("en");
    await toTheLastStep("en");
    fireEvent.click(screen.getByRole("button", { name: /Forest/ }));
    fireEvent.click(screen.getByRole("button", { name: FINISH.en }));
    await waitFor(() => expect(api.putUiPreferences).toHaveBeenCalledTimes(1));
    expect(vi.mocked(api.putUiPreferences).mock.calls[0]![0]).toEqual({ themePreset: "forest" });
    await waitFor(() => expect(api.putSettings).toHaveBeenCalledTimes(1));
    expect(vi.mocked(api.putSettings).mock.calls[0]![0]).toMatchObject({ setupCompleted: true });
    expect(vi.mocked(api.putUiPreferences).mock.invocationCallOrder[0]!).toBeLessThan(
      vi.mocked(api.putSettings).mock.invocationCallOrder[0]!,
    );
  });

  it("C11 a look that failed to save leaves the Setup unfinished", async () => {
    vi.mocked(api.putUiPreferences).mockRejectedValueOnce(new Error("disk full"));
    open("en");
    await toTheLastStep("en");
    fireEvent.click(screen.getByRole("button", { name: FINISH.en }));
    await waitFor(() => expect(api.putUiPreferences).toHaveBeenCalledTimes(1));
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(api.putSettings).not.toHaveBeenCalled();
  });
});
