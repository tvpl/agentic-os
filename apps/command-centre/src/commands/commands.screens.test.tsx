// @vitest-environment jsdom
/**
 * Commands and shortcuts, the part that needs the screens (.specs/features/
 * comandos-atalhos, checks C23-C33): the doors found while building (layers,
 * one instance per screen), every migrated key pressed on the screen that owns
 * it with its effect asserted, the guards of the key manager, the keyboard
 * layouts and platforms, the palette's asynchronous actions and the help that
 * hides what an inner scope covers.
 */
import { useRef } from "react";
import { describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useQueryClient, type QueryClient } from "@tanstack/react-query";
import type * as ApiModule from "../api";
import type * as CameraModule from "../brain/camera";
import { api } from "../api";
import { dictionaries } from "../i18n";
import { qk } from "../queries";
import { useNotifications, type NotificationItem } from "../hooks/useNotifications";
import { useDrawer } from "../ui";
import { dismiss, getLaminas, project } from "../nucleo/projections";
import { horizonRing } from "../nucleo/scenes";
import { runPanelId } from "../desktop/runPanels";
import { CommandRegistry, CommandsGate, CommandsProvider, useCommandScope, useCommands } from "./registry";
import { matchesCombo } from "./keys";
import {
  Probe,
  blur,
  cmd,
  mountRegistry,
  mountShell,
  openHelp,
  press,
  server,
  simulatePlatform,
  installHarness,
} from "./testkit";

vi.mock("../api", async (importOriginal) =>
  (await import("./testserver")).mockApi(await importOriginal<typeof ApiModule>()),
);
// The brain's canvases paint through WebGL / a 2D context jsdom does not have.
vi.mock("../brain/BrainCanvas", () => ({ BrainCanvas: () => null }));
vi.mock("../nucleo/scenes/BrainSceneCanvas", () => ({ BrainSceneCanvas: () => null }));
// The camera is the one thing a brain key moves that is not on the page: watch what it is asked.
const zoomLog = vi.hoisted(() => ({ calls: [] as Array<["by", number] | ["reset"]> }));
vi.mock("../brain/camera", async (importOriginal) => {
  const mod = await importOriginal<typeof CameraModule>();
  return {
    ...mod,
    useCamera: (...args: Parameters<typeof mod.useCamera>) => {
      const camera = mod.useCamera(...args);
      return {
        ...camera,
        by: (factor: number) => {
          zoomLog.calls.push(["by", factor]);
          camera.by(factor);
        },
        reset: () => {
          zoomLog.calls.push(["reset"]);
          camera.reset();
        },
      };
    },
  };
});

installHarness();

const hash = () => window.location.hash;
const settle = () => act(async () => undefined);

/* ---- door 4: a dialog is a layer ---------------------------------------------- */
describe("R1 the doors found while building", () => {
  it("C23 a dialog is a layer: what is behind it gets no key until it goes", async () => {
    const run = { g: vi.fn(), n: vi.fn(), v: vi.fn(), m: vi.fn(), o: vi.fn() };
    function RealDialog() {
      const ref = useRef<HTMLDivElement>(null);
      useDrawer(ref, () => undefined);
      return (
        <div role="dialog" aria-modal="true" tabIndex={-1} ref={ref}>
          <button type="button">inside</button>
        </div>
      );
    }
    function Stage({
      dialog,
      modalCommand,
      overlay,
    }: {
      dialog: boolean;
      modalCommand: boolean;
      overlay: boolean;
    }) {
      useCommandScope("overlay", overlay);
      return (
        <>
          <Probe commands={[cmd("g", "global", ["g"], run.g)]} />
          <Probe commands={[cmd("n", "nucleo", ["n"], run.n)]} />
          <Probe commands={[cmd("v", "view:x", ["v"], run.v)]} />
          {dialog && <RealDialog />}
          {modalCommand && <Probe commands={[cmd("m", "modal", ["m"], run.m)]} />}
          {overlay && <Probe commands={[cmd("o", "overlay", ["o"], run.o)]} />}
        </>
      );
    }
    const registry = new CommandRegistry();
    const ui = (dialog: boolean, overlay = false, modalCommand = false) => (
      <CommandsProvider registry={registry}>
        <Stage dialog={dialog} modalCommand={modalCommand} overlay={overlay} />
      </CommandsProvider>
    );
    const everything = () => (["g", "n", "v", "m", "o"] as const).forEach((k) => run[k].mockClear());
    const fired = () => (["g", "n", "v", "m", "o"] as const).filter((k) => run[k].mock.calls.length > 0);
    const pressAll = (target?: Element) => ["g", "n", "v", "m", "o"].forEach((key) => press({ key }, target));

    const { rerender } = render(ui(false));
    pressAll();
    expect(fired(), "no layer").toEqual(["g", "n", "v"]);

    // A dialog of the stack, with nothing registered for it: the screen behind it is inert, so its
    // keys are too — whoever has the focus.
    everything();
    rerender(ui(true));
    await settle();
    pressAll();
    pressAll(screen.getByRole("button", { name: "inside" }));
    expect(fired(), "dialog open, no command of its own").toEqual([]);

    // With one in `modal`, that one answers.
    rerender(ui(true, false, true));
    await settle();
    pressAll();
    pressAll(screen.getByRole("button", { name: "inside" }));
    expect(fired(), "dialog open").toEqual(["m"]);

    everything();
    rerender(ui(false));
    await settle();
    pressAll();
    expect(fired(), "dialog gone").toEqual(["g", "n", "v"]);

    // A layer held by hand (the focus mode): the same.
    everything();
    rerender(ui(false, true));
    await settle();
    pressAll();
    expect(fired(), "overlay held").toEqual(["o"]);
    everything();
    rerender(ui(false, false));
    await settle();
    pressAll();
    expect(fired(), "overlay gone").toEqual(["g", "n", "v"]);
  });

  it("C23 a modal dialog that is not in the stack still hides the screen; a popover does not", () => {
    const run = vi.fn();
    mountRegistry(<Probe commands={[cmd("g", "global", ["g"], run)]} />);
    for (const [modal, expected] of [
      ["true", 0],
      ["false", 1],
    ] as const) {
      const holder = document.createElement("div");
      holder.setAttribute("role", "dialog");
      holder.setAttribute("aria-modal", modal);
      const inside = document.createElement("button");
      holder.appendChild(inside);
      document.body.appendChild(holder);
      run.mockClear();
      press({ key: "g" }, inside);
      expect(run, `aria-modal=${modal}`).toHaveBeenCalledTimes(expected);
      holder.remove();
    }
  });

  it("C24 a screen on its way out stands down; of several instances the newest owns the keys", async () => {
    const a = vi.fn();
    const b = vi.fn();
    const registry = new CommandRegistry();
    const ui = (aOn: boolean) => (
      <CommandsProvider registry={registry}>
        <CommandsGate enabled={aOn}>
          <Probe commands={[cmd("probe:a", "view:x", ["a"], a)]} />
        </CommandsGate>
        <CommandsGate enabled>
          <Probe commands={[cmd("probe:b", "view:x", ["b"], b)]} />
        </CommandsGate>
      </CommandsProvider>
    );
    const { rerender } = render(ui(false));
    expect(registry.list().map((c) => c.id)).toEqual(["probe:b"]);
    press({ key: "a" });
    press({ key: "b" });
    expect(a).not.toHaveBeenCalled();
    expect(b).toHaveBeenCalledTimes(1);
    rerender(ui(true));
    // (in registration order: the screen that came back registers again, after the one that stayed)
    expect(registry.list().map((c) => c.id)).toEqual(["probe:b", "probe:a"]);
    press({ key: "a" });
    expect(a).toHaveBeenCalledTimes(1);
    rerender(ui(false));
    expect(registry.list().map((c) => c.id)).toEqual(["probe:b"]);

    // Two instances of one screen: the newest holds the keys; when it leaves, the older takes over.
    function Instance({ name, run }: { name: string; run: () => void }) {
      useCommands([cmd(`probe:${name}`, "view:runs", ["r"], run)], { exclusive: "run-detail" });
      return null;
    }
    const first = vi.fn();
    const second = vi.fn();
    const stage = (showSecond: boolean) => (
      <CommandsProvider registry={registry}>
        <Instance name="first" run={first} />
        {showSecond && <Instance name="second" run={second} />}
      </CommandsProvider>
    );
    cleanup();
    const view = render(stage(false));
    expect(registry.list().map((c) => c.id)).toEqual(["probe:first"]);
    view.rerender(stage(true));
    expect(registry.list().map((c) => c.id)).toEqual(["probe:second"]);
    press({ key: "r" });
    expect([first.mock.calls.length, second.mock.calls.length]).toEqual([0, 1]);
    view.rerender(stage(false));
    expect(registry.list().map((c) => c.id)).toEqual(["probe:first"]);
    press({ key: "r" });
    expect([first.mock.calls.length, second.mock.calls.length]).toEqual([1, 1]);
  });

  it("C24 the scene being left does not answer keys while it travels out", async () => {
    await mountShell("/pixel", "nucleo");
    await screen.findByRole("button", { name: /Eraser/ }, { timeout: 5000 });
    blur();
    press({ key: "Escape" });
    await waitFor(() => expect(hash()).toBe("#/"));
    // The Pixel scene is still drawn (it leaves for 650 ms) but it is a picture: 2 is the Núcleo's.
    expect(document.querySelectorAll("section.nu-scene").length).toBe(2);
    press({ key: "2" });
    await waitFor(() => expect(hash()).toBe("#/brain"));
  });
});

