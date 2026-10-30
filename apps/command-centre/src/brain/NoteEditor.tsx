/**
 * The note editor (.specs/features/cerebro-v2, design.md): "Nova nota" and "Editar nota", two dialogs on the primitives.
 * It is a separate chunk: `NoteEditorHost` imports it the first time a person asks for a note.
 *
 * The text is a plain field, not a rich editor. What the dialog is careful about is the save: it names the version it
 * read (`baseVersion`), a note that changed on disk meanwhile answers `409 edit_conflict`, and nothing the person typed
 * is dropped without them choosing it (the conflict banner, the confirmation before discarding).
 */
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Check, Circle, CircleAlert, Loader2, X } from "lucide-react";
import { ApiError } from "../api";
import { apiCall } from "../apiCall";
import { Button, Field } from "../components/primitives";
import { formatBytes } from "../components/ui";
import { useCommands, type Command } from "../commands/registry";
import { useConfirm } from "../hooks/useConfirm";
import { prefersReducedMotion } from "../hooks/usePresence";
import { useT, type TKey } from "../i18n";
import { useOsSettings } from "../queries";
import { DialogSurface, Modal } from "../ui";
import { errorMessage } from "../views/shared";
import type { NoteEditorRequest } from "./noteEvents";
import "./noteEditor.css";

