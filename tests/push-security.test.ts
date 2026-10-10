import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import crypto from "node:crypto";
import http from "node:http";
import type { AddressInfo } from "node:net";
import type { FastifyInstance } from "fastify";
import {
  b64url,
  checkPushEndpoint,
  deliverPush,
  endpointProblem,
  isKnownPushHost,
  isPublicAddress,
  type DeviceScope,
  type HostResolver,
} from "@mordomo/core";
import { AppContext } from "../apps/api/src/context.js";
import { buildServer } from "../apps/api/src/server.js";
import { makeTempHome } from "./helpers.js";

/**
 * Push endpoints (.specs/features/escopos-dispositivo, round 1, C46): a subscription is a URL the server POSTs to with
 * its own VAPID credential, so who may name one, and where it may point, is a security decision. Every refusal here is
 * measured by what reached a listener on 127.0.0.1, not by the status alone.
 */

const FCM = "https://fcm.googleapis.com/fcm/send/abc123";
/** What a host resolves to in these tests; the sandbox's DNS is never asked. */
const dnsTable = new Map<string, string[]>([
  ["fcm.googleapis.com", ["142.250.74.10"]],
  ["push.owner-server.example", ["93.184.216.34"]],
  ["rebinding.example", ["93.184.216.34"]],
  ["internal.example", ["10.0.0.7"]],
  ["mixed.example", ["93.184.216.34", "169.254.169.254"]],
]);
const resolver: HostResolver = async (host) => {
  const found = dnsTable.get(host);
  if (!found) throw new Error("ENOTFOUND");
  return found;
};

let ctx: AppContext;
let app: FastifyInstance;
let cleanup: () => void;
let canary: http.Server;
let canaryPort = 0;
const canaryHits: string[] = [];

beforeAll(async () => {
  const tmp = makeTempHome("mordomo-pushsec-");
  cleanup = tmp.cleanup;
  ctx = new AppContext(tmp.paths.home, { pushResolver: resolver });
  const settings = ctx.settings();
  settings.setupCompleted = true;
  settings.remote.enabled = true;
  settings.channels.push.enabled = true;
  ctx.settingsStore.save(settings);
  app = await buildServer(ctx);
  canary = http.createServer((req, res) => {
    canaryHits.push(`${req.method} ${req.url}`);
    res.statusCode = 201;
    res.end();
  });
  await new Promise<void>((resolve) => canary.listen(0, "127.0.0.1", resolve));
  canaryPort = (canary.address() as AddressInfo).port;
});

beforeEach(() => {
  ctx.db.prepare("DELETE FROM push_subscriptions").run();
});

afterAll(async () => {
  await app.close();
  ctx.close();
  cleanup();
  await new Promise((resolve) => canary.close(resolve));
});

const asOwner = () => ({ "x-mordomo-token": ctx.token(), "content-type": "application/json" });
const as = (credential: string) => ({ "x-mordomo-token": credential, "content-type": "application/json" });

function pair(scopes: readonly DeviceScope[]): { id: string; token: string } {
  const { code } = ctx.devices.startPairing("phone", scopes);
  const claimed = ctx.devices.claim(code, "phone")!;
  return { id: claimed.device.id, token: claimed.token };
}

function subscription(endpoint: string) {
  const ua = crypto.createECDH("prime256v1");
  ua.generateKeys();
  return {
    endpoint,
    keys: { p256dh: b64url.encode(ua.getPublicKey()), auth: b64url.encode(crypto.randomBytes(16)) },
  };
}

const subscribe = (credential: string, endpoint: string) =>
  app.inject({
    method: "POST",
    url: "/api/push/subscribe",
    headers: as(credential),
    payload: { subscription: subscription(endpoint) },
  });

const notification = (tone: "danger" | "warn" = "danger") => ({
  id: "n_x",
  kind: "system" as const,
  tone,
  title: "t",
  body: null,
  href: null,
  approvalId: null,
  runId: null,
  ts: Date.now(),
  read: false,
  dedupeKey: null,
});

