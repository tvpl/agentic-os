import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import crypto from "node:crypto";
import http from "node:http";
import type { AddressInfo } from "node:net";
import type { FastifyInstance } from "fastify";
import {
  b64url,
  checkPushEndpoint,
  classifyPushEndpoint,
  deliverPush,
  endpointProblem,
  isKnownPushHost,
  KNOWN_PUSH_HOSTS,
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

describe("C58 each rule of the endpoint policy, on its own", () => {
  it("a name belongs to a push service only when the whole name does, pattern by pattern", () => {
    expect(KNOWN_PUSH_HOSTS).toHaveLength(5);
    const cases: Array<{ pattern: string; yes: string[]; no: string[] }> = [
      {
        pattern: "fcm.googleapis.com",
        yes: ["fcm.googleapis.com"],
        no: [
          "fcm.googleapis.com.evil.example",
          "evilfcm.googleapis.com",
          "_fcm.googleapis.com",
          "x.fcm.googleapis.com",
        ],
      },
      {
        pattern: "android.googleapis.com",
        yes: ["android.googleapis.com"],
        no: [
          "android.googleapis.com.evil.example",
          "evilandroid.googleapis.com",
          "_android.googleapis.com",
          "x.android.googleapis.com",
        ],
      },
      {
        pattern: "*.push.services.mozilla.com",
        yes: ["updates.push.services.mozilla.com", "autopush-1.push.services.mozilla.com"],
        no: [
          "push.services.mozilla.com",
          "updates.push.services.mozilla.com.evil.example",
          "evil-push.services.mozilla.com",
          "a_b.push.services.mozilla.com",
          "a.b.push.services.mozilla.com",
        ],
      },
      {
        pattern: "*.push.apple.com",
        yes: ["web.push.apple.com", "17.push.apple.com"],
        no: [
          "push.apple.com",
          "web.push.apple.com.evil.example",
          "evilpush.apple.com",
          "x_.push.apple.com",
          "a.b.push.apple.com",
        ],
      },
      {
        pattern: "*.notify.windows.com",
        yes: ["wns2-par02p.notify.windows.com", "db5.notify.windows.com", "a.b.notify.windows.com"],
        no: [
          "notify.windows.com",
          "wns.notify.windows.com.evil.example",
          "evilnotify.windows.com",
          "ev_il.notify.windows.com",
          "x.notifyxwindows.com",
        ],
      },
    ];
    for (const c of cases) {
      const matching = KNOWN_PUSH_HOSTS.filter((re) => c.yes.every((h) => re.test(h)));
      expect(matching, c.pattern).toHaveLength(1);
      for (const host of c.yes) expect(isKnownPushHost(host), `${c.pattern}: ${host}`).toBe(true);
      for (const host of c.no) expect(isKnownPushHost(host), `${c.pattern}: ${host}`).toBe(false);
      // The name has to be the pattern's alone: no other pattern lets a refused name through.
      for (const host of c.no)
        expect(
          KNOWN_PUSH_HOSTS.some((re) => re.test(host)),
          host,
        ).toBe(false);
    }
  });

  it("each dot of a pattern is a dot: the name with any other character in its place is not a push service", () => {
    // One real host of each pattern; every dot of it replaced by a letter, a digit and a hyphen in turn. A pattern
    // whose dot is unescaped lets `fcmXgoogleapis.com` (a name anyone can register) through.
    const canonical = [
      "fcm.googleapis.com",
      "android.googleapis.com",
      "updates.push.services.mozilla.com",
      "web.push.apple.com",
      "wns2-par02p.notify.windows.com",
    ];
    for (const host of canonical) {
      expect(isKnownPushHost(host), host).toBe(true);
      for (let at = 0; at < host.length; at++) {
        if (host[at] !== ".") continue;
        for (const other of ["x", "7", "-"]) {
          const changed = `${host.slice(0, at)}${other}${host.slice(at + 1)}`;
          expect(isKnownPushHost(changed), changed).toBe(false);
        }
      }
    }
    for (const host of [
      "fcmXgoogleapis.com",
      "androidXgoogleapis.com",
      "a.push.servicesXmozilla.com",
      "services-mozilla.com",
      "a.pushXapple.com",
      "push-apple.com",
      "a.notifyXwindows.com",
    ]) {
      expect(isKnownPushHost(host), host).toBe(false);
    }
  });

  it("a hexadecimal IPv4 inside an IPv6 address is read byte by byte, in order", () => {
    // Each byte of the embedded address decides one of these, so a swapped or mis-shifted byte shows.
    const private4 = [
      ["::ffff:a00:1", "10.0.0.1"],
      ["::ffff:ac10:1", "172.16.0.1"],
      ["::ffff:c0a8:101", "192.168.1.1"],
      ["::ffff:7f00:1", "127.0.0.1"],
      ["::ffff:a9fe:a9fe", "169.254.169.254"],
      ["::ffff:cb00:7101", "203.0.113.1"],
      ["::ffff:6440:1", "100.64.0.1"],
      ["64:ff9b::a00:1", "10.0.0.1"],
      ["64:ff9b::c0a8:1", "192.168.0.1"],
      ["64:ff9b::cb00:7101", "203.0.113.1"],
    ] as const;
    for (const [v6, v4] of private4) {
      expect(isPublicAddress(v6), `${v6} (${v4})`).toBe(false);
      expect(isPublicAddress(v4), v4).toBe(false);
    }
    // The neighbour of each, one step over the edge on the byte that decides, is public.
    const public4 = [
      ["::ffff:b00:1", "11.0.0.1"],
      ["::ffff:ac20:1", "172.32.0.1"],
      ["::ffff:c0a9:101", "192.169.1.1"],
      ["::ffff:cb00:7201", "203.0.114.1"],
      ["::ffff:6480:1", "100.128.0.1"],
      ["::ffff:808:808", "8.8.8.8"],
      ["::ffff:808:404", "8.8.4.4"],
      ["64:ff9b::c0a9:1", "192.169.0.1"],
      ["64:ff9b::cb00:7201", "203.0.114.1"],
      ["64:ff9b::808:808", "8.8.8.8"],
    ] as const;
    for (const [v6, v4] of public4) {
      expect(isPublicAddress(v6), `${v6} (${v4})`).toBe(true);
      expect(isPublicAddress(v4), v4).toBe(true);
    }
  });

  it("an address is public unless a range names it: every range, at both of its edges, and its neighbours", () => {
    const inside: Array<[string, string[]]> = [
      ["0.0.0.0/8", ["0.0.0.0", "0.255.255.255"]],
      ["10/8", ["10.0.0.0", "10.255.255.255"]],
      ["100.64/10", ["100.64.0.0", "100.127.255.255"]],
      ["127/8", ["127.0.0.0", "127.255.255.255"]],
      ["169.254/16", ["169.254.0.0", "169.254.169.254", "169.254.255.255"]],
      ["172.16/12", ["172.16.0.0", "172.31.255.255"]],
      ["192.0.0/24", ["192.0.0.0", "192.0.0.255"]],
      ["192.0.2/24", ["192.0.2.0", "192.0.2.255"]],
      ["192.168/16", ["192.168.0.0", "192.168.255.255"]],
      ["198.18/15", ["198.18.0.0", "198.19.255.255"]],
      ["198.51.100/24", ["198.51.100.0", "198.51.100.255"]],
      ["203.0.113/24", ["203.0.113.0", "203.0.113.255"]],
      ["224/4", ["224.0.0.1", "239.255.255.255"]],
      ["240/4", ["240.0.0.1", "255.255.255.255"]],
      ["::", ["::"]],
      ["::1", ["::1"]],
      ["fc00::/7", ["fc00::1", "fdff:ffff::1"]],
      ["fe80::/10", ["fe80::1", "febf::1"]],
      ["ff00::/8", ["ff02::1", "ffff::1"]],
      ["2001:db8::/32", ["2001:db8::1", "2001:db8:ffff::1"]],
      ["100::/64", ["100::1", "100::ffff:ffff:ffff:ffff"]],
      ["::/96 (IPv4-compatible)", ["::7f00:1", "::127.0.0.1", "::8.8.8.8", "::a00:1"]],
      ["64:ff9b:1::/48 (local NAT64)", ["64:ff9b:1::7f00:1", "64:ff9b:1:ffff::1"]],
      ["::ffff:0:0:0/96 (SIIT)", ["::ffff:0:7f00:1", "::ffff:0:a00:1"]],
      ["2002::/16 (6to4)", ["2002:7f00:1::1", "2002:808:808::1"]],
      ["2001::/32 (Teredo)", ["2001::1", "2001:0:ffff::1"]],
      ["fec0::/10 (site-local)", ["fec0::1", "feff::1"]],
      [
        "mapped and NAT64 forms of a private address",
        ["::ffff:10.0.0.1", "::ffff:a00:1", "64:ff9b::a00:1", "64:ff9b::10.0.0.1", "::ffff:127.0.0.1"],
      ],
    ];
    for (const [range, addresses] of inside) {
      for (const address of addresses) expect(isPublicAddress(address), `${range}: ${address}`).toBe(false);
    }
    const outside = [
      "1.0.0.1",
      "9.255.255.255",
      "11.0.0.0",
      "100.63.255.255",
      "100.128.0.0",
      "126.255.255.255",
      "128.0.0.1",
      "169.253.255.255",
      "169.255.0.0",
      "172.15.255.255",
      "172.32.0.0",
      "192.0.1.1",
      "192.0.3.1",
      "192.167.255.255",
      "192.169.0.0",
      "198.17.255.255",
      "198.20.0.0",
      "198.51.99.1",
      "198.51.101.1",
      "203.0.112.255",
      "203.0.114.1",
      "223.255.255.255",
      "8.8.8.8",
      "2606:4700:4700::1111",
      "2a00:1450:4001::1",
      "2001:4860:4860::8888",
      "2001:db9::1",
      "fbff::1",
      "100:0:0:1::1",
      "::ffff:8.8.8.8",
      "::ffff:808:808",
      "64:ff9b::808:808",
    ];
    for (const address of outside) expect(isPublicAddress(address), address).toBe(true);
  });

  it("a name is local when it ends like one of the local suffixes, or is one label, with or without a final dot", () => {
    for (const host of [
      "x.localhost",
      "x.local",
      "x.internal",
      "x.localdomain",
      "x.lan",
      "x.home",
      "x.corp",
      "x.intranet",
      "printer",
      "localhost",
      "localhost.",
      "x.lan.",
      "[fe80::1]",
    ]) {
      expect(endpointProblem(`https://${host}/send`), host).not.toBeNull();
    }
    for (const host of [
      "x.lanx.example",
      "homepage.example",
      "corp.example.com",
      "fcm.googleapis.com.",
      "8.8.8.8",
    ]) {
      expect(endpointProblem(`https://${host}/send`), host).toBeNull();
    }
  });

  it("an empty answer and a failing resolver are 'unresolved', never 'points inside'", async () => {
    const empty: HostResolver = async () => [];
    const failing: HostResolver = async () => {
      throw Object.assign(new Error("getaddrinfo EAI_AGAIN"), { code: "EAI_AGAIN" });
    };
    for (const r of [empty, failing]) {
      expect(await classifyPushEndpoint(FCM, r)).toMatchObject({ verdict: "unresolved" });
      expect(await checkPushEndpoint(FCM, r)).toMatch(/does not resolve/);
    }
    expect(await classifyPushEndpoint(FCM, resolver)).toEqual({ verdict: "ok" });
    expect(await classifyPushEndpoint("https://internal.example/x", resolver)).toMatchObject({
      verdict: "rejected",
    });
    expect(await classifyPushEndpoint("https://127.0.0.1/x", failing)).toMatchObject({ verdict: "rejected" });
    // A final dot on the name is the same name.
    expect(
      await checkPushEndpoint("https://fcm.googleapis.com./fcm/send/abc", resolver, {
        knownServicesOnly: true,
      }),
    ).toBeNull();
  });
});

describe("C58 the send and the routes keep what they promised", () => {
  it("a resolver that fails is a failed delivery, counted; the subscription goes only after the usual run of failures", async () => {
    expect((await subscribe(ctx.token(), FCM)).statusCode).toBe(200);
    const calls: string[] = [];
    const fetchImpl = (async (url: string | URL | Request) => {
      calls.push(String(url));
      return new Response(null, { status: 201 });
    }) as unknown as typeof fetch;
    const flaky: HostResolver = async () => {
      throw Object.assign(new Error("getaddrinfo EAI_AGAIN fcm.googleapis.com"), { code: "EAI_AGAIN" });
    };
    const deps = { getSettings: () => ctx.settings(), store: ctx.push, fetchImpl, resolveHost: flaky };
    const first = await deliverPush(deps, notification());
    expect(first).toEqual({ sent: 0, failed: 1, dropped: 0 });
    expect(ctx.push.list().map((r) => [r.endpoint, r.failures])).toEqual([[FCM, 1]]);
    expect(calls).toEqual([]);
    // The network comes back: it is delivered to, and the count starts over.
    expect(await deliverPush({ ...deps, resolveHost: resolver }, notification())).toEqual({
      sent: 1,
      failed: 0,
      dropped: 0,
    });
    expect(ctx.push.list()[0]!.failures).toBe(0);
    // Eight in a row and it goes, as for any other failure.
    let last = { sent: 0, failed: 0, dropped: 0 };
    for (let i = 0; i < 8; i++) last = await deliverPush(deps, notification());
    expect(last).toEqual({ sent: 0, failed: 1, dropped: 1 });
    expect(ctx.push.list()).toHaveLength(0);
    // An endpoint that now points inside is another matter: dropped at once.
    expect((await subscribe(ctx.token(), "https://rebinding.example/sub/2")).statusCode).toBe(200);
    dnsTable.set("rebinding.example", ["10.1.1.1"]);
    try {
      expect(await deliverPush({ ...deps, resolveHost: resolver }, notification())).toEqual({
        sent: 0,
        failed: 0,
        dropped: 1,
      });
    } finally {
      dnsTable.set("rebinding.example", ["93.184.216.34"]);
    }
  });

  it("a device cannot name an IP literal, even a public one; the owner can; a final dot changes nothing", async () => {
    const device = pair(["content"]);
    const literal = await subscribe(device.token, "https://8.8.8.8/x");
    expect(literal.statusCode).toBe(400);
    expect(literal.json()).toMatchObject({ error: { code: "invalid_push_endpoint" } });
    expect((literal.json() as { error: { message: string } }).error.message).toMatch(
      /only the push services/,
    );
    expect((await subscribe(ctx.token(), "https://8.8.8.8/x")).statusCode).toBe(200);
    expect((await subscribe(device.token, "https://fcm.googleapis.com./fcm/send/dot")).statusCode).toBe(200);
  });

  it("a device that subscribes its own endpoint again keeps it as its own, and revoking it still deletes it", async () => {
    const device = pair(["content"]);
    expect((await subscribe(device.token, FCM)).statusCode).toBe(200);
    const again = await subscribe(device.token, FCM);
    expect(again.statusCode).toBe(200);
    expect(ctx.push.ownerOf(FCM)).toBe(device.id);
    expect(ctx.push.list()).toHaveLength(1);
    expect(ctx.push.list()[0]!.deviceId).toBe(device.id);
    ctx.devices.revoke(device.id);
    expect(ctx.push.list()).toHaveLength(0);
  });

  it("the owner who registers an endpoint a device registered takes it over", async () => {
    const device = pair(["content"]);
    expect((await subscribe(device.token, FCM)).statusCode).toBe(200);
    expect(ctx.push.ownerOf(FCM)).toBe(device.id);
    expect((await subscribe(ctx.token(), FCM)).statusCode).toBe(200);
    expect(ctx.push.ownerOf(FCM)).toBeNull();
    expect(ctx.push.list()).toHaveLength(1);
    // It is the owner's now: revoking the device leaves it, and the device can no longer remove it.
    const gone = await app.inject({
      method: "POST",
      url: "/api/push/unsubscribe",
      headers: as(device.token),
      payload: { endpoint: FCM },
    });
    expect(gone.json()).toEqual({ removed: false });
    ctx.devices.revoke(device.id);
    expect(ctx.push.list().map((r) => r.endpoint)).toEqual([FCM]);
  });
});
