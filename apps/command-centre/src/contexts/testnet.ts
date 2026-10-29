/**
 * The server the work-context tests talk to (.specs/features/cerebro-contextos, S5), as a table and a log of the
 * writes. No JSX and no import of the app: the `vi.mock("../api")` factories load this file, and it must not pull the
 * mocked module back in (the same arrangement as `commands/testserver.ts`).
 */
import { vi } from "vitest";
import type * as ApiModule from "../api";

export interface ContextRow {
  id: string;
  name: string;
  paths: Array<{ path: string; state: "ok" | "missing" | "not_indexed" }>;
  notesDir: string;
  brief: string | null;
  map: string;
  files: number;
}

export const WORK = "/work";
export const HOME = "/home/me/.mordomo";

export const CONTEXT = (id: string, name: string, over: Partial<ContextRow> = {}): ContextRow => ({
  id,
  name,
  paths: [{ path: `${WORK}/${id}`, state: "ok" }],
  notesDir: `${HOME}/memory/notes/${id}`,
  brief: null,
  map: `${HOME}/memory/contexts/${id}.md`,
  files: 3,
  ...over,
});

export interface Call {
  method: string;
  url: string;
  body?: unknown;
}

const PREFS = {
  version: 1,
  shell: "moldura",
  themePreset: "hud-orange",
  microApps: [],
  dashboardLayout: {},
  spaces: {},
  activeSpace: "work",
  brain: {},
  activeContext: null as string | null,
};

export const net = {
  prefs: { ...PREFS },
  contexts: [] as ContextRow[],
  /** What `GET /api/contexts` does: answer the table (default), never answer, or fail. */
  list: "answer" as "answer" | "pending" | "fail",
  settings: { indexedFolders: [{ path: WORK, area: null, enabled: true }] } as Record<string, unknown>,
  graphDirs: [] as string[],
  total: 42,
  /** What `GET /api/sessions/:id` answers, by id (`{ session, runs }`); an id not here never answers. */
  sessions: new Map<string, unknown>(),
  /** Every request, in order. */
  calls: [] as Call[],
  /** A write's answer, by "METHOD url"; the default is what the route answers to a good request. */
  answers: new Map<string, (body: unknown) => Promise<unknown>>(),
};

export function resetNet(): void {
  net.prefs = { ...PREFS };
  net.contexts = [];
  net.list = "answer";
  net.settings = { indexedFolders: [{ path: WORK, area: null, enabled: true }] };
  net.graphDirs = [];
  net.total = 42;
  net.sessions = new Map();
  net.calls = [];
  net.answers.clear();
}

const strip = (url: string) => url.replace(/^\/api\/v1\//, "/api/");

function read(url: string): Promise<unknown> {
  const u = strip(url);
  if (u === "/api/ui-preferences") return Promise.resolve(structuredClone(net.prefs));
  if (u === "/api/contexts") {
    if (net.list === "pending") return new Promise(() => undefined);
    if (net.list === "fail") return Promise.reject(new Error("The service did not answer."));
    return Promise.resolve({ contexts: structuredClone(net.contexts) });
  }
  if (u.startsWith("/api/memory/status"))
    return Promise.resolve({ lastIndex: null, facets: { areas: [], exts: [], tags: [], total: net.total } });
  if (u.startsWith("/api/memory/graph"))
    return Promise.resolve({
      nodes: net.graphDirs.map((dir, id) => ({ id, dir, name: "f.md", path: `${dir}/f.md` })),
      edges: [],
      truncated: false,
      totalFiles: net.graphDirs.length,
    });
  if (u === "/api/settings") return Promise.resolve(structuredClone(net.settings));
  if (u === "/api/system/info") return Promise.resolve({ home: HOME });
  const session = /^\/api\/sessions\/([^/?]+)$/.exec(u);
  if (session && net.sessions.has(decodeURIComponent(session[1]!)))
    return Promise.resolve(structuredClone(net.sessions.get(decodeURIComponent(session[1]!))));
  return new Promise(() => undefined);
}

function write(method: string, url: string, body: unknown): Promise<unknown> {
  const u = strip(url);
  net.calls.push({ method, url: u, body });
  const given = net.answers.get(`${method} ${u}`);
  if (given) return given(body);
  if (method === "PUT" && u === "/api/ui-preferences") {
    net.prefs = { ...net.prefs, ...(body as object) };
    return Promise.resolve(structuredClone(net.prefs));
  }
  if (method === "POST" && u === "/api/contexts") {
    const b = body as { name: string; paths: string[] };
    const made = CONTEXT(b.name.toLowerCase().replace(/[^a-z0-9]+/g, "-"), b.name, {
      paths: b.paths.map((path) => ({ path, state: "ok" })),
      files: 0,
    });
    net.contexts.push(made);
    return Promise.resolve(made);
  }
  const patch = /^\/api\/contexts\/([^/]+)$/.exec(u);
  if (patch && method === "PATCH") {
    const c = net.contexts.find((x) => x.id === decodeURIComponent(patch[1]!))!;
    const b = body as { name?: string; brief?: true };
    if (b.name) c.name = b.name;
    if (b.brief) c.brief = `${c.notesDir}/_resumo.md`;
    return Promise.resolve(structuredClone(c));
  }
  if (patch && method === "DELETE") {
    const id = decodeURIComponent(patch[1]!);
    net.contexts = net.contexts.filter((x) => x.id !== id);
    if (net.prefs.activeContext === id) net.prefs.activeContext = null;
    return Promise.resolve({ deleted: true, id });
  }
  if (method === "PUT" && u === "/api/settings") {
    net.settings = { ...net.settings, ...(body as object) };
    return Promise.resolve(structuredClone(net.settings));
  }
  if (method === "POST" && u === "/api/memory/index")
    return Promise.resolve({ stats: { scanned: 1, added: 1, updated: 0, removed: 0 } });
  return new Promise(() => undefined);
}

export function mockApi(mod: typeof ApiModule) {
  return {
    ...mod,
    api: {
      ...mod.api,
      get: vi.fn((url: string) => {
        net.calls.push({ method: "GET", url: strip(url) });
        return read(url);
      }),
      post: vi.fn((url: string, body?: unknown) => write("POST", url, body)),
      put: vi.fn((url: string, body?: unknown) => write("PUT", url, body)),
      patch: vi.fn((url: string, body?: unknown) => write("PATCH", url, body)),
      del: vi.fn((url: string) => write("DELETE", url, undefined)),
      putSettings: vi.fn((patch: unknown) => write("PUT", "/api/settings", patch)),
      putUiPreferences: vi.fn((patch: unknown) => write("PUT", "/api/ui-preferences", patch)),
      uiPreferences: vi.fn(() => read("/api/ui-preferences")),
      streamEvents: vi.fn(() => () => undefined),
      streamRun: vi.fn(() => () => undefined),
    },
  };
}
