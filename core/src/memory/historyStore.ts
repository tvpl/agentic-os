import crypto from "node:crypto";
import path from "node:path";
import zlib from "node:zlib";
import type { Settings } from "../config/schema.js";
import type { Db } from "../db/db.js";

/**
 * The store of the internal history of `memory/` (.specs/features/cerebro-memoria-confiavel, door 4): the
 * versioned-path rule, one version written with its blob, and the retention. Database and bytes only, so the index
 * worker can record what a pass finds (`indexer.ts`); the reads and the restore are `history.ts`.
 */

export const VERSION_ORIGINS = [
  "create",
  "save",
  "properties",
  "task",
  "review",
  "cleanup",
  "proposal",
  "restore",
  "guard",
  "external",
  "baseline",
  "removed",
  "import",
] as const;
export type VersionOrigin = (typeof VERSION_ORIGINS)[number];

/** `owner`, `run:<id>`, `mcp`, `external` (outside the MordomoOS) or `system` (the MordomoOS on its own). */
export type VersionAuthor = "owner" | "mcp" | "external" | "system" | `run:${string}`;

/** The origins the owner's note writes record (AC 21). */
export type NoteWriteOrigin = "create" | "save" | "properties" | "task" | "review";

export const MAX_VERSIONED_BYTES = 1024 * 1024;
export const MAX_VERSIONS_PER_PATH = 50;
export const MIN_VERSIONS_KEPT = 5;
export const HISTORY_LIST_LIMIT = 100;
export const DEFAULT_HISTORY_MAX_BYTES = 268_435_456;

const UNVERSIONED_DIRS: ReadonlySet<string> = new Set(["journal", "areas", "contexts"]);

/**
 * Door 4's rule on a path relative to `memory/` (`/`-separated) and its size: a `.md` of at most 1 MiB, not under the
 * root's `journal/`, `areas/` or `contexts/`, and not the root's `ROUTER.md`. A path that leaves `memory/` is not.
 */
export function isVersionedPath(rel: string, size: number): boolean {
  if (size > MAX_VERSIONED_BYTES) return false;
  if (rel === "" || rel.startsWith("/") || path.isAbsolute(rel)) return false;
  const parts = rel.split("/");
  if (parts.some((p) => p === "" || p === "." || p === "..")) return false;
  if (!parts.at(-1)!.toLowerCase().endsWith(".md")) return false;
  if (parts.length === 1) return parts[0]!.toLowerCase() !== "router.md";
  return !UNVERSIONED_DIRS.has(parts[0]!.toLowerCase());
}

/** The path of `file` relative to `memory/`, `/`-separated, or null when it is not under `memory/`. */
export function memoryRel(memory: string, file: string): string | null {
  const rel = path.relative(path.resolve(memory), path.resolve(file));
  if (rel === "" || rel.startsWith("..") || path.isAbsolute(rel)) return null;
  return rel.split(path.sep).join("/");
}

const hashOf = (bytes: Uint8Array): string => `sha256:${crypto.createHash("sha256").update(bytes).digest("hex")}`;

interface NewestRow {
  id: number;
  sha256: string | null;
  origin: string;
}

/** The newest version of a path, or undefined when it has none. */
export function newestVersion(db: Db, rel: string): NewestRow | undefined {
  return db
    .prepare("SELECT id, sha256, origin FROM memory_versions WHERE path = ? ORDER BY id DESC LIMIT 1")
    .get(rel) as NewestRow | undefined;
}

/**
 * Record one version of a path (`bytes` null: the path was removed). Not checked against the versioned-path rule: the
 * callers that name a file go through `recordFileVersion`. Applies the retention of door 4 in the same transaction.
 */
export function recordVersion(
  db: Db,
  input: {
    rel: string;
    bytes: Uint8Array | null;
    author: VersionAuthor;
    origin: VersionOrigin;
    proposalId?: string | null;
    at?: number;
  },
  maxBytes: number,
): number {
  return db.transaction(() => {
    let sha: string | null = null;
    if (input.bytes !== null) {
      sha = hashOf(input.bytes);
      const has = db.prepare("SELECT 1 FROM memory_blobs WHERE sha256 = ?").get(sha);
      if (!has) {
        db.prepare("INSERT INTO memory_blobs (sha256, codec, size, bytes) VALUES (?, 'deflate', ?, ?)").run(
          sha,
          input.bytes.byteLength,
          zlib.deflateRawSync(input.bytes),
        );
      }
    }
    const info = db
      .prepare("INSERT INTO memory_versions (path, sha256, at, author, origin, proposal_id) VALUES (?, ?, ?, ?, ?, ?)")
      .run(input.rel, sha, input.at ?? Date.now(), input.author, input.origin, input.proposalId ?? null);
    db.prepare(
      "DELETE FROM memory_versions WHERE path = ? AND id NOT IN (SELECT id FROM memory_versions WHERE path = ? ORDER BY id DESC LIMIT ?)",
    ).run(input.rel, input.rel, MAX_VERSIONS_PER_PATH);
    enforceByteCap(db, maxBytes);
    return Number(info.lastInsertRowid);
  })();
}

/** The bytes the blobs take as stored (deflated). */
export function storedBlobBytes(db: Db): number {
  return (db.prepare("SELECT COALESCE(SUM(length(bytes)), 0) n FROM memory_blobs").get() as { n: number }).n;
}

/**
 * While the stored blobs exceed `maxBytes`, drop the oldest version that is not among the newest 5 of its path, then
 * every blob no version names. A store where no path holds more than 5 is kept whole, even above the cap.
 */
