import crypto from "node:crypto";
import type { Db } from "../db/db.js";
import type { Approval, ApprovalKind } from "@mordomo/contracts";

export type { Approval };

/**
 * An approval whose request the person must read whole before approving, because a paired device chose it: a write run
 * a device asked for, and a tool a run that a device started asks to use (the tool's input is what the agent was led
 * to ask, and a one-line label cuts it). A chat message or a row of the inbox carries only a label, so such an approval
 * is denied from there but approved where the whole request is shown (Settings › Security, the Resolver).
 */
export function requiresFullReview(approval: Pick<Approval, "kind" | "requestedBy">): boolean {
  return (
    (approval.kind === "write_run" || approval.kind === "tool_use") &&
    typeof approval.requestedBy === "string" &&
    approval.requestedBy.startsWith("device:")
  );
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

  /** `requestedBy` is who asked (`Approval.requestedBy`): the principal's name, or null when no request caused it. */
  request(
    kind: ApprovalKind,
    description: string,
    payload: Record<string, unknown> = {},
    requestedBy: string | null = null,
  ): Approval {
    const createdAt = Date.now();
    const approval: Approval = {
      id: crypto.randomUUID(),
      createdAt,
      kind,
      description,
      payload,
      status: "pending",
      resolvedAt: null,
      resolvedBy: null,
      requestedBy,
      expiresAt: createdAt + this.ttlMs(),
    };
    this.db
      .prepare(
        "INSERT INTO approvals (id, created_at, kind, description, payload, status, requested_by) VALUES (?, ?, ?, ?, ?, 'pending', ?)",
      )
      .run(approval.id, approval.createdAt, kind, description, JSON.stringify(payload), requestedBy);
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
        "UPDATE approvals SET status = 'expired', resolved_at = ?, resolved_by = 'system' WHERE status = 'pending' AND created_at < ?",
      )
      .run(now, cutoff);
    return stale.map((a) => ({ ...a, status: "expired" as const, resolvedAt: now, resolvedBy: "system" }));
  }

  /**
   * Apply a decision. Throws when the approval is already resolved or expired
   * so the caller can answer with a clear error instead of a silent no-op.
   */
  resolve(
    id: string,
    decision: "approved" | "denied",
    /** Merged into the payload with the decision — e.g. the answers to a question the agent asked. */
    patch?: Record<string, unknown>,
    /** Who decided (`Approval.resolvedBy`). */
    resolvedBy: string | null = null,
  ): Approval | null {
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
    if (patch && Object.keys(patch).length > 0) {
      this.db
        .prepare(
          "UPDATE approvals SET status = ?, resolved_at = ?, resolved_by = ?, payload = ? WHERE id = ? AND status = 'pending'",
        )
        .run(decision, Date.now(), resolvedBy, JSON.stringify({ ...current.payload, ...patch }), id);
    } else {
      this.db
        .prepare(
          "UPDATE approvals SET status = ?, resolved_at = ?, resolved_by = ? WHERE id = ? AND status = 'pending'",
        )
        .run(decision, Date.now(), resolvedBy, id);
    }
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
      resolvedBy: row.resolved_by ?? null,
      requestedBy: row.requested_by ?? null,
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
  resolved_by?: string | null;
  requested_by?: string | null;
}
