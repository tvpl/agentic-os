/**
 * The widget layer: absolute 24-column grid on wide viewports, a single
 * scrollable column below the stack breakpoint. Drag / resize / hide only in
 * edit mode; arrow keys nudge (Shift resizes) the focused widget grip.
 *
 * Motion (audit 2.2 §3 and §4): the dragged widget is moved with
 * `translate3d` written in one rAF per pointer frame (never React state);
 * the target cell is drawn as a highlight; on pointerup the reducer settles
 * the layout and every widget whose box changed — the dragged one snapping
 * into place, the neighbours pushed down, and the boxes that move when a
 * widget is hidden, shown or reset — plays a 200 ms FLIP instead of jumping.
 */
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  type CSSProperties,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { GripVertical, Settings2, X } from "lucide-react";
import { useT } from "../i18n";
import { orderedIds, type LayoutMap } from "./defaultLayout";
import { boxToPx, useGridMetrics, useWidgetDrag, type GridMetrics } from "./useGridLayout";

export interface WidgetSpec {
  title: string;
  icon: ReactNode;
  node: ReactNode;
  /** Renders the gear in edit mode when true. */
  configurable?: boolean;
}

export interface WidgetLayerProps {
  layout: LayoutMap;
  widgets: Record<string, WidgetSpec>;
  editMode: boolean;
  onLayoutChange: (next: LayoutMap) => void;
  onMetrics?: (m: GridMetrics) => void;
  /** Gear clicked in edit mode: open the per-widget config popover on `anchor`. */
  onConfigure?: (id: string, anchor: HTMLElement) => void;
}

const FLIP_MS = 200;

