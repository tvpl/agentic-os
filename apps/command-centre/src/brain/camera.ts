/**
 * Camera helpers: the animated zoom/pan target (the physics step eases the
 * live transform toward it) and minimap dragging.
 */
import { useCallback, useEffect, useMemo, type MutableRefObject, type RefObject } from "react";
import { WORLD_EXTENT, clampZoom, type World } from "./engine/world";

export interface Camera {
  /** Multiply the zoom (clamped), keeping the centre. */
  by: (factor: number) => void;
  /** Back to 1× at the origin. */
  reset: () => void;
  /** Fit the whole world into the viewport. */
  fit: () => void;
  /** Centre a world point, zooming in a little if we are far out. */
  centerOn: (x: number, y: number, k?: number) => void;
  /** Ready-made handlers for the zoom stack. */
  controls: { in: () => void; out: () => void; fit: () => void; reset: () => void };
}

export function useCamera(
  world: MutableRefObject<World>,
  viewRef: MutableRefObject<{ width: number; height: number }>,
  dirty: () => void,
): Camera {
  const by = useCallback(
    (factor: number) => {
      world.current.target.k = clampZoom(world.current.target.k * factor);
      dirty();
    },
    [world, dirty],
  );
  const reset = useCallback(() => {
    world.current.target = { x: 0, y: 0, k: 1 };
    dirty();
  }, [world, dirty]);
  const fit = useCallback(() => {
    const { width, height } = viewRef.current;
    world.current.target = { x: 0, y: 0, k: clampZoom(Math.min(width, height) / WORLD_EXTENT) };
    dirty();
  }, [world, viewRef, dirty]);
  const centerOn = useCallback(
    (x: number, y: number, k?: number) => {
      const nk = clampZoom(k ?? Math.max(world.current.target.k, 2.1));
      world.current.target = { x: -x * nk, y: -y * nk, k: nk };
      dirty();
    },
    [world, dirty],
  );
  const controls = useMemo(() => ({ in: () => by(1.3), out: () => by(0.77), fit, reset }), [by, fit, reset]);
  return useMemo(() => ({ by, reset, fit, centerOn, controls }), [by, reset, fit, centerOn, controls]);
}

/** Click / drag the minimap to move the viewport. `enabled` re-binds when the panel mounts. */
export function useMinimapNav(
  minimapRef: RefObject<HTMLCanvasElement>,
  world: MutableRefObject<World>,
  dirty: () => void,
  enabled: boolean,
): void {
  useEffect(() => {
    const mini = minimapRef.current;
    if (!mini || !enabled) return;
    let down = false;
    const jump = (e: PointerEvent) => {
      const rect = mini.getBoundingClientRect();
      const scale = rect.width / WORLD_EXTENT;
      const k = world.current.target.k;
      world.current.target = {
        x: -((e.clientX - rect.left - rect.width / 2) / scale) * k,
        y: -((e.clientY - rect.top - rect.height / 2) / scale) * k,
        k,
      };
      dirty();
    };
    const onDown = (e: PointerEvent) => {
      down = true;
      mini.setPointerCapture(e.pointerId);
      jump(e);
    };
    const onMove = (e: PointerEvent) => down && jump(e);
    const onUp = () => (down = false);
    mini.addEventListener("pointerdown", onDown);
    mini.addEventListener("pointermove", onMove);
    mini.addEventListener("pointerup", onUp);
    return () => {
      mini.removeEventListener("pointerdown", onDown);
      mini.removeEventListener("pointermove", onMove);
      mini.removeEventListener("pointerup", onUp);
    };
  }, [minimapRef, world, dirty, enabled]);
}
