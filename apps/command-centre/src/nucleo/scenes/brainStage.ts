/**
 * The Brain scene's stage (immersive shell): the one mutable object the React
 * side writes (data, the dimension, selection, highlights, where the free
 * space is) and the render loop reads every frame. Keeping it outside React
 * state means a hover or a camera move never re-renders the scene.
 *
 * It also owns the choreography that is not drawing: stars morphing between
 * arrangements, entering a note (its synapses become the space), travelling
 * through a synapse to a neighbour, and leaving back to where you were. Pure
 * apart from the clock the caller passes in.
 */
import { fitView, stopVel, zeroVel, type CamVel, type FlyInput } from "./brainCamera";
import { controlPoint } from "./brainCurve";
import type { DimLayout, Dimension } from "./brainDimensions";
import type { Ego } from "./brainEgo";
import type { ContentKind } from "./brainGlyphs";
import {
  clamp,
  hash01,
  planFlight,
  planPathFlight,
  type Camera,
  type Cluster,
  type Flight,
  type Vec3,
} from "./brainSpace";
import { burst, pulseDuration, type Pulse } from "./brainSynapse";

export interface StarCluster extends Cluster {
  color: string;
  /** Faint dust inside the nebula, so even a small brain has depth. */
  dust: Vec3[];
  /** Overlapping puffs of light (offset from the centre) that give the nebula volume. */
  puffs: Array<{ o: Vec3; r: number; a: number }>;
}

/** A glow of colour with volume behind a group of stars (an area, a type, a stretch of time). */
export interface Nebula {
  centre: Vec3;
  radius: number;
  color: string;
  puffs: Array<{ o: Vec3; r: number; a: number }>;
  /** Stars it belongs to (its presence follows theirs). */
  members: number[];
}

export interface StarEdge {
  a: number;
  b: number;
  strong: boolean;
  kind: string;
  why: string;
}

export interface StarModel {
  /** Index = the world's file index (so adjacency and edges line up). The area arrangement. */
  pos: Vec3[];
  /** Base star radius in world units. */
  size: number[];
  color: string[];
  label: string[];
  group: string[];
  mtime: number[];
  /** Index into `clusters`. */
  cluster: number[];
  /** The most linked stars of each cluster: labelled from further away. */
  hub: boolean[];
  clusters: StarCluster[];
  edges: StarEdge[];
  adjacency: number[][];
  radius: number;
  id: number[];
  degree: number[];
  kind: ContentKind[];
  /** Edge indices touching each star. */
  incident: number[][];
}

export interface Insets {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

/** The ego graph you are inside, anchored where its centre was when you arrived. */
export interface EgoState extends Ego {
  anchor: Vec3;
  /** Member index → hop (0 = the centre). */
  hop: Map<number, number>;
}

export interface Stage {
  model: StarModel | null;
  cam: Camera;
  flight: Flight | null;
  /** Visibility target per star (timeline, local mode) and its eased alpha. */
  target: Uint8Array;
  alpha: Float32Array;
  /** Stars lit by a search / legend pick (null = none: everything at full strength). */
  highlight: Set<number> | null;
  /** Name the highlighted stars (a search) or only their landmarks (an area). */
  labelHighlight: boolean;
  selIdx: number;
  hoverIdx: number;
  /** A star pointed at from outside the sky (a link in the reader, a row of the rail). */
  peekIdx: number;
  /** Stars sharing a key term the reader lit up. */
  termLit: Set<number> | null;
  /** How far the reader has read the note (0 … 1): the reticle fills with it. */
  readProgress: number;
  /** Screen space the camera should centre in (reader, lâminas, HUD and voice line removed). */
  insets: Insets;
  /** Screen boxes of the type floating over the sky (legend, tools, gauge, timeline): no words under them. */
  blocked: Array<[number, number, number, number]>;
  /** Last user input (ms): idle rotation waits for a pause. */
  lastInput: number;
  dragging: boolean;
  reduced: boolean;
  economy: boolean;
  /** Timeline cutoff (ms) or null (now). */
  cutoff: number | null;
  /** What the canvas draws into: focal length and the free area (px), for framing. */
  frame: { focal: number; freeW: number; freeH: number } | null;
  /** The canvas' size (px), once it is known. */
  viewport: { w: number; h: number } | null;
  /** Ask the loop for frames (wired by the canvas; a no-op until then). */
  wake: () => void;

