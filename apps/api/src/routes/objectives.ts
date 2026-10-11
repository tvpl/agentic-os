import { z } from "zod";
import type { FastifyInstance } from "fastify";
import type { StartedRun } from "@mordomo/core";
import {
  EffortLevel,
  ProviderId,
  RUN_LIMITS,
  type RunRequestSpec,
  type SkillRunInput,
} from "@mordomo/core/internal";
import type { AppContext } from "../context.js";
import { httpError, requireProvider, startedByOf } from "./common.js";
import { UuidParams } from "./params.js";

const requestSchema = z.discriminatedUnion("kind", [
  z.object({
    version: z.literal(1),
    kind: z.literal("prompt"),
    prompt: z.string().min(1).max(RUN_LIMITS.promptMaxChars),
    mode: z.enum(["read_only", "write"]),
  }),
  z.object({
    version: z.literal(1),
    kind: z.literal("system"),
    prompt: z.string().min(1).max(RUN_LIMITS.promptMaxChars),
    mode: z.enum(["read_only", "write"]),
  }),
  z.object({
    version: z.literal(1),
    kind: z.literal("skill"),
    skillSlug: z.string().min(1),
    inputs: z.record(z.string(), z.string()),
    mode: z.enum(["read_only", "write"]),
  }),
]);

export function registerObjectiveRoutes(app: FastifyInstance, ctx: AppContext): void {
  app.get("/api/objectives", { config: { scope: "monitor" } }, async () => ctx.objectives.list());

  app.get("/api/objectives/:id", { config: { scope: "monitor" } }, async (req) => {
    const { id } = UuidParams.parse(req.params);
    const objective = ctx.objectives.get(id);
    if (!objective) throw httpError(404, "Objective not found");
    return objective;
  });

  app.delete("/api/objectives/:id", { config: { scope: "owner" } }, async (req) => {
    const { id } = UuidParams.parse(req.params);
    if (!ctx.objectives.delete(id)) throw httpError(404, "Objective not found");
    return { deleted: id };
  });

  app.post("/api/objectives", { config: { scope: "owner" } }, async (req) => {
    const body = z
      .object({
        project: z.string().max(200).nullable().optional(),
        title: z.string().min(1).max(200),
        description: z.string().max(10_000).default(""),
        context: z
          .object({
            sources: z
              .array(
                z.object({ label: z.string(), path: z.string().optional(), version: z.string().optional() }),
              )
              .max(100)
              .optional(),
            decisions: z.array(z.string().max(2_000)).max(100).optional(),
            budgetUsd: z.number().min(0).nullable().optional(),
            retention: z.string().max(500).optional(),
          })
          .default({}),
        steps: z
          .array(
            z.object({
              id: z.string().uuid().optional(),
              title: z.string().min(1).max(200),
              request: requestSchema,
              dependencies: z.array(z.string().uuid()).max(100).default([]),
              resourceKeys: z.array(z.string().min(1).max(500)).max(100).default([]),
              expectedArtifacts: z.array(z.string().min(1).max(500)).max(100).default([]),
              priority: z.number().int().min(-100).max(100).default(0),
            }),
          )
          .min(1)
          .max(100),
      })
      .parse(req.body);
    try {
      return ctx.objectives.create({
        ...body,
        steps: body.steps as Array<(typeof body.steps)[number] & { request: RunRequestSpec }>,
      });
    } catch (error) {
      throw httpError(400, (error as Error).message, "invalid_objective");
    }
  });

  app.post("/api/objectives/:id/dispatch", { config: { scope: "owner" } }, async (req) => {
    const { id } = UuidParams.parse(req.params);
    if (!ctx.objectives.get(id)) throw httpError(404, "Objective not found");
    const body = z
      .object({
        limit: z.number().int().min(1).max(8).default(2),
        provider: ProviderId.optional(),
        model: z.string().nullable().optional(),
        effort: EffortLevel.optional(),
        cwd: z.string().optional(),
        timeoutMs: z.number().int().min(RUN_LIMITS.timeoutMinMs).max(RUN_LIMITS.timeoutMaxMs).optional(),
      })
      .default({})
      .parse(req.body ?? {});
    const settings = ctx.settings();
    const provider = body.provider ?? settings.defaultProvider;
    const providerSettings = requireProvider(ctx, provider, settings);
    if (!providerSettings.enabled) throw httpError(400, `Provider ${provider} is not enabled`);
    const results: Array<{ stepId: string; runId: string | null; status: string }> = [];
    for (const step of ctx.objectives.ready(id, body.limit)) {
      const cwd = ctx.resolveCwd(body.cwd);
      const timeoutMs = body.timeoutMs ?? settings.limits.defaultTimeoutMs;
      const model = body.model !== undefined ? body.model : providerSettings.defaultModel;
      const effort = body.effort ?? providerSettings.defaultEffort;
      const packet = JSON.stringify(ctx.objectives.contextPacket(id, step.id), null, 2);
      const onError = (error: unknown, failedRunId: string) =>
        req.log.error({ error, runId: failedRunId, objectiveId: id, stepId: step.id });
      let started: StartedRun;
      if (step.request.kind === "skill") {
        const input: SkillRunInput = {
          slug: step.request.skillSlug,
          inputs: step.request.inputs,
          provider,
          model,
          effort,
          cwd,
          timeoutMs,
          startedBy: startedByOf(req),
        };
        started = ctx.execution.gateAndLaunchSkill(input, `Objective step: ${step.title}`, onError);
      } else {
        const prompt = `Objective context packet (local, versioned):\n${packet}\n\nStep request:\n${step.request.prompt}`;
        // The prompt is assembled here from the objective's own records, not typed by a caller.
        started = ctx.execution.startPrompt(
          {
            prompt,
            provider,
            model,
            effort,
            mode: step.request.mode,
            cwd,
            // Only what the caller asked for: the engine applies the setting's default itself, and that default is
            // not held to the cap on a request (the setting only has a floor).
            timeoutMs: body.timeoutMs,
            startedBy: startedByOf(req),
          },
          { onError, composed: true },
        );
      }
      const { runId, status } = started;
      ctx.objectives.markDispatched(step.id, runId, status === "waiting_approval");
      const current = ctx.runs.get(runId);
      if (current && !["queued", "running", "waiting_approval"].includes(current.status))
        ctx.objectives.syncRun(current, ctx.runs);
      results.push({ stepId: step.id, runId, status });
    }
    return { objectiveId: id, dispatched: results };
  });

  app.post("/api/objectives/:id/steps/:stepId/retry", { config: { scope: "owner" } }, async (req) => {
    const params = z.object({ id: z.string().uuid(), stepId: z.string().uuid() }).parse(req.params);
    const { effectsReconciled } = z
      .object({ effectsReconciled: z.boolean().default(false) })
      .default({})
      .parse(req.body ?? {});
    const objective = ctx.objectives.get(params.id);
    if (!objective || !objective.steps.some((step) => step.id === params.stepId))
      throw httpError(404, "Objective step not found");
    try {
      return ctx.objectives.retryStep(params.stepId, effectsReconciled);
    } catch (error) {
      throw httpError(409, (error as Error).message, "step_not_retryable");
    }
  });
}
