/**
 * The notes sidebar (.specs/features/cerebro-vista-notas, design.md "Barra das notas" and its amendments): the line of
 * the active work context (it opens the shell's own selector: no second one is mounted, C31), the root and its menu,
 * the state of the index with "Reindexar" / "Cancelar", the Home, the heading "NOTAS" with "Recolher tudo" and
 * "Ordenar", and the tree with its empty, loading and failed states.
 */
import { useRef, useState } from "react";
import {
  ArrowDownWideNarrow,
  Ban,
  BrainCircuit,
  Check,
  ChevronsDownUp,
  CircleAlert,
  Crosshair,
  FolderOpen,
  Home,
  Loader,
  RefreshCw,
  X,
} from "lucide-react";
import { ApiError, type IndexProgressPayload } from "../../api";
import { apiCall } from "../../apiCall";
import { useLang, useT } from "../../i18n";
import { timeAgo, useToast } from "../../components/ui";
import { Button } from "../../components/primitives";
import { DropdownMenu, Tooltip, type MenuEntry } from "../../ui";
import { useOsEvent } from "../../hooks/useEventStream";
import { qk, useInvalidate, useRouteQuery } from "../../queries";
import { useRegisteredCommands } from "../../commands/registry";
import { SWITCH_CONTEXT_ID } from "../../contexts/ContextSelector";
import type { WorkContextState } from "../../contexts/useWorkContext";
import { errorMessage } from "../../views/shared";
import type { BrainHit } from "../memoryData";
import { NoteSearch } from "./NoteSearch";
import { NotesTree } from "./NotesTree";
import type { TreeFile, TreeLevel, TreeRoot } from "./notesData";
import { baseName, withoutExt } from "./notesData";
import type { FolderSelection, NotesState } from "./useNotesState";
import type { UseQueryResult } from "@tanstack/react-query";

export interface NotesSidebarProps {
  state: NotesState;
  work: WorkContextState;
  /** The first level of the current root (it also holds the roots). */
  top: UseQueryResult<TreeLevel, Error>;
  /** The current root, as the tree answered it. */
  root: string | null;
  /** `<home>/memory`: the root where new notes are written. */
  memoryRoot: string | null;
  selected: string | null;
  onOpen: (path: string, meta: { id?: number; title?: string | null }) => void;
  onSelectFolder: (folder: FolderSelection) => void;
  onNewNote: () => void;
}

export function rootLabel(
  root: TreeRoot | { path: string; name: string },
  memoryRoot: string | null,
  t: ReturnType<typeof useT>,
) {
  return root.path === memoryRoot ? t("notes.root.memory") : root.name;
}

export function NotesSidebar(p: NotesSidebarProps) {
  const t = useT();
  const status = useRouteQuery(qk.memoryStatus, "GET /api/memory/status", undefined, { staleTime: 30_000 });
  const nothingIndexed = status.data
    ? status.data.lastIndex === null && status.data.facets.total === 0
    : false;
  const index = useIndexState(status.data?.indexing.state === "running", status.data?.lastIndex?.at ?? null);
  return (
    <div className="notes-sidebar-body">
      <ContextLine work={p.work} />
      <div className="notes-rootbox">
        <RootMenu {...p} />
        <IndexLine index={index} />
      </div>
      <HomeLine {...p} />
      <div className="notes-heading-row">
        <h2 className="notes-heading">{t("notes.tree.heading")}</h2>
        <span className="notes-heading-tools">
          <Tooltip label={t("notes.tree.collapse")}>
            <button
              type="button"
              className="notes-icon-btn"
              aria-label={t("notes.tree.collapse")}
              onClick={p.state.collapseAll}
            >
              <ChevronsDownUp aria-hidden />
            </button>
          </Tooltip>
          <SortMenu state={p.state} />
        </span>
      </div>
      <TreeArea {...p} nothingIndexed={nothingIndexed} onReindex={index.reindex} />
    </div>
  );
}

/** The active work context, read from `useWorkContext`; choosing it opens the shell's selector (amendment 1). */
function ContextLine({ work }: { work: WorkContextState }) {
  const t = useT();
  const commands = useRegisteredCommands();
  const name = work.active ? work.active.name : t("context.all");
  return (
    <button
      type="button"
      className="notes-context"
      onClick={() => commands.find((c) => c.id === SWITCH_CONTEXT_ID)?.run()}
    >
      <Crosshair aria-hidden />
      <span className="notes-context-name">{name}</span>
    </button>
  );
}

