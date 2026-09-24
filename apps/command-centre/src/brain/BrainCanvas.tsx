import { useWorkspace } from "../components/Workspace";
/**
 * The Second Brain canvas: owns the render loop (dirty-flagged, throttled to
 * ≤ 12 fps when nothing moves, paused while the tab is hidden), the theme
 * tokens and sprite cache, the ResizeObserver-cached rect, the minimap, and
 * every pointer gesture (pan, node drag/pin, wheel/trackpad, pinch).
 * All world mutations go through the engine; React state lives in the parent.
 */
import { useEffect, useRef, type MutableRefObject, type RefObject } from "react";
import { ClickChain } from "./engine/clicks";
import { tripsActive } from "./engine/explosion";
import { cancelFlight, stepFlight } from "./engine/flight";
import { hitTest as engineHitTest, screenToWorld, zoomAt, type Hit } from "./engine/hitTest";
import {
  alphasSettled,
  maxDisplacement,
  stepWorld,
  transformSettled,
  tweenTransform,
} from "./engine/physics";
import { clampZoom, type FileNode, type World } from "./engine/world";
import {
  buildBackground,
  createMinimapState,
  drawFrame,
  drawMinimap,
  makeRingDefs,
  type RingDef,
} from "./render/draw";
import { LabelRanker, LabelWidthCache } from "./render/labels";
import { createSprites } from "./render/sprites";
import { readCanvasTokens } from "./render/tokens";

export interface CanvasHandlers {
  onHover: (hit: Hit | null, sx: number, sy: number) => void;
  onClick: (hit: Hit) => void;
  onDoubleClick: (hit: Hit) => void;
  /** A file was dragged (it is now pinned at its new position). */
  onDragEnd: (node: FileNode) => void;
  /** The zoom changed by more than a hair (pushed from the render loop; no polling). */
  onZoom?: (k: number) => void;
}

export interface BrainCanvasProps {
  world: MutableRefObject<World>;
  canvasRef: RefObject<HTMLCanvasElement>;
  minimapRef: RefObject<HTMLCanvasElement>;
  /** Live CSS size of the canvas (updated by the ResizeObserver, read by the camera helpers). */
  viewRef: MutableRefObject<{ width: number; height: number }>;
  /** Bump to force a frame (hover, selection, filters…). */
  invalidateRef: MutableRefObject<number>;
  /** Written by the canvas: true when motion is reduced (OS setting or economy mode). */
  reduceMotionRef?: MutableRefObject<boolean>;
  ringLabels: { skills: string; memory: string; routines: string; apps: string };
  coreLabel: string;
  ariaLabel: string;
  describedBy: string;
  handlers: CanvasHandlers;
}

/** Idle frame interval (≈12 fps) when nothing moves. */
const IDLE_INTERVAL_MS = 83;
const WHEEL_ZOOM_PER_PX = 0.0065;
/** Screen pixels a pointer must travel before a press becomes a drag (pan or node pin). */
const DRAG_THRESHOLD_PX = 4;
/** Zoom readout resolution. */
const ZOOM_EPSILON = 0.005;

