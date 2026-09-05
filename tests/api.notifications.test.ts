import { describe, expect, it, beforeAll, afterAll } from "vitest";
import type { FastifyInstance } from "fastify";
import { events } from "@mordomo/core";
import { AppContext } from "../apps/api/src/context.js";
import { buildServer } from "../apps/api/src/server.js";
import { makeTempHome } from "./helpers.js";

/** The persisted inbox over HTTP: bus events become rows; list, read, delete. */

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

describe("notifications API", () => {
  it("records an approval request from the bus and serves it", async () => {
    events.emit("approval.requested", { id: "ap-1", kind: "write_run", description: "Write to notes.md" });
    const res = await app.inject({ method: "GET", url: "/api/notifications", headers: auth() });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      items: Array<{ id: string; kind: string; approvalId: string | null; read: boolean }>;
      unread: number;
    };
    const row = body.items.find((i) => i.approvalId === "ap-1");
    expect(row).toBeDefined();
    expect(row!.id.startsWith("n_")).toBe(true);
    expect(row!.kind).toBe("approval");
    expect(row!.read).toBe(false);
    expect(body.unread).toBeGreaterThanOrEqual(1);
  });

  it("marks rows read by id and all at once", async () => {
    events.emit("budget.crossed", { level: 80, day: "2026-09-04", spentUsd: 8, budgetUsd: 10 });
    const list = (
      await app.inject({ method: "GET", url: "/api/notifications?unread=true", headers: auth() })
    ).json() as {
      items: Array<{ id: string }>;
    };
    expect(list.items.length).toBeGreaterThanOrEqual(2);
    const one = await app.inject({
      method: "POST",
      url: "/api/notifications/read",
      headers: auth(),
      payload: { ids: [list.items[0]!.id] },
    });
    expect(one.json()).toEqual({ updated: 1 });
    const all = await app.inject({
      method: "POST",
      url: "/api/notifications/read",
      headers: auth(),
      payload: { all: true },
    });
    expect((all.json() as { updated: number }).updated).toBeGreaterThanOrEqual(1);
    const after = (
      await app.inject({ method: "GET", url: "/api/notifications", headers: auth() })
    ).json() as { unread: number };
    expect(after.unread).toBe(0);
  });

  it("rejects an empty read request and deletes a row", async () => {
    const bad = await app.inject({
      method: "POST",
      url: "/api/notifications/read",
      headers: auth(),
      payload: {},
    });
    expect(bad.statusCode).toBe(400);
    const list = (await app.inject({ method: "GET", url: "/api/notifications", headers: auth() })).json() as {
      items: Array<{ id: string }>;
    };
    const id = list.items[0]!.id;
    const del = await app.inject({ method: "DELETE", url: `/api/notifications/${id}`, headers: auth() });
    expect(del.json()).toEqual({ deleted: true });
    const again = await app.inject({ method: "DELETE", url: `/api/notifications/${id}`, headers: auth() });
    expect(again.statusCode).toBe(404);
  });

  it("refuses without the local token", async () => {
    const res = await app.inject({ method: "GET", url: "/api/notifications" });
    expect(res.statusCode).toBe(401);
  });
});
