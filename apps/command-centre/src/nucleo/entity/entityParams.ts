/**
 * The entity's pure math: what each agent state looks like as a set of
 * numbers, how the numbers glide from one state to the next, how the HUD is
 * laid out around the core, and how an activity satellite lives and dies.
 *
 * Nothing here touches the DOM or WebGL, so it is unit tested
 * (`entityParams.test.ts`) and the render loop only reads from it.
 */
import type { CoreState } from "../../desktop/coreState";

/** What the agent is doing right now (one tool call), newest last. */
export interface EntityActivity {
  id: string;
  label: string;
  kind: "read" | "write" | "run" | "search" | "think" | "web" | "other";
  at: number;
}

export type EntityVariant = "hero" | "iris";

/**
 * The continuous knobs of the entity. Every one is interpolated, never
 * snapped, so a state change is a glide of ~400–800 ms.
 */
export interface EntityParams {
  /** Overall brightness of the core. */
  energy: number;
  /** Speed of the internal flow (noise advection), units per second. */
  flow: number;
  /** Intensity of the thin inner filaments. */
  filaments: number;
  /** Domain-warp amount: how turbulent the plasma is. */
  turbulence: number;
  /** Rotation speed of the inner field, radians per second. */
  spin: number;
  /** Brightness of the 3D orbital ring hugging the core. */
  ring: number;
  /** Speed of the comet running on the orbital, radians per second. */
  comet: number;
  /** Intensity of the system's scanning band (amber). */
  scan: number;
  /** How much of the system's amber is woven into the plasma and HUD. */
  warm: number;
  /** Shift of the body colour toward `--warn` (needs the human). */
  wait: number;
  /** Rotation multiplier of the HUD rings. */
  hudSpin: number;
  /** Breathing rate, radians per second. */
  breathe: number;
  /** Gain of the voice (speaking) waves. */
  voice: number;
}

export const PARAM_KEYS = [
  "energy",
  "flow",
  "filaments",
  "turbulence",
  "spin",
  "ring",
  "comet",
  "scan",
  "warm",
  "wait",
  "hudSpin",
  "breathe",
  "voice",
] as const satisfies ReadonlyArray<keyof EntityParams>;

function p(
  energy: number,
  flow: number,
  filaments: number,
  turbulence: number,
  spin: number,
  ring: number,
  comet: number,
  scan: number,
  warm: number,
  wait: number,
  hudSpin: number,
  breathe: number,
  voice: number,
): Readonly<EntityParams> {
  return Object.freeze({
    energy,
    flow,
    filaments,
    turbulence,
    spin,
    ring,
    comet,
    scan,
    warm,
    wait,
    hudSpin,
    breathe,
    voice,
  });
}

/**
 * The look of every state.
 *            energy flow  fil   turb  spin  ring  comet scan  warm  wait  hud   breathe voice
 */
export const STATE_PARAMS: Readonly<Record<CoreState, Readonly<EntityParams>>> = Object.freeze({
  idle: p(0.92, 0.22, 0.75, 0.55, 0.1, 0.35, 0.18, 0, 0.12, 0, 0.14, 0.9, 0),
  listening: p(1.02, 0.34, 0.72, 0.62, 0.14, 0.5, 0.3, 0, 0.1, 0, 0.24, 1.25, 0),
  queued: p(0.96, 0.55, 0.78, 0.7, 0.22, 0.62, 0.55, 0.35, 0.55, 0, 0.4, 1.3, 0),
  thinking: p(1.12, 1.35, 1.0, 0.92, 0.42, 0.9, 1.6, 1, 0.9, 0, 1, 1.7, 0),
  tool: p(1.08, 1.6, 0.92, 1.0, 0.5, 0.92, 2.1, 0.55, 0.95, 0, 1.25, 1.7, 0),
  responding: p(1.08, 0.62, 0.82, 0.7, 0.2, 0.6, 0.6, 0, 0.18, 0, 0.45, 1.1, 1),
  waiting: p(0.92, 0.26, 0.62, 0.58, 0.08, 0.55, 0.3, 0, 0.5, 1, 0.2, 0.7, 0),
  alert: p(1.0, 0.8, 0.85, 0.95, 0.3, 0.5, 0.8, 0, 0.1, 0, 0.6, 1.0, 0),
  done: p(1.04, 0.36, 0.7, 0.6, 0.14, 0.45, 0.5, 0, 0.12, 0, 0.3, 1.0, 0),
  cancelled: p(0.6, 0.16, 0.45, 0.5, 0.06, 0.22, 0.1, 0, 0.05, 0, 0.1, 0.8, 0),
  interrupted: p(1.0, 0.8, 0.85, 0.95, 0.3, 0.5, 0.8, 0, 0.1, 0, 0.6, 1.0, 0),
});

/** A fresh, mutable copy of a state's params (for the loop's `current`). */
export function paramsOf(state: CoreState): EntityParams {
  return { ...STATE_PARAMS[state] };
}

