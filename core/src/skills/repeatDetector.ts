import crypto from "node:crypto";
import type { Db } from "../db/db.js";
import type { Settings } from "../config/schema.js";
import type { NotificationInput } from "../notifications/store.js";
import type { DedupeLookup } from "../sentinels/types.js";

/**
 * "You did this twice — make it a skill?" (Onda 4, item 2).
 *
 * The manual rule every agent handbook repeats — do it twice by hand, then
 * write it down — automated. Once an hour the manual prompt runs of the last
 * 30 days are grouped by how much vocabulary they share; a group of two or
 * more that no existing skill already covers becomes ONE inbox row per week,
 * linking to the skill editor with the prompt pre-filled.
 *
 * Grouping is deliberately lexical (normalized token sets + Jaccard), not
 * semantic: it costs nothing, it is deterministic, and it is easy to explain
 * when it is wrong. `groupPrompts` is pure and unit-tested.
 */

/** Tokens considered when comparing two prompts. */
export const MAX_COMPARED_TOKENS = 40;
/** Vocabulary overlap two prompts need to count as "the same thing". */
export const DEFAULT_SIMILARITY = 0.6;
/** Tokens a skill must share with a group to count as already covering it. */
export const SKILL_OVERLAP_TOKENS = 3;

/**
 * Lowercase, punctuation-free token set of the first `max` tokens. Duplicates
 * collapse (a set, not a list): repeating a word does not make two prompts
 * more similar.
 */
export function normalizeTokens(text: string, max = MAX_COMPARED_TOKENS): string[] {
  const tokens = text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]+/gu, " ")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, max);
  return [...new Set(tokens)];
}

/** |A ∩ B| / |A ∪ B|; 0 for two empty sets. */
export function jaccard(a: ReadonlySet<string>, b: ReadonlySet<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let shared = 0;
  for (const t of a) if (b.has(t)) shared++;
  return shared / (a.size + b.size - shared);
}

export interface RepeatRun {
  id: string;
  prompt: string;
  createdAt: number;
}

export interface RepeatGroup {
  /** Stable id of the group's vocabulary — the dedupe key is built on it. */
  hash: string;
  runIds: string[];
  /** The most recent prompt of the group (what the skill editor is seeded with). */
  prompt: string;
  tokens: string[];
  count: number;
  lastAt: number;
}

export interface GroupOptions {
  similarity?: number;
  minRuns?: number;
  maxTokens?: number;
}

/**
 * Greedy single-pass clustering, newest first: each run either joins the first
 * group whose seed it resembles, or opens a new one. Groups smaller than
 * `minRuns` are dropped.
 */
export function groupPrompts(runs: readonly RepeatRun[], opts: GroupOptions = {}): RepeatGroup[] {
  const threshold = opts.similarity ?? DEFAULT_SIMILARITY;
  const minRuns = Math.max(2, opts.minRuns ?? 2);
  const maxTokens = opts.maxTokens ?? MAX_COMPARED_TOKENS;
  const ordered = [...runs].sort((a, b) => b.createdAt - a.createdAt);
  const groups: Array<{ seed: Set<string>; runs: RepeatRun[] }> = [];
  for (const run of ordered) {
    const tokens = new Set(normalizeTokens(run.prompt, maxTokens));
    if (tokens.size === 0) continue;
    const home = groups.find((g) => jaccard(g.seed, tokens) >= threshold);
    if (home) home.runs.push(run);
    else groups.push({ seed: tokens, runs: [run] });
  }
  return groups
    .filter((g) => g.runs.length >= minRuns)
    .map((g) => {
      const tokens = [...g.seed].sort();
      const newest = g.runs[0]!;
      return {
        hash: hashTokens(tokens),
        runIds: g.runs.map((r) => r.id),
        prompt: newest.prompt,
        tokens,
        count: g.runs.length,
        lastAt: newest.createdAt,
      };
    })
    .sort((a, b) => b.count - a.count || b.lastAt - a.lastAt);
}

