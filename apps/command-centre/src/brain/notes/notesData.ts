/**
 * What the notes view reads besides the graph, the search and the related files (those are `brain/memoryData.ts`'s):
 * one level of the tree (`GET /api/memory/tree`, door 1), a note (`GET /api/memory/note`) and its links
 * (`GET /api/memory/links`, the same cache entry as the links section of the panel). The query keys start with
 * `memory`, so the end of an index pass (`index.finished`) asks them again.
 */
import type { ApiCallResult } from "@mordomo/contracts";
import { useApiQuery, useRouteQuery } from "../../queries";
import type { NotesSort } from "./useNotesState";

export type TreeLevel = ApiCallResult<"GET /api/memory/tree">;
export type TreeFolder = TreeLevel["folders"][number];
export type TreeFile = TreeLevel["files"][number];
export type TreeRoot = TreeLevel["roots"][number];
export type NoteLinks = ApiCallResult<"GET /api/memory/links">;

export interface TreeAsk {
  context?: string;
  root?: string;
  dir?: string;
  sort?: NotesSort;
}

export function useTreeLevel(ask: TreeAsk, enabled = true) {
  const query = {
    ...(ask.context ? { context: ask.context } : {}),
    ...(ask.root ? { root: ask.root } : {}),
    ...(ask.dir ? { dir: ask.dir } : {}),
    ...(ask.sort && ask.sort !== "name" ? { sort: ask.sort } : {}),
  };
  return useRouteQuery(["memory", "tree", query], "GET /api/memory/tree", { query }, { enabled });
}

/** `<home>/memory`, the root where notes are written (the home, from the service's own info). */
export function useMemoryRoot(): string | null {
  const info = useApiQuery<{ home: string }>(["system", "info"], "/api/system/info", { staleTime: 60_000 });
  return info.data ? `${info.data.home.replace(/\/+$/, "")}/memory` : null;
}

/** The root a path is under (the longest one), and the path relative to it. */
export function rootOf(path: string, roots: readonly TreeRoot[]): { root: string; rel: string } | null {
  let best: string | null = null;
  for (const r of roots)
    if (path.startsWith(`${r.path}/`) && (best === null || r.path.length > best.length)) best = r.path;
  return best === null ? null : { root: best, rel: path.slice(best.length + 1) };
}

const dirOf = (rel: string) => (rel.includes("/") ? rel.slice(0, rel.lastIndexOf("/")) : "");
export const baseName = (path: string) => path.slice(path.lastIndexOf("/") + 1);
export const withoutExt = (name: string) => name.replace(/\.(md|markdown)$/i, "");

/**
 * The index id and the title of a note known only by its path (a tab read back after a reload): from the row of its
 * folder in the tree, which opens no file, under the roots of the active context. `null` while unknown, or when the
 * note has no row there.
 */
export function useNoteIdentity(
  path: string | null,
  known: { id?: number; title?: string | null } | undefined,
  roots: readonly TreeRoot[] | null,
  context: string | undefined,
) {
  const at = path && roots && known?.id === undefined ? rootOf(path, roots) : null;
  const level = useTreeLevel({ context, root: at?.root, dir: at ? dirOf(at.rel) : undefined }, at !== null);
  if (known?.id !== undefined) return { id: known.id, title: known.title ?? null };
  const row = at ? level.data?.files.find((f) => f.rel === at.rel) : undefined;
  return row ? { id: row.id, title: row.title } : null;
}

export function useNoteRead(path: string | null) {
  return useRouteQuery(
    ["memory", "note", path],
    "GET /api/memory/note",
    { query: { p: path ?? "" } },
    {
      enabled: path !== null,
      staleTime: 10_000,
    },
  );
}

export function useNoteLinks(id: number | null) {
  return useRouteQuery(
    ["memory", "links", id],
    "GET /api/memory/links",
    { query: { id: id ?? 0 } },
    {
      enabled: id !== null,
    },
  );
}