describe("R1 a sheet on its way out does not answer keys", () => {
  it("C24 a lâmina that is dissolving keeps none of its screen's keys", async () => {
    const registry = await mountShell("/", "nucleo");
    const ids = () => registry.list().map((c) => c.id);
    blur();
    act(() => project(runPanelId("r1")));
    await waitFor(() => expect(ids()).toContain("runs.again"), { timeout: 5000 });
    act(() => dismiss(runPanelId("r1")));
    // It is still drawn for its exit, as a picture: its keys are gone with it.
    await waitFor(() => expect(document.querySelector(".nu-lamina.bye")).not.toBeNull());
    expect(ids()).not.toContain("runs.again");
    await waitFor(() => expect(document.querySelector(".nu-lamina")).toBeNull(), { timeout: 5000 });
  });
});

/* ---- Pixel Studio ------------------------------------------------------------------ */
describe("R1 every key of Pixel Studio does what it says", () => {
  it("C26 Pixel Studio keys each act on Pixel Studio", async () => {
    await mountShell("/pixel", "nucleo");
    await screen.findByRole("button", { name: /Eraser/ }, { timeout: 5000 });
    const toolOn = () =>
      ["Pencil", "Eraser", "Fill", "Eyedropper"].find(
        (name) =>
          screen.getByRole("button", { name: new RegExp(name) }).getAttribute("aria-pressed") === "true",
      );
    const brush = () =>
      /(\d+)/.exec(document.querySelector(".pxs-brush")!.textContent!.replace(/Brush/, ""))![1];
    const secondary = () => document.querySelector(".pxs-secondary")!.getAttribute("title");
    const onion = () => screen.getByRole("button", { name: /Onion/ }).getAttribute("aria-pressed");
    const frameLabel = () => /Frame (\d+\/\d+)/.exec(document.body.textContent!)![1];
    const stays = (label: string) => {
      expect(hash(), label).toBe("#/pixel");
      expect(document.querySelector(".nu-shell")!.getAttribute("data-scene"), label).toBe("pixel");
    };
    const rows: Array<[string, KeyboardEventInit, () => unknown, unknown]> = [
      ["2 eraser", { key: "2" }, toolOn, "Eraser"],
      ["3 fill", { key: "3" }, toolOn, "Fill"],
      ["4 eyedropper", { key: "4" }, toolOn, "Eyedropper"],
      ["1 pencil", { key: "1" }, toolOn, "Pencil"],
      ["= brush up", { key: "=" }, brush, "2"],
      ["+ brush up", { key: "+", shiftKey: true }, brush, "3"],
      ["- brush down", { key: "-" }, brush, "2"],
      ["_ brush down", { key: "_", shiftKey: true }, brush, "1"],
      ["x swaps the colours", { key: "x" }, secondary, "Secondary colour: #29adff"],
      ["x swaps back", { key: "x" }, secondary, "Secondary colour: #fff1e8"],
      ["o onion on", { key: "o" }, onion, "true"],
      ["o onion off", { key: "o" }, onion, "false"],
    ];
    blur();
    for (const [label, init, read, expected] of rows) {
      press(init);
      expect(read(), label).toBe(expected);
      stays(label);
    }

    // Undo and redo, each by its own keys: an edit (a second frame) to take back.
    fireEvent.click(screen.getByRole("button", { name: /^Add$/ }));
    expect(frameLabel()).toBe("2/2");
    press({ key: "z", ctrlKey: true });
    expect(frameLabel(), "Ctrl+Z undoes").toBe("1/1");
    press({ key: "z", ctrlKey: true, shiftKey: true });
    expect(frameLabel(), "Ctrl+Shift+Z redoes").toBe("2/2");
    press({ key: "z", ctrlKey: true });
    expect(frameLabel()).toBe("1/1");
    press({ key: "y", ctrlKey: true });
    expect(frameLabel(), "Ctrl+Y redoes").toBe("2/2");
    // …but not while typing in a field: Ctrl+Z there is the field's.
    const name = screen.getAllByRole("textbox")[0]!;
    act(() => name.focus());
    press({ key: "z", ctrlKey: true }, name);
    expect(frameLabel(), "Ctrl+Z in a field").toBe("2/2");
    stays("undo");
  });

  it("C26 Esc with unsaved pixels asks before leaving; without any, it goes home", async () => {
    await mountShell("/pixel", "nucleo");
    await screen.findByRole("button", { name: /Eraser/ }, { timeout: 5000 });
    blur();
    fireEvent.click(screen.getByRole("button", { name: /^Add$/ }));
    // In a field, Escape is the field's: nothing asks, nobody leaves.
    const field = screen.getAllByRole("textbox")[0]!;
    act(() => field.focus());
    press({ key: "Escape" }, field);
    await settle();
    expect(screen.queryByRole("dialog", { name: "Leave with unsaved pixels?" })).toBeNull();
    expect(hash()).toBe("#/pixel");
    blur();
    press({ key: "Escape" });
    const ask = await screen.findByRole("dialog", { name: "Leave with unsaved pixels?" });
    expect(hash()).toBe("#/pixel");
    // Esc inside the question is the question's own: it stays, nobody leaves.
    press({ key: "Escape" }, ask);
    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: "Leave with unsaved pixels?" })).toBeNull(),
    );
    expect(hash()).toBe("#/pixel");
    press({ key: "Escape" });
    fireEvent.click(await screen.findByRole("button", { name: "Leave" }));
    await waitFor(() => expect(hash()).toBe("#/"));
  });
});

