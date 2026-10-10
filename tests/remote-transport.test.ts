import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import type { FastifyInstance } from "fastify";
import { AppContext } from "../apps/api/src/context.js";
import { runDoctor } from "../apps/api/src/doctor.js";
import { buildServer, startServer } from "../apps/api/src/server.js";
import { listenPlan } from "../apps/api/src/transport.js";
import { makeTempHome } from "./helpers.js";
import { injectTls } from "./helpers/tlsPeers.js";

/**
 * Remote access only over TLS or a tunnel (.specs/features/escopos-dispositivo, door 6): another machine meets TLS or
 * is refused before anything of its request is read, the listener without TLS is for this machine, and a `bindAddress`
 * beyond loopback is said out loud when nothing carries TLS on it.
 */

const REMOTE = "203.0.113.9";
const LOOPBACK = ["127.0.0.1", "127.0.0.2", "::1", "::ffff:127.0.0.1"];

let ctx: AppContext;
let app: FastifyInstance;
let token: string;
let cleanup: () => void;
let ui: string;

beforeAll(async () => {
  const tmp = makeTempHome("mordomo-transport-");
  cleanup = tmp.cleanup;
  ui = path.join(tmp.paths.home, "ui");
  fs.mkdirSync(path.join(ui, "assets"), { recursive: true });
  fs.writeFileSync(
    path.join(ui, "index.html"),
    '<!doctype html><html><head><meta name="mordomo-token" content="" /></head><body>ui</body></html>',
  );
  fs.writeFileSync(path.join(ui, "assets", "x.js"), "export {};");
  ctx = new AppContext(tmp.paths.home);
  const settings = ctx.settings();
  settings.setupCompleted = true;
  settings.remote.enabled = true;
  settings.remote.allowedHosts = ["mordomo.local"];
  ctx.settingsStore.save(settings);
  token = ctx.token();
  app = await buildServer(ctx, { uiDist: ui });
});

afterAll(async () => {
  await app.close();
  ctx.close();
  cleanup();
});

afterEach(() => vi.restoreAllMocks());

const owner = () => ({ "x-mordomo-token": token });
const body = (res: { json: () => unknown }) => res.json() as { error: { code: string; message: string } };

function pairDevice() {
  const { code } = ctx.devices.startPairing("phone", ["monitor"]);
  return ctx.devices.claim(code, "phone")!;
}

describe("S4 remote access only over TLS or a tunnel", () => {
  it("C23 a plain request from outside this machine is refused", async () => {
    const targets: Array<{ method: "GET" | "POST"; url: string }> = [
      { method: "GET", url: "/api/v1/meta" },
      { method: "POST", url: "/api/v1/pair/claim" },
      { method: "GET", url: "/api/v1/runs" },
      { method: "GET", url: "/" },
      { method: "GET", url: "/index.html" },
      { method: "GET", url: "/assets/x.js" },
    ];
    const hosts = ["mordomo.local", "evil.example", "127.0.0.1"];
    const credentials = [owner(), { "x-mordomo-token": "wrong" }, {}];
    for (const target of targets) {
      for (const host of hosts) {
        for (const credential of credentials) {
          const res = await app.inject({
            ...target,
            remoteAddress: REMOTE,
            headers: { host, ...credential },
            ...(target.method === "POST" ? { payload: { code: "123456" } } : {}),
          });
          const label = `${target.method} ${target.url} ${host}`;
          expect(res.statusCode, label).toBe(403);
          expect(body(res).error.code, label).toBe("tls_required");
          expect(body(res).error.message, label).toContain("remote.tls.enabled");
          expect(body(res).error.message, label).toContain("tunnel");
        }
      }
    }
    // None of that counted as a failed login: 54 refusals later the address is still served over TLS.
    const ok = await injectTls(app, {
      method: "GET",
      url: "/api/v1/meta",
      remoteAddress: REMOTE,
      headers: { host: "mordomo.local" },
    });
    expect(ok.statusCode).toBe(200);
  });

  it("C24 a TLS request from outside this machine is judged as before", async () => {
    const device = pairDevice();
    const tls = (url: string, headers: Record<string, string>) =>
      injectTls(app, {
        method: "GET",
        url,
        remoteAddress: REMOTE,
        headers: { host: "mordomo.local", ...headers },
      });
    expect((await tls("/api/v1/meta", {})).statusCode).toBe(200);
    expect((await tls("/api/v1/runs", { "x-mordomo-token": device.token })).statusCode).toBe(200);
    const wrong = await tls("/api/v1/runs", { "x-mordomo-token": "wrong" });
    expect(wrong.statusCode).toBe(401);
    expect(body(wrong).error.code).toBe("unauthorized");
    const foreign = await injectTls(app, {
      method: "GET",
      url: "/api/v1/meta",
      remoteAddress: REMOTE,
      headers: { host: "evil.example" },
    });
    expect(foreign.statusCode).toBe(403);
    expect(body(foreign).error.code).toBe("forbidden_host");
    // The page is served without the owner token to a peer from outside, as before.
    const page = await tls("/", {});
    expect(page.statusCode).toBe(200);
    expect(page.body).toContain('<meta name="mordomo-token" content="" />');
  });

  it("C25 loopback peers and tunnels are not asked for TLS", async () => {
    const device = pairDevice();
    for (const remoteAddress of LOOPBACK) {
      for (const host of ["127.0.0.1", "mordomo.local"]) {
        const meta = await app.inject({
          method: "GET",
          url: "/api/v1/meta",
          remoteAddress,
          headers: { host },
        });
        expect(meta.statusCode, `${remoteAddress} ${host}`).toBe(200);
        const settings = await app.inject({
          method: "GET",
          url: "/api/v1/settings",
          remoteAddress,
          headers: { host, "x-mordomo-token": device.token },
        });
        expect(settings.statusCode, `${remoteAddress} ${host} device`).toBe(200);
      }
    }
  });
});

