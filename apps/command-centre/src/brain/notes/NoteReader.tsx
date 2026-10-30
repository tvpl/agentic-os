/**
 * A note, read (.specs/features/cerebro-vista-notas, AC 20-24, AC 57; design.md "Área de leitura", items 2 and 4):
 * the title (the largest text of the view), its path, "Ver no grafo" and the "Mais" menu ("Definir como Home",
 * "Exportar Markdown", "Abrir no editor do sistema", "Copiar caminho"), then the body from `bodyStart` on, drawn by the
 * one renderer in shape `panel`. Its links are buttons that open the note `GET /api/memory/links` resolves them to, in a
 * tab; one that leads nowhere is text with `Unlink` and its hint. The properties table and the editor come in their
 * own place (between the header and the body), from the next batch.
 */
import { useMemo, type ReactNode } from "react";
import { MoreHorizontal, Network, Unlink } from "lucide-react";
import { ApiError } from "../../api";
import { apiCall } from "../../apiCall";
import { useT } from "../../i18n";
import { useToast } from "../../components/ui";
import { Button } from "../../components/primitives";
import { Markdown } from "../../components/Markdown";
import { DropdownMenu, Tooltip } from "../../ui";
import { copyText, downloadUrl, errorMessage } from "../../views/shared";
import { parseMarkdown, type Block } from "../markdown";
import { linkResolver } from "./noteLinks";
import { baseName, useNoteLinks, useNoteRead, withoutExt } from "./notesData";
import type { NoteMeta } from "./useNotesState";

/** The ids of the `##` headings of a body, by block index: the panel's "Nesta nota" scrolls to them. */
export function outlineOf(blocks: readonly Block[]): Array<{ index: number; id: string; text: string }> {
  const out: Array<{ index: number; id: string; text: string }> = [];
  blocks.forEach((b, index) => {
    if (b.type === "heading" && b.level === 2)
      out.push({
        index,
        id: `notes-h-${index}`,
        text: b.children.map((c) => ("text" in c ? c.text : "")).join(""),
      });
  });
  return out;
}

export function bodyOf(content: string, bodyStart: number): string {
  return content.slice(bodyStart);
}

export interface NoteReaderProps {
  path: string;
  meta: NoteMeta;
  /** The index id, once known (the links and "Ver no grafo" need it). */
  id: number | null;
  onOpen: (path: string, meta: NoteMeta) => void;
  onShowInGraph: (id: number) => void;
  onSetHome: (path: string) => void;
  /** The note is a tab: "Esta nota não existe mais." offers to close it. */
  onCloseTab?: () => void;
  /** A badge beside the title ("Índice da pasta"). */
  badge?: ReactNode;
}

export function NoteReader(p: NoteReaderProps) {
  const t = useT();
  const toast = useToast();
  const note = useNoteRead(p.path);
  const links = useNoteLinks(p.id);
  const title = p.meta.title ?? withoutExt(baseName(p.path));

  const content = note.data?.content ?? null;
  const blocks = useMemo(
    () => (note.data ? parseMarkdown(bodyOf(note.data.content, note.data.bodyStart)) : []),
    [note.data],
  );
  const headingIds = useMemo(() => new Map(outlineOf(blocks).map((h) => [h.index, h.id])), [blocks]);
  const resolve = useMemo(() => (links.data ? linkResolver(p.path, links.data) : null), [links.data, p.path]);

  if (note.isPending)
    return (
      <div className="notes-reader-state" role="status">
        <span className="spinner" aria-hidden /> {t("common.loading")}
      </div>
    );
  if (note.isError) {
    if (note.error instanceof ApiError && note.error.code === "note_missing")
      return (
        <div className="notes-reader-state">
          <p>{t("notes.reader.gone")}</p>
          {p.onCloseTab && (
            <Button size="sm" variant="secondary" onClick={p.onCloseTab}>
              {t("notes.cmd.closeTab")}
            </Button>
          )}
        </div>
      );
    return (
      <div className="notes-reader-state" role="alert">
        <p>{errorMessage(note.error, t)}</p>
        <Button size="sm" variant="secondary" onClick={() => void note.refetch()}>
          {t("brain.links.retry")}
        </Button>
      </div>
    );
  }

  const exportMarkdown = () => {
    const url = URL.createObjectURL(new Blob([content ?? ""], { type: "text/markdown;charset=utf-8" }));
    downloadUrl(url, `${withoutExt(note.data.name)}.md`);
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const openInEditor = () =>
    void apiCall("POST /api/memory/open", { body: { p: p.path } }).catch((err: unknown) =>
      toast(errorMessage(err, t), "danger"),
    );
  const copyPath = () => void copyText(p.path).then((ok) => ok && toast(t("notes.reader.copied"), "ok"));

  // Until the links are known a link is text: neither a button that may lead nowhere nor a false "broken".
  const byId = new Map<number, { path: string; title: string | null }>();
  const refs = {
    resolve: (ref: string) => {
      const row = resolve?.(ref);
      if (!row) return null;
      byId.set(row.id, { path: row.path, title: row.title });
      return row.id;
    },
    skills: new Set<string>(),
    onNote: (id: number) => {
      const to = byId.get(id);
      if (to) p.onOpen(to.path, { id, title: to.title });
    },
    onSkill: () => undefined,
    headingIds,
    brokenLink: (key: string, label: ReactNode, href: string) =>
      resolve && resolve(href) === null ? (
        <Tooltip key={key} label={t("notes.link.broken")}>
          <span
            className="notes-broken"
            role="img"
            aria-label={`${String(label)} — ${t("notes.link.broken")}`}
          >
            <Unlink aria-hidden />
            {label}
          </span>
        </Tooltip>
      ) : (
        <span key={key}>{label}</span>
      ),
  };

  return (
    <article className="notes-note" aria-label={title}>
      <header className="notes-note-head">
        <div className="notes-note-titles">
          <h1 className="notes-note-title">
            {title}
            {p.badge}
          </h1>
          <div className="notes-note-path">{p.path}</div>
        </div>
        <div className="notes-note-actions">
          <button
            type="button"
            className="btn sm"
            disabled={p.id === null}
            onClick={() => p.id !== null && p.onShowInGraph(p.id)}
          >
            <Network aria-hidden size={14} />
            {t("notes.reader.showInGraph")}
          </button>
          <DropdownMenu
            tip={t("notes.reader.more")}
            items={[
              { id: "home", label: t("notes.home.setThis"), onSelect: () => p.onSetHome(p.path) },
              { id: "export", label: t("notes.reader.export"), onSelect: exportMarkdown },
              { id: "open", label: t("notes.reader.open"), onSelect: openInEditor },
              { id: "copy", label: t("notes.reader.copyPath"), onSelect: copyPath },
            ]}
            trigger={
              <button type="button" className="btn sm" aria-label={t("notes.reader.more")}>
                <MoreHorizontal aria-hidden size={14} />
              </button>
            }
          />
        </div>
      </header>
      <div className="notes-note-body">
        <Markdown blocks={blocks} shape="panel" refs={refs} />
      </div>
    </article>
  );
}