/* ---- Second Brain, Runs, Skills ------------------------------------------------------ */
describe("R1 every key of the Second Brain, a run and a skill does what it says", () => {
  it("C27 Second Brain keys each act on the Second Brain", async () => {
    window.sessionStorage.setItem("mordomo.brainScene.classic", "1");
    await mountShell("/brain", "nucleo");
    await waitFor(() => expect(document.querySelector(".bs-classic .brain2")).not.toBeNull(), {
      timeout: 5000,
    });
    const brain = () => document.querySelector<HTMLElement>(".bs-classic .brain2")!;
    const local = () => document.querySelector('button[title="Local (f)"]')!.getAttribute("aria-pressed");
    const names = () =>
      (screen.getByRole("checkbox", { name: /File names|Nomes/ }) as HTMLInputElement).checked;
    const listOn = () => screen.getByRole("button", { name: /List view/ }).getAttribute("aria-pressed");

    // The camera: ⌘+ (and ⌘=) in, ⌘- out, ⌘0 back.
    blur();
    zoomLog.calls.length = 0;
    press({ key: "=", ctrlKey: true });
    press({ key: "+", ctrlKey: true, shiftKey: true });
    press({ key: "-", ctrlKey: true });
    press({ key: "0", ctrlKey: true });
    expect(zoomLog.calls).toEqual([["by", 1.25], ["by", 1.25], ["by", 0.8], ["reset"]]);

    // f (local mode) and l (file names) toggle their own switches.
    const was = { local: local(), names: names() };
    press({ key: "f" });
    expect(local()).toBe(was.local === "true" ? "false" : "true");
    press({ key: "f" });
    expect(local()).toBe(was.local);
    press({ key: "l" });
    expect(names()).toBe(!was.names);
    press({ key: "l" });
    expect(names()).toBe(was.names);

    // Esc closes the list, then the presentation — one thing at a time — and only then is the shell's.
    fireEvent.click(screen.getByRole("button", { name: /List view/ }));
    expect(listOn()).toBe("true");
    press({ key: "p" });
    expect(brain().classList.contains("presenting")).toBe(true);
    press({ key: "Escape" });
    expect(brain().classList.contains("has-list"), "the list went first").toBe(false);
    expect(brain().classList.contains("presenting")).toBe(true);
    press({ key: "Escape" });
    expect(brain().classList.contains("presenting"), "then the presentation").toBe(false);
    expect(hash(), "and the shell kept out of it").toBe("#/brain");
    press({ key: "Escape" });
    await waitFor(() => expect(hash(), "nothing left to close: the shell's Esc").toBe("#/"));
  });

  it("C27 / brings the search field on screen — panel folded or presenting — and focuses it once", async () => {
    window.sessionStorage.setItem("mordomo.brainScene.classic", "1");
    await mountShell("/brain", "nucleo");
    await waitFor(() => expect(document.querySelector(".bs-classic .brain2")).not.toBeNull(), {
      timeout: 5000,
    });
    const toggle = () => document.querySelector<HTMLButtonElement>(".brain2-panel > button[aria-expanded]")!;
    const onSearch = () => {
      const el = document.activeElement;
      return el?.tagName === "INPUT" && el.closest(".brain2-panel") !== null;
    };
    // The panel folded: `/` unfolds it (the panel used to listen for this itself) and focuses the field.
    fireEvent.click(toggle());
    expect(toggle().getAttribute("aria-expanded")).toBe("false");
    blur();
    press({ key: "/" });
    await waitFor(() => expect(toggle().getAttribute("aria-expanded")).toBe("true"));
    await waitFor(() => expect(onSearch()).toBe(true));
    // Presenting: `/` leaves it and focuses the field.
    blur();
    press({ key: "p" });
    expect(document.querySelector(".bs-classic .brain2")!.classList.contains("presenting")).toBe(true);
    press({ key: "/" });
    await waitFor(() =>
      expect(document.querySelector(".bs-classic .brain2")!.classList.contains("presenting")).toBe(false),
    );
    await waitFor(() => expect(onSearch()).toBe(true));
    // Once: the field is not grabbed again by a later render, nor when the panel is folded and unfolded.
    blur();
    await settle();
    expect(onSearch()).toBe(false);
    fireEvent.click(toggle());
    fireEvent.click(toggle());
    await settle();
    expect(toggle().getAttribute("aria-expanded")).toBe("true");
    expect(onSearch(), "unfolding the panel is not a request for the field").toBe(false);
  });

  it("C28 a run's /, c and r each do their own thing", async () => {
    await mountShell("/runs/r1", "moldura");
    await waitFor(() => expect(document.querySelector(".run-detail")).not.toBeNull(), { timeout: 5000 });
    await waitFor(() => expect(document.querySelector('input[type="search"]')).not.toBeNull());
    blur();
    press({ key: "/" });
    await waitFor(() => expect(document.activeElement).toBe(document.querySelector('input[type="search"]')));
    blur();
    expect(document.querySelector(".follow-up")).toBeNull();
    press({ key: "c" });
    await waitFor(() => expect(document.activeElement).toBe(document.querySelector(".follow-up-input")));
    expect(api.post).not.toHaveBeenCalled();
    blur();
    press({ key: "r" });
    await waitFor(() =>
      expect(vi.mocked(api.post).mock.calls.filter(([url]) => url === "/api/runs/r1/retry")).toHaveLength(1),
    );
    // Typing a "c" or an "r" in the follow-up is text.
    const box = document.querySelector<HTMLTextAreaElement>(".follow-up-input")!;
    press({ key: "r" }, box);
    press({ key: "c" }, box);
    await settle();
    expect(vi.mocked(api.post).mock.calls.filter(([url]) => url === "/api/runs/r1/retry")).toHaveLength(1);
  });

  it("C28 ⌘Enter on a skill's page runs it, from the page and from a field", async () => {
    await mountShell("/skills/demo", "moldura");
    await waitFor(
      () =>
        expect(document.querySelector<HTMLButtonElement>(".apps-run-actions .btn.primary")?.disabled).toBe(
          false,
        ),
      { timeout: 5000 },
    );
    // The run is put on hold by the security profile: the page stays, and can run again once it answers.
    vi.mocked(api.post).mockResolvedValue({ status: "waiting_approval", runId: null });
    const launches = () => vi.mocked(api.post).mock.calls.filter(([url]) => url === "/api/skills/demo/run");
    blur();
    press({ key: "Enter", ctrlKey: true });
    await waitFor(() => expect(launches()).toHaveLength(1));
    // Plain Enter is not it; Ctrl+Shift+Enter is not it.
    press({ key: "Enter" });
    press({ key: "Enter", ctrlKey: true, shiftKey: true });
    await settle();
    expect(launches()).toHaveLength(1);
    // From a field the page owns, it still runs (the key has a modifier).
    const field = document.querySelector<HTMLElement>("select, input, textarea");
    expect(field, "the page has a field").not.toBeNull();
    press({ key: "Enter", ctrlKey: true }, field!);
    await waitFor(() => expect(launches()).toHaveLength(2));
  });
});

