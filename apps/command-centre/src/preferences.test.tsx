// @vitest-environment jsdom
/**
 * UI preferences (.specs/features/preferencias-ui, round 2): the screens that
 * used to read and write the seven moved fields through the settings now go
 * through the UI preferences. Each test serves different values from the two
 * routes, so a screen that reads the old source shows the wrong one.
 */
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, renderHook, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import type { ReactNode } from "react";
import type * as ApiModule from "./api";
import type * as BrainStateModule from "./brain/useBrainState";
import { api } from "./api";
import { DEFAULT_SETTINGS } from "./brain/engine/world";
import { useBrainState, type BrainStateSources } from "./brain/useBrainState";
import Setup from "./views/Setup";
import SecondBrain from "./views/SecondBrain";
import BrainScene from "./nucleo/scenes/BrainScene";
import { DesktopTab } from "./views/settings/desktop";
import { ThemeTab } from "./views/settings/theme";

const MOVED = ["themePreset", "microApps", "dashboardLayout", "spaces", "activeSpace", "hud", "brain"];

/** What `GET /api/settings` answers: an old server's leftovers, never to be shown. */
const SETTINGS = {
  version: 2,
  systemName: "Casa",
  language: "en",
  theme: "dark",
  accentColor: "#ff7a1a",
  defaultProvider: "claude",
  providers: {
    claude: { enabled: true, defaultModel: null, defaultEffort: "default", binaryPath: null },
    cursor: { enabled: false, defaultModel: null, defaultEffort: "default", binaryPath: null },
    codex: { enabled: false, defaultModel: null, defaultEffort: "default", binaryPath: null },
  },
  indexedFolders: [],
  themePreset: "forest",
  brain: { layout: "hex" },
  microApps: [{ id: "old", name: "Old app", description: "", href: "/old" }],
};
/** What `GET /api/ui-preferences` answers: the values the screens must use. */
const PREFERENCES = {
  version: 1,
  themePreset: "jarvis",
  microApps: [{ id: "pixel", name: "Pixel", description: "Draw", href: "/pixel" }],
  dashboardLayout: {},
  spaces: {},
  activeSpace: "work",
  hud: { l: ["app:brain"], r: ["pulse"] },
  brain: { layout: "rings" },
};

let preferencesAnswer: () => Promise<unknown> = () => Promise.resolve(PREFERENCES);

vi.mock("./api", async (importOriginal) => {
  const mod = await importOriginal<typeof ApiModule>();
  const answer = (url: string): Promise<unknown> => {
    if (url === "/api/settings") return Promise.resolve(structuredClone(SETTINGS));
    if (url === "/api/ui-preferences") return preferencesAnswer();
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
    if (url.startsWith("/api/connectors") || url.startsWith("/api/skills") || url.startsWith("/api/routines"))
      return Promise.resolve([]);
    if (url.startsWith("/api/runs")) return Promise.resolve([]);
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
      putUiPreferences: vi.fn((patch: object) => Promise.resolve({ ...PREFERENCES, ...patch })),
      uiPreferences: vi.fn(() => preferencesAnswer()),
    },
  };
});

// Spy on the brain state hook to see which blob each view hands it as "the server's".
vi.mock("./brain/useBrainState", async (importOriginal) => {
  const mod = await importOriginal<typeof BrainStateModule>();
  return { ...mod, useBrainState: vi.fn(mod.useBrainState) };
});
// The canvases paint with a 2D context jsdom does not have; the state plumbing is what is under test.
vi.mock("./brain/BrainCanvas", () => ({ BrainCanvas: () => null }));
vi.mock("./nucleo/scenes/BrainSceneCanvas", () => ({ BrainSceneCanvas: () => null }));

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
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.useRealTimers();
  preferencesAnswer = () => Promise.resolve(PREFERENCES);
  window.localStorage.clear();
});

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return (
    <MemoryRouter>
      <QueryClientProvider client={qc}>{children}</QueryClientProvider>
    </MemoryRouter>
  );
}

/** Every `/api/settings` write the UI made, whichever helper it went through. */
function settingsWrites(): Array<Record<string, unknown>> {
  const viaHelper = vi.mocked(api.putSettings).mock.calls.map(([patch]) => patch as Record<string, unknown>);
  const viaRaw = [api.put, api.post, api.patch]
    .flatMap((fn) => vi.mocked(fn).mock.calls)
    .filter(([url]) => String(url).startsWith("/api/settings"))
    .map(([, body]) => (body ?? {}) as Record<string, unknown>);
  return [...viaHelper, ...viaRaw];
}

