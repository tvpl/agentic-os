import path from "node:path";
import type { Db } from "../db/db.js";
import type { MordomoPaths } from "../paths.js";
import type { Settings } from "../config/schema.js";
import type { Routine, SilentRoutine } from "../routines/types.js";
import type { Connector } from "../connectors/registry.js";
import { checkRouters } from "./routers.js";

/**
 * System hygiene — the "audit by density" of the second brain turned into an
 * actionable list: orphan notes, dangling router pointers, stale files,
 * skills never run, silent routines, connectors nobody uses.
 */

export type HygieneKind =
  | "orphan"
  | "dangling-link"
  | "stale"
  | "skill-never-run"
  | "silent-routine"
  | "unused-connector";

export type HygieneAction = "open" | "disconnect" | "archive" | "link";

export interface HygieneItem {
  kind: HygieneKind;
  /** File path for file-based kinds; slug / id otherwise. */
  id: string;
  name: string;
  detail: string;
  action: HygieneAction;
}

export interface HygieneReport {
  generatedAt: number;
  counts: Record<HygieneKind, number>;
  items: HygieneItem[];
  thresholds: { staleDays: number; silentRoutineDays: number; unusedConnectorDays: number };
}

export interface HygieneSources {
  skills: Array<{ slug: string; name: string; enabled?: boolean }>;
  routines: Routine[];
  connectors: Connector[];
  /**
   * Silent routines as the scheduler sees them (`RoutineScheduler.silent(days)`,
   * the same source as `GET /api/routines/silent`). When given it wins over the
   * local history query, so both views agree; `routines` is then only used as a
   * fallback for callers without a scheduler (CLI, tests).
   */
  silent?: SilentRoutine[];
}

export interface HygieneOptions {
  staleDays?: number;
  silentRoutineDays?: number;
  unusedConnectorDays?: number;
  /** Items listed per category (default 50). */
  perKind?: number;
  now?: number;
}

const DAY = 86_400_000;

function daysAgo(ts: number, now: number): number {
  return Math.max(0, Math.floor((now - ts) / DAY));
}

