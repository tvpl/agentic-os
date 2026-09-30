/**
 * The Skills scene's arsenal ring (immersive shell): pure geometry.
 *
 * Skills carry no category of their own, so one is read from their words
 * (slug, name, triggers, description) and the ring is laid out as sectors —
 * one per category, a small gap between them, favourites first inside each.
 * Angles are degrees clockwise from east (CSS `rotate()`), so the ring turns
 * a skill to the top with a rotation of `-90 - angle`.
 */

export const SKILL_CATEGORIES = ["agents", "code", "memory", "research", "think", "create", "other"] as const;
export type SkillCategory = (typeof SKILL_CATEGORIES)[number];

/** Word starts that put a skill in a category (`=word`: the whole word only); earlier categories win ties. */
const RULES: ReadonlyArray<readonly [Exclude<SkillCategory, "other">, readonly string[]]> = [
  ["agents", ["agent", "subagent", "claude", "mcp", "harness", "optimi", "otimiz", "prompt", "hook"]],
  [
    "code",
    [
      "code",
      "coding",
      "codific",
      "código",
      "codigo",
      "review",
      "revis",
      "diff",
      "branch",
      "bug",
      "refactor",
      "test",
      "sdd",
      "spec",
      "gauntlet",
      "implement",
      "lint",
      "depend",
      "commit",
      "deploy",
    ],
  ],
  [
    "memory",
    [
      "memory",
      "memória",
      "memoria",
      "=brain",
      "cérebro",
      "cerebro",
      "recall",
      "remember",
      "lembr",
      "notes",
      "notas",
      "digest",
      "journal",
      "consolid",
    ],
  ],
  ["research", ["news", "notícia", "noticia", "research", "pesquis", "search", "web", "source", "fonte"]],
  [
    "think",
    ["brainstorm", "idea", "ideia", "plan", "think", "pens", "decid", "decision", "strateg", "estrat"],
  ],
  [
    "create",
    [
      "pixel",
      "icon",
      "ícone",
      "icone",
      "image",
      "imagem",
      "html",
      "page",
      "página",
      "design",
      "write",
      "escrev",
      "document",
      "explain",
      "explica",
      "sprite",
      "slide",
      "draw",
    ],
  ],
];

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/** A keyword counts only at the start of a word: "test" is not in "latest". */
const PATTERNS = RULES.map(
  ([cat, words]) =>
    [
      cat,
      words.map((w) =>
        w.startsWith("=")
          ? new RegExp(`(?:^|[^\\p{L}\\p{N}])${escape(w.slice(1))}(?![\\p{L}\\p{N}])`, "iu")
          : new RegExp(`(?:^|[^\\p{L}\\p{N}])${escape(w)}`, "iu"),
      ),
    ] as const,
);

export interface CategoryText {
  slug: string;
  /** Canonical and localized names. */
  names: readonly string[];
  triggers: readonly string[];
  /** Canonical and localized descriptions. */
  descriptions: readonly string[];
}

/** The category a skill reads as: the most keyword hits, weighted by where they land. */
export function categoryOf(text: CategoryText): SkillCategory {
  const fields: Array<[string, number]> = [
    [text.slug.replace(/[-_]+/g, " "), 3],
    [text.names.join("\n"), 2],
    [text.triggers.join("\n"), 2],
    [text.descriptions.join("\n"), 1],
  ];
  let best: SkillCategory = "other";
  let bestScore = 0;
  for (const [cat, patterns] of PATTERNS) {
    let score = 0;
    for (const [field, weight] of fields) {
      for (const re of patterns) if (re.test(field)) score += weight;
    }
    if (score > bestScore) {
      best = cat;
      bestScore = score;
    }
  }
  return best;
}

export interface SectorItem {
  slug: string;
  category: SkillCategory;
  favorite: boolean;
  /** Display name, for the order inside a sector. */
  name: string;
}

export interface Sector<T extends SectorItem> {
  category: SkillCategory;
  items: T[];
}

/** Items grouped by category in the fixed category order; favourites first, then by name. */
export function groupSectors<T extends SectorItem>(items: readonly T[]): Sector<T>[] {
  const out: Sector<T>[] = [];
  for (const category of SKILL_CATEGORIES) {
    const inCat = items
      .filter((x) => x.category === category)
      .sort(
        (a, b) =>
          Number(b.favorite) - Number(a.favorite) ||
          a.name.localeCompare(b.name, undefined, { sensitivity: "base" }) ||
          a.slug.localeCompare(b.slug),
      );
    if (inCat.length > 0) out.push({ category, items: inCat });
  }
  return out;
}

/** Past this, one ring's names start to touch: items alternate on two rings. */
export const SINGLE_RING_MAX = 24;
/** Past this, even two rings crowd: the ring pages by sector. */
export const PAGE_MAX = 48;
/** The empty space between two sectors, in item slots. */
export const SECTOR_GAP = 0.7;

export interface RingSlot {
  /** Degrees, clockwise from east. */
  angle: number;
  /** 0 the outer ring, 1 the inner one (only when there are two). */
  ring: 0 | 1;
}
export interface RingSector {
  start: number;
  end: number;
  mid: number;
}
export interface RingLayout {
  slots: RingSlot[];
  sectors: RingSector[];
  rings: 1 | 2;
}

