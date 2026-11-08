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
/** `n` calendar months before `from`, clamped to the month's last day (31 Oct minus 4 months is 30 Jun, not 1 Jul). */
export function monthsBefore(from: Date, n: number): Date {
  const d = new Date(from.getTime());
  const day = d.getDate();
  d.setDate(1);
  d.setMonth(d.getMonth() - n);
  d.setDate(Math.min(day, new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate()));
  return d;
}
export function dayBefore(days: number, months = 0): string {
  const d = monthsBefore(new Date(), months);
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

/* ---- the agent's proposals (.specs/features/cerebro-memoria-confiavel, C88-C96, C103) ---- */

type ProposalRow = {
  id: string;
  kind: "consolidation" | "memory_edit" | "fact" | "note_create" | "note_save";
  status: "pending";
  author: string;
  runId: string | null;
  createdAt: number;
  summary: string;
  opCount: number;
};
type Op = {
  op: "add" | "supersede" | "close_loop" | "move_to_topic" | "fact";
  section: string | null;
  text: string;
  source: string | null;
  line: number | null;
  trust: "usuario" | "ferramenta" | "inferido";
  state: "valid" | "invalid" | "conflict";
  reason?: string;
};

let pids = 0;
/** A proposal of the list, `mp_` and 16 hex digits. */
export function proposal(over: Partial<ProposalRow> = {}): ProposalRow {
  const id = `mp_${(++pids).toString(16).padStart(16, "0")}`;
  return {
    id,
    kind: "consolidation",
    status: "pending",
    author: "run:a1b2c3",
    runId: "a1b2c3",
    createdAt: Date.now() - 2 * 3_600_000,
    summary: "Três decisões da semana.",
    opCount: 3,
    ...over,
  };
}

export const op = (over: Partial<Op> = {}): Op => ({
  op: "add",
  section: "Decisions",
  text: "Usar SQLite para o histórico",
  source: "journal/2026-09-03.md#Decisions",
  line: 12,
  trust: "usuario",
  state: "valid",
  ...over,
});

/**
 * The proposals routes: the list answers `GET /api/memory/proposals?status=pending` only (any other query is a
 * `400 unexpected_query`, L-052); a detail by its id; the decision and the skill run as handlers a test sets.
 */
export const proposals = {
  list: { items: [] as ProposalRow[], total: 0 } as
    { items: ProposalRow[]; total: number } | Error | "pending",
  details: new Map<string, Record<string, unknown> | Error>(),
  decide: (_id: string, _body: unknown): Promise<unknown> => Promise.reject(new NetError(500, "unexpected")),
  run: (_body: unknown): Promise<unknown> => Promise.reject(new NetError(500, "unexpected")),
};

/** The list the route answers, `total` its length unless given. */
export function pending(items: ProposalRow[], total = items.length): void {
  proposals.list = { items, total };
}

/** What accepting one fact does (`FactEffect` of the contract): nothing, until the test says so. */
export type Effect = {
  op: number | null;
  subject: string;
  predicate: string;
  object: string;
  validFrom: number;
  validTo: number | null;
  unchanged: number | null;
  closes: Array<{
    id: number;
    object: string;
    validFrom: number;
    validTo: number | null;
    action: "close" | "retract";
    at: number;
  }>;
  refuses: {
    id: number;
    object: string;
    validFrom: number;
    validTo: number | null;
    /** `covers`: the fact began before the new period and lasts beyond it; `starts_inside`: it begins inside it. */
    reason: "covers" | "starts_inside";
  } | null;
  error?: string;
};
/** The fact accepting is refused for (`refuses` of an effect), `ativo` over the whole period unless told otherwise. */
export const refusal = (reason: "covers" | "starts_inside" = "covers", object = "ativo") => ({
  id: 9,
  object,
  validFrom: Date.UTC(2026, 0, 1),
  validTo: null,
  reason,
});
export const effect = (over: Partial<Effect> = {}): Effect => ({
  op: null,
  subject: "Cliente X",
  predicate: "status",
  object: "inadimplente",
  validFrom: Date.UTC(2026, 5, 1, 15),
  validTo: null,
  unchanged: null,
  closes: [],
  refuses: null,
  ...over,
});

/** The detail of `p`: its ops, its diff, the `baseVersion` it read and the `effects` of its facts (none unless given). */
export function detailOf(
  p: ProposalRow,
  over: { ops?: Op[]; diff?: string; baseVersion?: string | null; effects?: Effect[] } = {},
) {
  const answer = {
    ...p,
    decidedAt: null,
    payload: {},
    result: null,
    ops: over.ops ?? [],
    diff: over.diff ?? "",
    baseVersion: over.baseVersion === undefined ? "sha256:mem1" : over.baseVersion,
    effects: over.effects ?? [],
  };
  proposals.details.set(p.id, answer);
  net.writes.set(`POST /api/memory/proposals/${p.id}/decide`, (b) => proposals.decide(p.id, b));
  return answer;
}

export function resetProposals(): void {
  proposals.list = { items: [], total: 0 };
  proposals.details = new Map();
  proposals.decide = () => Promise.reject(new NetError(500, "unexpected"));
  proposals.run = () => Promise.reject(new NetError(500, "unexpected"));
  net.overrides.push((u: Asked) => {
    if (u.pathname === "/api/memory/proposals") {
      if ([...u.searchParams].length !== 1 || u.searchParams.get("status") !== "pending")
        return Promise.reject(new NetError(400, "unexpected_query", `unexpected query: ${u.searchParams}`));
      const answer = proposals.list;
      if (answer === "pending") return new Promise(() => undefined);
      return answer instanceof Error ? Promise.reject(answer) : Promise.resolve(structuredClone(answer));
    }
    const one = /^\/api\/memory\/proposals\/(mp_[0-9a-f]{16})$/.exec(u.pathname);
    if (one) {
      const answer = proposals.details.get(one[1]!);
      if (!answer) return Promise.reject(new NetError(404, "not_found"));
      return answer instanceof Error ? Promise.reject(answer) : Promise.resolve(structuredClone(answer));
    }
    return undefined;
  });
  net.writes.set("POST /api/skills/consolidate-memory/run", (b) => proposals.run(b));
}

/** A decision's answer as the route gives it. */
export const accepted = (p: ProposalRow, written: Array<{ path: string; version: string }> = []) => ({
  proposal: { ...p, status: "accepted", decidedAt: Date.now(), payload: {}, result: { action: "accept" } },
  written,
  facts: [],
});
