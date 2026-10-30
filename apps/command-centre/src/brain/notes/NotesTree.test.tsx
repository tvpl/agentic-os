// @vitest-environment jsdom
/**
 * The tree of the notes view (.specs/features/cerebro-vista-notas, C36-C41; design.md "Barra das notas", item 5, and
 * "Estados"): the ARIA tree and its keys, "Recolher tudo", its empty, loading and failed states, a folder past the
 * cap, the locks and their reasons, a folder shown in the reading area, and "Ordenar". The network is `./testnet`.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type * as ApiModule from "../../api";
import { installPage, tick } from "../../ui/testkit";
import { renderWith } from "../../contexts/testkit";
import NotesView from "./NotesView";
import { MEM, NetError, WORK, asked, net, note, resetNet } from "./testnet";

vi.mock("../../api", async (importOriginal) =>
  (await import("./testnet")).mockApi(await importOriginal<typeof ApiModule>()),
);

installPage();
beforeEach(() => resetNet());

const view = () => renderWith(<NotesView onShowInGraph={() => undefined} />, { lang: "pt-BR" });
const tree = () => screen.findByRole("tree");
const item = (name: RegExp | string) => screen.getByRole("treeitem", { name });
const key = (el: Element, k: string) => fireEvent.keyDown(el, { key: k });
const focused = () => document.activeElement as HTMLElement;

describe("C36 the tree is an ARIA tree, and its keys", () => {
  it("C36 role=tree with treeitems carrying aria-level and, for folders, aria-expanded; ArrowDown/ArrowUp move, ArrowRight opens (asking for its dir), ArrowLeft closes, Enter on a file opens a tab; Recolher tudo closes every folder", async () => {
    note(1, MEM, "notes/plano.md", { title: "Plano" });
    note(2, MEM, "notes/clientes/acme.md", { title: "Acme" });
    note(3, MEM, "ROUTER.md", { title: "Router", reason: "generated", editable: false });
    view();
    await tree();
    const notes = item(/^notes/);
    expect(notes.getAttribute("aria-level")).toBe("1");
    expect(notes.getAttribute("aria-expanded")).toBe("false");
    const router = item(/Router/);
    expect(router.getAttribute("aria-level")).toBe("1");
    expect(router.hasAttribute("aria-expanded")).toBe(false);

    notes.focus();
    key(notes, "ArrowDown");
    expect(focused()).toBe(router);
    key(router, "ArrowUp");
    expect(focused()).toBe(notes);
    key(notes, "ArrowRight");
    await waitFor(() => expect(item(/^notes/).getAttribute("aria-expanded")).toBe("true"));
    expect(asked("/api/memory/tree").some((q) => q.get("dir") === "notes")).toBe(true);
    const clientes = await screen.findByRole("treeitem", { name: /clientes/ });
    expect(clientes.getAttribute("aria-level")).toBe("2");
    // ArrowRight on an open folder goes into it.
    key(item(/^notes/), "ArrowRight");
    expect(focused()).toBe(clientes);
    key(clientes, "ArrowRight");
    const acme = await screen.findByRole("treeitem", { name: /Acme/ });
    expect(acme.getAttribute("aria-level")).toBe("3");
    expect(asked("/api/memory/tree").some((q) => q.get("dir") === "notes/clientes")).toBe(true);
    // ArrowLeft on an open folder closes it; on a file it goes up to its folder.
    key(clientes, "ArrowLeft");
    await waitFor(() => expect(item(/clientes/).getAttribute("aria-expanded")).toBe("false"));
    key(item(/clientes/), "ArrowDown");
    const plano = item(/Plano/);
    expect(focused()).toBe(plano);
    key(plano, "Enter");
    expect(await screen.findByRole("tab", { name: /Plano/ })).toBeTruthy();
    key(plano, "ArrowLeft");
    expect(focused()).toBe(item(/^notes/));

    key(item(/clientes/), "ArrowRight");
    await waitFor(() => expect(item(/clientes/).getAttribute("aria-expanded")).toBe("true"));
    await userEvent.setup().click(screen.getByRole("button", { name: "Recolher tudo" }));
    await waitFor(() =>
      expect(
        [...document.querySelectorAll('[role="treeitem"][aria-expanded]')].map((el) =>
          el.getAttribute("aria-expanded"),
        ),
      ).toEqual(["false"]),
    );
  });
});

describe("C37 the tree's states", () => {
  it("C37 with no indexed row: Nada indexado ainda. and Reindexar", async () => {
    net.status = { lastIndex: null, total: 0, running: false };
    view();
    expect(await screen.findByText("Nada indexado ainda.")).toBeTruthy();
    const reindex = screen.getAllByRole("button", { name: "Reindexar" });
    expect(reindex.some((b) => b.textContent === "Reindexar")).toBe(true);
  });

  it("C37 while it loads, three skeleton rows and the hidden text Carregando…", async () => {
    net.overrides.push((u) => (u.pathname === "/api/memory/tree" ? new Promise(() => undefined) : undefined));
    view();
    const box = await waitFor(() => {
      const el = document.querySelector(".notes-skeleton");
      expect(el).not.toBeNull();
      return el!;
    });
    expect(box.querySelectorAll(".notes-skeleton-row")).toHaveLength(3);
    expect(within(box as HTMLElement).getByText("Carregando…").className).toBe("sr-only");
  });

  it("C37 when it fails, the message and Tentar de novo in a role=alert, which asks again", async () => {
    let fail = true;
    net.overrides.push((u) =>
      u.pathname === "/api/memory/tree" && fail
        ? Promise.reject(new NetError(500, "boom", "O índice não respondeu."))
        : undefined,
    );
    note(1, MEM, "notes/plano.md", { title: "Plano" });
    view();
    const alert = (await screen.findByText("O índice não respondeu.")).closest('[role="alert"]')!;
    expect(alert).not.toBeNull();
    const before = asked("/api/memory/tree").length;
    fail = false;
    await userEvent
      .setup()
      .click(within(alert as HTMLElement).getByRole("button", { name: "Tentar de novo" }));
    await tree();
    expect(asked("/api/memory/tree").length).toBeGreaterThan(before);
  });

  it("C37 an empty folder shows Nenhuma nota nesta pasta. and, under memory/, Nova nota", async () => {
    note(2, WORK, "projetos/app.md", { title: "App" });
    const { unmount } = view();
    expect(await screen.findByText("Nenhuma nota nesta pasta.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Nova nota" })).toBeTruthy();
    unmount();
    net.files = [];
    net.prefs.brain = { notes: { root: WORK, home: {}, tabs: [], active: null, sort: "name", expanded: [] } };
    view();
    expect(await screen.findByText("Nenhuma nota nesta pasta.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Nova nota" })).toBeNull();
  });
});

describe("C38 a folder past the cap", () => {
  it("C38 a folder answered with truncated and omitted: 3 ends with the text +3 não mostrados, with no action", async () => {
    note(1, MEM, "notes/a.md", { title: "A" });
    net.truncated[`${MEM}|notes`] = 3;
    view();
    await tree();
    await userEvent.setup().click(item(/^notes/));
    const more = await screen.findByText("+3 não mostrados");
    expect(more.tagName).toBe("LI");
    expect(more.getAttribute("role")).toBe("none");
    expect(more.querySelector("button, a")).toBeNull();
    // the last entry of its folder
    expect(more.parentElement!.lastElementChild).toBe(more);
  });
});

describe("C39 the lock and its reason", () => {
  it("C39 editable: false shows Lock whose Tooltip and accessible name say the reason: outside_memory, generated, not_markdown", async () => {
    note(1, MEM, "ROUTER.md", { title: "Router", reason: "generated", editable: false });
    note(2, MEM, "foto.txt", { title: null, reason: "not_markdown", editable: false });
    note(3, WORK, "leia.md", { title: "Leia" });
    view();
    await tree();
    const cases: Array<[RegExp, string]> = [
      [/Router/, "Gerada pelo MordomoOS"],
      [/foto/, "Só notas .md se editam"],
    ];
    const user = userEvent.setup();
    for (const [name, reason] of cases) {
      const el = item(name);
      const lock = el.querySelector<HTMLElement>(".notes-lock")!;
      expect(lock.querySelector("svg.lucide-lock")).not.toBeNull();
      expect(lock.getAttribute("aria-label")).toBe(reason);
      expect(el.getAttribute("aria-labelledby")).toBeTruthy();
      expect(screen.getByRole("treeitem", { name: new RegExp(reason) })).toBe(el);
      await user.hover(lock);
      await waitFor(
        () => expect(screen.getAllByRole("tooltip").map((x) => x.textContent)).toContain(reason),
        {
          timeout: 2000,
        },
      );
      await user.unhover(lock);
    }
    // a file of an indexed folder outside memory/
    await user.click(screen.getByRole("button", { name: /Memória/ }));
    await tick();
    await user.click(within(screen.getByRole("menu")).getAllByRole("menuitemcheckbox")[1]!);
    const leia = await screen.findByRole("treeitem", { name: /Leia/ });
    const lock = leia.querySelector<HTMLElement>(".notes-lock")!;
    expect(lock.getAttribute("aria-label")).toBe("Pasta fora de memory/: somente leitura");
    await user.hover(lock);
    await waitFor(
      () =>
        expect(screen.getAllByRole("tooltip").map((x) => x.textContent)).toContain(
          "Pasta fora de memory/: somente leitura",
        ),
      { timeout: 2000 },
    );
  });
});

describe("C40 a folder selected", () => {
  it("C40 a folder with indexNote shows that note with the badge Índice da pasta; one with indexNote: null lists its entries with title, type and updated date", async () => {
    note(1, MEM, "notes/clientes/README.md", { title: "Clientes", content: "# Clientes\n\nO índice.\n" });
    note(2, MEM, "notes/projetos/app.md", { title: "App", type: "project", mtime: Date.UTC(2026, 9, 14) });
    note(3, MEM, "notes/projetos/sem-tipo.md", { title: null });
    net.indexNotes[`${MEM}|notes/clientes`] = 1;
    view();
    await tree();
    const user = userEvent.setup();
    await user.click(item(/^notes/));
    await user.click(await screen.findByRole("treeitem", { name: /clientes/ }));
    const article = await screen.findByRole("article", { name: "Clientes" });
    expect(within(article).getByText("Índice da pasta").className).toContain("notes-badge");
    expect(within(article).getByText("O índice.")).toBeTruthy();

    await user.click(screen.getByRole("treeitem", { name: /projetos/ }));
    const table = await screen.findByRole("table");
    const rows = within(table)
      .getAllByRole("row")
      .map((r) => [...r.children].map((c) => c.textContent));
    expect(rows[0]).toEqual(["Título", "Tipo", "Atualizado"]);
    expect(rows[1]![0]).toBe("App");
    expect(rows[1]![1]).toBe("project");
    expect(rows[1]![2]).toBe(new Date(Date.UTC(2026, 9, 14)).toLocaleDateString("pt-BR"));
    expect(rows[2]![0]).toBe("sem-tipo");
    expect(rows[2]![1]).toBe("—");
  });
});

describe("C41 Ordenar", () => {
  it("C41 opens a DropdownMenu with Nome and Atualizado; Atualizado asks the tree with sort=updated and writes brain.notes.sort", async () => {
    note(1, MEM, "a.md", { title: "A" });
    view();
    await tree();
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Ordenar" }));
    await tick();
    const menu = screen.getByRole("menu");
    expect(
      within(menu)
        .getAllByRole("menuitemcheckbox")
        .map((i) => i.textContent),
    ).toEqual(["Nome", "Atualizado"]);
    await user.click(within(menu).getByRole("menuitemcheckbox", { name: "Atualizado" }));
    await waitFor(() =>
      expect(asked("/api/memory/tree").some((q) => q.get("sort") === "updated")).toBe(true),
    );
    await waitFor(() =>
      expect(
        net.calls.some(
          (c) =>
            c.method === "PUT" &&
            c.url === "/api/ui-preferences" &&
            (c.body as { brain?: { notes?: { sort?: string } } }).brain?.notes?.sort === "updated",
        ),
      ).toBe(true),
    );
  });
});
