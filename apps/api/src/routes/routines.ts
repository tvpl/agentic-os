import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { RoutineSchema, events } from "@mordomo/core";
import type { AppContext } from "../context.js";
import { httpError } from "./common.js";
import { IdParams } from "./params.js";

const SilentQuery = z.object({ days: z.coerce.number().int().min(1).max(365).default(30) });

export function registerRoutineRoutes(app: FastifyInstance, ctx: AppContext): void {
  const changed = (id: string, action: string) => events.emit("routine.changed", { id, action });
  /**
   * Webhook delivery is a settings-level opt-in: `settings.routines.allowWebhooks`.
   * The store refuses `delivery: "webhook"` when it is off, which surfaces as a 400.
   */
  const saveOpts = () => ({ allowWebhooks: ctx.settings().routines.allowWebhooks });
  /** Semantic routine errors from core carry no statusCode: they are user input problems. */
  const save = <T>(fn: () => T): T => {
    try {
      return fn();
    } catch (err) {
      const e = err as Error & { statusCode?: number };
      if (e.statusCode) throw e;
      throw httpError(400, e.message);
    }
  };

  app.get("/api/routines", async () => ctx.scheduler.status());

  /** Dashboard footer: "n/m fired today" plus the routine count per runner and kind. */
  app.get("/api/routines/summary", async () => ctx.scheduler.summary());

  /** Hygiene input: routines that never fired, went quiet, or keep failing inside the window. */
  app.get("/api/routines/silent", async (req) => {
    const { days } = SilentQuery.parse(req.query ?? {});
    return { days, routines: ctx.scheduler.silent(days) };
  });

  app.post("/api/routines", async (req) => {
    const routine = RoutineSchema.parse(req.body);
    if (ctx.routines.get(routine.id)) throw httpError(409, `Routine "${routine.id}" already exists`);
    if (routine.skillSlug && !ctx.skills.load(routine.skillSlug)) {
      throw httpError(400, `Unknown skill: ${routine.skillSlug}`);
    }
    const saved = save(() => ctx.routines.save(routine, saveOpts()));
    ctx.scheduler.reload();
    changed(saved.id, "created");
    return saved;
  });

  app.put("/api/routines/:id", async (req) => {
    const { id } = IdParams.parse(req.params);
    if (!ctx.routines.get(id)) throw httpError(404, "Routine not found");
    const routine = RoutineSchema.parse({ ...(req.body as object), id });
    if (routine.skillSlug && !ctx.skills.load(routine.skillSlug)) {
      throw httpError(400, `Unknown skill: ${routine.skillSlug}`);
    }
    const saved = save(() => ctx.routines.save(routine, saveOpts()));
    ctx.scheduler.reload();
    changed(id, "updated");
    return saved;
  });

  app.post("/api/routines/:id/toggle", async (req) => {
    const { id } = IdParams.parse(req.params);
    const routine = ctx.routines.get(id);
    if (!routine) throw httpError(404, "Routine not found");
    // Re-enabling a one-shot that already fired clears the reason it ended.
    const enabled = !routine.enabled;
    const saved = save(() =>
      ctx.routines.save(
        { ...routine, enabled, endedReason: enabled ? null : routine.endedReason },
        saveOpts(),
      ),
    );
    ctx.scheduler.reload();
    changed(id, saved.enabled ? "enabled" : "disabled");
    return saved;
  });

  app.post("/api/routines/:id/duplicate", async (req) => {
    const { id } = IdParams.parse(req.params);
    if (!ctx.routines.get(id)) throw httpError(404, "Routine not found");
    const copy = save(() => ctx.routines.duplicate(id, saveOpts()));
    ctx.scheduler.reload();
    changed(copy.id, "created");
    return copy;
  });

  app.delete("/api/routines/:id", async (req) => {
    const { id } = IdParams.parse(req.params);
    if (!ctx.routines.remove(id)) throw httpError(404, "Routine not found");
    ctx.scheduler.reload();
    changed(id, "deleted");
    return { deleted: id };
  });

  /** Manual test run — returns the real run id; watch via /api/runs/:id/stream. */
  app.post("/api/routines/:id/run", async (req) => {
    const { id } = IdParams.parse(req.params);
    if (!ctx.routines.get(id)) throw httpError(404, "Routine not found");
    // fire() creates the run row and resolves at once; execution continues
    // in the background (409 from core if the routine is already in flight).
    const { runId, status } = await ctx.scheduler.fire(id, { reason: "manual" });
    return { runId, status };
  });

  app.get("/api/routines/:id/history", async (req) => {
    const { id } = IdParams.parse(req.params);
    return ctx.scheduler.history(id, 30);
  });
}
