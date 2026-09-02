/**
 * Canvas renderer. Pure function of (world, theme, sprites, frame info) —
 * no React, no `getComputedStyle`, no per-frame DOM reads. Everything that
 * depends on the theme comes in through the `Theme` palette object, which
 * the React bridge caches once per theme change.
 */
import { cometHead } from "./physics";
import { blit, type SpriteCache } from "./sprites";
import {
  APP_COLOR,
  LABEL_ANGLE,
  MEMORY_COLOR,
  MEMORY_RING_RADIUS,
  RING,
  RING_SPEED,
  ROUTINE_COLOR,
  SKILL_COLOR,
  TWO_PI,
  WORLD_EXTENT,
  type World,
} from "./world";

export interface Theme {
  dark: boolean;
  accent: string;
  text: string;
  textDim: string;
  textFaint: string;
  /** Canvas ground (opaque). */
  bg: string;
  /** Background stars. */
  star: string;
  /** Background hex grid stroke. */
  hex: string;
  /** Fill of hex badges and the folder glyph on hubs. */
  badgeFill: string;
  /** Fill of ring-label pills. */
  label: string;
  font: string;
  mono: string;
}

export interface RingLabels {
  skills: string;
  memory: string;
  routines: string;
  apps: string;
  core: string;
}

export interface FrameInfo {
  cw: number;
  ch: number;
  /** Seconds. Frozen while the scene is static. */
  now: number;
  /** False under reduced motion or when idle: no twinkle, pulses or comets. */
  animate: boolean;
  labels: RingLabels;
}

/** Paints the static backdrop (stars, hex grid, accent glow) into an offscreen canvas. */
export function buildBackground(target: HTMLCanvasElement, width: number, height: number, theme: Theme, dpr: number): void {
  target.width = Math.max(1, Math.floor(width * dpr));
  target.height = Math.max(1, Math.floor(height * dpr));
  const bc = target.getContext("2d");
  if (!bc) return;
  bc.setTransform(dpr, 0, 0, dpr, 0, 0);
  bc.fillStyle = theme.bg;
  bc.fillRect(0, 0, width, height);
  let seed = 11;
  const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  bc.fillStyle = theme.star;
  for (let i = 0; i < 220; i++) {
    bc.globalAlpha = 0.06 + rand() * 0.22;
    bc.fillRect(rand() * width, rand() * height, 1.2, 1.2);
  }
  bc.globalAlpha = 1;
  const hexR = 34;
  bc.strokeStyle = theme.hex;
  bc.lineWidth = 1;
  bc.beginPath();
  for (let row = 0; row * hexR * 1.5 < height + hexR; row++) {
    for (let col = 0; col * hexR * Math.sqrt(3) < width + hexR; col++) {
      const cx = col * hexR * Math.sqrt(3) + (row % 2 ? (hexR * Math.sqrt(3)) / 2 : 0);
      const cy = row * hexR * 1.5;
      for (let i = 0; i < 6; i++) {
        const a = (Math.PI / 3) * i + Math.PI / 6;
        const px = cx + Math.cos(a) * hexR;
        const py = cy + Math.sin(a) * hexR;
        if (i === 0) bc.moveTo(px, py);
        else bc.lineTo(px, py);
      }
      bc.closePath();
    }
  }
  bc.stroke();
  const glow = bc.createRadialGradient(width / 2, height / 2, 10, width / 2, height / 2, Math.min(width, height) * 0.55);
  glow.addColorStop(0, theme.accent + (theme.dark ? "1f" : "14"));
  glow.addColorStop(0.4, theme.dark ? "#2b0f4d22" : "#c084fc10");
  glow.addColorStop(1, "transparent");
  bc.fillStyle = glow;
  bc.fillRect(0, 0, width, height);
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.lineTo(x + w - rr, y);
  ctx.arc(x + w - rr, y + rr, rr, -Math.PI / 2, 0);
  ctx.lineTo(x + w, y + h - rr);
  ctx.arc(x + w - rr, y + h - rr, rr, 0, Math.PI / 2);
  ctx.lineTo(x + rr, y + h);
  ctx.arc(x + rr, y + h - rr, rr, Math.PI / 2, Math.PI);
  ctx.lineTo(x, y + rr);
  ctx.arc(x + rr, y + rr, rr, Math.PI, Math.PI * 1.5);
  ctx.closePath();
}

