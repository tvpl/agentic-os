/**
 * The note panel (.specs/features/cerebro-vista-notas, AC 22; design.md "Painel da nota"): three sections that fold,
 * in this order: the links section of `cerebro-v2` ("Backlinks" and "Links quebrados", unchanged), "Relacionadas" from
 * the index (`useRelatedFiles` of `brain/memoryData.ts`) in the active context with each `why`, and "Nesta nota", the `##` headings of the body
 * (choosing one scrolls to it). Each section loads and fails on its own.
 */
import { useId, useMemo, useState, type ReactNode } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { useT } from "../../i18n";
import { LinksSection } from "../LinksSection";
import { RequestFailed } from "../RequestFailed";
import { parseMarkdown } from "../markdown";
import { useRelatedFiles } from "../memoryData";
import { bodyOf, outlineOf } from "./NoteReader";
import { useNoteLinks, useNoteRead, withoutExt } from "./notesData";
import type { NoteMeta } from "./useNotesState";

export interface NotePanelProps {
  path: string;
  id: number | null;
  context?: string;
  onOpen: (path: string, meta: NoteMeta) => void;
}

export function NotePanel({ path, id, context, onOpen }: NotePanelProps) {
  const t = useT();
  // The same answer the links section reads (one cache entry): a backlink is opened by its path.
  const links = useNoteLinks(id);
  const openBacklink = (to: number) => {
    const file = links.data?.backlinks.find((b) => b.file.id === to)?.file;
    if (file) onOpen(file.path, { id: file.id, title: file.title });
  };
  return (
    <div className="notes-panel-body">
      <Fold title={t("brain.links")}>
        {id !== null ? (
          <LinksSection fileId={id} onSelectId={openBacklink} />
        ) : (
          <p className="notes-panel-state">
            <span className="spinner sm" aria-hidden /> {t("common.loading")}
          </p>
        )}
      </Fold>
      <Fold title={t("notes.panel.related")}>
        <Related id={id} context={context} onOpen={onOpen} />
      </Fold>
      <Fold title={t("notes.panel.outline")}>
        <Outline path={path} />
      </Fold>
    </div>
  );
}

function Fold({ title, children }: { title: string; children: ReactNode }) {
  const [open, setOpen] = useState(true);
  const body = useId();
  return (
    <section className="notes-fold">
      <h3 className="notes-fold-head">
        <button type="button" aria-expanded={open} aria-controls={body} onClick={() => setOpen((v) => !v)}>
          {open ? <ChevronDown aria-hidden /> : <ChevronRight aria-hidden />}
          {title}
        </button>
      </h3>
      <div id={body} hidden={!open}>
        {children}
      </div>
    </section>
  );
}

function Related({
  id,
  context,
  onOpen,
}: {
  id: number | null;
  context?: string;
  onOpen: NotePanelProps["onOpen"];
}) {
  const t = useT();
  const related = useRelatedFiles(id, context);
  if (related.failed) return <RequestFailed message={t("brain.related.failed")} onRetry={related.retry} />;
  if (id === null || related.pending)
    return (
      <p className="notes-panel-state">
        <span className="spinner sm" aria-hidden /> {t("common.loading")}
      </p>
    );
  if (related.related.length === 0) return <p className="notes-panel-state">{t("notes.panel.noRelated")}</p>;
  return (
    <ul className="notes-related">
      {related.related.map((r) => (
        <li key={r.file.id}>
          <button
            type="button"
            className="brain-md-link"
            onClick={() => onOpen(r.file.path, { id: r.file.id, title: r.file.title })}
          >
            {r.file.title ?? withoutExt(r.file.name)}
          </button>
          <span className="notes-why">{r.why}</span>
        </li>
      ))}
    </ul>
  );
}

function Outline({ path }: { path: string }) {
  const t = useT();
  const note = useNoteRead(path);
  const outline = useMemo(
    () => (note.data ? outlineOf(parseMarkdown(bodyOf(note.data.content, note.data.bodyStart))) : []),
    [note.data],
  );
  if (note.isPending)
    return (
      <p className="notes-panel-state">
        <span className="spinner sm" aria-hidden /> {t("common.loading")}
      </p>
    );
  if (note.isError) return <RequestFailed message={note.error.message} onRetry={() => void note.refetch()} />;
  if (outline.length === 0) return <p className="notes-panel-state">{t("notes.panel.noHeadings")}</p>;
  return (
    <ul className="notes-outline">
      {outline.map((h) => (
        <li key={h.id}>
          <button
            type="button"
            className="brain-md-link"
            onClick={() =>
              document.getElementById(h.id)?.scrollIntoView({ behavior: "smooth", block: "start" })
            }
          >
            {h.text}
          </button>
        </li>
      ))}
    </ul>
  );
}
