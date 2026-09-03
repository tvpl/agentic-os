/**
 * One frame of the Second Brain: background, ring guides, typed edges, file
 * particles, planets, effects, comets, orbs, hubs and the core. Pure drawing
 * over the world; no React, no DOM reads (tokens and sprites are passed in).
 */
import { APP_COLOR, RING, ROUTINE_COLOR, SKILL_COLOR, TWO_PI, WORLD_EXTENT, type EdgeKind, type World } from "../engine/world";
import { drawClock, drawFolderGlyph, drawPixelCore, drawPlanet, quadPoint } from "./glyphs";
import type { SpriteSet } from "./sprites";
import type { CanvasTokens } from "./tokens";

export interface RingDef {
  r: number;
  label: string;
  color: string;
}

export function makeRingDefs(labels: { skills: string; memory: string; routines: string; apps: string }): RingDef[] {
  return [
    { r: RING.skills, label: labels.skills.toUpperCase(), color: SKILL_COLOR },
    { r: RING.hubs + 60, label: labels.memory.toUpperCase(), color: "#c084fc" },
    { r: RING.routines, label: labels.routines.toUpperCase(), color: ROUTINE_COLOR },
    { r: RING.apps, label: labels.apps.toUpperCase(), color: APP_COLOR },
  ];
}

export interface FrameOptions {
  width: number;
  height: number;
  /** Seconds. */
  tNow: number;
  tokens: CanvasTokens;
  sprites: SpriteSet;
  reduceMotion: boolean;
  ringDefs: RingDef[];
  background: HTMLCanvasElement | null;
  coreLabel: string;
}

/** Max edges drawn per frame; beyond it the faint kinds are dropped first. */
const EDGE_BUDGET = 4000;
const PULSE_BUDGET = 240;

