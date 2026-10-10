/**
 * The harness the commands tests share (.specs/features/comandos-atalhos): the
 * server as a table, the browser pieces jsdom lacks, the shell mounted the way
 * App.tsx mounts it, and the helpers that press keys and read the screens. The
 * `vi.mock` calls stay in the test files (they are hoisted there); their
 * factories live here.
 */
import { useState, type ReactNode } from "react";
import { afterEach, beforeAll, beforeEach, expect, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { HashRouter } from "react-router-dom";
import { api, type Meta } from "../api";
import { I18nContext, type Lang, dictionaries } from "../i18n";
import { ToastProvider } from "../components/ui";
import { ConfirmProvider } from "../hooks/useConfirm";
import { NotificationsProvider } from "../hooks/useNotifications";
import { WorkspaceProvider } from "../components/Workspace";
import { OsShell } from "../App";
import { qk } from "../queries";
import { comboParts, canonicalCombo } from "./keys";
import { CommandRegistry, CommandsProvider, useCommands, type Command, type CommandScope } from "./registry";

export { PREFS, PROVIDERS, RUN, SKILL, server, mockApi } from "./testserver";
import { PREFS, PROVIDERS, server } from "./testserver";

/** Register the browser shims and the per-test reset. Call once, at the top of a test file. */
export function installHarness() {
  // The shell mounts for real (lazy views included): more than the default 5 s on a busy machine.
  vi.setConfig({ testTimeout: 30_000 });
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
    globalThis.IntersectionObserver ??= class {
      observe() {}
      unobserve() {}
      disconnect() {}
      takeRecords() {
        return [];
      }
    } as unknown as typeof IntersectionObserver;
    Element.prototype.scrollIntoView ??= () => undefined;
    // A 2D context that draws nothing (the shell's canvases and Pixel Studio's grid).
    const noop = () => undefined;
    const ctx = new Proxy(
      {},
      {
        get: (_t, prop) =>
          prop === "getImageData" || prop === "createImageData"
            ? () => ({ data: new Uint8ClampedArray(4), width: 1, height: 1 })
            : prop === "measureText"
              ? () => ({ width: 0 })
              : prop === "createLinearGradient" || prop === "createRadialGradient" || prop === "createPattern"
                ? () => ({ addColorStop: noop })
                : prop === "canvas"
                  ? document.createElement("canvas")
                  : noop,
        set: () => true,
      },
    );
    HTMLCanvasElement.prototype.getContext = function (kind: string) {
      return kind === "2d" ? ctx : null;
    } as typeof HTMLCanvasElement.prototype.getContext;
  });

  beforeEach(() => {
    server.prefs = { ...PREFS };
    server.doctor = () => new Promise(() => undefined);
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
    // Calls are cleared by clearAllMocks; what a test made the server answer is not: back to the table.
    for (const fn of Object.values(api)) if (vi.isMockFunction(fn)) fn.mockReset();
    // Back to the prototype's getter (jsdom's own value).
    delete (window.navigator as { platform?: string }).platform;
    cleanup();
    vi.clearAllMocks();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    window.localStorage.clear();
    window.sessionStorage.clear();
  });
}

export const META: Meta = {
  name: "Casa",
  theme: "dark",
  accentColor: "#f97316",
  language: "en",
  setupCompleted: true,
  version: "0.8.0",
};

/** Mount the shell at `path`, the way App.tsx does once setup is complete. */
export async function mountShell(
  path: string,
  shell: "nucleo" | "moldura",
  lang: Lang = "en",
  registry = new CommandRegistry(),
) {
  server.prefs = { ...PREFS, shell };
  window.location.hash = `#${path}`;
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  // Known before any screen asks (a skill page picks its provider once, on mount).
  client.setQueryData(qk.providers, structuredClone(PROVIDERS));
  render(
    <QueryClientProvider client={client}>
      <I18nContext.Provider value={{ lang, setLang: () => undefined }}>
        <ToastProvider>
          <ConfirmProvider>
            <NotificationsProvider>
              <HashRouter>
                <WorkspaceProvider>
                  <OsShell
                    meta={{ ...META, language: lang }}
                    onMetaChanged={() => undefined}
                    registry={registry}
                  />
                </WorkspaceProvider>
              </HashRouter>
            </NotificationsProvider>
          </ConfirmProvider>
        </ToastProvider>
      </I18nContext.Provider>
    </QueryClientProvider>,
  );
  await waitFor(() =>
    expect(
      document.querySelector(shell === "nucleo" ? ".nu-shell" : '[data-shell="moldura"]'),
    ).not.toBeNull(),
  );
  return registry;
}

