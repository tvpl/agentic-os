import type { FastifyInstance } from "fastify";
import {
  SUGGESTION_BATCH_INTERVAL_MS,
  batchOpen,
  batchOutcome,
  pendingSuggestions,
  recordSuggestionBatch,
  suggestionBatchFiles,
  suggestionBatches,
  suggestionKnown,
  type CheckedSuggestion,
} from "@mordomo/core/internal";
import { audienceView } from "../access.js";
import type { AppContext } from "../context.js";
import { bind } from "../contract.js";
import { httpError } from "./common.js";
import { entityView } from "./entities.js";

/**
 * The AI suggestions of entities (.specs/features/cerebro-entidades-resumos, doors 9 and 10): `POST
 * /api/memory/entities/suggestions` starts a batch of the read-only skill `brain-entities` over up to 20 notes that
 * changed (the owner's, with the extraction on or off), the service starts one on its own at the end of an index pass
 * (`scheduleSuggestionBatches`, only from `startServer`), and `GET /api/memory/entities/suggestions` reads the newest
 * batches, each judged today. A suggestion changes nothing until the owner accepts it through the corrections.
 */

/** What the checks of a batch read today: the agents' hidden folders and the owner's entity keys. */
function checkEnv(ctx: AppContext) {
  const settings = ctx.settings();
  const owner = entityView(ctx, audienceView(ctx, null));
  return {
    env: {
      db: ctx.db,
      paths: ctx.paths,
      settings,
      hidden: audienceView(ctx, "agents").hidden,
      keyExists: (key: string) => owner.byKey.has(key),
    },
    owner,
  };
}

/** The recorded batches whose run still exists, newest first, each with its run. */
function batchesWithRuns(ctx: AppContext) {
  return suggestionBatches(ctx.db).flatMap((batch) => {
    const run = ctx.runs.get(batch.runId);
    return run ? [{ batch, run }] : [];
  });
}

/** Whether a batch is open (its run queued, running or waiting for approval): one at a time (AC 90). */
const anyBatchOpen = (ctx: AppContext): boolean =>
  batchesWithRuns(ctx).some(({ run }) => batchOpen(run.status));

/**
 * Start a batch now (door 9): the files of the agents that changed since the last batch's start, the names they know
 * and the ones the owner rejected; the batch is recorded with its start. `startedBy` is the owner, or null for the service.
 */
export function startSuggestionBatch(ctx: AppContext, startedBy: "owner" | null, now: number): string {
  const settings = ctx.settings();
  if (!settings.memory.entities.enabled) {
    throw httpError(409, "The entities are off (memory.entities.enabled).", "entities_disabled");
  }
  if (!ctx.suggestions.available()) {
    throw httpError(
      409,
      "The brain-entities skill is missing, disabled or not a memory skill.",
      "skill_unavailable",
    );
  }
  if (anyBatchOpen(ctx))
    throw httpError(409, "A batch of suggestions is still open.", "suggestions_in_progress");
  const agents = audienceView(ctx, "agents");
  const since = suggestionBatches(ctx.db)[0]?.startedAt ?? 0;
  const files = suggestionBatchFiles(
    { db: ctx.db, paths: ctx.paths, settings, hidden: agents.hidden },
    since,
  ).map((f) => f.path);
  if (files.length === 0) throw httpError(409, "No note changed since the last batch.", "nothing_to_read");
  const seen = entityView(ctx, agents);
  const known = suggestionKnown(seen.entities, seen.corrections);
  let id: string;
  try {
    id = ctx.suggestions.start({
      inputs: { files: files.join("\n"), ...(known.length > 0 ? { known: known.join("\n") } : {}) },
      startedBy,
    });
  } catch (err) {
    // A SKILL.md the safe reader refuses as the run starts is a skill that cannot run (as for a summary).
    const code = (err as { code?: unknown }).code;
    if (code === "not_a_file" || code === "file_too_large") {
      throw httpError(409, "The brain-entities skill cannot be read.", "skill_unavailable");
    }
    throw err;
  }
  recordSuggestionBatch(ctx.db, { runId: id, startedAt: now, files });
  return id;
}

/**
 * The service's own start (AC 86-88), at the end of an index pass: only with `memory.entities.llm.enabled`, no run of
 * any kind open, and the last batch started more than 24 h before `now` (or none ever); nothing to read starts nothing.
 * Answers the run's id, or null when it starts none.
 */
