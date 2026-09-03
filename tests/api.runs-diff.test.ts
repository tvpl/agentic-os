import { describe, expect, it, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import type { FastifyInstance } from "fastify";
import { AppContext } from "../apps/api/src/context.js";
import { buildServer } from "../apps/api/src/server.js";
import { findGitRoot } from "../apps/api/src/routes/runs.js";
import { FAKE_BIN, makeTempHome, withFakeBinPath } from "./helpers.js";

let ctx: AppContext;
let app: FastifyInstance;
let token: string;
let cleanup: () => void;
let restorePath: () => void;
let repo: string;
let plain: string;
let hasGit = true;

const auth = () => ({ "x-mordomo-token": token });
const gitEnv = { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_SYSTEM: "/dev/null", HOME: process.env.HOME ?? "/tmp" };
const git = (cwd: string, ...args: string[]) => execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", ...args], { cwd, env: gitEnv, stdio: ["ignore", "pipe", "pipe"] }).toString();

beforeAll(async () => {
  restorePath = withFakeBinPath();
  const tmp = makeTempHome();
  cleanup = tmp.cleanup;
  repo = path.join(tmp.paths.home, "repo");
  plain = path.join(tmp.paths.home, "plain");
  fs.mkdirSync(repo);
  fs.mkdirSync(plain);
  fs.writeFileSync(path.join(plain, "notes.md"), "# notes\nline\n");
  try {
    git(repo, "init", "-q");
    fs.writeFileSync(path.join(repo, "a.txt"), "one\ntwo\nthree\n");
    git(repo, "add", "a.txt");
    git(repo, "commit", "-q", "-m", "init");
    fs.writeFileSync(path.join(repo, "a.txt"), "one\n2\nthree\nfour\n");
    fs.writeFileSync(path.join(repo, "new.txt"), "brand new\n");
  } catch {
    hasGit = false;
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
  await app.close();
  ctx.close();
  restorePath();
  cleanup();
});

function makeRun(cwd: string): string {
  return ctx.runs.create({
    origin: "manual",
    provider: "claude",
    prompt: "diff test",
    cwd,
    model: null,
    effort: "default",
    mode: "read_only",
    timeoutMs: 30_000,
    profile: "read_only",
  }).id;
}

describe("GET /api/runs/:id/diff", () => {
  it("returns a git diff for a modified tracked file (relative or absolute path)", async () => {
    if (!hasGit) return;
    const id = makeRun(repo);
    const res = await app.inject({ method: "GET", url: `/api/runs/${id}/diff?file=a.txt`, headers: auth() });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.kind).toBe("git");
    expect(body.unchanged).toBe(false);
    expect(body.diff).toContain("-two");
    expect(body.diff).toContain("+2");
    expect(body.diff).toContain("+four");

    const abs = await app.inject({ method: "GET", url: `/api/runs/${id}/diff?file=${encodeURIComponent(path.join(repo, "a.txt"))}`, headers: auth() });
    expect(abs.json().kind).toBe("git");
  });

  it("returns a snapshot for untracked files and for non-git folders", async () => {
    const id = makeRun(hasGit ? repo : plain);
    if (hasGit) {
      const untracked = await app.inject({ method: "GET", url: `/api/runs/${id}/diff?file=new.txt`, headers: auth() });
      expect(untracked.json()).toMatchObject({ kind: "snapshot", untracked: true, content: "brand new\n" });
    }
    const plainRun = makeRun(plain);
    const res = await app.inject({ method: "GET", url: `/api/runs/${plainRun}/diff?file=notes.md`, headers: auth() });
    expect(res.json()).toMatchObject({ kind: "snapshot", untracked: false, content: "# notes\nline\n" });
  });

  it("refuses paths outside the granted roots and unknown runs", async () => {
    const id = makeRun(plain);
    const outside = await app.inject({ method: "GET", url: `/api/runs/${id}/diff?file=${encodeURIComponent("/etc/hostname")}`, headers: auth() });
    expect(outside.statusCode).toBe(403);
    const missing = await app.inject({ method: "GET", url: `/api/runs/${id}/diff?file=nope.md`, headers: auth() });
    expect(missing.json().kind).toBe("unavailable");
    const unknown = await app.inject({ method: "GET", url: `/api/runs/00000000-0000-4000-8000-000000000000/diff?file=a`, headers: auth() });
    expect(unknown.statusCode).toBe(404);
  });

  it("findGitRoot walks up to the work tree", () => {
    if (!hasGit) return;
    expect(findGitRoot(path.join(repo, "sub", "dir"))).toBe(repo);
    expect(findGitRoot("/")).toBeNull();
  });
});

describe("GET /api/runs pagination and metrics cost", () => {
  it("supports offset and reports the total in a header", async () => {
    const total = ctx.runs.count();
    const page = await app.inject({ method: "GET", url: "/api/runs?limit=1&offset=1", headers: auth() });
    expect(page.statusCode).toBe(200);
    expect(page.json()).toHaveLength(1);
    expect(page.headers["x-total-count"]).toBe(String(total));
    const end = await app.inject({ method: "GET", url: `/api/runs?limit=5&offset=${total}`, headers: auth() });
    expect(end.json()).toHaveLength(0);
  });

  it("exposes usage on run records and cost on /api/metrics", async () => {
    const id = makeRun(plain);
    const one = await app.inject({ method: "GET", url: `/api/runs/${id}`, headers: auth() });
    expect(one.json().run).toHaveProperty("usage", null);
    expect(one.json().run).toHaveProperty("filesChanged");
    const metrics = await app.inject({ method: "GET", url: "/api/metrics", headers: auth() });
    expect(metrics.json().cost).toMatchObject({ todayUsd: 0, weekUsd: 0, tokensToday: 0, burnRatePerHour: 0 });
    expect(metrics.json().usageSeries).toHaveLength(24);
  });
});
