import { describe, expect, it, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { FastifyInstance } from "fastify";
import { AppContext } from "../apps/api/src/context.js";
import { buildServer } from "../apps/api/src/server.js";
import { FAKE_BIN, FAKE_CLIS_RUNNABLE, makeTempHome, withFakeBinPath } from "./helpers.js";

/**
 * Security profiles are a real policy (audit item 39): read_only refuses
 * write runs, review_before_write turns them into approvals that launch the
 * run when approved, and routines only write under approved_automation.
 */
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

let ctx: AppContext;
let app: FastifyInstance;
let token: string;
let cleanup: () => void;
let restorePath: () => void;

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
  ctx.settingsStore.save(settings);
  ctx.reloadAdapters();
  token = ctx.token();
  app = await buildServer(ctx);
});

afterAll(async () => {
  await ctx.runs.shutdown(2000);
  await app.close();
  ctx.close();
  restorePath();
  cleanup();
});

const auth = () => ({ "x-mordomo-token": token, "content-type": "application/json" });
const setProfile = (securityProfile: string) => ctx.settingsStore.update({ securityProfile } as never);

describe("security profiles", () => {
  it("read_only refuses write runs with 403", async () => {
    setProfile("read_only");
    const res = await app.inject({
      method: "POST",
      url: "/api/runs",
      headers: auth(),
      payload: { prompt: "touch it", mode: "write" },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe("profile_refused");
  });

  it("review_before_write creates an approval instead of a run, and approving launches it", async () => {
    setProfile("review_before_write");
    const res = await app.inject({
      method: "POST",
      url: "/api/runs",
      headers: auth(),
      payload: { prompt: "change something", mode: "write" },
    });
    expect(res.statusCode).toBe(202);
    const body = res.json() as {
      runId: string | null;
      status: string;
      pendingApproval: { id: string; kind: string };
    };
    expect(body.runId).toBeNull();
    expect(body.status).toBe("waiting_approval");
    expect(body.pendingApproval.kind).toBe("write_run");
    expect(ctx.runs.list({ limit: 50 }).some((r) => r.promptSummary.includes("change something"))).toBe(
      false,
    );

    const pending = await app.inject({ method: "GET", url: "/api/approvals", headers: auth() });
    expect((pending.json() as Array<{ id: string }>).some((a) => a.id === body.pendingApproval.id)).toBe(
      true,
    );

    const resolved = await app.inject({
      method: "POST",
      url: `/api/approvals/${body.pendingApproval.id}/resolve`,
      headers: auth(),
      payload: { decision: "approved" },
    });
    expect(resolved.statusCode).toBe(200);
    const runId = (resolved.json() as { runId: string | null }).runId;
    expect(runId).toMatch(/^[0-9a-f-]{36}$/);
    const run = ctx.runs.get(runId!);
    expect(run?.permissionProfile).toBe("review_before_write");
  });

  it("denying a write_run approval launches nothing", async () => {
    setProfile("review_before_write");
    const res = await app.inject({
      method: "POST",
      url: "/api/runs",
      headers: auth(),
      payload: { prompt: "denied one", mode: "write" },
    });
    const id = (res.json() as { pendingApproval: { id: string } }).pendingApproval.id;
    const resolved = await app.inject({
      method: "POST",
      url: `/api/approvals/${id}/resolve`,
      headers: auth(),
      payload: { decision: "denied" },
    });
    expect((resolved.json() as { runId: string | null; status: string }).runId).toBeNull();
    expect(ctx.runs.list({ limit: 50 }).some((r) => r.promptSummary.includes("denied one"))).toBe(false);
  });

  it("controlled_write launches write runs immediately", async () => {
    setProfile("controlled_write");
    const res = await app.inject({
      method: "POST",
      url: "/api/runs",
      headers: auth(),
      payload: { prompt: "apply now", mode: "write" },
    });
    expect(res.statusCode).toBe(200);
    expect((res.json() as { runId: string }).runId).toMatch(/^[0-9a-f-]{36}$/);
  });

  it.skipIf(!FAKE_CLIS_RUNNABLE)("routines write only under approved_automation", async () => {
    ctx.routines.save({
      ...ctx.routines.get("daily-workspace-digest")!,
      id: "write-routine",
      name: "write routine",
      skillSlug: null,
      prompt: "write a note",
      profile: "controlled_write",
      enabled: false,
    });
    setProfile("controlled_write");
    const first = await ctx.scheduler.fire("write-routine", { reason: "manual" });
    await ctx.scheduler.drain();
    expect(ctx.runs.get(first.runId)?.permissionProfile).toBe("read_only");

    setProfile("approved_automation");
    const second = await ctx.scheduler.fire("write-routine", { reason: "manual" });
    await ctx.scheduler.drain();
    expect(ctx.runs.get(second.runId)?.permissionProfile).toBe("controlled_write");
  });
});