export function drawFrame(ctx: CanvasRenderingContext2D, w: World, o: FrameOptions): void {
  const { width: cw, height: ch, tNow, tokens, sprites, reduceMotion } = o;
  const cx = cw / 2;
  const cy = ch / 2;
  const tr = w.transform;
  const k = tr.k;
  const { accent, textDim, faint, font, mono } = tokens;

  ctx.clearRect(0, 0, cw, ch);
  if (o.background) ctx.drawImage(o.background, 0, 0, cw, ch);

  ctx.save();
  ctx.translate(cx + tr.x, cy + tr.y);
  ctx.scale(k, k);

  // ---- ring guides + labels (fade in after a layout switch) ----
  const ringAlpha = w.ringFade;
  for (const ring of o.ringDefs) {
    ctx.beginPath();
    ctx.arc(0, 0, ring.r, 0, TWO_PI);
    ctx.strokeStyle = ring.color;
    ctx.globalAlpha = 0.18 * ringAlpha;
    ctx.lineWidth = 1 / k;
    ctx.stroke();
    ctx.font = `800 ${15 / Math.max(0.7, k)}px ${font}`;
    ctx.fillStyle = ring.color;
    ctx.globalAlpha = 0.72 * ringAlpha;
    ctx.textAlign = "center";
    ctx.fillText(ring.label, 0, -ring.r + RING.labelPad / k - 4);
    ctx.textAlign = "start";
  }
  ctx.globalAlpha = 0.5 * ringAlpha;
  ctx.fillStyle = faint;
  for (const rr of [RING.routines, RING.apps]) {
    for (let i = 0; i < 36; i++) {
      const a = (i / 36) * TWO_PI + w.theta * (rr === RING.apps ? 0.22 : 0.5);
      ctx.beginPath();
      ctx.arc(Math.cos(a) * rr, Math.sin(a) * rr, 1.1 / k, 0, TWO_PI);
      ctx.fill();
    }
  }
  // Sector guides under the arcs layout: a faint dotted arc per hub sector.
  if (w.layout === "arcs") {
    ctx.setLineDash([2 / k, 5 / k]);
    for (const hub of w.hubs) {
      if (!hub.expanded) continue;
      ctx.beginPath();
      ctx.arc(0, 0, RING.filesInner + 4, hub.sectorStart + w.theta, hub.sectorStart + hub.sectorSpan + w.theta);
      ctx.strokeStyle = hub.color;
      ctx.globalAlpha = 0.28 * ringAlpha;
      ctx.lineWidth = 1 / k;
      ctx.stroke();
    }
    ctx.setLineDash([]);
  }
  ctx.globalAlpha = 1;

  ctx.globalCompositeOperation = tokens.blend;

  // ---- hub fan lines: small hubs, hovered hubs, and files mid-explosion ----
  const hubByKey = new Map(w.hubs.map((h) => [h.key, h] as const));
  for (const hub of w.hubs) {
    if (!hub.expanded) continue;
    if (w.filterGroup && hub.key !== w.filterGroup) continue;
    const hovered = w.hoverKey === `hub:${hub.key}`;
    const small = hub.count <= 80;
    ctx.strokeStyle = hub.color;
    ctx.globalAlpha = hovered ? 0.22 : 0.14;
    ctx.lineWidth = 0.7 / k;
    ctx.beginPath();
    let any = false;
    for (const n of w.files) {
      if (n.group !== hub.key) continue;
      if (!(small || hovered || n.trip)) continue;
      if (n.visAlpha < 0.05) continue;
      ctx.moveTo(hub.x, hub.y);
      ctx.lineTo(n.x, n.y);
      any = true;
    }
    if (any) ctx.stroke();
  }

  // ---- typed edges ----
  drawEdges(ctx, w, o, hubByKey);

  // ---- file particles (additive) ----
  let labelBudget = 240;
  const showLabels = w.showNames || k > 1.9;
  for (const n of w.files) {
    if (n.visAlpha <= 0.01) continue;
    const color = n.tint ?? w.colorOf.get(n.group) ?? "#94a3b8";
    const hub = hubByKey.get(n.group);
    const collapsedDim = hub && !hub.expanded ? 0.35 : 1;
    const dimByFilter = w.filterGroup !== null && n.group !== w.filterGroup;
    const dimBySearch = w.matched !== null && !w.matched.has(n.id);
    const selected = w.selectedId === n.id;
    let alpha = (dimByFilter || dimBySearch ? 0.05 : 0.95) * collapsedDim * n.hoverAlpha * n.visAlpha;
    if (!reduceMotion && alpha > 0.2) alpha *= 0.75 + 0.25 * Math.sin(tNow * 1.5 + n.phase);
    const boost = selected ? 2.1 : w.matched?.has(n.id) ? 1.6 : 1;
    const size = n.r * w.nodeScale * boost * (1 + 0.12 * Math.sin(n.phase));
    ctx.globalAlpha = alpha;
    ctx.drawImage(sprites.glow(color), n.x - size * 2.6, n.y - size * 2.6, size * 5.2, size * 5.2);
    if (n.pinned) {
      ctx.globalCompositeOperation = "source-over";
      ctx.strokeStyle = tokens.text;
      ctx.globalAlpha = 0.8 * n.visAlpha;
      ctx.lineWidth = 1 / k;
      ctx.beginPath();
      ctx.arc(n.x, n.y, size * 1.6 + 2 / k, 0, TWO_PI);
      ctx.stroke();
      ctx.globalCompositeOperation = tokens.blend;
    }
    const wantLabel = selected || (w.matched?.has(n.id) ?? false) || (showLabels && !dimByFilter && !dimBySearch && collapsedDim === 1 && n.hoverAlpha > 0.5 && labelBudget > 0);
    if (wantLabel && labelBudget > 0) {
      labelBudget--;
      ctx.globalCompositeOperation = "source-over";
      ctx.globalAlpha = (selected ? 1 : 0.7) * n.visAlpha;
      ctx.fillStyle = textDim;
      ctx.font = `${10 / k}px ${mono}`;
      ctx.fillText(n.name.length > 26 ? n.name.slice(0, 24) + "…" : n.name, n.x + size + 5 / k, n.y + 3 / k);
      ctx.globalCompositeOperation = tokens.blend;
    }
  }
  ctx.globalAlpha = 1;

  // ---- burst effects (hub explosions, run finishes) ----
  w.effects = w.effects.filter((fx) => tNow - fx.start < 1);
  for (const fx of w.effects) {
    const age = tNow - fx.start;
    const rr = age * 150;
    const alpha = Math.max(0, 1 - age / 0.9);
    ctx.strokeStyle = fx.color;
    ctx.globalAlpha = alpha * 0.8;
    ctx.lineWidth = 2 / k;
    ctx.beginPath();
    ctx.arc(fx.x, fx.y, rr, 0, TWO_PI);
    ctx.stroke();
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * TWO_PI + fx.start;
      const pr = rr * 0.85;
      const ps = 2.4 * alpha;
      ctx.globalAlpha = alpha;
      ctx.drawImage(sprites.glow(fx.color), fx.x + Math.cos(a) * pr - ps * 2, fx.y + Math.sin(a) * pr - ps * 2, ps * 4, ps * 4);
    }
  }
  ctx.globalAlpha = 1;

  // ---- live agent comets ----
  for (const comet of w.comets) {
    const targetOrb = comet.skillSlug ? w.orbs.find((orb) => orb.kind === "skill" && orb.id === comet.skillSlug) : undefined;
    const tx2 = targetOrb ? targetOrb.x : Math.cos(comet.seed + tNow * 0.4) * RING.hubs * 0.7;
    const ty2 = targetOrb ? targetOrb.y : Math.sin(comet.seed + tNow * 0.4) * RING.hubs * 0.7;
    const cycle = (tNow * 0.4 + comet.seed) % 2;
    const p = cycle < 1 ? cycle : 2 - cycle;
    const ease = p * p * (3 - 2 * p);
    const bulge = Math.sin(ease * Math.PI) * 44;
    const dx = ty2;
    const dy = -tx2;
    const dl = Math.hypot(dx, dy) || 1;
    const hx = tx2 * ease + (dx / dl) * bulge;
    const hy = ty2 * ease + (dy / dl) * bulge;
    comet.trail.push({ x: hx, y: hy });
    if (comet.trail.length > 16) comet.trail.shift();
    comet.trail.forEach((pt, i) => {
      const a2 = (i / comet.trail.length) * 0.7;
      const ps = 1 + (i / comet.trail.length) * 2.4;
      ctx.globalAlpha = a2;
      ctx.drawImage(sprites.glow(accent), pt.x - ps * 2, pt.y - ps * 2, ps * 4, ps * 4);
    });
    const headPulse = reduceMotion ? 1 : 0.85 + 0.15 * Math.sin(tNow * 6 + comet.seed);
    const hs = 4.2 * headPulse;
    ctx.globalAlpha = 1;
    ctx.drawImage(sprites.glow(tokens.spriteCore ?? accent), hx - hs * 2, hy - hs * 2, hs * 4, hs * 4);
    ctx.drawImage(sprites.glow(accent), hx - hs * 2.8, hy - hs * 2.8, hs * 5.6, hs * 5.6);
  }
  ctx.globalCompositeOperation = "source-over";
  ctx.globalAlpha = 1;

  // ---- sub-folder planets ----
  for (const p of w.planets) {
    const hub = hubByKey.get(p.hubKey);
    if (!hub || !hub.expanded) continue;
    const dim = w.filterGroup !== null && p.hubKey !== w.filterGroup ? 0.15 : 1;
    const hovered = w.hoverKey === `planet:${p.hubKey}:${p.dir}`;
    drawPlanet(ctx, p.x, p.y, hub.color, p.count, k, mono, hovered ? accent : textDim, dim * (hovered ? 1 : 0.85));
  }

  // ---- structure orbs ----
  for (const orb of w.orbs) {
    const hovered = w.hoverKey === `${orb.kind}:${orb.id}`;
    if (orb.kind === "skill") {
      const pulse = reduceMotion ? 1 : 0.88 + 0.12 * Math.sin(tNow * 2 + orb.baseAngle * 5);
      const s = (hovered ? 26 : 20) * pulse;
      ctx.drawImage(sprites.spark(SKILL_COLOR, hovered), orb.x - s, orb.y - s, s * 2, s * 2);
      if (hovered || k > 1.6) {
        ctx.fillStyle = hovered ? accent : textDim;
        ctx.font = `700 ${10 / k}px ${mono}`;
        ctx.textAlign = "center";
        ctx.fillText(orb.label, orb.x, orb.y - 12 / k);
        ctx.textAlign = "start";
      }
    } else if (orb.kind === "routine") {
      drawClock(ctx, orb.x, orb.y, hovered ? 10 : 8, ROUTINE_COLOR, orb.active, k, reduceMotion ? 0 : tNow, sprites);
      if (hovered) {
        ctx.fillStyle = accent;
        ctx.font = `700 ${10.5 / k}px ${font}`;
        ctx.textAlign = "center";
        ctx.fillText(orb.label, orb.x, orb.y - 15 / k);
        ctx.textAlign = "start";
      }
    } else {
      const s = hovered ? 22 : 18;
      ctx.drawImage(sprites.hex(orb.label, APP_COLOR, !!orb.official, orb.active, hovered), orb.x - s, orb.y - s, s * 2, s * 2);
      if (hovered) {
        ctx.fillStyle = accent;
        ctx.font = `700 ${10.5 / k}px ${font}`;
        ctx.textAlign = "center";
        ctx.fillText(orb.label, orb.x, orb.y - 20 / k);
        ctx.textAlign = "start";
      }
    }
  }

  // ---- memory hubs: halo sprite + disc + glyph + label with count beside it ----
  for (const hub of w.hubs) {
    const active = w.filterGroup === hub.key || w.hoverKey === `hub:${hub.key}`;
    const rr = active ? 13 : 10.5;
    const hs = rr * (active ? 3.2 : 2.4);
    ctx.globalAlpha = active ? 1 : 0.8;
    ctx.drawImage(sprites.halo(hub.color), hub.x - hs, hub.y - hs, hs * 2, hs * 2);
    ctx.globalAlpha = 1;
    ctx.beginPath();
    ctx.arc(hub.x, hub.y, rr, 0, TWO_PI);
    ctx.fillStyle = hub.color;
    ctx.fill();
    drawFolderGlyph(ctx, hub.x, hub.y, rr * 0.9, tokens.glyphInk);
    const label = hub.key.toUpperCase();
    const short = label.length > 16 ? label.slice(0, 15) + "…" : label;
    ctx.font = `800 ${11.5 / k}px ${font}`;
    ctx.textAlign = "center";
    ctx.fillStyle = active ? accent : textDim;
    const labelW = ctx.measureText(short).width;
    ctx.fillText(short, hub.x, hub.y - rr - 7 / k);
    ctx.font = `800 ${9 / k}px ${mono}`;
    ctx.fillStyle = faint;
    ctx.textAlign = "left";
    ctx.fillText(String(hub.count), hub.x + labelW / 2 + 4 / k, hub.y - rr - 7 / k);
    ctx.textAlign = "start";
    if (!hub.expanded) {
      ctx.strokeStyle = hub.color;
      ctx.globalAlpha = 0.6;
      ctx.lineWidth = 1 / k;
      ctx.beginPath();
      ctx.arc(hub.x, hub.y, rr + 5, 0, TWO_PI);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
  }

  drawPixelCore(ctx, accent, k, reduceMotion ? 0 : tNow, w.comets.length > 0, sprites);
  ctx.fillStyle = textDim;
  ctx.font = `800 ${11 / k}px ${font}`;
  ctx.textAlign = "center";
  ctx.fillText(o.coreLabel, 0, 36 / k);
  ctx.textAlign = "start";

  ctx.restore();
}

