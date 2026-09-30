/** Pure formatting for the shell (no DOM, no network). */

/** "2 h 05 min" / "12 min" / "< 1 min". */
export function formatIn(ms: number): string {
  const min = Math.max(0, Math.round(ms / 60_000));
  if (min < 1) return "< 1 min";
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  if (h >= 48) return `${Math.floor(h / 24)} d`;
  return `${h} h ${String(min % 60).padStart(2, "0")} min`;
}
