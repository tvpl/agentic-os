/**
 * The day's rhythm (refino item 53): quiet hours keep voice and sound off,
 * and the desk knows whether it is morning, day, evening or night so it can
 * dim at night and greet accordingly. Kept per browser; pure and tested.
 */
export interface QuietHours {
  enabled: boolean;
  /** Hour the quiet period starts (0–23). */
  start: number;
  /** Hour it ends (0–23); may be smaller than `start` when it crosses midnight. */
  end: number;
}

export const QUIET_KEY = "mordomo.quietHours";
export const DEFAULT_QUIET: QuietHours = { enabled: true, start: 22, end: 7 };

export function readQuietHours(storage: Pick<Storage, "getItem"> | null = safeStorage()): QuietHours {
  try {
    const raw = storage?.getItem(QUIET_KEY);
    if (!raw) return DEFAULT_QUIET;
    const q = JSON.parse(raw) as Partial<QuietHours>;
    return {
      enabled: q.enabled !== false,
      start: clampHour(q.start ?? DEFAULT_QUIET.start),
      end: clampHour(q.end ?? DEFAULT_QUIET.end),
    };
  } catch {
    return DEFAULT_QUIET;
  }
}

export function storeQuietHours(
  q: QuietHours,
  storage: Pick<Storage, "setItem"> | null = safeStorage(),
): void {
  try {
    storage?.setItem(QUIET_KEY, JSON.stringify(q));
  } catch {
    /* ignore */
  }
}

/** True inside the quiet period; a period that crosses midnight wraps. */
export function isQuiet(q: QuietHours, at: Date = new Date()): boolean {
  if (!q.enabled) return false;
  const h = at.getHours();
  if (q.start === q.end) return false;
  return q.start < q.end ? h >= q.start && h < q.end : h >= q.start || h < q.end;
}

export type DayPhase = "morning" | "day" | "evening" | "night";

export function dayPhase(at: Date = new Date()): DayPhase {
  const h = at.getHours();
  if (h >= 5 && h < 11) return "morning";
  if (h >= 11 && h < 18) return "day";
  if (h >= 18 && h < 22) return "evening";
  return "night";
}

function clampHour(n: number): number {
  return Number.isFinite(n) ? Math.max(0, Math.min(23, Math.round(n))) : 0;
}

function safeStorage(): Storage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}
