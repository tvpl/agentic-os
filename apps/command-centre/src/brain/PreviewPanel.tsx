import { errorMessage } from "../views/shared";
/**
 * Preview panel: markdown rendered as navigation (item 59) — every path or
 * link that resolves to a graph node becomes a button that selects it, every
 * `/skill` token that matches a skill orb highlights that orb — plus the
 * relations card (edges grouped by kind with counts, item 33).
 */
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Copy, ExternalLink, Pin, Sparkles, Terminal, X } from "lucide-react";
import { api, type MemoryPreview } from "../api";
import { formatBytes, timeAgo, useToast } from "../components/ui";
import { useOsNavigate } from "../hooks/useViewTransition";
import {
  readConsoleDraft,
  storeConsoleDraft,
  withConsoleReference,
  CONSOLE_DRAFT_EVENT,
} from "../desktop/consoleDraft";
import { useT } from "../i18n";
import { relationsOf } from "./engine/graph";
import type { EdgeKind, FileNode, World } from "./engine/world";
import { collectReferences, parseMarkdown, resolveReference, type Block, type Inline } from "./markdown";

export interface PreviewState {
  node: FileNode;
  content: string | null;
  kind: string;
  message: string | null;
}

export interface PreviewPanelProps {
  preview: PreviewState;
  world: World;
  /** Skill slugs present on the skills ring. */
  skills: ReadonlySet<string>;
  lang: string;
  onClose: () => void;
  onSelectId: (id: number, focus?: boolean) => void;
  onSkill: (slug: string) => void;
  onUnpin: (node: FileNode) => void;
  /** Unresolved references found in the rendered markdown (hygiene panel). */
  onDangling: (refs: string[]) => void;
}

const MD_EXT = new Set([".md", ".markdown", ".mdx", ".mdown"]);
const KIND_KEYS: Record<
  EdgeKind,
  | "brain.kind.markdown-link"
  | "brain.kind.related"
  | "brain.kind.same-dir"
  | "brain.kind.same-area"
  | "brain.kind.other"
> = {
  "markdown-link": "brain.kind.markdown-link",
  related: "brain.kind.related",
  "same-dir": "brain.kind.same-dir",
  "same-area": "brain.kind.same-area",
  other: "brain.kind.other",
};

