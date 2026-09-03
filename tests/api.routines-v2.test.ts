import { describe, expect, it, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { FastifyInstance } from "fastify";
import { AppContext } from "../apps/api/src/context.js";
import { buildServer } from "../apps/api/src/server.js";
import { FAKE_BIN, makeTempHome, withFakeBinPath } from "./helpers.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..");
const FAKE_MCP = path.join(here, "fixtures", "fake-mcp-server.mjs");

let ctx: AppContext;
let app: FastifyInstance;
let token: string;
let cleanup: () => void;
let restorePath: () => void;
const auth = () => ({ "x-mordomo-token": token });

beforeAll(async () => {
  restorePath = withFakeBinPath();
  const tmp = makeTempHome();
  cleanup = tmp.cleanup;
  for (const dir of ["skills", "routines", "connectors"]) {
    fs.cpSync(path.join(repoRoot, dir), path.join(tmp.paths.home, dir), { recursive: true });
  }
  ctx = new AppContext(tmp.paths.home);
  const settings = ctx.settings();
  settings.providers.claude.enabled = true;
  settings.providers.claude.binaryPath = path.join(FAKE_BIN, "claude");
  settings.setupCompleted = true;
  settings.timezone = "UTC";
  settings.connectors.allowedCommands = [process.execPath];
  ctx.settingsStore.save(settings);
  ctx.reloadAdapters();
  token = ctx.token();
  app = await buildServer(ctx);
});

afterAll(async () => {
  await app.close();
  ctx.close();
  restorePath();
  cleanup();
});

describe("routines v2 API", () => {
  it("exposes the v2 fields and the effective runner in the list", async () => {
    const res = await app.inject({ method: "GET", url: "/api/routines", headers: auth() });
    const list = res.json() as Array<Record<string, unknown>>;
    const heartbeat = list.find((r) => r.id === "service-heartbeat")!;
    expect(heartbeat.kind).toBe("heartbeat");
    expect(heartbeat.context).toBe("isolated");
    expect(heartbeat.runner).toBe("local");
    expect(heartbeat.firedToday).toBe(false);
    expect((heartbeat.heartbeat as { intervalMinutes: number }).intervalMinutes).toBe(60);
  });

  it("creates an interval routine and computes nextRunAt for it", async () => {
    const payload = {
      id: "api-every",
      name: "Every 15 minutes",
      prompt: "check things",
      kind: "every",
      every: { value: 15, unit: "minutes" },
      enabled: true,
    };
    const created = await app.inject({ method: "POST", url: "/api/routines", headers: auth(), payload });
    expect(created.statusCode).toBe(200);
    expect(created.json().kind).toBe("every");

    const list = await app.inject({ method: "GET", url: "/api/routines", headers: auth() });
    const row = (list.json() as Array<{ id: string; nextRunAt: number | null }>).find((r) => r.id === "api-every")!;
    expect(row.nextRunAt).toBeGreaterThan(Date.now());
    expect(row.nextRunAt).toBeLessThanOrEqual(Date.now() + 15 * 60_000);
  });

  it("rejects a routine whose kind is missing its fields, and webhook delivery while the flag is off", async () => {
    const bad = await app.inject({
      method: "POST",
      url: "/api/routines",
      headers: auth(),
      payload: { id: "api-bad-at", name: "Bad", prompt: "x", kind: "at", at: null },
    });
    expect(bad.statusCode).toBe(400);

    const hook = await app.inject({
      method: "POST",
      url: "/api/routines",
      headers: auth(),
      payload: {
        id: "api-hook",
        name: "Hook",
        prompt: "x",
        kind: "every",
        every: { value: 30, unit: "minutes" },
        delivery: "webhook",
        webhookUrl: "https://example.test/hook",
      },
    });
    expect(hook.statusCode).toBe(400);
    expect(hook.json().message ?? hook.json().error).toMatch(/allowWebhooks/);

    // With the settings flag on, the same routine is accepted.
    const settings = ctx.settings();
    settings.routines.allowWebhooks = true;
    ctx.settingsStore.save(settings);
    const ok = await app.inject({
      method: "POST",
      url: "/api/routines",
      headers: auth(),
      payload: {
        id: "api-hook",
        name: "Hook",
        prompt: "x",
        kind: "every",
        every: { value: 30, unit: "minutes" },
        delivery: "webhook",
        webhookUrl: "https://example.test/hook",
      },
    });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().delivery).toBe("webhook");
    settings.routines.allowWebhooks = false;
    ctx.settingsStore.save(settings);
  });

  it("summarises today's routines per runner and kind", async () => {
    const res = await app.inject({ method: "GET", url: "/api/routines/summary", headers: auth() });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { firedToday: number; totalToday: number; byRunner: Record<string, number>; byKind: Record<string, number> };
    expect(typeof body.firedToday).toBe("number");
    expect(typeof body.totalToday).toBe("number");
    expect(body.byRunner.local).toBeGreaterThan(0);
    expect(body.byKind.heartbeat).toBeGreaterThan(0);
  });

  it("lists silent routines for a window", async () => {
    const res = await app.inject({ method: "GET", url: "/api/routines/silent?days=30", headers: auth() });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { days: number; routines: Array<{ id: string; reason: string }> };
    expect(body.days).toBe(30);
    expect(body.routines.map((r) => r.id)).toContain("service-heartbeat");
    expect(body.routines.find((r) => r.id === "service-heartbeat")!.reason).toBe("never_fired");

    const bad = await app.inject({ method: "GET", url: "/api/routines/silent?days=0", headers: auth() });
    expect(bad.statusCode).toBe(400);
  });
});

