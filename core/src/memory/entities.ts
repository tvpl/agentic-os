import type { Db } from "../db/db.js";
import type { EventBus } from "../events.js";
import {
  ENTITY_KINDS,
  entityNorm,
  stemOf,
  type AcceptedName,
  type EntityKind,
  type MentionProof,
} from "./entityMentions.js";
import { MENTION_EXCERPT_MAX, findMention, mentionExcerpt, mentionFold } from "./mentions.js";
import { minhashMins } from "./minhash.js";

/**
 * The entities of the second brain (.specs/features/cerebro-entidades-resumos, doors 2 and 3): never stored, read from
 * the mentions a caller may see and the owner's corrections, in stages (the same norm, the gate, MinHash over the
 * names' 3-grams), and kept in a cache per audience until the next pass or correction.
 */

/** A mention as the read takes it: the row of `entity_mentions` with its file. */
export interface MentionRow {
  srcId: number;
  line: number;
  proof: MentionProof;
  kind: EntityKind;
  name: string;
  norm: string;
  /** The file: its absolute path and its title (a home note's shown name is its title, or its file name). */
  path: string;
  title: string | null;
}

export const CORRECTION_ACTIONS = ["merge", "separate", "ignore", "rename", "add", "reject"] as const;
export type CorrectionAction = (typeof CORRECTION_ACTIONS)[number];

/** A row of `entity_overrides` (door 3). */
export interface CorrectionRow {
  id: number;
  action: CorrectionAction;
  a: string;
  b: string | null;
  name: string | null;
  createdAt: number;
  undoneAt: number | null;
}

export interface Entity {
  key: string;
  kind: EntityKind;
  name: string;
  aliases: string[];
  /** Distinct files with a mention. */
  files: number;
  mentions: number;
  /** Mentions in more than `ENTITY_HUB_FILES` files: no edge of the graph goes through it (door 2). */
  hub: boolean;
  /** Every normalized name the entity holds, the canonical one first. */
  norms: string[];
  fileIds: number[];
  /** The home note (a `nota` mention's file), if any. */
  home: number | null;
  /** "Maybe the same": another entity with a name at estimated Jaccard 0.7 to 0.9 (AC 14). */
  duplicates: Array<{ key: string; name: string; similarity: number }>;
}

/** The precedence of the kinds (door 2): `perfil` > `projeto` > `tag` > `termo`. */
const PRECEDENCE: Record<EntityKind, number> = { perfil: 0, projeto: 1, tag: 2, termo: 3 };
/** A norm with fewer characters than this, without spaces, never enters MinHash (door 2, AC 12). */
export const ENTITY_GATE_CHARS = 6;
/** A norm whose characters have less Shannon entropy than this (bits) never enters MinHash. */
export const ENTITY_GATE_ENTROPY = 2.0;
export const ENTITY_MINHASH_FUNCTIONS = 32;
export const ENTITY_LSH_BANDS = 8;
export const ENTITY_LSH_ROWS = 4;
/** From this estimated Jaccard two names are one entity; from `ENTITY_DUPLICATE_SIMILARITY` they are "maybe the same". */
export const ENTITY_MERGE_SIMILARITY = 0.9;
export const ENTITY_DUPLICATE_SIMILARITY = 0.7;
/** An entity with mentions in more files than this is a hub. */
export const ENTITY_HUB_FILES = 50;
/** A `termo` is an entity only with mentions in at least this many files the audience sees (AC 16). */
export const TERM_MIN_FILES = 2;
/** At most this many corrections are active at once (AC 25). */
export const ENTITY_CORRECTIONS_MAX = 2000;

/** The Shannon entropy, in bits, of the characters of `norm` without its spaces. */
export function normEntropy(norm: string): number {
  const chars = [...norm.replace(/ /g, "")];
  if (chars.length === 0) return 0;
  const counts = new Map<string, number>();
  for (const ch of chars) counts.set(ch, (counts.get(ch) ?? 0) + 1);
  let h = 0;
  for (const c of counts.values()) {
    const p = c / chars.length;
    h -= p * Math.log2(p);
  }
  return h;
}

/** Whether a norm may enter MinHash (door 2, stage 2): at least 6 characters without spaces and 2.0 bits of entropy. */
export function passesGate(norm: string): boolean {
  return [...norm.replace(/ /g, "")].length >= ENTITY_GATE_CHARS && normEntropy(norm) >= ENTITY_GATE_ENTROPY;
}

/** The character 3-grams of a norm, spaces included; a norm shorter than 3 is its own one shingle. */
export function nameShingles(norm: string): Set<string> {
  const out = new Set<string>();
  if (norm.length < 3) {
    if (norm.length > 0) out.add(norm);
    return out;
  }
  for (let i = 0; i + 3 <= norm.length; i++) out.add(norm.slice(i, i + 3));
  return out;
}

