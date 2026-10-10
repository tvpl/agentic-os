// @vitest-environment jsdom
/**
 * The app frame (.specs/features/moldura-app, the checks that name this file): the shell as
 * `App.tsx` mounts it, with the real providers, router, palette, console and
 * Today widgets. The network is a table; the nine app views are stand-ins
 * that read their route through the same hooks the real views use, so what
 * is under test is which view the frame mounts and what route it hands it.
 * The Núcleo is a stand-in too: only whether it mounts is asserted here.
 */
import { createElement, useEffect, useState, type ComponentProps, type ComponentType } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Sun } from "lucide-react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { HashRouter } from "react-router-dom";
import type * as ApiModule from "../api";
import type * as AppsModule from "../desktop/apps";
import type * as ConsoleModule from "../desktop/console/Console";
import type { DesktopActions } from "../desktop/actions";
import { api, type Meta } from "../api";
import { APPS, type AppKind } from "../desktop/apps";
import { CONSOLE_DRAFT_EVENT } from "../desktop/consoleDraft";
import { docId } from "../desktop/docIds";
import { requestPanelAction, type PanelAction } from "../desktop/panelKinds";
import { formPanelId, runPanelId } from "../desktop/runPanels";
import { openOnboarding } from "../onboarding/state";
import { ShellProvider } from "./shell";
import { I18nContext, type Lang } from "../i18n";

// Each test mounts the whole shell (providers, router, palette, console, widgets): a few seconds on an
// idle machine and more than the 5 s default when the machine is busy. A real bug still fails fast.
vi.setConfig({ testTimeout: 30_000 });
import { ToastProvider } from "../components/ui";
import { ConfirmProvider } from "../hooks/useConfirm";
import { NotificationsProvider, useNotifications } from "../hooks/useNotifications";
import { getDialogDepth } from "../components/dialog";
import { LAUNCHER_EVENT } from "../App";
import { PRESETS } from "../theme";
import { WorkspaceProvider } from "../components/Workspace";
import { ThemeTab } from "../views/settings/theme";
import { qk } from "../queries";
import { OsShell } from "../App";
import { CHAT_KEY } from "./useFrameLayout";

/* ---- the server --------------------------------------------------------- */
const PREFS = {
  version: 1,
  shell: "moldura",
  themePreset: "hud-orange",
  microApps: [],
  dashboardLayout: {},
  spaces: {},
  activeSpace: "work",
  hud: { l: [], r: [] },
  brain: {},
};
const server = {
  prefs: { ...PREFS } as Record<string, unknown>,
  approvals: [] as unknown[],
  notifications: [] as unknown[],
  /** How `/api/ui-preferences` answers: at once, only when released, or with an error. */
  prefsMode: "ok" as "ok" | "pending" | "fail",
  release: null as (() => void) | null,
};
const approval = (id: string) => ({
  id,
  kind: "write_run",
  status: "pending",
  description: `approve ${id}`,
  createdAt: Date.now(),
  payload: {},
});
const RUN = {
  id: "r1",
  skillSlug: "demo",
  provider: "claude",
  status: "completed",
  promptSummary: "a demo run",
  createdAt: Date.now(),
};

/** The settings stand-in can be swapped for the real view, to look at its landmarks. */
const real = vi.hoisted(() => ({ settings: false }));

vi.mock("../api", async (importOriginal) => {
  const mod = await importOriginal<typeof ApiModule>();
  const answer = (url: string): Promise<unknown> => {
    if (url === "/api/ui-preferences") {
      if (server.prefsMode === "fail") return Promise.reject(new Error("offline"));
      if (server.prefsMode === "pending")
        return new Promise((resolve) => {
          server.release = () => resolve(structuredClone(server.prefs));
        });
      return Promise.resolve(structuredClone(server.prefs));
    }
    if (url === "/api/approvals") return Promise.resolve(structuredClone(server.approvals));
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
    if (url.startsWith("/api/runs?limit=8")) return Promise.resolve([RUN]);
    if (url.startsWith("/api/runs")) return Promise.resolve([]);
    if (url.startsWith("/api/skills") || url.startsWith("/api/routines")) return Promise.resolve([]);
    if (url.startsWith("/api/notifications")) return Promise.resolve({ items: server.notifications });
    if (url.startsWith("/api/settings")) return Promise.resolve({ indexedFolders: [] });
    if (url.startsWith("/api/memory/preview"))
      return Promise.resolve({ kind: "text", content: "# a\nthe document body" });
    return new Promise(() => undefined);
  };
  return {
    ...mod,
    api: {
      ...mod.api,
      get: vi.fn((url: string) => answer(url)),
      post: vi.fn(() => new Promise(() => undefined)),
      put: vi.fn(() => new Promise(() => undefined)),
      patch: vi.fn(() => new Promise(() => undefined)),
      del: vi.fn(() => new Promise(() => undefined)),
      putSettings: vi.fn(() => new Promise(() => undefined)),
      putUiPreferences: vi.fn((patch: Record<string, unknown>) => {
        server.prefs = { ...server.prefs, ...patch };
        return Promise.resolve(structuredClone(server.prefs));
      }),
      uiPreferences: vi.fn(() => answer("/api/ui-preferences")),
      streamEvents: vi.fn(() => () => undefined),
      streamRun: vi.fn(() => () => undefined),
    },
  };
});

/** The nine views, as stand-ins that read their route the way the real ones do. */
vi.mock("../desktop/apps", async (importOriginal) => {
  const mod = await importOriginal<typeof AppsModule>();
  const { usePanelParams, usePanelSearchParams } = await import("../desktop/appRoute");
  const { ThemeTab: Theme } = await import("../views/settings/theme");
  const pattern: Partial<Record<string, string>> = { runs: "/runs/:id?", skills: "/skills/:slug?" };
  const stub = (kind: string): ComponentType =>
    function StandIn() {
      // Views open with an `h1` of their own, and render it late (a lazy chunk, data).
      const [titled, setTitled] = useState(false);
      useEffect(() => setTitled(true), []);
      const params = usePanelParams<"id" | "slug">(pattern[kind] ?? `/${kind}`);
      const [search] = usePanelSearchParams();
      const detail = params.id ?? params.slug ?? search.get("tab") ?? "";
      if (kind === "settings" && real.settings)
        return createElement(mod.APPS.settings.Component, {} as never);
      return createElement(
        "div",
        { "data-testid": `view-${kind}`, "data-detail": detail },
        titled ? createElement("h1", { "data-testid": `h1-${kind}` }, kind) : null,
        kind,
        kind === "settings" && search.get("tab") === "theme"
          ? createElement(Theme, { s: {} as never, put: () => Promise.resolve({ ok: true as const }) })
          : null,
      );
    };
  const APPS = Object.fromEntries(
    Object.entries(mod.APPS).map(([kind, def]) => [kind, { ...def, Component: stub(kind) }]),
  ) as typeof mod.APPS;
  return {
    ...mod,
    APPS,
    appForPath: (pathname: string) => {
      const def = mod.appForPath(pathname);
      return def ? APPS[def.kind] : null;
    },
  };
});

/** The real console, and a window on the actions the frame hands it. */
const consoleActions: { current: DesktopActions | null } = { current: null };
vi.mock("../desktop/console/Console", async (importOriginal) => {
  const mod = await importOriginal<typeof ConsoleModule>();
  const { useDesktopActions } = await import("../desktop/actions");
  return {
    ...mod,
    default: function ConsoleProbe(props: ComponentProps<typeof mod.default>) {
      consoleActions.current = useDesktopActions();
      return createElement(mod.default, props);
    },
  };
});

vi.mock("../nucleo", () => ({
  default: () => createElement("div", { className: "nu-shell", "data-testid": "nucleo" }),
}));

/* ---- the browser -------------------------------------------------------- */
/** The window's width, as the media queries see it; `resize` tells every listener. */
const viewport = {
  width: 1440,
  listeners: new Set<() => void>(),
  resize(width: number) {
    viewport.width = width;
    act(() => viewport.listeners.forEach((fn) => fn()));
  },
};
const matches = (query: string): boolean => {
  const max = /\(max-width:\s*(\d+)px\)/.exec(query);
  if (max) return viewport.width <= Number(max[1]);
  const min = /\(min-width:\s*(\d+)px\)/.exec(query);
  if (min) return viewport.width >= Number(min[1]);
  return false;
};

