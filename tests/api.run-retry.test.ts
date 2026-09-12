import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { AppContext } from "../apps/api/src/context.js";
import { buildServer } from "../apps/api/src/server.js";
import { FAKE_BIN, makeTempHome, withFakeBinPath } from "./helpers.js";

describe("durable retry API", () => {
  let app: FastifyInstance;
  let ctx: AppContext;
  let token: string;
  let cleanup: () => void;
  let restorePath: () => void;

  beforeAll(async () => {
    restorePath = withFakeBinPath();
    const temp = makeTempHome("mordomo-retry-api-");
    cleanup = temp.cleanup;
    const skillDir = path.join(temp.paths.skills, "retry-fixture");
    fs.mkdirSync(skillDir, { recursive: true });
    fs.writeFileSync(
      path.join(skillDir, "SKILL.md"),
      [
        "---",
        "name: Retry fixture",
        "slug: retry-fixture",
        "description: Exercises durable skill retries",
        "inputs:",
        "  - name: target",
        "    label: Target",
        "    type: text",
        "    required: true",
        "mode: read_only",
        "---",
        "Process the exact target supplied.",
      ].join("\n"),
    );
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

  it("repeats a complete long prompt once for one submission id", async () => {
    const prompt = "complete request ".repeat(60);
    const first = await app.inject({
      method: "POST",
      url: "/api/runs",
      headers: auth(),
      payload: { prompt },
    });
    const sourceId = first.json().runId as string;
    const detail = await app.inject({ method: "GET", url: `/api/runs/${sourceId}`, headers: auth() });
    expect(detail.json().run.request.prompt).toBe(prompt);

    const submissionId = crypto.randomUUID();
    const payload = { submissionId };
    const retry = await app.inject({
      method: "POST",
      url: `/api/runs/${sourceId}/retry`,
      headers: auth(),
      payload,
    });
    expect(retry.statusCode).toBe(200);
    const retriedId = retry.json().runId as string;
    const duplicate = await app.inject({
      method: "POST",
      url: `/api/runs/${sourceId}/retry`,
      headers: auth(),
      payload,
    });
    expect(duplicate.json().runId).toBe(retriedId);
    expect(ctx.runs.get(retriedId)?.request).toMatchObject({ kind: "prompt", prompt });
    expect(ctx.runs.get(retriedId)?.parentRunId).toBe(sourceId);
  });

  it("refuses to guess the request of a legacy run", async () => {
    const legacy = ctx.runs.create({
      origin: "manual",
      provider: "claude",
      prompt: "summary only",
      cwd: ctx.paths.home,
      model: null,
      effort: "default",
      mode: "read_only",
      timeoutMs: 10_000,
      profile: "read_only",
    });
    const response = await app.inject({
      method: "POST",
      url: `/api/runs/${legacy.id}/retry`,
      headers: auth(),
      payload: { submissionId: crypto.randomUUID() },
    });
    expect(response.statusCode).toBe(409);
    expect(response.body).toContain("request_unavailable");
  });

  it("repeats a skill with its exact inputs, timeout and lineage", async () => {
    const launched = await app.inject({
      method: "POST",
      url: "/api/skills/retry-fixture/run",
      headers: auth(),
      payload: { inputs: { target: "folder with spaces" }, timeoutMs: 73_000 },
    });
    expect(launched.statusCode).toBe(200);
    const sourceId = launched.json().runId as string;
    const retried = await app.inject({
      method: "POST",
      url: `/api/runs/${sourceId}/retry`,
      headers: auth(),
      payload: { submissionId: crypto.randomUUID() },
    });
    expect(retried.statusCode).toBe(200);
    const retry = ctx.runs.get(retried.json().runId as string)!;
    expect(retry.request).toEqual({
      version: 1,
      kind: "skill",
      skillSlug: "retry-fixture",
      inputs: { target: "folder with spaces" },
      mode: "read_only",
    });
    expect(retry.timeoutMs).toBe(73_000);
    expect(retry.parentRunId).toBe(sourceId);
  });
});