/** The MinHash signature of a name (door 2): 32 values over its 3-grams, with the hash of `minhash.ts`. */
export function nameSignature(norm: string): Uint32Array {
  return minhashMins(nameShingles(norm), ENTITY_MINHASH_FUNCTIONS);
}

/** The estimated Jaccard of two signatures: the share of positions they agree on. */
export function signatureSimilarity(a: Uint32Array, b: Uint32Array): number {
  const n = Math.min(a.length, b.length);
  if (n === 0) return 0;
  let same = 0;
  for (let i = 0; i < n; i++) if (a[i] === b[i]) same++;
  return same / n;
}

/**
 * The pairs MinHash compares (door 2): only the names that share at least one of the 8 bands of 4 values (the first 32
 * of each signature), each with its estimated Jaccard. A pair in no common band is never compared.
 */
export function nameCandidates(
  items: ReadonlyArray<{ norm: string; sig: Uint32Array }>,
): Array<{ a: string; b: string; similarity: number }> {
  const pairs = new Map<string, { a: string; b: string; similarity: number }>();
  for (let band = 0; band < ENTITY_LSH_BANDS; band++) {
    const buckets = new Map<string, number[]>();
    items.forEach((item, i) => {
      if (item.sig.length < ENTITY_LSH_BANDS * ENTITY_LSH_ROWS) return;
      const key = Array.from(item.sig.subarray(band * ENTITY_LSH_ROWS, (band + 1) * ENTITY_LSH_ROWS)).join(",");
      const list = buckets.get(key);
      if (list) list.push(i);
      else buckets.set(key, [i]);
    });
    for (const list of buckets.values()) {
      for (let x = 0; x < list.length; x++) {
        for (let y = x + 1; y < list.length; y++) {
          const [p, q] = [items[list[x]!]!, items[list[y]!]!];
          const [a, b] = p.norm < q.norm ? [p, q] : [q, p];
          const id = `${a.norm}\u0000${b.norm}`;
          if (!pairs.has(id)) pairs.set(id, { a: a.norm, b: b.norm, similarity: signatureSimilarity(a.sig, b.sig) });
        }
      }
    }
  }
  return [...pairs.values()].sort((x, y) => (x.a < y.a ? -1 : x.a > y.a ? 1 : x.b < y.b ? -1 : x.b > y.b ? 1 : 0));
}

export interface DedupOptions {
  /** The signature of a norm (default `nameSignature`); a test gives fixed ones. */
  signature?: (norm: string) => Uint32Array;
}

/** An `add` correction's `b`: the kind and the aliases of the accepted entity (Landing 3a). */
export function addPayload(b: string | null): { kind: EntityKind; aliases: string[] } | null {
  try {
    const value = JSON.parse(b ?? "null") as { kind?: unknown; aliases?: unknown } | null;
    if (!value || !ENTITY_KINDS.includes(value.kind as EntityKind)) return null;
    const aliases = Array.isArray(value.aliases) ? value.aliases.filter((a): a is string => typeof a === "string") : [];
    return { kind: value.kind as EntityKind, aliases };
  } catch {
    return null;
  }
}

/**
 * The names the owner accepted (door 10): the name and each alias of every active `add`, with its kind, distinct, in
 * code-unit order. A pass of the index looks for them in the text (rule e, `nome`).
 */
export function acceptedNames(db: Db): AcceptedName[] {
  const out = new Map<string, AcceptedName>();
  for (const c of activeCorrections(readCorrections(db))) {
    if (c.action !== "add") continue;
    const payload = addPayload(c.b);
    if (!payload) continue;
    for (const name of [c.name ?? c.a, ...payload.aliases]) {
      if (entityNorm(name) !== "" && !out.has(name)) out.set(name, { name, kind: payload.kind });
    }
  }
  return [...out.values()].sort((x, y) => (x.name < y.name ? -1 : x.name > y.name ? 1 : 0));
}

/** Code-unit order, after the fold, for "first in alphabetical order" (never the locale's). */
function byName(x: string, y: string): number {
  const fx = mentionFold(x);
  const fy = mentionFold(y);
  if (fx !== fy) return fx < fy ? -1 : 1;
  return x < y ? -1 : x > y ? 1 : 0;
}

/** The most frequent of `names` (a name may repeat), the first in alphabetical order on a tie. */
function mostFrequent(names: readonly string[]): string {
  const counts = new Map<string, number>();
  for (const n of names) counts.set(n, (counts.get(n) ?? 0) + 1);
  return [...counts].sort((p, q) => q[1] - p[1] || byName(p[0], q[0]))[0]![0];
}

