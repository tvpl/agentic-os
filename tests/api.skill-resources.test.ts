import { describe, expect, it, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import type { FastifyInstance } from "fastify";
import { AppContext } from "../apps/api/src/context.js";
import { buildServer } from "../apps/api/src/server.js";
import { MAX_SKILL_RESOURCES, skillResourceContentType, skillResourceKind } from "../core/src/skills/catalog.js";
import { makeTempHome } from "./helpers.js";

/**
 * Skill resources (analysis 1.3 / 4.1): the catalog scans a skill folder
 * recursively and `GET /api/skills/:slug/resource` serves only what the scan
 * listed, from inside that folder, with an explicit content type.
 */

let ctx: AppContext;
let app: FastifyInstance;
let token: string;
let cleanup: () => void;
let skillsDir: string;

const SKILL_MD = `---
slug: brandy
name: Brandy
description: A thick skill with brand resources.
providers: [claude]
mode: read_only
---

# Brandy

Body.
`;

function auth() {
  return { "x-mordomo-token": token };
}

beforeAll(async () => {
  const tmp = makeTempHome("mordomo-skill-res-");
  cleanup = tmp.cleanup;
  skillsDir = tmp.paths.skills;
  const dir = path.join(skillsDir, "brandy");
  fs.mkdirSync(path.join(dir, "resources", "deep"), { recursive: true });
  fs.writeFileSync(path.join(dir, "SKILL.md"), SKILL_MD);
  fs.writeFileSync(path.join(dir, "README.md"), "# readme\n");
  fs.writeFileSync(path.join(dir, "resources", "brand.html"), "<html><body><h1>Brand</h1></body></html>");
  fs.writeFileSync(path.join(dir, "resources", "logo.png"), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  fs.writeFileSync(path.join(dir, "resources", "deep", "notes.md"), "# notes\n\nDeep reference.\n");
  fs.writeFileSync(path.join(dir, "resources", "data.bin"), Buffer.from([1, 2, 3]));
  fs.writeFileSync(path.join(dir, ".hidden.md"), "secret");
  // A secret outside the skill folder that path traversal must never reach.
  fs.writeFileSync(path.join(tmp.paths.home, "outside.md"), "TOP SECRET");
  try {
    fs.symlinkSync(path.join(tmp.paths.home, "outside.md"), path.join(dir, "escape.md"));
  } catch {
    /* symlinks may be unavailable (Windows without privileges) */
  }

  ctx = new AppContext(tmp.paths.home);
  token = ctx.token();
  app = await buildServer(ctx);
});

afterAll(async () => {
  await app.close();
  ctx.close();
  cleanup();
});

describe("skill resource catalog", () => {
  it("lists every regular file except SKILL.md, hidden entries and symlinks", () => {
    const skill = ctx.skills.load("brandy");
    expect(skill).not.toBeNull();
    const rels = skill!.resourceFiles.map((r) => r.rel);
    expect(rels).toEqual(["README.md", "resources/brand.html", "resources/data.bin", "resources/deep/notes.md", "resources/logo.png"]);
    expect(rels).not.toContain("SKILL.md");
    expect(rels).not.toContain(".hidden.md");
    expect(rels).not.toContain("escape.md");
    // The legacy flat list mirrors it, so older clients keep working.
    expect(skill!.resources).toEqual(rels);
  });

  it("classifies kinds and sizes", () => {
    const skill = ctx.skills.load("brandy")!;
    const byRel = new Map(skill.resourceFiles.map((r) => [r.rel, r]));
    expect(byRel.get("resources/brand.html")?.kind).toBe("html");
    expect(byRel.get("resources/logo.png")?.kind).toBe("image");
    expect(byRel.get("resources/deep/notes.md")?.kind).toBe("markdown");
    expect(byRel.get("resources/data.bin")?.kind).toBe("other");
    expect(byRel.get("resources/logo.png")?.size).toBe(4);
    expect(byRel.get("resources/deep/notes.md")?.name).toBe("notes.md");
    expect(skillResourceKind("a.PDF")).toBe("pdf");
    expect(skillResourceContentType("a.unknown")).toBe("application/octet-stream");
  });

  it("caps the scan so a deep folder cannot stall the catalog", () => {
    const dir = path.join(skillsDir, "many");
    fs.mkdirSync(path.join(dir, "files"), { recursive: true });
    fs.writeFileSync(path.join(dir, "SKILL.md"), SKILL_MD.replace("slug: brandy", "slug: many").replace("name: Brandy", "name: Many"));
    for (let i = 0; i < MAX_SKILL_RESOURCES + 25; i++) fs.writeFileSync(path.join(dir, "files", `f${String(i).padStart(4, "0")}.md`), "x");
    expect(ctx.skills.load("many")!.resourceFiles.length).toBe(MAX_SKILL_RESOURCES);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("resolves only listed relative paths, never an escape", () => {
    expect(ctx.skills.resolveResource("brandy", "resources/brand.html")?.contentType).toBe("text/html; charset=utf-8");
    expect(ctx.skills.resolveResource("brandy", "SKILL.md")).toBeNull();
    expect(ctx.skills.resolveResource("brandy", "../outside.md")).toBeNull();
    expect(ctx.skills.resolveResource("brandy", "resources/../../outside.md")).toBeNull();
    expect(ctx.skills.resolveResource("brandy", "/etc/passwd")).toBeNull();
    expect(ctx.skills.resolveResource("brandy", "escape.md")).toBeNull();
    expect(ctx.skills.resolveResource("brandy", "nope.md")).toBeNull();
    expect(ctx.skills.resolveResource("brandy", 42)).toBeNull();
  });
});

describe("GET /api/skills/:slug/resource", () => {
  it("serves a markdown resource as text with nosniff", async () => {
    const res = await app.inject({ method: "GET", url: "/api/skills/brandy/resource?rel=resources/deep/notes.md", headers: auth() });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toBe("text/markdown; charset=utf-8");
    expect(res.headers["x-content-type-options"]).toBe("nosniff");
    expect(res.body).toContain("Deep reference.");
  });

  it("serves HTML with a script-free CSP so the preview iframe cannot execute anything", async () => {
    const res = await app.inject({ method: "GET", url: "/api/skills/brandy/resource?rel=resources/brand.html", headers: auth() });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toBe("text/html; charset=utf-8");
    const csp = String(res.headers["content-security-policy"]);
    expect(csp).toContain("default-src 'none'");
    expect(csp).toContain("sandbox");
    expect(csp).not.toContain("script-src 'self'");
  });

  it("serves images inline and unknown types as a download", async () => {
    const png = await app.inject({ method: "GET", url: "/api/skills/brandy/resource?rel=resources/logo.png", headers: auth() });
    expect(png.statusCode).toBe(200);
    expect(png.headers["content-type"]).toBe("image/png");
    expect(png.headers["content-disposition"]).toBeUndefined();
    const bin = await app.inject({ method: "GET", url: "/api/skills/brandy/resource?rel=resources/data.bin", headers: auth() });
    expect(bin.statusCode).toBe(200);
    expect(String(bin.headers["content-disposition"])).toContain("attachment");
  });

  it("refuses traversal, SKILL.md, unknown files and unknown skills", async () => {
    for (const rel of ["../outside.md", "resources/../../outside.md", "SKILL.md", "missing.md", "/etc/passwd"]) {
      const res = await app.inject({ method: "GET", url: `/api/skills/brandy/resource?rel=${encodeURIComponent(rel)}`, headers: auth() });
      expect(res.statusCode).toBe(404);
      expect(res.body).not.toContain("TOP SECRET");
    }
    const missingSkill = await app.inject({ method: "GET", url: "/api/skills/nope/resource?rel=a.md", headers: auth() });
    expect(missingSkill.statusCode).toBe(404);
  });

  it("requires the local token and a rel", async () => {
    const noToken = await app.inject({ method: "GET", url: "/api/skills/brandy/resource?rel=README.md" });
    expect(noToken.statusCode).toBe(401);
    const noRel = await app.inject({ method: "GET", url: "/api/skills/brandy/resource", headers: auth() });
    expect(noRel.statusCode).toBe(400);
  });
});
