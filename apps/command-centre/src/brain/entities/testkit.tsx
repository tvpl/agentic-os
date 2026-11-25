/**
 * What the "Entidades" specs share (.specs/features/cerebro-entidades-resumos, S6 and the S8 card): the entity routes on
 * top of the notes-view stub, each answered only for what a test set (the list filtered by `kind`, `q`, `limit` and
 * `offset` over `kit.entities`, or `?file=` over `kit.byFile`; one entity by key from `kit.details`, any other key a
 * `404 not_found`; the suggestions, a run), the write routes answered only by the handler a test set (anything else a
 * `500`), the builders of an entity as the routes answer it, and the screen rendered with the providers the shells give
 * it, in pt-BR, with the route's `setLocation` recorded. "Now" is the claims' fixed clock, 2026-11-24 10:00 local.
 */
import { isDeepStrictEqual } from "node:util";
import { vi } from "vitest";
import { renderWith } from "../../contexts/testkit";
import type { CommandRegistry } from "../../commands/registry";
import { AppRouteContext } from "../../desktop/appRoute";
import { MEM, NetError, net, type Asked } from "../notes/testnet";
import type { ApiCallResult } from "@mordomo/contracts";
import EntitiesView, { type EntityDetail, type Suggestions } from "./EntitiesView";

type EntityItem = ApiCallResult<"GET /api/memory/entities">["items"][number];

export { MEM, NetError, net };

/** 2026-11-24 10:00 local, the claims' "now". */
export const NOW = new Date(2026, 10, 24, 10, 0, 0).getTime();

type Reply = unknown | Error | "pending";
type Handler = (body: unknown) => Promise<unknown>;

/** An entity of the list: `<kind>:<norm>` from its name, in `files` files. */
export function entity(
  kind: EntityItem["kind"],
  name: string,
  files = 1,
  aliases: string[] = [],
): EntityItem {
  const norm = name
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
  return { key: `${kind}:${norm}`, kind, name, aliases, files, mentions: files };
}

/** One entity as `GET /api/memory/entities/:key` answers it: no mention, no relation, unless `over` says. */
export function detail(e: EntityItem, over: Partial<EntityDetail> = {}): EntityDetail {
  return {
    key: e.key,
    kind: e.kind,
    name: e.name,
    aliases: e.aliases,
    mentions: [],
    related: [],
    duplicates: [],
    corrections: [],
    ...over,
  } as EntityDetail;
}

/** A mention of `name` in `<MEM>/notes/<file>` at `line`. */
export const mention = (fileId: number, file: string, line: number, excerpt: string, name: string) => ({
  fileId,
  path: `${MEM}/notes/${file}`,
  name,
  line,
  proof: "termo" as const,
  excerpt,
});

export const kit = {
  entities: [] as EntityItem[],
  /** A reply that wins over the table for the list (every kind and query). */
  list: null as Reply | null,
  details: new Map<string, Reply>(),
  byFile: new Map<number, Reply>(),
  suggestions: { items: [] } as Reply,
  runs: new Map<string, Reply>(),
  settings: {
    defaultProvider: "claude",
    memory: { entities: { enabled: true, llm: { enabled: false } } },
  } as Record<string, unknown>,
};

export const ROUTES = {
  correct: "POST /api/memory/entities/corrections",
  suggest: "POST /api/memory/entities/suggestions",
  settings: "PUT /api/settings",
} as const;

/** Set the handler of one write route. */
export const on = (route: keyof typeof ROUTES | `POST /api/runs/${string}/cancel`, handler: Handler) =>
  net.writes.set(route in ROUTES ? ROUTES[route as keyof typeof ROUTES] : route, handler);

/** A handler that answers `reply` to exactly `body` (a `NetError` is thrown), and `400 unexpected_body` otherwise. */
export const only =
  (body: unknown, reply: unknown): Handler =>
  (got) =>
    isDeepStrictEqual(got, body)
      ? reply instanceof Error
        ? Promise.reject(reply)
        : Promise.resolve(structuredClone(reply))
      : Promise.reject(new NetError(400, "unexpected_body", `unexpected body: ${JSON.stringify(got)}`));

