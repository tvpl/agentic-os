/**
 * Paired devices (plan Onda 3 §1): remote access without sharing the local
 * token. A pairing code shown on the desktop (six digits, ten minutes, five
 * attempts) is exchanged once for a per-device bearer token; only its SHA-256
 * is stored, so a leaked database reveals nothing usable. Tokens can expire
 * and be revoked; the last use is recorded coarsely (once a minute). Each
 * device holds a closed set of scopes (`@mordomo/contracts`, `DeviceScope`):
 * chosen when the code is shown, changed by the owner later, and read as the
 * default when the row predates scopes.
 */
import crypto from "node:crypto";
import {
  DEFAULT_DEVICE_SCOPES,
  closeDeviceScopes,
  type DeviceRecord,
  type DeviceScope,
} from "@mordomo/contracts";
import type { Db } from "../db/db.js";

export type { DeviceRecord };

export interface PairingCode {
  code: string;
  expiresAt: number;
}

interface PendingCode {
  expiresAt: number;
  attempts: number;
  /** Optional name suggested by the desktop side (the device may override it). */
  name: string | null;
  /** What the device that claims this code will be allowed to do (already closed). */
  scopes: DeviceScope[];
}

export const PAIRING_TTL_MS = 10 * 60_000;
export const PAIRING_MAX_ATTEMPTS = 5;
export const DEFAULT_DEVICE_TTL_MS = 90 * 86_400_000;
const LAST_SEEN_GRANULARITY_MS = 60_000;

export function hashToken(token: string): string {
  return crypto.createHash("sha256").update(token, "utf8").digest("hex");
}

/** What happened to a device that something tied to it must follow (its push subscriptions, for one). */
export type DeviceChange =
  { kind: "revoked"; device: DeviceRecord } | { kind: "scopes"; device: DeviceRecord };

export class DeviceStore {
  private readonly pending = new Map<string, PendingCode>();
  private readonly listeners: Array<(change: DeviceChange) => void> = [];

  constructor(
    private readonly db: Db,
    private readonly now: () => number = Date.now,
  ) {}

  /** Hear of a device revoked or given another set of scopes (synchronously, in the same call). Returns the way out. */
  onChange(listener: (change: DeviceChange) => void): () => void {
    this.listeners.push(listener);
    return () => {
      const i = this.listeners.indexOf(listener);
      if (i >= 0) this.listeners.splice(i, 1);
    };
  }

  /** Mint a pairing code. A new code replaces any older pending one. */
  startPairing(
    name: string | null = null,
    scopes: readonly DeviceScope[] = DEFAULT_DEVICE_SCOPES,
  ): PairingCode & { scopes: DeviceScope[] } {
    this.sweepCodes();
    const code = String(crypto.randomInt(0, 1_000_000)).padStart(6, "0");
    const expiresAt = this.now() + PAIRING_TTL_MS;
    const closed = closeDeviceScopes(scopes);
    this.pending.clear();
    this.pending.set(code, { expiresAt, attempts: 0, name, scopes: closed });
    return { code, expiresAt, scopes: closed };
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
        `INSERT INTO devices (id, name, token_hash, created_at, last_seen_at, expires_at, revoked_at, scopes)
         VALUES (?, ?, ?, ?, NULL, ?, NULL, ?)`,
      )
      .run(
        id,
        label,
        hashToken(token),
        createdAt,
        ttlMs > 0 ? createdAt + ttlMs : null,
        JSON.stringify(entry.scopes),
      );
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

  /** The device when its token still counts (not revoked, not expired), whatever it may do. */
  active(id: string): DeviceRecord | null {
    const device = this.get(id);
    if (!device || device.revokedAt !== null) return null;
    if (device.expiresAt !== null && device.expiresAt <= this.now()) return null;
    return device;
  }

  /** Replace what a device may do. Null when the device is unknown or revoked; the next request is judged by the new set. */
  setScopes(id: string, scopes: readonly DeviceScope[]): DeviceRecord | null {
    const res = this.db
      .prepare("UPDATE devices SET scopes = ? WHERE id = ? AND revoked_at IS NULL")
      .run(JSON.stringify(closeDeviceScopes(scopes)), id);
    const device = res.changes > 0 ? this.get(id) : null;
    if (device) for (const l of this.listeners) l({ kind: "scopes", device });
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
    const device = res.changes > 0 ? this.get(id) : null;
    if (device) for (const l of this.listeners) l({ kind: "revoked", device });
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
  scopes: string | null;
}

/**
 * A stored set of scopes: `NULL` (a device paired before scopes existed) reads as the default; text that is not a
 * JSON list reads as nothing (the safe side), and whatever it holds is closed and cut to the scopes this version knows.
 */
export function readScopes(raw: string | null): DeviceScope[] {
  if (raw === null) return closeDeviceScopes(DEFAULT_DEVICE_SCOPES);
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return closeDeviceScopes(parsed.filter((x): x is string => typeof x === "string"));
  } catch {
    return [];
  }
}

function fromRow(r: RawDevice): DeviceRecord {
  return {
    id: r.id,
    name: r.name,
    createdAt: r.created_at,
    lastSeenAt: r.last_seen_at,
    expiresAt: r.expires_at,
    revokedAt: r.revoked_at,
    scopes: readScopes(r.scopes ?? null),
  };
}
