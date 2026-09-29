/**
 * The scenes that have their own composition (immersive shell). A scene not
 * listed here shows its production view full screen. Each is its own chunk.
 */
import type { ComponentType } from "react";
import { lazyRoute } from "../lazyRoute";
import type { SceneId } from "./scenes";

export interface SceneViewProps {
  onMetaChanged: () => void;
}

export const SCENE_VIEWS: Partial<Record<SceneId, ComponentType<SceneViewProps>>> = {
  brain: lazyRoute(() => import("./scenes/BrainScene")),
  runs: lazyRoute(() => import("./scenes/RunsScene")),
  skills: lazyRoute(() => import("./scenes/SkillsScene")),
  routines: lazyRoute(() => import("./scenes/RoutinesScene")),
};
