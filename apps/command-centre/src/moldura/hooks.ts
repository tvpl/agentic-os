import { useEffect, useRef, type RefObject } from "react";
import { getDialogDepth } from "../components/dialog";

/** Call `onPress` for a pointer press outside `ref` (the bell's popover), while `enabled`. */
export function useOutsidePress(ref: RefObject<HTMLElement | null>, onPress: () => void, enabled = true) {
  const pressRef = useRef(onPress);
  pressRef.current = onPress;
  useEffect(() => {
    if (!enabled) return;
    const onDown = (e: PointerEvent) => {
      const el = e.target instanceof Node ? e.target : null;
      if (el && ref.current?.contains(el)) return;
      pressRef.current();
    };
    window.addEventListener("pointerdown", onDown);
    return () => window.removeEventListener("pointerdown", onDown);
  }, [ref, enabled]);
}

/**
 * Close a modal drawer when the press lands on what it covers. Everything
 * behind a modal drawer is inert, so a press there reaches no control; it
 * lands on the frame itself. A press inside any dialog (the drawer, or the
 * palette opened over it, or `keep`) is not "outside".
 */
export function useScrimPress(onPress: () => void, enabled: boolean, keep?: RefObject<Element | null>) {
  const pressRef = useRef(onPress);
  pressRef.current = onPress;
  useEffect(() => {
    if (!enabled) return;
    const onDown = (e: PointerEvent) => {
      const el = e.target instanceof Element ? e.target : null;
      if (el?.closest('[role="dialog"]') || (el && keep?.current?.contains(el))) return;
      // Something is open over the drawer (the palette): that press is its own.
      if (getDialogDepth() > 1) return;
      pressRef.current();
    };
    window.addEventListener("pointerdown", onDown);
    return () => window.removeEventListener("pointerdown", onDown);
  }, [enabled, keep]);
}

/**
 * Views are written for the Núcleo's scenes and the classic pages, where each
 * opens with an `h1`. In the frame the top bar's title is the page's `h1`, so
 * the view's own heading steps down to level 2 for assistive technology: one
 * top-level heading per page, without touching the views. Views render late
 * (lazy chunks, data), so new headings are caught as they arrive.
 */
export function useHeadingsBelowTitle(ref: RefObject<HTMLElement | null>) {
  useEffect(() => {
    const root = ref.current;
    if (!root) return;
    const demote = () => {
      for (const h of root.querySelectorAll("h1:not([aria-level])")) h.setAttribute("aria-level", "2");
    };
    demote();
    const observer = new MutationObserver(demote);
    observer.observe(root, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, [ref]);
}
