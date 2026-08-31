import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import type { FastifyInstance } from "fastify";
import { ProviderId, EffortLevel, resolveInsideRoots, isInside } from "@mordomo/core";
import type { AppContext } from "../context.js";

export function registerRunRoutes(app: FastifyInstance, ctx: AppContext): void {
  app.get("/api/runs", async (req) => {
    const q = z
      .object({
        limit: z.coerce.number().int().min(1).max(200).default(50),
        status: z.enum(["queued", "running", "waiting_approval", "done", "failed", "cancelled", "interrupted"]).optional(),
      })
      .parse(req.query);
    return ctx.runs.list(q);
  });

  app.get("/api/runs/:id", async (req) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const run = ctx.runs.get(id);
    if (!run) throw Object.assign(new Error("Run not found"), { statusCode: 404 });
    return { run, events: ctx.runs.eventsFor(id).map((e) => e.event) };
  });

  /** Manual prompt run (Command Centre "Run a prompt" box). */
  app.post("/api/runs", async (req) => {
    const body = z
      .object({
        prompt: z.string().min(1).max(20_000),
        provider: ProviderId.optional(),
        model: z.string().nullable().optional(),
        effort: EffortLevel.optional(),
        mode: z.enum(["read_only", "write"]).default("read_only"),
        cwd: z.string().optional(),
        timeoutMs: z.number().int().min(10_000).max(3_600_000).optional(),
      })
      .parse(req.body);
    const settings = ctx.settings();
    const provider = body.provider ?? settings.defaultProvider;
    if (!settings.providers[provider].enabled) {
      throw Object.assign(new Error(`Provider ${provider} is not enabled`), { statusCode: 400 });
    }
    let cwd = ctx.paths.home;
    if (body.cwd) {
      const roots = [ctx.paths.home, ...settings.indexedFolders.filter((f) => f.enabled).map((f) => f.path)];
      cwd = resolveInsideRoots(roots, body.cwd);
    }
    if (body.mode === "write" && settings.securityProfile === "read_only") {
      throw Object.assign(new Error("The current security profile is read-only; enable writes in Settings first."), { statusCode: 403 });
    }
    const run = ctx.runs.create({
      origin: "manual",
      provider,
      prompt: body.prompt,
      cwd,
      model: body.model !== undefined ? body.model : settings.providers[provider].defaultModel,
      effort: body.effort ?? settings.providers[provider].defaultEffort,
      mode: body.mode,
      timeoutMs: body.timeoutMs ?? settings.limits.defaultTimeoutMs,
      profile: body.mode === "write" ? settings.securityProfile : "read_only",
    });
    const artifactsNote = `\n\nIf you produce files, write them into: ${path.join(ctx.paths.artifacts, run.id)}`;
    void ctx.runs.execute(run.id, body.prompt + artifactsNote, body.mode);
    return { runId: run.id, status: "queued" };
  });

  app.post("/api/runs/:id/cancel", async (req) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const ok = await ctx.runs.cancel(id);
    return { cancelled: ok };
  });

  /** Live event stream (SSE). EventSource cannot set headers → token comes via query. */
  app.get("/api/runs/:id/stream", async (req, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const run = ctx.runs.get(id);
    if (!run) throw Object.assign(new Error("Run not found"), { statusCode: 404 });

    reply.raw.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });
    const send = (data: unknown) => reply.raw.write(`data: ${JSON.stringify(data)}\n\n`);

    // Replay history first, then follow live events.
    for (const { event } of ctx.runs.eventsFor(id)) send(event);
    const current = ctx.runs.get(id)!;
    if (!["queued", "running", "waiting_approval"].includes(current.status)) {
      send({ type: "run_state", ts: Date.now(), status: current.status, error: current.error });
      reply.raw.end();
      return reply;
    }
    const unsubscribe = ctx.runs.onEvent(id, (event) => {
      send(event);
      if (event.type === "result" || event.type === "error") {
        const final = ctx.runs.get(id);
        send({ type: "run_state", ts: Date.now(), status: final?.status, error: final?.error });
        unsubscribe();
        reply.raw.end();
      }
    });
    req.raw.on("close", unsubscribe);
    return reply;
  });

  app.get("/api/metrics", async () => ctx.runs.metrics());

  app.get("/api/artifacts/recent", async (req) => {
    const { limit } = z.object({ limit: z.coerce.number().int().min(1).max(100).default(20) }).parse(req.query);
    const runs = ctx.runs.list({ limit: 200 });
    const artifacts: Array<{
      runId: string;
      file: string;
      path: string;
      createdAt: number;
      origin: string;
      skillSlug: string | null;
      provider: string;
      sizeBytes: number | null;
    }> = [];
    for (const run of runs) {
      for (const rel of run.artifacts) {
        const abs = path.join(ctx.paths.artifacts, rel);
        let sizeBytes: number | null = null;
        try {
          sizeBytes = fs.statSync(abs).size;
        } catch {
          continue; // artifact was deleted on disk
        }
        artifacts.push({
          runId: run.id,
          file: rel.split("/").slice(1).join("/"),
          path: abs,
          createdAt: run.finishedAt ?? run.createdAt,
          origin: run.origin,
          skillSlug: run.skillSlug,
          provider: run.provider,
          sizeBytes,
        });
      }
      if (artifacts.length >= limit) break;
    }
    return artifacts.slice(0, limit);
  });

  /** Read one artifact (text) — strictly inside the artifacts dir. */
  app.get("/api/artifacts/file", async (req) => {
    const { p } = z.object({ p: z.string() }).parse(req.query);
    let resolved: string;
    try {
      resolved = resolveInsideRoots([ctx.paths.artifacts], p);
    } catch (err) {
      throw Object.assign(new Error((err as Error).message), { statusCode: 403 });
    }
    if (!isInside(ctx.paths.artifacts, resolved)) {
      throw Object.assign(new Error("Outside artifacts directory"), { statusCode: 403 });
    }
    const stat = fs.statSync(resolved);
    if (stat.size > 2 * 1024 * 1024) {
      return { path: resolved, content: null, note: "Artifact larger than 2 MB — open it from disk." };
    }
    return { path: resolved, content: fs.readFileSync(resolved, "utf8"), sizeBytes: stat.size };
  });
}
