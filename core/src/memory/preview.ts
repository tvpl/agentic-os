import path from "node:path";
import type { Settings } from "../config/schema.js";
import {
  NotRegularFileError,
  inspectPath,
  openWorkspaceFile,
  readScope,
  resolveReadable,
  type ReadScope,
} from "../security/safeFs.js";
import { isBinaryBuffer, BINARY_SNIFF_BYTES } from "./excludes.js";

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

/** What the preview, the open action and the diff need to know about the engine's home. */
export interface WorkspaceAccessOptions {
  /** The MordomoOS home (required): its `config/` and `logs/` are never served. */
  homeDir: string;
  /** Platform whose file-name rules apply (tests); defaults to this process's. */
  platform?: NodeJS.Platform;
}

/** The scope of the user's indexed folders plus `extraRoots` (the callers pass the home). */
export function workspaceScope(
  settings: Settings,
  extraRoots: string[],
  options: WorkspaceAccessOptions,
): ReadScope {
  return readScope({
    homeDir: options.homeDir,
    roots: [...settings.indexedFolders.filter((f) => f.enabled).map((f) => f.path), ...extraRoots],
    excludes: settings.excludes,
    ...(options.platform ? { platform: options.platform } : {}),
  });
}

/**
 * Resolve a user-supplied path against the granted roots and evaluate the
 * shared exclusion policy (settings excludes, hard directory blocklist,
 * secret-file patterns). Throws PathAccessError when outside every root, and
 * also when inside the MordomoOS home's `config/` or `logs/` (`options.homeDir`):
 * those are not granted even though the home is a root.
 */
export function checkWorkspacePath(
  settings: Settings,
  extraRoots: string[],
  filePath: string,
  options: WorkspaceAccessOptions,
): WorkspacePathCheck {
  const verdict = inspectPath(workspaceScope(settings, extraRoots, options), filePath);
  return { resolved: verdict.real, root: verdict.root, rel: verdict.rel, blockedReason: verdict.blockedReason };
}

/**
 * For "open with the OS" and similar actions: the resolved path, or a
 * PathAccessError (403) when it is outside the roots OR excluded/blocklisted.
 */
export function resolveOpenablePath(
  settings: Settings,
  extraRoots: string[],
  filePath: string,
  options: WorkspaceAccessOptions,
): string {
  return resolveReadable(workspaceScope(settings, extraRoots, options), filePath).real;
}

/**
 * Safe read-only preview. Content is returned as plain text — the UI renders it
 * escaped, never as HTML/scripts, so hostile file content stays inert.
 * Binary detection is content-based (NUL byte in the first 8 KiB), with a
 * short extension list short-circuiting obviously binary formats. The bytes
 * come through `openWorkspaceFile`, like every other read.
 */
export function previewFile(
  settings: Settings,
  extraRoots: string[],
  filePath: string,
  options: WorkspaceAccessOptions,
): PreviewResult {
  const scope = workspaceScope(settings, extraRoots, options);
  const check = inspectPath(scope, filePath);
  if (check.blockedReason) {
    return { kind: "blocked", content: null, truncated: false, size: 0, message: check.blockedReason };
  }
  const ext = path.extname(check.real).toLowerCase();
  let file: ReturnType<typeof openWorkspaceFile>;
  try {
    file = openWorkspaceFile(scope, filePath);
  } catch (err) {
    if (err instanceof NotRegularFileError) {
      return { kind: "binary", content: null, truncated: false, size: 0, message: "Not a regular file." };
    }
    throw err;
  }
  try {
    const size = file.stat.size;
    if (KNOWN_BINARY.has(ext)) {
      return { kind: "binary", content: null, truncated: false, size, message: "Binary or non-previewable file type." };
    }
    const { bytes, truncated } = file.readBytes(settings.limits.previewMaxBytes);
    if (isBinaryBuffer(bytes.subarray(0, BINARY_SNIFF_BYTES))) {
      return { kind: "binary", content: null, truncated: false, size, message: "Binary file (contains non-text bytes)." };
    }
    return { kind: "text", content: bytes.toString("utf8"), truncated, size, message: null };
  } finally {
    file.close();
  }
}
