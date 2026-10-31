// @vitest-environment jsdom
/**
 * "Histórico da memória" (.specs/features/cerebro-memoria-confiavel, C102; design.md "Diálogo - Histórico da memória";
 * G18): an item (`History`) of the NOTAS heading's `Menu`, its last tool after "Ordenar", and a registry command
 * (`global`, `palette: true`); both open a 720px `Modal` with the rows the route answers for `?limit=100` (and no other
 * query, L-052), each with, in order, the path in mono 12px, the time, the author and the origin; a path gone carries
 * "Apagada" and "Restaurar", which asks `?path=<it>` and opens the version dialog on its newest version with bytes; the
 * empty, loading and failed states.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import postcss from "postcss";
import type * as ApiModule from "../../api";
import type * as EventsModule from "../../hooks/useEventStream";
import { installPage } from "../../ui/testkit";
import { renderWith } from "../../contexts/testkit";
import { mountShell } from "../../commands/testkit";
import { CommandRegistry } from "../../commands/registry";
import { MemoryHistoryHost } from "../MemoryHistoryHost";
import NotesView from "./NotesView";
import { MEM, NetError, asked, net, note, resetNet, type Asked } from "./testnet";

vi.mock("../../api", async (importOriginal) =>
  (await import("./testnet")).mockApi(await importOriginal<typeof ApiModule>()),
);
vi.mock("../../hooks/useEventStream", async (importOriginal) => ({
  ...(await importOriginal<typeof EventsModule>()),
  useOsEvent: (await import("./testnet")).useOsEventMock,
}));
vi.mock("../../nucleo/scenes/BrainSceneCanvas", () => ({ BrainSceneCanvas: () => null }));
vi.mock("../BrainCanvas", () => ({ BrainCanvas: () => null }));
vi.setConfig({ testTimeout: 30_000 });

beforeAll(() => {
  const noop = () => undefined;
  const ctx = new Proxy(
    {},
    { get: (_t, p) => (p === "measureText" ? () => ({ width: 0 }) : noop), set: () => true },
  );
  HTMLCanvasElement.prototype.getContext = function () {
    return ctx;
  } as unknown as typeof HTMLCanvasElement.prototype.getContext;
});
installPage();

type Version = {
  id: number;
  path: string;
  at: number;
  author: string;
  origin: string;
  size: number | null;
  sha256: string | null;
  exists: boolean;
};
let vids = 0;
const version = (over: Partial<Version> = {}): Version => ({
  id: ++vids,
  path: "notes/a.md",
  at: Date.now() - 3 * 3_600_000,
  author: "owner",
  origin: "save",
  size: 10,
  sha256: `sha256:v${vids}`,
  exists: true,
  ...over,
});
const all = { list: [] as Version[] | Error | "pending", byPath: new Map<string, Version[]>() };

beforeEach(() => {
  resetNet();
  note(1, MEM, "notes/plano.md", { title: "Plano" });
  all.list = [];
  all.byPath = new Map();
  net.overrides.push((u: Asked) => {
    if (u.pathname === "/api/memory/history") {
      const q = [...u.searchParams];
      if (q.length === 1 && u.searchParams.get("limit") === "100") {
        const answer = all.list;
        if (answer === "pending") return new Promise(() => undefined);
        return answer instanceof Error
          ? Promise.reject(answer)
          : Promise.resolve({ versions: structuredClone(answer) });
      }
      const p = u.searchParams.get("path");
      if (q.length === 1 && p && all.byPath.has(p))
        return Promise.resolve({ versions: structuredClone(all.byPath.get(p)!) });
      return Promise.reject(new NetError(400, "unexpected_query", `unexpected: ${u.searchParams}`));
    }
    const one = /^\/api\/memory\/history\/(\d+)$/.exec(u.pathname);
    if (one)
      return Promise.resolve({
        id: Number(one[1]),
        path: "notes/velha.md",
        at: Date.now(),
        author: "owner",
        origin: "save",
        content: "# Velha\n",
        diff: "@@ -0,0 +1 @@\n+# Velha\n",
        current: null,
      });
    return undefined;
  });
});

const view = () =>
  renderWith(
    <>
      <NotesView onShowInGraph={() => undefined} />
      <MemoryHistoryHost />
    </>,
    { lang: "pt-BR" },
  );
const pad = (n: number) => String(n).padStart(2, "0");
const when = (at: number) => {
  const d = new Date(at);
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
};
const css = (selector: string) => {
  const out: Record<string, string> = {};
  postcss.parse(readFileSync(join(__dirname, "history.css"), "utf8")).walkRules((r) => {
    if (r.parent?.type === "root" && r.selectors.includes(selector))
      r.walkDecls((d) => void (out[d.prop] = d.value));
  });
  return out;
};

/** Open the dialog from the NOTAS heading's menu. */
async function fromMenu() {
  view();
  const side = await screen.findByRole("complementary", { name: "Notas" });
  const heading = within(side).getByRole("heading", { name: "NOTAS" });
  const tools = heading.parentElement!.querySelector(".notes-heading-tools")!;
  const more = await within(tools as HTMLElement).findByRole("button", { name: "Mais para as notas" });
  const user = userEvent.setup();
  await user.click(more);
  const item = await screen.findByRole("menuitem", { name: "Histórico da memória" });
  await user.click(item);
  return { tools, more, item };
}

