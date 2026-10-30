/**
 * The server the notes-view tests talk to (.specs/features/cerebro-vista-notas, batch B): a home with `memory/` and an
 * indexed folder, as a table of files, answered the way the routes answer (`GET /api/memory/tree` one level at a time,
 * the note, its links, the related files, the search, the index, the preferences, the contexts), and a log of every
 * request. No JSX and no import of the app: the `vi.mock("../../api")` factories load this file, and it must not pull
 * the mocked module back in (as `contexts/testnet.ts`).
 */
import { useEffect, useRef } from "react";
import { vi } from "vitest";
import type * as ApiModule from "../../api";

export const HOME = "/home/me/.mordomo";
export const MEM = `${HOME}/memory`;
export const WORK = "/work";

export interface FileDef {
  id: number;
  root: string;
  rel: string;
  title?: string | null;
  type?: string | null;
  mtime?: number;
  content?: string;
  bodyStart?: number;
  editable?: boolean;
  reason?: "outside_memory" | "generated" | "not_markdown";
}

export interface RootDef {
  path: string;
  name: string;
  editable: boolean;
  indexing: boolean;
}

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
  brain: {} as Record<string, unknown>,
  activeContext: null as string | null,
};

/** A request as the table reads it: its path and its query (a relative address; no host is made up). */
export interface Asked {
  pathname: string;
  searchParams: URLSearchParams;
}
type Answer = (url: Asked) => Promise<unknown> | undefined;

export const net = {
  prefs: structuredClone(PREFS),
  files: [] as FileDef[],
  roots: [] as RootDef[],
  /** The roots of `?context=<id>`. */
  contextRoots: {} as Record<string, RootDef[]>,
  contexts: [] as Array<{
    id: string;
    name: string;
    paths: Array<{ path: string; state: string }>;
    files: number;
  }>,
  /** `indexNote` of a folder, by `<root>|<dir>`. */
  indexNotes: {} as Record<string, number>,
  /** A folder answered with `truncated` and `omitted`, by `<root>|<dir>`. */
  truncated: {} as Record<string, number>,
  links: {} as Record<number, { backlinks: unknown[]; outgoing: unknown[] }>,
  related: {} as Record<number, Array<{ id: number; why: string }>>,
  status: {
    lastIndex: {
      at: Date.now() - 60_000,
      stats: { scanned: 3, added: 3, updated: 0, removed: 0 },
    } as unknown,
    total: 3,
    running: false,
  },
  /** Answers that win over the table, tried in order (a failure, a pending request, another body). */
  overrides: [] as Answer[],
  calls: [] as Call[],
  writes: new Map<string, (body: unknown) => Promise<unknown>>(),
};

export function resetNet(): void {
  net.prefs = structuredClone(PREFS);
  net.files = [];
  net.roots = [
    { path: MEM, name: "memory", editable: true, indexing: false },
    { path: WORK, name: "work", editable: false, indexing: false },
  ];
  net.contextRoots = {};
  net.contexts = [];
  net.indexNotes = {};
  net.truncated = {};
  net.links = {};
  net.related = {};
  net.status = {
    lastIndex: { at: Date.now() - 60_000, stats: { scanned: 3, added: 3, updated: 0, removed: 0 } },
    total: 3,
    running: false,
  };
  net.overrides = [];
  net.calls = [];
  net.writes.clear();
}

/** A note of the table, its `content` defaulting to its title as a heading. */
export function note(id: number, root: string, rel: string, over: Partial<FileDef> = {}): FileDef {
  const def: FileDef = { id, root, rel, title: null, type: null, mtime: 1_700_000_000_000 + id, ...over };
  net.files.push(def);
  return def;
}

export const pathOf = (f: FileDef) => `${f.root}/${f.rel}`;
const nameOf = (rel: string) => rel.slice(rel.lastIndexOf("/") + 1);
const dirOf = (rel: string) => (rel.includes("/") ? rel.slice(0, rel.lastIndexOf("/")) : "");

export function fileRow(f: FileDef) {
  const name = nameOf(f.rel);
  return {
    id: f.id,
    root: f.root,
    path: pathOf(f),
    rel: f.rel,
    name,
    ext: name.includes(".") ? name.slice(name.lastIndexOf(".")) : "",
    dir: `${f.root}${dirOf(f.rel) ? `/${dirOf(f.rel)}` : ""}`,
    area: null,
    size: 10,
    mtime: f.mtime ?? 1,
    indexedAt: 1,
    title: f.title ?? null,
    tags: [],
    fields: f.type ? { type: f.type } : {},
  };
}

