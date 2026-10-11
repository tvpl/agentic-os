/**
 * The stack of dialog layers (.specs/features/primitivas, door 3).
 *
 * Radix owns the focus, Tab and Escape of a dialog it renders; what the rest
 * of the app reads about "a dialog is up" lives here: the stack decides which
 * layer is on top, which part of the page is `inert` behind it, and how many
 * dialogs cover the shell (`getDialogDepth()`, which the command registry's
 * `modal` scope and the shell's depth push both read). A Radix dialog
 * registers with `useDialogLayer`; the two panels that stay where they are in
 * the tree (the narrow sidebar and the conversation drawer, which hold live
 * content and cannot be remounted into a portal) use `useDrawer`, which also
 * does what Radix does for the others: the focus trap, Escape and the restore.
 */
import { useEffect, useLayoutEffect, useRef, useSyncExternalStore, type RefObject } from "react";

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
export const FIELD =
  'input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled])';

/** Open dialog layers, bottom → top. */
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
/**
 * Dialogs that cover the shell (a Modal, a confirmation, the palette: portaled out of it).
 * The shell sets `data-depth="pushed"` when > 0 and recedes behind them. A
 * dialog that lives inside the shell (a drawer of the app frame) is part of
 * what would recede, so it does not count.
 */
function getPushingDepth(): number {
  const root = document.getElementById("root");
  return stack.filter((el) => !root?.contains(el)).length;
}
export function useDialogDepth(): number {
  return useSyncExternalStore(subscribeDialogDepth, getPushingDepth, () => 0);
}

/**
 * Elements inerted below the root's own children: the siblings along the path
 * to a dialog that stays where it is in the tree (see `syncInert`).
 */
const isolated = new Set<Element>();

/**
 * Make everything outside `top` inert by walking up from it to `root` and
 * inerting each level's other children. For a dialog that cannot leave its
 * place in the tree (the app frame's chat drawer holds a live conversation
 * and must not remount to be portaled).
 */
function isolate(top: HTMLElement, root: HTMLElement) {
  for (let node: HTMLElement = top; node !== root && node.parentElement; node = node.parentElement) {
    for (const sibling of Array.from(node.parentElement.children)) {
      if (sibling === node || sibling.classList.contains("toast-wrap")) continue;
      sibling.setAttribute("inert", "");
      isolated.add(sibling);
    }
  }
}

function syncInert() {
  const top = stack[stack.length - 1];
  const root = document.getElementById("root");
  for (const el of isolated) el.removeAttribute("inert");
  isolated.clear();
  if (root) {
    // A dialog portaled out of the root leaves the whole root inert; one that
    // lives inside it keeps its own path to the root alive.
    const inPlace = top !== undefined && root.contains(top);
    for (const child of Array.from(root.children)) {
      if (child.classList.contains("toast-wrap")) continue;
      if (top && !inPlace) child.setAttribute("inert", "");
      else child.removeAttribute("inert");
    }
    if (top && inPlace) isolate(top, root);
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

/*
 * What is up above the screen, for the code that listens on the window before Radix does. Radix hears
 * Escape on the document, after the window, so a scene that listens there answers first and takes the key
 * from the layer on top. Only what is OPEN counts (`data-state`): a layer that is leaving still has its
 * element for the length of its exit, and a second Escape pressed then is not its own.
 */
const HINTS = '.ui-tip[data-state="delayed-open"], .ui-tip[data-state="instant-open"]';
const PANELS = '.popover[data-state="open"], .ui-menu[data-state="open"]';

/**
 * Whether a hint, a popover or a menu is open: Escape belongs to it, one Escape closes one thing. The
 * Escape guards of the scenes ask this.
 */
export function escapeLayerOpen(): boolean {
  return document.querySelector(`${HINTS}, ${PANELS}`) !== null;
}

/**
 * Whether a popover or a menu is open: the letters and arrows of the screen behind it are not the screen's
 * (a menu types to find an item). A hint is not asked: it opens by itself where the pointer rests or focus
 * lands, and does not own the keyboard, so the keys of the scene go on answering under it.
 */
export function keyLayerOpen(): boolean {
  return document.querySelector(PANELS) !== null;
}

/**
 * Escapes a Radix layer took, and whether that layer was already on its way out. Radix keeps a layer in its
 * stack while its exit plays, handles the Escape pressed then and marks it handled; `useDrawer` reads the
 * mark to leave the Escape of a layer that is open to it, and must not leave it the Escape of one that is
 * already closing (the second tap of a quick double tap).
 */
const escapeTakenClosing = new WeakSet<Event>();
export function noteEscape(event: Event, panel: Element | null): void {
  if (panel?.getAttribute("data-state") === "closed") escapeTakenClosing.add(event);
}

/* ---- where focus goes back to when what held it is gone ------------------------------- */

/**
 * The control a floating panel hangs from, by the panel's element. A dialog opened from something inside a
 * menu or a popover (an item that says "Export", a button in the bell) finds that something gone when it
 * closes, because the panel left with the choice: focus then goes to the control the panel hung from.
 */
const hangsFrom = new WeakMap<Element, () => HTMLElement | null>();
export function registerHangsFrom(panel: Element, control: () => HTMLElement | null): void {
  hangsFrom.set(panel, control);
}
/** The control the panel around `el` hangs from, if `el` is inside one: a menu (Radix names its trigger) or a popover. */
export function controlOfPanelAround(el: Element | null): HTMLElement | null {
  for (let node: Element | null = el; node; node = node.parentElement) {
    const control = hangsFrom.get(node);
    if (control) return control();
  }
  const menu = el?.closest('[role="menu"][aria-labelledby]');
  const trigger = menu ? document.getElementById(menu.getAttribute("aria-labelledby")!) : null;
  return trigger instanceof HTMLElement ? trigger : null;
}

export function focusables(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
    (el) =>
      !el.closest("[inert]") &&
      !el.matches(":disabled") &&
      el.offsetParent !== null &&
      getComputedStyle(el).visibility !== "hidden",
  );
}

/** Put `el` (or its portal child) on the stack; the returned function takes it off again. */
function pushLayer(el: HTMLElement): () => void {
  // The portal child is the backdrop; the dialog may be nested inside it.
  const entry = (el.closest("#modal-root > *") as HTMLElement | null) ?? el;
  stack.push(entry);
  syncInert();
  notifyDepth();
  return () => {
    const i = stack.lastIndexOf(entry);
    if (i >= 0) stack.splice(i, 1);
    syncInert();
    notifyDepth();
  };
}

/**
 * Register the dialog element `ref` points at as a layer for as long as it is
 * mounted (and `open`): the page behind it goes `inert`, the depth counts it.
 * It does nothing with the keyboard: that is Radix's.
 */
export function useDialogLayer(ref: RefObject<HTMLElement | null>, open = true): void {
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || !open) return;
    return pushLayer(el);
  }, [ref, open]);
}