  /* ---- arrangement ---- */
  dim: Dimension;
  layout: DimLayout | null;
  /** Text of each guide / group label of the layout (localised by the React side). */
  guideText: string[];
  groupText: string[];
  /** Displayed position of every star (xyz), and the morph between arrangements. */
  pos: Float64Array;
  from: Float64Array;
  to: Float64Array;
  delay: Float32Array;
  morph: { t0: number; dur: number } | null;
  /** Bumped whenever displayed positions change (the canvas caches link curves on it). */
  posVersion: number;
  /** The glows behind the current arrangement's groups. */
  nebulae: Nebula[];

  /* ---- inside a note ---- */
  ego: EgoState | null;
  /** The camera before entering: leaving flies back to it. */
  saved: Camera | null;
  /** Inside a note, keep its space framed as the free area changes (until the user zooms or turns). */
  autoFrame: boolean;
  /** Run once the current flight has arrived (an arrival burst, a new ego graph). */
  arrival: (() => void) | null;
  /** A trip through a synapse under way (for streaks and the lit tunnel). */
  travel: { from: number; to: number; edge: number } | null;

  /* ---- synapses ---- */
  pulses: Pulse[];
  /** Per star: glow of a pulse that just reached it (0 … 1). */
  flash: Float32Array;
  bursts: Array<{ i: number; t0: number }>;

  /* ---- semantic zoom ---- */
  /** Continuous zoom level (0 areas … 3 synapses), written by the canvas. */
  level: number;
  /** Star the wheel would dive into next (−1 none). */
  enterIdx: number;
  /** Where the mouse is over the sky (null when it is elsewhere). */
  pointer: { x: number; y: number } | null;

  /* ---- wiring (set by the React side) ---- */
  onLevel: (level: number) => void;
  onEnter: (idx: number) => void;
  onExit: () => void;
  excerpt: (i: number) => string | undefined;
  need: (i: number) => void;
  /** Frame time (ms, rolling average) and count, for the performance check. */
  stats: { ms: number; frames: number };