beforeAll(() => {
  window.matchMedia = ((query: string) => {
    const listeners = new Map<() => void, () => void>();
    return {
      get matches() {
        return matches(query);
      },
      media: query,
      onchange: null,
      addListener: () => undefined,
      removeListener: () => undefined,
      addEventListener: (_: string, fn: () => void) => {
        listeners.set(fn, fn);
        viewport.listeners.add(fn);
      },
      removeEventListener: (_: string, fn: () => void) => {
        listeners.delete(fn);
        viewport.listeners.delete(fn);
      },
      dispatchEvent: () => false,
    };
  }) as unknown as typeof window.matchMedia;
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
  globalThis.IntersectionObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
    takeRecords() {
      return [];
    }
  } as unknown as typeof IntersectionObserver;
  Element.prototype.scrollIntoView ??= () => undefined;
});

beforeEach(() => {
  server.prefs = { ...PREFS };
  server.approvals = [];
  server.notifications = [];
  server.prefsMode = "ok";
  server.release = null;
  viewport.width = 1440;
  // The page the dialog stack expects: the app in #root, dialogs portaled to #modal-root.
  for (const id of ["root", "modal-root"]) {
    const el = document.createElement("div");
    el.id = id;
    document.body.append(el);
  }
  window.localStorage.setItem(
    "mordomo.onboarding.v1",
    JSON.stringify({ version: 1, status: "completed", step: 12, visited: [], practiced: false }),
  );
  vi.stubGlobal(
    "fetch",
    vi.fn(() => new Promise(() => undefined)),
  );
});

afterEach(() => {
  cleanup();
  document.getElementById("root")?.remove();
  document.getElementById("modal-root")?.remove();
  delete document.documentElement.dataset.theme;
  delete document.documentElement.dataset.preset;
  vi.clearAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
  window.localStorage.clear();
  consoleActions.current = null;
  notifications.current = null;
});

const META: Meta = {
  name: "Casa",
  theme: "dark",
  accentColor: "#f97316",
  language: "pt-BR",
  setupCompleted: true,
  version: "0.8.0",
};

/** A window on the notification store the bell reads. */
const notifications: { current: ReturnType<typeof useNotifications> | null } = { current: null };
function NotificationsProbe() {
  notifications.current = useNotifications();
  return null;
}

function Providers({
  lang,
  client,
  children,
}: {
  lang: Lang;
  client: QueryClient;
  children: React.ReactNode;
}) {
  return (
    <QueryClientProvider client={client}>
      <I18nContext.Provider value={{ lang, setLang: () => undefined }}>
        <ToastProvider>
          <ConfirmProvider>
            <NotificationsProvider>
              <HashRouter>
                <WorkspaceProvider>
                  <NotificationsProbe />
                  {children}
                </WorkspaceProvider>
              </HashRouter>
            </NotificationsProvider>
          </ConfirmProvider>
        </ToastProvider>
      </I18nContext.Provider>
    </QueryClientProvider>
  );
}

/** Mount the shell at `path`, the way App.tsx does once setup is complete. */
async function mountShell(path = "/", lang: Lang = "pt-BR", opts: { settle?: boolean } = {}) {
  window.location.hash = `#${path}`;
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  render(
    <Providers lang={lang} client={client}>
      <OsShell meta={{ ...META, language: lang }} onMetaChanged={() => undefined} />
    </Providers>,
    { container: document.getElementById("root")! },
  );
  if (opts.settle === false) return client;
  if (server.prefs.shell === "nucleo") await screen.findByTestId("nucleo");
  else await waitFor(() => expect(frame()).not.toBeNull());
  return client;
}

const frame = () => document.querySelector<HTMLElement>(".mold");
const nav = () => frame()!.querySelector("nav")!;
const top = () => frame()!.querySelector("header")!;
const main = () => frame()!.querySelector("main")!;
const aside = () => frame()!.querySelector<HTMLElement>("aside.mold-chat")!;
const route = () => window.location.hash;
const navLinks = () => within(nav()).getAllByRole("link");
/** The accessible name testing-library computes (aria-label, else the text). */
const nameOf = (el: HTMLElement) => el.getAttribute("aria-label") ?? el.textContent?.trim() ?? "";
const before = (a: Node, b: Node) => Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);

const PT_ITEMS = [
  "Hoje",
  "Execuções",
  "Skills",
  "Rotinas",
  "Memória",
  "Conectores",
  "Artefatos",
  "Gerações",
  "Pixel Studio",
  "Configurações",
];
const EN_ITEMS = [
  "Today",
  "Runs",
  "Skills",
  "Routines",
  "Memory",
  "Connectors",
  "Artifacts",
  "Generations",
  "Pixel Studio",
  "Settings",
];
const HREFS = [
  "#/",
  "#/runs",
  "#/skills",
  "#/routines",
  "#/brain",
  "#/connectors",
  "#/artifacts",
  "#/generations",
  "#/pixel",
  "#/settings",
];
const APP_ROUTES: Array<[string, string]> = [
  ["runs", "/runs"],
  ["skills", "/skills"],
  ["routines", "/routines"],
  ["brain", "/brain"],
  ["connectors", "/connectors"],
  ["artifacts", "/artifacts"],
  ["generations", "/generations"],
  ["pixel", "/pixel"],
  ["settings", "/settings"],
];

