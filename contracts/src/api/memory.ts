/** The second brain: the file index, search, graph, previews, recall, the journal, hygiene and bi-temporal facts. */
import { z } from "zod";
import { isAbsolutePath } from "../workContext.js";
import { IdParams, QueryFlag, err, notFound } from "./common.js";
import { ContextQuery, contextNotFound } from "./contexts.js";
import { route } from "./route.js";

// ---- schemas ---------------------------------------------------------------------------------------------------

export const JOURNAL_SECTION_NAMES = ["Today", "Decisions", "Open loops", "Runs"] as const;

/** The closed lists of .specs/features/cerebro-natureza, door 1: what a note is, and whose. */
const NATUREZA_VALUES = ["fato", "opiniao", "plano", "hipotese", "relato"] as const;
const ESCOPO_VALUES = ["pessoal", "equipe", "externo"] as const;
/** A query that takes a comma-separated list of one closed list: every item one of its values, none empty. */
const closedList = (values: readonly string[]) => {
  const item = `(?:${values.join("|")})`;
  return z
    .string()
    .regex(new RegExp(`^${item}(?:,${item})*$`), `expected a comma-separated list of ${values.join(", ")}`)
    .optional();
};
const NaturezaQuery = closedList(NATUREZA_VALUES);
const EscopoQuery = closedList(ESCOPO_VALUES);
/** A file's nature and scope as the search and the recall answer them: read through the closed lists, or null. */
const NaturezaSchema = z.enum(NATUREZA_VALUES).nullable();
const EscopoSchema = z.enum(ESCOPO_VALUES).nullable();

const IndexStatsSchema = z.object({
  scanned: z.number(),
  added: z.number(),
  updated: z.number(),
  removed: z.number(),
  skippedExcluded: z.number(),
  skippedBinary: z.number(),
  related: z.number(),
  durationMs: z.number(),
  /** Vectors (re)computed by the pass; present only while the semantic search is on. */
  embedded: z.number().optional(),
});

const FileRowSchema = z.object({
  id: z.number(),
  root: z.string(),
  path: z.string(),
  rel: z.string(),
  name: z.string(),
  ext: z.string(),
  dir: z.string(),
  area: z.string().nullable(),
  size: z.number(),
  mtime: z.number(),
  indexedAt: z.number(),
  title: z.string().nullable(),
  tags: z.array(z.string()),
  /** Dataview-style `key:: value` inline fields (markdown only): the keys are the user's. */
  fields: z.record(z.string()),
});

const SearchHitSchema = FileRowSchema.extend({
  snippet: z.string().nullable(),
  /** `via` `text`: the BM25 of FTS5 (lower is better); otherwise the reciprocal-rank-fusion score (higher is better). */
  score: z.number(),
  /** Which half of the search found the file: the words, the vectors, or both. */
  via: z.enum(["text", "semantic", "both"]),
  /** The file's nature and scope (cerebro-natureza, AC 10): null when it has none, or a value outside the lists. */
  natureza: NaturezaSchema,
  escopo: EscopoSchema,
});

const SemanticStatusSchema = z.object({
  enabled: z.boolean(),
  provider: z.string().nullable(),
  /** Where the cosine is computed; null while the search is off (nothing is loaded then). */
  backend: z.enum(["sqlite-vec", "js"]).nullable(),
  vectors: z.number(),
  /** Why an enabled search has no endpoint it may use. */
  blocked: z.string().nullable(),
  error: z.string().nullable(),
});

/** The version of a note: `sha256:` plus the hex digest of its exact bytes. */
export const NoteVersionSchema = z
  .string()
  .regex(/^sha256:[0-9a-f]{64}$/, "expected sha256: and 64 hex digits");

const NoteWrittenSchema = z.object({
  /** The file as the index names it. */
  path: z.string(),
  name: z.string(),
  version: NoteVersionSchema,
  size: z.number(),
  mtime: z.number(),
});

/**
 * The kinds of a property (.specs/features/cerebro-vista-notas, door 3), fixed by its key: `tags`, `aliases` are `list`;
 * `created`, `updated`, `last_reviewed`, `due` are `date`; `status` is `status`; `natureza`, `escopo` are `select`;
 * `review_every` is `interval`; any other key is `text`.
 */
export const PROPERTY_KINDS = ["text", "list", "date", "status", "select", "interval"] as const;

/** One `key: value` line at the top level of a note's front matter (door 2). */
const PropertySchema = z.object({
  key: z.string(),
  kind: z.enum(PROPERTY_KINDS),
  value: z.union([z.string(), z.array(z.string())]),
});

const NoteReadSchema = NoteWrittenSchema.extend({
  content: z.string(),
  /** False for a file that is not an editable note under `memory/`; `reason` says why. */
  editable: z.boolean(),
  reason: z.string().optional(),
  /** The properties of the front matter, in file order. */
  properties: z.array(PropertySchema),
  /** The lines of the front matter the property reader does not understand, as they are; null when there are none. */
  otherProperties: z.string().nullable(),
  /** Where the body starts: the offset (in characters of `content`) of the first character after the closing `---`. */
  bodyStart: z.number().int().min(0),
});

/** Why an entry of the tree cannot be edited (.specs/features/cerebro-vista-notas, AC 8 and amendment 9). */
export const TREE_REASONS = ["outside_memory", "generated", "not_markdown"] as const;