describe("C46 which addresses a push endpoint may name", () => {
  it("accepts public https and refuses loopback, private, link-local, metadata and mapped addresses", () => {
    for (const ok of ["8.8.8.8", "142.250.74.10", "2606:4700:4700::1111", "::ffff:8.8.8.8"]) {
      expect(isPublicAddress(ok), ok).toBe(true);
    }
    for (const bad of [
      "127.0.0.1",
      "127.255.255.254",
      "0.0.0.0",
      "10.1.2.3",
      "172.16.0.1",
      "172.31.255.255",
      "192.168.1.1",
      "169.254.169.254",
      "100.64.0.1",
      "224.0.0.1",
      "255.255.255.255",
      "::",
      "::1",
      "fe80::1",
      "fc00::1",
      "fd12:3456::1",
      "::ffff:127.0.0.1",
      "::ffff:7f00:1",
      "::ffff:a9fe:a9fe",
      "64:ff9b::7f00:1",
      "[::1]",
      "not-an-ip",
    ]) {
      expect(isPublicAddress(bad), bad).toBe(false);
    }
  });

  it("refuses an endpoint that is not https, carries credentials, uses another port or names a local host", () => {
    const bad = [
      "http://fcm.googleapis.com/x",
      `http://127.0.0.1:${canaryPort}/hit`,
      "https://127.0.0.1/x",
      "https://[::1]/x",
      "https://[::ffff:127.0.0.1]/x",
      "https://2130706433/x",
      "https://0x7f.0.0.1/x",
      "https://169.254.169.254/latest/meta-data",
      "https://10.0.0.1/x",
      "https://user:pw@fcm.googleapis.com/x",
      "https://fcm.googleapis.com:8443/x",
      "https://localhost/x",
      "https://app.localhost/x",
      "https://printer/x",
      "https://nas.local/x",
      "https://db.internal/x",
      "ftp://fcm.googleapis.com/x",
      "nope",
    ];
    for (const endpoint of bad) expect(endpointProblem(endpoint), endpoint).not.toBeNull();
    expect(endpointProblem(FCM)).toBeNull();
    expect(endpointProblem("https://push.owner-server.example:443/x")).toBeNull();
  });

  it("resolves the name and refuses one that points inside, or only partly outside", async () => {
    expect(await checkPushEndpoint(FCM, resolver)).toBeNull();
    expect(await checkPushEndpoint("https://internal.example/x", resolver)).toMatch(/resolves to an address/);
    expect(await checkPushEndpoint("https://mixed.example/x", resolver)).toMatch(/resolves to an address/);
    expect(await checkPushEndpoint("https://nowhere.example/x", resolver)).toMatch(/does not resolve/);
  });

  it("lets a paired device name only the push services of browsers", async () => {
    for (const host of [
      "fcm.googleapis.com",
      "updates.push.services.mozilla.com",
      "web.push.apple.com",
      "wns2-par02p.notify.windows.com",
    ]) {
      expect(isKnownPushHost(host), host).toBe(true);
    }
    for (const host of [
      "push.owner-server.example",
      "fcm.googleapis.com.evil.example",
      "evilfcm.googleapis.com",
    ]) {
      expect(isKnownPushHost(host), host).toBe(false);
    }
    expect(
      await checkPushEndpoint("https://push.owner-server.example/x", resolver, { knownServicesOnly: true }),
    ).toMatch(/only the push services/);
  });
});

describe("C46 the subscribe and unsubscribe routes", () => {
  it("a device that registers a loopback endpoint gets a refusal and the server posts nowhere", async () => {
    const device = pair(["monitor", "content"]);
    canaryHits.length = 0;
    for (const endpoint of [
      `http://127.0.0.1:${canaryPort}/hit`,
      `https://127.0.0.1:${canaryPort}/hit`,
      "https://127.0.0.1/hit",
      "https://[::1]/hit",
      "https://169.254.169.254/latest/meta-data",
      "https://internal.example/hit",
    ]) {
      const res = await subscribe(device.token, endpoint);
      expect(res.statusCode, endpoint).toBe(400);
      expect(res.json()).toMatchObject({ error: { code: "invalid_push_endpoint" } });
    }
    expect(ctx.push.list()).toHaveLength(0);
    await deliverPush(
      { getSettings: () => ctx.settings(), store: ctx.push, resolveHost: resolver },
      notification(),
    );
    expect(canaryHits).toEqual([]);
  });

  it("a device with only monitor cannot register one at all (403 scope_required)", async () => {
    const monitor = pair(["monitor"]);
    const res = await subscribe(monitor.token, FCM);
    expect(res.statusCode).toBe(403);
    expect(res.json()).toMatchObject({ error: { code: "scope_required" } });
    expect(ctx.push.list()).toHaveLength(0);
  });

  it("a device with content registers a browser push service, and only that", async () => {
    const device = pair(["content"]);
    expect((await subscribe(device.token, "https://push.owner-server.example/x")).statusCode).toBe(400);
    const ok = await subscribe(device.token, FCM);
    expect(ok.statusCode).toBe(200);
    expect(ctx.push.list().map((s) => [s.endpoint, s.deviceId])).toEqual([[FCM, device.id]]);
    ctx.push.removeForDevice(device.id);
  });

  it("the owner may name a public server of their own, never a private address", async () => {
    expect((await subscribe(ctx.token(), "https://push.owner-server.example/x")).statusCode).toBe(200);
    expect((await subscribe(ctx.token(), `https://127.0.0.1:${canaryPort}/hit`)).statusCode).toBe(400);
    expect((await subscribe(ctx.token(), "https://internal.example/hit")).statusCode).toBe(400);
    expect(ctx.push.list().map((s) => s.deviceId)).toEqual([null]);
    ctx.push.removeByEndpoint("https://push.owner-server.example/x");
  });

  it("a device neither replaces nor removes a subscription someone else registered", async () => {
    const a = pair(["content"]);
    const b = pair(["content"]);
    expect((await subscribe(a.token, FCM)).statusCode).toBe(200);
    const taken = await subscribe(b.token, FCM);
    expect(taken.statusCode).toBe(409);
    expect(taken.json()).toMatchObject({ error: { code: "push_endpoint_taken" } });
    const del = await app.inject({
      method: "POST",
      url: "/api/push/unsubscribe",
      headers: as(b.token),
      payload: { endpoint: FCM },
    });
    expect(del.json()).toEqual({ removed: false });
    const noEndpoint = await app.inject({
      method: "POST",
      url: "/api/push/unsubscribe",
      headers: as(b.token),
      payload: {},
    });
    expect(noEndpoint.statusCode).toBe(400);
    expect(ctx.push.list()).toHaveLength(1);
    const own = await app.inject({
      method: "POST",
      url: "/api/push/unsubscribe",
      headers: as(a.token),
      payload: { endpoint: FCM },
    });
    expect(own.json()).toEqual({ removed: true });
  });
});

