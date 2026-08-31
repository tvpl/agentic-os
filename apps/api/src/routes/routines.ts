import { z } from "zod";
import type { FastifyInstance } from "fastify";
import { RoutineSchema } from "@mordomo/core";
import type { AppContext } from "../context.js";

export function registerRoutineRoutes(app: FastifyInstance, ctx: AppContext): void {
  app.get("/api/routines", async () => ctx.scheduler.status());

  app.post("/api/routines", async (req) => {
    const routine = RoutineSchema.parse(req.body);
    if (ctx.routines.get(routine.id)) {
      throw Object.assign(new Error(`Routine "${routine.id}" already exists`), { statusCode: 409 });
    }
    if (routine.skillSlug && !ctx.skills.load(routine.skillSlug)) {
      throw Object.assign(new Error(`Unknown skill: ${routine.skillSlug}`), { statusCode: 400 });
    }
    const saved = ctx.routines.save(routine);
    ctx.scheduler.reload();
    return saved;
  });

  app.put("/api/routines/:id", async (req) => {
    const { id } = z.object({ id: z.string() }).parse(req.params);
    if (!ctx.routines.get(id)) throw Object.assign(new Error("Routine not found"), { statusCode: 404 });
    const routine = RoutineSchema.parse({ ...(req.body as object), id });
    if (routine.skillSlug && !ctx.skills.load(routine.skillSlug)) {
      throw Object.assign(new Error(`Unknown skill: ${routine.skillSlug}`), { statusCode: 400 });
    }
    const saved = ctx.routines.save(routine);
    ctx.scheduler.reload();
    return saved;
  });

  app.post("/api/routines/:id/toggle", async (req) => {
    const { id } = z.object({ id: z.string() }).parse(req.params);
    const routine = ctx.routines.get(id);
    if (!routine) throw Object.assign(new Error("Routine not found"), { statusCode: 404 });
    const saved = ctx.routines.save({ ...routine, enabled: !routine.enabled });
    ctx.scheduler.reload();
    return saved;
  });

  app.post("/api/routines/:id/duplicate", async (req) => {
    const { id } = z.object({ id: z.string() }).parse(req.params);
    const copy = ctx.routines.duplicate(id);
    ctx.scheduler.reload();
    return copy;
  });

  app.delete("/api/routines/:id", async (req) => {
    const { id } = z.object({ id: z.string() }).parse(req.params);
    if (!ctx.routines.remove(id)) throw Object.assign(new Error("Routine not found"), { statusCode: 404 });
    ctx.scheduler.reload();
    return { deleted: id };
  });

  /** Manual test run — returns immediately; watch via /api/runs/:id/stream. */
  app.post("/api/routines/:id/run", async (req) => {
    const { id } = z.object({ id: z.string() }).parse(req.params);
    const routine = ctx.routines.get(id);
    if (!routine) throw Object.assign(new Error("Routine not found"), { statusCode: 404 });
    const firing = ctx.scheduler.fire(id, "manual", null);
    // Give the scheduler a beat to create the run record so we can return its id.
    const record = await Promise.race([
      firing,
      new Promise<null>((resolve) => setTimeout(() => resolve(null), 1500)),
    ]);
    if (record) return { runId: record.id, status: record.status };
    const latest = ctx.runs.list({ limit: 1, origin: "routine" })[0];
    return { runId: latest?.id ?? null, status: latest?.status ?? "queued" };
  });

  app.get("/api/routines/:id/history", async (req) => {
    const { id } = z.object({ id: z.string() }).parse(req.params);
    return ctx.scheduler.history(id, 30);
  });
}
