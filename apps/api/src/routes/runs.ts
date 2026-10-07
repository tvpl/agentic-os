import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import type { FastifyInstance } from "fastify";
import {
  ProviderId,
  EffortLevel,
  resolveInsideRoots,
  isInside,
  findOnPath,
  previewFile,
  safeSpawn,
  type RunEvent,
} from "@mordomo/core";
import type { AppContext } from "../context.js";
import {
  gateWrite,
  grantedRoots,
  httpError,
  launchSkillRun,
  requireProvider,
  submitPromptRun,
  type SkillRunInput,
} from "./common.js";
import { UuidParam, UuidParams } from "./params.js";
import { lastEventId, openSse } from "./sse.js";

const ACTIVE_STATUSES = new Set(["queued", "running", "waiting_approval"]);

export function registerRunRoutes(app: FastifyInstance, ctx: AppContext): void {
  app.get("/api/runs", async (req, reply) => {
    const q = z
      .object({
        provider: ProviderId.optional(),
        statusGroup: z.enum(["active", "failed"]).optional(),
        order: z.enum(["asc", "desc"]).default("desc"),
        limit: z.coerce.number().int().min(1).max(200).default(50),
        offset: z.coerce.number().int().min(0).max(1_000_000).default(0),
        status: z
          .enum([
            "queued",
            "running",
            "waiting_approval",
            "done",
            "failed",
            "cancelled",
            "timed_out",
            "interrupted",
          ])
          .optional(),
      })
      .parse(req.query);
    // Body stays a plain array (other views depend on it); the total for pagination travels in a header.
    reply.header("x-total-count", String(ctx.runs.count(q)));
    // Complete requests may contain private context and are needed only on the
    // detail/retry path. Keep list payloads compact and summary-only.
    return ctx.runs.list(q).map(({ request: _request, ...run }) => run);
  });

  app.get("/api/runs/:id", async (req) => {
    const { id } = UuidParams.parse(req.params);
    const run = ctx.runs.get(id);
    if (!run) throw httpError(404, "Run not found");
    return { run, events: ctx.runs.eventsFor(id).map((e) => e.event) };
  });

  /**
   * Manual prompt run (Command Centre "Run a prompt" box). `sessionId`
   * continues an existing conversation; without it a new one is started and
   * returned, so the caller can continue it later. The old response fields
   * (`runId`, `status`, `pendingApproval`) are unchanged.
   */
  app.post("/api/runs", async (req, reply) => {
    const body = z
      .object({
        submissionId: z.string().uuid().optional(),
        prompt: z.string().min(1).max(20_000),
        provider: ProviderId.optional(),
        model: z.string().nullable().optional(),
        effort: EffortLevel.optional(),
        mode: z.enum(["read_only", "write"]).default("read_only"),
        cwd: z.string().optional(),
        timeoutMs: z.number().int().min(10_000).max(3_600_000).optional(),
        sessionId: UuidParam.optional(),
      })
      .parse(req.body);
    const result = submitPromptRun(ctx, body, (err, id) =>
      req.log.error({ err, runId: id, msg: "run failed to execute" }),
    );
    if (result.statusCode !== 200) reply.code(result.statusCode);
    return result.body;
  });

  /**
   * Squad (plan Onda 3 §5): fan several prompts out as children of a run.
   * Each child is an ordinary prompt run (same gate, its own session, its own
   * artifacts) that carries `parentRunId`; the parent's page shows the tree.
   */
  app.post("/api/runs/:id/children", async (req, reply) => {
    const { id } = UuidParams.parse(req.params);
    const parent = ctx.runs.get(id);
    if (!parent) throw httpError(404, "Run not found");
    const body = z
      .object({
        prompts: z.array(z.string().min(1).max(20_000)).min(1).max(8),
        provider: ProviderId.optional(),
        model: z.string().nullable().optional(),
        effort: EffortLevel.optional(),
        mode: z.enum(["read_only", "write"]).default("read_only"),
        cwd: z.string().optional(),
        timeoutMs: z.number().int().min(10_000).max(3_600_000).optional(),
      })
      .parse(req.body);
    const results = body.prompts.map((prompt) =>
      submitPromptRun(
        ctx,
        {
          ...body,
          prompt,
          cwd: body.cwd ?? parent.cwd ?? undefined,
          provider: body.provider ?? parent.provider,
          parentRunId: id,
        },
        (err, runId) => req.log.error({ err, runId, parentRunId: id, msg: "child run failed to execute" }),
      ),
    );
    if (results.some((r) => r.statusCode === 202)) reply.code(202);
    return { runs: results.map((r) => r.body) };
  });

  /** The children of a run (a squad), newest first. */
  app.get("/api/runs/:id/children", async (req) => {
    const { id } = UuidParams.parse(req.params);
    if (!ctx.runs.get(id)) throw httpError(404, "Run not found");
    return ctx.runs.list({ parentRunId: id, limit: 50 }).filter((r) => r.id !== id);
  });

  /**
   * Diff of one file touched by a run. When the file lives in a git work tree
   * the response is `git diff HEAD` for that path (argv-only spawn of the git
   * binary found on PATH, pinned through the allowlist's `allowPaths`);
   * otherwise (or for untracked files) a containment-checked snapshot with the
   * same rules as `/api/memory/preview`.
   */
  app.get("/api/runs/:id/diff", async (req) => {
    const { id } = UuidParams.parse(req.params);
    const { file } = z.object({ file: z.string().min(1).max(4096) }).parse(req.query);
    const run = ctx.runs.get(id);
    if (!run) throw httpError(404, "Run not found");
    const cwd = run.cwd ?? ctx.paths.home;
    const target = path.isAbsolute(file) ? file : path.join(cwd, file);
    const roots = [...grantedRoots(ctx), ctx.paths.artifacts];
    const resolved = resolveInsideRoots(roots, target); // PathAccessError → 403
    return runFileDiff(ctx, resolved, roots);
  });

  app.post("/api/runs/:id/cancel", async (req) => {
    const { id } = UuidParams.parse(req.params);
    const ok = await ctx.runs.cancel(id);
    return { cancelled: ok };
  });

  /** Repeat the complete typed request retained with a run. */
  app.post("/api/runs/:id/retry", async (req, reply) => {
    const { id } = UuidParams.parse(req.params);
    const { submissionId } = z.object({ submissionId: z.string().uuid() }).parse(req.body);
    const source = ctx.runs.get(id);
    if (!source) throw httpError(404, "Run not found");
    if (!source.request) {
      throw httpError(409, "This older run has no complete request to repeat safely.", "request_unavailable");
    }
    const prior = ctx.db
      .prepare("SELECT action, source_run_id, response FROM run_action_receipts WHERE id = ?")
      .get(submissionId) as { action: string; source_run_id: string; response: string | null } | undefined;
    if (prior) {
      if (prior.action !== "retry" || prior.source_run_id !== id)
        throw httpError(409, "Submission identity was reused for another action.", "submission_conflict");
      if (!prior.response)
        throw httpError(
          409,
          "This retry has an uncertain result. Check execution history.",
          "submission_uncertain",
        );
      return JSON.parse(prior.response);
    }
    // The provider comes from the recorded run: refuse one that is no longer
    // registered (`400 unknown_provider`) before a receipt or a run exists.
    requireProvider(ctx, source.provider);
    ctx.db
      .prepare(
        "INSERT INTO run_action_receipts(id, action, source_run_id, created_at) VALUES (?, 'retry', ?, ?)",
      )
      .run(submissionId, id, Date.now());
    let result: Record<string, unknown>;
    try {
      const lineage = source.parentRunId ?? source.id;
      if (source.request.kind === "skill") {
        const skill = ctx.skills.load(source.request.skillSlug);
        if (!skill)
          throw httpError(
            409,
            `Skill "${source.request.skillSlug}" is no longer available.`,
            "skill_unavailable",
          );
        const retryMode = skill.mode === "write" ? "write" : "read_only";
        const input: SkillRunInput = {
          slug: source.request.skillSlug,
          inputs: source.request.inputs,
          provider: source.provider,
          model: source.model,
          effort: source.effort,
          cwd: source.cwd ?? ctx.paths.home,
          timeoutMs: source.timeoutMs ?? ctx.settings().limits.defaultTimeoutMs,
          parentRunId: lineage,
        };
        const gated = gateWrite(ctx, retryMode, "skill", `Repeat /${input.slug} with ${source.provider}`, {
          kind: "skill",
          input,
        });
        result = gated.pendingApproval
          ? { runId: gated.runId, status: "waiting_approval", pendingApproval: gated.pendingApproval }
          : {
              ...launchSkillRun(ctx, input, (err, runId) => req.log.error({ err, runId, retryOf: id })),
              status: "queued",
            };
      } else {
        const repeated = submitPromptRun(
          ctx,
          {
            submissionId,
            prompt: source.request.prompt,
            provider: source.provider,
            model: source.model,
            effort: source.effort,
            mode: source.request.mode,
            cwd: source.cwd ?? ctx.paths.home,
            timeoutMs: source.timeoutMs ?? ctx.settings().limits.defaultTimeoutMs,
            parentRunId: lineage,
          },
          (err, runId) => req.log.error({ err, runId, retryOf: id }),
        );
        if (repeated.statusCode !== 200) reply.code(repeated.statusCode);
        result = repeated.body;
      }
    } catch (error) {
      ctx.db.prepare("DELETE FROM run_action_receipts WHERE id = ?").run(submissionId);
      throw error;
    }
    ctx.db
      .prepare("UPDATE run_action_receipts SET response = ? WHERE id = ?")
      .run(JSON.stringify(result), submissionId);
    return result;
  });

  /**
   * Live event stream (SSE). EventSource cannot set headers → token comes via
   * query. Frames carry the run_events DB id, so a reconnect with
   * `Last-Event-ID` resumes after the last frame the client saw.
   */
  app.get("/api/runs/:id/stream", { config: { queryToken: true } }, async (req, reply) => {
    const { id } = UuidParams.parse(req.params);
    if (!ctx.runs.get(id)) throw httpError(404, "Run not found");

    const ch = openSse(req, reply);
    let lastId = lastEventId(req) ?? 0;
    let finished = false;
    // Live events that arrive while the catch-up replay is still running are
    // buffered, then delivered in order and deduped by their row id.
    let replaying = true;
    const buffered: Array<{ event: RunEvent; eventId?: number }> = [];

    // Catch-up only: drain persisted events after `lastId` (they carry ids).
    const replay = () => {
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
    // No DB query per event: the manager hands over the persisted row id.
    // Events emitted but not persisted (e.g. "[queued]") have no id.
    const deliver = ({ event, eventId }: { event: RunEvent; eventId?: number }) => {
      if (eventId === undefined) {
        ch.send({ data: event });
      } else if (eventId > lastId) {
        ch.send({ id: eventId, data: event });
        lastId = eventId;
      } else {
        return; // already sent by the replay
      }
      if (event.type === "result" || event.type === "error") finish();
    };

    // Subscribe first so nothing persisted between replay and follow is lost.
    const unsubscribe = ctx.runs.onEvent(id, (event, eventId) => {
      if (ch.closed) return;
      if (replaying) buffered.push({ event, eventId });
      else deliver({ event, eventId });
    });
    ch.onClose(unsubscribe);

    replay();
    replaying = false;
    for (const item of buffered.splice(0)) {
      if (ch.closed) break;
      deliver(item);
    }
    const current = ctx.runs.get(id);
    if (!current || !ACTIVE_STATUSES.has(current.status)) finish();
    return reply;
  });

  app.get("/api/metrics", async () => ctx.runs.metrics());

  app.get("/api/artifacts/recent", async (req) => {
    const { limit } = z
      .object({ limit: z.coerce.number().int().min(1).max(100).default(20) })
      .parse(req.query);
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

export type RunDiffResult =
  | { kind: "git"; file: string; repoRoot: string; diff: string; truncated: boolean; unchanged: boolean }
  | {
      kind: "snapshot";
      file: string;
      content: string | null;
      truncated: boolean;
      untracked: boolean;
      message: string | null;
    }
  | { kind: "unavailable"; file: string; message: string };

/** Nearest ancestor containing `.git` (directory or worktree file), or null. */
export function findGitRoot(start: string): string | null {
  let dir = start;
  for (;;) {
    if (fs.existsSync(path.join(dir, ".git"))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

const DIFF_MAX_CHARS = 512 * 1024;
const GIT_TIMEOUT_MS = 10_000;

async function git(
  gitPath: string,
  cwd: string,
  args: string[],
): Promise<{ exitCode: number | null; stdout: string; truncated: boolean }> {
  const handle = safeSpawn(gitPath, ["-c", "core.quotepath=off", ...args], {
    cwd,
    allowPaths: [gitPath],
    timeoutMs: GIT_TIMEOUT_MS,
    env: { GIT_TERMINAL_PROMPT: "0", GIT_OPTIONAL_LOCKS: "0", GIT_PAGER: "cat" },
  });
  const res = await handle.result;
  return { exitCode: res.exitCode, stdout: res.stdout, truncated: res.stdoutTruncated };
}

async function runFileDiff(ctx: AppContext, resolved: string, roots: string[]): Promise<RunDiffResult> {
  const snapshot = (untracked: boolean): RunDiffResult => {
    if (!fs.existsSync(resolved))
      return { kind: "unavailable", file: resolved, message: "File no longer exists." };
    let preview: ReturnType<typeof previewFile>;
    try {
      preview = previewFile(ctx.settings(), roots, resolved);
    } catch (err) {
      throw httpError(403, (err as Error).message, "forbidden_path");
    }
    if (preview.kind !== "text")
      return { kind: "unavailable", file: resolved, message: preview.message ?? "Not previewable." };
    return {
      kind: "snapshot",
      file: resolved,
      content: preview.content,
      truncated: preview.truncated,
      untracked,
      message: preview.message,
    };
  };

  const repoRoot = findGitRoot(path.dirname(resolved));
  const gitPath = findOnPath("git");
  if (!repoRoot || !gitPath) return snapshot(false);
  const rel = path.relative(repoRoot, resolved);
  try {
    // HEAD may not exist yet (fresh repository): fall back to the index diff.
    let out = await git(gitPath, repoRoot, ["diff", "--no-color", "--no-ext-diff", "HEAD", "--", rel]);
    if (out.exitCode !== 0)
      out = await git(gitPath, repoRoot, ["diff", "--no-color", "--no-ext-diff", "--", rel]);
    if (out.exitCode !== 0) return snapshot(false);
    if (out.stdout.trim() === "") {
      const status = await git(gitPath, repoRoot, [
        "status",
        "--porcelain",
        "--untracked-files=all",
        "--",
        rel,
      ]);
      if (status.stdout.startsWith("??")) return snapshot(true);
      return { kind: "git", file: resolved, repoRoot, diff: "", truncated: false, unchanged: true };
    }
    const truncated = out.truncated || out.stdout.length > DIFF_MAX_CHARS;
    return {
      kind: "git",
      file: resolved,
      repoRoot,
      diff: out.stdout.slice(0, DIFF_MAX_CHARS),
      truncated,
      unchanged: false,
    };
  } catch {
    return snapshot(false);
  }
}