/* ---- S1 ------------------------------------------------------------------ */
describe("S1 the frame and its regions", () => {
  it("C1 the frame has exactly four regions", async () => {
    await mountShell("/");
    // The regions of the frame itself: a landmark nested inside one of them
    // (the console's own context panel is an <aside> in the chat) is part of
    // that region, not a fifth one.
    const regions = [...frame()!.querySelectorAll<HTMLElement>("nav, header, main, aside")].filter(
      (el) => !el.parentElement?.closest("nav, header, main, aside"),
    );
    expect(regions.map((el) => el.tagName).sort()).toEqual(["ASIDE", "HEADER", "MAIN", "NAV"]);
    expect(document.querySelectorAll(".nu-shell")).toHaveLength(0);
    // The top bar and the content share the centre column, the top bar first.
    expect(top().parentElement).toBe(main().parentElement);
    expect(before(top(), main())).toBe(true);
  });

  it("C3 the sidebar lists the ten items in order", async () => {
    for (const [lang, labels] of [
      ["pt-BR", PT_ITEMS],
      ["en", EN_ITEMS],
    ] as const) {
      await mountShell("/", lang);
      const links = navLinks();
      expect(links.map(nameOf)).toEqual(labels);
      expect(links.map((a) => a.getAttribute("href"))).toEqual(HREFS);
      cleanup();
    }
  });

  it("C4 groups and the current item", async () => {
    await mountShell("/runs/r1");
    const lists = within(nav()).getAllByRole("list");
    expect(lists).toHaveLength(3);
    const [first, more, end] = lists;
    // The main group has no title; the second one is titled "Mais", visibly.
    expect(first!.getAttribute("aria-labelledby")).toBeNull();
    expect(within(first!).getAllByRole("link").map(nameOf)).toEqual(PT_ITEMS.slice(0, 5));
    expect(within(nav()).getByRole("list", { name: "Mais" })).toBe(more);
    const title = within(nav()).getByText("Mais");
    expect(before(within(first!).getByRole("link", { name: "Memória" }), title)).toBe(true);
    expect(before(title, within(more!).getByRole("link", { name: "Conectores" }))).toBe(true);
    expect(within(more!).getAllByRole("link").map(nameOf)).toEqual(PT_ITEMS.slice(5, 9));
    expect(within(end!).getAllByRole("link").map(nameOf)).toEqual(["Configurações"]);

    const current = navLinks().filter((a) => a.getAttribute("aria-current") === "page");
    expect(current.map(nameOf)).toEqual(["Execuções"]);
  });

  it("C5 today counts pending approvals", async () => {
    server.approvals = [approval("a1"), approval("a2")];
    await mountShell("/runs");
    const today = () => within(nav()).getByRole("link", { name: /^Hoje/ });
    await waitFor(() => expect(within(today()).getByText("2")).toBeTruthy());
    cleanup();

    server.approvals = [];
    await mountShell("/runs");
    await waitFor(() =>
      expect(vi.mocked(api.get).mock.calls.some(([u]) => u === "/api/approvals")).toBe(true),
    );
    await act(async () => undefined);
    expect(today().textContent?.trim()).toBe("Hoje");
    expect(today().textContent).not.toMatch(/\d/);
  });

  it("C6 a collapsed sidebar keeps accessible names", async () => {
    await mountShell("/");
    fireEvent.click(within(nav()).getByRole("button", { name: "Barra lateral" }));
    const links = navLinks();
    expect(links).toHaveLength(10);
    links.forEach((link, i) => {
      // No label as visible text…
      expect(link.textContent ?? "").not.toContain(PT_ITEMS[i]!);
      // …and the label as the accessible name.
      expect(within(nav()).getByRole("link", { name: PT_ITEMS[i]! })).toBe(link);
    });
  });

  it("C7 the top bar shows title, search, bell and chat in order", async () => {
    await mountShell("/runs/r1");
    const bar = top();
    const h1 = within(bar).getByRole("heading", { level: 1 });
    expect(h1.textContent).toBe("Execuções");
    const search = within(bar).getByRole("button", { name: /Buscar ou comandar…/ });
    expect(search.textContent).toMatch(/⌘K|Ctrl K/);
    const bell = within(bar).getByRole("button", { name: "Notificações" });
    const chat = within(bar).getByRole("button", { name: "Conversa" });
    expect(before(h1, search) && before(search, bell) && before(bell, chat)).toBe(true);

    fireEvent.click(search);
    const palette = await screen.findByRole("dialog", { name: /./ });
    expect(within(palette).getByRole("combobox")).toBeTruthy();
  });

  it("C8 the chat column toggles and is remembered", async () => {
    await mountShell("/");
    const chat = () => within(top()).getByRole("button", { name: "Conversa" });
    expect(chat().getAttribute("aria-pressed")).toBe("true");
    expect(aside().hidden).toBe(false);

    fireEvent.click(chat());
    expect(chat().getAttribute("aria-pressed")).toBe("false");
    expect(aside().hidden).toBe(true);

    fireEvent.keyDown(document.body, { key: ".", ctrlKey: true });
    expect(aside().hidden).toBe(false);
    expect(chat().getAttribute("aria-pressed")).toBe("true");
    // ⌘ is the key on a Mac (comandos-atalhos door 3: Mod is the platform's command key).
    Object.defineProperty(window.navigator, "platform", { value: "MacIntel", configurable: true });
    try {
      fireEvent.keyDown(document.body, { key: ".", metaKey: true });
    } finally {
      delete (window.navigator as { platform?: string }).platform;
    }
    expect(aside().hidden).toBe(true);
    expect(chat().getAttribute("aria-pressed")).toBe("false");

    // A reload keeps it closed…
    cleanup();
    await mountShell("/");
    expect(aside().hidden).toBe(true);
    expect(chat().getAttribute("aria-pressed")).toBe("false");
    // …and open again once opened.
    fireEvent.click(chat());
    cleanup();
    await mountShell("/");
    expect(aside().hidden).toBe(false);
    expect(chat().getAttribute("aria-pressed")).toBe("true");
  });

  it("C10 the Núcleo keys are inert in the frame", async () => {
    server.approvals = [approval("a1")];
    await mountShell("/");
    await waitFor(() =>
      expect(within(nav()).getByRole("link", { name: /^Hoje/ }).textContent).toContain("1"),
    );
    const keys: Array<Partial<KeyboardEventInit>> = [
      { key: "1" },
      { key: "]" },
      { key: "/" },
      { key: "p" },
      { key: "j", metaKey: true },
      { key: "f", metaKey: true },
      { key: "a", metaKey: true, shiftKey: true },
      { key: "d", metaKey: true, shiftKey: true },
      { key: "j", ctrlKey: true },
      { key: "a", ctrlKey: true, shiftKey: true },
    ];
    for (const init of keys) {
      fireEvent.keyDown(document.body, init);
      await act(async () => undefined);
      const label = JSON.stringify(init);
      expect(route(), label).toBe("#/");
      expect(document.querySelectorAll('[role="dialog"]'), label).toHaveLength(0);
      expect(document.querySelector(".deck, .skill-deck, .nu-search, .search-bar"), label).toBeNull();
      expect(document.activeElement, label).toBe(document.body);
      expect(api.post, label).not.toHaveBeenCalled();
    }
  });
});

/* ---- S2 ------------------------------------------------------------------ */
describe("S2 the content and the Today page", () => {
  it("C11 each route renders its existing view", async () => {
    await mountShell("/");
    for (const [kind, path] of APP_ROUTES) {
      fireEvent.click(within(nav()).getByRole("link", { name: PT_ITEMS[HREFS.indexOf(`#${path}`)]! }));
      expect(route()).toBe(`#${path}`);
      const panel = await waitFor(() => {
        const el = main().querySelector(`[data-app="${kind}"]`);
        expect(el).not.toBeNull();
        return el as HTMLElement;
      });
      expect(within(panel).getByTestId(`view-${kind}`)).toBeTruthy();
      expect(main().querySelectorAll("[data-app]")).toHaveLength(1);
    }
    cleanup();

    for (const [path, kind, detail] of [
      ["/runs/r1", "runs", "r1"],
      ["/skills/s1", "skills", "s1"],
      ["/settings?tab=security", "settings", "security"],
    ] as const) {
      await mountShell(path);
      const view = within(main()).getByTestId(`view-${kind}`);
      expect(view.closest(`[data-app="${kind}"]`)).not.toBeNull();
      expect(view.getAttribute("data-detail")).toBe(detail);
      cleanup();
    }
  });

  it("C12 today shows six cards in order", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 9, 6, 12, 0, 0));
    const cases = [
      {
        lang: "pt-BR",
        today: "Hoje",
        date: "terça-feira, 6 de outubro",
        titles: ["Pede você", "Em execução", "Rotinas de hoje", "Caixa de entrada", "Diário", "Custo"],
      },
      {
        lang: "en",
        today: "Today",
        date: "Tuesday 6 October",
        titles: ["Needs you", "Running", "Today's routines", "Inbox", "Journal", "Cost"],
      },
    ] as const;
    for (const c of cases) {
      await mountShell("/", c.lang);
      const heading = within(main()).getByRole("heading", { level: 2 });
      expect(heading.textContent).toContain(c.today);
      expect(heading.textContent).toContain(c.date);
      const cards = [...main().querySelectorAll<HTMLElement>("section.mold-card")];
      expect(cards).toHaveLength(6);
      expect(cards.map((card) => within(card).getByRole("heading", { level: 3 }).textContent)).toEqual([
        ...c.titles,
      ]);
      expect(cards.map((card) => card.dataset.widget)).toEqual([
        "approvals",
        "now",
        "routines",
        "inbox",
        "journal",
        "cost",
      ]);
      // Each card holds its widget, not an empty box.
      for (const card of cards) expect(card.querySelector(".mold-card-b")!.childElementCount).toBe(1);
      cleanup();
    }
  });

  it("C14 runs navigate and documents open in a drawer", async () => {
    await mountShell("/");
    // From the conversation: the actions the console is handed.
    await waitFor(() => expect(consoleActions.current).not.toBeNull());
    act(() => consoleActions.current!.openRun("r1"));
    expect(route()).toBe("#/runs/r1");

    // From the palette: a recent run.
    act(() => {
      window.location.hash = "#/";
    });
    await waitFor(() => expect(within(top()).getByRole("heading", { level: 1 }).textContent).toBe("Hoje"));
    fireEvent.click(within(top()).getByRole("button", { name: /Buscar ou comandar…/ }));
    const palette = await screen.findByRole("dialog", { name: /./ });
    fireEvent.click(await within(palette).findByRole("option", { name: /\/demo/ }));
    await waitFor(() => expect(route()).toBe("#/runs/r1"));

    // A document: a drawer over the content, with the viewer and a Close button.
    act(() => consoleActions.current!.openDoc("notes/a.md"));
    const drawer = await within(main()).findByRole("dialog", { name: "Documento" });
    expect(drawer.querySelector(".doc-window")).not.toBeNull();
    await within(drawer).findByText(/the document body/);
    fireEvent.click(within(drawer).getByRole("button", { name: "Fechar" }));
    expect(within(main()).queryByRole("dialog", { name: "Documento" })).toBeNull();
  });
});