describe("C102 where Histórico da memória opens", () => {
  it("C102 the NOTAS heading's Menu is its last tool, after Ordenar, with the item Histórico da memória (History); it opens the 720px Modal", async () => {
    all.list = [version()];
    const user = userEvent.setup();
    view();
    const side = await screen.findByRole("complementary", { name: "Notas" });
    const heading = within(side).getByRole("heading", { name: "NOTAS" });
    const tools = heading.parentElement!.querySelector<HTMLElement>(".notes-heading-tools")!;
    const sort = await within(tools).findByRole("button", { name: "Ordenar" });
    const more = within(tools).getByRole("button", { name: "Mais para as notas" });
    expect(more.querySelector("svg.lucide-ellipsis, svg.lucide-more-horizontal")).not.toBeNull();
    expect(sort.compareDocumentPosition(more) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    const buttons = [...tools.querySelectorAll("button")];
    expect(buttons.at(-1)).toBe(more);
    await user.click(more);
    const item = await screen.findByRole("menuitem", { name: "Histórico da memória" });
    expect(item.querySelector("svg.lucide-history")).not.toBeNull();
    await user.click(item);
    const dialog = await screen.findByRole("dialog", { name: "Histórico da memória" });
    expect(dialog.className).toContain("mc-wide");
    expect(css(".modal.mc-wide")).toMatchObject({ width: "min(720px, 100%)" });
  });

  it("C102 the registry holds Histórico da memória (global, palette: true), and running it opens the same Modal", async () => {
    window.localStorage.setItem(
      "mordomo.onboarding.v1",
      JSON.stringify({ version: 1, status: "completed", step: 12, visited: [], practiced: false }),
    );
    globalThis.IntersectionObserver ??= class {
      observe() {}
      unobserve() {}
      disconnect() {}
      takeRecords() {
        return [];
      }
    } as unknown as typeof IntersectionObserver;
    Element.prototype.scrollIntoView ??= () => undefined;
    Element.prototype.scrollTo ??= () => undefined;
    all.list = [version()];
    const registry = new CommandRegistry();
    await mountShell("/", "moldura", "pt-BR", registry);
    const command = registry.list().find((c) => c.id === "action:memory-history")!;
    expect([command.title, command.scope, command.palette]).toEqual(["history.memory", "global", true]);
    const { tf } = await import("../../i18n");
    expect(tf("pt-BR", command.title)).toBe("Histórico da memória");
    act(() => void command.run());
    const dialog = await screen.findByRole("dialog", { name: "Histórico da memória" }, { timeout: 10_000 });
    await waitFor(() => expect(dialog.querySelectorAll(".mh-row")).toHaveLength(1));
    window.localStorage.clear();
  });
});

describe("C102 the rows", () => {
  it("C102 each row in order: the path in mono 12px, the time, the author, the origin; only ?limit=100 was asked", async () => {
    const v = version({ path: "notes/a.md", author: "run:a1b2c3", origin: "proposal" });
    all.list = [v, version({ path: "MEMORY.md", author: "system", origin: "guard" })];
    await fromMenu();
    const dialog = await screen.findByRole("dialog", { name: "Histórico da memória" });
    await waitFor(() => expect(dialog.querySelectorAll(".mh-row")).toHaveLength(2));
    const row = dialog.querySelectorAll(".mh-row")[0]!;
    expect([...row.children].slice(0, 4).map((c) => `${c.className}|${c.textContent}`)).toEqual([
      "hf-path|notes/a.md",
      "|há 3 horas",
      "mc-author|Execução a1b2c3",
      "hf-origin|Proposta aceita",
    ]);
    expect(css(".hf-path")).toMatchObject({ "font-family": "var(--font-mono)", "font-size": "var(--fs-2)" });
    expect(asked("/api/memory/history").map(String)).toEqual(["limit=100"]);
  });

  it("C102 a row with exists: false carries Apagada (Trash2) and Restaurar (.btn.sm), which asks ?path= and opens the version dialog on the newest version with bytes", async () => {
    const gone = version({
      path: "notes/velha.md",
      origin: "removed",
      sha256: null,
      size: null,
      exists: false,
    });
    const newest = version({
      path: "notes/velha.md",
      origin: "save",
      exists: false,
      at: Date.now() - 5 * 3_600_000,
    });
    const older = version({
      path: "notes/velha.md",
      origin: "create",
      exists: false,
      at: Date.now() - 9 * 3_600_000,
    });
    all.list = [gone, version({ path: "notes/a.md" })];
    all.byPath.set("notes/velha.md", [gone, newest, older]);
    await fromMenu();
    const dialog = await screen.findByRole("dialog", { name: "Histórico da memória" });
    await waitFor(() => expect(dialog.querySelectorAll(".mh-row")).toHaveLength(2));
    const [first, second] = [...dialog.querySelectorAll<HTMLElement>(".mh-row")];
    const deleted = first!.querySelector(".mh-deleted")!;
    expect(deleted.textContent).toBe("Apagada");
    expect(deleted.querySelector("svg.lucide-trash-2, svg.lucide-trash2")).not.toBeNull();
    const restore = within(first!).getByRole("button", { name: "Restaurar" });
    expect(restore.className).toBe("btn sm");
    expect(second!.querySelector(".mh-deleted")).toBeNull();
    expect(within(second!).queryByRole("button", { name: "Restaurar" })).toBeNull();
    fireEvent.click(restore);
    await screen.findByRole("dialog", { name: `Versão de ${when(newest.at)}` });
    expect(asked("/api/memory/history").map(String)).toEqual(["limit=100", "path=notes%2Fvelha.md"]);
  });

  it("C102 versions: [] shows Nenhuma mudança registrada ainda.", async () => {
    all.list = [];
    await fromMenu();
    const dialog = await screen.findByRole("dialog", { name: "Histórico da memória" });
    await waitFor(() => expect(dialog.textContent).toContain("Nenhuma mudança registrada ainda."));
  });

  it("C102 while pending: Carregando…; on failure: the message and Tentar de novo, which asks again", async () => {
    all.list = "pending";
    await fromMenu();
    let dialog = await screen.findByRole("dialog", { name: "Histórico da memória" });
    await waitFor(() => expect(dialog.querySelector(".spinner")).not.toBeNull());
    expect(dialog.textContent).toContain("Carregando…");
    fireEvent.click(within(dialog).getByRole("button", { name: "Fechar" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    all.list = new NetError(500, "boom", "falhou o histórico");
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Mais para as notas" }));
    await user.click(await screen.findByRole("menuitem", { name: "Histórico da memória" }));
    dialog = await screen.findByRole("dialog", { name: "Histórico da memória" });
    const alert = await waitFor(() => {
      const el = dialog.querySelector<HTMLElement>('[role="alert"]');
      expect(el?.textContent).toContain("falhou o histórico");
      return el!;
    });
    const n = asked("/api/memory/history").length;
    all.list = [];
    fireEvent.click(within(alert).getByRole("button", { name: "Tentar de novo" }));
    await waitFor(() => expect(asked("/api/memory/history").length).toBe(n + 1));
  });
});