/** What a correction answers: its id. */
export const wrote = (id: number, action: string) => ({
  correction: { id, action, names: [], createdAt: NOW },
});

const unexpected = () => Promise.reject(new NetError(500, "unexpected"));
const answer = (reply: Reply) =>
  reply === "pending"
    ? new Promise(() => undefined)
    : reply instanceof Error
      ? Promise.reject(reply)
      : Promise.resolve(structuredClone(reply));

/** The list as the route answers it, from the table. */
function listOf(u: Asked) {
  const kind = u.searchParams.get("kind");
  const q = (u.searchParams.get("q") ?? "").toLowerCase();
  const limit = Number(u.searchParams.get("limit") ?? 50);
  const offset = Number(u.searchParams.get("offset") ?? 0);
  const all = kit.entities.filter(
    (e) =>
      (!kind || e.kind === kind) &&
      (!q ||
        e.key
          .slice(e.key.indexOf(":") + 1)
          .split(" ")
          .some((w) => w.startsWith(q))),
  );
  return { items: all.slice(offset, offset + limit), total: all.length };
}

/** Reset the table and put the entity routes in front of the notes-view stub. Call in `beforeEach`. */
export function resetEntities(): void {
  kit.entities = [];
  kit.list = null;
  kit.details = new Map();
  kit.byFile = new Map();
  kit.suggestions = { items: [] };
  kit.runs = new Map();
  kit.settings = {
    defaultProvider: "claude",
    memory: { entities: { enabled: true, llm: { enabled: false } } },
  };
  for (const route of Object.values(ROUTES)) net.writes.set(route, unexpected);
  net.overrides.push((u: Asked) => {
    if (u.pathname === "/api/memory/entities") {
      const file = u.searchParams.get("file");
      if (file !== null) return answer(kit.byFile.get(Number(file)) ?? "pending");
      return answer(kit.list ?? listOf(u));
    }
    if (u.pathname === "/api/memory/entities/suggestions") return answer(kit.suggestions);
    const key = /^\/api\/memory\/entities\/([^/]+)$/.exec(u.pathname)?.[1];
    if (key !== undefined) {
      const reply = kit.details.get(decodeURIComponent(key));
      return reply === undefined ? Promise.reject(new NetError(404, "not_found")) : answer(reply);
    }
    const run = /^\/api\/runs\/([^/]+)$/.exec(u.pathname)?.[1];
    if (run !== undefined) return answer(kit.runs.get(run) ?? "pending");
    if (u.pathname === "/api/settings") return Promise.resolve(structuredClone(kit.settings));
    return undefined;
  });
}

/** What `GET /api/memory/entities/suggestions` answers next. */
export const suggests = (reply: Suggestions | Error | "pending") => void (kit.suggestions = reply);

/** The bodies of one write route, in order. */
export const sent = (route: string) => {
  const key = route in ROUTES ? ROUTES[route as keyof typeof ROUTES] : route;
  const [method, path] = key.split(" ");
  return net.calls.filter((c) => c.method === method && c.url.split("?")[0] === path).map((c) => c.body);
};

/** The screen, as the frame mounts it at `/brain/entities` (with `search`), and the route's moves. */
export function mountEntities({
  lang = "pt-BR",
  registry,
  search = "",
}: { lang?: "pt-BR" | "en"; registry?: CommandRegistry; search?: string } = {}) {
  const setLocation = vi.fn();
  const route = { pathname: "/brain/entities", search, setLocation };
  const rendered = renderWith(
    <AppRouteContext.Provider value={route}>
      <EntitiesView />
    </AppRouteContext.Provider>,
    { lang, ...(registry ? { registry } : {}) },
  );
  return { ...rendered, setLocation };
}

const q = <E extends Element = HTMLElement>(sel: string, root: ParentNode = document) => [
  ...root.querySelectorAll<E>(sel),
];
/** The list's rows, as buttons. */
export const rows = () => q<HTMLButtonElement>(".ent-view .ent-pick");
export const panel = () => document.querySelector<HTMLElement>(".ent-view .ent-panelcol");
export const card = () => document.querySelector<HTMLElement>(".ent-view .ent-ai");
/** `a` comes before `b` in the document. */
export const before = (a: Node, b: Node) =>
  (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
