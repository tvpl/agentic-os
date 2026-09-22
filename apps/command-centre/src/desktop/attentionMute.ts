/**
 * Silenced failures (refino item 21): a failed run the user has looked at and
 * decided not to act on leaves the attention list without leaving history.
 * Kept per browser, bounded, and pure so the widget and the tests agree.
 */
export const MUTE_STORAGE_KEY = "mordomo.attention.muted";
export const MAX_MUTED = 200;

export function readMuted(storage: Pick<Storage, "getItem"> | null = safeStorage()): ReadonlySet<string> {
  try {
    const raw = storage?.getItem(MUTE_STORAGE_KEY);
    const list = raw ? (JSON.parse(raw) as unknown) : [];
    return new Set(Array.isArray(list) ? list.filter((x): x is string => typeof x === "string") : []);
  } catch {
    return new Set();
  }
}

/** Adds `id`, keeping the newest `MAX_MUTED`; never throws. */
export function mute(
  muted: ReadonlySet<string>,
  id: string,
  storage: Pick<Storage, "setItem"> | null = safeStorage(),
): ReadonlySet<string> {
  const next = [...muted].filter((x) => x !== id);
  next.push(id);
  const bounded = new Set(next.slice(-MAX_MUTED));
  try {
    storage?.setItem(MUTE_STORAGE_KEY, JSON.stringify([...bounded]));
  } catch {
    /* private mode, quota: the mute still applies for this session */
  }
  return bounded;
}

function safeStorage(): Storage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}