  /* ---- the hand ---- */
  /** Velocity of the camera rig: it glides after a gesture and settles. */
  vel: CamVel;
  /** The point a gliding zoom closes in on (null: the focus). */
  zoomAnchor: Vec3 | null;
  /** Fly keys held (WASD / arrows, Q / E). */
  fly: FlyInput;
  /** Link under the cursor (−1 none). */
  hoverEdge: number;
  /** Group (area) name under the cursor (−1 none): its stars light up. */
  hoverGroup: number;
  /** Where the camera looks (the compass, the depth readout); called when it changes. */
  onView: (v: ViewInfo) => void;
  /** Cached framing of the whole arrangement (the overview). */
  homeCache: { key: string; fit: HomeFit } | null;
}

export interface ViewInfo {
  yaw: number;
  pitch: number;
  /** How much closer than the overview the camera is (1 = the whole sky). */
  zoom: number;
}

export interface HomeFit {
  tx: number;
  ty: number;
  tz: number;
  dist: number;
}

export const DEFAULT_PITCH = 0.36;
export const DEFAULT_YAW = 0.6;
export const FLIGHT_MS = 1300;
export const TRAVEL_MS = 1250;
export const MORPH_MS = 1500;
/** Inside a note the camera looks down on its shells, so they read as open ellipses. */
export const EGO_PITCH = 0.9;

export function createStage(): Stage {
  return {
    model: null,
    cam: { yaw: DEFAULT_YAW, pitch: DEFAULT_PITCH, dist: 1400, tx: 0, ty: 0, tz: 0 },
    flight: null,
    target: new Uint8Array(0),
    alpha: new Float32Array(0),
    highlight: null,
    labelHighlight: true,
    selIdx: -1,
    hoverIdx: -1,
    peekIdx: -1,
    termLit: null,
    readProgress: 0,
    insets: { top: 0, right: 0, bottom: 0, left: 0 },
    blocked: [],
    lastInput: 0,
    dragging: false,
    reduced: false,
    economy: false,
    cutoff: null,
    frame: null,
    viewport: null,
    wake: () => undefined,
    dim: "areas",
    layout: null,
    guideText: [],
    groupText: [],
    pos: new Float64Array(0),
    from: new Float64Array(0),
    to: new Float64Array(0),
    delay: new Float32Array(0),
    morph: null,
    posVersion: 0,
    nebulae: [],
    ego: null,
    saved: null,
    autoFrame: false,
    arrival: null,
    travel: null,
    pulses: [],
    flash: new Float32Array(0),
    bursts: [],
    level: 0,
    enterIdx: -1,
    pointer: null,
    onLevel: () => undefined,
    onEnter: () => undefined,
    onExit: () => undefined,
    excerpt: () => undefined,
    need: () => undefined,
    stats: { ms: 0, frames: 0 },
    vel: zeroVel(),
    zoomAnchor: null,
    fly: { right: 0, forward: 0, up: 0 },
    hoverEdge: -1,
    hoverGroup: -1,
    onView: () => undefined,
    homeCache: null,
  };
}

/** Recompute the free area from the canvas' size and the insets (framing must not wait for a frame). */
export function syncFrame(stage: Pick<Stage, "viewport" | "insets" | "frame">): void {
  const v = stage.viewport;
  if (!v) return;
  const ins = stage.insets;
  (stage as { frame: Stage["frame"] }).frame = {
    focal: Math.min(v.w, v.h) * 0.92,
    freeW: Math.max(40, v.w - ins.left - ins.right),
    freeH: Math.max(40, v.h - ins.top - ins.bottom),
  };
}

/** Distance limits for the current sky (inside a note: around its ego graph). */
export function distLimits(
  model: StarModel | null,
  ego?: Pick<EgoState, "r1" | "r2"> | null,
): [number, number] {
  const r = model?.radius ?? 400;
  if (ego) return [Math.max(80, ego.r1 * 0.9), Math.max(ego.r2 * 6, 900)];
  return [70, r * 4 + 900];
}

/**
 * Camera distance at which a sphere of `radius` fills `fill` of the free
 * area's shorter side (before the canvas has drawn: a fixed ratio).
 */
export function fitDistance(stage: Pick<Stage, "frame">, radius: number, fill = 0.42, min = 180): number {
  const f = stage.frame;
  if (!f) return Math.max(min, radius * 2.4 + 60);
  return Math.max(min, (radius * f.focal) / (fill * Math.max(120, Math.min(f.freeW, f.freeH))));
}

/** Margin kept around a framed set of stars (px): room for their names. */
const frameMargin = (f: { freeW: number; freeH: number }) => Math.max(44, Math.min(f.freeW, f.freeH) * 0.11);

/**
 * The whole arrangement framed from the default heading: the reference of
 * the semantic zoom (level 0) and of the depth gauge. Cached per arrangement
 * and free area.
 */
export function homeFit(stage: Pick<Stage, "frame" | "model" | "layout" | "homeCache">): HomeFit {
  const f = stage.frame;
  const pts = stage.layout?.pos ?? stage.model?.pos ?? [];
  if (!f || pts.length === 0) {
    const r = stage.layout?.radius ?? stage.model?.radius ?? 400;
    return {
      tx: 0,
      ty: 0,
      tz: 0,
      dist: fitDistance(stage, r, stage.layout?.dim === "time" ? 0.6 : 0.44, 320),
    };
  }
  const key = `${stage.layout?.dim ?? "m"}:${pts.length}:${Math.round(f.freeW / 8)}:${Math.round(f.freeH / 8)}:${Math.round(f.focal)}:${Math.round(pts[0]!.x)}`;
  if (stage.homeCache?.key === key) return stage.homeCache.fit;
  const fit = fitView(pts, DEFAULT_YAW, DEFAULT_PITCH, f.focal, f.freeW, f.freeH, {
    margin: frameMargin(f),
    min: 240,
  });
  (stage as { homeCache: Stage["homeCache"] }).homeCache = { key, fit };
  return fit;
}

/** The whole sky in view: the camera distance of the overview. */
export function overviewDistance(stage: Pick<Stage, "frame" | "model" | "layout" | "homeCache">): number {
  return homeFit(stage).dist;
}

/**
 * How to stand inside a note: every star of its space in the free area,
 * centred as seen from the current heading (the note itself need not be in
 * the middle — a note with one link would otherwise leave half the view empty).
 */
export function egoFit(
  stage: Pick<Stage, "frame"> & { cam?: Camera },
  ego: Pick<Ego, "r1" | "r2" | "hop2"> & { offset?: Map<number, Vec3> },
  anchor: Vec3 = { x: 0, y: 0, z: 0 },
): HomeFit {
  const f = stage.frame;
  if (!f || !ego.offset || ego.offset.size < 2) {
    const r = ego.hop2.length > 0 ? ego.r2 * 1.02 : ego.r1 * 1.25;
    return { tx: anchor.x, ty: anchor.y, tz: anchor.z, dist: fitDistance(stage, r, 0.4, 200) };
  }
  const pitch = stage.cam?.pitch ?? EGO_PITCH;
  const yaw = stage.cam?.yaw ?? DEFAULT_YAW;
  const fit = fitView([...ego.offset.values()], yaw, pitch, f.focal, f.freeW, f.freeH, {
    margin: frameMargin(f) + 12,
    min: 200,
  });
  return { tx: anchor.x + fit.tx, ty: anchor.y + fit.ty, tz: anchor.z + fit.tz, dist: fit.dist };
}

/** How far to stand inside a note (see `egoFit`). */
export function egoDistance(
  stage: Pick<Stage, "frame"> & { cam?: Camera },
  ego: Pick<Ego, "r1" | "r2" | "hop2"> & { offset?: Map<number, Vec3> },
): number {
  return egoFit(stage, ego).dist;
}

/** Inside a note: fly back to its whole space and keep it framed. */
export function frameEgo(stage: Stage, now: number): void {
  const ego = stage.ego;
  if (!ego) return;
  const fit = egoFit(stage, ego, ego.anchor);
  flyTo(stage, { x: fit.tx, y: fit.ty, z: fit.tz }, fit.dist, now);
  stage.autoFrame = true;
}

/** Closest the wheel goes in the open sky before it starts diving into the star under the reticle. */
export function zoomFloor(stage: Stage): number {
  return Math.max(distLimits(stage.model, null)[0], overviewDistance(stage) * 0.075, 90);
}

/** Furthest the wheel goes inside a note before it starts leaving it. */
export function zoomCeil(stage: Stage): number {
  return stage.ego ? egoDistance(stage, stage.ego) * 2 : distLimits(stage.model, null)[1];
}

/** Fly the camera to a point at a distance (reduced motion: a short cut, not a trip). */
export function flyTo(stage: Stage, p: Vec3, dist: number, now: number, dur = FLIGHT_MS): void {
  const [lo, hi] = distLimits(stage.model, stage.ego);
  stopVel(stage.vel);
  stage.flight = planFlight(
    stage.cam,
    { tx: p.x, ty: p.y, tz: p.z, dist: clamp(dist, lo, hi) },
    now,
    stage.reduced ? 1 : dur,
  );
  stage.arrival = null;
  stage.travel = null;
  stage.autoFrame = false;
  stage.wake();
}

/**
 * Fly so that every one of `points` is in the free area, centred, from the
 * current heading (and `pitch`, when given).
 */
export function flyFit(
  stage: Stage,
  points: readonly Vec3[],
  now: number,
  opts: { pitch?: number; min?: number } = {},
): void {
  const f = stage.frame;
  if (!f || points.length === 0) return;
  const pitch = opts.pitch ?? stage.cam.pitch;
  const fit = fitView(points, stage.cam.yaw, pitch, f.focal, f.freeW, f.freeH, {
    margin: frameMargin(f),
    min: opts.min ?? 200,
  });
  const [lo, hi] = distLimits(stage.model, stage.ego);
  stopVel(stage.vel);
  stage.flight = planFlight(
    stage.cam,
    {
      tx: fit.tx,
      ty: fit.ty,
      tz: fit.tz,
      dist: clamp(fit.dist, lo, hi),
      ...(opts.pitch === undefined ? {} : { pitch }),
    },
    now,
    stage.reduced ? 1 : FLIGHT_MS,
  );
  stage.arrival = null;
  stage.travel = null;
  stage.autoFrame = false;
  stage.wake();
}

/** Where every visible star is headed in the current arrangement. */
export function visibleTargets(stage: Stage): Vec3[] {
  const n = stage.model?.pos.length ?? 0;
  const out: Vec3[] = [];
  for (let i = 0; i < n; i++) if (stage.target[i] !== 0) out.push(targetOf({ ...stage, ego: null }, i));
  return out;
}

/** Back to the whole sky, framed in the free area from the default tilt. */
export function flyHome(stage: Stage, now: number): void {
  const pts = visibleTargets(stage);
  if (stage.frame && pts.length > 0) {
    flyFit(stage, pts, now, { pitch: DEFAULT_PITCH, min: 240 });
    stage.flight!.dur = stage.reduced ? 1 : FLIGHT_MS * 1.15;
    return;
  }
  const [lo, hi] = distLimits(stage.model);
  stopVel(stage.vel);
  stage.flight = planFlight(
    stage.cam,
    {
      tx: 0,
      ty: 0,
      tz: 0,
      dist: clamp(overviewDistance(stage), lo, hi),
      pitch: DEFAULT_PITCH,
    },
    now,
    stage.reduced ? 1 : FLIGHT_MS * 1.2,
  );
  stage.arrival = null;
  stage.travel = null;
  stage.wake();
}

/** Inside a note: fly close to its centre (a double click), keeping what the arrival will do. */
export function diveTo(stage: Stage, idx: number, now: number): void {
  const ego = stage.ego;
  if (!ego) return;
  const p = ego.centre === idx ? ego.anchor : posOf(stage, idx);
  const arrival = stage.arrival;
  const [lo, hi] = distLimits(stage.model, ego);
  const pitch = stage.flight?.to.pitch ?? stage.cam.pitch;
  const dist = egoDistance({ frame: stage.frame, cam: { ...stage.cam, pitch } }, ego) * 0.5;
  stopVel(stage.vel);
  stage.flight = planFlight(
    stage.cam,
    { tx: p.x, ty: p.y, tz: p.z, dist: clamp(dist, lo, hi), pitch },
    now,
    stage.reduced ? 1 : FLIGHT_MS * 0.9,
  );
  stage.arrival = arrival;
  stage.travel = null;
  stage.autoFrame = false;
  stage.wake();
}

/* ------------------------------------------------------------ positions */

/** Displayed position of a star. */
export function posOf(stage: Pick<Stage, "pos">, i: number): Vec3 {
  const k = i * 3;
  return { x: stage.pos[k] ?? 0, y: stage.pos[k + 1] ?? 0, z: stage.pos[k + 2] ?? 0 };
}

/** Where a star is headed: its place on the ego shells, else in the current arrangement. */
export function targetOf(stage: Pick<Stage, "ego" | "layout" | "model">, i: number): Vec3 {
  const ego = stage.ego;
  const o = ego?.offset.get(i);
  if (ego && o) return { x: ego.anchor.x + o.x, y: ego.anchor.y + o.y, z: ego.anchor.z + o.z };
  return stage.layout?.pos[i] ?? stage.model?.pos[i] ?? { x: 0, y: 0, z: 0 };
}

/** Start moving every star from where it is to where it is headed (reduced motion: jump). */
export function retarget(stage: Stage, now: number, dur = MORPH_MS): void {
  const n = stage.model?.pos.length ?? 0;
  if (stage.pos.length !== n * 3) return;
  let moves = false;
  for (let i = 0; i < n; i++) {
    const t = targetOf(stage, i);
    const k = i * 3;
    stage.from[k] = stage.pos[k]!;
    stage.from[k + 1] = stage.pos[k + 1]!;
    stage.from[k + 2] = stage.pos[k + 2]!;
    stage.to[k] = t.x;
    stage.to[k + 1] = t.y;
    stage.to[k + 2] = t.z;
    if (!moves && (t.x !== stage.pos[k] || t.y !== stage.pos[k + 1] || t.z !== stage.pos[k + 2]))
      moves = true;
  }
  stage.posVersion++;
  if (!moves) return;
  if (stage.reduced || dur <= 1) {
    stage.pos.set(stage.to);
    stage.morph = null;
  } else stage.morph = { t0: now, dur };
  stage.wake();
}

const easeOut = (t: number) => 1 - Math.pow(1 - t, 3);
const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

/** Advance the morph; true while stars are still moving. */
export function stepMorph(stage: Stage, now: number): boolean {
  const m = stage.morph;
  if (!m) return false;
  const n = stage.pos.length / 3;
  const spread = m.dur * 0.35;
  let moving = false;
  for (let i = 0; i < n; i++) {
    const k = clamp((now - m.t0 - (stage.delay[i] ?? 0) * spread) / (m.dur - spread), 0, 1);
    if (k < 1) moving = true;
    const e = stage.ego?.hop.has(i) ? easeOut(k) : easeInOut(k);
    const j = i * 3;
    stage.pos[j] = stage.from[j]! + (stage.to[j]! - stage.from[j]!) * e;
    stage.pos[j + 1] = stage.from[j + 1]! + (stage.to[j + 1]! - stage.from[j + 1]!) * e;
    stage.pos[j + 2] = stage.from[j + 2]! + (stage.to[j + 2]! - stage.from[j + 2]!) * e;
  }
  if (!moving) stage.morph = null;
  stage.posVersion++;
  return moving;
}

/** Resize the per-star buffers to a new model, keeping what can be kept. */
export function setModel(stage: Stage, model: StarModel): void {
  const n = model.pos.length;
  if (stage.alpha.length !== n) {
    const alpha = new Float32Array(n);
    const target = new Uint8Array(n);
    for (let i = 0; i < n; i++) {
      alpha[i] = stage.alpha[i] ?? 0;
      target[i] = 1;
    }
    stage.alpha = alpha;
    stage.target = target;
    stage.flash = new Float32Array(n);
    stage.pulses = [];
  }
  const first = stage.model === null;
  const fresh = stage.pos.length !== n * 3;
  stage.model = model;
  if (stage.layout && stage.layout.pos.length !== n) stage.layout = null;
  if (fresh) {
    stage.pos = new Float64Array(n * 3);
    stage.from = new Float64Array(n * 3);
    stage.to = new Float64Array(n * 3);
    stage.delay = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const p = targetOf(stage, i);
      stage.pos[i * 3] = p.x;
      stage.pos[i * 3 + 1] = p.y;
      stage.pos[i * 3 + 2] = p.z;
    }
    stage.morph = null;
    stage.posVersion++;
  }
  for (let i = 0; i < n; i++) stage.delay[i] = hash01(model.id[i] ?? i, 77);
  if (stage.ego && stage.ego.centre >= n) stage.ego = null;
  if (first) stage.cam = { ...stage.cam, dist: overviewDistance(stage) * 1.3 };
  if (stage.selIdx >= n) stage.selIdx = -1;
  if (stage.hoverIdx >= n) stage.hoverIdx = -1;
  if (stage.peekIdx >= n) stage.peekIdx = -1;
  stage.pulses = stage.pulses.filter((p) => p.e < model.edges.length);
  if (!fresh) retarget(stage, 0, 1);
  stage.wake();
}