export function BrainCanvas({
  world,
  canvasRef,
  minimapRef,
  viewRef,
  invalidateRef,
  reduceMotionRef,
  ringLabels,
  coreLabel,
  ariaLabel,
  describedBy,
  handlers,
}: BrainCanvasProps) {
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;
  const ringDefsRef = useRef<RingDef[]>(makeRingDefs(ringLabels));
  const coreLabelRef = useRef(coreLabel);
  const draggingRef = useRef(false);

  const { economy } = useWorkspace();
  // Ring guides are rebuilt only when the language changes, never per frame (A.1).
  useEffect(() => {
    ringDefsRef.current = makeRingDefs(ringLabels);
    invalidateRef.current++;
  }, [ringLabels, invalidateRef]);
  useEffect(() => {
    coreLabelRef.current = coreLabel;
    invalidateRef.current++;
  }, [coreLabel, invalidateRef]);

  /* ---------- render loop ---------- */
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const w = world.current;
    const motionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
    let reduceMotion = economy || motionQuery.matches;
    if (reduceMotionRef) reduceMotionRef.current = reduceMotion;
    const onMotion = () => {
      reduceMotion = economy || motionQuery.matches;
      if (reduceMotionRef) reduceMotionRef.current = reduceMotion;
      invalidateRef.current++;
    };
    motionQuery.addEventListener("change", onMotion);

    let tokens = readCanvasTokens();
    let sprites = createSprites(tokens);
    let background: HTMLCanvasElement | null = null;
    let rect = { width: canvas.clientWidth || 1, height: canvas.clientHeight || 1 };
    let dpr = Math.min(window.devicePixelRatio || 1, 2);
    const minimap = createMinimapState();
    const labelRanker = new LabelRanker();
    const labelWidths = new LabelWidthCache();

    const resize = () => {
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      const r = canvas.getBoundingClientRect();
      rect = { width: Math.max(1, r.width), height: Math.max(1, r.height) };
      viewRef.current = { width: rect.width, height: rect.height };
      canvas.width = Math.max(1, Math.floor(rect.width * dpr));
      canvas.height = Math.max(1, Math.floor(rect.height * dpr));
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      background = buildBackground(rect.width, rect.height, tokens);
      invalidateRef.current++;
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);

    const themeObserver = new MutationObserver(() => {
      tokens = readCanvasTokens();
      sprites = createSprites(tokens);
      background = buildBackground(rect.width, rect.height, tokens);
      minimap.layerStamp = "";
      invalidateRef.current++;
    });
    themeObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme", "data-accent", "style", "class"],
    });

    let raf = 0;
    let last = performance.now();
    let lastDraw = 0;
    let seenDirty = -1;
    let running = true;
    let lastZoom = -1;

    /** True while anything on screen still moves (full frame rate); false → idle throttle. */
    const isMoving = (): boolean => {
      if (draggingRef.current) return true;
      if (w.effects.length > 0 || w.comets.length > 0) return true;
      if (w.flight || !transformSettled(w)) return true;
      if (tripsActive(w.files)) return true;
      if (w.layout === "force" && w.sim && w.sim.alpha() > w.sim.alphaMin()) return true;
      return maxDisplacement(w) > 0.3;
    };
    const isActive = (moving: boolean): boolean => {
      if (moving) return true;
      if (seenDirty !== invalidateRef.current) return true;
      if (!reduceMotion && w.spin > 0) return true;
      return !alphasSettled(w);
    };

    const frame = (now: number) => {
      if (!running) return;
      raf = requestAnimationFrame(frame);
      if (economy && now - lastDraw < 1000 / 30) return;
      const moving = isMoving();
      if (!isActive(moving) && now - lastDraw < (economy ? 1000 : IDLE_INTERVAL_MS)) return;
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      lastDraw = now;
      seenDirty = invalidateRef.current;

      if (w.flight) stepFlight(w, w.time);
      else tweenTransform(w, dt);
      stepWorld(w, dt, !reduceMotion);
      if (Math.abs(w.transform.k - lastZoom) > ZOOM_EPSILON) {
        lastZoom = w.transform.k;
        handlersRef.current.onZoom?.(lastZoom);
      }
      drawFrame(ctx, w, {
        width: rect.width,
        height: rect.height,
        tNow: reduceMotion ? 0 : now / 1000,
        tokens,
        sprites,
        reduceMotion,
        ringDefs: ringDefsRef.current,
        background,
        coreLabel: coreLabelRef.current,
        labelRanker,
        labelWidths,
      });
      const mini = minimapRef.current;
      if (mini)
        drawMinimap(mini, w, minimap, {
          tokens,
          viewW: rect.width,
          viewH: rect.height,
          filesMoved: moving,
          dpr,
        });
    };

    const start = () => {
      if (!running || raf) return;
      last = performance.now();
      raf = requestAnimationFrame(frame);
    };
    const stop = () => {
      cancelAnimationFrame(raf);
      raf = 0;
    };
    const onVisibility = () => {
      if (document.hidden) stop();
      else {
        invalidateRef.current++;
        start();
      }
    };
    document.addEventListener("visibilitychange", onVisibility);
    if (!document.hidden) start();

    return () => {
      running = false;
      stop();
      ro.disconnect();
      themeObserver.disconnect();
      motionQuery.removeEventListener("change", onMotion);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [canvasRef, minimapRef, world, viewRef, invalidateRef, reduceMotionRef, economy]);

  /* ---------- pointer interaction ---------- */
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const w = world.current;
    const pointers = new Map<number, { x: number; y: number }>();
    let mode: "none" | "pan" | "node" | "pinch" = "none";
    let moved = false;
    let start = { x: 0, y: 0 };
    /** Screen position of the press: the drag threshold is measured from here. */
    let downAt = { x: 0, y: 0 };
    let dragNode: FileNode | null = null;
    let wasPinned = false;
    let pinchDist = 0;
    let pinchMid = { x: 0, y: 0 };
    let lastHoverId: string | null = null;
    /** What the last click landed on. The second press of a double-click and
     *  the dblclick event reuse it, because the first click's own camera
     *  flight has already moved that node away from under the pointer by the
     *  time they would be hit-tested (see engine/clicks). */
    const clicks = new ClickChain<Hit>();
    /** Hit a chained press will click on release (no live hit-test for it). */
    let pressHit: Hit | null = null;
    const click = (hit: Hit, e: PointerEvent) => {
      clicks.record(hit, performance.now(), e.clientX, e.clientY);
      handlersRef.current.onClick(hit);
    };

    const rectOf = () => canvas.getBoundingClientRect();
    const toWorld = (clientX: number, clientY: number) =>
      screenToWorld(w.transform, rectOf(), clientX, clientY);
    const hitAt = (clientX: number, clientY: number): Hit & { sx: number; sy: number } => {
      const p = toWorld(clientX, clientY);
      return { ...engineHitTest(w, p.x, p.y), sx: p.sx, sy: p.sy };
    };
    const hoverKeyOf = (hit: Hit): string | null =>
      hit.hub
        ? `hub:${hit.hub.key}`
        : hit.orb
          ? `${hit.orb.kind}:${hit.orb.id}`
          : hit.planet
            ? `planet:${hit.planet.hubKey}:${hit.planet.dir}`
            : null;

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      cancelFlight(w);
      const rect = rectOf();
      const tg = w.target;
      // Trackpad pinch arrives as ctrlKey + wheel; ⌘/ctrl + wheel is zoom too. A
      // classic mouse wheel (line deltas or large integer steps with no deltaX)
      // keeps zooming; a plain two-finger trackpad scroll pans (item 43).
      const mouseWheel =
        e.deltaMode !== 0 || (Math.abs(e.deltaY) >= 40 && e.deltaX === 0 && Number.isInteger(e.deltaY));
      if (e.ctrlKey || e.metaKey || mouseWheel) {
        const delta = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaMode === 2 ? e.deltaY * 100 : e.deltaY;
        const factor = Math.exp(
          -delta * (e.ctrlKey || e.metaKey ? WHEEL_ZOOM_PER_PX * 1.6 : WHEEL_ZOOM_PER_PX),
        );
        zoomAt(tg, rect, e.clientX, e.clientY, factor, clampZoom);
      } else {
        tg.x -= e.shiftKey && e.deltaX === 0 ? e.deltaY : e.deltaX;
        tg.y -= e.shiftKey && e.deltaX === 0 ? 0 : e.deltaY;
      }
      invalidateRef.current++;
    };

    const onDown = (e: PointerEvent) => {
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      canvas.setPointerCapture(e.pointerId);
      if (pointers.size === 2) {
        const [a, b] = [...pointers.values()];
        pinchDist = Math.hypot(a!.x - b!.x, a!.y - b!.y) || 1;
        pinchMid = { x: (a!.x + b!.x) / 2, y: (a!.y + b!.y) / 2 };
        if (dragNode) dragNode = null;
        cancelFlight(w);
        clicks.reset();
        pressHit = null;
        mode = "pinch";
        canvas.classList.remove("dragging", "dragging-node");
        return;
      }
      if (e.button !== 0 && e.pointerType === "mouse") return;
      moved = false;
      downAt = { x: e.clientX, y: e.clientY };
      // A press that continues the previous click (same spot, quick) acts on
      // what that click hit; it starts no node drag and is not hit-tested live.
      const { hit, reused } = clicks.hitForPress(performance.now(), e.clientX, e.clientY, () =>
        hitAt(e.clientX, e.clientY),
      );
      pressHit = reused ? hit : null;
      if (!reused && hit.file && !hit.hub && !hit.orb && !hit.planet) {
        mode = "node";
        dragNode = hit.file;
        wasPinned = dragNode.pinned;
        canvas.classList.add("dragging-node");
        draggingRef.current = true;
        return;
      }
      mode = "pan";
      start = { x: e.clientX - w.transform.x, y: e.clientY - w.transform.y };
      canvas.classList.add("dragging");
    };
    const pastThreshold = (e: PointerEvent): boolean =>
      Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y) > DRAG_THRESHOLD_PX;

    const onMove = (e: PointerEvent) => {
      if (pointers.has(e.pointerId)) pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (mode === "pinch" && pointers.size >= 2) {
        const [a, b] = [...pointers.values()];
        const dist = Math.hypot(a!.x - b!.x, a!.y - b!.y) || 1;
        const mid = { x: (a!.x + b!.x) / 2, y: (a!.y + b!.y) / 2 };
        const rect = rectOf();
        zoomAt(w.target, rect, mid.x, mid.y, dist / pinchDist, clampZoom);
        w.target.x += mid.x - pinchMid.x;
        w.target.y += mid.y - pinchMid.y;
        pinchDist = dist;
        pinchMid = mid;
        invalidateRef.current++;
        return;
      }
      if (mode === "node" && dragNode) {
        if (!moved && pastThreshold(e)) moved = true;
        if (!moved) return;
        const p = toWorld(e.clientX, e.clientY);
        dragNode.pinned = true;
        dragNode.trip = null;
        dragNode.x = p.x;
        dragNode.y = p.y;
        dragNode.vx = 0;
        dragNode.vy = 0;
        dragNode.fx = p.x;
        dragNode.fy = p.y;
        if (w.layout === "force" && w.sim) w.sim.alphaTarget(0.2).restart();
        invalidateRef.current++;
        return;
      }
      if (mode === "pan") {
        if (!moved && pastThreshold(e)) moved = true;
        if (!moved) return;
        // The pan takes over from any flight where the flight currently is.
        if (w.flight) {
          cancelFlight(w);
          start = { x: e.clientX - w.transform.x, y: e.clientY - w.transform.y };
        }
        const nx = e.clientX - start.x;
        const ny = e.clientY - start.y;
        w.transform.x = nx;
        w.transform.y = ny;
        w.target.x = nx;
        w.target.y = ny;
        w.target.k = w.transform.k;
        invalidateRef.current++;
        return;
      }
      if (e.pointerType === "touch") return;
      const hit = hitAt(e.clientX, e.clientY);
      w.hoverKey = hoverKeyOf(hit);
      const hoverId = w.hoverKey ?? (hit.file ? `file:${hit.file.id}` : null);
      if (hoverId === lastHoverId) return;
      lastHoverId = hoverId;
      invalidateRef.current++;
      handlersRef.current.onHover(hoverId ? hit : null, hit.sx + 14, hit.sy + 10);
    };

    const onUp = (e: PointerEvent) => {
      pointers.delete(e.pointerId);
      canvas.classList.remove("dragging", "dragging-node");
      draggingRef.current = false;
      const prevMode = mode;
      if (prevMode === "pinch") {
        if (pointers.size < 2) mode = "none";
        return;
      }
      mode = "none";
      if (prevMode === "node" && dragNode) {
        const node = dragNode;
        dragNode = null;
        if (w.layout === "force" && w.sim) w.sim.alphaTarget(0);
        if (moved) {
          clicks.reset();
          handlersRef.current.onDragEnd(node);
        } else {
          node.pinned = wasPinned;
          click({ file: node }, e);
        }
        invalidateRef.current++;
        return;
      }
      const chained = pressHit;
      pressHit = null;
      if (prevMode !== "pan" || moved) {
        if (moved) clicks.reset();
        return;
      }
      click(chained ?? hitAt(e.clientX, e.clientY), e);
    };

    const onCancel = (e: PointerEvent) => {
      pointers.delete(e.pointerId);
      canvas.classList.remove("dragging", "dragging-node");
      draggingRef.current = false;
      dragNode = null;
      pressHit = null;
      clicks.reset();
      mode = pointers.size >= 2 ? "pinch" : "none";
    };

    const onDblClick = (e: MouseEvent) => {
      handlersRef.current.onDoubleClick(
        clicks.hitForDoubleClick(performance.now(), () => hitAt(e.clientX, e.clientY)),
      );
    };
    const onLeave = () => {
      if (lastHoverId === null) return;
      lastHoverId = null;
      w.hoverKey = null;
      invalidateRef.current++;
      handlersRef.current.onHover(null, 0, 0);
    };

    canvas.addEventListener("wheel", onWheel, { passive: false });
    canvas.addEventListener("pointerdown", onDown);
    canvas.addEventListener("pointermove", onMove);
    canvas.addEventListener("pointerup", onUp);
    canvas.addEventListener("pointercancel", onCancel);
    canvas.addEventListener("pointerleave", onLeave);
    canvas.addEventListener("dblclick", onDblClick);
    return () => {
      canvas.removeEventListener("wheel", onWheel);
      canvas.removeEventListener("pointerdown", onDown);
      canvas.removeEventListener("pointermove", onMove);
      canvas.removeEventListener("pointerup", onUp);
      canvas.removeEventListener("pointercancel", onCancel);
      canvas.removeEventListener("pointerleave", onLeave);
      canvas.removeEventListener("dblclick", onDblClick);
    };
  }, [canvasRef, world, invalidateRef]);

  return (
    <canvas
      ref={canvasRef}
      className="brain-canvas"
      aria-label={ariaLabel}
      role="img"
      aria-describedby={describedBy}
    />
  );
}