export function autoSuggestionBatch(ctx: AppContext, now: number): string | null {
  const settings = ctx.settings();
  if (!settings.memory.entities.llm.enabled || !settings.memory.entities.enabled) return null;
  const open = ctx.db
    .prepare("SELECT COUNT(*) AS n FROM runs WHERE status IN ('queued', 'running', 'waiting_approval')")
    .get() as { n: number };
  if (open.n > 0) return null;
  const last = suggestionBatches(ctx.db)[0];
  if (last && now - last.startedAt <= SUGGESTION_BATCH_INTERVAL_MS) return null;
  if (!ctx.suggestions.available()) return null;
  try {
    return startSuggestionBatch(ctx, null, now);
  } catch (err) {
    if ((err as { code?: unknown }).code === "nothing_to_read") return null;
    throw err;
  }
}

/**
 * The service's schedule of the batches (door 9): after each finished index pass, `autoSuggestionBatch` with the clock
 * `now`. Only the service calls it (`startServer`), never a CLI context; answers the unsubscribe.
 */
export function scheduleSuggestionBatches(
  ctx: AppContext,
  now: () => number = Date.now,
  onError: (err: unknown) => void = () => {},
): () => void {
  return ctx.events.subscribe((event) => {
    if (event.type !== "index.finished") return;
    try {
      autoSuggestionBatch(ctx, now());
    } catch (err) {
      onError(err);
    }
  });
}

/** A suggestion as the list shows it (AC 93). */
const itemOf = (s: CheckedSuggestion) => ({
  id: s.id,
  kind: s.kind,
  name: s.name,
  aliases: s.aliases,
  ...(s.mergeWith !== undefined ? { mergeWith: s.mergeWith } : {}),
  evidence: s.evidence,
  state: "pending" as const,
});

/**
 * The suggestion `id` names, as today's check lets it through (door 10): of a recorded batch whose run ended `done`;
 * null for none. Whether it is still pending is the correction's to judge.
 */
export function findSuggestion(ctx: AppContext, id: string): CheckedSuggestion | null {
  const colon = id.lastIndexOf(":");
  if (colon <= 0) return null;
  const runId = id.slice(0, colon);
  const found = batchesWithRuns(ctx).find(({ batch }) => batch.runId === runId);
  if (!found) return null;
  const { env } = checkEnv(ctx);
  const outcome = batchOutcome({ ...env, batch: found.batch }, found.run.status);
  if (outcome.kind !== "accepted") return null;
  return outcome.suggestions.find((s) => s.id === id) ?? null;
}

export function registerSuggestionRoutes(app: FastifyInstance, ctx: AppContext): void {
  bind(app, "memory.entities.suggestions.start", async (_input, _req, reply) => {
    const id = startSuggestionBatch(ctx, "owner", Date.now());
    reply.code(202);
    return { id, status: "running" as const };
  });

  bind(app, "memory.entities.suggestions.list", async () => {
    const settings = ctx.settings();
    const { env, owner } = checkEnv(ctx);
    const batches = batchesWithRuns(ctx);
    const outcomes = batches.map(({ batch, run }) => ({
      batch,
      run,
      outcome: batchOutcome({ ...env, batch }, run.status),
    }));
    const newest = outcomes[0];
    // The suggestions of the newest finished batch: one still reading leaves the last one's on the list.
    const finished = outcomes.find((o) => o.outcome.kind !== "running");
    const items =
      finished?.outcome.kind === "accepted"
        ? pendingSuggestions(finished.outcome.suggestions, owner, owner.corrections).map(itemOf)
        : [];
    const recordedLast = suggestionBatches(ctx.db)[0];
    return {
      items,
      ...(newest
        ? {
            lastBatch: {
              id: newest.run.id,
              status: newest.run.status,
              startedAt: newest.batch.startedAt,
              ...(newest.run.finishedAt !== null ? { finishedAt: newest.run.finishedAt } : {}),
              ...(newest.outcome.kind === "refused" ? { reason: newest.outcome.reason } : {}),
            },
          }
        : {}),
      ...(settings.memory.entities.llm.enabled && recordedLast
        ? { nextBatchAt: recordedLast.startedAt + SUGGESTION_BATCH_INTERVAL_MS }
        : {}),
    };
  });
}
