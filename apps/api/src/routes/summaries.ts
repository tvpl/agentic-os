import type { FastifyInstance } from "fastify";
import {
  chooseSummarySources,
  judgeSummaryRun,
  resolveSummaryScope,
  sourceSha256,
  summaryRunOutcome,
  summaryScopeFiles,
  summaryState,
  type SummarySource,
} from "@mordomo/core/internal";
import { accessView, audienceView, type AccessView } from "../access.js";
import type { AppContext } from "../context.js";
import { bind } from "../contract.js";
import { httpError } from "./common.js";
import { recordAgentRead } from "./memory.js";

/**
 * The summaries of an area or a work context (.specs/features/cerebro-entidades-resumos, door 6): `POST
 * /api/memory/summaries` records the sources of the scope and starts the read-only skill `brain-summarize`; `GET
 * /api/memory/summaries` and `GET /api/memory/summaries/:kind/:id` read the runs of each scope, newest first, each
 * judged today (`checkSummary`), and say whether the current summary is fresh or stale, as the caller sees it.
 */

/** The run statuses a summary is still being written in: they hold the lock of one run per scope (AC 50). */
const OPEN_STATUSES = ["queued", "running", "waiting_approval"] as const;
/** What a caller that may not see the file a refusal names is told instead of the reason. */
const HIDDEN_REASON = "O último resumo cita um arquivo que não pode ser mostrado aqui.";

type ScopeKind = "area" | "context";

interface SummaryRunRow {
  run_id: string;
  sources: string;
  started_at: number;
}

/** A scope's summary as `view`'s caller reads it (AC 53-60, AC 63). */
function readSummary(
  ctx: AppContext,
  view: AccessView,
  kind: ScopeKind,
  id: string,
): ReturnType<typeof summaryOf> {
  const settings = ctx.settings();
  const scope = resolveSummaryScope({ paths: ctx.paths, settings }, kind, id);
  if (!scope) throw httpError(404, `No ${kind} is named ${id}.`, "scope_not_found");
  return summaryOf(ctx, view, scope);
}

function summaryOf(
  ctx: AppContext,
  view: AccessView,
  scope: NonNullable<ReturnType<typeof resolveSummaryScope>>,
) {
  const settings = ctx.settings();
  const agents = audienceView(ctx, "agents");
  const env = { db: ctx.db, paths: ctx.paths, settings, hidden: agents.hidden };
  const owner = view.audience === null;
  /** Whether the caller may be told of a path (the owner: of every one). */
  const sees = (file: string) => owner || view.allowsPath(file);

  const rows = ctx.db
    .prepare(
      "SELECT run_id, sources, started_at FROM summary_runs WHERE scope_kind = ? AND scope_id = ? ORDER BY started_at DESC, rowid DESC",
    )
    .all(scope.kind, scope.id) as SummaryRunRow[];

  let running = false;
  let lastError: string | undefined;
  let current:
    | {
        row: SummaryRunRow;
        run: NonNullable<ReturnType<AppContext["runs"]["get"]>>;
        paragraphs: Extract<ReturnType<typeof summaryRunOutcome>, { kind: "candidate" }>["paragraphs"];
      }
    | undefined;
  for (const [i, row] of rows.entries()) {
    const run = ctx.runs.get(row.run_id);
    if (!run) continue;
    let sources: SummarySource[];
    try {
      sources = JSON.parse(row.sources) as SummarySource[];
    } catch {
      sources = [];
    }
    const outcome = summaryRunOutcome(run.status, () =>
      judgeSummaryRun(env, run.id, new Set(sources.map((s) => s.path))),
    );
    if (outcome.kind === "candidate") {
      current = { row, run, paragraphs: outcome.paragraphs };
      break;
    }
    // Only the newest run speaks of itself (AC 55): an older one that gives no summary is passed over.
    if (i > 0) continue;
    if (outcome.kind === "running") running = true;
    else lastError = outcome.path !== undefined && !sees(outcome.path) ? HIDDEN_REASON : outcome.lastError;
  }

  const head = {
    scope: { kind: scope.kind, id: scope.id, name: scope.name },
    running,
    ...(lastError !== undefined ? { lastError } : {}),
  };
  if (!current) return { ...head, state: "missing" as const, sources: [] };

  let recorded: SummarySource[];
  try {
    recorded = JSON.parse(current.row.sources) as SummarySource[];
  } catch {
    recorded = [];
  }
  recorded = recorded.filter((s) => sees(s.path));
  // The files of the scope a summary may read, of those the caller sees: what may have been added since.
  const scopeFiles = summaryScopeFiles(env, scope).filter((f) => !view.hidden(f.path));
  const rowOf = ctx.db.prepare("SELECT id, size, mtime FROM files WHERE path = ?");
  const indexed = (file: string) =>
    rowOf.get(file) as { id: number; size: number; mtime: number } | undefined;
  const staleness = summaryState(
    recorded,
    { file: indexed, sha256: (file) => sourceSha256(env, file) },
    scopeFiles,
    current.row.started_at,
  );
  const run = current.run;
  return {
    ...head,
    state: staleness.state,
    generatedAt: run.startedAt ?? run.createdAt,
    changes: staleness.changes,
    // A paragraph that cites a file the caller does not see is dropped whole, never cut (AC 63).
    paragraphs: current.paragraphs.filter((p) => p.citations.every((c) => sees(c.path))),
    sources: staleness.sources.map((s) => {
      const fileId = indexed(s.path)?.id;
      return {
        ...(fileId !== undefined && s.state !== "removed" ? { fileId } : {}),
        path: s.path,
        name: s.path.split(/[\\/]/).pop() ?? s.path,
        state: s.state,
      };
    }),
    run: {
      id: run.id,
      provider: run.provider,
      startedAt: run.startedAt ?? run.createdAt,
      ...(run.finishedAt !== null ? { finishedAt: run.finishedAt } : {}),
    },
  };
}