class UnionFind {
  private parent = new Map<string, string>();
  add(x: string): void {
    if (!this.parent.has(x)) this.parent.set(x, x);
  }
  find(x: string): string {
    this.add(x);
    let root = x;
    while (this.parent.get(root) !== root) root = this.parent.get(root)!;
    let cur = x;
    while (cur !== root) {
      const next = this.parent.get(cur)!;
      this.parent.set(cur, root);
      cur = next;
    }
    return root;
  }
  union(x: string, y: string): void {
    const [rx, ry] = [this.find(x), this.find(y)];
    if (rx !== ry) this.parent.set(rx < ry ? ry : rx, rx < ry ? rx : ry);
  }
  nodes(): string[] {
    return [...this.parent.keys()];
  }
}

/** The active corrections, in the order they apply: `created_at`, then id (door 3, AC 28). */
export function activeCorrections(corrections: readonly CorrectionRow[]): CorrectionRow[] {
  return corrections
    .filter((c) => c.undoneAt === null)
    .sort((x, y) => x.createdAt - y.createdAt || x.id - y.id);
}

/**
 * The mentions that count (AC 102): a `nome` row stands for the active `add` that named it, so one whose `add` was
 * undone (or whose kind it does not carry) is ignored at read until the next pass removes it.
 */
export function liveMentions(rows: readonly MentionRow[], corrections: readonly CorrectionRow[]): MentionRow[] {
  const named = new Set<string>();
  for (const c of activeCorrections(corrections)) {
    const payload = c.action === "add" ? addPayload(c.b) : null;
    if (!payload) continue;
    for (const name of [c.a, ...payload.aliases]) named.add(`${payload.kind}:${entityNorm(name)}`);
  }
  return rows.filter((r) => r.proof !== "nome" || named.has(`${r.kind}:${r.norm}`));
}

/**
 * The entities of a set of mentions and the owner's corrections (door 2, door 3): (0) the `nota` names of one file are
 * one entity (Landing 2b), and so are an `add` and its aliases; (1) the same norm is the same entity; (2) the gate; (3)
 * MinHash: an estimated Jaccard of 0.9 or more joins two names, unless a `separate` keeps them apart, and 0.7 to 0.9
 * lists each in the other's `duplicates`; then `merge` joins (over the gate and MinHash), `ignore` drops, `rename` names,
 * in `created_at` order. A `termo` needs mentions in 2 files. Ordered by files, then name.
 */