export function memoryHygiene(
  db: Db,
  paths: MordomoPaths,
  settings: Settings,
  sources: HygieneSources,
  opts: HygieneOptions = {},
): HygieneReport {
  const now = opts.now ?? Date.now();
  const staleDays = opts.staleDays ?? 90;
  const silentRoutineDays = opts.silentRoutineDays ?? 30;
  const unusedConnectorDays = opts.unusedConnectorDays ?? 30;
  const perKind = Math.min(Math.max(opts.perKind ?? 50, 1), 500);
  const items: HygieneItem[] = [];
  const counts: Record<HygieneKind, number> = {
    orphan: 0,
    "dangling-link": 0,
    stale: 0,
    "skill-never-run": 0,
    "silent-routine": 0,
    "unused-connector": 0,
  };
  const routerDir = path.join(paths.memory, "areas");
  const routerMaster = path.join(paths.memory, "ROUTER.md");
  const isGenerated = (p: string) => p === routerMaster || p.startsWith(routerDir + path.sep);

  // 1. Orphans: markdown notes with no markdown-link edge in either direction.
  const orphanRows = db
    .prepare(
      `SELECT f.path, f.name, f.mtime FROM files f
       WHERE f.ext IN ('.md', '.markdown')
         AND NOT EXISTS (SELECT 1 FROM file_links l WHERE l.kind = 'markdown-link' AND (l.src_id = f.id OR l.dst_id = f.id))
       ORDER BY f.mtime DESC`,
    )
    .all() as Array<{ path: string; name: string; mtime: number }>;
  const orphans = orphanRows.filter((r) => !isGenerated(r.path));
  counts.orphan = orphans.length;
  for (const r of orphans.slice(0, perKind)) {
    items.push({ kind: "orphan", id: r.path, name: r.name, detail: `No links in or out; last modified ${daysAgo(r.mtime, now)} d ago.`, action: "link" });
  }

  // 2. Dangling router pointers (reuses the router checker).
  const issues = checkRouters(db, paths, settings);
  counts["dangling-link"] = issues.length;
  for (const issue of issues.slice(0, perKind)) {
    items.push({ kind: "dangling-link", id: issue.file, name: path.basename(issue.file), detail: issue.problem, action: "open" });
  }

  // 3. Stale files: not touched for `staleDays`.
  const staleCutoff = now - staleDays * DAY;
  const staleCount = (db.prepare("SELECT COUNT(*) c FROM files WHERE mtime < ?").get(staleCutoff) as { c: number }).c;
  counts.stale = staleCount;
  const staleRows = db
    .prepare("SELECT path, name, mtime FROM files WHERE mtime < ? ORDER BY mtime ASC LIMIT ?")
    .all(staleCutoff, perKind) as Array<{ path: string; name: string; mtime: number }>;
  for (const r of staleRows) {
    items.push({ kind: "stale", id: r.path, name: r.name, detail: `Untouched for ${daysAgo(r.mtime, now)} d.`, action: "archive" });
  }

  // 4. Skills never run (join on runs.skill_slug).
  const ran = new Set(
    (db.prepare("SELECT DISTINCT skill_slug s FROM runs WHERE skill_slug IS NOT NULL").all() as Array<{ s: string }>).map((r) => r.s),
  );
  const neverRun = sources.skills.filter((s) => !ran.has(s.slug));
  counts["skill-never-run"] = neverRun.length;
  for (const s of neverRun.slice(0, perKind)) {
    items.push({ kind: "skill-never-run", id: s.slug, name: s.name, detail: s.enabled === false ? "Never run (disabled)." : "Never run.", action: "open" });
  }

  // 5. Silent routines — the scheduler's verdict when we have it.
  if (sources.silent) {
    counts["silent-routine"] = sources.silent.length;
    for (const r of sources.silent.slice(0, perKind)) {
      const state = r.enabled ? "enabled" : "paused";
      const detail =
        r.reason === "failures"
          ? `${r.failuresInWindow} failed run(s) in the last ${silentRoutineDays} d (${state}).`
          : r.reason === "never_fired"
            ? `Never fired (${state}).`
            : `No successful run in the last ${silentRoutineDays} d${r.lastFiredAt === null ? "" : `, last fired ${daysAgo(r.lastFiredAt, now)} d ago`} (${state}).`;
      items.push({ kind: "silent-routine", id: r.id, name: r.name, detail, action: "archive" });
    }
  } else {
    // Fallback without a scheduler: firings straight from the history table.
    const lastFire = db.prepare(
      "SELECT MAX(fired_at) m FROM routine_history WHERE routine_id = ? AND status IN ('fired','caught_up')",
    );
    const silentCutoff = now - silentRoutineDays * DAY;
    const silent: Array<{ routine: Routine; last: number | null }> = [];
    for (const routine of sources.routines) {
      const last = (lastFire.get(routine.id) as { m: number | null }).m;
      if (last !== null && last >= silentCutoff) continue;
      if (last === null && routine.createdAt >= silentCutoff) continue; // too young to judge
      silent.push({ routine, last });
    }
    counts["silent-routine"] = silent.length;
    for (const { routine, last } of silent.slice(0, perKind)) {
      const state = routine.enabled ? "enabled" : "paused";
      const detail =
        last === null
          ? `Never fired (${state}, created ${daysAgo(routine.createdAt, now)} d ago).`
          : `Last fired ${daysAgo(last, now)} d ago (${state}).`;
      items.push({ kind: "silent-routine", id: routine.id, name: routine.name, detail, action: "archive" });
    }
  }

  // 6. Connectors unused for `unusedConnectorDays` (registry `lastUsedAt`).
  const connCutoff = now - unusedConnectorDays * DAY;
  const unused = sources.connectors.filter((c) => c.lastUsedAt === null || c.lastUsedAt < connCutoff);
  counts["unused-connector"] = unused.length;
  for (const c of unused.slice(0, perKind)) {
    const detail = c.lastUsedAt === null ? `Never used (${c.kind}, ${c.status}).` : `Last used ${daysAgo(c.lastUsedAt, now)} d ago (${c.kind}).`;
    items.push({ kind: "unused-connector", id: c.id, name: c.name, detail, action: "disconnect" });
  }

  return { generatedAt: now, counts, items, thresholds: { staleDays, silentRoutineDays, unusedConnectorDays } };
}
