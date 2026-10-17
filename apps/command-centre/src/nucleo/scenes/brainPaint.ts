/**
 * The Brain scene's painter (immersive shell): one frame of the sky on a 2D
 * canvas with its own perspective. Back to front: three layers of background
 * stars at different depths (the far ones only turn with the view, the near
 * ones slide past as you fly — parallax), a faint polar grid under the
 * constellation with the areas' drop lines (a floor that tells you where
 * "down" is and how far things are), the nebulae, the arrangement's guides,
 * every link as a curve that thins and fades with distance, the synapses of
 * the note you are inside as ribbons with light flowing along them, the
 * pulses firing through the network, the stars (fogged towards their nebula's
 * haze and out of focus far away, crisp lit bodies with their content icon
 * up close), bursts and reticles, the cursor's halo, and last the words —
 * placed so they never collide, never under the interface.
 *
 * It reads the shared `Stage` and writes only its own buffers, the camera
 * (flights, the rig's glide, the idle turn), the stars' fades and the pulses.
 */
import { eyeOf, flyThrust, stepCamera } from "./brainCamera";
import { controlPointInto } from "./brainCurve";
import { groupPresence, groupPx, labelPx, placeLabels, type Box, type LabelAsk } from "./brainLabels";
import { mixHex, rgba } from "./brainModel";
import { distToQuad, pickBox, pickStar } from "./brainPick";
import { clamp, flightAt, hash01, lerp, NEAR } from "./brainSpace";
import {
  distLimits,
  EDGE_BEND,
  egoDistance,
  egoFit,
  overviewDistance,
  stepMorph,
  zoomCeil,
  zoomFloor,
  type Stage,
  type StarModel,
} from "./brainStage";
import { burst, cascade, pulseDuration, pulseEnd, stepPulses, type Pulse } from "./brainSynapse";
import { isRecent } from "./brainTimeline";
import { BODY_PX, GLYPH_INSIDE_PX, labelBudget, levelWeights, zoomLevel } from "./brainZoom";
import { strokeGlyph, type Blur, type SpriteBook } from "./brainSprites";

export interface Tokens {
  light: boolean;
  bg: string;
  text: string;
  dim: string;
  faint: string;
  agent: string;
  agentText: string;
  accent: string;
  display: string;
  body: string;
  mono: string;
}

export interface Words {
  /** Hint on the star a wheel would dive into. */
  enter: string;
  /** Hint that zooming further out leaves the note. */
  exit: string;
}

const IDLE_SPIN = 0.03;
const EGO_SPIN = 0.015;
export const IDLE_AFTER_MS = 4500;
const HAIR = String.fromCharCode(8202);
const spaced = (s: string) => [...s].join(HAIR);
const RIBBON_STEPS = 18;
/** Background star layers: how much of the camera's travel each follows (1 = infinitely far). */
const LAYERS = [
  { n: 420, follow: 1, reach: 6, size: 0.9, alpha: 0.5 },
  { n: 220, follow: 0.8, reach: 3.2, size: 1.3, alpha: 0.5 },
  { n: 110, follow: 0.45, reach: 1.9, size: 1.8, alpha: 0.42 },
] as const;
const FOG = [0, 0.34, 0.62];

interface Floor {
  cx: number;
  cz: number;
  y: number;
  r: number;
}

interface LabelDraw {
  i: number;
  box: Box;
  title: string;
  font: string;
  px: number;
  glyph: boolean;
  ex: string;
  pri: number;
  alpha: number;
}

export class Painter {
  w = 1;
  h = 1;
  view = { cx: -1, cy: -1, focal: 800 };
  /* per-star screen buffers */
  private px = new Float32Array(0);
  private py = new Float32Array(0);
  private ps = new Float32Array(0);
  private pd = new Float32Array(0);
  private ok = new Uint8Array(0);
  private order: number[] = [];
  /* hit targets (the stars as last drawn) */
  private hx = new Float32Array(0);
  private hy = new Float32Array(0);
  private hr = new Float32Array(0);
  private hit = new Uint8Array(0);
  /* hover swell and label fade per star */
  private hov = new Float32Array(0);
  private hovOn = new Set<number>();
  private labA = new Float32Array(0);
  private shown = new Uint8Array(0);
  /* link curves: world control points (cached on the stage's position version) and their projection */
  private cp = new Float64Array(0);
  private cpVersion = -1;
  private cpModel: StarModel | null = null;
  private cx2 = new Float32Array(0);
  private cy2 = new Float32Array(0);
  private cok = new Uint8Array(0);
  /* background layers */
  private bgDir = new Float32Array(0);
  private bgPrev = new Float32Array(0);
  private prevValid = false;
  private lastTarget = { x: 0, y: 0, z: 0, d: 0 };
  private warp = 0;
  private egoMix = 0;
  private quietMix = 0;
  private lastLevel = -1;
  private lastView = { yaw: NaN, pitch: NaN, zoom: NaN };
  private nextAmbient = 0;
  private nextFocus = 0;
  private lastHover = -1;
  private widths = new Map<string, number>();
  private exitHint = 0;
  private halo = { x: 0, y: 0, r: 10, a: 0 };
  /* colours: every star fogged at three depths (cached per model and theme) */
  private fogCols: string[][] = [];
  private fogKey: { m: StarModel | null; tk: Tokens | null } = { m: null, tk: null };
  private floors = new WeakMap<object, Floor>();
  private groupSets = new WeakMap<object, Set<number>[]>();
  private groupReach = new WeakMap<object, number[]>();
  /** Where the area names were drawn (for the hand). */
  groupBoxes: Array<{ gi: number; box: Box }> = [];

  constructor(
    private ctx: CanvasRenderingContext2D,
    public book: SpriteBook,
    public tk: Tokens,
  ) {
    const total = LAYERS.reduce((s, l) => s + l.n, 0);
    this.bgDir = new Float32Array(total * 3);
    this.bgPrev = new Float32Array(total * 2);
    let k = 0;
    LAYERS.forEach((l, li) => {
      for (let j = 0; j < l.n; j++, k++) {
        const u = hash01(k, 301 + li) * 2 - 1;
        const phi = hash01(k, 302 + li) * Math.PI * 2;
        const rr = Math.sqrt(1 - u * u);
        // the near layer fills a ball (motes you pass through), the far ones a shell
        const r = li === 2 ? Math.cbrt(0.15 + 0.85 * hash01(k, 313)) : 1;
        this.bgDir[k * 3] = Math.cos(phi) * rr * r;
        this.bgDir[k * 3 + 1] = u * r;
        this.bgDir[k * 3 + 2] = Math.sin(phi) * rr * r;
      }
    });
  }

  /** The star under (x, y) (its drawn radius plus `slop`), keeping `current` while it is close. */
  pick(x: number, y: number, slop: number, current = -1): number {
    return pickStar({ x: this.hx, y: this.hy, r: this.hr, on: this.hit }, x, y, slop, current);
  }

  /** The link under (x, y), within `tol` px of its curve as drawn (−1 none). */
  pickEdge(stage: Stage, x: number, y: number, tol = 5, current = -1): number {
    const m = stage.model;
    if (!m) return -1;
    let best = -1;
    let bestD = tol;
    // The link already under the cursor holds on a little longer.
    if (current >= 0 && current < m.edges.length) {
      const ed = m.edges[current]!;
      if (this.ok[ed.a] && this.ok[ed.b]) {
        const cx = this.cok[current] ? this.cx2[current]! : (this.px[ed.a]! + this.px[ed.b]!) / 2;
        const cy = this.cok[current] ? this.cy2[current]! : (this.py[ed.a]! + this.py[ed.b]!) / 2;
        const { d, t } = distToQuad(
          x,
          y,
          this.px[ed.a]!,
          this.py[ed.a]!,
          cx,
          cy,
          this.px[ed.b]!,
          this.py[ed.b]!,
          12,
        );
        if (d < tol * 1.8 && t > 0.04 && t < 0.96) {
          best = current;
          bestD = d * 0.6;
        }
      }
    }
    for (let e = 0; e < m.edges.length; e++) {
      const ed = m.edges[e]!;
      const a = ed.a;
      const b = ed.b;
      if (!this.ok[a] || !this.ok[b] || stage.alpha[a]! < 0.5 || stage.alpha[b]! < 0.5) continue;
      const ax = this.px[a]!;
      const ay = this.py[a]!;
      const bx = this.px[b]!;
      const by = this.py[b]!;
      const cx = this.cok[e] ? this.cx2[e]! : (ax + bx) / 2;
      const cy = this.cok[e] ? this.cy2[e]! : (ay + by) / 2;
      if (
        x < Math.min(ax, bx, cx) - tol ||
        x > Math.max(ax, bx, cx) + tol ||
        y < Math.min(ay, by, cy) - tol ||
        y > Math.max(ay, by, cy) + tol
      )
        continue;
      const { d, t } = distToQuad(x, y, ax, ay, cx, cy, bx, by, 12);
      // Not at the very ends (that is the star's business).
      if (d < bestD && t > 0.06 && t < 0.94) {
        bestD = d;
        best = e;
      }
    }
    return best;
  }

  /** The area name under (x, y) (−1 none). */
  pickGroup(x: number, y: number): number {
    const k = pickBox(
      this.groupBoxes.map((g) => g.box),
      x,
      y,
    );
    return k >= 0 ? this.groupBoxes[k]!.gi : -1;
  }

  /** Where a star was last drawn (for the hover card). */
  screenOf(i: number): { x: number; y: number; r: number } | null {
    return this.hit[i] ? { x: this.hx[i]!, y: this.hy[i]!, r: this.hr[i]! } : null;
  }

