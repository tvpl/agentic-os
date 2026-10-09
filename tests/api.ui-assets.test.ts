import fs from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { AppContext } from "../apps/api/src/context.js";
import { buildServer } from "../apps/api/src/server.js";
import { makeTempHome } from "./helpers.js";

describe("Command Centre asset delivery across rebuilds", () => {
  const temp = makeTempHome("mordomo-ui-assets-");
  const uiDist = path.join(temp.paths.home, "ui");
  let ctx: AppContext;
  let app: FastifyInstance;
  beforeAll(async () => {
    fs.mkdirSync(path.join(uiDist, "assets"), { recursive: true });
    fs.writeFileSync(
      path.join(uiDist, "index.html"),
      '<!doctype html><meta name="mordomo-token" content=""><div id="root"></div>',
    );
    fs.writeFileSync(path.join(uiDist, "assets", "old.js"), 'export const build = "old";');
    ctx = new AppContext(temp.paths.home);
    app = await buildServer(ctx, { uiDist });
    await app.ready();
  });
  afterAll(async () => {
    await app.close();
    ctx.close();
    temp.cleanup();
  });

  it("serves new hashed JS and CSS created after the daemon starts", async () => {
    for (const [file, body, mime] of [
      ["main-newhash.js", 'export const build = "new";', "javascript"],
      ["main-newhash.css", "body { color: white; }", "text/css"],
    ]) {
      fs.writeFileSync(path.join(uiDist, "assets", file!), body!);
      const response = await app.inject(`/assets/${file}`);
      expect(response.statusCode).toBe(200);
      expect(response.headers["content-type"]).toContain(mime);
      expect(response.body).toBe(body);
    }
  });
  it("returns uncached 404s, never the token-bearing shell, for missing assets", async () => {
    fs.unlinkSync(path.join(uiDist, "assets", "old.js"));
    for (const url of [
      "/assets/old.js",
      "/assets/missing.js?v=2",
      "/fonts/missing.woff2",
      "/icons/missing.png",
      "/missing.js",
      "/sw-missing.js",
    ]) {
      const response = await app.inject(url);
      expect(response.statusCode).toBe(404);
      expect(response.headers["content-type"]).toContain("application/json");
      expect(response.headers["cache-control"]).toBe("no-store");
      expect(response.body).not.toContain(ctx.token());
    }
  });
  it("reads fresh HTML and injects the local token on each shell request", async () => {
    fs.writeFileSync(
      path.join(uiDist, "index.html"),
      '<!doctype html><meta name="mordomo-token" content=""><main>Updated build</main>',
    );
    for (const url of ["/", "/index.html", "/settings"]) {
      // a browser opening the page (a program fetching it gets no token: tests/api.security-p0.test.ts C53)
      const response = await app.inject({
        url,
        headers: { "sec-fetch-dest": "document", "sec-fetch-mode": "navigate" },
      });
      expect(response.statusCode).toBe(200);
      expect(response.headers["cache-control"]).toBe("no-store");
      expect(response.body).toContain("Updated build");
      expect(response.body).toContain(`content="${ctx.token()}"`);
    }
  });
  it("keeps unknown API routes outside the UI fallback", async () => {
    const response = await app.inject({
      url: "/api/not-a-route",
      headers: { "x-mordomo-token": ctx.token() },
    });
    expect(response.statusCode).toBe(404);
    expect(response.headers["content-type"]).toContain("application/json");
  });
});
