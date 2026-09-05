import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { Db } from "../db/db.js";
import type { PushSubscriptionJson, VapidKeys } from "../channels/webpush.js";
import { generateVapidKeys } from "../channels/webpush.js";

export interface PushSubscriptionRecord {
  id: string;
  endpoint: string;
  label: string | null;
  createdAt: number;
  lastOkAt: number | null;
  failures: number;
}

/** Subscriptions in SQLite; the VAPID pair in `config/vapid.json` (0600), created on first read. */
export class PushStore {
  private keys: VapidKeys | null = null;

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

  upsert(sub: PushSubscriptionJson, label: string | null = null): PushSubscriptionRecord {
    const existing = this.db
      .prepare("SELECT id FROM push_subscriptions WHERE endpoint = ?")
      .get(sub.endpoint) as { id: string } | undefined;
    const id = existing?.id ?? `ps_${crypto.randomUUID()}`;
    if (existing) {
      this.db
        .prepare(
          "UPDATE push_subscriptions SET p256dh = ?, auth = ?, label = COALESCE(?, label), failures = 0 WHERE id = ?",
        )
        .run(sub.keys.p256dh, sub.keys.auth, label, id);
    } else {
      this.db
        .prepare(
          "INSERT INTO push_subscriptions (id, endpoint, p256dh, auth, label, created_at, last_ok_at, failures) VALUES (?, ?, ?, ?, ?, ?, NULL, 0)",
        )
        .run(id, sub.endpoint, sub.keys.p256dh, sub.keys.auth, label, Date.now());
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

  /** Full subscriptions (with keys) for delivery only. */
  targets(): Array<{ id: string; sub: PushSubscriptionJson }> {
    return (
      this.db.prepare("SELECT id, endpoint, p256dh, auth FROM push_subscriptions").all() as Array<{
        id: string;
        endpoint: string;
        p256dh: string;
        auth: string;
      }>
    ).map((r) => ({ id: r.id, sub: { endpoint: r.endpoint, keys: { p256dh: r.p256dh, auth: r.auth } } }));
  }

  removeByEndpoint(endpoint: string): boolean {
    return this.db.prepare("DELETE FROM push_subscriptions WHERE endpoint = ?").run(endpoint).changes > 0;
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
    label: (r.label as string | null) ?? null,
    createdAt: Number(r.created_at),
    lastOkAt: r.last_ok_at == null ? null : Number(r.last_ok_at),
    failures: Number(r.failures ?? 0),
  };
}
