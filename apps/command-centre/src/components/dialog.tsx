/**
 * Shared dialog machinery: portal into #modal-root, focus trap, initial
 * focus, focus restore, Escape handled on the dialog (never leaking to the
 * OS shell) and `inert` on everything behind the top-most dialog.
 */
import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
const FIELD = 'input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled])';

/** Open dialogs, bottom → top. Only the top one traps focus. */
const stack: HTMLElement[] = [];

/* ---- depth store: how many dialogs are open (drives the depth push) ---- */
const depthListeners = new Set<() => void>();
function notifyDepth() {
  for (const fn of depthListeners) fn();
}
export function getDialogDepth(): number {
  return stack.length;
}
export function subscribeDialogDepth(fn: () => void): () => void {
  depthListeners.add(fn);
  return () => {
    depthListeners.delete(fn);
  };
}
/** Number of open dialogs (Modal, Confirm, palette). The shell sets `data-depth="pushed"` when > 0. */
export function useDialogDepth(): number {
  return useSyncExternalStore(subscribeDialogDepth, getDialogDepth, () => 0);
}

function syncInert() {
  const top = stack[stack.length - 1];
  const root = document.getElementById("root");
  if (root) {
    for (const child of Array.from(root.children)) {
      if (child.classList.contains("toast-wrap")) continue;
      if (top) child.setAttribute("inert", "");
      else child.removeAttribute("inert");
    }
  }
  const portal = document.getElementById("modal-root");
  if (portal) {
    for (const child of Array.from(portal.children)) {
      const el = child as HTMLElement;
      const isTop = top ? el === top || el.contains(top) : false;
      if (top && !isTop) el.setAttribute("inert", "");
      else el.removeAttribute("inert");
    }
  }
}

export function focusables(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
    (el) => !el.hasAttribute("inert") && el.offsetParent !== null,
  );
}

export interface UseDialogOptions {
  /** Where focus lands on open; default: first field, else the dialog itself. */
  initialFocus?: () => HTMLElement | null | undefined;
}

/**
 * Attach to the element carrying role="dialog" (give it tabIndex={-1}).
 * `onClose` may be an inline arrow: it is read through a ref, so the effect
 * runs once per mount and focus is never stolen on parent re-renders.
 */
export function useDialog(ref: RefObject<HTMLElement>, onClose: () => void, opts: UseDialogOptions = {}): void {
  const onCloseRef = useRef(onClose);
  const initialRef = useRef(opts.initialFocus);
  useLayoutEffect(() => {
    onCloseRef.current = onClose;
    initialRef.current = opts.initialFocus;
  });

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const previous = document.activeElement as HTMLElement | null;
    // The portal child is the backdrop; the dialog may be nested inside it.
    const portalChild = el.closest("#modal-root > *") as HTMLElement | null;
    const entry = portalChild ?? el;
    stack.push(entry);
    syncInert();
    notifyDepth();

    const target =
      initialRef.current?.() ??
      el.querySelector<HTMLElement>(FIELD) ??
      focusables(el).find((f) => !f.hasAttribute("data-dialog-close")) ??
      el;
    const raf = requestAnimationFrame(() => target.focus({ preventScroll: true }));

    const onKey = (e: KeyboardEvent) => {
      if (stack[stack.length - 1] !== entry) return;
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        onCloseRef.current();
        return;
      }
      if (e.key !== "Tab") return;
      const items = focusables(el);
      if (items.length === 0) {
        e.preventDefault();
        el.focus();
        return;
      }
      const first = items[0]!;
      const last = items[items.length - 1]!;
      const active = document.activeElement as HTMLElement | null;
      if (e.shiftKey && (active === first || active === el || !el.contains(active))) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && (active === last || !el.contains(active))) {
        e.preventDefault();
        first.focus();
      }
    };
    el.addEventListener("keydown", onKey);
    return () => {
      cancelAnimationFrame(raf);
      el.removeEventListener("keydown", onKey);
      const i = stack.lastIndexOf(entry);
      if (i >= 0) stack.splice(i, 1);
      syncInert();
      notifyDepth();
      if (previous && previous.isConnected && typeof previous.focus === "function") previous.focus({ preventScroll: true });
    };
  }, [ref]);
}

/** Render dialog markup outside the OS shell so the shell can be made inert. */
export function DialogPortal({ children }: { children: ReactNode }) {
  const host = document.getElementById("modal-root") ?? document.body;
  return createPortal(children, host);
}

/**
 * Keep a node mounted while its exit animation plays.
 * `mounted` → render it; `closing` → add the exit class.
 */
export function usePresence(open: boolean, exitMs = 160): { mounted: boolean; closing: boolean } {
  const [mounted, setMounted] = useState(open);
  const [closing, setClosing] = useState(false);
  useEffect(() => {
    if (open) {
      setMounted(true);
      setClosing(false);
      return;
    }
    if (!mounted) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setMounted(false);
      return;
    }
    setClosing(true);
    const timer = window.setTimeout(() => {
      setMounted(false);
      setClosing(false);
    }, exitMs);
    return () => window.clearTimeout(timer);
  }, [open, mounted, exitMs]);
  return { mounted, closing };
}
