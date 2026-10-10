import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { FastifyInstance } from "fastify";
import { events, type DeviceScope } from "@mordomo/core";
import { AppContext } from "../apps/api/src/context.js";
import { buildServer, safeUrl } from "../apps/api/src/server.js";
import type { Principal } from "../apps/api/src/routes/common.js";
import { TICKET_TTL_MS, TICKETS_PER_PRINCIPAL, TicketStore, ticketKey } from "../apps/api/src/tickets.js";
import { makeTempHome } from "./helpers.js";

/**
 * Stream tickets (.specs/features/escopos-dispositivo, door 5): the two event streams open with a one-use, 30-second
 * ticket instead of a credential in the URL, and a device's token is not accepted in the URL of either.
 */

let ctx: AppContext;
let app: FastifyInstance;
let token: string;
let base: string;
let cleanup: () => void;
const seen: Array<{ url: string; principal: Principal | null }> = [];

beforeAll(async () => {
  const tmp = makeTempHome("mordomo-tickets-");
  cleanup = tmp.cleanup;
  ctx = new AppContext(tmp.paths.home);
  const settings = ctx.settings();
  settings.setupCompleted = true;
  settings.remote.enabled = true;
  ctx.settingsStore.save(settings);
  token = ctx.token();
  app = await buildServer(ctx);
  // After the gate's own hook: what principal the gate decided for each request.
  app.addHook("onRequest", async (req) => {
    seen.push({ url: req.url, principal: req.principal });
  });
  await app.listen({ port: 0, host: "127.0.0.1" });
  base = `http://127.0.0.1:${(app.server.address() as { port: number }).port}`;
});

afterEach(() => vi.useRealTimers());

afterAll(async () => {
  await app.close();
  ctx.close();
  cleanup();
});

const owner = () => ({ "x-mordomo-token": token, "content-type": "application/json" });
const as = (credential: string) => ({ "x-mordomo-token": credential, "content-type": "application/json" });

function pair(scopes: readonly DeviceScope[]): { id: string; token: string } {
  const { code } = ctx.devices.startPairing("phone", scopes);
  const claimed = ctx.devices.claim(code, "phone")!;
  return { id: claimed.device.id, token: claimed.token };
}

const mint = (headers: Record<string, string>, payload: unknown) =>
  app.inject({ method: "POST", url: "/api/v1/stream-tickets", headers, payload: payload as object });
const ticketOf = async (headers: Record<string, string>, payload: unknown): Promise<string> => {
  const res = await mint(headers, payload);
  expect(res.statusCode).toBe(200);
  return (res.json() as { ticket: string }).ticket;
};
const errorOf = (res: { json: () => unknown }) =>
  (res.json() as { error: { code: string; message: string } }).error;

/** Open an SSE URL on a real socket; the caller reads what arrives and hangs up. */
async function open(url: string): Promise<{
  status: number;
  type: string | null;
  body: string;
  close: () => void;
  next: (until: RegExp) => Promise<string>;
}> {
  const ac = new AbortController();
  const res = await fetch(url, { signal: ac.signal });
  let body = "";
  const reader = res.body?.getReader();
  const decoder = new TextDecoder();
  return {
    status: res.status,
    type: res.headers.get("content-type"),
    get body() {
      return body;
    },
    close: () => ac.abort(),
    async next(until: RegExp) {
      const deadline = Date.now() + 5000;
      while (!until.test(body) && Date.now() < deadline) {
        const chunk = await reader!.read();
        if (chunk.done) break;
        body += decoder.decode(chunk.value);
      }
      return body;
    },
  };
}