const strip = (url: string) => url.replace(/^\/api\/v1\//, "/api/");

export class NetError extends Error {
  constructor(
    public status: number,
    public code: string,
    message = code,
  ) {
    super(message);
  }
}

function tree(u: Asked): unknown {
  const context = u.searchParams.get("context");
  const roots = context ? (net.contextRoots[context] ?? []) : net.roots;
  const asked = u.searchParams.get("root");
  const root = asked ?? roots[0]?.path ?? null;
  if (asked && !roots.some((r) => r.path === asked)) throw new NetError(400, "unknown_root");
  const dir = u.searchParams.get("dir") ?? "";
  const sort = u.searchParams.get("sort") ?? "name";
  const inRoot = net.files.filter((f) => f.root === root);
  const prefix = dir ? `${dir}/` : "";
  const under = inRoot.filter((f) => f.rel.startsWith(prefix));
  if (dir && under.length === 0) throw new NetError(404, "not_found");
  const folders = new Map<string, number>();
  const files = [];
  for (const f of under) {
    const rest = f.rel.slice(prefix.length);
    if (rest.includes("/")) {
      const name = rest.slice(0, rest.indexOf("/"));
      folders.set(name, (folders.get(name) ?? 0) + 1);
    } else files.push(f);
  }
  if (sort === "updated") files.sort((a, b) => (b.mtime ?? 0) - (a.mtime ?? 0));
  else files.sort((a, b) => nameOf(a.rel).localeCompare(nameOf(b.rel)));
  const omitted = net.truncated[`${root}|${dir}`] ?? 0;
  return {
    roots: roots.map((r) => ({ ...r })),
    root,
    dir,
    folders: [...folders.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([name, count]) => ({ rel: prefix + name, name, count, editable: root === MEM })),
    files: files.map((f) => ({
      id: f.id,
      rel: f.rel,
      name: nameOf(f.rel),
      title: f.title ?? null,
      type: f.type ?? null,
      mtime: f.mtime ?? 1,
      editable: f.editable ?? f.root === MEM,
      ...(f.reason ? { reason: f.reason } : f.root !== MEM ? { reason: "outside_memory" } : {}),
    })),
    indexNote: net.indexNotes[`${root}|${dir}`] ?? null,
    truncated: omitted > 0,
    omitted,
  };
}

function read(url: string): Promise<unknown> {
  const [pathname, query] = strip(url).split("?");
  const u: Asked = { pathname: pathname!, searchParams: new URLSearchParams(query ?? "") };
  for (const o of net.overrides) {
    const given = o(u);
    if (given) return given;
  }
  try {
    switch (u.pathname) {
      case "/api/ui-preferences":
        return Promise.resolve(structuredClone(net.prefs));
      case "/api/contexts":
        return Promise.resolve({ contexts: structuredClone(net.contexts) });
      case "/api/memory/status":
        return Promise.resolve({
          lastIndex: net.status.lastIndex,
          facets: { areas: [], exts: [], tags: [], total: net.status.total },
          indexing: {
            state: net.status.running ? "running" : "idle",
            mode: "worker",
            runId: null,
            phase: null,
            scanned: 0,
            total: null,
            interrupted: false,
          },
          semantic: { enabled: false },
        });
      case "/api/memory/tree":
        return Promise.resolve(tree(u));
      case "/api/memory/note": {
        const p = u.searchParams.get("p");
        const f = net.files.find((x) => pathOf(x) === p);
        if (!f) return Promise.reject(new NetError(404, "note_missing", "The file does not exist"));
        const content = f.content ?? `# ${f.title ?? nameOf(f.rel)}\n`;
        return Promise.resolve({
          path: pathOf(f),
          name: nameOf(f.rel),
          version: `sha256:${f.id}`,
          size: content.length,
          mtime: f.mtime ?? 1,
          content,
          editable: f.editable ?? f.root === MEM,
          properties: [],
          otherProperties: null,
          bodyStart: f.bodyStart ?? 0,
        });
      }
      case "/api/memory/links": {
        const id = Number(u.searchParams.get("id"));
        const f = net.files.find((x) => x.id === id);
        if (!f) return Promise.reject(new NetError(404, "not_found"));
        const l = net.links[id] ?? { backlinks: [], outgoing: [] };
        return Promise.resolve({ file: fileRow(f), ...structuredClone(l) });
      }
      case "/api/memory/related": {
        const id = Number(u.searchParams.get("id"));
        return Promise.resolve(
          (net.related[id] ?? []).map((r) => ({
            file: fileRow(net.files.find((f) => f.id === r.id)!),
            why: r.why,
          })),
        );
      }
      case "/api/memory/search": {
        const q = (u.searchParams.get("q") ?? "").toLowerCase();
        return Promise.resolve(
          net.files
            .filter((f) => (f.title ?? f.rel).toLowerCase().includes(q))
            .map((f) => ({ ...fileRow(f), snippet: null, score: 1, via: "text" })),
        );
      }
      case "/api/memory/graph":
        return Promise.resolve({ nodes: [], edges: [], truncated: false, totalFiles: 0 });
      case "/api/system/info":
        return Promise.resolve({ home: HOME });
    }
  } catch (err) {
    return Promise.reject(err);
  }
  return new Promise(() => undefined);
}

function write(method: string, url: string, body: unknown): Promise<unknown> {
  const u = url.replace(/^\/api\/v1\//, "/api/");
  net.calls.push({ method, url: u, body });
  const given = net.writes.get(`${method} ${u}`);
  if (given) return given(body);
  if (method === "PUT" && u === "/api/ui-preferences") {
    const b = body as { brain?: Record<string, unknown>; activeContext?: string | null };
    net.prefs = {
      ...net.prefs,
      ...b,
      brain: { ...net.prefs.brain, ...(b.brain ?? {}) },
    } as typeof net.prefs;
    return Promise.resolve(structuredClone(net.prefs));
  }
  if (method === "POST" && u === "/api/memory/index")
    return Promise.resolve({ stats: { scanned: 1, added: 0, updated: 0, removed: 0 } });
  if (method === "POST" && u === "/api/memory/index/cancel")
    return Promise.resolve({ cancelled: true, runId: "r" });
  if (method === "POST" && u === "/api/memory/open")
    return Promise.resolve({ opened: (body as { p: string }).p });
  return new Promise(() => undefined);
}

export function mockApi(mod: typeof ApiModule) {
  // A refusal of the table is the app's own error, with its status and code.
  const asApi = (p: Promise<unknown>) =>
    p.catch((err: unknown) => {
      if (err instanceof NetError) throw new mod.ApiError(err.status, err.message, err.code);
      throw err;
    });
  return {
    ...mod,
    api: {
      ...mod.api,
      get: vi.fn((url: string) => {
        net.calls.push({ method: "GET", url: url.replace(/^\/api\/v1\//, "/api/") });
        return asApi(read(url));
      }),
      post: vi.fn((url: string, body?: unknown) => asApi(write("POST", url, body))),
      put: vi.fn((url: string, body?: unknown) => asApi(write("PUT", url, body))),
      patch: vi.fn((url: string, body?: unknown) => asApi(write("PATCH", url, body))),
      del: vi.fn((url: string) => asApi(write("DELETE", url, undefined))),
      putUiPreferences: vi.fn((patch: unknown) => asApi(write("PUT", "/api/ui-preferences", patch))),
      uiPreferences: vi.fn(() => read("/api/ui-preferences")),
      streamEvents: vi.fn(() => () => undefined),
      streamRun: vi.fn(() => () => undefined),
    },
  };
}

/** The GETs of one route (the path only), in order, as their query strings. */
export function asked(path: string): URLSearchParams[] {
  return net.calls
    .filter((c) => c.method === "GET" && c.url.split("?")[0] === path)
    .map((c) => new URLSearchParams(c.url.split("?")[1] ?? ""));
}

/* ---- the event stream: what a test emits reaches every `useOsEvent` of the screen ---- */
type Listener = (event: { type: string; payload: unknown }) => void;
const listeners = new Set<Listener>();

/** Stands in for `useOsEvent` (`vi.mock("../../hooks/useEventStream")`). */
export function useOsEventMock(types: string | readonly string[], handler: Listener): void {
  const ref = useRef(handler);
  ref.current = handler;
  const key = Array.isArray(types) ? types.join("|") : String(types);
  useEffect(() => {
    const wanted = new Set(key.split("|"));
    const fn: Listener = (e) => wanted.has(e.type) && ref.current(e);
    listeners.add(fn);
    return () => {
      listeners.delete(fn);
    };
  }, [key]);
}

export function emit(type: string, payload: unknown = {}): void {
  for (const fn of [...listeners]) fn({ type, payload });
}