export function computeEntities(
  allRows: readonly MentionRow[],
  corrections: readonly CorrectionRow[],
  options: DedupOptions = {},
): Entity[] {
  const rows = liveMentions(allRows, corrections);
  const signature = options.signature ?? nameSignature;
  const active = activeCorrections(corrections);
  const uf = new UnionFind();
  const byNorm = new Map<string, MentionRow[]>();
  for (const row of rows) {
    uf.add(row.norm);
    const list = byNorm.get(row.norm);
    if (list) list.push(row);
    else byNorm.set(row.norm, [row]);
  }

  // (0) a home note's names, and an accepted entity's
  const homeNorms = new Map<number, string>();
  for (const row of rows) {
    if (row.proof !== "nota") continue;
    const first = homeNorms.get(row.srcId);
    if (first === undefined) homeNorms.set(row.srcId, row.norm);
    else uf.union(first, row.norm);
  }
  const adds = new Map<string, { kind: EntityKind; aliases: string[]; name: string }>();
  for (const c of active) {
    if (c.action !== "add") continue;
    const payload = addPayload(c.b);
    if (!payload) continue;
    uf.add(c.a);
    adds.set(c.a, { ...payload, name: c.name ?? c.a });
    for (const alias of payload.aliases) {
      const norm = entityNorm(alias);
      if (norm !== "") uf.union(c.a, norm);
    }
  }

  // (2) and (3): the names past the gate, by LSH, unless a `separate` would end up inside one entity
  const separations = active.filter((c) => c.action === "separate" && c.b !== null) as Array<CorrectionRow & { b: string }>;
  const apart = (x: string, y: string): boolean => {
    const [rx, ry] = [uf.find(x), uf.find(y)];
    return separations.some(
      (s) => (uf.find(s.a) === rx && uf.find(s.b) === ry) || (uf.find(s.a) === ry && uf.find(s.b) === rx),
    );
  };
  const eligible = [...byNorm.keys()].filter(passesGate).map((norm) => ({ norm, sig: signature(norm) }));
  const maybe: Array<{ a: string; b: string; similarity: number }> = [];
  for (const pair of nameCandidates(eligible)) {
    if (pair.similarity >= ENTITY_MERGE_SIMILARITY) {
      if (uf.find(pair.a) !== uf.find(pair.b) && !apart(pair.a, pair.b)) uf.union(pair.a, pair.b);
    } else if (pair.similarity >= ENTITY_DUPLICATE_SIMILARITY) maybe.push(pair);
  }
  for (const c of active) if (c.action === "merge" && c.b !== null) uf.union(c.a, c.b);

  // the clusters
  const clusters = new Map<string, string[]>();
  for (const norm of uf.nodes()) {
    const root = uf.find(norm);
    const list = clusters.get(root);
    if (list) list.push(norm);
    else clusters.set(root, [norm]);
  }
  const ignored = new Set(active.filter((c) => c.action === "ignore").map((c) => uf.find(c.a)));
  const renames = new Map<string, string>();
  for (const c of active) if (c.action === "rename" && c.name) renames.set(uf.find(c.a), c.name);

  const out: Entity[] = [];
  const keyOfRoot = new Map<string, { key: string; name: string }>();
  for (const [root, norms] of clusters) {
    if (ignored.has(root)) continue;
    const mentions = norms.flatMap((n) => byNorm.get(n) ?? []);
    const add = norms.map((n) => adds.get(n)).find((a) => a !== undefined);
    if (mentions.length === 0 && !add) continue;
    const kinds = [...mentions.map((m) => m.kind), ...(add ? [add.kind] : [])];
    const kind = kinds.sort((x, y) => PRECEDENCE[x] - PRECEDENCE[y])[0]!;
    const fileIds = [...new Set(mentions.map((m) => m.srcId))].sort((x, y) => x - y);
    if (kind === "termo" && !add && fileIds.length < TERM_MIN_FILES) continue;

    // the shown name: the home note's title, else the accepted name, else the most frequent (Landing 2b, AC 15)
    const notas = mentions.filter((m) => m.proof === "nota");
    let home: number | null = null;
    let shown: string;
    if (notas.length > 0) {
      home = Math.min(...notas.map((m) => m.srcId));
      const homeRow = notas.find((m) => m.srcId === home)!;
      const titleNorm = entityNorm(homeRow.title ?? stemOf(homeRow.path));
      shown = (notas.find((m) => m.srcId === home && m.norm === titleNorm) ?? homeRow).name;
    } else if (add) shown = add.name;
    else shown = mostFrequent(mentions.map((m) => m.name));
    const canonical = entityNorm(shown);
    const key = `${kind}:${canonical}`;
    const name = renames.get(root) ?? shown;

    const aliasByNorm = new Map<string, string>();
    for (const norm of norms) {
      if (norm === canonical) continue;
      const names = (byNorm.get(norm) ?? []).map((m) => m.name);
      if (names.length > 0) aliasByNorm.set(norm, mostFrequent(names));
    }
    for (const alias of add?.aliases ?? []) {
      const norm = entityNorm(alias);
      if (norm !== "" && norm !== canonical && !aliasByNorm.has(norm)) aliasByNorm.set(norm, alias);
    }
    keyOfRoot.set(root, { key, name });
    out.push({
      key,
      kind,
      name,
      aliases: [...aliasByNorm.values()].sort(byName),
      files: fileIds.length,
      mentions: mentions.length,
      hub: fileIds.length > ENTITY_HUB_FILES,
      norms: [canonical, ...norms.filter((n) => n !== canonical).sort()],
      fileIds,
      home,
      duplicates: [],
    });
  }

  // "maybe the same", between two entities that are listed and not kept apart
  const byKey = new Map(out.map((e) => [e.key, e]));
  const best = new Map<string, number>();
  for (const pair of maybe) {
    const [ra, rb] = [uf.find(pair.a), uf.find(pair.b)];
    if (ra === rb || apart(pair.a, pair.b)) continue;
    const [ea, eb] = [keyOfRoot.get(ra), keyOfRoot.get(rb)];
    if (!ea || !eb) continue;
    const id = ea.key < eb.key ? `${ea.key}\u0000${eb.key}` : `${eb.key}\u0000${ea.key}`;
    best.set(id, Math.max(best.get(id) ?? 0, pair.similarity));
  }
  for (const [id, similarity] of best) {
    const [ka, kb] = id.split("\u0000") as [string, string];
    const [ea, eb] = [byKey.get(ka)!, byKey.get(kb)!];
    ea.duplicates.push({ key: eb.key, name: eb.name, similarity });
    eb.duplicates.push({ key: ea.key, name: ea.name, similarity });
  }
  for (const e of out) e.duplicates.sort((x, y) => y.similarity - x.similarity || byName(x.name, y.name));
  return out.sort((x, y) => y.files - x.files || byName(x.name, y.name) || (x.key < y.key ? -1 : 1));
}

