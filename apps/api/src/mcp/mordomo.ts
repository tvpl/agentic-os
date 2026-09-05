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
  return { get: (p) => call("GET", p), post: (p, b) => call("POST", p, b) };
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
        }>(`/api/memory/recall?q=${q}${k}`);
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
          >("/api/skills");
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
        const r = await api.post<{ runId: string | null; status: string }>(`/api/skills/${slug}/run`, {
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
        await api.post("/api/memory/journal/append", body);
        return "Appended.";
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
        const r = await api.get<unknown>(`/api/memory/facts?${params.toString()}`);
        return JSON.stringify(r, null, 2);
      },
    },
    {
      name: "inbox_unread",
      description: "Unread notifications of the MordomoOS inbox (approvals, failures, alerts).",
      inputSchema: { type: "object", properties: {} },
      handler: async () => {
        const r = await api.get<{ items: Array<{ title: string; body?: string | null; ts: number }> }>(
          "/api/notifications?unread=true&limit=50",
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