describe("connector data API", () => {
  const mcpConnector = {
    id: "fake-mcp-cal",
    name: "Fake calendar",
    kind: "mcp",
    origin: "test",
    maintainer: "test",
    dataMapping: {
      transport: "mcp",
      command: process.execPath,
      args: [FAKE_MCP, "ok"],
      env: [],
      tools: {
        list: {
          name: "list_events",
          args: { timeMin: "{todayStart}" },
          parse: "json",
          path: "events",
          fields: { id: "id", title: "summary", ts: "start", tag: "calendar" },
        },
      },
      install: "npm i -g fake-mcp",
      setup: [],
    },
  };

  it("reads a connector through the MCP client and caches the result", async () => {
    const created = await app.inject({ method: "POST", url: "/api/connectors", headers: auth(), payload: mcpConnector });
    expect(created.statusCode).toBe(200);

    const first = await app.inject({ method: "GET", url: "/api/connectors/fake-mcp-cal/data", headers: auth() });
    expect(first.statusCode).toBe(200);
    const a = first.json() as { status: string; syncedAt: number; items: Array<{ title: string }>; summary: Record<string, number> };
    expect(a.status).toBe("ok");
    expect(a.items.map((i) => i.title)).toEqual(["Standup", "Design review", "Dentist"]);
    expect(a.summary).toMatchObject({ total: 3, work: 2, personal: 1 });

    // Inside the TTL the same payload comes back untouched.
    const second = await app.inject({ method: "GET", url: "/api/connectors/fake-mcp-cal/data", headers: auth() });
    expect(second.json().syncedAt).toBe(a.syncedAt);

    // ?refresh=1 bypasses the cache.
    await new Promise((r) => setTimeout(r, 5));
    const third = await app.inject({ method: "GET", url: "/api/connectors/fake-mcp-cal/data?refresh=1", headers: auth() });
    expect(third.json().syncedAt).toBeGreaterThan(a.syncedAt);
  }, 30_000);

  it("records lastUsedAt on the connector after a successful read", async () => {
    const list = await app.inject({ method: "GET", url: "/api/connectors", headers: auth() });
    const row = (list.json() as Array<{ id: string; lastUsedAt: number | null }>).find((c) => c.id === "fake-mcp-cal")!;
    expect(row.lastUsedAt).toBeGreaterThan(0);
  });

  it("answers not_configured with a setup checklist for a seed connector without credentials", async () => {
    const res = await app.inject({ method: "GET", url: "/api/connectors/calendar-google/data", headers: auth() });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { status: string; items: unknown[]; setup: string[]; message: string };
    expect(body.status).toBe("not_configured");
    expect(body.items).toEqual([]);
    expect(body.setup.join(" ")).toMatch(/GOOGLE_OAUTH_CREDENTIALS|npx|allowlist/i);
  }, 30_000);

  it("exposes the setup checklist on its own, and 404s for an unknown connector", async () => {
    const steps = await app.inject({ method: "GET", url: "/api/connectors/email-gmail/setup", headers: auth() });
    expect(steps.statusCode).toBe(200);
    expect((steps.json() as { steps: string[] }).steps.join(" ")).toContain("GMAIL_CREDENTIALS_PATH");

    const missing = await app.inject({ method: "GET", url: "/api/connectors/nope/data", headers: auth() });
    expect(missing.statusCode).toBe(404);
  });
});

describe("settings schema (cross-frontier requests)", () => {
  it("keeps per-widget config inside dashboardLayout across a round-trip", async () => {
    const layout = { today: { x: 0, y: 0, w: 6, h: 6, visible: true, config: { zones: ["UTC", "America/Sao_Paulo"], limit: 5 } } };
    const put = await app.inject({ method: "PUT", url: "/api/settings", headers: auth(), payload: { dashboardLayout: layout } });
    expect(put.statusCode).toBe(200);
    const res = await app.inject({ method: "GET", url: "/api/settings", headers: auth() });
    const saved = (res.json() as { dashboardLayout: Record<string, { config?: Record<string, unknown> }> }).dashboardLayout;
    expect(saved.today!.config).toEqual({ zones: ["UTC", "America/Sao_Paulo"], limit: 5 });
  });

  it("exposes themePreset with the HUD default and accepts the four presets", async () => {
    const res = await app.inject({ method: "GET", url: "/api/settings", headers: auth() });
    expect(res.json().themePreset).toBe("hud-orange");
    for (const preset of ["forest", "ocean", "mono", "hud-orange"]) {
      const put = await app.inject({ method: "PUT", url: "/api/settings", headers: auth(), payload: { themePreset: preset } });
      expect(put.statusCode).toBe(200);
      expect(put.json().themePreset ?? preset).toBe(preset);
    }
    const bad = await app.inject({ method: "PUT", url: "/api/settings", headers: auth(), payload: { themePreset: "neon" } });
    expect(bad.statusCode).toBe(400);
  });
});
