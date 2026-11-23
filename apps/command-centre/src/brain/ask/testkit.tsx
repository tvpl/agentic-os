/**
 * What the "Perguntar" specs share (.specs/features/cerebro-perguntar, S5): the routes of an ask on top of the
 * notes-view stub, each answered only for what a test set (`GET /api/memory/ask` the list, `GET /api/memory/ask/:id` by
 * id, any other id a `404 not_found`), each write a handler that answers only the exact body a test expects (any other
 * body is a `400 unexpected_body`), the builders of an ask as the routes answer it, and the screen rendered with the
 * providers the shells give it, in pt-BR, with the route's `setLocation` recorded. The `vi.mock` calls stay in the spec
 * files. "Now" is the claims' fixed clock, 2026-11-22 10:00 local.
 */
import type { ReactElement } from "react";
import { isDeepStrictEqual } from "node:util";
import { vi } from "vitest";
import { renderWith } from "../../contexts/testkit";
import type { CommandRegistry } from "../../commands/registry";
import { AppRouteContext } from "../../desktop/appRoute";
import { MEM, NetError, net, type Asked } from "../notes/testnet";
import AskView, { type AskCitation, type AskDetail, type AskItem } from "./AskView";

export { MEM, NetError, net };

/** 2026-11-22 10:00 local, the claims' "now". */
export const NOW = new Date(2026, 10, 22, 10, 0, 0).getTime();

type Handler = (body: unknown) => Promise<unknown>;

/** A citation as the route answers it: `<MEM>/notes/<name>`, its section, its id, its nature when labelled. */
export function cite(name: string, section: string, fileId: number, natureza?: AskCitation["natureza"]) {
  return {
    path: `${MEM}/notes/${name}`,
    section,
    name,
    fileId,
    ...(natureza ? { natureza } : {}),
  } as AskCitation;
}

export const ONBOARDING = cite("onboarding.md", "Decisão", 1);
export const PLANO = cite("plano.md", "Próximos passos", 2, "plano");

/** A paragraph of an answer. */
export const para = (text: string, ...citations: AskCitation[]) => ({ text, citations });

/** An ask as `GET /api/memory/ask/:id` answers it: `answered` with two paragraphs, started at now and done in 42 s. */
export function detail(over: Partial<AskDetail> = {}): AskDetail {
  return {
    id: "run-1",
    question: "O que decidi sobre o onboarding?",
    mode: "direct",
    scope: { kind: "all" },
    status: "answered",
    answer: {
      paragraphs: [
        para("Você decidiu fazer o onboarding em duas etapas.", ONBOARDING),
        para("O próximo passo é **testar** com três clientes.", ONBOARDING, PLANO),
      ],
    },
    run: { provider: "claude", startedAt: NOW, finishedAt: NOW + 42_000 },
    ...over,
  } as AskDetail;
}

/** A line of `GET /api/memory/ask`. */
export function item(id: string, question: string, over: Partial<AskItem> = {}): AskItem {
  return {
    id,
    question,
    mode: "direct",
    scope: { kind: "all" },
    status: "answered",
    startedAt: NOW - 5 * 60_000,
    finishedAt: NOW - 4 * 60_000,
    ...over,
  } as AskItem;
}

type Reply = unknown | Error | "pending";
export const kit = {
  list: { items: [] } as Reply,
  details: new Map<string, Reply>(),
  settings: { memorySkills: ["recall"], folderAccess: [] } as Record<string, unknown>,
  areas: [] as Array<{ area: string; count: number }>,
};

/** What the list answers next. */
export const listed = (reply: AskItem[] | Error | "pending") =>
  void (kit.list = Array.isArray(reply) ? { items: reply } : reply);
/** What `GET /api/memory/ask/<id>` answers next. */
export const shows = (reply: AskDetail | Error | "pending", id = (reply as AskDetail).id) =>
  void kit.details.set(id, reply);

