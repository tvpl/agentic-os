import crypto from "node:crypto";
import path from "node:path";
import {
  DASHBOARD_ID,
  DASHBOARD_MAX_BYTES,
  DashboardSnapshotSchema,
  DashboardSpecSchema,
  serializeDashboard,
  type DashboardSnapshot,
  type DashboardSpec,
} from "@mordomo/contracts";
import type { Settings } from "../config/schema.js";
import type { Db } from "../db/db.js";
import { EditConflictError } from "../errors.js";
import type { MordomoPaths } from "../paths.js";
import { homeReadScope, listWorkspaceDir, readWorkspaceFile, type ReadScope } from "../security/safeFs.js";
import { moveWorkspaceFile, writeWorkspaceFile } from "../security/safeWrite.js";

/**
 * Where a dashboard lives (doors 1 and 4 of .specs/features/cerebro-paineis): its definition is the file
 * `memory/dashboards/<id>.json`, written by the guarded writer and versioned by the `sha256:` of its bytes as a note is
 * (AD-031); its last snapshot is one row of `dashboard_snapshots`, and its KPIs keep one point per local hour in
 * `dashboard_series` for 90 days. Every file is read and written through the safe primitives.
 */

/** `404 dashboard_not_found`: no file of that id, or one door 1 refuses (amendment 11). */
export class DashboardNotFoundError extends Error {
  readonly statusCode = 404;
  readonly code = "dashboard_not_found";
  constructor(id: string) {
    super(`No dashboard is called ${id}.`);
    this.name = "DashboardNotFoundError";
  }
}

/** `409 dashboard_exists`: the derived id and its `-2` to `-99` are all taken (AC 4). */
export class DashboardExistsError extends Error {
  readonly statusCode = 409;
  readonly code = "dashboard_exists";
  constructor(base: string) {
    super(`${base} and ${base}-2 to ${base}-99 are all taken.`);
    this.name = "DashboardExistsError";
  }
}

/** `409 refresh_in_progress`: one refresh of a dashboard at a time (AC 9). */
export class RefreshInProgressError extends Error {
  readonly statusCode = 409;
  readonly code = "refresh_in_progress";
  constructor(id: string) {
    super(`A refresh of ${id} is running.`);
    this.name = "RefreshInProgressError";
  }
}

/** `409 skill_unavailable`: the skill of a question dashboard is missing, disabled or not a memory skill. */
export class DashboardSkillUnavailableError extends Error {
  readonly statusCode = 409;
  readonly code = "skill_unavailable";
  constructor() {
    super("The dashboard-answer skill is not available.");
    this.name = "DashboardSkillUnavailableError";
  }
}

const dashboardNotFound = (id: string) => new DashboardNotFoundError(id);

export interface StoredDashboard {
  id: string;
  definition: DashboardSpec;
  version: string;
}

export interface DashboardProblem {
  id: string;
  message: string;
}

export const SERIES_RETENTION_MS = 90 * 86_400_000;
/** The archive of a dashboard (amendment 21): not a cleanup archive, which C5 keeps under `memory/archive/<day>-<id>/`. */
const ARCHIVE = ["archive", "dashboards"];

const versionOf = (bytes: Uint8Array): string =>
  `sha256:${crypto.createHash("sha256").update(bytes).digest("hex")}`;

/** The local start of the hour of `now` (amendment 14: in a half-hour zone it is not the UTC hour). */
export function localHourStart(now: number): number {
  const d = new Date(now);
  d.setMinutes(0, 0, 0);
  return d.getTime();
}

export class DashboardStore {
  constructor(
    private readonly db: Db,
    private readonly paths: MordomoPaths,
    private readonly settings: () => Settings,
  ) {}

  get dir(): string {
    return path.join(this.paths.memory, "dashboards");
  }

  fileOf(id: string): string {
    return path.join(this.dir, `${id}.json`);
  }

  private scope(): ReadScope {
    return homeReadScope(this.paths.home, [this.paths.memory], this.settings().excludes);
  }

