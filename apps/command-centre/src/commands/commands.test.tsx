// @vitest-environment jsdom
/**
 * Commands and shortcuts (.specs/features/comandos-atalhos, checks C1-C10, C12-C15 and the hygiene tests; C11 and C16 read the source: commands.source.test.ts).
 * S1 drives the registry and its one keydown listener through small probes;
 * the platform is simulated where production reads it (`navigator.platform`).
 */
import { useState } from "react";
import { describe, expect, it, onTestFinished, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { HashRouter } from "react-router-dom";
import type * as ApiModule from "../api";
import { api } from "../api";
import { ToastProvider } from "../components/ui";
import { NotificationsProvider } from "../hooks/useNotifications";
import { CommandPalette } from "../components/CommandPalette";
import { project } from "../nucleo/projections";
import { runPanelId } from "../desktop/runPanels";
import { CommandRegistry, CommandsProvider, useCommands, type CommandScope } from "./registry";
import {
  META,
  Probe,
  blur,
  cmd,
  expectedHelp,
  installHarness,
  mountRegistry,
  mountShell,
  openHelp,
  paletteSections,
  press,
  simulatePlatform,
} from "./testkit";

vi.mock("../api", async (importOriginal) =>
  (await import("./testserver")).mockApi(await importOriginal<typeof ApiModule>()),
);
// The brain's canvases paint through WebGL / a 2D context jsdom does not have.
vi.mock("../brain/BrainCanvas", () => ({ BrainCanvas: () => null }));
vi.mock("../nucleo/scenes/BrainSceneCanvas", () => ({ BrainSceneCanvas: () => null }));

installHarness();

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
});

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
