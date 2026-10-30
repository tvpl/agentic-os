/**
 * The tree of the notes view (.specs/features/cerebro-vista-notas, AC 7, 8, 12; design.md "Barra das notas", item 5):
 * an ARIA `tree`, one level per request of `GET /api/memory/tree` (a folder is asked for when it opens), folders first.
 * ArrowUp and ArrowDown move, ArrowRight opens a folder (or goes into it), ArrowLeft closes it (or goes up), Enter opens
 * a file in a tab or shows a folder. What cannot be edited carries the `Lock` with its reason, as text in its hint and
 * in its name; a folder past the cap ends with "+N não mostrados".
 */
import { useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { ChevronDown, ChevronRight, FileText, Folder, FolderOpen, Lock } from "lucide-react";
import { useT, type TKey } from "../../i18n";
import { Tooltip } from "../../ui";
import { Button } from "../../components/primitives";
import type { TreeFile, TreeFolder, TreeLevel } from "./notesData";
import { useTreeLevel, withoutExt } from "./notesData";
import type { FolderSelection, NotesSort } from "./useNotesState";

const REASON: Record<NonNullable<TreeFile["reason"]>, TKey> = {
  outside_memory: "notes.lock.outside",
  generated: "notes.lock.generated",
  not_markdown: "notes.lock.notMarkdown",
};

export interface NotesTreeProps {
  root: string;
  context?: string;
  sort: NotesSort;
  /** The first level, asked for by the sidebar (it holds the roots). */
  top: TreeLevel;
  expanded: ReadonlySet<string>;
  setExpanded: (path: string, open: boolean) => void;
  /** The path of the open tab or of the folder shown: the row with the selection's background. */
  selected: string | null;
  onOpenFile: (file: TreeFile, path: string) => void;
  onSelectFolder: (folder: FolderSelection) => void;
}

const join = (root: string, rel: string) => `${root}/${rel}`;

export function NotesTree(props: NotesTreeProps) {
  const t = useT();
  const ref = useRef<HTMLUListElement>(null);
  const [focused, setFocused] = useState<string | null>(null);

  const items = () => [...(ref.current?.querySelectorAll<HTMLElement>('[role="treeitem"]') ?? [])];
  const move = (el: HTMLElement | undefined | null) => {
    if (!el) return;
    el.focus();
    setFocused(el.dataset.path ?? null);
  };
  const onKeyDown = (e: KeyboardEvent<HTMLElement>) => {
    const el = (e.target as HTMLElement).closest<HTMLElement>('[role="treeitem"]');
    if (!el || !ref.current?.contains(el)) return;
    const all = items();
    const at = all.indexOf(el);
    const path = el.dataset.path!;
    const folder = el.dataset.kind === "folder";
    const open = el.getAttribute("aria-expanded") === "true";
    switch (e.key) {
      case "ArrowDown":
        move(all[at + 1]);
        break;
      case "ArrowUp":
        move(all[at - 1]);
        break;
      case "ArrowRight":
        if (folder && !open) props.setExpanded(path, true);
        else if (folder) move(el.querySelector<HTMLElement>('[role="group"] > [role="treeitem"]'));
        else return;
        break;
      case "ArrowLeft":
        if (folder && open) props.setExpanded(path, false);
        else move(el.parentElement?.closest<HTMLElement>('[role="treeitem"]'));
        break;
      case "Home":
        move(all[0]);
        break;
      case "End":
        move(all[all.length - 1]);
        break;
      case "Enter":
        el.click();
        break;
      default:
        return;
    }
    e.preventDefault();
    e.stopPropagation();
  };

  const first = props.top.folders[0] ?? props.top.files[0];
  const tabStop = focused ?? (first ? join(props.root, first.rel) : null);
  return (
    <ul ref={ref} className="notes-tree" role="tree" aria-label={t("notes.view.notes")}>
      <LevelItems
        {...props}
        level={props.top}
        depth={1}
        tabStop={tabStop}
        onFocusItem={setFocused}
        onKeyItem={onKeyDown}
      />
    </ul>
  );
}

interface LevelProps extends NotesTreeProps {
  level: TreeLevel;
  depth: number;
  tabStop: string | null;
  onFocusItem: (path: string) => void;
  /** The tree's keys, on each item (a key on a nested item is handled once: it stops there). */
  onKeyItem: (e: KeyboardEvent<HTMLElement>) => void;
}

function LevelItems(p: LevelProps) {
  const t = useT();
  return (
    <>
      {p.level.folders.map((f) => (
        <FolderItem key={f.rel} {...p} folder={f} />
      ))}
      {p.level.files.map((f) => (
        <FileItem key={f.rel} {...p} file={f} />
      ))}
      {p.level.truncated && (
        <li role="none" className="notes-omitted" style={{ paddingInlineStart: indent(p.depth) }}>
          {t("notes.tree.omitted", { n: p.level.omitted })}
        </li>
      )}
    </>
  );
}

function FileItem(p: LevelProps & { file: TreeFile }) {
  const t = useT();
  const name = useId();
  const f = p.file;
  const path = join(p.root, f.rel);
  return (
    <li
      role="treeitem"
      aria-level={p.depth}
      aria-selected={p.selected === path}
      aria-labelledby={name}
      tabIndex={p.tabStop === path ? 0 : -1}
      data-path={path}
      data-kind="file"
      className="notes-item"
      onFocus={(e) => e.target === e.currentTarget && p.onFocusItem(path)}
      onKeyDown={p.onKeyItem}
      onClick={(e) => {
        e.stopPropagation();
        p.onOpenFile(f, path);
      }}
    >
      <span className="notes-row" id={name} style={{ paddingInlineStart: indent(p.depth) }}>
        <span className="notes-chevron" aria-hidden />
        <FileText aria-hidden className="notes-icon" />
        <span className="notes-name">{f.title ?? withoutExt(f.name)}</span>
        {!f.editable && f.reason && <LockMark text={t(REASON[f.reason])} />}
      </span>
    </li>
  );
}

function FolderItem(p: LevelProps & { folder: TreeFolder }) {
  const t = useT();
  const { folder } = p;
  const path = join(p.root, folder.rel);
  const open = p.expanded.has(path);
  const name = useId();
  return (
    <li
      role="treeitem"
      aria-level={p.depth}
      aria-expanded={open}
      aria-labelledby={name}
      aria-selected={p.selected === path}
      tabIndex={p.tabStop === path ? 0 : -1}
      data-path={path}
      data-kind="folder"
      className="notes-item"
      onFocus={(e) => e.target === e.currentTarget && p.onFocusItem(path)}
      onKeyDown={p.onKeyItem}
      onClick={(e) => {
        e.stopPropagation();
        p.setExpanded(path, !open);
        p.onSelectFolder({ root: p.root, rel: folder.rel, name: folder.name });
      }}
    >
      <span className="notes-row" id={name} style={{ paddingInlineStart: indent(p.depth) }}>
        <span className="notes-chevron" aria-hidden>
          {open ? <ChevronDown /> : <ChevronRight />}
        </span>
        {open ? (
          <FolderOpen aria-hidden className="notes-icon" />
        ) : (
          <Folder aria-hidden className="notes-icon" />
        )}
        <span className="notes-name">{folder.name}</span>
        {!folder.editable && folder.reason && <LockMark text={t(REASON[folder.reason])} />}
      </span>
      {open && <FolderChildren {...p} />}
    </li>
  );
}

function FolderChildren(p: LevelProps & { folder: TreeFolder }) {
  const t = useT();
  const level = useTreeLevel({ context: p.context, root: p.root, dir: p.folder.rel, sort: p.sort });
  let body: ReactNode;
  if (level.isPending)
    body = (
      <li role="none" className="notes-state" style={{ paddingInlineStart: indent(p.depth + 1) }}>
        <span className="spinner sm" aria-hidden /> {t("common.loading")}
      </li>
    );
  else if (level.isError)
    body = (
      <li
        role="none"
        className="notes-state"
        style={{ paddingInlineStart: indent(p.depth + 1) }}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.stopPropagation()}
      >
        <span role="alert">{level.error.message}</span>{" "}
        <Button size="sm" variant="ghost" onClick={() => void level.refetch()}>
          {t("brain.links.retry")}
        </Button>
      </li>
    );
  else body = <LevelItems {...p} level={level.data} depth={p.depth + 1} />;
  return (
    <ul role="group" className="notes-group">
      {body}
    </ul>
  );
}

function LockMark({ text }: { text: string }) {
  return (
    <Tooltip label={text}>
      <span className="notes-lock" role="img" aria-label={text}>
        <Lock aria-hidden />
      </span>
    </Tooltip>
  );
}

const indent = (depth: number) => `calc(${depth - 1} * var(--notes-indent))`;
