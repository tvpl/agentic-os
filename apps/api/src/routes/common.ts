import type { AppContext } from "../context.js";

/** Error carrying an HTTP status — the global error handler maps it 1:1. */
export function httpError(statusCode: number, message: string, code?: string): Error & { statusCode: number; code?: string } {
  return Object.assign(new Error(message), { statusCode, ...(code ? { code } : {}) });
}

/** Roots a user-supplied path may resolve into: the home plus enabled indexed folders. */
export function grantedRoots(ctx: AppContext): string[] {
  return [ctx.paths.home, ...ctx.settings().indexedFolders.filter((f) => f.enabled).map((f) => f.path)];
}
