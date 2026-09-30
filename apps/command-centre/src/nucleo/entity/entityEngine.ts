/**
 * Runs the entity: owns the WebGL body and the HUD, glides the state params,
 * listens to the voice line (typing) and the reply stream (speaking), and
 * keeps the activity satellites. The loop only runs while the entity is on
 * screen and the tab is visible; economy caps it at ~12 fps and reduced
 * motion draws one still frame per change.
 */
import type { CoreState } from "../../desktop/coreState";
import { TYPING_EVENT } from "../CoreOrb";
import { EntityGl, newFrame, type EntityFrame } from "./entityGl";
import { EntityHud, css, type HudFrame, type HudPalette, type Satellite } from "./entityHud";
import {
  GEOMETRY,
  SATELLITE_TTL,
  SHOCK_DURATION,
  TOOL_PULSE_EVERY,
  TYPING_KICK,
  approach,
  assignSlots,
  frameInterval,
  luminance,
  paramsOf,
  parseColour,
  renderDpr,
  shellCount,
  shortLabel,
  speakKick,
  stateKick,
  stepParams,
  STATE_PARAMS,
  waitPulse,
  type EntityActivity,
  type EntityParams,
  type EntityVariant,
  type Rgb,
} from "./entityParams";

/** Fired on `window` while reply text streams; `detail.chars` is the burst size. */
export const SPEAK_EVENT = "mordomo:speak";

export interface EngineOptions {
  variant: EntityVariant;
  economy: boolean;
}

const MAX_SATS = 8;

let colourCtx: CanvasRenderingContext2D | null = null;
/** Resolves any CSS colour (hex, rgb(), color-mix, named) to 0..1 channels. */
function resolveColour(value: string, fallback: Rgb): Rgb {
  const v = value.trim();
  if (!v) return fallback;
  const direct = parseColour(v);
  if (direct) return direct;
  if (!colourCtx) colourCtx = document.createElement("canvas").getContext("2d");
  if (!colourCtx) return fallback;
  colourCtx.fillStyle = "#000000";
  colourCtx.fillStyle = v;
  return parseColour(String(colourCtx.fillStyle)) ?? fallback;
}

interface Palette {
  light: boolean;
  agent: Rgb;
  sys: Rgb;
  warn: Rgb;
  danger: Rgb;
  ok: Rgb;
  hud: HudPalette;
}

function readPalette(): Palette {
  const root = document.documentElement;
  const cs = getComputedStyle(root);
  const get = (name: string, fb: Rgb) => resolveColour(cs.getPropertyValue(name), fb);
  const bg = get("--bg", [0.043, 0.039, 0.031]);
  const light = luminance(bg) > 0.4;
  const agent = get("--agent", [0.133, 0.827, 0.933]);
  const sys = get("--accent", [0.976, 0.451, 0.086]);
  const warn = get("--warn", [0.984, 0.749, 0.141]);
  const danger = get("--danger", [0.973, 0.443, 0.443]);
  const ok = get("--ok", [0.29, 0.871, 0.502]);
  const faint = get("--text-faint", light ? [0.43, 0.4, 0.34] : [0.56, 0.53, 0.45]);
  const dim = get("--text-dim", light ? [0.3, 0.28, 0.24] : [0.72, 0.69, 0.62]);
  const fs0 = parseFloat(cs.getPropertyValue("--fs-0")) || 10;
  const mono =
    cs.getPropertyValue("--font-mono").trim() ||
    '"JetBrains Mono", "SF Mono", ui-monospace, Menlo, monospace';
  return {
    light,
    agent,
    sys,
    warn,
    danger,
    ok,
    hud: {
      light,
      agent: css(agent),
      sys: css(sys),
      warn: css(warn),
      danger: css(danger),
      ok: css(ok),
      faint: css(faint),
      dim: css(dim),
      plate: css(bg),
      fs0,
      mono,
    },
  };
}

