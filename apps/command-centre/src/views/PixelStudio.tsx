import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Braces,
  ChevronLeft,
  ChevronRight,
  Copy,
  Download,
  Eraser,
  FlipHorizontal2,
  Layers,
  Minus,
  PaintBucket,
  Pause,
  Pencil,
  Pipette,
  Play,
  Plus,
  Redo2,
  Repeat,
  Save,
  Trash2,
  Undo2,
} from "lucide-react";
import { api } from "../api";
import { useT } from "../i18n";
import { useToast } from "../components/ui";
import { useConfirm } from "../hooks/useConfirm";
import { downloadUrl as downloadFile } from "./shared";
import "./apps.css";

/* =========================================================================
   Pixel Studio — a self-contained pixel-art drawing + animation micro-app.
   A frame is a flat array of length size*size; each cell is a hex color
   string or null (transparent).
   ========================================================================= */

type GridSize = 16 | 24 | 32;
type Tool = "pencil" | "eraser" | "fill" | "eyedropper";
type Frame = Array<string | null>;

const GRID_SIZES: GridSize[] = [16, 24, 32];
const MAX_FRAMES = 24;
const MAX_UNDO = 40;
const EXPORT_SCALE = 16;
const NAME_RE = /^[a-z0-9][a-z0-9-]{0,39}$/;
const DRAFT_KEY = "pixel-studio-draft";
export const MAX_BRUSH = 4;
export const MAX_RECENTS = 8;

/** PICO-8 palette — 16 well-loved retro colors. */
const PALETTE = [
  "#000000", "#1d2b53", "#7e2553", "#008751",
  "#ab5236", "#5f574f", "#c2c3c7", "#fff1e8",
  "#ff004d", "#ffa300", "#ffec27", "#00e436",
  "#29adff", "#83769c", "#ff77a8", "#ffccaa",
];

function makeFrame(size: GridSize): Frame {
  return new Array<string | null>(size * size).fill(null);
}

function cloneFrames(frames: Frame[]): Frame[] {
  return frames.map((f) => f.slice());
}

/** Copy the top-left min(from,to) square; pad or crop the rest. */
function resizeFrame(frame: Frame, from: GridSize, to: GridSize): Frame {
  const next = makeFrame(to);
  const n = Math.min(from, to);
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      next[y * to + x] = frame[y * from + x] ?? null;
    }
  }
  return next;
}

function hasPixelsOutside(frame: Frame, from: GridSize, to: GridSize): boolean {
  for (let y = 0; y < from; y++) {
    for (let x = 0; x < from; x++) {
      if ((x >= to || y >= to) && frame[y * from + x]) return true;
    }
  }
  return false;
}

function floodFill(frame: Frame, size: GridSize, sx: number, sy: number, color: string | null): Frame {
  const target = frame[sy * size + sx] ?? null;
  if (target === color) return frame;
  const next = frame.slice();
  const stack: number[] = [sy * size + sx];
  while (stack.length > 0) {
    const i = stack.pop();
    if (i === undefined) break;
    if ((next[i] ?? null) !== target) continue;
    next[i] = color;
    const x = i % size;
    if (x > 0) stack.push(i - 1);
    if (x < size - 1) stack.push(i + 1);
    if (i >= size) stack.push(i - size);
    if (i < size * (size - 1)) stack.push(i + size);
  }
  return next;
}

/** Brush size clamped to 1…MAX_BRUSH (`+` / `-` never leave the range). */
export function clampBrush(n: number): number {
  return Math.max(1, Math.min(MAX_BRUSH, Math.round(n)));
}

/**
 * Indices painted by a brush of `brush` cells centred on (x, y), clipped to
 * the grid. Brush 1 is the single cell under the pointer.
 */
export function brushCells(x: number, y: number, size: number, brush: number): number[] {
  const b = clampBrush(brush);
  const offset = Math.floor((b - 1) / 2);
  const out: number[] = [];
  for (let dy = 0; dy < b; dy++) {
    for (let dx = 0; dx < b; dx++) {
      const cx = x - offset + dx;
      const cy = y - offset + dy;
      if (cx < 0 || cy < 0 || cx >= size || cy >= size) continue;
      out.push(cy * size + cx);
    }
  }
  return out;
}