describe("S5 stream tickets", () => {
  it("C28 a ticket is minted for the two streams", async () => {
    const runId = crypto.randomUUID();
    const device = pair(["monitor"]);
    const tickets = new Set<string>();
    for (const headers of [owner(), as(device.token)]) {
      for (const payload of [{ target: "events" }, { target: "run", runId }]) {
        const res = await mint(headers, payload);
        expect(res.statusCode).toBe(200);
        const body = res.json() as { ticket: string; expiresAt: number };
        expect(body.ticket).toMatch(/^tk_[A-Za-z0-9_-]{32}$/);
        expect(Math.abs(body.expiresAt - (Date.now() + TICKET_TTL_MS))).toBeLessThan(1000);
        tickets.add(body.ticket);
      }
    }
    expect(tickets.size).toBe(4);
    expect(TICKET_TTL_MS).toBe(30_000);
    const blind = pair([]);
    const refused = await mint(as(blind.token), { target: "events" });
    expect(refused.statusCode).toBe(403);
    expect(errorOf(refused).code).toBe("scope_required");
    const anonymous = await mint({ "content-type": "application/json" }, { target: "events" });
    expect(anonymous.statusCode).toBe(401);
    for (const payload of [{}, { target: "x" }, { target: "run" }, { target: "run", runId: "nope" }]) {
      const bad = await mint(owner(), payload);
      expect(bad.statusCode, JSON.stringify(payload)).toBe(400);
    }
  });

  it("C29 a ticket opens the stream as the one who minted it", async () => {
    const device = pair(["monitor"]);
    const run = ctx.runs.create({
      origin: "manual",
      provider: "claude",
      prompt: "streamed",
      cwd: ctx.paths.home,
      model: null,
      effort: "default",
      mode: "read_only",
      timeoutMs: 60_000,
      profile: "read_only",
      status: "waiting_approval",
    });
    for (const [credential, name] of [
      [owner(), "owner"],
      [as(device.token), `device:${device.id}`],
    ] as const) {
      seen.length = 0;
      const ticket = await ticketOf(credential, { target: "events" });
      const feed = await open(`${base}/api/v1/events?ticket=${ticket}`);
      expect(feed.status).toBe(200);
      expect(feed.type).toContain("text/event-stream");
      events.emit("notification.read", { all: true });
      expect(await feed.next(/event: notification\.read/)).toContain("event: notification.read");
      feed.close();
      const principal = seen.find((s) => s.url.includes("/api/events"))?.principal;
      expect(
        principal ? (principal.kind === "device" ? `device:${principal.deviceId}` : principal.kind) : null,
      ).toBe(name);

      const runTicket = await ticketOf(credential, { target: "run", runId: run.id });
      const stream = await open(`${base}/api/v1/runs/${run.id}/stream?ticket=${runTicket}`);
      expect(stream.status).toBe(200);
      expect(stream.type).toContain("text/event-stream");
      stream.close();
    }
  });

  it("C30 a ticket is refused the same way in every other case", async () => {
    const device = pair(["monitor"]);
    const runX = crypto.randomUUID();
    const runY = crypto.randomUUID();
    const attempts: Array<{ name: string; status: number; body: string }> = [];
    const get = async (name: string, url: string, method = "GET") => {
      const res = await fetch(`${base}${url}`, { method });
      attempts.push({ name, status: res.status, body: await res.text() });
    };

    const reused = await ticketOf(owner(), { target: "events" });
    const first = await open(`${base}/api/v1/events?ticket=${reused}`);
    expect(first.status).toBe(200);
    first.close();
    await get("second presentation", `/api/v1/events?ticket=${reused}`);

    const old = await ticketOf(owner(), { target: "events" });
    const wrongStream = await ticketOf(owner(), { target: "run", runId: runX });
    const wrongFeed = await ticketOf(owner(), { target: "events" });
    const otherRun = await ticketOf(owner(), { target: "run", runId: runX });
    const revoked = await ticketOf(as(device.token), { target: "events" });
    const demoted = pair(["monitor"]);
    const lost = await ticketOf(as(demoted.token), { target: "events" });
    const elsewhere = await ticketOf(owner(), { target: "events" });
    const elsewhereToo = await ticketOf(owner(), { target: "events" });
    const posted = await ticketOf(owner(), { target: "events" });
    const lapsed = pair(["monitor"]);
    const lapsedTicket = await ticketOf(as(lapsed.token), { target: "events" });
    const closedOff = pair(["monitor"]);
    const closedOffTicket = await ticketOf(as(closedOff.token), { target: "events" });
    const byHead = await ticketOf(owner(), { target: "events" });
    const twin = await ticketOf(owner(), { target: "events" });

    await get("wrong stream", `/api/v1/events?ticket=${wrongStream}`);
    await get("the feed's ticket on a run", `/api/v1/runs/${runX}/stream?ticket=${wrongFeed}`);
    await get("another run", `/api/v1/runs/${runY}/stream?ticket=${otherRun}`);
    ctx.devices.revoke(device.id);
    await get("revoked device", `/api/v1/events?ticket=${revoked}`);
    ctx.devices.setScopes(demoted.id, []);
    await get("device that lost monitor", `/api/v1/events?ticket=${lost}`);
    await get(
      "the ticket of a run stream, once spent at the wrong place, at its own",
      `/api/v1/runs/${runX}/stream?ticket=${wrongStream}`,
    );
    // The device came to expire after the ticket was made.
    ctx.db.prepare("UPDATE devices SET expires_at = 1 WHERE id = ?").run(lapsed.id);
    await get("device that expired", `/api/v1/events?ticket=${lapsedTicket}`);
    // Remote access was turned off after the ticket was made.
    const remote = ctx.settings().remote;
    ctx.settingsStore.update({ remote: { ...remote, enabled: false } });
    try {
      await get("remote access turned off", `/api/v1/events?ticket=${closedOffTicket}`);
    } finally {
      ctx.settingsStore.update({ remote: { ...remote, enabled: true } });
    }
    await get("a route that takes no ticket", `/api/v1/runs?ticket=${elsewhere}`);
    await get("a public route", `/api/v1/meta?ticket=${elsewhereToo}`);
    await get("another method", `/api/v1/runs?ticket=${posted}`, "POST");
    // HEAD is a twin of GET to the router and not to the ticket.
    const head = await fetch(`${base}/api/v1/events?ticket=${byHead}`, { method: "HEAD" });
    expect(head.status, "HEAD").toBe(401);
    // After 30 seconds: the clock moves, the sockets do not.
    vi.useFakeTimers({ toFake: ["Date"], now: Date.now() });
    vi.setSystemTime(Date.now() + TICKET_TTL_MS + 1);
    await get("after 30 seconds", `/api/v1/events?ticket=${old}`);
    vi.useRealTimers();

    expect(attempts.map((a) => a.name)).toEqual([
      "second presentation",
      "wrong stream",
      "the feed's ticket on a run",
      "another run",
      "revoked device",
      "device that lost monitor",
      "the ticket of a run stream, once spent at the wrong place, at its own",
      "device that expired",
      "remote access turned off",
      "a route that takes no ticket",
      "a public route",
      "another method",
      "after 30 seconds",
    ]);
    for (const a of attempts) expect(a.status, a.name).toBe(401);
    // Never says why: one body for every refusal.
    expect(new Set(attempts.map((a) => a.body)).size).toBe(1);
    expect(JSON.parse(attempts[0]!.body)).toMatchObject({ error: { code: "unauthorized" } });

    // Two presentations at once open exactly one stream.
    const [a, b] = await Promise.all([
      fetch(`${base}/api/v1/events?ticket=${twin}`),
      fetch(`${base}/api/v1/events?ticket=${twin}`),
    ]);
    expect([a.status, b.status].sort()).toEqual([200, 401]);
    void a.body?.cancel();
    void b.body?.cancel();
  });

  it("C31 the device token leaves the stream URLs", async () => {
    const device = pair(["monitor", "content"]);
    const runId = crypto.randomUUID();
    for (const url of [
      `/api/v1/events?token=${device.token}`,
      `/api/v1/runs/${runId}/stream?token=${device.token}`,
    ]) {
      const res = await fetch(`${base}${url}`);
      expect(res.status, url).toBe(401);
      const body = (await res.json()) as { error: { code: string; message: string } };
      expect(body.error.code, url).toBe("unauthorized");
      expect(body.error.message, url).toContain("ticket");
    }
    for (const url of [`/api/v1/events?token=${token}`]) {
      const stream = await open(`${base}${url}`);
      expect(stream.status, url).toBe(200);
      stream.close();
    }
    const run = ctx.runs.create({
      origin: "manual",
      provider: "claude",
      prompt: "owner stream",
      cwd: ctx.paths.home,
      model: null,
      effort: "default",
      mode: "read_only",
      timeoutMs: 60_000,
      profile: "read_only",
      status: "waiting_approval",
    });
    const ownerRun = await open(`${base}/api/v1/runs/${run.id}/stream?token=${token}`);
    expect(ownerRun.status).toBe(200);
    ownerRun.close();

    // The two file routes keep the device token in the URL (an <img> cannot send a header): still the scope gate applies.
    const answer = async (url: string) => {
      const res = await fetch(`${base}${url}`);
      return { status: res.status, code: ((await res.json()) as { error?: { code?: string } }).error?.code };
    };
    for (const url of ["/api/v1/artifacts/raw?p=/nope", "/api/v1/skills/nope/resource?rel=a.png"]) {
      const held = await answer(`${url}&token=${device.token}`);
      expect(["unauthorized", "scope_required", "owner_only"], `${url} ${String(held.code)}`).not.toContain(
        held.code,
      );
    }
    const monitorOnly = pair(["monitor"]);
    for (const url of ["/api/v1/artifacts/raw?p=/nope", "/api/v1/skills/nope/resource?rel=a.png"]) {
      expect(await answer(`${url}&token=${monitorOnly.token}`), url).toEqual({
        status: 403,
        code: "scope_required",
      });
    }
    // Nowhere else.
    const queryOnly = (url: string, method = "GET") => fetch(`${base}${url}`, { method });
    expect((await queryOnly(`/api/v1/stream-tickets?token=${token}`, "POST")).status).toBe(401);
    expect((await queryOnly(`/api/v1/runs?token=${token}`)).status).toBe(401);
  });

  it("C32 live tickets are bounded per principal", async () => {
    const heavy = pair(["monitor"]);
    const light = pair(["monitor"]);
    const minted: string[] = [];
    for (let i = 0; i < TICKETS_PER_PRINCIPAL; i++) {
      minted.push(await ticketOf(as(heavy.token), { target: "events" }));
    }
    const over = await mint(as(heavy.token), { target: "events" });
    expect(over.statusCode).toBe(429);
    expect(errorOf(over).code).toBe("too_many_requests");
    // Another principal, and the owner, are not held back by it.
    expect((await mint(as(light.token), { target: "events" })).statusCode).toBe(200);
    expect((await mint(owner(), { target: "events" })).statusCode).toBe(200);
    // A ticket that was used no longer counts.
    const used = await open(`${base}/api/v1/events?ticket=${minted[0]}`);
    expect(used.status).toBe(200);
    used.close();
    expect((await mint(as(heavy.token), { target: "events" })).statusCode).toBe(200);
    expect((await mint(as(heavy.token), { target: "events" })).statusCode).toBe(429);
    // Neither does one that ran out.
    vi.useFakeTimers({ toFake: ["Date"], now: Date.now() });
    vi.setSystemTime(Date.now() + TICKET_TTL_MS + 1);
    expect((await mint(as(heavy.token), { target: "events" })).statusCode).toBe(200);
  });

  it("C33 the ticket never reaches the request log", async () => {
    expect(safeUrl("/api/events?ticket=tk_abc&since=3")).toBe("/api/events?ticket=[REDACTED]&since=3");
    expect(safeUrl("/api/events?since=3&ticket=tk_abc")).toBe("/api/events?since=3&ticket=[REDACTED]");
    expect(safeUrl("/api/events?since=3&token=abc")).toBe("/api/events?since=3&token=[REDACTED]");
    const secret = "tk_neverlogthisticketvalue00000001";
    // On the stream itself: a refused presentation is logged like any other request, and a stream that opens is hijacked
    // (and is not), so both leave the log without the value.
    const live = await ticketOf(owner(), { target: "events" });
    const opened = await open(`${base}/api/v1/events?ticket=${live}`);
    expect(opened.status).toBe(200);
    opened.close();
    const refused = await fetch(`${base}/api/v1/events?ticket=${secret}`);
    expect(refused.status).toBe(401);
    await refused.text();
    const runStream = await fetch(`${base}/api/v1/runs/${crypto.randomUUID()}/stream?ticket=${secret}x`);
    expect(runStream.status).toBe(401);
    await runStream.text();
    await new Promise((r) => setTimeout(r, 200));
    const log = fs.readFileSync(path.join(ctx.paths.logs, "api.jsonl"), "utf8");
    expect(log).toContain("/api/events?ticket=[REDACTED]");
    expect(log).not.toContain(secret);
    expect(log).not.toContain(live);
  });
});