/** Switch the arrangement: the stars morph to it (not the ego graph you are inside). */
export function setLayout(stage: Stage, layout: DimLayout, now: number): void {
  if (!stage.model || layout.pos.length !== stage.model.pos.length) return;
  const changed = stage.layout?.dim !== layout.dim;
  stage.layout = layout;
  stage.dim = layout.dim;
  retarget(stage, now, changed ? MORPH_MS : 1);
}

/* ------------------------------------------------------ inside a note */

function withHops(ego: Ego, anchor: Vec3): EgoState {
  const hop = new Map<number, number>([[ego.centre, 0]]);
  for (const j of ego.hop1) hop.set(j, 1);
  for (const j of ego.hop2) hop.set(j, 2);
  return { ...ego, anchor: { ...anchor }, hop };
}

/** How far links bow (the sky and the trips through them agree on it). */
export const EDGE_BEND = 0.2;

/**
 * The point the link `e` (a → b) bows away from: inside a note, its anchor;
 * otherwise the time axis, the shared group's centre or the middle of the sky.
 */
export function bowFrom(stage: Pick<Stage, "ego" | "layout">, a: number, b: number, mid: Vec3): Vec3 {
  const ego = stage.ego;
  if (ego && ego.hop.has(a) && ego.hop.has(b)) return ego.anchor;
  const lay = stage.layout;
  if (!lay) return { x: 0, y: 0, z: 0 };
  if (lay.axis) return { x: mid.x, y: 0, z: 0 };
  const g = lay.groupOf[a] ?? -1;
  if (g >= 0 && g === lay.groupOf[b] && lay.groups[g]) return lay.groups[g]!.centre;
  return { x: 0, y: 0, z: 0 };
}