describe("R1 a skill's ⌘Enter respects whether it can run", () => {
  it("C28 ⌘Enter does nothing while the skill is already running", async () => {
    await mountShell("/skills/demo", "moldura");
    await waitFor(
      () =>
        expect(document.querySelector<HTMLButtonElement>(".apps-run-actions .btn.primary")?.disabled).toBe(
          false,
        ),
      { timeout: 5000 },
    );
    const launches = () => vi.mocked(api.post).mock.calls.filter(([url]) => url === "/api/skills/demo/run");
    blur();
    // The launch never answers: the page is running.
    press({ key: "Enter", ctrlKey: true });
    await waitFor(() => expect(launches()).toHaveLength(1));
    await settle();
    press({ key: "Enter", ctrlKey: true });
    press({ key: "Enter", ctrlKey: true });
    await settle();
    expect(launches(), "while it runs, the key is not another run").toHaveLength(1);
  });
});

/* ---- the Núcleo ---------------------------------------------------------------------- */
describe("R1 the Núcleo's own keys", () => {
  it("C29 1-5 and [ ] travel between the scenes", async () => {
    await mountShell("/", "nucleo");
    const paths = ["#/", "#/brain", "#/runs", "#/skills", "#/routines"];
    for (const [key, to] of [
      ["3", paths[2]],
      ["4", paths[3]],
      ["5", paths[4]],
      ["2", paths[1]],
      ["1", paths[0]],
    ] as const) {
      blur();
      press({ key });
      await waitFor(() => expect(hash(), key).toBe(to));
    }
    // [ and ] walk the ring around where you are.
    for (const [key, step] of [
      ["]", 1],
      ["]", 1],
      ["[", -1],
      ["[", -1],
      ["[", -1],
    ] as const) {
      const ring = horizonRing(document.querySelector(".nu-shell")!.getAttribute("data-scene") as never);
      const at = ring.findIndex(
        (s) => s.id === document.querySelector(".nu-shell")!.getAttribute("data-scene"),
      );
      const to = ring[(at + step + ring.length) % ring.length]!;
      blur();
      press({ key });
      await waitFor(() => expect(hash(), `${key} from ${at}`).toBe(`#${to.path}`));
    }
  });

  it("C29 Esc folds the conversation, then closes the search, then dismisses a sheet, then goes home", async () => {
    await mountShell("/runs", "nucleo");
    const voice = () => document.querySelector(".nu-voice")!;
    const shell = () => document.querySelector(".nu-shell")!;

    // The conversation rises when the line is used; Esc folds it and lets go of the line.
    act(() => document.querySelector<HTMLTextAreaElement>(".cons-input")!.focus());
    await waitFor(() => expect(voice().hasAttribute("data-open")).toBe(true));
    press({ key: "Escape" }, document.activeElement!);
    await waitFor(() => expect(voice().hasAttribute("data-open")).toBe(false));
    expect(hash()).toBe("#/runs");

    // ⌘F opens the one search; Esc closes it and stays — from its own field, and from the page.
    for (const fromTheField of [true, false]) {
      blur();
      press({ key: "f", ctrlKey: true });
      await waitFor(() => expect(shell().classList.contains("searching")).toBe(true));
      if (!fromTheField) blur();
      press({ key: "Escape" }, document.activeElement ?? document.body);
      await waitFor(() => expect(shell().classList.contains("searching")).toBe(false));
      expect(hash()).toBe("#/runs");
    }

    // A sheet (lâmina) is dismissed before the shell goes home.
    blur();
    act(() => project("cost"));
    await waitFor(() => expect(getLaminas()).toEqual(["cost"]));
    press({ key: "Escape" });
    await waitFor(() => expect(getLaminas()).toEqual([]));
    expect(hash()).toBe("#/runs");
    press({ key: "Escape" });
    await waitFor(() => expect(hash()).toBe("#/"));
  });

  it("C29 ⌘J opens the skill deck and the same key puts it away; Ctrl+Shift+J is not it", async () => {
    await mountShell("/", "nucleo");
    const deck = () => document.querySelector(".skill-deck");
    blur();
    press({ key: "j", ctrlKey: true, shiftKey: true });
    await settle();
    expect(deck(), "Ctrl+Shift+J").toBeNull();
    press({ key: "j", ctrlKey: true });
    await waitFor(() => expect(deck()).not.toBeNull());
    press({ key: "j", ctrlKey: true }, document.activeElement ?? document.body);
    await waitFor(() => expect(deck()).toBeNull());
  });

  it("C29 with a sheet up and the deck open, Esc closes the deck first and the sheet next", async () => {
    await mountShell("/runs", "nucleo");
    blur();
    act(() => project("cost"));
    await waitFor(() => expect(getLaminas()).toEqual(["cost"]));
    press({ key: "j", ctrlKey: true });
    await waitFor(() => expect(document.querySelector(".skill-deck")).not.toBeNull());
    press({ key: "Escape" }, document.activeElement ?? document.body);
    await waitFor(() => expect(document.querySelector(".skill-deck")).toBeNull());
    expect(getLaminas(), "the sheet under the deck stayed").toEqual(["cost"]);
    expect(hash()).toBe("#/runs");
    blur();
    press({ key: "Escape" });
    await waitFor(() => expect(getLaminas()).toEqual([]));
  });

  it("C29 Esc in a field of the scene leaves a sheet up; from the page it dismisses it", async () => {
    await mountShell("/runs", "nucleo");
    await waitFor(() => expect(document.querySelector(".nu-scene.on input")).not.toBeNull(), {
      timeout: 5000,
    });
    blur();
    act(() => project("cost"));
    await waitFor(() => expect(getLaminas()).toEqual(["cost"]));
    const field = document.querySelector<HTMLInputElement>(".nu-scene.on input")!;
    act(() => field.focus());
    press({ key: "Escape" }, field);
    await settle();
    expect(getLaminas(), "Esc in a field is the field's").toEqual(["cost"]);
    expect(hash()).toBe("#/runs");
    act(() => field.blur());
    press({ key: "Escape" });
    await waitFor(() => expect(getLaminas()).toEqual([]));
  });

  it("C29 with the conversation and the search both open, Esc folds the conversation first", async () => {
    await mountShell("/runs", "nucleo");
    const shell = () => document.querySelector(".nu-shell")!;
    const voice = () => document.querySelector(".nu-voice")!;
    blur();
    press({ key: "f", ctrlKey: true });
    await waitFor(() => expect(shell().classList.contains("searching")).toBe(true));
    act(() => document.querySelector<HTMLTextAreaElement>(".cons-input")!.focus());
    await waitFor(() => expect(voice().hasAttribute("data-open")).toBe(true));
    press({ key: "Escape" }, document.activeElement!);
    await waitFor(() => expect(voice().hasAttribute("data-open")).toBe(false));
    expect(shell().classList.contains("searching"), "the search is still there").toBe(true);
    blur();
    press({ key: "Escape" });
    await waitFor(() => expect(shell().classList.contains("searching")).toBe(false));
  });

  it("C29 ⌘⇧A and ⌘⇧D answer only with a decision waiting, and only with Shift", async () => {
    const registry = await mountShell("/", "nucleo");
    const approve = registry.list().find((c) => c.id === "nucleo.approve")!;
    const deny = registry.list().find((c) => c.id === "nucleo.deny")!;
    expect(approve.keys).toEqual(["Mod+Shift+A"]);
    expect(deny.keys).toEqual(["Mod+Shift+D"]);
    // Nothing waits: the keys fall through (the command is off) and nothing is sent.
    expect(approve.when!()).toBe(false);
    blur();
    press({ key: "a", ctrlKey: true, shiftKey: true });
    press({ key: "d", ctrlKey: true, shiftKey: true });
    await settle();
    expect(api.post).not.toHaveBeenCalled();
  });
});