/** Label along the ring at the label angle, inside an opaque pill so nodes never overlap it. */
function drawRingLabel(ctx: CanvasRenderingContext2D, text: string, r: number, angle: number, color: string, theme: Theme, k: number): void {
  const fontPx = 12 / Math.max(0.7, k);
  ctx.font = `800 ${fontPx}px ${theme.font}`;
  const tw = ctx.measureText(text).width;
  const padX = 9 / Math.max(0.7, k);
  const h = fontPx * 1.6;
  let rot = angle + Math.PI / 2;
  if (Math.sin(angle) > 0) rot += Math.PI; // keep the text upright
  ctx.save();
  ctx.translate(Math.cos(angle) * r, Math.sin(angle) * r);
  ctx.rotate(rot);
  roundRect(ctx, -tw / 2 - padX, -h / 2, tw + padX * 2, h, h / 2);
  ctx.fillStyle = theme.label;
  ctx.fill();
  ctx.strokeStyle = color + (theme.dark ? "80" : "b0");
  ctx.lineWidth = 1 / Math.max(0.7, k);
  ctx.stroke();
  ctx.fillStyle = theme.dark ? color : theme.text;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, 0, 0.5);
  ctx.restore();
  ctx.textAlign = "start";
  ctx.textBaseline = "alphabetic";
}

function quadPoint(ax: number, ay: number, cx: number, cy: number, bx: number, by: number, u: number): [number, number] {
  const v = 1 - u;
  return [v * v * ax + 2 * v * u * cx + u * u * bx, v * v * ay + 2 * v * u * cy + u * u * by];
}

function initials(name: string): string {
  const words = name.replace(/\(.*?\)/g, "").trim().split(/[\s-]+/).filter(Boolean);
  if (words.length >= 2) return (words[0]![0]! + words[1]![0]!).toUpperCase();
  return (name.slice(0, 2) || "?").toUpperCase();
}

function drawFolderGlyph(ctx: CanvasRenderingContext2D, x: number, y: number, size: number, color: string): void {
  ctx.fillStyle = color;
  const s = size;
  ctx.fillRect(x - s / 2, y - s / 2 + s * 0.25, s, s * 0.55);
  ctx.fillRect(x - s / 2, y - s / 2 + s * 0.12, s * 0.45, s * 0.2);
}

const CORE_PIXELS = ["01111110", "01000010", "01011010", "01000010", "01100110", "01000010", "01111110", "00000000"];

function drawPixelCore(ctx: CanvasRenderingContext2D, sprites: SpriteCache, color: string, k: number, now: number, agentsActive: boolean): void {
  const px = 4.4 / Math.max(0.6, Math.min(k, 2));
  const half = (CORE_PIXELS.length * px) / 2;
  const pulse = now === 0 ? 0.5 : 0.4 + 0.25 * Math.sin(now * (agentsActive ? 5 : 2));
  ctx.globalAlpha = pulse;
  blit(ctx, sprites.ring(color, half + 13 / k, 1.6 / k, agentsActive ? 14 : 9), 0, 0);
  if (agentsActive) {
    ctx.globalAlpha = pulse * 0.6;
    blit(ctx, sprites.ring(color, half + 22 / k, 1.6 / k, 14), 0, 0);
  }
  ctx.globalAlpha = 1;
  ctx.fillStyle = color;
  CORE_PIXELS.forEach((rowStr, row) => {
    for (let col = 0; col < rowStr.length; col++) {
      if (rowStr[col] === "1") ctx.fillRect(col * px - half, row * px - half, px * 0.92, px * 0.92);
    }
  });
}

