/** Unified-diff parsing for the diff viewer (pure, tested). */
export type DiffLineKind = "add" | "del" | "ctx" | "hunk" | "meta";

export interface DiffLine {
  kind: DiffLineKind;
  text: string;
  oldNo: number | null;
  newNo: number | null;
}

const HUNK = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/;

export function parseUnifiedDiff(diff: string): DiffLine[] {
  const out: DiffLine[] = [];
  let oldNo = 0;
  let newNo = 0;
  let inHunk = false;
  for (const raw of diff.split("\n")) {
    if (raw === "" && out.length && diff.endsWith("\n")) continue;
    const hunk = HUNK.exec(raw);
    if (hunk) {
      oldNo = Number(hunk[1]);
      newNo = Number(hunk[2]);
      inHunk = true;
      out.push({ kind: "hunk", text: raw, oldNo: null, newNo: null });
      continue;
    }
    if (!inHunk) {
      out.push({ kind: "meta", text: raw, oldNo: null, newNo: null });
      continue;
    }
    if (raw.startsWith("+")) {
      out.push({ kind: "add", text: raw.slice(1), oldNo: null, newNo: newNo++ });
    } else if (raw.startsWith("-")) {
      out.push({ kind: "del", text: raw.slice(1), oldNo: oldNo++, newNo: null });
    } else if (raw.startsWith("\\")) {
      out.push({ kind: "meta", text: raw, oldNo: null, newNo: null });
    } else {
      out.push({ kind: "ctx", text: raw.startsWith(" ") ? raw.slice(1) : raw, oldNo: oldNo++, newNo: newNo++ });
    }
  }
  return out;
}

/** A snapshot (untracked or non-git file) renders as an all-added file. */
export function snapshotToLines(content: string): DiffLine[] {
  const lines = content.split("\n");
  if (lines.length && lines[lines.length - 1] === "" && content.endsWith("\n")) lines.pop();
  return lines.map((text, i) => ({ kind: "add", text, oldNo: null, newNo: i + 1 }));
}

export function diffStats(lines: readonly DiffLine[]): { added: number; removed: number } {
  let added = 0;
  let removed = 0;
  for (const l of lines) {
    if (l.kind === "add") added++;
    else if (l.kind === "del") removed++;
  }
  return { added, removed };
}

/** Short display name for an absolute path relative to a base (cwd/repo), else the basename. */
export function displayPath(file: string, base: string | null | undefined): string {
  if (base && file.startsWith(base.endsWith("/") ? base : `${base}/`)) return file.slice(base.length + (base.endsWith("/") ? 0 : 1));
  return file;
}

/** `GET /api/runs/:id/diff?file=` (mirrors `RunDiffResult` in apps/api/src/routes/runs.ts). */
export type RunDiff =
  | { kind: "git"; file: string; repoRoot: string; diff: string; truncated: boolean; unchanged: boolean }
  | { kind: "snapshot"; file: string; content: string | null; truncated: boolean; untracked: boolean; message: string | null }
  | { kind: "unavailable"; file: string; message: string };

export interface DiffView {
  lines: DiffLine[];
  added: number;
  removed: number;
  /** Reason there is nothing to show (unchanged file, unavailable, binary). */
  note: string | null;
  truncated: boolean;
  /** How the backend produced it, for the badge next to the file name. */
  source: "git" | "snapshot" | "none";
}

/** One shape for the viewer, whichever branch the backend took. */
export function diffToView(result: RunDiff): DiffView {
  if (result.kind === "unavailable") return { lines: [], added: 0, removed: 0, note: result.message, truncated: false, source: "none" };
  if (result.kind === "snapshot") {
    const lines = result.content == null ? [] : snapshotToLines(result.content);
    return { lines, ...diffStats(lines), note: result.message, truncated: result.truncated, source: "snapshot" };
  }
  if (result.unchanged || result.diff.trim() === "") {
    return { lines: [], added: 0, removed: 0, note: null, truncated: false, source: "git" };
  }
  const lines = parseUnifiedDiff(result.diff);
  return { lines, ...diffStats(lines), note: null, truncated: result.truncated, source: "git" };
}