export function hashTokens(tokens: readonly string[]): string {
  return crypto.createHash("sha256").update([...tokens].sort().join(" ")).digest("hex").slice(0, 12);
}

/**
 * True when a skill already covers this group: its name plus description
 * shares at least `minShared` tokens with the group's vocabulary.
 */
export function skillCoversGroup(
  group: Pick<RepeatGroup, "tokens">,
  skills: ReadonlyArray<{ name: string; description: string }>,
  minShared = SKILL_OVERLAP_TOKENS,
): boolean {
  const groupTokens = new Set(group.tokens);
  return skills.some((skill) => {
    const skillTokens = new Set(normalizeTokens(`${skill.name} ${skill.description}`, 200));
    let shared = 0;
    for (const t of skillTokens) {
      if (groupTokens.has(t) && ++shared >= minShared) return true;
    }
    return false;
  });
}

/** ISO week label (`2026-W36`) — the row is offered again next week, not tomorrow. */
export function isoWeek(at = Date.now()): string {
  const d = new Date(at);
  const utc = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  // ISO: Thursday of the current week decides the year.
  const day = utc.getUTCDay() || 7;
  utc.setUTCDate(utc.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(utc.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((utc.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7);
  return `${utc.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

export function repeatDedupeKey(hash: string, at = Date.now()): string {
  return `repeat:${hash}:${isoWeek(at)}`;
}

/** Prompt head shown in the row (and seeded into the skill editor). */
export function promptHead(prompt: string, max = 180): string {
  const text = prompt.replace(/\s+/g, " ").trim();
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

/** The inbox row a group produces. `href` is what the skill editor reads. */
export function repeatNotification(group: RepeatGroup, at = Date.now()): NotificationInput {
  return {
    kind: "system",
    tone: "info",
    title: "You did this twice — make it a skill?",
    body: `${group.count}× "${promptHead(group.prompt)}"`,
    href: `/skills?new=1&prompt=${encodeURIComponent(promptHead(group.prompt, 500))}`,
    dedupeKey: repeatDedupeKey(group.hash, at),
  };
}

/** Manual prompt runs (origin `manual`, no skill) of the window. */
export function manualPromptRuns(db: Db, since: number, limit = 500): RepeatRun[] {
  const rows = db
    .prepare(
      `SELECT id, prompt_summary, created_at FROM runs
       WHERE origin = 'manual' AND skill_slug IS NULL AND created_at >= ?
       ORDER BY created_at DESC LIMIT ?`,
    )
    .all(since, limit) as Array<{ id: string; prompt_summary: string; created_at: number }>;
  return rows.map((r) => ({ id: r.id, prompt: r.prompt_summary, createdAt: r.created_at }));
}

export interface RepeatDetectorDeps {
  db: Db;
  getSettings: () => Settings;
  /** `SkillCatalog` satisfies this. */
  skills: { list(): ReadonlyArray<{ name: string; description: string }> };
  /** The inbox: one row per group per week. */
  notifications: DedupeLookup & { add(input: NotificationInput): unknown };
  now?: () => number;
}

/**
 * Hourly pass. Returns the rows it wrote (usually none: the dedupe key keeps
 * a group to one row a week).
 */
export function detectRepeatedPrompts(deps: RepeatDetectorDeps): NotificationInput[] {
  const settings = deps.getSettings().sentinels.repeatDetector;
  if (!settings.enabled) return [];
  const now = deps.now?.() ?? Date.now();
  const runs = manualPromptRuns(deps.db, now - settings.days * 86_400_000);
  const groups = groupPrompts(runs, { similarity: settings.similarity, minRuns: settings.minRuns });
  const skills = deps.skills.list();
  const written: NotificationInput[] = [];
  for (const group of groups) {
    if (skillCoversGroup(group, skills)) continue;
    const input = repeatNotification(group, now);
    if (input.dedupeKey && deps.notifications.hasDedupeKey(input.dedupeKey)) continue;
    deps.notifications.add(input);
    written.push(input);
  }
  return written;
}
