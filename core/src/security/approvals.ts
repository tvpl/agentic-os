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
}

export class ApprovalStore {
  constructor(private readonly db: Db) {}

  request(kind: ApprovalKind, description: string, payload: Record<string, unknown> = {}): Approval {
    const approval: Approval = {
      id: crypto.randomUUID(),
      createdAt: Date.now(),
      kind,
      description,
      payload,
      status: "pending",
      resolvedAt: null,
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
    return (rows as RawRow[]).map(fromRow);
  }

  get(id: string): Approval | null {
    const row = this.db.prepare("SELECT * FROM approvals WHERE id = ?").get(id) as RawRow | undefined;
    return row ? fromRow(row) : null;
  }

  resolve(id: string, decision: "approved" | "denied"): Approval | null {
    this.db
      .prepare("UPDATE approvals SET status = ?, resolved_at = ? WHERE id = ? AND status = 'pending'")
      .run(decision, Date.now(), id);
    return this.get(id);
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

function fromRow(row: RawRow): Approval {
  return {
    id: row.id,
    createdAt: row.created_at,
    kind: row.kind as ApprovalKind,
    description: row.description,
    payload: JSON.parse(row.payload) as Record<string, unknown>,
    status: row.status as Approval["status"],
    resolvedAt: row.resolved_at,
  };
}
