import { describe, expect, it, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import type { FastifyInstance } from "fastify";
import { AppContext } from "../apps/api/src/context.js";
import { buildServer } from "../apps/api/src/server.js";
import { artifactKind, artifactTitle } from "../apps/api/src/routes/system.js";
import { makeTempHome, withFakeBinPath } from "./helpers.js";

let ctx: AppContext;
let app: FastifyInstance;
let token: string;
let cleanup: () => void;
let restorePath: () => void;

beforeAll(async () => {
  restorePath = withFakeBinPath();
  const tmp = makeTempHome();
  cleanup = tmp.cleanup;
  ctx = new AppContext(tmp.paths.home);
  const settings = ctx.settings();
  settings.setupCompleted = true;
  ctx.settingsStore.save(settings);
  token = ctx.token();
  app = await buildServer(ctx);

  const dir = path.join(ctx.paths.artifacts, "pixel-studio");
  fs.mkdirSync(dir, { recursive: true });
  // 1×1 transparent PNG
  fs.writeFileSync(
    path.join(dir, "hero.png"),
    Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
      "base64",
    ),
  );
  const reports = path.join(ctx.paths.artifacts, "run-abc");
  fs.mkdirSync(reports, { recursive: true });
  fs.writeFileSync(
    path.join(reports, "report.md"),
    "---\nfront: matter\n---\n\n# Thro brand candidates\n\nbody\n",
  );
  fs.writeFileSync(
    path.join(reports, "page.html"),
    "<!doctype html><html><head><title>OS restyle — 10 brand candidates</title></head><body></body></html>",
  );
  fs.writeFileSync(path.join(reports, "notes.txt"), "plain");
  fs.writeFileSync(path.join(ctx.paths.artifacts, ".hidden.png"), "x");
});

afterAll(async () => {
  await app.close();
  ctx.close();
  restorePath();
  cleanup();
});

const auth = () => ({ "x-mordomo-token": token });

describe("artifact helpers", () => {
  it("classifies kinds by extension", () => {
    expect(artifactKind("a.png")).toBe("image");
    expect(artifactKind("a.MP4")).toBe("video");
    expect(artifactKind("a.html")).toBe("html");
    expect(artifactKind("a.md")).toBe("markdown");
    expect(artifactKind("a.ts")).toBe("code");
    expect(artifactKind("a.bin")).toBe("other");
  });

  it("reads markdown headings and html titles", () => {
    expect(artifactTitle(path.join(ctx.paths.artifacts, "run-abc", "report.md"), "markdown")).toBe(
      "Thro brand candidates",
    );
    expect(artifactTitle(path.join(ctx.paths.artifacts, "run-abc", "page.html"), "html")).toBe(
      "OS restyle — 10 brand candidates",
    );
    expect(artifactTitle(path.join(ctx.paths.artifacts, "run-abc", "notes.txt"), "other")).toBe("notes.txt");
    expect(artifactTitle("/nowhere/x.md", "markdown")).toBe("x.md");
  });
});

describe("GET /api/artifacts/list + /raw", () => {
  it("lists every file under artifacts/ with kind, title, folder and thumbnail flag", async () => {
    const res = await app.inject({ method: "GET", url: "/api/artifacts/list", headers: auth() });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.total).toBe(4);
    expect(body.folders).toEqual(["pixel-studio", "run-abc"]);
    const png = body.items.find((i: { file: string }) => i.file.endsWith("hero.png"));
    expect(png).toMatchObject({ kind: "image", thumbnail: true, folder: "pixel-studio", runId: null });
    const md = body.items.find((i: { file: string }) => i.file.endsWith("report.md"));
    expect(md).toMatchObject({ kind: "markdown", title: "Thro brand candidates", thumbnail: false });
    expect(body.items.some((i: { file: string }) => i.file.includes(".hidden"))).toBe(false);
  });

  it("filters by text, kind, folder and since", async () => {
    const q = await app.inject({ method: "GET", url: "/api/artifacts/list?q=thro", headers: auth() });
    expect(q.json().items.map((i: { file: string }) => i.file)).toEqual(["run-abc/report.md"]);
    const kind = await app.inject({ method: "GET", url: "/api/artifacts/list?kind=image", headers: auth() });
    expect(kind.json().total).toBe(1);
    const folder = await app.inject({
      method: "GET",
      url: "/api/artifacts/list?folder=run-abc",
      headers: auth(),
    });
    expect(folder.json().total).toBe(3);
    const future = await app.inject({
      method: "GET",
      url: `/api/artifacts/list?since=${Date.now() + 60_000}`,
      headers: auth(),
    });
    expect(future.json().total).toBe(0);
    const bad = await app.inject({ method: "GET", url: "/api/artifacts/list?kind=nope", headers: auth() });
    expect(bad.statusCode).toBe(400);
  });

  it("serves raw images inside artifacts/ only, with the right content type", async () => {
    const p = path.join(ctx.paths.artifacts, "pixel-studio", "hero.png");
    const ok = await app.inject({
      method: "GET",
      url: `/api/artifacts/raw?p=${encodeURIComponent(p)}`,
      headers: auth(),
    });
    expect(ok.statusCode).toBe(200);
    expect(ok.headers["content-type"]).toBe("image/png");
    expect(ok.rawPayload.length).toBeGreaterThan(20);
    const outside = await app.inject({
      method: "GET",
      url: `/api/artifacts/raw?p=${encodeURIComponent("/etc/passwd")}`,
      headers: auth(),
    });
    expect(outside.statusCode).toBe(403);
    const traversal = await app.inject({
      method: "GET",
      url: `/api/artifacts/raw?p=${encodeURIComponent(path.join(ctx.paths.artifacts, "..", "config", "settings.json"))}`,
      headers: auth(),
    });
    expect(traversal.statusCode).toBe(403);
    const text = await app.inject({
      method: "GET",
      url: `/api/artifacts/raw?p=${encodeURIComponent(path.join(ctx.paths.artifacts, "run-abc", "notes.txt"))}`,
      headers: auth(),
    });
    expect(text.statusCode).toBe(415);
    const missing = await app.inject({
      method: "GET",
      url: `/api/artifacts/raw?p=${encodeURIComponent(path.join(ctx.paths.artifacts, "nope.png"))}`,
      headers: auth(),
    });
    expect(missing.statusCode).toBe(404);
  });
});
