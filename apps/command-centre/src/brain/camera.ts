/**
 * Camera helpers: timed flights (`flyTo`, `fitToBounds`), the plain zoom
 * target (the physics step eases the live transform toward it) and minimap
 * dragging. Overlay panels reserve screen insets so a framed sector lands in
 * the free part of the viewport instead of under a panel.
 */
import { useCallback, useEffect, useMemo, type MutableRefObject, type RefObject } from "react";
import {
  cancelFlight,
  centreTransform,
  contentBounds,
  fitToBounds as fitBounds,
  startFlight,
  type Bounds,
  type FlightOptions,
  type Insets,
  zoomTarget,
} from "./engine/flight";
import { clampZoom, type Transform, type World } from "./engine/world";

export interface Camera {
  /** Multiply the zoom (clamped), keeping the centre. */
  by: (factor: number) => void;
  /** Back to 1× at the origin (animated). */
  reset: () => void;
  /** Fit everything drawn (visible files, hubs, orbs) into the free viewport. */
  fit: () => void;
  /** Centre a world point, zooming in a little if we are far out (animated). */
  centerOn: (x: number, y: number, k?: number) => void;
  /** Animate to an explicit transform. */
  flyTo: (target: Transform, opts?: FlightOptions) => void;
  /** Animate so `bounds` fills the viewport minus the panel insets. */
  fitToBounds: (bounds: Bounds | null, opts?: { padding?: number; maxK?: number } & FlightOptions) => void;
  /** Ready-made handlers for the zoom stack. */
  controls: { in: () => void; out: () => void; fit: () => void; reset: () => void };
}

/** Screen pixels reserved by the overlay panels (updated by the container). */
export type InsetsRef = MutableRefObject<Insets>;

export function useCamera(
  world: MutableRefObject<World>,
  viewRef: MutableRefObject<{ width: number; height: number }>,
  insetsRef: InsetsRef,
  dirty: () => void,
  /** When true, flights jump instead of animating (prefers-reduced-motion / economy). A ref keeps the callbacks stable. */
  reduceMotionRef?: MutableRefObject<boolean>,
  /** Re-measures `insetsRef` before any helper that frames against it (a resize must not leave them stale). */
  refreshInsets?: () => void,
): Camera {
  const flyTo = useCallback(
    (target: Transform, opts?: FlightOptions) => {
      const w = world.current;
      startFlight(w, target, viewRef.current, {
        ...opts,
        duration: reduceMotionRef?.current ? 0 : opts?.duration,
      });
      dirty();
    },
    [world, viewRef, dirty, reduceMotionRef],
  );
  const by = useCallback(
    (factor: number) => {
      const w = world.current;
      const next = zoomTarget(w, factor, clampZoom);
      if (w.flight) {
        // Compose with the flight in progress instead of freezing it mid-way.
        startFlight(w, next, viewRef.current, { duration: reduceMotionRef?.current ? 0 : 0.2 });
      } else {
        w.target = next;
      }
      dirty();
    },
    [world, viewRef, dirty, reduceMotionRef],
  );
  const reset = useCallback(() => flyTo({ x: 0, y: 0, k: 1 }), [flyTo]);
  const fitToBounds = useCallback(
    (bounds: Bounds | null, opts: { padding?: number; maxK?: number } & FlightOptions = {}) => {
      const { padding, maxK, ...flight } = opts;
      refreshInsets?.();
      flyTo(fitBounds(bounds, viewRef.current, { padding, maxK, insets: insetsRef.current }), flight);
    },
    [flyTo, viewRef, insetsRef, refreshInsets],
  );
  const fit = useCallback(
    () => fitToBounds(contentBounds(world.current), { padding: 30, maxK: 2.5 }),
    [fitToBounds, world],
  );
  const centerOn = useCallback(
    (x: number, y: number, k?: number) => {
      const w = world.current;
      const live = w.flight ? w.flight.to.k : w.target.k;
      refreshInsets?.();
      flyTo(centreTransform(x, y, k ?? Math.max(live, 1.8), insetsRef.current));
    },
    [world, flyTo, insetsRef, refreshInsets],
  );
  const controls = useMemo(() => ({ in: () => by(1.3), out: () => by(0.77), fit, reset }), [by, fit, reset]);
  return useMemo(
    () => ({ by, reset, fit, centerOn, flyTo, fitToBounds, controls }),
    [by, reset, fit, centerOn, flyTo, fitToBounds, controls],
  );
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
      const w = world.current;
      cancelFlight(w);
      const rect = mini.getBoundingClientRect();
      const scale = Math.min(rect.width, rect.height) / w.minimapExtent;
      const k = w.target.k;
      w.target = {
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
