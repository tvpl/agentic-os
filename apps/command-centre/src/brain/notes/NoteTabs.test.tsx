// @vitest-environment jsdom
/**
 * The tabs and the Home of the notes view (.specs/features/cerebro-vista-notas, C43-C46, C48, C49; design.md "Área de
 * leitura" and "Estados"): where a note opens, the 12-tab cap, closing a tab with unsaved changes, what a reload
 * reopens from `UiPreferences.brain.notes`, and the Home of each root. The network is `./testnet`.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type * as ApiModule from "../../api";
import { installPage, tick } from "../../ui/testkit";
import { renderWith } from "../../contexts/testkit";
import NotesView from "./NotesView";
import { NoteTabs, useCloseTab } from "./NoteTabs";
import { useNotesCommands } from "./notesCommands";
import { useNotesState, type NotesState } from "./useNotesState";
import { MEM, WORK, fileRow, net, note, pathOf, resetNet } from "./testnet";

vi.mock("../../api", async (importOriginal) =>
  (await import("./testnet")).mockApi(await importOriginal<typeof ApiModule>()),
);

installPage();
beforeEach(() => resetNet());

const view = () => renderWith(<NotesView onShowInGraph={() => undefined} />, { lang: "pt-BR" });
const tabNames = () => screen.queryAllByRole("tab").map((t) => t.textContent);
const activeTab = () => screen.queryAllByRole("tab").find((t) => t.getAttribute("aria-selected") === "true");
const sidebar = () => screen.getByRole("complementary", { name: "Notas" });
const putNotes = () =>
  net.calls
    .filter((c) => c.method === "PUT" && c.url === "/api/ui-preferences")
    .map((c) => (c.body as { brain?: { notes?: Record<string, unknown> } }).brain?.notes)
    .filter(Boolean);

/** The tab rules with the screen's own state and strip, and a handle on the state (the editor of batch C marks unsaved). */
let handle: NotesState;
function Strip() {
  const state = useNotesState();
  handle = state;
  const close = useCloseTab(state);
  useNotesCommands(state.tabs.active, () => undefined, close);
  return (
    <NoteTabs state={state} value={state.tabs.active}>
      <p>leitura</p>
    </NoteTabs>
  );
}
const strip = async () => {
  const r = renderWith(<Strip />, { lang: "pt-BR" });
  await waitFor(() => expect(handle.ready).toBe(true));
  return r;
};
const p = (i: number) => `${MEM}/notes/n${i}.md`;

describe("C43 where a note opens", () => {
  it("C43 from the tree, the search, a link or the Home: its tab is focused when open (no second tab), else a new tab opens right after the active one", async () => {
    const alfa = note(1, MEM, "notes/alfa.md", { title: "Alfa" });
    const beta = note(2, MEM, "notes/beta.md", { title: "Beta" });
    note(3, MEM, "notes/gama.md", { title: "Gama", content: "# Gama\n\nVeja [[Beta]].\n" });
    net.links[3] = {
      backlinks: [],
      outgoing: [
        { kind: "wikilink", target: "beta", label: null, line: 3, resolved: fileRow(beta), alternatives: [] },
      ],
    };
    view();
    const user = userEvent.setup();
    await user.click(await screen.findByRole("treeitem", { name: /^notes/ }));
    // the tree
    await user.click(await screen.findByRole("treeitem", { name: /Alfa/ }));
    await user.click(screen.getByRole("treeitem", { name: /Beta/ }));
    expect(tabNames()).toEqual(["Alfa", "Beta"]);
    expect(activeTab()!.textContent).toBe("Beta");
    await user.click(screen.getByRole("tab", { name: "Alfa" }));
    expect(activeTab()!.textContent).toBe("Alfa");
    // the search ("+"): right after the active tab
    await user.click(screen.getByRole("button", { name: "Abrir outra nota" }));
    await user.type(await screen.findByRole("combobox", { name: "Abrir outra nota" }), "gama");
    await user.click(await screen.findByRole("option", { name: /Gama/ }));
    expect(tabNames()).toEqual(["Alfa", "Gama", "Beta"]);
    expect(activeTab()!.textContent).toBe("Gama");
    // a link of the body: Beta is open, so it is focused
    await user.click(await screen.findByRole("button", { name: "Beta" }));
    expect(tabNames()).toEqual(["Alfa", "Gama", "Beta"]);
    expect(activeTab()!.textContent).toBe("Beta");
    // the tree again: focused, not opened twice
    await user.click(screen.getByRole("treeitem", { name: /Alfa/ }));
    expect(tabNames()).toEqual(["Alfa", "Gama", "Beta"]);
    expect(activeTab()!.textContent).toBe("Alfa");
    // the Home: closed, it opens right after the active tab
    net.prefs.brain = {};
    await user.click(screen.getByRole("button", { name: "Mais" }));
    await tick();
    await user.click(screen.getByRole("menuitem", { name: "Definir como Home" }));
    await user.click(screen.getByRole("button", { name: "Fechar Alfa" }));
    expect(tabNames()).toEqual(["Gama", "Beta"]);
    await user.click(screen.getByRole("tab", { name: "Gama" }));
    await user.click(within(sidebar()).getByRole("button", { name: "Alfa" }));
    expect(tabNames()).toEqual(["Gama", "Alfa", "Beta"]);
    expect(activeTab()!.textContent).toBe("Alfa");
    await user.click(screen.getByRole("tab", { name: "Beta" }));
    await user.click(within(sidebar()).getByRole("button", { name: "Alfa" }));
    expect(tabNames()).toEqual(["Gama", "Alfa", "Beta"]);
    expect(activeTab()!.textContent).toBe("Alfa");
    expect(pathOf(alfa)).toBe(`${MEM}/notes/alfa.md`);
  });
});

