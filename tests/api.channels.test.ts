import { describe, expect, it, beforeAll, afterAll, beforeEach, afterEach, vi } from "vitest";
import type { FastifyInstance } from "fastify";
import { deliverToTelegram, events, formatNotification, type NotificationRecord } from "@mordomo/core";
import { AppContext } from "../apps/api/src/context.js";
import { buildServer } from "../apps/api/src/server.js";
import { makeTempHome } from "./helpers.js";

/**
 * Telegram delivery (Onda 2, item 4): the test endpoint, the token that lives
 * only in the environment, and the tone gate. `fetch` is stubbed — no test
 * ever talks to api.telegram.org.
 */

const TOKEN_ENV = "MORDOMO_TEST_TELEGRAM_TOKEN";

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
  settings.channels.telegram.enabled = true;
  settings.channels.telegram.botTokenEnv = TOKEN_ENV;
  settings.channels.telegram.chatId = "12345";
  ctx.settingsStore.save(settings);
  token = ctx.token();
  app = await buildServer(ctx);
});

afterAll(async () => {
  await app.close();
  ctx.close();
  cleanup();
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env[TOKEN_ENV];
});

const auth = () => ({ "x-mordomo-token": token });
const okResponse = () => new Response(JSON.stringify({ ok: true, result: {} }), { status: 200 });

const testEndpoint = () =>
  app.inject({ method: "POST", url: "/api/channels/telegram/test", headers: auth() });

describe("POST /api/channels/telegram/test", () => {
  it("sends the message and reports ok", async () => {
    process.env[TOKEN_ENV] = "bot-secret-token";
    const fetchMock = vi.fn(async () => okResponse());
    vi.stubGlobal("fetch", fetchMock);

    const res = await testEndpoint();
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.telegram.org/botbot-secret-token/sendMessage");
    expect(init.method).toBe("POST");
    const body = JSON.parse(String(init.body)) as { chat_id: string; text: string };
    expect(body.chat_id).toBe("12345");
    expect(body.text).toContain("MordomoOS");
    expect(body.text).toContain("http://127.0.0.1:");
  });

  it("explains a missing token without calling out", async () => {
    const fetchMock = vi.fn(async () => okResponse());
    vi.stubGlobal("fetch", fetchMock);
    const body = (await testEndpoint()).json() as { ok: boolean; error?: string };
    expect(body.ok).toBe(false);
    expect(body.error).toContain(TOKEN_ENV);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("reports an HTTP failure and never echoes the token", async () => {
    process.env[TOKEN_ENV] = "bot-secret-token";
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("nope", { status: 401 })),
    );
    const body = (await testEndpoint()).json() as { ok: boolean; error?: string };
    expect(body.ok).toBe(false);
    expect(body.error).toContain("401");
    expect(body.error).not.toContain("bot-secret-token");
  });

  it("reports a Telegram-level rejection (200 with ok:false)", async () => {
    process.env[TOKEN_ENV] = "bot-secret-token";
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify({ ok: false, description: "chat not found" }), { status: 200 }),
      ),
    );
    const body = (await testEndpoint()).json() as { ok: boolean; error?: string };
    expect(body).toEqual({ ok: false, error: "chat not found" });
  });

  it("reports a network failure instead of throwing", async () => {
    process.env[TOKEN_ENV] = "bot-secret-token";
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("getaddrinfo ENOTFOUND api.telegram.org");
      }),
    );
    const res = await testEndpoint();
    expect(res.statusCode).toBe(200);
    expect((res.json() as { ok: boolean }).ok).toBe(false);
  });

  it("refuses without the local token", async () => {
    const res = await app.inject({ method: "POST", url: "/api/channels/telegram/test" });
    expect(res.statusCode).toBe(401);
  });
});

describe("tone gate and message body", () => {
  const row = (tone: NotificationRecord["tone"]): NotificationRecord => ({
    id: "n_1",
    kind: "system",
    tone,
    title: "Run failed",
    body: "workspace-digest",
    href: "/runs/abc",
    approvalId: null,
    runId: "abc",
    ts: Date.now(),
    read: false,
    dedupeKey: null,
  });

  beforeEach(() => {
    process.env[TOKEN_ENV] = "bot-secret-token";
  });

  it("delivers at or above minTone and skips below it", async () => {
    const fetchMock = vi.fn(async () => okResponse());
    const deps = { getSettings: () => ctx.settings(), fetchImpl: fetchMock as unknown as typeof fetch };
    expect(await deliverToTelegram(deps, row("danger"))).toEqual({ ok: true });
    expect(await deliverToTelegram(deps, row("warn"))).toEqual({ ok: true });
    expect((await deliverToTelegram(deps, row("info"))).skipped).toBe("tone");
    expect((await deliverToTelegram(deps, row("ok"))).skipped).toBe("tone");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("skips entirely when the channel is off", async () => {
    const settings = ctx.settings();
    const off = { ...settings, channels: { telegram: { ...settings.channels.telegram, enabled: false } } };
    const result = await deliverToTelegram({ getSettings: () => off }, row("danger"));
    expect(result.skipped).toBe("disabled");
  });

  it("puts the title, the body and the local link in the message", () => {
    const text = formatNotification(row("danger"), 4777);
    expect(text.split("\n")).toEqual(["Run failed", "workspace-digest", "http://127.0.0.1:4777/runs/abc"]);
  });
});

describe("notification.created delivery", () => {
  it("posts a warn row written by the inbox", async () => {
    process.env[TOKEN_ENV] = "bot-secret-token";
    const fetchMock = vi.fn(async () => okResponse());
    vi.stubGlobal("fetch", fetchMock);
    ctx.notifications.add({ kind: "system", tone: "warn", title: "Routine went quiet", body: "digest" });
    // The channel listens on the bus and delivers out of band.
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(events.lastId).toBeGreaterThan(0);
  });
});
