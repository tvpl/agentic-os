/**
 * The Skills scene's filters and type-to-find (immersive shell): pure.
 *
 * Filters take skills off the ring (mode, provider, favourites, paused);
 * the typed filter only dims what does not match and turns the ring to the
 * best match, so the arsenal keeps its shape while you look.
 */
import type { ProviderId, Skill } from "../../api";

export type ModeFilter = "all" | "read_only" | "write";
export type ProviderFilter = "all" | ProviderId;

export interface SkillFilters {
  mode: ModeFilter;
  provider: ProviderFilter;
  favOnly: boolean;
  /** Paused (disabled) skills join the ring. */
  showPaused: boolean;
}

export const NO_FILTERS: SkillFilters = { mode: "all", provider: "all", favOnly: false, showPaused: false };

type Filterable = Pick<Skill, "slug" | "mode" | "providers" | "enabled" | "favorite">;

/** What the filters leave on the ring; `keep` (the deep-linked skill) stays whatever they say. */
export function filterSkills<T extends Filterable>(
  skills: readonly T[],
  f: SkillFilters,
  keep?: string,
): T[] {
  return skills.filter(
    (s) =>
      s.slug === keep ||
      ((f.showPaused || s.enabled) &&
        (f.mode === "all" || s.mode === f.mode) &&
        (f.provider === "all" || s.providers.includes(f.provider)) &&
        (!f.favOnly || Boolean(s.favorite))),
  );
}

export interface MatchText {
  slug: string;
  /** Canonical and localized names. */
  names: readonly string[];
  triggers: readonly string[];
  /** Canonical and localized descriptions. */
  descriptions: readonly string[];
}

/**
 * How well `query` finds a skill: 0 when a word is missing everywhere;
 * otherwise, per word, the best place it lands — the start of the slug
 * outranks the slug or name, which outranks a trigger, then the description.
 */
export function matchScore(text: MatchText, query: string): number {
  const words = query.trim().toLowerCase().replace(/^\//, "").split(/\s+/).filter(Boolean);
  if (words.length === 0) return 0;
  const slug = text.slug.toLowerCase();
  const names = text.names.join("\n").toLowerCase();
  const triggers = text.triggers.join("\n").toLowerCase();
  const desc = text.descriptions.join("\n").toLowerCase();
  let score = 0;
  for (const w of words) {
    const s = slug.startsWith(w)
      ? 5
      : slug.includes(w) || names.includes(w)
        ? 3
        : triggers.includes(w)
          ? 2
          : desc.includes(w)
            ? 1
            : 0;
    if (s === 0) return 0;
    score += s;
  }
  return score;
}

/** The best match's slug, in ring order on ties (favourites first when `favorite` says so), or null. */
export function bestMatch(
  items: ReadonlyArray<{ slug: string; favorite?: boolean; score: number }>,
): string | null {
  let best: { slug: string; favorite?: boolean; score: number } | null = null;
  for (const it of items) {
    if (it.score <= 0) continue;
    if (!best || it.score > best.score || (it.score === best.score && it.favorite && !best.favorite))
      best = it;
  }
  return best?.slug ?? null;
}

/** The voice line's text with `/slug ` in front, replacing a slash command already there. */
export function withSlashCommand(text: string, slug: string): string {
  const rest = text
    .trimStart()
    .replace(/^\/[\w.-]+(?:\s+|$)/, "")
    .trimEnd();
  return rest ? `/${slug} ${rest}` : `/${slug} `;
}

/** Index `i` moved by `delta` around a ring of `n`. */
export function stepIndex(i: number, delta: number, n: number): number {
  if (n <= 0) return 0;
  return (((i + delta) % n) + n) % n;
}