function RootMenu(p: NotesSidebarProps) {
  const t = useT();
  const roots = p.top.data?.roots ?? [];
  const current = roots.find((r) => r.path === p.root) ?? null;
  const badges = (r: TreeRoot) => (
    <span className="notes-root-badges">
      <span className="notes-badge">{r.editable ? t("notes.root.editable") : t("notes.root.readonly")}</span>
      {r.indexing && <span className="notes-badge">{t("notes.root.indexing")}</span>}
    </span>
  );
  const items: MenuEntry[] = roots.map((r) => ({
    id: `root:${r.path}`,
    checked: r.path === p.root,
    onSelect: () => {
      p.state.setRoot(r.path);
      p.state.selectFolder(null);
    },
    label: (
      <span className="notes-root-item">
        <span className="notes-root-name">{rootLabel(r, p.memoryRoot, t)}</span>
        <span className="notes-root-path">{r.path}</span>
        {badges(r)}
      </span>
    ),
  }));
  const Icon = current && current.path === p.memoryRoot ? BrainCircuit : FolderOpen;
  return (
    <DropdownMenu
      align="start"
      className="notes-root-menu"
      items={items}
      trigger={
        <button type="button" className="notes-root" disabled={roots.length === 0}>
          <Icon aria-hidden className="notes-root-icon" />
          <span className="notes-root-text">
            <span className="notes-root-name">{current ? rootLabel(current, p.memoryRoot, t) : "—"}</span>
            <span className="notes-root-path">{current?.path ?? ""}</span>
          </span>
        </button>
      }
    />
  );
}

interface IndexState {
  kind: "idle" | "running" | "done" | "cancelled" | "failed";
  progress: IndexProgressPayload | null;
  at: number | null;
  code: string | null;
  reindex: () => void;
  cancel: () => void;
}

/** The index pass as the events tell it (AC 10, AC 11); the status of the index before the first event. */
function useIndexState(runningAtStart: boolean, lastAt: number | null): IndexState {
  const t = useT();
  const toast = useToast();
  const invalidate = useInvalidate();
  const [kind, setKind] = useState<IndexState["kind"] | null>(null);
  const [progress, setProgress] = useState<IndexProgressPayload | null>(null);
  const [at, setAt] = useState<number | null>(null);
  const [code, setCode] = useState<string | null>(null);
  const [asking, setAsking] = useState(false);
  useOsEvent("index.started", () => {
    setKind("running");
    setProgress(null);
  });
  useOsEvent("index.progress", (e) => {
    setKind("running");
    setProgress(e.payload as IndexProgressPayload);
  });
  useOsEvent("index.finished", () => {
    setKind("done");
    setAt(Date.now());
    setProgress(null);
  });
  useOsEvent("index.cancelled", () => {
    setKind("cancelled");
    setProgress(null);
  });
  useOsEvent("index.failed", (e) => {
    setKind("failed");
    setCode((e.payload as { code?: string }).code ?? null);
    setProgress(null);
  });
  const shown: IndexState["kind"] =
    asking && kind !== "running"
      ? "running"
      : (kind ?? (runningAtStart ? "running" : lastAt ? "done" : "idle"));
  return {
    kind: shown,
    progress,
    at: at ?? lastAt,
    code,
    reindex: () => {
      setAsking(true);
      void apiCall("POST /api/memory/index")
        .then(() => invalidate(qk.memoryStatus, ["memory", "tree"]))
        .catch((err: unknown) => {
          // A cancel and a failure are said in the line (index.cancelled, index.failed), not twice.
          if (!(
            err instanceof ApiError &&
            ["index_cancelled", "index_worker_crashed", "index_worker_out_of_memory"].includes(err.code)
          ))
            toast(errorMessage(err, t), "danger");
        })
        .finally(() => setAsking(false));
    },
    cancel: () => {
      void apiCall("POST /api/memory/index/cancel", { body: {} }).catch((err: unknown) =>
        toast(errorMessage(err, t), "danger"),
      );
    },
  };
}

function failureText(code: string | null, t: ReturnType<typeof useT>): string {
  if (code === "index_worker_crashed") return t("notes.index.code.crashed");
  if (code === "index_worker_out_of_memory") return t("notes.index.code.memory");
  if (code === "index_scan_incomplete") return t("notes.index.code.scan");
  return t("notes.index.code.other", { code: code ?? "?" });
}