/** One level of the notes tree (door 1): built from the `files` rows only. */
const MemoryTreeSchema = z.object({
  /** `memory/` then the enabled indexed folders; with a context, its `ok` paths then its notes folder. */
  roots: z.array(
    z.object({
      path: z.string(),
      name: z.string(),
      editable: z.boolean(),
      /** True while an index pass runs (a pass walks every root). */
      indexing: z.boolean(),
    }),
  ),
  /** The root asked for (or the first one); null only when there is no root at all. */
  root: z.string().nullable(),
  /** The folder listed, relative to the root, with `/` (`""` for the root itself). */
  dir: z.string(),
  folders: z.array(
    z.object({
      rel: z.string(),
      name: z.string(),
      /** Indexed files under the folder, at any depth, that today's policy shows. */
      count: z.number().int().min(0),
      editable: z.boolean(),
      reason: z.enum(TREE_REASONS).optional(),
    }),
  ),
  files: z.array(
    z.object({
      id: z.number(),
      rel: z.string(),
      name: z.string(),
      title: z.string().nullable(),
      /** The front matter's `type`, as the index holds it in `fields`. */
      type: z.string().nullable(),
      mtime: z.number(),
      editable: z.boolean(),
      reason: z.enum(TREE_REASONS).optional(),
    }),
  ),
  /** The id of the folder's index note: its `_index.md`, else the first of index.md, README.md, CLAUDE.md, AGENTS.md. */
  indexNote: z.number().nullable(),
  /** More than 1 000 entries: the first 1 000 in the order asked for are listed. */
  truncated: z.boolean(),
  /** How many entries were left out (0 when nothing was). */
  omitted: z.number().int().min(0),
});

const LinkKindSchema = z.enum(["markdown-link", "wikilink"]);

const BacklinkSchema = z.object({
  /** The file that holds the link. */
  file: FileRowSchema,
  kind: LinkKindSchema,
  line: z.number(),
  label: z.string().nullable(),
});

const OutgoingLinkSchema = z.object({
  kind: LinkKindSchema,
  /** Markdown link: the absolute path it names. Wikilink: the name it uses (`folder/name`, lower case, no `.md`). */
  target: z.string(),
  label: z.string().nullable(),
  line: z.number(),
  /** The file the link leads to today; `null` when it leads nowhere (a broken link). */
  resolved: FileRowSchema.nullable(),
  /** Other files a wikilink could have meant; `resolved` is the one the resolution order took. */
  alternatives: z.array(FileRowSchema),
});

const IndexingStatusSchema = z.object({
  state: z.enum(["idle", "running"]),
  /** Where a pass runs: a worker thread, or (no worker script) the service's own thread. */
  mode: z.enum(["worker", "inline"]),
  runId: z.string().nullable(),
  phase: z.enum(["scan", "index", "prune", "related", "vectors"]).nullable(),
  scanned: z.number(),
  total: z.number().nullable(),
  /** A pass of the previous process died; the start of this one takes it up again. */
  interrupted: z.boolean(),
});

const AreaCountSchema = z.object({ area: z.string(), count: z.number() });
const ExtCountSchema = z.object({ ext: z.string(), count: z.number() });
const TagCountSchema = z.object({ tag: z.string(), count: z.number() });

const GraphNodeSchema = z.object({
  id: z.number(),
  name: z.string(),
  rel: z.string(),
  path: z.string(),
  ext: z.string(),
  area: z.string().nullable(),
  dir: z.string(),
  size: z.number(),
  mtime: z.number(),
  title: z.string().nullable(),
  tags: z.array(z.string()),
  fields: z.record(z.string()).optional(),
});

const GraphDataSchema = z.object({
  nodes: z.array(GraphNodeSchema),
  edges: z.array(
    z.object({
      source: z.number(),
      target: z.number(),
      kind: z.enum(["markdown-link", "wikilink", "same-dir", "related"]),
      why: z.string(),
    }),
  ),
  truncated: z.boolean(),
  totalFiles: z.number(),
});

const PreviewResultSchema = z.object({
  kind: z.enum(["text", "binary", "blocked", "too-large"]),
  content: z.string().nullable(),
  truncated: z.boolean(),
  size: z.number(),
  message: z.string().nullable(),
  /** Whether the file is a note the owner can edit (a `.md` under memory/ that is not generated). */
  editable: z.boolean(),
});

const RecallResultSchema = z.object({
  question: z.string(),
  keywords: z.array(z.string()),
  answerContext: z.array(
    z.object({
      path: z.string(),
      section: z.string(),
      excerpt: z.string(),
      score: z.number(),
      why: z.string(),
      via: z.string().optional(),
      /** What the excerpt is (cerebro-natureza, AC 11): its passage's, its file's, its generated section's, or null. */
      natureza: NaturezaSchema,
      /** The file's scope, or null. */
      escopo: EscopoSchema,
    }),
  ),
  tokensEstimate: z.number(),
  candidatesConsidered: z.number(),
  opened: z.number(),
  candidates: z.array(z.object({ path: z.string(), score: z.number(), why: z.string() })),
  durationMs: z.number(),
});

