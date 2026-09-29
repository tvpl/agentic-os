/**
 * The agent's visual body: a living, volumetric energy core rendered in
 * WebGL2, with a crisp HUD around it where the agent's tool calls appear as
 * satellites. Two sizes:
 *
 * - `hero`: the big presence of the home scene (400–700 px), with rings,
 *   micro-text and activity satellites.
 * - `iris`: 36–56 px, at the left of the voice line in every scene; the same
 *   core with a single ring.
 *
 * Every state has its own behaviour (see `entityParams.ts`), and changes
 * glide over ~600 ms. Falls back to the 2D `CoreOrb` when WebGL2 is missing
 * or the context is lost.
 *
 * Inputs besides props: `TYPING_EVENT` (one per keystroke → listening ripples)
 * and `SPEAK_EVENT` (`CustomEvent<{ chars }>` while reply text streams →
 * voice waves), both on `window`.
 */
import { useEffect, useRef, useState } from "react";
import type { CoreState } from "../../desktop/coreState";
import CoreOrb from "../CoreOrb";
import { EntityEngine } from "./entityEngine";
import { stateWord, type EntityActivity } from "./entityParams";
import "./entity.css";

export { SPEAK_EVENT } from "./entityEngine";
export { TYPING_EVENT } from "../CoreOrb";
export type { EntityActivity } from "./entityParams";

export interface EntityProps {
  state: CoreState;
  /** hero: the big presence in the home scene; iris: the small one beside the voice line. */
  variant: "hero" | "iris";
  /** Economy render profile: ~12 fps. */
  economy?: boolean;
  /** Hero only: what the agent is doing right now (tool calls), newest last, max ~6. */
  activity?: readonly EntityActivity[];
  /** Word shown in the micro-text ring (e.g. a localized state name); defaults to the state. */
  stateLabel?: string;
  className?: string;
}

const NO_ACTIVITY: readonly EntityActivity[] = [];

export default function Entity({
  state,
  variant,
  economy = false,
  activity = NO_ACTIVITY,
  stateLabel,
  className,
}: EntityProps) {
  const wrap = useRef<HTMLDivElement>(null);
  const engine = useRef<EntityEngine | null>(null);
  const [failed, setFailed] = useState(false);
  const latest = useRef({ state, activity, word: stateLabel ?? stateWord(state) });
  latest.current = { state, activity, word: stateLabel ?? stateWord(state) };

  useEffect(() => {
    const host = wrap.current;
    if (!host || failed) return;
    // Fresh canvases per engine: a canvas whose context was lost cannot get a new one.
    const glCanvas = document.createElement("canvas");
    glCanvas.className = "entity-gl";
    const hudCanvas = document.createElement("canvas");
    hudCanvas.className = "entity-hud";
    host.append(glCanvas, hudCanvas);
    const e = EntityEngine.create(host, glCanvas, hudCanvas, { variant, economy }, () => setFailed(true));
    if (!e) {
      glCanvas.remove();
      hudCanvas.remove();
      setFailed(true);
      return;
    }
    engine.current = e;
    const now = latest.current;
    e.setWord(now.word);
    e.setState(now.state, true);
    e.setActivity(now.activity);
    return () => {
      e.dispose();
      engine.current = null;
      glCanvas.remove();
      hudCanvas.remove();
    };
  }, [variant, economy, failed]);

  useEffect(() => {
    engine.current?.setState(state);
  }, [state]);

  useEffect(() => {
    engine.current?.setActivity(activity);
  }, [activity]);

  const word = stateLabel ?? stateWord(state);
  useEffect(() => {
    engine.current?.setWord(word);
  }, [word]);

  const cls = className ? `entity entity--${variant} ${className}` : `entity entity--${variant}`;
  if (failed) {
    return (
      <div className={cls} data-state={state} aria-hidden>
        <CoreOrb state={state} mini={variant === "iris"} economy={economy} className="entity-fallback" />
      </div>
    );
  }
  return <div ref={wrap} className={cls} data-state={state} aria-hidden />;
}
