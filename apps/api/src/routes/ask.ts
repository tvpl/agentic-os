import path from "node:path";
import type { FastifyInstance } from "fastify";
import {
  ASK_ANSWER_MAX_BYTES,
  type AskAnswer,
  type AskMode,
  type AskScope,
  type AskStatus,
  type RunRecord,
} from "@mordomo/contracts";
import {
  ASK_SKILL,
  checkAskAnswer,
  homeReadScope,
  hybridRecall,
  readWorkspaceFile,
  resolveAskScope,
} from "@mordomo/core/internal";
import { audienceView } from "../access.js";
import type { AppContext } from "../context.js";
import { bind } from "../contract.js";
import { httpError } from "./common.js";

/**
 * The three routes of an ask (.specs/features/cerebro-perguntar, door 1): `POST /api/memory/ask` resolves the scope,
 * recalls as agents read and either abstains (no run) or starts the read-only skill `brain-ask` with the recall's
 * sections as its `sources` (door 2); `GET /api/memory/ask` and `GET /api/memory/ask/:id` read the runs of that skill,
 * each with its answer judged today by today's policy, the folders hidden from agents and the scope (door 3).
 */

/** The run statuses an ask is still answering in: they hold the lock of door 1, and their file is not read yet. */
const OPEN_STATUSES = ["queued", "running", "waiting_approval"] as const;
const OPEN: ReadonlySet<string> = new Set(OPEN_STATUSES);
const LIST_DEFAULT = 30;

/** What the checks of an ask read: the database, the paths, the owner's settings and what is hidden from agents. */
function askEnv(ctx: AppContext) {
  const view = audienceView(ctx, "agents");
  return { view, env: { db: ctx.db, paths: ctx.paths, settings: ctx.settings(), hidden: view.hidden } };
}
/** What `judge` reads: the environment of the core's ask (`askEnv`'s `env`). */
type AskEnv = Parameters<typeof resolveAskScope>[0];

/** The scope a run's `scope` input names (the inverse of what `resolveAskScope` writes); null for one it cannot read. */
function scopeFromInput(input: string | undefined): AskScope | null {
  if (input === "all") return { kind: "all" };
  if (input?.startsWith("context:")) return { kind: "context", id: input.slice("context:".length) };
  if (input?.startsWith("folder:")) return { kind: "folder", path: input.slice("folder:".length) };
  if (input?.startsWith("notes:")) {
    const paths = input
      .slice("notes:".length)
      .split(";")
      .filter((p) => p !== "");
    return paths.length > 0 ? { kind: "notes", paths } : null;
  }
  return null;
}

interface Judgement {
  status: AskStatus;
  answer?: AskAnswer;
  reason?: string;
}

/**
 * What an ask reads as today (AC 7-13, door 3): `running` while its run is open (its file is not read), `failed` when
 * the run ended otherwise than `done` or wrote no `answer.json`, else the answer's verdict by today's rules. Exported
 * for its own layer (`tests/perguntar.layer.test.ts` C113), which calls it with no HTTP.
 */
export function judge(env: AskEnv, run: RunRecord, inputs: Readonly<Record<string, string>>): Judgement {
  if (OPEN.has(run.status)) return { status: "running" };
  if (run.status !== "done") return { status: "failed", reason: `A execução terminou em ${run.status}.` };
  let bytes: Buffer;
  try {
    bytes = readWorkspaceFile(
      homeReadScope(env.paths.home, [env.paths.artifacts], env.settings.excludes),
      path.join(env.paths.artifacts, run.id, "answer.json"),
      { maxBytes: ASK_ANSWER_MAX_BYTES, strict: true },
    ).bytes;
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT") return { status: "failed", reason: "A execução não escreveu answer.json." };
    if (code === "file_too_large") {
      return { status: "refused", reason: `A resposta passa de ${ASK_ANSWER_MAX_BYTES} bytes.` };
    }
    return { status: "failed", reason: err instanceof Error ? err.message : String(err) };
  }
  const asked = scopeFromInput(inputs.scope);
  if (asked === null) return { status: "refused", reason: "O escopo desta pergunta não pode ser lido." };
  let within: ReturnType<typeof resolveAskScope>["within"];
  try {
    within = resolveAskScope(env, asked).within;
  } catch (err) {
    // Today's rules refuse the scope itself (a context deleted, a folder hidden since): no citation can be inside it.
    const code = (err as { code?: unknown }).code;
    if (code === "context_not_found" || code === "folder_outside_index" || code === "unknown_note") {
      return { status: "refused", reason: (err as Error).message };
    }
    throw err;
  }
  const verdict = checkAskAnswer(bytes, { ...env, within, mode: modeOf(inputs) });
  return verdict.ok
    ? { status: "answered", answer: verdict.answer }
    : { status: "refused", reason: verdict.reason };
}

