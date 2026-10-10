// @vitest-environment jsdom
/**
 * Commands and shortcuts (.specs/features/comandos-atalhos, checks C1-C16).
 * S1 drives the registry and its one keydown listener through small probes;
 * the platform is simulated where production reads it (`navigator.platform`).
 */
import { useState, type ReactNode } from "react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, onTestFinished, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { HashRouter } from "react-router-dom";
import type * as ApiModule from "../api";
import { api, type Meta } from "../api";
import { I18nContext, type Lang } from "../i18n";
import { ToastProvider } from "../components/ui";
import { ConfirmProvider } from "../hooks/useConfirm";
import { NotificationsProvider } from "../hooks/useNotifications";
import { WorkspaceProvider } from "../components/Workspace";
import { OsShell } from "../App";
import { qk } from "../queries";
import { CommandPalette } from "../components/CommandPalette";
import { dictionaries } from "../i18n";
import { project } from "../nucleo/projections";
import { runPanelId } from "../desktop/runPanels";
import { comboParts, canonicalCombo } from "./keys";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import ts from "typescript";
import { CommandRegistry, CommandsProvider, useCommands, type Command, type CommandScope } from "./registry";

// The shell mounts for real (lazy views included): more than the default 5 s on a busy machine.
vi.setConfig({ testTimeout: 30_000 });

/* ---- the server: a table ------------------------------------------------------ */
const PREFS = {
  version: 1,
  shell: "nucleo",
  themePreset: "hud-orange",
  microApps: [],
  dashboardLayout: {},
  spaces: {},
  activeSpace: "work",
  hud: { l: [], r: [] },
  brain: {},
};
const SKILL = {
  slug: "demo",
  name: "Demo",
  description: "a demo skill",
  enabled: true,
  mode: "read_only",
  inputs: [],
  triggers: [],
  providers: ["claude"],
  recommendedModel: null,
  recommendedEffort: "default",
  skillFile: "demo/SKILL.md",
  body: "",
  favorite: false,
  version: "1",
  guardrails: [],
  successCriteria: [],
  resources: [],
  bodyLineCount: 0,
  thick: false,
};
const RUN = {
  id: "r1",
  createdAt: Date.now() - 60_000,
  startedAt: Date.now() - 60_000,
  finishedAt: Date.now() - 30_000,
  origin: "skill",
  provider: "claude",
  model: null,
  effort: "default",
  status: "completed",
  exitCode: 0,
  durationMs: 30_000,
  cwd: null,
  promptSummary: "a demo run",
  request: { mode: "read_only", prompt: "do the demo" },
  skillSlug: "demo",
  routineId: null,
  maxCostUsd: null,
  parentRunId: null,
  sessionId: null,
  pid: null,
  error: null,
  failure: null,
  artifacts: [],
  filesChanged: [],
  attempts: 1,
  timeoutMs: null,
  permissionProfile: null,
  usage: null,
};
const PROVIDERS = [
  {
    id: "claude",
    displayName: "Claude",
    enabled: true,
    isDefault: true,
    health: { installed: true, ok: true, authenticated: true },
  },
];
const server = { prefs: { ...PREFS } as Record<string, unknown> };

vi.mock("../api", async (importOriginal) => {
  const mod = await importOriginal<typeof ApiModule>();
  const answer = (url: string): Promise<unknown> => {
    if (url === "/api/ui-preferences") return Promise.resolve(structuredClone(server.prefs));
    if (url.startsWith("/api/providers")) return Promise.resolve(structuredClone(PROVIDERS));
    if (url === "/api/runs/r1") return Promise.resolve({ run: structuredClone(RUN), events: [] });
    if (url.startsWith("/api/runs")) return Promise.resolve([structuredClone(RUN)]);
    if (url === "/api/skills/demo") return Promise.resolve(structuredClone(SKILL));
    if (url.startsWith("/api/skills")) return Promise.resolve([structuredClone(SKILL)]);
    if (
      url.startsWith("/api/approvals") ||
      url.startsWith("/api/routines") ||
      url.startsWith("/api/connectors")
    )
      return Promise.resolve([]);
    if (url.startsWith("/api/notifications")) return Promise.resolve({ items: [] });
    if (url.startsWith("/api/settings")) return Promise.resolve({ indexedFolders: [] });
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
      putUiPreferences: vi.fn(() => new Promise(() => undefined)),
      uiPreferences: vi.fn(() => answer("/api/ui-preferences")),
      streamEvents: vi.fn(() => () => undefined),
      streamRun: vi.fn(() => () => undefined),
    },
  };
});
// The brain's canvases paint through WebGL / a 2D context jsdom does not have.
vi.mock("../brain/BrainCanvas", () => ({ BrainCanvas: () => null }));
vi.mock("../nucleo/scenes/BrainSceneCanvas", () => ({ BrainSceneCanvas: () => null }));

