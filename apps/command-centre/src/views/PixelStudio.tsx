import { useCallback, useEffect, useRef, useState } from "react";
import {
  Copy,
  Download,
  Eraser,
  FlipHorizontal2,
  Layers,
  PaintBucket,
  Pause,
  Pencil,
  Pipette,
  Play,
  Plus,
  Save,
  Trash2,
  Undo2,
} from "lucide-react";
import { api } from "../api";
import { useT } from "../i18n";
import { useToast } from "../components/ui";

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

function downloadUrl(url: string, filename: string): void {
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
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

const PXS_CSS = `
.pxs-layout { display: grid; grid-template-columns: 236px minmax(0, 1fr) 300px; gap: 14px; align-items: start; }
@media (max-width: 980px) { .pxs-layout { grid-template-columns: 1fr; } }
.pxs-layout .card { margin: 0; }
.pxs-col { display: flex; flex-direction: column; gap: 14px; }
.pxs-checker {
  background-color: var(--bg);
  background-image: conic-gradient(color-mix(in srgb, var(--text) 8%, transparent) 25%, transparent 0 50%, color-mix(in srgb, var(--text) 8%, transparent) 0 75%, transparent 0);
  background-size: 14px 14px;
}
.pxs-stage {
  position: relative; width: 100%; max-width: 620px; margin: 0 auto; aspect-ratio: 1;
  border: 1px solid var(--border-strong); border-radius: var(--radius-sm); overflow: hidden;
  box-shadow: 0 0 0 1px color-mix(in srgb, var(--accent) 18%, transparent), 0 0 28px -10px color-mix(in srgb, var(--accent) 45%, transparent);
}
.pxs-stage canvas { display: block; width: 100%; height: 100%; image-rendering: pixelated; touch-action: none; cursor: crosshair; }
.pxs-gridlines {
  position: absolute; inset: 0; pointer-events: none;
  background-image:
    linear-gradient(to right, color-mix(in srgb, var(--text) 10%, transparent) 1px, transparent 1px),
    linear-gradient(to bottom, color-mix(in srgb, var(--text) 10%, transparent) 1px, transparent 1px);
  background-size: var(--pxs-cell) var(--pxs-cell);
}
.pxs-toolgrid { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; }
.pxs-tool {
  display: flex; align-items: center; gap: 6px; padding: 7px 8px;
  border: 1px solid var(--border-strong); border-radius: var(--radius-sm);
  background: var(--bg-raise); color: var(--text-dim); font: inherit; font-weight: 550; font-size: 11.5px;
  cursor: pointer; transition: background 0.12s ease, border-color 0.12s ease, color 0.12s ease;
  min-width: 0; overflow: hidden; white-space: nowrap; text-overflow: ellipsis;
}
.pxs-tool svg { flex-shrink: 0; }
.pxs-tool svg { width: 14px; height: 14px; }
.pxs-tool:hover { background: var(--bg-raise-2); color: var(--text); }
.pxs-tool.active { border-color: var(--accent); color: var(--accent); background: color-mix(in srgb, var(--accent) 12%, var(--bg-raise)); }
.pxs-tool .pxs-key { margin-left: auto; }
.pxs-swatches { display: grid; grid-template-columns: repeat(8, 1fr); gap: 5px; }
.pxs-swatch {
  aspect-ratio: 1; width: 100%; border-radius: 5px; border: 1px solid var(--border-strong);
  cursor: pointer; padding: 0; transition: transform 0.1s ease;
}
.pxs-swatch:hover { transform: scale(1.14); }
.pxs-swatch.active { outline: 2px solid var(--accent); outline-offset: 1px; }
.pxs-current { display: flex; align-items: center; gap: 10px; margin-top: 10px; }
.pxs-current .pxs-chip { width: 30px; height: 30px; border-radius: 6px; border: 1px solid var(--border-strong); flex-shrink: 0; }
.pxs-colorinput { width: 34px; height: 30px; padding: 0; border: 1px solid var(--border-strong); border-radius: 6px; background: var(--bg-raise); cursor: pointer; }
.pxs-frames { display: flex; flex-wrap: wrap; gap: 8px; }
.pxs-frame {
  position: relative; width: 52px; height: 52px; padding: 0; cursor: pointer;
  border: 1px solid var(--border-strong); border-radius: var(--radius-sm); overflow: hidden;
}
.pxs-frame:hover { border-color: var(--text-faint); }
.pxs-frame.active { border-color: var(--accent); box-shadow: 0 0 0 1px var(--accent); }
.pxs-frame canvas { display: block; width: 100%; height: 100%; image-rendering: pixelated; }
.pxs-frame .pxs-frame-n {
  position: absolute; bottom: 1px; right: 3px; font-size: 10px; font-family: var(--mono);
  color: var(--text); text-shadow: 0 0 3px var(--bg), 0 0 3px var(--bg);
}
.pxs-preview-row { display: flex; align-items: flex-end; gap: 14px; justify-content: center; padding: 8px 0; }
.pxs-preview-box { border: 1px solid var(--border); border-radius: 4px; }
.pxs-preview-box canvas { display: block; image-rendering: pixelated; }
.pxs-fps { display: flex; align-items: center; gap: 8px; font-size: 12px; color: var(--text-dim); }
.pxs-fps input[type="range"] { flex: 1; accent-color: var(--accent); }
.pxs-stack { display: flex; flex-direction: column; gap: 7px; }
`;

export default function PixelStudio() {
  const t = usePixelT();
  const toast = useToast();

  const [size, setSize] = useState<GridSize>(16);
  const [frames, setFrames] = useState<Frame[]>(() => [makeFrame(16)]);
  const [current, setCurrent] = useState(0);
  const [tool, setTool] = useState<Tool>("pencil");
  const [color, setColor] = useState<string | null>("#29adff");
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

  const frame = frames[current] ?? frames[0] ?? makeFrame(size);

  /* ---------- undo ---------- */
  const pushUndo = useCallback(() => {
    undoRef.current.push({ frames: cloneFrames(frames), size, current });
    if (undoRef.current.length > MAX_UNDO) undoRef.current.shift();
  }, [frames, size, current]);

  const undo = useCallback(() => {
    const snap = undoRef.current.pop();
    if (!snap) return;
    setFrames(snap.frames);
    setSize(snap.size);
    setCurrent(Math.min(snap.current, snap.frames.length - 1));
  }, []);

  /* ---------- painting ---------- */
  const applyAt = useCallback(
    (x: number, y: number, first: boolean) => {
      if (x < 0 || y < 0 || x >= size || y >= size) return;
      if (tool === "eyedropper") {
        const picked = frames[current]?.[y * size + x] ?? null;
        setColor(picked);
        if (typeof picked === "string") setCustomColor(picked);
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
      setFrames((prev) => {
        const next = prev.slice();
        const f = next[current];
        if (!f) return prev;
        const nf = f.slice();
        nf[y * size + x] = value;
        if (mirrorX) nf[y * size + (size - 1 - x)] = value;
        next[current] = nf;
        return next;
      });
    },
    [tool, color, mirrorX, size, current, frames, pushUndo],
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
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "z") {
      e.preventDefault();
      undo();
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
  const changeSize = (next: GridSize) => {
    if (next === size) return;
    if (next < size && frames.some((f) => hasPixelsOutside(f, size, next))) {
      if (!window.confirm(t("pixel.gridConfirm"))) return;
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

  const deleteFrame = () => {
    if (frames.length <= 1) return;
    if (!window.confirm(t("pixel.deleteConfirm"))) return;
    pushUndo();
    setFrames((prev) => prev.filter((_, i) => i !== current));
    setCurrent(Math.max(0, current - 1));
  };

  const clearFrame = () => {
    if (!window.confirm(t("pixel.clearConfirm"))) return;
    pushUndo();
    setFrames((prev) => {
      const next = prev.slice();
      next[current] = makeFrame(size);
      return next;
    });
  };

  /* ---------- export ---------- */
  const exportPng = () => downloadUrl(frameToPngDataUrl(frame, size, EXPORT_SCALE), `${saveName || "sprite"}.png`);

  const exportSheet = () =>
    downloadUrl(sheetToPngDataUrl(frames, size, EXPORT_SCALE), `${saveName || "sprite"}.sheet.png`);

  const exportSvg = () => {
    const blob = new Blob([frameToSvg(frame, size)], { type: "image/svg+xml" });
    const url = URL.createObjectURL(blob);
    downloadUrl(url, `${saveName || "sprite"}.svg`);
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
      <style>{PXS_CSS}</style>
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
              <button className="btn danger sm" onClick={clearFrame}>
                <Trash2 aria-hidden /> {t("pixel.clear")}
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
                  onClick={() => setColor(c)}
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
              <input
                type="color"
                className="pxs-colorinput"
                value={customColor}
                onChange={(e) => {
                  setCustomColor(e.target.value);
                  setColor(e.target.value);
                }}
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
          </div>

          <div className="card">
            <h2>{t("pixel.preview")}</h2>
            <PreviewBoxes frames={frames} size={size} playing={playing} fps={fps} current={current} />
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
}: {
  frames: Frame[];
  size: GridSize;
  playing: boolean;
  fps: number;
  current: number;
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
        <canvas ref={ref4x} width={size} height={size} style={{ width: size * 4, height: size * 4 }} aria-label="Preview" />
      </div>
    </div>
  );
}
