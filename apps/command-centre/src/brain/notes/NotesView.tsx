/**
 * The notes view of the Second Brain (.specs/features/cerebro-vista-notas; design.md "Tela - Vista de notas"), the
 * same in both shells: three columns, the notes sidebar (260 px, 200 to 400 px by its edge), the reading area with the
 * tabs, and the note panel (280 px, closed under 1 100 px of useful width). It follows the active work context
 * (`useWorkContext`): its tree, search and related files are the context's, and a new context makes its first root
 * the current one while the tabs stay. Its own chunk, fetched the first time "Notas" is chosen.
 */
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { PanelLeft, PanelRight } from "lucide-react";
import { ApiError } from "../../api";
import { useT } from "../../i18n";
import { Tooltip } from "../../ui";
import { Button } from "../../components/primitives";
import { useWorkContext } from "../../contexts/useWorkContext";
import type { BrainHit } from "../memoryData";
import { FolderView } from "./FolderView";
import type { NoteDraft } from "./NoteEditInPlace";
import { NotePanel } from "./NotePanel";
import { NoteReader } from "./NoteReader";
import { NoteSearch } from "./NoteSearch";
import { NoteTabs, useCloseTab } from "./NoteTabs";
import { useNotesCommands } from "./notesCommands";
import { NotesSidebar } from "./NotesSidebar";
import { useMemoryRoot, useNoteIdentity, useTreeLevel } from "./notesData";
import { useNotesState, type NoteMeta } from "./useNotesState";
import "./notes.css";

export const SIDEBAR = { initial: 260, min: 200, max: 400, step: 16 } as const;
/** Below this useful width the note panel is closed (design.md). */
export const PANEL_MIN_WIDTH = 1100;

export interface NotesViewProps {
  /** "Ver no grafo": the graph, with this note selected, in local mode with 1 hop (AC 23). */
  onShowInGraph: (id: number) => void;
}

