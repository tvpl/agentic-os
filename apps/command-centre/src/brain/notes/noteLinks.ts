/**
 * Which note a link of the body leads to (.specs/features/cerebro-vista-notas, AC 21, amendment 7): the answer of
 * `GET /api/memory/links` for the note, never a second resolution here, so the body and the panel cannot disagree. A
 * link of the body is matched to its `outgoing[]` entry by the key the index stored it under: for a wikilink the name
 * folded as `wikilinkKey` folds it (core/src/memory/linkParser.ts), for a Markdown link the absolute path it names.
 */
import type { NoteLinks } from "./notesData";

type Row = NonNullable<NoteLinks["outgoing"][number]["resolved"]>;

const SCHEME = /^[a-z][a-z0-9+.-]*:/i;
const fold = (name: string) => name.normalize("NFC").toLowerCase().normalize("NFC");

/** The key of a wikilink target: no heading, no `.md`, forward slashes, folded. */
export function wikilinkKey(raw: string): string {
  let target = raw.split("#")[0]!.trim().replace(/\\/g, "/");
  target = target.replace(/^\.?\/+/, "");
  for (const ext of [".md", ".markdown"])
    if (target.toLowerCase().endsWith(ext)) target = target.slice(0, -ext.length);
  return fold(target);
}

/** `path.resolve(dir, rel)` for POSIX paths. */
function resolvePosix(dir: string, rel: string): string {
  const parts = (rel.startsWith("/") ? rel : `${dir}/${rel}`).split("/");
  const out: string[] = [];
  for (const p of parts) {
    if (p === "" || p === ".") continue;
    if (p === "..") out.pop();
    else out.push(p);
  }
  return `/${out.join("/")}`;
}

/**
 * The resolver of one note's body: `href` (a wikilink target or a link's href) to the file it leads to, `undefined`
 * when the link is not one the index knows of (an external link), `null` when it leads nowhere.
 */
export function linkResolver(notePath: string, links: NoteLinks): (href: string) => Row | null | undefined {
  const dir = notePath.slice(0, notePath.lastIndexOf("/"));
  const wiki = new Map<string, Row | null>();
  const md = new Map<string, Row | null>();
  for (const link of links.outgoing) {
    const map = link.kind === "wikilink" ? wiki : md;
    if (!map.has(link.target) || link.resolved) map.set(link.target, link.resolved);
  }
  return (href) => {
    const raw = href.trim();
    if (SCHEME.test(raw)) return undefined;
    const before = raw.split(/[#?]/)[0]!;
    let decoded = before;
    try {
      decoded = decodeURIComponent(before);
    } catch {
      /* the text as it is */
    }
    const asPath = md.get(resolvePosix(dir, decoded));
    if (asPath !== undefined) return asPath;
    const asWiki = wiki.get(wikilinkKey(raw));
    if (asWiki !== undefined) return asWiki;
    return null;
  };
}
