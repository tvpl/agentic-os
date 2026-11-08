// @vitest-environment jsdom
/**
 * The dialogs and the "Mais" menu of the dashboards (.specs/features/cerebro-paineis, C85, C86, C87; design.md
 * "Página"; plan.md amendment 25): "Novo painel…" with its three cards, "Personalizar" with its switches, its keyboard
 * order and its conflict, and "Exportar HTML", "Editar no editor do sistema" and "Arquivar painel".
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import type * as ApiModule from "../api";
import type * as EventsModule from "../hooks/useEventStream";
import { installPage } from "../ui/testkit";
import { MEM, NetError, net } from "../brain/notes/testnet";
import { answerRead, dash, resetDash, sent } from "./testnet";
import { definition, mountBoard, ok, read, serve, snapshot, w, where } from "./testkit";

vi.mock("../api", async (importOriginal) =>
  (await import("./testnet")).dashMockApi(await importOriginal<typeof ApiModule>()),
);
vi.mock("../hooks/useEventStream", async (importOriginal) => ({
  ...(await importOriginal<typeof EventsModule>()),
  useOsEvent: (await import("../brain/notes/testnet")).useOsEventMock,
}));
vi.setConfig({ testTimeout: 30_000 });

installPage();
beforeEach(() => {
  resetDash();
});

const a = w("a", "list", { kind: "notes" }, undefined, "Notas");
const b = w("b", "list", { kind: "projects" }, { size: "m" }, "Projetos");
const c = w("c", "list", { kind: "runs" }, undefined, "Agentes");
const overview = definition("overview", [a, b, c]);
const snap = snapshot("visao-geral", [
  ok("a", "list", { items: [{ title: "Uma nota" }], total: 1 }),
  ok("b", "list", { items: [], total: 0 }),
  ok("c", "list", { items: [], total: 0 }),
]);
const V1 = `sha256:${"1".repeat(64)}`;

async function open(trigger: Element) {
  fireEvent.pointerDown(trigger, { button: 0, pointerType: "mouse" });
  return screen.findByRole("menu");
}
const menuItems = (menu: HTMLElement) =>
  [...menu.querySelectorAll('[role^="menuitem"]')].map((e) => e.textContent);
const choose = async (trigger: string, name: string) => {
  const menu = await open(document.querySelector(trigger)!);
  fireEvent.click(within(menu).getByRole("menuitem", { name }));
};

describe("C85 Novo painel", () => {
  it("C85 a Modal with three cards in order, Visão geral, Contexto (a select) and Pergunta (at most 500 characters), then Criar and Cancelar", async () => {
    net.contexts = [
      { id: "projeto-x", name: "Projeto X", paths: [], files: 0 },
      { id: "casa", name: "Casa", paths: [], files: 0 },
    ];
    serve("visao-geral", read(overview, snap));
    mountBoard();
    await screen.findByText("Uma nota");
    await choose(".dsh-pick", "Novo painel…");
    const dialog = await screen.findByRole("dialog", { name: "Novo painel" });
    const cards = [...dialog.querySelectorAll<HTMLElement>(".dsh-new-card")];
    expect(cards.map((c) => c.querySelector(".dsh-new-t")!.textContent)).toEqual([
      "Visão geral",
      "Contexto",
      "Pergunta",
    ]);
    const select = await within(cards[1]!).findByRole("combobox");
    expect([...select.querySelectorAll("option")].map((o) => o.textContent)).toEqual(["Projeto X", "Casa"]);
    expect(within(cards[2]!).getByRole("textbox").getAttribute("maxlength")).toBe("500");
    const buttons = [...dialog.querySelectorAll(".modal-actions button")].map((x) => x.textContent);
    expect(buttons).toEqual(["Criar", "Cancelar"]);
  });

  it("C85 with no context the Contexto card says Crie um contexto primeiro, a link to the contexts' settings", async () => {
    net.contexts = [];
    serve("visao-geral", read(overview, snap));
    mountBoard();
    await screen.findByText("Uma nota");
    await choose(".dsh-pick", "Novo painel…");
    const dialog = await screen.findByRole("dialog", { name: "Novo painel" });
    const area = dialog.querySelector('.dsh-new-card[data-choice="area"]')!;
    const link = await within(area as HTMLElement).findByRole("link", { name: "Crie um contexto primeiro" });
    expect(link.getAttribute("href")).toBe("/settings?tab=memory");
    expect(area.querySelector("select")).toBeNull();
  });

  it("C85 Criar on Pergunta sends POST template question with the text, then its refresh, and the page shows pergunta; Cancelar sends nothing", async () => {
    serve("visao-geral", read(overview, snap));
    const question = definition("question", [], { title: "Por que demora?", question: "Por que demora?" });
    dash.writes.set("POST /api/dashboards", async () => {
      dash.list = [
        ...(dash.list as unknown[]),
        {
          id: "pergunta",
          title: "Por que demora?",
          kind: "question",
          contextId: null,
          refresh: "manual",
          generatedAt: null,
          stale: false,
        },
      ];
      return { id: "pergunta", definition: question, version: V1 };
    });
    dash.writes.set("POST /api/dashboards/pergunta/refresh", async () => ({ runId: "run-1" }));
    answerRead("pergunta", read(question, null));
    mountBoard();
    await screen.findByText("Uma nota");
    await choose(".dsh-pick", "Novo painel…");
    let dialog = await screen.findByRole("dialog", { name: "Novo painel" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancelar" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(net.calls.filter((x) => x.method === "POST")).toEqual([]);

    await choose(".dsh-pick", "Novo painel…");
    dialog = await screen.findByRole("dialog", { name: "Novo painel" });
    const field = within(
      dialog.querySelector<HTMLElement>('.dsh-new-card[data-choice="question"]')!,
    ).getByRole("textbox");
    fireEvent.change(field, { target: { value: "  Por que demora?  " } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Criar" }));
    await waitFor(() => expect(sent("POST", "/api/dashboards/pergunta/refresh")).toHaveLength(1));
    expect(sent("POST", "/api/dashboards")).toEqual([{ template: "question", question: "Por que demora?" }]);
    const posts = net.calls.filter((x) => x.method === "POST").map((x) => x.url);
    expect(posts).toEqual(["/api/dashboards", "/api/dashboards/pergunta/refresh"]);
    await waitFor(() => expect(where.pathname).toBe("/dashboards/pergunta"));
    await waitFor(() => expect(document.querySelector(".dsh-title")!.textContent).toBe("Por que demora?"));
    expect(dash.unexpected).toEqual([]);
  });
});

describe("C86 Personalizar", () => {
  const rows = (dialog: HTMLElement) =>
    [...dialog.querySelectorAll<HTMLElement>(".dsh-custom-row")].map(
      (r) => r.querySelector(".dsh-custom-t")!.textContent,
    );

  it("C86 the widgets in order, each with a Switch mostrar; ArrowDown and ArrowUp move the focused row; saving sends the order, hidden: true and the version read", async () => {
    serve("visao-geral", read(overview, snap, { version: V1 }));
    dash.writes.set("PUT /api/dashboards/visao-geral", async (body) => ({
      definition: (body as { definition: unknown }).definition,
      version: `sha256:${"2".repeat(64)}`,
    }));
    mountBoard();
    await screen.findByText("Uma nota");
    await choose(".dsh-more", "Personalizar");
    const dialog = await screen.findByRole("dialog", { name: "Personalizar" });
    expect(rows(dialog)).toEqual(["Notas", "Projetos", "Agentes"]);
    const switches = within(dialog).getAllByRole("switch");
    expect(switches.map((s) => s.getAttribute("aria-label"))).toEqual([
      "mostrar Notas",
      "mostrar Projetos",
      "mostrar Agentes",
    ]);
    expect(switches.map((s) => s.getAttribute("aria-checked"))).toEqual(["true", "true", "true"]);
    const grip = (title: string) => within(dialog).getByRole("button", { name: title });
    grip("Notas").focus();
    fireEvent.keyDown(grip("Notas"), { key: "ArrowDown" });
    expect(rows(dialog)).toEqual(["Projetos", "Notas", "Agentes"]);
    await waitFor(() => expect(document.activeElement).toBe(grip("Notas")));
    fireEvent.keyDown(grip("Agentes"), { key: "ArrowUp" });
    expect(rows(dialog)).toEqual(["Projetos", "Agentes", "Notas"]);
    fireEvent.click(within(dialog).getByRole("switch", { name: "mostrar Projetos" }));
    fireEvent.click(within(dialog).getByRole("button", { name: "Salvar" }));
    await waitFor(() => expect(sent("PUT", "/api/dashboards/visao-geral")).toHaveLength(1));
    const body = sent("PUT", "/api/dashboards/visao-geral")[0] as {
      definition: typeof overview;
      baseVersion: string;
    };
    expect(body.baseVersion).toBe(V1);
    expect(body.definition.widgets.map((x) => x.id)).toEqual(["b", "c", "a"]);
    expect(body.definition.widgets.map((x) => x.options?.hidden)).toEqual([true, undefined, undefined]);
    expect(body.definition.widgets[0]!.options).toEqual({ size: "m", hidden: true });
    expect({ ...body.definition, widgets: [] }).toEqual({ ...overview, widgets: [] });
  });

  it("C86 a 409 edit_conflict says Este painel mudou em outro lugar. with Recarregar, which reloads the definition", async () => {
    serve("visao-geral", read(overview, snap, { version: V1 }));
    dash.writes.set("PUT /api/dashboards/visao-geral", () =>
      Promise.reject(new NetError(409, "edit_conflict")),
    );
    mountBoard();
    await screen.findByText("Uma nota");
    await choose(".dsh-more", "Personalizar");
    const dialog = await screen.findByRole("dialog", { name: "Personalizar" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Salvar" }));
    const alert = await within(dialog).findByRole("alert");
    expect(alert.textContent).toContain("Este painel mudou em outro lugar.");
    const changed = definition("overview", [c, a]);
    answerRead("visao-geral", read(changed, snap, { version: `sha256:${"3".repeat(64)}` }));
    fireEvent.click(within(alert).getByRole("button", { name: "Recarregar" }));
    await waitFor(() => expect(rows(dialog)).toEqual(["Agentes", "Notas"]));
    expect(within(dialog).queryByRole("alert")).toBeNull();
  });
});

describe("C87 Mais", () => {
  it("C87 in order: Exportar HTML, Personalizar, Editar no editor do sistema, Arquivar painel", async () => {
    serve("visao-geral", read(overview, snap));
    mountBoard();
    await screen.findByText("Uma nota");
    const menu = await open(document.querySelector(".dsh-more")!);
    expect(menuItems(menu)).toEqual([
      "Exportar HTML",
      "Personalizar",
      "Editar no editor do sistema",
      "Arquivar painel",
    ]);
  });

  it("C87 Exportar HTML posts the export and shows the path it answered", async () => {
    serve("visao-geral", read(overview, snap));
    const path = "/home/me/.mordomo/artifacts/dashboards/visao-geral-2026-10-30T1407.html";
    dash.writes.set("POST /api/dashboards/visao-geral/export", async () => ({ path }));
    mountBoard();
    await screen.findByText("Uma nota");
    await choose(".dsh-more", "Exportar HTML");
    await screen.findByText((text) => text.includes(path));
    expect(sent("POST", "/api/dashboards/visao-geral/export")).toHaveLength(1);
  });

  it("C87 Editar no editor do sistema posts /api/memory/open with the dashboard's file", async () => {
    serve("visao-geral", read(overview, snap));
    mountBoard();
    await screen.findByText("Uma nota");
    await waitFor(() => expect(net.calls.some((x) => x.url === "/api/system/info")).toBe(true));
    await new Promise((r) => setTimeout(r, 20));
    await choose(".dsh-more", "Editar no editor do sistema");
    await waitFor(() =>
      expect(sent("POST", "/api/memory/open")).toEqual([{ p: `${MEM}/dashboards/visao-geral.json` }]),
    );
  });

  it("C87 Arquivar painel deletes it and the page moves to the first dashboard left", async () => {
    serve("visao-geral", read(overview, snap));
    const area = definition("area", [a], { title: "Projeto X" });
    serve(
      "contexto-x",
      read(area, snapshot("contexto-x", [ok("a", "list", { items: [{ title: "Do contexto" }], total: 1 })])),
    );
    dash.writes.set("DELETE /api/dashboards/visao-geral", async () => {
      dash.list = (dash.list as Array<{ id: string }>).filter((d) => d.id !== "visao-geral");
      return { archived: `${MEM}/archive/dashboards/visao-geral-2026-10-30.json` };
    });
    mountBoard({ path: "/dashboards/visao-geral" });
    await screen.findByText("Uma nota");
    await choose(".dsh-more", "Arquivar painel");
    await screen.findByText("Do contexto");
    expect(sent("DELETE", "/api/dashboards/visao-geral")).toHaveLength(1);
    expect(where.pathname).toBe("/dashboards/contexto-x");
  });
});