describe("C44 at most 12 tabs", () => {
  it("C44 a 13th closes the least recently focused tab with no unsaved changes; with all 12 unsaved nothing opens and it says Feche uma aba para abrir outra.; an unsaved tab shows a dot and the hidden text", async () => {
    await strip();
    act(() => {
      for (let i = 0; i < 12; i++) handle.open(p(i), { title: `N${i}` });
    });
    expect(tabNames()).toHaveLength(12);
    // n0 is the least recently focused, but it is unsaved: n1 makes room
    act(() => handle.markUnsaved(p(0), true));
    act(() => void handle.open(p(12), { title: "N12" }));
    expect(handle.tabs.tabs).toHaveLength(12);
    expect(handle.tabs.tabs).not.toContain(p(1));
    expect(handle.tabs.tabs).toContain(p(0));
    expect(handle.tabs.tabs.at(-1)).toBe(p(12));
    // the unsaved tab: a dot and the hidden words
    const n0 = screen.getByRole("tab", { name: /N0/ });
    expect(n0.querySelector(".notes-tab-dot")).not.toBeNull();
    expect(within(n0).getByText("alterações não salvas").className).toBe("sr-only");
    expect(screen.getByRole("tab", { name: /N2/ }).querySelector(".notes-tab-dot")).toBeNull();
    // all twelve unsaved: the 13th does not open
    act(() => {
      for (const path of handle.tabs.tabs) handle.markUnsaved(path, true);
    });
    const before = [...handle.tabs.tabs];
    let opened = true;
    act(() => {
      opened = handle.open(p(13), { title: "N13" });
    });
    expect(opened).toBe(false);
    expect(handle.tabs.tabs).toEqual(before);
    expect(await screen.findByText("Feche uma aba para abrir outra.")).toBeTruthy();
  });
});