const freePort = () =>
  new Promise<number>((resolve, reject) => {
    const probe = net.createServer();
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const { port } = probe.address() as net.AddressInfo;
      probe.close(() => resolve(port));
    });
  });

/** A home whose settings are written before the service starts. */
async function homeWith(
  bindAddress: string,
  tls: boolean,
): Promise<{ home: string; port: number; tlsPort: number; cleanup: () => void }> {
  const tmp = makeTempHome("mordomo-listen-");
  const port = await freePort();
  const tlsPort = await freePort();
  const seed = new AppContext(tmp.paths.home);
  const settings = seed.settings();
  settings.setupCompleted = true;
  settings.port = port;
  settings.bindAddress = bindAddress;
  settings.remote.enabled = true;
  settings.remote.allowedHosts = ["mordomo.local"];
  settings.remote.tls = { enabled: tls, port: tlsPort };
  seed.settingsStore.save(settings);
  seed.close();
  return { home: tmp.paths.home, port, tlsPort, cleanup: tmp.cleanup };
}

describe("S4 only the TLS listener leaves loopback", () => {
  it("C26 only the TLS listener leaves loopback", async () => {
    const binds: Array<[string, string, string | null]> = [
      // bindAddress, listener without TLS, listener with TLS (when remote access and TLS are on)
      ["127.0.0.1", "127.0.0.1", "127.0.0.1"],
      ["localhost", "localhost", "localhost"],
      ["::1", "::1", "::1"],
      ["0.0.0.0", "127.0.0.1", "0.0.0.0"],
      ["::", "127.0.0.1", "::"],
      ["192.0.2.7", "127.0.0.1", "192.0.2.7"],
    ];
    for (const [bindAddress, plainHost, tlsHost] of binds) {
      for (const tlsOn of [true, false]) {
        const plan = listenPlan({
          bindAddress,
          remote: { enabled: true, allowedHosts: [], deviceTtlDays: 90, tls: { enabled: tlsOn, port: null } },
        });
        const label = `${bindAddress} tls=${String(tlsOn)}`;
        expect(plan.plainHost, label).toBe(plainHost);
        expect(plan.tlsHost, label).toBe(tlsOn ? tlsHost : null);
        const loopback = plainHost === bindAddress;
        expect(plan.ignoredBind, label).toBe(loopback || tlsOn ? null : bindAddress);
      }
    }
    const off = listenPlan({
      bindAddress: "0.0.0.0",
      remote: { enabled: false, allowedHosts: [], deviceTtlDays: 90, tls: { enabled: true, port: null } },
    });
    expect(off).toEqual({ plainHost: "127.0.0.1", tlsHost: null, ignoredBind: "0.0.0.0" });

    // What the sockets really bound to.
    const withTls = await homeWith("0.0.0.0", true);
    const first = await startServer(withTls.home);
    try {
      expect(first.listeners.plain).toEqual({ host: "127.0.0.1", port: withTls.port });
      expect(first.listeners.tls).toEqual({ host: "0.0.0.0", port: withTls.tlsPort });
    } finally {
      await first.close();
      withTls.cleanup();
    }
    const noTls = await homeWith("0.0.0.0", false);
    const second = await startServer(noTls.home);
    try {
      expect(second.listeners.plain).toEqual({ host: "127.0.0.1", port: noTls.port });
      expect(second.listeners.tls).toBeNull();
    } finally {
      await second.close();
      noTls.cleanup();
    }
  });

  it("C27 an exposed bind without TLS is said out loud", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const exposed = await homeWith("0.0.0.0", false);
    const handle = await startServer(exposed.home);
    try {
      const said = warn.mock.calls.map((c) => String(c[0])).join("\n");
      for (const phrase of ["0.0.0.0", "remote.enabled", "remote.tls.enabled", "tunnel"])
        expect(said).toContain(phrase);
      const doctor = await runDoctor(handle.ctx, { npmAudit: false });
      const bind = doctor.checks.find((c) => c.id === "bind")!;
      expect(bind.status).toBe("warn");
      for (const phrase of ["0.0.0.0", "remote.enabled", "remote.tls.enabled", "tunnel"])
        expect(bind.detail).toContain(phrase);
    } finally {
      await handle.close();
    }
    const log = fs.readFileSync(path.join(exposed.home, "logs", "api.jsonl"), "utf8");
    expect(log).toContain("remote.tls.enabled");
    exposed.cleanup();

    warn.mockClear();
    for (const [bindAddress, tls] of [
      ["127.0.0.1", false],
      ["0.0.0.0", true],
    ] as const) {
      const quiet = await homeWith(bindAddress, tls);
      const started = await startServer(quiet.home);
      try {
        expect(
          warn.mock.calls.map((c) => String(c[0])).join("\n"),
          `${bindAddress} ${String(tls)}`,
        ).not.toContain("not honoured");
        const doctor = await runDoctor(started.ctx, { npmAudit: false });
        expect(doctor.checks.find((c) => c.id === "bind")!.status, `${bindAddress} ${String(tls)}`).toBe(
          "ok",
        );
      } finally {
        await started.close();
        quiet.cleanup();
      }
    }
  });
});