/**
 * The co-mention edges of the graph (door 5): for every two files that share an entity that is not a hub, 0.5 per
 * entity in common. An ignored entity is no entity, so no edge goes through it (AC 21).
 */
export function coMentionEdges(entities: readonly Entity[]): Array<{ a: number; b: number; weight: number }> {
  const edges = new Map<string, { a: number; b: number; weight: number }>();
  for (const e of entities) {
    if (e.hub) continue;
    for (let i = 0; i < e.fileIds.length; i++) {
      for (let j = i + 1; j < e.fileIds.length; j++) {
        const [a, b] = [e.fileIds[i]!, e.fileIds[j]!];
        const id = `${a}:${b}`;
        const edge = edges.get(id);
        if (edge) edge.weight += 0.5;
        else edges.set(id, { a, b, weight: 0.5 });
      }
    }
  }
  return [...edges.values()].sort((x, y) => x.a - y.a || x.b - y.b);
}

// ---- reading from the index ---------------------------------------------------------------------------------------

type Allow = (row: { root: string; rel: string }) => boolean;

/** The mentions of the files `allow` lets through. */
export function readMentions(db: Db, allow: Allow): MentionRow[] {
  const rows = db
    .prepare(
      `SELECT m.src_id, m.line, m.proof, m.kind, m.name, m.norm, f.path, f.title, f.root, f.rel
         FROM entity_mentions m JOIN files f ON f.id = m.src_id
        ORDER BY m.src_id, m.line, m.rowid`,
    )
    .all() as Array<{
    src_id: number;
    line: number;
    proof: MentionProof;
    kind: EntityKind;
    name: string;
    norm: string;
    path: string;
    title: string | null;
    root: string;
    rel: string;
  }>;
  return rows
    .filter((r) => allow(r))
    .map((r) => ({
      srcId: r.src_id,
      line: r.line,
      proof: r.proof,
      kind: r.kind,
      name: r.name,
      norm: r.norm,
      path: r.path,
      title: r.title,
    }));
}

/** Every correction, active or undone, in the order they were made. */
export function readCorrections(db: Db): CorrectionRow[] {
  return (
    db
      .prepare("SELECT id, action, a, b, name, created_at, undone_at FROM entity_overrides ORDER BY created_at, id")
      .all() as Array<{
      id: number;
      action: CorrectionAction;
      a: string;
      b: string | null;
      name: string | null;
      created_at: number;
      undone_at: number | null;
    }>
  ).map((r) => ({
    id: r.id,
    action: r.action,
    a: r.a,
    b: r.b,
    name: r.name,
    createdAt: r.created_at,
    undoneAt: r.undone_at,
  }));
}

/** What one audience reads: its mentions, the corrections and the entities they make. */
export interface EntityView {
  rows: MentionRow[];
  corrections: CorrectionRow[];
  entities: Entity[];
  byKey: Map<string, Entity>;
  /** The entity a normalized name belongs to, for this audience. */
  byNorm: Map<string, Entity>;
}

/**
 * The entities by audience (AC 38): worked out on first read and kept until a pass of the index finishes
 * (`index.finished`) or a correction is written; one view per audience key (an owner read never serves a device).
 */
export class EntityReader {
  private cache = new Map<string, EntityView>();

  constructor(
    private readonly db: Db,
    bus?: EventBus,
  ) {
    bus?.subscribe((event) => {
      if (event.type === "index.finished") this.invalidate();
    });
  }

  /** Work the view out from the index (no cache). */
  compute(allow: Allow): EntityView {
    const corrections = readCorrections(this.db);
    const rows = liveMentions(readMentions(this.db, allow), corrections);
    const entities = computeEntities(rows, corrections);
    const byNorm = new Map<string, Entity>();
    for (const e of entities) for (const n of e.norms) byNorm.set(n, e);
    return { rows, corrections, entities, byKey: new Map(entities.map((e) => [e.key, e])), byNorm };
  }

  /** The view of `audience` (a key that names who reads and what is hidden from them). */
  read(audience: string, allow: Allow): EntityView {
    const cached = this.cache.get(audience);
    if (cached) return cached;
    const view = this.compute(allow);
    this.cache.set(audience, view);
    return view;
  }

  invalidate(): void {
    this.cache.clear();
  }
}

// ---- the owner's corrections (door 3) -----------------------------------------------------------------------------

/** What `POST /api/memory/entities/corrections` asks. */
export interface CorrectionInput {
  action: "merge" | "separate" | "ignore" | "rename" | "undo" | "accept" | "reject";
  key?: string | undefined;
  other?: string | undefined;
  name?: string | undefined;
  id?: number | undefined;
  suggestion?: string | undefined;
}

