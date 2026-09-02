import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import type { FastifyInstance } from "fastify";
import { ProviderId, EffortLevel, resolveInsideRoots, isInside } from "@mordomo/core";
import type { AppContext } from "../context.js";
import { grantedRoots, httpError } from "./common.js";
import { UuidParams } from "./params.js";
import { lastEventId, openSse } from "./sse.js";

const ACTIVE_STATUSES = new Set(["queued", "running", "waiting_approval"]);

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
    const { id } = UuidParams.parse(req.params);
    const run = ctx.runs.get(id);
    if (!run) throw httpError(404, "Run not found");
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
    if (!settings.providers[provider].enabled) throw httpError(400, `Provider ${provider} is not enabled`);
    const cwd = body.cwd ? resolveInsideRoots(grantedRoots(ctx), body.cwd) : ctx.paths.home;
    if (body.mode === "write" && settings.securityProfile === "read_only") {
      throw httpError(403, "The current security profile is read-only; enable writes in Settings first.");
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
    ctx.runs.execute(run.id, body.prompt + artifactsNote, body.mode).catch((err: unknown) => {
      req.log.error({ err, runId: run.id, msg: "run failed to execute" });
    });
    return { runId: run.id, status: "queued" };
  });

  app.post("/api/runs/:id/cancel", async (req) => {
    const { id } = UuidParams.parse(req.params);
    const ok = await ctx.runs.cancel(id);
    return { cancelled: ok };
  });

  /**
   * Live event stream (SSE). EventSource cannot set headers → token comes via
   * query. Frames carry the run_events DB id, so a reconnect with
   * `Last-Event-ID` resumes after the last frame the client saw.
   */
  app.get("/api/runs/:id/stream", async (req, reply) => {
    const { id } = UuidParams.parse(req.params);
    if (!ctx.runs.get(id)) throw httpError(404, "Run not found");

    const ch = openSse(req, reply);
    let lastId = lastEventId(req) ?? 0;
    let finished = false;

    // Drain persisted events after `lastId` (they carry ids; dedup by id).
    const flush = () => {
      for (;;) {
        const rows = ctx.runs.eventsFor(id, lastId);
        for (const row of rows) {
          ch.send({ id: row.id, data: row.event });
          lastId = row.id;
        }
        if (rows.length < 2000) break;
      }
    };
    const finish = () => {
      if (finished) return;
      finished = true;
      const final = ctx.runs.get(id);
      ch.send({ data: { type: "run_state", ts: Date.now(), status: final?.status, error: final?.error } });
      ch.end();
    };

    // Subscribe first so nothing persisted between replay and follow is lost.
    const unsubscribe = ctx.runs.onEvent(id, (event) => {
      if (ch.closed) return;
      const before = lastId;
      flush();
      // Events that are emitted but not persisted (e.g. "[queued]") have no id.
      if (lastId === before) ch.send({ data: event });
      if (event.type === "result" || event.type === "error") finish();
    });
    ch.onClose(unsubscribe);

    flush();
    const current = ctx.runs.get(id);
    if (!current || !ACTIVE_STATUSES.has(current.status)) finish();
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
    const resolved = resolveInsideRoots([ctx.paths.artifacts], p); // PathAccessError → 403
    if (!isInside(ctx.paths.artifacts, resolved)) throw httpError(403, "Outside artifacts directory");
    let stat: fs.Stats;
    try {
      stat = fs.statSync(resolved);
    } catch {
      throw httpError(404, "Artifact not found");
    }
    if (stat.size > 2 * 1024 * 1024) {
      return { path: resolved, content: null, note: "Artifact larger than 2 MB — open it from disk." };
    }
    return { path: resolved, content: fs.readFileSync(resolved, "utf8"), sizeBytes: stat.size };
  });
}
