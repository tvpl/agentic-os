import { describe, expect, it, vi, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import type { FastifyInstance } from "fastify";
import { AppContext } from "../apps/api/src/context.js";
import { buildServer } from "../apps/api/src/server.js";
import { FAKE_BIN, makeTempHome, withFakeBinPath } from "./helpers.js";

/** Per-skill daily budget: refused at 409 once spent, the remainder caps the run. */

let ctx: AppContext;
let app: FastifyInstance;
let token: string;
let cleanup: () => void;
let restorePath: () => void;

beforeAll(async () => {
  restorePath = withFakeBinPath();
  const tmp = makeTempHome();
  cleanup = tmp.cleanup;
  fs.mkdirSync(path.join(tmp.paths.home, "skills", "capped"), { recursive: true });
  fs.writeFileSync(
    path.join(tmp.paths.home, "skills", "capped", "SKILL.md"),
    [
      "---",
      "name: Capped",
      "slug: capped",
      "description: A skill with a daily budget",
      "budgetUsd: 0.2",
      "---",
      "",
      "Do little.",
    ].join("\n"),
  );
  ctx = new AppContext(tmp.paths.home);
  const settings = ctx.settings();
  settings.setupCompleted = true;
  settings.providers.claude.enabled = true;
  settings.providers.claude.binaryPath = path.join(FAKE_BIN, "claude");
  ctx.settingsStore.save(settings);
  token = ctx.token();
  app = await buildServer(ctx);
});

afterAll(async () => {
  await app.close();
  ctx.close();
  cleanup();
  restorePath();
});

const auth = () => ({ "x-mordomo-token": token });

describe("skill budgets", () => {
  it("caps the first run with the remaining budget and refuses once it is spent", async () => {
    const skill = (
      await app.inject({ method: "GET", url: "/api/skills/capped", headers: auth() })
    ).json() as { budgetUsd: number };
    expect(skill.budgetUsd).toBe(0.2);
    const first = await app.inject({
      method: "POST",
      url: "/api/skills/capped/run",
      headers: auth(),
      payload: {},
    });
    expect(first.statusCode).toBe(200);
    const runId = (first.json() as { runId: string }).runId;
    expect(ctx.runs.get(runId)!.maxCostUsd).toBeCloseTo(0.2, 6);
    // Wait for the fake CLI to finish, then pretend it billed above the cap.
    for (let i = 0; i < 50 && ctx.runs.get(runId)!.status !== "done"; i++)
      await new Promise((r) => setTimeout(r, 100));
    ctx.db.prepare("UPDATE runs SET cost_usd = ? WHERE id = ?").run(0.25, runId);

    const second = await app.inject({
      method: "POST",
      url: "/api/skills/capped/run",
      headers: auth(),
      payload: {},
    });
    expect(second.statusCode).toBe(409);
    expect(second.body).toContain("budget_exhausted");
    expect(ctx.runs.list({ skillSlug: "capped" })).toHaveLength(1);
  });
});

it("concurrent skill requests cannot allocate the same remaining budget", async () => {
  const tmp = makeTempHome();
  const directory = path.join(tmp.paths.home, "skills", "reserved");
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(
    path.join(directory, "SKILL.md"),
    "---\nname: Reserved\nslug: reserved\ndescription: Budget concurrency fixture\nbudgetUsd: 1\n---\nRead only.",
  );
  const local = new AppContext(tmp.paths.home);
  const settings = local.settings();
  settings.providers.claude.enabled = true;
  local.settingsStore.save(settings);
  const execute = vi.spyOn(local.runs, "execute").mockImplementation(async (id) => local.runs.get(id)!);
  const server = await buildServer(local);
  try {
    const send = () =>
      server.inject({
        method: "POST",
        url: "/api/skills/reserved/run",
        headers: { "x-mordomo-token": local.token() },
        payload: {},
      });
    const responses = await Promise.all([send(), send()]);
    expect(responses.map((r) => r.statusCode).sort()).toEqual([200, 409]);
    expect(execute).toHaveBeenCalledTimes(1);
    expect(local.runs.committedTodayUsd({ skillSlug: "reserved" })).toBe(1);
  } finally {
    await server.close();
    local.close();
    tmp.cleanup();
  }
});