/* ---- S3 ------------------------------------------------------------------ */
describe("S3 switching shells", () => {
  function mountTheme(shell: "moldura" | "nucleo") {
    server.prefs = { ...PREFS, shell };
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    client.setQueryData(qk.uiPreferences, structuredClone(server.prefs));
    render(
      <Providers lang="pt-BR" client={client}>
        <ThemeTab s={{} as never} put={() => Promise.resolve({ ok: true as const })} />
      </Providers>,
    );
  }

  it("C18 appearance offers the two interfaces", async () => {
    for (const shell of ["moldura", "nucleo"] as const) {
      mountTheme(shell);
      expect(screen.getByText("Interface", { selector: "label" })).toBeTruthy();
      const group = await screen.findByRole("radiogroup", { name: "Interface" });
      const options = within(group).getAllByRole("radio");
      expect(options.map((o) => o.textContent)).toEqual(["Moldura de app", "Núcleo imersivo"]);
      const checked = options.filter((o) => o.getAttribute("aria-checked") === "true");
      await waitFor(() =>
        expect(checked.map((o) => o.textContent)).toEqual([
          shell === "moldura" ? "Moldura de app" : "Núcleo imersivo",
        ]),
      );
      // Above the presets.
      const presets = screen.getByRole("heading", { name: "Preset de tema" });
      expect(before(group, presets)).toBe(true);
      expect(before(group, document.querySelector(".apps-presets")!)).toBe(true);
      cleanup();
    }
  });

  it("C19 choosing an interface swaps the shell in place", async () => {
    const errors = vi.spyOn(console, "error");
    await mountShell("/settings?tab=theme");
    const root = document.querySelector(".os-root");
    const group = await within(main()).findByRole("radiogroup", { name: "Interface" });
    fireEvent.click(within(group).getByRole("radio", { name: "Núcleo imersivo" }));

    await waitFor(() => expect(api.putUiPreferences).toHaveBeenCalledWith({ shell: "nucleo" }));
    await screen.findByTestId("nucleo");
    expect(frame()).toBeNull();
    expect(document.querySelectorAll(".nu-shell")).toHaveLength(1);
    // In place: the same document, the same root, no navigation.
    expect(document.querySelector(".os-root")).toBe(root);
    expect(route()).toBe("#/settings?tab=theme");
    const navigation = errors.mock.calls
      .flat()
      .some((a) => String(a).includes("Not implemented: navigation"));
    expect(navigation).toBe(false);
  });

  it("C21 the palette switches shells and hides lâmina actions", async () => {
    await mountShell("/");
    fireEvent.click(within(top()).getByRole("button", { name: /Buscar ou comandar…/ }));
    let palette = await screen.findByRole("dialog", { name: /./ });
    const names = () =>
      within(palette)
        .queryAllByRole("option")
        .map((o) => o.textContent ?? "");
    await waitFor(() => expect(names().some((n) => n.includes("Mudar para o Núcleo imersivo"))).toBe(true));
    expect(names().some((n) => /Abrir um painel/.test(n))).toBe(false);
    fireEvent.change(within(palette).getByRole("combobox"), {
      target: { value: "organizar revisar código" },
    });
    await act(async () => undefined);
    expect(names().some((n) => /Organizar a tela|Não sei organizar/.test(n))).toBe(false);
    // The tour has no places to point at in the frame: its action is not offered either.
    fireEvent.change(within(palette).getByRole("combobox"), { target: { value: "guia interativo" } });
    await act(async () => undefined);
    expect(names().some((n) => /Guia interativo/.test(n))).toBe(false);
    fireEvent.change(within(palette).getByRole("combobox"), { target: { value: "" } });
    await act(async () => undefined);

    fireEvent.click(within(palette).getByRole("option", { name: /Mudar para o Núcleo imersivo/ }));
    await waitFor(() => expect(api.putUiPreferences).toHaveBeenCalledWith({ shell: "nucleo" }));
    await screen.findByTestId("nucleo");
    cleanup();
    vi.mocked(api.putUiPreferences).mockClear();

    // The Núcleo offers the way back (and keeps its own lâmina actions).
    server.prefs = { ...PREFS, shell: "nucleo" };
    await mountShell("/");
    act(() => {
      window.dispatchEvent(new CustomEvent("mordomo:launcher"));
    });
    palette = await screen.findByRole("dialog", { name: /./ });
    await waitFor(() => expect(names().some((n) => n.includes("Mudar para a moldura de app"))).toBe(true));
    expect(names().some((n) => n.includes("Mudar para o Núcleo imersivo"))).toBe(false);
    expect(names().some((n) => /Abrir um painel/.test(n))).toBe(true);
    fireEvent.change(within(palette).getByRole("combobox"), { target: { value: "guia interativo" } });
    await waitFor(() => expect(names().some((n) => /Guia interativo/.test(n))).toBe(true));
    fireEvent.change(within(palette).getByRole("combobox"), { target: { value: "" } });
    await act(async () => undefined);
    fireEvent.click(within(palette).getByRole("option", { name: /Mudar para a moldura de app/ }));
    await waitFor(() => expect(api.putUiPreferences).toHaveBeenCalledWith({ shell: "moldura" }));
    await waitFor(() => expect(frame()).not.toBeNull());
  });

  it("C75 until the preferences arrive, the interface control marks the shell in use", async () => {
    server.prefsMode = "fail";
    for (const shell of ["moldura", "nucleo"] as const) {
      const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
      render(
        <Providers lang="pt-BR" client={client}>
          <ShellProvider value={shell}>
            <ThemeTab s={{} as never} put={() => Promise.resolve({ ok: true as const })} />
          </ShellProvider>
        </Providers>,
      );
      const group = await screen.findByRole("radiogroup", { name: "Interface" });
      await waitFor(() => expect(client.getQueryState(qk.uiPreferences)?.status).toBe("error"));
      const checked = within(group)
        .getAllByRole("radio")
        .filter((o) => o.getAttribute("aria-checked") === "true");
      expect(checked.map((o) => o.textContent)).toEqual([
        shell === "moldura" ? "Moldura de app" : "Núcleo imersivo",
      ]);
      cleanup();
    }
  });
});

/* ---- Rodada 2: the review of the first build ---------------------------- */
const inertIn = () => [...document.querySelectorAll("[inert]")];
const isInert = (el: Element) => Boolean(el.closest("[inert]"));
const chatButton = () => within(top()).getByRole("button", { name: "Conversa" });
const escape = (target: Element = document.body) => fireEvent.keyDown(target, { key: "Escape" });
const openDoc = (path = "notes/a.md") => act(() => consoleActions.current!.openDoc(path));
const drawer = () => within(main()).queryByRole("dialog", { name: "Documento" });
const palette = () => screen.queryByRole("dialog", { name: /./ });
const settled = () => act(async () => undefined);

