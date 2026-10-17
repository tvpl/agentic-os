/**
 * The depth gauge (Brain scene, immersive shell): where you are on the
 * semantic zoom — areas, hubs, notes, synapses — as a vertical instrument on
 * the sky's edge, and under it a compass: which way you face, how far you
 * lean over the sky, how much closer than the whole view you are. A marker
 * slides as you zoom; each stop is a button that flies to that depth; the
 * compass takes you home. It listens to the stage itself, so moving never
 * re-renders the scene.
 */
import { useEffect, useRef, useState, type CSSProperties } from "react";
import { useT, type TKey } from "../../i18n";
import type { Stage } from "./brainStage";
import { ZOOM_LEVELS, type ZoomLevel } from "./brainZoom";
import { Tooltip } from "../../ui";

const KEYS: Record<ZoomLevel, TKey> = {
  areas: "scene.brain.zoom.areas",
  hubs: "scene.brain.zoom.hubs",
  notes: "scene.brain.zoom.notes",
  synapses: "scene.brain.zoom.synapses",
};

export function BrainSceneGauge({
  stage,
  onLevel,
  onHome,
}: {
  stage: Stage;
  /** Go to a depth (0 areas … 3 synapses: into the star under the reticle). */
  onLevel: (level: number) => void;
  /** Back to the whole sky from the default heading. */
  onHome: () => void;
}) {
  const t = useT();
  const [level, setLevel] = useState(stage.level);
  const compassRef = useRef<HTMLButtonElement>(null);
  const readRef = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    stage.onLevel = (l) => setLevel(Math.round(l * 20) / 20);
    stage.onView = (v) => {
      const el = compassRef.current;
      if (el) {
        el.style.setProperty("--yaw", `${(-v.yaw * 180) / Math.PI}deg`);
        el.style.setProperty("--tilt", String(Math.max(0.18, Math.abs(Math.sin(v.pitch)))));
      }
      if (readRef.current)
        readRef.current.textContent = `×${v.zoom >= 10 ? Math.round(v.zoom) : v.zoom.toFixed(1)}`;
    };
    stage.wake();
    return () => {
      stage.onLevel = () => undefined;
      stage.onView = () => undefined;
    };
  }, [stage]);
  const current = Math.min(3, Math.round(level));
  return (
    <nav
      className="bs-gauge"
      aria-label={t("scene.brain.zoom")}
      style={{ "--lv": level / 3 } as CSSProperties}
    >
      <div className="bs-gauge-scale">
        <span className="bs-gauge-rail" aria-hidden>
          <i className="bs-gauge-mark" />
        </span>
        <ol>
          {ZOOM_LEVELS.map((z, k) => (
            <li key={z}>
              <button
                type="button"
                aria-current={k === current ? "step" : undefined}
                title={t("scene.brain.zoomTo", { level: t(KEYS[z]) })}
                onClick={() => onLevel(k)}
              >
                {t(KEYS[z])}
              </button>
            </li>
          ))}
        </ol>
      </div>
      <Tooltip label={t("scene.brain.compass")}>
        <button
          ref={compassRef}
          type="button"
          className="bs-compass"
          aria-label={t("scene.brain.compass")}
          onClick={onHome}
        >
          <svg width={38} height={38} viewBox="-20 -20 40 40" aria-hidden focusable="false">
            <circle r={17.5} className="bs-compass-ring" />
            <ellipse className="bs-compass-plane" cx={0} cy={0} rx={12} ry={12} />
            <g className="bs-compass-dial">
              <path d="M0 -17 L3 -9.5 L-3 -9.5 Z" className="bs-compass-north" />
              <path d="M17 0 L13 0 M-17 0 L-13 0 M0 17 L0 13" className="bs-compass-ticks" />
            </g>
            <circle r={1.8} className="bs-compass-eye" />
          </svg>
          <span ref={readRef} className="bs-zoomread">
            ×1.0
          </span>
        </button>
      </Tooltip>
    </nav>
  );
}
