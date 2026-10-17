/**
 * The box a widget instance is rendered in, so its body can adapt (fewer
 * rows, a compact clock, a two-line routine row) instead of clipping.
 * Provided by WidgetLayer; defaults to a comfortable box for hosts that
 * render a widget outside the grid (the gallery, tests).
 */
import { createContext, useContext } from "react";

export interface WidgetSize {
  /** Grid units. */
  w: number;
  h: number;
  /** Pixels of the widget frame (0 when unknown). */
  widthPx: number;
  heightPx: number;
  /** Maximized or focus-mode: the widget owns most of the screen. */
  expanded: boolean;
  /** Stacked single-column layout (narrow viewport): height is content-driven. */
  stacked: boolean;
}

export const DEFAULT_WIDGET_SIZE: WidgetSize = {
  w: 6,
  h: 8,
  widthPx: 0,
  heightPx: 0,
  expanded: false,
  stacked: false,
};

export const WidgetSizeContext = createContext<WidgetSize>(DEFAULT_WIDGET_SIZE);

export function useWidgetSize(): WidgetSize {
  return useContext(WidgetSizeContext);
}