describe("C46 a subscription follows its device", () => {
  it("revoking the device deletes what it registered, and nothing else", async () => {
    const device = pair(["content"]);
    await subscribe(device.token, FCM);
    await subscribe(ctx.token(), "https://push.owner-server.example/own");
    expect(ctx.push.list()).toHaveLength(2);
    const res = await app.inject({
      method: "DELETE",
      url: `/api/devices/${device.id}`,
      headers: { "x-mordomo-token": ctx.token() },
    });
    expect(res.statusCode).toBe(200);
    expect(ctx.push.list().map((s) => s.endpoint)).toEqual(["https://push.owner-server.example/own"]);
    ctx.push.removeByEndpoint("https://push.owner-server.example/own");
  });

  it("taking content away (setScopes) deletes them; changing to a set that keeps it does not", async () => {
    const device = pair(["content", "run"]);
    await subscribe(device.token, FCM);
    const keeps = await app.inject({
      method: "PATCH",
      url: `/api/devices/${device.id}`,
      headers: asOwner(),
      payload: { scopes: ["content"] },
    });
    expect(keeps.statusCode).toBe(200);
    expect(ctx.push.list()).toHaveLength(1);
    const drops = await app.inject({
      method: "PATCH",
      url: `/api/devices/${device.id}`,
      headers: asOwner(),
      payload: { scopes: [] },
    });
    expect(drops.statusCode).toBe(200);
    expect(ctx.push.list()).toHaveLength(0);
    // Also through the store, the way the CLI and other callers reach it.
    await subscribe(pair(["content"]).token, FCM);
    const again = ctx.push.list()[0]!.deviceId!;
    ctx.devices.setScopes(again, ["monitor"]);
    expect(ctx.push.list()).toHaveLength(0);
  });

  it("an expired device's subscription is deleted at the next send instead of delivered to", async () => {
    const device = pair(["content"]);
    await subscribe(device.token, FCM);
    ctx.db.prepare("UPDATE devices SET expires_at = 1 WHERE id = ?").run(device.id);
    const calls: string[] = [];
    const fetchImpl = (async (url: string | URL | Request) => {
      calls.push(String(url));
      return new Response(null, { status: 201 });
    }) as unknown as typeof fetch;
    const r = await deliverPush(
      { getSettings: () => ctx.settings(), store: ctx.push, fetchImpl, resolveHost: resolver },
      notification(),
    );
    expect(calls).toEqual([]);
    expect(r.skipped).toBe("none");
    expect(ctx.push.list()).toHaveLength(0);
  });
});

describe("C46 the send is checked too", () => {
  it("a name that came to point inside after it was subscribed is dropped, not posted to; redirects are errors", async () => {
    const endpoint = "https://rebinding.example/sub/1";
    expect((await subscribe(ctx.token(), endpoint)).statusCode).toBe(200);
    const seen: Array<{ url: string; redirect: RequestRedirect | undefined }> = [];
    const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
      seen.push({ url: String(url), redirect: init?.redirect });
      return new Response(null, { status: 201 });
    }) as unknown as typeof fetch;
    const deps = { getSettings: () => ctx.settings(), store: ctx.push, fetchImpl };

    const fine = await deliverPush({ ...deps, resolveHost: resolver }, notification());
    expect(fine).toEqual({ sent: 1, failed: 0, dropped: 0 });
    expect(seen).toEqual([{ url: endpoint, redirect: "error" }]);

    seen.length = 0;
    dnsTable.set("rebinding.example", ["127.0.0.1"]);
    try {
      const moved = await deliverPush({ ...deps, resolveHost: resolver }, notification());
      expect(moved).toEqual({ sent: 0, failed: 0, dropped: 1 });
      expect(seen).toEqual([]);
      expect(ctx.push.list()).toHaveLength(0);
    } finally {
      dnsTable.set("rebinding.example", ["93.184.216.34"]);
    }
  });
});
