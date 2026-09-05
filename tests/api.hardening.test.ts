import { describe, expect, it, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { FastifyInstance } from "fastify";
import { events } from "@mordomo/core";
import { AppContext, readRestorePending } from "../apps/api/src/context.js";
import { buildServer, isAllowedHost, safeUrl, tokenMatches } from "../apps/api/src/server.js";
import { deepMergeSettings, SettingsPatchSchema } from "../apps/api/src/routes/system.js";
import { FAKE_BIN, makeTempHome, withFakeBinPath } from "./helpers.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

let ctx: AppContext;
let app: FastifyInstance;
let token: string;
let home: string;
let workspace: string;
let cleanup: () => void;
let restorePath: () => void;

beforeAll(async () => {
  restorePath = withFakeBinPath();
  const tmp = makeTempHome("mordomo-hardening-");
  cleanup = tmp.cleanup;
  home = tmp.paths.home;
  for (const dir of ["skills", "routines", "connectors"]) {
    fs.cpSync(path.join(repoRoot, dir), path.join(home, dir), { recursive: true });
  }
  workspace = path.join(home, "ws");
  fs.mkdirSync(workspace);
  fs.writeFileSync(path.join(workspace, "notes.md"), "# Notes\n");

  ctx = new AppContext(home);
  const settings = ctx.settings();
  settings.providers.claude.enabled = true;
  settings.providers.claude.binaryPath = path.join(FAKE_BIN, "claude");
  settings.indexedFolders = [{ path: workspace, area: "Projetos", enabled: true }];
  settings.setupCompleted = true;
  ctx.settingsStore.save(settings);
  ctx.reloadAdapters();
  token = ctx.token();
  app = await buildServer(ctx);
  // A route that throws an internal error, to assert the 500 envelope hides details.
  app.get("/api/__boom", async () => {
    throw new Error(`secret path ${home}/config/token`);
  });
});

afterAll(async () => {
  await app.close();
  ctx.close();
  restorePath();
  cleanup();
});

const auth = () => ({ "x-mordomo-token": token });

// ---------------------------------------------------------------------------
describe("route param validation (audit #1)", () => {
  it("DELETE /api/routines/..%2Fx → 400 and touches no file", async () => {
    const victim = path.join(home, "x.json");
    fs.writeFileSync(victim, "{}");
    const res = await app.inject({ method: "DELETE", url: "/api/routines/..%2Fx", headers: auth() });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe("validation");
    expect(fs.existsSync(victim)).toBe(true);
    const enc = await app.inject({ method: "DELETE", url: "/api/routines/%2E%2E%2Fx", headers: auth() });
    expect(enc.statusCode).toBe(400);
    expect(fs.existsSync(victim)).toBe(true);
  });

  it("rejects traversal ids on connectors and skills too", async () => {
    const victim = path.join(home, "victim.json");
    fs.writeFileSync(victim, "{}");
    for (const url of ["/api/connectors/..%2Fvictim", "/api/skills/..%2Fvictim", "/api/routines/a%2Fb"]) {
      const res = await app.inject({ method: "DELETE", url, headers: auth() });
      expect(res.statusCode, url).toBe(400);
    }
    const put = await app.inject({
      method: "PUT",
      url: "/api/connectors/..%2Fvictim",
      headers: auth(),
      payload: {},
    });
    expect(put.statusCode).toBe(400);
    expect(fs.existsSync(victim)).toBe(true);
    const tooLong = "a".repeat(82);
    const long = await app.inject({ method: "GET", url: `/api/skills/${tooLong}`, headers: auth() });
    expect(long.statusCode).toBe(400);
    const notFound = await app.inject({ method: "GET", url: "/api/skills/does-not-exist", headers: auth() });
    expect(notFound.statusCode).toBe(404);
    expect(notFound.json().error.code).toBe("not_found");
  });

  it("rejects non-uuid run and approval ids", async () => {
    expect((await app.inject({ method: "GET", url: "/api/runs/..%2Fx", headers: auth() })).statusCode).toBe(
      400,
    );
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/api/approvals/nope/resolve",
          headers: auth(),
          payload: { decision: "denied" },
        })
      ).statusCode,
    ).toBe(400);
    expect(
      (await app.inject({ method: "POST", url: "/api/backups/..%2Fetc/restore", headers: auth() }))
        .statusCode,
    ).toBe(400);
  });
});