  /** The definition of `id` and its version; a file door 1 refuses is `problem`, a missing one null. */
  read(id: string): StoredDashboard | { problem: string } | null {
    if (!DASHBOARD_ID.test(id)) return { problem: "The file name is not a dashboard id." };
    let bytes: Buffer;
    try {
      bytes = readWorkspaceFile(this.scope(), this.fileOf(id), {
        maxBytes: DASHBOARD_MAX_BYTES,
        strict: true,
      }).bytes;
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === "ENOENT") return null;
      return { problem: err instanceof Error ? err.message : String(err) };
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(bytes.toString("utf8"));
    } catch (err) {
      return { problem: `Not JSON: ${err instanceof Error ? err.message : String(err)}` };
    }
    const result = DashboardSpecSchema.safeParse(parsed);
    if (!result.success) {
      return {
        problem: result.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`).join("; "),
      };
    }
    return { id, definition: result.data, version: versionOf(bytes) };
  }

  /** The dashboard `id`, or `404 dashboard_not_found` (a file door 1 refuses is not a dashboard, amendment 11). */
  require(id: string): StoredDashboard {
    const found = this.read(id);
    if (found === null || "problem" in found) throw dashboardNotFound(id);
    return found;
  }

  /** Every file of `memory/dashboards/`: the dashboards, and the files that are not one. */
  list(): { dashboards: StoredDashboard[]; problems: DashboardProblem[] } {
    let entries;
    try {
      entries = listWorkspaceDir(this.scope(), this.dir);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return { dashboards: [], problems: [] };
      throw err;
    }
    const dashboards: StoredDashboard[] = [];
    const problems: DashboardProblem[] = [];
    for (const entry of entries
      .filter((e) => e.isFile && e.name.endsWith(".json"))
      .sort((a, b) => (a.name < b.name ? -1 : 1))) {
      const id = entry.name.slice(0, -".json".length);
      const found = this.read(id);
      if (found === null) continue;
      if ("problem" in found) problems.push({ id, message: found.problem });
      else dashboards.push(found);
    }
    return { dashboards, problems };
  }

  /** Write a new dashboard under the first free id of `base`, `base-2` ... `base-99` (AC 4). */
  create(base: string, definition: DashboardSpec): StoredDashboard {
    const text = serializeDashboard(definition);
    for (let n = 1; n <= 99; n++) {
      const id = n === 1 ? base : `${base}-${n}`;
      try {
        writeWorkspaceFile(this.scope(), this.fileOf(id), text, { mode: "create" });
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === "EEXIST") continue;
        throw err;
      }
      return { id, definition, version: versionOf(Buffer.from(text, "utf8")) };
    }
    throw new DashboardExistsError(base);
  }

  /** Replace the definition, only over the bytes the caller read (AC 6). */
  update(id: string, definition: DashboardSpec, baseVersion: string): StoredDashboard {
    this.require(id);
    const text = serializeDashboard(definition);
    const expected = /^sha256:([0-9a-f]{64})$/.exec(baseVersion)![1]!;
    try {
      writeWorkspaceFile(this.scope(), this.fileOf(id), text, { mode: "replace", expectSha256: expected });
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") throw dashboardNotFound(id);
      if (err instanceof EditConflictError) throw err;
      throw err;
    }
    return { id, definition, version: versionOf(Buffer.from(text, "utf8")) };
  }

  /**
   * Move the file to `memory/archive/dashboards/<id>-<day>.json` (`-2` and on when that is taken the same day,
   * amendment 21) and delete its snapshot and its series. Answers the archived path.
   */
  archive(id: string, day: string): string {
    this.require(id);
    const dir = path.join(this.paths.memory, ...ARCHIVE);
    for (let n = 1; ; n++) {
      const to = path.join(dir, `${id}-${day}${n === 1 ? "" : `-${n}`}.json`);
      try {
        const moved = moveWorkspaceFile(this.scope(), this.fileOf(id), to);
        this.db.transaction(() => {
          this.db.prepare("DELETE FROM dashboard_snapshots WHERE dashboard_id = ?").run(id);
          this.db.prepare("DELETE FROM dashboard_series WHERE dashboard_id = ?").run(id);
        })();
        return moved.to;
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === "EEXIST") continue;
        if ((err as NodeJS.ErrnoException).code === "ENOENT") throw dashboardNotFound(id);
        throw err;
      }
    }
  }

  // ---- door 4 ------------------------------------------------------------------------------------------------------

  snapshot(id: string): DashboardSnapshot | null {
    const row = this.db.prepare("SELECT json FROM dashboard_snapshots WHERE dashboard_id = ?").get(id) as
      { json: string } | undefined;
    if (!row) return null;
    const parsed = DashboardSnapshotSchema.safeParse(JSON.parse(row.json));
    return parsed.success ? (parsed.data as DashboardSnapshot) : null;
  }

  /** The last snapshot replaces the one before (a dashboard keeps at most one). */
  saveSnapshot(snapshot: DashboardSnapshot): void {
    this.db
      .prepare(
        "INSERT INTO dashboard_snapshots (dashboard_id, generated_at, json) VALUES (?, ?, ?) ON CONFLICT(dashboard_id) DO UPDATE SET generated_at = excluded.generated_at, json = excluded.json",
      )
      .run(snapshot.dashboardId, snapshot.generatedAt, JSON.stringify(snapshot));
  }

  /** One point per KPI per local hour, replacing the point of the same hour; points past 90 days go. */
  savePoints(id: string, points: ReadonlyArray<{ widgetId: string; value: number }>, now: number): void {
    const at = localHourStart(now);
    this.db.transaction(() => {
      const put = this.db.prepare(
        "INSERT INTO dashboard_series (dashboard_id, widget_id, at, value) VALUES (?, ?, ?, ?) ON CONFLICT(dashboard_id, widget_id, at) DO UPDATE SET value = excluded.value",
      );
      for (const p of points) put.run(id, p.widgetId, at, p.value);
      this.db
        .prepare("DELETE FROM dashboard_series WHERE dashboard_id = ? AND at < ?")
        .run(id, now - SERIES_RETENTION_MS);
    })();
  }

  /** The stored points of a KPI, oldest first. */
  points(id: string, widgetId: string): Array<{ at: number; value: number }> {
    return this.db
      .prepare(
        "SELECT at, value FROM dashboard_series WHERE dashboard_id = ? AND widget_id = ? ORDER BY at ASC",
      )
      .all(id, widgetId) as Array<{ at: number; value: number }>;
  }
}
