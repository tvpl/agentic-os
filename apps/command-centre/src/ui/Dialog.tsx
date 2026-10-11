/**
 * Dialogs on Radix (.specs/features/primitivas). `DialogSurface` is the layer
 * every dialog of the app stands on: portal into `#modal-root`, the focus trap,
 * Escape on the top layer only, the page behind it `inert`, the focus handed
 * back to what held it. `Modal` is the standard sheet on top of it: a title, a
 * close button and the exit that plays before `onClose` runs.
 */
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { useT } from "../i18n";
import { prefersReducedMotion, usePresence } from "../hooks/usePresence";
import { controlOfPanelAround, initialTarget, registerHangsFrom, useDialogLayer } from "./layers";

const EXIT_MS = 160;

export interface DialogSurfaceProps {
  open: boolean;
  /** Radix asks to close: Escape, or a press outside the sheet. */
  onOpenChange?: (open: boolean) => void;
  /** The sheet's accessible name; or `labelledBy`, the id of an element inside it. */
  label?: string;
  labelledBy?: string;
  children: ReactNode;
  /** The class of the full-screen backdrop; `false` for none (a drawer that stays where it is). */
  backdrop?: string | false;
  /** The class of the sheet. */
  className?: string;
  /** Where focus lands on open; default: the first field, else the first control that is not "close", else the sheet. */
  initialFocus?: () => HTMLElement | null | undefined;
  /** Render under `#modal-root` (default). A drawer that cannot leave its place in the tree passes `false`. */
  portal?: boolean;
  /** How long the sheet stays mounted after `open` turns false, for its exit to play. */
  exitMs?: number;
  /** No exit at all: the sheet is gone as soon as `open` turns false. */
  instant?: boolean;
  /** A press on the backdrop asks to close (default). */
  dismissOnPress?: boolean;
  /** Extra attributes for the sheet (`data-testid`, `id`). */
  sheetProps?: { id?: string } & { [name in `data-${string}`]?: string };
}

/** The sheet, mounted for as long as the dialog is up (and while it leaves). */
function Sheet({
  label,
  labelledBy,
  className,
  initialFocus,
  dismissOnPress,
  sheetProps,
  children,
}: Pick<
  DialogSurfaceProps,
  "label" | "labelledBy" | "className" | "initialFocus" | "dismissOnPress" | "sheetProps" | "children"
>) {
  const ref = useRef<HTMLDivElement>(null);
  // What held focus when the dialog opened: Radix hands focus back to a trigger only, and these have none.
  const opener = useRef<HTMLElement | null>(document.activeElement as HTMLElement | null);
  // ...and, if that was an item of a menu or a control of a popover, what the panel hung from: the item
  // is gone by the time the dialog closes, the control is not.
  const [control] = useState(() => controlOfPanelAround(document.activeElement));
  useDialogLayer(ref);
  // A dialog opened from inside this one (the palette's "Keyboard shortcuts") finds this one gone when it
  // closes: it goes back to what this one goes back to.
  useEffect(() => {
    const el = ref.current;
    if (el) registerHangsFrom(el, () => (opener.current?.isConnected ? opener.current : control));
  }, [control]);
  return (
    <DialogPrimitive.Content
      {...sheetProps}
      ref={ref}
      className={className}
      aria-modal="true"
      aria-label={label}
      aria-labelledby={labelledBy}
      aria-describedby={undefined}
      tabIndex={-1}
      // Radix focuses the first control it finds; the app wants a field first, and says where when it knows.
      // (Doing it here, rather than by hand, lets the focus trap know where focus is from the start.)
      onOpenAutoFocus={(event) => {
        event.preventDefault();
        const el = ref.current;
        if (el) (initialFocus?.() ?? initialTarget(el)).focus({ preventScroll: true });
      }}
      // Radix runs this once the sheet is gone and its focus trap with it, so the opener can take focus back.
      onCloseAutoFocus={(event) => {
        event.preventDefault();
        const previous = opener.current?.isConnected ? opener.current : control;
        if (previous && previous.isConnected && typeof previous.focus === "function")
          previous.focus({ preventScroll: true });
      }}
      onInteractOutside={(event) => {
        // A press on the backdrop closes; focus moving elsewhere (a toast, a tooltip) does not.
        if (!dismissOnPress || event.detail.originalEvent.type !== "pointerdown") event.preventDefault();
      }}
    >
      {children}
    </DialogPrimitive.Content>
  );
}

