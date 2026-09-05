import { describe, expect, it, beforeAll, afterAll } from "vitest";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { FastifyInstance } from "fastify";
import { AppContext } from "../apps/api/src/context.js";
import { buildServer, isAllowedHost } from "../apps/api/src/server.js";
import { makeTempHome } from "./helpers.js";

/** Remote access: pairing codes, device tokens, host allow-list, token injection. */

let ctx: AppContext;
let app: FastifyInstance;
let token: string;
let cleanup: () => void;

beforeAll(async () => {
  const tmp = makeTempHome();
  cleanup = tmp.cleanup;
  ctx = new AppContext(tmp.paths.home);
  const settings = ctx.settings();
  settings.setupCompleted = true;
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

describe("host allow-list", () => {
  it("accepts loopback always and listed hosts only when given", () => {
    expect(isAllowedHost("127.0.0.1:4777")).toBe(true);
    expect(isAllowedHost("mordomo.tail1234.ts.net:4777")).toBe(false);
    expect(isAllowedHost("mordomo.tail1234.ts.net:4777", ["mordomo.tail1234.ts.net"])).toBe(true);
    expect(isAllowedHost("mordomo.tail1234.ts.net:4777", ["mordomo.tail1234.ts.net:4778"])).toBe(false);
    expect(isAllowedHost("evil.example:4777", ["mordomo.tail1234.ts.net"])).toBe(false);
  });
});

describe("pairing", () => {
  it("refuses to claim while remote access is off", async () => {
    const start = await app.inject({ method: "POST", url: "/api/pair/start", headers: auth(), payload: {} });
    expect(start.statusCode).toBe(200);
    const { code } = start.json() as { code: string };
    expect(code).toMatch(/^\d{6}$/);
    const claim = await app.inject({
      method: "POST",
      url: "/api/pair/claim",
      payload: { code, name: "phone" },
    });
    expect(claim.statusCode).toBe(403);
  });

  it("exchanges the code once for a device token that authenticates API calls", async () => {
    ctx.settingsStore.update({
      remote: { enabled: true, allowedHosts: ["mordomo.local"], deviceTtlDays: 30 },
    });
    const start = await app.inject({
      method: "POST",
      url: "/api/pair/start",
      headers: auth(),
      payload: { name: "desk" },
    });
    const { code } = start.json() as { code: string };
    const wrong = await app.inject({
      method: "POST",
      url: "/api/pair/claim",
      payload: { code: "000000", name: "x" },
    });
    expect(wrong.statusCode).toBe(401);
    const claim = await app.inject({
      method: "POST",
      url: "/api/pair/claim",
      payload: { code, name: "phone" },
    });
    expect(claim.statusCode).toBe(200);
    const { token: deviceToken, device } = claim.json() as {
      token: string;
      device: { id: string; name: string };
    };
    expect(device.name).toBe("phone");
    // The code is single use.
    const again = await app.inject({
      method: "POST",
      url: "/api/pair/claim",
      payload: { code, name: "phone" },
    });
    expect(again.statusCode).toBe(401);
    // The device token opens the API, also from an allowed remote host.
    const me = await app.inject({
      method: "GET",
      url: "/api/settings",
      headers: { "x-mordomo-token": deviceToken, host: "mordomo.local:4777" },
    });
    expect(me.statusCode).toBe(200);
    const bad = await app.inject({
      method: "GET",
      url: "/api/settings",
      headers: { "x-mordomo-token": "nope", host: "mordomo.local:4777" },
    });
    expect(bad.statusCode).toBe(401);
    const list = await app.inject({ method: "GET", url: "/api/devices", headers: auth() });
    expect((list.json() as { devices: Array<{ id: string }> }).devices.map((d) => d.id)).toContain(device.id);
    // Revoked → refused.
    const revoke = await app.inject({ method: "DELETE", url: `/api/devices/${device.id}`, headers: auth() });
    expect(revoke.json()).toEqual({ revoked: true });
    const after = await app.inject({
      method: "GET",
      url: "/api/settings",
      headers: { "x-mordomo-token": deviceToken },
    });
    expect(after.statusCode).toBe(401);
  });

  it("injects the local token only for loopback pages", async () => {
    const local = await app.inject({ method: "GET", url: "/", headers: { host: "127.0.0.1:4777" } });
    const remote = await app.inject({ method: "GET", url: "/", headers: { host: "mordomo.local:4777" } });
    if (local.statusCode === 200 && local.headers["content-type"]?.toString().includes("text/html")) {
      expect(local.body).toContain(`content="${token}"`);
      expect(remote.body).not.toContain(token);
    }
  });
});

describe("remote TLS", () => {
  it("exposes the certificate fingerprint in /api/meta only when remote + tls are on, and keeps the files", async () => {
    const before = await app.inject({ method: "GET", url: "/api/meta" });
    expect((before.json() as { tls: unknown }).tls).toBeNull();
    ctx.settingsStore.update({
      remote: {
        enabled: true,
        allowedHosts: ["mordomo.local:4777", "10.0.0.5"],
        deviceTtlDays: 30,
        tls: { enabled: true, port: null },
      },
    });
    const after = await app.inject({ method: "GET", url: "/api/meta" });
    const tls = (after.json() as { tls: { port: number; fingerprint: string; hosts: string[] } }).tls;
    expect(tls.port).toBe(ctx.settings().port + 1);
    expect(tls.fingerprint).toMatch(/^([0-9A-F]{2}:){31}[0-9A-F]{2}$/);
    expect(tls.hosts).toEqual(["mordomo.local", "10.0.0.5"]);
    const certFile = path.join(ctx.paths.config, "tls", "cert.pem");
    expect(fs.existsSync(certFile)).toBe(true);
    const cert = new crypto.X509Certificate(fs.readFileSync(certFile));
    expect(cert.checkHost("mordomo.local")).toBe("mordomo.local");
    expect(cert.fingerprint256).toBe(tls.fingerprint);
    ctx.settingsStore.update({
      remote: { enabled: false, allowedHosts: [], deviceTtlDays: 30, tls: { enabled: false, port: null } },
    });
  });
});