const RecallStatsSchema = z.object({
  totalRecalls: z.number(),
  totalTokens: z.number(),
  paths: z.array(z.object({ path: z.string(), count: z.number(), lastAt: z.number() })),
  lastAt: z.number().nullable(),
});

const JournalSectionsSchema = z.array(z.object({ name: z.string(), lines: z.array(z.string()) }));

const JournalDaySchema = z.object({
  date: z.string(),
  path: z.string(),
  content: z.string(),
  /** True when the file was created by this call. */
  created: z.boolean(),
});

const HygieneKind = z.enum([
  "orphan",
  "dangling-link",
  "stale",
  "skill-never-run",
  "silent-routine",
  "unused-connector",
]);

const HygieneReportSchema = z.object({
  generatedAt: z.number(),
  counts: z.object({
    orphan: z.number(),
    "dangling-link": z.number(),
    stale: z.number(),
    "skill-never-run": z.number(),
    "silent-routine": z.number(),
    "unused-connector": z.number(),
  }),
  items: z.array(
    z.object({
      kind: HygieneKind,
      id: z.string(),
      name: z.string(),
      detail: z.string(),
      action: z.enum(["open", "disconnect", "archive", "link"]),
    }),
  ),
  thresholds: z.object({
    staleDays: z.number(),
    silentRoutineDays: z.number(),
    unusedConnectorDays: z.number(),
  }),
});

export const FactSchema = z.object({
  id: z.number(),
  subject: z.string(),
  predicate: z.string(),
  object: z.string(),
  validFrom: z.number(),
  validTo: z.number().nullable(),
  sourceRunId: z.string().nullable(),
  sourcePath: z.string().nullable(),
  createdAt: z.number(),
});

/** A real calendar day as `YYYY-MM-DD`: `2026-02-30` is not one. */
export function isJournalDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [y, m, d] = value.split("-").map(Number) as [number, number, number];
  const date = new Date(y, m - 1, d);
  return date.getFullYear() === y && date.getMonth() === m - 1 && date.getDate() === d;
}

const journalDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "expected YYYY-MM-DD")
  .refine(isJournalDate, { message: "expected YYYY-MM-DD" });

const memoryScopeNote = "A run's own credential recalls from the memory folder only";
/** What `context` does to a read (.specs/features/cerebro-contextos, S2). */
const contextNote =
  "context=<id> limits it to the files of that work context, context=all (or none) is the whole index";

/**
 * A folder of the map (.specs/features/cerebro-organizar, doors 4 and 8): what the index knows of its direct children
 * and the state of its index note.
 */
const FolderMapSchema = z.object({
  /** The folder, absolute. */
  path: z.string(),
  /** Relative to its root, with `/` (`""` for an indexed root itself, `notes/<…>` under memory/). */
  rel: z.string(),
  /** Direct children the index knows, without `_index.md` and names starting with `.`. */
  children: z.number().int().min(0),
  /** `sha256:` of the sorted, newline-joined `d:<folder>` / `f:<file>` list of those children. */
  digest: NoteVersionSchema,
  /** The index note (`_index.md`), or null when there is none. */
  index: z.string().nullable(),
  /** The note's front matter `children-digest`, or null. */
  indexDigest: z.string().nullable(),
  /** `missing`: no index note; `fresh`: its `children-digest` is `digest`; `stale`: another one, or none. */
  state: z.enum(["missing", "stale", "fresh"]),
  /** Where the index note is or will be: inside the folder under memory/notes/, under memory/maps/<root slug>/ else. */
  indexPath: z.string(),
});

/** `memory`, or an absolute path (POSIX, or a Windows drive or share). */
const MapsRootQuery = z
  .string()
  .min(1)
  .max(4096)
  .refine((v) => v === "memory" || /^(\/|[A-Za-z]:[\\/]|\\\\)/.test(v), {
    message: "root: memory, or an absolute path",
  });

/**
 * The guided cleanup (.specs/features/cerebro-faxina-guiada): what a scope holds, from the index rows alone, and what a
 * scan of it found. A scope is a work context (`context=<id>`) or a folder (`dir=<absolute path>`), never both and never
 * the whole index.
 */
export const CLEANUP_KIND_GROUPS = ["notes", "text", "pdf", "image", "code", "other"] as const;
/** The kinds of a finding, in the order the scan lists them (plan.md, Impact). */
export const CLEANUP_FINDING_KINDS = [
  "duplicate",
  "near-duplicate",
  "stale",
  "orphan",
  "broken-link",
  "empty-folder",
  "large-file",
  "untitled",
] as const;
/** What the owner may decide about a finding (door 3). */
export const CLEANUP_DECISIONS = ["keep", "archive", "merge", "snooze", "unsure"] as const;
export const CLEANUP_SCAN_STATES = ["running", "finished", "failed"] as const;
/** The phases of a scan, in order (door 6; the payload of `cleanup.progress` in `eventSchemas.ts` says the same). */
export const CLEANUP_PHASES = ["inventory", "signatures", "links", "findings"] as const;

/** `dir`: an absolute folder (POSIX, or a Windows drive or share). */
const CleanupDirField = z.string().min(1).max(4096).refine(isAbsolutePath, "dir: an absolute path");

const CleanupScopeSchema = z.union([
  z.object({ kind: z.literal("context"), id: z.string() }),
  z.object({ kind: z.literal("dir"), path: z.string() }),
]);

