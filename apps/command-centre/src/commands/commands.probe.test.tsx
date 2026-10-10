// @vitest-environment jsdom
/**
 * Commands and shortcuts, C16's runtime probe (.specs/features/comandos-atalhos).
 * The source reader proves what it can read; this counts what actually reaches
 * the page: every `keydown` listener added to `window`, `document`, `body`,
 * `documentElement` or the app's root elements, from the first line of this
 * file — `vi.hoisted` runs before any import, so what a statically imported
 * module does when it loads is recorded too and is never discarded — while
 * both shells and every screen mount and the dialogs open. Exactly one listener
 * site is the registry's (one listener per mounted provider); every other site
 * is one the allowlist declares, and a file never has more sites than it is
 * allowed. The recorder patches `EventTarget.prototype.addEventListener` (and
 * `window`'s own method), so it does not matter how the call is spelled. The
 * `on…` properties of the page are checked as well: they stay null.
 */
import { act, cleanup, fireEvent } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type * as ApiModule from "../api";
import { OUTSIDE_THE_REGISTRY } from "./listenersAllowlist";
import { installHarness, mountShell } from "./testkit";

// Before any import of the app (vi.hoisted runs first): record what reaches the page.
const probe = vi.hoisted(() => {
  // React sits between an effect and the app's own frame: look deep.
  Error.stackTraceLimit = 80;
  /** One entry per listener added: the file and the call site that added it. */
  const seen: Array<{ file: string; site: string }> = [];
  /**
   * Where a listener was added from: the first frame that is the app's own source — or React DOM, which
   * delegates every event (keydown included) to the container of each root and portal. That one is
   * how `onKeyDown` works, not a listener of the app; it is counted apart and never allowed to grow.
   */
  const origin = () => {
    for (const line of (new Error().stack ?? "").split("\n")) {
      if (/commands\/(testkit|commands\.)/.test(line)) continue;
      const m = /\/src\/(.+?\.tsx?):(\d+):(\d+)/.exec(line);
      if (m && !line.includes("node_modules")) return { file: m[1]!, site: `${m[1]}:${m[2]}:${m[3]}` };
      if (line.includes("node_modules/react-dom/")) return { file: "react-dom", site: "react-dom" };
    }
    return { file: "unknown", site: "unknown" };
  };
  /** The page: the window, the document, its body and root element, and the app's own roots. */
  const onPage = (target: unknown) =>
    target === window ||
    target === document ||
    target === document.body ||
    target === document.documentElement ||
    (target instanceof Element && (target.id === "root" || target.id === "modal-root"));
  const wrap = (owner: object) => {
    const original = (owner as { addEventListener: EventTarget["addEventListener"] }).addEventListener;
    (owner as { addEventListener: unknown }).addEventListener = function (
      this: EventTarget,
      ...args: Parameters<typeof original>
    ) {
      if (args[0] === "keydown" && onPage(this)) seen.push(origin());
      return original.apply(this, args);
    };
  };
  wrap(EventTarget.prototype);
  // jsdom's window has a method of its own, which the prototype's does not see.
  if (Object.prototype.hasOwnProperty.call(window, "addEventListener")) wrap(window);
  return { seen };
});

vi.mock("../api", async (importOriginal) =>
  (await import("./testserver")).mockApi(await importOriginal<typeof ApiModule>()),
);
// The brain's canvases paint through WebGL / a 2D context jsdom does not have.
vi.mock("../brain/BrainCanvas", () => ({ BrainCanvas: () => null }));
vi.mock("../nucleo/scenes/BrainSceneCanvas", () => ({ BrainSceneCanvas: () => null }));

installHarness();

const REGISTRY = "commands/registry.ts";
/** React DOM's own delegation of keydown to the roots and portals (how `onKeyDown` works): not the app's. */
const REACT = "react-dom";
const startup = probe.seen.slice().filter((e) => e.file !== REACT);

/** The `on…` handlers of the page, which are another way to listen: all null. */
const onHandlers = () =>
  Object.fromEntries(
    [
      ["window", window],
      ["document", document],
      ["body", document.body],
      ["documentElement", document.documentElement],
      ["root", document.getElementById("root")],
      ["modal-root", document.getElementById("modal-root")],
    ]
      .filter(([, target]) => target)
      .map(([name, target]) => [name as string, (target as { onkeydown: unknown }).onkeydown]),
  );

/** The sites each file has put on the page, over everything recorded. */
const sitesByFile = (entries: Array<{ file: string; site: string }>) => {
  const out = new Map<string, Set<string>>();
  for (const { file, site } of entries) out.set(file, (out.get(file) ?? new Set()).add(site));
  return out;
};