const modeOf = (inputs: Readonly<Record<string, string>>): AskMode =>
  inputs.mode === "reason_first" ? "reason_first" : "direct";
const inputsOf = (run: RunRecord): Record<string, string> =>
  run.request?.kind === "skill" ? run.request.inputs : {};

export function registerAskRoutes(app: FastifyInstance, ctx: AppContext): void {
  bind(app, "memory.ask", async ({ body }, _req, reply) => {
    const { view, env } = askEnv(ctx);
    const question = body.question.trim();
    const take = body.mode === "reason_first" ? (body.take ?? "").trim() : "";
    const scope = resolveAskScope(env, body.scope);
    if (!ctx.ask.available()) {
      throw httpError(
        409,
        "The brain-ask skill is missing, disabled or not a memory skill.",
        "skill_unavailable",
      );
    }
    // One ask at a time (door 1): the lock is the table of runs, so it outlives the service.
    const open = ctx.db
      .prepare(
        `SELECT COUNT(*) AS n FROM runs WHERE skill_slug = ? AND status IN (${OPEN_STATUSES.map(() => "?").join(", ")})`,
      )
      .get(ASK_SKILL, ...OPEN_STATUSES) as { n: number };
    if (open.n > 0) throw httpError(409, "An ask is still being answered.", "ask_in_progress");

    // The recall as agents read it (AC 16): the agents' index, their view of the settings, the scope's rows.
    const result = await hybridRecall(ctx.db, ctx.paths, view.settings, question, {
      ...(scope.within ? { within: scope.within } : {}),
      index: ctx.indexer.audienceTable("agents"),
      semantic: ctx.semantic,
      local: ctx.localModels,
    });
    if (result.abstained) {
      const policy = view.rowFilter();
      const rows = ctx.db.prepare("SELECT root, rel, path FROM files").all() as Array<{
        root: string;
        rel: string;
        path: string;
      }>;
      const consulted = rows.filter(
        (row) => policy(row) && !view.hidden(row.path) && (scope.within === null || scope.within(row)),
      ).length;
      return { status: "abstained" as const, abstainReason: result.abstainReason ?? "no_match", consulted };
    }
    const sources = result.answerContext.map((c) => `## ${c.path} § ${c.section}\n${c.excerpt}`).join("\n\n");
    const id = ctx.ask.start({
      inputs: { question, mode: body.mode, take, scope: scope.input, sources },
      ...(scope.contextId !== undefined ? { contextId: scope.contextId } : {}),
    });
    reply.code(202);
    return { status: "running" as const, id };
  });

  bind(app, "memory.ask.list", async ({ query: { limit } }) => {
    const { env } = askEnv(ctx);
    const ids = ctx.db
      .prepare("SELECT id FROM runs WHERE skill_slug = ? ORDER BY created_at DESC, id DESC LIMIT ?")
      .all(ASK_SKILL, limit ?? LIST_DEFAULT) as Array<{ id: string }>;
    const items = ids.flatMap(({ id }) => {
      const run = ctx.runs.get(id);
      if (!run) return [];
      const inputs = inputsOf(run);
      return [
        {
          id,
          question: inputs.question ?? "",
          mode: modeOf(inputs),
          scope: scopeFromInput(inputs.scope) ?? { kind: "all" as const },
          status: judge(env, run, inputs).status,
          startedAt: run.startedAt ?? run.createdAt,
          ...(run.finishedAt !== null ? { finishedAt: run.finishedAt } : {}),
        },
      ];
    });
    return { items };
  });

  bind(app, "memory.ask.get", async ({ params: { id } }) => {
    const run = ctx.runs.get(id);
    if (!run || run.skillSlug !== ASK_SKILL) throw httpError(404, "No ask has this id.", "not_found");
    const { env } = askEnv(ctx);
    const inputs = inputsOf(run);
    const mode = modeOf(inputs);
    const judged = judge(env, run, inputs);
    return {
      id,
      question: inputs.question ?? "",
      mode,
      ...(mode === "reason_first" ? { take: inputs.take ?? "" } : {}),
      scope: scopeFromInput(inputs.scope) ?? { kind: "all" as const },
      status: judged.status,
      ...(judged.answer !== undefined ? { answer: judged.answer } : {}),
      ...(judged.reason !== undefined ? { reason: judged.reason } : {}),
      run: {
        provider: run.provider,
        startedAt: run.startedAt ?? run.createdAt,
        ...(run.finishedAt !== null ? { finishedAt: run.finishedAt } : {}),
      },
    };
  });
}