/* ---- the key manager's guards ---------------------------------------------------------- */
describe("R1 what the key manager leaves to somebody else", () => {
  it("C30 a key already handled, an IME composition and the guided tour are not commands", () => {
    const run = vi.fn();
    const esc = vi.fn();
    mountRegistry(
      <Probe
        commands={[
          cmd("probe:x", "global", ["x"], run),
          cmd("probe:esc", "global", ["Escape"], esc, { allowInInput: true }),
        ]}
      />,
    );
    press({ key: "x" });
    expect(run).toHaveBeenCalledTimes(1);

    // Somebody before us took it (`defaultPrevented`).
    const taken = (e: KeyboardEvent) => e.preventDefault();
    window.addEventListener("keydown", taken, true);
    press({ key: "x" });
    window.removeEventListener("keydown", taken, true);
    expect(run).toHaveBeenCalledTimes(1);

    // An IME composition: the key is part of the text being composed.
    press({ key: "x", isComposing: true });
    press({ key: "Process", isComposing: true });
    press({ key: "Escape", isComposing: true });
    // Safari ends a composition with a key that says only keyCode 229.
    press({ key: "Escape", keyCode: 229 });
    press({ key: "x", keyCode: 229 });
    expect(run).toHaveBeenCalledTimes(1);
    expect(esc).not.toHaveBeenCalled();
    press({ key: "Escape" });
    expect(esc).toHaveBeenCalledTimes(1);

    // The tour owns the keyboard while it is up.
    document.documentElement.dataset.onboarding = "1";
    press({ key: "x" });
    press({ key: "Escape" });
    delete document.documentElement.dataset.onboarding;
    expect(run).toHaveBeenCalledTimes(1);
    expect(esc).toHaveBeenCalledTimes(1);
    press({ key: "x" });
    expect(run).toHaveBeenCalledTimes(2);
  });

  it("C30 Shift is part of a letter's key: Ctrl+Shift+J is not Ctrl+J, Ctrl+A is not Ctrl+Shift+A", () => {
    const deck = vi.fn();
    const approve = vi.fn();
    const focus = vi.fn();
    mountRegistry(
      <Probe
        commands={[
          cmd("probe:deck", "global", ["Mod+J"], deck),
          cmd("probe:approve", "global", ["Mod+Shift+A"], approve),
          cmd("probe:focus", "global", ["p"], focus),
        ]}
      />,
    );
    press({ key: "j", ctrlKey: true, shiftKey: true });
    press({ key: "a", ctrlKey: true });
    press({ key: "p", shiftKey: true });
    expect([deck, approve, focus].map((f) => f.mock.calls.length)).toEqual([0, 0, 0]);
    press({ key: "j", ctrlKey: true });
    press({ key: "a", ctrlKey: true, shiftKey: true });
    press({ key: "A", ctrlKey: true, shiftKey: true });
    // Caps Lock: the letter is typed in capitals without Shift held.
    press({ key: "P" });
    expect([deck, approve, focus].map((f) => f.mock.calls.length)).toEqual([1, 2, 1]);
  });
});

