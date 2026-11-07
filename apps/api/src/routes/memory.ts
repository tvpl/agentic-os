import fs from "node:fs";
import path from "node:path";
import type { FastifyInstance, FastifyRequest } from "fastify";
import {
  appendJournal,
  assertFact,
  buildGraph,
  checkRouters,
  classifyNotePath,
  contextOkPaths,
  createNote,
  ensureJournal,
  factStats,
  factSourcePolicy,
  getVersion,
  listVersions,
  visibleHistoryPaths,
  recordFileVersion,
  restoreVersion,
  decideProposal,
  exportFolder,
  importFolder,
  listProposals,
  planNewNote,
  readProposal,
  storeProposal,
  ProposalValidationError,
  folderDigests,
  generateRouters,
  homeReadScope,
  inspectPath,
  installJournalHooks,
  journalSections,
  listFacets,
  linksOf,
  listJournalDates,
  memoryTree,
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
  runMapReach,
  saveNote,
  saveProperties,
  saveTask,
  statWorkspacePath,
  workspaceScope,
  journalDir,
  journalPath,
  proposalPaths,
  parseEscopoList,
  parseNaturezaList,
  type ReadScope,
} from "@mordomo/core/internal";
import { accessView, rankScored, zeroCounts, type AccessView } from "../access.js";
import type { AppContext } from "../context.js";
import { bind } from "../contract.js";
import { httpError } from "./common.js";
import { contextFilter, requireContext } from "./contexts.js";

/**
 * What a run's own credential reads through the recall and the search (.specs/features/cerebro-contextos, doors 7 and
 * 8): the files under `memory/` and under the `ok` paths of the run's work context (the folders the run is already
 * handed as its working and added folders), never the owner's other folders; and the context a read follows when the
 * call names none. A context deleted since the run started leaves `memory/`. Null for any other caller.
 */
function runReach(
  ctx: AppContext,
  req: FastifyRequest,
  view: AccessView,
): { scope: ReadScope; context: string | undefined } | null {
  if (req.principal?.kind !== "run") return null;
  // The run's view of the settings (cerebro-memoria-confiavel, door 12): a folder hidden from agents is no part of it.
  const settings = view.settings;
  const contextId = ctx.runs.get(req.principal.runId)?.contextId ?? null;
  const context = contextId ? settings.contexts.find((c) => c.id === contextId) : undefined;
  if (!context)
    return {
      scope: homeReadScope(ctx.paths.home, [ctx.paths.memory], settings.excludes),
      context: undefined,
    };
  const roots = [ctx.paths.memory, ...contextOkPaths({ paths: ctx.paths, settings }, context)];
  return { scope: homeReadScope(ctx.paths.home, roots, settings.excludes), context: context.id };
}

/**
 * What a device answers for a note or a file it may not see (cerebro-memoria-confiavel, AC 92): the same `404
 * not_found` as for one that does not exist, so the answer does not say the folder is there.
 */
function hiddenFromDevice(what: "note" | "file"): Error {
  return httpError(
    404,
    what === "note" ? "The note does not exist." : "The file does not exist.",
    "not_found",
  );
}

/** Whether the scope lets `file` be read today (a refused path is not a hit). */
/**
 * The `natureza` and `escopo` filters of the search and the recall (cerebro-natureza, AC 8, 9 and 12): the contract has
 * already refused a value outside the closed lists, so each is the list it names, or absent.
 */
function natureFilters(q: { natureza?: string | undefined; escopo?: string | undefined }) {
  const natureza = q.natureza !== undefined ? parseNaturezaList(q.natureza) : null;
  const escopo = q.escopo !== undefined ? parseEscopoList(q.escopo) : null;
  return { ...(natureza ? { natureza } : {}), ...(escopo ? { escopo } : {}) };
}

