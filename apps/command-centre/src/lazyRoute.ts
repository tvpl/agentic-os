import { lazy, type ComponentType, type LazyExoticComponent } from "react";

const RELOAD_KEY = "mordomo.lazy-reload.v1";

/**
 * `React.lazy` for route chunks that survives an update. After a rebuild the
 * open tab still references the old hashed chunk names; the first navigation
 * into a route then fails with "Failed to fetch dynamically imported module".
 * Reload once (guarded per session) so the page picks up the new build,
 * otherwise let the error boundary show its recovery actions.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- mirrors React.lazy's own signature
export function lazyRoute<T extends ComponentType<any>>(
  importer: () => Promise<{ default: T }>,
): LazyExoticComponent<T> {
  return lazy(() =>
    importer().then(
      (mod) => {
        try {
          sessionStorage.removeItem(RELOAD_KEY);
        } catch {
          /* storage disabled */
        }
        return mod;
      },
      (error: unknown) => {
        if (isStaleChunkError(error) && markReload()) {
          location.reload();
          // Never resolves: the reload replaces the document.
          return new Promise<{ default: T }>(() => undefined);
        }
        throw error;
      },
    ),
  );
}

export function isStaleChunkError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /dynamically imported module|Importing a module script failed|Loading chunk|Loading CSS chunk/i.test(
    message,
  );
}

/** True the first time in this session; false when a reload already happened (avoid loops). */
function markReload(): boolean {
  try {
    if (sessionStorage.getItem(RELOAD_KEY)) return false;
    sessionStorage.setItem(RELOAD_KEY, String(Date.now()));
    return true;
  } catch {
    return false;
  }
}
