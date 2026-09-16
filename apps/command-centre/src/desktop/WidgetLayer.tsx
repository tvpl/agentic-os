/**
 * The window layer (redesign F4a): free pixel positions with a stacking
 * order on wide viewports, a single scrollable column below the stack
 * breakpoint.
 *
 * The grid is gone. A window is dragged by its title bar at any time — edit
 * mode is no longer a prerequisite for moving your own desktop — it is raised
 * when you touch it, it may overlap its neighbours, and dropping it against
 * an edge snaps it to half or full stage. Edit mode now only carries the
 * things that are genuinely edits to the *set* of windows: the per-widget
 * gear and the gallery.
 *
 * Motion: the dragged window is moved with `translate3d` written in one rAF
 * per pointer frame (never React state); only the settled box is committed,
 * and windows whose box changed for another reason (an arrangement, a reset)
 * play a 200 ms FLIP instead of jumping.
 */
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type MutableRefObject,
  type ReactNode,
} from "react";
import { ChevronDown, Maximize2, Minimize2, X } from "lucide-react";
import { useT } from "../i18n";
import { orderedIds } from "./defaultLayout";
import { useStageSize, type StageMetrics } from "./useWindowLayout";
import { useWindowDrag } from "./useWindowDrag";
import { overviewSlots, raise, tetherOrigin, tetherPath, tetherTarget, type WindowMap } from "./windowModel";
import { WidgetSizeContext, type WidgetSize } from "./widgetSize";
import Surface from "./Surface";
import type { Box } from "./surfaceSize";

export interface WidgetSpec {
  title: string;
  icon: ReactNode;
  node: ReactNode;
  /** Honest minimum of the expanded composition, in CSS px (registry `surfaceMin`). */
  surfaceMin?: Box;
  /**
   * `false` for a widget whose expanded view would add nothing (the clock).
   * The frame then omits the maximize control rather than offering a screen
   * that cannot be filled — see `hasSurface` in the registry.
   */
  expandable?: boolean;
}

export interface WidgetLayerProps {
  layout: WindowMap;
  widgets: Record<string, WidgetSpec>;
  onLayoutChange: (next: WindowMap) => void;
  onMetrics?: (m: StageMetrics) => void;
  /**
   * Expanded widget, when the host drives it (the ambient strip opens a
   * surface from outside the layer). Omit to let the layer own the state.
   */
  expandedId?: string | null;
  onExpandedChange?: (id: string | null) => void;
  /** Camera pulled back: every window laid out on a grid, one click to return. */
  overview?: boolean;
  onOverviewChange?: (next: boolean) => void;
  /**
   * Window ids the console draft points at. A line is drawn from the console
   * to each, so the link the agent will receive is visible before sending.
   */
  tetherTo?: readonly string[];
}

const FLIP_MS = 200;

/**
 * Provides the widget's box to its body. The value is memoized on the
 * numbers it is made of, so a re-render of the layer (every drag frame that
 * changes the target cell, every metrics update) hands the memoized widget
 * node the same context value and it stays put.
 */
function SizedWidget({
  box,
  metrics,
  expanded,
  children,
}: {
  box: { w: number; h: number };
  metrics: StageMetrics;
  expanded: boolean;
  children: ReactNode;
}) {
  const { w, h } = box;
  const { stacked, w: stageW } = metrics;
  const value = useMemo<WidgetSize>(
    () => ({
      // `w`/`h` were grid units and are now pixels; `heightTier` reads the
      // pixel fields, so nothing downstream needs the old scale.
      w,
      h,
      widthPx: stacked ? stageW : w,
      heightPx: stacked ? 0 : h,
      expanded,
      stacked,
    }),
    [w, h, stacked, stageW, expanded],
  );
  return <WidgetSizeContext.Provider value={value}>{children}</WidgetSizeContext.Provider>;
}

/** Cheap dependency key: re-measure overflow when the composition changes. */
function idsKey(layout: WindowMap, maximized: string | null, stacked: boolean): string {
  return `${Object.entries(layout)
    .map(([id, b]) => `${id}:${b.w}x${b.h}:${b.visible ? 1 : 0}`)
    .join("|")}#${maximized ?? ""}#${stacked ? 1 : 0}`;
}

