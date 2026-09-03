/**
 * The artifact ring: which chips orbit the core, in which order, and how each
 * one is labelled. Pure so it can be unit-tested (no React, no DOM).
 *
 * RUBRIC 1.5: chips are numbered in creation order, carry an icon per kind and
 * a small count in the chip footer; hovering shows a radial label with
 * "nº · title", or "skill · date, time" for a skill output.
 */
import type { ArtifactKind, ArtifactListItem } from "../api";

export type ChipKind = "artifact" | "file";

export interface RingSourceFile {
  name: string;
  path: string;
  title?: string | null;
  mtime: number;
}

export interface RingChip {
  key: string;
  /** 1-based position in creation order (oldest first), as in the video. */
  n: number;
  kind: ChipKind;
  artifactKind: ArtifactKind;
  /** Base file name. */
  label: string;
  /** Human title (markdown heading / html title / file name). */
  title: string;
  path: string;
  runId: string | null;
  skillSlug: string | null;
  ts: number;
}

const IMAGE = ["png", "jpg", "jpeg", "gif", "webp", "svg"];
const VIDEO = ["mp4", "webm", "mov"];
const CODE = ["ts", "tsx", "js", "mjs", "py", "sh", "json", "css", "yaml", "yml", "sql", "go", "rs"];

/** Mirror of the API's `artifactKind` for files that never went through a run. */
export function kindOf(file: string): ArtifactKind {
  const ext = file.split(".").pop()?.toLowerCase() ?? "";
  if (IMAGE.includes(ext)) return "image";
  if (VIDEO.includes(ext)) return "video";
  if (ext === "html" || ext === "htm") return "html";
  if (ext === "md" || ext === "markdown") return "markdown";
  if (CODE.includes(ext)) return "code";
  return "other";
}

/**
 * Merge recent artifacts (first) with recently changed graph files up to
 * `max` chips, then number them oldest → newest so the ring reads like a
 * creation timeline.
 */
export function buildRingChips(
  artifacts: readonly ArtifactListItem[],
  files: readonly RingSourceFile[],
  max = 24,
): RingChip[] {
  const seen = new Set<string>();
  const out: Omit<RingChip, "n">[] = [];

  for (const a of artifacts) {
    if (out.length >= max) break;
    const key = `a:${a.id || a.path}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      key,
      kind: "artifact",
      artifactKind: a.kind,
      label: a.file.split("/").pop() ?? a.file,
      title: a.title || a.file,
      path: a.path,
      runId: a.runId,
      skillSlug: a.skillSlug,
      ts: a.createdAt,
    });
  }

  for (const f of files) {
    if (out.length >= max) break;
    const key = `f:${f.path}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      key,
      kind: "file",
      artifactKind: kindOf(f.name),
      label: f.name,
      title: f.title || f.name,
      path: f.path,
      runId: null,
      skillSlug: null,
      ts: f.mtime,
    });
  }

  return out
    .slice()
    .sort((a, b) => a.ts - b.ts || a.key.localeCompare(b.key))
    .map((chip, i) => ({ ...chip, n: i + 1 }));
}

/** Radial label: "nº · title", or "skill · date, time" for a skill output. */
export function chipLabel(chip: RingChip, locale: string): string {
  if (chip.skillSlug) {
    const when = new Date(chip.ts).toLocaleString(locale, {
      day: "2-digit",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
    });
    return `/${chip.skillSlug} · ${when}`;
  }
  return `${chip.n} · ${chip.title}`;
}

/** Does this chip match a free-text query (case-insensitive, over title, file and skill)? */
export function chipMatches(chip: RingChip, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return false;
  return `${chip.title} ${chip.label} ${chip.skillSlug ?? ""} ${chip.path}`.toLowerCase().includes(q);
}

/** Position of chip `i` of `n` on an ellipse: the ring opens at the top so the brand can breathe. */
export function chipAngle(i: number, n: number): number {
  if (n <= 1) return Math.PI * 0.5;
  return Math.PI * (0.56 + (1.88 * i) / (n - 1));
}