/** A suggestion as accepting or rejecting it needs it (door 10): what passed today's check, by its id. */
export interface SuggestionChoice {
  kind: EntityKind;
  name: string;
  /** `entityNorm(name)`. */
  norm: string;
  aliases: string[];
  mergeWith?: string | undefined;
}

/**
 * Whether a suggestion that passed today's check is still to decide (AC 97, AC 101): its norm was not rejected, and,
 * without `mergeWith`, it is no entity's yet; with it, the entity it names does not hold it yet.
 */
export function suggestionPending(
  view: Pick<EntityView, "byKey" | "byNorm">,
  corrections: readonly CorrectionRow[],
  suggestion: Pick<SuggestionChoice, "norm" | "mergeWith">,
): boolean {
  const active = activeCorrections(corrections);
  if (active.some((c) => c.action === "reject" && c.a === suggestion.norm)) return false;
  if (suggestion.mergeWith === undefined) {
    return !view.byNorm.has(suggestion.norm) && !active.some((c) => c.action === "add" && c.a === suggestion.norm);
  }
  const target = view.byKey.get(suggestion.mergeWith);
  return target === undefined || !target.norms.includes(suggestion.norm);
}

/** A refusal of a correction, by its reason; the route answers it (`400`, `404` or `409` with the reason as the code). */
export class CorrectionError extends Error {
  constructor(
    readonly reason: "validation" | "not_found" | "correction_conflict" | "too_many_corrections",
    message: string,
  ) {
    super(message);
    this.name = "CorrectionError";
  }
}

/** The names of a correction as the API shows them: the normalized names it stores. */
export function correctionNames(c: Pick<CorrectionRow, "action" | "a" | "b">): string[] {
  return c.action === "merge" || c.action === "separate" ? [c.a, c.b ?? ""] : [c.a];
}

/** The entity `key` names for the owner: by its key, or (`<kind>:<norm>`) by a name it holds. */
function entityOf(view: EntityView, key: string | undefined, label: "key" | "other"): { entity: Entity; norm: string } {
  if (key === undefined || key === "") throw new CorrectionError("validation", `${label} is required.`);
  const exact = view.byKey.get(key);
  if (exact) return { entity: exact, norm: exact.norms[0]! };
  const colon = key.indexOf(":");
  const norm = colon === -1 ? "" : key.slice(colon + 1);
  const kind = key.slice(0, colon);
  const found = ENTITY_KINDS.includes(kind as EntityKind) ? view.byNorm.get(norm) : undefined;
  if (!found) throw new CorrectionError("not_found", `No entity ${label === "key" ? "key" : "other"} ${key}.`);
  return { entity: found, norm };
}

/**
 * Write one correction of the owner (door 3) against the owner's view `view`, and answer the row written: `merge` and
 * `separate` of `key` and `other` (`409 correction_conflict` against an active opposite on the pair; `separate` of one
 * norm is `400 validation`), `ignore` and `rename` of `key`, `undo` of `id` (`404 not_found`, `409 correction_conflict`
 * when undone already), at most 2 000 active (`409 too_many_corrections`). `accept` and `reject` take a suggestion by
 * its id (door 10), as `suggestion` finds it today (`404 not_found` when none): `accept` stores `add` (the norm, the
 * name, and the kind and aliases as JSON in `b`, Landing 3a) or, with `mergeWith`, `merge` of the two norms; `reject`
 * stores `reject` with the norm; either is `409 correction_conflict` for a suggestion no longer pending.
 */
