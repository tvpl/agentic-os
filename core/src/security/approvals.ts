import crypto from "node:crypto";
import type { Db } from "../db/db.js";
import type { ApprovalKind } from "./profiles.js";

export interface Approval {
  id: string;
  createdAt: number;
  kind: ApprovalKind;
  description: string;
  payload: Record<string, unknown>;
  status: "pending" | "approved" | "denied" | "expired";
  resolvedAt: number | null;
  /** When a still-pending approval is swept to `expired` (createdAt + TTL). */
  expiresAt: number;
}

/** Default lifetime of a pending approval (settings.limits.approvalTtlDays). */
export const DEFAULT_APPROVAL_TTL_MS = 7 * 86_400_000;

export class ApprovalStore {
  /**
   * `getTtlMs` is read on every call so a settings change takes effect without
   * rebuilding the store.
   */
  constructor(
    private readonly db: Db,
    private readonly getTtlMs: () => number = () => DEFAULT_APPROVAL_TTL_MS,
  ) {}

  /** Current TTL, guarded against a bad/unreadable settings value. */
  private ttlMs(): number {
    try {
      const ttl = this.getTtlMs();
      return Number.isFinite(ttl) && ttl > 0 ? ttl : DEFAULT_APPROVAL_TTL_MS;
    } catch {
      return DEFAULT_APPROVAL_TTL_MS;
    }
  }

  request(kind: ApprovalKind, description: string, payload: Record<string, unknown> = {}): Approval {
    const createdAt = Date.now();
    const approval: Approval = {
      id: crypto.randomUUID(),
      createdAt,
      kind,
      description,
      payload,
      status: "pending",
      resolvedAt: null,
      expiresAt: createdAt + this.ttlMs(),
    };
    this.db
      .prepare(
        "INSERT INTO approvals (id, created_at, kind, description, payload, status) VALUES (?, ?, ?, ?, ?, 'pending')",
      )
      .run(approval.id, approval.createdAt, kind, description, JSON.stringify(payload));
    return approval;
  }

  list(status?: Approval["status"]): Approval[] {
    const rows = status
      ? this.db.prepare("SELECT * FROM approvals WHERE status = ? ORDER BY created_at DESC").all(status)
      : this.db.prepare("SELECT * FROM approvals ORDER BY created_at DESC LIMIT 200").all();
    return (rows as RawRow[]).map((row) => this.fromRow(row));
  }

  get(id: string): Approval | null {
    const row = this.db.prepare("SELECT * FROM approvals WHERE id = ?").get(id) as RawRow | undefined;
    return row ? this.fromRow(row) : null;
  }

  /**
   * Sweep pending approvals past their TTL to `expired`. Called on boot and
   * hourly by the service; returns the approvals it expired so the caller can
   * clean up whatever they were gating (a `waiting_approval` run).
   */
  expireStale(now = Date.now()): Approval[] {
    const cutoff = now - this.ttlMs();
    const stale = (
      this.db
        .prepare("SELECT * FROM approvals WHERE status = 'pending' AND created_at < ?")
        .all(cutoff) as RawRow[]
    ).map((row) => this.fromRow(row));
    if (stale.length === 0) return [];
    this.db
      .prepare(
        "UPDATE approvals SET status = 'expired', resolved_at = ? WHERE status = 'pending' AND created_at < ?",
      )
      .run(now, cutoff);
    return stale.map((a) => ({ ...a, status: "expired" as const, resolvedAt: now }));
  }

  /**
   * Apply a decision. Throws when the approval is already resolved or expired
   * so the caller can answer with a clear error instead of a silent no-op.
   */
  resolve(id: string, decision: "approved" | "denied"): Approval | null {
    const current = this.get(id);
    if (!current) return null;
    if (current.status === "pending" && current.expiresAt <= Date.now()) {
      this.expireStale();
      throw Object.assign(
        new Error(
          `Approval ${id} expired on ${new Date(current.expiresAt).toISOString()} and can no longer be resolved. Request the action again.`,
        ),
        {
          statusCode: 409,
          code: "approval_expired",
        },
      );
    }
    if (current.status !== "pending") {
      throw Object.assign(new Error(`Approval ${id} is already ${current.status}.`), {
        statusCode: 409,
        code: current.status === "expired" ? "approval_expired" : "approval_resolved",
      });
    }
    this.db
      .prepare("UPDATE approvals SET status = ?, resolved_at = ? WHERE id = ? AND status = 'pending'")
      .run(decision, Date.now(), id);
    return this.get(id);
  }

  private fromRow(row: RawRow): Approval {
    return {
      id: row.id,
      createdAt: row.created_at,
      kind: row.kind as ApprovalKind,
      description: row.description,
      payload: JSON.parse(row.payload) as Record<string, unknown>,
      status: row.status as Approval["status"],
      resolvedAt: row.resolved_at,
      expiresAt: row.created_at + this.ttlMs(),
    };
  }
}

interface RawRow {
  id: string;
  created_at: number;
  kind: string;
  description: string;
  payload: string;
  status: string;
  resolved_at: number | null;
}
