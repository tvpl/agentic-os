import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { Db } from "../db/db.js";
import type { PushSubscriptionJson, VapidKeys } from "../channels/webpush.js";
import { generateVapidKeys } from "../channels/webpush.js";

export interface PushSubscriptionRecord {
  id: string;
  endpoint: string;
  /** The paired device that registered it; null for the owner's (and for what was subscribed before devices could). */
  deviceId: string | null;
  label: string | null;
  createdAt: number;
  lastOkAt: number | null;
  failures: number;
}

/** Subscriptions in SQLite; the VAPID pair in `config/vapid.json` (0600), created on first read. */
export class PushStore {
  private keys: VapidKeys | null = null;
  /** Whether a paired device's subscriptions still count (the device lives and may read content); set by the engine. */
  private deviceGate: (deviceId: string) => boolean = () => true;

  setDeviceGate(gate: (deviceId: string) => boolean): void {
    this.deviceGate = gate;
  }

  constructor(
    private readonly db: Db,
    private readonly configDir: string,
  ) {}

  vapidKeys(): VapidKeys {
    if (this.keys) return this.keys;
    const file = path.join(this.configDir, "vapid.json");
    if (fs.existsSync(file)) {
      const parsed = JSON.parse(fs.readFileSync(file, "utf8")) as Partial<VapidKeys>;
      if (parsed.publicKey && parsed.privateKey) {
        this.keys = { publicKey: parsed.publicKey, privateKey: parsed.privateKey };
        return this.keys;
      }
    }
    const keys = generateVapidKeys();
    fs.mkdirSync(this.configDir, { recursive: true });
    fs.writeFileSync(file, JSON.stringify(keys, null, 2), { mode: 0o600 });
    this.keys = keys;
    return keys;
  }

  /** The device that registered the subscription at `endpoint`: undefined when there is none, null for the owner's. */
  ownerOf(endpoint: string): string | null | undefined {
    const row = this.db
      .prepare("SELECT device_id FROM push_subscriptions WHERE endpoint = ?")
      .get(endpoint) as { device_id: string | null } | undefined;
    return row ? row.device_id : undefined;
  }

  upsert(
    sub: PushSubscriptionJson,
    label: string | null = null,
    deviceId: string | null = null,
  ): PushSubscriptionRecord {
    const existing = this.db
      .prepare("SELECT id FROM push_subscriptions WHERE endpoint = ?")
      .get(sub.endpoint) as { id: string } | undefined;
    const id = existing?.id ?? `ps_${crypto.randomUUID()}`;
    if (existing) {
      this.db
        .prepare(
          "UPDATE push_subscriptions SET p256dh = ?, auth = ?, label = COALESCE(?, label), failures = 0, device_id = ? WHERE id = ?",
        )
        .run(sub.keys.p256dh, sub.keys.auth, label, deviceId, id);
    } else {
      this.db
        .prepare(
          "INSERT INTO push_subscriptions (id, endpoint, p256dh, auth, label, created_at, last_ok_at, failures, device_id) VALUES (?, ?, ?, ?, ?, ?, NULL, 0, ?)",
        )
        .run(id, sub.endpoint, sub.keys.p256dh, sub.keys.auth, label, Date.now(), deviceId);
    }
    return this.get(id)!;
  }

  get(id: string): PushSubscriptionRecord | null {
    const row = this.db.prepare("SELECT * FROM push_subscriptions WHERE id = ?").get(id) as
      Record<string, unknown> | undefined;
    return row ? fromRow(row) : null;
  }

  list(): PushSubscriptionRecord[] {
    return (
      this.db.prepare("SELECT * FROM push_subscriptions ORDER BY created_at DESC").all() as Array<
        Record<string, unknown>
      >
    ).map(fromRow);
  }

  /**
   * Full subscriptions (with keys) for delivery only. One that a paired device registered and that device no longer
   * counts for (revoked, expired, or without `content`) is deleted here instead of delivered to.
   */
  targets(): Array<{ id: string; sub: PushSubscriptionJson }> {
    const rows = this.db
      .prepare("SELECT id, endpoint, p256dh, auth, device_id FROM push_subscriptions")
      .all() as Array<{
      id: string;
      endpoint: string;
      p256dh: string;
      auth: string;
      device_id: string | null;
    }>;
    const live: typeof rows = [];
    for (const r of rows) {
      if (r.device_id !== null && !this.deviceGate(r.device_id)) this.remove(r.id);
      else live.push(r);
    }
    return live.map((r) => ({
      id: r.id,
      sub: { endpoint: r.endpoint, keys: { p256dh: r.p256dh, auth: r.auth } },
    }));
  }

  /** Remove by endpoint; with `deviceId`, only a subscription that device registered itself. */
  removeByEndpoint(endpoint: string, deviceId?: string): boolean {
    return deviceId === undefined
      ? this.db.prepare("DELETE FROM push_subscriptions WHERE endpoint = ?").run(endpoint).changes > 0
      : this.db
          .prepare("DELETE FROM push_subscriptions WHERE endpoint = ? AND device_id = ?")
          .run(endpoint, deviceId).changes > 0;
  }

  /** Everything a paired device registered (it was revoked, or lost the permission to read content). */
  removeForDevice(deviceId: string): number {
    return this.db.prepare("DELETE FROM push_subscriptions WHERE device_id = ?").run(deviceId).changes;
  }

  remove(id: string): boolean {
    return this.db.prepare("DELETE FROM push_subscriptions WHERE id = ?").run(id).changes > 0;
  }

  markOk(id: string): void {
    this.db
      .prepare("UPDATE push_subscriptions SET last_ok_at = ?, failures = 0 WHERE id = ?")
      .run(Date.now(), id);
  }

  /** Count a failure; after `maxFailures` in a row the subscription is dropped. */
  markFailure(id: string, maxFailures = 8): boolean {
    this.db.prepare("UPDATE push_subscriptions SET failures = failures + 1 WHERE id = ?").run(id);
    const row = this.get(id);
    if (row && row.failures >= maxFailures) {
      this.remove(id);
      return true;
    }
    return false;
  }
}

function fromRow(r: Record<string, unknown>): PushSubscriptionRecord {
  return {
    id: String(r.id),
    endpoint: String(r.endpoint),
    deviceId: (r.device_id as string | null) ?? null,
    label: (r.label as string | null) ?? null,
    createdAt: Number(r.created_at),
    lastOkAt: r.last_ok_at == null ? null : Number(r.last_ok_at),
    failures: Number(r.failures ?? 0),
  };
}