export function writeCorrection(
  db: Db,
  view: EntityView,
  input: CorrectionInput,
  now: number,
  suggestion: (id: string) => SuggestionChoice | null = () => null,
): CorrectionRow {
  if (input.action === "undo") {
    if (input.id === undefined) throw new CorrectionError("validation", "id is required.");
    const row = db.prepare("SELECT undone_at FROM entity_overrides WHERE id = ?").get(input.id) as
      | { undone_at: number | null }
      | undefined;
    if (!row) throw new CorrectionError("not_found", `No correction ${input.id}.`);
    if (row.undone_at !== null) throw new CorrectionError("correction_conflict", "The correction was undone already.");
    db.prepare("UPDATE entity_overrides SET undone_at = ? WHERE id = ?").run(now, input.id);
    return readCorrections(db).find((c) => c.id === input.id)!;
  }
  // The corrections as stored now (the view may have been worked out before the last one).
  const stored = readCorrections(db);
  const active = activeCorrections(stored);
  let row: { action: CorrectionAction; a: string; b: string | null; name: string | null };
  if (input.action === "accept" || input.action === "reject") {
    if (input.suggestion === undefined) throw new CorrectionError("validation", "suggestion is required.");
    const found = suggestion(input.suggestion);
    if (!found) throw new CorrectionError("not_found", `No suggestion ${input.suggestion}.`);
    if (!suggestionPending(view, stored, found)) {
      throw new CorrectionError("correction_conflict", "The suggestion was accepted or rejected already.");
    }
    if (input.action === "reject") row = { action: "reject", a: found.norm, b: null, name: null };
    else if (found.mergeWith === undefined) {
      row = {
        action: "add",
        a: found.norm,
        b: JSON.stringify({ kind: found.kind, aliases: found.aliases }),
        name: found.name,
      };
    } else {
      const target = entityOf(view, found.mergeWith, "key");
      const separated = active.some(
        (c) =>
          c.action === "separate" &&
          c.b !== null &&
          ((target.entity.norms.includes(c.a) && c.b === found.norm) ||
            (target.entity.norms.includes(c.b) && c.a === found.norm)),
      );
      if (separated) {
        throw new CorrectionError("correction_conflict", "The pair has an active separate; undo it first.");
      }
      row = { action: "merge", a: target.norm, b: found.norm, name: null };
    }
  } else if (input.action === "merge" || input.action === "separate") {
    const one = entityOf(view, input.key, "key");
    const two = entityOf(view, input.other, "other");
    const [a, b] = [one.norm, two.norm];
    if (a === b) throw new CorrectionError("validation", "Both names are the same normalized name.");
    if (input.action === "merge" && one.entity === two.entity) {
      throw new CorrectionError("validation", "Both names are one entity already.");
    }
    const opposite = input.action === "merge" ? "separate" : "merge";
    const pair = (c: CorrectionRow) =>
      c.action === opposite &&
      c.b !== null &&
      ((one.entity.norms.includes(c.a) && two.entity.norms.includes(c.b)) ||
        (two.entity.norms.includes(c.a) && one.entity.norms.includes(c.b)) ||
        (c.a === a && c.b === b) ||
        (c.a === b && c.b === a));
    if (active.some(pair)) {
      throw new CorrectionError("correction_conflict", `The pair has an active ${opposite}; undo it first.`);
    }
    row = { action: input.action, a, b, name: null };
  } else if (input.action === "rename") {
    const one = entityOf(view, input.key, "key");
    const name = (input.name ?? "").trim();
    if (name === "") throw new CorrectionError("validation", "name is required.");
    row = { action: "rename", a: one.norm, b: null, name };
  } else row = { action: "ignore", a: entityOf(view, input.key, "key").norm, b: null, name: null };

  if (active.length >= ENTITY_CORRECTIONS_MAX) {
    throw new CorrectionError("too_many_corrections", `There are ${ENTITY_CORRECTIONS_MAX} active corrections.`);
  }
  const id = Number(
    db
      .prepare("INSERT INTO entity_overrides (action, a, b, name, created_at) VALUES (?, ?, ?, ?, ?)")
      .run(row.action, row.a, row.b, row.name, now).lastInsertRowid,
  );
  return { id, ...row, createdAt: now, undoneAt: null };
}

// ---- what the routes answer (door 4) ------------------------------------------------------------------------------

export interface EntityItem {
  key: string;
  kind: EntityKind;
  name: string;
  aliases: string[];
  files: number;
  mentions: number;
}

const itemOf = (e: Entity): EntityItem => ({
  key: e.key,
  kind: e.kind,
  name: e.name,
  aliases: e.aliases,
  files: e.files,
  mentions: e.mentions,
});

/**
 * The view counted over the files `within` lets through (a work context, AC 31): an entity keeps the mentions of those
 * files only, and one with none there is not listed. The entities themselves are the audience's.
 */
function narrowed(view: EntityView, within: ((fileId: number) => boolean) | undefined): Entity[] {
  if (!within) return view.entities;
  const out: Entity[] = [];
  for (const e of view.entities) {
    const fileIds = e.fileIds.filter(within);
    if (fileIds.length === 0) continue;
    const norms = new Set(e.norms);
    const mentions = view.rows.filter((r) => norms.has(r.norm) && within(r.srcId)).length;
    out.push({ ...e, fileIds, files: fileIds.length, mentions });
  }
  return out.sort((x, y) => y.files - x.files || byName(x.name, y.name) || (x.key < y.key ? -1 : 1));
}

