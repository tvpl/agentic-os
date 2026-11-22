/**
 * What the "Revisão semanal" specs share (.specs/features/cerebro-rituais, S5): `GET /api/memory/weekly-review`
 * answered only for the query it is given (the active context, or none: L-052; any other query is a `400
 * unexpected_query`), each write a handler that answers only the exact body a test expects (any other body is a `400
 * unexpected_body`), the builders of a list as the route answers it, and the screen rendered with the providers the
 * shells give it, in pt-BR. The `vi.mock` calls stay in the spec files.
 */
import type { ReactElement } from "react";
import { isDeepStrictEqual } from "node:util";
import { renderWith } from "../../contexts/testkit";
import type { CommandRegistry } from "../../commands/registry";
import { AppRouteContext } from "../../desktop/appRoute";
import { MEM, NetError, WORK, net, type Asked } from "../notes/testnet";
import WeeklyReview from "./WeeklyReview";

export { MEM, NetError, WORK, net };

type Answer = Record<string, unknown>;
type Handler = (body: unknown) => Promise<unknown>;

let keys = 0;
/** A loop as the route lists it: a 64-hex key, 18 days old, one source unless given. */
export function loop(text: string, over: Record<string, unknown> = {}) {
  const key = (++keys).toString(16).padStart(64, "0");
  return {
    key,
    text,
    day: "2026-10-22",
    ageDays: 18,
    sources: [{ path: `${MEM}/journal/2026-10-22.md`, line: 4 }],
    ...over,
  };
}

/** A project of `projects` (or `someday.projects`): editable under memory/, with its version `sha256:<title>`. */
export function project(title: string, over: Record<string, unknown> = {}) {
  const slug = title.toLowerCase().replace(/\W+/g, "-");
  return {
    path: `${MEM}/notes/${slug}.md`,
    title,
    status: "active",
    due: null,
    health: "on_track",
    nextAction: { line: 8, text: "Ligar" },
    lastReviewed: null,
    reviewBy: null,
    reviewDue: false,
    editable: true,
    version: `sha256:${slug}`,
    ...over,
  };
}

/** A whole answer of the list: the week of Monday 2026-11-09, nothing in any list unless given. */
export function weekly(over: Record<string, unknown> = {}): Answer {
  const loops = (over.loopItems as unknown[]) ?? [];
  const projects = (over.projectItems as unknown[]) ?? [];
  const archive = (over.archiveItems as unknown[]) ?? [];
  const inbox = (over.inboxItems as unknown[]) ?? [];
  const rest = { ...over };
  for (const k of ["loopItems", "projectItems", "archiveItems", "inboxItems"]) delete rest[k];
  return {
    week: "2026-11-09",
    finishedAt: null,
    counts: { loops: 0, projects: 0, archived: 0 },
    nextReminder: null,
    loops: { items: loops, total: loops.length },
    projects: { items: projects, total: projects.length },
    someday: { loops: [], projects: [] },
    archive: { items: archive, total: archive.length },
    inbox: { items: inbox, total: inbox.length },
    reviewsDue: 0,
    ...rest,
  };
}

/** The list's answers, each for exactly one query (`{}` for none), and the writes' handlers. */
export const kit = {
  lists: [] as Array<{ query: Record<string, string>; answer: Answer | Error | "pending" }>,
};

/** The answer to `query` (the last one given wins, so a test can change what the next read gets). */
export function answer(answer: Answer | Error | "pending", query: Record<string, string> = {}): void {
  kit.lists.push({ query, answer });
}

/** A handler that answers `reply` to exactly `body`, and `400 unexpected_body` to anything else. */
export const only =
  (body: unknown, reply: unknown | (() => unknown)): Handler =>
  (got) =>
    isDeepStrictEqual(got, body)
      ? Promise.resolve(typeof reply === "function" ? (reply as () => unknown)() : reply)
      : Promise.reject(new NetError(400, "unexpected_body", `unexpected body: ${JSON.stringify(got)}`));

/** Handlers answering each exact body in turn (the decision, then its undo). */
export const each =
  (...pairs: Array<[unknown, unknown]>): Handler =>
  (got) => {
    const hit = pairs.find(([b]) => isDeepStrictEqual(got, b));
    return hit
      ? Promise.resolve(hit[1])
      : Promise.reject(new NetError(400, "unexpected_body", `unexpected body: ${JSON.stringify(got)}`));
  };

