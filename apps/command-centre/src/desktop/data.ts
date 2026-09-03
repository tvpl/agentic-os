/** Small shared helpers for the desktop: queries with the desktop's cadence, tickers, palettes. */
import { useEffect, useState } from "react";
import { useOsArtifacts, useOsRoutines, useOsRuns } from "../queries";

export const ACTIVE_STATUSES = ["queued", "running", "waiting_approval"] as const;
export const isActiveStatus = (status: string): boolean => (ACTIVE_STATUSES as readonly string[]).includes(status);

/**
 * `/api/events` invalidates these on every run/routine change; the 30 s
 * interval is only a fallback for a dropped SSE connection.
 */
export const useDesktopRuns = () => useOsRuns({ limit: 200 }, { refetchInterval: 30_000 });
export const useDesktopRoutines = () => useOsRoutines({ refetchInterval: 30_000 });
export const useDesktopArtifacts = () => useOsArtifacts();

/** Re-renders every `ms`; returns Date.now(). */
export function useTicker(ms: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), ms);
    return () => window.clearInterval(id);
  }, [ms]);
  return now;
}

export function sameLocalDay(a: number, b: number): boolean {
  const da = new Date(a);
  const db = new Date(b);
  return da.getFullYear() === db.getFullYear() && da.getMonth() === db.getMonth() && da.getDate() === db.getDate();
}

/** "1h 05m 09s" / "12m 09s" / "42s" / "3d 4h" — locale-neutral units. */
export function formatCountdown(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const d = Math.floor(total / 86_400);
  const h = Math.floor((total % 86_400) / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${pad(m)}m ${pad(s)}s`;
  if (m > 0) return `${m}m ${pad(s)}s`;
  return `${s}s`;
}

/** Compact age for chips: "now", "5m", "3h", "2d". */
export function shortAge(ts: number, now = Date.now()): string {
  const minutes = Math.floor((now - ts) / 60_000);
  if (minutes < 1) return "now";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

export const AREA_COLORS = ["#c084fc", "#f472b6", "#fb923c", "#22d3ee", "#fde047", "#4ade80", "#a5b4fc"];
/** Same hues, darkened for a light ground where additive glow is off. */
export const AREA_COLORS_LIGHT = ["#7e22ce", "#be185d", "#c2410c", "#0e7490", "#a16207", "#15803d", "#4338ca"];