const countBytes = { count: z.number().int().min(0), bytes: z.number().int().min(0) };

const CleanupInventorySchema = z.object({
  scope: CleanupScopeSchema,
  /** The scope's indexed files that today's policy shows, and their bytes. */
  total: z.object(countBytes),
  /** Six groups by extension, always in the order of `CLEANUP_KIND_GROUPS`. */
  byKind: z.array(z.object({ kind: z.enum(CLEANUP_KIND_GROUPS), ...countBytes })),
  /** Up to 100 KiB, up to 1 MiB, up to `memory.cleanup.largeBytes`, and larger (`upTo` null). */
  bySize: z.array(z.object({ upTo: z.number().int().nullable(), ...countBytes })),
  /** Whole days since `mtime`: 0-30, 31-90, 91-365, and more than 365 (`to` null). */
  byAge: z.array(
    z.object({ from: z.number().int(), to: z.number().int().nullable(), count: z.number().int().min(0) }),
  ),
  /** The 10 folders below the scope's roots with the most bytes (their files' at any depth), most first. */
  topFolders: z.array(z.object({ path: z.string(), ...countBytes })),
  /**
   * Up to 12 groups, the largest first: one per first-level subfolder when the files lie under two or more, else the
   * connected components of the related-by-content edges scored 0.3 or more. `terms` are the top 3 shared terms.
   */
  clusters: z.array(
    z.object({
      kind: z.enum(["folder", "related"]),
      name: z.string(),
      /** The subfolder, for a `folder` group. */
      path: z.string().nullable(),
      count: z.number().int().min(0),
      terms: z.array(z.string()),
    }),
  ),
  /** The most recent `mtime` (ms) of the rows `total` counts, null when there are none ("última mudança há D dias"). */
  newest: z.number().nullable(),
});

const CleanupFindingSchema = z.object({
  /** `<kind>:` and the SHA-256 of the members' paths and hashes, sorted (door 3): a member that changes, changes it. */
  key: z.string(),
  kind: z.enum(CLEANUP_FINDING_KINDS),
  /** The files the finding is about (none for an `empty-folder`, whose folder is in `detail`). */
  files: z.array(
    z.object({
      id: z.number().int(),
      path: z.string(),
      size: z.number().int().min(0),
      mtime: z.number(),
      /** The bytes as the scan saw them. */
      sha256: z.string(),
    }),
  ),
  /** What the finding is, by kind: the estimate, the age, the date, the link, the folder, the size. */
  detail: z.object({
    /** `near-duplicate`: the estimated Jaccard similarity of the two texts' 5-word shingles. */
    similarity: z.number().optional(),
    /** `stale`: whole days since `mtime` or since `lastReviewed`, as `since` says. */
    ageDays: z.number().int().optional(),
    since: z.enum(["mtime", "last_reviewed"]).optional(),
    lastReviewed: z.string().optional(),
    /** `broken-link`: the target as the note writes it, the line, and the kind of link. */
    target: z.string().optional(),
    line: z.number().int().optional(),
    linkKind: z.enum(["markdown-link", "wikilink"]).optional(),
    /** `empty-folder`: the folder. */
    folder: z.string().optional(),
    /** `large-file`: its bytes and the bound it passed. */
    bytes: z.number().int().optional(),
    limit: z.number().int().optional(),
  }),
  suggested: z.enum(CLEANUP_DECISIONS),
});

const CleanupScanSchema = z.object({
  scanId: z.string(),
  scope: CleanupScopeSchema,
  status: z.enum(CLEANUP_SCAN_STATES),
  /** The phase the scan is in (the last one it reached, once it ended). */
  phase: z.enum(CLEANUP_PHASES),
  /** Why a `failed` scan stopped; null otherwise. */
  code: z.string().nullable(),
  startedAt: z.number(),
  finishedAt: z.number().nullable(),
  /** The findings once the scan finished (none while it runs or after it failed). */
  findings: z.array(CleanupFindingSchema),
  /** How many findings a stored decision hid. */
  decided: z.number().int().min(0),
});

/** Why an apply or an undo left a file where it was (AC 28, AC 29, AC 32). */
const CLEANUP_SKIP_REASONS = ["changed", "missing", "exists", "forbidden_path"] as const;
const CleanupSkippedSchema = z.array(z.object({ path: z.string(), reason: z.enum(CLEANUP_SKIP_REASONS) }));
const CleanupMovesSchema = z.array(z.object({ from: z.string(), to: z.string() }));

const CleanupDecisionsBody = z.object({
  scanId: z.string().min(1).max(64),
  decisions: z
    .array(
      z.object({
        /** A finding's key, as the scan reported it. */
        key: z.string().min(1).max(200),
        decision: z.enum(CLEANUP_DECISIONS),
        /** `merge`: the member that stays. */
        keepFileId: z.number().int().optional(),
        /** `snooze`: until when, in milliseconds since the epoch (later than now). */
        until: z.number().int().optional(),
      }),
    )
    .min(1)
    .max(5000),
});

const cleanupScanStale = err(409, "scan_stale", "A newer scan of the same scope replaced this one");
const cleanupRestoreInProgress = err(
  409,
  "restore_in_progress",
  "A restore holds the home; try again when it has finished",
);

