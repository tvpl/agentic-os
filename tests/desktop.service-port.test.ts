import { afterEach, beforeAll, afterAll, describe, expect, it, vi } from "vitest";
import crypto from "node:crypto";
import type { FastifyInstance } from "fastify";
import { LAUNCH_SECRET_MIN_LENGTH, startServer, type ServerHandle } from "../apps/api/src/server.js";
import { AppContext } from "../apps/api/src/context.js";
import { buildServer } from "../apps/api/src/server.js";
import { makeTempHome } from "./helpers.js";

/**
 * distribuicao, F5 of the first verification round: a desktop shell's service listens on a port the system gave it
 * (`--port 0`), and every address it hands out must name that port, not `settings.port`: the pairing address, the links
 * of the Telegram messages, the run-API and broker callbacks (`servicePort()`).
 */

const TOKEN_ENV = "MORDOMO_TEST_SERVICE_PORT_TELEGRAM";

describe("servicePort(): the bound port once the listener has one, the configured one before", () => {
  let ctx: AppContext;
  let cleanup: () => void;
  beforeAll(() => {
    const tmp = makeTempHome();
    cleanup = tmp.cleanup;
    ctx = new AppContext(tmp.paths.home);
  });
  afterAll(() => {
    ctx.close();
    cleanup();
  });

  it("C22 before any listener it is settings.port; after one it is the bound port", () => {
    expect(ctx.boundPort).toBeNull();
    expect(ctx.servicePort()).toBe(ctx.settings().port);
    ctx.boundPort = 42763;
    expect(ctx.servicePort()).toBe(42763);
    expect(ctx.servicePort()).not.toBe(ctx.settings().port);
    ctx.boundPort = null;
    expect(ctx.servicePort()).toBe(ctx.settings().port);
  });
});

describe("a sidecar on a port the system chose: every address the service hands out names that port", () => {
  let handle: ServerHandle;
  let app: FastifyInstance;
  let cleanup: () => void;
  let token: string;

  beforeAll(async () => {
    const tmp = makeTempHome();
    cleanup = tmp.cleanup;
    // the settings carry another port (and Telegram, whose bot token is in the environment of this test only)
    const seed = new AppContext(tmp.paths.home);
    const settings = seed.settings();
    settings.setupCompleted = true;
    settings.port = 4777;
    settings.channels.telegram.enabled = true;
    settings.channels.telegram.botTokenEnv = TOKEN_ENV;
    settings.channels.telegram.chatId = "12345";
    seed.settingsStore.save(settings);
    seed.close();
    handle = await startServer(tmp.paths.home, {
      port: 0,
      launchSecret: crypto.randomBytes(LAUNCH_SECRET_MIN_LENGTH).toString("base64url"),
    });
    app = handle.app;
    token = handle.ctx.token();
  });
  afterAll(async () => {
    await handle.close();
    cleanup();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env[TOKEN_ENV];
  });

  const auth = () => ({ "x-mordomo-token": token });
  const sentText = (fetchMock: ReturnType<typeof vi.fn>): string => {
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    return (JSON.parse(String(init.body)) as { text: string }).text;
  };
  const stubTelegram = () => {
    process.env[TOKEN_ENV] = "bot-secret-token";
    const fetchMock = vi.fn(
      async () => new Response(JSON.stringify({ ok: true, result: {} }), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
  };

  it("C22 the listener is not on settings.port, and the context knows where it is", () => {
    const bound = handle.listeners.plain.port;
    expect(bound).toBeGreaterThan(0);
    expect(bound).not.toBe(4777);
    expect(handle.ctx.servicePort()).toBe(bound);
  });

  it("C22 pair.start answers the bound port, the address a device is told to open", async () => {
    const res = await app.inject({ method: "POST", url: "/api/pair/start", headers: auth(), payload: {} });
    expect(res.statusCode).toBe(200);
    expect((res.json() as { port: number }).port).toBe(handle.listeners.plain.port);
  });

  it("C22 the Telegram test message links to the bound port", async () => {
    const fetchMock = stubTelegram();
    const res = await app.inject({ method: "POST", url: "/api/channels/telegram/test", headers: auth() });
    expect(res.statusCode).toBe(200);
    expect(sentText(fetchMock)).toContain(
      `http://127.0.0.1:${handle.listeners.plain.port}/settings?tab=channels`,
    );
    expect(sentText(fetchMock)).not.toContain(":4777");
  });

  it("C22 an alert delivered by the engine's Telegram channel links to the bound port", async () => {
    const fetchMock = stubTelegram();
    handle.ctx.notifications.add({
      kind: "system",
      tone: "warn",
      title: "Routine went quiet",
      body: "digest",
      href: "/routines",
    });
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(sentText(fetchMock)).toContain(`http://127.0.0.1:${handle.listeners.plain.port}/routines`);
    expect(sentText(fetchMock)).not.toContain(":4777");
  });
});

describe("a service that was not given a port keeps the configured one in what it hands out", () => {
  it("C22 buildServer without a listener answers settings.port", async () => {
    const tmp = makeTempHome();
    const ctx = new AppContext(tmp.paths.home);
    const settings = ctx.settings();
    settings.setupCompleted = true;
    ctx.settingsStore.save(settings);
    const app = await buildServer(ctx);
    try {
      const res = await app.inject({
        method: "POST",
        url: "/api/pair/start",
        headers: { "x-mordomo-token": ctx.token() },
        payload: {},
      });
      expect((res.json() as { port: number }).port).toBe(ctx.settings().port);
    } finally {
      await app.close();
      ctx.close();
      tmp.cleanup();
    }
  });
});
