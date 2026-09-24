import { useEffect, useLayoutEffect, useState, type RefObject } from "react";
import { focusables } from "../components/dialog";
import { clipTarget, type Rect } from "./state";

/** Follow lazy routes, widget reflow, scrolling and viewport changes without a perpetual render loop. */
export function useTourTarget(selector: string | null, active: boolean) {
  const [target, setTarget] = useState<Rect | null>(null);
  const [element, setElement] = useState<HTMLElement | null>(null);
  useLayoutEffect(() => {
    if (!active || !selector) {
      setTarget(null);
      setElement(null);
      return;
    }
    let frame = 0;
    let found: HTMLElement | null = null;
    let settlingUntil = performance.now() + 650;
    const resize = new ResizeObserver(() => schedule());
    const measure = () => {
      frame = 0;
      const next = document.querySelector<HTMLElement>(selector);
      if (next !== found) {
        resize.disconnect();
        found = next;
        setElement(next);
        if (next) {
          resize.observe(next);
          next.scrollIntoView({
            block: window.innerWidth < 700 ? "start" : "nearest",
            inline: "nearest",
            behavior: "instant",
          });
        }
        settlingUntil = performance.now() + 650;
      }
      const box = found?.getBoundingClientRect();
      const rect =
        box && box.width > 0 && box.height > 0 && found && getComputedStyle(found).visibility !== "hidden"
          ? clipTarget(box, window.innerWidth, window.innerHeight)
          : null;
      setTarget((prev) => (JSON.stringify(prev) === JSON.stringify(rect) ? prev : rect));
      if (performance.now() < settlingUntil) schedule();
    };
    function schedule() {
      if (!frame) frame = requestAnimationFrame(measure);
    }
    const mutations = new MutationObserver(schedule);
    const root = document.getElementById("root");
    if (root) mutations.observe(root, { childList: true, subtree: true });
    window.addEventListener("resize", schedule);
    window.addEventListener("scroll", schedule, true);
    schedule();
    return () => {
      cancelAnimationFrame(frame);
      resize.disconnect();
      mutations.disconnect();
      window.removeEventListener("resize", schedule);
      window.removeEventListener("scroll", schedule, true);
    };
  }, [selector, active]);
  return { target, element };
}

/** Keep the guide and the explicit, safe practice target operable; isolate the rest of the OS. */
export function useTourFocus(
  ref: RefObject<HTMLElement>,
  active: boolean,
  interactive: HTMLElement | null,
  onClose: () => void,
) {
  useEffect(() => {
    if (!active) return;
    const previous = document.activeElement as HTMLElement | null;
    const changed = new Set<HTMLElement>();
    const isolate = () => {
      const visit = (node: HTMLElement) => {
        if (node === interactive) return;
        if (interactive && node.contains(interactive)) {
          for (const child of Array.from(node.children)) if (child instanceof HTMLElement) visit(child);
        } else if (!node.inert) {
          node.inert = true;
          changed.add(node);
        }
      };
      const root = document.getElementById("root");
      if (root) for (const child of Array.from(root.children)) if (child instanceof HTMLElement) visit(child);
    };
    isolate();
    const observer = new MutationObserver(isolate);
    const root = document.getElementById("root");
    if (root) observer.observe(root, { childList: true, subtree: true });
    document.documentElement.dataset.onboarding = "active";
    const frame = requestAnimationFrame(() => ref.current?.focus({ preventScroll: true }));
    const keys = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopImmediatePropagation();
        onClose();
        return;
      }
      if ((event.metaKey || event.ctrlKey) && ["k", "m"].includes(event.key.toLowerCase())) {
        event.preventDefault();
        event.stopImmediatePropagation();
        return;
      }
      if (event.key !== "Tab") return;
      const items = [
        ...(ref.current ? focusables(ref.current) : []),
        ...(interactive ? focusables(interactive) : []),
      ];
      if (!items.length) {
        event.preventDefault();
        ref.current?.focus();
        return;
      }
      const current = items.indexOf(document.activeElement as HTMLElement);
      event.preventDefault();
      items[(current + (event.shiftKey ? -1 : 1) + items.length) % items.length]?.focus();
    };
    document.addEventListener("keydown", keys, true);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      changed.forEach((node) => {
        node.inert = false;
      });
      delete document.documentElement.dataset.onboarding;
      document.removeEventListener("keydown", keys, true);
      if (previous?.isConnected) previous.focus({ preventScroll: true });
    };
  }, [ref, active, interactive, onClose]);
}
