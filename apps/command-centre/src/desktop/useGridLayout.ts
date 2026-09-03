/**
 * Grid metrics (rows/cols/cell size, stacked breakpoint), the local layout
 * state with debounced persistence, and the drag/resize/keyboard hook.
 *
 * The local layout is the source of truth while the user edits: the server
 * copy is only adopted when nothing is in flight and nothing is dirty, so a
 * refetch can never silently revert an in-progress or failed-but-local edit.
 *
 * Drag path (audit 2.2 §3): pointermove never touches React state. The
 * dragged element gets `transform: translate3d()` (or width/height while
 * resizing) written inside one rAF per frame; the only state update is the
 * target cell, and only when it changes. On pointerup the reducer settles
 * the layout (neighbours pushed down) and WidgetLayer FLIP-animates every
 * widget that moved, including the dragged one snapping into its cell.
 */
import { useCallback, useEffect, useRef, useState, type CSSProperties, type RefObject } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import { qk } from "../queries";
import { COLS, GRID_PAD, GRID_TOP, STACK_BREAKPOINT, computeRows, layoutsEqual, normalizeLayout, type LayoutMap, type WidgetBox } from "./defaultLayout";
import { beginDrag, dragOffsetPx, dragTarget, nudgeBox, settleDrag, type DragSession } from "./dragReducer";

export { clampMove, clampResize } from "./dragReducer";

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
const CONFIG_MIRROR_KEY = "mordomo.desktop.widgetConfig";

/**
 * Per-widget `config` mirrored in localStorage: the server settings schema
 * may not carry `config` yet (it strips unknown keys), so the mirror keeps
 * user choices alive until it does. Server wins when present.
 */
function readConfigMirror(): Record<string, Record<string, unknown>> {
  try {
    const raw = localStorage.getItem(CONFIG_MIRROR_KEY);
    return raw ? (JSON.parse(raw) as Record<string, Record<string, unknown>>) : {};
  } catch {
    return {};
  }
}
function writeConfigMirror(layout: LayoutMap) {
  try {
    const out: Record<string, Record<string, unknown>> = {};
    for (const [id, box] of Object.entries(layout)) if (box.config) out[id] = box.config;
    localStorage.setItem(CONFIG_MIRROR_KEY, JSON.stringify(out));
  } catch {
    /* ignore */
  }
}
function mergeMirror(layout: LayoutMap): LayoutMap {
  const mirror = readConfigMirror();
  let changed = false;
  const out: LayoutMap = { ...layout };
  for (const [id, cfg] of Object.entries(mirror)) {
    const box = out[id];
    if (box && !box.config) {
      out[id] = { ...box, config: cfg };
      changed = true;
    }
  }
  return changed ? out : layout;
}

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
  const [layout, setLayout] = useState<LayoutMap>(() => mergeMirror(normalizeLayout(serverLayout, rows)));
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
    const next = mergeMirror(normalizeLayout(serverLayout, rows));
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
      writeConfigMirror(next);
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
export interface WidgetDrag {
  /** Id of the widget being dragged (one re-render at start / end). */
  draggingId: string | null;
  mode: DragSession["mode"] | null;
  /** Target cell while dragging (updates only when the cell changes). */
  target: WidgetBox | null;
  start: (id: string, mode: DragSession["mode"], e: { clientX: number; clientY: number; pointerId?: number }, box: WidgetBox, el: HTMLElement) => void;
  /** Arrow keys move by one cell; with Shift they resize by one cell. */
  nudge: (id: string, key: string, shift: boolean) => boolean;
}

export function useWidgetDrag(
  layout: LayoutMap,
  metrics: GridMetrics,
  commit: (next: LayoutMap) => void,
  /** Called right before the settled layout is committed (WidgetLayer snapshots rects for FLIP). */
  onBeforeCommit?: () => void,
): WidgetDrag {
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [mode, setMode] = useState<DragSession["mode"] | null>(null);
  const [target, setTarget] = useState<WidgetBox | null>(null);
  const sessionRef = useRef<DragSession | null>(null);
  const elRef = useRef<HTMLElement | null>(null);
  const rafRef = useRef(0);
  const lastPointer = useRef({ x: 0, y: 0 });
  const layoutRef = useRef(layout);
  layoutRef.current = layout;
  const metricsRef = useRef(metrics);
  metricsRef.current = metrics;
  const commitRef = useRef(commit);
  commitRef.current = commit;
  const beforeRef = useRef(onBeforeCommit);
  beforeRef.current = onBeforeCommit;

  const applyFrame = useCallback(() => {
    rafRef.current = 0;
    const s = sessionRef.current;
    const el = elRef.current;
    if (!s || !el) return;
    const m = metricsRef.current;
    const { dx, dy } = dragOffsetPx(s, lastPointer.current.x, lastPointer.current.y);
    if (s.mode === "move") {
      el.style.transform = `translate3d(${dx}px, ${dy}px, 0)`;
    } else {
      el.style.width = `${Math.max(m.cellW * 3 - 8, s.origin.w * m.cellW - 8 + dx)}px`;
      el.style.height = `${Math.max(m.cellH * 2 - 8, s.origin.h * m.cellH - 8 + dy)}px`;
    }
    const next = dragTarget(s, lastPointer.current.x, lastPointer.current.y, m);
    if (next !== s.target) {
      s.target = next;
      setTarget(next);
    }
  }, []);

  useEffect(() => {
    if (!draggingId) return;
    const onMove = (e: PointerEvent) => {
      lastPointer.current = { x: e.clientX, y: e.clientY };
      if (!rafRef.current) rafRef.current = requestAnimationFrame(applyFrame);
    };
    const onUp = () => {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = 0;
      const s = sessionRef.current;
      const el = elRef.current;
      sessionRef.current = null;
      elRef.current = null;
      if (s && el) {
        beforeRef.current?.(); // rects with the drag transform still applied
        el.style.transform = "";
        el.style.width = "";
        el.style.height = "";
        const settled = settleDrag(layoutRef.current, s.id, s.target, metricsRef.current);
        if (!layoutsEqual(settled.layout, layoutRef.current)) commitRef.current(settled.layout);
      }
      setDraggingId(null);
      setMode(null);
      setTarget(null);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp, { once: true });
    window.addEventListener("pointercancel", onUp, { once: true });
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
      cancelAnimationFrame(rafRef.current);
      rafRef.current = 0;
    };
  }, [draggingId, applyFrame]);

  const start = useCallback<WidgetDrag["start"]>((id, dragMode, e, box, el) => {
    sessionRef.current = beginDrag(id, dragMode, e.clientX, e.clientY, box);
    elRef.current = el;
    lastPointer.current = { x: e.clientX, y: e.clientY };
    setDraggingId(id);
    setMode(dragMode);
    setTarget(box);
  }, []);

  const nudge = useCallback(
    (id: string, key: string, shift: boolean): boolean => {
      const box = layout[id];
      if (!box) return false;
      const next = nudgeBox(box, key, shift, metrics);
      if (!next) return key.startsWith("Arrow");
      onBeforeCommit?.();
      commit(settleDrag(layout, id, next, metrics).layout);
      return true;
    },
    [layout, metrics, commit, onBeforeCommit],
  );

  return { draggingId, mode, target, start, nudge };
}
