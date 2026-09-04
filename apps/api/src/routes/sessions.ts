import { z } from "zod";
import type { FastifyInstance } from "fastify";
import { EffortLevel, ProviderId } from "@mordomo/core";
import type { AppContext } from "../context.js";
import { httpError, submitPromptRun } from "./common.js";
import { UuidParams } from "./params.js";

/**
 * Conversations (Onda 1). A session groups the runs that continue one
 * provider-side conversation; `POST /api/runs` starts one implicitly, this
 * router lists them, opens one and continues it. Continuing goes through the
 * same `submitPromptRun` as the prompt box, so the write gate, the path
 * containment and the profile rules are identical.
 */
export function registerSessionRoutes(app: FastifyInstance, ctx: AppContext): void {
  app.get("/api/sessions", async (req, reply) => {
    const q = z
      .object({
        limit: z.coerce.number().int().min(1).max(200).default(50),
        offset: z.coerce.number().int().min(0).max(1_000_000).default(0),
        provider: ProviderId.optional(),
      })
      .parse(req.query);
    // Same convention as /api/runs: a plain array plus the total in a header.
    reply.header("x-total-count", String(ctx.runs.sessions.count(q)));
    return ctx.runs.sessions.list(q);
  });

  app.get("/api/sessions/:id", async (req) => {
    const { id } = UuidParams.parse(req.params);
    const session = ctx.runs.sessions.get(id);
    if (!session) throw httpError(404, "Session not found");
    return { session, runs: ctx.runs.list({ sessionId: id, limit: 200 }) };
  });

  /** Continue the conversation: a new run that resumes the provider session. */
  app.post("/api/sessions/:id/continue", async (req, reply) => {
    const { id } = UuidParams.parse(req.params);
    const body = z
      .object({
        prompt: z.string().min(1).max(20_000),
        mode: z.enum(["read_only", "write"]).default("read_only"),
        effort: EffortLevel.optional(),
        model: z.string().nullable().optional(),
        timeoutMs: z.number().int().min(10_000).max(3_600_000).optional(),
      })
      .parse(req.body);
    // Provider and cwd come from the session itself (submitPromptRun resolves
    // them); a 404 for an unknown session comes from there too.
    const result = submitPromptRun(ctx, { ...body, sessionId: id }, (err, runId) =>
      req.log.error({ err, runId, sessionId: id, msg: "run failed to execute" }),
    );
    if (result.statusCode !== 200) reply.code(result.statusCode);
    return result.body;
  });

  /** Forget a conversation. Its runs stay in the history, unlinked. */
  app.delete("/api/sessions/:id", async (req) => {
    const { id } = UuidParams.parse(req.params);
    if (!ctx.runs.sessions.get(id)) throw httpError(404, "Session not found");
    return ctx.runs.sessions.delete(id);
  });
}
