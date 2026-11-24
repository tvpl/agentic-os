/**
 * `mordomo mcp` (plan Onda 3 §4): MordomoOS as an MCP server for the CLIs it
 * orchestrates. A Claude, Cursor or Codex session can recall the memory,
 * list and run skills, append to today's journal, query facts and read the
 * inbox — through the local HTTP API with the local token and `x-mordomo-as:
 * mcp` (cerebro-perguntar, door 5): the server reads as agents read, hiding the
 * folders hidden from agents, and lets the tools call only their routes.
 *
 * What a session writes to the memory waits for the owner
 * (.specs/features/cerebro-memoria-confiavel, door 9): `facts_assert`,
 * `note_create` and `note_save` store a proposal in the review inbox, and a
 * journal line says an agent wrote it. The mark is provenance, not
 * containment: this process holds the owner's token.
 */
import { entityNorm } from "@mordomo/core/internal";
import { serveMcpStdio, type McpTool } from "./stdio.js";

export interface McpApi {
  get<T>(path: string): Promise<T>;
  post<T>(path: string, body: unknown): Promise<T>;
  put<T>(path: string, body: unknown): Promise<T>;
}

/**
 * The name of the program on the other end of the MCP (cerebro-perguntar, door 5): the `clientInfo.name` of its
 * `initialize`, lower-cased, when it is 1 to 40 of `a-z`, `0-9`, `.`, `_` and `-`; `desconhecido` otherwise.
 */
export function mcpClientName(clientInfo: unknown): string {
  const name =
    clientInfo !== null && typeof clientInfo === "object"
      ? (clientInfo as { name?: unknown }).name
      : undefined;
  if (typeof name !== "string") return "desconhecido";
  const lower = name.toLowerCase();
  return /^[a-z0-9._-]{1,40}$/.test(lower) ? lower : "desconhecido";
}

/**
 * The API as the tools call it: the owner's token, `x-mordomo-as: mcp` and the client's name on every call, so the
 * server reads as agents read and lets the tools call only their routes (door 5). `client` is read on each call: the
 * name is known once the client has sent `initialize`. A refused call throws with its `status`.
 */