/** A body that scrolls itself (the console) must not get the frame's cue or fade mask. */
function selfScrolling(inner: HTMLElement): boolean {
  return inner.querySelector(":scope > .console") !== null;
}

/**
 * Marks each widget with `data-overflow` ("more" / "end" / absent) so the
 * frame can show a "there is more below" cue: one ResizeObserver over every
 * `.widget-inner` and its content, plus a scroll listener per widget.
 */
function useOverflowCue(elements: MutableRefObject<Map<string, HTMLElement>>, key: string) {
  useEffect(() => {
    const measure = (section: HTMLElement) => {
      const inner = section.querySelector<HTMLElement>(":scope > .widget-inner");
      if (!inner) return;
      const overflow = !selfScrolling(inner) && inner.scrollHeight - inner.clientHeight > 4;
      const atEnd = inner.scrollTop + inner.clientHeight >= inner.scrollHeight - 4;
      const next = overflow ? (atEnd ? "end" : "more") : "";
      if (section.dataset.overflow !== next) {
        if (next) section.dataset.overflow = next;
        else delete section.dataset.overflow;
      }
    };
    const sections = [...elements.current.values()];
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const section = (entry.target as HTMLElement).closest<HTMLElement>(".widget");
        if (section) measure(section);
      }
    });
    const cleanups: Array<() => void> = [];
    for (const section of sections) {
      const inner = section.querySelector<HTMLElement>(":scope > .widget-inner");
      if (!inner) continue;
      if (selfScrolling(inner)) {
        delete section.dataset.overflow;
        continue;
      }
      ro.observe(inner);
      for (const child of Array.from(inner.children)) ro.observe(child);
      const onScroll = () => measure(section);
      inner.addEventListener("scroll", onScroll, { passive: true });
      cleanups.push(() => inner.removeEventListener("scroll", onScroll));
      measure(section);
    }
    // Content that arrives later (queries resolving) changes scrollHeight without a resize of the observed
    // children, so poll lightly while the desktop is visible.
    const tick = window.setInterval(() => {
      if (document.hidden) return;
      for (const section of elements.current.values()) measure(section);
    }, 1500);
    return () => {
      ro.disconnect();
      for (const c of cleanups) c();
      window.clearInterval(tick);
    };
  }, [elements, key]);
}

