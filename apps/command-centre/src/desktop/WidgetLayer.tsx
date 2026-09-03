/**
 * The widget layer: absolute 24-column grid on wide viewports, a single
 * scrollable column below the stack breakpoint. Drag / resize / hide only in
 * edit mode; arrow keys nudge (Shift resizes) the focused widget header.
 */
import { useRef, type CSSProperties, type KeyboardEvent, type ReactNode } from "react";
import { useT } from "../i18n";
import { WIDGET_ORDER, type LayoutMap } from "./defaultLayout";
import { boxToPx, useGridMetrics, useWidgetDrag, type GridMetrics } from "./useGridLayout";

export interface WidgetSpec {
  title: string;
  icon: ReactNode;
  node: ReactNode;
}

export interface WidgetLayerProps {
  layout: LayoutMap;
  widgets: Record<string, WidgetSpec>;
  editMode: boolean;
  onLayoutChange: (next: LayoutMap) => void;
  onMetrics?: (m: GridMetrics) => void;
}

export default function WidgetLayer({ layout, widgets, editMode, onLayoutChange, onMetrics }: WidgetLayerProps) {
  const t = useT();
  const ref = useRef<HTMLDivElement>(null);
  const metrics = useGridMetrics(ref);
  onMetrics?.(metrics);
  const { drag, ghost, start, nudge } = useWidgetDrag(layout, metrics, onLayoutChange);

  const ids = WIDGET_ORDER.filter((id) => widgets[id] && layout[id]?.visible);

  const onHeaderKey = (id: string, e: KeyboardEvent<HTMLElement>) => {
    if (!editMode) return;
    if (nudge(id, e.key, e.shiftKey)) e.preventDefault();
  };

  return (
    <div className={`desktop-widgets${metrics.stacked ? " stacked" : ""}`} ref={ref}>
      {ids.map((id, index) => {
        const widget = widgets[id]!;
        const box = drag?.id === id && ghost ? ghost : layout[id]!;
        const style: CSSProperties = metrics.stacked
          ? { "--enter-delay": `${index * 40}ms` } as CSSProperties
          : ({ ...boxToPx(box, metrics), "--enter-delay": `${index * 40}ms` } as CSSProperties);
        return (
          <section
            key={id}
            className={`widget enter-fade-up${editMode ? " editing" : ""}${drag?.id === id ? " dragging" : ""}`}
            style={style}
            aria-label={widget.title}
            onPointerDown={(e) => {
              if (!editMode || metrics.stacked) return;
              const target = e.target as HTMLElement;
              if (target.closest(".widget-resize") || target.closest(".widget-hide")) return;
              e.preventDefault();
              start(id, "move", e, box);
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
                  onKeyDown={(e) => onHeaderKey(id, e)}
                >
                  ⠿
                </button>
                <button
                  type="button"
                  className="widget-hide"
                  aria-label={`${t("os.hideWidget")}: ${widget.title}`}
                  title={t("os.hideWidget")}
                  onClick={() => onLayoutChange({ ...layout, [id]: { ...box, visible: false } })}
                >
                  ✕
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
                      e.preventDefault();
                      e.stopPropagation();
                      start(id, "resize", e, box);
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
