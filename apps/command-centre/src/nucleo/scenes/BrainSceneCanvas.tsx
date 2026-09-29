/**
 * The Brain scene's sky (immersive shell): a full-screen canvas the painter
 * (`brainPaint.ts`) draws into, plus everything a hand does to it — flying
 * through space, not scrolling a picture:
 *
 * - drag orbits around the focus; right-drag, Shift+drag or two fingers pan;
 *   the wheel or a pinch dollies towards the point under the cursor; every
 *   motion glides after the hand lets go and settles;
 * - close enough to a star, scrolling on dives into it (its synapses become
 *   the space); inside a note, scrolling far enough out leaves it;
 * - a click opens the star under the cursor, a double click dives to it (on
 *   empty space: frames everything); an area's name flies to the area; a link
 *   frames the two notes it joins;
 * - keys: W A S D / arrows fly, Q / E rise and sink, Shift+arrows orbit,
 *   + / − dolly, 0 home, F frames the selection, Enter dives.
 *
 * Hovering a star swells it, lights its synapses and fires them, and a card
 * follows the cursor with what it is; hovering a link says what joins the
 * two notes; hovering an area's name lights the whole area.
 *
 * The loop reads the shared `Stage` and never touches React state. It stops
 * when nothing moves (always under reduced motion and the economy profile,
 * which also caps it at 30 fps and turns every glide into a cut) and while
 * the tab is hidden.
 */
import { useEffect, useRef } from "react";
import {
  dollyBy,
  DAMPING,
  flyThrust,
  orbitBy,
  panBy,
  panVelocity,
  stopVel,
  type FlyInput,
} from "./brainCamera";
import { GLYPHS, type ContentKind } from "./brainGlyphs";
import { releaseVelocity } from "./brainPick";
import { clamp, unproject, type Vec3 } from "./brainSpace";
import { distLimits, flyFit, posOf, syncFrame, zoomCeil, zoomFloor, type Stage } from "./brainStage";
import { IDLE_AFTER_MS, Painter, type Tokens, type Words } from "./brainPaint";
import { SpriteBook } from "./brainSprites";

export interface StarCard {
  title: string;
  kind: ContentKind;
  /** Area (or folder) · type · age. */
  meta: string;
  excerpt?: string;
  /** Its line of text is still being read (the card fills it in when it arrives). */
  pending?: boolean;
  /** "N links". */
  links: string;
}

export interface EdgeCard {
  title: string;
  kind: string;
  why: string;
}

export interface GroupCard {
  title: string;
  meta: string;
}

export interface CanvasWords extends Words {
  /** "click to open · double click to dive". */
  starHint: string;
  /** "click to frame both". */
  edgeHint: string;
  /** "click to fly there". */
  groupHint: string;
}

export interface BrainSceneCanvasProps {
  stage: Stage;
  onPick: (index: number) => void;
  onEmpty: () => void;
  /** Double click on a star: open it and fly close. */
  onDive: (index: number) => void;
  /** Double click on empty space, 0 / Home: frame everything (inside a note: its space). */
  onHome: () => void;
  /** F: frame the selection (or what is under the cursor). */
  onFrame: () => void;
  /** An area's name: fly to the area. */
  onGroup: (group: number) => void;
  describe: (index: number) => StarCard;
  describeEdge: (edge: number) => EdgeCard | null;
  describeGroup: (group: number) => GroupCard | null;
  /** The hand did something in the sky (the navigation help may step aside). */
  onInteract?: () => void;
  words: CanvasWords;
  label: string;
  describedBy?: string;
}

const DRAG_PX = 4;
/** Wheel travel (px of deltaY) spent pushing past a limit before it dives in or leaves. */
const PUSH = 220;
const ORBIT_X = 0.0055;
const ORBIT_Y = 0.0045;
const DOUBLE_MS = 320;

const FLY_KEYS: Record<string, Partial<FlyInput>> = {
  KeyW: { forward: 1 },
  ArrowUp: { forward: 1 },
  KeyS: { forward: -1 },
  ArrowDown: { forward: -1 },
  KeyA: { right: -1 },
  ArrowLeft: { right: -1 },
  KeyD: { right: 1 },
  ArrowRight: { right: 1 },
  KeyQ: { up: 1 },
  KeyE: { up: -1 },
};

