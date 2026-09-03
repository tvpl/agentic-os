/**
 * Safe markdown renderer for skill bodies and markdown resources. Reuses the
 * Second Brain parser (block tree, never raw HTML): links only for http(s)/
 * mailto, `/skill` tokens link to the skill page, paths render as code.
 */
import { Fragment, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { parseMarkdown, type Block, type Inline } from "../../brain/markdown";

const SAFE_HREF = /^(https?:|mailto:)/i;

export function safeHref(href: string): string | null {
  const h = href.trim();
  if (SAFE_HREF.test(h)) return h;
  if (h.startsWith("#")) return h;
  return null;
}

function renderInline(nodes: Inline[], keyBase = "i"): ReactNode[] {
  return nodes.map((n, i) => {
    const key = `${keyBase}${i}`;
    switch (n.type) {
      case "text":
        return <Fragment key={key}>{n.text}</Fragment>;
      case "code":
      case "path":
        return <code key={key}>{n.text}</code>;
      case "strong":
        return <strong key={key}>{renderInline(n.children, key)}</strong>;
      case "em":
        return <em key={key}>{renderInline(n.children, key)}</em>;
      case "link": {
        const href = safeHref(n.href);
        if (!href) return <code key={key}>{n.text}</code>;
        return (
          <a key={key} href={href} target="_blank" rel="noreferrer noopener">
            {n.text}
          </a>
        );
      }
      case "skill":
        return (
          <Link key={key} className="apps-md-skill" to={`/skills/${encodeURIComponent(n.slug)}`}>
            /{n.slug}
          </Link>
        );
      default:
        return null;
    }
  });
}

function renderBlock(b: Block, i: number): ReactNode {
  switch (b.type) {
    case "heading": {
      const Tag = `h${Math.min(6, Math.max(1, b.level))}` as "h1" | "h2" | "h3" | "h4" | "h5" | "h6";
      return <Tag key={i}>{renderInline(b.children, `h${i}`)}</Tag>;
    }
    case "paragraph":
      return <p key={i}>{renderInline(b.children, `p${i}`)}</p>;
    case "quote":
      return <blockquote key={i}>{renderInline(b.children, `q${i}`)}</blockquote>;
    case "hr":
      return <hr key={i} />;
    case "code":
      return (
        <pre key={i} data-lang={b.lang ?? undefined}>
          <code>{b.text}</code>
        </pre>
      );
    case "list": {
      const Tag = b.ordered ? "ol" : "ul";
      return (
        <Tag key={i}>
          {b.items.map((item, j) => (
            <li key={j} className={item.checked === null ? undefined : "task"}>
              {item.checked !== null && <input type="checkbox" checked={item.checked} readOnly aria-label={item.checked ? "done" : "todo"} />}
              {item.label && <span className="apps-md-label">{item.label}:</span>}
              {renderInline(item.children, `l${i}-${j}`)}
            </li>
          ))}
        </Tag>
      );
    }
    default:
      return null;
  }
}

export default function Markdown({ source, className }: { source: string; className?: string }) {
  const blocks = parseMarkdown(source);
  return <div className={["apps-md", className ?? ""].filter(Boolean).join(" ")}>{blocks.map(renderBlock)}</div>;
}
