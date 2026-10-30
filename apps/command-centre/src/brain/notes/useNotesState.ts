/**
 * The state of the notes view (.specs/features/cerebro-vista-notas, door 4): the root, a Home per root, the tabs and
 * the active one, the sort and the open folders live in `UiPreferences.brain.notes`, per machine, and are written
 * back (whole, so a field is never merged with a stale one) a moment after they change. What lasts only while the view
 * is open: which tabs have unsaved changes, the folder selected in the tree, and what is known of each open note.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { UiPreferencesDoc } from "../../api";
import { useT } from "../../i18n";
import { useToast } from "../../components/ui";
import { useOsUiPreferences, useSaveUiPreferences } from "../../queries";
import { closeTab, focusTab, NO_TABS, openTab, restoreTabs, type TabsState } from "./tabs";

export type NotesSort = "name" | "updated";
type StoredNotes = NonNullable<NonNullable<UiPreferencesDoc["brain"]>["notes"]>;

/** What the view knows of a note it was handed (by the tree, the search, a link or the Home). */
export interface NoteMeta {
  id?: number;
  title?: string | null;
}

/** A folder of the tree, selected: the reading area shows its index note or its entries (AC 9). */
export interface FolderSelection {
  root: string;
  rel: string;
  name: string;
}

const SAVE_DELAY_MS = 400;
const MAX_EXPANDED = 500;

export interface NotesState {
  ready: boolean;
  /** The root chosen; `null` is the tree's default (memory/, or the context's first root). */
  root: string | null;
  setRoot: (root: string | null) => void;
  sort: NotesSort;
  setSort: (sort: NotesSort) => void;
  expanded: ReadonlySet<string>;
  setExpanded: (path: string, open: boolean) => void;
  collapseAll: () => void;
  home: Readonly<Record<string, string>>;
  setHome: (root: string, path: string) => void;
  tabs: TabsState;
  /** Open `path` in a tab (or focus it); false when the 12 tabs all have unsaved changes. */
  open: (path: string, meta?: NoteMeta) => boolean;
  focus: (path: string) => void;
  /** Close at once: asking about unsaved changes is the caller's (`NoteTabs`). */
  close: (path: string) => void;
  unsaved: ReadonlySet<string>;
  /** The editor of a tab says whether it holds unsaved changes. */
  markUnsaved: (path: string, unsaved: boolean) => void;
  meta: ReadonlyMap<string, NoteMeta>;
  remember: (path: string, meta: NoteMeta) => void;
  folder: FolderSelection | null;
  selectFolder: (folder: FolderSelection | null) => void;
}