export function PreviewPanel({
  preview,
  world,
  skills,
  lang,
  onClose,
  onSelectId,
  onSkill,
  onUnpin,
  onDangling,
}: PreviewPanelProps) {
  const t = useT();
  const toast = useToast();
  const navigate = useOsNavigate();
  const [sending, setSending] = useState(false);
  const sendToConsole = async (ask?: string) => {
    if (sending) return;
    setSending(true);
    try {
      const latest = await api.get<MemoryPreview>(
        `/api/memory/preview?p=${encodeURIComponent(preview.node.path)}`,
      );
      if (latest.kind === "blocked") throw new Error(t("brain.blocked"));
      const base = readConsoleDraft();
      // "Ask for a summary" (refino item 24): the question comes with the file.
      const draft = withConsoleReference(
        ask ? { ...base, text: `${ask} ` } : base,
        preview.node.path,
        t("brain.consoleSource"),
      );
      if (!storeConsoleDraft(draft)) throw new Error(t("brain.consoleStorageFailed"));
      // The console is on the stage already (G2: the brain is a panel beside
      // it), so it has to be told the draft changed rather than re-reading it
      // on mount; then the desktop comes to the front.
      window.dispatchEvent(new CustomEvent(CONSOLE_DRAFT_EVENT));
      navigate("/");
    } catch (error) {
      toast(errorMessage(error, t), "danger");
    } finally {
      setSending(false);
    }
  };
  const { node } = preview;
  const isMarkdown = MD_EXT.has(node.ext.toLowerCase());
  const blocks = useMemo<Block[] | null>(
    () => (isMarkdown && preview.kind === "text" && preview.content ? parseMarkdown(preview.content) : null),
    [isMarkdown, preview.kind, preview.content],
  );
  const files = world.files;

  const resolve = useMemo(() => {
    const cache = new Map<string, number | null>();
    return (ref: string): number | null => {
      let v = cache.get(ref);
      if (v === undefined) {
        v = resolveReference(ref, files);
        cache.set(ref, v);
      }
      return v;
    };
  }, [files]);

  useEffect(() => {
    if (!blocks) {
      onDangling([]);
      return;
    }
    onDangling(collectReferences(blocks).filter((ref) => resolve(ref) === null));
  }, [blocks, resolve, onDangling]);

  const relations = useMemo(() => relationsOf(world, node.id), [world, node.id]);
  const degree = relations.reduce((s, r) => s + r.count, 0);

  const renderInline = (nodes: Inline[], keyBase = ""): ReactNode[] =>
    nodes.map((n, i) => {
      const key = `${keyBase}${i}`;
      switch (n.type) {
        case "text":
          return n.text;
        case "code":
          return <code key={key}>{n.text}</code>;
        case "strong":
          return <strong key={key}>{renderInline(n.children, key + "s")}</strong>;
        case "em":
          return <em key={key}>{renderInline(n.children, key + "e")}</em>;
        case "skill": {
          const known = skills.has(n.slug);
          return known ? (
            <button
              key={key}
              type="button"
              className="brain-md-chip skill"
              onClick={() => onSkill(n.slug)}
              title={t("brain.ring.skills")}
            >
              /{n.slug}
            </button>
          ) : (
            <code key={key}>/{n.slug}</code>
          );
        }
        case "path": {
          const id = resolve(n.text);
          return id !== null ? (
            <button
              key={key}
              type="button"
              className="brain-md-link"
              onClick={() => onSelectId(id, true)}
              title={t("brain.clickToSelect")}
            >
              {n.text}
            </button>
          ) : (
            <span key={key} className="brain-md-dangling" title={t("brain.hygiene.dangling")}>
              {n.text}
            </span>
          );
        }
        case "link": {
          const id = resolve(n.href);
          if (id !== null) {
            return (
              <button
                key={key}
                type="button"
                className="brain-md-link"
                onClick={() => onSelectId(id, true)}
                title={n.href}
              >
                {n.text}
              </button>
            );
          }
          if (/^https?:\/\//i.test(n.href)) {
            return (
              <a key={key} href={n.href} target="_blank" rel="noreferrer noopener">
                {n.text}
              </a>
            );
          }
          return (
            <span key={key} className="brain-md-dangling" title={n.href}>
              {n.text}
            </span>
          );
        }
      }
    });

  const renderBlocks = (list: Block[]): ReactNode[] =>
    list.map((b, i) => {
      switch (b.type) {
        case "heading": {
          const level = Math.min(4, b.level + 1);
          const Tag = `h${level}` as "h2" | "h3" | "h4";
          return <Tag key={i}>{renderInline(b.children, `h${i}`)}</Tag>;
        }
        case "paragraph":
          return <p key={i}>{renderInline(b.children, `p${i}`)}</p>;
        case "quote":
          return <blockquote key={i}>{renderInline(b.children, `q${i}`)}</blockquote>;
        case "code":
          return (
            <pre key={i} className="preview-pre">
              {b.text}
            </pre>
          );
        case "table":
          return (
            <table key={i} className="brain-md-table">
              <thead>
                <tr>
                  {b.header.map((cell, ci) => (
                    <th key={ci}>{renderInline(cell, `b${i}h${ci}`)}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {b.rows.map((row, ri) => (
                  <tr key={ri}>
                    {row.map((cell, ci) => (
                      <td key={ci}>{renderInline(cell, `b${i}r${ri}c${ci}`)}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          );
        case "hr":
          return <hr key={i} />;
        case "list": {
          const Tag = b.ordered ? "ol" : "ul";
          return (
            <Tag key={i}>
              {b.items.map((item, j) => (
                <li key={j} className={item.label ? "labelled" : undefined}>
                  {item.checked !== null && (
                    <span
                      className={`brain-md-task${item.checked ? " done" : ""}`}
                      aria-label={item.checked ? "done" : "todo"}
                    />
                  )}
                  {item.label && <span className="brain-md-label">{item.label}</span>}
                  <span className={item.label ? "brain-md-chips" : undefined}>
                    {renderInline(item.children, `l${i}-${j}`)}
                  </span>
                </li>
              ))}
            </Tag>
          );
        }
      }
    });

  return (
    <aside className="brain2-preview" aria-label={t("brain.preview")}>
      <div className="brain-preview-head">
        <h3 className="brain-preview-title">{node.title ?? node.name}</h3>
        <button className="btn ghost sm icon-only" onClick={onClose} aria-label={t("common.close")}>
          <X aria-hidden />
        </button>
      </div>
      <p className="mono brain-preview-path">{node.path}</p>
      <div className="brain-preview-badges">
        <span className="badge accent">{node.group}</span>
        <span className="badge dim">{node.ext || "file"}</span>
        <span className="badge dim">{formatBytes(node.size)}</span>
        <span className="badge dim">{timeAgo(node.mtime, lang)}</span>
        <span className="badge dim" title={t("brain.edges")}>
          {t("brain.degree")} {degree}
        </span>
        {node.pinned && (
          <button
            className="badge accent brain-badge-btn"
            onClick={() => onUnpin(node)}
            title={t("brain.unpin")}
          >
            <Pin aria-hidden /> {t("brain.pinned")}
          </button>
        )}
      </div>
      <div className="brain-preview-actions">
        <button
          className="btn sm"
          disabled={
            sending || preview.kind === "loading" || preview.kind === "blocked" || preview.kind === "error"
          }
          onClick={() => void sendToConsole()}
        >
          <Terminal aria-hidden /> {t("brain.useInConsole")}
        </button>
        <button
          className="btn sm"
          disabled={
            sending || preview.kind === "loading" || preview.kind === "blocked" || preview.kind === "error"
          }
          onClick={() => void sendToConsole(t("brain.askSummary"))}
        >
          <Sparkles aria-hidden /> {t("brain.summarize")}
        </button>
        <button
          className="btn sm"
          onClick={() => {
            void navigator.clipboard
              .writeText(node.path)
              .then(() => toast(t("common.copied"), "ok"))
              .catch((error: Error) => toast(errorMessage(error, t), "danger"));
          }}
        >
          <Copy aria-hidden /> {t("brain.copyPath")}
        </button>
        <button
          className="btn sm"
          onClick={() =>
            void api
              .post("/api/memory/open", { p: node.path })
              .catch((e: Error) => toast(e.message, "danger"))
          }
        >
          <ExternalLink aria-hidden /> {t("brain.openEditor")}
        </button>
      </div>

      {relations.length > 0 && (
        <section className="brain-relations" aria-label={t("brain.relations")}>
          <div className="hud-label">{t("brain.relations")}</div>
          {relations.map((r) => (
            <details key={r.kind} className="brain-relation" open={r.kind === "markdown-link"}>
              <summary>
                <span className={`brain-kind-swatch ${r.kind}`} aria-hidden />
                {t(KIND_KEYS[r.kind])} <span className="count">×{r.count}</span>
              </summary>
              <div className="brain-relation-list">
                {r.entries.slice(0, 12).map((e, i) => (
                  <button
                    key={`${e.id}-${i}`}
                    className="brain-md-link"
                    onClick={() => onSelectId(e.id, true)}
                    title={e.why || e.name}
                  >
                    {e.name}
                  </button>
                ))}
                {r.entries.length > 12 && (
                  <span className="brain-more">{t("brain.moreN", { n: r.entries.length - 12 })}</span>
                )}
              </div>
            </details>
          ))}
        </section>
      )}

      <div className="brain-preview-body">
        {preview.kind === "loading" ? (
          <span className="spinner" aria-hidden />
        ) : blocks ? (
          <div className="brain-md">{renderBlocks(blocks)}</div>
        ) : preview.kind === "text" ? (
          <pre className="preview-pre">{preview.content}</pre>
        ) : (
          <p className="brain-preview-note">
            {preview.kind === "blocked" ? t("brain.blocked") : (preview.message ?? t("brain.binary"))}
          </p>
        )}
      </div>
    </aside>
  );
}
