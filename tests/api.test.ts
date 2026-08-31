import { describe, expect, it, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { FastifyInstance } from "fastify";
import { AppContext } from "../apps/api/src/context.js";
import { buildServer } from "../apps/api/src/server.js";
import { FAKE_BIN, makeTempHome, withFakeBinPath } from "./helpers.js";

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
  // Seed the temp home with real repo data (skills, routines, connectors)
  for (const dir of ["skills", "routines", "connectors"]) {
    fs.cpSync(path.join(repoRoot, dir), path.join(tmp.paths.home, dir), { recursive: true });
  }
  const workspace = path.join(tmp.paths.home, "ws");
  fs.mkdirSync(workspace);
  fs.writeFileSync(path.join(workspace, "plan.md"), "# Plano\nOrçamento trimestral do projeto Alfa.\n");
  fs.writeFileSync(path.join(workspace, ".env"), "TOKEN=hidden\n");

  ctx = new AppContext(tmp.paths.home);
  const settings = ctx.settings();
  settings.providers.claude.enabled = true;
  settings.providers.claude.binaryPath = path.join(FAKE_BIN, "claude");
  settings.indexedFolders = [{ path: workspace, area: "Projetos", enabled: true }];
  settings.setupCompleted = true;
  ctx.settingsStore.save(settings);
  // Recreate adapters with the pinned fake binary
  (ctx.adapters.claude as unknown as { opts: { binaryPath: string } }) = ctx.adapters.claude;
  token = ctx.token();
  app = await buildServer(ctx);
});

afterAll(async () => {
  await app.close();
  ctx.close();
  restorePath();
  cleanup();
});

const auth = () => ({ "x-mordomo-token": token });

describe("security layer", () => {
  it("rejects API calls without the local token", async () => {
    const res = await app.inject({ method: "GET", url: "/api/settings" });
    expect(res.statusCode).toBe(401);
  });

  it("rejects foreign Host headers (DNS rebinding)", async () => {
    const res = await app.inject({ method: "GET", url: "/api/meta", headers: { host: "evil.example.com" } });
    expect(res.statusCode).toBe(403);
  });

  it("serves /api/meta without token (branding only) and sets security headers", async () => {
    const res = await app.inject({ method: "GET", url: "/api/meta" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ name: "MordomoOS" });
    expect(res.headers["x-frame-options"]).toBe("DENY");
    expect(res.headers["content-security-policy"]).toContain("default-src 'self'");
  });
});

describe("settings & providers", () => {
  it("round-trips settings and validates bad ports", async () => {
    const get = await app.inject({ method: "GET", url: "/api/settings", headers: auth() });
    expect(get.statusCode).toBe(200);
    const bad = await app.inject({ method: "PUT", url: "/api/settings", headers: auth(), payload: { port: 80 } });
    expect(bad.statusCode).toBe(500); // zod rejects privileged ports (<1024)
    const ok = await app.inject({ method: "PUT", url: "/api/settings", headers: auth(), payload: { accentColor: "#22c55e" } });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().settings.accentColor).toBe("#22c55e");
  });

  it("gates exposing the server beyond localhost behind an approval", async () => {
    const res = await app.inject({ method: "PUT", url: "/api/settings", headers: auth(), payload: { bindAddress: "0.0.0.0" } });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.settings.bindAddress).toBe("127.0.0.1"); // unchanged!
    expect(body.pendingApproval.kind).toBe("expose_port");
    const deny = await app.inject({
      method: "POST",
      url: `/api/approvals/${body.pendingApproval.id}/resolve`,
      headers: auth(),
      payload: { decision: "denied" },
    });
    expect(deny.json().status).toBe("denied");
  });

  it("reports provider snapshots with the fake claude healthy", async () => {
    const res = await app.inject({ method: "GET", url: "/api/providers?force=1", headers: auth() });
    const providers = res.json() as Array<{ id: string; health: { installed: boolean }; enabled: boolean }>;
    const claude = providers.find((s) => s.id === "claude")!;
    expect(claude.enabled).toBe(true);
    expect(claude.health.installed).toBe(true);
  });

  it("runs a read-only smoke test", async () => {
    const res = await app.inject({ method: "POST", url: "/api/providers/claude/smoke", headers: auth() });
    expect(res.statusCode).toBe(200);
    expect(res.json().run.status).toBe("done");
  });
});

