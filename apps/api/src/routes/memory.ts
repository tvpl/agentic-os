import { z } from "zod";
import type { FastifyInstance } from "fastify";
import {
  JOURNAL_SECTIONS,
  appendJournal,
  assertFact,
  buildGraph,
  checkRouters,
  ensureJournal,
  events,
  factStats,
  generateRouters,
  installJournalHooks,
  isJournalDate,
  journalSections,
  listFacets,
  listJournalDates,
  localDateString,
  memoryHygiene,
  previewFile,
  queryFacts,
  queryFilesByField,
  recall,
  recallStats,
  recentJournals,
  recordRecall,
  relatedFiles,
  resolveInsideRoots,
  retractFact,
  searchFiles,
} from "@mordomo/core";
import type { AppContext } from "../context.js";
import { grantedRoots, httpError } from "./common.js";

const JournalDateParam = z.string().refine(isJournalDate, { message: "expected YYYY-MM-DD" });

export function registerMemoryRoutes(app: FastifyInstance, ctx: AppContext): void {
  // Journal hooks: `memory/` becomes an indexed root (journal notes are
  // searchable and recallable) and every finished run leaves one line under
  // "Runs". Idempotent, so adding the same call to AppContext later is safe.
  const disposeJournalHooks = installJournalHooks(events, ctx.paths, { indexer: ctx.indexer });
  app.addHook("onClose", async () => {
    disposeJournalHooks();
  });

  app.get("/api/memory/status", async () => {
    const last = ctx.indexer.lastIndex();
    const facets = listFacets(ctx.db);
    return { lastIndex: last, facets };
  });

  app.post("/api/memory/index", async () => {
    // Chunked, non-blocking indexing: emits index.progress / index.finished on the bus.
    const stats = await ctx.indexer.indexAllAsync();
    return { stats };
  });

  app.get("/api/memory/search", async (req) => {
    const q = z
      .object({
        q: z.string().default(""),
        area: z.string().optional(),
        ext: z.string().optional(),
        dir: z.string().optional(),
        tag: z.string().optional(),
        modifiedAfter: z.coerce.number().optional(),
        limit: z.coerce.number().int().min(1).max(200).optional(),
      })
      .parse(req.query);
    return searchFiles(ctx.db, { query: q.q, ...q });
  });

  app.get("/api/memory/graph", async (req) => {
    const q = z
      .object({
        area: z.string().optional(),
        dir: z.string().optional(),
        q: z.string().optional(),
        maxNodes: z.coerce.number().int().min(10).max(4000).optional(),
        related: z.coerce.boolean().optional(),
      })
      .parse(req.query);
    return buildGraph(ctx.db, {
      area: q.area,
      dir: q.dir,
      query: q.q,
      maxNodes: q.maxNodes,
      related: q.related,
    });
  });

  app.get("/api/memory/related", async (req) => {
    const { id } = z.object({ id: z.coerce.number().int() }).parse(req.query);
    return relatedFiles(ctx.db, id);
  });

  app.get("/api/memory/preview", async (req) => {
    const { p } = z.object({ p: z.string() }).parse(req.query);
    // previewFile enforces root containment + secret blocklist (403 on violation).
    try {
      return previewFile(ctx.settings(), [ctx.paths.home], p);
    } catch (err) {
      throw httpError(403, (err as Error).message, "forbidden_path");
    }
  });

  /**
   * Open a file with the OS default application — explicit user action only.
   * The executable is a fixed platform constant; the path is containment-checked.
   */
  app.post("/api/memory/open", async (req) => {
    const { p } = z.object({ p: z.string() }).parse(req.body);
    const resolved = resolveInsideRoots(grantedRoots(ctx), p); // PathAccessError → 403
    const { spawn } = await import("node:child_process");
    const [exe, args] =
      process.platform === "darwin"
        ? ["open", [resolved]]
        : process.platform === "win32"
          ? ["cmd", ["/c", "start", "", resolved]]
          : ["xdg-open", [resolved]];
    const child = spawn(exe, args, { detached: true, stdio: "ignore" });
    child.on("error", () => {
      /* opener missing (headless) — the UI already shows the path */
    });
    child.unref();
    return { opened: resolved };
  });

  app.post("/api/memory/routers", async () => {
    const result = generateRouters(ctx.db, ctx.paths, ctx.settings());
    return { written: result.written };
  });

  app.get("/api/memory/routers/check", async () => checkRouters(ctx.db, ctx.paths, ctx.settings()));

  // ---- memory v2: layered recall, journal, hygiene, facts, inline fields ----

  /** Layered retrieval (the deterministic `brain.js`): keywords → index → top-K → sections → pointers. */
  app.get("/api/memory/recall", async (req) => {
    const q = z
      .object({
        q: z.string().min(1).max(2000),
        k: z.coerce.number().int().min(1).max(10).optional(),
        area: z.string().optional(),
        excerptChars: z.coerce.number().int().min(200).max(20_000).optional(),
        /** Skip the frequency bookkeeping (dry runs, UI previews). */
        record: z.coerce.boolean().optional(),
      })
      .parse(req.query);
    const result = recall(ctx.db, ctx.paths, ctx.settings(), q.q, {
      k: q.k,
      area: q.area,
      excerptChars: q.excerptChars,
    });
    if (q.record !== false) recordRecall(ctx.db, result);
    return result;
  });

  app.get("/api/memory/recall/stats", async (req) => {
    const { limit } = z
      .object({ limit: z.coerce.number().int().min(1).max(500).optional() })
      .parse(req.query);
    return recallStats(ctx.db, limit);
  });

  /** A day's journal (created from the template on first access) — or the last N days with `days=`. */
  app.get("/api/memory/journal", async (req) => {
    const q = z
      .object({ date: JournalDateParam.optional(), days: z.coerce.number().int().min(1).max(90).optional() })
      .parse(req.query);
    if (q.days) {
      const today = q.date ?? localDateString();
      const days = recentJournals(ctx.paths, q.days, today);
      return { today, days: days.map((d) => ({ ...d, sections: journalSections(d.content) })) };
    }
    const day = ensureJournal(ctx.paths, q.date ?? localDateString());
    return { ...day, sections: journalSections(day.content), dates: listJournalDates(ctx.paths) };
  });

  app.post("/api/memory/journal/append", async (req) => {
    const body = z
      .object({
        text: z.string().min(1).max(4000),
        section: z.enum(JOURNAL_SECTIONS).optional(),
        date: JournalDateParam.optional(),
        timestamp: z.boolean().optional(),
      })
      .parse(req.body);
    const day = appendJournal(ctx.paths, body);
    return { ...day, sections: journalSections(day.content) };
  });

  /** Orphans, dangling router links, stale files, skills never run, silent routines, unused connectors. */
  app.get("/api/memory/hygiene", async (req) => {
    const q = z
      .object({
        staleDays: z.coerce.number().int().min(1).max(3650).optional(),
        silentRoutineDays: z.coerce.number().int().min(1).max(3650).optional(),
        unusedConnectorDays: z.coerce.number().int().min(1).max(3650).optional(),
        perKind: z.coerce.number().int().min(1).max(500).optional(),
      })
      .parse(req.query);
    return memoryHygiene(
      ctx.db,
      ctx.paths,
      ctx.settings(),
      {
        skills: ctx.skills.list(),
        routines: ctx.routines.list(),
        connectors: ctx.connectors.list(),
        // Same verdict as GET /api/routines/silent, so both views agree.
        silent: ctx.scheduler.silent(q.silentRoutineDays ?? 30),
      },
      q,
    );
  });

  /** Bi-temporal facts: currently valid by default; `asOf=` for a point in time; `includeExpired=true` for history. */
  app.get("/api/memory/facts", async (req) => {
    const q = z
      .object({
        subject: z.string().max(2000).optional(),
        predicate: z.string().max(2000).optional(),
        asOf: z.coerce.number().int().optional(),
        includeExpired: z.coerce.boolean().optional(),
        limit: z.coerce.number().int().min(1).max(2000).optional(),
      })
      .parse(req.query);
    return { facts: queryFacts(ctx.db, q), stats: factStats(ctx.db) };
  });

  app.post("/api/memory/facts", async (req, reply) => {
    const body = z
      .object({
        subject: z.string().min(1).max(2000),
        predicate: z.string().min(1).max(2000),
        object: z.string().min(1).max(2000),
        validFrom: z.number().int().optional(),
        sourceRunId: z.string().max(200).nullable().optional(),
        sourcePath: z.string().max(4096).nullable().optional(),
      })
      .parse(req.body);
    const result = assertFact(ctx.db, body);
    reply.code(result.unchanged ? 200 : 201);
    return result;
  });

  app.post("/api/memory/facts/:id/retract", async (req) => {
    const { id } = z.object({ id: z.coerce.number().int().positive() }).parse(req.params);
    const fact = retractFact(ctx.db, id);
    if (!fact) throw httpError(404, "Fact not found", "not_found");
    return fact;
  });

  /** Dataview-style query over inline `key:: value` fields: `where=key`, `key:value` or `key:~substring`. */
  app.get("/api/memory/query", async (req) => {
    const q = z
      .object({
        where: z.string().min(1).max(500),
        limit: z.coerce.number().int().min(1).max(1000).optional(),
      })
      .parse(req.query);
    return { where: q.where, files: queryFilesByField(ctx.db, q) };
  });
}