/** The curve of the link between two stars as the sky draws it (for the trip through it). */
export function linkCurve(stage: Stage, a: number, b: number): { a: Vec3; c: Vec3; b: Vec3 } {
  const e = stage.model ? edgeIndex(stage.model, a, b) : -1;
  const ed = e >= 0 ? stage.model!.edges[e]! : null;
  // The curve is defined from the edge's own a to b; flip it when travelling the other way.
  const [s, t] = ed && ed.a === b ? [b, a] : [a, b];
  const ps = posOf(stage, s);
  const pt = posOf(stage, t);
  const mid = { x: (ps.x + pt.x) / 2, y: (ps.y + pt.y) / 2, z: (ps.z + pt.z) / 2 };
  const c = controlPoint(ps, pt, bowFrom(stage, s, t, mid), EDGE_BEND, Math.max(0, e));
  return s === a ? { a: ps, c, b: pt } : { a: pt, c, b: ps };
}

/** The first edge index joining two stars, or −1. */
export function edgeIndex(model: StarModel, a: number, b: number): number {
  for (const e of model.incident[a] ?? []) {
    const ed = model.edges[e]!;
    if ((ed.a === a && ed.b === b) || (ed.a === b && ed.b === a)) return e;
  }
  return -1;
}

/**
 * Enter a note. From inside another note, when it is on the current ego
 * graph, the camera travels through the synapse to it and the space
 * rearranges around it on arrival; otherwise the camera flies to it and its
 * synapses unfold around it at once. `onArrive` runs when the camera is
 * there (the arrival burst).
 */