// ---------------------------------------------------------------------------
describe("error envelope (audit #7)", () => {
  it("zod errors → 400 { error: { code: validation, issues } } + message", async () => {
    const res = await app.inject({
      method: "PUT",
      url: "/api/settings",
      headers: auth(),
      payload: { port: 80 },
    });
    expect(res.statusCode).toBe(400);
    const body = res.json();
    expect(body.error.code).toBe("validation");
    expect(body.error.message).toContain("port");
    expect(Array.isArray(body.error.issues)).toBe(true);
    expect(body.message).toBe(body.error.message);
  });

  it("unknown errors → 500 without leaking the message", async () => {
    const res = await app.inject({ method: "GET", url: "/api/__boom", headers: auth() });
    expect(res.statusCode).toBe(500);
    expect(res.json()).toEqual({
      error: { code: "internal", message: "Internal error" },
      message: "Internal error",
    });
    expect(res.body).not.toContain("secret path");
    expect(res.body).not.toContain(home);
  });

  it("statusCode errors keep their status and a code", async () => {
    const res = await app.inject({ method: "GET", url: "/api/routines/nope/history", headers: auth() });
    expect([200, 404]).toContain(res.statusCode);
    const nf = await app.inject({ method: "POST", url: "/api/routines/nope/toggle", headers: auth() });
    expect(nf.statusCode).toBe(404);
    expect(nf.json().error).toEqual({ code: "not_found", message: "Routine not found" });
    const unknown = await app.inject({ method: "GET", url: "/api/nope", headers: auth() });
    expect(unknown.statusCode).toBe(404);
    expect(unknown.json().error.code).toBe("not_found");
  });
});

// ---------------------------------------------------------------------------
describe("host and token checks (audit #8)", () => {
  it("parses Host with new URL: IPv6 brackets ok, foreign/missing rejected", () => {
    expect(isAllowedHost("127.0.0.1:4777")).toBe(true);
    expect(isAllowedHost("localhost")).toBe(true);
    expect(isAllowedHost("LOCALHOST:80")).toBe(true);
    expect(isAllowedHost("[::1]:4777")).toBe(true);
    expect(isAllowedHost("[::1]")).toBe(true);
    expect(isAllowedHost("evil.example.com")).toBe(false);
    expect(isAllowedHost("127.0.0.1.evil.com")).toBe(false);
    expect(isAllowedHost("127.0.0.1@evil.com")).toBe(false);
    expect(isAllowedHost("localhost/../x")).toBe(false);
    expect(isAllowedHost("0.0.0.0")).toBe(false);
    expect(isAllowedHost("")).toBe(false);
    expect(isAllowedHost(undefined)).toBe(false);
    expect(isAllowedHost("::1")).toBe(false); // must be bracketed per RFC 7230
  });

  it("accepts a bracketed IPv6 Host and rejects a foreign one", async () => {
    const v6 = await app.inject({ method: "GET", url: "/api/meta", headers: { host: "[::1]:4777" } });
    expect(v6.statusCode).toBe(200);
    const evil = await app.inject({ method: "GET", url: "/api/meta", headers: { host: "evil.example.com" } });
    expect(evil.statusCode).toBe(403);
    expect(evil.json().error.code).toBe("forbidden_host");
  });

  it("compares the token in constant time on equal-length buffers", async () => {
    expect(tokenMatches(token, token)).toBe(true);
    expect(tokenMatches(token.slice(0, -1), token)).toBe(false);
    expect(tokenMatches(token + "x", token)).toBe(false);
    expect(tokenMatches(undefined, token)).toBe(false);
    expect(tokenMatches("", token)).toBe(false);
    // Flip the last character so the wrong token can never equal the real one by chance.
    const flipped = token.slice(0, -1) + (token.endsWith("0") ? "1" : "0");
    const wrong = await app.inject({
      method: "GET",
      url: "/api/settings",
      headers: { "x-mordomo-token": flipped },
    });
    expect(wrong.statusCode).toBe(401);
    const viaQuery = await app.inject({ method: "GET", url: `/api/settings?token=${token}` });
    expect(viaQuery.statusCode).toBe(200);
  });
});

