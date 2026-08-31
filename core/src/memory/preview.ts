import fs from "node:fs";
import path from "node:path";
import type { Settings } from "../config/schema.js";
import { isSecretFile, resolveInsideRoots } from "../security/paths.js";

const PREVIEWABLE = new Set([
  ".md", ".markdown", ".txt", ".json", ".yaml", ".yml", ".toml", ".csv",
  ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".py", ".rb", ".go", ".rs",
  ".java", ".sh", ".ps1", ".html", ".css", ".sql", ".xml", ".ini", ".log", ".cfg", ".conf",
]);

export interface PreviewResult {
  kind: "text" | "binary" | "blocked" | "too-large";
  content: string | null;
  truncated: boolean;
  size: number;
  message: string | null;
}

/**
 * Safe read-only preview. Content is returned as plain text — the UI renders it
 * escaped, never as HTML/scripts, so hostile file content stays inert.
 */
export function previewFile(
  settings: Settings,
  extraRoots: string[],
  filePath: string,
): PreviewResult {
  const roots = [
    ...settings.indexedFolders.filter((f) => f.enabled).map((f) => f.path),
    ...extraRoots,
  ];
  const resolved = resolveInsideRoots(roots, filePath);
  if (isSecretFile(resolved)) {
    return { kind: "blocked", content: null, truncated: false, size: 0, message: "This file matches the secret-file blocklist and is never read." };
  }
  const stat = fs.statSync(resolved);
  const ext = path.extname(resolved).toLowerCase();
  if (!PREVIEWABLE.has(ext)) {
    return { kind: "binary", content: null, truncated: false, size: stat.size, message: "Binary or non-previewable file type." };
  }
  const max = settings.limits.previewMaxBytes;
  const fd = fs.openSync(resolved, "r");
  try {
    const buf = Buffer.alloc(Math.min(stat.size, max));
    fs.readSync(fd, buf, 0, buf.length, 0);
    return {
      kind: "text",
      content: buf.toString("utf8"),
      truncated: stat.size > max,
      size: stat.size,
      message: null,
    };
  } finally {
    fs.closeSync(fd);
  }
}
