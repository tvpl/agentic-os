import path from "node:path";
import type { Db } from "../db/db.js";
import { fileRowFromDb, type FileRow } from "./indexer.js";
import { relatedEdges } from "./related.js";

export interface GraphNode {
  id: number;
  name: string;
  rel: string;
  path: string;
  ext: string;
  area: string | null;
  dir: string;
  size: number;
  mtime: number;
  title: string | null;
  tags: string[];
  /** Inline `key:: value` fields (only present when the file has any). */
  fields?: Record<string, string>;
}

export interface GraphEdge {
  source: number;
  target: number;
  kind: "markdown-link" | "same-dir" | "same-area" | "related";
  /** Human explanation of why the two files are related. */
  why: string;
}

export interface GraphData {
  nodes: GraphNode[];
  edges: GraphEdge[];
  truncated: boolean;
  totalFiles: number;
}

/**
 * Builds graph data for the Visual Second Brain.
 * Caps node/edge counts so very large workspaces stay responsive; the UI can
 * narrow by area/dir/query to see more detail.
 */
export function buildGraph(
  db: Db,
  opts: { area?: string; dir?: string; query?: string; maxNodes?: number; related?: boolean } = {},
): GraphData {
  const maxNodes = Math.min(opts.maxNodes ?? 400, 4000);
  const clauses: string[] = [];
  const params: unknown[] = [];
  if (opts.area) {
    clauses.push("area = ?");
    params.push(opts.area);
  }
  if (opts.dir) {
    clauses.push("dir LIKE ?");
    params.push(`${opts.dir}%`);
  }
  if (opts.query) {
    clauses.push("(name LIKE ? OR rel LIKE ?)");
    params.push(`%${opts.query}%`, `%${opts.query}%`);
  }
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  const totalFiles = (
    db.prepare(`SELECT COUNT(*) c FROM files ${where}`).get(...params) as { c: number }
  ).c;
  const rows = db
    .prepare(`SELECT * FROM files ${where} ORDER BY mtime DESC LIMIT ?`)
    .all(...params, maxNodes) as Array<Record<string, unknown>>;
  const files = rows.map(fileRowFromDb);
  const included = new Set(files.map((f) => f.id));

  const edges: GraphEdge[] = [];
  const linkRows = db
    .prepare("SELECT src_id, dst_id FROM file_links WHERE kind = 'markdown-link'")
    .all() as Array<{ src_id: number; dst_id: number }>;
  for (const link of linkRows) {
    if (included.has(link.src_id) && included.has(link.dst_id)) {
      edges.push({
        source: link.src_id,
        target: link.dst_id,
        kind: "markdown-link",
        why: "One file links to the other with a markdown link.",
      });
    }
  }

  // Same-directory edges: connect each file to a directory hub (cheapest way to
  // show structure). We link consecutive files per dir to keep edge count linear.
  const byDir = new Map<string, FileRow[]>();
  for (const f of files) {
    const list = byDir.get(f.dir) ?? [];
    list.push(f);
    byDir.set(f.dir, list);
  }
  for (const [dir, group] of byDir) {
    if (group.length < 2) continue;
    const hub = group[0]!;
    for (let i = 1; i < group.length && i < 40; i++) {
      edges.push({
        source: hub.id,
        target: group[i]!.id,
        kind: "same-dir",
        why: `Both live in ${path.basename(dir) || dir}/.`,
      });
    }
  }

  // Related-by-content edges (Onda 4): TF-IDF cosine over the indexed text,
  // top-3 per file. Off by default in the canvas legend; always computed so
  // the count shows, unless the caller opts out (`related: false`).
  if (opts.related !== false) {
    for (const r of storedOrComputedRelated(db, files)) {
      edges.push({
        source: r.source,
        target: r.target,
        kind: "related",
        why: r.terms.length
          ? `Similar content (${Math.round(r.score * 100)}%): ${r.terms.join(", ")}.`
          : `Similar content (${Math.round(r.score * 100)}%).`,
      });
    }
  }

  return {
    nodes: files.map((f) => ({
      id: f.id,
      name: f.name,
      rel: f.rel,
      path: f.path,
      ext: f.ext,
      area: f.area,
      dir: f.dir,
      size: f.size,
      mtime: f.mtime,
      title: f.title,
      tags: f.tags,
      ...(Object.keys(f.fields).length > 0 ? { fields: f.fields } : {}),
    })),
    edges,
    truncated: totalFiles > files.length,
    totalFiles,
  };
}