/**
 * Exponential approach: frame-rate independent, never overshoots.
 * After `3 * tau` seconds the value is 95% of the way there.
 */
export function approach(current: number, target: number, dt: number, tau: number): number {
  if (tau <= 0 || dt <= 0) return dt > 0 ? target : current;
  return target + (current - target) * Math.exp(-dt / tau);
}

/** Default glide time constant: 95% of a state change in ~600 ms. */
export const GLIDE_TAU = 0.2;

/** Glides every param of `current` toward `target`, in place (no allocation). */
export function stepParams(
  current: EntityParams,
  target: Readonly<EntityParams>,
  dt: number,
  tau: number = GLIDE_TAU,
): void {
  for (let i = 0; i < PARAM_KEYS.length; i++) {
    const k = PARAM_KEYS[i]!;
    current[k] = approach(current[k], target[k], dt, tau);
  }
}

export function clamp01(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}
export function easeOutCubic(x: number): number {
  const c = 1 - clamp01(x);
  return 1 - c * c * c;
}
export function easeInOutSine(x: number): number {
  return -(Math.cos(Math.PI * clamp01(x)) - 1) / 2;
}

/** A one-shot event a state change fires on entry. */
export interface StateKick {
  /** Expanding shockwave colour, or null. */
  shock: "danger" | "ok" | null;
  /** Brief dim (cancelled). */
  dim: boolean;
  /** A discrete pulse from the core (tool calls). */
  pulse: boolean;
}

export function stateKick(prev: CoreState | null, next: CoreState): StateKick {
  if (prev === next) return { shock: null, dim: false, pulse: false };
  return {
    shock: next === "alert" || next === "interrupted" ? "danger" : next === "done" ? "ok" : null,
    dim: next === "cancelled",
    pulse: next === "tool",
  };
}

/** Seconds between the discrete pulses while a tool runs. */
export const TOOL_PULSE_EVERY = 0.9;
/** Seconds a shockwave takes to expand and fade. */
export const SHOCK_DURATION = 1.5;

/** Insistent "needs you" pulse, 0..1, sharp attack and slow release; period 1.8 s. */
export function waitPulse(t: number): number {
  const ph = (t / 1.8) % 1;
  const x = ph < 0.12 ? ph / 0.12 : Math.exp(-(ph - 0.12) * 5);
  return clamp01(x);
}

/* ---- Voice --------------------------------------------------------------- */

/** The loudness a burst of streamed characters gives the voice, 0..1. */
export function speakKick(chars: number): number {
  if (!(chars > 0)) return 0;
  return clamp01(0.35 + Math.min(chars, 120) / 120);
}

/** Loudness added by one keystroke to the listening energy. */
export const TYPING_KICK = 0.35;

/* ---- Geometry ------------------------------------------------------------ */

/**
 * Layout around the core, as fractions of the element's size S (the smaller
 * of its width and height). The WebGL canvas covers the element; the HUD
 * canvas can reach past it sideways for satellite labels.
 */
export interface EntityGeometry {
  /** Core radius. */
  core: number;
  /** Radius of the 3D orbital (in core radii, used by the shader). */
  orbital: number;
  /** Thin ring with rotating segments. */
  ringA: number;
  /** Tick ring. */
  ringB: number;
  /** Micro-text ring. */
  ringText: number;
  /** Orbit of the activity satellites. */
  satellites: number;
}

export const GEOMETRY: Readonly<Record<EntityVariant, Readonly<EntityGeometry>>> = Object.freeze({
  hero: Object.freeze({
    core: 0.19,
    orbital: 1.42,
    ringA: 0.305,
    ringB: 0.335,
    ringText: 0.368,
    satellites: 0.43,
  }),
  iris: Object.freeze({
    core: 0.28,
    orbital: 0,
    ringA: 0.44,
    ringB: 0,
    ringText: 0,
    satellites: 0,
  }),
});

/** Canvas pixel ratio: capped at 2, and 1.5 for a hero larger than 600 px. */
export function renderDpr(variant: EntityVariant, cssSize: number, deviceDpr: number): number {
  const dpr = Number.isFinite(deviceDpr) && deviceDpr > 0 ? deviceDpr : 1;
  const cap = variant === "hero" && cssSize > 600 ? 1.5 : 2;
  return Math.min(cap, dpr);
}

/**
 * Glass shells the core's rays cross (each front and back; the shader's
 * maximum is 6). Fewer when small: at 40 px three shells already read.
 */
export function shellCount(variant: EntityVariant, cssSize: number): number {
  if (variant === "iris") return 3;
  return cssSize > 600 ? 5 : 6;
}

/** Minimum milliseconds between frames: economy draws ~12 fps. */
export function frameInterval(economy: boolean): number {
  return economy ? 1000 / 12 : 0;
}

/* ---- Activity satellites -------------------------------------------------- */

