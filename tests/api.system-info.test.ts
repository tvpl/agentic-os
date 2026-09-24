import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { AppContext } from "../apps/api/src/context.js";
import { buildServer } from "../apps/api/src/server.js";
import { UpdateChecker, compareVersions, type FetchLike } from "../apps/api/src/updates.js";
import { makeTempHome } from "./helpers.js";

function fakeFetch(body: unknown, ok = true, status = 200): { fetch: FetchLike; calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    fetch: async (url) => {
      calls.push(url);
      return { ok, status, json: async () => body };
    },
  };
}

describe("version comparison", () => {
  it("orders numerically and tolerates a v prefix and pre-release suffixes", () => {
    expect(compareVersions("0.8.0", "0.8.0")).toBe(0);
    expect(compareVersions("v0.9.0", "0.8.0")).toBeGreaterThan(0);
    expect(compareVersions("0.8.0", "0.10.0")).toBeLessThan(0);
    expect(compareVersions("1.0.0-rc.1", "1.0.0")).toBe(0);
  });
});

describe("update checker", () => {
  it("reports a newer release and caches the answer", async () => {
    const f = fakeFetch({ tag_name: "v0.9.0", html_url: "https://example.test/rel" });
    const checker = new UpdateChecker("0.8.0", f.fetch);
    const first = await checker.check();
    expect(first).toMatchObject({
      current: "0.8.0",
      latest: "0.9.0",
      upToDate: false,
      url: "https://example.test/rel",
    });
    await checker.check();
    expect(f.calls).toHaveLength(1);
    await checker.check(true);
    expect(f.calls).toHaveLength(2);
  });
  it("never throws: a failed request becomes an error field", async () => {
    const checker = new UpdateChecker("0.8.0", fakeFetch({}, false, 503).fetch);
    const status = await checker.check();
    expect(status.upToDate).toBeNull();
    expect(status.error).toContain("503");
    const none = await new UpdateChecker("0.8.0", fakeFetch({}, false, 404).fetch).check();
    expect(none.error).toBe("no published release yet");
  });
});

describe("system info and update routes", () => {
  const temp = makeTempHome("mordomo-sysinfo-");
  let ctx: AppContext;
  let app: FastifyInstance;
  const f = fakeFetch({ tag_name: "v0.8.0" });
  beforeAll(async () => {
    ctx = new AppContext(temp.paths.home);
    app = await buildServer(ctx, { updates: new UpdateChecker("0.8.0", f.fetch) });
    await app.ready();
  });
  afterAll(async () => {
    await app.close();
    ctx.close();
    temp.cleanup();
  });
  const headers = () => ({ "x-mordomo-token": ctx.token() });

  it("tells which home and entry are serving, behind the token", async () => {
    expect((await app.inject("/api/system/info")).statusCode).toBe(401);
    const res = await app.inject({ url: "/api/system/info", headers: headers() });
    expect(res.statusCode).toBe(200);
    const info = res.json();
    expect(info.home).toBe(temp.paths.home);
    // Built: cli.js; packaged: the bundle; under vitest the TypeScript source itself.
    expect(info.entry).toMatch(/cli\.js$|mordomo\.mjs$|entry\.ts$/);
    expect(typeof info.serviceInstalled).toBe("boolean");
    expect(info.packaged).toBe(false);
    // Build freshness and leftover processes: shape only (the values depend on the machine).
    expect(info.build).toMatchObject({ startedAt: ctx.startedAt });
    expect(typeof info.build.stale).toBe("boolean");
    expect(Array.isArray(info.siblings)).toBe(true);
    for (const s of info.siblings) expect(s.pid).not.toBe(process.pid);
  });
  it("exposes the build stamp pre-auth on /api/meta so `mordomo launch` can compare builds", async () => {
    const meta = (await app.inject("/api/meta")).json();
    expect(meta.build).toMatchObject({ startedAt: ctx.startedAt });
    expect(typeof meta.entry).toBe("string");
  });
  it("restart and reap are token-protected", async () => {
    expect((await app.inject({ method: "POST", url: "/api/system/restart" })).statusCode).toBe(401);
    expect((await app.inject({ method: "POST", url: "/api/system/reap" })).statusCode).toBe(401);
  });
  it("does not contact the network unless enabled or forced", async () => {
    const off = (await app.inject({ url: "/api/updates", headers: headers() })).json();
    expect(off).toMatchObject({ enabled: false, status: null });
    expect(f.calls).toHaveLength(0);
    const forced = (await app.inject({ url: "/api/updates?force=1", headers: headers() })).json();
    expect(forced.status).toMatchObject({ latest: "0.8.0", upToDate: true });
    expect(f.calls).toHaveLength(1);
    const s = ctx.settings();
    s.updates.check = true;
    ctx.settingsStore.save(s);
    const on = (await app.inject({ url: "/api/updates", headers: headers() })).json();
    expect(on.enabled).toBe(true);
    expect(on.status.upToDate).toBe(true);
    expect(f.calls).toHaveLength(1); // cached
  });
});