/**
 * Rows the indexer stored (`file_related`) when it has any; otherwise the
 * request-time computation (an index made before migration 9, until the next
 * pass rebuilds it).
 */
function storedOrComputedRelated(
  db: Db,
  files: ReadonlyArray<{ id: number; mtime: number }>,
): Array<{ source: number; target: number; score: number; terms: string[] }> {
  const total = (db.prepare("SELECT COUNT(*) c FROM file_related").get() as { c: number }).c;
  if (total === 0) return relatedEdges(db, files);
  const ids = files.map((f) => f.id);
  const out: Array<{ source: number; target: number; score: number; terms: string[] }> = [];
  for (let i = 0; i < ids.length; i += 400) {
    const chunk = ids.slice(i, i + 400);
    const marks = chunk.map(() => "?").join(",");
    const rows = db
      .prepare(`SELECT src_id, dst_id, score, terms FROM file_related WHERE src_id IN (${marks}) AND dst_id IN (${marks})`)
      .all(...chunk, ...chunk) as Array<{ src_id: number; dst_id: number; score: number; terms: string }>;
    for (const r of rows) {
      let terms: string[] = [];
      try {
        terms = JSON.parse(r.terms) as string[];
      } catch {
        /* keep empty */
      }
      out.push({ source: r.src_id, target: r.dst_id, score: r.score, terms });
    }
  }
  return out;
}

export function relatedFiles(db: Db, fileId: number): Array<{ file: FileRow; why: string }> {
  const links = db
    .prepare(
      `SELECT CASE WHEN src_id = ? THEN dst_id ELSE src_id END AS other, kind
       FROM file_links WHERE src_id = ? OR dst_id = ? LIMIT 50`,
    )
    .all(fileId, fileId, fileId) as Array<{ other: number; kind: string }>;
  const out: Array<{ file: FileRow; why: string }> = [];
  for (const link of links) {
    const row = db.prepare("SELECT * FROM files WHERE id = ?").get(link.other) as
      | Record<string, unknown>
      | undefined;
    if (!row) continue;
    out.push({
      file: fileRowFromDb(row),
      why:
        link.kind === "markdown-link"
          ? "Connected by a markdown link."
          : link.kind === "same-dir"
            ? "They share the same folder."
            : "They belong to the same area.",
    });
  }
  const related = db
    .prepare(
      `SELECT CASE WHEN src_id = ? THEN dst_id ELSE src_id END AS other, score, terms
       FROM file_related WHERE src_id = ? OR dst_id = ? ORDER BY score DESC LIMIT 10`,
    )
    .all(fileId, fileId, fileId) as Array<{ other: number; score: number; terms: string }>;
  for (const r of related) {
    if (out.some((o) => o.file.id === r.other)) continue;
    const row = db.prepare("SELECT * FROM files WHERE id = ?").get(r.other) as Record<string, unknown> | undefined;
    if (!row) continue;
    let terms: string[] = [];
    try {
      terms = JSON.parse(r.terms) as string[];
    } catch {
      /* keep empty */
    }
    out.push({
      file: fileRowFromDb(row),
      why: `Similar content (${Math.round(r.score * 100)}%)${terms.length ? `: ${terms.join(", ")}` : ""}.`,
    });
  }
  return out;
}