const KIND_ORDER: EdgeKind[] = ["same-area", "other", "same-dir", "markdown-link"];

function drawEdges(ctx: CanvasRenderingContext2D, w: World, o: FrameOptions, hubByKey: Map<string, World["hubs"][number]>): void {
  const { tokens, sprites, reduceMotion, tNow } = o;
  const k = w.transform.k;
  const accent = tokens.accent;
  const total = w.edges.length;
  if (total === 0) return;
  // Budget: faint kinds are dropped first when the graph is dense.
  const counts = new Map<EdgeKind, number>();
  for (const e of w.edges) if (w.edgeKinds.has(e.kind)) counts.set(e.kind, (counts.get(e.kind) ?? 0) + 1);
  const drawn = new Set<EdgeKind>();
  let used = 0;
  for (const kind of [...KIND_ORDER].reverse()) {
    const c = counts.get(kind) ?? 0;
    if (c === 0) continue;
    if (used + c > EDGE_BUDGET && kind !== "markdown-link") continue;
    drawn.add(kind);
    used += c;
  }
  let pulses = 0;
  for (const kind of KIND_ORDER) {
    if (!drawn.has(kind)) continue;
    if (kind === "same-dir") ctx.setLineDash([1.5 / k, 3.5 / k]);
    for (let i = 0; i < w.edges.length; i++) {
      const e = w.edges[i]!;
      if (e.kind !== kind) continue;
      const a = w.files[e.a];
      const b = w.files[e.b];
      if (!a || !b) continue;
      const vis = Math.min(a.visAlpha, b.visAlpha) * Math.max(a.hoverAlpha, b.hoverAlpha) * (a.hoverAlpha > 0.5 && b.hoverAlpha > 0.5 ? 1 : 0.35);
      if (vis <= 0.02) continue;
      const isSel = w.selectedEdges.has(i);
      if (kind === "markdown-link") {
        const mx = ((a.x + b.x) / 2) * 0.82;
        const my = ((a.y + b.y) / 2) * 0.82;
        ctx.strokeStyle = accent;
        ctx.globalAlpha = (isSel ? 0.3 : 0.1) * vis;
        ctx.lineWidth = (isSel ? 5 : 3.4) / k;
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.quadraticCurveTo(mx, my, b.x, b.y);
        ctx.stroke();
        ctx.globalAlpha = (isSel ? 0.95 : 0.4) * vis;
        ctx.lineWidth = (isSel ? 1.6 : 1) / k;
        ctx.stroke();
        if (pulses < PULSE_BUDGET && !reduceMotion && vis > 0.5) {
          pulses++;
          const u = (tNow * (isSel ? 0.55 : 0.22) + i * 0.137) % 1;
          const [px, py] = quadPoint(a.x, a.y, mx, my, b.x, b.y, u);
          const ps = (isSel ? 3.4 : 2.2) / Math.max(0.7, k);
          ctx.globalAlpha = 0.9 * vis;
          ctx.drawImage(sprites.glow(accent), px - ps * 2, py - ps * 2, ps * 4, ps * 4);
        }
      } else if (kind === "same-dir") {
        ctx.strokeStyle = hubByKey.get(a.group)?.color ?? tokens.faint;
        ctx.globalAlpha = (isSel ? 0.8 : 0.28) * vis;
        ctx.lineWidth = (isSel ? 1.2 : 0.7) / k;
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.stroke();
      } else {
        ctx.strokeStyle = tokens.faint;
        ctx.globalAlpha = (isSel ? 0.5 : 0.07) * vis;
        ctx.lineWidth = (isSel ? 1 : 0.6) / k;
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.stroke();
      }
    }
    ctx.setLineDash([]);
  }
  ctx.globalAlpha = 1;
}