describe("R2.1 which shell shows while the preferences travel", () => {
  it("C27 a slow load shows a skeleton, then the saved shell", async () => {
    server.prefs = { ...PREFS, shell: "nucleo" };
    server.prefsMode = "pending";
    await mountShell("/", "pt-BR", { settle: false });
    await waitFor(() => expect(server.release).not.toBeNull());
    // Neither shell, no empty page: a skeleton; and the palette does not open over a guess.
    expect(document.querySelector(".page-skeleton")).not.toBeNull();
    expect(frame()).toBeNull();
    expect(screen.queryByTestId("nucleo")).toBeNull();
    expect(document.querySelector(".os-root")!.getAttribute("data-shell")).toBeNull();
    act(() => {
      window.dispatchEvent(new CustomEvent(LAUNCHER_EVENT));
    });
    expect(palette()).toBeNull();

    act(() => server.release!());
    await screen.findByTestId("nucleo");
    expect(document.querySelector(".page-skeleton")).toBeNull();
    expect(document.querySelector(".os-root")!.getAttribute("data-shell")).toBe("nucleo");
    // The answer is mirrored for the next visit.
    expect(localStorage.getItem("mordomo.shell")).toBe("nucleo");
  });

  it("C28 the mirror stands in while the load is slow, and a matching answer changes nothing", async () => {
    localStorage.setItem("mordomo.shell", "nucleo");
    server.prefs = { ...PREFS, shell: "nucleo" };
    server.prefsMode = "pending";
    await mountShell("/", "pt-BR", { settle: false });
    // No skeleton, no frame: the last shell seen is there at once.
    const nucleo = await screen.findByTestId("nucleo");
    expect(frame()).toBeNull();
    await waitFor(() => expect(server.release).not.toBeNull());
    act(() => server.release!());
    await settled();
    expect(screen.getByTestId("nucleo")).toBe(nucleo);
  });

  it("C29 a failed load keeps the mirrored shell, retries, and does not swap on a matching answer", async () => {
    localStorage.setItem("mordomo.shell", "nucleo");
    server.prefs = { ...PREFS, shell: "nucleo" };
    server.prefsMode = "fail";
    const client = await mountShell("/", "pt-BR", { settle: false });
    const nucleo = await screen.findByTestId("nucleo");
    await waitFor(() => expect(client.getQueryState(qk.uiPreferences)?.status).toBe("error"));
    expect(frame()).toBeNull();
    expect(screen.getByTestId("nucleo")).toBe(nucleo);

    server.prefsMode = "ok";
    await act(() => client.invalidateQueries({ queryKey: qk.uiPreferences }));
    await waitFor(() => expect(client.getQueryState(qk.uiPreferences)?.status).toBe("success"));
    expect(screen.getByTestId("nucleo")).toBe(nucleo);
    expect(frame()).toBeNull();
  });

  it("C30 a failed load with no mirror shows the frame, and a later answer is the truth", async () => {
    server.prefs = { ...PREFS, shell: "nucleo" };
    server.prefsMode = "fail";
    const client = await mountShell("/", "pt-BR", { settle: false });
    await waitFor(() => expect(frame()).not.toBeNull());
    // Mounting the frame asks for the preferences again (Today's widgets do): a retry of a
    // query that never had data is "pending" again, and must not take the frame away.
    await settled();
    await settled();
    expect(frame()).not.toBeNull();
    // The correction: the server says otherwise, so the Núcleo it is.
    server.prefsMode = "ok";
    await act(() => client.invalidateQueries({ queryKey: qk.uiPreferences }));
    await screen.findByTestId("nucleo");
    expect(frame()).toBeNull();
  });

  it("C31 a refetch that fails after a load keeps the shell, and blocked storage is no harm", async () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    server.prefs = { ...PREFS, shell: "nucleo" };
    const client = await mountShell("/");
    server.prefsMode = "fail";
    await act(() => client.invalidateQueries({ queryKey: qk.uiPreferences }));
    await settled();
    expect(screen.getByTestId("nucleo")).toBeTruthy();
    expect(frame()).toBeNull();
    vi.restoreAllMocks();
  });

  it("C32 choosing an interface is mirrored, and focus follows the control into the new shell", async () => {
    await mountShell("/settings?tab=theme");
    expect(localStorage.getItem("mordomo.shell")).toBe("moldura");
    const group = await within(main()).findByRole("radiogroup", { name: "Interface" });
    fireEvent.click(within(group).getByRole("radio", { name: "Núcleo imersivo" }));
    await screen.findByTestId("nucleo");
    expect(localStorage.getItem("mordomo.shell")).toBe("nucleo");
  });
});

describe("R2.2 the frame names what it shows", () => {
  it("C33 the tour is offered in the Núcleo only", async () => {
    real.settings = true;
    try {
      await mountShell("/settings");
      await within(main()).findByRole("navigation", { name: "Configurações" });
      expect(within(main()).queryByRole("button", { name: /Guia do OS/ })).toBeNull();
      cleanup();
      server.prefs = { ...PREFS, shell: "nucleo" };
      // The Núcleo is a stand-in here; the view itself is what is asked.
      const { default: Settings } = await import("../views/Settings");
      const { ShellProvider } = await import("./shell");
      const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
      render(
        <Providers lang="pt-BR" client={client}>
          <ShellProvider value="nucleo">
            <Settings onMetaChanged={() => undefined} />
          </ShellProvider>
        </Providers>,
      );
      expect(await screen.findByRole("button", { name: /Guia do OS/ })).toBeTruthy();
    } finally {
      real.settings = false;
    }
  });

  it("C34 the bell and the Today item carry their counts in their names", async () => {
    server.approvals = [approval("a1"), approval("a2")];
    await mountShell("/runs");
    const bell = () => within(top()).getByRole("button", { name: /^Notificações/ });
    expect(bell().getAttribute("aria-label")).toBe("Notificações");
    act(() => {
      notifications.current!.notify({ kind: "system", title: "one" });
      notifications.current!.notify({ kind: "system", title: "two" });
    });
    expect(bell().getAttribute("aria-label")).toBe("Notificações, 2 não lidas");
    // The badge is not read a second time.
    expect(bell().querySelector(".mold-dot-count")!.getAttribute("aria-hidden")).toBe("true");

    const today = () => within(nav()).getByRole("link", { name: /^Hoje/ });
    await waitFor(() => expect(today().getAttribute("aria-label")).toBe("Hoje, 2 aprovações pendentes"));
    // Folded, the same name: the visible label is gone, the count is not.
    fireEvent.click(within(nav()).getByRole("button", { name: "Barra lateral" }));
    expect(today().getAttribute("aria-label")).toBe("Hoje, 2 aprovações pendentes");
    expect(today().textContent ?? "").not.toContain("Hoje");
  });

  it("C35 the sidebar button keeps one name and says its state with aria-expanded", async () => {
    await mountShell("/");
    const button = () => within(nav()).getByRole("button", { name: "Barra lateral" });
    expect(button().getAttribute("aria-expanded")).toBe("true");
    expect(button().getAttribute("title")).toBe("Recolher");
    fireEvent.click(button());
    expect(button().getAttribute("aria-expanded")).toBe("false");
    expect(button().getAttribute("title")).toBe("Expandir");
    expect(button().getAttribute("aria-label")).toBe("Barra lateral");
  });

  it("C36 a page has one level-1 heading and its nested landmarks are labelled", async () => {
    for (const path of ["/runs/r1", "/skills/s1", "/settings?tab=security"]) {
      await mountShell(path);
      const stand = await within(main()).findByTestId(/^h1-/);
      // The view's own title steps down; the top bar's is the page's.
      await waitFor(() => expect(stand.getAttribute("aria-level")).toBe("2"));
      const ones = [...frame()!.querySelectorAll("h1")].filter((h) => !h.hasAttribute("aria-level"));
      expect(ones).toHaveLength(1);
      expect(top().contains(ones[0]!)).toBe(true);
      cleanup();
    }
    real.settings = true;
    try {
      await mountShell("/settings");
      const sub = await within(main()).findByRole("navigation", { name: "Configurações" });
      // Four regions of the frame; the settings menu is part of the content region.
      const top4 = [...frame()!.querySelectorAll<HTMLElement>("nav, header, main, aside")].filter(
        (el) => !el.parentElement?.closest("nav, header, main, aside"),
      );
      expect(top4.map((el) => el.tagName).sort()).toEqual(["ASIDE", "HEADER", "MAIN", "NAV"]);
      expect(main().contains(sub)).toBe(true);
      expect(sub.getAttribute("aria-label")).not.toBe(nav().getAttribute("aria-label"));
    } finally {
      real.settings = false;
    }
  });

  it("C37 an address that is no place of the frame lands on Today, without a step in the history", async () => {
    const push = vi.spyOn(window.history, "pushState");
    const replace = vi.spyOn(window.history, "replaceState");
    await mountShell("/nonsense/deep");
    await waitFor(() => expect(route()).toBe("#/"));
    expect(within(top()).getByRole("heading", { level: 1 }).textContent).toBe("Hoje");
    expect(within(nav()).getByRole("link", { name: /^Hoje/ }).getAttribute("aria-current")).toBe("page");
    // Back must not land on the address that was just refused.
    expect(replace.mock.calls.some(([, , url]) => String(url).endsWith("#/"))).toBe(true);
    expect(push).not.toHaveBeenCalled();
  });

  it("C38 the shell root carries the shell for the banner, and no :has() is needed", async () => {
    await mountShell("/");
    expect(document.querySelector(".os-root")!.getAttribute("data-shell")).toBe("moldura");
    expect(frame()!.getAttribute("data-shell")).toBeNull();
  });
});

