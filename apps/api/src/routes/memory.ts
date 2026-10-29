import path from "node:path";
import type { FastifyInstance } from "fastify";
import {
  appendJournal,
  assertFact,
  buildGraph,
  checkRouters,
  classifyNotePath,
  createNote,
  ensureJournal,
  factStats,
  generateRouters,
  homeReadScope,
  installJournalHooks,
  journalSections,
  listFacets,
  linksOf,
  listJournalDates,
  localDateString,
  memoryHygiene,
  previewFile,
  queryFacts,
  queryFilesByField,
  readNote,
  recall,
  recallStats,
  recentJournals,
  recordRecall,
  relatedFiles,
  resolveOpenablePath,
  retractFact,
  saveNote,
  statWorkspacePath,
  workspaceScope,
  type ReadScope,
} from "@mordomo/core/internal";
import type { AppContext } from "../context.js";
import { bind } from "../contract.js";
import { httpError } from "./common.js";

/**
 * What `POST /api/memory/open` hands to the OS (docs/security.md): documents
 * and media by extension, and folders without one. Anything else, executables
 * and app bundles included, is refused before a process starts.
 */
export const OPENABLE_EXTENSIONS: ReadonlySet<string> = new Set(
  "md txt pdf png jpg jpeg gif webp svg mp4 mov webm mp3 wav m4a csv json html htm docx xlsx pptx odt ods odp rtf".split(
    " ",
  ),
);

function isOpenable(scope: ReadScope, resolved: string): boolean {
  const ext = path.extname(resolved).slice(1).toLowerCase();
  if (ext) return OPENABLE_EXTENSIONS.has(ext);
  try {
    return statWorkspacePath(scope, resolved).stat.isDirectory();
  } catch {
    return false;
  }
}

/** The platform's opener, argv only. Never `cmd /c`, which re-parses `&` in a file name. */
export function openerFor(platform: NodeJS.Platform, resolved: string): [string, string[]] {
  if (platform === "darwin") return ["open", [resolved]];
  if (platform === "win32") return ["explorer.exe", [resolved]];
  return ["xdg-open", [resolved]];
}

/** Whether the preview of `p` offers "Edit": a text file that is an editable note (nothing about it may throw). */
function previewIsEditable(note: Parameters<typeof classifyNotePath>[0], p: string, kind: string): boolean {
  if (kind !== "text") return false;
  try {
    return classifyNotePath(note, p).editable;
  } catch {
    return false;
  }
}

