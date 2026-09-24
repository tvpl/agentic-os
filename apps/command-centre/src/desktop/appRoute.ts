/**
 * A panel's own route (redesign G2).
 *
 * The app views were written for the router: `useParams` for the run or the
 * skill they show, `useSearchParams` for the settings tab. Inside a panel the
 * URL is `/` — the stage may hold three apps at once — so the panel carries
 * its own path and query, and these two hooks read them. Outside a panel
 * (the stacked column still renders apps as pages) they fall through to the
 * router, so a view never has to know where it is mounted.
 */
import { createContext, useCallback, useContext, useMemo } from "react";
import { matchPath, useParams, useSearchParams } from "react-router-dom";
import type { AppLocation } from "./apps";

export interface AppRoute extends AppLocation {
  /** Move the panel: a new path, a new query, or both. */
  setLocation: (next: Partial<AppLocation>) => void;
}

export const AppRouteContext = createContext<AppRoute | null>(null);

/** Route params for `pattern` — the panel's path when in one, the URL's otherwise. */
export function usePanelParams<K extends string>(pattern: string): Partial<Record<K, string>> {
  const panel = useContext(AppRouteContext);
  const fromRouter = useParams();
  return useMemo(() => {
    if (!panel) return fromRouter as Partial<Record<K, string>>;
    const m = matchPath(pattern, panel.pathname);
    return (m?.params ?? {}) as Partial<Record<K, string>>;
  }, [panel, pattern, fromRouter]);
}

/**
 * `replace` is honoured by the router branch only: a panel's query is state,
 * not history — the browser's Back button steps between pages, never between
 * two selections inside one plate.
 */
type SetSearch = (next: Record<string, string> | URLSearchParams, opts?: { replace?: boolean }) => void;

/** The query string — the panel's when in one, the URL's otherwise. */
export function usePanelSearchParams(): [URLSearchParams, SetSearch] {
  const panel = useContext(AppRouteContext);
  const [fromRouter, setRouter] = useSearchParams();
  const params = useMemo(() => new URLSearchParams(panel?.search ?? ""), [panel?.search]);
  const setPanel = useCallback<SetSearch>(
    (next) => {
      const qs = new URLSearchParams(next).toString();
      panel?.setLocation({ search: qs ? `?${qs}` : "" });
    },
    [panel],
  );
  const setViaRouter = useCallback<SetSearch>((next, opts) => setRouter(next, opts), [setRouter]);
  return panel ? [params, setPanel] : [fromRouter, setViaRouter];
}
