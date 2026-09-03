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
