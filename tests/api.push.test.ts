import { describe, expect, it, beforeAll, afterAll } from "vitest";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { FastifyInstance } from "fastify";
import { b64url, deliverPush, decryptPayload } from "@mordomo/core";
import { AppContext } from "../apps/api/src/context.js";
import { buildServer } from "../apps/api/src/server.js";
import { makeTempHome } from "./helpers.js";

let ctx: AppContext;
let app: FastifyInstance;
let token: string;
let cleanup: () => void;
let home: string;

beforeAll(async () => {
  const tmp = makeTempHome();
  cleanup = tmp.cleanup;
  home = tmp.paths.home;
  ctx = new AppContext(home);
  const settings = ctx.settings();
  settings.setupCompleted = true;
  settings.channels.push.enabled = true;
  ctx.settingsStore.save(settings);
  token = ctx.token();
  app = await buildServer(ctx);
});

afterAll(async () => {
  await app.close();
  ctx.close();
  cleanup();
});

const auth = () => ({ "x-mordomo-token": token });

describe("push API", () => {
  it("hands out a VAPID public key generated once into config/vapid.json (0600)", async () => {
    const res = await app.inject({ method: "GET", url: "/api/push/vapid", headers: auth() });
    expect(res.statusCode).toBe(200);
    const { publicKey } = res.json() as { publicKey: string };
    expect(b64url.decode(publicKey).length).toBe(65);
    const file = path.join(home, "config", "vapid.json");
    expect(fs.existsSync(file)).toBe(true);
    if (process.platform !== "win32") expect(fs.statSync(file).mode & 0o777).toBe(0o600);
    const again = (await app.inject({ method: "GET", url: "/api/push/vapid", headers: auth() })).json() as {
      publicKey: string;
    };
    expect(again.publicKey).toBe(publicKey);
  });

  it("stores a subscription, lists it without keys, delivers an encrypted payload, and drops dead endpoints", async () => {
    const ua = crypto.createECDH("prime256v1");
    ua.generateKeys();
    const authSecret = b64url.encode(crypto.randomBytes(16));
    const subscription = {
      endpoint: "https://push.example.net/sub/abc",
      keys: { p256dh: b64url.encode(ua.getPublicKey()), auth: authSecret },
    };
    const sub = await app.inject({
      method: "POST",
      url: "/api/push/subscribe",
      headers: auth(),
      payload: { subscription, label: "Pixel" },
    });
    expect(sub.statusCode).toBe(200);
    const list = (
      await app.inject({ method: "GET", url: "/api/push/subscriptions", headers: auth() })
    ).json() as Array<Record<string, unknown>>;
    expect(list).toHaveLength(1);
    expect(list[0]!.label).toBe("Pixel");
    expect(list[0]).not.toHaveProperty("p256dh");

    const got: Buffer[] = [];
    const fetchImpl = (async (_url: string | URL | Request, init?: RequestInit) => {
      got.push(init!.body as Buffer);
      return new Response(null, { status: 201 });
    }) as unknown as typeof fetch;
    const r = await deliverPush(
      { getSettings: () => ctx.settings(), store: ctx.push, fetchImpl },
      {
        id: "n_1",
        kind: "approval",
        tone: "warn",
        title: "Approval requested",
        body: "Write: notes.md",
        href: "/runs/1",
        approvalId: "ap-1",
        runId: "1",
        ts: Date.now(),
        read: false,
        dedupeKey: null,
      },
    );
    expect(r).toEqual({ sent: 1, failed: 0, dropped: 0 });
    const plain = JSON.parse(
      decryptPayload(
        got[0]!,
        b64url.encode(ua.getPrivateKey()),
        subscription.keys.p256dh,
        authSecret,
      ).toString("utf8"),
    ) as Record<string, unknown>;
    expect(plain.title).toBe("Approval requested");
    expect(plain.approvalId).toBe("ap-1");

    // Below the tone: skipped. Dead endpoint: dropped.
    const low = await deliverPush(
      { getSettings: () => ctx.settings(), store: ctx.push, fetchImpl },
      {
        id: "n_2",
        kind: "system",
        tone: "info",
        title: "x",
        body: null,
        href: null,
        approvalId: null,
        runId: null,
        ts: Date.now(),
        read: false,
        dedupeKey: null,
      },
    );
    expect(low.skipped).toBe("tone");
    const gone = (async () => new Response(null, { status: 410 })) as unknown as typeof fetch;
    const r2 = await deliverPush(
      { getSettings: () => ctx.settings(), store: ctx.push, fetchImpl: gone },
      {
        id: "n_3",
        kind: "system",
        tone: "danger",
        title: "y",
        body: null,
        href: null,
        approvalId: null,
        runId: null,
        ts: Date.now(),
        read: false,
        dedupeKey: null,
      },
    );
    expect(r2.dropped).toBe(1);
    expect(ctx.push.list()).toHaveLength(0);
  });

  it("validates subscriptions and unsubscribes by endpoint", async () => {
    const bad = await app.inject({
      method: "POST",
      url: "/api/push/subscribe",
      headers: auth(),
      payload: { subscription: { endpoint: "nope", keys: { p256dh: "x", auth: "y" } } },
    });
    expect(bad.statusCode).toBe(400);
    const ua = crypto.createECDH("prime256v1");
    ua.generateKeys();
    const subscription = {
      endpoint: "https://push.example.net/sub/z",
      keys: { p256dh: b64url.encode(ua.getPublicKey()), auth: b64url.encode(crypto.randomBytes(16)) },
    };
    await app.inject({
      method: "POST",
      url: "/api/push/subscribe",
      headers: auth(),
      payload: { subscription },
    });
    const del = await app.inject({
      method: "POST",
      url: "/api/push/unsubscribe",
      headers: auth(),
      payload: { endpoint: subscription.endpoint },
    });
    expect(del.json()).toEqual({ removed: true });
    const status = await app.inject({ method: "GET", url: "/api/channels/telegram/status", headers: auth() });
    expect(status.statusCode).toBe(200);
    expect((status.json() as { inbound: boolean }).inbound).toBe(false);
  });
});
