/**
 * What the "Resumos" specs share (.specs/features/cerebro-entidades-resumos, S7): the summaries routes on top of the
 * notes-view stub, each answered only for what a test set (the list; one scope's summary by `<kind>:<id>`, any other a
 * `404 scope_not_found`; the active runs and each run's request, for "Cancelar"; the settings), the write routes
 * answered only by the handler a test set (anything else a `500`), the builders of an item and of a summary as the
 * routes answer them, and the screen rendered with the providers the shells give it, in pt-BR, with the route's
 * `setLocation` recorded. "Now" is the claims' fixed clock, 2026-11-24 10:00 local.
 */
import { isDeepStrictEqual } from "node:util";
import { vi } from "vitest";
import { renderWith } from "../../contexts/testkit";
import type { CommandRegistry } from "../../commands/registry";
import { AppRouteContext } from "../../desktop/appRoute";
import { MEM, NetError, net, type Asked } from "../notes/testnet";
import type { ApiCallResult } from "@mordomo/contracts";
import SummariesView from "./SummariesView";

type Item = ApiCallResult<"GET /api/memory/summaries">["items"][number];
type Detail = ApiCallResult<"GET /api/memory/summaries/:kind/:id">;

export { MEM, NetError, net };

/** 2026-11-24 10:00 local, the claims' "now". */
export const NOW = new Date(2026, 10, 24, 10, 0, 0).getTime();

type Reply = unknown | Error | "pending";
type Handler = (body: unknown) => Promise<unknown>;

/** A scope of the list: an area is named by its name, a context by an id. */
export function item(kind: "area" | "context", name: string, over: Partial<Item> = {}): Item {
  return {
    scope: { kind, id: kind === "area" ? name : `ctx-${name.toLowerCase().replace(/\W+/g, "-")}`, name },
    state: "missing",
    running: false,
    ...over,
  };
}

/** One scope's summary as `GET /api/memory/summaries/:kind/:id` answers it. */
export function detail(i: Item, over: Partial<Detail> = {}): Detail {
  return { ...i, sources: [], ...over } as Detail;
}

/** A paragraph and the notes it cites (`<MEM>/notes/<file>`). */
export const paragraph = (
  text: string,
  cites: Array<[string, string, number, ("plano" | undefined)?]> = [],
) => ({
  text,
  citations: cites.map(([name, section, fileId, natureza]) => ({
    path: `${MEM}/notes/${name}`,
    section,
    name,
    fileId,
    ...(natureza ? { natureza } : {}),
  })),
});

export const kit = {
  items: [] as Item[],
  /** A reply that wins over the table for the list. */
  list: null as Reply | null,
  details: new Map<string, Reply>(),
  /** What `GET /api/runs?statusGroup=active` answers. */
  active: [] as Array<Record<string, unknown>>,
  /** `GET /api/runs/:id`, by id. */
  runs: new Map<string, Reply>(),
  settings: { defaultProvider: "claude", memorySkills: ["recall", "x"] } as Record<string, unknown>,
};

export const ROUTES = {
  start: "POST /api/memory/summaries",
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

const unexpected = () => Promise.reject(new NetError(500, "unexpected"));
const answer = (reply: Reply) =>
  reply === "pending"
    ? new Promise(() => undefined)
    : reply instanceof Error
      ? Promise.reject(reply)
      : Promise.resolve(structuredClone(reply));

/** Reset the table and put the summaries routes in front of the notes-view stub. Call in `beforeEach`. */
export function resetSummaries(): void {
  kit.items = [];
  kit.list = null;
  kit.details = new Map();
  kit.active = [];
  kit.runs = new Map();
  kit.settings = { defaultProvider: "claude", memorySkills: ["recall", "x"] };
  for (const route of Object.values(ROUTES)) net.writes.set(route, unexpected);
  net.overrides.push((u: Asked) => {
    if (u.pathname === "/api/memory/summaries") return answer(kit.list ?? { items: kit.items });
    const one = /^\/api\/memory\/summaries\/(area|context)\/([^/]+)$/.exec(u.pathname);
    if (one) {
      const reply = kit.details.get(`${one[1]}:${decodeURIComponent(one[2]!)}`);
      return reply === undefined ? Promise.reject(new NetError(404, "scope_not_found")) : answer(reply);
    }
    if (u.pathname === "/api/runs") return answer(kit.active);
    const run = /^\/api\/runs\/([^/]+)$/.exec(u.pathname)?.[1];
    if (run !== undefined) return answer(kit.runs.get(run) ?? "pending");
    if (u.pathname === "/api/settings") return Promise.resolve(structuredClone(kit.settings));
    return undefined;
  });
}

/** The bodies of one write route, in order. */
export const sent = (route: string) => {
  const key = route in ROUTES ? ROUTES[route as keyof typeof ROUTES] : route;
  const [method, path] = key.split(" ");
  return net.calls.filter((c) => c.method === method && c.url.split("?")[0] === path).map((c) => c.body);
};

/** The screen, as the frame mounts it at `/brain/summaries` (with `search`), and the route's moves. */
export function mountSummaries({
  lang = "pt-BR",
  registry,
  search = "",
}: { lang?: "pt-BR" | "en"; registry?: CommandRegistry; search?: string } = {}) {
  const setLocation = vi.fn();
  const route = { pathname: "/brain/summaries", search, setLocation };
  const rendered = renderWith(
    <AppRouteContext.Provider value={route}>
      <SummariesView />
    </AppRouteContext.Provider>,
    { lang, ...(registry ? { registry } : {}) },
  );
  return { ...rendered, setLocation };
}

/** The scope's search: `?kind=area&id=<name>`. */
export const searchOf = (i: Item) => `?kind=${i.scope.kind}&id=${encodeURIComponent(i.scope.id)}`;

const q = <E extends Element = HTMLElement>(sel: string, root: ParentNode = document) => [
  ...root.querySelectorAll<E>(sel),
];
/** The list's rows, as the buttons that open them. */
export const picks = () => q<HTMLButtonElement>(".sum-view .sum-pick");
export const rowOf = (name: string) =>
  q<HTMLElement>(".sum-view .sum-row").find((r) => r.querySelector(".sum-name")?.textContent === name)!;
export const panel = () => document.querySelector<HTMLElement>(".sum-view .sum-panelcol");
/** `a` comes before `b` in the document. */
export const before = (a: Node, b: Node) =>
  (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