describe("C16 what reaches the page while the app mounts", () => {
  it("C16 what the modules do when they load is seen: none of it is the registry's, all of it is listed", () => {
    // The recorder was installed before the app's first import: the static modules have loaded by now.
    expect(startup.filter((e) => e.file === REGISTRY)).toEqual([]);
    for (const { file, site } of startup)
      expect(file in OUTSIDE_THE_REGISTRY, `${site} put a keydown listener on the page when it loaded`).toBe(
        true,
      );
    expect(Object.values(onHandlers()).every((handler) => handler === null)).toBe(true);
  });

  it("C16 each shell and each screen puts exactly one registry listener on the page, and none that is not listed", async () => {
    const states: Array<["nucleo" | "moldura", string]> = [
      ...[
        "/",
        "/runs/r1",
        "/skills/demo",
        "/pixel",
        "/brain",
        "/settings",
        "/routines",
        "/connectors",
        "/artifacts",
        "/generations",
      ].map((p) => ["moldura", p] as ["moldura", string]),
      ...[
        "/",
        "/brain",
        "/runs",
        "/runs/r1",
        "/skills",
        "/routines",
        "/pixel",
        "/settings",
        "/connectors",
      ].map((p) => ["nucleo", p] as ["nucleo", string]),
    ];
    expect(states.length).toBeGreaterThan(15);
    const press = (init: KeyboardEventInit) => act(() => void fireEvent.keyDown(document.body, init));
    const check = (label: string, from: number) => {
      const mine = probe.seen.slice(from);
      expect(
        mine.filter((e) => e.file === REGISTRY),
        `${label}: ${JSON.stringify(mine)}`,
      ).toHaveLength(1);
      for (const { file, site } of mine.filter((e) => e.file !== REGISTRY && e.file !== REACT))
        expect(file in OUTSIDE_THE_REGISTRY, `${label} — ${site} is not in the allowlist`).toBe(true);
      expect(onHandlers(), `${label}: an on… handler was set on the page`).toEqual(
        Object.fromEntries(Object.keys(onHandlers()).map((k) => [k, null])),
      );
    };
    for (const [shell, path] of states) {
      const from = probe.seen.length;
      await mountShell(path, shell);
      await act(async () => new Promise((resolve) => setTimeout(resolve, 400)));
      check(`${shell} ${path}`, from);
      cleanup();
    }

    // With the layers up: the palette and the help (dialogs), the deck, the focus mode.
    for (const [shell, keys] of [
      ["moldura", [{ key: "k", ctrlKey: true }]],
      ["moldura", [{ key: "?", shiftKey: true }]],
      ["nucleo", [{ key: "j", ctrlKey: true }]],
      ["nucleo", [{ key: "p" }]],
    ] as const) {
      const from = probe.seen.length;
      await mountShell("/", shell);
      for (const init of keys) press(init);
      await act(async () => new Promise((resolve) => setTimeout(resolve, 400)));
      check(`${shell} with ${JSON.stringify(keys)}`, from);
      cleanup();
    }

    // Over the whole run: one registry site, and no file with more sites than the allowlist says.
    const sites = sitesByFile(probe.seen);
    expect([...(sites.get(REGISTRY) ?? [])].length, "the registry's sites").toBe(1);
    for (const [file, set] of sites) {
      if (file === REGISTRY || file === REACT) continue;
      const allowedHere = OUTSIDE_THE_REGISTRY[file]?.[0] ?? 0;
      expect(
        [...set].length,
        `${file} put keydown listeners from ${[...set].join(", ")}`,
      ).toBeLessThanOrEqual(allowedHere);
    }
    // The dialogs did open: the probe reached the listeners it is there to count.
    expect(sites.has("components/dialog.tsx")).toBe(true);
  }, 300_000);

  it("C16 the probe sees a listener the source reader cannot read, wherever it is spelled", () => {
    const before = probe.seen.length;
    const add = (window as unknown as Record<string, (t: string, f: () => void) => void>)[
      "add" + "EventListener"
    ]!;
    add.call(window, "keydown", () => undefined);
    const { addEventListener: detached } = EventTarget.prototype;
    detached.call(document.body, "keydown", () => undefined);
    detached.call(document.documentElement, "keydown", () => undefined);
    expect(probe.seen.length).toBe(before + 3);
    // …and a listener on an element of the screen is not on the page.
    document.createElement("div").addEventListener("keydown", () => undefined);
    expect(probe.seen.length).toBe(before + 3);
    // …nor is another event.
    window.addEventListener("resize", () => undefined);
    expect(probe.seen.length).toBe(before + 3);
  });
});