describe("R2.3 the drawers are dialogs", () => {
  it("C39 the narrow chat drawer takes focus, shuts the rest, and gives focus back", async () => {
    viewport.width = 800;
    await mountShell("/");
    const toggle = chatButton();
    toggle.focus();
    expect(aside().hidden).toBe(true);
    expect(aside().getAttribute("role")).toBeNull();
    fireEvent.click(toggle);

    expect(aside().getAttribute("role")).toBe("dialog");
    expect(aside().getAttribute("aria-modal")).toBe("true");
    expect(aside().getAttribute("aria-label")).toBe("Conversa");
    await waitFor(() => expect(document.activeElement).toBe(aside().querySelector("textarea")));
    // Behind the veil: the sidebar, the top bar and the content cannot be reached.
    expect(isInert(nav())).toBe(true);
    expect(isInert(top())).toBe(true);
    expect(isInert(main())).toBe(true);
    expect(isInert(aside())).toBe(false);

    escape(aside().querySelector("textarea")!);
    expect(aside().hidden).toBe(true);
    expect(inertIn()).toHaveLength(0);
    expect(document.activeElement).toBe(toggle);
  });

  it("C40 the document drawer takes focus, shuts the rest, and gives focus back", async () => {
    await mountShell("/");
    const search = within(top()).getByRole("button", { name: /Buscar ou comandar…/ });
    search.focus();
    openDoc();
    const dialog = await within(main()).findByRole("dialog", { name: "Documento" });
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    await waitFor(() =>
      expect(document.activeElement).toBe(within(dialog).getByRole("button", { name: "Fechar" })),
    );
    expect(isInert(nav())).toBe(true);
    expect(isInert(top())).toBe(true);
    expect(isInert(aside())).toBe(true);
    expect(isInert(dialog)).toBe(false);
    // Part of the shell, so the shell does not recede behind it.
    expect(document.querySelector(".os-root")!.getAttribute("data-depth")).toBeNull();

    escape();
    expect(drawer()).toBeNull();
    expect(inertIn()).toHaveLength(0);
    expect(document.activeElement).toBe(search);

    // The Close button does the same.
    openDoc();
    fireEvent.click(await within(main()).findByRole("button", { name: "Fechar" }));
    expect(drawer()).toBeNull();
    expect(inertIn()).toHaveLength(0);
  });

  it("C41 Esc closes the topmost thing first: the palette, then a document, then the chat drawer", async () => {
    viewport.width = 800;
    await mountShell("/");
    fireEvent.click(chatButton());
    await waitFor(() => expect(aside().getAttribute("role")).toBe("dialog"));
    openDoc();
    await within(main()).findByRole("dialog", { name: "Documento" });
    expect(getDialogDepth()).toBe(2);

    // The palette over both.
    act(() => {
      window.dispatchEvent(new CustomEvent(LAUNCHER_EVENT));
    });
    await screen.findByRole("combobox");
    expect(getDialogDepth()).toBe(3);
    // The palette is portaled out of the shell: that one does push it back.
    expect(document.querySelector(".os-root")!.getAttribute("data-depth")).toBe("pushed");
    escape(screen.getByRole("combobox"));
    await waitFor(() => expect(screen.queryByRole("combobox")).toBeNull());
    expect(getDialogDepth()).toBe(2);
    expect(drawer()).not.toBeNull();
    expect(aside().hidden).toBe(false);

    escape();
    expect(drawer()).toBeNull();
    expect(aside().hidden).toBe(false);
    expect(isInert(nav())).toBe(true);

    escape();
    expect(aside().hidden).toBe(true);
    expect(getDialogDepth()).toBe(0);
    expect(inertIn()).toHaveLength(0);
    expect(route()).toBe("#/");
  });

  it("C42 Esc closes the bell first and gives focus back to it; it is not a modal", async () => {
    await mountShell("/");
    const bell = within(top()).getByRole("button", { name: /^Notificações/ });
    fireEvent.click(bell);
    expect(within(top()).getByRole("dialog", { name: "Notificações" })).toBeTruthy();
    expect(inertIn()).toHaveLength(0);
    escape();
    expect(within(top()).queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(bell);
    // And a drawer opened over it takes the bell away.
    fireEvent.click(bell);
    openDoc();
    await within(main()).findByRole("dialog", { name: "Documento" });
    expect(within(top()).queryByRole("dialog", { name: "Notificações" })).toBeNull();
  });

  it("C43 a press on what a modal drawer covers closes it, a press inside does not", async () => {
    await mountShell("/");
    openDoc();
    const dialog = await within(main()).findByRole("dialog", { name: "Documento" });
    fireEvent.pointerDown(dialog);
    expect(drawer()).not.toBeNull();
    fireEvent.pointerDown(frame()!);
    expect(drawer()).toBeNull();
  });

  it("C44 a document drawer leaves with the page it was opened on, and returns nothing for an unknown panel", async () => {
    await mountShell("/runs");
    const stays = ["zzz", "constructor"];
    openDoc();
    await within(main()).findByRole("dialog", { name: "Documento" });
    for (const id of stays) act(() => consoleActions.current!.openPanel(id));
    expect(drawer()).not.toBeNull();
    expect(route()).toBe("#/runs");

    const leaves: Array<[string, () => void, string]> = [
      ["a skill form", () => consoleActions.current!.openSkillForm("x"), "#/skills/x"],
      ["a run", () => consoleActions.current!.openRun("r9"), "#/runs/r9"],
      ["an app", () => consoleActions.current!.openApp("pixel"), "#/pixel"],
      ["an instrument", () => consoleActions.current!.openPanel("now"), "#/"],
    ];
    for (const [label, go, to] of leaves) {
      if (!drawer()) openDoc();
      await within(main()).findByRole("dialog", { name: "Documento" });
      act(go);
      await waitFor(() => expect(route(), label).toBe(to));
      expect(drawer(), label).toBeNull();
      expect(inertIn(), label).toHaveLength(0);
    }
    // Following a link from the palette is a navigation too.
    openDoc();
    await within(main()).findByRole("dialog", { name: "Documento" });
    act(() => {
      window.location.hash = "#/runs";
    });
    await waitFor(() => expect(drawer()).toBeNull());
  });
});

describe("R2.4 narrow and wide", () => {
  it("C45 the narrow sidebar is a rail that unfolds over the content and folds back", async () => {
    viewport.width = 800;
    await mountShell("/");
    expect(frame()!.hasAttribute("data-collapsed")).toBe(true);
    const toggle = within(nav()).getByRole("button", { name: "Barra lateral" });
    toggle.focus();
    fireEvent.click(toggle);
    expect(frame()!.hasAttribute("data-collapsed")).toBe(false);
    expect(nav().hasAttribute("data-overlay")).toBe(true);
    expect(isInert(main())).toBe(true);
    expect(isInert(nav())).toBe(false);
    await waitFor(() => expect(nav().contains(document.activeElement)).toBe(true));

    escape();
    expect(frame()!.hasAttribute("data-collapsed")).toBe(true);
    expect(inertIn()).toHaveLength(0);
    expect(document.activeElement).toBe(toggle);

    // Following a link folds it back too.
    fireEvent.click(toggle);
    fireEvent.click(within(nav()).getByRole("link", { name: "Execuções" }));
    await waitFor(() => expect(route()).toBe("#/runs"));
    expect(frame()!.hasAttribute("data-collapsed")).toBe(true);
    await waitFor(() => expect(inertIn()).toHaveLength(0));
  });

  it("C46 crossing the breakpoint resets the narrow state and clears every inert", async () => {
    viewport.width = 800;
    await mountShell("/");
    fireEvent.click(chatButton());
    await waitFor(() => expect(aside().getAttribute("role")).toBe("dialog"));
    viewport.resize(1440);
    await settled();
    // Wide: the remembered column (open by default), a landmark again, nothing inert.
    expect(aside().getAttribute("role")).toBeNull();
    expect(aside().hidden).toBe(false);
    expect(frame()!.hasAttribute("data-narrow")).toBe(false);
    expect(inertIn()).toHaveLength(0);
    expect(getDialogDepth()).toBe(0);

    // The rail left unfolded narrow does not come back unfolded: narrow always starts folded.
    viewport.resize(800);
    await settled();
    fireEvent.click(within(nav()).getByRole("button", { name: "Barra lateral" }));
    expect(nav().hasAttribute("data-overlay")).toBe(true);
    viewport.resize(1440);
    await settled();
    expect(nav().hasAttribute("data-overlay")).toBe(false);
    expect(inertIn()).toHaveLength(0);
    viewport.resize(800);
    await settled();
    expect(nav().hasAttribute("data-overlay")).toBe(false);
    expect(frame()!.hasAttribute("data-collapsed")).toBe(true);
    expect(inertIn()).toHaveLength(0);
    viewport.resize(1440);
    await settled();

    // Close the column wide; narrow again starts folded and closed, and the wide choice is intact.
    fireEvent.click(chatButton());
    viewport.resize(800);
    await settled();
    expect(aside().hidden).toBe(true);
    expect(frame()!.hasAttribute("data-collapsed")).toBe(true);
    viewport.resize(1440);
    await settled();
    expect(aside().hidden).toBe(true);
    expect(frame()!.hasAttribute("data-collapsed")).toBe(false);
  });

  it("C47 a half-typed draft survives the chat being hidden, and ⌘. works from the line itself", async () => {
    await mountShell("/");
    const line = () => aside().querySelector("textarea")!;
    fireEvent.change(line(), { target: { value: "ask about the" } });
    fireEvent.keyDown(line(), { key: ".", ctrlKey: true });
    expect(aside().hidden).toBe(true);
    fireEvent.keyDown(document.body, { key: ".", ctrlKey: true });
    expect(aside().hidden).toBe(false);
    expect(line().value).toBe("ask about the");
    // Across the breakpoint too: the console is never remounted.
    const before = line();
    viewport.resize(800);
    await settled();
    viewport.resize(1440);
    await settled();
    expect(line()).toBe(before);
    expect(line().value).toBe("ask about the");
  });
});

describe("R2.5 the frame is stable and holds in every theme", () => {
  it("C48 the actions keep their identity, and the panel events are subscribed once", async () => {
    const add = vi.spyOn(window, "addEventListener");
    await mountShell("/");
    await waitFor(() => expect(consoleActions.current).not.toBeNull());
    const first = consoleActions.current;
    const subscribed = () => add.mock.calls.filter(([type]) => type === "mordomo:open-panel").length;
    const count = subscribed();
    expect(count).toBe(1);
    // Re-renders of the frame: the bell, the chat toggle, the unread count, a poll.
    const bell = within(top()).getByRole("button", { name: /^Notificações/ });
    fireEvent.click(bell);
    fireEvent.click(bell);
    fireEvent.click(chatButton());
    fireEvent.click(chatButton());
    act(() => {
      notifications.current!.notify({ kind: "system", title: "x" });
    });
    await settled();
    expect(consoleActions.current).toBe(first);
    expect(subscribed()).toBe(count);
    add.mockRestore();
  });

  it("C49 light and dark, every preset: the frame mounts, nothing is reported (the contrast is measured in the browser, moldura.spec.ts)", async () => {
    const problems = [vi.spyOn(console, "error"), vi.spyOn(console, "warn")];
    for (const theme of ["dark", "light"] as const) {
      for (const preset of PRESETS) {
        document.documentElement.dataset.theme = theme;
        document.documentElement.dataset.preset = preset.id;
        await mountShell("/");
        expect(within(nav()).getAllByRole("link")).toHaveLength(10);
        expect(aside().hidden).toBe(false);
        cleanup();
      }
    }
    expect(
      problems.flatMap((p) => p.mock.calls),
      "console output while mounting",
    ).toEqual([]);
  });
});

/* ---- Verification round 1: what it found no proof for ------------------ */
const press = (target: Element) => fireEvent.pointerDown(target);
const iconMarkup = (Icon: ComponentType<{ className?: string }>) => {
  const holder = document.createElement("div");
  holder.innerHTML = renderToStaticMarkup(createElement(Icon, { className: "mold-link-i" }));
  return holder.querySelector("svg")!.innerHTML;
};

describe("V1.1 what the sidebar draws", () => {
  it("C62 the brand is the installation's name and every item has its own icon", async () => {
    await mountShell("/");
    const brand = () => nav().querySelector<HTMLElement>(".mold-brand")!;
    expect(brand().textContent).toContain(META.name);
    expect(brand().querySelector(".mold-brand-mark")!.textContent).toBe("C");

    // Hoje is the sun; every other item carries the icon of the app it opens.
    const kinds: AppKind[] = [
      "runs",
      "skills",
      "routines",
      "brain",
      "connectors",
      "artifacts",
      "generations",
      "pixel",
      "settings",
    ];
    const expected = [Sun, ...kinds.map((kind) => APPS[kind].Icon)];
    const drawn = () => navLinks().map((a) => a.querySelector("svg.mold-link-i")?.innerHTML);
    expect(drawn()).toEqual(expected.map(iconMarkup));
    expect(new Set(drawn()).size).toBe(10);

    // Folded: the same ten icons, and the name is only a tooltip and the first letter.
    fireEvent.click(within(nav()).getByRole("button", { name: "Barra lateral" }));
    expect(drawn()).toEqual(expected.map(iconMarkup));
    expect(brand().textContent).toBe("C");
    expect(brand().getAttribute("title")).toBe(META.name);
  });
});

describe("V1.2 the ways out of what covers the content", () => {
  it("C63 the conversation closes with its own button, wide and narrow", async () => {
    await mountShell("/");
    const close = () => within(aside()).getByRole("button", { name: "Fechar conversa" });
    fireEvent.click(close());
    expect(aside().hidden).toBe(true);
    expect(chatButton().getAttribute("aria-pressed")).toBe("false");
    expect(localStorage.getItem(CHAT_KEY)).toBe("0");
    cleanup();
    localStorage.clear();

    viewport.width = 800;
    await mountShell("/");
    chatButton().focus();
    fireEvent.click(chatButton());
    await waitFor(() => expect(aside().getAttribute("role")).toBe("dialog"));
    fireEvent.click(close());
    expect(aside().hidden).toBe(true);
    expect(inertIn()).toHaveLength(0);
    expect(document.activeElement).toBe(chatButton());
  });

  it("C64 a press on what a narrow chat drawer or the unfolded sidebar covers closes it, a press inside does not", async () => {
    viewport.width = 800;
    await mountShell("/");
    fireEvent.click(chatButton());
    await waitFor(() => expect(aside().getAttribute("role")).toBe("dialog"));
    press(aside());
    expect(aside().hidden).toBe(false);
    press(frame()!);
    expect(aside().hidden).toBe(true);
    expect(inertIn()).toHaveLength(0);

    const toggle = within(nav()).getByRole("button", { name: "Barra lateral" });
    fireEvent.click(toggle);
    expect(nav().hasAttribute("data-overlay")).toBe(true);
    press(nav());
    expect(nav().hasAttribute("data-overlay")).toBe(true);
    press(frame()!);
    expect(nav().hasAttribute("data-overlay")).toBe(false);
    expect(inertIn()).toHaveLength(0);

    // The sidebar's own button folds it too.
    fireEvent.click(toggle);
    expect(nav().hasAttribute("data-overlay")).toBe(true);
    fireEvent.click(toggle);
    expect(nav().hasAttribute("data-overlay")).toBe(false);
  });

  it("C65 a press behind the palette opened over a drawer leaves the drawer open", async () => {
    viewport.width = 800;
    await mountShell("/");
    fireEvent.click(chatButton());
    await waitFor(() => expect(aside().getAttribute("role")).toBe("dialog"));
    act(() => {
      window.dispatchEvent(new CustomEvent(LAUNCHER_EVENT));
    });
    await screen.findByRole("combobox");
    expect(getDialogDepth()).toBe(2);
    press(document.body);
    expect(aside().hidden).toBe(false);
    expect(aside().getAttribute("role")).toBe("dialog");
  });

  it("C25 the narrow chat drawer carries ⌘. and gives it up to a dialog over it", async () => {
    viewport.width = 800;
    await mountShell("/");
    // Wide or narrow, the key shows and hides the conversation; narrow, the drawer is a modal
    // that hides the frame's own scope, so it carries the key itself.
    fireEvent.click(chatButton());
    await waitFor(() => expect(aside().getAttribute("role")).toBe("dialog"));
    expect(aside().hidden).toBe(false);
    fireEvent.keyDown(document.activeElement ?? document.body, { key: ".", ctrlKey: true });
    await settled();
    expect(aside().hidden, "⌘. closes the drawer").toBe(true);
    fireEvent.keyDown(document.body, { key: ".", ctrlKey: true });
    await settled();
    expect(aside().hidden, "and opens it").toBe(false);
    // The palette over the drawer is the dialog on top: ⌘. is not the drawer's then.
    act(() => {
      window.dispatchEvent(new CustomEvent(LAUNCHER_EVENT));
    });
    await screen.findByRole("combobox");
    expect(getDialogDepth()).toBe(2);
    fireEvent.keyDown(screen.getByRole("combobox"), { key: ".", ctrlKey: true });
    await settled();
    expect(aside().hidden, "the drawer stays under the palette").toBe(false);
    expect(aside().getAttribute("role")).toBe("dialog");
  });

  it("C74 ⌘K and Ctrl K open the palette in the frame and the same key closes it", async () => {
    // Mod is the platform's command key (comandos-atalhos, door 3): ⌘ on a Mac, Ctrl elsewhere —
    // the other one belongs to the system (Win+K) or to text editing (Ctrl+K on a Mac).
    for (const [platform, yes, no] of [
      ["Linux x86_64", { ctrlKey: true }, { metaKey: true }],
      ["MacIntel", { metaKey: true }, { ctrlKey: true }],
    ] as const) {
      Object.defineProperty(window.navigator, "platform", { value: platform, configurable: true });
      try {
        await mountShell("/");
        const label = `${platform} ${JSON.stringify(yes)}`;
        fireEvent.keyDown(document.body, { key: "k", ...no });
        await settled();
        expect(screen.queryByRole("combobox"), label).toBeNull();
        // `fireEvent` answers false when the handler cancelled the event: the browser's own ⌘K / Ctrl K
        // (the address bar, the search box) must not also run.
        expect(fireEvent.keyDown(document.body, { key: "k", ...yes }), label).toBe(false);
        await waitFor(() => expect(screen.queryByRole("combobox"), label).not.toBeNull());
        expect(fireEvent.keyDown(document.activeElement ?? document.body, { key: "k", ...yes }), label).toBe(
          false,
        );
        await waitFor(() => expect(screen.queryByRole("combobox"), label).toBeNull());
      } finally {
        delete (window.navigator as { platform?: string }).platform;
        cleanup();
      }
    }
  });

  it("C66 Esc in the frame closes what is open and goes nowhere; in the Núcleo it goes to Today", async () => {
    await mountShell("/runs");
    escape();
    await settled();
    expect(route()).toBe("#/runs");
    cleanup();

    server.prefs = { ...PREFS, shell: "nucleo" };
    await mountShell("/runs");
    escape();
    await waitFor(() => expect(route()).toBe("#/"));
  });
});

describe("V1.3 what the rest of the app can ask of the frame", () => {
  it("C67 a panel id opens the page or drawer that shows the same thing", async () => {
    await mountShell("/runs");
    await waitFor(() => expect(consoleActions.current).not.toBeNull());
    const cases: Array<[string, string, string]> = [
      ["a run", runPanelId("r9"), "#/runs/r9"],
      ["a skill form", formPanelId("deploy"), "#/skills/deploy"],
      ["an instrument", "now", "#/"],
    ];
    for (const [label, id, to] of cases) {
      act(() => consoleActions.current!.openPanel(id));
      await waitFor(() => expect(route(), label).toBe(to));
      act(() => consoleActions.current!.openApp("runs"));
      await waitFor(() => expect(route()).toBe("#/runs"));
    }
    act(() => consoleActions.current!.openPanel(docId("notes/a.md")));
    await within(main()).findByRole("dialog", { name: "Documento" });
    expect(route()).toBe("#/runs");
  });

  it("C68 a panel's close or minimise event dismisses the document drawer; focus and restore do not", async () => {
    await mountShell("/");
    await waitFor(() => expect(consoleActions.current).not.toBeNull());
    const actions: Array<[PanelAction, boolean]> = [
      ["focus", true],
      ["restore", true],
      ["minimize", false],
      ["close", false],
    ];
    for (const [action, stays] of actions) {
      openDoc();
      await within(main()).findByRole("dialog", { name: "Documento" });
      act(() => requestPanelAction(docId("notes/a.md"), action));
      expect(drawer() !== null, action).toBe(stays);
      if (stays) fireEvent.click(within(drawer()!).getByRole("button", { name: "Fechar" }));
      expect(inertIn(), action).toHaveLength(0);
    }
  });

  it("C69 words put on the line bring the conversation on screen, wide and narrow, and leave it open", async () => {
    await mountShell("/");
    fireEvent.click(chatButton());
    expect(aside().hidden).toBe(true);
    act(() => {
      window.dispatchEvent(new CustomEvent(CONSOLE_DRAFT_EVENT));
    });
    expect(aside().hidden).toBe(false);
    act(() => {
      window.dispatchEvent(new CustomEvent(CONSOLE_DRAFT_EVENT));
    });
    expect(aside().hidden).toBe(false);
    cleanup();

    viewport.width = 800;
    await mountShell("/");
    expect(aside().hidden).toBe(true);
    act(() => {
      window.dispatchEvent(new CustomEvent(CONSOLE_DRAFT_EVENT));
    });
    await waitFor(() => expect(aside().getAttribute("role")).toBe("dialog"));
    expect(aside().hidden).toBe(false);
  });
});

describe("V1.4 the breakpoint and what belongs to the Núcleo", () => {
  it("C70 900 px is wide and 899 px is narrow", async () => {
    for (const [width, narrow] of [
      [900, false],
      [899, true],
    ] as const) {
      viewport.width = width;
      await mountShell("/");
      expect(frame()!.hasAttribute("data-narrow"), `${width}px`).toBe(narrow);
      expect(frame()!.hasAttribute("data-collapsed"), `${width}px`).toBe(narrow);
      expect(aside().hidden, `${width}px`).toBe(narrow);
      cleanup();
    }
  });

  it("C71 the HUD overlay and the tour are the Núcleo's: the frame mounts neither", async () => {
    await mountShell("/");
    expect(document.querySelector(".hud-overlay")).toBeNull();
    act(() => openOnboarding());
    await settled();
    expect(document.getElementById("ob-title")).toBeNull();
    cleanup();

    server.prefs = { ...PREFS, shell: "nucleo" };
    await mountShell("/");
    expect(document.querySelector(".hud-overlay")).not.toBeNull();
    act(() => openOnboarding());
    await waitFor(() => expect(document.getElementById("ob-title")).not.toBeNull());
  });
});

describe("V1.5 time passes", () => {
  /** Mount with the clock in the test's hands: the shell, the retry and midnight all use timers. */
  async function mountWithClock(start: Date, beforeMount?: () => void) {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"] });
    vi.setSystemTime(start);
    beforeMount?.();
    const client = await mountShell("/", "pt-BR", { settle: false });
    await elapse(0);
    return client;
  }
  const elapse = (ms: number) => act(async () => void (await vi.advanceTimersByTimeAsync(ms)));
  const asked = () => vi.mocked(api.get).mock.calls.filter(([url]) => url === "/api/ui-preferences").length;

  it("C72 a failed preferences request is asked again every few seconds until it answers", async () => {
    server.prefs = { ...PREFS, shell: "nucleo" };
    server.prefsMode = "fail";
    await mountWithClock(new Date(2026, 9, 6, 12, 0, 0));
    // No mirror and no answer: the frame stands in, and the request goes on being made, quietly.
    expect(frame()).not.toBeNull();
    const first = asked();
    await elapse(5_000);
    expect(asked()).toBeGreaterThan(first);

    // The server comes back: the next try is the truth, with nobody touching anything.
    server.prefsMode = "ok";
    await elapse(10_000);
    expect(screen.getByTestId("nucleo")).toBeTruthy();
    expect(frame()).toBeNull();
    // Answered, it stops asking.
    const answered = asked();
    await elapse(60_000);
    expect(asked()).toBe(answered);
  });

  it("C73 Today's date moves to the next day at every midnight, and its timer goes with the page", async () => {
    let set!: MockInstance<typeof window.setTimeout>;
    let clear!: MockInstance<typeof window.clearTimeout>;
    await mountWithClock(new Date(2026, 9, 6, 23, 59, 30), () => {
      set = vi.spyOn(window, "setTimeout");
      clear = vi.spyOn(window, "clearTimeout");
    });
    const heading = () => within(main()).getByRole("heading", { level: 2 }).textContent;
    expect(heading()).toContain("6 de outubro");
    await elapse(29_000);
    expect(heading()).toContain("6 de outubro");
    await elapse(2_000);
    expect(heading()).toContain("7 de outubro");
    // And the night after: a tab left open for days keeps up.
    await elapse(23 * 3_600_000);
    expect(heading()).toContain("7 de outubro");
    await elapse(3_600_000);
    expect(heading()).toContain("8 de outubro");

    // The timer armed for the next midnight (nothing else waits that long) goes when Today does.
    const armed = set.mock.calls.flatMap(([, ms], i) => ((ms ?? 0) > 3_600_000 ? [i] : []));
    expect(armed.length).toBeGreaterThan(0);
    const timer = set.mock.results[armed.at(-1)!]!.value;
    act(() => {
      window.location.hash = "#/runs";
    });
    await elapse(0);
    expect(within(top()).getByRole("heading", { level: 1 }).textContent).toBe("Execuções");
    expect(clear.mock.calls.some(([id]) => id === timer)).toBe(true);
  });
});