function setRgb(dst: Float32Array, c: Rgb): void {
  dst[0] = c[0];
  dst[1] = c[1];
  dst[2] = c[2];
}

/** Column-major rotation of `angle` around a fixed tilted axis, in place. */
const AXIS = (() => {
  const x = 0.28;
  const y = 0.95;
  const z = 0.14;
  const l = Math.hypot(x, y, z);
  return [x / l, y / l, z / l] as const;
})();
function rotate(m: Float32Array, angle: number): void {
  const [x, y, z] = AXIS;
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const t = 1 - c;
  m[0] = t * x * x + c;
  m[1] = t * x * y + s * z;
  m[2] = t * x * z - s * y;
  m[3] = t * x * y - s * z;
  m[4] = t * y * y + c;
  m[5] = t * y * z + s * x;
  m[6] = t * x * z + s * y;
  m[7] = t * y * z - s * x;
  m[8] = t * z * z + c;
}

export class EntityEngine {
  private readonly gl: EntityGl;
  private readonly hud: EntityHud;
  private readonly wrap: HTMLElement;
  private readonly glCanvas: HTMLCanvasElement;
  private readonly hudCanvas: HTMLCanvasElement;
  private readonly variant: EntityVariant;
  private readonly economy: boolean;
  private readonly reduced: boolean;
  private readonly onLost: () => void;

  private state: CoreState = "idle";
  private readonly cur: EntityParams = paramsOf("idle");
  private readonly frame: EntityFrame = newFrame();
  private readonly hf: HudFrame = {
    time: 0,
    spinA: 0,
    spinB: 0,
    spinText: 0,
    scan: 0,
    scanPhase: 0,
    warm: 0,
    wait: 0,
    waitPulse: 0,
    speak: 0,
    speakPhase: 0,
    typing: 0,
    shockProgress: 1,
    shockAmp: 0,
    shockOk: false,
    dim: 1,
    energy: 1,
    coreScale: 1,
  };
  private pal: Palette;

  // Clocks and integrated phases (integrated so a speed change never jumps).
  private time = 0;
  private rotAngle = 0;
  private breathePhase = 0;
  private typing = 0;
  private speak = 0;
  private speakLevel = 0;
  private lastSpeak = -10;
  private pulse = 1;
  private toolTimer = 0;
  private shockProgress = 1;
  private shockAmp = 0;
  private dimKick = 0;

  private readonly sats: Satellite[] = [];
  private satCount = 0;
  private slots = new Map<string, number>();
  private seen = new Map<string, number>();

  private raf = 0;
  private last = 0;
  private lastDraw = 0;
  private onScreen = true;
  private running = false;
  private disposed = false;
  private size = 0;

  private readonly io: IntersectionObserver | null;
  private readonly ro: ResizeObserver | null;
  private readonly mo: MutationObserver;