export default function WidgetLayer({
  layout,
  widgets,
  onLayoutChange,
  onMetrics,
  expandedId,
  onExpandedChange,
  overview = false,
  onOverviewChange,
  tetherTo,
}: WidgetLayerProps) {
  const t = useT();
  const [ownMaximized, setOwnMaximized] = useState<string | null>(null);
  const controlled = expandedId !== undefined;
  const maximized = controlled ? expandedId : ownMaximized;
  /**
   * Read through refs so the setter is stable for the lifetime of the layer.
   * A host that passes an inline `onExpandedChange` would otherwise produce a
   * new identity every render, re-running the effect below and closing the
   * surface the moment anything upstream re-rendered.
   */
  const controlledRef = useRef(controlled);
  const onExpandedChangeRef = useRef(onExpandedChange);
  useLayoutEffect(() => {
    controlledRef.current = controlled;
    onExpandedChangeRef.current = onExpandedChange;
  });
  const setMaximized = useCallback((id: string | null) => {
    if (controlledRef.current) onExpandedChangeRef.current?.(id);
    else setOwnMaximized(id);
  }, []);
  const ref = useRef<HTMLDivElement>(null);
  const metrics = useStageSize(ref);
  const onMetricsRef = useRef(onMetrics);
  onMetricsRef.current = onMetrics;
  // Reported after commit (never during render: the parent stores it in state).
  useEffect(() => {
    onMetricsRef.current?.(metrics);
  }, [metrics]);

  const elements = useRef(new Map<string, HTMLElement>());
  const rects = useRef(new Map<string, { left: number; top: number }>());
  /** Changes worth re-measuring the overflow cue for. */
  const layoutKey = idsKey(layout, maximized, metrics.stacked);
  useOverflowCue(elements, layoutKey);
  /** Ids whose FLIP must be skipped for one commit (the dragged element keeps its own transform). */
  const skipFlip = useRef(new Set<string>());

  /** Snapshot before a commit so the settled layout FLIPs from where things visually are. */
  const snapshot = useCallback(() => {
    for (const [id, el] of elements.current) {
      const r = el.getBoundingClientRect();
      rects.current.set(id, { left: r.left, top: r.top });
    }
  }, []);

  const {
    draggingId,
    mode: dragMode,
    snapPreview,
    start,
    nudge,
  } = useWindowDrag(layout, metrics, (next) => {
    snapshot();
    onLayoutChange(next);
  });
  /** The widget that was just released snaps with a spring; neighbours ease. */
  const snapRef = useRef<string | null>(null);

  /**
   * FLIP: invert to the previous position, then let CSS play it forward.
   *
   * It writes `transform` straight onto the element, which is the same inline
   * property React uses for the overview's camera transform — and React does
   * not rewrite a style whose value it has not changed. So while the camera
   * is pulled back the FLIP stands down entirely: there is no settling to
   * animate there, and running it would wipe the camera on the next commit.
   */
  useLayoutEffect(() => {
    if (slots) {
      // Keep the bookkeeping current so leaving the overview does not FLIP
      // from a position the window never actually had.
      for (const [id, el] of elements.current) {
        const r = el.getBoundingClientRect();
        rects.current.set(id, { left: r.left, top: r.top });
      }
      skipFlip.current.clear();
      snapRef.current = null;
      return;
    }
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

  // The overview is a camera move, not a layout change: the boxes are left
  // exactly as they are and only the transform differs, so leaving it
  // restores the desktop without anything to undo.
  const slots = useMemo(
    () => (overview && !metrics.stacked ? overviewSlots(layout, metrics) : null),
    [overview, metrics, layout],
  );

  /**
   * One curve per referenced window, from the console's top edge. Skipped
   * while the camera is pulled back — there the windows are not where their
   * boxes say they are, so a tether would point at empty stage.
   */
  const tethers = useMemo(() => {
    if (!tetherTo?.length || slots || metrics.stacked) return [];
    const consoleBox = layout.prompt;
    if (!consoleBox?.visible || consoleBox.minimized) return [];
    const from = tetherOrigin(consoleBox);
    return tetherTo
      .map((id) => {
        const box = layout[id];
        if (!box?.visible || box.minimized || id === "prompt") return null;
        return { id, d: tetherPath(from, tetherTarget(box, from)) };
      })
      .filter((t): t is { id: string; d: string } => t !== null);
  }, [tetherTo, layout, slots, metrics.stacked]);
  const ids = orderedIds(Object.keys(layout)).filter((id) => widgets[id] && layout[id]?.visible);

  const hide = (id: string) => {
    setMaximized(null);
    snapshot();
    onLayoutChange({ ...layout, [id]: { ...layout[id]!, visible: false } });
  };

  return (
    <div
      className={`desktop-widgets${metrics.stacked ? " stacked" : ""}${draggingId ? " dragging-any" : ""}${slots ? " overview" : ""}`}
      ref={ref}
    >
      {tethers.length > 0 && (
        <svg className="tethers" aria-hidden>
          {tethers.map((t) => (
            <path key={t.id} d={t.d} />
          ))}
        </svg>
      )}
      {!metrics.stacked && snapPreview && (
        <div
          className="snap-preview"
          aria-hidden
          style={{ left: snapPreview.x, top: snapPreview.y, width: snapPreview.w, height: snapPreview.h }}
        />
      )}
      {ids.map((id, index) => {
        const widget = widgets[id]!;
        const boxed = layout[id]!;
        const style: CSSProperties = metrics.stacked
          ? ({ "--enter-delay": `${index * 40}ms` } as CSSProperties)
          : ({
              left: boxed.x,
              top: boxed.y,
              width: boxed.w,
              height: boxed.h,
              zIndex: boxed.z,
              "--enter-delay": `${index * 40}ms`,
            } as CSSProperties);
        const slot = slots?.[id];
        if (slot)
          Object.assign(style, {
            transform: `translate3d(${slot.x - boxed.x}px, ${slot.y - boxed.y}px, 0) scale(${slot.scale})`,
            transformOrigin: "top left",
            cursor: "zoom-in",
          });
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
            data-widget-id={id}
            className={`widget${boxed.h <= 140 && maximized !== id ? " compact" : ""} enter-fade-up${dragging ? ` dragging ${dragMode ?? ""}` : ""}`}
            style={style}
            aria-label={widget.title}
            onPointerDown={(e) => {
              // In the overview a window is a target, not a thing to drag:
              // picking one is how you leave the camera view.
              if (overview) {
                e.preventDefault();
                onOverviewChange?.(false);
                onLayoutChange(raise(layout, id));
                return;
              }
              // Touching a window raises it, always — that is the one thing a
              // window manager must never make you enter a mode for.
              if (metrics.stacked || e.button !== 0) return;
              if (layout[id] && layout[id]!.z !== Math.max(...Object.values(layout).map((b) => b.z)))
                onLayoutChange(raise(layout, id));
              const targetEl = e.target as HTMLElement;
              // Dragging starts on the title bar only: the body belongs to
              // the widget, and its buttons and fields must keep working.
              if (!targetEl.closest(".widget-inner > h2")) return;
              if (targetEl.closest("button, a, input, textarea, select")) return;
              e.preventDefault();
              skipFlip.current.add(id);
              snapRef.current = id;
              start(id, "move", e, boxed);
            }}
          >
            <div
              className="widget-inner"
              role="region"
              aria-label={widget.title}
              tabIndex={0}
              // While expanded the body lives in the surface; the frame stays
              // behind the veil so the desktop still reads as a desktop.
              aria-hidden={maximized === id || undefined}
            >
              <h2>
                {widget.icon} <span className="widget-title">{widget.title}</span>
                <span className="widget-window-actions">
                  {(widget.expandable !== false || maximized === id) && (
                    <button
                      type="button"
                      className="os-tool"
                      aria-label={`${t(maximized === id ? "desktop.window.restore" : "desktop.window.maximize")}: ${widget.title}`}
                      onClick={() => setMaximized(maximized === id ? null : id)}
                    >
                      {maximized === id ? <Minimize2 aria-hidden /> : <Maximize2 aria-hidden />}
                    </button>
                  )}
                  <button
                    type="button"
                    className="os-tool"
                    aria-label={`${t("os.hideWidget")}: ${widget.title}`}
                    onClick={() => hide(id)}
                  >
                    <X aria-hidden />
                  </button>
                </span>
              </h2>
              {maximized === id ? null : (
                <SizedWidget box={boxed} metrics={metrics} expanded={false}>
                  {widget.node}
                </SizedWidget>
              )}
            </div>
            {/* A pointer-only affordance: the region above is focusable and scrolls with the
                keyboard, so the cue stays out of the accessibility tree (it is also
                `visibility: hidden` until the body overflows). */}
            <button
              type="button"
              className="widget-more-cue"
              tabIndex={-1}
              aria-hidden
              title={t("widget.scrollMore")}
              onClick={(e) => {
                const inner = (e.currentTarget.parentElement as HTMLElement).querySelector<HTMLElement>(
                  ":scope > .widget-inner",
                );
                inner?.scrollBy({ top: inner.clientHeight * 0.7, behavior: "smooth" });
              }}
            >
              <ChevronDown aria-hidden />
            </button>
            {!maximized && (
              <>
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
                      start(id, "resize", e, boxed);
                    }}
                  />
                )}
              </>
            )}
          </section>
        );
      })}
      {maximized && widgets[maximized] && (
        <Surface
          title={widgets[maximized]!.title}
          icon={widgets[maximized]!.icon}
          min={widgets[maximized]!.surfaceMin}
          onClose={() => setMaximized(null)}
          onHide={() => hide(maximized)}
        >
          {widgets[maximized]!.node}
        </Surface>
      )}
    </div>
  );
}