export const ROUTES = {
  ask: "POST /api/memory/ask",
  cancel: "POST /api/runs/run-1/cancel",
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

/** Reset the table and put the ask's routes in front of the notes-view stub. Call in `beforeEach`. */
export function resetAsk(): void {
  kit.list = { items: [] };
  kit.details = new Map();
  kit.settings = { memorySkills: ["recall"], folderAccess: [] };
  kit.areas = [];
  for (const route of Object.values(ROUTES)) net.writes.set(route, unexpected);
  net.overrides.push((u: Asked) => {
    if (u.pathname === "/api/memory/ask") return answer(kit.list);
    const id = /^\/api\/memory\/ask\/([^/]+)$/.exec(u.pathname)?.[1];
    if (id !== undefined) {
      const reply = kit.details.get(decodeURIComponent(id));
      return reply === undefined ? Promise.reject(new NetError(404, "not_found")) : answer(reply);
    }
    if (u.pathname === "/api/settings")
      return Promise.resolve({
        ...structuredClone(kit.settings),
        areas: [],
        folderAccess: kit.settings.folderAccess,
      });
    if (u.pathname === "/api/memory/status")
      return Promise.resolve({
        lastIndex: null,
        facets: { areas: structuredClone(kit.areas), exts: [], tags: [], total: 3 },
        indexing: {
          state: "idle",
          mode: "worker",
          runId: null,
          phase: null,
          scanned: 0,
          total: null,
          interrupted: false,
        },
        semantic: { enabled: false },
      });
    return undefined;
  });
}

/** The bodies of one write route, in order. */
export const sent = (route: string) => {
  const key = route in ROUTES ? ROUTES[route as keyof typeof ROUTES] : route;
  const [method, path] = key.split(" ");
  return net.calls.filter((c) => c.method === method && c.url.split("?")[0] === path).map((c) => c.body);
};
/** The `brain.ask` of each `PUT /api/ui-preferences`. */
export const savedAsk = () =>
  net.calls
    .filter((c) => c.method === "PUT" && c.url === "/api/ui-preferences")
    .map((c) => (c.body as { brain?: { ask?: unknown } }).brain?.ask);

/** The screen, as the frame mounts it at `/brain/ask` (with `search`), and the route's moves. */
export function mountAsk(
  {
    lang = "pt-BR",
    registry,
    search = "",
  }: { lang?: "pt-BR" | "en"; registry?: CommandRegistry; search?: string } = {},
  extra: ReactElement | null = null,
) {
  const setLocation = vi.fn();
  const route = { pathname: "/brain/ask", search, setLocation };
  const rendered = renderWith(
    <AppRouteContext.Provider value={route}>
      <AskView />
      {extra}
    </AppRouteContext.Provider>,
    { lang, ...(registry ? { registry } : {}) },
  );
  return { ...rendered, setLocation };
}

const q = <E extends Element = HTMLElement>(sel: string, root: ParentNode = document) => [
  ...root.querySelectorAll<E>(sel),
];
/** The button "Perguntar" (or "Nova pergunta"). */
export const sendButton = () => document.querySelector<HTMLButtonElement>(".ask-send button")!;
export const questionField = () =>
  document.querySelector<HTMLTextAreaElement>(`textarea[placeholder^="Ex.:"]`)!;
/** The text fields of the view, in DOM order, by their labels. */
export const fieldLabels = () => q<HTMLLabelElement>(".ask-fields label").map((l) => l.textContent);
export const result = () => document.querySelector<HTMLElement>(".ask-result");
export const rows = () => q<HTMLButtonElement>(".ask-row");
/** The citation buttons under `root`, by name. */
export const cites = (root: ParentNode = document) =>
  q<HTMLButtonElement>(".ask-cite", root).map((b) => b.textContent);
/** `a` comes before `b` in the document. */
export const before = (a: Node, b: Node) =>
  (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