export function registerSummaryRoutes(app: FastifyInstance, ctx: AppContext): void {
  bind(app, "memory.summaries.start", async ({ body }, _req, reply) => {
    const settings = ctx.settings();
    const scope = resolveSummaryScope({ paths: ctx.paths, settings }, body.scope.kind, body.scope.id);
    if (!scope) throw httpError(404, `No ${body.scope.kind} is named ${body.scope.id}.`, "scope_not_found");
    if (!ctx.summaries.available()) {
      throw httpError(
        409,
        "The brain-summarize skill is missing, disabled or not a memory skill.",
        "skill_unavailable",
      );
    }
    // One run per scope (AC 50): the lock is the table of runs, so it outlives the service.
    const open = ctx.db
      .prepare(
        `SELECT COUNT(*) AS n FROM summary_runs s JOIN runs r ON r.id = s.run_id
         WHERE s.scope_kind = ? AND s.scope_id = ? AND r.status IN (${OPEN_STATUSES.map(() => "?").join(", ")})`,
      )
      .get(scope.kind, scope.id, ...OPEN_STATUSES) as { n: number };
    if (open.n > 0)
      throw httpError(409, "A summary of this scope is still being written.", "summary_in_progress");

    const startedAt = Date.now();
    const sources = chooseSummarySources(
      { db: ctx.db, paths: ctx.paths, settings, hidden: audienceView(ctx, "agents").hidden },
      scope,
    );
    if (sources.length === 0) throw httpError(409, "The scope has no file the agents read.", "empty_scope");
    let id: string;
    try {
      id = ctx.summaries.start({
        inputs: { scope: scope.input, sources: sources.map((s) => s.path).join("\n") },
      });
    } catch (err) {
      // A SKILL.md the safe reader refuses as the run starts (not a file, a file too large) is a skill that cannot
      // run, as `available` says of one it refuses before; a path refused on the way is `403 forbidden_path`.
      const code = (err as { code?: unknown }).code;
      if (code === "not_a_file" || code === "file_too_large") {
        throw httpError(409, "The brain-summarize skill cannot be read.", "skill_unavailable");
      }
      throw err;
    }
    ctx.db
      .prepare(
        "INSERT INTO summary_runs (run_id, scope_kind, scope_id, sources, started_at) VALUES (?, ?, ?, ?, ?)",
      )
      .run(id, scope.kind, scope.id, JSON.stringify(sources), startedAt);
    reply.code(202);
    return { id, status: "running" as const };
  });

  bind(app, "memory.summaries.list", async (_input, req) => {
    const view = accessView(ctx, req.principal);
    const settings = ctx.settings();
    const scopes: Array<[ScopeKind, string]> = [
      ...settings.areas.map((a): [ScopeKind, string] => ["area", a]),
      ...settings.contexts.map((c): [ScopeKind, string] => ["context", c.id]),
    ];
    const items = scopes.map(([kind, id]) => {
      const s = readSummary(ctx, view, kind, id);
      return {
        scope: s.scope,
        state: s.state,
        ...("generatedAt" in s ? { generatedAt: s.generatedAt, changes: s.changes } : {}),
        running: s.running,
        ...(s.lastError !== undefined ? { lastError: s.lastError } : {}),
      };
    });
    return { items };
  });

  bind(app, "memory.summaries.get", async ({ params: { kind, id } }, req) => {
    const summary = readSummary(ctx, accessView(ctx, req.principal), kind, id);
    // An agent's read (the tool `summary`) counts once, with each file its paragraphs cite.
    recordAgentRead(
      ctx,
      req,
      "summary",
      ("paragraphs" in summary ? summary.paragraphs : []).flatMap((p) => p.citations.map((c) => c.path)),
    );
    return summary;
  });
}