/* ---- layouts and platforms ------------------------------------------------------------- */
describe("R1 layouts, platforms and the home key", () => {
  it("C31 a digit is the key that types it, with or without Shift (AZERTY); Shift+digit is the physical key", () => {
    const ev = (init: KeyboardEventInit) => new KeyboardEvent("keydown", init);
    // US: 1 is "1"; Shift+1 is "!" on the same physical key.
    expect(matchesCombo("1", ev({ key: "1", code: "Digit1" }), false)).toBe(true);
    expect(matchesCombo("1", ev({ key: "!", code: "Digit1", shiftKey: true }), false)).toBe(false);
    expect(matchesCombo("Shift+1", ev({ key: "!", code: "Digit1", shiftKey: true }), false)).toBe(true);
    expect(matchesCombo("Shift+1", ev({ key: "1", code: "Digit1" }), false)).toBe(false);
    // AZERTY: the digit row is shifted: Shift+& types "1".
    expect(matchesCombo("1", ev({ key: "1", code: "Digit1", shiftKey: true }), false)).toBe(true);
    expect(matchesCombo("1", ev({ key: "&", code: "Digit1" }), false)).toBe(false);
    // The digit's neighbours are not it.
    expect(matchesCombo("1", ev({ key: "2", code: "Digit2" }), false)).toBe(false);
    expect(matchesCombo("Shift+1", ev({ key: "@", code: "Digit2", shiftKey: true }), false)).toBe(false);
    // Mod keeps its meaning.
    expect(matchesCombo("Mod+1", ev({ key: "1", code: "Digit1", ctrlKey: true }), false)).toBe(true);
    expect(matchesCombo("Mod+1", ev({ key: "1", code: "Digit1", metaKey: true }), false)).toBe(false);
  });

  it("C31 in the Núcleo an AZERTY 1 travels, Shift+P does not open the focus mode and Caps Lock P does", async () => {
    await mountShell("/runs", "nucleo");
    blur();
    press({ key: "1", code: "Digit1", shiftKey: true });
    await waitFor(() => expect(hash()).toBe("#/"));
    await waitFor(() => expect(document.querySelectorAll("section.nu-scene").length).toBe(1), {
      timeout: 5000,
    });
    press({ key: "p", shiftKey: true });
    await settle();
    expect(document.querySelector(".nu-focus"), "Shift+P").toBeNull();
    press({ key: "P" });
    await waitFor(() => expect(document.querySelector(".nu-focus"), "Caps Lock P").not.toBeNull());
  });

  it("C31 Ctrl+M opens and closes the palette on a Mac too; Ctrl+K does not; Cmd+M does", async () => {
    simulatePlatform("MacIntel");
    await mountShell("/", "moldura");
    const palette = () => screen.queryByRole("dialog", { name: "Command palette" });
    blur();
    press({ key: "k", ctrlKey: true });
    await settle();
    expect(palette(), "Ctrl+K on a Mac").toBeNull();
    for (const init of [{ ctrlKey: true }, { metaKey: true }]) {
      press({ key: "m", ...init });
      await waitFor(() => expect(palette(), JSON.stringify(init)).not.toBeNull());
      press({ key: "m", ...init }, document.activeElement ?? document.body);
      await waitFor(() => expect(palette(), JSON.stringify(init)).toBeNull());
    }
  });

  it("C31 Esc goes home only from somewhere that is not home, and only in the Núcleo", async () => {
    const registry = await mountShell("/", "nucleo");
    const home = () => registry.list().find((c) => c.id === "global.home")!;
    expect(home().when!(), "at the core").toBe(false);
    blur();
    press({ key: "Escape" });
    await settle();
    expect(hash()).toBe("#/");
    press({ key: "3" });
    await waitFor(() => expect(hash()).toBe("#/runs"));
    expect(home().when!(), "in a scene").toBe(true);
    cleanup();

    const frame = await mountShell("/runs", "moldura");
    expect(
      frame.list().some((c) => c.id === "global.home"),
      "the frame has no way home by Esc",
    ).toBe(false);
  });
});

