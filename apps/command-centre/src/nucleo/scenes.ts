/**
 * The scenes (immersive shell). There are no windows: each place in the OS
 * fills the screen, one at a time, and the URL says which. The five main
 * scenes sit on the horizon and answer to 1–5; the rest are reached from the
 * palette, the horizon's "more" and deep links, and appear on the horizon
 * only while you are in them.
 */
import type { TKey } from "../i18n";
import type { AppKind } from "../desktop/apps";

export type SceneId = "nucleo" | AppKind;

export interface SceneDef {
  id: SceneId;
  /** The route that is this scene; deeper paths (`/runs/abc`) stay in it. */
  path: string;
  labelKey: TKey;
  /** One glyph, the same family the panels used. */
  glyph: string;
  /** On the horizon and on the number keys. */
  main: boolean;
  /** The production view behind it; the Núcleo has none. */
  app?: AppKind;
}

export const SCENES: readonly SceneDef[] = [
  { id: "nucleo", path: "/", labelKey: "nucleo.scene.nucleo", glyph: "◉", main: true },
  { id: "brain", path: "/brain", labelKey: "nucleo.scene.brain", glyph: "✦", main: true, app: "brain" },
  { id: "runs", path: "/runs", labelKey: "nucleo.scene.runs", glyph: "⎔", main: true, app: "runs" },
  { id: "skills", path: "/skills", labelKey: "nucleo.scene.skills", glyph: "⬡", main: true, app: "skills" },
  {
    id: "routines",
    path: "/routines",
    labelKey: "nucleo.scene.routines",
    glyph: "◷",
    main: true,
    app: "routines",
  },
  {
    id: "connectors",
    path: "/connectors",
    labelKey: "nucleo.scene.connectors",
    glyph: "⌬",
    main: false,
    app: "connectors",
  },
  {
    id: "artifacts",
    path: "/artifacts",
    labelKey: "nucleo.scene.artifacts",
    glyph: "◈",
    main: false,
    app: "artifacts",
  },
  {
    id: "generations",
    path: "/generations",
    labelKey: "nucleo.scene.generations",
    glyph: "▦",
    main: false,
    app: "generations",
  },
  { id: "pixel", path: "/pixel", labelKey: "nucleo.scene.pixel", glyph: "▩", main: false, app: "pixel" },
  {
    id: "settings",
    path: "/settings",
    labelKey: "nucleo.scene.settings",
    glyph: "⚙",
    main: false,
    app: "settings",
  },
];

export const MAIN_SCENES = SCENES.filter((s) => s.main);

export function sceneById(id: SceneId): SceneDef {
  return SCENES.find((s) => s.id === id) ?? SCENES[0]!;
}

/** The scene a URL is in: `/runs/abc` is Runs, anything unknown is the Núcleo. */
export function sceneForPath(pathname: string): SceneDef {
  const segment = `/${pathname.split("/")[1] ?? ""}`;
  if (segment === "/") return SCENES[0]!;
  return SCENES.find((s) => s.path === segment) ?? SCENES[0]!;
}

/**
 * How a change of scene travels: into a scene from the Núcleo is a dive,
 * back to it a rise, and between two scenes a sideways turn in the
 * direction of the horizon (the shorter way round).
 */
export type Travel = { mode: "dive" | "rise" | "side"; dir: 1 | -1 };
export function travelBetween(from: SceneId, to: SceneId): Travel {
  if (from === "nucleo") return { mode: "dive", dir: 1 };
  if (to === "nucleo") return { mode: "rise", dir: -1 };
  const ring = horizonRing(to);
  const a = ring.findIndex((s) => s.id === from);
  const b = ring.findIndex((s) => s.id === to);
  if (a < 0 || b < 0) return { mode: "side", dir: 1 };
  const n = ring.length;
  let delta = (b - a + n) % n;
  if (delta > n / 2) delta -= n;
  return { mode: "side", dir: delta >= 0 ? 1 : -1 };
}

/** The horizon's ring: the main scenes, plus the current one when it is not main (after the Núcleo). */
export function horizonRing(current: SceneId): SceneDef[] {
  const scene = sceneById(current);
  if (scene.main) return [...MAIN_SCENES];
  return [...MAIN_SCENES, scene];
}

/** Signed distance from `active` to `index` on a ring of `n`, in −⌊n/2⌋…⌊n/2⌋. */
export function ringOffset(index: number, active: number, n: number): number {
  const half = Math.floor(n / 2);
  return ((index - active + n + half) % n) - half;
}
