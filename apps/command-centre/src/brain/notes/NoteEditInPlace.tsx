/**
 * The editor of cerebro-v2, in place (.specs/features/cerebro-vista-notas, AC 37-39; design.md "Área de leitura", item
 * 4): the reading area becomes the plain Markdown field (mono 13px), the state line with its icon and text
 * (`role="status"`), "Salvar" and ⌘S / Ctrl+S, the conflict banner with "Carregar a versão do disco" and "Salvar como
 * cópia"; the side panel stays. Typing `[[` lists up to 8 notes whose title or name holds what follows (accent-folded):
 * arrows move, Enter inserts `[[Título]]`, Esc closes.
 *
 * What the person typed outlives the tab being in the background: it is kept in the view's drafts (by path) until it
 * is saved, dropped by them, or the tab closes. While the text is unchanged the editor follows the note on disk (a
 * property written meanwhile is a new version).
 */
import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import { useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Check, Circle, CircleAlert, FileText, Loader2 } from "lucide-react";
import { ApiError } from "../../api";
import { apiCall } from "../../apiCall";
import { useT, type TKey } from "../../i18n";
import { Button } from "../../components/primitives";
import { useCommands, type Command } from "../../commands/registry";
import { errorMessage } from "../../views/shared";
import { useBrainSearch } from "../memoryData";
import type { NoteDoc } from "./notesData";
import type { NoteMeta } from "./useNotesState";
import "../noteEditor.css";

/** What a tab's editor holds that is not on disk yet: the text, and the version and text it started from. */
export interface NoteDraft {
  text: string;
  version: string;
  content: string;
}

type Operation = "idle" | "saving" | "conflict" | "error";
type StateKind = "saved" | "dirty" | "saving" | "conflict" | "error";
const STATE_ICON = {
  saved: Check,
  dirty: Circle,
  saving: Loader2,
  conflict: AlertTriangle,
  error: CircleAlert,
} as const;
const LINK_HITS = 8;

/** Lower case with the accents taken off: `Plâncton` and `pla` meet. */
export const fold = (s: string) => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();