/** Draws one frame. `ctx` is already scaled by DPR; `bg` is the cached backdrop. */
export function renderScene(
  ctx: CanvasRenderingContext2D,
  w: World,
  sprites: SpriteCache,
  theme: Theme,
  bg: HTMLCanvasElement | null,
  info: FrameInfo,
): void {
  const { cw, ch, now, animate } = info;
  const tr = w.transform;
  const k = tr.k;
  const inv = 1 / k;
  const light = !theme.dark;
  const additive = theme.dark ? "lighter" : "source-over";

  ctx.clearRect(0, 0, cw, ch);
  if (bg) ctx.drawImage(bg, 0, 0, cw, ch);
  else {
    ctx.fillStyle = theme.bg;
    ctx.fillRect(0, 0, cw, ch);
  }

  ctx.save();
  ctx.translate(cw / 2 + tr.x, ch / 2 + tr.y);
  ctx.scale(k, k);

  // ring guides
  const rings: Array<{ r: number; color: string }> = [
    { r: RING.skills, color: SKILL_COLOR },
    { r: MEMORY_RING_RADIUS, color: MEMORY_COLOR },
    { r: RING.routines, color: ROUTINE_COLOR },
    { r: RING.apps, color: APP_COLOR },
  ];
  ctx.lineWidth = inv;
  for (const ring of rings) {
    ctx.beginPath();
    ctx.arc(0, 0, ring.r, 0, TWO_PI);
    ctx.strokeStyle = ring.color + (light ? "55" : "2e");
    ctx.stroke();
  }
  ctx.fillStyle = theme.textFaint;
  ctx.globalAlpha = 0.5;
  for (const rr of [RING.routines, RING.apps] as const) {
    const speed = rr === RING.apps ? RING_SPEED.apps : RING_SPEED.routines;
    ctx.beginPath();
    for (let i = 0; i < 36; i++) {
      const a = (i / 36) * TWO_PI + w.theta * speed;
      const x = Math.cos(a) * rr;
      const y = Math.sin(a) * rr;
      ctx.moveTo(x + 1.1 * inv, y);
      ctx.arc(x, y, 1.1 * inv, 0, TWO_PI);
    }
    ctx.fill();
  }
  ctx.globalAlpha = 1;

  ctx.globalCompositeOperation = additive;

  // hub fan lines
  for (const hub of w.hubs) {
    if (!hub.expanded || hub.count > 80) continue;
    if (w.filterGroup && hub.key !== w.filterGroup) continue;
    ctx.strokeStyle = hub.color;
    ctx.globalAlpha = light ? 0.22 : 0.14;
    ctx.lineWidth = 0.7 * inv;
    ctx.beginPath();
    for (const n of w.files) {
      if (n.group !== hub.key) continue;
      ctx.moveTo(hub.x, hub.y);
      ctx.lineTo(n.x, n.y);
    }
    ctx.stroke();
  }

  // markdown links: one path for plain edges, one for selected; two strokes each
  if (w.edges.length > 0 && w.edges.length < 1500) {
    const strokeEdges = (selected: boolean) => {
      ctx.beginPath();
      let any = false;
      for (let i = 0; i < w.edges.length; i++) {
        if (w.selectedEdges.has(i) !== selected) continue;
        const e = w.edges[i]!;
        const a = w.files[e.a];
        const b = w.files[e.b];
        if (!a || !b) continue;
        any = true;
        ctx.moveTo(a.x, a.y);
        ctx.quadraticCurveTo(((a.x + b.x) / 2) * 0.82, ((a.y + b.y) / 2) * 0.82, b.x, b.y);
      }
      if (!any) return;
      ctx.strokeStyle = theme.accent;
      ctx.globalAlpha = selected ? 0.3 : light ? 0.16 : 0.1;
      ctx.lineWidth = (selected ? 5 : 3.4) * inv;
      ctx.stroke();
      ctx.globalAlpha = selected ? 0.95 : light ? 0.55 : 0.4;
      ctx.lineWidth = (selected ? 1.6 : 1) * inv;
      ctx.stroke();
    };
    strokeEdges(false);
    if (w.selectedEdges.size > 0) strokeEdges(true);
    if (animate) {
      const pulse = sprites.glow(theme.accent, light);
      const limit = Math.min(240, w.edges.length);
      ctx.globalAlpha = 0.9;
      for (let i = 0; i < limit; i++) {
        const e = w.edges[i]!;
        const a = w.files[e.a];
        const b = w.files[e.b];
        if (!a || !b) continue;
        const isSel = w.selectedEdges.has(i);
        const u = (now * (isSel ? 0.55 : 0.22) + i * 0.137) % 1;
        const [px, py] = quadPoint(a.x, a.y, ((a.x + b.x) / 2) * 0.82, ((a.y + b.y) / 2) * 0.82, b.x, b.y, u);
        blit(ctx, pulse, px, py, ((isSel ? 3.4 : 2.2) / Math.max(0.7, k)) * 0.1);
      }
    }
    ctx.globalAlpha = 1;
  }

  // file particles
  let labelBudget = 240;
  const labelFont = `${10 * inv}px ${theme.mono}`;
  for (const n of w.files) {
    const color = w.colorOf.get(n.group) ?? "#94a3b8";
    const hub = w.hubByKey.get(n.group);
    const collapsedDim = hub && !hub.expanded ? 0.35 : 1;
    const dimByFilter = w.filterGroup !== null && n.group !== w.filterGroup;
    const dimBySearch = w.matched !== null && !w.matched.has(n.id);
    const selected = w.selectedId === n.id;
    let alpha = (dimByFilter || dimBySearch ? 0.05 : light ? 0.85 : 0.95) * collapsedDim;
    if (animate && alpha > 0.2) alpha *= 0.7 + 0.3 * Math.sin(now * 1.5 + n.phase);
    const boost = selected ? 2.1 : w.matched?.has(n.id) ? 1.6 : 1;
    const size = n.r * w.nodeScale * boost;
    ctx.globalAlpha = alpha;
    blit(ctx, sprites.glow(color, light), n.x, n.y, (size * 2.6) / 20);

    const wantLabel =
      selected ||
      (w.matched?.has(n.id) ?? false) ||
      ((w.showNames || k > 1.9) && !dimByFilter && !dimBySearch && collapsedDim === 1 && labelBudget > 0);
    if (wantLabel && labelBudget > 0) {
      labelBudget--;
      ctx.globalCompositeOperation = "source-over";
      ctx.globalAlpha = selected ? 1 : 0.8;
      ctx.fillStyle = selected ? theme.text : theme.textDim;
      ctx.font = labelFont;
      ctx.fillText(n.name.length > 26 ? n.name.slice(0, 24) + "…" : n.name, n.x + size + 5 * inv, n.y + 3 * inv);
      ctx.globalCompositeOperation = additive;
    }
  }

  // bursts
  for (const fx of w.effects) {
    const age = now - fx.start;
    const rr = age * 150;
    const alpha = Math.max(0, 1 - age / 0.9);
    ctx.strokeStyle = fx.color;
    ctx.globalAlpha = alpha * 0.8;
    ctx.lineWidth = 2 * inv;
    ctx.beginPath();
    ctx.arc(fx.x, fx.y, rr, 0, TWO_PI);
    ctx.stroke();
    const spark = sprites.glow(fx.color, light);
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * TWO_PI + fx.start;
      ctx.globalAlpha = alpha;
      blit(ctx, spark, fx.x + Math.cos(a) * rr * 0.85, fx.y + Math.sin(a) * rr * 0.85, (2.4 * alpha * 2) / 20);
    }
  }
  ctx.globalAlpha = 1;

  // live agent comets
  if (animate) {
    const trailSprite = sprites.glow(theme.accent, light);
    const headSprite = sprites.glow(light ? theme.accent : "#ffffff", light);
    for (const comet of w.comets) {
      const [hx, hy] = cometHead(w, comet, now);
      comet.trail.forEach((pt, i) => {
        ctx.globalAlpha = (i / comet.trail.length) * 0.7;
        blit(ctx, trailSprite, pt.x, pt.y, ((1 + (i / comet.trail.length) * 2.4) * 2) / 20);
      });
      const hs = 4.2 * (0.85 + 0.15 * Math.sin(now * 6 + comet.seed));
      ctx.globalAlpha = 1;
      blit(ctx, headSprite, hx, hy, (hs * 2) / 20);
      blit(ctx, trailSprite, hx, hy, (hs * 2.8) / 20);
    }
  }
  ctx.globalCompositeOperation = "source-over";
  ctx.globalAlpha = 1;

  // structure orbs
  const orbFont = `700 ${10.5 * inv}px ${theme.font}`;
  for (const orb of w.orbs) {
    const hovered = w.hoverKey === `${orb.kind}:${orb.id}`;
    if (orb.kind === "skill") {
      const pulse = animate ? 0.85 + 0.15 * Math.sin(now * 2 + orb.baseAngle * 5) : 1;
      const size = hovered ? 11 : 8;
      blit(ctx, sprites.spark(SKILL_COLOR, size, light ? 3 : 8, light ? theme.badgeFill : "#fff8ee"), orb.x, orb.y, pulse);
      if (hovered || k > 1.6) {
        ctx.fillStyle = hovered ? theme.accent : theme.textDim;
        ctx.font = `700 ${10 * inv}px ${theme.mono}`;
        ctx.textAlign = "center";
        ctx.fillText(orb.label, orb.x, orb.y - 12 * inv);
        ctx.textAlign = "start";
      }
    } else if (orb.kind === "routine") {
      const size = hovered ? 10 : 8;
      ctx.globalAlpha = orb.active ? 1 : 0.45;
      blit(ctx, sprites.ring(ROUTINE_COLOR, size, 1.6 / Math.max(0.7, k), orb.active ? (light ? 3 : 7) : 2), orb.x, orb.y);
      const minuteA = animate ? (now * 0.8) % TWO_PI : Math.PI / 3;
      ctx.strokeStyle = ROUTINE_COLOR;
      ctx.lineWidth = 1.6 / Math.max(0.7, k);
      ctx.beginPath();
      ctx.moveTo(orb.x, orb.y);
      ctx.lineTo(orb.x + Math.cos(minuteA - Math.PI / 2) * size * 0.72, orb.y + Math.sin(minuteA - Math.PI / 2) * size * 0.72);
      ctx.moveTo(orb.x, orb.y);
      ctx.lineTo(orb.x + Math.cos(minuteA / 12 - Math.PI / 2) * size * 0.45, orb.y + Math.sin(minuteA / 12 - Math.PI / 2) * size * 0.45);
      ctx.stroke();
      ctx.globalAlpha = 1;
      if (hovered) {
        ctx.fillStyle = theme.accent;
        ctx.font = orbFont;
        ctx.textAlign = "center";
        ctx.fillText(orb.label, orb.x, orb.y - 15 * inv);
        ctx.textAlign = "start";
      }
    } else {
      const size = hovered ? 15 : 12;
      ctx.globalAlpha = orb.active ? 1 : 0.72;
      blit(ctx, sprites.hex(APP_COLOR, size, theme.badgeFill, orb.official ? (light ? 3 : 7) : 3, 1.6 / Math.max(0.7, k)), orb.x, orb.y);
      ctx.fillStyle = light ? theme.text : APP_COLOR;
      ctx.font = `800 ${Math.max(7, size * 0.62)}px ${theme.mono}`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(initials(orb.label), orb.x, orb.y + 0.5);
      ctx.textBaseline = "alphabetic";
      ctx.globalAlpha = 1;
      if (hovered) {
        ctx.fillStyle = theme.accent;
        ctx.font = orbFont;
        ctx.fillText(orb.label, orb.x, orb.y - 20 * inv);
      }
      ctx.textAlign = "start";
    }
  }

  // memory hubs
  for (const hub of w.hubs) {
    const active = w.filterGroup === hub.key || w.hoverKey === `hub:${hub.key}`;
    const rr = active ? 13 : 10.5;
    blit(ctx, sprites.disc(hub.color, rr, light ? (active ? 6 : 3) : active ? 13 : 7), hub.x, hub.y);
    drawFolderGlyph(ctx, hub.x, hub.y, rr * 0.9, theme.badgeFill);
    ctx.font = `800 ${9 * inv}px ${theme.mono}`;
    ctx.fillStyle = theme.textFaint;
    ctx.textAlign = "center";
    ctx.fillText(String(hub.count), hub.x, hub.y + rr + 11 * inv);
    ctx.fillStyle = active ? theme.accent : theme.textDim;
    ctx.font = `800 ${11.5 * inv}px ${theme.font}`;
    const label = hub.key.toUpperCase();
    ctx.fillText(label.length > 16 ? label.slice(0, 15) + "…" : label, hub.x, hub.y - rr - 7 * inv);
    ctx.textAlign = "start";
    if (!hub.expanded) {
      ctx.strokeStyle = hub.color;
      ctx.globalAlpha = 0.6;
      ctx.lineWidth = inv;
      ctx.beginPath();
      ctx.arc(hub.x, hub.y, rr + 5, 0, TWO_PI);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
  }

  drawPixelCore(ctx, sprites, theme.accent, k, animate ? now : 0, w.comets.length > 0);
  ctx.fillStyle = theme.textDim;
  ctx.font = `800 ${11 * inv}px ${theme.font}`;
  ctx.textAlign = "center";
  ctx.fillText(info.labels.core, 0, 36 * inv);
  ctx.textAlign = "start";

  // ring labels on top, rotating with their ring, inside opaque pills
  drawRingLabel(ctx, info.labels.skills.toUpperCase(), RING.skills, LABEL_ANGLE + w.theta * RING_SPEED.skills, SKILL_COLOR, theme, k);
  drawRingLabel(ctx, info.labels.memory.toUpperCase(), MEMORY_RING_RADIUS, LABEL_ANGLE + w.theta * RING_SPEED.memory, MEMORY_COLOR, theme, k);
  drawRingLabel(ctx, info.labels.routines.toUpperCase(), RING.routines, LABEL_ANGLE + w.theta * RING_SPEED.routines, ROUTINE_COLOR, theme, k);
  drawRingLabel(ctx, info.labels.apps.toUpperCase(), RING.apps, LABEL_ANGLE + w.theta * RING_SPEED.apps, APP_COLOR, theme, k);

  ctx.restore();
}

