import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import type { FastifyInstance } from "fastify";
import { ProviderId, EffortLevel, resolveInsideRoots, isInside, findOnPath, previewFile, safeSpawn } from "@mordomo/core";
import type { AppContext } from "../context.js";
import { gateWrite, grantedRoots, httpError, launchPromptRun, type PromptRunInput } from "./common.js";
import { UuidParams } from "./params.js";
import { lastEventId, openSse } from "./sse.js";

const ACTIVE_STATUSES = new Set(["queued", "running", "waiting_approval"]);

export function registerRunRoutes(app: FastifyInstance, ctx: AppContext): void {
  app.get("/api/runs", async (req, reply) => {
    const q = z
      .object({
        limit: z.coerce.number().int().min(1).max(200).default(50),
        offset: z.coerce.number().int().min(0).max(1_000_000).default(0),
        status: z.enum(["queued", "running", "waiting_approval", "done", "failed", "cancelled", "timed_out", "interrupted"]).optional(),
      })
      .parse(req.query);
    // Body stays a plain array (other views depend on it); the total for pagination travels in a header.
    reply.header("x-total-count", String(ctx.runs.count({ status: q.status })));
    return ctx.runs.list(q);
  });

  app.get("/api/runs/:id", async (req) => {
    const { id } = UuidParams.parse(req.params);
    const run = ctx.runs.get(id);
    if (!run) throw httpError(404, "Run not found");
    return { run, events: ctx.runs.eventsFor(id).map((e) => e.event) };
  });

  /** Manual prompt run (Command Centre "Run a prompt" box). */
  app.post("/api/runs", async (req, reply) => {
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
    const input: PromptRunInput = {
      prompt: body.prompt,
      provider,
      model: body.model !== undefined ? body.model : settings.providers[provider].defaultModel,
      effort: body.effort ?? settings.providers[provider].defaultEffort,
      mode: body.mode,
      cwd,
      timeoutMs: body.timeoutMs ?? settings.limits.defaultTimeoutMs,
    };
    const gate = gateWrite(ctx, body.mode, "manual", `Write-mode prompt run with ${provider}: "${body.prompt.slice(0, 80)}"`, { kind: "prompt", input });
    if (gate.pendingApproval) {
      reply.code(202);
      return { runId: null, status: "waiting_approval", pendingApproval: gate.pendingApproval };
    }
    const { runId } = launchPromptRun(ctx, input, (err, id) => req.log.error({ err, runId: id, msg: "run failed to execute" }));
    return { runId, status: "queued" };
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

export type RunDiffResult =
  | { kind: "git"; file: string; repoRoot: string; diff: string; truncated: boolean; unchanged: boolean }
  | { kind: "snapshot"; file: string; content: string | null; truncated: boolean; untracked: boolean; message: string | null }
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

async function git(gitPath: string, cwd: string, args: string[]): Promise<{ exitCode: number | null; stdout: string; truncated: boolean }> {
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
    if (!fs.existsSync(resolved)) return { kind: "unavailable", file: resolved, message: "File no longer exists." };
    let preview: ReturnType<typeof previewFile>;
    try {
      preview = previewFile(ctx.settings(), roots, resolved);
    } catch (err) {
      throw httpError(403, (err as Error).message, "forbidden_path");
    }
    if (preview.kind !== "text") return { kind: "unavailable", file: resolved, message: preview.message ?? "Not previewable." };
    return { kind: "snapshot", file: resolved, content: preview.content, truncated: preview.truncated, untracked, message: preview.message };
  };

  const repoRoot = findGitRoot(path.dirname(resolved));
  const gitPath = findOnPath("git");
  if (!repoRoot || !gitPath) return snapshot(false);
  const rel = path.relative(repoRoot, resolved);
  try {
    // HEAD may not exist yet (fresh repository): fall back to the index diff.
    let out = await git(gitPath, repoRoot, ["diff", "--no-color", "--no-ext-diff", "HEAD", "--", rel]);
    if (out.exitCode !== 0) out = await git(gitPath, repoRoot, ["diff", "--no-color", "--no-ext-diff", "--", rel]);
    if (out.exitCode !== 0) return snapshot(false);
    if (out.stdout.trim() === "") {
      const status = await git(gitPath, repoRoot, ["status", "--porcelain", "--untracked-files=all", "--", rel]);
      if (status.stdout.startsWith("??")) return snapshot(true);
      return { kind: "git", file: resolved, repoRoot, diff: "", truncated: false, unchanged: true };
    }
    const truncated = out.truncated || out.stdout.length > DIFF_MAX_CHARS;
    return { kind: "git", file: resolved, repoRoot, diff: out.stdout.slice(0, DIFF_MAX_CHARS), truncated, unchanged: false };
  } catch {
    return snapshot(false);
  }
}