export const ROUTES = {
  loops: "POST /api/memory/weekly-review/loops",
  archive: "POST /api/memory/weekly-review/archive",
  finish: "POST /api/memory/weekly-review/finish",
  tasks: "POST /api/memory/tasks",
  reviews: "POST /api/memory/reviews",
  props: "PUT /api/memory/notes/properties",
  undo: "POST /api/memory/cleanup/undo",
} as const;

/** Set the handler of one write route. */
export const on = (route: keyof typeof ROUTES, handler: Handler) => net.writes.set(ROUTES[route], handler);

const unexpected = () => Promise.reject(new NetError(500, "unexpected"));

/** Reset the table and put the weekly route in front of the notes-view stub. Call in `beforeEach`. */
export function resetWeekly(): void {
  kit.lists = [];
  for (const route of Object.values(ROUTES)) net.writes.set(route, unexpected);
  net.overrides.push((u: Asked) => {
    if (u.pathname !== "/api/memory/weekly-review") return undefined;
    const asked = Object.fromEntries(u.searchParams);
    const hit = [...kit.lists].reverse().find((l) => isDeepStrictEqual(l.query, asked));
    if (!hit)
      return Promise.reject(new NetError(400, "unexpected_query", `unexpected query: ${u.searchParams}`));
    if (hit.answer === "pending") return new Promise(() => undefined);
    return hit.answer instanceof Error
      ? Promise.reject(hit.answer)
      : Promise.resolve(structuredClone(hit.answer));
  });
}

/** The requests of one route ("POST /api/…"), with their bodies, in order. */
export const sent = (route: keyof typeof ROUTES) => {
  const [method, path] = ROUTES[route].split(" ");
  return net.calls.filter((c) => c.method === method && c.url.split("?")[0] === path).map((c) => c.body);
};
/** The GETs of the list, as their query strings. */
export const reads = () =>
  net.calls
    .filter((c) => c.method === "GET" && c.url.split("?")[0] === "/api/memory/weekly-review")
    .map((c) => c.url.split("?")[1] ?? "");

/** The screen, as the frame mounts it at `/brain/weekly`. */
export function mountWeekly(
  { lang = "pt-BR", registry }: { lang?: "pt-BR" | "en"; registry?: CommandRegistry } = {},
  extra: ReactElement | null = null,
) {
  const route = { pathname: "/brain/weekly", search: "", setLocation: () => undefined };
  return renderWith(
    <AppRouteContext.Provider value={route}>
      <WeeklyReview />
      {extra}
    </AppRouteContext.Provider>,
    { lang, ...(registry ? { registry } : {}) },
  );
}

const q = <E extends Element = HTMLElement>(sel: string, root: ParentNode = document) => [
  ...root.querySelectorAll<E>(sel),
];
/** The step bar's buttons, by text. */
export const stepButtons = () => q<HTMLButtonElement>(".wk-steps button");
export const stepNow = () => document.querySelector(".wk-now")?.textContent;
/** The items of the page, top to bottom. */
export const itemsOn = () => q<HTMLLIElement>(".wk-item");
/** The item whose text holds `text`. */
export const itemWith = (text: string) => itemsOn().find((li) => li.textContent!.includes(text))!;
/** An item's buttons, left to right, by text. */
export const actionsOf = (li: Element) =>
  q<HTMLButtonElement>(".wk-acts button", li).map((b) => b.textContent!.trim());
export const button = (li: Element, name: string) =>
  q<HTMLButtonElement>("button", li).find((b) => b.textContent!.trim() === name)!;
export const notice = () => document.querySelector(".wk-notice");
export const status = () => document.querySelector(".wk-status")?.textContent;
/** `a` comes before `b` in the document. */
export const before = (a: Node, b: Node) =>
  (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
/** The texts of `els`, in document order, must read `texts` in that order. */
export function inOrder(root: Element, texts: string[]): boolean {
  const all = root.textContent ?? "";
  let at = -1;
  for (const text of texts) {
    const i = all.indexOf(text, at + 1);
    if (i < 0 || i <= at) return false;
    at = i;
  }
  return true;
}
