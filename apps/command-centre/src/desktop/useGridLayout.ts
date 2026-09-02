/**
 * Grid metrics (rows/cols/cell size, stacked breakpoint), the local layout
 * state with debounced persistence, and drag/resize/keyboard interactions.
 *
 * The local layout is the source of truth while the user edits: the server
 * copy is only adopted when nothing is in flight and nothing is dirty, so a
 * refetch can never silently revert an in-progress or failed-but-local edit.
 */
import { useCallback, useEffect, useRef, useState, type CSSProperties, type RefObject } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import { qk } from "../queries";
import {
  COLS,
  GRID_PAD,
  GRID_TOP,
  MIN_H,
  MIN_W,
  STACK_BREAKPOINT,
  computeRows,
  layoutsEqual,
  normalizeLayout,
  type LayoutMap,
  type WidgetBox,
} from "./defaultLayout";

export interface GridMetrics {
  width: number;
  height: number;
  cols: number;
  rows: number;
  cellW: number;
  cellH: number;
  /** Narrow viewport: widgets stack in one scrollable column, no grid. */
  stacked: boolean;
}

export function useGridMetrics(ref: RefObject<HTMLElement>): GridMetrics {
  const [size, setSize] = useState({ w: 1200, h: 800 });
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => setSize((prev) => (prev.w === el.clientWidth && prev.h === el.clientHeight ? prev : { w: el.clientWidth, h: el.clientHeight }));
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);

  const rows = computeRows(size.h - GRID_TOP - GRID_PAD);
  const cellW = (size.w - GRID_PAD * 2) / COLS;
  const cellH = (size.h - GRID_TOP - GRID_PAD) / rows;
  const stacked = size.w < STACK_BREAKPOINT;

  useEffect(() => {
    document.documentElement.style.setProperty("--cell-w", `${cellW}px`);
    document.documentElement.style.setProperty("--cell-h", `${cellH}px`);
  }, [cellW, cellH]);

  return { width: size.w, height: size.h, cols: COLS, rows, cellW, cellH, stacked };
}

export function boxToPx(box: WidgetBox, m: GridMetrics): CSSProperties {
  return {
    left: GRID_PAD + box.x * m.cellW,
    top: GRID_TOP + box.y * m.cellH,
    width: box.w * m.cellW - 8,
    height: box.h * m.cellH - 8,
  };
}

const PERSIST_DEBOUNCE_MS = 300;

export interface LayoutState {
  layout: LayoutMap;
  /** Apply a new layout locally and persist it (debounced). */
  commit: (next: LayoutMap) => void;
  saving: boolean;
  /** Local changes not yet confirmed by the server. */
  dirty: boolean;
}

export function useLayoutState({
  serverLayout,
  rows,
  editing,
  onError,
}: {
  serverLayout: Partial<Record<string, Partial<WidgetBox>>> | undefined;
  rows: number;
  editing: boolean;
  onError: (err: Error) => void;
}): LayoutState {
  const qc = useQueryClient();
  const [layout, setLayout] = useState<LayoutMap>(() => normalizeLayout(serverLayout, rows));
  const [dirty, setDirty] = useState(false);
  const latestRef = useRef(layout);
  const timerRef = useRef<number>();
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;

  const mutation = useMutation({
    mutationFn: (next: LayoutMap) => api.put("/api/settings", { dashboardLayout: next }),
    onSuccess: (_data, vars) => {
      if (vars === latestRef.current) setDirty(false);
      qc.invalidateQueries({ queryKey: qk.settings }).catch(() => undefined);
    },
    onError: (err: Error) => onErrorRef.current(err),
  });
  const { mutate, isPending } = mutation;

  // Adopt the server layout only when idle: not editing, nothing pending, nothing dirty.
  useEffect(() => {
    if (editing || isPending || dirty || !serverLayout) return;
    const next = normalizeLayout(serverLayout, rows);
    setLayout((prev) => (layoutsEqual(prev, next) ? prev : next));
  }, [serverLayout, rows, editing, isPending, dirty]);

  // The grid changed size: keep the local layout valid (no persistence, not a user edit).
  useEffect(() => {
    setLayout((prev) => {
      const next = normalizeLayout(prev, rows);
      return layoutsEqual(prev, next) ? prev : next;
    });
  }, [rows]);

  useEffect(() => {
    latestRef.current = layout;
  }, [layout]);

  const commit = useCallback(
    (next: LayoutMap) => {
      latestRef.current = next;
      setLayout(next);
      setDirty(true);
      window.clearTimeout(timerRef.current);
      timerRef.current = window.setTimeout(() => mutate(next), PERSIST_DEBOUNCE_MS);
    },
    [mutate],
  );

  // Flush a pending save on unmount (navigating away right after a drag).
  useEffect(
    () => () => {
      if (timerRef.current !== undefined) {
        window.clearTimeout(timerRef.current);
        mutate(latestRef.current);
      }
    },
    [mutate],
  );

  return { layout, commit, saving: isPending, dirty };
}

