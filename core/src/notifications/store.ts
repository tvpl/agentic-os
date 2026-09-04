import crypto from "node:crypto";
import type { Db } from "../db/db.js";
import { redactSecrets } from "../security/redact.js";
import { events } from "../events.js";

/**
 * Persisted inbox (Onda 2, item 3).
 *
 * The Command Centre used to keep its notification feed in `localStorage`, so
 * a closed tab lost every approval request and every failed run. This store is
 * the server-side half: the recorder (`installNotificationRecorder`) turns bus
 * events into rows, the UI seeds itself from `GET /api/notifications` and stays
 * current over SSE.
 *
 * The store is pure SQLite plus one bus announcement (`notification.created`).
 * It never spawns anything and never reads credentials; titles and bodies go
 * through the secret redactor because they quote prompts and approval
 * descriptions.
 */

export type NotificationKind = "approval" | "run" | "routine" | "index" | "system";
export type NotificationTone = "ok" | "warn" | "danger" | "info";

export const NOTIFICATION_KINDS: readonly NotificationKind[] = [
  "approval",
  "run",
  "routine",
  "index",
  "system",
];

export interface NotificationRecord {
  /** `n_<uuid>` — the prefix is what tells the UI a row came from the server. */
  id: string;
  kind: NotificationKind;
  tone: NotificationTone | null;
  title: string;
  body: string | null;
  href: string | null;
  approvalId: string | null;
  runId: string | null;
  ts: number;
  read: boolean;
  /** Rows sharing a key within `DEDUPE_MS` replace each other. */
  dedupeKey: string | null;
}

export interface NotificationInput {
  kind: NotificationKind;
  tone?: NotificationTone | null;
  title: string;
  body?: string | null;
  href?: string | null;
  approvalId?: string | null;
  runId?: string | null;
  /** Defaults to now. */
  ts?: number;
  /** Informational rows (index finished, resolved approvals) start read. */
  read?: boolean;
  dedupeKey?: string | null;
}

/** Same window the Command Centre reducer uses, so both sides agree. */
export const DEDUPE_MS = 3_000;
export const DEFAULT_LIST_LIMIT = 200;
export const DEFAULT_KEEP = 500;

const TITLE_MAX = 160;
const BODY_MAX = 500;

export class NotificationStore {
  constructor(private readonly db: Db) {}

  /**
   * Append a row and announce it. When `dedupeKey` is set, a row with the same
   * key written less than `DEDUPE_MS` ago is replaced (not stacked) — the same
   * rule the UI applies to live events.
   */
  add(input: NotificationInput): NotificationRecord {
    const ts = input.ts ?? Date.now();
    const dedupeKey = input.dedupeKey ?? null;
    if (dedupeKey) {
      this.db
        .prepare("DELETE FROM notifications WHERE dedupe_key = ? AND ABS(ts - ?) <= ?")
        .run(dedupeKey, ts, DEDUPE_MS);
    }
    const id = `n_${crypto.randomUUID()}`;
    this.db
      .prepare(
        `INSERT INTO notifications (id, kind, tone, title, body, href, approval_id, run_id, ts, read, dedupe_key)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        input.kind,
        input.tone ?? null,
        clamp(input.title, TITLE_MAX) ?? "",
        clamp(input.body, BODY_MAX),
        input.href ?? null,
        input.approvalId ?? null,
        input.runId ?? null,
        ts,
        input.read ? 1 : 0,
        dedupeKey,
      );
    const record = this.get(id);
    if (!record) throw new Error("notification insert failed");
    events.emit("notification.created", record);
    return record;
  }

  get(id: string): NotificationRecord | null {
    const row = this.db.prepare("SELECT * FROM notifications WHERE id = ?").get(id) as RawRow | undefined;
    return row ? fromRow(row) : null;
  }

  /** Newest first. `unreadOnly` is what the bell badge polls with. */
  list(opts: { limit?: number; unreadOnly?: boolean } = {}): NotificationRecord[] {
    const where = opts.unreadOnly ? "WHERE read = 0" : "";
    const rows = this.db
      .prepare(`SELECT * FROM notifications ${where} ORDER BY ts DESC, rowid DESC LIMIT ?`)
      .all(Math.max(1, opts.limit ?? DEFAULT_LIST_LIMIT)) as RawRow[];
    return rows.map(fromRow);
  }

  /** Mark the given ids read; returns how many rows actually changed. */
  markRead(ids: readonly string[]): number {
    if (ids.length === 0) return 0;
    const stmt = this.db.prepare("UPDATE notifications SET read = 1 WHERE id = ? AND read = 0");
    const tx = this.db.transaction((list: readonly string[]) => {
      let updated = 0;
      for (const id of list) updated += stmt.run(id).changes;
      return updated;
    });
    return tx(ids) as number;
  }

  markAllRead(): number {
    return this.db.prepare("UPDATE notifications SET read = 1 WHERE read = 0").run().changes;
  }

  unreadCount(): number {
    return (this.db.prepare("SELECT COUNT(*) c FROM notifications WHERE read = 0").get() as { c: number }).c;
  }

  /** True when a row with this dedupe key exists (optionally since `since`). */
  hasDedupeKey(key: string, since?: number): boolean {
    const row = this.db
      .prepare("SELECT 1 x FROM notifications WHERE dedupe_key = ? AND ts >= ? LIMIT 1")
      .get(key, since ?? 0) as { x: number } | undefined;
    return row !== undefined;
  }

  delete(id: string): boolean {
    return this.db.prepare("DELETE FROM notifications WHERE id = ?").run(id).changes > 0;
  }

  /** Keep the newest `keep` rows; returns how many were dropped. */
  prune(keep = DEFAULT_KEEP): number {
    return this.db
      .prepare(
        `DELETE FROM notifications WHERE id NOT IN (
           SELECT id FROM notifications ORDER BY ts DESC, rowid DESC LIMIT ?
         )`,
      )
      .run(Math.max(0, keep)).changes;
  }

  count(): number {
    return (this.db.prepare("SELECT COUNT(*) c FROM notifications").get() as { c: number }).c;
  }
}

/** Single line, redacted, bounded — titles and bodies quote user text. */
function clamp(raw: string | null | undefined, max: number): string | null {
  if (raw == null) return null;
  const text = redactSecrets(raw).replace(/\s+/g, " ").trim();
  if (!text) return null;
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

interface RawRow {
  id: string;
  kind: string;
  tone: string | null;
  title: string;
  body: string | null;
  href: string | null;
  approval_id: string | null;
  run_id: string | null;
  ts: number;
  read: number;
  dedupe_key: string | null;
}

function fromRow(row: RawRow): NotificationRecord {
  return {
    id: row.id,
    kind: row.kind as NotificationKind,
    tone: (row.tone as NotificationTone | null) ?? null,
    title: row.title,
    body: row.body,
    href: row.href,
    approvalId: row.approval_id,
    runId: row.run_id,
    ts: row.ts,
    read: row.read !== 0,
    dedupeKey: row.dedupe_key,
  };
}
