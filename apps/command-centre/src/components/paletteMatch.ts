/**
 * Command-palette matching (pure, tested): a small fuzzy scorer with prefix
 * and word-boundary boosts plus keyword aliases. No dependencies.
 */

export interface Matchable {
  id: string;
  /** Primary text (name / title). */
  label: string;
  /** Aliases and synonyms (slug, translations, "reindex", "rebuild"...). */
  keywords?: readonly string[];
}

export interface Ranked<T> {
  item: T;
  score: number;
}

/** Lowercase, strip diacritics and collapse whitespace. */
export function normalize(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Score of `query` against `text` (both raw). 0 = no match.
 *   prefix ............... 100 (+ up to 10 for a short target)
 *   word-boundary start ..  85
 *   substring ............  70
 *   subsequence ..........  10..45 (gaps cost points)
 */
export function fuzzyScore(query: string, text: string): number {
  const q = normalize(query);
  const t = normalize(text);
  if (!q) return 1;
  if (!t) return 0;
  if (t.startsWith(q)) return 100 + Math.max(0, 10 - Math.floor((t.length - q.length) / 4));
  const idx = t.indexOf(q);
  if (idx > 0) return t[idx - 1] === " " || t[idx - 1] === "-" || t[idx - 1] === "/" || t[idx - 1] === "." ? 85 : 70;
  // subsequence: every query char in order
  let ti = 0;
  let gaps = 0;
  let last = -1;
  for (const ch of q) {
    const found = t.indexOf(ch, ti);
    if (found < 0) return 0;
    if (last >= 0 && found > last + 1) gaps += found - last - 1;
    last = found;
    ti = found + 1;
  }
  return Math.max(10, 45 - gaps * 2);
}

/** Best score across the label and its keywords (keywords cap at 90 so a real prefix on the label wins). */
export function scoreItem(item: Matchable, query: string): number {
  let best = fuzzyScore(query, item.label);
  for (const kw of item.keywords ?? []) {
    const s = Math.min(90, fuzzyScore(query, kw));
    if (s > best) best = s;
  }
  return best;
}

/** Rank and filter; an empty query keeps the input order. */
export function rankItems<T extends Matchable>(items: readonly T[], query: string, limit = Infinity): Ranked<T>[] {
  const q = normalize(query);
  if (!q) return items.slice(0, limit).map((item) => ({ item, score: 1 }));
  const out: Ranked<T>[] = [];
  items.forEach((item, index) => {
    const score = scoreItem(item, q);
    if (score > 0) out.push({ item, score: score * 1000 - index });
  });
  out.sort((a, b) => b.score - a.score);
  return out.slice(0, limit).map((r) => ({ item: r.item, score: Math.round(r.score / 1000) }));
}

/** Split `text` into [before, match, after] for highlighting a substring hit; null when not a substring. */
export function highlightRange(text: string, query: string): [string, string, string] | null {
  const q = normalize(query);
  if (!q) return null;
  const idx = normalize(text).indexOf(q);
  if (idx < 0 || normalize(text).length !== text.length) return null;
  return [text.slice(0, idx), text.slice(idx, idx + q.length), text.slice(idx + q.length)];
}
