/**
 * `mordomo mcp` (plan Onda 3 §4): MordomoOS as an MCP server for the CLIs it
 * orchestrates. A Claude, Cursor or Codex session can recall the memory,
 * list and run skills, append to today's journal, query facts and read the
 * inbox — through the local HTTP API with the local token, so every call is
 * subject to the same containment and gating as the Command Centre.
 */
import { serveMcpStdio, type McpTool } from "./stdio.js";

export interface McpApi {
  get<T>(path: string): Promise<T>;
  post<T>(path: string, body: unknown): Promise<T>;
  put<T>(path: string, body: unknown): Promise<T>;
}

export function httpApi(baseUrl: string, token: string): McpApi {
  const call = async <T>(method: string, path: string, body?: unknown): Promise<T> => {
    const res = await fetch(`${baseUrl}${path}`, {
      method,
      headers: { "content-type": "application/json", "x-mordomo-token": token },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`${method} ${path} → ${res.status}: ${text.slice(0, 300)}`);
    return (text ? JSON.parse(text) : {}) as T;
  };
  return { get: (p) => call("GET", p), post: (p, b) => call("POST", p, b), put: (p, b) => call("PUT", p, b) };
}

const str = (v: unknown, name: string): string => {
  if (typeof v !== "string" || !v.trim()) throw new Error(`${name} is required`);
  return v.trim();
};

export function mordomoTools(api: McpApi): McpTool[] {
  return [
    {
      name: "recall",
      description:
        "Layered memory retrieval: the sections of the indexed workspace worth reading for a question.",
      inputSchema: {
        type: "object",
        properties: { question: { type: "string" }, k: { type: "number" } },
        required: ["question"],
      },
      handler: async (a) => {
        const q = encodeURIComponent(str(a.question, "question"));
        const k = typeof a.k === "number" ? `&k=${Math.max(1, Math.min(10, Math.round(a.k)))}` : "";
        const r = await api.get<{
          answerContext: Array<{ path: string; section: string; excerpt?: string; score: number }>;
        }>(`/api/v1/memory/recall?q=${q}${k}`);
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
        "Run a skill headlessly (subject to the security profile; write runs may park for approval). Returns the run id.",
      inputSchema: {
        type: "object",
        properties: { slug: { type: "string" }, inputs: { type: "object" } },
        required: ["slug"],
      },
      handler: async (a) => {
        const slug = encodeURIComponent(str(a.slug, "slug"));
        const r = await api.post<{ runId: string | null; status: string }>(`/api/v1/skills/${slug}/run`, {
          inputs: (a.inputs ?? {}) as object,
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
        await api.post("/api/v1/memory/journal/append", body);
        return "Appended.";
      },
    },
    {
      name: "facts_assert",
      description:
        "Remember one durable fact about the user or the workspace as subject / predicate / object (e.g. 'user' / 'prefers' / 'commits in Portuguese'). Use sparingly, only for what will matter in future sessions.",
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
        const r = await api.post<{ fact: { id: number }; unchanged: boolean }>("/api/v1/memory/facts", {
          subject: str(a.subject, "subject"),
          predicate: str(a.predicate, "predicate"),
          object: str(a.object, "object"),
          ...(runId ? { sourceRunId: runId } : {}),
        });
        return `${r.unchanged ? "Already knew" : "Remembered"} fact #${r.fact.id}: ${str(a.subject, "subject")} ${str(a.predicate, "predicate")} ${str(a.object, "object")}`;
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
        "Create a Markdown note under memory/notes (an `area` of the settings gives it a folder). Returns its path and its version; keep the version to save later.",
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
        const body: Record<string, unknown> = { title: str(a.title, "title") };
        for (const key of ["content", "area", "tags", "frontMatter"] as const)
          if (a[key] !== undefined) body[key] = a[key];
        const r = await api.post<{ path: string; version: string }>("/api/v1/memory/notes", body);
        return `Created ${r.path}\nversion: ${r.version}`;
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
        "Replace a note's text, only if it is still the version you read (baseVersion). A changed note answers edit_conflict and nothing is written: read it again and merge.",
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
        const r = await api.put<{ path: string; version: string }>("/api/v1/memory/notes", {
          path: str(a.path, "path"),
          content: a.content,
          baseVersion: str(a.baseVersion, "baseVersion"),
        });
        return `Saved ${r.path}\nversion: ${r.version}`;
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
  ];
}

export function serveMordomoMcp(api: McpApi, version: string): Promise<void> {
  return serveMcpStdio({ name: "mordomo", version, tools: mordomoTools(api) });
}
