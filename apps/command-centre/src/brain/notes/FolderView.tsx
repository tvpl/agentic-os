/**
 * A folder chosen in the tree (.specs/features/cerebro-vista-notas, AC 9, amendments 4 and 5; design.md "Pasta
 * selecionada"): its index note, read, with the badge "Índice da pasta" (the folder's `_index.md` where
 * cerebro-organizar puts it, else `index.md`, `README.md`, `CLAUDE.md`, `AGENTS.md`); without one, its entries with
 * title, type (`fields.type` of the index) and the date of their last change, from the tree's own answer.
 */
import { FileText, Folder } from "lucide-react";
import { useLang, useT } from "../../i18n";
import { Button } from "../../components/primitives";
import { errorMessage } from "../../views/shared";
import { NoteReader, type NoteReaderProps } from "./NoteReader";
import { useNoteLinks, useTreeLevel, withoutExt } from "./notesData";
import type { FolderSelection, NoteMeta, NotesSort } from "./useNotesState";

export interface FolderViewProps extends Pick<NoteReaderProps, "onShowInGraph" | "onSetHome"> {
  folder: FolderSelection;
  context?: string;
  sort: NotesSort;
  onOpen: (path: string, meta: NoteMeta) => void;
  onSelectFolder: (folder: FolderSelection) => void;
}

export function FolderView(p: FolderViewProps) {
  const t = useT();
  const lang = useLang();
  const level = useTreeLevel({ context: p.context, root: p.folder.root, dir: p.folder.rel, sort: p.sort });
  const indexId = level.data?.indexNote ?? null;
  const index = useNoteLinks(indexId);

  if (level.isPending || (indexId !== null && index.isPending))
    return (
      <div className="notes-reader-state" role="status">
        <span className="spinner" aria-hidden /> {t("common.loading")}
      </div>
    );
  const failed = level.error ?? index.error;
  if (failed)
    return (
      <div className="notes-reader-state" role="alert">
        <p>{errorMessage(failed, t)}</p>
        <Button
          size="sm"
          variant="secondary"
          onClick={() => void (level.isError ? level.refetch() : index.refetch())}
        >
          {t("brain.links.retry")}
        </Button>
      </div>
    );
  const file = index.data?.file;
  const entries = level.data ?? { folders: [], files: [] };
  if (indexId !== null && file)
    return (
      <NoteReader
        path={file.path}
        id={file.id}
        meta={{ id: file.id, title: file.title }}
        onOpen={p.onOpen}
        onShowInGraph={p.onShowInGraph}
        onSetHome={p.onSetHome}
        badge={<span className="notes-badge notes-index-badge">{t("notes.reader.folderIndex")}</span>}
      />
    );
  const date = (ms: number) => new Date(ms).toLocaleDateString(lang);
  return (
    <section className="notes-folder" aria-label={p.folder.name}>
      <h1 className="notes-note-title">{p.folder.name}</h1>
      <div className="notes-note-path">{`${p.folder.root}/${p.folder.rel}`}</div>
      <table className="notes-folder-table">
        <thead>
          <tr>
            <th scope="col">{t("notes.folder.title")}</th>
            <th scope="col">{t("notes.folder.type")}</th>
            <th scope="col">{t("notes.sort.updated")}</th>
          </tr>
        </thead>
        <tbody>
          {entries.folders.map((f) => (
            <tr key={`d:${f.rel}`}>
              <td>
                <button
                  type="button"
                  className="brain-md-link"
                  onClick={() => p.onSelectFolder({ root: p.folder.root, rel: f.rel, name: f.name })}
                >
                  <Folder aria-hidden size={14} />
                  {f.name}
                </button>
              </td>
              <td>—</td>
              <td>—</td>
            </tr>
          ))}
          {entries.files.map((f) => (
            <tr key={f.rel}>
              <td>
                <button
                  type="button"
                  className="brain-md-link"
                  onClick={() => p.onOpen(`${p.folder.root}/${f.rel}`, { id: f.id, title: f.title })}
                >
                  <FileText aria-hidden size={14} />
                  {f.title ?? withoutExt(f.name)}
                </button>
              </td>
              <td>{f.type ?? "—"}</td>
              <td>{date(f.mtime)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