function IndexLine({ index }: { index: IndexState }) {
  const t = useT();
  const lang = useLang();
  const running = index.kind === "running";
  let line = null;
  if (running) {
    const x = index.progress?.scanned ?? 0;
    const y = index.progress?.total ?? "…";
    line = (
      <>
        <Loader aria-hidden className="notes-spin" />
        <span>{t("notes.index.running", { x, y })}</span>
      </>
    );
  } else if (index.kind === "done" && index.at !== null)
    line = (
      <>
        <Check aria-hidden />
        <span>{t("notes.index.done", { when: timeAgo(index.at, lang) })}</span>
      </>
    );
  else if (index.kind === "cancelled")
    line = (
      <>
        <Ban aria-hidden />
        <span>{t("notes.index.cancelled")}</span>
      </>
    );
  else if (index.kind === "failed") {
    const why = failureText(index.code, t);
    line = (
      <Tooltip label={why}>
        <span className="notes-index-failed" role="img" aria-label={`${t("notes.index.failed")}: ${why}`}>
          <CircleAlert aria-hidden />
          {t("notes.index.failed")}
        </span>
      </Tooltip>
    );
  }
  const action = running ? t("notes.index.cancel") : t("notes.index.reindex");
  return (
    <div className="notes-index">
      <div className="notes-index-line" role="status" aria-live="polite">
        {line}
      </div>
      <Tooltip label={action}>
        <button
          type="button"
          className="notes-icon-btn"
          aria-label={action}
          onClick={running ? index.cancel : index.reindex}
        >
          {running ? <X aria-hidden /> : <RefreshCw aria-hidden />}
        </button>
      </Tooltip>
    </div>
  );
}

function HomeLine(p: NotesSidebarProps) {
  const t = useT();
  const anchor = useRef<HTMLButtonElement>(null);
  const [choosing, setChoosing] = useState(false);
  const home = p.root ? p.state.home[p.root] : undefined;
  const known = home ? p.state.meta.get(home) : undefined;
  if (home)
    return (
      <button type="button" className="notes-home" onClick={() => p.onOpen(home, known ?? {})}>
        <Home aria-hidden />
        <span className="notes-home-title">{known?.title ?? withoutExt(baseName(home))}</span>
      </button>
    );
  return (
    <>
      <button
        ref={anchor}
        type="button"
        className="notes-home notes-home-empty"
        disabled={!p.root}
        aria-haspopup="dialog"
        onClick={() => setChoosing(true)}
      >
        <Home aria-hidden />
        <span>{t("notes.home.set")}</span>
      </button>
      <NoteSearch
        open={choosing}
        onClose={() => setChoosing(false)}
        anchor={anchor}
        context={p.work.query}
        label={t("notes.home.choose")}
        onPick={(hit: BrainHit) => {
          setChoosing(false);
          if (!p.root || !hit.path) return;
          p.state.remember(hit.path, { id: hit.id, title: hit.title ?? null });
          p.state.setHome(p.root, hit.path);
        }}
      />
    </>
  );
}

function SortMenu({ state }: { state: NotesState }) {
  const t = useT();
  return (
    <DropdownMenu
      tip={t("notes.tree.sort")}
      items={[
        {
          id: "name",
          label: t("notes.sort.name"),
          checked: state.sort === "name",
          onSelect: () => state.setSort("name"),
        },
        {
          id: "updated",
          label: t("notes.sort.updated"),
          checked: state.sort === "updated",
          onSelect: () => state.setSort("updated"),
        },
      ]}
      trigger={
        <button type="button" className="notes-icon-btn" aria-label={t("notes.tree.sort")}>
          <ArrowDownWideNarrow aria-hidden />
        </button>
      }
    />
  );
}

function TreeArea(p: NotesSidebarProps & { nothingIndexed: boolean; onReindex: () => void }) {
  const t = useT();
  const top = p.top;
  if (p.nothingIndexed)
    return (
      <div className="notes-empty">
        <p>{t("notes.tree.nothing")}</p>
        <Button size="sm" variant="secondary" onClick={p.onReindex}>
          {t("notes.index.reindex")}
        </Button>
      </div>
    );
  if (top.isPending)
    return (
      <div className="notes-skeleton" aria-busy="true">
        <span className="sr-only">{t("common.loading")}</span>
        <span className="skeleton notes-skeleton-row" aria-hidden />
        <span className="skeleton notes-skeleton-row" aria-hidden />
        <span className="skeleton notes-skeleton-row" aria-hidden />
      </div>
    );
  if (top.isError)
    return (
      <div className="notes-error" role="alert">
        <p>{errorMessage(top.error, t)}</p>
        <Button size="sm" variant="secondary" onClick={() => void top.refetch()}>
          {t("brain.links.retry")}
        </Button>
      </div>
    );
  const level = top.data;
  if (!p.root || (level.folders.length === 0 && level.files.length === 0))
    return (
      <div className="notes-empty">
        <p>{t("notes.tree.empty")}</p>
        {p.root !== null && p.root === p.memoryRoot && (
          <Button size="sm" variant="secondary" onClick={p.onNewNote}>
            {t("notes.tree.newNote")}
          </Button>
        )}
      </div>
    );
  return (
    <NotesTree
      root={p.root}
      context={p.work.query}
      sort={p.state.sort}
      top={level}
      expanded={p.state.expanded}
      setExpanded={p.state.setExpanded}
      selected={p.selected}
      onOpenFile={(file: TreeFile, path: string) => p.onOpen(path, { id: file.id, title: file.title })}
      onSelectFolder={p.onSelectFolder}
    />
  );
}