/** Where each item and each sector sits, for sectors of the given sizes (in order). */
export function ringLayout(sizes: readonly number[], singleMax = SINGLE_RING_MAX): RingLayout {
  const live = sizes.filter((n) => n > 0);
  const n = live.reduce((a, b) => a + b, 0);
  const rings: 1 | 2 = n > singleMax ? 2 : 1;
  if (n === 0) return { slots: [], sectors: [], rings };
  const gap = live.length > 1 ? SECTOR_GAP : 0;
  const total = n + gap * live.length;
  const step = 360 / total;
  const slots: RingSlot[] = [];
  const sectors: RingSector[] = [];
  let cursor = gap / 2;
  for (const size of sizes) {
    if (size <= 0) continue;
    const start = cursor * step;
    for (let i = 0; i < size; i++) {
      const idx = slots.length;
      slots.push({ angle: (cursor + 0.5) * step, ring: rings === 2 && idx % 2 === 1 ? 1 : 0 });
      cursor += 1;
    }
    const end = cursor * step;
    sectors.push({ start, end, mid: (start + end) / 2 });
    cursor += gap;
  }
  return { slots, sectors, rings };
}

/**
 * The ring's next rotation so the item at `angle` lands at the top, turning
 * the short way round from `prev` (the value keeps growing past ±360 so the
 * transition never spins the long way).
 */
export function nextRotation(prev: number, angle: number): number {
  const target = -90 - angle;
  const delta = ((((target - prev) % 360) + 540) % 360) - 180;
  return prev + delta;
}

/** Sectors split into pages of at most `max` items, breaking only at sector edges (a sector larger than `max` is cut). */
export function paginate<T extends SectorItem>(sectors: readonly Sector<T>[], max = PAGE_MAX): Sector<T>[][] {
  const pages: Sector<T>[][] = [];
  let page: Sector<T>[] = [];
  let count = 0;
  const flush = () => {
    if (page.length) pages.push(page);
    page = [];
    count = 0;
  };
  for (const sector of sectors) {
    for (let i = 0; i < sector.items.length; i += max) {
      const chunk = sector.items.slice(i, i + max);
      if (count + chunk.length > max) flush();
      page.push({ category: sector.category, items: chunk });
      count += chunk.length;
    }
  }
  flush();
  return pages;
}

export interface Orbit {
  rx: number;
  ry: number;
  /** Names sit outside the orbit (1) or inside it (-1). */
  out: 1 | -1;
}
export interface RingGeometry {
  orbits: Orbit[];
  /** Where the sector labels run; null when the middle needs their room. */
  label: { rx: number; ry: number } | null;
  /** The room left in the middle for the chosen skill. */
  centre: { w: number; h: number };
  /** The middle is small: the chosen skill shows only its essentials. */
  compact: boolean;
}

/** Half a name's width plus half a glyph: how far a name sits from its glyph, sideways and up/down. */
export const NAME_OFFSET = { x: 70, y: 36 };

/** What the chosen skill's typography needs, top to bottom. */
export const CENTRE_MIN_H = 250;
/** Half a sector label's width and height, and the room kept around it. */
const LABEL_HALF = { x: 48, y: 7 };

/**
 * A box inside the ellipse (a, b) at least `minH` tall when it can be, as
 * wide as that allows up to `maxHalfW` either side: along an ellipse a
 * narrower box is a taller one.
 */
export function inscribedBox(a: number, b: number, minH: number, maxHalfW: number): { w: number; h: number } {
  const need = Math.min(1, minH / 2 / b);
  const x = Math.max(0, Math.min(maxHalfW, a * Math.sqrt(1 - need ** 2)));
  return { w: 2 * x, h: 2 * b * Math.sqrt(Math.max(0, 1 - (x / a) ** 2)) };
}

/** Below this width the sector labels give the middle their room. */
export const CENTRE_MIN_W = 360;
/** Below this width, even without them, the chosen skill's typography goes compact. */
export const CENTRE_COMPACT_W = 300;

/**
 * The ring for a stage of `w` × `h`: an orbit as wide as the stage allows
 * (an ellipse on a wide screen, a circle on a square one) with room for the
 * names outside it, sector labels just inside, the chosen skill in what
 * remains. When the middle gets too small the labels give up their room,
 * and past that the middle goes compact.
 */
export function ringGeometry(w: number, h: number, rings: 1 | 2): RingGeometry {
  const ryMax = Math.max(110, h / 2 - 62);
  const rx = Math.max(140, Math.min(w / 2 - NAME_OFFSET.x - 54, ryMax * 1.9));
  const ry = Math.min(ryMax, rx * 1.15);
  const fit = (a: number, b: number) => {
    const box = inscribedBox(Math.max(1, a), Math.max(1, b), CENTRE_MIN_H, 270);
    return { w: Math.max(160, box.w), h: Math.max(120, box.h) };
  };
  if (rings === 2) {
    const inner: Orbit = { rx: rx * 0.7, ry: ry * 0.64, out: -1 };
    const centre = fit(inner.rx - 15 - NAME_OFFSET.x * 1.5, inner.ry - 17 - NAME_OFFSET.y);
    return {
      orbits: [{ rx, ry, out: 1 }, inner],
      label: { rx: rx * 0.85, ry: ry * 0.82 },
      centre,
      compact: true,
    };
  }
  const orbits: Orbit[] = [{ rx, ry, out: 1 }];
  const label = { rx: rx - 72, ry: ry - 36 };
  const withLabels = fit(label.rx - LABEL_HALF.x - 6, label.ry - LABEL_HALF.y - 6);
  if (withLabels.w >= CENTRE_MIN_W) return { orbits, label, centre: withLabels, compact: false };
  const bare = fit(rx - 15 - 16, ry - 17 - 16);
  return { orbits, label: null, centre: bare, compact: bare.w < CENTRE_COMPACT_W };
}