export function enterNote(stage: Stage, ego: Ego, now: number, onArrive?: () => void): "travel" | "fly" {
  const idx = ego.centre;
  const inside = stage.ego;
  const onShell = inside !== null && inside.centre !== idx && inside.hop.has(idx);
  if (!inside) stage.saved = { ...stage.cam };
  stopVel(stage.vel);
  const view = { frame: stage.frame, cam: { ...stage.cam, pitch: inside ? stage.cam.pitch : EGO_PITCH } };
  const dist = egoDistance(view, ego);
  if (onShell && !stage.reduced) {
    // From where the camera looks now along the drawn curve to the neighbour.
    const from = inside.centre;
    const curve = linkCurve(stage, from, idx);
    curve.a = { x: stage.cam.tx, y: stage.cam.ty, z: stage.cam.tz };
    stage.flight = planPathFlight(stage.cam, curve, dist, now, TRAVEL_MS, 0.62);
    stage.travel = { from, to: idx, edge: stage.model ? edgeIndex(stage.model, from, idx) : -1 };
    stage.arrival = () => {
      stage.travel = null;
      stage.ego = withHops(ego, posOf(stage, idx));
      stage.autoFrame = true;
      retarget(stage, performance.now());
      onArrive?.();
    };
    stage.wake();
    return "travel";
  }
  const anchor = inside?.hop.has(idx) ? posOf(stage, idx) : targetOfBase(stage, idx);
  stage.ego = withHops(ego, anchor);
  retarget(stage, now);
  const [lo, hi] = distLimits(stage.model, stage.ego);
  const fit = egoFit(view, ego, anchor);
  stage.flight = planFlight(
    stage.cam,
    {
      tx: fit.tx,
      ty: fit.ty,
      tz: fit.tz,
      dist: clamp(dist, lo, hi),
      ...(inside ? {} : { pitch: EGO_PITCH }),
    },
    now,
    stage.reduced ? 1 : FLIGHT_MS,
  );
  stage.travel = null;
  stage.arrival = onArrive ?? null;
  stage.autoFrame = true;
  stage.wake();
  return "fly";
}

