/**
 * How anything on screen asks for the note editor (.specs/features/cerebro-v2): a window event, so the palette, the
 * Second Brain, the Núcleo's brain scene and the preview need not know where the editor is mounted (`OsShell`), nor
 * pull its code in: the editor itself is a separate chunk that loads the first time a request arrives.
 */
export const OPEN_NOTE_EVENT = "mordomo:open-note";

export type NoteEditorRequest =
  | {
      mode: "new";
      /** A folder under `memory/notes`, chosen already (the notes view's selected folder): read-only, with "Trocar". */
      folder?: string;
      /** Who asked takes the new note (the notes view opens it in a tab); otherwise the dialog edits it. */
      onCreated?: (path: string) => void;
    }
  | { mode: "edit"; path: string };

export function openNoteEditor(request: NoteEditorRequest): void {
  window.dispatchEvent(new CustomEvent<NoteEditorRequest>(OPEN_NOTE_EVENT, { detail: request }));
}