  private constructor(
    gl: EntityGl,
    hud: EntityHud,
    wrap: HTMLElement,
    glCanvas: HTMLCanvasElement,
    hudCanvas: HTMLCanvasElement,
    opts: EngineOptions,
    onLost: () => void,
  ) {
    this.gl = gl;
    this.hud = hud;
    this.wrap = wrap;
    this.glCanvas = glCanvas;
    this.hudCanvas = hudCanvas;
    this.variant = opts.variant;
    this.economy = opts.economy;
    this.onLost = onLost;
    this.reduced =
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    this.pal = readPalette();
    this.applyPalette();

    window.addEventListener(TYPING_EVENT, this.onTyping);
    window.addEventListener(SPEAK_EVENT, this.onSpeak);
    document.addEventListener("visibilitychange", this.onVisibility);
    glCanvas.addEventListener("webglcontextlost", this.onContextLost);
    this.mo = new MutationObserver(this.onTheme);
    this.mo.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme", "style", "class"],
    });
    this.io =
      typeof IntersectionObserver === "function"
        ? new IntersectionObserver((entries) => {
            this.onScreen = entries.some((e) => e.isIntersecting);
            this.schedule();
          })
        : null;
    this.io?.observe(wrap);
    this.ro = typeof ResizeObserver === "function" ? new ResizeObserver(() => this.resize()) : null;
    this.ro?.observe(wrap);
    this.resize();
  }

  /** Creates the engine, or null when WebGL2 is unavailable (render the 2D fallback). */
  static create(
    wrap: HTMLElement,
    glCanvas: HTMLCanvasElement,
    hudCanvas: HTMLCanvasElement,
    opts: EngineOptions,
    onLost: () => void,
  ): EntityEngine | null {
    const gl = EntityGl.create(glCanvas);
    if (!gl) return null;
    let hud: EntityHud;
    try {
      hud = new EntityHud(hudCanvas, opts.variant);
    } catch {
      gl.dispose();
      return null;
    }
    return new EntityEngine(gl, hud, wrap, glCanvas, hudCanvas, opts, onLost);
  }

  /* ---- Inputs ------------------------------------------------------------ */

  setState(next: CoreState, immediate = false): void {
    const prev = this.state;
    this.state = next;
    if (immediate) {
      Object.assign(this.cur, STATE_PARAMS[next]);
    }
    const kick = stateKick(immediate ? next : prev, next);
    if (kick.shock) {
      this.shockProgress = 0;
      this.shockAmp = 1;
      const c = kick.shock === "ok" ? this.pal.ok : this.pal.danger;
      setRgb(this.frame.shock, c);
      this.hf.shockOk = kick.shock === "ok";
    }
    if (kick.dim) this.dimKick = 1;
    if (kick.pulse) {
      this.pulse = 0;
      this.toolTimer = 0;
    }
    if (this.reduced) {
      Object.assign(this.cur, STATE_PARAMS[next]);
      // One still frame per state: the flash shown mid-way, nothing carried over.
      if (kick.shock) this.shockProgress = 0.3;
      else this.shockAmp = 0;
      this.pulse = kick.pulse ? 0.35 : 1;
      this.dimKick = kick.dim ? 1 : 0;
      this.render();
    }
    this.schedule();
  }

  setWord(word: string): void {
    this.hud.setWord(word);
    if (!this.running) this.render();
  }

  setActivity(list: readonly EntityActivity[]): void {
    if (this.variant !== "hero") return;
    const now = Date.now();
    const recent = list.slice(-MAX_SATS);
    let fresh = false;
    const nextSeen = new Map<string, number>();
    for (const a of recent) {
      const known = this.seen.get(a.id);
      if (known !== undefined) {
        nextSeen.set(a.id, known);
        continue;
      }
      const ageAtSight = (now - a.at) / 1000;
      if (ageAtSight > SATELLITE_TTL) continue;
      // Fresh items are born now (with a spark); older ones keep their age.
      const born = ageAtSight < 2 ? this.time : this.time - ageAtSight;
      nextSeen.set(a.id, born);
      if (ageAtSight < 2) fresh = true;
    }
    this.seen = nextSeen;
    const ids = recent.filter((a) => nextSeen.has(a.id)).map((a) => a.id);
    this.slots = assignSlots(ids, this.slots);
    this.satCount = 0;
    for (const a of recent) {
      const born = nextSeen.get(a.id);
      if (born === undefined) continue;
      const label = shortLabel(a.label).toUpperCase();
      this.sats[this.satCount++] = {
        id: a.id,
        kind: a.kind,
        label,
        born,
        slot: this.slots.get(a.id) ?? 0,
      };
    }
    if (fresh && this.pulse >= 1) this.pulse = 0;
    if (this.reduced) this.render();
    this.schedule();
  }

  private readonly onTyping = (): void => {
    this.typing = Math.min(1, this.typing + TYPING_KICK);
    this.schedule();
  };

  private readonly onSpeak = (e: Event): void => {
    const chars = (e as CustomEvent<{ chars?: number } | undefined>).detail?.chars ?? 12;
    this.speakLevel = Math.max(this.speakLevel, speakKick(chars));
    this.lastSpeak = this.time;
    this.schedule();
  };

  private readonly onVisibility = (): void => this.schedule();

  private readonly onContextLost = (e: Event): void => {
    e.preventDefault();
    this.onLost();
  };

  private readonly onTheme = (): void => {
    this.pal = readPalette();
    this.applyPalette();
    if (!this.running) this.render();
  };

  private applyPalette(): void {
    const p = this.pal;
    setRgb(this.frame.body, p.agent);
    setRgb(this.frame.sys, p.sys);
    setRgb(this.frame.warn, p.warn);
    setRgb(this.frame.shock, this.hf.shockOk ? p.ok : p.danger);
    this.frame.light = p.light ? 1 : 0;
    this.hud.setPalette(p.hud);
  }

  private resize(): void {
    const w = this.wrap.clientWidth;
    const h = this.wrap.clientHeight;
    const size = Math.min(w, h);
    if (size <= 0) return;
    this.size = size;
    const dpr = renderDpr(this.variant, size, window.devicePixelRatio || 1);
    this.gl.setSize(w * dpr, h * dpr);
    this.hud.setMetrics(this.hudCanvas.clientWidth || w, this.hudCanvas.clientHeight || h, size, dpr);
    const g = GEOMETRY[this.variant];
    this.frame.coreRadius = g.core;
    this.frame.orbital = g.orbital;
    this.frame.steps = shellCount(this.variant, size);
    this.frame.detail = this.variant === "iris" ? 1.05 : 1.55;
    if (!this.running) this.render();
  }

  /* ---- Loop -------------------------------------------------------------- */

  private schedule(): void {
    const want = !this.disposed && !this.reduced && this.onScreen && !document.hidden;
    if (want && !this.running) {
      this.running = true;
      this.last = performance.now();
      this.raf = requestAnimationFrame(this.tick);
    } else if (!want && this.running) {
      this.running = false;
      cancelAnimationFrame(this.raf);
    }
  }

  private readonly tick = (now: number): void => {
    if (!this.running) return;
    this.raf = requestAnimationFrame(this.tick);
    const interval = frameInterval(this.economy);
    if (interval > 0 && now - this.lastDraw < interval - 2) return;
    this.lastDraw = now;
    const dt = Math.min(0.1, Math.max(0, (now - this.last) / 1000));
    this.last = now;
    this.update(dt);
    this.render();
  };

  /** Advances every clock and glide by `dt` seconds. */
  update(dt: number): void {
    const c = this.cur;
    this.time += dt;
    stepParams(c, STATE_PARAMS[this.state], dt);
    const f = this.frame;
    const h = this.hf;
    f.flowPhase += dt * c.flow;
    f.cometPhase += dt * c.comet;
    f.scanPhase += dt * (0.8 + 1.2 * c.scan);
    this.rotAngle += dt * c.spin;
    this.breathePhase += dt * c.breathe;
    h.spinA += dt * (0.05 + 0.45 * c.hudSpin);
    h.spinB -= dt * (0.015 + 0.12 * c.hudSpin);
    h.spinText += dt * (0.01 + 0.035 * c.hudSpin);
    f.ripplePhase += dt * 9;

    this.typing = Math.max(0, this.typing - dt * 1.3);
    // Voice: bursts from the stream; a gentle synthetic voice if the stream is quiet.
    this.speakLevel = approach(this.speakLevel, 0, dt, 0.22);
    let level = this.speakLevel;
    if (c.voice > 0.05 && this.time - this.lastSpeak > 0.5) {
      const s = Math.abs(Math.sin(this.time * 4.1) * Math.sin(this.time * 1.7 + 0.6));
      level = Math.max(level, c.voice * (0.22 + 0.3 * s));
    }
    this.speak = approach(this.speak, level, dt, level > this.speak ? 0.05 : 0.14);
    const syll = 0.82 + 0.18 * Math.sin(this.time * 19) * Math.sin(this.time * 7.3);
    const speak = this.speak * syll;
    f.speakPhase += dt * (4.5 + 9 * this.speak);

    // Tool: a discrete pulse every TOOL_PULSE_EVERY seconds.
    if (this.state === "tool") {
      this.toolTimer += dt;
      if (this.toolTimer >= TOOL_PULSE_EVERY) {
        this.toolTimer = 0;
        this.pulse = 0;
      }
    }
    if (this.pulse < 1) this.pulse = Math.min(1, this.pulse + dt / 0.85);
    if (this.shockAmp > 0) {
      this.shockProgress += dt / SHOCK_DURATION;
      if (this.shockProgress >= 1) {
        this.shockProgress = 1;
        this.shockAmp = 0;
      }
    }
    this.dimKick = approach(this.dimKick, 0, dt, 0.7);

    const wp = waitPulse(this.time);
    f.time = this.time;
    f.energy = c.energy * (1 + c.wait * 0.45 * wp);
    f.filaments = c.filaments;
    f.typing = this.typing;
    f.speak = speak;
    f.scan = c.scan;
    f.ring = c.ring * (1 + c.wait * 0.6 * wp);
    f.pulse = this.pulse;
    f.dim = 1 - 0.5 * this.dimKick;
    f.shockProgress = this.shockProgress;
    f.shockAmp = this.shockAmp;
    f.wait = c.wait;
    f.breathe = Math.sin(this.breathePhase);
    f.warm = c.warm;
    f.turbulence = c.turbulence;
    f.tool = this.state === "tool" ? 1 : 0;
    f.listening = this.state === "listening" ? 1 : 0;
    rotate(f.rot, this.rotAngle);

    h.time = this.time;
    h.scan = c.scan;
    h.scanPhase = f.scanPhase;
    h.warm = c.warm;
    h.wait = c.wait;
    h.waitPulse = wp;
    h.speak = speak;
    h.speakPhase = f.speakPhase;
    h.typing = this.typing;
    h.shockProgress = this.shockProgress;
    h.shockAmp = this.shockAmp;
    h.dim = f.dim;
    h.energy = f.energy;
    h.coreScale = 1 + 0.05 * speak;

    // Retire satellites past their life.
    if (this.satCount > 0) {
      let n = 0;
      for (let i = 0; i < this.satCount; i++) {
        const s = this.sats[i]!;
        if (this.time - s.born < SATELLITE_TTL) this.sats[n++] = s;
      }
      this.satCount = n;
    }
  }

  render(): void {
    if (this.disposed || this.size <= 0) return;
    if (this.reduced || !this.running) {
      // Keep derived values coherent for still frames.
      if (this.frame.time === 0) this.update(0);
    }
    this.gl.draw(this.frame);
    this.hud.draw(this.hf, this.sats, this.satCount);
  }

  /** For benchmarks: draws `n` frames synchronously and returns ms per frame. */
  benchmark(n: number): number {
    this.gl.finish();
    const t0 = performance.now();
    for (let i = 0; i < n; i++) {
      this.update(1 / 60);
      this.gl.draw(this.frame);
      this.hud.draw(this.hf, this.sats, this.satCount);
      this.gl.finish();
    }
    return (performance.now() - t0) / n;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.running = false;
    cancelAnimationFrame(this.raf);
    window.removeEventListener(TYPING_EVENT, this.onTyping);
    window.removeEventListener(SPEAK_EVENT, this.onSpeak);
    document.removeEventListener("visibilitychange", this.onVisibility);
    this.glCanvas.removeEventListener("webglcontextlost", this.onContextLost);
    this.mo.disconnect();
    this.io?.disconnect();
    this.ro?.disconnect();
    this.gl.dispose();
  }
}
