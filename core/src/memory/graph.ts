import path from "node:path";
import type { Db } from "../db/db.js";
import { fileRowFromDb, type FileRow } from "./indexer.js";

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
}

export interface GraphEdge {
  source: number;
  target: number;
  kind: "markdown-link" | "same-dir" | "same-area";
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
  opts: { area?: string; dir?: string; query?: string; maxNodes?: number } = {},
): GraphData {
  const maxNodes = Math.min(opts.maxNodes ?? 400, 1500);
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
    })),
    edges,
    truncated: totalFiles > files.length,
    totalFiles,
  };
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
  return out;
}