function readTokens(el: Element): Tokens {
  const probe = document.createElement("canvas").getContext("2d");
  const toHex = (css: string, fallback: string): string => {
    if (!probe || !css.trim()) return fallback;
    probe.fillStyle = fallback;
    probe.fillStyle = css.trim();
    const v = String(probe.fillStyle);
    if (v.startsWith("#")) return v;
    const m = /rgba?\(([^)]+)\)/.exec(v);
    if (!m) return fallback;
    const [r = 0, g = 0, b = 0] = m[1]!.split(",").map((x) => Math.round(parseFloat(x)));
    return `#${[r, g, b].map((c) => c.toString(16).padStart(2, "0")).join("")}`;
  };
  const cs = getComputedStyle(el);
  const v = (name: string) => cs.getPropertyValue(name);
  const bg = toHex(v("--bg"), "#0b0a08");
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(bg.slice(i, i + 2), 16) / 255) as [number, number, number];
  return {
    light: 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.5,
    bg,
    text: toHex(v("--text"), "#f2eee3"),
    dim: toHex(v("--text-dim"), "#b3aa96"),
    faint: toHex(v("--text-faint"), "#8f8672"),
    agent: toHex(v("--agent"), "#22d3ee"),
    agentText: toHex(v("--agent-text"), "#67e8f9"),
    accent: toHex(v("--accent-text"), "#fbbf24"),
    display: v("--font-display").trim() || "sans-serif",
    body: v("--font").trim() || "sans-serif",
    mono: v("--font-mono").trim() || "monospace",
  };
}