/* ---------------------------------------------------------------------------
   Minimap: a cached file layer (redrawn only when files moved) plus the
   viewport rectangle (redrawn when the transform changed). Crisp at any DPR.
--------------------------------------------------------------------------- */
export interface MinimapState {
  layer: HTMLCanvasElement | null;
  layerStamp: string;
  rectStamp: string;
}

export function createMinimapState(): MinimapState {
  return { layer: null, layerStamp: "", rectStamp: "" };
}

export function drawMinimap(
  mini: HTMLCanvasElement,
  w: World,
  st: MinimapState,
  o: { tokens: CanvasTokens; viewW: number; viewH: number; filesMoved: boolean; dpr: number },
): void {
  const cssW = mini.clientWidth || 226;
  const cssH = mini.clientHeight || 150;
  const pw = Math.max(1, Math.round(cssW * o.dpr));
  const ph = Math.max(1, Math.round(cssH * o.dpr));
  if (mini.width !== pw || mini.height !== ph) {
    mini.width = pw;
    mini.height = ph;
    st.layerStamp = "";
    st.rectStamp = "";
  }
  const tr = w.transform;
  const rectStamp = `${tr.x.toFixed(1)}:${tr.y.toFixed(1)}:${tr.k.toFixed(3)}:${o.viewW}:${o.viewH}`;
  const layerStamp = `${w.files.length}:${w.theta.toFixed(3)}:${w.layout}:${w.filterGroup ?? ""}`;
  const needLayer = !st.layer || st.layerStamp !== layerStamp || o.filesMoved;
  if (!needLayer && st.rectStamp === rectStamp) return;

  const scale = cssW / WORLD_EXTENT;
  if (needLayer) {
    if (!st.layer) st.layer = document.createElement("canvas");
    const layer = st.layer;
    layer.width = pw;
    layer.height = ph;
    const lc = layer.getContext("2d");
    if (lc) {
      lc.setTransform(o.dpr, 0, 0, o.dpr, 0, 0);
      lc.clearRect(0, 0, cssW, cssH);
      lc.fillStyle = o.tokens.minimapFill;
      lc.fillRect(0, 0, cssW, cssH);
      lc.strokeStyle = o.tokens.faint;
      lc.globalAlpha = 0.5;
      lc.lineWidth = 1;
      for (const rr of [RING.skills, RING.routines, RING.apps]) {
        lc.beginPath();
        lc.arc(cssW / 2, cssH / 2, rr * scale, 0, TWO_PI);
        lc.stroke();
      }
      lc.globalAlpha = 1;
      for (let i = 0; i < w.files.length; i += 2) {
        const n = w.files[i]!;
        if (n.visAlpha < 0.3) continue;
        lc.fillStyle = n.tint ?? w.colorOf.get(n.group) ?? "#94a3b8";
        lc.globalAlpha = w.filterGroup && n.group !== w.filterGroup ? 0.25 : 0.9;
        lc.fillRect(cssW / 2 + n.x * scale, cssH / 2 + n.y * scale, 1.4, 1.4);
      }
      lc.globalAlpha = 1;
    }
    st.layerStamp = layerStamp;
  }
  const mctx = mini.getContext("2d");
  if (!mctx || !st.layer) return;
  mctx.setTransform(1, 0, 0, 1, 0, 0);
  mctx.clearRect(0, 0, pw, ph);
  mctx.drawImage(st.layer, 0, 0);
  mctx.setTransform(o.dpr, 0, 0, o.dpr, 0, 0);
  const vw = (o.viewW / tr.k) * scale;
  const vh = (o.viewH / tr.k) * scale;
  const vx = cssW / 2 + (-tr.x / tr.k - o.viewW / (2 * tr.k)) * scale;
  const vy = cssH / 2 + (-tr.y / tr.k - o.viewH / (2 * tr.k)) * scale;
  mctx.strokeStyle = o.tokens.accent;
  mctx.lineWidth = 1;
  mctx.strokeRect(Math.round(vx) + 0.5, Math.round(vy) + 0.5, Math.round(vw), Math.round(vh));
  st.rectStamp = rectStamp;
}

