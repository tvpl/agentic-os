/**
 * The desktop's first composition, and the smallest box each window may take
 * (redesign F4a, recomposed in F7).
 *
 * Positions are stored in pixels, but the *default* is expressed as fractions
 * of the stage: a first run on a 1280×800 laptop and on a 2560×1440 monitor
 * should both open composed, not with a 1440-pixel layout clamped into a
 * smaller screen.
 *
 * F7 changed what "composed" means. The fractions used to reproduce the old
 * three-column grid, which is exactly why the running app still read as the
 * dashboard it was meant to replace: nine panels, all open, before the user
 * had asked for anything. The stage now opens clear — console, pods, dock and
 * the memory field — and every other window is one pod away. The fractions
 * below are still where each one lands when it is opened; they are a
 * destination now, not a first impression.
 */
import { WIDGET_ORDER, type WidgetId } from "./defaultLayout";
import { APPS, appKindOf } from "./apps";
import { FORM_BOX, RUN_BOX, isFormPanelId, isRunPanelId } from "./runPanels";
import {
  ARC_MARGIN,
  MIN_H,
  MIN_W,
  clampIntoStage,
  normalizeZ,
  type Size,
  type WindowMap,
} from "./windowModel";

/** Fractions of the stage: x, y, w, h in 0–1, plus the initial stacking order. */
interface Spec {
  fx: number;
  fy: number;
  fw: number;
  fh: number;
  visible: boolean;
}

const SIDE = 5 / 24;
const CENTRE = 14 / 24;
const RIGHT = 19 / 24;

/**
 * Where each window lands when a pod opens it. Nothing is on the stage at
 * first boot — the console is fixed over it (G4), not a window — and each
 * instrument keeps the column it used to sit in, so opening three of them
 * still composes instead of piling up at one corner.
 */
export const DEFAULT_SPECS: Record<WidgetId, Spec> = {
  now: { fx: SIDE, fy: 0, fw: CENTRE, fh: 0.4, visible: false },
  attention: { fx: SIDE, fy: 0.85, fw: CENTRE, fh: 0.15, visible: false },
  approvals: { fx: SIDE, fy: 0.1, fw: 0.34, fh: 0.4, visible: false },
  cost: { fx: 0, fy: 0.75, fw: SIDE, fh: 0.25, visible: false },
  routines: { fx: RIGHT, fy: 0.5, fw: SIDE, fh: 0.25, visible: false },
  pulse: { fx: RIGHT, fy: 0.75, fw: SIDE, fh: 0.25, visible: false },
  inbox: { fx: 0.24, fy: 0.06, fw: 0.28, fh: 0.3, visible: false },
};

/**
 * Smallest box per widget, in CSS pixels — what the body needs before it
 * starts clipping.
 */
export const WINDOW_MIN: Partial<Record<string, Size>> = {
  now: { w: 360, h: 200 },
  routines: { w: 260, h: 150 },
  attention: { w: 300, h: MIN_H },
};

export function minFor(id: string | undefined): Size {
  if (id && isDocId(id)) return { w: 320, h: 220 };
  if (id && appKindOf(id)) return { w: 420, h: 320 };
  if (id && isRunPanelId(id)) return { w: 420, h: 280 };
  if (id && isFormPanelId(id)) return { w: 340, h: 240 };
  return (id && WINDOW_MIN[id]) || { w: MIN_W, h: MIN_H };
}

/**
 * Document windows (redesign F5): a window whose content is a file the agent
 * produced or the user opened, rather than a registry widget. The id carries
 * the path so the layout is self-describing and a reopened desktop knows what
 * to render without a second lookup.
 */
const DOC_PREFIX = "doc:";
export const docId = (path: string): string => DOC_PREFIX + path;
export const isDocId = (id: string): boolean => id.startsWith(DOC_PREFIX);
export const docPath = (id: string): string => id.slice(DOC_PREFIX.length);
/** Default box for a freshly opened document. */
export const DOC_BOX: Size = { w: 460, h: 340 };

/** The first composition, materialised for the stage it will open on. */
export function defaultWindows(stage: Size): WindowMap {
  const out: WindowMap = {};
  // The pod arcs float over both edges: the first composition is laid out in
  // the space between them, so nothing opens underneath a pod.
  const usable = Math.max(320, stage.w - ARC_MARGIN * 2);
  WIDGET_ORDER.forEach((id, i) => {
    const spec = DEFAULT_SPECS[id];
    const box = {
      x: Math.round(ARC_MARGIN + spec.fx * usable),
      y: Math.round(spec.fy * stage.h),
      w: Math.round(spec.fw * usable),
      h: Math.round(spec.fh * stage.h),
      z: i + 1,
      visible: spec.visible,
      minimized: false,
    };
    out[id] = clampIntoStage(box, stage, minFor(id));
  });
  return out;
}

/**
 * A stored layout, made safe for the stage it is about to be drawn on: every
 * registered panel present (falling back to its default box), documents kept,
 * unknown ids dropped, and everything clamped back into view.
 */
export function normalizeWindows(
  stored: Partial<Record<string, Partial<WindowMap[string]>>> | undefined,
  stage: Size,
): WindowMap {
  const defaults = defaultWindows(stage);
  const out: WindowMap = {};
  for (const id of WIDGET_ORDER) {
    const fallback = defaults[id]!;
    const saved = stored?.[id];
    out[id] = clampIntoStage({ ...fallback, ...saved } as WindowMap[string], stage, minFor(id));
  }
  for (const [id, saved] of Object.entries(stored ?? {})) {
    if (out[id]) continue;
    if (isDocId(id)) {
      // A document the user had open: kept, so reopening the desktop puts the
      // work back where it was.
      out[id] = clampIntoStage(
        {
          x: 40,
          y: 40,
          ...DOC_BOX,
          z: 1,
          visible: true,
          ...saved,
        } as WindowMap[string],
        stage,
        minFor(id),
      );
      continue;
    }
    if (isRunPanelId(id) || isFormPanelId(id)) {
      // A trace or a form the user had open: kept, so the desk comes back
      // as it was — a finished run's trace is still worth reading.
      const size = isRunPanelId(id) ? RUN_BOX : FORM_BOX;
      out[id] = clampIntoStage(
        { x: 60, y: 60, ...size, z: 1, visible: true, ...saved } as WindowMap[string],
        stage,
        minFor(id),
      );
      continue;
    }
    const app = appKindOf(id);
    if (app) {
      // An app the user had open: kept, at its own size when the stored box
      // is unreadable.
      out[id] = clampIntoStage(
        { x: 40, y: 40, ...APPS[app].size, z: 1, visible: true, ...saved } as WindowMap[string],
        stage,
        minFor(id),
      );
      continue;
    }
    // Anything else is a widget this version no longer has: dropped, not kept.
  }
  // Raising a window bumps the top of the stack; a long session would persist
  // ever-growing integers. Reading is where they get compacted back to 1..n.
  return normalizeZ(out);
}
