import { useEffect, useMemo, useState, type MutableRefObject } from "react";
import type { World } from "./engine/world";

/** Tiny pub/sub the render loop pushes the zoom into (no polling). */
export interface ZoomBus {
  subscribe: (fn: (k: number) => void) => () => void;
  emit: (k: number) => void;
}

export function createZoomBus(): ZoomBus {
  const subs = new Set<(k: number) => void>();
  return {
    subscribe: (fn) => {
      subs.add(fn);
      return () => {
        subs.delete(fn);
      };
    },
    emit: (k) => {
      for (const fn of subs) fn(k);
    },
  };
}

export function useZoomBus(): ZoomBus {
  return useMemo(createZoomBus, []);
}

/** Local readout only: camera movement must not rerender the graph container. */
export function ZoomReadout({ world, bus }: { world: MutableRefObject<World>; bus: ZoomBus }) {
  const [percent, setPercent] = useState(() => Math.round(world.current.transform.k * 100));
  useEffect(() => bus.subscribe((k) => setPercent(Math.round(k * 100))), [bus]);
  return (
    <output className="zoom-readout" aria-label="Zoom">
      {percent}%
    </output>
  );
}
