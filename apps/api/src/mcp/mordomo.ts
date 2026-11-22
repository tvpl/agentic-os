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
};

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
