/**
 * The expanded form of a widget (redesign F2).
 *
 * The old `maximized` hid every sibling with `visibility: hidden` and stretched
 * one widget over the whole screen — the desktop vanished and a three-row panel
 * floated in a 2000 px canvas. A surface instead opens *over* the desktop: the
 * veil blurs what is behind rather than deleting it, and the panel is sized by
 * `surfaceBox` to a bounded multiple of what the widget said it can fill.
 *
 * It is a real dialog: portalled out of the shell so everything behind goes
 * `inert`, focus trapped and restored, Escape and a click on the veil close it.
 * All of that comes from `useDialog`, so the surface cannot drift from the rest
 * of the app's modal behaviour.
 */
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Minimize2, X } from "lucide-react";
import { useT } from "../i18n";
import { DialogPortal, useDialog } from "../components/dialog";
import { WidgetSizeContext, type WidgetSize } from "./widgetSize";
import { surfaceBox, type Box } from "./surfaceSize";

export interface SurfaceProps {
  title: string;
  icon: ReactNode;
  children: ReactNode;
  /** The widget's declared honest minimum; absent falls back to a modest box. */
  min?: Box;
  onClose: () => void;
  /** Hide the widget as well as closing the surface. */
  onHide?: () => void;
}

/** Viewport box, tracked so the surface reflows when the window is resized. */
function useViewport(): Box {
  const [box, setBox] = useState<Box>(() => ({
    w: typeof window === "undefined" ? 1280 : window.innerWidth,
    h: typeof window === "undefined" ? 800 : window.innerHeight,
  }));
  useEffect(() => {
    const measure = () => setBox({ w: window.innerWidth, h: window.innerHeight });
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, []);
  return box;
}

export default function Surface({ title, icon, children, min, onClose, onHide }: SurfaceProps) {
  const t = useT();
  const ref = useRef<HTMLDivElement>(null);
  useDialog(ref, onClose);
  const viewport = useViewport();
  const box = useMemo(() => surfaceBox(min, viewport), [min, viewport]);

  /**
   * The body measures itself the same way a grid cell does, so a widget's
   * `heightTier` logic keeps working — it just gets the surface's pixels
   * instead of the cell's, and `expanded` tells it to use the full composition.
   */
  const size = useMemo<WidgetSize>(
    () => ({
      w: 0,
      h: 0,
      widthPx: box.w,
      heightPx: box.h - 44,
      expanded: true,
      stacked: false,
    }),
    [box.w, box.h],
  );

  return (
    <DialogPortal>
      <div className="surface-veil" onPointerDown={onClose} data-testid="surface-veil">
        <div
          className="surface"
          role="dialog"
          aria-modal="true"
          aria-label={title}
          tabIndex={-1}
          ref={ref}
          style={{ width: box.w, height: box.h }}
          onPointerDown={(e) => e.stopPropagation()}
        >
          <header className="surface-head">
            <span className="surface-icon" aria-hidden>
              {icon}
            </span>
            <h2>{title}</h2>
            <span className="surface-actions">
              {onHide && (
                <button
                  type="button"
                  className="os-tool"
                  aria-label={`${t("os.hideWidget")}: ${title}`}
                  onClick={onHide}
                >
                  <X aria-hidden />
                </button>
              )}
              <button
                type="button"
                className="os-tool"
                aria-label={`${t("desktop.window.restore")}: ${title}`}
                data-dialog-close
                onClick={onClose}
              >
                <Minimize2 aria-hidden />
              </button>
            </span>
          </header>
          <div className="surface-body">
            <WidgetSizeContext.Provider value={size}>{children}</WidgetSizeContext.Provider>
          </div>
        </div>
      </div>
    </DialogPortal>
  );
}
