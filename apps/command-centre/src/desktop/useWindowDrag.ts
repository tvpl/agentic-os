/**
 * Dragging, resizing and keyboard nudging for the window layer (F4a).
 *
 * The grid's reducer pushed neighbours out of the way; windows overlap, so
 * there is nothing to settle — a drag is just a position, committed on
 * pointerup. Motion still never goes through React state: the dragged window
 * is moved with `translate3d` in one rAF per pointer frame, and only the
 * final box is committed.
 */
import { useCallback, useRef, useState } from "react";
import { minFor } from "./defaultWindows";
import {
  KEEP_VISIBLE,
  clampIntoStage,
  clampSize,
  raise,
  snapBox,
  snapEdgeAt,
  type Size,
  type SnapEdge,
  type WindowBox,
  type WindowMap,
} from "./windowModel";

export type DragMode = "move" | "resize";

export interface WindowDrag {
  draggingId: string | null;
  mode: DragMode | null;
  /** Box the pointer is currently proposing, drawn as a snap preview. */
  snapPreview: Omit<WindowBox, "z" | "visible"> | null;
  start: (id: string, mode: DragMode, e: React.PointerEvent, box: WindowBox) => void;
  nudge: (id: string, key: string, resize: boolean) => boolean;
}

const NUDGE_PX = 16;

export function useWindowDrag(
  layout: WindowMap,
  stage: Size,
  onChange: (next: WindowMap) => void,
): WindowDrag {
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [mode, setMode] = useState<DragMode | null>(null);
  const [snapPreview, setSnapPreview] = useState<Omit<WindowBox, "z" | "visible"> | null>(null);
  const layoutRef = useRef(layout);
  layoutRef.current = layout;
  const stageRef = useRef(stage);
  stageRef.current = stage;
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  const start = useCallback((id: string, dragMode: DragMode, e: React.PointerEvent, box: WindowBox) => {
    if (e.button !== 0) return;
    const el = (e.currentTarget as HTMLElement).closest<HTMLElement>(".widget");
    if (!el) return;
    e.preventDefault();
    // A drag begins with a raise: whatever you grab comes to the front.
    onChangeRef.current(raise(layoutRef.current, id));
    setDraggingId(id);
    setMode(dragMode);
    document.body.classList.add("window-dragging");

    const startX = e.clientX;
    const startY = e.clientY;
    const origin = { ...box };
    const min = minFor(id);
    let latest: WindowBox = origin;
    let edge: SnapEdge = null;
    let frame = 0;

    const apply = () => {
      frame = 0;
      if (dragMode === "move") {
        el.style.transform = `translate3d(${latest.x - origin.x}px, ${latest.y - origin.y}px, 0)`;
      } else {
        el.style.width = `${latest.w}px`;
        el.style.height = `${latest.h}px`;
      }
    };

    const move = (ev: PointerEvent) => {
      const dx = ev.clientX - startX;
      const dy = ev.clientY - startY;
      const s = stageRef.current;
      if (dragMode === "move") {
        const keep = Math.min(KEEP_VISIBLE, origin.w);
        latest = {
          ...origin,
          x: Math.min(Math.max(origin.x + dx, -(origin.w - keep)), Math.max(0, s.w - keep)),
          y: Math.min(Math.max(origin.y + dy, 0), Math.max(0, s.h - 32)),
        };
        // Snap is armed by the pointer, not by the window's own edge: the
        // user aims at the screen edge, not at where the box happens to end.
        const rect = el.parentElement?.getBoundingClientRect();
        const px = ev.clientX - (rect?.left ?? 0);
        const py = ev.clientY - (rect?.top ?? 0);
        const next = snapEdgeAt(px, py, s);
        if (next !== edge) {
          edge = next;
          setSnapPreview(next ? snapBox(next, s) : null);
        }
      } else {
        const sized = clampSize({ w: origin.w + dx, h: origin.h + dy }, min, s);
        latest = { ...origin, ...sized };
      }
      if (!frame) frame = requestAnimationFrame(apply);
    };

    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
      cancelAnimationFrame(frame);
      // Only the transform is ours to clear. Width and height are React's:
      // it wrote them through the same inline style object, and a move that
      // does not change the size produces no style diff — so clearing them
      // here left the window at 0 × 0 until something else re-rendered it.
      el.style.transform = "";
      document.body.classList.remove("window-dragging");
      setDraggingId(null);
      setMode(null);
      setSnapPreview(null);
      const settled: WindowBox = edge
        ? { ...latest, ...snapBox(edge, stageRef.current) }
        : clampIntoStage(latest, stageRef.current, min);
      const current = layoutRef.current;
      const before = current[id];
      if (!before) return;
      if (
        before.x === settled.x &&
        before.y === settled.y &&
        before.w === settled.w &&
        before.h === settled.h
      )
        return;
      // Only the geometry: `settled` descends from the box captured at
      // pointerdown, so it still carries the stacking order from *before* the
      // grab raised this window. Spreading it whole would undo that raise.
      const { x, y, w, h } = settled;
      onChangeRef.current({ ...current, [id]: { ...before, x, y, w, h } });
    };

    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
  }, []);

  /** Arrow keys move the focused window; with Shift they resize it. */
  const nudge = useCallback((id: string, key: string, resize: boolean): boolean => {
    const current = layoutRef.current;
    const box = current[id];
    if (!box) return false;
    const step = NUDGE_PX;
    const delta: Record<string, [number, number]> = {
      ArrowLeft: [-step, 0],
      ArrowRight: [step, 0],
      ArrowUp: [0, -step],
      ArrowDown: [0, step],
    };
    const d = delta[key];
    if (!d) return false;
    const next = resize
      ? { ...box, ...clampSize({ w: box.w + d[0], h: box.h + d[1] }, minFor(id), stageRef.current) }
      : { ...box, x: box.x + d[0], y: box.y + d[1] };
    onChangeRef.current({
      ...current,
      [id]: clampIntoStage(next, stageRef.current, minFor(id)),
    });
    return true;
  }, []);

  return { draggingId, mode, snapPreview, start, nudge };
}