describe("skills API", () => {
  it("lists the seed catalog", async () => {
    const res = await app.inject({ method: "GET", url: "/api/skills", headers: auth() });
    const skills = res.json() as Array<{ slug: string }>;
    expect(skills.some((s) => s.slug === "workspace-digest")).toBe(true);
  });

  it("runs a skill from the button endpoint and records artifacts", async () => {
    const run = await app.inject({
      method: "POST",
      url: "/api/skills/workspace-digest/run",
      headers: auth(),
      payload: { inputs: { focus: "Projetos" } },
    });
    expect(run.statusCode).toBe(200);
    const { runId } = run.json();
    // Poll until the run finishes (fake CLI is fast)
    let status = "";
    for (let i = 0; i < 50; i++) {
      const r = await app.inject({ method: "GET", url: `/api/runs/${runId}`, headers: auth() });
      status = r.json().run.status;
      if (!["queued", "running"].includes(status)) break;
      await new Promise((r2) => setTimeout(r2, 100));
    }
    expect(status).toBe("done");
    const events = await app.inject({ method: "GET", url: `/api/runs/${runId}`, headers: auth() });
    expect(events.json().events.length).toBeGreaterThan(2);
  });

  it("rejects runs of unknown or disabled providers", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/skills/workspace-digest/run",
      headers: auth(),
      payload: { provider: "codex" },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toContain("not enabled");
  });

  it("creates, favorites and deletes a skill", async () => {
    const create = await app.inject({
      method: "POST",
      url: "/api/skills",
      headers: auth(),
      payload: {
        frontmatter: { name: "Tmp", slug: "tmp-skill", description: "temp" },
        body: "Do something small.",
      },
    });
    expect(create.statusCode).toBe(200);
    const fav = await app.inject({ method: "POST", url: "/api/skills/tmp-skill/favorite", headers: auth() });
    expect(fav.json().favorite).toBe(true);
    const del = await app.inject({ method: "DELETE", url: "/api/skills/tmp-skill", headers: auth() });
    expect(del.json().deleted).toBe("tmp-skill");
  });
});

describe("memory API", () => {
  it("indexes, searches and previews with exclusion protection", async () => {
    const idx = await app.inject({ method: "POST", url: "/api/memory/index", headers: auth() });
    expect(idx.json().stats.added).toBeGreaterThan(0);

    const search = await app.inject({ method: "GET", url: "/api/memory/search?q=trimestral", headers: auth() });
    const hits = search.json() as Array<{ name: string }>;
    expect(hits[0]!.name).toBe("plan.md");

    const graph = await app.inject({ method: "GET", url: "/api/memory/graph", headers: auth() });
    expect(graph.json().nodes.length).toBeGreaterThan(0);

    const ws = ctx.settings().indexedFolders[0]!.path;
    const preview = await app.inject({
      method: "GET",
      url: `/api/memory/preview?p=${encodeURIComponent(path.join(ws, "plan.md"))}`,
      headers: auth(),
    });
    expect(preview.json().kind).toBe("text");

    const blocked = await app.inject({
      method: "GET",
      url: `/api/memory/preview?p=${encodeURIComponent(path.join(ws, ".env"))}`,
      headers: auth(),
    });
    expect(blocked.json().kind).toBe("blocked");

    const outside = await app.inject({
      method: "GET",
      url: `/api/memory/preview?p=${encodeURIComponent("/etc/passwd")}`,
      headers: auth(),
    });
    expect(outside.statusCode).toBe(403);
  });

  it("generates routers", async () => {
    const res = await app.inject({ method: "POST", url: "/api/memory/routers", headers: auth() });
    expect(res.json().written.length).toBeGreaterThan(1);
  });
});

