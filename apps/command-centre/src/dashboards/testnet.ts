/**
 * The server the dashboards' tests talk to (.specs/features/cerebro-paineis, S5): the routes of `/api/dashboards*`
 * and `PUT /api/memory/tasks` answered from a table keyed by the method, the path and the whole query (L-052), and a
 * request the table was not given is refused and written down in `dash.unexpected`, so a test can say none was made.
 * Everything else (the preferences, the note a task box reads, the contexts, the home) is the notes-view stub's
 * (`../brain/notes/testnet`). No JSX and no import of the app: the `vi.mock("../api")` factories load this file.
 */
import { vi } from "vitest";
import type * as ApiModule from "../api";
import { NetError, mockApi, net, resetNet } from "../brain/notes/testnet";

type Handler = (body: unknown) => Promise<unknown>;

export const dash = {
  /** `GET /api/dashboards`: the list, or an error. */
  list: [] as unknown[] | Error,
  /** `GET /api/dashboards/:id`, by id and `since` (none: no `since` in the query). */
  reads: new Map<string, unknown>(),
  /** The writes, by `METHOD /path`. */
  writes: new Map<string, Handler>(),
  /** Every request the table was not given, as `METHOD /path?query`. */
  unexpected: [] as string[],
};

const readKey = (id: string, since: string | null) => `${id}|${since ?? ""}`;

/** What `GET /api/dashboards/<id>` answers, only when asked with exactly this `since` (or with none). */
export function answerRead(id: string, answer: unknown, since: number | null = null): void {
  dash.reads.set(readKey(id, since === null ? null : String(since)), answer);
}

export function resetDash(): void {
  resetNet();
  dash.list = [];
  dash.reads.clear();
  dash.writes.clear();
  dash.unexpected = [];
  (net.prefs as Record<string, unknown>).dashboards = { lastViewed: {} };
}

const strip = (url: string) => url.replace(/^\/api\/v1\//, "/api/");
const refuse = (what: string) => {
  dash.unexpected.push(what);
  return Promise.reject(new NetError(500, "unexpected", `not in the table: ${what}`));
};
const answer = (a: unknown) =>
  a instanceof Error ? Promise.reject(a) : Promise.resolve(structuredClone(a as object));

function dashGet(url: string): Promise<unknown> | undefined {
  const u = strip(url);
  const [path, query = ""] = u.split("?");
  if (path === "/api/dashboards") {
    net.calls.push({ method: "GET", url: u });
    if (query !== "") return refuse(`GET ${u}`);
    return dash.list instanceof Error
      ? Promise.reject(dash.list)
      : answer({ dashboards: dash.list, problems: [] });
  }
  const m = /^\/api\/dashboards\/([^/]+)$/.exec(path!);
  if (!m) return undefined;
  net.calls.push({ method: "GET", url: u });
  const q = new URLSearchParams(query);
  if ([...q.keys()].some((k) => k !== "since")) return refuse(`GET ${u}`);
  const key = readKey(decodeURIComponent(m[1]!), q.get("since"));
  return dash.reads.has(key) ? answer(dash.reads.get(key)) : refuse(`GET ${u}`);
}

function dashWrite(method: string, url: string, body: unknown): Promise<unknown> | undefined {
  const u = strip(url);
  if (!u.startsWith("/api/dashboards") && !u.startsWith("/api/memory/tasks")) return undefined;
  net.calls.push({ method, url: u, body });
  const handler = dash.writes.get(`${method} ${u}`);
  return handler ? handler(body).then((a) => structuredClone(a)) : refuse(`${method} ${u}`);
}

export function dashMockApi(mod: typeof ApiModule) {
  const base = mockApi(mod);
  const asApi = (p: Promise<unknown>) =>
    p.catch((err: unknown) => {
      if (err instanceof NetError) throw new mod.ApiError(err.status, err.message, err.code);
      throw err;
    });
  const wrap =
    (method: string, fallback: (url: string, body?: unknown) => Promise<unknown>) =>
    (url: string, body?: unknown) => {
      const mine = method === "GET" ? dashGet(url) : dashWrite(method, url, body);
      return mine ? asApi(mine) : fallback(url, body);
    };
  return {
    ...base,
    api: {
      ...base.api,
      get: vi.fn(wrap("GET", (url) => base.api.get(url))),
      post: vi.fn(wrap("POST", (url, body) => base.api.post(url, body))),
      put: vi.fn(wrap("PUT", (url, body) => base.api.put(url, body))),
      del: vi.fn(wrap("DELETE", (url) => base.api.del(url))),
    },
  };
}

/** The bodies of the requests of one method and path, in order. */
export const sent = (method: string, path: string) =>
  net.calls.filter((c) => c.method === method && c.url.split("?")[0] === path).map((c) => c.body);
/** The requests of one method and path, as their whole URLs, in order. */
export const urls = (method: string, path: string) =>
  net.calls.filter((c) => c.method === method && c.url.split("?")[0] === path).map((c) => c.url);
