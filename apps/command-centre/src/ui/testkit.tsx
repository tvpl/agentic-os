/**
 * What the primitives' tests share (.specs/features/primitivas): the page the
 * app gives them (`#root` for the shell, `#modal-root` for the layers), the
 * browser pieces jsdom lacks, and a switch for "reduced motion".
 */
import type { ReactElement } from "react";
import { afterEach, beforeEach, vi } from "vitest";
import { act, cleanup, fireEvent, render, type RenderResult } from "@testing-library/react";
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

/**
 * jsdom plays no animation, so a Radix layer is gone the moment it closes and "a layer that is leaving"
 * cannot be seen. This gives every element that carries a `data-state` an exit: while it reads `closed` it
 * has a running animation, so Radix keeps it mounted (still `data-state="closed"`, still in its layer stack)
 * until `finish` ends the animation, as a browser does after the CSS exit. Returns `restore` too.
 */
export function giveLayersAnExit() {
  const real = window.getComputedStyle.bind(window);
  const hadCss = "CSS" in globalThis;
  if (!hadCss) (globalThis as { CSS?: unknown }).CSS = { escape: (name: string) => name };
  window.getComputedStyle = ((el: Element, pseudo?: string | null) => {
    const style = real(el, pseudo);
    if (!el.getAttribute?.("data-state")) return style;
    return new Proxy(style, {
      get(target, key) {
        if (key === "animationName")
          return el.getAttribute("data-state") === "closed" ? "ui-exit" : "ui-enter";
        const value = Reflect.get(target, key) as unknown;
        return typeof value === "function" ? (value as () => unknown).bind(target) : value;
      },
    });
  }) as typeof window.getComputedStyle;
  return {
    /** The exit is over: the layer unmounts. */
    finish: (el: Element) => act(() => void fireEvent.animationEnd(el, { animationName: "ui-exit" })),
    restore: () => {
      window.getComputedStyle = real;
      if (!hadCss) delete (globalThis as { CSS?: unknown }).CSS;
    },
  };
}