export function BrainSceneCanvas(props: BrainSceneCanvasProps) {
  const { stage, label, describedBy } = props;
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const cb = useRef(props);
  cb.current = props;

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    const card = cardRef.current;
    let tk = readTokens(canvas);
    const book = new SpriteBook(tk);
    const painter = new Painter(ctx, book, tk);
    const still = () => stage.reduced || stage.economy;
    // Development builds expose the painter for the visual checks.
    if (import.meta.env.DEV) (window as unknown as { __brainPainter?: unknown }).__brainPainter = painter;

    /* ---- size: the layout size, never the transformed one (the scene may be mid-zoom) ---- */
    let dpr = 1;
    const resize = () => {
      dpr = stage.economy ? 1 : Math.min(2, window.devicePixelRatio || 1);
      painter.w = Math.max(1, canvas.clientWidth);
      painter.h = Math.max(1, canvas.clientHeight);
      canvas.width = Math.round(painter.w * dpr);
      canvas.height = Math.round(painter.h * dpr);
      stage.viewport = { w: painter.w, h: painter.h };
      syncFrame(stage);
      schedule();
    };

    /* ---- the loop ---- */
    let raf = 0;
    let last = performance.now();
    let lastDraw = 0;
    let idleTimer = 0;
    const frame = (now: number) => {
      raf = 0;
      const interacting = stage.dragging || stage.flight !== null || now - stage.lastInput < 1200;
      const minGap = stage.economy ? 33 : interacting || stage.morph ? 0 : 30;
      if (now - lastDraw < minGap - 1) {
        schedule();
        return;
      }
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      lastDraw = now;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const t0 = performance.now();
      const busy = painter.frame(stage, now, dt, cb.current.words);
      const ms = performance.now() - t0;
      stage.stats.ms = stage.stats.frames === 0 ? ms : stage.stats.ms * 0.94 + ms * 0.06;
      stage.stats.frames++;
      // The sky moved under a still cursor: what is under it may have changed.
      if (busy && stage.pointer && !stage.dragging) hoverAt(stage.pointer, false);
      refreshCard();
      const spinning = !still() && !stage.dragging && now - stage.lastInput > IDLE_AFTER_MS;
      if (busy || spinning || stage.dragging) schedule();
      else if (!still()) {
        // Quiet only until the idle pause is over: then the sky starts turning.
        window.clearTimeout(idleTimer);
        idleTimer = window.setTimeout(schedule, Math.max(50, IDLE_AFTER_MS - (now - stage.lastInput) + 20));
      }
    };
    function schedule() {
      if (raf || document.hidden) return;
      raf = requestAnimationFrame(frame);
    }
    stage.wake = schedule;
    const onVisibility = () => {
      if (document.hidden) {
        cancelAnimationFrame(raf);
        raf = 0;
        held.clear();
        applyFly();
      } else {
        last = performance.now();
        schedule();
      }
    };
    document.addEventListener("visibilitychange", onVisibility);
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);
    resize();
    const mo = new MutationObserver(() => {
      tk = readTokens(canvas);
      painter.tk = tk;
      book.setTheme(tk);
      schedule();
    });
    mo.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme", "data-preset", "style"],
    });

    /* ---- the hover card ---- */
    const part = <T extends Element>(sel: string) => card?.querySelector<T>(sel) ?? null;
    const cardParts = {
      glyph: part<SVGPathElement>(".bs-card-glyph path"),
      title: part<HTMLElement>(".bs-card-title"),
      meta: part<HTMLElement>(".bs-card-meta"),
      excerpt: part<HTMLElement>(".bs-card-excerpt"),
      links: part<HTMLElement>(".bs-card-links"),
      hint: part<HTMLElement>(".bs-card-hint"),
    };
    let cardKey = "";
    let cardPending = false;
    let cardAt = { x: 0, y: 0 };
    let cardSize = { w: 0, h: 0 };
    const fillCard = (key: string) => {
      if (!card || key === cardKey) return;
      cardKey = key;
      if (!key) {
        delete card.dataset.on;
        return;
      }
      const [kind, raw] = key.split(":") as [string, string];
      const n = Number(raw);
      const set = (el: HTMLElement | null, text: string) => {
        if (el) el.textContent = text;
      };
      const words = cb.current.words;
      cardPending = false;
      if (kind === "s") {
        const d = cb.current.describe(n);
        cardPending = Boolean(d.pending);
        card.dataset.mode = "star";
        cardParts.glyph?.setAttribute("d", GLYPHS[d.kind]);
        set(cardParts.title, d.title);
        set(cardParts.meta, d.meta);
        set(cardParts.excerpt, d.excerpt ?? "");
        set(cardParts.links, d.links);
        set(cardParts.hint, words.starHint);
      } else if (kind === "e") {
        const d = cb.current.describeEdge(n);
        if (!d) return fillCard("");
        card.dataset.mode = "edge";
        set(cardParts.title, d.title);
        set(cardParts.meta, d.kind);
        set(cardParts.excerpt, d.why);
        set(cardParts.links, "");
        set(cardParts.hint, words.edgeHint);
      } else {
        const d = cb.current.describeGroup(n);
        if (!d) return fillCard("");
        card.dataset.mode = "group";
        set(cardParts.title, d.title);
        set(cardParts.meta, d.meta);
        set(cardParts.excerpt, "");
        set(cardParts.links, "");
        set(cardParts.hint, words.groupHint);
      }
      card.dataset.on = "1";
      cardSize = { w: card.offsetWidth, h: card.offsetHeight };
    };
    const placeCard = (x: number, y: number) => {
      if (!card || !cardKey) return;
      const ins = stage.insets;
      const { w, h } = cardSize;
      const minX = ins.left + 8;
      const maxX = painter.w - ins.right - 8 - w;
      const minY = ins.top + 8;
      const maxY = painter.h - ins.bottom - 8 - h;
      let cx = x + 18;
      let cy = y + 20;
      if (cx > maxX) cx = x - 18 - w;
      if (cy > maxY) cy = y - 16 - h;
      cx = clamp(cx, minX, Math.max(minX, maxX));
      cy = clamp(cy, minY, Math.max(minY, maxY));
      card.style.transform = `translate3d(${Math.round(cx)}px, ${Math.round(cy)}px, 0)`;
      cardAt = { x, y };
    };
    /** The line of text the card was waiting for has arrived: fill it in where it stands. */
    const refreshCard = () => {
      if (!cardPending || !cardKey.startsWith("s:")) return;
      const idx = Number(cardKey.slice(2));
      if (stage.excerpt(idx) === undefined) return;
      const key = cardKey;
      cardKey = "";
      fillCard(key);
      placeCard(cardAt.x, cardAt.y);
    };

    /* ---- hover ---- */
    const hoverAt = (p: { x: number; y: number }, moved: boolean) => {
      let idx = painter.pick(p.x, p.y, 6, stage.hoverIdx);
      let group = -1;
      let edge = -1;
      if (idx < 0) group = painter.pickGroup(p.x, p.y);
      if (idx < 0 && group < 0) edge = painter.pickEdge(stage, p.x, p.y, 5, stage.hoverEdge);
      if (stage.flight && stage.travel) idx = edge = group = -1;
      const changed = idx !== stage.hoverIdx || edge !== stage.hoverEdge || group !== stage.hoverGroup;
      stage.hoverIdx = idx;
      stage.hoverEdge = edge;
      stage.hoverGroup = group;
      if (idx >= 0 || edge >= 0 || group >= 0) canvas.dataset.hover = "1";
      else delete canvas.dataset.hover;
      fillCard(idx >= 0 ? `s:${idx}` : edge >= 0 ? `e:${edge}` : group >= 0 ? `g:${group}` : "");
      if (moved || changed) placeCard(p.x, p.y);
      if (changed) schedule();
    };
    const clearHover = () => {
      if (stage.hoverIdx >= 0 || stage.hoverEdge >= 0 || stage.hoverGroup >= 0) schedule();
      stage.hoverIdx = -1;
      stage.hoverEdge = -1;
      stage.hoverGroup = -1;
      delete canvas.dataset.hover;
      fillCard("");
    };

    /* ---- input ---- */
    const pointers = new Map<number, { x: number; y: number }>();
    let drag: {
      mode: "orbit" | "pan";
      x: number;
      y: number;
      moved: number;
      samples: Array<{ t: number; dx: number; dy: number }>;
    } | null = null;
    let pinch: { d: number; mid: { x: number; y: number } } | null = null;
    let push = 0;
    let pushAt = 0;
    let settle = false;
    let lastWheel = 0;
    let wheelAt = { x: -999, y: -999 };
    let lastClick = { t: 0, x: 0, y: 0 };
    const local = (e: { clientX: number; clientY: number }) => {
      const r = canvas.getBoundingClientRect();
      const kx = r.width > 0 ? canvas.clientWidth / r.width : 1;
      const ky = r.height > 0 ? canvas.clientHeight / r.height : 1;
      return { x: (e.clientX - r.left) * kx, y: (e.clientY - r.top) * ky };
    };
    const touched = () => {
      stage.lastInput = performance.now();
      cb.current.onInteract?.();
    };
    /** Distance limits of the moment, the dive-in floor and the way-out ceiling included. */
    const limits = (): [number, number] => {
      const [lo, hi] = distLimits(stage.model, stage.ego);
      return stage.ego ? [lo, Math.min(hi, zoomCeil(stage))] : [Math.max(lo, zoomFloor(stage)), hi];
    };
    /** The point a zoom closes in on: the star under the cursor, else the point at the focus depth. */
    const anchorAt = (x: number, y: number): Vec3 => {
      const star = painter.pick(x, y, 24);
      return star >= 0 ? posOf(stage, star) : unproject(x, y, stage.cam, painter.view);
    };
    const takeOver = () => {
      if (!stage.travel) {
        stage.flight = null;
        stage.arrival = null;
      }
    };

    const onDown = (e: PointerEvent) => {
      if (e.pointerType === "mouse" && e.button > 2) return;
      canvas.setPointerCapture(e.pointerId);
      pointers.set(e.pointerId, local(e));
      if (document.activeElement !== canvas) canvas.focus({ preventScroll: true });
      stopVel(stage.vel);
      touched();
      if (pointers.size === 2) {
        const [a, b] = [...pointers.values()] as [{ x: number; y: number }, { x: number; y: number }];
        pinch = {
          d: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)),
          mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
        };
        drag = null;
        stage.dragging = true;
        clearHover();
      } else if (pointers.size === 1) {
        const p = local(e);
        const pan = e.button === 1 || e.button === 2 || e.shiftKey;
        drag = { mode: pan ? "pan" : "orbit", x: p.x, y: p.y, moved: 0, samples: [] };
      }
    };
    const onMove = (e: PointerEvent) => {
      const p = local(e);
      if (pointers.has(e.pointerId)) pointers.set(e.pointerId, p);
      if (pinch && pointers.size >= 2) {
        const [a, b] = [...pointers.values()] as [{ x: number; y: number }, { x: number; y: number }];
        const d = Math.max(1, Math.hypot(a.x - b.x, a.y - b.y));
        const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
        takeOver();
        const [lo, hi] = limits();
        panBy(stage.cam, mid.x - pinch.mid.x, mid.y - pinch.mid.y, painter.view.focal);
        dollyBy(stage.cam, anchorAt(mid.x, mid.y), pinch.d / d, lo, hi);
        stage.autoFrame = false;
        pinch = { d, mid };
        touched();
        schedule();
        return;
      }
      if (drag) {
        const dx = p.x - drag.x;
        const dy = p.y - drag.y;
        drag.moved += Math.abs(dx) + Math.abs(dy);
        drag.x = p.x;
        drag.y = p.y;
        if (drag.moved > DRAG_PX) {
          if (!stage.dragging) {
            stage.dragging = true;
            canvas.dataset.drag = drag.mode;
            clearHover();
          }
          takeOver();
          if (drag.mode === "orbit") orbitBy(stage.cam, dx * ORBIT_X, dy * ORBIT_Y);
          else {
            panBy(stage.cam, dx, dy, painter.view.focal);
            stage.autoFrame = false;
          }
          const now = performance.now();
          drag.samples.push({ t: now, dx, dy });
          if (drag.samples.length > 10) drag.samples.shift();
          touched();
          schedule();
        }
        return;
      }
      if (e.pointerType === "mouse") {
        stage.pointer = p;
        // A hand over the sky holds the idle turn (what is under it stays under it).
        stage.lastInput = performance.now();
        hoverAt(p, true);
        schedule();
      }
    };
    const onUp = (e: PointerEvent) => {
      pointers.delete(e.pointerId);
      if (pinch) {
        if (pointers.size < 2) pinch = null;
        if (pointers.size === 0) {
          stage.dragging = false;
          delete canvas.dataset.drag;
        }
        return;
      }
      const d = drag;
      drag = null;
      const wasDrag = stage.dragging;
      stage.dragging = false;
      delete canvas.dataset.drag;
      stage.lastInput = performance.now();
      if (!d || e.type === "pointercancel") return;
      if (wasDrag) {
        // Let go: the motion carries on and settles.
        if (!still()) {
          const v = releaseVelocity(d.samples, performance.now());
          if (d.mode === "orbit") {
            stage.vel.yaw = clamp(v.vx * ORBIT_X * 0.6, -2.4, 2.4);
            stage.vel.pitch = clamp(v.vy * ORBIT_Y * 0.6, -1.8, 1.8);
          } else {
            const pv = panVelocity(stage.cam, v.vx * 0.7, v.vy * 0.7, painter.view.focal);
            stage.vel.x = pv.x;
            stage.vel.y = pv.y;
            stage.vel.z = pv.z;
          }
        }
        schedule();
        return;
      }
      if (e.button === 2 || e.button === 1) return;
      const p = local(e);
      const now = performance.now();
      // The second click of a double click belongs to the double click.
      const second = now - lastClick.t < DOUBLE_MS && Math.hypot(p.x - lastClick.x, p.y - lastClick.y) < 8;
      lastClick = second ? { t: 0, x: 0, y: 0 } : { t: now, x: p.x, y: p.y };
      if (second) return;
      const idx = painter.pick(p.x, p.y, e.pointerType === "mouse" ? 6 : 14, stage.hoverIdx);
      if (idx >= 0) return cb.current.onPick(idx);
      const group = painter.pickGroup(p.x, p.y);
      if (group >= 0) return cb.current.onGroup(group);
      const edge = e.pointerType === "mouse" ? painter.pickEdge(stage, p.x, p.y, 5) : -1;
      const ed = edge >= 0 ? stage.model?.edges[edge] : undefined;
      if (ed) return flyFit(stage, [posOf(stage, ed.a), posOf(stage, ed.b)], performance.now(), { min: 160 });
      cb.current.onEmpty();
    };
    const onLeave = () => {
      stage.pointer = null;
      clearHover();
      schedule();
    };
    const onContext = (e: MouseEvent) => e.preventDefault();
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const p = local(e);
      const now = performance.now();
      touched();
      const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1;
      if (e.shiftKey && !e.ctrlKey) {
        // Shift + scroll pans.
        takeOver();
        const dx = e.deltaX !== 0 ? e.deltaX : e.deltaY;
        const dy = e.deltaX !== 0 ? e.deltaY : 0;
        panBy(stage.cam, -dx * unit, -dy * unit, painter.view.focal);
        stage.autoFrame = false;
        schedule();
        return;
      }
      // A dive in, a way out or a trip is under way: the wheel waits for it, and then for
      // the hand to pause (a trackpad's momentum must not carry on into the new space).
      if (stage.flight && (stage.arrival || stage.travel || stage.ego)) {
        push = 0;
        settle = true;
        lastWheel = now;
        return;
      }
      if (settle) {
        const gap = now - lastWheel;
        lastWheel = now;
        if (gap < 260) return;
        settle = false;
      }
      if (now - pushAt > 450) push = 0;
      const cam = stage.cam;
      const deltaY = e.deltaY * unit;
      if (!stage.ego) {
        if (deltaY < 0 && stage.enterIdx >= 0 && cam.dist <= zoomFloor(stage) * 1.04 && !stage.flight) {
          push += -deltaY;
          pushAt = now;
          stopVel(stage.vel);
          if (push > PUSH) {
            push = 0;
            settle = true;
            lastWheel = now;
            cb.current.onPick(stage.enterIdx);
          }
          return;
        }
      } else if (deltaY > 0 && cam.dist >= zoomCeil(stage) * 0.97 && !stage.flight) {
        push += deltaY;
        pushAt = now;
        stopVel(stage.vel);
        if (push > PUSH) {
          push = 0;
          settle = true;
          lastWheel = now;
          cb.current.onEmpty();
        }
        return;
      }
      if (stage.travel) return;
      takeOver();
      // A new gesture stops the glide of the previous one (but not its own).
      stage.vel.yaw = stage.vel.pitch = stage.vel.x = stage.vel.y = stage.vel.z = 0;
      // A new gesture (a pause, or the cursor moved on) picks what to close in on.
      if (now - lastWheel > 220 || Math.hypot(p.x - wheelAt.x, p.y - wheelAt.y) > 24 || !stage.zoomAnchor) {
        stage.zoomAnchor = anchorAt(p.x, p.y);
        wheelAt = p;
      }
      lastWheel = now;
      const rate = e.ctrlKey ? 0.011 : 0.0017;
      const [lo, hi] = limits();
      if (still()) dollyBy(cam, stage.zoomAnchor, Math.exp(deltaY * rate), lo, hi);
      else stage.vel.zoom = clamp(stage.vel.zoom + deltaY * rate * DAMPING.zoom, -9, 9);
      stage.autoFrame = false;
      schedule();
    };
    const onDbl = (e: MouseEvent) => {
      const p = local(e);
      const idx = painter.pick(p.x, p.y, 6, stage.hoverIdx);
      if (idx >= 0) cb.current.onDive(idx);
      else if (painter.pickGroup(p.x, p.y) < 0) cb.current.onHome();
    };

    /* ---- keys ---- */
    const held = new Set<string>();
    const applyFly = () => {
      const f: FlyInput = { right: 0, forward: 0, up: 0 };
      for (const code of held) {
        const k = FLY_KEYS[code];
        if (!k) continue;
        f.right += k.right ?? 0;
        f.forward += k.forward ?? 0;
        f.up += k.up ?? 0;
      }
      f.right = clamp(f.right, -1, 1);
      f.forward = clamp(f.forward, -1, 1);
      f.up = clamp(f.up, -1, 1);
      stage.fly = f;
      schedule();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const c = stage.cam;
      let handled = true;
      const fly = FLY_KEYS[e.code];
      if (fly && e.shiftKey && e.code.startsWith("Arrow")) {
        // Shift + arrows orbit.
        const yaw = e.code === "ArrowLeft" ? -1 : e.code === "ArrowRight" ? 1 : 0;
        const pitch = e.code === "ArrowUp" ? -1 : e.code === "ArrowDown" ? 1 : 0;
        if (still()) orbitBy(c, yaw * 0.15, pitch * 0.12);
        else {
          stage.vel.yaw += yaw * 1.1;
          stage.vel.pitch += pitch * 0.9;
        }
      } else if (fly) {
        takeOver();
        if (still()) {
          const step = flyThrust(c, { right: 0, forward: 0, up: 0, ...fly }, 0.14);
          if (step) {
            c.tx += step.x;
            c.ty += step.y;
            c.tz += step.z;
          }
        } else if (!e.repeat) {
          held.add(e.code);
          applyFly();
        }
        stage.autoFrame = false;
      } else if (["+", "=", "-", "_"].includes(e.key)) {
        takeOver();
        stage.zoomAnchor = null;
        const inward = e.key === "+" || e.key === "=";
        const [lo, hi] = limits();
        if (still()) dollyBy(c, { x: c.tx, y: c.ty, z: c.tz }, inward ? 0.82 : 1.22, lo, hi);
        else stage.vel.zoom = clamp(stage.vel.zoom + (inward ? -1.8 : 1.8), -9, 9);
        stage.autoFrame = false;
      } else if (e.key === "0" || e.key === "Home") {
        cb.current.onHome();
      } else if (e.key === "f" || e.key === "F") {
        cb.current.onFrame();
      } else if (e.key === "Enter" && !stage.ego) {
        const idx = stage.hoverIdx >= 0 ? stage.hoverIdx : stage.enterIdx;
        if (idx >= 0) cb.current.onPick(idx);
        else handled = false;
      } else handled = false;
      if (!handled) return;
      e.preventDefault();
      e.stopPropagation();
      touched();
      schedule();
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (held.delete(e.code)) applyFly();
    };
    const onBlur = () => {
      if (held.size === 0) return;
      held.clear();
      applyFly();
    };
    canvas.addEventListener("pointerdown", onDown);
    canvas.addEventListener("pointermove", onMove);
    canvas.addEventListener("pointerup", onUp);
    canvas.addEventListener("pointercancel", onUp);
    canvas.addEventListener("pointerleave", onLeave);
    canvas.addEventListener("contextmenu", onContext);
    canvas.addEventListener("wheel", onWheel, { passive: false });
    canvas.addEventListener("dblclick", onDbl);
    canvas.addEventListener("keydown", onKey);
    canvas.addEventListener("keyup", onKeyUp);
    canvas.addEventListener("blur", onBlur);

    return () => {
      cancelAnimationFrame(raf);
      window.clearTimeout(idleTimer);
      stage.wake = () => undefined;
      stage.fly = { right: 0, forward: 0, up: 0 };
      stage.pointer = null;
      document.removeEventListener("visibilitychange", onVisibility);
      ro.disconnect();
      mo.disconnect();
      canvas.removeEventListener("pointerdown", onDown);
      canvas.removeEventListener("pointermove", onMove);
      canvas.removeEventListener("pointerup", onUp);
      canvas.removeEventListener("pointercancel", onUp);
      canvas.removeEventListener("pointerleave", onLeave);
      canvas.removeEventListener("contextmenu", onContext);
      canvas.removeEventListener("wheel", onWheel);
      canvas.removeEventListener("dblclick", onDbl);
      canvas.removeEventListener("keydown", onKey);
      canvas.removeEventListener("keyup", onKeyUp);
      canvas.removeEventListener("blur", onBlur);
    };
  }, [stage]);

  return (
    <>
      <canvas
        ref={canvasRef}
        className="bs-sky"
        tabIndex={0}
        role="img"
        aria-label={label}
        aria-describedby={describedBy}
      />
      <div ref={cardRef} className="bs-card" aria-hidden>
        <div className="bs-card-head">
          <svg
            className="bs-card-glyph"
            width={16}
            height={16}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={1.7}
            strokeLinecap="round"
            strokeLinejoin="round"
            focusable="false"
          >
            <path />
          </svg>
          <b className="bs-card-title" />
        </div>
        <span className="bs-card-meta" />
        <span className="bs-card-excerpt" />
        <span className="bs-card-foot">
          <span className="bs-card-links" />
          <span className="bs-card-hint" />
        </span>
      </div>
    </>
  );
}
