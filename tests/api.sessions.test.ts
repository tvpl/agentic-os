import { describe, expect, it, beforeAll, afterAll } from "vitest";
import path from "node:path";
import type { FastifyInstance } from "fastify";
import { AppContext } from "../apps/api/src/context.js";
import { buildServer } from "../apps/api/src/server.js";
import { FAKE_BIN, makeTempHome, withFakeBinPath } from "./helpers.js";

/** Conversations over HTTP: start, list, open, continue, forget. */

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

/** Wait for a run to leave the live statuses (the fake CLI finishes fast). */
async function settle(runId: string): Promise<void> {
  for (let i = 0; i < 100; i++) {
    const status = ctx.runs.get(runId)?.status;
    if (status && !["queued", "running", "waiting_approval"].includes(status)) return;
    await new Promise((r) => setTimeout(r, 50));
  }
}

describe("sessions API", () => {
  it("starts a conversation from POST /api/runs and continues it", async () => {
    const first = await app.inject({
      method: "POST",
      url: "/api/runs",
      headers: auth(),
      payload: { prompt: "hello there" },
    });
    expect(first.statusCode).toBe(200);
    const { runId, sessionId, status } = first.json() as {
      runId: string;
      sessionId: string;
      status: string;
    };
    expect(status).toBe("queued"); // unchanged shape for existing callers
    expect(sessionId).toBeTruthy();
    await settle(runId);

    // The run row points at the conversation, and so does GET /api/runs/:id.
    const detail = await app.inject({ method: "GET", url: `/api/runs/${runId}`, headers: auth() });
    expect(detail.json().run.sessionId).toBe(sessionId);

    const listed = await app.inject({ method: "GET", url: "/api/sessions", headers: auth() });
    expect(listed.statusCode).toBe(200);
    expect(listed.headers["x-total-count"]).toBe("1");
    const [session] = listed.json() as Array<{
      id: string;
      title: string;
      turns: number;
      providerSessionId: string | null;
      lastRun: { id: string } | null;
      runCount: number;
    }>;
    expect(session?.id).toBe(sessionId);
    expect(session?.title).toBe("hello there");
    expect(session?.turns).toBe(1);
    expect(session?.providerSessionId).toBeTruthy(); // captured from the stream
    expect(session?.lastRun?.id).toBe(runId);
    expect(session?.runCount).toBe(1);

    const cont = await app.inject({
      method: "POST",
      url: `/api/sessions/${sessionId}/continue`,
      headers: auth(),
      payload: { prompt: "and now the follow-up" },
    });
    expect(cont.statusCode).toBe(200);
    const second = cont.json() as { runId: string; sessionId: string };
    expect(second.sessionId).toBe(sessionId);
    await settle(second.runId);

    const opened = await app.inject({ method: "GET", url: `/api/sessions/${sessionId}`, headers: auth() });
    expect(opened.statusCode).toBe(200);
    const body = opened.json() as { session: { turns: number }; runs: Array<{ id: string }> };
    expect(body.session.turns).toBe(2);
    expect(body.runs.map((r) => r.id)).toEqual([second.runId, runId]);

    // Forgetting the conversation keeps the runs.
    const del = await app.inject({ method: "DELETE", url: `/api/sessions/${sessionId}`, headers: auth() });
    expect(del.json()).toEqual({ deleted: true, runsKept: 2 });
    expect(ctx.runs.get(runId)?.sessionId).toBeNull();
    const gone = await app.inject({ method: "GET", url: `/api/sessions/${sessionId}`, headers: auth() });
    expect(gone.statusCode).toBe(404);
  });

  it("refuses to continue an unknown conversation", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/sessions/11111111-1111-4111-8111-111111111111/continue",
      headers: auth(),
      payload: { prompt: "hi" },
    });
    expect(res.statusCode).toBe(404);
  });

  it("requires the local token", async () => {
    expect((await app.inject({ method: "GET", url: "/api/sessions" })).statusCode).toBe(401);
  });
});
