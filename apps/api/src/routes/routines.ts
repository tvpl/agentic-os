import type { FastifyInstance } from "fastify";
import { RoutineSchema } from "@mordomo/core/internal";
import type { AppContext } from "../context.js";
import { bind } from "../contract.js";
import { httpError, requireProvider } from "./common.js";

export function registerRoutineRoutes(app: FastifyInstance, ctx: AppContext): void {
  const changed = (id: string, action: string) => ctx.events.emit("routine.changed", { id, action });
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

  /**
   * `workingDir` is where an agent will start: the same rule as a run's `cwd`
   * (inside a granted folder, outside the home's `config/` and `logs/`), at
   * create and edit. The scheduler applies it again at every fire, because the
   * folder may have been revoked or turned private since.
   */
  const checkWorkingDir = (workingDir: string | null): void => {
    if (workingDir) ctx.resolveCwd(workingDir); // PathAccessError → 403 forbidden_path
  };

  bind(app, "routines.list", async () => ctx.scheduler.status());

  /** Dashboard footer: "n/m fired today" plus the routine count per runner and kind. */
  bind(app, "routines.summary", async () => ctx.scheduler.summary());

  /** Hygiene input: routines that never fired, went quiet, or keep failing inside the window. */
  bind(app, "routines.silent", async ({ query: { days } }) => {
    return { days, routines: ctx.scheduler.silent(days) };
  });

  bind(app, "routines.create", async ({ body: routine }) => {
    requireProvider(ctx, routine.provider);
    checkWorkingDir(routine.workingDir);
    if (ctx.routines.get(routine.id)) throw httpError(409, `Routine "${routine.id}" already exists`);
    if (routine.skillSlug && !ctx.skills.load(routine.skillSlug)) {
      throw httpError(400, `Unknown skill: ${routine.skillSlug}`);
    }
    const saved = save(() => ctx.routines.save(routine, saveOpts()));
    ctx.scheduler.reload();
    changed(saved.id, "created");
    return saved;
  });

  bind(
    app,
    "routines.update",
    async ({ params: { id }, body }) => {
      // The id in the URL names the routine; the body may leave its own out.
      const routine = RoutineSchema.parse({ ...body, id });
      requireProvider(ctx, routine.provider);
      checkWorkingDir(routine.workingDir);
      if (routine.skillSlug && !ctx.skills.load(routine.skillSlug)) {
        throw httpError(400, `Unknown skill: ${routine.skillSlug}`);
      }
      const saved = save(() => ctx.routines.save(routine, saveOpts()));
      ctx.scheduler.reload();
      changed(id, "updated");
      return saved;
    },
    {
      // The routine is looked for before the body is read, as it always was.
      precheck: ({ params: { id } }) => {
        if (!ctx.routines.get(id)) throw httpError(404, "Routine not found");
      },
    },
  );

  bind(app, "routines.toggle", async ({ params: { id } }) => {
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

  bind(app, "routines.duplicate", async ({ params: { id } }) => {
    if (!ctx.routines.get(id)) throw httpError(404, "Routine not found");
    const copy = save(() => ctx.routines.duplicate(id, saveOpts()));
    ctx.scheduler.reload();
    changed(copy.id, "created");
    return copy;
  });

  bind(app, "routines.delete", async ({ params: { id } }) => {
    if (!ctx.routines.remove(id)) throw httpError(404, "Routine not found");
    ctx.scheduler.reload();
    changed(id, "deleted");
    return { deleted: id };
  });

  /** Manual test run — returns the real run id; watch via /api/runs/:id/stream. */
  bind(app, "routines.run", async ({ params: { id } }) => {
    const routine = ctx.routines.get(id);
    if (!routine) throw httpError(404, "Routine not found");
    // A stored routine on a provider that is no longer registered is refused
    // here (`400 unknown_provider`); a scheduled fire ends `failed` instead.
    requireProvider(ctx, routine.provider);
    // fire() creates the run row and resolves at once; execution continues
    // in the background (409 from core if the routine is already in flight).
    const { runId, status } = await ctx.scheduler.fire(id, { reason: "manual" });
    return { runId, status };
  });

  bind(app, "routines.history", async ({ params: { id } }) => {
    return ctx.scheduler.history(id, 30);
  });
}
