import type { FastifyInstance } from "fastify";
import type { AppContext } from "../context.js";
import { bind } from "../contract.js";
import { httpError, startedByOf } from "./common.js";

/**
 * Conversations (Onda 1). A session groups the runs that continue one
 * provider-side conversation; `POST /api/runs` starts one implicitly, this
 * router lists them, opens one and continues it. Continuing goes through the
 * same `engine.execution.startPrompt` as the prompt box, so the write gate, the path
 * containment and the profile rules are identical.
 */
export function registerSessionRoutes(app: FastifyInstance, ctx: AppContext): void {
  bind(app, "sessions.list", async ({ query: q }, _req, reply) => {
    // Same convention as /api/runs: a plain array plus the total in a header.
    reply.header("x-total-count", String(ctx.runs.sessions.count(q)));
    return ctx.runs.sessions.list(q);
  });

  bind(app, "sessions.get", async ({ params: { id } }) => {
    const session = ctx.runs.sessions.get(id);
    if (!session) throw httpError(404, "Session not found");
    return { session, runs: ctx.runs.list({ sessionId: id, limit: 200 }) };
  });

  /** Continue the conversation: a new run that resumes the provider session. */
  bind(app, "sessions.continue", async ({ params: { id }, body }, req, reply) => {
    // Provider and cwd come from the session itself (`startPrompt` resolves
    // them); a 404 for an unknown session comes from there too.
    const started = ctx.execution.startPrompt(
      { ...body, sessionId: id, startedBy: startedByOf(req) },
      { onError: (err, runId) => req.log.error({ err, runId, sessionId: id, msg: "run failed to execute" }) },
    );
    if (started.status === "waiting_approval") reply.code(202);
    return started;
  });

  /** Rename a conversation (refino item 49). */
  bind(app, "sessions.rename", async ({ params: { id }, body }) => {
    if (!ctx.runs.sessions.get(id)) throw httpError(404, "Session not found");
    ctx.runs.sessions.rename(id, body.title);
    const renamed = ctx.runs.sessions.get(id);
    if (!renamed) throw httpError(404, "Session not found");
    return renamed;
  });

  /** Forget a conversation. Its runs stay in the history, unlinked. */
  bind(app, "sessions.delete", async ({ params: { id } }) => {
    if (!ctx.runs.sessions.get(id)) throw httpError(404, "Session not found");
    return ctx.runs.sessions.delete(id);
  });
}
