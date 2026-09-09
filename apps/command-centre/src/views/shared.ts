/** Small helpers shared by the F4 views (Skills, Routines, Settings, Connectors, Setup, Pixel Studio). */
import { ApiError } from "../api";

export function errorMessage(
  err: unknown,
  translate?: (key: "brain.indexUnavailable" | "brain.sourceMissing") => string,
): string {
  if (err instanceof ApiError && err.code === "index_scan_incomplete" && translate) {
    return translate("brain.indexUnavailable");
  }
  if (err instanceof ApiError && err.code === "source_missing" && translate)
    return translate("brain.sourceMissing");
  if (err instanceof Error) return err.message;
  return String(err);
}

/** True when the local service could not be reached at all (network/timeout). */
export function isOffline(err: unknown): boolean {
  return err instanceof ApiError && err.unreachable;
}

/** Absolute POSIX (`/x`), Windows drive (`C:\x`) or UNC (`\\host\x`) path. */
export function isAbsolutePath(p: string): boolean {
  return /^(\/|[A-Za-z]:[\\/]|\\\\)/.test(p.trim());
}

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

export const SLUG_RE = /^[a-z0-9][a-z0-9-]{1,40}$/;

export function slugify(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 41);
}

/** Trigger a browser download for a data:/blob: URL. */
export function downloadUrl(url: string, filename: string): void {
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
}