/** The `[[` being typed right before the caret, and what follows it; null when the caret is not in one. */
export function linkAt(text: string, caret: number): { start: number; q: string } | null {
  const m = /\[\[([^[\]|\n]*)$/.exec(text.slice(0, caret));
  return m ? { start: caret - m[1]!.length - 2, q: m[1]! } : null;
}

/** The conflict banner of cerebro-v2 (design.md "Tela Editor"), over the editor or the properties table. */
export function ConflictBanner({
  message,
  onReload,
  onCopy,
}: {
  message?: string | null;
  onReload: () => void;
  onCopy: () => void;
}) {
  const t = useT();
  return (
    <div className="note-editor-banner" role="alert">
      <AlertTriangle aria-hidden />
      <div>
        <p>{t("note.conflict.body")}</p>
        {message && <p>{message}</p>}
        <div className="note-editor-banner-actions">
          <Button size="sm" variant="secondary" onClick={onReload}>
            {t("note.conflict.reload")}
          </Button>
          <Button size="sm" variant="secondary" onClick={onCopy}>
            {t("note.conflict.copy")}
          </Button>
        </div>
      </div>
    </div>
  );
}

export interface NoteEditInPlaceProps {
  note: NoteDoc;
  title: string;
  drafts: Map<string, NoteDraft>;
  context?: string | undefined;
  onUnsaved: (on: boolean) => void;
  onOpen: (path: string, meta: NoteMeta) => void;
}

export function NoteEditInPlace({ note, title, drafts, context, onUnsaved, onOpen }: NoteEditInPlaceProps) {
  const t = useT();
  const qc = useQueryClient();
  const field = useRef<HTMLTextAreaElement>(null);
  const kept = drafts.get(note.path);
  const [text, setText] = useState(kept?.text ?? note.content);
  const [base, setBase] = useState({
    version: kept?.version ?? note.version,
    content: kept?.content ?? note.content,
  });
  const [operation, setOperation] = useState<Operation>("idle");
  const [message, setMessage] = useState<string | null>(null);
  const dirty = text !== base.content;

  useEffect(() => field.current?.focus({ preventScroll: true }), []);
  useEffect(() => {
    onUnsaved(dirty);
    if (dirty) drafts.set(note.path, { text, ...base });
    else drafts.delete(note.path);
  }, [dirty, text, base, drafts, note.path, onUnsaved]);
  // Unchanged text follows the disk (a property written, a save of another tab of the same file).
  useEffect(() => {
    if (dirty || operation === "saving" || note.version === base.version) return;
    setBase({ version: note.version, content: note.content });
    setText(note.content);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [note.version, note.content]);

  const save = useCallback(async () => {
    if (!dirty || operation === "saving" || operation === "conflict") return;
    setOperation("saving");
    setMessage(null);
    try {
      const done = await apiCall("PUT /api/memory/notes", {
        body: { path: note.path, content: text, baseVersion: base.version },
      });
      setBase({ version: done.version, content: text });
      setOperation("idle");
      void qc.invalidateQueries({ queryKey: ["memory"] });
    } catch (err) {
      if (err instanceof ApiError && err.code === "edit_conflict") return setOperation("conflict");
      setMessage(errorMessage(err, t));
      setOperation("error");
    }
  }, [dirty, operation, note.path, text, base.version, qc, t]);
  const saveRef = useRef(save);
  saveRef.current = save;
  useCommands(
    useMemo<Command[]>(
      () => [
        {
          id: "brain.notes.save",
          title: "note.save",
          group: "actions",
          scope: "view:brain",
          keys: ["Mod+S"],
          allowInInput: true,
          run: () => void saveRef.current(),
        },
      ],
      [],
    ),
  );

  /** "Carregar a versão do disco": the person's text is dropped (they chose it). */
  const reload = async () => {
    try {
      const doc = await apiCall("GET /api/memory/note", { query: { p: note.path } });
      qc.setQueryData(["memory", "note", note.path], doc);
      setBase({ version: doc.version, content: doc.content });
      setText(doc.content);
      setOperation("idle");
      setMessage(null);
    } catch (err) {
      setMessage(errorMessage(err, t));
    }
  };
  /** "Salvar como cópia": the person's text becomes a new note beside this one, opened in its own tab. */
  const saveAsCopy = async () => {
    setOperation("saving");
    try {
      const copy = await apiCall("POST /api/memory/notes", {
        body: { title: `${title} ${t("note.copySuffix")}` },
      });
      await apiCall("PUT /api/memory/notes", {
        body: { path: copy.path, content: text, baseVersion: copy.version },
      });
      void qc.invalidateQueries({ queryKey: ["memory"] });
      await reload();
      onOpen(copy.path, {});
    } catch (err) {
      setMessage(errorMessage(err, t));
      setOperation("conflict");
    }
  };

  /* ---- the `[[` list ---- */
  const [link, setLink] = useState<{ start: number; q: string } | null>(null);
  const [at, setAt] = useState(0);
  const search = useBrainSearch(link?.q ?? "", 20, context);
  const hits = useMemo(() => {
    if (!link) return [];
    const q = fold(link.q);
    return search.hits.filter((h) => fold(`${h.title ?? ""}\n${h.name}`).includes(q)).slice(0, LINK_HITS);
  }, [link, search.hits]);
  const listId = useId();
  const follow = (el: HTMLTextAreaElement) => {
    setLink(linkAt(el.value, el.selectionStart));
    setAt(0);
  };
  const insert = (i: number) => {
    const hit = hits[i];
    const el = field.current;
    if (!hit || !link || !el) return;
    const label = hit.title ?? hit.name.replace(/\.(md|markdown)$/i, "");
    const caret = el.selectionStart;
    const next = `${text.slice(0, link.start)}[[${label}]]${text.slice(caret)}`;
    const after = link.start + label.length + 4;
    caretTo.current = after;
    setText(next);
    setLink(null);
  };
  // The caret goes after an inserted link as soon as the field holds it.
  const caretTo = useRef<number | null>(null);
  useLayoutEffect(() => {
    if (caretTo.current === null) return;
    field.current?.setSelectionRange(caretTo.current, caretTo.current);
    caretTo.current = null;
  }, [text]);
  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (!link) return;
    if (e.key === "Escape") setLink(null);
    else if (hits.length === 0) return;
    else if (e.key === "ArrowDown") setAt((i) => Math.min(hits.length - 1, i + 1));
    else if (e.key === "ArrowUp") setAt((i) => Math.max(0, i - 1));
    else if (e.key === "Enter") insert(at);
    else return;
    e.preventDefault();
  };

  const kind: StateKind =
    operation === "saving"
      ? "saving"
      : operation === "conflict"
        ? "conflict"
        : operation === "error"
          ? "error"
          : dirty
            ? "dirty"
            : "saved";
  const Icon = STATE_ICON[kind];
  const open = link !== null && hits.length > 0;
  return (
    <div className="notes-editor">
      {operation === "conflict" && (
        <ConflictBanner message={message} onReload={() => void reload()} onCopy={() => void saveAsCopy()} />
      )}
      {operation === "error" && message && (
        <p className="note-editor-error" role="alert">
          {message}
        </p>
      )}
      <textarea
        ref={field}
        className="input note-editor-field"
        aria-label={t("note.field")}
        aria-controls={open ? listId : undefined}
        aria-activedescendant={open ? `${listId}-${at}` : undefined}
        value={text}
        spellCheck
        onChange={(e) => {
          setText(e.target.value);
          follow(e.target);
        }}
        onSelect={(e) => link && follow(e.currentTarget)}
        onKeyDown={onKeyDown}
      />
      {open && (
        <ul
          className="notes-search-hits notes-link-hits"
          role="listbox"
          id={listId}
          aria-label={t("notes.edit.links")}
        >
          {hits.map((hit, i) => (
            <li
              key={hit.id}
              id={`${listId}-${i}`}
              role="option"
              aria-selected={i === at}
              className="notes-search-hit"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => insert(i)}
              onKeyDown={(e) => e.key === "Enter" && insert(i)}
            >
              <FileText aria-hidden size={14} />
              <span className="notes-search-title">{hit.title ?? hit.name}</span>
              <span className="notes-search-rel">{hit.rel}</span>
            </li>
          ))}
        </ul>
      )}
      <div className="note-editor-foot">
        <span className={`note-state ${kind}`} role="status">
          <Icon aria-hidden className={kind === "saving" ? "spin" : undefined} />
          {t(`note.state.${kind}` as TKey)}
        </span>
        <Button
          size="sm"
          variant="primary"
          onClick={() => void save()}
          disabled={!dirty || operation === "saving" || operation === "conflict"}
          loading={operation === "saving"}
        >
          {t("note.save")}
        </Button>
      </div>
    </div>
  );
}