/** Static backdrop: star dust, hex grid and a central glow, built on resize only. */
export function buildBackground(width: number, height: number, tokens: CanvasTokens): HTMLCanvasElement {
  const bg = document.createElement("canvas");
  bg.width = Math.max(1, Math.floor(width));
  bg.height = Math.max(1, Math.floor(height));
  const bc = bg.getContext("2d");
  if (!bc) return bg;
  let seed = 11;
  const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  bc.fillStyle = tokens.star;
  for (let i = 0; i < 220; i++) {
    bc.globalAlpha = 0.06 + rand() * 0.22;
    bc.fillRect(rand() * width, rand() * height, 1.2, 1.2);
  }
  bc.globalAlpha = 1;
  const hexR = 34;
  bc.strokeStyle = tokens.hexGrid;
  bc.lineWidth = 1;
  for (let row = 0; row * hexR * 1.5 < height + hexR; row++) {
    for (let col = 0; col * hexR * Math.sqrt(3) < width + hexR; col++) {
      const cx2 = col * hexR * Math.sqrt(3) + (row % 2 ? (hexR * Math.sqrt(3)) / 2 : 0);
      const cy2 = row * hexR * 1.5;
      bc.beginPath();
      for (let i = 0; i < 6; i++) {
        const a = (Math.PI / 3) * i + Math.PI / 6;
        const px = cx2 + Math.cos(a) * hexR;
        const py = cy2 + Math.sin(a) * hexR;
        if (i === 0) bc.moveTo(px, py);
        else bc.lineTo(px, py);
      }
      bc.closePath();
      bc.stroke();
    }
  }
  const glow = bc.createRadialGradient(width / 2, height / 2, 10, width / 2, height / 2, Math.min(width, height) * 0.55);
  glow.addColorStop(0, tokens.accent + "1f");
  glow.addColorStop(0.4, tokens.light ? "#c084fc14" : "#2b0f4d22");
  glow.addColorStop(1, "transparent");
  bc.fillStyle = glow;
  bc.fillRect(0, 0, width, height);
  return bg;
}