describe("C45 closing a tab with unsaved changes asks", () => {
  it("C45 its X (Fechar <título>) or the command Fechar aba open a Modal Descartar as alterações não salvas? with Continuar editando focused; Continuar editando keeps the tab, Descartar closes it", async () => {
    const { registry } = await strip();
    act(() => {
      handle.open(p(1), { title: "Beta" });
      handle.markUnsaved(p(1), true);
    });
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Fechar Beta" }));
    const dialog = await screen.findByRole("dialog", { name: "Descartar as alterações não salvas?" });
    await waitFor(() =>
      expect(document.activeElement).toBe(within(dialog).getByRole("button", { name: "Continuar editando" })),
    );
    await user.click(within(dialog).getByRole("button", { name: "Continuar editando" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(tabNames()).toHaveLength(1);
    expect(screen.getByRole("tab", { name: /^Beta/ }).textContent).toContain("alterações não salvas");
    expect(handle.unsaved.has(p(1))).toBe(true);
    // the command
    const close = registry.list().find((c) => c.id === "brain.notes.closeTab")!;
    expect(close.when?.()).toBe(true);
    act(() => close.run());
    const again = await screen.findByRole("dialog", { name: "Descartar as alterações não salvas?" });
    await waitFor(() =>
      expect(document.activeElement).toBe(within(again).getByRole("button", { name: "Continuar editando" })),
    );
    await user.click(within(again).getByRole("button", { name: "Descartar" }));
    await waitFor(() => expect(tabNames()).toEqual([]));
    // a tab with nothing unsaved closes at once
    act(() => void handle.open(p(2), { title: "Gama" }));
    await user.click(screen.getByRole("button", { name: "Fechar Gama" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(tabNames()).toEqual([]);
  });
});

describe("C46 a reload reopens the view", () => {
  it("C46 the root, the tabs in their order, the active tab, the sort and the open folders come back from brain.notes; a tab whose note is gone says Esta nota não existe mais. with Fechar aba", async () => {
    note(1, WORK, "docs/alfa.md", { title: "Alfa" });
    note(2, WORK, "docs/beta.md", { title: "Beta" });
    net.prefs.brain = {
      layout: "force",
      notes: {
        root: WORK,
        home: {},
        tabs: [`${WORK}/docs/alfa.md`, `${WORK}/docs/sumiu.md`, `${WORK}/docs/beta.md`],
        active: `${WORK}/docs/beta.md`,
        sort: "updated",
        expanded: [`${WORK}/docs`],
      },
    };
    view();
    await waitFor(() => expect(tabNames()).toEqual(["alfa", "sumiu", "Beta"]));
    expect(activeTab()!.textContent).toBe("Beta");
    expect(await screen.findByRole("article", { name: "Beta" })).toBeTruthy();
    const root = within(sidebar()).getByRole("button", { name: /work/ });
    expect(root.querySelector(".notes-root-path")!.textContent).toBe(WORK);
    const docs = await screen.findByRole("treeitem", { name: /docs/ });
    expect(docs.getAttribute("aria-expanded")).toBe("true");
    const trees = net.calls.filter((c) => c.url.startsWith("/api/memory/tree?"));
    expect(
      trees.some((c) => c.url.includes("sort=updated") && c.url.includes(`root=${encodeURIComponent(WORK)}`)),
    ).toBe(true);
    // the gone note
    const user = userEvent.setup();
    await user.click(screen.getByRole("tab", { name: "sumiu" }));
    expect(await screen.findByText("Esta nota não existe mais.")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Fechar aba" }));
    expect(tabNames()).toEqual(["alfa", "Beta"]);
    // and what the view stores is written back by PUT /api/ui-preferences, the other brain fields untouched
    await waitFor(() =>
      expect(putNotes().at(-1)).toEqual({
        root: WORK,
        home: {},
        tabs: [`${WORK}/docs/alfa.md`, `${WORK}/docs/beta.md`],
        active: `${WORK}/docs/beta.md`,
        sort: "updated",
        expanded: [`${WORK}/docs`],
      }),
    );
    expect(net.prefs.brain.layout).toBe("force");
  });
});

describe("C48 Definir como Home", () => {
  it("C48 the Mais menu or the command makes the note the Home of the current root, at the top of the sidebar with the Home icon and its title; with no tab open the reading area shows it; another root has its own", async () => {
    note(1, MEM, "alfa.md", { title: "Alfa", content: "# Alfa\n\nA casa.\n" });
    note(2, WORK, "beta.md", { title: "Beta" });
    const { registry } = view();
    const user = userEvent.setup();
    await user.click(await screen.findByRole("treeitem", { name: /Alfa/ }));
    await user.click(await screen.findByRole("button", { name: "Mais" }));
    await tick();
    await user.click(screen.getByRole("menuitem", { name: "Definir como Home" }));
    const home = await within(sidebar()).findByRole("button", { name: "Alfa" });
    expect(home.querySelector("svg.lucide-house, svg.lucide-home")).not.toBeNull();
    await user.click(screen.getByRole("button", { name: "Fechar Alfa" }));
    expect(tabNames()).toEqual([]);
    expect(await screen.findByRole("article", { name: "Alfa" })).toBeTruthy();
    expect(screen.getByText("A casa.")).toBeTruthy();

    // another root: no Home there, until the command sets one
    await user.click(within(sidebar()).getByRole("button", { name: /Memória/ }));
    await tick();
    await user.click(within(screen.getByRole("menu")).getAllByRole("menuitemcheckbox")[1]!);
    expect(await within(sidebar()).findByRole("button", { name: "Definir uma Home" })).toBeTruthy();
    expect(screen.getByText("Abra uma nota na árvore ou defina uma Home.")).toBeTruthy();
    await user.click(await screen.findByRole("treeitem", { name: /Beta/ }));
    act(() =>
      registry
        .list()
        .find((c) => c.id === "brain.notes.setHome")!
        .run(),
    );
    expect(await within(sidebar()).findByRole("button", { name: "Beta" })).toBeTruthy();
    await user.click(within(sidebar()).getByRole("button", { name: /work/ }));
    await tick();
    await user.click(within(screen.getByRole("menu")).getAllByRole("menuitemcheckbox")[0]!);
    expect(await within(sidebar()).findByRole("button", { name: "Alfa" })).toBeTruthy();
    await waitFor(() =>
      expect(putNotes().at(-1)!.home).toEqual({ [MEM]: `${MEM}/alfa.md`, [WORK]: `${WORK}/beta.md` }),
    );
  });
});

describe("C49 no Home", () => {
  it("C49 with no Home for the root the sidebar shows Definir uma Home, and with no tab and no Home the reading area says Abra uma nota na árvore ou defina uma Home.", async () => {
    note(1, MEM, "alfa.md", { title: "Alfa" });
    view();
    const set = await within(await waitFor(sidebar)).findByRole("button", { name: "Definir uma Home" });
    expect(set.className).toContain("notes-home-empty");
    expect(screen.getByText("Abra uma nota na árvore ou defina uma Home.")).toBeTruthy();
    expect(screen.queryAllByRole("tab")).toEqual([]);
  });
});