export function enforceByteCap(db: Db, maxBytes: number): void {
  const gc = db.prepare(
    "DELETE FROM memory_blobs WHERE sha256 NOT IN (SELECT sha256 FROM memory_versions WHERE sha256 IS NOT NULL)",
  );
  gc.run();
  const oldest = db.prepare(
    `SELECT v.id FROM memory_versions v
      WHERE (SELECT COUNT(*) FROM memory_versions w WHERE w.path = v.path AND w.id > v.id) >= ?
      ORDER BY v.id LIMIT 1`,
  );
  const drop = db.prepare("DELETE FROM memory_versions WHERE id = ?");
  while (storedBlobBytes(db) > maxBytes) {
    const victim = oldest.get(MIN_VERSIONS_KEPT) as { id: number } | undefined;
    if (!victim) return;
    drop.run(victim.id);
    gc.run();
  }
}

/** The byte cap the settings give (an unreadable value reads its default). */
export function historyMaxBytes(settings: Settings): number {
  return settings.memory.history.maxBytes;
}

/** What an index pass found of a versioned file: its first version (`baseline`), a change made outside (`external`). */
export function recordIndexed(db: Db, rel: string, bytes: Uint8Array, maxBytes: number): number | null {
  if (!isVersionedPath(rel, bytes.byteLength)) return null;
  const newest = newestVersion(db, rel);
  if (!newest) return recordVersion(db, { rel, bytes, author: "system", origin: "baseline" }, maxBytes);
  if (newest.sha256 === hashOf(bytes)) return null;
  return recordVersion(db, { rel, bytes, author: "external", origin: "external" }, maxBytes);
}

/** The paths whose newest version is not `removed` (what an index pass checks is still on disk). */
export function livePaths(db: Db): string[] {
  return (
    db
      .prepare(
        `SELECT v.path FROM memory_versions v
          WHERE v.id = (SELECT MAX(w.id) FROM memory_versions w WHERE w.path = v.path) AND v.origin != 'removed'`,
      )
      .all() as Array<{ path: string }>
  ).map((r) => r.path);
}

/** The paths that have at least one version. */
export function versionedPaths(db: Db): Set<string> {
  return new Set(
    (db.prepare("SELECT DISTINCT path FROM memory_versions").all() as Array<{ path: string }>).map((r) => r.path),
  );
}


/**
 * Which paths of the history a caller may be told of (cerebro-memoria-confiavel, plan amendment 11, round 2 finding 6): a
 * path the caller may see, unless a note whose versions it holds went on to a path the caller may not see. History is
 * keyed by path, so a move leaves the old path's versions behind with the bytes the note had; they are the note's, and
 * a note that now sits in a hidden folder has no versions in a visible one.
 *
 * A path P has gone on to Q when P's newest version is a `removed` one and the bytes of its last version with bytes
 * are the bytes of the first version of Q, recorded after it: a note carried over unchanged (a move by this system, an
 * edit outside it that renamed the file). Followed as far as it goes; a path is hidden when it is, or when any path it
 * went on to is. A note that was edited while it moved is not followed (the bytes are the link).
 */
export function visibleHistoryPaths(
  db: Db,
  hidden: (rel: string) => boolean,
): (rel: string) => boolean {
  const first = new Map<string, { id: number; sha: string | null }>();
  const newest = new Map<string, { id: number; sha: string | null }>();
  const live = new Map<string, string>();
  for (const v of db
    .prepare(
      `SELECT v.path, v.id, v.sha256 FROM memory_versions v
         JOIN (SELECT path, MIN(id) m FROM memory_versions GROUP BY path) f ON v.id = f.m`,
    )
    .all() as Array<{ path: string; id: number; sha256: string | null }>)
    first.set(v.path, { id: v.id, sha: v.sha256 });
  for (const v of db
    .prepare(
      `SELECT v.path, v.id, v.sha256 FROM memory_versions v
         JOIN (SELECT path, MAX(id) m FROM memory_versions GROUP BY path) f ON v.id = f.m`,
    )
    .all() as Array<{ path: string; id: number; sha256: string | null }>)
    newest.set(v.path, { id: v.id, sha: v.sha256 });
  for (const v of db
    .prepare(
      `SELECT v.path, v.sha256 FROM memory_versions v
         JOIN (SELECT path, MAX(id) m FROM memory_versions WHERE sha256 IS NOT NULL GROUP BY path) f ON v.id = f.m`,
    )
    .all() as Array<{ path: string; sha256: string }>)
    live.set(v.path, v.sha256);
  // The paths that begin with each set of bytes.
  const startsWith = new Map<string, string[]>();
  for (const [p, f] of first) {
    if (f.sha === null) continue;
    const list = startsWith.get(f.sha) ?? [];
    list.push(p);
    startsWith.set(f.sha, list);
  }
  const known = new Map<string, boolean>();
  const visible = (rel: string, trail: ReadonlySet<string>): boolean => {
    const memo = known.get(rel);
    if (memo !== undefined) return memo;
    if (hidden(rel)) {
      known.set(rel, false);
      return false;
    }
    const end = newest.get(rel);
    const bytes = live.get(rel);
    let ok = true;
    if (end && end.sha === null && bytes !== undefined) {
      for (const next of startsWith.get(bytes) ?? []) {
        if (next === rel || trail.has(next) || (first.get(next)?.id ?? 0) <= end.id) continue;
        if (!visible(next, new Set([...trail, rel]))) {
          ok = false;
          break;
        }
      }
    }
    known.set(rel, ok);
    return ok;
  };
  return (rel) => visible(rel, new Set());
}
