/**
 * The server the "Busca por significado" tests talk to (.specs/features/cerebro-busca-significado, S7): the settings,
 * `GET /api/memory/status`, `GET /api/memory/embedder` and the writes, each answering only the request it was given
 * (L-052): a `PUT /api/settings` or a `POST /api/memory/embedder` whose body is not one the test allowed is refused,
 * and so is any other route. No JSX and no import of the app: the `vi.mock("../../api")` factory loads this file.
 */
import { isDeepStrictEqual } from "node:util";
import { vi } from "vitest";
import type * as ApiModule from "../../api";

export interface Call {
  method: string;
  url: string;
  body?: unknown;
}
type Json = Record<string, unknown>;

export const GEMMA = {
  id: "embeddinggemma-300m-q4",
  kind: "embedder",
  name: "EmbeddingGemma 300m",
  bytes: 209_000_000,
  dimensions: 768,
  license: { name: "Gemma", acceptRequired: true },
  state: "absent",
};
export const QWEN = {
  id: "qwen3-embedding-0.6b-q4f16",
  kind: "embedder",
  name: "Qwen3-Embedding 0.6B",
  bytes: 567_000_000,
  dimensions: 1024,
  license: { name: "Apache-2.0", acceptRequired: false },
  state: "absent",
};
export const RERANKER = {
  id: "qwen3-reranker-0.6b-q4",
  kind: "reranker",
  name: "Qwen3-Reranker 0.6B",
  bytes: 1_007_000_000,
  license: { name: "Apache-2.0", acceptRequired: false },
  state: "absent",
};

export const EMB = { enabled: false, provider: "hash", sendRemote: false } as Json;
export const RECALL = {
  abstain: true,
  hops: 2,
  tokenBudget: 3000,
  rerank: { enabled: false, candidates: 20, timeoutMs: 15000 },
  // cerebro-entidades-resumos, door 5: the server's settings carry the recall's graph switch
  graph: { enabled: false },
};

export function status(semantic: Json = {}, indexing: Json = {}): Json {
  return {
    lastIndex: null,
    facets: { areas: [], exts: [], tags: [], total: 0 },
    indexing: {
      state: "idle",
      mode: "worker",
      runId: null,
      phase: null,
      scanned: 0,
      total: null,
      interrupted: false,
      ...indexing,
    },
    semantic: {
      enabled: false,
      provider: null,
      backend: null,
      vectors: 0,
      sections: 0,
      model: null,
      blocked: null,
      error: null,
      ...semantic,
    },
  };
}

export const net = {
  settings: {} as Json,
  status: status() as Json,
  catalog: { active: null, platform: { ok: true }, models: [GEMMA, QWEN, RERANKER] } as Json,
  /** What `GET /api/memory/embedder` does: answer `catalog` (default), never answer, or fail. */
  catalogMode: "answer" as "answer" | "pending" | "fail",
  /** The `PUT /api/settings` bodies the test allows. */
  puts: [] as unknown[],
  /** The `POST /api/memory/embedder` bodies the test allows, each with its answer. */
  posts: [] as Array<{ body: unknown; answer: () => Promise<unknown> }>,
  /** `POST /api/memory/index`: the pass, when the test allows one. */
  index: null as null | (() => Promise<unknown>),
  calls: [] as Call[],
};

export function resetNet(): void {
  net.settings = { memory: { embeddings: { ...EMB }, recall: structuredClone(RECALL) } };
  net.status = status();
  net.catalog = { active: null, platform: { ok: true }, models: [GEMMA, QWEN, RERANKER] };
  net.catalogMode = "answer";
  net.puts = [];
  net.posts = [];
  net.index = null;
  net.calls = [];
}

const strip = (url: string) => url.replace(/^\/api\/v1\//, "/api/");
const refuse = (what: string) => Promise.reject(new Error(`not allowed by the test: ${what}`));

function read(url: string): Promise<unknown> {
  const u = strip(url);
  net.calls.push({ method: "GET", url: u });
  if (u === "/api/memory/status") return Promise.resolve(structuredClone(net.status));
  if (u === "/api/memory/embedder") {
    if (net.catalogMode === "pending") return new Promise(() => undefined);
    if (net.catalogMode === "fail") return Promise.reject(new Error("The service did not answer."));
    return Promise.resolve(structuredClone(net.catalog));
  }
  return refuse(`GET ${u}`);
}

function write(method: string, url: string, body: unknown): Promise<unknown> {
  const u = strip(url);
  net.calls.push({ method, url: u, body });
  if (method === "PUT" && u === "/api/settings") {
    if (!net.puts.some((b) => isDeepStrictEqual(b, body))) return refuse(`PUT ${u} ${JSON.stringify(body)}`);
    // `memory` merges its own fields, each replaced whole (G43), as the route does.
    const patch = body as { memory?: Json };
    const memory = { ...(net.settings.memory as Json), ...(patch.memory ?? {}) };
    net.settings = { ...net.settings, ...patch, memory };
    return Promise.resolve({ settings: structuredClone(net.settings), pendingApproval: null });
  }
  if (method === "POST" && u === "/api/memory/embedder") {
    const given = net.posts.find((p) => isDeepStrictEqual(p.body, body));
    return given ? given.answer() : refuse(`POST ${u} ${JSON.stringify(body)}`);
  }
  if (method === "POST" && u === "/api/memory/index" && net.index) return net.index();
  return refuse(`${method} ${u}`);
}

export function mockApi(mod: typeof ApiModule) {
  return {
    ...mod,
    api: {
      ...mod.api,
      get: vi.fn((url: string) => read(url)),
      post: vi.fn((url: string, body?: unknown) => write("POST", url, body)),
      put: vi.fn((url: string, body?: unknown) => write("PUT", url, body)),
      patch: vi.fn((url: string, body?: unknown) => write("PATCH", url, body)),
      del: vi.fn((url: string) => write("DELETE", url, undefined)),
      putSettings: vi.fn((patch: unknown) => write("PUT", "/api/settings", patch)),
      streamEvents: vi.fn(() => () => undefined),
    },
  };
}
