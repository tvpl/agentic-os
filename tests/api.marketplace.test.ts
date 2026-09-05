import { describe, expect, it, beforeAll, afterAll } from "vitest";
import crypto from "node:crypto";
import type { FastifyInstance } from "fastify";
import { SkillRegistry, type Fetcher } from "@mordomo/core";
import { AppContext } from "../apps/api/src/context.js";
import { buildServer } from "../apps/api/src/server.js";
import { makeTempHome } from "./helpers.js";

/** Marketplace over HTTP with a fake fetcher: list, install (verified), refuse to overwrite, force. */

const REG = "https://skills.example/index.json";
const SKILL_MD =
  "---\nname: Hello Registry\ndescription: says hi\ntriggers:\n  - /hello-registry\n---\n\n# Hello\n\nSay hi.\n";
const sha = (s: string) => crypto.createHash("sha256").update(s).digest("hex");
const index = {
  name: "Test",
  skills: [
    {
      slug: "hello-registry",
      name: "Hello Registry",
      description: "says hi",
      version: "1.2.0",
      files: { "SKILL.md": { url: "https://skills.example/hello/SKILL.md", sha256: sha(SKILL_MD) } },
    },
  ],
};
const fetcher: Fetcher = async (url) => {
  const enc = (s: string) => new TextEncoder().encode(s);
  if (url === REG) return { ok: true, status: 200, bytes: enc(JSON.stringify(index)) };
  if (url === "https://skills.example/hello/SKILL.md") return { ok: true, status: 200, bytes: enc(SKILL_MD) };
  return { ok: false, status: 404, bytes: new Uint8Array() };
};

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
  settings.marketplace = { registries: [REG] };
  ctx.settingsStore.save(settings);
  (ctx as unknown as { skillRegistry: SkillRegistry }).skillRegistry = new SkillRegistry(fetcher);
  token = ctx.token();
  app = await buildServer(ctx);
});
afterAll(async () => {
  await app.close();
  ctx.close();
  cleanup();
});
const auth = () => ({ "x-mordomo-token": token });

describe("marketplace API", () => {
  it("lists registry skills and installs one after verification", async () => {
    const list = await app.inject({ method: "GET", url: "/api/skills/registry", headers: auth() });
    expect(list.statusCode).toBe(200);
    const body = list.json() as {
      skills: Array<{ slug: string; installed: boolean; files: string[] }>;
      errors: unknown[];
    };
    expect(body.errors).toEqual([]);
    expect(body.skills[0]).toMatchObject({ slug: "hello-registry", installed: false, files: ["SKILL.md"] });

    const install = await app.inject({
      method: "POST",
      url: "/api/skills/install",
      headers: auth(),
      payload: { slug: "hello-registry" },
    });
    expect(install.statusCode).toBe(200);
    expect((install.json() as { version: string }).version).toBe("1.2.0");
    expect(ctx.skills.load("hello-registry")?.name).toBe("Hello Registry");

    const again = await app.inject({
      method: "POST",
      url: "/api/skills/install",
      headers: auth(),
      payload: { slug: "hello-registry" },
    });
    expect(again.statusCode).toBe(409);
    const forced = await app.inject({
      method: "POST",
      url: "/api/skills/install",
      headers: auth(),
      payload: { slug: "hello-registry", force: true },
    });
    expect(forced.statusCode).toBe(200);
    const after = (
      await app.inject({ method: "GET", url: "/api/skills/registry", headers: auth() })
    ).json() as { skills: Array<{ installed: boolean }> };
    expect(after.skills[0]!.installed).toBe(true);
  });

  it("404s an unknown slug", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/skills/install",
      headers: auth(),
      payload: { slug: "nope" },
    });
    expect(res.statusCode).toBe(404);
  });
});
