/**
 * Which shell is on screen (.specs/features/moldura-app). The preference lives
 * on the server, so the first paint has to guess without making the wrong
 * shell flash or the screen go blank. The rule:
 *
 *  1. The server's answer, once there, is the truth and wins every time it
 *     changes: the user saved a choice here, or another window did.
 *  2. Until it is there (loading) or when it cannot be had (the request
 *     failed), the last answer seen on this browser stands in: it is mirrored
 *     in `localStorage`, the way the theme preset is.
 *  3. With no mirror (a first visit): while loading, a neutral skeleton, never
 *     an empty page and never a shell that may be the wrong one; once the
 *     request has failed, the frame (the default of a new install), with the
 *     request retried quietly.
 *
 * So a failed load never swaps a Núcleo user into the frame, and the retry
 * that finally succeeds changes nothing when it agrees with what was shown.
 * The one swap left is a correction: the mirror (or the default) was wrong,
 * which needs a different browser or cleared site data.
 */
import { createContext, useContext, useEffect, useState } from "react";
import type { UiShell } from "../api";
import { useOsUiPreferences } from "../queries";

export const SHELL_HINT_KEY = "mordomo.shell";
/** How often a failed or unanswered preferences request is asked again, until it answers. */
const RETRY_MS = 5_000;

const asShell = (v: unknown): UiShell | null => (v === "moldura" || v === "nucleo" ? v : null);

export function readShellHint(): UiShell | null {
  try {
    return asShell(localStorage.getItem(SHELL_HINT_KEY));
  } catch {
    return null;
  }
}

function storeShellHint(shell: UiShell) {
  try {
    localStorage.setItem(SHELL_HINT_KEY, shell);
  } catch {
    /* private mode or blocked storage: the server's answer is all there is */
  }
}

/** The shell to mount, or `null` while nothing is known yet (show a skeleton). */
export function useShell(): UiShell | null {
  const prefs = useOsUiPreferences({
    staleTime: 30_000,
    refetchInterval: (query) => (query.state.data ? false : RETRY_MS),
  });
  const [hint] = useState(readShellHint);
  const server = asShell(prefs.data?.shell) ?? (prefs.data ? "moldura" : null);
  useEffect(() => {
    if (server) storeShellHint(server);
  }, [server]);
  // A retry puts a query that never had data back to "pending": remember that it failed, or the
  // frame mounted for the default would unmount into a skeleton on every quiet retry.
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (prefs.isError) setFailed(true);
  }, [prefs.isError]);
  if (server) return server;
  if (hint) return hint;
  return failed || prefs.isError ? "moldura" : null;
}

/**
 * The shell the tree below is part of. Views that render in both (Settings)
 * read it to hide what only one of them supports. Outside a provider (a view
 * mounted on its own) it is the Núcleo, which is where those views grew up.
 */
const ShellContext = createContext<UiShell>("nucleo");
export const ShellProvider = ShellContext.Provider;
export const useCurrentShell = (): UiShell => useContext(ShellContext);
