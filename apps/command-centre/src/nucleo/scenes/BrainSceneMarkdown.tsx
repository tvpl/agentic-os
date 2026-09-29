/**
 * The reader's markdown (Brain scene, immersive shell). The parser and the
 * reference resolver are the Second Brain's (`src/brain/markdown.ts`):
 * never HTML. Every path or link that resolves to a note becomes a synapse —
 * its content icon, then its words — that travels to it (and lights it in
 * the sky while pointed at); every known `/skill` a button to that skill;
 * headings carry the ids the outline jumps to.
 */
import type { ReactNode } from "react";
import type { Block, Inline } from "../../brain/markdown";
import { useT } from "../../i18n";
import { BrainGlyph } from "./BrainGlyph";
import type { ContentKind } from "./brainGlyphs";

export interface MarkdownProps {
  blocks: Block[];
  resolve: (ref: string) => number | null;
  skills: ReadonlySet<string>;
  onNote: (id: number) => void;
  onSkill: (slug: string) => void;
  /** Heading ids by block index (the outline's). */
  headingIds?: ReadonlyMap<number, string>;
  /** Point at a note (hover / focus of a link), or stop pointing (null). */
  onPeek?: (id: number | null) => void;
  /** Content kind of a note id, for the icon before a resolved link. */
  kindOf?: (id: number) => ContentKind | null;
}

export function BrainSceneMarkdown({
  blocks,
  resolve,
  skills,
  onNote,
  onSkill,
  headingIds,
  onPeek,
  kindOf,
}: MarkdownProps) {
  const t = useT();
  const synapse = (key: string, id: number, label: ReactNode, title: string) => {
    const kind = kindOf?.(id) ?? null;
    return (
      <button
        key={key}
        type="button"
        className="bs-md-link"
        onClick={() => onNote(id)}
        onMouseEnter={() => onPeek?.(id)}
        onMouseLeave={() => onPeek?.(null)}
        onFocus={() => onPeek?.(id)}
        onBlur={() => onPeek?.(null)}
        title={title}
      >
        {kind && <BrainGlyph kind={kind} size={13} className="bs-md-link-icon" />}
        {label}
      </button>
    );
  };
  const inline = (nodes: Inline[], keyBase: string): ReactNode[] =>
    nodes.map((n, i) => {
      const key = `${keyBase}${i}`;
      switch (n.type) {
        case "text":
          return n.text;
        case "code":
          return <code key={key}>{n.text}</code>;
        case "strong":
          return <strong key={key}>{inline(n.children, `${key}s`)}</strong>;
        case "em":
          return <em key={key}>{inline(n.children, `${key}e`)}</em>;
        case "skill":
          return skills.has(n.slug) ? (
            <button key={key} type="button" className="bs-md-skill" onClick={() => onSkill(n.slug)}>
              /{n.slug}
            </button>
          ) : (
            <code key={key}>/{n.slug}</code>
          );
        case "path": {
          const id = resolve(n.text);
          return id !== null ? (
            synapse(key, id, n.text, t("brain.clickToSelect"))
          ) : (
            <span key={key} className="bs-md-dangling" title={t("brain.hygiene.dangling")}>
              {n.text}
            </span>
          );
        }
        case "link": {
          const id = resolve(n.href);
          if (id !== null) return synapse(key, id, n.text, n.href);
          if (/^https?:\/\//i.test(n.href))
            return (
              <a key={key} href={n.href} target="_blank" rel="noreferrer noopener">
                {n.text}
                <span className="bs-md-ext" aria-hidden>
                  ↗
                </span>
              </a>
            );
          return (
            <span key={key} className="bs-md-dangling" title={n.href}>
              {n.text}
            </span>
          );
        }
      }
    });

  return (
    <div className="bs-md">
      {blocks.map((b, i) => {
        switch (b.type) {
          case "heading": {
            const Tag = `h${Math.min(5, b.level + 2)}` as "h3" | "h4" | "h5";
            return (
              <Tag key={i} id={headingIds?.get(i)} data-level={b.level}>
                {inline(b.children, `h${i}`)}
              </Tag>
            );
          }
          case "paragraph":
            return <p key={i}>{inline(b.children, `p${i}`)}</p>;
          case "quote":
            return <blockquote key={i}>{inline(b.children, `q${i}`)}</blockquote>;
          case "code":
            return (
              <pre key={i} className="bs-md-pre" data-lang={b.lang ?? undefined}>
                <code>{b.text}</code>
              </pre>
            );
          case "hr":
            return <hr key={i} />;
          case "table":
            return (
              <div key={i} className="bs-md-table-wrap">
                <table className="bs-md-table">
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
              </div>
            );
          case "list": {
            const Tag = b.ordered ? "ol" : "ul";
            return (
              <Tag key={i}>
                {b.items.map((item, j) => (
                  <li
                    key={j}
                    className={item.label ? "labelled" : undefined}
                    data-task={item.checked === null ? undefined : item.checked ? "done" : "open"}
                  >
                    {item.checked !== null && (
                      <span className={`bs-md-task${item.checked ? " done" : ""}`} aria-hidden />
                    )}
                    {item.label && <span className="bs-md-label">{item.label}</span>}
                    {inline(item.children, `l${i}-${j}`)}
                  </li>
                ))}
              </Tag>
            );
          }
        }
      })}
    </div>
  );
}