function targetOfBase(stage: Stage, i: number): Vec3 {
  return stage.layout?.pos[i] ?? stage.model?.pos[i] ?? posOf(stage, i);
}

/** Refresh the ego graph in place (the links or the visibility changed), keeping its anchor. */
export function refreshEgo(stage: Stage, ego: Ego, now: number): void {
  if (!stage.ego || stage.ego.centre !== ego.centre) return;
  stage.ego = withHops(ego, stage.ego.anchor);
  retarget(stage, now);
}

/** Leave the note: the stars go home and the camera returns to where you were. */
export function leaveNote(stage: Stage, now: number): void {
  if (!stage.ego) return;
  const anchor = stage.ego.anchor;
  stage.ego = null;
  stage.travel = null;
  retarget(stage, now);
  const back: Camera = stage.saved ?? {
    ...stage.cam,
    tx: anchor.x,
    ty: anchor.y,
    tz: anchor.z,
    dist: Math.max(stage.cam.dist * 2, overviewDistance(stage) * 0.55),
  };
  stage.saved = null;
  stage.autoFrame = false;
  stopVel(stage.vel);
  const [lo, hi] = distLimits(stage.model);
  stage.flight = planFlight(
    stage.cam,
    { ...back, yaw: stage.cam.yaw, dist: clamp(back.dist, lo, hi) },
    now,
    stage.reduced ? 1 : FLIGHT_MS,
  );
  stage.arrival = null;
  stage.wake();
}

/** Light a note up: rings around it and a pulse down every one of its links, cascading on. */
export function igniteBurst(stage: Stage, idx: number, now: number): void {
  const m = stage.model;
  if (!m || idx < 0 || idx >= m.pos.length) return;
  stage.bursts = [...stage.bursts.filter((b) => now - b.t0 < 1400), { i: idx, t0: now }];
  if (idx < stage.flash.length) stage.flash[idx] = 1;
  if (stage.reduced || stage.economy) {
    stage.wake();
    return;
  }
  const len = (e: number) => {
    const ed = m.edges[e]!;
    const a = posOf(stage, ed.a);
    const b = posOf(stage, ed.b);
    return pulseDuration(Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z));
  };
  stage.pulses = [
    ...stage.pulses,
    ...burst(idx, m.incident, now + 80, { strength: 1, dur: len, max: 32 }),
  ].slice(-240);
  stage.wake();
}
