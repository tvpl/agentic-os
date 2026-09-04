/**
 * Paired devices (plan Onda 3 §1): remote access without sharing the local
 * token. A pairing code shown on the desktop (six digits, ten minutes, five
 * attempts) is exchanged once for a per-device bearer token; only its SHA-256
 * is stored, so a leaked database reveals nothing usable. Tokens can expire
 * and be revoked; the last use is recorded coarsely (once a minute).
 */
import crypto from "node:crypto";
import type { Db } from "../db/db.js";

export interface DeviceRecord {
  id: string;
  name: string;
  createdAt: number;
  lastSeenAt: number | null;
  expiresAt: number | null;
  revokedAt: number | null;
}

export interface PairingCode {
  code: string;
  expiresAt: number;
}

interface PendingCode {
  expiresAt: number;
  attempts: number;
  /** Optional name suggested by the desktop side (the device may override it). */
  name: string | null;
}

export const PAIRING_TTL_MS = 10 * 60_000;
export const PAIRING_MAX_ATTEMPTS = 5;
export const DEFAULT_DEVICE_TTL_MS = 90 * 86_400_000;
const LAST_SEEN_GRANULARITY_MS = 60_000;

export function hashToken(token: string): string {
  return crypto.createHash("sha256").update(token, "utf8").digest("hex");
}

export class DeviceStore {
  private readonly pending = new Map<string, PendingCode>();

  constructor(
    private readonly db: Db,
    private readonly now: () => number = Date.now,
  ) {}

  /** Mint a pairing code. A new code replaces any older pending one. */
  startPairing(name: string | null = null): PairingCode {
    this.sweepCodes();
    const code = String(crypto.randomInt(0, 1_000_000)).padStart(6, "0");
    const expiresAt = this.now() + PAIRING_TTL_MS;
    this.pending.clear();
    this.pending.set(code, { expiresAt, attempts: 0, name });
    return { code, expiresAt };
  }

  /** Whether a pairing is currently open (never reveals the code). */
  pairingOpen(): PairingCode | null {
    this.sweepCodes();
    const [code, p] = [...this.pending.entries()][0] ?? [];
    return code && p ? { code, expiresAt: p.expiresAt } : null;
  }

  /**
   * Exchange a code for a device token. Wrong codes burn one attempt on every
   * pending code (there is at most one); after the limit the code is dropped.
   * Returns null on any failure — the caller answers a generic 401.
   */
  claim(
    code: string,
    name: string,
    ttlMs = DEFAULT_DEVICE_TTL_MS,
  ): { device: DeviceRecord; token: string } | null {
    this.sweepCodes();
    const entry = this.pending.get(code);
    if (!entry) {
      for (const [k, p] of this.pending) {
        p.attempts += 1;
        if (p.attempts >= PAIRING_MAX_ATTEMPTS) this.pending.delete(k);
      }
      return null;
    }
    this.pending.delete(code);
    const token = crypto.randomBytes(32).toString("base64url");
    const id = crypto.randomUUID();
    const createdAt = this.now();
    const label = (name.trim() || entry.name || "device").slice(0, 80);
    this.db
      .prepare(
        `INSERT INTO devices (id, name, token_hash, created_at, last_seen_at, expires_at, revoked_at)
         VALUES (?, ?, ?, ?, NULL, ?, NULL)`,
      )
      .run(id, label, hashToken(token), createdAt, ttlMs > 0 ? createdAt + ttlMs : null);
    return { device: this.get(id)!, token };
  }

  /** The device a bearer token belongs to, or null when unknown, revoked or expired. */
  verify(token: string): DeviceRecord | null {
    if (!token) return null;
    const row = this.db.prepare("SELECT * FROM devices WHERE token_hash = ?").get(hashToken(token)) as
      RawDevice | undefined;
    if (!row) return null;
    const device = fromRow(row);
    const now = this.now();
    if (device.revokedAt !== null) return null;
    if (device.expiresAt !== null && device.expiresAt <= now) return null;
    if (device.lastSeenAt === null || now - device.lastSeenAt >= LAST_SEEN_GRANULARITY_MS) {
      this.db.prepare("UPDATE devices SET last_seen_at = ? WHERE id = ?").run(now, device.id);
      device.lastSeenAt = now;
    }
    return device;
  }

  get(id: string): DeviceRecord | null {
    const row = this.db.prepare("SELECT * FROM devices WHERE id = ?").get(id) as RawDevice | undefined;
    return row ? fromRow(row) : null;
  }

  list(): DeviceRecord[] {
    const rows = this.db.prepare("SELECT * FROM devices ORDER BY created_at DESC").all() as RawDevice[];
    return rows.map(fromRow);
  }

  revoke(id: string): boolean {
    const res = this.db
      .prepare("UPDATE devices SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL")
      .run(this.now(), id);
    return res.changes > 0;
  }

  private sweepCodes(): void {
    const now = this.now();
    for (const [k, p] of this.pending) if (p.expiresAt <= now) this.pending.delete(k);
  }
}

interface RawDevice {
  id: string;
  name: string;
  token_hash: string;
  created_at: number;
  last_seen_at: number | null;
  expires_at: number | null;
  revoked_at: number | null;
}

function fromRow(r: RawDevice): DeviceRecord {
  return {
    id: r.id,
    name: r.name,
    createdAt: r.created_at,
    lastSeenAt: r.last_seen_at,
    expiresAt: r.expires_at,
    revokedAt: r.revoked_at,
  };
}
