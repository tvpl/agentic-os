import { useEffect, useState, type MutableRefObject } from "react";
import type { World } from "./engine/world";

/** Local readout only: camera movement must not rerender the graph container. */
export function ZoomReadout({ world }: { world: MutableRefObject<World> }) {
  const [percent, setPercent] = useState(() => Math.round(world.current.transform.k * 100));
  useEffect(() => {
    const timer = window.setInterval(() => {
      if (!document.hidden) setPercent(Math.round(world.current.transform.k * 100));
    }, 200);
    return () => window.clearInterval(timer);
  }, [world]);
  return (
    <output className="zoom-readout" aria-label="Zoom">
      {percent}%
    </output>
  );
}
