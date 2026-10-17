import type { Db } from "../db/db.js";
import { fileRowFromDb, type FileRow } from "./indexer.js";
import { MARKDOWN_EXTENSIONS, foldName, type LinkKind } from "./linkParser.js";

/**
 * Who points at a file and where its links lead (.specs/features/cerebro-v2, S2). The targets are stored as text
 * (`note_links`, door 1) and resolved HERE, when somebody asks, so a file that is created, renamed or deleted changes
 * every link that points at it without any other file being read again, and a link to nothing is simply one that
 * resolves to nothing. Nothing here ever writes a note.
 */

export interface BacklinkRow {
  file: FileRow;
  kind: LinkKind;
  line: number;
  label: string | null;
}

export interface OutgoingRow {
  kind: LinkKind;
  target: string;
  label: string | null;
  line: number;
  /** The file the link leads to today, or `null` when it leads nowhere. */
  resolved: FileRow | null;
  /** Other files a wikilink could have meant (it took `resolved` by the resolution order). */
  alternatives: FileRow[];
}

export interface LinksOf {
  file: FileRow;
  backlinks: BacklinkRow[];
  outgoing: OutgoingRow[];
}

type Allow = (row: { root: string; rel: string }) => boolean;

/** A path as wikilink keys are compared: forward slashes, folded (`foldName`: NFC and Unicode lower case). */
const keyed = (rel: string): string => foldName(rel.replace(/\\/g, "/"));

const stemOf = (rel: string): string => {
  const lower = keyed(rel);
  const ext = MARKDOWN_EXTENSIONS.find((e) => lower.endsWith(e));
  return ext ? lower.slice(0, -ext.length) : lower;
};

/** Anything outside printable ASCII. */
const NON_ASCII = /[^\x20-\x7e]/;

/** The rows whose file name has a character outside printable ASCII (SQL compares those as bytes: see below). */
const accentedRows = (db: Db): FileRow[] =>
  (db.prepare("SELECT * FROM files WHERE name GLOB '*[^ -~]*'").all() as Array<Record<string, unknown>>).map(fileRowFromDb);

/**
 * The files a wikilink key can mean, best first: the one in the source's own folder, else the shortest relative path,
 * else the first in alphabetical order. A key with a folder (`pasta/alvo`) must match the end of the path.
 */
export function resolveWikilink(
  db: Db,
  source: { dir: string },
  key: string,
  allow: Allow,
  /** The files with a non-ASCII name, when the caller has them already (one request resolves many links). */
  accented: () => FileRow[] = () => accentedRows(db),
): FileRow[] {
  const last = key.slice(key.lastIndexOf("/") + 1);
  const names = [`${last}.md`, `${last}.markdown`, last];
  // SQLite's lower() folds ASCII only, so a key with an accent is compared in JavaScript, against the files whose
  // name has one (a name that folds to a non-ASCII key has a non-ASCII character itself). A key in plain ASCII is
  // looked up in SQL as before; the one name that folds into plain ASCII from outside it (the Kelvin sign) is not found.
  const rows: FileRow[] = NON_ASCII.test(last)
    ? accented().filter((file) => names.includes(foldName(file.name)))
    : (
        db
          .prepare(`SELECT * FROM files WHERE lower(name) IN (${names.map(() => "?").join(",")})`)
          .all(...names) as Array<Record<string, unknown>>
      ).map(fileRowFromDb);
  return rows
    .filter((file) => allow(file))
    .filter((file) => {
      const stem = stemOf(file.rel);
      const named = keyed(file.rel);
      return stem === key || stem.endsWith(`/${key}`) || named === key || named.endsWith(`/${key}`);
    })
    .sort(
      (a, b) =>
        Number(b.dir === source.dir) - Number(a.dir === source.dir) ||
        a.rel.length - b.rel.length ||
        (a.rel < b.rel ? -1 : a.rel > b.rel ? 1 : 0),
    );
}

/** The keys a wikilink may use to mean this file: every tail of its path without the extension. */
function keysOf(file: FileRow): string[] {
  const parts = stemOf(file.rel).split("/");
  const keys: string[] = [];
  for (let i = 0; i < parts.length; i++) keys.push(parts.slice(i).join("/"));
  // a link to a file that is not Markdown keeps its extension (`[[foto.png]]`)
  const named = keyed(file.rel).split("/");
  if (!MARKDOWN_EXTENSIONS.some((e) => keyed(file.rel).endsWith(e)))
    for (let i = 0; i < named.length; i++) keys.push(named.slice(i).join("/"));
  return [...new Set(keys)];
}

/** Who points at one indexed file, and where its own links lead. `null` when the id is not an allowed row. */
export function linksOf(db: Db, id: number, allow: Allow): LinksOf | null {
  const row = db.prepare("SELECT * FROM files WHERE id = ?").get(id) as Record<string, unknown> | undefined;
  if (!row) return null;
  const file = fileRowFromDb(row);
  if (!allow(file)) return null;

  const byId = db.prepare("SELECT * FROM files WHERE id = ?");
  const fileOf = (srcId: number): FileRow | null => {
    const r = byId.get(srcId) as Record<string, unknown> | undefined;
    const f = r ? fileRowFromDb(r) : null;
    return f && allow(f) ? f : null;
  };

  let accented: FileRow[] | null = null;
  const accentedOnce = () => (accented ??= accentedRows(db));

  const backlinks: BacklinkRow[] = [];
  const direct = db
    .prepare("SELECT src_id, line, label FROM note_links WHERE kind = 'markdown-link' AND target = ? AND src_id != ?")
    .all(file.path, file.id) as Array<{ src_id: number; line: number; label: string | null }>;
  for (const hit of direct) {
    const source = fileOf(hit.src_id);
    if (source) backlinks.push({ file: source, kind: "markdown-link", line: hit.line, label: hit.label });
  }
  const keys = keysOf(file);
  const candidates = db
    .prepare(
      `SELECT src_id, target, line, label FROM note_links WHERE kind = 'wikilink' AND src_id != ? AND target IN (${keys.map(() => "?").join(",")})`,
    )
    .all(file.id, ...keys) as Array<{ src_id: number; target: string; line: number; label: string | null }>;
  for (const hit of candidates) {
    const source = fileOf(hit.src_id);
    if (!source) continue;
    // A key several files share goes to one of them: it is a backlink of this file only if this one wins.
    if (resolveWikilink(db, source, hit.target, allow, accentedOnce)[0]?.id !== file.id) continue;
    backlinks.push({ file: source, kind: "wikilink", line: hit.line, label: hit.label });
  }
  backlinks.sort((a, b) => (a.file.rel < b.file.rel ? -1 : a.file.rel > b.file.rel ? 1 : a.line - b.line));

  const outgoing: OutgoingRow[] = (
    db
      .prepare("SELECT kind, target, label, line FROM note_links WHERE src_id = ? ORDER BY line, rowid")
      .all(file.id) as Array<{ kind: LinkKind; target: string; label: string | null; line: number }>
  ).map((link) => {
    if (link.kind === "markdown-link") {
      const hit = db.prepare("SELECT * FROM files WHERE path = ?").get(link.target) as Record<string, unknown> | undefined;
      const resolved = hit ? fileRowFromDb(hit) : null;
      return { ...link, resolved: resolved && allow(resolved) ? resolved : null, alternatives: [] };
    }
    const [resolved, ...alternatives] = resolveWikilink(db, file, link.target, allow, accentedOnce);
    return { ...link, resolved: resolved ?? null, alternatives };
  });
  return { file, backlinks, outgoing };
}