/* ---- the palette's asynchronous actions (AD-014) ------------------------------------------- */
describe("R1 the palette closes at once on an action that talks to the server", () => {
  type Lang = "en" | "pt-BR";
  const LANGS: Lang[] = ["en", "pt-BR"];
  const fmt = (template: string, params: Record<string, string | number>) =>
    template.replace(/\{(\w+)\}/g, (_, key: string) => String(params[key]));
  /** What the providers hold, read from inside them. */
  const held = { client: null as QueryClient | null, items: [] as NotificationItem[] };
  function Spy() {
    held.client = useQueryClient();
    held.items = useNotifications().items;
    return null;
  }
  const gone = () =>
    waitFor(() =>
      expect(screen.queryByRole("dialog", { name: /^(Command palette|Paleta de comandos)$/ })).toBeNull(),
    );
  const toastOf = async (text: string) => (await screen.findByText(text)).closest(".toast")!;

  /** Mount the frame, open the palette and choose the row of `id`; the palette must be gone before the server answers. */
  const choose = async (lang: Lang, id: string, setup: () => void = () => undefined) => {
    const onMetaChanged = vi.fn();
    await mountShell("/", "moldura", lang, undefined, { onMetaChanged, inside: <Spy /> });
    setup();
    blur();
    press({ key: "k", ctrlKey: true });
    await screen.findByRole("combobox");
    await waitFor(() => expect(document.getElementById(`palette-list-${id}`), id).not.toBeNull());
    const invalidate = vi.spyOn(held.client!, "invalidateQueries");
    fireEvent.click(document.getElementById(`palette-list-${id}`)!);
    await gone();
    return { onMetaChanged, invalidate };
  };
  const after = () => {
    document.documentElement.removeAttribute("data-theme");
    cleanup();
  };

  it("C32 the palette closes first; the answer navigates to Settings and says so in a toast", async () => {
    let answer!: (report: unknown) => void;
    server.doctor = () => new Promise((resolve) => (answer = resolve));
    await mountShell("/", "moldura");
    blur();
    press({ key: "k", ctrlKey: true });
    const input = (await screen.findByRole("combobox")) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "diagnostics" } });
    await waitFor(() => expect(document.getElementById("palette-list-action:doctor")).not.toBeNull());
    fireEvent.keyDown(input, { key: "Enter" });
    await gone();
    expect(api.get).toHaveBeenCalledWith("/api/doctor?audit=0");
    expect(hash()).toBe("#/");
    await act(async () => answer({ ok: 3, warn: 1, fail: 0 }));
    await waitFor(() => expect(hash()).toBe("#/settings?tab=diagnostics"));
    await screen.findByText("Doctor: 3 ok · 1 warnings · 0 failures");
  });

  it("C32 each of the five actions says it worked, in both languages: the toast, its tone and what it did", async () => {
    for (const lang of LANGS) {
      const d = dictionaries[lang];
      const toastText = (id: string, params: Record<string, string | number>) => {
        const key = {
          "action:reindex": "shell.action.reindexDone",
          "action:backup": "shell.action.backupDone",
          "action:doctor": "shell.action.doctorDone",
          "action:toggle-theme": "shell.palette.themeToggled",
        }[id] as keyof typeof d;
        return fmt(d[key], params);
      };
      const putSettings = () =>
        vi.mocked(api.putSettings).mockResolvedValue({ settings: {}, pendingApproval: null });
      type Row = {
        label: string;
        id: string;
        setup: () => void;
        text: string;
        tone: "ok" | "danger";
        effect: (spied: Awaited<ReturnType<typeof choose>>) => void;
      };
      const doctor = (report: { ok: number; warn: number; fail: number }): Row => {
        const tone = report.fail > 0 ? "danger" : "ok";
        const text = toastText("action:doctor", report);
        return {
          label: `doctor ${JSON.stringify(report)}`,
          id: "action:doctor",
          setup: () => (server.doctor = () => Promise.resolve(report)),
          text,
          tone,
          effect: () => {
            expect(hash()).toBe("#/settings?tab=diagnostics");
            // The report is kept for the Diagnostics tab, and the bell has a line about it.
            expect(held.client!.getQueryData(qk.doctor)).toEqual(report);
            expect(held.items.filter((i) => i.kind === "system")).toEqual([
              expect.objectContaining({
                kind: "system",
                title: d["shell.action.doctor"],
                body: text,
                href: "/settings?tab=diagnostics",
                tone,
              }),
            ]);
          },
        };
      };
      const theme = (from: "dark" | "light", next: "dark" | "light"): Row => ({
        label: `theme ${from} → ${next}`,
        id: "action:toggle-theme",
        setup: () => {
          document.documentElement.dataset.theme = from;
          putSettings();
        },
        text: toastText("action:toggle-theme", { theme: next }),
        tone: "ok",
        effect: ({ onMetaChanged }) => {
          expect(api.putSettings).toHaveBeenCalledWith({ theme: next });
          // The shell reads the theme again, or it only takes at the next refresh.
          expect(onMetaChanged).toHaveBeenCalledTimes(1);
        },
      });
      const rows: Row[] = [
        {
          label: "reindex",
          id: "action:reindex",
          setup: () => vi.mocked(api.post).mockResolvedValue({}),
          text: toastText("action:reindex", {}),
          tone: "ok",
          effect: ({ invalidate }) => {
            expect(api.post).toHaveBeenCalledWith("/api/memory/index");
            expect(invalidate).toHaveBeenCalledWith({ queryKey: ["memory"] });
          },
        },
        {
          label: "backup",
          id: "action:backup",
          setup: () => vi.mocked(api.post).mockResolvedValue({ name: "b-2026" }),
          text: toastText("action:backup", { name: "b-2026" }),
          tone: "ok",
          effect: ({ invalidate }) => {
            expect(api.post).toHaveBeenCalledWith("/api/backups", {});
            expect(invalidate).toHaveBeenCalledWith({ queryKey: qk.backups });
          },
        },
        // Failures make it dangerous; warnings alone do not. One failure is enough.
        doctor({ ok: 5, warn: 0, fail: 0 }),
        doctor({ ok: 3, warn: 1, fail: 2 }),
        doctor({ ok: 4, warn: 0, fail: 1 }),
        doctor({ ok: 4, warn: 2, fail: 0 }),
        theme("dark", "light"),
        theme("light", "dark"),
        {
          label: "switch interface",
          id: "action:switch-shell",
          setup: () =>
            vi.mocked(api.putUiPreferences).mockResolvedValue({ ...server.prefs, shell: "nucleo" } as never),
          text: d["moldura.palette.switchedToNucleo"],
          tone: "ok",
          effect: () => expect(api.putUiPreferences).toHaveBeenCalledWith({ shell: "nucleo" }),
        },
      ];
      for (const row of rows) {
        const spied = await choose(lang, row.id, row.setup);
        const toast = await toastOf(row.text);
        expect(toast.classList.contains(row.tone), `${lang} ${row.label}: ${toast.className}`).toBe(true);
        expect(toast.classList.contains(row.tone === "ok" ? "danger" : "ok"), `${lang} ${row.label}`).toBe(
          false,
        );
        await waitFor(() => row.effect(spied));
        after();
      }
    }
  }, 240_000);

  it("C32 a failure of any of the five is a dangerous toast that names the action; the palette stays closed", async () => {
    const boom = () => Promise.reject(new Error("boom"));
    for (const lang of LANGS) {
      const d = dictionaries[lang];
      const rows: Array<[id: string, label: string, fail: () => void]> = [
        ["action:reindex", d["shell.action.reindex"], () => vi.mocked(api.post).mockImplementation(boom)],
        ["action:backup", d["shell.action.backup"], () => vi.mocked(api.post).mockImplementation(boom)],
        ["action:doctor", d["shell.action.doctor"], () => (server.doctor = boom)],
        [
          "action:toggle-theme",
          d["shell.action.toggleTheme"],
          () => vi.mocked(api.putSettings).mockImplementation(boom),
        ],
        [
          "action:switch-shell",
          d["moldura.palette.toNucleo"],
          () => vi.mocked(api.putUiPreferences).mockImplementation(boom),
        ],
      ];
      for (const [id, label, fail] of rows) {
        await choose(lang, id, fail);
        const toast = await toastOf(fmt(d["shell.action.failed"], { action: label, error: "boom" }));
        expect(toast.classList.contains("danger"), `${lang} ${id}: ${toast.className}`).toBe(true);
        expect(hash(), id).toBe("#/");
        after();
      }
    }
  }, 240_000);

  it("C32 the frame's own row, 'Open the skill deck', opens the deck (it replaced an event)", async () => {
    await mountShell("/", "moldura");
    blur();
    press({ key: "k", ctrlKey: true });
    await screen.findByRole("combobox");
    await waitFor(() => expect(document.getElementById("palette-list-action:skill-deck")).not.toBeNull());
    // The frame has no key for it: ⌘J is the Núcleo's.
    expect(document.getElementById("palette-list-action:skill-deck")!.querySelector(".pr-keys")).toBeNull();
    expect(document.querySelector(".skill-deck")).toBeNull();
    fireEvent.click(document.getElementById("palette-list-action:skill-deck")!);
    await gone();
    await waitFor(() => expect(document.querySelector(".skill-deck")).not.toBeNull());
  });

  it("C32 what the actions say exists in both languages, with the same holes, and is translated", () => {
    const keys = [
      "shell.action.reindex",
      "shell.action.reindexDone",
      "shell.action.backup",
      "shell.action.backupDone",
      "shell.action.doctor",
      "shell.action.doctorDone",
      "shell.action.toggleTheme",
      "shell.palette.themeToggled",
      "shell.action.failed",
      "moldura.palette.toNucleo",
      "moldura.palette.toFrame",
      "moldura.palette.switchedToNucleo",
      "moldura.palette.switchedToFrame",
    ] as const;
    const holes = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
    for (const key of keys) {
      const en = dictionaries.en[key];
      const pt = dictionaries["pt-BR"][key];
      expect(en.length, `en ${key}`).toBeGreaterThan(3);
      expect(pt.length, `pt-BR ${key}`).toBeGreaterThan(3);
      expect(pt, `${key} is not translated`).not.toBe(en);
      expect(holes(pt), `${key} holes`).toEqual(holes(en));
    }
    // The two switch notices say where you are now, and differ from each other, in each language.
    for (const lang of ["en", "pt-BR"] as const)
      expect(dictionaries[lang]["moldura.palette.switchedToNucleo"]).not.toBe(
        dictionaries[lang]["moldura.palette.switchedToFrame"],
      );
  });
});