export const blur = () => act(() => (document.activeElement as HTMLElement | null)?.blur());

/** The shortcuts sheet as a person reads it: blocks, their titles, and each row's chips and title. */
export async function openHelp() {
  blur();
  press({ key: "?", shiftKey: true });
  const sheet = await screen.findByRole("dialog", { name: /^(Keyboard shortcuts|Atalhos de teclado)$/ });
  return [...sheet.querySelectorAll<HTMLElement>(".shortcut-group")].map((g) => ({
    scope: g.dataset.scope!,
    title: g.querySelector("h3")!.textContent,
    rows: [...g.querySelectorAll<HTMLElement>(".shortcut-row")].map((r) => ({
      id: r.dataset.command!,
      label: r.querySelector(".shortcut-label")!.textContent,
      combos: [...r.querySelectorAll(".shortcut-combo")].map((c) =>
        [...c.querySelectorAll("kbd")].map((k) => k.textContent).join("+"),
      ),
    })),
  }));
}

/**
 * What the sheet must show: every registered command with keys, by scope (the
 * layers excepted) — minus a key that a command of an inner scope also holds
 * (AC 17: it is that scope's while it is up, drawn there once).
 */
export function expectedHelp(registry: CommandRegistry, lang: Lang) {
  const rank = (scope: string) => (scope === "global" ? 0 : scope.startsWith("view:") ? 2 : 1);
  const layer = (c: Command) => c.scope === "modal" || c.scope === "overlay";
  const all = registry.list().filter((c) => !layer(c));
  const covered = (c: Command, k: string) =>
    all.some(
      (d) =>
        rank(d.scope) > rank(c.scope) && (d.keys ?? []).some((x) => canonicalCombo(x) === canonicalCombo(k)),
    );
  const shown = all
    .filter((c) => c.keys?.length)
    .map((c) => ({ c, keys: c.keys!.filter((k) => !covered(c, k)) }))
    .filter((x) => x.keys.length > 0);
  const scopes = [...new Set(shown.map((x) => x.c.scope))].sort((a, b) => rank(a) - rank(b));
  return scopes.map((scope) => ({
    scope,
    rows: shown
      .filter((x) => x.c.scope === scope)
      .map(({ c, keys }) => ({
        id: c.id,
        label: dictionaries[lang][c.title],
        combos: [...new Map(keys.map((k) => [canonicalCombo(k), k])).values()].map((k) =>
          comboParts(k).join("+"),
        ),
      })),
  }));
}

/** The palette's sections, as the ids of their options. */
export function paletteSections(): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const section of document.querySelectorAll<HTMLElement>(".palette-section")) {
    const name = section.querySelector(".launcher-section")?.textContent?.trim() ?? "";
    out[name] = [...section.querySelectorAll<HTMLElement>('[role="option"]')].map((o) =>
      o.id.replace(/^palette-list-/, ""),
    );
  }
  return out;
}

/* ---- the platform, as production reads it --------------------------------- */
export function simulatePlatform(platform: string) {
  Object.defineProperty(window.navigator, "platform", { value: platform, configurable: true });
}

/* ---- probes ----------------------------------------------------------------- */
export const cmd = (
  id: string,
  scope: CommandScope,
  keys: string[],
  run: () => void,
  extra: Partial<Command> = {},
) => ({ id, title: "common.close", group: "view", scope, keys, run, ...extra }) satisfies Command;

export function Probe({ commands }: { commands: Command[] }) {
  const [list] = useState(commands);
  useCommands(list);
  return null;
}

export function mountRegistry(children: ReactNode) {
  const registry = new CommandRegistry();
  const view = render(<CommandsProvider registry={registry}>{children}</CommandsProvider>);
  return { registry, ...view };
}

export const press = (init: KeyboardEventInit, target: Element = document.body) => {
  act(() => {
    fireEvent.keyDown(target, init);
  });
};