export function useNotesState(): NotesState {
  const t = useT();
  const toast = useToast();
  const prefs = useOsUiPreferences();
  const save = useSaveUiPreferences();
  const [stored, setStored] = useState<StoredNotes | null>(null);
  const [tabs, setTabs] = useState<TabsState>(NO_TABS);
  const [unsaved, setUnsaved] = useState<ReadonlySet<string>>(() => new Set());
  const [meta, setMeta] = useState<ReadonlyMap<string, NoteMeta>>(() => new Map());
  const [folder, setFolder] = useState<FolderSelection | null>(null);
  const stamp = useRef(1);

  // Read once, when the preferences arrive (a reload reopens the view as it was, AC 17).
  const loaded = prefs.isSuccess || prefs.isError;
  useEffect(() => {
    if (stored !== null || !loaded) return;
    const notes = prefs.data?.brain?.notes;
    setStored({
      root: notes?.root ?? null,
      home: notes?.home ?? {},
      tabs: notes?.tabs ?? [],
      active: notes?.active ?? null,
      sort: notes?.sort ?? "name",
      expanded: notes?.expanded ?? [],
    });
    setTabs(restoreTabs(notes?.tabs ?? [], notes?.active ?? null));
  }, [loaded, prefs.data, stored]);

  // Written back whole, a moment after the last change.
  const toSave = useMemo<StoredNotes | null>(
    () => (stored === null ? null : { ...stored, tabs: [...tabs.tabs], active: tabs.active }),
    [stored, tabs.tabs, tabs.active],
  );
  const first = useRef(true);
  const pending = useRef<StoredNotes | null>(null);
  const saveRef = useRef(save);
  saveRef.current = save;
  useEffect(() => {
    if (toSave === null) return;
    if (first.current) {
      first.current = false;
      return;
    }
    pending.current = toSave;
    const id = window.setTimeout(() => {
      pending.current = null;
      void saveRef.current({ brain: { notes: toSave } }).catch(() => undefined);
    }, SAVE_DELAY_MS);
    return () => window.clearTimeout(id);
  }, [toSave]);
  // Leaving the view writes what was still waiting.
  useEffect(
    () => () => {
      if (pending.current) void saveRef.current({ brain: { notes: pending.current } }).catch(() => undefined);
    },
    [],
  );

  const patch = useCallback((change: Partial<StoredNotes>) => {
    setStored((cur) => (cur ? { ...cur, ...change } : cur));
  }, []);

  const unsavedRef = useRef(unsaved);
  unsavedRef.current = unsaved;
  const tabsRef = useRef(tabs);
  tabsRef.current = tabs;

  const remember = useCallback((path: string, m: NoteMeta) => {
    setMeta((cur) => {
      const before = cur.get(path);
      if (before && before.id === (m.id ?? before.id) && before.title === (m.title ?? before.title))
        return cur;
      const next = new Map(cur);
      next.set(path, { ...before, ...m });
      return next;
    });
  }, []);

  const open = useCallback(
    (path: string, m?: NoteMeta) => {
      if (m) remember(path, m);
      const result = openTab(tabsRef.current, path, unsavedRef.current, stamp.current++);
      if (result.refused) {
        toast(t("notes.tab.full"), "info");
        return false;
      }
      tabsRef.current = result.state;
      setTabs(result.state);
      setFolder(null);
      return true;
    },
    [remember, toast, t],
  );
  const focus = useCallback((path: string) => {
    setTabs((cur) => focusTab(cur, path, stamp.current++));
    setFolder(null);
  }, []);
  const close = useCallback((path: string) => {
    setTabs((cur) => closeTab(cur, path));
    setUnsaved((cur) => {
      if (!cur.has(path)) return cur;
      const next = new Set(cur);
      next.delete(path);
      return next;
    });
  }, []);
  const markUnsaved = useCallback((path: string, on: boolean) => {
    setUnsaved((cur) => {
      if (cur.has(path) === on) return cur;
      const next = new Set(cur);
      if (on) next.add(path);
      else next.delete(path);
      return next;
    });
  }, []);

  const expanded = useMemo(() => new Set(stored?.expanded ?? []), [stored?.expanded]);
  const setExpanded = useCallback((path: string, on: boolean) => {
    setStored((cur) => {
      if (!cur) return cur;
      const has = cur.expanded.includes(path);
      if (has === on) return cur;
      const next = on ? [...cur.expanded, path].slice(-MAX_EXPANDED) : cur.expanded.filter((p) => p !== path);
      return { ...cur, expanded: next };
    });
  }, []);

  return {
    ready: stored !== null,
    root: stored?.root ?? null,
    setRoot: useCallback((root: string | null) => patch({ root }), [patch]),
    sort: stored?.sort ?? "name",
    setSort: useCallback((sort: NotesSort) => patch({ sort }), [patch]),
    expanded,
    setExpanded,
    collapseAll: useCallback(() => patch({ expanded: [] }), [patch]),
    home: stored?.home ?? {},
    setHome: useCallback(
      (root: string, path: string) =>
        setStored((cur) => (cur ? { ...cur, home: { ...cur.home, [root]: path } } : cur)),
      [],
    ),
    tabs,
    open,
    focus,
    close,
    unsaved,
    markUnsaved,
    meta,
    remember,
    folder,
    selectFolder: setFolder,
  };
}
