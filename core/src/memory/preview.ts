import fs from "node:fs";
import path from "node:path";
import type { Settings } from "../config/schema.js";
import { PathAccessError, isInside, resolveInsideRoots } from "../security/paths.js";
import { isBinaryBuffer, makeWorkspaceFilter, BINARY_SNIFF_BYTES } from "./excludes.js";

/** Extensions that are binary by definition — refused without reading a byte. */
const KNOWN_BINARY = new Set([
  ".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp", ".ico", ".tiff", ".heic", ".psd",
  ".pdf", ".zip", ".gz", ".tgz", ".bz2", ".xz", ".7z", ".rar", ".tar", ".jar", ".war",
  ".exe", ".dll", ".so", ".dylib", ".bin", ".o", ".a", ".class", ".pyc", ".wasm",
  ".mp3", ".mp4", ".m4a", ".mov", ".avi", ".mkv", ".wav", ".flac", ".ogg",
  ".doc", ".docx", ".xls", ".xlsx", ".ppt", ".pptx", ".sqlite", ".db",
  ".ttf", ".otf", ".woff", ".woff2", ".eot",
]);

export interface PreviewResult {
  kind: "text" | "binary" | "blocked" | "too-large";
  content: string | null;
  truncated: boolean;
  size: number;
  message: string | null;
}

export interface WorkspacePathCheck {
  /** Real, resolved path inside one of the roots. */
  resolved: string;
  /** The granted root that contains it. */
  root: string;
  /** Path relative to that root. */
  rel: string;
  /** Why it must not be read (exclusions, blocklists) — null when readable. */
  blockedReason: string | null;
}

function grantedRoots(settings: Settings, extraRoots: string[]): string[] {
  return [
    ...settings.indexedFolders.filter((f) => f.enabled).map((f) => f.path),
    ...extraRoots,
  ];
}

/**
 * Resolve a user-supplied path against the granted roots and evaluate the
 * shared exclusion policy (settings excludes, hard directory blocklist,
 * secret-file patterns). Throws PathAccessError when outside every root.
 */
export function checkWorkspacePath(
  settings: Settings,
  extraRoots: string[],
  filePath: string,
): WorkspacePathCheck {
  const roots = grantedRoots(settings, extraRoots);
  const resolved = resolveInsideRoots(roots, filePath);
  // Longest containing root wins (nested roots): its excludes context is the most specific.
  const containing = roots
    .map((r) => (fs.existsSync(r) ? fs.realpathSync(r) : path.resolve(r)))
    .filter((r) => isInside(r, resolved))
    .sort((a, b) => b.length - a.length);
  const root = containing[0] ?? path.dirname(resolved);
  const rel = path.relative(root, resolved);
  const filter = makeWorkspaceFilter(settings.excludes);
  return { resolved, root, rel, blockedReason: filter.reasonToSkip(rel, resolved) };
}

/**
 * For "open with the OS" and similar actions: the resolved path, or a
 * PathAccessError (403) when it is outside the roots OR excluded/blocklisted.
 */
export function resolveOpenablePath(settings: Settings, extraRoots: string[], filePath: string): string {
  const check = checkWorkspacePath(settings, extraRoots, filePath);
  if (check.blockedReason) throw new PathAccessError(filePath, check.blockedReason);
  return check.resolved;
}

/**
 * Safe read-only preview. Content is returned as plain text — the UI renders it
 * escaped, never as HTML/scripts, so hostile file content stays inert.
 * Binary detection is content-based (NUL byte in the first 8 KiB), with a
 * short extension list short-circuiting obviously binary formats.
 */
export function previewFile(
  settings: Settings,
  extraRoots: string[],
  filePath: string,
): PreviewResult {
  const check = checkWorkspacePath(settings, extraRoots, filePath);
  if (check.blockedReason) {
    return { kind: "blocked", content: null, truncated: false, size: 0, message: check.blockedReason };
  }
  const resolved = check.resolved;
  const stat = fs.statSync(resolved);
  if (!stat.isFile()) {
    return { kind: "binary", content: null, truncated: false, size: 0, message: "Not a regular file." };
  }
  const ext = path.extname(resolved).toLowerCase();
  if (KNOWN_BINARY.has(ext)) {
    return { kind: "binary", content: null, truncated: false, size: stat.size, message: "Binary or non-previewable file type." };
  }
  const max = settings.limits.previewMaxBytes;
  const fd = fs.openSync(resolved, "r");
  try {
    const buf = Buffer.alloc(Math.min(stat.size, max));
    const read = fs.readSync(fd, buf, 0, buf.length, 0);
    const bytes = buf.subarray(0, read);
    if (isBinaryBuffer(bytes.subarray(0, BINARY_SNIFF_BYTES))) {
      return { kind: "binary", content: null, truncated: false, size: stat.size, message: "Binary file (contains non-text bytes)." };
    }
    return {
      kind: "text",
      content: bytes.toString("utf8"),
      truncated: stat.size > max,
      size: stat.size,
      message: null,
    };
  } finally {
    fs.closeSync(fd);
  }
}
