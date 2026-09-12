import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { AppContext } from "../apps/api/src/context.js";
import { buildServer } from "../apps/api/src/server.js";
import { FAKE_BIN, FAKE_CLIS_RUNNABLE, makeTempHome, withFakeBinPath } from "./helpers.js";

describe.skipIf(!FAKE_CLIS_RUNNABLE)("objective API", () => {
  let app: FastifyInstance, ctx: AppContext, token: string, cleanup: () => void, restorePath: () => void;
  beforeAll(async () => {
    restorePath = withFakeBinPath();
    const temp = makeTempHome("mordomo-objective-api-");
    cleanup = temp.cleanup;
    ctx = new AppContext(temp.paths.home);
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
  const auth = () => ({ "x-mordomo-token": token });

  it("dispatches a ready step with an inspectable context packet and verifies it", async () => {
    const created = await app.inject({
      method: "POST",
      url: "/api/objectives",
      headers: auth(),
      payload: {
        project: "engine",
        title: "Objective contract",
        description: "prove the orchestration path",
        context: {
          sources: [{ label: "plan", path: "docs/plan.md", version: "1" }],
          decisions: ["Keep evidence local"],
        },
        steps: [
          {
            title: "Inspect",
            request: { version: 1, kind: "prompt", prompt: "Return a concise result", mode: "read_only" },
            priority: 10,
          },
        ],
      },
    });
    expect(created.statusCode).toBe(200);
    const objectiveId = created.json().id as string;
    const dispatched = await app.inject({
      method: "POST",
      url: `/api/objectives/${objectiveId}/dispatch`,
      headers: auth(),
      payload: { limit: 1 },
    });
    expect(dispatched.statusCode).toBe(200);
    expect(dispatched.json().dispatched).toHaveLength(1);
    let objective = created.json();
    for (let i = 0; i < 50; i++) {
      objective = (
        await app.inject({ method: "GET", url: `/api/objectives/${objectiveId}`, headers: auth() })
      ).json();
      if (["completed", "blocked"].includes(objective.status)) break;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    expect(objective.status).toBe("completed");
    expect(objective.steps[0].evidence).toMatchObject({ verified: true, processStatus: "done" });
    const run = ctx.runs.get(objective.steps[0].runId)!;
    expect(run.request.prompt).toContain("Objective context packet");
    expect(run.request.prompt).toContain("Keep evidence local");
  });
});