export function httpApi(baseUrl: string, token: string, client: () => string = () => "desconhecido"): McpApi {
  const call = async <T>(method: string, path: string, body?: unknown): Promise<T> => {
    const res = await fetch(`${baseUrl}${path}`, {
      method,
      headers: {
        "content-type": "application/json",
        "x-mordomo-token": token,
        "x-mordomo-as": "mcp",
        "x-mordomo-client": client(),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    if (!res.ok)
      throw Object.assign(new Error(`${method} ${path} → ${res.status}: ${text.slice(0, 300)}`), {
        status: res.status,
      });
    return (text ? JSON.parse(text) : {}) as T;
  };
  return { get: (p) => call("GET", p), post: (p, b) => call("POST", p, b), put: (p, b) => call("PUT", p, b) };
}

/** What every tool that proposes answers (AC 48). */
const waiting = (id: string) => `Proposal ${id} is waiting for review in the MordomoOS inbox.`;

const propose = async (api: McpApi, body: Record<string, unknown>): Promise<string> => {
  const r = await api.post<{ proposal: { id: string } }>("/api/v1/memory/proposals", body);
  return waiting(r.proposal.id);
};

const str = (v: unknown, name: string): string => {
  if (typeof v !== "string" || !v.trim()) throw new Error(`${name} is required`);
  return v.trim();
};

/** An optional text argument: absent (or empty) is undefined, anything else must be text. */
const optional = (v: unknown, name: string): string | undefined => {
  if (v === undefined || v === null || v === "") return undefined;
  if (typeof v !== "string") throw new Error(`${name} must be a string`);
  return v.trim() || undefined;
};

/** A whole number argument held between 1 and `max`, `fallback` when it is no number (door 4). */
const clamp = (v: unknown, max: number, fallback: number): number =>
  typeof v === "number" && Number.isFinite(v) ? Math.max(1, Math.min(max, Math.round(v))) : fallback;

/** What the recall's tool and `mordomo recall` say when the recall abstains (AC 52). */
export const abstentionText = (reason: string): string =>
  `Nothing found: no indexed section answers this (${reason}).`;

/**
 * What each tool does to the memory (cerebro-perguntar, door 7, `GET /api/mcp`): it reads as an agent, it proposes (the
 * owner decides in the review inbox, or the line is marked as an agent's), or it is the owner's by its nature.
 */
export const MCP_TOOL_KINDS: Readonly<Record<string, "read" | "propose" | "owner">> = {
  recall: "read",
  skills_list: "read",
  skills_run: "owner",
  journal_append: "propose",
  facts_assert: "propose",
  facts_query: "read",
  note_create: "propose",
  note_read: "read",
  note_save: "propose",
  inbox_unread: "owner",
  search: "read",
  links: "read",
  hygiene: "read",
  entities: "read",
  entity: "read",
  summary: "read",
};

/** An entity as `GET /api/memory/entities` lists it (cerebro-entidades-resumos, door 4). */
interface EntityLine {
  key: string;
  kind: string;
  name: string;
  aliases: string[];
  files: number;
}

/** At most this many mentions in the answer of the tool `entity` (door 7). */
const ENTITY_TOOL_MENTIONS = 20;

/** A summary as `GET /api/memory/summaries/:kind/:id` answers it (cerebro-entidades-resumos, door 6). */
interface SummaryRead {
  scope: { name: string };
  state: "missing" | "fresh" | "stale";
  generatedAt?: number;
  changes?: { changed: number; removed: number; added: number };
  paragraphs?: Array<{ text: string; citations: Array<{ path: string; section: string }> }>;
}

/** A day as the tool `summary` says it, `DD/MM/AAAA` in the local zone. */
const localDay = (ms: number): string => {
  const d = new Date(ms);
  return `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()}`;
};

/** The first line of the tool `summary` (door 7): the state and, for a current summary, its day or what changed. */
function summaryStateLine(s: SummaryRead): string {
  if (s.state === "missing" || s.generatedAt === undefined) return `Ainda não há resumo de ${s.scope.name}.`;
  if (s.state === "fresh") return `Resumo atual de ${localDay(s.generatedAt)}.`;
  const { changed, removed, added } = s.changes ?? { changed: 0, removed: 0, added: 0 };
  return [
    `Resumo velho: ${changed === 1 ? "1 fonte mudou" : `${changed} fontes mudaram`}`,
    removed === 1 ? "1 saiu" : `${removed} saíram`,
    `${added === 1 ? "1 arquivo novo" : `${added} arquivos novos`}.`,
  ].join(", ");
}

export function mordomoTools(api: McpApi): McpTool[] {
  return [
    {
      name: "recall",
      description:
        "Layered memory retrieval: the sections of the indexed workspace worth reading for a question. context: a work context id to recall only its files (all, or none, for the whole index).",
      inputSchema: {
        type: "object",
        properties: { question: { type: "string" }, k: { type: "number" }, context: { type: "string" } },
        required: ["question"],
      },
      handler: async (a) => {
        const q = encodeURIComponent(str(a.question, "question"));
        const k = typeof a.k === "number" ? `&k=${Math.max(1, Math.min(10, Math.round(a.k)))}` : "";
        const context = optional(a.context, "context");
        const c = context !== undefined ? `&context=${encodeURIComponent(context)}` : "";
        const r = await api.get<{
          answerContext: Array<{ path: string; section: string; excerpt?: string; score: number }>;
          abstained?: boolean;
          abstainReason?: string | null;
        }>(`/api/v1/memory/recall?q=${q}${k}${c}`);
        // The recall's abstention (cerebro-busca-significado, AC 52): the agent is told nothing answers, and why.
        if (r.abstained) return abstentionText(r.abstainReason ?? "no_match");
        if (r.answerContext.length === 0) return "No indexed section matched.";
        return r.answerContext
          .map((c) => `## ${c.path} § ${c.section} (score ${c.score})\n${c.excerpt ?? ""}`)
          .join("\n\n");
      },
    },
    {
      name: "skills_list",
      description: "The canonical skill catalog (slug, name, description, mode).",
      inputSchema: { type: "object", properties: {} },
      handler: async () => {
        const skills =
          await api.get<
            Array<{ slug: string; name: string; description: string; enabled: boolean; mode?: string }>
          >("/api/v1/skills");
        return (
          skills
            .filter((s) => s.enabled)
            .map((s) => `/${s.slug} — ${s.name}: ${s.description}`)
            .join("\n") || "No skills."
        );
      },
    },
    {
      name: "skills_run",
      description:
        "Run a skill headlessly (subject to the security profile; write runs may park for approval). Returns the run id. context: a work context id to run it in (all, or none, for no context).",
      inputSchema: {
        type: "object",
        properties: { slug: { type: "string" }, inputs: { type: "object" }, context: { type: "string" } },
        required: ["slug"],
      },
      handler: async (a) => {
        const slug = encodeURIComponent(str(a.slug, "slug"));
        const context = optional(a.context, "context");
        const r = await api.post<{ runId: string | null; status: string }>(`/api/v1/skills/${slug}/run`, {
          inputs: (a.inputs ?? {}) as object,
          ...(context !== undefined && context !== "all" ? { contextId: context } : {}),
        });
        return JSON.stringify(r);
      },
    },
    {
      name: "journal_append",
      description: "Append a line to today's journal (sections: Today, Decisions, Open loops, Runs).",
      inputSchema: {
        type: "object",
        properties: { text: { type: "string" }, section: { type: "string" } },
        required: ["text"],
      },
      handler: async (a) => {
        const body: Record<string, unknown> = { text: str(a.text, "text") };
        if (typeof a.section === "string") body.section = a.section;
        body.author = "agent";
        await api.post("/api/v1/memory/journal/append", body);
        return "Appended.";
      },
    },
    {
      name: "facts_assert",
      description:
        "Propose one durable fact about the user or the workspace as subject / predicate / object (e.g. 'user' / 'prefers' / 'commits in Portuguese'); it is remembered once the owner accepts it in the MordomoOS inbox. Use sparingly, only for what will matter in future sessions.",
      inputSchema: {
        type: "object",
        properties: {
          subject: { type: "string" },
          predicate: { type: "string" },
          object: { type: "string" },
        },
        required: ["subject", "predicate", "object"],
      },
      handler: async (a) => {
        const runId = process.env.MORDOMO_RUN_ID;
        return propose(api, {
          kind: "fact",
          subject: str(a.subject, "subject"),
          predicate: str(a.predicate, "predicate"),
          object: str(a.object, "object"),
          ...(runId ? { sourceRunId: runId } : {}),
        });
      },
    },
    {
      name: "facts_query",
      description: "Bi-temporal facts (subject / predicate filters).",
      inputSchema: {
        type: "object",
        properties: { subject: { type: "string" }, predicate: { type: "string" } },
      },
      handler: async (a) => {
        const params = new URLSearchParams();
        if (typeof a.subject === "string") params.set("subject", a.subject);
        if (typeof a.predicate === "string") params.set("predicate", a.predicate);
        const r = await api.get<unknown>(`/api/v1/memory/facts?${params.toString()}`);
        return JSON.stringify(r, null, 2);
      },
    },
    {
      name: "note_create",
      description:
        "Propose a new Markdown note under memory/notes (an `area` of the settings gives it a folder); it is created once the owner accepts it in the MordomoOS inbox.",
      inputSchema: {
        type: "object",
        properties: {
          title: { type: "string" },
          content: { type: "string" },
          area: { type: "string" },
          tags: { type: "array", items: { type: "string" } },
          frontMatter: { type: "boolean" },
        },
        required: ["title"],
      },
      handler: async (a) => {
        const body: Record<string, unknown> = { kind: "note_create", title: str(a.title, "title") };
        for (const key of ["content", "area", "tags", "frontMatter"] as const)
          if (a[key] !== undefined) body[key] = a[key];
        return propose(api, body);
      },
    },
    {
      name: "note_read",
      description:
        "Read a note for editing: its whole text and its version, and whether it can be edited (only .md notes under memory/).",
      inputSchema: { type: "object", properties: { path: { type: "string" } }, required: ["path"] },
      handler: async (a) => {
        const r = await api.get<{
          path: string;
          version: string;
          editable: boolean;
          reason?: string;
          content: string;
        }>(`/api/v1/memory/note?p=${encodeURIComponent(str(a.path, "path"))}`);
        const head = `${r.path}\nversion: ${r.version}${r.editable ? "" : `\nread-only: ${r.reason ?? ""}`}`;
        return `${head}\n\n${r.content}`;
      },
    },
    {
      name: "note_save",
      description:
        "Propose a note's new text against the version you read (baseVersion); the owner accepts it in the MordomoOS inbox, and a note that changed meanwhile is not overwritten.",
      inputSchema: {
        type: "object",
        properties: {
          path: { type: "string" },
          content: { type: "string" },
          baseVersion: { type: "string" },
        },
        required: ["path", "content", "baseVersion"],
      },
      handler: async (a) => {
        if (typeof a.content !== "string") throw new Error("content is required");
        return propose(api, {
          kind: "note_save",
          path: str(a.path, "path"),
          content: a.content,
          baseVersion: str(a.baseVersion, "baseVersion"),
        });
      },
    },
    {
      name: "inbox_unread",
      description: "Unread notifications of the MordomoOS inbox (approvals, failures, alerts).",
      inputSchema: { type: "object", properties: {} },
      handler: async () => {
        const r = await api.get<{ items: Array<{ title: string; body?: string | null; ts: number }> }>(
          "/api/v1/notifications?unread=true&limit=50",
        );
        return (
          r.items
            .map((i) => `- ${new Date(i.ts).toISOString()} ${i.title}${i.body ? ` — ${i.body}` : ""}`)
            .join("\n") || "Inbox is empty."
        );
      },
    },
    // cerebro-perguntar, door 4: find a file by its words, see who points at it, and ask what is broken.
    {
      name: "search",
      description:
        "Find files of the indexed workspace by their words (and meaning, with the semantic search on): one line per file, its path, the section when the vectors found it, and an excerpt. mode: auto, text or semantic; context: a work context id; limit: 1 to 20 (10).",
      inputSchema: {
        type: "object",
        properties: {
          query: { type: "string" },
          mode: { type: "string", enum: ["auto", "text", "semantic"] },
          context: { type: "string" },
          limit: { type: "number" },
        },
        required: ["query"],
      },
      handler: async (a) => {
        const params = new URLSearchParams({
          q: str(a.query, "query"),
          limit: String(clamp(a.limit, 20, 10)),
        });
        const mode = optional(a.mode, "mode");
        if (mode !== undefined) params.set("mode", mode);
        const context = optional(a.context, "context");
        if (context !== undefined) params.set("context", context);
        const hits = await api.get<Array<{ path: string; section?: string; snippet: string | null }>>(
          `/api/v1/memory/search?${params.toString()}`,
        );
        if (hits.length === 0) return "No file matched.";
        return hits
          .map((h) => {
            // One line per file: the excerpt's own line breaks are spaces.
            const excerpt = h.snippet?.replace(/\s+/g, " ").trim();
            return `${h.path}${h.section ? ` (${h.section})` : ""}${excerpt ? ` — ${excerpt}` : ""}`;
          })
          .join("\n");
      },
    },
    {
      name: "links",
      description:
        "Who points at a file (backlinks) and where its own links lead, the broken ones marked (quebrado). path: absolute, or relative to memory/.",
      inputSchema: { type: "object", properties: { path: { type: "string" } }, required: ["path"] },
      handler: async (a) => {
        const p = str(a.path, "path");
        let r: {
          backlinks: Array<{ file: { path: string } }>;
          outgoing: Array<{ target: string; resolved: { path: string } | null }>;
        };
        try {
          r = await api.get(`/api/v1/memory/links?p=${encodeURIComponent(p)}`);
        } catch (err) {
          // A file that is not there and one hidden from agents read the same (AC 60).
          if ((err as { status?: number }).status === 404) throw new Error(`File not found: ${p}`);
          throw err;
        }
        const list = (lines: string[]) => (lines.length > 0 ? lines : ["- (none)"]);
        return [
          "Backlinks:",
          ...list(r.backlinks.map((b) => `- ${b.file.path}`)),
          "Links:",
          ...list(r.outgoing.map((l) => (l.resolved ? `- ${l.resolved.path}` : `- ${l.target} (quebrado)`))),
        ].join("\n");
      },
    },
    {
      name: "hygiene",
      description:
        "What is broken or forgotten in the memory: orphan notes, broken links, broken router pointers and stale files. perKind: items of each list, 1 to 20 (10).",
      inputSchema: { type: "object", properties: { perKind: { type: "number" } } },
      handler: async (a) => {
        const r = await api.get<{
          counts: { orphan: number; "dangling-link": number; stale: number };
          items: Array<{ kind: string; id: string; detail: string }>;
          brokenLinks: { count: number; items: Array<{ path: string; target: string; line: number }> };
        }>(`/api/v1/memory/hygiene?perKind=${clamp(a.perKind, 20, 10)}`);
        const of = (kind: string, line: (i: { id: string; detail: string }) => string) =>
          r.items.filter((i) => i.kind === kind).map(line);
        const block = (title: string, count: number, lines: string[]) => [`${title} (${count}):`, ...lines];
        return [
          ...block(
            "Orphans",
            r.counts.orphan,
            of("orphan", (i) => `- ${i.id}`),
          ),
          ...block(
            "Broken links",
            r.brokenLinks.count,
            r.brokenLinks.items.map((l) => `- ${l.path}:${l.line} → ${l.target}`),
          ),
          ...block(
            "Broken router pointers",
            r.counts["dangling-link"],
            of("dangling-link", (i) => `- ${i.id}: ${i.detail}`),
          ),
          ...block(
            "Stale files",
            r.counts.stale,
            of("stale", (i) => `- ${i.id}: ${i.detail}`),
          ),
        ].join("\n");
      },
    },
    // cerebro-entidades-resumos, door 7: who and what the notes name, read as agents read.
    {
      name: "entities",
      description:
        "The people, projects, tags and terms the notes name, by how many files cite them: one line per entity, name (kind, files). query: a word prefix of the name; kind: perfil, projeto, tag or termo; limit: 1 to 50 (20).",
      inputSchema: {
        type: "object",
        properties: {
          query: { type: "string" },
          kind: { type: "string", enum: ["perfil", "projeto", "tag", "termo"] },
          limit: { type: "number" },
        },
      },
      handler: async (a) => {
        const params = new URLSearchParams({ limit: String(clamp(a.limit, 50, 20)) });
        const query = optional(a.query, "query");
        if (query !== undefined) params.set("q", query);
        const kind = optional(a.kind, "kind");
        if (kind !== undefined) params.set("kind", kind);
        const r = await api.get<{ items: EntityLine[] }>(`/api/v1/memory/entities?${params.toString()}`);
        if (r.items.length === 0) return "No entity matched.";
        return r.items.map((e) => `${e.name} (${e.kind}, ${e.files} arquivos)`).join("\n");
      },
    },
    {
      name: "entity",
      description:
        "One entity the notes name: its kind, aliases, up to 20 mentions (path:line — excerpt) and the entities it shares files with. name: its name or an alias; or key: <kind>:<normalized name>, as entities gives it.",
      inputSchema: {
        type: "object",
        properties: { name: { type: "string" }, key: { type: "string" } },
      },
      handler: async (a) => {
        const name = optional(a.name, "name");
        let key = optional(a.key, "key");
        if (name === undefined && key === undefined) throw new Error("name or key is required");
        const asked = key ?? name!;
        if (key === undefined) {
          // The entity one of whose names (or aliases) has the same normalized name.
          const norm = entityNorm(name!);
          const params = new URLSearchParams({ q: name!, limit: "200" });
          const r =
            norm === ""
              ? { items: [] }
              : await api.get<{ items: EntityLine[] }>(`/api/v1/memory/entities?${params.toString()}`);
          key = r.items.find(
            (e) =>
              e.key.slice(e.key.indexOf(":") + 1) === norm ||
              [e.name, ...e.aliases].some((n) => entityNorm(n) === norm),
          )?.key;
          if (key === undefined) throw new Error(`Entity not found: ${asked}`);
        }
        let e: {
          name: string;
          kind: string;
          aliases: string[];
          mentions: Array<{ path: string; line: number; excerpt: string }>;
          related: Array<{ name: string; kind: string; shared: number }>;
        };
        try {
          e = await api.get(`/api/v1/memory/entities/${encodeURIComponent(key)}`);
        } catch (err) {
          // An entity that does not exist, one only of hidden files and a key that is no key read the same (AC 34).
          const status = (err as { status?: number }).status;
          if (status === 404 || status === 400) throw new Error(`Entity not found: ${asked}`);
          throw err;
        }
        const list = (lines: string[]) => (lines.length > 0 ? lines : ["- (none)"]);
        return [
          `${e.name} (${e.kind})`,
          `Aliases: ${e.aliases.length > 0 ? e.aliases.join(", ") : "(none)"}`,
          `Mentions (${e.mentions.length}):`,
          ...list(
            e.mentions.slice(0, ENTITY_TOOL_MENTIONS).map((m) => `- ${m.path}:${m.line} — ${m.excerpt}`),
          ),
          "Related:",
          ...list(e.related.map((r) => `- ${r.name} (${r.kind}, ${r.shared} arquivos em comum)`)),
        ].join("\n");
      },
    },
    // cerebro-entidades-resumos, door 7: the summary of an area or a context, read as agents read
    {
      name: "summary",
      description:
        "The summary of an area or a work context of the notes: whether it is current or old (and what changed since), then its paragraphs, each with the (path § section) it cites. area: the area's name; or context: the context's id.",
      inputSchema: {
        type: "object",
        properties: { area: { type: "string" }, context: { type: "string" } },
      },
      handler: async (a) => {
        const area = optional(a.area, "area");
        const context = optional(a.context, "context");
        if (area === undefined && context === undefined) throw new Error("area or context is required");
        if (area !== undefined && context !== undefined) throw new Error("give area or context, not both");
        const [kind, id] = area !== undefined ? ["area", area] : ["context", context!];
        let s: SummaryRead;
        try {
          s = await api.get<SummaryRead>(`/api/v1/memory/summaries/${kind}/${encodeURIComponent(id)}`);
        } catch (err) {
          if ((err as { status?: number }).status === 404) throw new Error(`No ${kind} is named ${id}.`);
          throw err;
        }
        return [
          summaryStateLine(s),
          ...(s.paragraphs ?? []).map(
            (p) => `\n${[p.text, ...p.citations.map((c) => `(${c.path} § ${c.section})`)].join(" ")}`,
          ),
        ].join("\n");
      },
    },
  ];
}

export function serveMordomoMcp(
  api: McpApi,
  version: string,
  onInitialize?: (params: Record<string, unknown> | undefined) => void,
): Promise<void> {
  const tools = mordomoTools(api);
  return serveMcpStdio({ name: "mordomo", version, tools, ...(onInitialize ? { onInitialize } : {}) });
}