// ---------------------------------------------------------------------------
describe("settings deep-merge + adapter reload (audit #6)", () => {
  it("deepMergeSettings keeps sibling fields and replaces arrays", () => {
    const current = ctx.settings();
    const patch = SettingsPatchSchema.parse({
      providers: { claude: { enabled: false } },
      limits: { maxConcurrentRuns: 2 },
    });
    const merged = deepMergeSettings(current, patch);
    expect(merged.providers.claude.enabled).toBe(false);
    expect(merged.providers.claude.binaryPath).toBe(current.providers.claude.binaryPath);
    expect(merged.providers.cursor).toEqual(current.providers.cursor);
    expect(merged.limits.maxConcurrentRuns).toBe(2);
    expect(merged.limits.defaultTimeoutMs).toBe(current.limits.defaultTimeoutMs);
    const arrays = deepMergeSettings(current, SettingsPatchSchema.parse({ areas: ["Only"] }));
    expect(arrays.areas).toEqual(["Only"]);
  });

  it("PUT /api/settings with a partial provider does not reset binaryPath and reloads adapters", async () => {
    const before = ctx.settings();
    const binaryPath = before.providers.claude.binaryPath;
    expect(binaryPath).toBeTruthy();
    const adapterBefore = ctx.adapters.claude;
    let seen = 0;
    const unsub = events.subscribe((e) => {
      if (e.type === "settings.changed") seen++;
    });
    const res = await app.inject({
      method: "PUT",
      url: "/api/settings",
      headers: auth(),
      payload: { providers: { claude: { defaultEffort: "high" } }, limits: { maxConcurrentRuns: 2 } },
    });
    unsub();
    expect(res.statusCode).toBe(200);
    const saved = res.json().settings;
    expect(saved.providers.claude.binaryPath).toBe(binaryPath);
    expect(saved.providers.claude.enabled).toBe(true);
    expect(saved.providers.claude.defaultEffort).toBe("high");
    expect(saved.limits.maxConcurrentRuns).toBe(2);
    expect(saved.limits.defaultTimeoutMs).toBe(before.limits.defaultTimeoutMs);
    expect(ctx.adapters.claude).not.toBe(adapterBefore);
    expect(seen).toBeGreaterThanOrEqual(1);
  });

  it("validates new indexedFolders: absolute, existing directory, not inside config/", async () => {
    const keep = ctx.settings().indexedFolders;
    const rel = await app.inject({
      method: "PUT",
      url: "/api/settings",
      headers: auth(),
      payload: { indexedFolders: [...keep, { path: "relative/dir" }] },
    });
    expect(rel.statusCode).toBe(400);
    const missing = await app.inject({
      method: "PUT",
      url: "/api/settings",
      headers: auth(),
      payload: { indexedFolders: [...keep, { path: path.join(home, "nope") }] },
    });
    expect(missing.statusCode).toBe(400);
    const file = await app.inject({
      method: "PUT",
      url: "/api/settings",
      headers: auth(),
      payload: { indexedFolders: [...keep, { path: path.join(workspace, "notes.md") }] },
    });
    expect(file.statusCode).toBe(400);
    const cfg = await app.inject({
      method: "PUT",
      url: "/api/settings",
      headers: auth(),
      payload: { indexedFolders: [...keep, { path: ctx.paths.config }] },
    });
    expect(cfg.statusCode).toBe(400);
    expect(cfg.json().error.message).toContain("config");
    expect(ctx.settings().indexedFolders).toEqual(keep);
  });
});