  private ensure(n: number, e: number) {
    if (this.px.length !== n) {
      this.px = new Float32Array(n);
      this.py = new Float32Array(n);
      this.ps = new Float32Array(n);
      this.pd = new Float32Array(n);
      this.ok = new Uint8Array(n);
      this.hx = new Float32Array(n);
      this.hy = new Float32Array(n);
      this.hr = new Float32Array(n);
      this.hit = new Uint8Array(n);
      this.hov = new Float32Array(n);
      this.hovOn.clear();
      this.labA = new Float32Array(n);
      this.shown = new Uint8Array(n);
    }
    if (this.cx2.length !== e) {
      this.cp = new Float64Array(e * 3);
      this.cx2 = new Float32Array(e);
      this.cy2 = new Float32Array(e);
      this.cok = new Uint8Array(e);
      this.cpVersion = -1;
    }
  }

  private width(font: string, text: string): number {
    const key = `${font}|${text}`;
    let v = this.widths.get(key);
    if (v === undefined) {
      this.ctx.font = font;
      v = this.ctx.measureText(text).width;
      if (this.widths.size > 4000) this.widths.clear();
      this.widths.set(key, v);
    }
    return v;
  }

  private fit(font: string, text: string, max: number): string {
    if (this.width(font, text) <= max) return text;
    let lo = 0;
    let hi = text.length;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (this.width(font, `${text.slice(0, mid)}…`) <= max) lo = mid;
      else hi = mid - 1;
    }
    return `${text.slice(0, lo).trimEnd()}…`;
  }

  /** Each star's colour at three depths of haze (towards a darker veil of its own hue). */
  private colours(m: StarModel): string[][] {
    const tk = this.tk;
    if (this.fogKey.m === m && this.fogKey.tk === tk) return this.fogCols;
    const byCol = new Map<string, string[]>();
    this.fogCols = FOG.map(() => new Array<string>(m.color.length));
    m.color.forEach((c, i) => {
      let set = byCol.get(c);
      if (!set) {
        const base = tk.light ? mixHex(c, tk.text, 0.4) : c;
        const haze = tk.light ? mixHex(tk.bg, c, 0.25) : mixHex(tk.bg, c, 0.32);
        set = FOG.map((f) => (f === 0 ? base : mixHex(base, haze, f)));
        byCol.set(c, set);
      }
      for (let l = 0; l < FOG.length; l++) this.fogCols[l]![i] = set[l]!;
    });
    this.fogKey = { m, tk };
    return this.fogCols;
  }

  /** The floor under an arrangement: a plane below its lowest star, centred under it. */
  private floorOf(stage: Stage, m: StarModel): Floor {
    const key: object = stage.layout ?? m;
    let f = this.floors.get(key);
    if (f) return f;
    const pts = stage.layout?.pos ?? m.pos;
    let cx = 0;
    let cz = 0;
    let maxY = -Infinity;
    for (const p of pts) {
      cx += p.x;
      cz += p.z;
      maxY = Math.max(maxY, p.y);
    }
    cx /= Math.max(1, pts.length);
    cz /= Math.max(1, pts.length);
    let r = 60;
    for (const p of pts) r = Math.max(r, Math.hypot(p.x - cx, p.z - cz));
    f = { cx, cz, y: (Number.isFinite(maxY) ? maxY : 0) + Math.max(40, r * 0.22), r: r * 1.02 };
    this.floors.set(key, f);
    return f;
  }

  /** How far each group's stars actually reach from its centre (its nominal radius is roomier). */
  private reachOf(stage: Stage): number[] {
    const lay = stage.layout;
    if (!lay) return [];
    let r = this.groupReach.get(lay);
    if (!r) {
      r = lay.groups.map((g) => {
        let far = 18;
        for (const i of g.members) {
          const p = lay.pos[i];
          if (p) far = Math.max(far, Math.hypot(p.x - g.centre.x, p.y - g.centre.y, p.z - g.centre.z));
        }
        return far;
      });
      this.groupReach.set(lay, r);
    }
    return r;
  }

  private groupSet(stage: Stage, gi: number): Set<number> | null {
    const lay = stage.layout;
    if (!lay || gi < 0 || gi >= lay.groups.length) return null;
    let sets = this.groupSets.get(lay);
    if (!sets) {
      sets = lay.groups.map((g) => new Set(g.members));
      this.groupSets.set(lay, sets);
    }
    return sets[gi] ?? null;
  }

  /** Draw one frame. True while something moves (the loop keeps going). */
  frame(stage: Stage, now: number, dt: number, words: Words): boolean {
    const { ctx, tk, book } = this;
    const { w, h } = this;
    ctx.clearRect(0, 0, w, h);
    const m = stage.model;
    if (!m) return false;
    const n = m.pos.length;
    const E = m.edges.length;
    this.ensure(n, E);
    let busy = false;
    const t = now / 1000;
    const still = stage.reduced || stage.economy;
    const ego = stage.ego;

    /* ---- the free part of the screen (the camera centres in it), eased ---- */
    const ins = stage.insets;
    const freeW = Math.max(40, w - ins.left - ins.right);
    const freeH = Math.max(40, h - ins.top - ins.bottom);
    const tx = ins.left + freeW / 2;
    const ty = ins.top + freeH / 2;
    const view = this.view;
    if (view.cx < 0 || stage.reduced) {
      view.cx = tx;
      view.cy = ty;
    } else {
      const k = Math.min(1, dt * 5);
      view.cx = lerp(view.cx, tx, k);
      view.cy = lerp(view.cy, ty, k);
      if (Math.abs(view.cx - tx) > 0.5 || Math.abs(view.cy - ty) > 0.5) busy = true;
    }
    view.focal = Math.min(w, h) * 0.92;
    stage.frame = { focal: view.focal, freeW, freeH };

    /* ---- camera: a flight, else the rig's glide, the fly keys, the idle turn ---- */
    if (stage.flight) {
      const f = flightAt(stage.flight, now);
      stage.cam = f.cam;
      busy = true;
      if (f.done) {
        stage.flight = null;
        const arrive = stage.arrival;
        stage.arrival = null;
        arrive?.();
      }
    } else {
      const [lo0, hi0] = distLimits(m, ego);
      const lo = ego ? lo0 : Math.max(lo0, zoomFloor(stage));
      const hi = ego ? Math.min(hi0, zoomCeil(stage)) : hi0;
      const thrust = still ? null : flyThrust(stage.cam, stage.fly);
      if (stepCamera(stage.cam, stage.vel, dt, { lo, hi, anchor: stage.zoomAnchor, thrust })) {
        busy = true;
        stage.lastInput = now;
        if (thrust || stage.vel.x || stage.vel.y || stage.vel.z || stage.vel.zoom) stage.autoFrame = false;
      }
      if (!still && !stage.dragging && now - stage.lastInput > IDLE_AFTER_MS)
        stage.cam.yaw += dt * (ego ? EGO_SPIN : IDLE_SPIN);
      // Inside a note, its space stays framed while the reader slides and the window changes.
      if (ego && stage.autoFrame) {
        const fit = egoFit(stage, ego, ego.anchor);
        const c = stage.cam;
        const k = stage.reduced ? 1 : Math.min(1, dt * 3);
        const off = Math.hypot(c.tx - fit.tx, c.ty - fit.ty, c.tz - fit.tz);
        if (Math.abs(c.dist - fit.dist) > 0.5 || off > 0.5) {
          c.dist += (fit.dist - c.dist) * k;
          c.tx += (fit.tx - c.tx) * k;
          c.ty += (fit.ty - c.ty) * k;
          c.tz += (fit.tz - c.tz) * k;
          busy = true;
        }
      }
    }
    const cam = stage.cam;
    // Speed of the camera relative to how far it stands: the warp of motion streaks.
    const lt = this.lastTarget;
    const moved = Math.hypot(cam.tx - lt.x, cam.ty - lt.y, cam.tz - lt.z) + Math.abs(cam.dist - lt.d) * 0.5;
    const speed = dt > 0 ? moved / Math.max(60, cam.dist) / dt : 0;
    this.warp = still ? 0 : lerp(this.warp, clamp((speed - 0.12) * 1.3, 0, 1), Math.min(1, dt * 8));
    this.lastTarget = { x: cam.tx, y: cam.ty, z: cam.tz, d: cam.dist };

    /* ---- stars move, fade, flash, swell under the cursor ---- */
    if (stepMorph(stage, now)) busy = true;
    const ka = stage.reduced ? 1 : Math.min(1, dt * 4);
    for (let i = 0; i < n; i++) {
      const target = stage.target[i] ?? 1;
      const a = stage.alpha[i]!;
      const next = a + (target - a) * ka;
      stage.alpha[i] = Math.abs(target - next) < 0.01 ? target : next;
      if (stage.alpha[i] !== target) busy = true;
      const f = stage.flash[i]!;
      if (f > 0) {
        stage.flash[i] = f < 0.01 ? 0 : f * Math.exp(-dt * 2.6);
        busy = true;
      }
    }
    if (stage.hoverIdx >= 0 && stage.hoverIdx < n) this.hovOn.add(stage.hoverIdx);
    const kh = stage.reduced ? 1 : Math.min(1, dt * 11);
    for (const i of this.hovOn) {
      const want = i === stage.hoverIdx ? 1 : 0;
      const v = this.hov[i]! + (want - this.hov[i]!) * kh;
      this.hov[i] = Math.abs(want - v) < 0.01 ? want : v;
      if (this.hov[i] !== want) busy = true;
      if (this.hov[i] === 0 && want === 0) this.hovOn.delete(i);
    }
    const egoTarget = ego ? 1 : 0;
    this.egoMix = stage.reduced ? egoTarget : lerp(this.egoMix, egoTarget, Math.min(1, dt * 3));
    if (Math.abs(this.egoMix - egoTarget) > 0.005) busy = true;
    else this.egoMix = egoTarget;
    const egoMix = this.egoMix;

    /* ---- semantic zoom ---- */
    const overview = overviewDistance(stage);
    const level = zoomLevel(cam.dist, overview, ego !== null);
    stage.level = level;
    if (Math.abs(level - this.lastLevel) > 0.04) {
      this.lastLevel = level;
      stage.onLevel(level);
    }
    const lw = levelWeights(level);
    {
      const zoom = overview / Math.max(1, cam.dist);
      const lv = this.lastView;
      if (
        !(Math.abs(lv.yaw - cam.yaw) < 0.004) ||
        !(Math.abs(lv.pitch - cam.pitch) < 0.004) ||
        !(Math.abs(lv.zoom - zoom) < 0.01)
      ) {
        this.lastView = { yaw: cam.yaw, pitch: cam.pitch, zoom };
        stage.onView({ yaw: cam.yaw, pitch: cam.pitch, zoom });
      }
    }

    /* ---- projection ---- */
    const cyw = Math.cos(cam.yaw);
    const syw = Math.sin(cam.yaw);
    const cpt = Math.cos(cam.pitch);
    const spt = Math.sin(cam.pitch);
    const focal = view.focal;
    const vx = view.cx;
    const vy = view.cy;
    let sx = 0;
    let sy = 0;
    let ss = 0;
    let sd = 0;
    const P = (x0: number, y0: number, z0: number): boolean => {
      const x = x0 - cam.tx;
      const y = y0 - cam.ty;
      const z = z0 - cam.tz;
      const x1 = x * cyw - z * syw;
      const z1 = x * syw + z * cyw;
      const y1 = y * cpt - z1 * spt;
      const z2 = y * spt + z1 * cpt;
      const d = z2 + cam.dist;
      if (d < NEAR) return false;
      const s = focal / d;
      sx = vx + x1 * s;
      sy = vy + y1 * s;
      ss = s;
      sd = d;
      return true;
    };
    const pos = stage.pos;
    for (let i = 0; i < n; i++) {
      if (P(pos[i * 3]!, pos[i * 3 + 1]!, pos[i * 3 + 2]!)) {
        this.px[i] = sx;
        this.py[i] = sy;
        this.ps[i] = ss;
        this.pd[i] = sd;
        this.ok[i] = 1;
      } else this.ok[i] = 0;
    }

    const add: GlobalCompositeOperation = tk.light ? "source-over" : "lighter";
    const focus = stage.hoverIdx >= 0 ? stage.hoverIdx : stage.peekIdx >= 0 ? stage.peekIdx : stage.selIdx;
    const near = focus >= 0 && !ego ? new Set(m.adjacency[focus] ?? []) : null;
    const hl = stage.highlight;
    const terms = stage.termLit;
    const grp = this.groupSet(stage, stage.hoverGroup);
    const hEdge = stage.hoverEdge >= 0 ? (m.edges[stage.hoverEdge] ?? null) : null;
    const quiet = (focus >= 0 && !ego) || hl !== null || terms !== null || grp !== null || hEdge !== null;
    this.quietMix = stage.reduced
      ? quiet
        ? 1
        : 0
      : lerp(this.quietMix, quiet ? 1 : 0, Math.min(1, dt * (quiet ? 9 : 5)));
    if (Math.abs(this.quietMix - (quiet ? 1 : 0)) > 0.01) busy = true;
    else this.quietMix = quiet ? 1 : 0;
    // Far out a whole sky stays legible behind what is lit; up close the rest steps back further.
    const dimFloor = lerp(tk.light ? 0.45 : 0.42, tk.light ? 0.3 : 0.24, clamp(level, 0, 1));
    const dimOthers = lerp(1, dimFloor, this.quietMix);
    const lit = (i: number) =>
      i === focus ||
      (near?.has(i) ?? false) ||
      (hl?.has(i) ?? false) ||
      (terms?.has(i) ?? false) ||
      (grp?.has(i) ?? false) ||
      (hEdge !== null && (hEdge.a === i || hEdge.b === i));
    // Atmosphere: what is further than the focus fades into its haze.
    const depthFade = (d: number) => clamp(1.55 - d / (cam.dist * 1.3), 0.16, 1);
    // Stars between the eye and what it looks at thin out, so a close-up is not a blur of foreground.
    const nearFade = (d: number) => clamp((d - cam.dist * 0.2) / (cam.dist * 0.36), 0, 1);
    const fogLevel = (d: number) => {
      const q = d / cam.dist;
      return q < 1.12 ? 0 : q < 1.55 ? 1 : 2;
    };
    const outside = 1 - 0.84 * egoMix;
    const starR = (i: number) => m.size[i]! * 1.1 * Math.pow(this.ps[i]!, 0.9);
    const tint = (hex: string) => (tk.light ? mixHex(hex, tk.text, 0.4) : hex);
    const cols = this.colours(m);

    /* ---- background layers: far ones only turn with the view, near ones slide past (parallax) ---- */
    {
      const warp = this.warp;
      const base = Math.max(900, m.radius * 1.4);
      const streak = warp > 0.03 && this.prevValid;
      ctx.globalCompositeOperation = "source-over";
      ctx.lineWidth = 1;
      let k = 0;
      LAYERS.forEach((layer, li) => {
        const R = base * layer.reach;
        const f = layer.follow;
        ctx.fillStyle = rgba(tk.light ? tk.faint : tk.dim, tk.light ? layer.alpha * 0.55 : layer.alpha);
        ctx.strokeStyle = rgba(tk.dim, 0.45 * warp * (li === 0 ? 0.4 : 1));
        if (streak) ctx.beginPath();
        for (let j = 0; j < layer.n; j++, k++) {
          const ok = P(
            this.bgDir[k * 3]! * R + cam.tx * f,
            this.bgDir[k * 3 + 1]! * R + cam.ty * f,
            this.bgDir[k * 3 + 2]! * R + cam.tz * f,
          );
          if (!ok || sx < -20 || sx > w + 20 || sy < -20 || sy > h + 20) {
            this.bgPrev[k * 2] = NaN;
            continue;
          }
          const size =
            layer.size *
            (0.55 + hash01(k, 303) * 0.9) *
            (li === 2 ? clamp(ss * (R / focal) * 0.6, 0.6, 2.2) : 1);
          if (streak && Number.isFinite(this.bgPrev[k * 2]!)) {
            ctx.moveTo(this.bgPrev[k * 2]!, this.bgPrev[k * 2 + 1]!);
            ctx.lineTo(sx, sy);
          }
          ctx.globalAlpha = 0.3 + 0.7 * hash01(k, 304);
          ctx.fillRect(sx - size / 2, sy - size / 2, size, size);
          this.bgPrev[k * 2] = sx;
          this.bgPrev[k * 2 + 1] = sy;
        }
        ctx.globalAlpha = 1;
        if (streak) ctx.stroke();
      });
      this.prevValid = true;
    }

    /* ---- the floor: a polar grid under the constellation, and drop lines from the areas ---- */
    const lay = stage.layout;
    const floor = this.floorOf(stage, m);
    const eye = eyeOf(cam);
    // Only from above (the eye on the stars' side of the plane), fading as the eye nears it.
    const floorAlpha =
      clamp((floor.y - eye.y) / (cam.dist * 0.25), 0, 1) * (1 - 0.55 * egoMix) * (tk.light ? 0.11 : 0.08);
    const floorP = (x: number, z: number) => P(x, floor.y, z);
    if (floorAlpha > 0.005) {
      ctx.globalCompositeOperation = "source-over";
      ctx.lineWidth = 1;
      const gridCol = tk.light ? mixHex(tk.dim, tk.agent, 0.25) : mixHex(tk.dim, tk.agentText, 0.3);
      const rings = 5;
      for (let k = 1; k <= rings; k++) {
        const rr = (floor.r * k) / rings;
        const steps = 72;
        ctx.strokeStyle = rgba(gridCol, floorAlpha * (k === rings ? 0.55 : 1 - (k / rings) * 0.45));
        ctx.beginPath();
        let pen = false;
        for (let s = 0; s <= steps; s++) {
          const th = (s / steps) * Math.PI * 2;
          if (floorP(floor.cx + Math.cos(th) * rr, floor.cz + Math.sin(th) * rr)) {
            const a = depthFade(sd);
            if (a < 0.2) pen = false;
            else if (pen) ctx.lineTo(sx, sy);
            else ctx.moveTo(sx, sy);
            pen = a >= 0.2;
          } else pen = false;
        }
        ctx.stroke();
      }
      ctx.strokeStyle = rgba(gridCol, floorAlpha * 0.6);
      ctx.beginPath();
      for (let k = 0; k < 12; k++) {
        const th = (k / 12) * Math.PI * 2;
        let pen = false;
        for (let s = 1; s <= 10; s++) {
          const rr = (floor.r * s) / 10;
          if (floorP(floor.cx + Math.cos(th) * rr, floor.cz + Math.sin(th) * rr)) {
            if (pen) ctx.lineTo(sx, sy);
            else ctx.moveTo(sx, sy);
            pen = true;
          } else pen = false;
        }
      }
      ctx.stroke();
      // Drop lines: where each group stands above the floor.
      if (lay && (lay.dim === "areas" || lay.dim === "types") && egoMix < 0.95) {
        ctx.setLineDash([2, 4]);
        lay.groups.forEach((g, gi) => {
          const neb = stage.nebulae[gi];
          const col = tint(neb?.color ?? tk.dim);
          if (!P(g.centre.x, g.centre.y + g.radius * 0.35, g.centre.z)) return;
          const x0 = sx;
          const y0 = sy;
          if (!floorP(g.centre.x, g.centre.z)) return;
          const hot = stage.hoverGroup === gi;
          ctx.strokeStyle = rgba(col, floorAlpha * (hot ? 3.4 : 1.8));
          ctx.beginPath();
          ctx.moveTo(x0, y0);
          ctx.lineTo(sx, sy);
          ctx.stroke();
          // its shadow on the floor
          ctx.beginPath();
          let pen = false;
          for (let s = 0; s <= 28; s++) {
            const th = (s / 28) * Math.PI * 2;
            const rr = g.radius * 0.55;
            if (floorP(g.centre.x + Math.cos(th) * rr, g.centre.z + Math.sin(th) * rr)) {
              if (pen) ctx.lineTo(sx, sy);
              else ctx.moveTo(sx, sy);
              pen = true;
            }
          }
          ctx.stroke();
        });
        ctx.setLineDash([]);
      }
      // The star under the cursor drops a line to the floor too: you see how high it floats.
      const hv = stage.hoverIdx;
      if (hv >= 0 && this.ok[hv] && !ego) {
        const x0 = this.px[hv]!;
        const y0 = this.py[hv]!;
        const p = hv * 3;
        if (floorP(pos[p]!, pos[p + 2]!)) {
          ctx.strokeStyle = rgba(tk.agentText, Math.min(0.5, floorAlpha * 4) * this.hov[hv]!);
          ctx.setLineDash([1, 3]);
          ctx.beginPath();
          ctx.moveTo(x0, y0);
          ctx.lineTo(sx, sy);
          ctx.stroke();
          ctx.setLineDash([]);
          ctx.beginPath();
          ctx.ellipse(sx, sy, 6, 6 * clamp(Math.abs(spt), 0.2, 1), 0, 0, Math.PI * 2);
          ctx.stroke();
        }
      }
    }

    /* ---- nebulae ---- */
    ctx.globalCompositeOperation = add;
    stage.nebulae.forEach((neb, gi) => {
      let presence = 0;
      for (const i of neb.members) presence += stage.alpha[i]!;
      presence = neb.members.length ? presence / neb.members.length : 0;
      presence *= 1 - 0.7 * egoMix;
      if (grp && stage.hoverGroup !== gi) presence *= 0.55;
      else if (stage.hoverGroup === gi) presence *= 1.6;
      if (presence < 0.02) return;
      const col = tint(neb.color);
      const sprite = book.puff(col);
      for (const pf of neb.puffs) {
        if (!P(neb.centre.x + pf.o.x, neb.centre.y + pf.o.y, neb.centre.z + pf.o.z)) continue;
        const r = pf.r * ss;
        if (r < 3) continue;
        ctx.globalAlpha =
          (tk.light ? 0.09 : 0.1) * pf.a * presence * (stage.dim === "areas" ? 1 : 0.8) * depthFade(sd);
        ctx.drawImage(sprite, sx - r, sy - r, r * 2, r * 2);
      }
    });
    ctx.globalAlpha = 1;
    // Area dust (the areas arrangement): depth inside each nebula.
    if (stage.dim === "areas" && egoMix < 0.95) {
      m.clusters.forEach((cl) => {
        ctx.fillStyle = rgba(tint(cl.color), (tk.light ? 0.36 : 0.3) * (1 - egoMix));
        for (const d of cl.dust) {
          if (!P(d.x, d.y, d.z)) continue;
          const s = clamp(1.1 * ss, 0.6, 2.4);
          ctx.globalAlpha = depthFade(sd);
          ctx.fillRect(sx - s / 2, sy - s / 2, s, s);
        }
      });
      ctx.globalAlpha = 1;
    }

    /* ---- guides of the arrangement ---- */
    const guideAlpha = (1 - 0.9 * egoMix) * (tk.light ? 0.5 : 0.42);
    if (lay && guideAlpha > 0.02) {
      ctx.globalCompositeOperation = "source-over";
      ctx.lineWidth = 1;
      const rings = lay.dim === "links";
      for (const g of lay.guides) {
        ctx.strokeStyle = rgba(
          g.strong || rings ? tk.agentText : tk.dim,
          guideAlpha * (g.strong ? 0.8 : rings ? 0.75 : 0.55),
        );
        ctx.setLineDash(g.strong ? [] : rings ? [1, 3] : [2, 5]);
        ctx.beginPath();
        if (g.shape === "line" && g.b) {
          const steps = 24;
          let pen = false;
          for (let k = 0; k <= steps; k++) {
            const u = k / steps;
            if (P(lerp(g.a.x, g.b.x, u), lerp(g.a.y, g.b.y, u), lerp(g.a.z, g.b.z, u))) {
              if (pen) ctx.lineTo(sx, sy);
              else ctx.moveTo(sx, sy);
              pen = true;
            } else pen = false;
          }
        } else if (g.shape === "ring" && g.radius) {
          const steps = 56;
          let pen = false;
          for (let k = 0; k <= steps; k++) {
            const th = (k / steps) * Math.PI * 2;
            const c = Math.cos(th) * g.radius;
            const s2 = Math.sin(th) * g.radius;
            const ok = g.normal === "x" ? P(g.a.x, g.a.y + c, g.a.z + s2) : P(g.a.x + c, g.a.y, g.a.z + s2);
            if (ok) {
              if (pen) ctx.lineTo(sx, sy);
              else ctx.moveTo(sx, sy);
              pen = true;
            } else pen = false;
          }
        }
        ctx.stroke();
      }
      ctx.setLineDash([]);
    }

    /* ---- link curves: control points (cached while nothing moves), projected every frame ---- */
    if (this.cpVersion !== stage.posVersion || this.cpModel !== m) {
      this.cpVersion = stage.posVersion;
      this.cpModel = m;
      for (let e = 0; e < E; e++) {
        const ed = m.edges[e]!;
        const a = ed.a * 3;
        const b = ed.b * 3;
        const ax = pos[a]!;
        const ay = pos[a + 1]!;
        const az = pos[a + 2]!;
        const bx = pos[b]!;
        const by = pos[b + 1]!;
        const bz = pos[b + 2]!;
        let cx = 0;
        let cy = 0;
        let cz = 0;
        if (ego && ego.hop.has(ed.a) && ego.hop.has(ed.b)) {
          cx = ego.anchor.x;
          cy = ego.anchor.y;
          cz = ego.anchor.z;
        } else if (lay?.axis) {
          cx = (ax + bx) / 2;
        } else if (lay) {
          const g = lay.groupOf[ed.a] ?? -1;
          if (g >= 0 && g === lay.groupOf[ed.b] && lay.groups[g]) {
            const c = lay.groups[g]!.centre;
            cx = c.x;
            cy = c.y;
            cz = c.z;
          }
        }
        controlPointInto(this.cp, e * 3, ax, ay, az, bx, by, bz, cx, cy, cz, EDGE_BEND, e);
      }
    }
    for (let e = 0; e < E; e++) {
      if (P(this.cp[e * 3]!, this.cp[e * 3 + 1]!, this.cp[e * 3 + 2]!)) {
        this.cx2[e] = sx;
        this.cy2[e] = sy;
        this.cok[e] = 1;
      } else this.cok[e] = 0;
    }

    /* ---- background links: batched by depth (near: thicker, brighter) and kind ---- */
    ctx.globalCompositeOperation = "source-over";
    const TIERS = 4;
    const buckets: Path2D[] = Array.from({ length: TIERS * 2 }, () => new Path2D());
    const warm = new Path2D();
    let anyWarm = false;
    const ribbons: number[] = [];
    const hot: number[] = [];
    const margin = 60;
    for (let e = 0; e < E; e++) {
      const ed = m.edges[e]!;
      const a = ed.a;
      const b = ed.b;
      if (!this.ok[a] || !this.ok[b]) continue;
      const v = Math.min(stage.alpha[a]!, stage.alpha[b]!);
      if (v < 0.05) continue;
      if (ego && ego.hop.has(a) && ego.hop.has(b)) {
        ribbons.push(e);
        continue;
      }
      if (e === stage.hoverEdge || (!ego && focus >= 0 && (a === focus || b === focus) && v > 0.5)) {
        hot.push(e);
        continue;
      }
      const ax = this.px[a]!;
      const ay = this.py[a]!;
      const bx = this.px[b]!;
      const by = this.py[b]!;
      const has = this.cok[e] === 1;
      const cx = has ? this.cx2[e]! : (ax + bx) / 2;
      const cy = has ? this.cy2[e]! : (ay + by) / 2;
      if (
        Math.max(ax, bx, cx) < -margin ||
        Math.min(ax, bx, cx) > w + margin ||
        Math.max(ay, by, cy) < -margin ||
        Math.min(ay, by, cy) > h + margin
      )
        continue;
      if ((hl && hl.has(a) && hl.has(b)) || (grp && grp.has(a) && grp.has(b))) {
        warm.moveTo(ax, ay);
        warm.quadraticCurveTo(cx, cy, bx, by);
        anyWarm = true;
        continue;
      }
      const q = (this.pd[a]! + this.pd[b]!) / 2 / cam.dist;
      const tier = q > 1.35 ? 0 : q > 1.0 ? 1 : q > 0.72 ? 2 : 3;
      const path = buckets[tier * 2 + (ed.strong ? 1 : 0)]!;
      path.moveTo(ax, ay);
      path.quadraticCurveTo(cx, cy, bx, by);
    }
    // A dense web fades so the stars stay readable.
    const density = Math.sqrt(clamp(400 / Math.max(1, E), 0.16, 1));
    const lineBase = (tk.light ? 0.075 : 0.11) * density * lerp(1, 0.42, this.quietMix) * outside;
    const strongCol = tk.light ? mixHex(tk.dim, tk.agent, 0.3) : mixHex(tk.dim, tk.agentText, 0.3);
    const tierAlpha = [0.32, 0.8, 1.3, 1.7];
    const tierWidth = [0.45, 0.8, 1.15, 1.6];
    for (let tier = 0; tier < TIERS; tier++)
      for (let strong = 0; strong < 2; strong++) {
        ctx.lineWidth = tierWidth[tier]! * (strong ? 1.15 : 1);
        ctx.strokeStyle = rgba(strong ? strongCol : tk.dim, lineBase * tierAlpha[tier]! * (strong ? 1.7 : 1));
        ctx.stroke(buckets[tier * 2 + strong]!);
      }
    if (anyWarm) {
      ctx.lineWidth = 1.1;
      ctx.strokeStyle =
        stage.labelHighlight && !grp ? rgba(tk.agent, 0.34) : rgba(tk.dim, Math.min(0.6, lineBase * 3.2));
      ctx.stroke(warm);
    }

    /* ---- the focused note's links (overview): lit curves with light flowing out ---- */
    const flow = still ? 0 : -t * 34;
    for (const e of hot) {
      const ed = m.edges[e]!;
      const out = ed.a === focus;
      const [a, b] = out ? [ed.a, ed.b] : [ed.b, ed.a];
      const cx = this.cok[e] ? this.cx2[e]! : (this.px[a]! + this.px[b]!) / 2;
      const cy = this.cok[e] ? this.cy2[e]! : (this.py[a]! + this.py[b]!) / 2;
      const pointed = e === stage.hoverEdge;
      ctx.beginPath();
      ctx.moveTo(this.px[a]!, this.py[a]!);
      ctx.quadraticCurveTo(cx, cy, this.px[b]!, this.py[b]!);
      if (pointed && !tk.light) {
        ctx.globalCompositeOperation = add;
        ctx.lineWidth = 7;
        ctx.strokeStyle = rgba(tk.agent, 0.16);
        ctx.stroke();
        ctx.globalCompositeOperation = "source-over";
      }
      ctx.lineWidth = pointed ? 2 : 1.5;
      ctx.strokeStyle = rgba(tk.agent, tk.light ? 0.7 : pointed ? 0.95 : 0.75);
      ctx.stroke();
      if (!still) {
        ctx.setLineDash([2, 12]);
        ctx.lineDashOffset = flow;
        ctx.lineWidth = 2.2;
        ctx.strokeStyle = rgba(tk.light ? tk.agent : "#ffffff", 0.75);
        ctx.stroke();
        ctx.setLineDash([]);
        busy = true;
      }
    }

    /* ---- inside a note: its synapses are ribbons you can follow ---- */
    const sample = new Float32Array((RIBBON_STEPS + 1) * 3);
    const ribbonPoint = (e: number, u: number): boolean => {
      const ed = m.edges[e]!;
      const a = ed.a * 3;
      const b = ed.b * 3;
      const q = 1 - u;
      return P(
        q * q * pos[a]! + 2 * q * u * this.cp[e * 3]! + u * u * pos[b]!,
        q * q * pos[a + 1]! + 2 * q * u * this.cp[e * 3 + 1]! + u * u * pos[b + 1]!,
        q * q * pos[a + 2]! + 2 * q * u * this.cp[e * 3 + 2]! + u * u * pos[b + 2]!,
      );
    };
    if (ribbons.length > 0 && ego) {
      const pointed = stage.hoverIdx >= 0 ? stage.hoverIdx : stage.peekIdx;
      const travelEdge = stage.travel?.edge ?? -1;
      // Far ribbons first.
      ribbons.sort((x, y) => {
        const dx = this.pd[m.edges[x]!.a]! + this.pd[m.edges[x]!.b]!;
        const dy = this.pd[m.edges[y]!.a]! + this.pd[m.edges[y]!.b]!;
        return dy - dx;
      });
      for (const e of ribbons) {
        const ed = m.edges[e]!;
        // Walk from the end nearer the centre outwards (the flow runs away from the note).
        const ha = ego.hop.get(ed.a)!;
        const hb = ego.hop.get(ed.b)!;
        const outward = ha <= hb;
        let okAll = true;
        let sAvg = 0;
        for (let k = 0; k <= RIBBON_STEPS; k++) {
          const u = outward ? k / RIBBON_STEPS : 1 - k / RIBBON_STEPS;
          if (!ribbonPoint(e, u)) {
            okAll = false;
            break;
          }
          sample[k * 3] = sx;
          sample[k * 3 + 1] = sy;
          sample[k * 3 + 2] = ss;
          sAvg += ss;
        }
        if (!okAll) continue;
        sAvg /= RIBBON_STEPS + 1;
        const inner = Math.min(ha, hb);
        const lit2 = (pointed >= 0 && (ed.a === pointed || ed.b === pointed)) || e === stage.hoverEdge;
        const travelling = e === travelEdge;
        const v = Math.min(stage.alpha[ed.a]!, stage.alpha[ed.b]!) * egoMix;
        const kindCol =
          ed.kind === "markdown-link"
            ? tk.agent
            : ed.kind === "related"
              ? tk.accent
              : mixHex(tk.dim, tk.agentText, 0.25);
        const col = travelling || lit2 ? tk.agent : kindCol;
        const weight = inner === 0 ? 1 : 0.6;
        const trace = () => {
          ctx.beginPath();
          ctx.moveTo(sample[0]!, sample[1]!);
          for (let k = 1; k <= RIBBON_STEPS; k++) ctx.lineTo(sample[k * 3]!, sample[k * 3 + 1]!);
        };
        // glow
        ctx.globalCompositeOperation = add;
        trace();
        ctx.lineCap = "round";
        ctx.lineWidth = clamp(sAvg * (lit2 || travelling ? 12 : 8) * weight, 2, 18);
        ctx.strokeStyle = rgba(col, (tk.light ? 0.1 : 0.09) * v * (lit2 || travelling ? 2 : 1));
        ctx.stroke();
        // body
        ctx.globalCompositeOperation = "source-over";
        ctx.lineWidth = clamp(sAvg * 1.7 * weight, 0.8, 3) * (lit2 ? 1.4 : 1);
        ctx.strokeStyle = rgba(col, (lit2 || travelling ? 0.95 : 0.6) * v * (inner === 0 ? 1 : 0.7));
        ctx.stroke();
        // light flowing outwards along it
        if (!still) {
          ctx.setLineDash([1.5, 9 + 3 * inner]);
          ctx.lineDashOffset = flow * (inner === 0 ? 1 : 0.7);
          ctx.lineWidth = clamp(sAvg * 2.4 * weight, 1.2, 3.6);
          ctx.strokeStyle = rgba(tk.light ? tk.agent : "#ffffff", (lit2 || travelling ? 0.95 : 0.55) * v);
          ctx.stroke();
          ctx.setLineDash([]);
          busy = true;
        }
        ctx.lineCap = "butt";
      }
    }

    /* ---- key-term threads: from the note to every star sharing a term ---- */
    if (terms && terms.size > 0 && stage.selIdx >= 0 && this.ok[stage.selIdx]) {
      const c = stage.selIdx;
      ctx.globalCompositeOperation = "source-over";
      ctx.setLineDash([3, 6]);
      ctx.lineWidth = 1;
      ctx.strokeStyle = rgba(tk.accent, 0.55);
      ctx.beginPath();
      for (const i of terms) {
        if (i === c || !this.ok[i] || stage.alpha[i]! < 0.3) continue;
        const mx = (this.px[c]! + this.px[i]!) / 2;
        const my =
          (this.py[c]! + this.py[i]!) / 2 -
          Math.hypot(this.px[i]! - this.px[c]!, this.py[i]! - this.py[c]!) * 0.18;
        ctx.moveTo(this.px[c]!, this.py[c]!);
        ctx.quadraticCurveTo(mx, my, this.px[i]!, this.py[i]!);
      }
      ctx.stroke();
      ctx.setLineDash([]);
    }

    /* ---- synapses firing ---- */
    const worldLen = (e: number) => {
      const ed = m.edges[e]!;
      const a = ed.a * 3;
      const b = ed.b * 3;
      return Math.hypot(pos[b]! - pos[a]!, pos[b + 1]! - pos[a + 1]!, pos[b + 2]! - pos[a + 2]!);
    };
    // A new star under the cursor fires down every one of its links at once.
    if (stage.hoverIdx !== this.lastHover) {
      this.lastHover = stage.hoverIdx;
      if (stage.hoverIdx >= 0 && !still && stage.hoverIdx < n) {
        stage.pulses = [
          ...stage.pulses,
          ...burst(stage.hoverIdx, m.incident, now + 40, {
            strength: 0.9,
            gen: 1,
            max: 18,
            dur: (e) => pulseDuration(worldLen(e)) * 0.8,
          }),
        ].slice(-240);
      }
    }
    if (!still && E > 0) {
      const visibleEdge = (e: number) => {
        const ed = m.edges[e]!;
        return (
          this.ok[ed.a] === 1 && this.ok[ed.b] === 1 && stage.alpha[ed.a]! > 0.5 && stage.alpha[ed.b]! > 0.5
        );
      };
      if (now >= this.nextAmbient) {
        this.nextAmbient = now + (ego ? 520 : quiet ? 380 : 150) + Math.random() * 120;
        for (let tries = 0; tries < 4; tries++) {
          const e = Math.floor(Math.random() * E);
          if (!visibleEdge(e)) continue;
          if (ego && !(ego.hop.has(m.edges[e]!.a) && ego.hop.has(m.edges[e]!.b)) && Math.random() < 0.7)
            continue;
          const ed = m.edges[e]!;
          stage.pulses.push({
            e,
            from: Math.random() < 0.5 ? ed.a : ed.b,
            t0: now,
            dur: pulseDuration(worldLen(e)),
            s: 0.5,
            gen: 2,
          });
          break;
        }
      }
      const source = ego ? ego.centre : focus;
      if (source >= 0 && now >= this.nextFocus) {
        this.nextFocus = now + (ego ? 300 : 420) + Math.random() * 160;
        // Inside a note, the first shell fires onwards too.
        const from =
          ego && Math.random() < 0.4 && ego.hop1.length > 0
            ? ego.hop1[Math.floor(Math.random() * ego.hop1.length)]!
            : source;
        const inc = m.incident[from] ?? [];
        if (inc.length > 0) {
          const e = inc[Math.floor(Math.random() * inc.length)]!;
          if (visibleEdge(e))
            stage.pulses.push({ e, from, t0: now, dur: pulseDuration(worldLen(e)), s: 0.85, gen: 1 });
        }
      }
      stage.pulses = stepPulses(stage.pulses, now, (p: Pulse) => {
        const end = pulseEnd(p, m.edges);
        if (end < n) stage.flash[end] = Math.max(stage.flash[end]!, p.s * 0.85);
        if (p.gen < 2 && !stage.economy)
          return cascade(p, m.edges, m.incident, now, Math.random, {
            dur: (e) => pulseDuration(worldLen(e)),
          });
      });
    } else if (stage.pulses.length > 0 && still) stage.pulses = [];
    if (stage.pulses.length > 0) {
      busy = true;
      ctx.globalCompositeOperation = add;
      for (const p of stage.pulses) {
        const k = (now - p.t0) / p.dur;
        if (k < 0 || k > 1) continue;
        const ed = m.edges[p.e];
        if (!ed || !this.ok[ed.a] || !this.ok[ed.b]) continue;
        const rev = p.from !== ed.a;
        const inRibbon = ego !== null && ego.hop.has(ed.a) && ego.hop.has(ed.b);
        const col = p.gen <= 1 ? tk.agent : tint(m.color[p.from] ?? tk.agent);
        const spark = book.spark(col);
        const env = Math.sin(Math.PI * clamp(k * 1.15, 0, 1)) * (0.35 + 0.65 * p.s);
        for (let tail = 4; tail >= 0; tail--) {
          const kk = k - tail * 0.028;
          if (kk < 0) continue;
          const u = rev ? 1 - kk : kk;
          let x: number;
          let y: number;
          let s: number;
          if (inRibbon) {
            if (!ribbonPoint(p.e, u)) continue;
            x = sx;
            y = sy;
            s = ss;
          } else {
            const q = 1 - u;
            const cx = this.cok[p.e] ? this.cx2[p.e]! : (this.px[ed.a]! + this.px[ed.b]!) / 2;
            const cy = this.cok[p.e] ? this.cy2[p.e]! : (this.py[ed.a]! + this.py[ed.b]!) / 2;
            x = q * q * this.px[ed.a]! + 2 * q * u * cx + u * u * this.px[ed.b]!;
            y = q * q * this.py[ed.a]! + 2 * q * u * cy + u * u * this.py[ed.b]!;
            s = this.ps[ed.a]! * (1 - u) + this.ps[ed.b]! * u || 1;
          }
          const r = (2.4 + 3.2 * p.s) * clamp(Math.pow(s, 0.7), 0.5, 1.8) * (1 - tail * 0.16);
          ctx.globalAlpha = env * (1 - tail * 0.2) * (inRibbon || p.gen <= 1 ? 1 : outside);
          ctx.drawImage(spark, x - r, y - r, r * 2, r * 2);
        }
      }
      ctx.globalAlpha = 1;
    }

    /* ---- stars, far to near: fogged and out of focus far away, crisp up close ---- */
    const order = this.order;
    order.length = 0;
    for (let i = 0; i < n; i++) if (this.ok[i] && stage.alpha[i]! > 0.02) order.push(i);
    order.sort((i, j) => this.pd[j]! - this.pd[i]!);
    this.hit.fill(0);
    const sel = stage.selIdx;
    for (const i of order) {
      const d = this.pd[i]!;
      const hop = ego?.hop.get(i);
      const member = hop !== undefined;
      const on = lit(i) || member;
      const hv = this.hov[i]!;
      const a =
        stage.alpha[i]! *
        (member ? 1 : depthFade(d)) *
        (i === sel || member || hv > 0 ? 1 : nearFade(d)) *
        (on ? 1 : dimOthers) *
        (ego && !member ? outside : 1);
      if (a < 0.01) continue;
      const hopScale = hop === 0 ? 2.3 : hop === 1 ? 1.45 : hop === 2 ? 1.1 : 1;
      const r = clamp(
        starR(i) * lerp(1, hopScale, egoMix) * (on && !member ? 1.22 : 1) * (1 + 0.55 * hv),
        0.8,
        (hop === 0 ? 30 : member ? 17 : 13) * (1 + 0.4 * hv),
      );
      const x = this.px[i]!;
      const y = this.py[i]!;
      const fl0 = on || i === sel || member ? 0 : fogLevel(d);
      const col = cols[fl0]![i]!;
      const raw = m.color[i]!;
      const dd = Math.abs(d - cam.dist) / cam.dist;
      const blur: Blur = on || i === sel || hv > 0 ? 0 : dd < 0.35 ? 0 : dd < 0.85 ? 1 : 2;
      ctx.globalCompositeOperation = add;
      ctx.globalAlpha = a;
      if (r >= BODY_PX && a > 0.3) {
        const g = Math.min(r * 3.4, r + 34);
        ctx.drawImage(book.glow(col, 0), x - g, y - g, g * 2, g * 2);
        ctx.globalCompositeOperation = "source-over";
        ctx.drawImage(book.body(fl0 === 0 ? raw : col), x - r, y - r, r * 2, r * 2);
        if (r >= GLYPH_INSIDE_PX) {
          ctx.strokeStyle = rgba(tk.bg, 0.86 * a);
          strokeGlyph(ctx, book.glyph(m.kind[i]!), x, y, r * 1.12);
        }
      } else {
        const g =
          !on && this.quietMix > 0.5
            ? r * 2.6
            : Math.min(r * (blur === 2 ? 4.8 : 4.2), r + (blur === 2 ? 24 : 32));
        ctx.drawImage(book.glow(col, blur), x - g, y - g, g * 2, g * 2);
      }
      if (hv > 0.01) {
        // under the cursor: a halo of the agent's light around it
        ctx.globalCompositeOperation = add;
        ctx.globalAlpha = 0.55 * hv;
        const g = r * 3 + 10;
        ctx.drawImage(book.glow(tk.agent, 1), x - g, y - g, g * 2, g * 2);
      }
      const fl = stage.flash[i]!;
      if (fl > 0.02) {
        ctx.globalCompositeOperation = add;
        ctx.globalAlpha = fl * Math.min(1, a + 0.3);
        const g = r * 2 + 18 * fl;
        ctx.drawImage(book.glow(tk.agent, 0), x - g, y - g, g * 2, g * 2);
      }
      if (stage.alpha[i]! > 0.4 && a > 0.1) {
        this.hx[i] = x;
        this.hy[i] = y;
        this.hr[i] = Math.max(4, r * 1.25);
        this.hit[i] = 1;
      }
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "source-over";

    /* ---- recent changes pulse ---- */
    const nowMs = Date.now();
    ctx.lineWidth = 1;
    for (const i of order) {
      if (stage.alpha[i]! < 0.6 || !isRecent(m.mtime[i]!, nowMs, stage.cutoff)) continue;
      if ((quiet && !lit(i)) || (ego && !ego.hop.has(i))) continue;
      const d = this.pd[i]!;
      const fade = nearFade(d) * depthFade(d);
      if (fade < 0.2) continue;
      const r = Math.max(1.2, Math.min(10, starR(i)));
      const col = tint(m.color[i]!);
      if (still) {
        ctx.strokeStyle = rgba(col, 0.45 * fade);
        ctx.beginPath();
        ctx.arc(this.px[i]!, this.py[i]!, r * 2.6, 0, Math.PI * 2);
        ctx.stroke();
      } else {
        busy = true;
        const ph = (t * 0.6 + (i % 7) / 7) % 1;
        ctx.strokeStyle = rgba(col, 0.5 * (1 - ph) * fade);
        ctx.beginPath();
        ctx.arc(this.px[i]!, this.py[i]!, Math.min(r * (2 + ph * 5), 36), 0, Math.PI * 2);
        ctx.stroke();
      }
    }

    /* ---- arrival bursts ---- */
    if (stage.bursts.length > 0) {
      stage.bursts = stage.bursts.filter((b) => now - b.t0 < 1300);
      for (const b of stage.bursts) {
        const i = b.i;
        if (!this.ok[i]) continue;
        const k = (now - b.t0) / 1300;
        const r0 = this.hit[i] ? this.hr[i]! : 8;
        for (let ring = 0; ring < 2; ring++) {
          const kk = clamp(k * 1.25 - ring * 0.2, 0, 1);
          if (kk <= 0 || kk >= 1) continue;
          ctx.strokeStyle = rgba(tk.agent, 0.8 * (1 - kk) * (1 - kk));
          ctx.lineWidth = 2 - kk * 1.4;
          ctx.beginPath();
          ctx.arc(this.px[i]!, this.py[i]!, r0 + kk * (90 + ring * 50), 0, Math.PI * 2);
          ctx.stroke();
        }
      }
      if (stage.bursts.length > 0) busy = true;
    }

    /* ---- the reticle on the note you are in (it fills as you read) ---- */
    const reticle = ego ? ego.centre : sel;
    if (reticle >= 0 && this.ok[reticle] && stage.alpha[reticle]! > 0.3) {
      const x = this.px[reticle]!;
      const y = this.py[reticle]!;
      const base = this.hit[reticle] ? this.hr[reticle]! : 10;
      const rr = base + 9 + (still ? 0 : Math.sin(t * 2.4) * 1.5);
      const spin = still ? 0 : t * 0.5;
      ctx.strokeStyle = rgba(tk.agent, 0.85);
      ctx.lineWidth = 1.2;
      for (let k = 0; k < 4; k++) {
        const a0 = (k * Math.PI) / 2 + spin;
        ctx.beginPath();
        ctx.arc(x, y, rr, a0, a0 + 0.9);
        ctx.stroke();
      }
      if (ego && stage.readProgress > 0.005) {
        ctx.strokeStyle = rgba(tk.agentText, 0.9);
        ctx.lineWidth = 2.2;
        ctx.beginPath();
        ctx.arc(x, y, rr + 6, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * clamp(stage.readProgress, 0, 1));
        ctx.stroke();
      }
      if (!still) busy = true;
    }

    /* ---- the star the wheel would dive into ---- */
    stage.enterIdx = -1;
    let enterBox: Box | null = null;
    if (!ego && level >= 1.55 && !stage.flight) {
      let best = -1;
      let bestD = 90 * 90;
      const aim = stage.pointer ?? { x: view.cx, y: view.cy };
      for (const i of order) {
        if (!this.hit[i] || stage.alpha[i]! < 0.6 || (quiet && !lit(i))) continue;
        const d2 = (this.px[i]! - aim.x) ** 2 + (this.py[i]! - aim.y) ** 2;
        if (d2 < bestD) {
          bestD = d2;
          best = i;
        }
      }
      stage.enterIdx = best;
      if (best >= 0) {
        const x = this.px[best]!;
        const y = this.py[best]!;
        const rr = this.hr[best]! + 12;
        const k = clamp((level - 1.55) / 0.4, 0, 1);
        ctx.strokeStyle = rgba(tk.agentText, 0.6 * k);
        ctx.setLineDash([3, 5]);
        ctx.lineDashOffset = still ? 0 : -t * 10;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(x, y, rr, 0, Math.PI * 2);
        ctx.stroke();
        ctx.setLineDash([]);
        const font = `500 12px ${tk.body}`;
        const tw = this.width(font, words.enter);
        ctx.font = font;
        ctx.textAlign = "center";
        ctx.textBaseline = "alphabetic";
        ctx.globalAlpha = k;
        ctx.fillStyle = tk.agentText;
        ctx.fillText(words.enter, x, y - rr - 7);
        ctx.globalAlpha = 1;
        enterBox = { x: x - tw / 2 - 2, y: y - rr - 19, w: tw + 4, h: 15 };
        if (!still) busy = true;
      }
    }

    /* ---- the cursor's halo: a faint reticle that snaps onto the star under it ---- */
    {
      const p = stage.pointer;
      const hv = stage.hoverIdx;
      const onStar = hv >= 0 && this.hit[hv];
      const wantA = !p || stage.dragging ? 0 : onStar ? 0.9 : 0.32;
      const wx = onStar ? this.hx[hv]! : (p?.x ?? this.halo.x);
      const wy = onStar ? this.hy[hv]! : (p?.y ?? this.halo.y);
      const wr = onStar ? this.hr[hv]! + 9 : 11;
      const k = stage.reduced ? 1 : Math.min(1, dt * 18);
      const hl0 = this.halo;
      if (hl0.a < 0.01 && wantA > 0) {
        hl0.x = wx;
        hl0.y = wy;
      }
      hl0.x = lerp(hl0.x, wx, k);
      hl0.y = lerp(hl0.y, wy, k);
      hl0.r = lerp(hl0.r, wr, k);
      hl0.a = lerp(hl0.a, wantA, Math.min(1, dt * 10));
      if (Math.abs(hl0.a - wantA) > 0.01 || Math.abs(hl0.x - wx) > 0.3 || Math.abs(hl0.y - wy) > 0.3)
        busy = true;
      if (hl0.a > 0.01) {
        ctx.strokeStyle = rgba(onStar ? tk.agent : tk.dim, hl0.a * (onStar ? 0.9 : 0.8));
        ctx.lineWidth = 1;
        const spin = still || !onStar ? Math.PI / 4 : t * 0.8;
        for (let q = 0; q < 4; q++) {
          const a0 = spin + (q * Math.PI) / 2;
          ctx.beginPath();
          ctx.arc(hl0.x, hl0.y, hl0.r, a0 - 0.32, a0 + 0.32);
          ctx.stroke();
        }
        if (!onStar) {
          ctx.fillStyle = rgba(tk.dim, hl0.a);
          ctx.fillRect(hl0.x - 0.75, hl0.y - 0.75, 1.5, 1.5);
        } else if (!still) busy = true;
      }
    }

    /* ---- words ---- */
    this.labels(stage, m, lw, level, focus, near, nearFade, depthFade, starR, lit, grp, dt, enterBox);

    // Leaving hint: zoomed out past the note's space.
    if (ego) {
      const far = cam.dist / egoDistance(stage, ego);
      const target = clamp((far - 1.45) / 0.5, 0, 1);
      this.exitHint = lerp(this.exitHint, target, Math.min(1, dt * 6));
      if (this.exitHint > 0.02) {
        ctx.font = `500 12px ${tk.body}`;
        ctx.textAlign = "center";
        ctx.globalAlpha = this.exitHint;
        ctx.fillStyle = tk.agentText;
        ctx.fillText(words.exit, view.cx, h - ins.bottom - 14);
        ctx.globalAlpha = 1;
        busy = true;
      }
    } else this.exitHint = 0;

    return busy;
  }

  private labels(
    stage: Stage,
    m: StarModel,
    lw: ReturnType<typeof levelWeights>,
    level: number,
    focus: number,
    near: Set<number> | null,
    nearFade: (d: number) => number,
    depthFade: (d: number) => number,
    starR: (i: number) => number,
    lit: (i: number) => boolean,
    grp: Set<number> | null,
    dt: number,
    enterBox: Box | null,
  ) {
    const { ctx, tk, book } = this;
    const { w, h } = this;
    const ego = stage.ego;
    const egoMix = this.egoMix;
    const ins = stage.insets;
    const quiet = this.quietMix > 0.5;
    // Text stays out of the HUD, the voice line and the reader (stars may pass under them).
    const bounds: Box = {
      x: ins.left + 6,
      y: ins.top + 4,
      w: Math.max(10, w - ins.left - ins.right - 12),
      h: Math.max(10, h - ins.top - ins.bottom - 8),
    };
    const inFree = (x: number, y: number) =>
      x >= bounds.x && x <= bounds.x + bounds.w && y >= bounds.y && y <= bounds.y + bounds.h;
    const blocked: Box[] = stage.blocked.map(([x, y, bw, bh]) => ({
      x: x - 8,
      y: y - 6,
      w: bw + 16,
      h: bh + 12,
    }));
    if (enterBox) blocked.push(enterBox);
    const outline = (text: string, x: number, y: number, fill: string, a: number) => {
      ctx.lineJoin = "round";
      ctx.lineWidth = 3;
      ctx.strokeStyle = rgba(tk.bg, (tk.light ? 0.9 : 0.82) * a);
      ctx.strokeText(text, x, y);
      ctx.fillStyle = fill;
      ctx.fillText(text, x, y);
    };
    ctx.textBaseline = "alphabetic";
    this.groupBoxes = [];

    /* groups: area / type names at their clouds' centres */
    const lay = stage.layout;
    const eye = eyeOf(stage.cam);
    const freeMin = Math.max(120, Math.min(bounds.w, bounds.h));
    const groupAlpha = (1 - 0.95 * egoMix) * lerp(1, 0.6, this.quietMix);
    if (lay && groupAlpha > 0.03 && (lay.dim === "areas" || lay.dim === "types")) {
      const reach = this.reachOf(stage);
      lay.groups.forEach((g, gi) => {
        let presence = 0;
        for (const i of g.members) presence += stage.alpha[i]!;
        presence = g.members.length ? presence / g.members.length : 0;
        if (presence < 0.1) return;
        const pr = this.projectPoint(stage, g.centre.x, g.centre.y, g.centre.z);
        if (!pr) return;
        const span = (reach[gi] ?? g.radius) * 2 * pr.s;
        const hot = stage.hoverGroup === gi;
        const zoomed = hot ? 1 : 1 - clamp((level - 1.3) / 0.6, 0, 1) * 0.7;
        const eyeD = Math.hypot(eye.x - g.centre.x, eye.y - g.centre.y, eye.z - g.centre.z);
        const alpha =
          groupPresence(span / freeMin, eyeD / Math.max(20, reach[gi] ?? g.radius)) *
          zoomed *
          presence *
          groupAlpha *
          (grp && !hot ? 0.45 : 1) *
          clamp(depthFade(pr.d) + 0.25, 0, 1);
        if (alpha < 0.04) return;
        const size = groupPx(span);
        const font = `600 ${size}px ${tk.display}`;
        const text = spaced((stage.groupText[gi] ?? g.key).toUpperCase());
        const count = String(g.members.length);
        const cfont = `500 ${Math.max(12, size - 2)}px ${tk.mono}`;
        const tw = this.width(font, text);
        const cw = this.width(cfont, count) + 7;
        const glyphW = lay.dim === "types" ? size + 6 : 0;
        const total = glyphW + tw + cw;
        // Just above the middle of the cloud, so the stars at its heart stay visible; it steps up
        // (or down) off any bright star it would cover.
        const w0 = total + 12;
        const h0 = size + 9;
        const clearOf = (b: Box) => {
          for (const k of this.order) {
            if (!this.hit[k] || this.hr[k]! < 3.2) continue;
            const x = this.hx[k]!;
            const y = this.hy[k]!;
            const r = this.hr[k]! * 0.7;
            if (x + r > b.x && x - r < b.x + b.w && y + r > b.y && y - r < b.y + b.h) return false;
          }
          return true;
        };
        const hitsUi = (b: Box) =>
          blocked.some((o) => b.x < o.x + o.w && b.x + b.w > o.x && b.y < o.y + o.h && b.y + b.h > o.y);
        let box: Box | null = null;
        for (const dy of [0, -h0 - 4, h0 + 6, -2 * h0 - 8, 2 * h0 + 10]) {
          const top = pr.y - Math.min(span * 0.18, 40) - size - 4 + dy;
          const b = { x: pr.x - total / 2 - 6, y: top, w: w0, h: h0 };
          if (!inFree(b.x, b.y) || !inFree(b.x + b.w, b.y + b.h) || hitsUi(b)) continue;
          if (clearOf(b)) {
            box = b;
            break;
          }
          box ??= b;
        }
        if (!box) return;
        const cyTop = box.y + 4;
        if (alpha > 0.25) blocked.push(box);
        this.groupBoxes.push({ gi, box });
        const col = lay.dim === "types" ? tk.text : (stage.nebulae[gi]?.color ?? tk.text);
        const colT = tk.light ? mixHex(col, tk.text, 0.55) : col;
        const x0 = pr.x - total / 2;
        const baseY = cyTop + size;
        ctx.globalAlpha = Math.min(1, alpha * (hot ? 1.2 : 1));
        if (hot) {
          ctx.strokeStyle = rgba(colT, 0.6);
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(x0, baseY + 5);
          ctx.lineTo(x0 + total, baseY + 5);
          ctx.stroke();
        }
        if (glyphW) {
          ctx.strokeStyle = colT;
          strokeGlyph(ctx, book.glyph(g.key as never), x0 + size / 2, baseY - size * 0.36, size);
        }
        ctx.textAlign = "left";
        ctx.font = font;
        outline(text, x0 + glyphW, baseY, colT, alpha);
        ctx.font = cfont;
        outline(count, x0 + glyphW + tw + 7, baseY, tk.dim, alpha);
      });
      ctx.globalAlpha = 1;
    }

    /* guide labels: time ticks, link bands */
    if (lay && (lay.dim === "time" || lay.dim === "links") && egoMix < 0.95) {
      const font = `500 12px ${tk.body}`;
      ctx.font = font;
      ctx.textAlign = "center";
      lay.guides.forEach((g, gi) => {
        const text = stage.guideText[gi];
        if (!text || !g.labelAt) return;
        const pr = this.projectPoint(stage, g.labelAt.x, g.labelAt.y, g.labelAt.z);
        if (!pr || !inFree(pr.x, pr.y)) return;
        const tw = this.width(font, text);
        const box = { x: pr.x - tw / 2 - 3, y: pr.y - 11, w: tw + 6, h: 15 };
        for (const b of blocked)
          if (box.x < b.x + b.w && box.x + box.w > b.x && box.y < b.y + b.h && box.y + box.h > b.y) return;
        blocked.push(box);
        const a = (1 - egoMix) * (g.strong ? 1 : clamp(0.65 + pr.s * 0.3, 0.65, 1));
        ctx.globalAlpha = a;
        outline(text, pr.x, pr.y, g.strong || lay.dim === "links" ? tk.agentText : tk.text, a);
      });
      ctx.globalAlpha = 1;
    }

    /* stars: candidates by priority, placed without collisions */
    const budget = ego
      ? Math.round(clamp((bounds.w * bounds.h) / 6500, 6, 60))
      : labelBudget(level, bounds.w * bounds.h);
    const roomy = bounds.h > 260;
    const asks: LabelAsk[] = [];
    const draws = new Map<number, Omit<LabelDraw, "box">>();
    for (const i of this.order) {
      const hop = ego?.hop.get(i);
      if (!this.hit[i] && hop === undefined) continue;
      if (stage.alpha[i]! < 0.5) continue;
      const pointed = i === stage.hoverIdx;
      // The star under the cursor speaks through its card.
      if (pointed) continue;
      if (hop === undefined && nearFade(this.pd[i]!) < 0.5) continue;
      if (ego && hop === undefined && !pointed && !(stage.termLit?.has(i) ?? false)) continue;
      let pri = -1;
      if (pointed) pri = -1;
      else if (i === focus || i === stage.selIdx || hop === 0 || i === stage.peekIdx) pri = 0;
      else if (hop === 1 || (near?.has(i) ?? false) || (grp !== null && grp.has(i) && m.hub[i])) pri = 1;
      else if ((stage.highlight?.has(i) && stage.labelHighlight) || stage.termLit?.has(i)) pri = 2;
      else if (lit(i) && stage.hoverEdge >= 0) pri = 0;
      else if (hop === 2) pri = 3;
      // With something lit (an area, a search, a lens), only its stars may speak.
      else if ((!quiet || lit(i)) && m.hub[i] && lw.hubs > 0.25 && this.ps[i]! > 0.45) pri = 3;
      else if ((!quiet || lit(i)) && lw.notes > 0.15 && this.ps[i]! > 0.85) pri = 4;
      else continue;
      const centre = hop === 0;
      const px = labelPx(pri < 0 ? 0 : pri, this.ps[i]!);
      const tfont = centre ? `600 ${px}px ${tk.display}` : `${pri <= 0 ? 600 : 500} ${px}px ${tk.body}`;
      const title = this.fit(tfont, m.label[i]!, centre ? 320 : pri <= 0 ? 280 : 220);
      const tw = this.width(tfont, title);
      const r = this.hit[i] ? this.hr[i]! : starR(i);
      const glyph = r < GLYPH_INSIDE_PX + 2;
      const gw = glyph ? Math.round(px) + 4 : 0;
      const wantExcerpt =
        !centre &&
        !pointed &&
        roomy &&
        ((hop === 1 && (ego?.hop1.length ?? 0) <= 8) ||
          (pri === 4 && lw.excerpts > 0.5 && this.ps[i]! > 1.9));
      let ex = "";
      if (wantExcerpt) {
        const raw = stage.excerpt(i);
        if (raw === undefined) stage.need(i);
        else ex = raw;
      }
      const efont = `400 12px ${tk.body}`;
      const exText = ex ? this.fit(efont, ex, 230) : "";
      const ew = exText ? this.width(efont, exText) : 0;
      const bw = Math.ceil(Math.max(tw + gw, ew)) + 6;
      const lh = Math.round(px * 1.25);
      const bh = lh + (exText ? 14 : 0);
      // Previously shown labels hold their place (no flicker as the sky turns); only the
      // star under the cursor (pri −1) is placed whatever it collides with.
      const rank = pri * 2 + (this.shown[i] ? 0 : 1);
      // The note you are in wears a reticle: its name goes outside it.
      const ringed = i === (ego ? ego.centre : stage.selIdx);
      asks.push({
        id: i,
        pri: rank,
        x: this.px[i]!,
        y: this.py[i]!,
        r: ringed ? r + 13 : r * 0.8,
        w: bw,
        h: bh,
      });
      draws.set(i, {
        i,
        title,
        font: tfont,
        px,
        glyph,
        ex: exText,
        pri,
        alpha: pri >= 3 ? clamp((this.ps[i]! - 0.35) * 1.5, 0.5, 0.9) * (pri === 4 ? lw.notes : 1) : 1,
      });
    }
    // Nearer first within a priority (the order is far → near).
    asks.sort((a, b) => a.pri - b.pri || this.pd[a.id]! - this.pd[b.id]!);
    const placed = placeLabels(asks, { blocked, bounds, max: budget, gap: 5 });
    const now = new Set<number>();
    const kf = stage.reduced ? 1 : Math.min(1, dt * 7);
    for (const p of placed) {
      const d = draws.get(p.id)!;
      now.add(p.id);
      this.labA[p.id] = Math.min(1, this.labA[p.id]! + kf * (1 - this.labA[p.id]!) + 0.02);
      const a =
        d.alpha * this.labA[p.id]! * (ego?.hop.has(p.id) ? 1 : clamp(depthFade(this.pd[p.id]!) + 0.2, 0, 1));
      if (a < 0.02) continue;
      const i = p.id;
      const { box } = p;
      const centreX = box.x + box.w / 2;
      const lh = Math.round(d.px * 1.25);
      const baseY = box.y + lh - Math.round(d.px * 0.3);
      const tw = this.width(d.font, d.title);
      const gw = d.glyph ? Math.round(d.px) + 4 : 0;
      const left =
        p.side === "right"
          ? box.x + 3
          : p.side === "left"
            ? box.x + box.w - 3 - (tw + gw)
            : centreX - (tw + gw) / 2;
      ctx.globalAlpha = a;
      if (d.glyph) {
        ctx.strokeStyle = tk.light ? mixHex(m.color[i]!, tk.text, 0.45) : m.color[i]!;
        strokeGlyph(ctx, book.glyph(m.kind[i]!), left + d.px / 2, baseY - d.px * 0.36, d.px);
      }
      ctx.font = d.font;
      ctx.textAlign = "left";
      const fill = d.pri <= 0 || (d.pri === 1 && ego) ? tk.text : d.pri <= 2 ? tk.agentText : tk.dim;
      outline(d.title, left + gw, baseY, fill, a);
      if (d.ex) {
        const efont = `400 12px ${tk.body}`;
        ctx.font = efont;
        const ew = this.width(efont, d.ex);
        const ex0 =
          p.side === "right" ? box.x + 3 : p.side === "left" ? box.x + box.w - 3 - ew : centreX - ew / 2;
        outline(d.ex, ex0, baseY + 14, tk.faint, a);
      }
    }
    for (let i = 0; i < this.shown.length; i++) {
      if (this.shown[i] && !now.has(i)) this.labA[i] = 0;
      this.shown[i] = now.has(i) ? 1 : 0;
    }
    ctx.globalAlpha = 1;
    ctx.textAlign = "center";
  }

  private projectPoint(
    stage: Stage,
    x0: number,
    y0: number,
    z0: number,
  ): { x: number; y: number; s: number; d: number } | null {
    const cam = stage.cam;
    const x = x0 - cam.tx;
    const y = y0 - cam.ty;
    const z = z0 - cam.tz;
    const cy = Math.cos(cam.yaw);
    const sy = Math.sin(cam.yaw);
    const x1 = x * cy - z * sy;
    const z1 = x * sy + z * cy;
    const cp = Math.cos(cam.pitch);
    const sp = Math.sin(cam.pitch);
    const y1 = y * cp - z1 * sp;
    const z2 = y * sp + z1 * cp;
    const d = z2 + cam.dist;
    if (d < NEAR) return null;
    const s = this.view.focal / d;
    return { x: this.view.cx + x1 * s, y: this.view.cy + y1 * s, s, d };
  }
}