/* ---- the help hides what an inner scope covers (AC 17) -------------------------------------- */
describe("R1 the shortcuts sheet says each key once, with the meaning it has here", () => {
  const chips = (help: Awaited<ReturnType<typeof openHelp>>, combo: string) =>
    help.flatMap((b) => b.rows.filter((r) => r.combos.includes(combo)).map((r) => `${b.scope}:${r.id}`));

  it("C33 Pixel Studio inside the Núcleo: 1-4, [, ] and Esc appear once, as Pixel's", async () => {
    await mountShell("/pixel", "nucleo");
    await screen.findByRole("button", { name: /Eraser/ }, { timeout: 5000 });
    const help = await openHelp();
    for (const [combo, command] of [
      ["1", "pixel.tool.pencil"],
      ["2", "pixel.tool.eraser"],
      ["3", "pixel.tool.fill"],
      ["4", "pixel.tool.eyedropper"],
      ["[", "pixel.prevFrame"],
      ["]", "pixel.nextFrame"],
      ["Esc", "pixel.leave"],
    ] as const)
      expect(chips(help, combo), combo).toEqual([`view:pixel:${command}`]);
    // What Pixel does not take stays the Núcleo's.
    expect(chips(help, "5")).toEqual(["nucleo:nucleo.scene.routines"]);
    expect(chips(help, "P")).toEqual(["nucleo:nucleo.focus"]);
    // The row of a command that lost every key is gone, not empty.
    const ids = help.flatMap((b) => b.rows.map((r) => r.id));
    for (const gone of [
      "nucleo.scene.nucleo",
      "nucleo.scene.brain",
      "nucleo.prev",
      "nucleo.escape",
      "global.home",
    ])
      expect(ids, gone).not.toContain(gone);
  });

  it("C33 at the core, Esc is the Núcleo's (the global way home is behind it)", async () => {
    await mountShell("/", "nucleo");
    const help = await openHelp();
    expect(chips(help, "Esc")).toEqual(["nucleo:nucleo.escape"]);
  });

  it("C33 one physical key is one chip group: Ctrl+K and Ctrl+M off a Mac, ⌘K, ⌘M and ⌃M on one", async () => {
    for (const [platform, expected] of [
      ["Linux x86_64", ["Ctrl+K", "Ctrl+M"]],
      ["MacIntel", ["⌘+K", "⌘+M", "⌃+M"]],
    ] as const) {
      simulatePlatform(platform);
      await mountShell("/", "moldura");
      const help = await openHelp();
      const row = help.flatMap((b) => b.rows).find((r) => r.id === "palette.open")!;
      expect(row.combos, platform).toEqual(expected);
      cleanup();
    }
  });
});