/** `GET /api/memory/entities` (AC 29, AC 30): by files then name, `q` a word prefix of a normalized name. */
export function listEntities(
  view: EntityView,
  query: {
    kind?: EntityKind | undefined;
    q?: string | undefined;
    limit?: number | undefined;
    offset?: number | undefined;
    within?: ((fileId: number) => boolean) | undefined;
  },
): { items: EntityItem[]; total: number } {
  const q = query.q !== undefined ? entityNorm(query.q) : "";
  const matching = narrowed(view, query.within).filter(
    (e) =>
      (query.kind === undefined || e.kind === query.kind) &&
      (q === "" || e.norms.some((n) => ` ${n}`.includes(` ${q}`))),
  );
  const offset = query.offset ?? 0;
  return { items: matching.slice(offset, offset + (query.limit ?? 50)).map(itemOf), total: matching.length };
}

/**
 * The correction as the API shows it; `shown` (an audience's, `shownNorms`) cuts `names` to the norms that audience
 * sees, so a correction that touches a hidden name never says it.
 */
export function correctionItem(c: CorrectionRow, shown?: ReadonlySet<string>) {
  return {
    id: c.id,
    action: c.action,
    names: shown ? correctionNames(c).filter((n) => shown.has(n)) : correctionNames(c),
    ...(c.name !== null && c.action !== "add" ? { name: c.name } : {}),
    createdAt: c.createdAt,
    undoneAt: c.undoneAt,
  };
}

/**
 * The normalized names an audience's entities show: each one's canonical name and its aliases. An owner's merge puts a
 * name the audience cannot read into the entity's `norms`; this is what it is allowed to say of them.
 */
function shownNorms(entities: readonly Entity[]): Set<string> {
  return new Set(entities.flatMap((e) => [e.norms[0]!, ...e.aliases.map(entityNorm)]));
}

/** At most this many mentions in one entity's answer, by path then line. */
export const ENTITY_DETAIL_MENTIONS_MAX = 500;
/** At most this many related entities (AC 32). */
export const ENTITY_RELATED_MAX = 10;

/**
 * `GET /api/memory/entities/:key` (AC 32): the entity, its home note, its mentions with the line cut to 160 characters
 * around the name (read from the text the index stores), the entities it shares files with, its duplicates and the
 * corrections that touch one of its names. Null when the audience has no entity with this key.
 */
export function entityDetail(
  db: Db,
  view: EntityView,
  key: string,
  within?: (fileId: number) => boolean,
) {
  const entities = narrowed(view, within);
  const entity = entities.find((e) => e.key === key);
  if (!entity) return null;
  const norms = new Set(entity.norms);
  const shown = shownNorms(view.entities);
  const rows = view.rows
    .filter((r) => norms.has(r.norm) && (!within || within(r.srcId)))
    .sort((x, y) => (x.path < y.path ? -1 : x.path > y.path ? 1 : x.line - y.line))
    .slice(0, ENTITY_DETAIL_MENTIONS_MAX);
  const textOf = db.prepare("SELECT content FROM files_fts WHERE rowid = ?");
  const lines = new Map<number, string[]>();
  const linesOf = (id: number): string[] => {
    let found = lines.get(id);
    if (!found) {
      found = ((textOf.get(id) as { content: string } | undefined)?.content ?? "").split(/\r?\n/);
      lines.set(id, found);
    }
    return found;
  };
  const excerptOf = (row: MentionRow): string => {
    const all = linesOf(row.srcId);
    const at = (text: string) => findMention(text, row.name);
    let text = all[row.line - 1] ?? "";
    // A home note's names are its header's: the line that shows the name, when there is one.
    if (row.proof === "nota" && !at(text)) text = all.find((l) => at(l)) ?? text;
    const hit = at(text);
    return hit ? mentionExcerpt(text, hit.start, hit.end) : text.slice(0, MENTION_EXCERPT_MAX);
  };
  const shared = new Set(entity.fileIds);
  const related = entities
    .filter((e) => e.key !== entity.key)
    .map((e) => ({ key: e.key, name: e.name, kind: e.kind, shared: e.fileIds.filter((id) => shared.has(id)).length }))
    .filter((r) => r.shared > 0)
    .sort((x, y) => y.shared - x.shared || byName(x.name, y.name))
    .slice(0, ENTITY_RELATED_MAX);
  const homeRow = entity.home !== null ? view.rows.find((r) => r.srcId === entity.home) : undefined;
  return {
    key: entity.key,
    kind: entity.kind,
    name: entity.name,
    aliases: entity.aliases,
    ...(homeRow ? { home: { fileId: homeRow.srcId, path: homeRow.path } } : {}),
    mentions: rows.map((r) => ({
      fileId: r.srcId,
      path: r.path,
      name: r.name,
      line: r.line,
      proof: r.proof,
      excerpt: excerptOf(r),
    })),
    related,
    duplicates: entity.duplicates,
    corrections: view.corrections
      .filter((c) => correctionNames(c).some((n) => norms.has(n) && shown.has(n)))
      .map((c) => correctionItem(c, shown)),
  };
}