const cleanupScopeRequired = err(
  400,
  "scope_required",
  "Neither context nor dir names a scope (context=all is the whole index), or dir is not a folder inside an enabled indexed folder or memory/",
);

// ---- routes ----------------------------------------------------------------------------------------------------

export const memoryRoutes = {
  "memory.status": route({
    method: "GET",
    path: "/api/memory/status",
    summary: `The last index run and the facets of the index (areas, extensions, tags); ${contextNote}`,
    tag: "memory",
    scope: "monitor",
    query: z.object({ context: ContextQuery }),
    responses: {
      200: z.object({
        lastIndex: z.object({ at: z.number(), stats: IndexStatsSchema }).nullable(),
        facets: z.object({
          areas: z.array(AreaCountSchema),
          exts: z.array(ExtCountSchema),
          tags: z.array(TagCountSchema),
          total: z.number(),
        }),
        indexing: IndexingStatusSchema,
        semantic: SemanticStatusSchema,
      }),
    },
    errors: [contextNotFound],
  }),
  "memory.index": route({
    method: "POST",
    path: "/api/memory/index",
    summary: "Index every granted folder (chunked; progress arrives as index.* events)",
    tag: "memory",
    scope: "owner",
    responses: { 200: z.object({ stats: IndexStatsSchema }) },
    errors: [
      err(
        409,
        "index_scan_incomplete",
        "The scan could not read a folder it needs; the previous index is kept",
      ),
      err(
        409,
        "index_cancelled",
        "The pass was cancelled (POST /api/memory/index/cancel); what it had committed stays",
      ),
      err(409, "restore_in_progress", "A restore holds the home; no pass starts until it has finished"),
      err(
        503,
        "index_worker_crashed",
        "The index worker died or broke the protocol; the previous index is kept",
      ),
      err(
        503,
        "index_worker_out_of_memory",
        "The index worker ran past its memory limit; the previous index is kept",
      ),
    ],
  }),
  "memory.index.cancel": route({
    method: "POST",
    path: "/api/memory/index/cancel",
    summary: "Stop the index pass that runs, at its next block; what it had committed stays",
    tag: "memory",
    scope: "owner",
    responses: { 200: z.object({ cancelled: z.boolean(), runId: z.string().nullable() }) },
  }),
  "memory.search": route({
    method: "GET",
    path: "/api/memory/search",
    summary: `Full-text search over the index; with the semantic search on, the words and the vectors fused (mode auto, text or semantic); ${contextNote}`,
    tag: "memory",
    scope: "content",
    query: z.object({
      q: z.string().default(""),
      mode: z.enum(["auto", "text", "semantic"]).optional(),
      area: z.string().optional(),
      ext: z.string().optional(),
      dir: z.string().optional(),
      tag: z.string().optional(),
      modifiedAfter: z.coerce.number().optional(),
      limit: z.coerce.number().int().min(1).max(200).optional(),
      context: ContextQuery,
      /** Only files of these natures / scopes, comma-separated (cerebro-natureza, AC 8 and 9). */
      natureza: NaturezaQuery,
      escopo: EscopoQuery,
    }),
    responses: { 200: z.array(SearchHitSchema) },
    errors: [
      contextNotFound,
      err(
        409,
        "semantic_disabled",
        "mode=semantic while memory.embeddings is off or has no endpoint it may use",
      ),
    ],
  }),
  "memory.graph": route({
    method: "GET",
    path: "/api/memory/graph",
    summary: `Files and their links for the visual second brain; ${contextNote}`,
    tag: "memory",
    scope: "content",
    query: z.object({
      area: z.string().optional(),
      dir: z.string().optional(),
      q: z.string().optional(),
      maxNodes: z.coerce.number().int().min(10).max(4000).optional(),
      related: QueryFlag,
      context: ContextQuery,
    }),
    responses: { 200: GraphDataSchema },
    errors: [contextNotFound],
  }),
  "memory.related": route({
    method: "GET",
    path: "/api/memory/related",
    summary: `The files linked to one indexed file, and why; ${contextNote}`,
    tag: "memory",
    scope: "content",
    query: z.object({ id: z.coerce.number().int(), context: ContextQuery }),
    responses: { 200: z.array(z.object({ file: FileRowSchema, why: z.string() })) },
    errors: [notFound("The file, or the file in the work context"), contextNotFound],
  }),
  "memory.links": route({
    method: "GET",
    path: "/api/memory/links",
    summary: "Who points at an indexed file (backlinks) and where its own links lead, broken ones included",
    tag: "memory",
    scope: "content",
    query: z.object({ id: z.coerce.number().int() }),
    responses: {
      200: z.object({
        file: FileRowSchema,
        backlinks: z.array(BacklinkSchema),
        outgoing: z.array(OutgoingLinkSchema),
      }),
    },
    errors: [notFound("The file")],
  }),
  "memory.preview": route({
    method: "GET",
    path: "/api/memory/preview",
    summary: "A text preview of a file inside the granted folders",
    tag: "memory",
    scope: "content",
    query: z.object({ p: z.string() }),
    responses: { 200: PreviewResultSchema },
    errors: [
      err(
        404,
        "source_missing",
        "The source was moved or removed: refresh the index and select an existing file",
      ),
    ],
  }),
  "memory.open": route({
    method: "POST",
    path: "/api/memory/open",
    summary: "Open a document or folder with the operating system's default application",
    tag: "memory",
    scope: "owner",
    body: z.object({ p: z.string() }),
    responses: { 200: z.object({ opened: z.string() }) },
    errors: [
      err(
        415,
        "unsupported_type",
        "Only documents, media and folders open from here; an executable or an app bundle is refused",
      ),
    ],
  }),
  "memory.note": route({
    method: "GET",
    path: "/api/memory/note",
    summary: "A note's whole text and its version, for editing; `editable` says whether it can be saved",
    tag: "memory",
    scope: "content",
    query: z.object({ p: z.string().min(1) }),
    responses: { 200: NoteReadSchema },
    errors: [
      err(
        403,
        "forbidden_path",
        "The path is outside the granted folders or inside the home's config/ or logs/",
      ),
      err(404, "not_a_file", "The path names something that is not a regular file"),
      err(404, "note_missing", "The file does not exist"),
      err(
        413,
        "note_too_large",
        "The note is larger than the editing limit; the preview still shows its start",
      ),
    ],
  }),
  "memory.notes.create": route({
    method: "POST",
    path: "/api/memory/notes",
    summary:
      "Create a Markdown note under memory/notes (an area gives it a folder); a name that exists gets -2, -3…",
    tag: "memory",
    scope: "owner",
    body: z.object({
      title: z.string().min(1).max(600),
      area: z.string().min(1).max(200).optional(),
      /** A folder under memory/notes (up to 4 levels, each made a name as a note's title is); made when missing. */
      folder: z.string().min(1).max(1000).optional(),
      content: z.string().max(2_000_000).optional(),
      frontMatter: z.boolean().optional(),
      tags: z.array(z.string().max(100)).max(100).optional(),
    }),
    responses: { 201: NoteWrittenSchema },
    errors: [
      err(400, "unknown_area", "The area is not one of the areas in the settings"),
      err(403, "forbidden_path", "A link on the way or a private file would be written through"),
      err(409, "note_exists", "Ninety-nine notes already have this name"),
      err(
        409,
        "structure_fixed",
        "memory.notes.fixedStructure is on and the note would make a folder or go straight into memory/notes/",
      ),
      err(413, "note_too_large", "The note is larger than the editing limit"),
    ],
  }),
  "memory.notes.properties": route({
    method: "PUT",
    path: "/api/memory/notes/properties",
    summary:
      "Change, add or remove properties of a note's front matter, only if it is still the version the caller read (baseVersion); every other byte is kept",
    tag: "memory",
    scope: "owner",
    body: z.object({
      path: z.string().min(1),
      baseVersion: NoteVersionSchema,
      set: z.record(z.union([z.string().max(4000), z.array(z.string().max(4000)).max(1000)])).optional(),
      remove: z.array(z.string().max(200)).max(1000).optional(),
    }),
    responses: { 200: NoteWrittenSchema.extend({ properties: z.array(PropertySchema) }) },
    errors: [
      err(403, "forbidden_path", "A link on the way or a private file would be written through"),
      err(
        403,
        "note_not_editable",
        "Not a .md file under memory/, or a file the engine generates (ROUTER.md, areas/, journal/, contexts/)",
      ),
      err(404, "not_a_file", "The path names something that is not a regular file"),
      err(404, "note_missing", "The note does not exist"),
      err(409, "edit_conflict", "The file changed after it was read; nothing was written"),
      err(
        409,
        "front_matter_unreadable",
        "The front matter is longer than 4 096 bytes or has no closing ---; nothing was written",
      ),
      err(413, "note_too_large", "The note is larger than the editing limit"),
    ],
  }),
  "memory.notes.save": route({
    method: "PUT",
    path: "/api/memory/notes",
    summary: "Replace a note, only if it is still the version the caller read (baseVersion)",
    tag: "memory",
    scope: "owner",
    body: z.object({
      path: z.string().min(1),
      content: z.string().max(2_000_000),
      baseVersion: NoteVersionSchema,
    }),
    responses: { 200: NoteWrittenSchema },
    errors: [
      err(403, "forbidden_path", "A link on the way or a private file would be written through"),
      err(
        403,
        "note_not_editable",
        "Not a .md file under memory/, or a file the engine generates (ROUTER.md, areas/, journal/)",
      ),
      err(404, "note_missing", "The note does not exist any more; it is not created"),
      err(409, "edit_conflict", "The file changed after it was read; nothing was written"),
      err(413, "note_too_large", "The note is larger than the editing limit"),
    ],
  }),
  "memory.maps": route({
    method: "GET",
    path: "/api/memory/maps",
    summary:
      "The folders of the indexed roots and of memory/notes/ with the digest of their children and the state of their index note (missing, stale, fresh); a run's own credential sees only memory/notes/ and the folders the run was handed",
    tag: "memory",
    scope: "content",
    query: z.object({ root: MapsRootQuery.optional() }),
    responses: { 200: z.object({ folders: z.array(FolderMapSchema) }) },
    errors: [notFound("The indexed root (or, for a run's credential, a folder the run was handed)")],
  }),
  "memory.tree": route({
    method: "GET",
    path: "/api/memory/tree",
    summary: `One level of the notes tree, from the index rows only (no file is opened): the roots, the subfolders with their count, the files, and the folder's index note; ${contextNote}`,
    tag: "memory",
    scope: "content",
    query: z.object({
      context: ContextQuery,
      /** A root, absolute: memory/, an enabled indexed folder, or (with a context) one of its roots. */
      root: z.string().min(1).max(4096).optional(),
      /** The folder, relative to the root (`""`, the default, is the root). */
      dir: z.string().max(4096).optional(),
      sort: z.enum(["name", "updated"]).optional(),
    }),
    responses: { 200: MemoryTreeSchema },
    errors: [
      err(400, "unknown_root", "The root is not memory/, an enabled indexed folder or a root of the context"),
      notFound("An indexed row under the folder (dir)"),
      contextNotFound,
    ],
  }),
  "memory.cleanup.inventory": route({
    method: "GET",
    path: "/api/memory/cleanup/inventory",
    summary:
      "What a work context or a folder holds, from the index rows only (no file is opened): totals, kinds, sizes, ages, the largest folders and the groups",
    tag: "memory",
    scope: "content",
    query: z.object({ context: ContextQuery, dir: CleanupDirField.optional() }),
    responses: { 200: CleanupInventorySchema },
    errors: [cleanupScopeRequired, contextNotFound],
  }),
  "memory.cleanup.scans.start": route({
    method: "POST",
    path: "/api/memory/cleanup/scans",
    summary:
      "Start a scan of a work context or a folder for what asks a decision (duplicates, near-duplicates, stale, orphans, broken links, empty folders, large files, untitled notes); progress arrives as cleanup.* events",
    tag: "memory",
    scope: "owner",
    body: z.object({ context: z.string().min(1).max(64).optional(), dir: CleanupDirField.optional() }),
    responses: { 202: z.object({ scanId: z.string() }) },
    errors: [
      cleanupScopeRequired,
      contextNotFound,
      err(409, "scan_running", "A scan of the same scope is running; the message names its scanId"),
      err(409, "restore_in_progress", "A restore holds the home; no scan starts until it has finished"),
    ],
  }),
  "memory.cleanup.scans.get": route({
    method: "GET",
    path: "/api/memory/cleanup/scans/:id",
    summary: "A cleanup scan: running with its phase, finished with its findings, or failed with its code",
    tag: "memory",
    scope: "content",
    params: IdParams,
    responses: { 200: CleanupScanSchema },
    errors: [notFound("The scan")],
  }),
  "memory.cleanup.decisions": route({
    method: "PUT",
    path: "/api/memory/cleanup/decisions",
    summary:
      "Store the owner's answers to findings of a scan (keep, archive, merge, snooze, unsure), one per finding of the scope; all or none",
    tag: "memory",
    scope: "owner",
    body: CleanupDecisionsBody,
    responses: { 200: z.object({ saved: z.number().int().min(0) }) },
    errors: [notFound("The scan"), cleanupScanStale],
  }),
  "memory.cleanup.apply": route({
    method: "POST",
    path: "/api/memory/cleanup/apply",
    summary:
      "Apply the decisions on a finished scan: move what is under memory/ to memory/archive/AAAA-MM-DD-<id>/ with a manifest, and list what lies outside memory/ as proposals",
    tag: "memory",
    scope: "owner",
    body: z.object({ scanId: z.string().min(1).max(64) }),
    responses: {
      200: z.object({
        /** The manifest of the moves; null when nothing moved. */
        manifest: z.string().nullable(),
        moved: CleanupMovesSchema,
        skipped: CleanupSkippedSchema,
        /** The proposal list under artifacts/cleanup/; null when there is none. */
        proposals: z.string().nullable(),
      }),
    },
    errors: [
      notFound("The scan"),
      err(409, "scan_running", "The scan has not finished; the message names it"),
      cleanupScanStale,
      cleanupRestoreInProgress,
    ],
  }),
  "memory.cleanup.undo": route({
    method: "POST",
    path: "/api/memory/cleanup/undo",
    summary:
      "Move back what an apply archived, by its manifest: each file still as it was left and whose origin is free",
    tag: "memory",
    scope: "owner",
    body: z.object({
      manifest: z.string().min(1).max(4096).refine(isAbsolutePath, "manifest: an absolute path"),
    }),
    responses: { 200: z.object({ restored: CleanupMovesSchema, skipped: CleanupSkippedSchema }) },
    errors: [
      notFound("The manifest"),
      err(
        409,
        "undo_conflict",
        "The manifest is not one this version can undo (its v is not 1, or it names a path outside its archive)",
      ),
      cleanupRestoreInProgress,
    ],
  }),
  "memory.routers": route({
    method: "POST",
    path: "/api/memory/routers",
    summary: "Regenerate the router files of the second brain",
    tag: "memory",
    scope: "owner",
    responses: { 200: z.object({ written: z.array(z.string()) }) },
  }),
  "memory.routers.check": route({
    method: "GET",
    path: "/api/memory/routers/check",
    summary: "Problems found in the router files (missing master, dangling links, staleness)",
    tag: "memory",
    scope: "content",
    responses: { 200: z.array(z.object({ file: z.string(), problem: z.string() })) },
  }),
  "memory.recall": route({
    method: "GET",
    path: "/api/memory/recall",
    summary: `Layered recall: keywords, index, top files, sections, pointers. ${memoryScopeNote}; ${contextNote}`,
    tag: "memory",
    scope: "content",
    query: z.object({
      q: z.string().min(1).max(2000),
      k: z.coerce.number().int().min(1).max(10).optional(),
      area: z.string().optional(),
      excerptChars: z.coerce.number().int().min(200).max(20_000).optional(),
      /** Skip the frequency bookkeeping (dry runs, UI previews). */
      record: QueryFlag,
      context: ContextQuery,
      /** Only excerpts of these natures (one with none is not returned) / of files of these scopes (AC 12). */
      natureza: NaturezaQuery,
      escopo: EscopoQuery,
    }),
    responses: { 200: RecallResultSchema },
    errors: [contextNotFound],
  }),
  "memory.recall.stats": route({
    method: "GET",
    path: "/api/memory/recall/stats",
    summary: "How often each path was recalled",
    tag: "memory",
    scope: "content",
    query: z.object({ limit: z.coerce.number().int().min(1).max(500).optional() }),
    responses: { 200: RecallStatsSchema },
  }),
  "memory.journal": route({
    method: "GET",
    path: "/api/memory/journal",
    summary: "A day's journal (created from the template on first access), or the last N days with days=",
    tag: "memory",
    scope: "content",
    query: z.object({
      date: journalDate.optional(),
      days: z.coerce.number().int().min(1).max(90).optional(),
    }),
    responses: {
      200: z.union([
        JournalDaySchema.extend({ sections: JournalSectionsSchema, dates: z.array(z.string()) }),
        z.object({
          today: z.string(),
          days: z.array(JournalDaySchema.extend({ sections: JournalSectionsSchema })),
        }),
      ]),
    },
  }),
  "memory.journal.append": route({
    method: "POST",
    path: "/api/memory/journal/append",
    summary: "Add a line under a section of a day's journal",
    tag: "memory",
    scope: "owner",
    body: z.object({
      text: z.string().min(1).max(4000),
      section: z.enum(JOURNAL_SECTION_NAMES).optional(),
      date: journalDate.optional(),
      timestamp: z.boolean().optional(),
    }),
    responses: { 200: JournalDaySchema.extend({ sections: JournalSectionsSchema }) },
  }),
  "memory.hygiene": route({
    method: "GET",
    path: "/api/memory/hygiene",
    summary: "Orphans, dangling links, stale files, skills never run, silent routines and unused connectors",
    tag: "memory",
    scope: "content",
    query: z.object({
      staleDays: z.coerce.number().int().min(1).max(3650).optional(),
      silentRoutineDays: z.coerce.number().int().min(1).max(3650).optional(),
      unusedConnectorDays: z.coerce.number().int().min(1).max(3650).optional(),
      perKind: z.coerce.number().int().min(1).max(500).optional(),
    }),
    responses: { 200: HygieneReportSchema },
  }),
  "memory.facts.list": route({
    method: "GET",
    path: "/api/memory/facts",
    summary:
      "Bi-temporal facts: currently valid by default, asOf for a point in time, includeExpired for history",
    tag: "memory",
    scope: "content",
    query: z.object({
      subject: z.string().max(2000).optional(),
      predicate: z.string().max(2000).optional(),
      asOf: z.coerce.number().int().optional(),
      includeExpired: QueryFlag,
      limit: z.coerce.number().int().min(1).max(2000).optional(),
    }),
    responses: {
      200: z.object({
        facts: z.array(FactSchema),
        stats: z.object({ open: z.number(), expired: z.number(), subjects: z.number() }),
      }),
    },
  }),
  "memory.facts.assert": route({
    method: "POST",
    path: "/api/memory/facts",
    summary: "Assert a fact (201 when new, 200 when an identical open fact already existed)",
    tag: "memory",
    scope: "owner",
    body: z.object({
      subject: z.string().min(1).max(2000),
      predicate: z.string().min(1).max(2000),
      object: z.string().min(1).max(2000),
      validFrom: z.number().int().optional(),
      sourceRunId: z.string().max(200).nullable().optional(),
      sourcePath: z.string().max(4096).nullable().optional(),
    }),
    responses: {
      200: z.object({ fact: FactSchema, invalidated: z.array(FactSchema), unchanged: z.boolean() }),
      201: z.object({ fact: FactSchema, invalidated: z.array(FactSchema), unchanged: z.boolean() }),
    },
  }),
  "memory.facts.retract": route({
    method: "POST",
    path: "/api/memory/facts/:id/retract",
    summary: "Close a fact at this instant",
    tag: "memory",
    scope: "owner",
    params: z.object({ id: z.coerce.number().int().positive() }),
    responses: { 200: FactSchema },
    errors: [notFound("The fact")],
  }),
  "memory.query": route({
    method: "GET",
    path: "/api/memory/query",
    summary: "Dataview-style query over inline `key:: value` fields: where=key, key:value or key:~substring",
    tag: "memory",
    scope: "content",
    query: z.object({
      where: z.string().min(1).max(500),
      limit: z.coerce.number().int().min(1).max(1000).optional(),
    }),
    responses: { 200: z.object({ where: z.string(), files: z.array(FileRowSchema) }) },
  }),
} as const;