/** Seconds a satellite stays on the orbit. */
export const SATELLITE_TTL = 8;
/** Seconds the birth spark takes to travel from the core to the orbit. */
export const SPARK_DURATION = 0.65;
/** Number of angular slots on the satellite orbit. */
export const SATELLITE_SLOTS = 8;
/** Angular drift of the whole orbit, radians per second. */
export const SATELLITE_DRIFT = 0.035;

/** Opacity of a satellite by age: rises with the spark, holds, fades out over the last 1.5 s. */
export function satelliteAlpha(age: number): number {
  if (age < 0 || age >= SATELLITE_TTL) return 0;
  const inT = clamp01((age - SPARK_DURATION * 0.55) / 0.35);
  const outT = clamp01((SATELLITE_TTL - age) / 1.5);
  return easeOutCubic(inT) * easeInOutSine(outT);
}

/** Scale of the satellite node: pops from 0.6 to 1 as the spark lands. */
export function satelliteScale(age: number): number {
  return 0.6 + 0.4 * easeOutCubic((age - SPARK_DURATION * 0.55) / 0.45);
}

/** Progress of the birth spark 0..1, or -1 once it has landed. */
export function sparkProgress(age: number): number {
  if (age < 0 || age > SPARK_DURATION) return -1;
  return age / SPARK_DURATION;
}

/** Angle of a slot: slot 0 at the upper right, going clockwise on screen. */
export function slotAngle(slot: number, slots: number = SATELLITE_SLOTS): number {
  return -Math.PI / 2 + Math.PI / slots + (slot / slots) * Math.PI * 2;
}

/** Stable small hash of an id (FNV-1a), for a satellite's preferred slot. */
export function hashId(id: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/**
 * Gives every live satellite a slot on the orbit. Satellites that already
 * had one keep it (they never jump); newcomers take their preferred slot
 * (hash of the id) or the nearest free one, so two never overlap while
 * there are free slots.
 */
export function assignSlots(
  ids: readonly string[],
  previous: ReadonlyMap<string, number>,
  slots: number = SATELLITE_SLOTS,
): Map<string, number> {
  const out = new Map<string, number>();
  const taken = new Set<number>();
  for (const id of ids) {
    const s = previous.get(id);
    if (s !== undefined && !taken.has(s)) {
      out.set(id, s);
      taken.add(s);
    }
  }
  for (const id of ids) {
    if (out.has(id)) continue;
    const want = hashId(id) % slots;
    let chosen = want;
    for (let k = 0; k < slots; k++) {
      // want, want+1, want-1, want+2, …
      const off = k % 2 === 0 ? k / 2 : -(k + 1) / 2;
      const s = (((want + off) % slots) + slots) % slots;
      if (!taken.has(s)) {
        chosen = s;
        break;
      }
    }
    out.set(id, chosen);
    taken.add(chosen);
  }
  return out;
}

/** Screen position of a point on a circular orbit (y down). */
export function orbitPoint(angle: number, radius: number, cx: number, cy: number): { x: number; y: number } {
  return { x: cx + Math.cos(angle) * radius, y: cy + Math.sin(angle) * radius };
}

/** Longest label shown next to a satellite. */
export const LABEL_MAX = 22;
export function shortLabel(label: string, max: number = LABEL_MAX): string {
  const clean = label.replace(/\s+/g, " ").trim();
  if (clean.length <= max) return clean;
  return `${clean.slice(0, max - 1).trimEnd()}…`;
}

/** The word shown in the micro-text ring when no `stateLabel` is given. */
export function stateWord(state: CoreState): string {
  return state.toUpperCase();
}

/** The inscription written twice around the HUD. */
export function inscription(word: string): string {
  const w = word.trim().toUpperCase();
  return w ? `MORDOMO · ONLINE · ${w}` : "MORDOMO · ONLINE";
}

/* ---- Colour -------------------------------------------------------------- */

export type Rgb = readonly [number, number, number];

/** Parses `#rgb`, `#rrggbb`, `rgb()`/`rgba()` into 0..1 channels, or null. */
export function parseColour(value: string): Rgb | null {
  const v = value.trim();
  let m = /^#([0-9a-f]{3})$/i.exec(v);
  if (m) {
    const s = m[1]!;
    const ch = (i: number) => parseInt(s[i]! + s[i]!, 16) / 255;
    return [ch(0), ch(1), ch(2)];
  }
  m = /^#([0-9a-f]{6})([0-9a-f]{2})?$/i.exec(v);
  if (m) {
    const n = parseInt(m[1]!, 16);
    return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
  }
  m = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/i.exec(v);
  if (m) return [Number(m[1]) / 255, Number(m[2]) / 255, Number(m[3]) / 255];
  return null;
}

/** Relative luminance (sRGB, WCAG). */
export function luminance(c: Rgb): number {
  const lin = (x: number) => (x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4);
  return 0.2126 * lin(c[0]) + 0.7152 * lin(c[1]) + 0.0722 * lin(c[2]);
}
