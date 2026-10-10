/**
 * Route transitions (analysis item 13). `useOsNavigate()` wraps react-router's
 * navigate in `document.startViewTransition` when the browser supports it and
 * the user has not asked for reduced motion; otherwise it navigates directly
 * and `.route-surface` plays its 160 ms fade.
 */
import { useCallback } from "react";
import { flushSync } from "react-dom";
import { useNavigate, type NavigateOptions, type To } from "react-router-dom";

interface ViewTransitionLike {
  finished: Promise<void>;
  ready: Promise<void>;
}
type StartViewTransition = (update: () => void | Promise<void>) => ViewTransitionLike;

export function supportsViewTransition(): boolean {
  return (
    typeof document !== "undefined" &&
    typeof (document as Document & { startViewTransition?: StartViewTransition }).startViewTransition ===
      "function"
  );
}

export function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

export interface TransitionOptions {
  /** Runs inside the same synchronous update as the navigation (e.g. close the palette so its tile is gone in the new snapshot). */
  before?: () => void;
}

/**
 * Run a DOM update inside a view transition (falls back to a plain call).
 * `html[data-vt]` is set while the transition runs so CSS can mute the
 * fallback fade.
 */
export function withViewTransition(update: () => void): Promise<void> {
  const doc = document as Document & { startViewTransition?: StartViewTransition };
  if (!doc.startViewTransition || prefersReducedMotion()) {
    update();
    return Promise.resolve();
  }
  const html = document.documentElement;
  html.dataset.vt = "1";
  const cleanup = () => {
    delete html.dataset.vt;
  };
  try {
    const vt = doc.startViewTransition(update);
    // `ready` can reject (an aborted transition) even though the DOM update succeeded.
    void vt.ready.catch(() => undefined);
    return vt.finished.then(cleanup, cleanup);
  } catch {
    cleanup();
    update();
    return Promise.resolve();
  }
}

export type OsNavigate = (to: To | number, opts?: NavigateOptions & TransitionOptions) => void;

/** `useNavigate` with view transitions. Drop-in for `useNavigate()` in shell code. */
export function useOsNavigate(): OsNavigate {
  const navigate = useNavigate();
  return useCallback<OsNavigate>(
    (to, opts = {}) => {
      const { before, ...navOpts } = opts;
      const go = () => {
        before?.();
        if (typeof to === "number") navigate(to);
        else navigate(to, navOpts);
      };
      void withViewTransition(() => flushSync(go));
    },
    [navigate],
  );
}
