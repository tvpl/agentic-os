/**
 * What the primitives' tests share (.specs/features/primitivas): the page the
 * app gives them (`#root` for the shell, `#modal-root` for the layers), the
 * browser pieces jsdom lacks, and a switch for "reduced motion".
 */
import type { ReactElement } from "react";
import { afterEach, beforeEach, vi } from "vitest";
import { cleanup, render, type RenderResult } from "@testing-library/react";
import { I18nContext } from "../i18n";

export const motion = { reduced: false };

/** Register the shims and the per-test reset. Call once, at the top of a test file. */
export function installPage() {
  beforeEach(() => {
    motion.reduced = false;
    document.body.innerHTML = '<div id="root"></div><div id="modal-root"></div>';
    window.matchMedia = ((query: string) => ({
      matches: query.includes("prefers-reduced-motion: reduce") ? motion.reduced : false,
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
    // jsdom has no layout: every element reads as laid out, so `focusables` can find the controls.
    Object.defineProperty(HTMLElement.prototype, "offsetParent", {
      configurable: true,
      get() {
        return this.parentNode;
      },
    });
  });
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    document.body.innerHTML = "";
  });
}

/** Render into a fresh node of the page's `#root`, the way the app mounts, with the English strings. */
export function mount(ui: ReactElement): RenderResult {
  const container = document.createElement("div");
  container.className = "app";
  document.getElementById("root")!.appendChild(container);
  return render(
    <I18nContext.Provider value={{ lang: "en", setLang: () => undefined }}>{ui}</I18nContext.Provider>,
    { container },
  );
}

/** Let the timers Radix sets at mount (the outside-press listener is added on the next tick) run. */
export const tick = (ms = 5) => new Promise<void>((resolve) => setTimeout(resolve, ms));
