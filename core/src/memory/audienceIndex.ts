import path from "node:path";
import type { FolderAudience } from "@mordomo/contracts";
import type { Db } from "../db/db.js";
import type { Settings } from "../config/schema.js";
import { isInside, realpathLenient } from "../security/paths.js";
import { accessSettings, deniedDirs, resolveFolderAccess } from "./folderAccess.js";
import { storedRowFilter } from "./indexer.js";

/**
 * One full-text index for each audience that is not the owner (.specs/features/cerebro-memoria-confiavel, door 19,
 * plan amendment 7). bm25 works out the weight of a word from every row of the index (how many hold it, how long they
 * are on average), so ranking a device's search over the index of the whole home let a hidden folder change the
 * order a device saw, and an order that changes says that something is there. A device and a run's credential
 * therefore search an index of their own, which holds only the files they may see: ranked as if the hidden
 * folders were not there, because to them they are not.
 *
 * - An audience that hides nothing from itself reads the owner's index (`files_fts`): there is no copy.
 * - Otherwise it reads `files_fts_agents` or `files_fts_devices` (migration 31), contentless: they hold the index of the
 *   text and not the text, which stays in `files_fts` (a snippet is read from there).
 * - The `meta` row `fts.<audience>` says what the table was built for: `shared`, or the JSON of the exclusion list of the
 *   audience's view of the settings (`{ home, excludes }`, whose last entry is the access mark of
 *   `core/src/memory/excludes.ts`). Every writer mirrors a file by THAT row, not by the settings it holds (the worker
 *   thread of a pass has the settings of when it started), so the table is always the table of the row; and the one
 *   function that changes the row, `ensureAudienceIndex`, rebuilds the table in the same transaction.
 * - `ensureAudienceIndex` is called when a pass starts and by the search and the recall of that audience, so a change of
 *   `folderAccess`, of the owner's excludes, or of the roots is a rebuild the next time anyone reads.
 */

export type Audience = FolderAudience;
export type FtsTable = "files_fts" | "files_fts_agents" | "files_fts_devices";
/**
 * The table of "related by content" edges an audience reads (door 20): the owner's `file_related`, or, for the devices
 * when a folder is hidden from them, the one worked out over the files they may see. A run's credential has no route
 * that reads edges, so the agents have no table of their own.
 */
export type RelatedTable = "file_related" | "file_related_devices";
export const RELATED_DEVICES_TABLE = "file_related_devices";

/** The table each audience reads when it has one of its own. */
export const AUDIENCE_TABLES: Readonly<Record<Audience, Exclude<FtsTable, "files_fts">>> = {
  agents: "files_fts_agents",
  devices: "files_fts_devices",
};

const SHARED = "shared";
const AUDIENCES: readonly Audience[] = ["agents", "devices"];
const metaKey = (audience: Audience): string => `fts.${audience}`;

export interface AudienceEnv {
  db: Db;
  homeDir: string;
  settings: Settings;
  /** The roots the index walks (the enabled indexed folders and the implicit ones such as `memory/`). */
  roots: readonly string[];
  platform?: NodeJS.Platform | undefined;
}

/** What the table of `audience` must be built for now: `shared` when it hides nothing from it, else its view's excludes. */
export function audienceSpec(env: Omit<AudienceEnv, "db">, audience: Audience): string {
  const paths = { artifacts: path.join(env.homeDir, "artifacts"), home: env.homeDir };
  const base = { paths, settings: env.settings, ...(env.platform ? { platform: env.platform } : {}) };
  const access = resolveFolderAccess(base);
  // A device is never served `artifacts/exports/` whatever the levels say: it matters to the index only when a root
  // holds that folder (the home itself indexed).
  const holdsExports = deniedDirs(paths, audience).some((dir) =>
    env.roots.some((root) => isInside(realpathLenient(root), dir) || isInside(dir, realpathLenient(root))),
  );
  if (!access.hides(audience) && !holdsExports) return SHARED;
  const view = accessSettings(base, audience, access);
  return JSON.stringify({ home: env.homeDir, excludes: view.excludes });
}

const relMetaKey = "rel.devices";

export const readSpec = (db: Db, audience: Audience): string | null =>
  (db.prepare("SELECT value FROM meta WHERE key = ?").get(metaKey(audience)) as { value: string } | undefined)?.value ?? null;

/** What the devices' related edges were last worked out for (the spec of their index at the time), or null. */
export const readRelatedSpec = (db: Db): string | null =>
  (db.prepare("SELECT value FROM meta WHERE key = ?").get(relMetaKey) as { value: string } | undefined)?.value ?? null;