export default function NotesView({ onShowInGraph }: NotesViewProps) {
  const t = useT();
  const work = useWorkContext();
  const state = useNotesState();
  const memoryRoot = useMemoryRoot();

  /* ---------- the tree's first level: the roots, the root, its entries ---------- */
  const top = useTreeLevel(
    { context: work.query, root: state.root ?? undefined, sort: state.sort },
    state.ready && work.ready,
  );
  const { root: storedRoot, setRoot, selectFolder } = state;
  // A root the tree no longer has (another context, a folder taken out): back to the default.
  useEffect(() => {
    if (storedRoot !== null && top.error instanceof ApiError && top.error.code === "unknown_root")
      setRoot(null);
  }, [top.error, storedRoot, setRoot]);
  // A new context: its first root becomes the current one; the tabs stay (AC 54).
  const seen = useRef<string | null>(null);
  useEffect(() => {
    if (!work.ready || !state.ready) return;
    const now = work.query ?? "";
    if (seen.current === null) seen.current = now;
    else if (seen.current !== now) {
      seen.current = now;
      setRoot(null);
      selectFolder(null);
    }
  }, [work.ready, work.query, state.ready, setRoot, selectFolder]);
  const root = top.data?.root ?? (top.isPending ? storedRoot : null);

  /* ---------- what the reading area shows ---------- */
  const active = state.tabs.active;
  const home = root ? state.home[root] : undefined;
  const shown = state.folder ? null : (active ?? home ?? null);
  const identity = useNoteIdentity(
    shown,
    shown ? state.meta.get(shown) : undefined,
    top.data?.roots ?? null,
    work.query,
  );
  const shownId = identity?.id ?? null;
  const { remember } = state;
  useEffect(() => {
    if (shown && identity) remember(shown, { id: identity.id, title: identity.title });
  }, [shown, identity, remember]);

  const open = useCallback((path: string, meta: NoteMeta = {}) => state.open(path, meta), [state]);

  /* ---------- editing in place: which tabs are editors, and their texts not saved yet ---------- */
  const [editing, setEditing] = useState<ReadonlySet<string>>(() => new Set());
  const drafts = useRef(new Map<string, NoteDraft>()).current;
  const edit = useCallback((path: string, on: boolean) => {
    setEditing((cur) => {
      if (cur.has(path) === on) return cur;
      const next = new Set(cur);
      if (on) next.add(path);
      else next.delete(path);
      return next;
    });
  }, []);
  const openToEdit = useCallback(
    (path: string, meta: NoteMeta = {}) => {
      if (state.open(path, meta)) edit(path, true);
    },
    [state, edit],
  );
  // A closed tab forgets its editor and what it held.
  const openTabs = state.tabs.tabs;
  useEffect(() => {
    const kept = new Set(openTabs);
    for (const path of drafts.keys()) if (!kept.has(path)) drafts.delete(path);
    setEditing((cur) =>
      [...cur].every((p) => kept.has(p)) ? cur : new Set([...cur].filter((p) => kept.has(p))),
    );
  }, [openTabs, drafts]);
  const { markUnsaved } = state;
  const onUnsaved = useCallback((on: boolean) => shown && markUnsaved(shown, on), [shown, markUnsaved]);
  const closeTab = useCloseTab(state);
  const setHome = useCallback((path: string) => root && state.setHome(root, path), [root, state]);

  /* ---------- the commands of the view (comandos-atalhos design.md) ---------- */
  useNotesCommands(active, setHome, closeTab);

  /* ---------- layout: the sidebar's edge and the panel's room ---------- */
  const rootRef = useRef<HTMLDivElement>(null);
  const [side, setSide] = useState<number>(SIDEBAR.initial);
  const [width, setWidth] = useState(0);
  const [panelClosed, setPanelClosed] = useState(false);
  const [sideOpen, setSideOpen] = useState(true);
  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const measure = () => setWidth(el.getBoundingClientRect().width);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const roomForPanel = width >= PANEL_MIN_WIDTH;
  const panelOpen = roomForPanel && !panelClosed;
  const clampSide = (px: number) => Math.round(Math.min(SIDEBAR.max, Math.max(SIDEBAR.min, px)));
  const drag = (e: ReactPointerEvent<HTMLButtonElement>) => {
    const left = rootRef.current?.getBoundingClientRect().left ?? 0;
    const el = e.currentTarget;
    el.setPointerCapture(e.pointerId);
    const onMove = (ev: PointerEvent) => setSide(clampSide(ev.clientX - left));
    const onUp = (ev: PointerEvent) => {
      el.releasePointerCapture(ev.pointerId);
      el.removeEventListener("pointermove", onMove);
      el.removeEventListener("pointerup", onUp);
    };
    el.addEventListener("pointermove", onMove);
    el.addEventListener("pointerup", onUp);
  };
  const nudge = (e: KeyboardEvent<HTMLButtonElement>) => {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    e.preventDefault();
    setSide((w) => clampSide(w + (e.key === "ArrowRight" ? SIDEBAR.step : -SIDEBAR.step)));
  };

  const selected = state.folder ? `${state.folder.root}/${state.folder.rel}` : active;

  return (
    <div
      ref={rootRef}
      className="notes-view"
      data-panel={panelOpen ? "" : undefined}
      data-folded={sideOpen ? undefined : ""}
      style={{ "--notes-side": `${side}px` } as CSSProperties}
    >
      <aside className="notes-sidebar" aria-label={t("notes.view.notes")} hidden={!sideOpen}>
        <NotesSidebar
          state={state}
          work={work}
          top={top}
          root={root}
          memoryRoot={memoryRoot}
          selected={selected}
          onOpen={open}
          onSelectFolder={state.selectFolder}
          onCreated={openToEdit}
        />
      </aside>
      <button
        type="button"
        className="notes-edge"
        aria-label={t("notes.sidebar.resize")}
        hidden={!sideOpen}
        onPointerDown={drag}
        onKeyDown={nudge}
      />
      <section className="notes-main" aria-label={t("notes.tab.list")}>
        <Tooltip label={t("notes.sidebar.toggle")}>
          <button
            type="button"
            className="notes-icon-btn notes-side-toggle"
            aria-label={t("notes.sidebar.toggle")}
            aria-pressed={sideOpen}
            onClick={() => setSideOpen((v) => !v)}
          >
            <PanelLeft aria-hidden />
          </button>
        </Tooltip>
        <NoteTabs state={state} context={work.query} value={state.folder ? null : active}>
          {state.folder ? (
            <FolderView
              folder={state.folder}
              context={work.query}
              sort={state.sort}
              onOpen={open}
              onSelectFolder={state.selectFolder}
              onShowInGraph={onShowInGraph}
              onSetHome={setHome}
              onEditInTab={openToEdit}
            />
          ) : shown ? (
            <NoteReader
              key={shown}
              path={shown}
              id={shownId}
              meta={state.meta.get(shown) ?? {}}
              onOpen={open}
              onShowInGraph={onShowInGraph}
              onSetHome={setHome}
              onCloseTab={active === shown ? () => void closeTab(shown) : undefined}
              editing={editing.has(shown)}
              onEdit={(on) => (active === shown ? edit(shown, on) : openToEdit(shown))}
              drafts={drafts}
              unsaved={state.unsaved.has(shown)}
              onUnsaved={onUnsaved}
              context={work.query}
            />
          ) : (
            <NoHome
              root={root}
              context={work.query}
              onPick={(hit) => {
                if (!root || !hit.path) return;
                state.remember(hit.path, { id: hit.id, title: hit.title ?? null });
                state.setHome(root, hit.path);
              }}
            />
          )}
        </NoteTabs>
        {roomForPanel && (
          <Tooltip label={t("notes.panel.toggle")}>
            <button
              type="button"
              className="notes-icon-btn notes-panel-toggle"
              aria-label={t("notes.panel.toggle")}
              aria-pressed={panelOpen}
              onClick={() => setPanelClosed((v) => !v)}
            >
              <PanelRight aria-hidden />
            </button>
          </Tooltip>
        )}
      </section>
      {panelOpen && (
        <aside className="notes-panel" aria-label={t("notes.panel.label")}>
          {shown && <NotePanel key={shown} path={shown} id={shownId} context={work.query} onOpen={open} />}
        </aside>
      )}
    </div>
  );
}

/** No tab and no Home (AC 19): what to do, and the way to choose a Home. */
function NoHome({
  root,
  context,
  onPick,
}: {
  root: string | null;
  context?: string;
  onPick: (hit: BrainHit) => void;
}) {
  const t = useT();
  const anchor = useRef<HTMLButtonElement>(null);
  const [choosing, setChoosing] = useState(false);
  return (
    <div className="notes-reader-state">
      <p>{t("notes.reader.empty")}</p>
      <Button ref={anchor} size="sm" variant="secondary" disabled={!root} onClick={() => setChoosing(true)}>
        {t("notes.home.set")}
      </Button>
      <NoteSearch
        open={choosing}
        onClose={() => setChoosing(false)}
        anchor={anchor}
        context={context}
        label={t("notes.home.choose")}
        onPick={(hit) => {
          setChoosing(false);
          onPick(hit);
        }}
      />
    </div>
  );
}