export interface MinimapInfo {
  /** CSS size of the minimap canvas. */
  mw: number;
  mh: number;
  /** CSS size of the main canvas (viewport rectangle). */
  cw: number;
  ch: number;
  dpr: number;
}

/** Minimap: rings, one dot per file (every other when large) and the viewport rectangle. DPR-aware. */
export function renderMinimap(mctx: CanvasRenderingContext2D, w: World, theme: Theme, info: MinimapInfo): void {
  const { mw, mh, cw, ch, dpr } = info;
  mctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const scale = mw / WORLD_EXTENT;
  mctx.clearRect(0, 0, mw, mh);
  mctx.fillStyle = theme.dark ? "rgba(0,0,0,0.25)" : "rgba(255,255,255,0.35)";
  mctx.fillRect(0, 0, mw, mh);
  mctx.strokeStyle = theme.textFaint;
  mctx.lineWidth = 1;
  mctx.globalAlpha = 0.5;
  for (const rr of [RING.skills, RING.routines, RING.apps]) {
    mctx.beginPath();
    mctx.arc(mw / 2, mh / 2, rr * scale, 0, TWO_PI);
    mctx.stroke();
  }
  mctx.globalAlpha = 1;
  const step = w.files.length > 1200 ? 2 : 1;
  for (let i = 0; i < w.files.length; i += step) {
    const n = w.files[i]!;
    mctx.fillStyle = w.colorOf.get(n.group) ?? "#94a3b8";
    mctx.fillRect(mw / 2 + n.x * scale, mh / 2 + n.y * scale, 1.4, 1.4);
  }
  const tr = w.transform;
  const vw = (cw / tr.k) * scale;
  const vh = (ch / tr.k) * scale;
  const vx = mw / 2 + (-tr.x / tr.k - cw / (2 * tr.k)) * scale;
  const vy = mh / 2 + (-tr.y / tr.k - ch / (2 * tr.k)) * scale;
  mctx.strokeStyle = theme.accent;
  mctx.lineWidth = 1;
  mctx.strokeRect(vx, vy, vw, vh);
}
