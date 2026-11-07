/**
 * Creating in the tree (.specs/features/cerebro-vista-notas, AC 41, AC 43, AC 45, AC 46; design.md "Tela - Nova nota /
 * Nova pasta"): "Nova nota" and "Nova pasta" beside the heading "NOTAS", only while the root is `memory/`. "Nova nota"
 * opens the create dialog of cerebro-v2 with the selected folder of `memory/notes` chosen; "Nova pasta" asks the
 * folder's name and its first note's title (a folder is born with a note: an empty one is not indexed). With
 * `memory.notes.fixedStructure` on, what the service would refuse (`409 structure_fixed`) is disabled with its reason.
 */
import { useState, type FormEvent } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { FilePlus, FolderPlus } from "lucide-react";
import { apiCall } from "../../apiCall";
import { useT } from "../../i18n";
import { Button, Field } from "../../components/primitives";
import { Modal, Tooltip } from "../../ui";
import { useOsSettings } from "../../queries";
import { errorMessage } from "../../views/shared";
import { openNoteEditor } from "../noteEvents";
import type { FolderSelection } from "./useNotesState";

/** Where a new note goes: the selected folder, relative to `memory/notes` ("" for it), or null when none of it is. */
export function notesFolderOf(folder: FolderSelection | null, memoryRoot: string | null): string | null {
  if (!folder || folder.root !== memoryRoot) return null;
  if (folder.rel === "notes") return "";
  return folder.rel.startsWith("notes/") ? folder.rel.slice("notes/".length) : null;
}

export interface CreateControlsProps {
  folder: FolderSelection | null;
  memoryRoot: string | null;
  /** The new note, to open in a tab in edit mode. */
  onCreated: (path: string) => void;
}

/** Open the cerebro-v2 create dialog with the selected folder of `memory/notes` chosen. */
export function newNoteIn(base: string | null, onCreated: (path: string) => void): void {
  openNoteEditor({ mode: "new", ...(base ? { folder: base } : {}), onCreated });
}

const useFixedStructure = () => useOsSettings().data?.memory.notes.fixedStructure === true;

/** The empty root's "Nova nota" (C37): straight into `memory/notes/`, which the fixed structure refuses. */
export function EmptyNewNote({ onCreated }: { onCreated: (path: string) => void }) {
  const t = useT();
  const fixed = useFixedStructure();
  return (
    <Tooltip label={fixed ? t("notes.create.fixed") : undefined}>
      <Button
        size="sm"
        variant="secondary"
        aria-label={t("notes.tree.newNote")}
        aria-disabled={fixed || undefined}
        onClick={() => !fixed && newNoteIn(null, onCreated)}
      >
        {t("notes.tree.newNote")}
      </Button>
    </Tooltip>
  );
}

export function CreateControls({ folder, memoryRoot, onCreated }: CreateControlsProps) {
  const t = useT();
  const fixed = useFixedStructure();
  const [naming, setNaming] = useState(false);
  const base = notesFolderOf(folder, memoryRoot);
  const why = t("notes.create.fixed");
  // With the structure fixed a note goes only into a folder that exists, and no folder is made (door 5).
  const noteOff = fixed && !base;
  const folderOff = fixed;
  return (
    <>
      <Tooltip label={noteOff ? why : t("notes.tree.newNote")}>
        <button
          type="button"
          className="notes-icon-btn"
          aria-label={t("notes.tree.newNote")}
          aria-disabled={noteOff || undefined}
          onClick={() => !noteOff && newNoteIn(base, onCreated)}
        >
          <FilePlus aria-hidden />
        </button>
      </Tooltip>
      <Tooltip label={folderOff ? why : t("notes.tree.newFolder")}>
        <button
          type="button"
          className="notes-icon-btn"
          aria-label={t("notes.tree.newFolder")}
          aria-disabled={folderOff || undefined}
          aria-haspopup="dialog"
          onClick={() => !folderOff && setNaming(true)}
        >
          <FolderPlus aria-hidden />
        </button>
      </Tooltip>
      {naming && <NewFolderDialog base={base} onClose={() => setNaming(false)} onCreated={onCreated} />}
    </>
  );
}

function NewFolderDialog({
  base,
  onClose,
  onCreated,
}: {
  base: string | null;
  onClose: () => void;
  onCreated: (path: string) => void;
}) {
  const t = useT();
  const qc = useQueryClient();
  const [name, setName] = useState("");
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ready = name.trim() !== "" && title.trim() !== "";

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!ready || busy) return;
    setBusy(true);
    setError(null);
    try {
      const made = await apiCall("POST /api/memory/notes", {
        body: { title: title.trim(), folder: base ? `${base}/${name.trim()}` : name.trim() },
      });
      void qc.invalidateQueries({ queryKey: ["memory"] });
      onCreated(made.path);
      onClose();
    } catch (err) {
      setError(errorMessage(err, t));
      setBusy(false);
    }
  };

  return (
    <Modal title={t("notes.tree.newFolder")} onClose={onClose} className="notes-folder-dialog">
      <form onSubmit={(event) => void submit(event)} noValidate>
        <Field label={t("notes.create.folderName")} htmlFor="notes-new-folder" error={error}>
          <input
            id="notes-new-folder"
            className="input"
            value={name}
            maxLength={200}
            autoComplete="off"
            required
            onChange={(event) => setName(event.target.value)}
          />
        </Field>
        <Field label={t("notes.create.firstTitle")} htmlFor="notes-new-first">
          <input
            id="notes-new-first"
            className="input"
            value={title}
            maxLength={200}
            autoComplete="off"
            required
            onChange={(event) => setTitle(event.target.value)}
          />
        </Field>
        <div className="modal-actions">
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            {t("common.cancel")}
          </Button>
          <Button type="submit" variant="primary" disabled={!ready} loading={busy}>
            {t("note.new.create")}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
