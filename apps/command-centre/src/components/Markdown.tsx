/**
 * The one Markdown renderer (.specs/features/limpeza-legado, door 2). The parser (`brain/markdown.ts`) turns the
 * text into a block tree, never HTML; this turns the tree into elements, never `dangerouslySetInnerHTML`, so raw
 * HTML in a note is text. Three surfaces draw it, each with the classes and the references it always had:
 *
 * - `page`: a skill body or an agent's reply (`.apps-md`): a `/skill` is a link to its page, a path is code;
 * - `panel`: the Second Brain's preview (`.brain-md`): a path or link that names a note selects it;
 * - `scene`: the Núcleo's reader (`.bs-md`): the same, with the note's icon, a hover that points at it in the sky,
 *   and the ids the outline jumps to.
 *
 * What counts as a link out is decided once, by `safeExternalHref`: `http://`, `https://` and `mailto:`, and
 * nothing else. Anything else (`javascript:`, `data:`, `//host`, `#anchor`, a relative path) is inert text.
 */
import { Fragment, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { useT } from "../i18n";
import type { Block, Inline } from "../brain/markdown";
import { parseMarkdown } from "../brain/markdown";

export type MarkdownShape = "page" | "panel" | "scene";

/** What `panel` and `scene` need to turn a reference into a button; `page` needs none of it. */
export interface MarkdownRefs {
  /** The id of the note a path or a link names, or null. */
  resolve: (ref: string) => number | null;
  /** The skills a `/token` may name. */
  skills: ReadonlySet<string>;
  onNote: (id: number) => void;
  onSkill: (slug: string) => void;
  /** Point at a note (hover or focus of a link), or stop pointing (null). `scene` only. */
  onPeek?: (id: number | null) => void;
  /** The icon before a resolved link. `scene` only. */
  iconOf?: (id: number) => ReactNode;
  /** Heading ids by block index (the outline's). `scene` only. */
  headingIds?: ReadonlyMap<number, string>;
}

export interface MarkdownProps {
  /** The text; parsed here. Give `blocks` instead when the caller has parsed it already. */
  source?: string;
  blocks?: Block[];
  shape: MarkdownShape;
  /** An extra class on the root. `page` only. */
  className?: string;
  refs?: MarkdownRefs;
}

const EXTERNAL = /^(https?:\/\/|mailto:)/i;

/** The href of a link that may leave the app, or null: the only rule of the product on what a link may be. */
export function safeExternalHref(href: string): string | null {
  const h = href.trim();
  return EXTERNAL.test(h) ? h : null;
}

/** Every `<a>` the renderer draws: it opens elsewhere, and neither side learns about the other. */
const anchor = (key: string, href: string, children: ReactNode) => (
  <a key={key} href={href} target="_blank" rel="noreferrer noopener">
    {children}
  </a>
);

const NO_REFS: MarkdownRefs = {
  resolve: () => null,
  skills: new Set(),
  onNote: () => undefined,
  onSkill: () => undefined,
};

export function Markdown({ source, blocks, shape, className, refs }: MarkdownProps) {
  const t = useT();
  const tree = blocks ?? parseMarkdown(source ?? "");
  const r = refs ?? NO_REFS;

  const note = (key: string, id: number, label: ReactNode, title: string): ReactNode => {
    if (shape === "panel")
      return (
        <button key={key} type="button" className="brain-md-link" onClick={() => r.onNote(id)} title={title}>
          {label}
        </button>
      );
    const icon = r.iconOf?.(id) ?? null;
    return (
      <button
        key={key}
        type="button"
        className="bs-md-link"
        onClick={() => r.onNote(id)}
        onMouseEnter={() => r.onPeek?.(id)}
        onMouseLeave={() => r.onPeek?.(null)}
        onFocus={() => r.onPeek?.(id)}
        onBlur={() => r.onPeek?.(null)}
        title={title}
      >
        {icon}
        {label}
      </button>
    );
  };
  const dangling = (key: string, label: ReactNode, title: string) => (
    <span key={key} className={shape === "panel" ? "brain-md-dangling" : "bs-md-dangling"} title={title}>
      {label}
    </span>
  );

  const inline = (nodes: Inline[], keyBase: string): ReactNode[] =>
    nodes.map((n, i) => {
      const key = `${keyBase}${i}`;
      switch (n.type) {
        case "text":
          return <Fragment key={key}>{n.text}</Fragment>;
        case "code":
          return <code key={key}>{n.text}</code>;
        case "strong":
          return <strong key={key}>{inline(n.children, `${key}s`)}</strong>;
        case "em":
          return <em key={key}>{inline(n.children, `${key}e`)}</em>;
        case "skill": {
          if (shape === "page")
            return (
              <Link key={key} className="apps-md-skill" to={`/skills/${encodeURIComponent(n.slug)}`}>
                /{n.slug}
              </Link>
            );
          if (!r.skills.has(n.slug)) return <code key={key}>/{n.slug}</code>;
          return shape === "panel" ? (
            <button
              key={key}
              type="button"
              className="brain-md-chip skill"
              onClick={() => r.onSkill(n.slug)}
              title={t("brain.ring.skills")}
            >
              /{n.slug}
            </button>
          ) : (
            <button key={key} type="button" className="bs-md-skill" onClick={() => r.onSkill(n.slug)}>
              /{n.slug}
            </button>
          );
        }
        case "path": {
          if (shape === "page") return <code key={key}>{n.text}</code>;
          const id = r.resolve(n.text);
          return id !== null
            ? note(key, id, n.text, t("brain.clickToSelect"))
            : dangling(key, n.text, t("brain.hygiene.dangling"));
        }
        case "link": {
          const href = safeExternalHref(n.href);
          if (shape === "page") return href ? anchor(key, href, n.text) : <code key={key}>{n.text}</code>;
          const id = r.resolve(n.href);
          if (id !== null) return note(key, id, n.text, n.href);
          if (href)
            return anchor(
              key,
              href,
              shape === "scene" ? (
                <>
                  {n.text}
                  <span className="bs-md-ext" aria-hidden>
                    ↗
                  </span>
                </>
              ) : (
                n.text
              ),
            );
          return dangling(key, n.text, n.href);
        }
      }
    });

  const heading = (b: Extract<Block, { type: "heading" }>, i: number): ReactNode => {
    const level = shape === "page" ? b.level : shape === "panel" ? b.level + 1 : b.level + 2;
    const max = shape === "page" ? 6 : shape === "panel" ? 4 : 5;
    const Tag = `h${Math.min(max, Math.max(1, level))}` as "h1" | "h2" | "h3" | "h4" | "h5" | "h6";
    if (shape === "scene")
      return (
        <Tag key={i} id={r.headingIds?.get(i)} data-level={b.level}>
          {inline(b.children, `h${i}`)}
        </Tag>
      );
    return <Tag key={i}>{inline(b.children, `h${i}`)}</Tag>;
  };

  const code = (b: Extract<Block, { type: "code" }>, i: number): ReactNode =>
    shape === "panel" ? (
      <pre key={i} className="preview-pre">
        {b.text}
      </pre>
    ) : (
      <pre key={i} className={shape === "scene" ? "bs-md-pre" : undefined} data-lang={b.lang ?? undefined}>
        <code>{b.text}</code>
      </pre>
    );

  const table = (b: Extract<Block, { type: "table" }>, i: number): ReactNode => {
    const cls = shape === "page" ? undefined : shape === "panel" ? "brain-md-table" : "bs-md-table";
    const el = (
      <table key={i} className={cls}>
        <thead>
          <tr>
            {b.header.map((cell, ci) => (
              <th key={ci}>{inline(cell, `b${i}h${ci}`)}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {b.rows.map((row, ri) => (
            <tr key={ri}>
              {row.map((cell, ci) => (
                <td key={ci}>{inline(cell, `b${i}r${ri}c${ci}`)}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    );
    return shape === "scene" ? (
      <div key={i} className="bs-md-table-wrap">
        {el}
      </div>
    ) : (
      el
    );
  };

  const list = (b: Extract<Block, { type: "list" }>, i: number): ReactNode => {
    const Tag = b.ordered ? "ol" : "ul";
    return (
      <Tag key={i}>
        {b.items.map((item, j) => {
          const body = inline(item.children, `l${i}-${j}`);
          const done = item.checked === true;
          if (shape === "page")
            return (
              <li key={j} className={item.checked === null ? undefined : "task"}>
                {item.checked !== null && (
                  <input type="checkbox" checked={done} readOnly aria-label={done ? "done" : "todo"} />
                )}
                {item.label && <span className="apps-md-label">{item.label}:</span>}
                {body}
              </li>
            );
          if (shape === "panel")
            return (
              <li key={j} className={item.label ? "labelled" : undefined}>
                {item.checked !== null && (
                  <span
                    className={`brain-md-task${done ? " done" : ""}`}
                    aria-label={done ? "done" : "todo"}
                  />
                )}
                {item.label && <span className="brain-md-label">{item.label}</span>}
                <span className={item.label ? "brain-md-chips" : undefined}>{body}</span>
              </li>
            );
          return (
            <li
              key={j}
              className={item.label ? "labelled" : undefined}
              data-task={item.checked === null ? undefined : done ? "done" : "open"}
            >
              {item.checked !== null && <span className={`bs-md-task${done ? " done" : ""}`} aria-hidden />}
              {item.label && <span className="bs-md-label">{item.label}</span>}
              {body}
            </li>
          );
        })}
      </Tag>
    );
  };

  const block = (b: Block, i: number): ReactNode => {
    switch (b.type) {
      case "heading":
        return heading(b, i);
      case "paragraph":
        return <p key={i}>{inline(b.children, `p${i}`)}</p>;
      case "quote":
        return <blockquote key={i}>{inline(b.children, `q${i}`)}</blockquote>;
      case "hr":
        return <hr key={i} />;
      case "code":
        return code(b, i);
      case "table":
        return table(b, i);
      case "list":
        return list(b, i);
    }
  };

  const root =
    shape === "page"
      ? ["apps-md", className ?? ""].filter(Boolean).join(" ")
      : shape === "panel"
        ? "brain-md"
        : "bs-md";
  return <div className={root}>{tree.map(block)}</div>;
}
