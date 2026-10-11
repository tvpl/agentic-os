import { EventEmitter } from "node:events";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { FastifyInstance } from "fastify";
import { AppContext } from "../apps/api/src/context.js";
import { buildServer } from "../apps/api/src/server.js";
import { closeAllSse, openSse } from "../apps/api/src/routes/sse.js";
import { FAKE_BIN, FAKE_CLIS_RUNNABLE, makeTempHome, withFakeBinPath } from "./helpers.js";

/**
 * What the HTTP routes answer now that they are clients of `engine.execution` (.specs/features/sdk-core, S3, round 1
 * of the verification): the answers that did not change are held to what the base answered, and the ones that did
 * are said here, with the number of the check.
 */

describe.skipIf(!FAKE_CLIS_RUNNABLE)("the routes answer as they did", () => {
  let app: FastifyInstance, ctx: AppContext, token: string, cleanup: () => void, restorePath: () => void;
  let home: string;
  beforeAll(async () => {
    restorePath = withFakeBinPath();
    const temp = makeTempHome("mordomo-sdk-http-");
    cleanup = temp.cleanup;
    home = temp.paths.home;
    fs.mkdirSync(path.join(home, "skills", "noted"), { recursive: true });
    fs.writeFileSync(
      path.join(home, "skills", "noted", "SKILL.md"),
      "---\nname: Noted\nslug: noted\ndescription: A skill with notes\n---\n\nDo the thing.\n",
    );
    ctx = new AppContext(home);
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
  const post = (url: string, payload: unknown = {}) =>
    app.inject({ method: "POST", url, headers: auth(), payload: payload as never });

  async function newObjective(prompt: string, extra: Record<string, unknown> = {}) {
    const created = await post("/api/objectives", {
      project: "engine",
      title: "Objective",
      steps: [{ title: "Step", request: { version: 1, kind: "prompt", prompt, mode: "read_only" } }],
      ...extra,
    });
    expect(created.statusCode).toBe(200);
    return created.json().id as string;
  }

  async function finished(runId: string): Promise<void> {
    for (let i = 0; i < 200; i++) {
      const status = ctx.runs.get(runId)?.status;
      if (status && !["queued", "running", "waiting_approval"].includes(status)) return;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    throw new Error(`run ${runId} did not finish`);
  }

  it("C61 a prompt step is dispatched whatever the setting's default timeout is, and its context packet is not held to the prompt bound", async () => {
    // The setting only has a floor (contracts/src/settings.ts), so two hours is a value the owner may have chosen;
    // the cap of 3 600 000 belongs to the timeout a caller asks for, not to the default the engine applies.
    const settings = ctx.settings();
    settings.limits.defaultTimeoutMs = 7_200_000;
    ctx.settingsStore.save(settings);
    // 20 000 characters is the longest prompt a caller may type; the packet the engine adds goes past it.
    const objectiveId = await newObjective("p".repeat(20_000), {
      context: { decisions: ["Keep evidence local"] },
    });
    const dispatched = await post(`/api/objectives/${objectiveId}/dispatch`, { limit: 1 });
    expect(dispatched.statusCode, dispatched.body).toBe(200);
    const runId = dispatched.json().dispatched[0].runId as string;
    const run = ctx.runs.get(runId)!;
    expect(run.timeoutMs).toBe(7_200_000);
    expect(run.request?.kind === "prompt" && run.request.prompt.length).toBeGreaterThan(20_000);
    await finished(runId);

    // A timeout the caller asks for is still held to the bound.
    const again = await newObjective("short");
    const refused = await post(`/api/objectives/${again}/dispatch`, { limit: 1, timeoutMs: 3_600_001 });
    expect(refused.statusCode).toBe(400);
    const accepted = await post(`/api/objectives/${again}/dispatch`, { limit: 1, timeoutMs: 3_600_000 });
    expect(accepted.statusCode, accepted.body).toBe(200);
    const asked = accepted.json().dispatched[0].runId as string;
    expect(ctx.runs.get(asked)?.timeoutMs).toBe(3_600_000);
    await finished(asked);

    // A prompt typed by a caller keeps its bound, on the route that takes one.
    const typed = await post("/api/runs", { prompt: "p".repeat(20_001) });
    expect(typed.statusCode).toBe(400);
    const setting = await post("/api/runs", { prompt: "default timeout" });
    expect(setting.statusCode).toBe(200);
    expect(ctx.runs.get(setting.json().runId as string)?.timeoutMs).toBe(7_200_000);
    await finished(setting.json().runId as string);
    settings.limits.defaultTimeoutMs = 600_000;
    ctx.settingsStore.save(settings);
  });

  it("C69 every route that starts a run takes the setting's default timeout as it is, above the cap on a request", async () => {
    const settings = ctx.settings();
    settings.limits.defaultTimeoutMs = 7_200_000;
    ctx.settingsStore.save(settings);
    try {
      const parent = await post("/api/runs", { prompt: "the parent" });
      const parentId = parent.json().runId as string;
      const sessionId = parent.json().sessionId as string;
      await finished(parentId);
      const retry = (id: string) => post(`/api/runs/${id}/retry`, { submissionId: crypto.randomUUID() });
      const skillRun = await post("/api/skills/noted/run", {});
      await finished(skillRun.json().runId as string);

      const objective = async (request: Record<string, unknown>) => {
        const created = await post("/api/objectives", {
          title: "Objective",
          steps: [{ title: "Step", request }],
        });
        const dispatched = await post(`/api/objectives/${created.json().id}/dispatch`, { limit: 1 });
        return dispatched.json().dispatched[0]?.runId as string;
      };
      const callers: Array<[string, () => Promise<string | undefined>]> = [
        ["POST /api/runs", async () => parentId],
        [
          "POST /api/runs/:id/children",
          async () =>
            (await post(`/api/runs/${parentId}/children`, { prompts: ["a child"] })).json().runs[0]?.runId,
        ],
        [
          "POST /api/sessions/:id/continue",
          async () =>
            (await post(`/api/sessions/${sessionId}/continue`, { prompt: "and again" })).json().runId,
        ],
        ["POST /api/skills/:slug/run", async () => skillRun.json().runId],
        ["POST /api/runs/:id/retry of a prompt", async () => (await retry(parentId)).json().runId],
        [
          "POST /api/runs/:id/retry of a skill",
          async () => (await retry(skillRun.json().runId)).json().runId,
        ],
        [
          "dispatch of a prompt step",
          () => objective({ version: 1, kind: "prompt", prompt: "a step", mode: "read_only" }),
        ],
        [
          "dispatch of a skill step",
          () => objective({ version: 1, kind: "skill", skillSlug: "noted", inputs: {}, mode: "read_only" }),
        ],
      ];
      for (const [label, start] of callers) {
        const runId = await start();
        expect(runId, label).toBeTruthy();
        await finished(runId!);
        expect(ctx.runs.get(runId!)?.timeoutMs, label).toBe(7_200_000);
      }
      // A retry of a run that recorded no timeout takes the default too.
      ctx.db
        .prepare("UPDATE runs SET timeout_ms = NULL WHERE id IN (?, ?)")
        .run(parentId, skillRun.json().runId);
      for (const id of [parentId, skillRun.json().runId as string]) {
        const again = (await retry(id)).json().runId as string;
        await finished(again);
        expect(ctx.runs.get(again)?.timeoutMs, `retry of ${id} with no timeout recorded`).toBe(7_200_000);
      }
    } finally {
      settings.limits.defaultTimeoutMs = 600_000;
      ctx.settingsStore.save(settings);
    }
  });

  it("C70 a timeout a caller asks for is held to 3 600 000 by every route that takes one", async () => {
    const parent = await post("/api/runs", { prompt: "the parent" });
    await finished(parent.json().runId as string);
    const asks: Array<[string, string, Record<string, unknown>]> = [
      ["/api/runs", "runs", { prompt: "x" }],
      [`/api/runs/${parent.json().runId}/children`, "children", { prompts: ["x"] }],
      [`/api/sessions/${parent.json().sessionId}/continue`, "continue", { prompt: "x" }],
      ["/api/skills/noted/run", "skills run", {}],
    ];
    for (const [url, label, body] of asks) {
      const over = await post(url, { ...body, timeoutMs: 3_600_001 });
      expect(over.statusCode, `${label}: 3 600 001`).toBe(400);
      const under = await post(url, { ...body, timeoutMs: 9_999 });
      expect(under.statusCode, `${label}: 9 999`).toBe(400);
      const edge = await post(url, { ...body, timeoutMs: 3_600_000 });
      expect(edge.statusCode, `${label}: 3 600 000 ${edge.body}`).toBe(200);
      const runId = (edge.json().runId ?? edge.json().runs?.[0]?.runId) as string;
      await finished(runId);
      expect(ctx.runs.get(runId)?.timeoutMs, label).toBe(3_600_000);
    }
  });

  it("C63 the replay of a retry that was parked answers 202, like the call it repeats", async () => {
    // Before this feature the replay answered 200 with the same body; the body says `waiting_approval`, and the
    // status now says it too (AD-022 e).
    const settings = ctx.settings();
    settings.securityProfile = "review_before_write";
    ctx.settingsStore.save(settings);
    try {
      const first = await post("/api/runs", { prompt: "change something", mode: "write" });
      expect(first.statusCode).toBe(202);
      const sourceId = first.json().runId as string;
      const submissionId = crypto.randomUUID();
      const retried = await post(`/api/runs/${sourceId}/retry`, { submissionId });
      expect(retried.statusCode).toBe(202);
      const replay = await post(`/api/runs/${sourceId}/retry`, { submissionId });
      expect(replay.statusCode).toBe(202);
      expect(replay.json()).toEqual(retried.json());
      // And the replay of a run that was queued stays 200.
      settings.securityProfile = "read_only";
      ctx.settingsStore.save(settings);
      const read = await post("/api/runs", { prompt: "just read" });
      expect(read.statusCode).toBe(200);
      const readSubmission = crypto.randomUUID();
      const once = await post(`/api/runs/${read.json().runId}/retry`, { submissionId: readSubmission });
      const twice = await post(`/api/runs/${read.json().runId}/retry`, { submissionId: readSubmission });
      expect([once.statusCode, twice.statusCode]).toEqual([200, 200]);
      await finished(read.json().runId as string);
      await finished(once.json().runId as string);
    } finally {
      settings.securityProfile = "read_only";
      ctx.settingsStore.save(settings);
    }
  });

  it("C64 the notes promotion and the smoke test are recorded as asked by the owner", async () => {
    const settings = ctx.settings();
    settings.securityProfile = "review_before_write";
    ctx.settingsStore.save(settings);
    try {
      await post("/api/skills/noted/notes", { text: "Always check the invoice number twice." });
      const promoted = await post("/api/skills/noted/notes/promote");
      expect(promoted.statusCode).toBe(202);
      expect(ctx.runs.get(promoted.json().runId as string)?.startedBy).toBe("owner");
      const smoke = await post("/api/providers/claude/smoke");
      expect(smoke.statusCode).toBe(200);
      expect(ctx.runs.get(smoke.json().run.id as string)?.startedBy).toBe("owner");
    } finally {
      settings.securityProfile = "read_only";
      ctx.settingsStore.save(settings);
    }
  });
});

describe("C62 the streams of a server end with that server", () => {
  function fakeRequest(server: object) {
    return { server, raw: new EventEmitter(), headers: {}, query: {} } as never;
  }
  function fakeReply() {
    const raw = Object.assign(new EventEmitter(), {
      writeHead: vi.fn(),
      flushHeaders: vi.fn(),
      end: vi.fn(),
      write: vi.fn(() => true),
    });
    return { reply: { hijack: vi.fn(), raw } as never, raw };
  }

  it("closeAllSse(app) ends the channels of that server and none of another in the same process", () => {
    const serverA = { name: "a" } as never;
    const serverB = { name: "b" } as never;
    const a = fakeReply();
    const b = fakeReply();
    const channelA = openSse(fakeRequest(serverA), a.reply, { heartbeatMs: 60_000 });
    const channelB = openSse(fakeRequest(serverB), b.reply, { heartbeatMs: 60_000 });
    closeAllSse(serverA);
    expect(channelA.closed).toBe(true);
    expect(a.raw.end).toHaveBeenCalledOnce();
    expect(channelB.closed).toBe(false);
    expect(b.raw.end).not.toHaveBeenCalled();
    closeAllSse(serverB);
    expect(channelB.closed).toBe(true);
  });
});