describe("routines API", () => {
  it("lists seed routine as paused and manually test-runs it", async () => {
    const list = await app.inject({ method: "GET", url: "/api/routines", headers: auth() });
    const routine = (list.json() as Array<{ id: string; enabled: boolean }>).find((r) => r.id === "daily-workspace-digest")!;
    expect(routine.enabled).toBe(false);

    const run = await app.inject({ method: "POST", url: "/api/routines/daily-workspace-digest/run", headers: auth() });
    expect(run.statusCode).toBe(200);
    const history = await app.inject({ method: "GET", url: "/api/routines/daily-workspace-digest/history", headers: auth() });
    expect(history.json().length).toBeGreaterThan(0);
  });

  it("toggles a routine and computes next run", async () => {
    const on = await app.inject({ method: "POST", url: "/api/routines/daily-workspace-digest/toggle", headers: auth() });
    expect(on.json().enabled).toBe(true);
    const list = await app.inject({ method: "GET", url: "/api/routines", headers: auth() });
    const routine = (list.json() as Array<{ id: string; nextRunAt: number | null }>).find((r) => r.id === "daily-workspace-digest")!;
    expect(routine.nextRunAt).toBeGreaterThan(Date.now());
    await app.inject({ method: "POST", url: "/api/routines/daily-workspace-digest/toggle", headers: auth() });
  });
});

describe("connectors API", () => {
  it("gates write enablement behind approval", async () => {
    const get = await app.inject({ method: "GET", url: "/api/connectors", headers: auth() });
    const playwright = (get.json() as Array<Record<string, unknown>>).find((c) => c.id === "playwright")!;
    const res = await app.inject({
      method: "PUT",
      url: "/api/connectors/playwright",
      headers: auth(),
      payload: { ...playwright, writeEnabled: true },
    });
    const body = res.json();
    expect(body.connector.writeEnabled).toBe(false);
    expect(body.pendingApproval.kind).toBe("connector_write");
  });

  it("audits without credentials and caps recommendations at 3", async () => {
    const res = await app.inject({ method: "GET", url: "/api/connectors/audit", headers: auth() });
    const report = res.json();
    expect(report.recommendations.length).toBeLessThanOrEqual(3);
  });
});

describe("sync + artifacts + doctor", () => {
  it("plans and applies a sync into a target dir", async () => {
    const target = path.join(ctx.paths.home, "export-target");
    fs.mkdirSync(target, { recursive: true });
    const plan = await app.inject({ method: "GET", url: `/api/sync/plan?target=${encodeURIComponent(target)}`, headers: auth() });
    expect(plan.json().actions.length).toBeGreaterThan(0);
    const apply = await app.inject({ method: "POST", url: "/api/sync/apply", headers: auth(), payload: { target } });
    expect(apply.json().written.length).toBeGreaterThan(0);
    expect(fs.existsSync(path.join(target, "CLAUDE.md"))).toBe(true);
  });

  it("lists recent artifacts and serves them safely", async () => {
    const recent = await app.inject({ method: "GET", url: "/api/artifacts/recent", headers: auth() });
    expect(recent.statusCode).toBe(200);
    const outside = await app.inject({
      method: "GET",
      url: `/api/artifacts/file?p=${encodeURIComponent("/etc/passwd")}`,
      headers: auth(),
    });
    expect(outside.statusCode).toBe(403);
  });

  it("runs the doctor and exports diagnostics without secrets", async () => {
    const doctor = await app.inject({ method: "GET", url: "/api/doctor", headers: auth() });
    expect(doctor.json().checks.length).toBeGreaterThan(5);
    const diag = await app.inject({ method: "GET", url: "/api/diagnostics/export", headers: auth() });
    expect(diag.statusCode).toBe(200);
    expect(diag.body).not.toContain(token);
  });
});