/** Most recently used colours, newest first, deduped and bounded. */
export function pushRecent(list: readonly string[], color: string | null, max = MAX_RECENTS): string[] {
  if (!color) return [...list];
  return [color, ...list.filter((c) => c !== color)].slice(0, max);
}

/** `[` / `]` frame navigation: wraps around at both ends. */
export function stepFrame(current: number, total: number, delta: number): number {
  if (total <= 0) return 0;
  return (((current + delta) % total) + total) % total;
}

export interface SpriteMetadata {
  name: string;
  format: "sprite-sheet";
  frames: number;
  frameWidth: number;
  frameHeight: number;
  sheetWidth: number;
  sheetHeight: number;
  scale: number;
  fps: number;
  palette: string[];
  generatedAt: string;
}

/** Metadata that travels with the exported sprite sheet (frame boxes + palette). */
export function spriteMetadata(
  name: string,
  frames: readonly Frame[],
  size: GridSize,
  scale: number,
  fps: number,
  now: Date = new Date(),
): SpriteMetadata {
  const palette = new Set<string>();
  for (const f of frames) for (const c of f) if (c) palette.add(c);
  return {
    name,
    format: "sprite-sheet",
    frames: frames.length,
    frameWidth: size * scale,
    frameHeight: size * scale,
    sheetWidth: size * scale * frames.length,
    sheetHeight: size * scale,
    scale,
    fps,
    palette: [...palette].sort(),
    generatedAt: now.toISOString(),
  };
}

function get2d(canvas: HTMLCanvasElement): CanvasRenderingContext2D {
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas 2D context unavailable");
  return ctx;
}

function paintFrame(ctx: CanvasRenderingContext2D, frame: Frame, size: number, scale = 1, ox = 0): void {
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const c = frame[y * size + x];
      if (!c) continue;
      ctx.fillStyle = c;
      ctx.fillRect(ox + x * scale, y * scale, scale, scale);
    }
  }
}

function frameToPngDataUrl(frame: Frame, size: GridSize, scale: number): string {
  const c = document.createElement("canvas");
  c.width = size * scale;
  c.height = size * scale;
  paintFrame(get2d(c), frame, size, scale);
  return c.toDataURL("image/png");
}

function sheetToPngDataUrl(frames: Frame[], size: GridSize, scale: number): string {
  const c = document.createElement("canvas");
  c.width = size * scale * frames.length;
  c.height = size * scale;
  const ctx = get2d(c);
  frames.forEach((f, i) => paintFrame(ctx, f, size, scale, i * size * scale));
  return c.toDataURL("image/png");
}

function frameToSvg(frame: Frame, size: GridSize): string {
  const rects: string[] = [];
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const c = frame[y * size + x];
      if (c) rects.push(`<rect x="${x}" y="${y}" width="1" height="1" fill="${c}"/>`);
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" shape-rendering="crispEdges">${rects.join("")}</svg>`;
}

/** The dictionary is typed on its known keys; pixel.* keys fall back to the key. */
function usePixelT(): (key: string) => string {
  const t = useT();
  return useCallback((key: string) => t(key as Parameters<typeof t>[0]), [t]);
}

interface Snapshot {
  frames: Frame[];
  size: GridSize;
  current: number;
}