/* ---- the browser ---------------------------------------------------------------- */
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
  window.localStorage.setItem(
    "mordomo.onboarding.v1",
    JSON.stringify({ version: 1, status: "completed", step: 12, visited: [], practiced: false }),
  );
  vi.stubGlobal(
    "fetch",
    vi.fn(() => new Promise(() => undefined)),
  );
});

const META: Meta = {
  name: "Casa",
  theme: "dark",
  accentColor: "#f97316",
  language: "en",
  setupCompleted: true,
  version: "0.8.0",
};

/** Mount the shell at `path`, the way App.tsx does once setup is complete. */
async function mountShell(
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

const blur = () => act(() => (document.activeElement as HTMLElement | null)?.blur());

/** The shortcuts sheet as a person reads it: blocks, their titles, and each row's chips and title. */
async function openHelp() {
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

/** What the sheet must show: every registered command with keys, by scope (the layers excepted). */
function expectedHelp(registry: CommandRegistry, lang: Lang) {
  const order = (scope: string) => (scope === "global" ? 0 : scope.startsWith("view:") ? 2 : 1);
  const shown = registry.list().filter((c) => c.keys?.length && c.scope !== "modal" && c.scope !== "overlay");
  const scopes = [...new Set(shown.map((c) => c.scope))].sort((a, b) => order(a) - order(b));
  return scopes.map((scope) => ({
    scope,
    rows: shown
      .filter((c) => c.scope === scope)
      .map((c) => ({
        id: c.id,
        label: dictionaries[lang][c.title],
        combos: [...new Map(c.keys!.map((k) => [canonicalCombo(k), k])).values()].map((k) =>
          comboParts(k).join("+"),
        ),
      })),
  }));
}

/** The palette's sections, as the ids of their options. */
function paletteSections(): Record<string, string[]> {
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
function simulatePlatform(platform: string) {
  Object.defineProperty(window.navigator, "platform", { value: platform, configurable: true });
}
afterEach(() => {
  // Back to the prototype's getter (jsdom's own value).
  delete (window.navigator as { platform?: string }).platform;
  cleanup();
  vi.clearAllMocks();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  window.localStorage.clear();
  window.sessionStorage.clear();
});

/* ---- probes ----------------------------------------------------------------- */
const cmd = (
  id: string,
  scope: CommandScope,
  keys: string[],
  run: () => void,
  extra: Partial<Command> = {},
) => ({ id, title: "common.close", group: "view", scope, keys, run, ...extra }) satisfies Command;

function Probe({ commands }: { commands: Command[] }) {
  const [list] = useState(commands);
  useCommands(list);
  return null;
}

function mountRegistry(children: ReactNode) {
  const registry = new CommandRegistry();
  const view = render(<CommandsProvider registry={registry}>{children}</CommandsProvider>);
  return { registry, ...view };
}

const press = (init: KeyboardEventInit, target: Element = document.body) => {
  act(() => {
    fireEvent.keyDown(target, init);
  });
};

const SCOPES: CommandScope[] = ["global", "nucleo", "view:pixel", "overlay", "modal"];

/* ---- S1 ------------------------------------------------------------------------ */
describe("S1 the registry and the key manager", () => {
  it("C1 commands live while their owner is mounted", () => {
    const run = vi.fn();
    const command = cmd("probe:c1", "global", ["Mod+K"], run);
    function Owner() {
      const [on, setOn] = useState(true);
      return (
        <>
          <button type="button" onClick={() => setOn((v) => !v)}>
            toggle
          </button>
          {on && <Probe commands={[command]} />}
        </>
      );
    }
    const { registry, getByRole } = mountRegistry(<Owner />);
    expect(registry.list()).toEqual([command]);
    press({ key: "k", ctrlKey: true });
    expect(run).toHaveBeenCalledTimes(1);

    fireEvent.click(getByRole("button"));
    expect(registry.list()).toEqual([]);
    press({ key: "k", ctrlKey: true });
    expect(run).toHaveBeenCalledTimes(1);

    fireEvent.click(getByRole("button"));
    expect(registry.list()).toEqual([command]);
  });

  it("C2 the innermost active scope wins", () => {
    // Every non-empty set of the five scopes, each holding `x`.
    const subsets = Array.from({ length: 2 ** SCOPES.length - 1 }, (_, n) =>
      SCOPES.filter((_, i) => (n + 1) & (1 << i)),
    );
    expect(subsets).toHaveLength(31);
    for (const active of subsets) {
      const runs = Object.fromEntries(SCOPES.map((s) => [s, vi.fn()]));
      mountRegistry(active.map((s) => <Probe key={s} commands={[cmd(`probe:${s}`, s, ["x"], runs[s]!)]} />));
      press({ key: "x" });
      const innermost = active[active.length - 1]!;
      for (const s of SCOPES)
        expect(runs[s], `${active.join("+")}: ${s}`).toHaveBeenCalledTimes(s === innermost ? 1 : 0);
      cleanup();
    }
  });

  it("C3 bare keys never fire while typing", () => {
    const targets: Array<[string, () => HTMLElement]> = [
      ["input", () => document.createElement("input")],
      ["textarea", () => document.createElement("textarea")],
      ["select", () => document.createElement("select")],
      [
        "contenteditable",
        () => {
          const el = document.createElement("div");
          el.setAttribute("contenteditable", "true");
          el.tabIndex = 0;
          return el;
        },
      ],
    ];
    for (const [name, make] of targets) {
      const bare = vi.fn();
      const allowed = vi.fn();
      const modded = vi.fn();
      mountRegistry(
        <Probe
          commands={[
            cmd("probe:p", "global", ["p"], bare),
            cmd("probe:q", "global", ["Escape"], allowed, { allowInInput: true }),
            cmd("probe:k", "global", ["Mod+K"], modded),
          ]}
        />,
      );
      const el = make();
      document.body.appendChild(el);
      el.focus();
      press({ key: "p" }, el);
      press({ key: "Escape" }, el);
      press({ key: "k", ctrlKey: true }, el);
      expect(bare, name).not.toHaveBeenCalled();
      expect(allowed, name).toHaveBeenCalledTimes(1);
      expect(modded, name).toHaveBeenCalledTimes(1);
      // Out of the field the bare key is a command again.
      press({ key: "p" });
      expect(bare, name).toHaveBeenCalledTimes(1);
      el.remove();
      cleanup();
    }
  });

  it("C4 Mod is the platform's command key", () => {
    const platforms: Array<[string, string, "metaKey" | "ctrlKey", "metaKey" | "ctrlKey"]> = [
      ["Mac", "MacIntel", "metaKey", "ctrlKey"],
      ["Windows", "Win32", "ctrlKey", "metaKey"],
      ["Linux", "Linux x86_64", "ctrlKey", "metaKey"],
    ];
    for (const [name, platform, yes, no] of platforms) {
      simulatePlatform(platform);
      const run = vi.fn();
      mountRegistry(<Probe commands={[cmd("probe:k", "global", ["Mod+K"], run)]} />);
      press({ key: "k", [no]: true });
      expect(run, `${name}: ${no}+K`).not.toHaveBeenCalled();
      press({ key: "k", [yes]: true });
      expect(run, `${name}: ${yes}+K`).toHaveBeenCalledTimes(1);
      cleanup();
    }
  });

  it("C5 a duplicate key in one scope is refused", () => {
    const registry = new CommandRegistry();
    registry.register([cmd("palette.open", "global", ["Mod+K"], () => undefined)]);
    expect(() => registry.register([cmd("probe.other", "global", ["Mod+K"], () => undefined)])).toThrow(
      /palette\.open[\s\S]*probe\.other|probe\.other[\s\S]*palette\.open/,
    );
    // The same combination in another scope is a different place.
    expect(() =>
      registry.register([cmd("probe.view", "view:pixel", ["Mod+K"], () => undefined)]),
    ).not.toThrow();
    expect(() => registry.register([cmd("probe.shell", "nucleo", ["Mod+K"], () => undefined)])).not.toThrow();
    // Through the hook, the mounting component gets the error (jsdom also reports it: expected here).
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const quiet = (e: ErrorEvent) => e.preventDefault();
    window.addEventListener("error", quiet);
    onTestFinished(() => window.removeEventListener("error", quiet));
    expect(() =>
      mountRegistry(
        <>
          <Probe commands={[cmd("palette.open", "global", ["Mod+K"], () => undefined)]} />
          <Probe commands={[cmd("probe.other", "global", ["Mod+K"], () => undefined)]} />
        </>,
      ),
    ).toThrow(/palette\.open[\s\S]*probe\.other|probe\.other[\s\S]*palette\.open/);
  });
});

/* ---- S2 ------------------------------------------------------------------------ */
describe("S2 the palette and the sheet read the registry", () => {
  it("C6 a disabled command falls through and hides", async () => {
    const flag = { on: false };
    const inner = vi.fn();
    const outer = vi.fn();
    const registry = new CommandRegistry();
    registry.register([cmd("probe:outer", "global", ["x"], outer)]);
    registry.register([
      cmd("probe:when", "view:probe", ["x"], inner, {
        group: "actions",
        palette: true,
        title: "shell.action.backup",
        when: () => flag.on,
      }),
    ]);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const mountPalette = () =>
      render(
        <QueryClientProvider client={client}>
          <ToastProvider>
            <NotificationsProvider>
              <HashRouter>
                <CommandsProvider registry={registry}>
                  <CommandPalette
                    meta={META}
                    onClose={() => undefined}
                    onMetaChanged={() => undefined}
                    onShortcuts={() => undefined}
                    shell="moldura"
                  />
                </CommandsProvider>
              </HashRouter>
            </NotificationsProvider>
          </ToastProvider>
        </QueryClientProvider>,
      );

    // Off: the key goes to the scope below, and the palette does not offer it.
    render(<CommandsProvider registry={registry}>{null}</CommandsProvider>);
    press({ key: "x" });
    expect(inner).not.toHaveBeenCalled();
    expect(outer).toHaveBeenCalledTimes(1);
    cleanup();
    mountPalette();
    await screen.findByRole("combobox");
    expect(document.getElementById("palette-list-action:reindex")).toBeNull(); // only what is registered
    expect(document.getElementById("palette-list-probe:when")).toBeNull();
    cleanup();

    // On: it answers and it is listed.
    flag.on = true;
    render(<CommandsProvider registry={registry}>{null}</CommandsProvider>);
    press({ key: "x" });
    expect(inner).toHaveBeenCalledTimes(1);
    expect(outer).toHaveBeenCalledTimes(1);
    cleanup();
    mountPalette();
    await screen.findByRole("combobox");
    expect(document.getElementById("palette-list-probe:when")).not.toBeNull();
  });

  it("C7 the palette lists the registered commands with their keys", async () => {
    for (const [platform, chat, probe] of [
      ["Linux x86_64", "Ctrl .", "Ctrl K"],
      ["MacIntel", "⌘.", "⌘K"],
    ] as const) {
      simulatePlatform(platform);
      const registry = await mountShell("/", "moldura");
      fireEvent.click(screen.getByRole("button", { name: /Search or run a command/ }));
      await screen.findByRole("dialog", { name: "Command palette" });
      // A command registered while the palette is open is listed too.
      act(() => {
        registry.register([
          cmd("probe:keyed", "view:probe", ["Mod+K"], () => undefined, {
            group: "actions",
            palette: true,
            title: "shell.action.backup",
          }),
        ]);
      });
      const listed = registry.list().filter((c) => c.palette && (!c.when || c.when()));
      const sections = paletteSections();
      expect(sections.Apps, platform).toEqual(listed.filter((c) => c.group === "apps").map((c) => c.id));
      expect(sections.Actions, platform).toEqual(listed.filter((c) => c.group !== "apps").map((c) => c.id));
      // The frame's own: the conversation toggle (⌘. / Ctrl .), and nothing of the Núcleo's.
      expect(sections.Actions).toContain("moldura.chat");
      expect(sections.Actions).not.toContain("action:open-panel");
      const hint = (id: string) =>
        document.getElementById(`palette-list-${id}`)!.querySelector(".pr-keys")?.textContent;
      expect(hint("moldura.chat"), platform).toBe(chat);
      expect(hint("probe:keyed"), platform).toBe(probe);
      expect(hint("action:shortcuts"), platform).toBe("?");
      const option = document.getElementById("palette-list-moldura.chat")!;
      expect(option.getAttribute("aria-keyshortcuts"), platform).toBe(
        platform === "MacIntel" ? "Meta+." : "Control+.",
      );
      // A command without keys has no hint.
      expect(hint("action:backup"), platform).toBeUndefined();
      cleanup();
    }
  });

  it("C9 the help lists exactly the registered keys by scope", async () => {
    for (const [lang, titles] of [
      ["en", ["General", "Núcleo", "Pixel Studio"]],
      ["pt-BR", ["Geral", "Núcleo", "Pixel Studio"]],
    ] as const) {
      const registry = await mountShell("/pixel", "nucleo", lang);
      await screen.findByRole("button", { name: lang === "en" ? /Eraser/ : /Borracha/ }, { timeout: 5000 });
      const help = await openHelp();
      expect(
        help.map((b) => b.scope),
        lang,
      ).toEqual(["global", "nucleo", "view:pixel"]);
      expect(
        help.map((b) => b.title),
        lang,
      ).toEqual(titles);
      expect(
        help.map(({ scope, rows }) => ({ scope, rows })),
        lang,
      ).toEqual(expectedHelp(registry, lang));
      for (const row of help.flatMap((b) => b.rows)) expect(row.combos.length, row.id).toBeGreaterThan(0);
      cleanup();
    }
    // The frame: General, then the frame's own block.
    const registry = await mountShell("/", "moldura");
    const help = await openHelp();
    expect(help.map((b) => b.title)).toEqual(["General", "App frame"]);
    expect(help.map(({ scope, rows }) => ({ scope, rows }))).toEqual(expectedHelp(registry, "en"));
  });

  it("C10 the help follows the shell and the screen", async () => {
    const NUCLEO_KEYS = ["1", "[", "]", "P", "Ctrl+J"];
    const combos = (help: Awaited<ReturnType<typeof openHelp>>) =>
      new Set(help.flatMap((b) => b.rows.flatMap((r) => r.combos)));

    await mountShell("/", "moldura");
    let seen = combos(await openHelp());
    for (const k of NUCLEO_KEYS) expect(seen.has(k), `frame: ${k}`).toBe(false);
    cleanup();

    await mountShell("/", "nucleo");
    seen = combos(await openHelp());
    for (const k of NUCLEO_KEYS) expect(seen.has(k), `núcleo: ${k}`).toBe(true);
    cleanup();

    for (const shell of ["nucleo", "moldura"] as const) {
      await mountShell("/pixel", shell);
      await screen.findByRole("button", { name: /Eraser/ }, { timeout: 5000 });
      const help = await openHelp();
      expect(
        help.map((b) => b.title),
        shell,
      ).toContain("Pixel Studio");
      cleanup();
    }
  });

  it("C11 the scenes heading reads right in both languages", () => {
    expect(dictionaries.en["shell.shortcuts.desktop"]).toBe("Scenes");
    expect(dictionaries["pt-BR"]["shell.shortcuts.desktop"]).toBe("Cenas");
  });
});

/* ---- S3 ------------------------------------------------------------------------ */
describe("S3 the conflicts are gone", () => {
  it("C12 Pixel Studio keys stay in Pixel Studio", async () => {
    await mountShell("/pixel", "nucleo");
    const tool = (name: RegExp) => screen.getByRole("button", { name });
    await screen.findByRole("button", { name: /Eraser/ }, { timeout: 5000 });
    fireEvent.click(screen.getByRole("button", { name: /^Add$/ }));
    const frameLabel = () => screen.getByText(/Frame \d+\/\d+/).textContent;
    expect(frameLabel()).toMatch(/Frame 2\/2/);
    const stayed = (label: string) => {
      expect(window.location.hash, label).toBe("#/pixel");
      expect(document.querySelector(".nu-shell")!.getAttribute("data-scene"), label).toBe("pixel");
    };

    blur();
    press({ key: "2" });
    expect(tool(/Eraser/).getAttribute("aria-pressed")).toBe("true");
    expect(tool(/Pencil/).getAttribute("aria-pressed")).toBe("false");
    stayed("2");
    press({ key: "[" });
    expect(frameLabel()).toMatch(/Frame 1\/2/);
    stayed("[");
    press({ key: "]" });
    expect(frameLabel()).toMatch(/Frame 2\/2/);
    stayed("]");
    press({ key: "1" });
    expect(tool(/Pencil/).getAttribute("aria-pressed")).toBe("true");
    stayed("1");
  });

  it("C13 Second Brain keys stay in the Second Brain", async () => {
    window.sessionStorage.setItem("mordomo.brainScene.classic", "1");
    await mountShell("/brain", "nucleo");
    await waitFor(() => expect(document.querySelector(".bs-classic .brain2")).not.toBeNull(), {
      timeout: 5000,
    });
    const brain = () => document.querySelector<HTMLElement>(".bs-classic .brain2")!;

    blur();
    press({ key: "p" });
    expect(brain().classList.contains("presenting")).toBe(true);
    expect(document.querySelector(".nu-focus")).toBeNull();
    expect(document.querySelector(".nu-shell")!.hasAttribute("data-focus")).toBe(false);

    blur();
    press({ key: "/" });
    await waitFor(() => {
      const el = document.activeElement as HTMLElement | null;
      expect(el?.tagName).toBe("INPUT");
      expect(brain().contains(el)).toBe(true);
    });
    expect(document.activeElement?.classList.contains("cons-input")).toBe(false);
    expect(brain().classList.contains("presenting")).toBe(false);
  });

  it("C14 a run's r fires once", async () => {
    await mountShell("/runs/r1", "nucleo");
    fireEvent.click(await screen.findByRole("tab", { name: "Log" }, { timeout: 5000 }));
    act(() => project(runPanelId("r1")));
    await waitFor(() => expect(document.querySelectorAll(".run-detail")).toHaveLength(2));
    expect(document.querySelector(".nu-laminas .run-detail")).not.toBeNull();
    expect(document.querySelector('.nu-scene.on[data-scene="runs"] .run-detail')).not.toBeNull();

    blur();
    press({ key: "r" });
    const retries = () => vi.mocked(api.post).mock.calls.filter(([url]) => url === "/api/runs/r1/retry");
    await waitFor(() => expect(retries()).toHaveLength(1));
    await act(async () => undefined);
    expect(retries()).toHaveLength(1);
  });

  it("C15 Mod+Enter belongs to the open palette", async () => {
    await mountShell("/skills/demo", "moldura");
    // The skill page behind can run: its own ⌘Enter would fire if the key reached it.
    await waitFor(
      () => {
        const run = document.querySelector<HTMLButtonElement>(".apps-run-actions .btn.primary");
        expect(run?.disabled).toBe(false);
      },
      { timeout: 5000 },
    );
    fireEvent.click(screen.getByRole("button", { name: /Search or run a command/ }));
    const palette = await screen.findByRole("dialog", { name: "Command palette" });
    const input = within(palette).getByRole("combobox");
    fireEvent.change(input, { target: { value: "demo" } });
    const option = await waitFor(() => {
      const el = document.getElementById("palette-list-skill:demo");
      expect(el).not.toBeNull();
      return el!;
    });
    fireEvent.mouseEnter(option);
    expect(option.getAttribute("aria-selected")).toBe("true");
    fireEvent.keyDown(input, { key: "Enter", ctrlKey: true });
    const launches = () => vi.mocked(api.post).mock.calls.filter(([url]) => url === "/api/skills/demo/run");
    await waitFor(() => expect(launches()).toHaveLength(1));
    await act(async () => undefined);
    // The palette's secondary action (run as is), and not the skill page's ⌘Enter behind it.
    expect(launches()).toEqual([["/api/skills/demo/run", { inputs: {} }]]);
  });

  it("C16 the migrated screens own no keydown listener", () => {
    const SRC = join(__dirname, "..");
    // The six named by the check, and every file of the frame: Moldura.tsx is only a composer now,
    // its keys live in the hooks and parts split out of it.
    const frame = readdirSync(join(SRC, "moldura"))
      .filter((f) => /\.tsx?$/.test(f) && !/\.test\.tsx?$/.test(f))
      .map((f) => `moldura/${f}`);
    const MIGRATED = [
      ...new Set([
        "App.tsx",
        "nucleo/index.tsx",
        "moldura/Moldura.tsx",
        "views/PixelStudio.tsx",
        "views/SecondBrain.tsx",
        "runs/RunDetail.tsx",
        ...frame,
      ]),
    ];
    expect(MIGRATED).toEqual(
      expect.arrayContaining(["moldura/useFrameLayout.ts", "moldura/BellPopover.tsx"]),
    );
    // Self-test: the reader finds each way of listening, and only those.
    const sample = `
      window.addEventListener("keydown", a);
      document.addEventListener('keydown', b, true);
      window.onkeydown = c;
      document.onkeydown = d;
      canvas.addEventListener("keydown", e);
      window.addEventListener("keyup", f);
      el.onkeydown = g;
    `;
    expect(keydownListeners(sample)).toEqual([
      'window.addEventListener("keydown")',
      'document.addEventListener("keydown")',
      "window.onkeydown",
      "document.onkeydown",
    ]);
    expect(namesUsed("export const RESET_LAYOUT_EVENT = 1; f(SHORTCUTS_EVENT); g(OTHER);", RETIRED)).toEqual([
      "RESET_LAYOUT_EVENT",
      "SHORTCUTS_EVENT",
    ]);

    for (const file of MIGRATED)
      expect(keydownListeners(readFileSync(join(SRC, file), "utf8"), file), file).toEqual([]);
    const sources = walk(SRC).filter((f) => /\.tsx?$/.test(f) && !/\.test\.tsx?$|typetest/.test(f));
    expect(sources.length).toBeGreaterThan(100);
    for (const file of sources)
      expect(namesUsed(readFileSync(file, "utf8"), RETIRED), relative(SRC, file)).toEqual([]);
  });
});

/* ---- beyond the checks: the manager's own hygiene -------------------------------------- */
describe("the key manager's hygiene", () => {
  it("holds one keydown listener on the window and leaves none behind", () => {
    const add = vi.spyOn(window, "addEventListener");
    const remove = vi.spyOn(window, "removeEventListener");
    const run = vi.fn();
    const { unmount } = mountRegistry(
      <>
        <Probe commands={[cmd("probe:a", "global", ["a"], run)]} />
        <Probe commands={[cmd("probe:b", "view:x", ["b"], run)]} />
      </>,
    );
    const keydowns = (spy: typeof add) => spy.mock.calls.filter(([type]) => type === "keydown");
    expect(keydowns(add)).toHaveLength(1);
    unmount();
    expect(keydowns(remove)).toHaveLength(1);
    expect(keydowns(remove)[0]![1]).toBe(keydowns(add)[0]![1]);
    press({ key: "a" });
    expect(run).not.toHaveBeenCalled();
  });

  it("in a production build a collision only warns: the interface of whoever bought it stays up", async () => {
    vi.stubEnv("MODE", "production");
    vi.resetModules();
    const { CommandRegistry: Prod } = await import("./registry");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const registry = new Prod();
    registry.register([cmd("probe:one", "global", ["Mod+K"], () => undefined)]);
    expect(() => registry.register([cmd("probe:two", "global", ["Mod+K"], () => undefined)])).not.toThrow();
    expect(warn).toHaveBeenCalledWith(expect.stringMatching(/probe:one[\s\S]*probe:two/));
    vi.unstubAllEnvs();
  });

  it("a re-render does not re-register: the commands keep their place and identity", () => {
    const registry = new CommandRegistry();
    const changes = vi.fn();
    registry.subscribe(changes);
    const commands = [cmd("probe:r", "global", ["r"], () => undefined)];
    function Owner({ tick }: { tick: number }) {
      useCommands(commands);
      return <span>{tick}</span>;
    }
    const { rerender } = render(
      <CommandsProvider registry={registry}>
        <Owner tick={0} />
      </CommandsProvider>,
    );
    const before = changes.mock.calls.length;
    for (let tick = 1; tick <= 3; tick++)
      rerender(
        <CommandsProvider registry={registry}>
          <Owner tick={tick} />
        </CommandsProvider>,
      );
    expect(changes.mock.calls.length).toBe(before);
    expect(registry.list()[0]).toBe(commands[0]);
  });

  it("the bell popover is not a modal: its own Esc closes it with the focus inside", async () => {
    await mountShell("/", "moldura");
    fireEvent.click(screen.getByRole("button", { name: /Notifications/ }));
    const popover = await screen.findByRole("dialog", { name: "Notifications" });
    const probe = document.createElement("button");
    popover.appendChild(probe);
    probe.focus();
    press({ key: "Escape" }, probe);
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Notifications" })).toBeNull());
  });

  it("the palette's toggle keys close it while it is open (a modal hides the global keys)", async () => {
    const registry = await mountShell("/", "nucleo");
    blur();
    press({ key: "k", ctrlKey: true });
    await screen.findByRole("dialog", { name: "Command palette" });
    expect(registry.activeScopes()).toEqual(["modal"]);
    for (const init of [
      { key: "k", ctrlKey: true },
      { key: "m", ctrlKey: true },
    ]) {
      press(init, document.activeElement ?? document.body);
      await waitFor(() => expect(screen.queryByRole("dialog", { name: "Command palette" })).toBeNull());
      press({ key: "k", ctrlKey: true });
      await screen.findByRole("dialog", { name: "Command palette" });
    }
  });
});

/* ---- the source, read as a TypeScript tree (C16) ---------------------------------------- */
const RETIRED = ["RESET_LAYOUT_EVENT", "SHORTCUTS_EVENT"];

function parse(text: string, name = "sample.tsx"): ts.SourceFile {
  return ts.createSourceFile(name, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
}

function visit(node: ts.Node, fn: (n: ts.Node) => void) {
  fn(node);
  node.forEachChild((child) => visit(child, fn));
}

/** `window`/`document` keydown listeners: `addEventListener("keydown", …)` or `onkeydown =`. */
function keydownListeners(text: string, name?: string): string[] {
  const found: string[] = [];
  const target = (e: ts.Expression) =>
    ts.isIdentifier(e) && ["window", "document"].includes(e.text) ? e.text : null;
  visit(parse(text, name), (n) => {
    if (ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression)) {
      const who = target(n.expression.expression);
      const arg = n.arguments[0];
      if (
        who &&
        n.expression.name.text === "addEventListener" &&
        arg &&
        ts.isStringLiteralLike(arg) &&
        arg.text === "keydown"
      )
        found.push(`${who}.addEventListener("keydown")`);
    }
    if (
      ts.isBinaryExpression(n) &&
      n.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
      ts.isPropertyAccessExpression(n.left) &&
      n.left.name.text.toLowerCase() === "onkeydown"
    ) {
      const who = target(n.left.expression);
      if (who) found.push(`${who}.onkeydown`);
    }
  });
  return found;
}

/** Which of `names` the source declares or refers to, as identifiers. */
function namesUsed(text: string, names: string[]): string[] {
  const found = new Set<string>();
  visit(parse(text), (n) => {
    if (ts.isIdentifier(n) && names.includes(n.text)) found.add(n.text);
  });
  return names.filter((x) => found.has(x));
}

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}
