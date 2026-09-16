export const ONBOARDING_KEY = "mordomo.onboarding.v1";
export const ONBOARDING_EVENT = "mordomo:onboarding";
export const ONBOARDING_DRAFT_EVENT = "mordomo:onboarding-draft";

export const TOUR_STEPS = [
  { id: "desktop", chapter: 0, route: "/", target: '[data-onboarding="desktop"]' },
  { id: "modes", chapter: 0, route: "/", target: '[data-onboarding="modes"]' },
  { id: "console", chapter: 0, route: "/", target: '[data-panel="prompt"]' },
  { id: "providers", chapter: 1, route: "/settings?tab=providers", target: "#settings-tabs-panel-providers" },
  { id: "brain", chapter: 1, route: "/brain", target: '[data-onboarding="brain"]' },
  { id: "skills", chapter: 1, route: "/skills", target: '[data-onboarding="skills"] .page' },
  { id: "runs", chapter: 2, route: "/runs", target: '[data-onboarding="runs"] .page' },
  { id: "artifacts", chapter: 2, route: "/artifacts", target: '[data-onboarding="artifacts"] .page' },
  { id: "routines", chapter: 2, route: "/routines", target: '[data-onboarding="routines"] .page' },
  { id: "connectors", chapter: 3, route: "/connectors", target: '[data-onboarding="connectors"] .page' },
  { id: "pixel", chapter: 3, route: "/pixel", target: '[data-onboarding="pixel"] .page' },
  { id: "settings", chapter: 3, route: "/settings?tab=theme", target: "#settings-tabs-panel-theme" },
] as const;
export type StepId = (typeof TOUR_STEPS)[number]["id"];
export type TourStatus = "new" | "active" | "paused" | "completed";
export interface TourProgress {
  version: 1;
  status: TourStatus;
  step: number;
  visited: StepId[];
  practiced: boolean;
}
export const freshProgress = (): TourProgress => ({
  version: 1,
  status: "new",
  step: 0,
  visited: [],
  practiced: false,
});

/** Invalid or future storage must never prevent the OS from opening. */
export function parseProgress(raw: string | null): TourProgress {
  try {
    const p = JSON.parse(raw ?? "null") as Partial<TourProgress> | null;
    if (!p || p.version !== 1 || !["new", "active", "paused", "completed"].includes(p.status ?? ""))
      return freshProgress();
    return {
      version: 1,
      status: p.status!,
      step: Number.isInteger(p.step) ? Math.max(0, Math.min(TOUR_STEPS.length, p.step!)) : 0,
      visited: Array.isArray(p.visited)
        ? [...new Set(p.visited.filter((id) => TOUR_STEPS.some((s) => s.id === id)))]
        : [],
      practiced: p.practiced === true,
    };
  } catch {
    return freshProgress();
  }
}
export function readProgress(): TourProgress {
  try {
    return parseProgress(localStorage.getItem(ONBOARDING_KEY));
  } catch {
    return freshProgress();
  }
}
export function saveProgress(progress: TourProgress): void {
  try {
    localStorage.setItem(ONBOARDING_KEY, JSON.stringify(progress));
  } catch {
    /* Storage can be disabled; the tour still works for this visit. */
  }
}
export function openOnboarding(): void {
  window.dispatchEvent(new Event(ONBOARDING_EVENT));
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}
export function clipTarget(rect: Rect, width: number, height: number): Rect | null {
  const x = Math.max(8, rect.x - 8);
  const y = Math.max(8, rect.y - 8);
  const right = Math.min(width - 8, rect.x + rect.width + 8);
  const bottom = Math.min(height - 8, rect.y + rect.height + 8);
  return right > x && bottom > y ? { x, y, width: right - x, height: bottom - y } : null;
}

/** Choose the least obstructive corner, keeping the coach inside small viewports. */
export function placeCoach(target: Rect | null, width: number, height: number, card: Rect): Rect {
  const w = Math.min(card.width || 390, width - 24);
  const h = Math.min(card.height || 440, height - 96);
  const bottom = Math.max(72, height - h - 20);
  const right = Math.max(12, width - w - 20);
  const options = [
    { x: right, y: bottom },
    { x: 20, y: bottom },
    { x: right, y: 84 },
    { x: 20, y: 84 },
  ];
  const overlap = ({ x, y }: { x: number; y: number }) =>
    target
      ? Math.max(0, Math.min(x + w, target.x + target.width) - Math.max(x, target.x)) *
        Math.max(0, Math.min(y + h, target.y + target.height) - Math.max(y, target.y))
      : 0;
  const best = width < 700 ? { x: 12, y: bottom } : options.sort((a, b) => overlap(a) - overlap(b))[0]!;
  return { ...best, width: w, height: h };
}
