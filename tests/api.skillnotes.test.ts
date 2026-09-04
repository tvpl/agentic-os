import { describe, expect, it, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import type { FastifyInstance } from "fastify";
import { AppContext } from "../apps/api/src/context.js";
import { buildServer } from "../apps/api/src/server.js";
import { makeTempHome } from "./helpers.js";

/** Agent notes: NOTES.md beside SKILL.md, appended over HTTP and folded into the run prompt. */

let ctx: AppContext;
let app: FastifyInstance;
let token: string;
let cleanup: () => void;
let home: string;

beforeAll(async () => {
  const tmp = makeTempHome();
  cleanup = tmp.cleanup;
  home = tmp.paths.home;
  fs.mkdirSync(path.join(home, "skills", "noted"), { recursive: true });
  fs.writeFileSync(
    path.join(home, "skills", "noted", "SKILL.md"),
    ["---", "name: Noted", "slug: noted", "description: A skill with notes", "---", "", "Do the thing."].join(
      "\n",
    ),
  );
  ctx = new AppContext(home);
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

describe("skill notes", () => {
  it("starts empty and appends dated bullets", async () => {
    const empty = await app.inject({ method: "GET", url: "/api/skills/noted/notes", headers: auth() });
    expect(empty.statusCode).toBe(200);
    expect((empty.json() as { notes: string }).notes).toBe("");

    const add = await app.inject({
      method: "POST",
      url: "/api/skills/noted/notes",
      headers: auth(),
      payload: { text: "Always check the invoice number twice.", runId: "run-1" },
    });
    expect(add.statusCode).toBe(200);
    const body = add.json() as { notes: string; path: string };
    expect(body.notes).toContain("# Notes for Noted");
    expect(body.notes).toContain("Always check the invoice number twice.");
    expect(body.notes).toContain("run run-1");
    expect(fs.existsSync(path.join(home, "skills", "noted", "NOTES.md"))).toBe(true);

    await app.inject({
      method: "POST",
      url: "/api/skills/noted/notes",
      headers: auth(),
      payload: { text: "Second\nline" },
    });
    const after = (
      await app.inject({ method: "GET", url: "/api/skills/noted/notes", headers: auth() })
    ).json() as {
      notes: string;
    };
    expect(after.notes.split("\n").filter((l) => l.startsWith("- ")).length).toBe(2);
    expect(after.notes).toContain("Second line");
  });

  it("folds the notes into the run prompt", () => {
    const skill = ctx.skills.load("noted")!;
    const prompt = ctx.skills.buildRunPrompt(skill, {}, "/tmp/artifacts");
    expect(prompt).toContain("Notes saved from previous runs");
    expect(prompt).toContain("Always check the invoice number twice.");
  });

  it("rejects empty notes and unknown skills", async () => {
    const bad = await app.inject({
      method: "POST",
      url: "/api/skills/noted/notes",
      headers: auth(),
      payload: { text: "   " },
    });
    expect(bad.statusCode).toBe(400);
    const missing = await app.inject({ method: "GET", url: "/api/skills/nope/notes", headers: auth() });
    expect(missing.statusCode).toBe(404);
  });
});
