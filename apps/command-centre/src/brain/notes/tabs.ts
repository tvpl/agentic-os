/**
 * The tabs of the notes view (.specs/features/cerebro-vista-notas, AC 14-16, door 4), as pure rules: a note already
 * open is focused, never opened twice; a new one opens right after the active tab; past 12 the least recently focused
 * tab with no unsaved changes makes room, and with all 12 unsaved nothing opens. Paths are absolute.
 */
export const MAX_TABS = 12;

export interface TabsState {
  tabs: readonly string[];
  active: string | null;
  /** When each tab was last focused (a counter, not a clock): the least recent is the first to go. */
  focusedAt: Readonly<Record<string, number>>;
}

export const NO_TABS: TabsState = { tabs: [], active: null, focusedAt: {} };

/** Open `path`: `refused` when every one of the 12 tabs has unsaved changes. */
export function openTab(
  state: TabsState,
  path: string,
  unsaved: ReadonlySet<string>,
  stamp: number,
): { state: TabsState; refused: boolean } {
  if (state.tabs.includes(path)) return { state: focusTab(state, path, stamp), refused: false };
  let tabs = [...state.tabs];
  const focusedAt = { ...state.focusedAt };
  if (tabs.length >= MAX_TABS) {
    const room = tabs
      .filter((p) => !unsaved.has(p))
      .sort((a, b) => (focusedAt[a] ?? -1) - (focusedAt[b] ?? -1))[0];
    if (room === undefined) return { state, refused: true };
    tabs = tabs.filter((p) => p !== room);
    delete focusedAt[room];
  }
  const at = state.active === null ? -1 : tabs.indexOf(state.active);
  tabs.splice(at < 0 ? tabs.length : at + 1, 0, path);
  focusedAt[path] = stamp;
  return { state: { tabs, active: path, focusedAt }, refused: false };
}

export function focusTab(state: TabsState, path: string, stamp: number): TabsState {
  if (!state.tabs.includes(path)) return state;
  return { ...state, active: path, focusedAt: { ...state.focusedAt, [path]: stamp } };
}

/** Close `path`; the active tab moves to the one that took its place (the next, else the previous). */
export function closeTab(state: TabsState, path: string): TabsState {
  const at = state.tabs.indexOf(path);
  if (at < 0) return state;
  const tabs = state.tabs.filter((p) => p !== path);
  const focusedAt = { ...state.focusedAt };
  delete focusedAt[path];
  const active = state.active === path ? (tabs[at] ?? tabs[at - 1] ?? null) : state.active;
  return { tabs, active, focusedAt };
}

/** The tabs read back from the preferences: no repeats, at most 12, the active one only if it is open. */
export function restoreTabs(tabs: readonly string[], active: string | null): TabsState {
  const open = [...new Set(tabs)].slice(0, MAX_TABS);
  const focusedAt: Record<string, number> = {};
  open.forEach((p, i) => (focusedAt[p] = -open.length + i));
  const current = active !== null && open.includes(active) ? active : (open[0] ?? null);
  if (current !== null) focusedAt[current] = 0;
  return { tabs: open, active: current, focusedAt };
}