describe("S5 the ticket store, on its own layer", () => {
  const key = ticketKey("/api/runs/:id/stream", { id: "a" });
  const owner: Principal = { kind: "owner" };
  const device: Principal = { kind: "device", deviceId: "d1" };

  it("C30 a ticket is good once, for its stream and its life; a wrong presentation spends it", () => {
    const store = new TicketStore();
    const made = store.mint(device, key)!;
    expect(made.ticket).toMatch(/^tk_[A-Za-z0-9_-]{32}$/);
    // Presented at another stream: refused, and gone for the right one too.
    expect(store.redeem(made.ticket, ticketKey("/api/runs/:id/stream", { id: "b" }))).toBeNull();
    expect(store.redeem(made.ticket, key)).toBeNull();
    // Right stream, once.
    const good = store.mint(device, key)!;
    expect(store.redeem(good.ticket, key)).toEqual(device);
    expect(store.redeem(good.ticket, key)).toBeNull();
    // After its life.
    const old = store.mint(owner, key)!;
    vi.useFakeTimers({ toFake: ["Date"], now: Date.now() });
    vi.setSystemTime(Date.now() + TICKET_TTL_MS + 1);
    expect(store.redeem(old.ticket, key)).toBeNull();
    vi.useRealTimers();
    // The feed's key is not a run's.
    expect(ticketKey("/api/events", {})).not.toBe(ticketKey("/api/runs/:id/stream", {}));
    // The cap is per principal, counted on live tickets.
    const capped = new TicketStore();
    for (let i = 0; i < TICKETS_PER_PRINCIPAL; i++) expect(capped.mint(device, key)).not.toBeNull();
    expect(capped.mint(device, key)).toBeNull();
    expect(capped.mint(owner, key)).not.toBeNull();
  });
});
