// @vitest-environment jsdom
/**
 * Arrangements of the notes view that design.md decides (.specs/features/cerebro-vista-notas, C87-C89; "Correções da
 * rodada 1"): the person's own fold of the note panel, the reading area's "Definir uma Home" when no tab is open and
 * no Home exists, and the tabs' "+" at the end of the strip. The network is `./testnet`.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type * as ApiModule from "../../api";
import { installPage } from "../../ui/testkit";
import { renderWith } from "../../contexts/testkit";
import NotesView from "./NotesView";
import { MEM, net, note, resetNet } from "./testnet";

vi.mock("../../api", async (importOriginal) =>
  (await import("./testnet")).mockApi(await importOriginal<typeof ApiModule>()),
);
vi.setConfig({ testTimeout: 20_000 });

installPage();
beforeEach(() => resetNet());

// jsdom lays nothing out: the view reads as 1 440 px wide, so the note panel has its room.
const rect = HTMLElement.prototype.getBoundingClientRect;
beforeEach(() => {
  HTMLElement.prototype.getBoundingClientRect = function (this: HTMLElement) {
    if (this.classList.contains("notes-view"))
      return { x: 0, y: 0, top: 0, left: 0, width: 1440, height: 900, right: 1440, bottom: 900 } as DOMRect;
    return rect.call(this);
  };
});
afterEach(() => {
  HTMLElement.prototype.getBoundingClientRect = rect;
});

const view = () => renderWith(<NotesView onShowInGraph={() => undefined} />, { lang: "pt-BR" });
async function openNote(user: ReturnType<typeof userEvent.setup>, title: RegExp) {
  const folder = await screen.findByRole("treeitem", { name: /^notes/ });
  if (folder.getAttribute("aria-expanded") !== "true") await user.click(folder);
  await user.click(await screen.findByRole("treeitem", { name: title }));
  await screen.findByRole("article", { name: title });
}

describe("C87 the person folds the note panel", () => {
  it("C87 the Painel da nota button, pressed while the panel is open, closes it and opens it again, with the note still read", async () => {
    note(1, MEM, "notes/plano.md", { title: "Plano" });
    view();
    const user = userEvent.setup();
    await openNote(user, /Plano/);
    const panel = () => screen.queryByRole("complementary", { name: "Painel da nota" });
    expect(panel()).not.toBeNull();
    const toggle = screen.getByRole("button", { name: "Painel da nota" });
    expect(toggle.getAttribute("aria-pressed")).toBe("true");
    await user.click(toggle);
    expect(panel()).toBeNull();
    expect(toggle.getAttribute("aria-pressed")).toBe("false");
    expect(screen.getByRole("article", { name: "Plano" })).toBeTruthy();
    await user.click(toggle);
    expect(panel()).not.toBeNull();
    expect(toggle.getAttribute("aria-pressed")).toBe("true");
  });
});

describe("C88 the reading area's Definir uma Home", () => {
  it("C88 with no tab and no Home the reading area holds Definir uma Home beside its sentence; choosing it opens Escolher nota…, and the note picked becomes the Home the reading area shows", async () => {
    note(1, MEM, "notes/alfa.md", { title: "Alfa", content: "# Alfa\n\nA nota de início.\n" });
    view();
    const user = userEvent.setup();
    const sentence = await screen.findByText("Abra uma nota na árvore ou defina uma Home.");
    const reading = sentence.closest<HTMLElement>(".notes-reading")!;
    expect(reading).not.toBeNull();
    const set = within(reading).getByRole("button", { name: "Definir uma Home" });
    expect(sentence.parentElement!.contains(set)).toBe(true);
    // it waits for the root (a Home is a root's): once the tree has answered it can be chosen
    await screen.findByRole("treeitem", { name: /^notes/ });
    await waitFor(() => expect((set as HTMLButtonElement).disabled).toBe(false));
    await user.click(set);
    await user.type(await screen.findByRole("combobox", { name: "Escolher nota…" }), "alfa");
    await user.click(await screen.findByRole("option", { name: /Alfa/ }));
    expect(await within(reading).findByText("A nota de início.")).toBeTruthy();
    expect(screen.queryByText("Abra uma nota na árvore ou defina uma Home.")).toBeNull();
    const home = screen.getByRole("complementary", { name: "Notas" }).querySelector(".notes-home")!;
    expect(home.textContent).toBe("Alfa");
    await waitFor(() =>
      expect(
        net.calls.some(
          (c) =>
            c.method === "PUT" &&
            c.url === "/api/ui-preferences" &&
            (c.body as { brain?: { notes?: { home?: Record<string, string> } } }).brain?.notes?.home?.[
              MEM
            ] === `${MEM}/notes/alfa.md`,
        ),
      ).toBe(true),
    );
  });
});

describe("C89 the tabs' + at the end", () => {
  it("C89 Abrir outra nota is the last control of the tab strip, after every tab and every Fechar", async () => {
    note(1, MEM, "notes/alfa.md", { title: "Alfa" });
    note(2, MEM, "notes/beta.md", { title: "Beta" });
    view();
    const user = userEvent.setup();
    await openNote(user, /Alfa/);
    await openNote(user, /Beta/);
    const plus = screen.getByRole("button", { name: "Abrir outra nota" });
    const strip = plus.closest<HTMLElement>(".notes-tabs")!;
    expect(strip.lastElementChild).toBe(plus);
    const before = [
      ...within(strip).getAllByRole("tab"),
      ...within(strip).getAllByRole("button", { name: /^Fechar / }),
    ];
    expect(before).toHaveLength(4);
    for (const el of before)
      expect(
        el.compareDocumentPosition(plus) & Node.DOCUMENT_POSITION_FOLLOWING,
        el.textContent!,
      ).toBeTruthy();
  });
});
