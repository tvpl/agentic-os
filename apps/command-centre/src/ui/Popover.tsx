/**
 * The anchored, non-modal floating panel on Radix (.specs/features/primitivas).
 * A press outside and Escape close it; focus goes in on open and back to the
 * anchor on close, unless the press that closed it put focus somewhere else.
 * It does not take the page: nothing behind it is `inert`, it is not counted as
 * a dialog, and it says so with `aria-modal="false"`, which is what the command
 * registry reads to keep the screen behind a popover live.
 */
import { useCallback, useEffect, useMemo, useRef, type RefObject, type ReactNode } from "react";
import * as PopoverPrimitive from "@radix-ui/react-popover";
import { noteEscape, registerHangsFrom } from "./layers";

export type PopoverPlacement = "bottom-start" | "bottom-end" | "bottom" | "top-start" | "top-end" | "top";

export interface PopoverProps {
  open: boolean;
  onClose: () => void;
  /** The trigger: a ref or the element itself. The popover is anchored to it and focus returns to it on close. */
  anchor: RefObject<HTMLElement | null> | HTMLElement | null;
  children: ReactNode;
  placement?: PopoverPlacement;
  /** Gap between anchor and popover in px (default 6). */
  offset?: number;
  ariaLabel?: string;
  className?: string;
  /** Where focus lands on open; default: first focusable, else the popover. */
  initialFocus?: () => HTMLElement | null | undefined;
  /** Matching width with the anchor (menus under inputs). */
  matchWidth?: boolean;
  /** Render under `#modal-root` (default). A popover that must stay inside its parent in the tree passes `false`. */
  portal?: boolean;
}

function anchorElement(anchor: PopoverProps["anchor"]): HTMLElement | null {
  if (!anchor) return null;
  return anchor instanceof HTMLElement ? anchor : anchor.current;
}

export function Popover({
  open,
  onClose,
  anchor,
  children,
  placement = "bottom-start",
  offset = 6,
  ariaLabel,
  className,
  initialFocus,
  matchWidth = false,
  portal = true,
}: PopoverProps) {
  const pressedOutside = useRef(false);
  const contentRef = useRef<HTMLDivElement | null>(null);
  // The panel says what it hangs from, so a dialog opened from inside it can give focus back there.
  const panelRef = useCallback(
    (el: HTMLDivElement | null) => {
      contentRef.current = el;
      if (el) registerHangsFrom(el, () => anchorElement(anchor));
    },
    [anchor],
  );
  const virtualAnchor = useMemo(
    () => ({
      get current() {
        return anchorElement(anchor);
      },
    }),
    [anchor],
  );
  // Focus goes back to the anchor as the popover closes, unless the press that closed it put focus somewhere else.
  useEffect(() => {
    if (!open) return;
    return () => {
      const back = anchorElement(anchor);
      const active = document.activeElement;
      // The panel is still in the tree here (it leaves when its exit ends), so the ref is current.
      const here = active === document.body || contentRef.current?.contains(active);
      if (!pressedOutside.current && here && back?.isConnected) back.focus({ preventScroll: true });
      pressedOutside.current = false;
    };
  }, [open, anchor]);
  const [side, align] = placement.split("-") as ["top" | "bottom", ("start" | "end")?];
  const content = (
    <PopoverPrimitive.Content
      ref={panelRef}
      side={side}
      align={align ?? "center"}
      sideOffset={offset}
      collisionPadding={8}
      aria-modal="false"
      aria-label={ariaLabel}
      className={["popover", className ?? ""].filter(Boolean).join(" ")}
      style={matchWidth ? { width: "var(--radix-popover-trigger-width)" } : undefined}
      onEscapeKeyDown={(event) => noteEscape(event, contentRef.current)}
      onOpenAutoFocus={(event) => {
        const target = initialFocus?.();
        if (!target) return;
        event.preventDefault();
        target.focus({ preventScroll: true });
      }}
      onInteractOutside={(event) => {
        // A press on the anchor is the anchor's own toggle: closing here would let its click reopen it.
        if (anchorElement(anchor)?.contains(event.target as Node)) {
          event.preventDefault();
          return;
        }
        pressedOutside.current = true;
      }}
      onCloseAutoFocus={(event) => event.preventDefault()}
    >
      {children}
    </PopoverPrimitive.Content>
  );
  return (
    <PopoverPrimitive.Root open={open} onOpenChange={(next) => !next && onClose()}>
      <PopoverPrimitive.Anchor virtualRef={virtualAnchor} />
      {portal ? (
        <PopoverPrimitive.Portal container={document.getElementById("modal-root") ?? undefined}>
          {content}
        </PopoverPrimitive.Portal>
      ) : (
        content
      )}
    </PopoverPrimitive.Root>
  );
}