function readable(scope: ReadScope, file: string): boolean {
  try {
    return inspectPath(scope, file).blockedReason === null;
  } catch {
    return false;
  }
}

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

  bind(app, "memory.status", async ({ query: q }, req) => {
    // A work context counts the facets over its own files; the rest of the answer is the index's (cerebro-contextos AC 14).
    // A device counts none of a folder hidden from it (cerebro-memoria-confiavel, amendment 5).
    const view = accessView(ctx, req.principal);
    const context = contextFilter(ctx, q.context, view.settings);
    const policy = view.audience === "devices" ? view.rowFilter() : null;
    const within = policy
      ? (row: { root: string; rel: string }) => policy(row) && (!context || context(row))
      : context;
    const last = ctx.indexer.lastIndex();
    const facets = listFacets(ctx.db, within);
    // The counts of a pass are over every file, hidden ones included: a device with a hidden folder is given none
    // (round 2 finding 8), nor the progress of a pass that is running.
    const redact = view.ownIndex();
    const indexing = ctx.indexHost.status();
    return {
      lastIndex: last && redact ? { ...last, stats: zeroCounts(last.stats) } : last,
      facets,
      indexing: redact ? { ...indexing, scanned: 0, total: indexing.total === null ? null : 0 } : indexing,
      semantic: ctx.semantic.status(redact && policy ? policy : undefined),
    };
  });

  bind(app, "memory.index", async () => {
    // Chunked, non-blocking indexing: emits index.progress / index.finished on the bus.
    const stats = await ctx.indexer.indexAllAsync();
    return { stats };
  });

  bind(app, "memory.index.cancel", async () => ctx.indexHost.cancel());

  bind(app, "memory.search", async ({ query: q }, req) => {
    // Rows are judged by today's policy as they are read (an old index may still hold a private path).
    const { mode, context, natureza: _natureza, escopo: _escopo, ...filters } = q;
    const view = accessView(ctx, req.principal);
    const reach = runReach(ctx, req, view);
    const within = contextFilter(ctx, context ?? reach?.context, view.settings);
    const policy = view.rowFilter();
    type Row = { root: string; rel: string };
    const scoped = reach
      ? (row: Row) => policy(row) && readable(reach.scope, path.join(row.root, row.rel))
      : policy;
    const allow = within ? (row: Row) => scoped(row) && within(row) : scoped;
    // Anyone but the owner ranks over the index of their own audience, which holds only what they may see (door 19).
    const index = view.audience ? ctx.indexer.audienceTable(view.audience) : undefined;
    const hits = await ctx.semantic.search(
      { ...filters, ...natureFilters(q), query: q.q, allow, ...(index ? { index } : {}) },
      mode ?? "auto",
    );
    // Anyone but the owner is given the score of a hit's place in the list, never the bm25 of the whole index (amendment 4).
    return view.audience === null ? hits : rankScored(hits);
  });

  /** The edges a device reads are worked out over the files it may see, not over the whole corpus (door 20). */
  const relatedTableOf = (req: FastifyRequest) =>
    req.principal?.kind === "device" ? ctx.indexer.relatedTable("devices") : ("file_related" as const);

  bind(app, "memory.graph", async ({ query: q }, req) => {
    const within = contextFilter(ctx, q.context);
    return buildGraph(ctx.db, {
      area: q.area,
      dir: q.dir,
      query: q.q,
      maxNodes: q.maxNodes,
      related: q.related,
      // Rows are judged by today's policy as they are read: an excluded file is no node, no edge, no count; nor is a
      // file in a folder hidden from the caller (cerebro-memoria-confiavel, door 12).
      allow: accessView(ctx, req.principal).rowFilter(),
      ...(within ? { within } : {}),
      relatedTable: relatedTableOf(req),
    });
  });

  bind(app, "memory.related", async ({ query: { id, context } }, req) => {
    const within = contextFilter(ctx, context);
    const related = relatedFiles(
      ctx.db,
      id,
      accessView(ctx, req.principal).rowFilter(),
      within,
      relatedTableOf(req),
    );
    if (!related) throw httpError(404, "File not found", "not_found");
    return related;
  });

  bind(app, "memory.links", async ({ query: { id } }, req) => {
    // Rows are judged by today's policy as they are read: a stale row under a private path is not a file here.
    const links = linksOf(ctx.db, id, accessView(ctx, req.principal).rowFilter());
    if (!links) throw httpError(404, "File not found", "not_found");
    return links;
  });

  bind(app, "memory.preview", async ({ query: { p } }, req) => {
    // previewFile enforces root containment, the secret blocklist and the home's
    // private config/ and logs/ (403 on violation).
    const view = accessView(ctx, req.principal);
    const device = view.audience === "devices";
    if (device && view.hidden(p)) throw hiddenFromDevice("file");
    try {
      const preview = previewFile(view.settings, [ctx.paths.home], p, { homeDir: ctx.paths.home });
      return { ...preview, editable: previewIsEditable(noteContext(), p, preview.kind) };
    } catch (err) {
      if (device && (err as NodeJS.ErrnoException).code === "ENOENT") throw hiddenFromDevice("file");
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
  /** The owner's note writes record a version each (.specs/features/cerebro-memoria-confiavel, AC 21). */
  const historyEnv = () => ({ db: ctx.db, paths: ctx.paths, settings: ctx.settings() });
  const noteContext = () => {
    const env = historyEnv();
    return {
      paths: ctx.paths,
      settings: env.settings,
      history: (
        file: string,
        bytes: Uint8Array | string,
        origin: "create" | "save" | "properties" | "task",
      ) => {
        recordFileVersion(env, file, bytes, "owner", origin);
      },
    };
  };

  bind(app, "memory.note", async ({ query: { p } }, req) => {
    const view = accessView(ctx, req.principal);
    const device = view.audience === "devices";
    if (device && view.hidden(p)) throw hiddenFromDevice("note");
    try {
      return readNote({ ...noteContext(), settings: view.settings }, p);
    } catch (err) {
      if (device && (err as NodeJS.ErrnoException).code === "ENOENT") throw hiddenFromDevice("note");
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

  bind(app, "memory.notes.properties", async ({ body }) => {
    const written = saveProperties(noteContext(), body);
    reindex(written.path);
    return written;
  });

  // A task checked from a dashboard (cerebro-paineis, amendment 17): the box of one line, then the index learns it.
  bind(app, "memory.tasks.save", async ({ body }) => {
    const written = saveTask(noteContext(), body);
    reindex(written.path);
    return written;
  });

  /**
   * One level of the notes tree (.specs/features/cerebro-vista-notas, door 1), from the index rows alone: no file is
   * opened, and a row today's policy hides is neither listed nor counted.
   */
  bind(app, "memory.tree", async ({ query: q }, req) => {
    const view = accessView(ctx, req.principal);
    const context = requireContext(ctx, q.context, view.settings);
    return memoryTree(
      ctx.db,
      { ...noteContext(), settings: view.settings },
      {
        context,
        root: q.root,
        dir: q.dir,
        sort: q.sort,
        indexing: ctx.indexHost.status().state === "running",
        access: view.access,
      },
    );
  });

  /**
   * The folders and the state of their index notes (.specs/features/cerebro-organizar, doors 4 and 10). A run's own
   * credential sees `memory/notes/` and the folders the run was handed; a root outside them is `404`.
   */
  bind(app, "memory.maps", async ({ query: q }, req) => {
    const env = { paths: ctx.paths, settings: accessView(ctx, req.principal).settings };
    let reach: string[] | undefined;
    if (req.principal?.kind === "run") {
      const run = ctx.runs.get(req.principal.runId);
      const skill = run?.skillSlug ? ctx.skills.load(run.skillSlug) : null;
      reach = run ? runMapReach(env, run, skill) : [];
    }
    const folders = folderDigests(ctx.db, env, {
      ...(q.root !== undefined ? { root: q.root } : {}),
      ...(reach ? { reach } : {}),
    });
    if (!folders) throw httpError(404, `No indexed root this caller may read is ${q.root}.`, "not_found");
    return { folders };
  });

  bind(app, "memory.routers", async () => {
    const result = generateRouters(ctx.db, ctx.paths, ctx.settings());
    return { written: result.written };
  });

  bind(app, "memory.routers.check", async (_input, req) => {
    // A pointer the caller may not be told of is not reported (today's policy, and the folders hidden from it).
    const view = accessView(ctx, req.principal);
    return checkRouters(ctx.db, ctx.paths, view.settings, (target) => view.allowsPath(target));
  });

  // ---- memory v2: layered recall, journal, hygiene, facts, inline fields ----

  /** Layered retrieval (the deterministic `brain.js`): keywords → index → top-K → sections → pointers. */
  bind(app, "memory.recall", async ({ query: q }, req) => {
    // A run's credential recalls from the memory folder and its work context, not from every folder the owner
    // granted; without `context` it follows the run's context (door 7).
    const view = accessView(ctx, req.principal);
    const reach = runReach(ctx, req, view);
    const within = contextFilter(ctx, q.context ?? reach?.context, view.settings);
    const result = recall(ctx.db, ctx.paths, view.settings, q.q, {
      k: q.k,
      area: q.area,
      excerptChars: q.excerptChars,
      ...(reach ? { scope: reach.scope } : {}),
      ...(within ? { within } : {}),
      ...(view.audience ? { index: ctx.indexer.audienceTable(view.audience) } : {}),
      ...natureFilters(q),
    });
    if (q.record !== false) recordRecall(ctx.db, result);
    // Anyone but the owner is given scores by place in each list (amendment 4).
    return view.audience === null
      ? result
      : {
          ...result,
          answerContext: rankScored(result.answerContext),
          candidates: rankScored(result.candidates),
        };
  });

  bind(app, "memory.recall.stats", async ({ query: { limit } }, req) => {
    // A path the caller may not be told of is not listed (today's policy, and the folders hidden from it).
    const view = accessView(ctx, req.principal);
    return recallStats(ctx.db, limit, (p) => view.allowsPath(p));
  });

  /** A day's journal (created from the template on first access) — or the last N days with `days=`. */
  bind(app, "memory.journal", async ({ query: q }, req) => {
    // The days are read through the caller's scope: today's policy, and for a device or a run the folders hidden from it.
    const view = accessView(ctx, req.principal);
    if (q.days) {
      const today = q.date ?? localDateString();
      const days = recentJournals(ctx.paths, q.days, today, view.scopeOf([ctx.paths.memory]));
      return { today, days: days.map((d) => ({ ...d, sections: journalSections(d.content) })) };
    }
    const date = q.date ?? localDateString();
    // A day the caller may not see is not there, and is not made (G15): `404 not_found`.
    if (view.hidden(journalDir(ctx.paths)) || view.hidden(journalPath(ctx.paths, date))) {
      throw httpError(404, "No journal day the caller may read is there.", "not_found");
    }
    const day = ensureJournal(ctx.paths, date);
    return { ...day, sections: journalSections(day.content), dates: listJournalDates(ctx.paths) };
  });

  bind(app, "memory.journal.append", async ({ body }, req) => {
    const run = req.principal?.kind === "run";
    // A run's credential writes the journal only where agents may write (cerebro-memoria-confiavel, door 12).
    if (run) {
      const view = accessView(ctx, req.principal);
      const day = journalPath(ctx.paths, body.date ?? localDateString());
      const level = [journalDir(ctx.paths), day].map((p) => view.access.level(p, "agents"));
      if (level.includes("hide")) throw httpError(403, "The journal is hidden from agents.", "folder_hidden");
      if (level.includes("read"))
        throw httpError(403, "Agents may only read the journal.", "folder_read_only");
    }
    if (req.principal?.kind === "run") ctx.noteMemoryWrite(req.principal.runId);
    // A line a run's credential appends, or that an agent sends through the owner's token, says an agent wrote it
    // (cerebro-memoria-confiavel, door 9): the consolidation never promotes it by the "Decisions" rule.
    const { author, ...entry } = body;
    const day = appendJournal(ctx.paths, { ...entry, agent: run || author === "agent" });
    return { ...day, sections: journalSections(day.content) };
  });

  /** Orphans, dangling router links, stale files, skills never run, silent routines, unused connectors. */
  bind(app, "memory.hygiene", async ({ query: q }, req) => {
    const view = accessView(ctx, req.principal);
    return memoryHygiene(
      ctx.db,
      ctx.paths,
      view.settings,
      {
        skills: ctx.skills.list(),
        routines: ctx.routines.list(),
        connectors: ctx.connectors.list(),
        // Same verdict as GET /api/routines/silent, so both views agree.
        silent: ctx.scheduler.silent(q.silentRoutineDays ?? 30),
      },
      { ...q, allow: view.rowFilter(), allowPath: (target) => view.allowsPath(target) },
    );
  });

  /** Bi-temporal facts: currently valid by default; `asOf=` for a point in time; `includeExpired=true` for history. */
  bind(app, "memory.facts.list", async ({ query: q }, req) => {
    // A fact whose source today's policy refuses, or cannot judge, is not shown (cerebro-memoria-confiavel, AC 20); nor
    // one whose source lies in a folder hidden from the caller (door 12).
    const allow = factSourcePolicy({ settings: accessView(ctx, req.principal).settings, paths: ctx.paths });
    return { facts: queryFacts(ctx.db, { ...q, allow }), stats: factStats(ctx.db) };
  });

  bind(app, "memory.facts.assert", async ({ body }, req, reply) => {
    // A run's credential says which run asserted the fact; the body cannot name another, nor any caller an author.
    // What a run asserts waits in the review inbox (cerebro-memoria-confiavel, door 9): a proposal, no fact.
    if (req.principal?.kind === "run") {
      const runId = req.principal.runId;
      ctx.noteMemoryWrite(runId);
      const proposal = storeProposal(
        ctx.db,
        {
          kind: "fact",
          author: `run:${runId}`,
          runId,
          summary: `${body.subject} · ${body.predicate} · ${body.object}`,
          payload: { ...body, sourceRunId: runId },
        },
        { capped: true },
      );
      reply.code(202);
      return { proposal };
    }
    const result = assertFact(ctx.db, { ...body, author: "owner" });
    reply.code(result.unchanged ? 200 : 201);
    return result;
  });

  bind(app, "memory.facts.retract", async ({ params: { id }, body }) => {
    const fact = retractFact(ctx.db, id, Date.now(), body?.reason ?? "ended");
    if (!fact) throw httpError(404, "Fact not found", "not_found");
    return fact;
  });

  // ---- the history of memory/ (.specs/features/cerebro-memoria-confiavel, doors 4 and 10) ----

  /**
   * A version of the history (a path relative to memory/, an id) the caller may see: none in a folder hidden from it
   * (door 12), and, while a folder is hidden from it, none that predates a removal of its path (round 3 finding 2, plan
   * amendment 16): history is keyed by path, so a note moved into a hidden folder leaves its versions under the path it
   * came from, and where it went is not always known.
   */
  const historyAllow = (view: AccessView) =>
    view.audience === null
      ? undefined
      : visibleHistoryPaths(
          ctx.db,
          (rel) => view.hidden(path.join(ctx.paths.memory, ...rel.split("/"))),
          view.access.hides(view.audience)
            ? { exists: (rel) => fs.existsSync(path.join(ctx.paths.memory, ...rel.split("/"))) }
            : undefined,
        );

  bind(app, "memory.history.list", async ({ query: q }, req) => ({
    versions: listVersions(historyEnv(), {
      path: q.path,
      limit: q.limit,
      allow: historyAllow(accessView(ctx, req.principal)),
    }),
  }));

  bind(app, "memory.history.get", async ({ params: { id } }, req) => {
    const version = getVersion(historyEnv(), id);
    const allow = historyAllow(accessView(ctx, req.principal));
    if (allow && !allow(version.path, version.id))
      throw httpError(404, `No version of memory/ with bytes has the id ${id}.`, "not_found");
    return version;
  });

  bind(app, "memory.history.restore", async ({ body }) => {
    const restored = restoreVersion(historyEnv(), body);
    reindex(path.join(ctx.paths.memory, ...restored.path.split("/")));
    return restored;
  });

  // ---- the review inbox of what an agent writes (.specs/features/cerebro-memoria-confiavel, doors 5 to 7 and 10) ----

  /**
   * The proposals the caller may see (G14): none that names a file in a folder hidden from it, as a source, a target or
   * the note it writes; one whose files cannot be worked out is hidden too.
   */
  const proposalAllow = (view: AccessView) =>
    view.audience === null
      ? undefined
      : (record: Parameters<typeof proposalPaths>[1]) => {
          const named = proposalPaths(historyEnv(), record);
          return named !== null && !named.some((p) => view.hidden(p));
        };

  bind(app, "memory.proposals.list", async ({ query: q }, req) =>
    listProposals(ctx.db, q, proposalAllow(accessView(ctx, req.principal))),
  );

  bind(app, "memory.proposals.get", async ({ params: { id } }, req) => {
    const view = accessView(ctx, req.principal);
    // The facts the effects name are shown to a caller as `GET /api/memory/facts` shows them (AC 20, door 12).
    const proposal = readProposal(
      historyEnv(),
      id,
      undefined,
      view.audience === null ? undefined : factSourcePolicy({ settings: view.settings, paths: ctx.paths }),
    );
    const allow = proposalAllow(view);
    if (allow && !allow(proposal)) throw httpError(404, `No proposal has the id ${id}.`, "not_found");
    return proposal;
  });

  /** What the MCP tools send: the owner's token, an agent's words (`author: mcp`). */
  bind(app, "memory.proposals.create", async ({ body }, _req, reply) => {
    const { kind, ...payload } = body;
    let summary: string;
    if (kind === "fact") {
      summary = `${body.subject} · ${body.predicate} · ${body.object}`;
    } else if (kind === "note_create") {
      // A note that could never be created as asked is refused now, naming why, rather than waiting to fail.
      try {
        planNewNote({ paths: ctx.paths, settings: ctx.settings() }, body);
      } catch (err) {
        const code = (err as { code?: string }).code ?? "validation";
        throw new ProposalValidationError(`${code}: ${(err as Error).message}`);
      }
      summary = body.title.trim();
    } else {
      summary = path.basename(body.path);
    }
    const proposal = storeProposal(
      ctx.db,
      { kind, author: "mcp", runId: null, summary, payload },
      { capped: true },
    );
    reply.code(201);
    return { proposal };
  });

  bind(app, "memory.proposals.decide", async ({ params: { id }, body }) => {
    const decided = decideProposal(historyEnv(), id, body);
    for (const w of decided.written) reindex(path.join(ctx.paths.memory, ...w.path.split("/")));
    return decided;
  });

  // ---- export and import a folder (.specs/features/cerebro-memoria-confiavel, doors 14 and 15) ----

  bind(app, "memory.export", async ({ body: { folder } }) => exportFolder(historyEnv(), folder));

  bind(app, "memory.import", async ({ body }) => {
    const { written, ...done } = importFolder(historyEnv(), body);
    ctx.indexer.requestIndexPaths(written).catch(() => undefined);
    return done;
  });

  /** Dataview-style query over inline `key:: value` fields: `where=key`, `key:value` or `key:~substring`. */
  bind(app, "memory.query", async ({ query: q }, req) => {
    // Rows are judged by today's policy as they are read, and by the folders hidden from the caller (door 12).
    return {
      where: q.where,
      files: queryFilesByField(ctx.db, { ...q, allow: accessView(ctx, req.principal).rowFilter() }),
    };
  });
}
