// @vitest-environment jsdom
/**
 * The notes sidebar (.specs/features/cerebro-vista-notas, C31-C35; design.md "Barra das notas" and its amendments):
 * the line of the active context and the shell's one selector, the root and its menu, the context of every tree
 * request, a context switch, the index line and "Reindexar" / "Cancelar". The network is `./testnet`.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type * as ApiModule from "../../api";
import type * as EventsModule from "../../hooks/useEventStream";
import { installPage, tick } from "../../ui/testkit";
import { renderWith } from "../../contexts/testkit";
import { ContextSelector, SWITCH_CONTEXT_ID } from "../../contexts/ContextSelector";
import NotesView from "./NotesView";
import { MEM, WORK, asked, emit, net, note, resetNet } from "./testnet";

vi.mock("../../api", async (importOriginal) =>
  (await import("./testnet")).mockApi(await importOriginal<typeof ApiModule>()),
);
vi.mock("../../hooks/useEventStream", async (importOriginal) => ({
  ...(await importOriginal<typeof EventsModule>()),
  useOsEvent: (await import("./testnet")).useOsEventMock,
}));

installPage();
beforeEach(() => {
  resetNet();
  note(1, MEM, "notes/plano.md", { title: "Plano" });
  note(2, WORK, "projetos/app.md", { title: "App" });
});

const view = (lang: "en" | "pt-BR" = "pt-BR") =>
  renderWith(
    <>
      <ContextSelector variant="frame" />
      <NotesView onShowInGraph={() => undefined} />
    </>,
    { lang },
  );
const sidebar = () => screen.getByRole("complementary", { name: "Notas" });

describe("C31 the top of the sidebar is the active context, and the shell's selector is the only one", () => {
  it("C31 a Crosshair button named after the active context (Todo o cérebro with none) opens the shell's ContextSelector menu; the registry holds action:switch-context once", async () => {
    const { registry } = view();
    const line = await within(await waitFor(sidebar)).findByRole("button", { name: "Todo o cérebro" });
    expect(line.querySelector("svg.lucide-crosshair")).not.toBeNull();
    expect(registry.list().filter((c) => c.id === SWITCH_CONTEXT_ID)).toHaveLength(1);
    const user = userEvent.setup();
    await user.click(line);
    // The shell's selector opens its own menu (the command waits for a closing palette first).
    const menu = await screen.findByRole("menu", {}, { timeout: 2000 });
    expect(within(menu).getByRole("menuitemcheckbox", { name: "Todo o cérebro" })).toBeTruthy();
    expect(screen.getAllByRole("menu")).toHaveLength(1);
  });

  it("C31 with a context active the line reads its name", async () => {
    net.contexts = [
      { id: "alfa", name: "Alfa do cliente", paths: [{ path: `${WORK}/projetos`, state: "ok" }], files: 1 },
    ];
    net.contextRoots.alfa = [
      { path: `${WORK}/projetos`, name: "projetos", editable: false, indexing: false },
    ];
    net.prefs.activeContext = "alfa";
    view();
    const line = await within(await waitFor(sidebar)).findByRole("button", { name: "Alfa do cliente" });
    expect(line.querySelector("svg.lucide-crosshair")).not.toBeNull();
  });
});

describe("C32 the root button, its menu and the context of the tree's requests", () => {
  it("C32 the root reads Memória with its path in mono; the menu lists the roots in order with Editável or Somente leitura (and Indexando while indexing); choosing one asks the tree with root=<path>", async () => {
    net.roots[1]!.indexing = true;
    view();
    const root = await within(await waitFor(sidebar)).findByRole("button", { name: /Memória/ });
    expect(root.querySelector(".notes-root-path")!.textContent).toBe(MEM);
    const user = userEvent.setup();
    await user.click(root);
    await tick();
    const items = within(screen.getByRole("menu")).getAllByRole("menuitemcheckbox");
    expect(items.map((i) => i.querySelector(".notes-root-path")!.textContent)).toEqual([MEM, WORK]);
    expect(items[0]!.textContent).toContain("Memória");
    expect(items[0]!.textContent).toContain("Editável");
    expect(items[0]!.textContent).not.toContain("Indexando");
    expect(items[1]!.textContent).toContain("work");
    expect(items[1]!.textContent).toContain("Somente leitura");
    expect(items[1]!.textContent).toContain("Indexando");
    expect(items[0]!.getAttribute("aria-checked")).toBe("true");
    await user.click(items[1]!);
    await waitFor(() => expect(asked("/api/memory/tree").some((q) => q.get("root") === WORK)).toBe(true));
    expect(await within(sidebar()).findByRole("treeitem", { name: /projetos/ })).toBeTruthy();
  });

  it("C32 with a context active every tree request carries context=<id>", async () => {
    net.contexts = [
      { id: "alfa", name: "Alfa", paths: [{ path: `${WORK}/projetos`, state: "ok" }], files: 1 },
    ];
    net.contextRoots.alfa = [
      { path: WORK, name: "work", editable: false, indexing: false },
      { path: `${MEM}/notes`, name: "notes", editable: true, indexing: false },
    ];
    net.prefs.activeContext = "alfa";
    view();
    const tree = await within(await waitFor(sidebar)).findByRole("tree");
    const user = userEvent.setup();
    await user.click(within(tree).getByRole("treeitem", { name: /projetos/ }));
    await within(tree).findByRole("treeitem", { name: /App/ });
    const trees = asked("/api/memory/tree");
    expect(trees.length).toBeGreaterThanOrEqual(2);
    for (const q of trees) expect(q.get("context")).toBe("alfa");
  });
});

describe("C33 switching the context", () => {
  it("C33 reloads the tree with the new context's roots, makes its first root the current one and keeps the open tabs", async () => {
    net.contexts = [{ id: "alfa", name: "Alfa", paths: [{ path: WORK, state: "ok" }], files: 1 }];
    net.contextRoots.alfa = [{ path: WORK, name: "work", editable: false, indexing: false }];
    view();
    const user = userEvent.setup();
    const tree = await within(await waitFor(sidebar)).findByRole("tree");
    await user.click(within(tree).getByRole("treeitem", { name: /notes/ }));
    await user.click(await within(tree).findByRole("treeitem", { name: /Plano/ }));
    expect(await screen.findByRole("tab", { name: /Plano/ })).toBeTruthy();

    // The shell's selector switches the context.
    await user.click(document.querySelector<HTMLElement>(".ctx-sel")!);
    await tick();
    await user.click(await screen.findByRole("menuitemcheckbox", { name: /Alfa/ }));
    await waitFor(() =>
      expect(asked("/api/memory/tree").some((q) => q.get("context") === "alfa")).toBe(true),
    );
    const root = await within(sidebar()).findByRole("button", { name: /work/ });
    expect(root.querySelector(".notes-root-path")!.textContent).toBe(WORK);
    expect(await within(sidebar()).findByRole("treeitem", { name: /projetos/ })).toBeTruthy();
    // The tab is still open.
    expect(screen.getByRole("tab", { name: /Plano/ })).toBeTruthy();
    // The new root is what the view stores (it is the context's first: the default).
    await waitFor(() =>
      expect((net.prefs.brain as { notes?: { root: string | null; tabs: string[] } }).notes?.tabs).toEqual([
        `${MEM}/notes/plano.md`,
      ]),
    );
  });
});

describe("C34 the index line", () => {
  it("C34 in a role=status region: Indexando 3 de 10 with Loader, Indexado · <há quanto> with Check, Indexação cancelada with Ban, Falhou with CircleAlert and the code translated in its Tooltip", async () => {
    view();
    const status = await waitFor(() => {
      const el = sidebar().querySelector<HTMLElement>('.notes-index [role="status"]');
      expect(el).not.toBeNull();
      return el!;
    });
    act(() =>
      emit("index.progress", { scanned: 3, total: 10, added: 0, updated: 0, removed: 0, phase: "index" }),
    );
    expect(status.textContent).toBe("Indexando 3 de 10");
    expect(status.querySelector("svg.lucide-loader")).not.toBeNull();
    act(() => emit("index.finished", { stats: { scanned: 10, added: 0, updated: 0, removed: 0 } }));
    expect(status.textContent).toMatch(/^Indexado · /);
    expect(status.textContent).not.toBe("Indexado · ");
    expect(status.querySelector("svg.lucide-check")).not.toBeNull();
    act(() => emit("index.cancelled", { runId: "r" }));
    expect(status.textContent).toBe("Indexação cancelada");
    expect(status.querySelector("svg.lucide-ban")).not.toBeNull();
    act(() => emit("index.failed", { code: "index_worker_crashed", previousIndexPreserved: true }));
    expect(status.textContent).toBe("Falhou");
    expect(status.querySelector("svg.lucide-circle-alert")).not.toBeNull();
    const failed = status.querySelector<HTMLElement>(".notes-index-failed")!;
    expect(failed.getAttribute("aria-label")).toBe(
      "Falhou: O indexador parou; o índice anterior foi mantido.",
    );
    const user = userEvent.setup();
    await user.hover(failed);
    expect(
      (await screen.findAllByText("O indexador parou; o índice anterior foi mantido.", {}, { timeout: 2000 }))
        .length,
    ).toBeGreaterThan(0);
  });
});

describe("C35 Reindexar and Cancelar", () => {
  it("C35 Reindexar calls POST /api/memory/index; while the pass runs the same button reads Cancelar and calls POST /api/memory/index/cancel", async () => {
    let finish: (v: unknown) => void = () => undefined;
    net.writes.set("POST /api/memory/index", () => new Promise((resolve) => (finish = resolve)));
    view();
    const user = userEvent.setup();
    const box = await waitFor(() => {
      const el = sidebar().querySelector<HTMLElement>(".notes-index");
      expect(el).not.toBeNull();
      return el!;
    });
    await user.click(within(box).getByRole("button", { name: "Reindexar" }));
    expect(net.calls.filter((c) => c.method === "POST" && c.url === "/api/memory/index")).toHaveLength(1);
    const cancel = within(box).getByRole("button", { name: "Cancelar" });
    act(() => emit("index.progress", { scanned: 1, total: 4, added: 0, updated: 0, removed: 0 }));
    expect(within(box).getByRole("button", { name: "Cancelar" })).toBe(cancel);
    await user.click(cancel);
    expect(net.calls.filter((c) => c.method === "POST" && c.url === "/api/memory/index/cancel")).toHaveLength(
      1,
    );
    act(() => emit("index.cancelled", { runId: "r" }));
    await act(async () => finish({ stats: { scanned: 1, added: 0, updated: 0, removed: 0 } }));
    expect(await within(box).findByRole("button", { name: "Reindexar" })).toBeTruthy();
  });
});
