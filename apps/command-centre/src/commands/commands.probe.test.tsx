// @vitest-environment jsdom
/**
 * Commands and shortcuts, C16's runtime probe (.specs/features/comandos-atalhos).
 * The source reader proves what it can read; this counts what actually reaches
 * the page: every `keydown` listener added to `window`, `document`, `body` or
 * `documentElement` from the moment the test file starts — before any module of
 * the app is imported, so a listener added when a module loads is seen — while
 * both shells and every screen mount. Exactly one is the registry's; the others
 * are the ones the allowlist declares.
 */
import { cleanup } from "@testing-library/react";
import { act } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type * as ApiModule from "../api";
import { OUTSIDE_THE_REGISTRY } from "./listenersAllowlist";
import { installHarness, mountShell } from "./testkit";

// Before any import of the app (vi.hoisted runs first): record what reaches the page.
const probe = vi.hoisted(() => {
  const seen: string[] = [];
  /** Where a listener was added from: the first frame of the app's own source in the stack. */
  const origin = () => {
    const frame = (new Error().stack ?? "")
      .split("\n")
      .find((l) => /\/src\/(?!commands\/(testkit|commands\.))/.test(l) && !l.includes("node_modules"));
    return /\/src\/(.+?\.tsx?)/.exec(frame ?? "")?.[1] ?? `unknown: ${frame}`;
  };
  for (const target of [window, document, document.body, document.documentElement]) {
    const add = target.addEventListener;
    target.addEventListener = function (this: EventTarget, ...args: Parameters<typeof add>) {
      if (args[0] === "keydown") seen.push(origin());
      return add.apply(this, args);
    } as typeof add;
  }
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
const allowed = new Set(Object.keys(OUTSIDE_THE_REGISTRY));

describe("C16 what reaches the page while the app mounts", () => {
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
    // Modules load as the screens mount (lazy chunks): what a module does when it loads is in here too.
    probe.seen.length = 0;
    for (const [shell, path] of states) {
      const from = probe.seen.length;
      await mountShell(path, shell);
      await act(async () => new Promise((resolve) => setTimeout(resolve, 400)));
      const mine = probe.seen.slice(from);
      const label = `${shell} ${path}: ${JSON.stringify(mine)}`;
      expect(
        mine.filter((f) => f === REGISTRY),
        label,
      ).toHaveLength(1);
      for (const file of mine.filter((f) => f !== REGISTRY))
        expect(allowed.has(file), `${label} — ${file} is not in the allowlist`).toBe(true);
      cleanup();
    }
  }, 240_000);

  it("C16 the probe sees a listener the source reader cannot read", () => {
    // A listener put on the page by a name the reader cannot follow still passes through the probe.
    const before = probe.seen.length;
    const add = (window as unknown as Record<string, (t: string, f: () => void) => void>)[
      "add" + "EventListener"
    ]!;
    add.call(window, "keydown", () => undefined);
    expect(probe.seen.length).toBe(before + 1);
    // …and a listener on an element is not on the page.
    document.createElement("div").addEventListener("keydown", () => undefined);
    expect(probe.seen.length).toBe(before + 1);
  });
});