// ---------------------------------------------------------------------------
describe("containment (audit #9)", () => {
  it("skills/import refuses a sourceDir outside the granted roots", async () => {
    const outside = fs.mkdtempSync(path.join(path.dirname(home), "outside-skill-"));
    try {
      fs.writeFileSync(path.join(outside, "SKILL.md"), "---\nname: X\n---\nbody");
      const res = await app.inject({
        method: "POST",
        url: "/api/skills/import",
        headers: auth(),
        payload: { sourceDir: outside },
      });
      expect(res.statusCode).toBe(403);
      expect(res.json().error.code).toBe("forbidden_path");
      expect(fs.existsSync(path.join(ctx.paths.skills, path.basename(outside)))).toBe(false);
    } finally {
      fs.rmSync(outside, { recursive: true, force: true });
    }
  });

  it("skills/import works from inside an indexed folder", async () => {
    const src = path.join(workspace, "imported-skill");
    fs.mkdirSync(src);
    fs.writeFileSync(
      path.join(src, "SKILL.md"),
      "---\nname: Imported\ndescription: test\n---\nDo the thing.\n",
    );
    const res = await app.inject({
      method: "POST",
      url: "/api/skills/import",
      headers: auth(),
      payload: { sourceDir: src },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().slug).toBe("imported-skill");
    const dup = await app.inject({
      method: "POST",
      url: "/api/skills/import",
      headers: auth(),
      payload: { sourceDir: src },
    });
    expect(dup.statusCode).toBe(409);
    const badSlug = await app.inject({
      method: "POST",
      url: "/api/skills/import",
      headers: auth(),
      payload: { sourceDir: src, slug: "../x" },
    });
    expect(badSlug.statusCode).toBe(400);
  });

  it("sync plan/apply refuse a target outside the granted roots", async () => {
    const outside = fs.mkdtempSync(path.join(path.dirname(home), "outside-sync-"));
    try {
      const plan = await app.inject({
        method: "GET",
        url: `/api/sync/plan?target=${encodeURIComponent(outside)}`,
        headers: auth(),
      });
      expect(plan.statusCode).toBe(403);
      const apply = await app.inject({
        method: "POST",
        url: "/api/sync/apply",
        headers: auth(),
        payload: { target: outside },
      });
      expect(apply.statusCode).toBe(403);
      expect(fs.readdirSync(outside)).toEqual([]);
    } finally {
      fs.rmSync(outside, { recursive: true, force: true });
    }
    const inside = path.join(workspace, "sync-target");
    fs.mkdirSync(inside);
    const ok = await app.inject({
      method: "GET",
      url: `/api/sync/plan?target=${encodeURIComponent(inside)}`,
      headers: auth(),
    });
    expect(ok.statusCode).toBe(200);
  });
});

// ---------------------------------------------------------------------------
describe("backup restore is staged, never against the open DB (audit #3)", () => {
  it("stages the restore, reports it in /api/health and can be cancelled", async () => {
    const created = await app.inject({ method: "POST", url: "/api/backups", headers: auth(), payload: {} });
    expect(created.statusCode).toBe(200);
    const name = created.json().name as string;
    const dbBefore = fs.statSync(ctx.paths.dbFile).mtimeMs;

    const res = await app.inject({ method: "POST", url: `/api/backups/${name}/restore`, headers: auth() });
    expect(res.statusCode).toBe(202);
    expect(res.json()).toMatchObject({
      staged: true,
      restored: false,
      name,
      apply: "mordomo stop && mordomo start",
    });
    expect(ctx.db.open).toBe(true);
    expect(fs.statSync(ctx.paths.dbFile).mtimeMs).toBe(dbBefore);
    const pending = readRestorePending(ctx.paths);
    expect(pending?.name).toBe(name);
    expect(fs.existsSync(path.join(pending!.stagedPath, "config", "settings.json"))).toBe(true);

    const health = await app.inject({ method: "GET", url: "/api/health", headers: auth() });
    expect(health.json().restorePending.name).toBe(name);

    const cancel = await app.inject({
      method: "DELETE",
      url: "/api/backups/restore-pending",
      headers: auth(),
    });
    expect(cancel.json().cancelled).toBe(name);
    expect(readRestorePending(ctx.paths)).toBeNull();

    const missing = await app.inject({
      method: "POST",
      url: "/api/backups/full-does-not-exist/restore",
      headers: auth(),
    });
    expect(missing.statusCode).toBe(404);
  });

  it("applies a staged restore at boot, before the DB opens", async () => {
    const tmp = makeTempHome("mordomo-restore-boot-");
    try {
      const boot = new AppContext(tmp.paths.home);
      const s = boot.settings();
      s.systemName = "BeforeBackup";
      boot.settingsStore.save(s);
      const bootApp = await buildServer(boot);
      const t = boot.token();
      const created = await bootApp.inject({
        method: "POST",
        url: "/api/backups",
        headers: { "x-mordomo-token": t },
        payload: {},
      });
      const name = created.json().name as string;
      boot.settingsStore.update({ systemName: "AfterBackup" });
      const staged = await bootApp.inject({
        method: "POST",
        url: `/api/backups/${name}/restore`,
        headers: { "x-mordomo-token": t },
      });
      expect(staged.statusCode).toBe(202);
      await bootApp.close();
      boot.close();

      const restarted = new AppContext(tmp.paths.home, { applyPendingRestore: true });
      expect(restarted.restoredAtBoot?.name).toBe(name);
      expect(restarted.settings().systemName).toBe("BeforeBackup");
      expect(readRestorePending(tmp.paths)).toBeNull();
      restarted.close();
    } finally {
      tmp.cleanup();
    }
  });
});

// ---------------------------------------------------------------------------
describe("health, version and request log (audit #25)", () => {
  it("reports real health data and a package.json version", async () => {
    const res = await app.inject({ method: "GET", url: "/api/health", headers: auth() });
    const body = res.json();
    expect(body.ok).toBe(true);
    expect(body.db.open).toBe(true);
    expect(typeof body.activeRuns).toBe("number");
    expect(typeof body.pendingApprovals).toBe("number");
    expect(typeof body.lastEventId).toBe("number");
    expect(body.version).toMatch(/^\d+\.\d+\.\d+/);
    // The single source of truth is the repository root package.json.
    const pkg = JSON.parse(fs.readFileSync(path.join(repoRoot, "package.json"), "utf8"));
    expect(body.version).toBe(pkg.version);
  });

  it("writes logs/api.jsonl with the token stripped from URLs", async () => {
    expect(safeUrl(`/api/events?since=1&token=${token}`)).toBe("/api/events?since=1&token=[REDACTED]");
    await app.inject({ method: "GET", url: `/api/metrics?token=${token}` });
    await new Promise((r) => setTimeout(r, 50));
    const file = path.join(ctx.paths.logs, "api.jsonl");
    expect(fs.existsSync(file)).toBe(true);
    const raw = fs.readFileSync(file, "utf8");
    expect(raw).not.toContain(token);
    const lines = raw
      .trim()
      .split("\n")
      .map((l) => JSON.parse(l));
    const metrics = lines.find((l) => typeof l.url === "string" && l.url.startsWith("/api/metrics"));
    expect(metrics).toBeTruthy();
    expect(metrics).toMatchObject({ method: "GET", status: 200 });
    expect(typeof metrics.ms).toBe("number");
    expect(typeof metrics.ts).toBe("number");
    expect(metrics.reqId).toBeTruthy();
    const boom = lines.find((l) => l.level === "error" && l.err);
    expect(boom).toBeTruthy();
  });

  it("doctor includes the npm audit check (skipped in a home without a lockfile)", async () => {
    const res = await app.inject({ method: "GET", url: "/api/doctor", headers: auth() });
    const audit = res.json().checks.find((c: { id: string }) => c.id === "npm-audit");
    expect(audit).toBeTruthy();
    expect(audit.status).toBe("skip");
    const off = await app.inject({ method: "GET", url: "/api/doctor?audit=0", headers: auth() });
    expect(off.json().checks.some((c: { id: string }) => c.id === "npm-audit")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
describe("SSE streams (audit #23, #27)", () => {
  let base = "";
  beforeAll(async () => {
    await app.listen({ port: 0, host: "127.0.0.1" });
    const addr = app.server.address();
    base = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;
  });

  async function readSse(
    url: string,
    headers: Record<string, string>,
    ms: number,
  ): Promise<{ status: number; text: string; contentType: string }> {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), ms);
    try {
      const res = await fetch(url, { headers, signal: ac.signal });
      const contentType = res.headers.get("content-type") ?? "";
      if (!res.body) return { status: res.status, text: "", contentType };
      const reader = res.body.getReader();
      let text = "";
      try {
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          text += Buffer.from(value).toString("utf8");
        }
      } catch {
        /* aborted */
      }
      return { status: res.status, text, contentType };
    } finally {
      clearTimeout(timer);
    }
  }

  it("refuses a request with no Host header (raw HTTP/1.0)", async () => {
    const port = Number(new URL(base).port);
    const raw = await new Promise<string>((resolve, reject) => {
      const socket = net.connect(port, "127.0.0.1", () => {
        socket.write("GET /api/meta HTTP/1.0\r\n\r\n");
      });
      let buf = "";
      socket.on("data", (d) => (buf += d.toString("utf8")));
      socket.on("end", () => resolve(buf));
      socket.on("error", reject);
      setTimeout(() => socket.destroy(), 2000);
    });
    expect(raw.startsWith("HTTP/1.1 403")).toBe(true);
    expect(raw).toContain("forbidden_host");
  });

  it("/api/runs/:id/stream sends id: lines and honours Last-Event-ID", async () => {
    const run = await app.inject({
      method: "POST",
      url: "/api/skills/workspace-digest/run",
      headers: auth(),
      payload: { inputs: { focus: "x" } },
    });
    const { runId } = run.json();
    for (let i = 0; i < 50; i++) {
      const r = await app.inject({ method: "GET", url: `/api/runs/${runId}`, headers: auth() });
      if (!["queued", "running"].includes(r.json().run.status)) break;
      await new Promise((r2) => setTimeout(r2, 100));
    }
    const full = await readSse(`${base}/api/runs/${runId}/stream?token=${token}`, {}, 3000);
    expect(full.status).toBe(200);
    expect(full.contentType).toContain("text/event-stream");
    const ids = [...full.text.matchAll(/^id: (\d+)$/gm)].map((m) => Number(m[1]));
    expect(ids.length).toBeGreaterThan(1);
    expect(full.text).toContain('"type":"run_state"');

    const resumeFrom = ids[ids.length - 2]!;
    const resumed = await readSse(
      `${base}/api/runs/${runId}/stream?token=${token}`,
      { "Last-Event-ID": String(resumeFrom) },
      3000,
    );
    const resumedIds = [...resumed.text.matchAll(/^id: (\d+)$/gm)].map((m) => Number(m[1]));
    expect(resumedIds).toEqual(ids.filter((id) => id > resumeFrom));
    expect(resumed.text).toContain('"type":"run_state"');
  });

  it("/api/events replays from Last-Event-ID / ?since and streams live events", async () => {
    const a = events.emit("settings.changed", { keys: ["a"] });
    const b = events.emit("settings.changed", { keys: ["b"] });
    const pending = readSse(`${base}/api/events?token=${token}&since=${a.id}`, {}, 700);
    await new Promise((r) => setTimeout(r, 200));
    const live = events.emit("routine.changed", { id: "x", action: "test" });
    const out = await pending;
    expect(out.status).toBe(200);
    expect(out.contentType).toContain("text/event-stream");
    expect(out.text).not.toContain(`id: ${a.id}\n`);
    expect(out.text).toContain(`id: ${b.id}\nevent: settings.changed\n`);
    expect(out.text).toContain(`id: ${live.id}\nevent: routine.changed\n`);
    expect(out.text).toContain('"keys":["b"]');

    const viaHeader = await readSse(
      `${base}/api/events?token=${token}`,
      { "Last-Event-ID": String(a.id) },
      400,
    );
    expect(viaHeader.text).toContain(`id: ${b.id}\n`);
    const noResume = await readSse(`${base}/api/events?token=${token}`, {}, 400);
    expect(noResume.text).not.toContain(`id: ${b.id}\n`);
    expect(noResume.text).toContain(": connected");
    const unauth = await fetch(`${base}/api/events`);
    expect(unauth.status).toBe(401);
  });
});