/* ---------------------------------------------------------------------------
   Drag, resize and keyboard nudging (edit mode only).
--------------------------------------------------------------------------- */
export interface DragState {
  id: string;
  mode: "move" | "resize";
  px: number;
  py: number;
  box: WidgetBox;
}

export function clampMove(box: WidgetBox, x: number, y: number, m: Pick<GridMetrics, "cols" | "rows">): WidgetBox {
  return { ...box, x: Math.max(0, Math.min(m.cols - box.w, x)), y: Math.max(0, Math.min(m.rows - box.h, y)) };
}

export function clampResize(box: WidgetBox, w: number, h: number, m: Pick<GridMetrics, "cols" | "rows">): WidgetBox {
  return { ...box, w: Math.max(MIN_W, Math.min(m.cols - box.x, w)), h: Math.max(MIN_H, Math.min(m.rows - box.y, h)) };
}

export function useWidgetDrag(layout: LayoutMap, metrics: GridMetrics, commit: (next: LayoutMap) => void) {
  const [drag, setDrag] = useState<DragState | null>(null);
  const [ghost, setGhost] = useState<WidgetBox | null>(null);
  const ghostRef = useRef<WidgetBox | null>(null);

  useEffect(() => {
    if (!drag) return;
    const onMove = (e: PointerEvent) => {
      const dx = e.clientX - drag.px;
      const dy = e.clientY - drag.py;
      const next =
        drag.mode === "move"
          ? clampMove(drag.box, Math.round(drag.box.x + dx / metrics.cellW), Math.round(drag.box.y + dy / metrics.cellH), metrics)
          : clampResize(drag.box, Math.round(drag.box.w + dx / metrics.cellW), Math.round(drag.box.h + dy / metrics.cellH), metrics);
      ghostRef.current = next;
      setGhost(next);
    };
    const onUp = () => {
      const g = ghostRef.current;
      if (g) commit({ ...layout, [drag.id]: g });
      ghostRef.current = null;
      setDrag(null);
      setGhost(null);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp, { once: true });
    window.addEventListener("pointercancel", onUp, { once: true });
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };
  }, [drag, metrics, layout, commit]);

  const start = useCallback((id: string, mode: DragState["mode"], e: { clientX: number; clientY: number }, box: WidgetBox) => {
    ghostRef.current = box;
    setDrag({ id, mode, px: e.clientX, py: e.clientY, box });
    setGhost(box);
  }, []);

  /** Arrow keys move by one cell; with Shift they resize by one cell. */
  const nudge = useCallback(
    (id: string, key: string, shift: boolean): boolean => {
      const box = layout[id];
      if (!box) return false;
      const delta: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
      const d = delta[key];
      if (!d) return false;
      const next = shift ? clampResize(box, box.w + d[0], box.h + d[1], metrics) : clampMove(box, box.x + d[0], box.y + d[1], metrics);
      if (next.x !== box.x || next.y !== box.y || next.w !== box.w || next.h !== box.h) commit({ ...layout, [id]: next });
      return true;
    },
    [layout, metrics, commit],
  );

  return { drag, ghost, start, nudge };
}