export default function WidgetLayer({
  layout,
  widgets,
  editMode,
  onLayoutChange,
  onMetrics,
  onConfigure,
}: WidgetLayerProps) {
  const t = useT();
  const ref = useRef<HTMLDivElement>(null);
  const metrics = useGridMetrics(ref);
  const onMetricsRef = useRef(onMetrics);
  onMetricsRef.current = onMetrics;
  // Reported after commit (never during render: the parent stores it in state).
  useEffect(() => {
    onMetricsRef.current?.(metrics);
  }, [metrics]);

  const elements = useRef(new Map<string, HTMLElement>());
  const rects = useRef(new Map<string, { left: number; top: number }>());
  /** Ids whose FLIP must be skipped for one commit (the dragged element keeps its own transform). */
  const skipFlip = useRef(new Set<string>());

  /** Snapshot before a commit so the settled layout FLIPs from where things visually are. */
  const snapshot = useCallback(() => {
    for (const [id, el] of elements.current) {
      const r = el.getBoundingClientRect();
      rects.current.set(id, { left: r.left, top: r.top });
    }
  }, []);

  const { draggingId, mode, target, start, nudge } = useWidgetDrag(layout, metrics, onLayoutChange, snapshot);
  /** The widget that was just released snaps with a spring; neighbours ease. */
  const snapRef = useRef<string | null>(null);

  // FLIP: invert to the previous position, then let CSS play it forward.
  useLayoutEffect(() => {
    const reduce =
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    for (const [id, el] of elements.current) {
      const prev = rects.current.get(id);
      const r = el.getBoundingClientRect();
      const next = { left: r.left, top: r.top };
      const moved = prev && (Math.abs(prev.left - next.left) > 0.5 || Math.abs(prev.top - next.top) > 0.5);
      if (moved && !reduce && !skipFlip.current.has(id) && id !== draggingId) {
        const dx = prev.left - next.left;
        const dy = prev.top - next.top;
        const ease = snapRef.current === id ? "var(--ease-spring)" : "var(--ease-emphasized)";
        el.style.transition = "none";
        el.style.transform = `translate3d(${dx}px, ${dy}px, 0)`;
        void el.offsetWidth; // flush the inverted frame
        el.style.transition = `transform ${FLIP_MS}ms ${ease}`;
        el.style.transform = "translate3d(0, 0, 0)";
        const done = () => {
          el.style.transition = "";
          el.style.transform = "";
          el.removeEventListener("transitionend", done);
        };
        el.addEventListener("transitionend", done);
      }
      rects.current.set(id, next);
    }
    skipFlip.current.clear();
    snapRef.current = null;
  });

  const ids = orderedIds(Object.keys(layout)).filter((id) => widgets[id] && layout[id]?.visible);

  const onGripKey = (id: string, e: KeyboardEvent<HTMLElement>) => {
    if (!editMode) return;
    if (nudge(id, e.key, e.shiftKey)) e.preventDefault();
  };

  const hide = (id: string) => {
    snapshot();
    onLayoutChange({ ...layout, [id]: { ...layout[id]!, visible: false } });
  };

  return (
    <div
      className={`desktop-widgets${metrics.stacked ? " stacked" : ""}${draggingId ? " dragging-any" : ""}`}
      ref={ref}
    >
      {editMode && !metrics.stacked && draggingId && target && (
        <div className="drop-target" aria-hidden style={boxToPx(target, metrics)} />
      )}
      {ids.map((id, index) => {
        const widget = widgets[id]!;
        const boxed = layout[id]!;
        const style: CSSProperties = metrics.stacked
          ? ({ "--enter-delay": `${index * 40}ms` } as CSSProperties)
          : ({ ...boxToPx(boxed, metrics), "--enter-delay": `${index * 40}ms` } as CSSProperties);
        const dragging = draggingId === id;
        return (
          <section
            key={id}
            ref={(el) => {
              if (el) elements.current.set(id, el);
              else {
                elements.current.delete(id);
                rects.current.delete(id);
              }
            }}
            className={`widget enter-fade-up${editMode ? " editing" : ""}${dragging ? ` dragging ${mode ?? ""}` : ""}`}
            style={style}
            aria-label={widget.title}
            onPointerDown={(e) => {
              if (!editMode || metrics.stacked || e.button !== 0) return;
              const targetEl = e.target as HTMLElement;
              if (
                targetEl.closest(".widget-resize") ||
                targetEl.closest(".widget-hide") ||
                targetEl.closest(".widget-config")
              )
                return;
              e.preventDefault();
              skipFlip.current.add(id);
              snapRef.current = id;
              start(id, "move", e, boxed, e.currentTarget);
            }}
          >
            <div className="widget-inner" role="region" aria-label={widget.title} tabIndex={0}>
              <h2>
                {widget.icon} {widget.title}
              </h2>
              {widget.node}
            </div>
            {editMode && (
              <>
                <button
                  type="button"
                  className="widget-grip"
                  aria-label={`${t("os.moveWidget")}: ${widget.title}`}
                  title={t("os.moveWidget")}
                  aria-keyshortcuts="ArrowUp ArrowDown ArrowLeft ArrowRight Shift+ArrowUp"
                  onKeyDown={(e) => onGripKey(id, e)}
                >
                  <GripVertical aria-hidden />
                </button>
                {widget.configurable && onConfigure && (
                  <button
                    type="button"
                    className="widget-config"
                    aria-label={`${t("desktop.config.title")}: ${widget.title}`}
                    title={t("desktop.config.open")}
                    onClick={(e) => onConfigure(id, e.currentTarget)}
                  >
                    <Settings2 aria-hidden />
                  </button>
                )}
                <button
                  type="button"
                  className="widget-hide"
                  aria-label={`${t("os.hideWidget")}: ${widget.title}`}
                  title={t("os.hideWidget")}
                  onClick={() => hide(id)}
                >
                  <X aria-hidden />
                </button>
                {!metrics.stacked && (
                  <button
                    type="button"
                    className="widget-resize"
                    aria-label={`${t("os.resizeWidget")}: ${widget.title}`}
                    title={t("os.resizeWidget")}
                    onKeyDown={(e) => {
                      if (nudge(id, e.key, true)) e.preventDefault();
                    }}
                    onPointerDown={(e) => {
                      if (e.button !== 0) return;
                      e.preventDefault();
                      e.stopPropagation();
                      skipFlip.current.add(id);
                      snapRef.current = id;
                      start(id, "resize", e, boxed, e.currentTarget.parentElement as HTMLElement);
                    }}
                  />
                )}
              </>
            )}
          </section>
        );
      })}
    </div>
  );
}