/** The `serverBlob` the last render handed to the brain state hook. */
function lastServerBlob(): unknown {
  const calls = vi.mocked(useBrainState).mock.calls;
  return calls[calls.length - 1]?.[0].serverBlob;
}

describe("S3 the UI reads and writes preferences through their route", () => {
  it("C23 setup completion saves the preset and the HUD as UI preferences", async () => {
    render(<Setup onDone={() => undefined} />, { wrapper });
    const next = async () => fireEvent.click(await screen.findByRole("button", { name: "Next" }));
    for (let i = 0; i < 4; i++) await next();
    fireEvent.click(await screen.findByRole("button", { name: /JARVIS/ }));
    fireEvent.click(await screen.findByRole("button", { name: "Finish setup" }));

    await waitFor(() => expect(api.putUiPreferences).toHaveBeenCalledTimes(1));
    const prefs = vi.mocked(api.putUiPreferences).mock.calls[0]![0];
    expect(prefs.themePreset).toBe("jarvis");
    expect(prefs.hud?.l.length).toBeGreaterThan(0);
    const writes = settingsWrites();
    expect(writes).toHaveLength(1);
    expect(writes[0]).toMatchObject({ setupCompleted: true, systemName: "MordomoOS" });
    for (const key of MOVED) expect(writes[0], key).not.toHaveProperty(key);
  });

  it("C24 the brain state saves its view to the UI preferences", async () => {
    vi.useFakeTimers();
    const src: BrainStateSources = {
      graph: null,
      skills: [],
      routines: [],
      connectors: [],
      ringLabels: { skills: "s", memory: "m", routines: "r", apps: "a" },
      timeline: null,
      serverBlob: { layout: "rings" },
      dirty: () => undefined,
    };
    const { result } = renderHook(() => useBrainState(src), { wrapper });
    // The blob it is handed wins over the local default.
    expect(result.current.ui.layout).toBe("rings");
    act(() => result.current.persist({ ...DEFAULT_SETTINGS, layout: "hex" }, true));
    act(() => void vi.advanceTimersByTime(1000));
    expect(api.putUiPreferences).toHaveBeenCalledTimes(1);
    expect(vi.mocked(api.putUiPreferences).mock.calls[0]![0].brain?.layout).toBe("hex");
    expect(settingsWrites()).toEqual([]);
  });

  it("C25 the Second Brain reads its saved view from the UI preferences", async () => {
    render(<SecondBrain />, { wrapper });
    await waitFor(() => expect(lastServerBlob()).toEqual(PREFERENCES.brain));
    expect(api.get).toHaveBeenCalledWith("/api/ui-preferences", expect.anything());
  });

  it("C26 the brain scene reads its saved view from the UI preferences", async () => {
    render(<BrainScene onMetaChanged={() => undefined} />, { wrapper });
    await waitFor(() => expect(lastServerBlob()).toEqual(PREFERENCES.brain));
    expect(api.get).toHaveBeenCalledWith("/api/ui-preferences", expect.anything());
  });

  it("C27 the theme tab marks the preset saved in the UI preferences", async () => {
    render(<ThemeTab s={SETTINGS as never} put={() => Promise.resolve({ ok: true })} />, { wrapper });
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /JARVIS/ }).getAttribute("aria-pressed")).toBe("true"),
    );
    expect(screen.getByRole("button", { name: /Forest/ }).getAttribute("aria-pressed")).toBe("false");
  });

  it("C28 the desktop tab waits, fails and lists from the UI preferences", async () => {
    preferencesAnswer = () => new Promise(() => undefined);
    const { container, unmount } = render(
      <DesktopTab s={SETTINGS as never} put={() => Promise.resolve({ ok: true })} />,
      { wrapper },
    );
    expect(container.querySelector(".skeleton")).not.toBeNull();
    unmount();

    preferencesAnswer = () => Promise.reject(new Error("preferences unavailable"));
    render(<DesktopTab s={SETTINGS as never} put={() => Promise.resolve({ ok: true })} />, { wrapper });
    expect(await screen.findByText(/preferences unavailable/)).toBeTruthy();
    cleanup();

    preferencesAnswer = () => Promise.resolve(PREFERENCES);
    render(<DesktopTab s={SETTINGS as never} put={() => Promise.resolve({ ok: true })} />, { wrapper });
    expect(await screen.findByDisplayValue("Pixel")).toBeTruthy();
    expect(screen.queryByDisplayValue("Old app")).toBeNull();
  });
});