export function DialogSurface({
  open,
  onOpenChange,
  label,
  labelledBy,
  children,
  backdrop = "modal-backdrop",
  className = "modal",
  initialFocus,
  portal = true,
  exitMs = EXIT_MS,
  instant = false,
  dismissOnPress = true,
  sheetProps,
}: DialogSurfaceProps) {
  const { mounted } = usePresence(open, instant ? 0 : exitMs);
  if (!mounted) return null;
  const sheet = (
    <Sheet
      label={label}
      labelledBy={labelledBy}
      className={className}
      initialFocus={initialFocus}
      dismissOnPress={dismissOnPress}
      sheetProps={sheetProps}
    >
      {children}
    </Sheet>
  );
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      {portal ? (
        <DialogPrimitive.Portal forceMount container={document.getElementById("modal-root") ?? undefined}>
          {backdrop === false ? (
            sheet
          ) : (
            <DialogPrimitive.Overlay forceMount className={backdrop}>
              {sheet}
            </DialogPrimitive.Overlay>
          )}
        </DialogPrimitive.Portal>
      ) : (
        sheet
      )}
    </DialogPrimitive.Root>
  );
}

/* ---------- Modal ---------- */
export interface ModalProps {
  title: string;
  /**
   * Called after the exit animation when the user closes the modal (X, Esc,
   * backdrop). May be an inline arrow; it is read through a ref.
   */
  onClose: () => void;
  children: ReactNode;
  narrow?: boolean;
  /** Override the initial focus target (default: first field, else the dialog itself). */
  initialFocus?: () => HTMLElement | null | undefined;
  /**
   * Controlled presence: pass `open={false}` instead of unmounting to get the
   * exit animation when the parent closes the modal itself (after a save).
   * Conditional mounting (`{open && <Modal/>}`) still works and animates the
   * user-initiated closes.
   */
  open?: boolean;
  className?: string;
}

export function Modal({
  open = true,
  title,
  onClose,
  children,
  narrow = false,
  initialFocus,
  className,
}: ModalProps) {
  const t = useT();
  const [leaving, setLeaving] = useState(false);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const timer = useRef<number | undefined>(undefined);

  // User-initiated close: play the exit, then tell the parent.
  const requestClose = useCallback(() => {
    if (timer.current !== undefined) return;
    if (prefersReducedMotion()) {
      onCloseRef.current();
      return;
    }
    setLeaving(true);
    timer.current = window.setTimeout(() => {
      timer.current = undefined;
      onCloseRef.current();
    }, EXIT_MS);
  }, []);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  // The parent closed it itself: ready for the next time it opens.
  useEffect(() => {
    if (!open) setLeaving(false);
  }, [open]);

  return (
    <DialogSurface
      open={open && !leaving}
      onOpenChange={(next) => !next && requestClose()}
      label={title}
      className={["modal", narrow ? "narrow" : "", className ?? ""].filter(Boolean).join(" ")}
      initialFocus={initialFocus}
    >
      <div className="modal-head">
        <DialogPrimitive.Title>{title}</DialogPrimitive.Title>
        <button
          type="button"
          className="btn ghost sm icon-only"
          onClick={requestClose}
          aria-label={t("common.close")}
          data-dialog-close
        >
          <X aria-hidden />
        </button>
      </div>
      {children}
    </DialogSurface>
  );
}
