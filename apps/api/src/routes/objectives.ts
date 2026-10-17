import type { FastifyInstance } from "fastify";
import type { StartedRun } from "@mordomo/core";
import type { RunRequestSpec, SkillRunInput } from "@mordomo/core/internal";
import type { AppContext } from "../context.js";
import { bind } from "../contract.js";
import { httpError, requireProvider, startedByOf } from "./common.js";

export function registerObjectiveRoutes(app: FastifyInstance, ctx: AppContext): void {
  bind(app, "objectives.list", async () => ctx.objectives.list());

  bind(app, "objectives.get", async ({ params: { id } }) => {
    const objective = ctx.objectives.get(id);
    if (!objective) throw httpError(404, "Objective not found");
    return objective;
  });

  bind(app, "objectives.delete", async ({ params: { id } }) => {
    if (!ctx.objectives.delete(id)) throw httpError(404, "Objective not found");
    return { deleted: id };
  });

  bind(app, "objectives.create", async ({ body }) => {
    try {
      return ctx.objectives.create({
        ...body,
        steps: body.steps as Array<(typeof body.steps)[number] & { request: RunRequestSpec }>,
      });
    } catch (error) {
      throw httpError(400, (error as Error).message, "invalid_objective");
    }
  });

  bind(
    app,
    "objectives.dispatch",
    async ({ params: { id }, body }, req) => {
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
    },
    {
      // The objective is looked for before the body is read, as it always was: a wrong body for an objective that
      // is not there is a 404.
      precheck: ({ params: { id } }) => {
        if (!ctx.objectives.get(id)) throw httpError(404, "Objective not found");
      },
    },
  );

  bind(app, "objectives.retryStep", async ({ params, body: { effectsReconciled } }) => {
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
