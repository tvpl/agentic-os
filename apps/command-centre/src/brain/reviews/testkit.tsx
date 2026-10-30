/**
 * What the "Revisões" specs share (.specs/features/cerebro-natureza, S5): `GET /api/memory/reviews` answered from a
 * table keyed by the whole query it is asked (kind, context, natureza, escopo: L-052), so a scope the screen drops or
 * gets wrong shows another list; the notes of the items in the notes-view stub of the network (`../notes/testnet`), with
 * their version and properties; the decisions and the undo routes as handlers a test sets; and the screen rendered with
 * the providers the shells give it, in pt-BR. The `vi.mock` calls stay in the spec files.
 */
import type { ReactElement } from "react";
import { screen, within } from "@testing-library/react";
import { renderWith } from "../../contexts/testkit";
import type { CommandRegistry } from "../../commands/registry";
import { AppRouteContext } from "../../desktop/appRoute";
import { MEM, NetError, WORK, net, note, type Asked } from "../notes/testnet";
import ReviewsScreen, { type ReviewItem } from "./ReviewsScreen";

export { MEM, NetError, WORK, net };
export const DAY = 86_400_000;

const pad = (n: number) => String(n).padStart(2, "0");
/** The local day `AAAA-MM-DD` that is `days` before today (`months` months before, when given). */
export function dayBefore(days: number, months = 0): string {
  const d = new Date();
  d.setMonth(d.getMonth() - months);
  d.setDate(d.getDate() - days);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
export const dayAfter = (days: number) => dayBefore(-days);

let ids = 100;
/**
 * A list item of the route, and its file in the notes stub (its content and front matter, its version `sha256:<id>`).
 * `rel` under memory/ is editable; under the indexed folder it is not.
 */
export function item(
  rel: string,
  over: Partial<ReviewItem> & {
    root?: string;
    content?: string;
    properties?: Array<{ key: string; kind: string; value: string | string[] }>;
  } = {},
): ReviewItem {
  const { root = MEM, content, properties, ...rest } = over;
  const id = ++ids;
  note(id, root, rel, {
    content: content ?? `# ${rel}\n\nO texto de ${rel}.\n`,
    properties: properties ?? [],
    editable: root === MEM,
  });
  return {
    path: `${root}/${rel}`,
    name: rel.slice(rel.lastIndexOf("/") + 1),
    natureza: null,
    type: null,
    escopo: null,
    lastReviewed: dayBefore(0, 4),
    dueSince: dayBefore(1),
    editable: root === MEM,
    mtime: Date.now() - 200 * DAY,
    ...rest,
  };
}

type Query = { kind?: string; context?: string; natureza?: string; escopo?: string };
type ListAnswer = { items: ReviewItem[]; total: number; nextDue: string | null };

/** The table of lists: each answer for exactly one query; `wrong` for any other. */
export const reviews = {
  lists: [] as Array<{ query: Query; answer: ListAnswer | Error | "pending" }>,
  wrong: { items: [] as ReviewItem[], total: 0, nextDue: null as string | null },
  decide: (_body: unknown): Promise<unknown> => Promise.reject(new NetError(500, "unexpected")),
  props: (_body: unknown): Promise<unknown> => Promise.reject(new NetError(500, "unexpected")),
  retract: (_id: string): Promise<unknown> => Promise.reject(new NetError(500, "unexpected")),
};

/** The answer to the query `query` (kind `due` when left out), as the route reads it. */
export function list(query: Query, items: ReviewItem[] | Error | "pending", over: Partial<ListAnswer> = {}) {
  const answer = Array.isArray(items) ? { items, total: items.length, nextDue: null, ...over } : items;
  reviews.lists.push({ query: { kind: "due", ...query }, answer });
}

const same = (u: URLSearchParams, q: Query) =>
  (["kind", "context", "natureza", "escopo"] as const).every(
    (k) => (k === "kind" ? (u.get(k) ?? "due") : u.get(k)) === (q[k] ?? null),
  );

/** Reset the table and put the reviews routes in front of the notes-view stub. Call in `beforeEach`. */
export function resetReviews(): void {
  reviews.lists = [];
  reviews.wrong = { items: [], total: 0, nextDue: null };
  reviews.decide = () => Promise.reject(new NetError(500, "unexpected"));
  reviews.props = () => Promise.reject(new NetError(500, "unexpected"));
  reviews.retract = () => Promise.reject(new NetError(500, "unexpected"));
  net.overrides.push((u: Asked) => {
    if (u.pathname !== "/api/memory/reviews") return undefined;
    const hit = [...reviews.lists].reverse().find((l) => same(u.searchParams, l.query));
    const answer = hit?.answer ?? reviews.wrong;
    if (answer === "pending") return new Promise(() => undefined);
    return answer instanceof Error ? Promise.reject(answer) : Promise.resolve(structuredClone(answer));
  });
  net.writes.set("POST /api/memory/reviews", (b) => reviews.decide(b));
  net.writes.set("PUT /api/memory/notes/properties", (b) => reviews.props(b));
  for (let id = 1; id < 50; id++)
    net.writes.set(`POST /api/memory/facts/${id}/retract`, () => reviews.retract(String(id)));
}

/** A decision's answer as the route gives it (door 4). */
export const decided = (path: string, over: Record<string, unknown> = {}) => ({
  path,
  state: null,
  previous: null,
  ...over,
});

/** The requests of one method and path, with their bodies, in order. */
export const sent = (method: string, path: string) =>
  net.calls.filter((c) => c.method === method && c.url.split("?")[0] === path).map((c) => c.body);

/** The screen, as the frame mounts it at `/brain/reviews` (with `search`, the panel's query, e.g. `?path=…`). */
export function mountReviews(
  {
    lang = "pt-BR",
    search = "",
    registry,
  }: { lang?: "pt-BR" | "en"; search?: string; registry?: CommandRegistry } = {},
  extra: ReactElement | null = null,
) {
  const route = { pathname: "/brain/reviews", search, setLocation: () => undefined };
  return renderWith(
    <AppRouteContext.Provider value={route}>
      <ReviewsScreen />
      {extra}
    </AppRouteContext.Provider>,
    { lang, ...(registry ? { registry } : {}) },
  );
}

/** The list's items, top to bottom, as their names. */
export const names = () => [...document.querySelectorAll(".rv-item .rv-name")].map((e) => e.textContent);
/** The detail's buttons, left to right, by text. */
export const actions = () =>
  [...document.querySelectorAll<HTMLButtonElement>(".rv-acts button")].map((b) => b.textContent!.trim());
/** The item of the list named `name`. */
export const itemNamed = (name: string) =>
  [...document.querySelectorAll<HTMLElement>(".rv-item")].find(
    (li) => li.querySelector(".rv-name")?.textContent === name,
  )!;
export const detail = () => within(document.querySelector<HTMLElement>(".rv-detail")!);
export const notice = () => document.querySelector(".rv-notice");
export const listStatus = () => document.querySelector(".rv-status")?.textContent;
export const findList = () => screen.findByRole("list", { name: "Revisões" });