/** Where focus lands on open: the first field, else the first control that is not "close", else the dialog. */
export function initialTarget(el: HTMLElement): HTMLElement {
  const items = focusables(el);
  return (
    items.find((candidate) => candidate.matches(FIELD)) ??
    items.find((f) => !f.hasAttribute("data-dialog-close")) ??
    el
  );
}

export interface UseDrawerOptions {
  /** Where focus lands on open; default: first field, else the drawer itself. */
  initialFocus?: () => HTMLElement | null | undefined;
  /**
   * For a component that stays mounted while closed: the drawer registers when
   * this turns true and leaves the stack when it turns false.
   */
  open?: boolean;
}

/**
 * A panel that stays where it is in the tree and is a dialog only some of the
 * time (the sidebar when it unfolds over a narrow window, the conversation as
 * a drawer): Radix mounts its layer together with the content, so these two do
 * not use it. Attach to the element carrying `role="dialog"` (tabIndex -1).
 * `onClose` may be an inline arrow: it is read through a ref, so the effect
 * runs once per open and focus is never stolen on parent re-renders.
 */
export function useDrawer(
  ref: RefObject<HTMLElement | null>,
  onClose: () => void,
  opts: UseDrawerOptions = {},
): void {
  const onCloseRef = useRef(onClose);
  const initialRef = useRef(opts.initialFocus);
  useLayoutEffect(() => {
    onCloseRef.current = onClose;
    initialRef.current = opts.initialFocus;
  });

  const open = opts.open ?? true;
  useEffect(() => {
    const el = ref.current;
    if (!el || !open) return;
    const previous = document.activeElement as HTMLElement | null;
    const release = pushLayer(el);
    const entry = (el.closest("#modal-root > *") as HTMLElement | null) ?? el;

    const target = initialRef.current?.() ?? initialTarget(el);
    // The frame can land late (a busy stage, a canvas repaint). If the user
    // — or an automation — has already put focus on a field inside the
    // drawer by then, that choice stands: stealing it mid-typing sent the
    // second field's text into the first.
    const raf = requestAnimationFrame(() => {
      const active = document.activeElement;
      if (active && active !== el && el.contains(active)) return;
      target.focus({ preventScroll: true });
    });

    const onKey = (e: KeyboardEvent) => {
      // A Radix layer above this panel (a popover over the chat drawer, a hint on a control inside the
      // sidebar) already took the key in its capture listener and marked it handled: that Escape was
      // its own, and the panel closes on the next one. The registry reads the mark the same way.
      if (e.defaultPrevented && !escapeTakenClosing.has(e)) return;
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
    // A focused control can be disabled or removed after an async action,
    // returning focus to body. The top drawer still owns Escape and Tab.
    document.addEventListener("keydown", onKey);
    return () => {
      cancelAnimationFrame(raf);
      document.removeEventListener("keydown", onKey);
      release();
      if (previous && previous.isConnected && typeof previous.focus === "function")
        previous.focus({ preventScroll: true });
    };
  }, [ref, open]);
}