export function registerMemoryRoutes(app: FastifyInstance, ctx: AppContext): void {
  // Journal hooks: `memory/` becomes an indexed root (journal notes are
  // searchable and recallable) and every finished run leaves one line under
  // "Runs". Idempotent, so adding the same call to AppContext later is safe.
  const disposeJournalHooks = installJournalHooks(ctx.events, ctx.paths, { indexer: ctx.indexer });
  app.addHook("onClose", async () => {
    disposeJournalHooks();
  });

  bind(app, "memory.status", async () => {
    const last = ctx.indexer.lastIndex();
    const facets = listFacets(ctx.db);
    return { lastIndex: last, facets, indexing: ctx.indexHost.status(), semantic: ctx.semantic.status() };
  });

  bind(app, "memory.index", async () => {
    // Chunked, non-blocking indexing: emits index.progress / index.finished on the bus.
    const stats = await ctx.indexer.indexAllAsync();
    return { stats };
  });

  bind(app, "memory.index.cancel", async () => ctx.indexHost.cancel());

  bind(app, "memory.search", async ({ query: q }) => {
    // Rows are judged by today's policy as they are read (an old index may still hold a private path).
    const { mode, ...filters } = q;
    return ctx.semantic.search({ ...filters, query: q.q, allow: ctx.indexer.rowFilter() }, mode ?? "auto");
  });

  bind(app, "memory.graph", async ({ query: q }) => {
    return buildGraph(ctx.db, {
      area: q.area,
      dir: q.dir,
      query: q.q,
      maxNodes: q.maxNodes,
      related: q.related,
      // Rows are judged by today's policy as they are read: an excluded file is no node, no edge, no count.
      allow: ctx.indexer.rowFilter(),
    });
  });

  bind(app, "memory.related", async ({ query: { id } }) => {
    const related = relatedFiles(ctx.db, id, ctx.indexer.rowFilter());
    if (!related) throw httpError(404, "File not found", "not_found");
    return related;
  });

  bind(app, "memory.links", async ({ query: { id } }) => {
    // Rows are judged by today's policy as they are read: a stale row under a private path is not a file here.
    const links = linksOf(ctx.db, id, ctx.indexer.rowFilter());
    if (!links) throw httpError(404, "File not found", "not_found");
    return links;
  });

  bind(app, "memory.preview", async ({ query: { p } }) => {
    // previewFile enforces root containment, the secret blocklist and the home's
    // private config/ and logs/ (403 on violation).
    try {
      const preview = previewFile(ctx.settings(), [ctx.paths.home], p, { homeDir: ctx.paths.home });
      return { ...preview, editable: previewIsEditable(noteContext(), p, preview.kind) };
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT")
        throw httpError(
          404,
          "The source was moved or removed. Refresh the index and select an existing file.",
          "source_missing",
        );
      throw httpError(403, (err as Error).message, "forbidden_path");
    }
  });

  /**
   * Open a file with the OS default application — explicit user action only.
   * The executable is a fixed platform constant; the path is containment-checked.
   */
  bind(app, "memory.open", async ({ body: { p } }) => {
    // Same filter as the preview and the indexer; PathAccessError → 403.
    const access = { homeDir: ctx.paths.home };
    const resolved = resolveOpenablePath(ctx.settings(), [ctx.paths.home], p, access);
    if (!isOpenable(workspaceScope(ctx.settings(), [ctx.paths.home], access), resolved)) {
      throw httpError(415, "Only documents, media and folders open from here", "unsupported_type");
    }
    const { spawn } = await import("node:child_process");
    const [exe, args] = openerFor(process.platform, resolved);
    const child = spawn(exe, args, { detached: true, stdio: "ignore" });
    child.on("error", () => {
      /* opener missing (headless) — the UI already shows the path */
    });
    child.unref();
    return { opened: resolved };
  });

  // ---- notes: create and edit the Markdown files under memory/ -----------------------------------------

  /** After a write, the index learns about the file on its own time; the answer does not wait for it. */
  const reindex = (notePath: string): void => {
    ctx.indexer.requestIndexPaths([notePath]).catch(() => undefined);
  };
  const noteContext = () => ({ paths: ctx.paths, settings: ctx.settings() });

  bind(app, "memory.note", async ({ query: { p } }) => {
    try {
      return readNote(noteContext(), p);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT")
        throw httpError(404, "The note does not exist.", "note_missing");
      throw err;
    }
  });

  bind(app, "memory.notes.create", async ({ body }, _req, reply) => {
    const written = createNote(noteContext(), body);
    reindex(written.path);
    reply.code(201);
    return written;
  });

  bind(app, "memory.notes.save", async ({ body }) => {
    const written = saveNote(noteContext(), body);
    reindex(written.path);
    return written;
  });

  bind(app, "memory.routers", async () => {
    const result = generateRouters(ctx.db, ctx.paths, ctx.settings());
    return { written: result.written };
  });

  bind(app, "memory.routers.check", async () => checkRouters(ctx.db, ctx.paths, ctx.settings()));

  // ---- memory v2: layered recall, journal, hygiene, facts, inline fields ----

  /** Layered retrieval (the deterministic `brain.js`): keywords → index → top-K → sections → pointers. */
  bind(app, "memory.recall", async ({ query: q }, req) => {
    const result = recall(ctx.db, ctx.paths, ctx.settings(), q.q, {
      k: q.k,
      area: q.area,
      excerptChars: q.excerptChars,
      // A run's credential recalls from the memory folder, not from every folder the owner granted.
      ...(req.principal?.kind === "run" ? { scope: homeReadScope(ctx.paths.home, [ctx.paths.memory]) } : {}),
    });
    if (q.record !== false) recordRecall(ctx.db, result);
    return result;
  });

  bind(app, "memory.recall.stats", async ({ query: { limit } }) => {
    return recallStats(ctx.db, limit);
  });

  /** A day's journal (created from the template on first access) — or the last N days with `days=`. */
  bind(app, "memory.journal", async ({ query: q }) => {
    if (q.days) {
      const today = q.date ?? localDateString();
      const days = recentJournals(ctx.paths, q.days, today);
      return { today, days: days.map((d) => ({ ...d, sections: journalSections(d.content) })) };
    }
    const day = ensureJournal(ctx.paths, q.date ?? localDateString());
    return { ...day, sections: journalSections(day.content), dates: listJournalDates(ctx.paths) };
  });

  bind(app, "memory.journal.append", async ({ body }, req) => {
    if (req.principal?.kind === "run") ctx.noteMemoryWrite(req.principal.runId);
    const day = appendJournal(ctx.paths, body);
    return { ...day, sections: journalSections(day.content) };
  });

  /** Orphans, dangling router links, stale files, skills never run, silent routines, unused connectors. */
  bind(app, "memory.hygiene", async ({ query: q }) => {
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
      { ...q, allow: ctx.indexer.rowFilter() },
    );
  });

  /** Bi-temporal facts: currently valid by default; `asOf=` for a point in time; `includeExpired=true` for history. */
  bind(app, "memory.facts.list", async ({ query: q }) => {
    return { facts: queryFacts(ctx.db, q), stats: factStats(ctx.db) };
  });

  bind(app, "memory.facts.assert", async ({ body }, req, reply) => {
    // A run's credential says which run asserted the fact; the body cannot name another.
    if (req.principal?.kind === "run") {
      ctx.noteMemoryWrite(req.principal.runId);
      body.sourceRunId = req.principal.runId;
    }
    const result = assertFact(ctx.db, body);
    reply.code(result.unchanged ? 200 : 201);
    return result;
  });

  bind(app, "memory.facts.retract", async ({ params: { id } }) => {
    const fact = retractFact(ctx.db, id);
    if (!fact) throw httpError(404, "Fact not found", "not_found");
    return fact;
  });

  /** Dataview-style query over inline `key:: value` fields: `where=key`, `key:value` or `key:~substring`. */
  bind(app, "memory.query", async ({ query: q }) => {
    return { where: q.where, files: queryFilesByField(ctx.db, q) };
  });
}
