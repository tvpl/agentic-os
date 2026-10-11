import fs from "node:fs";
import path from "node:path";
import type { FastifyInstance } from "fastify";
import type { RunEvent } from "@mordomo/core";
import {
  NotRegularFileError,
  inspectPath,
  checkWorkspacePath,
  findOnPath,
  openWorkspaceFile,
  previewFile,
  statWorkspacePath,
} from "@mordomo/core/internal";
import { currentRunFrameVersion, type RunFrameType } from "@mordomo/contracts";
import type { AppContext } from "../context.js";
import { bind } from "../contract.js";
import { grantedRoots, httpError, startedByOf } from "./common.js";
import { runGit } from "./git.js";
import { lastEventId, openSse } from "./sse.js";

const ACTIVE_STATUSES = new Set(["queued", "running", "waiting_approval"]);

/**
 * A frame of the stream as it is sent: the event of the run (as persisted in `run_events`, which carries no version)
 * with the version of its type. The version is added here, at the boundary, and never stored.
 */
function framed<T extends { type: RunFrameType }>(frame: T): T & { v: number } {
  return { ...frame, v: currentRunFrameVersion(frame.type) };
}

export function registerRunRoutes(app: FastifyInstance, ctx: AppContext): void {
  bind(app, "runs.list", async ({ query: q }, _req, reply) => {
    // Body stays a plain array (other views depend on it); the total for pagination travels in a header.
    reply.header("x-total-count", String(ctx.runs.count(q)));
    // Complete requests may contain private context and are needed only on the
    // detail/retry path. Keep list payloads compact and summary-only.
    return ctx.runs.list(q).map(({ request: _request, ...run }) => run);
  });

  bind(app, "runs.get", async ({ params: { id } }) => {
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
  bind(app, "runs.create", async ({ body }, req, reply) => {
    const started = ctx.execution.startPrompt(
      { ...body, startedBy: startedByOf(req) },
      { onError: (err, id) => req.log.error({ err, runId: id, msg: "run failed to execute" }) },
    );
    if (started.status === "waiting_approval") reply.code(202);
    return started;
  });

  /**
   * Squad (plan Onda 3 §5): fan several prompts out as children of a run.
   * Each child is an ordinary prompt run (same gate, its own session, its own
   * artifacts) that carries `parentRunId`; the parent's page shows the tree.
   */
  bind(app, "runs.children.create", async ({ params: { id }, body }, req, reply) => {
    const parent = ctx.runs.get(id);
    if (!parent) throw httpError(404, "Run not found");
    const { prompts, ...shared } = body;
    const cwd = body.cwd ?? parent.cwd;
    const runs = prompts.map((prompt) =>
      ctx.execution.startPrompt(
        {
          ...shared,
          prompt,
          ...(cwd ? { cwd } : {}),
          provider: body.provider ?? parent.provider,
          parentRunId: id,
          startedBy: startedByOf(req),
        },
        {
          onError: (err, runId) =>
            req.log.error({ err, runId, parentRunId: id, msg: "child run failed to execute" }),
        },
      ),
    );
    if (runs.some((r) => r.status === "waiting_approval")) reply.code(202);
    return { runs };
  });

  /** The children of a run (a squad), newest first. */
  bind(app, "runs.children.list", async ({ params: { id } }) => {
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
  bind(app, "runs.diff", async ({ params: { id }, query: { file } }) => {
    const run = ctx.runs.get(id);
    if (!run) throw httpError(404, "Run not found");
    const cwd = run.cwd ?? ctx.paths.home;
    const target = path.isAbsolute(file) ? file : path.join(cwd, file);
    const roots = [...grantedRoots(ctx), ctx.paths.artifacts];
    // `file` comes from a run's record: it must lie in a granted root and outside the home's config/ and logs/ (403);
    // the rest of the filter (secret names, excludes) answers "unavailable" inside runFileDiff.
    const resolved = inspectPath(ctx.readScope([ctx.paths.artifacts]), target).real;
    return runFileDiff(ctx, resolved, roots);
  });

  bind(app, "runs.cancel", async ({ params: { id } }) => {
    const ok = await ctx.execution.cancel(id);
    return { cancelled: ok };
  });

  /** Repeat the complete typed request retained with a run. */
  bind(app, "runs.retry", async ({ params: { id }, body: { submissionId } }, req, reply) => {
    const started = ctx.execution.retry(
      id,
      { submissionId, startedBy: startedByOf(req) },
      { onError: (err, runId) => req.log.error({ err, runId, retryOf: id }) },
    );
    if (started.status === "waiting_approval") reply.code(202);
    return started;
  });

  /**
   * Live event stream (SSE). EventSource cannot set headers → token comes via
   * query. Frames carry the run_events DB id, so a reconnect with
   * `Last-Event-ID` resumes after the last frame the client saw.
   */
  bind(app, "runs.stream", async ({ params: { id } }, req, reply) => {
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
          ch.send({ id: row.id, data: framed(row.event) });
          lastId = row.id;
        }
        if (rows.length < 2000) break;
      }
    };
    const finish = () => {
      if (finished) return;
      finished = true;
      const final = ctx.runs.get(id);
      ch.send({
        data: framed({
          type: "run_state" as const,
          ts: Date.now(),
          status: final?.status,
          error: final?.error,
        }),
      });
      ch.end();
    };
    // No DB query per event: the manager hands over the persisted row id.
    // Events emitted but not persisted (e.g. "[queued]") have no id.
    const deliver = ({ event, eventId }: { event: RunEvent; eventId?: number }) => {
      if (eventId === undefined) {
        ch.send({ data: framed(event) });
      } else if (eventId > lastId) {
        ch.send({ id: eventId, data: framed(event) });
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

  bind(app, "metrics.get", async () => ctx.runs.metrics());

  bind(app, "artifacts.recent", async ({ query: { limit } }) => {
    const runs = ctx.runs.list({ limit: 200 });
    const scope = ctx.scopeOf([ctx.paths.artifacts]);
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
          sizeBytes = statWorkspacePath(scope, abs).stat.size;
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
  bind(app, "artifacts.file", async ({ query: { p } }) => {
    let file: ReturnType<typeof openWorkspaceFile>;
    try {
      // PathAccessError → 403 (outside artifacts/, a link out of it, a secret name).
      file = openWorkspaceFile(ctx.scopeOf([ctx.paths.artifacts]), p);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT" || err instanceof NotRegularFileError)
        throw httpError(404, "Artifact not found");
      throw err;
    }
    try {
      if (file.stat.size > ARTIFACT_TEXT_MAX_BYTES) {
        return { path: file.path, content: null, note: "Artifact larger than 2 MB — open it from disk." };
      }
      return {
        path: file.path,
        content: file.readBytes(ARTIFACT_TEXT_MAX_BYTES).bytes.toString("utf8"),
        sizeBytes: file.stat.size,
      };
    } finally {
      file.close();
    }
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
const ARTIFACT_TEXT_MAX_BYTES = 2 * 1024 * 1024;

async function runFileDiff(ctx: AppContext, resolved: string, roots: string[]): Promise<RunDiffResult> {
  const filterOptions = { homeDir: ctx.paths.home };
  // The same filter as the preview, before git runs: a diff of a tracked secret
  // or of the home's config/ would otherwise bypass it.
  let access: ReturnType<typeof checkWorkspacePath>;
  try {
    access = checkWorkspacePath(ctx.settings(), roots, resolved, filterOptions);
  } catch (err) {
    throw httpError(403, (err as Error).message, "forbidden_path");
  }
  if (access.blockedReason) return { kind: "unavailable", file: resolved, message: access.blockedReason };

  const snapshot = (untracked: boolean): RunDiffResult => {
    if (!fs.existsSync(resolved))
      return { kind: "unavailable", file: resolved, message: "File no longer exists." };
    let preview: ReturnType<typeof previewFile>;
    try {
      preview = previewFile(ctx.settings(), roots, resolved, filterOptions);
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
  // What git reads is every file `rel` names (a directory names all of those under it, a deleted one the files
  // it held), not the one path the filter judged above. List them first, judge each with the same filter, and
  // only then ask for the diff of that same, literal pathspec.
  const readsOnlyAllowed = async (against: string[]): Promise<boolean | "failed"> => {
    const listed = await runGit(gitPath, repoRoot, [
      "diff",
      "--name-only",
      "-z",
      "--no-renames",
      ...against,
      "--",
      rel,
    ]);
    if (listed.exitCode !== 0) return "failed";
    if (listed.truncated) return false; // a list cut short cannot be judged whole
    for (const name of listed.stdout.split("\0").filter(Boolean)) {
      try {
        if (checkWorkspacePath(ctx.settings(), roots, path.join(repoRoot, name), filterOptions).blockedReason)
          return false;
      } catch {
        return false; // outside every root, or the home's config/ and logs/: not shown either
      }
    }
    return true;
  };
  try {
    // HEAD may not exist yet (fresh repository): fall back to the index diff.
    let against = ["HEAD"];
    let allowed = await readsOnlyAllowed(against);
    if (allowed === "failed") {
      against = [];
      allowed = await readsOnlyAllowed(against);
    }
    if (allowed === "failed") return snapshot(false);
    if (!allowed)
      return {
        kind: "unavailable",
        file: resolved,
        message: "The diff would include files that are not shown.",
      };
    const out = await runGit(gitPath, repoRoot, [
      "diff",
      "--no-color",
      "--no-renames",
      ...against,
      "--",
      rel,
    ]);
    if (out.exitCode !== 0) return snapshot(false);
    if (out.stdout.trim() === "") {
      const status = await runGit(gitPath, repoRoot, [
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