export function writeRelatedSpec(db: Db, spec: string | null): void {
  if (spec === null) db.prepare("DELETE FROM meta WHERE key = ?").run(relMetaKey);
  else
    db.prepare("INSERT INTO meta(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(
      relMetaKey,
      spec,
    );
}

/** The related table `audience` reads, given the full-text table it was answered. */
export const relatedTableFor = (audience: Audience, fts: FtsTable): RelatedTable =>
  audience === "devices" && fts !== "files_fts" ? RELATED_DEVICES_TABLE : "file_related";

/** The test a stored spec makes of a row: true when the audience may see the file. */
export function allowOf(spec: string, platform: NodeJS.Platform | undefined): (row: { root: string; rel: string }) => boolean {
  const { home, excludes } = JSON.parse(spec) as { home: string; excludes: string[] };
  return storedRowFilter(excludes, { homeDir: home, ...(platform ? { platform } : {}) });
}

/**
 * Make the table of `audience` the one the settings ask for, and answer the table to read: the owner's `files_fts` when
 * the audience hides nothing from itself. A change is one transaction: the table is emptied, filled with the files the
 * audience may see (from the text in `files_fts`) and its `meta` row written. Call it outside a write transaction.
 */
export function ensureAudienceIndex(env: AudienceEnv, audience: Audience): FtsTable {
  const want = audienceSpec(env, audience);
  if (readSpec(env.db, audience) !== want) {
    const table = AUDIENCE_TABLES[audience];
    env.db
      .transaction(() => {
        // The row is read again under the lock: another process may have built it while this one waited.
        if (readSpec(env.db, audience) === want) return;
        env.db.prepare(`INSERT INTO ${table}(${table}) VALUES ('delete-all')`).run();
        if (want !== SHARED) {
          const allow = allowOf(want, env.platform);
          const insert = env.db.prepare(
            `INSERT INTO ${table}(rowid, name, rel, content) SELECT rowid, name, rel, content FROM files_fts WHERE rowid = ?`,
          );
          const rows = env.db.prepare("SELECT id, root, rel FROM files").all() as Array<{ id: number; root: string; rel: string }>;
          for (const row of rows) if (allow(row)) insert.run(row.id);
        }
        // The edges worked out for the old view are of the old view: emptied, and worked out again by the next pass.
        if (audience === "devices") {
          env.db.prepare(`DELETE FROM ${RELATED_DEVICES_TABLE}`).run();
          writeRelatedSpec(env.db, null);
        }
        env.db.prepare("INSERT INTO meta(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(
          metaKey(audience),
          want,
        );
      })
      .immediate();
  }
  return want === SHARED ? "files_fts" : AUDIENCE_TABLES[audience];
}

/**
 * The writer of the audience tables inside a write transaction of the indexer: each file written to (or removed from)
 * `files_fts` is written to (or removed from) the tables whose `meta` row says they hold a view, if the audience may
 * see it. A table with no row, or `shared`, is not touched. Made once per transaction.
 */
export class AudienceMirror {
  private readonly allow = new Map<Audience, (row: { root: string; rel: string }) => boolean>();

  constructor(
    private readonly db: Db,
    platform?: NodeJS.Platform,
  ) {
    for (const audience of AUDIENCES) {
      const spec = readSpec(db, audience);
      if (spec !== null && spec !== SHARED) this.allow.set(audience, allowOf(spec, platform));
    }
  }

  upsert(id: number, row: { root: string; rel: string }, name: string, content: string): void {
    for (const [audience, allow] of this.allow) {
      const table = AUDIENCE_TABLES[audience];
      this.db.prepare(`DELETE FROM ${table} WHERE rowid = ?`).run(id);
      if (allow(row)) {
        this.db.prepare(`INSERT INTO ${table} (rowid, name, rel, content) VALUES (?, ?, ?, ?)`).run(id, name, row.rel, content);
      } else if (audience === "devices") {
        // a file that left the view (moved into a hidden folder) takes its edges with it
        this.db.prepare(`DELETE FROM ${RELATED_DEVICES_TABLE} WHERE src_id = ? OR dst_id = ?`).run(id, id);
      }
    }
  }

  remove(id: number): void {
    for (const audience of this.allow.keys()) {
      this.db.prepare(`DELETE FROM ${AUDIENCE_TABLES[audience]} WHERE rowid = ?`).run(id);
      if (audience === "devices") this.db.prepare(`DELETE FROM ${RELATED_DEVICES_TABLE} WHERE src_id = ? OR dst_id = ?`).run(id, id);
    }
  }
}
