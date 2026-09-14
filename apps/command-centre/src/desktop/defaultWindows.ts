/**
 * The desktop's first composition, and the smallest box each window may take
 * (redesign F4a).
 *
 * Positions are stored in pixels, but the *default* is expressed as fractions
 * of the stage: a first run on a 1280×800 laptop and on a 2560×1440 monitor
 * should both open composed, not with a 1440-pixel layout clamped into a
 * smaller screen. The fractions are the three-column composition the grid
 * used to produce, so nothing about the first impression changes — only what
 * the user can do to it afterwards.
 */
import { WIDGET_ORDER, baseId, type WidgetId } from "./defaultLayout";
import { MIN_H, MIN_W, clampIntoStage, normalizeZ, type Size, type WindowMap } from "./windowModel";

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

export const DEFAULT_SPECS: Record<WidgetId, Spec> = {
  now: { fx: SIDE, fy: 0, fw: CENTRE, fh: 0.4, visible: true },
  prompt: { fx: SIDE, fy: 0.4, fw: CENTRE, fh: 0.45, visible: true },
  attention: { fx: SIDE, fy: 0.85, fw: CENTRE, fh: 0.15, visible: true },
  today: { fx: 0, fy: 0, fw: SIDE, fh: 0.5, visible: true },
  workspace: { fx: 0, fy: 0.5, fw: SIDE, fh: 0.25, visible: true },
  cost: { fx: 0, fy: 0.75, fw: SIDE, fh: 0.25, visible: true },
  deck: { fx: RIGHT, fy: 0, fw: SIDE, fh: 0.5, visible: true },
  routines: { fx: RIGHT, fy: 0.5, fw: SIDE, fh: 0.25, visible: true },
  pulse: { fx: RIGHT, fy: 0.75, fw: SIDE, fh: 0.25, visible: true },
  // Available from the gallery, not part of the first impression.
  microapps: { fx: 0.06, fy: 0.06, fw: 0.2, fh: 0.35, visible: false },
  inbox: { fx: 0.24, fy: 0.06, fw: 0.28, fh: 0.3, visible: false },
  agenda: { fx: 0.3, fy: 0.12, fw: 0.28, fh: 0.25, visible: false },
  calendar: { fx: 0.36, fy: 0.18, fw: 0.28, fh: 0.35, visible: false },
  email: { fx: 0.42, fy: 0.24, fw: 0.28, fh: 0.35, visible: false },
};

/**
 * Smallest box per widget, in CSS pixels — what the body needs before it
 * starts clipping. The console's floor is the one that matters: its thread,
 * field and button row need ~170 px of body under ~72 px of frame.
 */
export const WINDOW_MIN: Partial<Record<string, Size>> = {
  now: { w: 360, h: 200 },
  prompt: { w: 380, h: 260 },
  today: { w: 260, h: 180 },
  deck: { w: 260, h: 200 },
  routines: { w: 260, h: 150 },
  microapps: { w: MIN_W, h: 150 },
  attention: { w: 300, h: MIN_H },
};

export function minFor(id: string | undefined): Size {
  if (id && isDocId(id)) return { w: 320, h: 220 };
  return (id && WINDOW_MIN[baseId(id)]) || { w: MIN_W, h: MIN_H };
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
  WIDGET_ORDER.forEach((id, i) => {
    const spec = DEFAULT_SPECS[id];
    const box = {
      x: Math.round(spec.fx * stage.w),
      y: Math.round(spec.fy * stage.h),
      w: Math.round(spec.fw * stage.w),
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
 * registered widget present (falling back to its default box), unknown ids
 * dropped, duplicates kept, and everything clamped back into view.
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
    const base = baseId(id);
    // A duplicate ("today:2") of a known widget; anything else is stale.
    if (id === base || !(WIDGET_ORDER as readonly string[]).includes(base)) continue;
    out[id] = clampIntoStage(
      { ...defaults[base as WidgetId]!, visible: false, ...saved } as WindowMap[string],
      stage,
      minFor(id),
    );
  }
  // Raising a window bumps the top of the stack; a long session would persist
  // ever-growing integers. Reading is where they get compacted back to 1..n.
  return normalizeZ(out);
}