/** What `GET /api/memory/note` answers. */
interface NoteDoc {
  path: string;
  name: string;
  content: string;
  version: string;
  size: number;
  editable: boolean;
  reason?: string | undefined;
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
const EXIT_MS = 160;
/** The most a note may hold in the editor: the server's own rule is the smaller of this and `limits.maxIndexedFileBytes`. */
const NOTE_BYTES_CAP = 1024 * 1024;

/** A note's title as the person reads it: the first heading, else the file name. */
export function titleOf(text: string, name: string): string {
  return /^#\s+(.+)$/m.exec(text)?.[1]?.trim() || name.replace(/\.md$/i, "");
}

export function StateBadge({ kind }: { kind: StateKind }) {
  const t = useT();
  const Icon = STATE_ICON[kind];
  return (
    <span className={`note-state ${kind}`} role="status">
      <Icon aria-hidden className={kind === "saving" ? "spin" : undefined} />
      {t(`note.state.${kind}` as TKey)}
    </span>
  );
}

export default function NoteEditor({
  request,
  onRequest,
  onClose,
}: {
  request: NoteEditorRequest;
  onRequest: (next: NoteEditorRequest) => void;
  onClose: () => void;
}) {
  return request.mode === "new" ? (
    <NewNote
      folder={request.folder}
      onClose={onClose}
      onCreated={(path) => {
        if (!request.onCreated) return onRequest({ mode: "edit", path });
        request.onCreated(path);
        onClose();
      }}
    />
  ) : (
    <EditNote
      key={request.path}
      path={request.path}
      onClose={onClose}
      onSwitch={(path) => onRequest({ mode: "edit", path })}
    />
  );
}

/* ---------------------------------------------------------------- new note */

function NewNote({
  folder: chosen,
  onClose,
  onCreated,
}: {
  folder?: string | undefined;
  onClose: () => void;
  onCreated: (path: string) => void;
}) {
  const t = useT();
  const qc = useQueryClient();
  const settings = useOsSettings();
  const titleRef = useRef<HTMLInputElement>(null);
  const [title, setTitle] = useState("");
  const [area, setArea] = useState("");
  // A folder chosen by the caller (cerebro-vista-notas, AC 41): read-only until "Trocar"; a folder and an area are
  // never sent together (door 7).
  const [folder, setFolder] = useState(chosen ?? "");
  const [changing, setChanging] = useState(false);
  const inFolder = folder.trim().replace(/^\/+|\/+$/g, "");
  const [frontMatter, setFrontMatter] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!title.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      const made = await apiCall("POST /api/memory/notes", {
        body: {
          title: title.trim(),
          ...(inFolder ? { folder: inFolder } : area ? { area } : {}),
          ...(frontMatter ? { frontMatter: true } : {}),
        },
      });
      void qc.invalidateQueries({ queryKey: ["memory"] });
      onCreated(made.path);
    } catch (err) {
      setError(errorMessage(err, t));
      setBusy(false);
    }
  };

  return (
    <Modal title={t("note.new")} onClose={onClose} narrow initialFocus={() => titleRef.current}>
      <form onSubmit={(event) => void submit(event)} noValidate>
        <Field label={t("note.new.title")} htmlFor="note-new-title" error={error}>
          <input
            ref={titleRef}
            id="note-new-title"
            className="input"
            value={title}
            maxLength={200}
            autoComplete="off"
            aria-invalid={error ? true : undefined}
            onChange={(event) => setTitle(event.target.value)}
          />
        </Field>
        {chosen !== undefined && (
          <Field label={t("note.new.folder")} htmlFor="note-new-folder">
            <div className="note-folder">
              <input
                id="note-new-folder"
                className="input mono"
                value={folder}
                readOnly={!changing}
                autoComplete="off"
                onChange={(event) => setFolder(event.target.value)}
              />
              {!changing && (
                <Button size="sm" variant="secondary" onClick={() => setChanging(true)}>
                  {t("note.new.change")}
                </Button>
              )}
            </div>
          </Field>
        )}
        {!inFolder && (
          <Field label={t("note.new.area")} htmlFor="note-new-area">
            <select
              id="note-new-area"
              className="input"
              value={area}
              onChange={(event) => setArea(event.target.value)}
            >
              <option value="">{t("note.noArea")}</option>
              {(settings.data?.areas ?? []).map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>
          </Field>
        )}
        <label className="note-check">
          <input
            type="checkbox"
            checked={frontMatter}
            onChange={(event) => setFrontMatter(event.target.checked)}
          />
          {t("note.new.frontMatter")}
        </label>
        <div className="modal-actions">
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            {t("common.cancel")}
          </Button>
          <Button type="submit" variant="primary" disabled={!title.trim()} loading={busy}>
            {t("note.new.create")}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

/* --------------------------------------------------------------- edit note */

function EditNote({
  path,
  onClose,
  onSwitch,
}: {
  path: string;
  onClose: () => void;
  onSwitch: (path: string) => void;
}) {
  const t = useT();
  const qc = useQueryClient();
  const confirm = useConfirm();
  const settings = useOsSettings();
  const fieldRef = useRef<HTMLTextAreaElement>(null);
  const [open, setOpen] = useState(true);
  const [phase, setPhase] = useState<"loading" | "ready" | "failed">("loading");
  const [loadError, setLoadError] = useState<string | null>(null);
  const [note, setNote] = useState<NoteDoc | null>(null);
  const [text, setText] = useState("");
  const [operation, setOperation] = useState<Operation>("idle");
  const [message, setMessage] = useState<string | null>(null);
  const closing = useRef(false);

  const load = useCallback(async () => {
    setPhase("loading");
    try {
      const doc = await apiCall("GET /api/memory/note", { query: { p: path } });
      setNote(doc);
      setText(doc.content);
      setOperation("idle");
      setMessage(null);
      setPhase("ready");
    } catch (err) {
      setLoadError(errorMessage(err, t));
      setPhase("failed");
    }
  }, [path, t]);
  useEffect(() => {
    void load();
    // `load` changes with the language; the note is read once per path.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path]);

  // The field does not exist while the note loads, so the dialog cannot open on it: it takes focus when it appears.
  useEffect(() => {
    if (phase === "ready") fieldRef.current?.focus({ preventScroll: true });
  }, [phase]);

  const dirty = note !== null && text !== note.content;
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
  const title = note ? titleOf(text, note.name) : path;
  const limit = Math.min(settings.data?.limits.maxIndexedFileBytes ?? NOTE_BYTES_CAP, NOTE_BYTES_CAP);

  const save = useCallback(async () => {
    if (!note || !note.editable || !dirty || operation === "saving" || operation === "conflict") return;
    setOperation("saving");
    setMessage(null);
    try {
      const done = await apiCall("PUT /api/memory/notes", {
        body: { path: note.path, content: text, baseVersion: note.version },
      });
      setNote({ ...note, content: text, version: done.version, size: done.size });
      setOperation("idle");
      void qc.invalidateQueries({ queryKey: ["memory"] });
    } catch (err) {
      if (err instanceof ApiError && err.code === "edit_conflict") {
        setOperation("conflict");
        return;
      }
      setMessage(errorMessage(err, t));
      setOperation("error");
    }
  }, [note, dirty, operation, text, qc, t]);
  const saveRef = useRef(save);
  saveRef.current = save;

  /** Load the disk's version, dropping the person's text (they chose it). */
  const useDisk = () => void load();

  /** Keep the person's text as a new note next to the one that changed. */
  const saveAsCopy = async () => {
    if (!note) return;
    setOperation("saving");
    try {
      const copy = await apiCall("POST /api/memory/notes", {
        body: { title: `${titleOf(text, note.name)} ${t("note.copySuffix")}` },
      });
      await apiCall("PUT /api/memory/notes", {
        body: { path: copy.path, content: text, baseVersion: copy.version },
      });
      void qc.invalidateQueries({ queryKey: ["memory"] });
      onSwitch(copy.path);
    } catch (err) {
      setMessage(errorMessage(err, t));
      setOperation("conflict");
    }
  };

  const commands = useMemo<Command[]>(
    () => [
      {
        id: "note.save",
        title: "note.save",
        group: "actions",
        scope: "modal",
        keys: ["Mod+S"],
        allowInInput: true,
        run: () => void saveRef.current(),
      },
    ],
    [],
  );
  useCommands(commands);

  const finish = () => {
    if (closing.current) return;
    closing.current = true;
    if (prefersReducedMotion()) {
      onClose();
      return;
    }
    setOpen(false);
    window.setTimeout(onClose, EXIT_MS);
  };
  const requestClose = async () => {
    if (closing.current) return;
    if (dirty) {
      const discard = await confirm({
        title: t("note.discard.title"),
        confirmLabel: t("note.discard.confirm"),
        cancelLabel: t("note.discard.keep"),
        danger: true,
      });
      if (!discard) return;
    }
    finish();
  };

  const editable = note?.editable === true;
  return (
    <DialogSurface
      open={open}
      onOpenChange={(next) => !next && void requestClose()}
      label={t("note.edit.title")}
      className="modal note-editor"
      initialFocus={() => fieldRef.current}
    >
      <div className="modal-head">
        <h2>{t("note.edit.title")}</h2>
        <button
          type="button"
          className="btn ghost sm icon-only"
          onClick={() => void requestClose()}
          aria-label={t("common.close")}
          data-dialog-close
        >
          <X aria-hidden />
        </button>
      </div>
      {phase === "loading" && (
        <p className="note-editor-loading">
          <span className="spinner" aria-hidden /> {t("note.loading")}
        </p>
      )}
      {phase === "failed" && (
        <div className="note-editor-failed" role="alert">
          <p>
            {t("note.loadFailed")} {loadError}
          </p>
          <Button variant="secondary" size="sm" onClick={() => void load()}>
            {t("common.retry")}
          </Button>
        </div>
      )}
      {phase === "ready" && note && (
        <>
          <div className="note-editor-sub">
            <div className="note-editor-title">
              <strong>{title}</strong>
              <span className="mono note-editor-path">{note.path}</span>
            </div>
            {editable ? (
              <StateBadge kind={kind} />
            ) : (
              <span className="note-state readonly">{t("note.readonly")}</span>
            )}
          </div>
          {!editable && (
            <p className="note-editor-reason" role="note">
              {note.reason}
            </p>
          )}
          {operation === "conflict" && (
            <div className="note-editor-banner" role="alert">
              <AlertTriangle aria-hidden />
              <div>
                <p>{t("note.conflict.body")}</p>
                {message && <p>{message}</p>}
                <div className="note-editor-banner-actions">
                  <Button size="sm" variant="secondary" onClick={useDisk}>
                    {t("note.conflict.reload")}
                  </Button>
                  <Button size="sm" variant="secondary" onClick={() => void saveAsCopy()}>
                    {t("note.conflict.copy")}
                  </Button>
                </div>
              </div>
            </div>
          )}
          {operation === "error" && message && (
            <p className="note-editor-error" role="alert">
              {message}
            </p>
          )}
          <textarea
            ref={fieldRef}
            className="input note-editor-field"
            aria-label={t("note.field")}
            value={text}
            readOnly={!editable}
            spellCheck
            onChange={(event) => setText(event.target.value)}
          />
          <div className="note-editor-foot">
            <span className="note-editor-size">
              {t("note.size", {
                size: formatBytes(new TextEncoder().encode(text).length),
                limit: formatBytes(limit),
              })}
            </span>
            <div className="modal-actions">
              <Button variant="ghost" onClick={() => void requestClose()}>
                {t("common.close")}
              </Button>
              {editable && (
                <Button
                  variant="primary"
                  onClick={() => void save()}
                  disabled={!dirty || operation === "saving" || operation === "conflict"}
                  loading={operation === "saving"}
                >
                  {t("note.save")}
                </Button>
              )}
            </div>
          </div>
        </>
      )}
    </DialogSurface>
  );
}