export default function PixelStudio() {
  const t = usePixelT();
  const toast = useToast();
  const confirm = useConfirm();
  const navigate = useNavigate();
  const dirtyRef = useRef(false);
  const restoredRef = useRef(false);

  const [size, setSize] = useState<GridSize>(16);
  const [frames, setFrames] = useState<Frame[]>(() => [makeFrame(16)]);
  const [current, setCurrent] = useState(0);
  const [tool, setTool] = useState<Tool>("pencil");
  const [color, setColor] = useState<string | null>("#29adff");
  const [secondary, setSecondary] = useState<string | null>("#fff1e8");
  const [recents, setRecents] = useState<string[]>([]);
  const [brush, setBrush] = useState(1);
  const [customColor, setCustomColor] = useState("#29adff");
  const [mirrorX, setMirrorX] = useState(false);
  const [onion, setOnion] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [fps, setFps] = useState(6);
  const [saveName, setSaveName] = useState("sprite");
  const [saving, setSaving] = useState(false);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawingRef = useRef(false);
  const undoRef = useRef<Snapshot[]>([]);
  const redoRef = useRef<Snapshot[]>([]);

  const frame = frames[current] ?? frames[0] ?? makeFrame(size);

  /* ---------- draft persistence + unsaved-work guard (audit 6.8) ---------- */
  useEffect(() => {
    if (restoredRef.current) return;
    restoredRef.current = true;
    try {
      const raw = localStorage.getItem(DRAFT_KEY);
      if (!raw) return;
      const d = JSON.parse(raw) as Snapshot;
      if (!GRID_SIZES.includes(d.size) || !Array.isArray(d.frames) || d.frames.length === 0) return;
      setSize(d.size);
      setFrames(d.frames);
      setCurrent(Math.min(d.current, d.frames.length - 1));
      dirtyRef.current = true;
      toast(t("pixel.draftRestored"), "info");
    } catch {
      /* storage blocked or corrupt draft */
    }
  }, [toast, t]);
  useEffect(() => {
    const id = window.setTimeout(() => {
      try {
        if (frames.some((f) => f.some((c) => c !== null))) localStorage.setItem(DRAFT_KEY, JSON.stringify({ size, frames, current }));
        else localStorage.removeItem(DRAFT_KEY);
      } catch {
        /* storage blocked */
      }
    }, 400);
    return () => window.clearTimeout(id);
  }, [frames, size, current]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || !dirtyRef.current) return;
      if (["INPUT", "TEXTAREA", "SELECT"].includes(document.activeElement?.tagName ?? "")) return;
      if ((e.target as Element | null)?.closest?.('[role="dialog"]')) return;
      e.stopPropagation();
      e.preventDefault();
      void confirm({ title: t("pixel.leaveTitle"), body: t("pixel.leaveBody"), danger: true, confirmLabel: t("pixel.leave") }).then((ok) => {
        if (ok) {
          dirtyRef.current = false;
          navigate("/");
        }
      });
    };
    const onUnload = (e: BeforeUnloadEvent) => {
      if (dirtyRef.current) e.preventDefault();
    };
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("beforeunload", onUnload);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("beforeunload", onUnload);
    };
  }, [confirm, navigate, t]);

  /* ---------- undo ---------- */
  const snapshot = useCallback((): Snapshot => ({ frames: cloneFrames(frames), size, current }), [frames, size, current]);

  const pushUndo = useCallback(() => {
    dirtyRef.current = true;
    undoRef.current.push(snapshot());
    if (undoRef.current.length > MAX_UNDO) undoRef.current.shift();
    // A new edit ends the redo branch, as in every editor.
    redoRef.current = [];
  }, [snapshot]);

  const applySnapshot = useCallback((snap: Snapshot) => {
    setFrames(snap.frames);
    setSize(snap.size);
    setCurrent(Math.min(snap.current, snap.frames.length - 1));
  }, []);

  const undo = useCallback(() => {
    const snap = undoRef.current.pop();
    if (!snap) return;
    redoRef.current.push(snapshot());
    if (redoRef.current.length > MAX_UNDO) redoRef.current.shift();
    applySnapshot(snap);
  }, [snapshot, applySnapshot]);

  const redo = useCallback(() => {
    const snap = redoRef.current.pop();
    if (!snap) return;
    undoRef.current.push(snapshot());
    if (undoRef.current.length > MAX_UNDO) undoRef.current.shift();
    applySnapshot(snap);
  }, [snapshot, applySnapshot]);

  /** Choosing a colour anywhere (palette, picker, eyedropper) feeds the recents row. */
  const chooseColor = useCallback((next: string | null) => {
    setColor(next);
    if (typeof next === "string") {
      setCustomColor(next);
      setRecents((prev) => pushRecent(prev, next));
    }
  }, []);

  const swapColors = useCallback(() => {
    setColor(secondary);
    setSecondary(color);
    if (typeof secondary === "string") setCustomColor(secondary);
  }, [color, secondary]);

  /* ---------- painting ---------- */
  const applyAt = useCallback(
    (x: number, y: number, first: boolean) => {
      if (x < 0 || y < 0 || x >= size || y >= size) return;
      if (tool === "eyedropper") {
        chooseColor(frames[current]?.[y * size + x] ?? null);
        return;
      }
      if (tool === "fill") {
        if (!first) return;
        pushUndo();
        setFrames((prev) => {
          const next = prev.slice();
          const f = next[current];
          if (f) next[current] = floodFill(f, size, x, y, color);
          return next;
        });
        return;
      }
      const value = tool === "eraser" ? null : color;
      if (first) pushUndo();
      const cells = brushCells(x, y, size, brush);
      setFrames((prev) => {
        const next = prev.slice();
        const f = next[current];
        if (!f) return prev;
        const nf = f.slice();
        for (const i of cells) {
          nf[i] = value;
          if (mirrorX) {
            const cx = i % size;
            nf[i - cx + (size - 1 - cx)] = value;
          }
        }
        next[current] = nf;
        return next;
      });
    },
    [tool, color, mirrorX, size, current, frames, brush, pushUndo, chooseColor],
  );

  const cellFromEvent = (e: React.PointerEvent<HTMLCanvasElement>): { x: number; y: number } => {
    const rect = e.currentTarget.getBoundingClientRect();
    return {
      x: Math.floor(((e.clientX - rect.left) / rect.width) * size),
      y: Math.floor(((e.clientY - rect.top) / rect.height) * size),
    };
  };

  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    drawingRef.current = true;
    const { x, y } = cellFromEvent(e);
    applyAt(x, y, true);
  };

  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawingRef.current) return;
    if (tool === "fill" || tool === "eyedropper") return;
    const { x, y } = cellFromEvent(e);
    applyAt(x, y, false);
  };

  const onPointerUp = () => {
    drawingRef.current = false;
  };

  /* ---------- main canvas render ---------- */
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = get2d(canvas);
    ctx.clearRect(0, 0, size, size);
    if (onion && current > 0) {
      const prev = frames[current - 1];
      if (prev) {
        ctx.globalAlpha = 0.28;
        paintFrame(ctx, prev, size);
        ctx.globalAlpha = 1;
      }
    }
    const f = frames[current];
    if (f) paintFrame(ctx, f, size);
  }, [frames, current, size, onion]);

  /* ---------- keyboard ---------- */
  const keyRef = useRef<(e: KeyboardEvent) => void>(() => {});
  keyRef.current = (e: KeyboardEvent) => {
    const target = e.target as HTMLElement | null;
    if (target && /^(input|textarea|select)$/i.test(target.tagName)) return;
    const mod = e.metaKey || e.ctrlKey;
    const key = e.key.toLowerCase();
    if (mod && (key === "y" || (key === "z" && e.shiftKey))) {
      e.preventDefault();
      redo();
      return;
    }
    if (mod && key === "z") {
      e.preventDefault();
      undo();
      return;
    }
    if (mod || e.altKey) return;
    if (e.key === "[" || e.key === "]") {
      e.preventDefault();
      setCurrent((c) => stepFrame(c, frames.length, e.key === "[" ? -1 : 1));
      return;
    }
    if (e.key === "+" || e.key === "=") {
      e.preventDefault();
      setBrush((b) => clampBrush(b + 1));
      return;
    }
    if (e.key === "-" || e.key === "_") {
      e.preventDefault();
      setBrush((b) => clampBrush(b - 1));
      return;
    }
    if (key === "x") {
      e.preventDefault();
      swapColors();
      return;
    }
    if (key === "o") {
      e.preventDefault();
      setOnion((v) => !v);
      return;
    }
    const tools: Record<string, Tool> = { "1": "pencil", "2": "eraser", "3": "fill", "4": "eyedropper" };
    const next = tools[e.key];
    if (next) setTool(next);
  };
  useEffect(() => {
    const handler = (e: KeyboardEvent) => keyRef.current(e);
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  /* ---------- grid size ---------- */
  const changeSize = async (next: GridSize) => {
    if (next === size) return;
    if (next < size && frames.some((f) => hasPixelsOutside(f, size, next))) {
      if (!(await confirm({ title: t("pixel.gridConfirm"), danger: true }))) return;
    }
    pushUndo();
    setFrames((prev) => prev.map((f) => resizeFrame(f, size, next)));
    setSize(next);
  };

  /* ---------- frame ops ---------- */
  const addFrame = () => {
    if (frames.length >= MAX_FRAMES) return;
    pushUndo();
    setFrames((prev) => [...prev, makeFrame(size)]);
    setCurrent(frames.length);
  };

  const duplicateFrame = () => {
    if (frames.length >= MAX_FRAMES) return;
    pushUndo();
    setFrames((prev) => {
      const f = prev[current];
      if (!f) return prev;
      const next = prev.slice();
      next.splice(current + 1, 0, f.slice());
      return next;
    });
    setCurrent(current + 1);
  };

  const deleteFrame = async () => {
    if (frames.length <= 1) return;
    if (!(await confirm({ title: t("pixel.deleteConfirm"), danger: true, confirmLabel: t("common.delete") }))) return;
    pushUndo();
    setFrames((prev) => prev.filter((_, i) => i !== current));
    setCurrent(Math.max(0, current - 1));
  };

  const clearFrame = async () => {
    if (!(await confirm({ title: t("pixel.clearConfirm"), danger: true }))) return;
    pushUndo();
    setFrames((prev) => {
      const next = prev.slice();
      next[current] = makeFrame(size);
      return next;
    });
  };

  /* ---------- export ---------- */
  const exportPng = () => downloadFile(frameToPngDataUrl(frame, size, EXPORT_SCALE), `${saveName || "sprite"}.png`);

  const exportSheet = () =>
    downloadFile(sheetToPngDataUrl(frames, size, EXPORT_SCALE), `${saveName || "sprite"}.sheet.png`);

  /** Sprite sheet + the JSON an engine needs to slice it (frame boxes, palette, fps). */
  const exportSheetWithMeta = () => {
    const name = saveName || "sprite";
    downloadFile(sheetToPngDataUrl(frames, size, EXPORT_SCALE), `${name}.sheet.png`);
    const meta = spriteMetadata(name, frames, size, EXPORT_SCALE, fps);
    const blob = new Blob([JSON.stringify(meta, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    downloadFile(url, `${name}.json`);
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  };

  const exportSvg = () => {
    const blob = new Blob([frameToSvg(frame, size)], { type: "image/svg+xml" });
    const url = URL.createObjectURL(blob);
    downloadFile(url, `${saveName || "sprite"}.svg`);
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  };

  /* ---------- save to artifacts ---------- */
  const saveToArtifacts = async () => {
    if (!NAME_RE.test(saveName)) {
      toast(t("pixel.nameInvalid"), "danger");
      return;
    }
    setSaving(true);
    try {
      const body: { name: string; dataUrl: string; spriteSheetDataUrl?: string; frames: number } = {
        name: saveName,
        dataUrl: frameToPngDataUrl(frame, size, EXPORT_SCALE),
        frames: frames.length,
      };
      if (frames.length > 1) body.spriteSheetDataUrl = sheetToPngDataUrl(frames, size, EXPORT_SCALE);
      const res = await api.post<{ saved: string[] }>("/api/microapps/pixel/save", body);
      toast(`${t("pixel.saved")} ${res.saved.join(", ")}`, "ok");
      dirtyRef.current = false;
    } catch (err) {
      toast((err as Error).message, "danger");
    } finally {
      setSaving(false);
    }
  };

  const tools: Array<{ id: Tool; icon: JSX.Element; key: string }> = [
    { id: "pencil", icon: <Pencil aria-hidden />, key: "1" },
    { id: "eraser", icon: <Eraser aria-hidden />, key: "2" },
    { id: "fill", icon: <PaintBucket aria-hidden />, key: "3" },
    { id: "eyedropper", icon: <Pipette aria-hidden />, key: "4" },
  ];

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>{t("pixel.title")}</h1>
          <p className="sub">{t("pixel.sub")}</p>
        </div>
        <div className="head-actions">
          <div className="segmented" role="group" aria-label={t("pixel.grid")}>
            {GRID_SIZES.map((s) => (
              <button key={s} className={size === s ? "active" : ""} onClick={() => changeSize(s)}>
                {s}×{s}
              </button>
            ))}
          </div>
          <button
            className={`pxs-tool${onion ? " active" : ""}`}
            onClick={() => setOnion((v) => !v)}
            aria-pressed={onion}
            title={t("pixel.onion")}
          >
            <Layers aria-hidden /> {t("pixel.onion")}
            <span className="kbd pxs-key">o</span>
          </button>
        </div>
      </div>

      <div className="pxs-layout">
        {/* ---- left: tools + palette ---- */}
        <div className="pxs-col">
          <div className="card">
            <h2>{t("pixel.tools")}</h2>
            <div className="pxs-toolgrid">
              {tools.map((tl) => (
                <button
                  key={tl.id}
                  className={`pxs-tool${tool === tl.id ? " active" : ""}`}
                  onClick={() => setTool(tl.id)}
                  aria-pressed={tool === tl.id}
                >
                  {tl.icon} {t(`pixel.tool.${tl.id}`)}
                  <span className="kbd pxs-key">{tl.key}</span>
                </button>
              ))}
            </div>
            <div className="pxs-stack" style={{ marginTop: 10 }}>
              <button
                className={`pxs-tool${mirrorX ? " active" : ""}`}
                onClick={() => setMirrorX((v) => !v)}
                aria-pressed={mirrorX}
              >
                <FlipHorizontal2 aria-hidden /> {t("pixel.mirror")}
              </button>
              <button className="pxs-tool" onClick={undo}>
                <Undo2 aria-hidden /> {t("pixel.undo")}
                <span className="kbd pxs-key">⌘Z</span>
              </button>
              <button className="pxs-tool" onClick={redo}>
                <Redo2 aria-hidden /> {t("apps.pixel.redo")}
                <span className="kbd pxs-key">⌘⇧Z</span>
              </button>
              <button className="btn danger sm" onClick={clearFrame}>
                <Trash2 aria-hidden /> {t("pixel.clear")}
              </button>
            </div>
            <div className="pxs-brush" role="group" aria-label={t("apps.pixel.brush")}>
              <button className="btn sm" onClick={() => setBrush((b) => clampBrush(b - 1))} disabled={brush <= 1} aria-label={`${t("apps.pixel.brush")} -`}>
                <Minus aria-hidden />
              </button>
              <span className="pxs-brush-dots" aria-hidden>
                {Array.from({ length: MAX_BRUSH }, (_, i) => (
                  <i key={i} className={i < brush ? "on" : ""} />
                ))}
              </span>
              <span className="mono" aria-live="polite">
                {t("apps.pixel.brush")} {brush}
              </span>
              <button className="btn sm" onClick={() => setBrush((b) => clampBrush(b + 1))} disabled={brush >= MAX_BRUSH} aria-label={`${t("apps.pixel.brush")} +`}>
                <Plus aria-hidden />
              </button>
            </div>
          </div>

          <div className="card">
            <h2>{t("pixel.palette")}</h2>
            <div className="pxs-swatches">
              {PALETTE.map((c) => (
                <button
                  key={c}
                  className={`pxs-swatch${color === c ? " active" : ""}`}
                  style={{ background: c }}
                  onClick={() => chooseColor(c)}
                  aria-label={c}
                  title={c}
                />
              ))}
            </div>
            <div className="pxs-current">
              <span
                className={`pxs-chip${color === null ? " pxs-checker" : ""}`}
                style={color ? { background: color } : undefined}
                title={color ?? t("pixel.transparent")}
              />
              <span
                className={`pxs-secondary${secondary === null ? " pxs-checker" : ""}`}
                style={secondary ? { background: secondary } : undefined}
                title={`${t("apps.pixel.secondary")}: ${secondary ?? t("pixel.transparent")}`}
              />
              <input
                type="color"
                className="pxs-colorinput"
                value={customColor}
                onChange={(e) => chooseColor(e.target.value)}
                aria-label={t("pixel.custom")}
              />
              <button
                className={`pxs-swatch pxs-checker${color === null ? " active" : ""}`}
                style={{ width: 30, height: 30, flexShrink: 0 }}
                onClick={() => setColor(null)}
                aria-label={t("pixel.transparent")}
                title={t("pixel.transparent")}
              />
              <span className="mono" style={{ fontSize: 11, color: "var(--text-faint)" }}>
                {color ?? t("pixel.transparent")}
              </span>
            </div>
            <div className="pxs-hint-row">
              <button className="btn sm" onClick={swapColors}>
                <Repeat aria-hidden /> {t("apps.pixel.swap")}
                <span className="kbd pxs-key">x</span>
              </button>
            </div>
            <div className="pxs-recent" role="group" aria-label={t("apps.pixel.recent")}>
              {recents.map((c) => (
                <button key={c} className={`pxs-swatch${color === c ? " active" : ""}`} style={{ background: c }} onClick={() => chooseColor(c)} aria-label={c} title={c} />
              ))}
            </div>
            <p className="pxs-shortcuts">
              <strong>{t("apps.pixel.shortcuts")}:</strong> {t("apps.pixel.shortcutsBody")}
            </p>
          </div>
        </div>

        {/* ---- center: editor canvas ---- */}
        <div className="card">
          <h2>
            {t("pixel.canvas")} · {size}×{size} · {t("pixel.frame")} {current + 1}/{frames.length}
          </h2>
          <div className="pxs-stage pxs-checker" style={{ ["--pxs-cell" as string]: `calc(100% / ${size})` }}>
            <canvas
              ref={canvasRef}
              width={size}
              height={size}
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerCancel={onPointerUp}
              aria-label={t("pixel.canvas")}
            />
            <div className="pxs-gridlines" aria-hidden />
          </div>
        </div>

        {/* ---- right: animation + export + save ---- */}
        <div className="pxs-col">
          <div className="card">
            <h2>{t("pixel.frames")}</h2>
            <div className="pxs-frames">
              {frames.map((f, i) => (
                <button
                  key={i}
                  className={`pxs-frame pxs-checker${i === current ? " active" : ""}`}
                  onClick={() => setCurrent(i)}
                  aria-label={`${t("pixel.frame")} ${i + 1}`}
                  aria-pressed={i === current}
                >
                  <FrameThumb frame={f} size={size} />
                  <span className="pxs-frame-n">{i + 1}</span>
                </button>
              ))}
            </div>
            <div style={{ display: "flex", gap: 6, marginTop: 10, flexWrap: "wrap" }}>
              <button className="btn sm" onClick={addFrame} disabled={frames.length >= MAX_FRAMES}>
                <Plus aria-hidden /> {t("pixel.addFrame")}
              </button>
              <button className="btn sm" onClick={duplicateFrame} disabled={frames.length >= MAX_FRAMES}>
                <Copy aria-hidden /> {t("pixel.duplicate")}
              </button>
              <button className="btn sm danger" onClick={deleteFrame} disabled={frames.length <= 1}>
                <Trash2 aria-hidden /> {t("pixel.deleteFrame")}
              </button>
            </div>
            <div className="pxs-frame-nav">
              <button className="btn sm" onClick={() => setCurrent((c) => stepFrame(c, frames.length, -1))} disabled={frames.length <= 1} aria-label={t("apps.pixel.prevFrame")}>
                <ChevronLeft aria-hidden /> <span className="kbd pxs-key">[</span>
              </button>
              <button className="btn sm" onClick={() => setCurrent((c) => stepFrame(c, frames.length, 1))} disabled={frames.length <= 1} aria-label={t("apps.pixel.nextFrame")}>
                <span className="kbd pxs-key">]</span> <ChevronRight aria-hidden />
              </button>
            </div>
          </div>

          <div className="card">
            <h2>{t("pixel.preview")}</h2>
            <PreviewBoxes label={t("brain.preview")} frames={frames} size={size} playing={playing} fps={fps} current={current} />
            <div style={{ display: "flex", gap: 10, alignItems: "center", marginTop: 8 }}>
              <button className="btn primary sm" onClick={() => setPlaying((v) => !v)}>
                {playing ? <Pause aria-hidden /> : <Play aria-hidden />} {playing ? t("pixel.pause") : t("pixel.play")}
              </button>
              <label className="pxs-fps" style={{ flex: 1 }}>
                <span className="mono">{fps} {t("pixel.fps")}</span>
                <input
                  type="range"
                  min={2}
                  max={12}
                  step={1}
                  value={fps}
                  onChange={(e) => setFps(Number(e.target.value))}
                  aria-label={t("pixel.fps")}
                />
              </label>
            </div>
          </div>

          <div className="card">
            <h2>{t("pixel.export")}</h2>
            <div className="pxs-stack">
              <button className="btn sm" onClick={exportPng}>
                <Download aria-hidden /> {t("pixel.exportPng")}
              </button>
              <button className="btn sm" onClick={exportSheet} disabled={frames.length <= 1}>
                <Download aria-hidden /> {t("pixel.exportSheet")}
              </button>
              <button className="btn sm" onClick={exportSheetWithMeta} disabled={frames.length <= 1}>
                <Braces aria-hidden /> {t("apps.pixel.exportMeta")}
              </button>
              <button className="btn sm" onClick={exportSvg}>
                <Download aria-hidden /> {t("pixel.exportSvg")}
              </button>
            </div>
          </div>

          <div className="card">
            <h2>{t("pixel.save")}</h2>
            <div className="field" style={{ marginBottom: 8 }}>
              <label htmlFor="pxs-name">{t("pixel.saveName")}</label>
              <input
                id="pxs-name"
                className="input mono"
                value={saveName}
                placeholder={t("pixel.namePh")}
                onChange={(e) => setSaveName(e.target.value.toLowerCase())}
              />
              <span className="hint">{t("pixel.nameHint")}</span>
            </div>
            <button className="btn primary" onClick={saveToArtifacts} disabled={saving} style={{ width: "100%", justifyContent: "center" }}>
              {saving ? <span className="spinner" aria-hidden /> : <Save aria-hidden />} {t("pixel.saveBtn")}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ---------- small canvases ---------- */

function FrameThumb({ frame, size }: { frame: Frame; size: GridSize }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = get2d(canvas);
    ctx.clearRect(0, 0, size, size);
    paintFrame(ctx, frame, size);
  }, [frame, size]);
  return <canvas ref={ref} width={size} height={size} aria-hidden />;
}

function PreviewBoxes({
  frames,
  size,
  playing,
  fps,
  current,
  label,
}: {
  frames: Frame[];
  size: GridSize;
  playing: boolean;
  fps: number;
  current: number;
  label: string;
}) {
  const [tick, setTick] = useState(0);
  const ref1x = useRef<HTMLCanvasElement>(null);
  const ref4x = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (!playing) return;
    const id = setInterval(() => setTick((v) => v + 1), Math.round(1000 / fps));
    return () => clearInterval(id);
  }, [playing, fps]);

  const shown = playing ? tick % frames.length : Math.min(current, frames.length - 1);

  useEffect(() => {
    const frame = frames[shown];
    if (!frame) return;
    for (const ref of [ref1x, ref4x]) {
      const canvas = ref.current;
      if (!canvas) continue;
      const ctx = get2d(canvas);
      ctx.clearRect(0, 0, size, size);
      paintFrame(ctx, frame, size);
    }
  }, [frames, shown, size]);

  return (
    <div className="pxs-preview-row">
      <div className="pxs-preview-box pxs-checker">
        <canvas ref={ref1x} width={size} height={size} style={{ width: size, height: size }} aria-hidden />
      </div>
      <div className="pxs-preview-box pxs-checker">
        <canvas ref={ref4x} width={size} height={size} style={{ width: size * 4, height: size * 4 }} aria-label={label} />
      </div>
    </div>
  );
}
