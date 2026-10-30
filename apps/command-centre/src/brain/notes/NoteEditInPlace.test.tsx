// @vitest-environment jsdom
/**
 * Editing a note where it is read (.specs/features/cerebro-vista-notas, C64-C67; design.md "Área de leitura", items 2
 * and 4): "Editar" turns the body into the editor of cerebro-v2 with the panel still there, `[[` lists the notes to link,
 * a save clears the tab's mark and reaches the body, the panel and (after the next index pass) the tree, and a note that
 * cannot be edited says so. The network is `./testnet`; the event stream is the shell's own, fed by the test.
 */
import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type * as ApiModule from "../../api";
import { api, type OsEvent } from "../../api";
import { useEventStream } from "../../hooks/useEventStream";
import { installPage } from "../../ui/testkit";
import { renderWith } from "../../contexts/testkit";
import NotesView from "./NotesView";
import { MEM, NetError, net, note, pathOf, resetNet, type FileDef } from "./testnet";

vi.mock("../../api", async (importOriginal) =>
  (await import("./testnet")).mockApi(await importOriginal<typeof ApiModule>()),
);
vi.setConfig({ testTimeout: 30_000 });

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

/** The shell's event stream, with the test as the server. */
let push: (e: OsEvent) => void = () => undefined;
function Stream() {
  useEventStream();
  return null;
}
function view() {
  vi.mocked(api.streamEvents).mockImplementation((onEvent: (e: OsEvent) => void) => {
    push = onEvent;
    return () => undefined;
  });
  return renderWith(
    <>
      <Stream />
      <NotesView onShowInGraph={() => undefined} />
    </>,
    { lang: "pt-BR" },
  );
}

/** `PUT /api/memory/notes` as the server answers it: the file on the network becomes the new version. */
function answerSaves(f: FileDef, gate?: Promise<void>) {
  let n = 1;
  net.writes.set("PUT /api/memory/notes", async (body) => {
    await gate;
    const b = body as { content: string };
    f.content = b.content;
    f.version = `sha256:saved-${++n}`;
    return { path: pathOf(f), name: "plano.md", version: f.version, size: b.content.length, mtime: 3 };
  });
}

async function openNote(title: RegExp) {
  const user = userEvent.setup();
  await user.click(await screen.findByRole("treeitem", { name: /^notes/ }));
  await user.click(await screen.findByRole("treeitem", { name: title }));
  await screen.findByRole("article", { name: title });
  return user;
}
const state = () => document.querySelector<HTMLElement>('.notes-editor [role="status"]')!;
const field = () => screen.getByRole("textbox", { name: "Texto da nota" }) as HTMLTextAreaElement;
const saves = () => net.calls.filter((c) => c.method === "PUT" && c.url === "/api/memory/notes");

describe("C64 the editor in place", () => {
  it("C64 Editar turns the reading area into the cerebro-v2 editor in place: the textarea in mono 13px, the status line by state with its icon, Salvar, Ctrl+S, the panel still visible and no dialog; Ler turns it back", async () => {
    const f = note(1, MEM, "notes/plano.md", { title: "Plano", content: "# Plano\n\nO corpo.\n" });
    let open!: () => void;
    answerSaves(
      f,
      new Promise<void>((r) => {
        open = r;
      }),
    );
    view();
    const user = await openNote(/Plano/);
    await user.click(screen.getByRole("button", { name: "Editar" }));
    const text = field();
    expect(text.tagName).toBe("TEXTAREA");
    expect(text.value).toBe("# Plano\n\nO corpo.\n");
    expect(text.closest("article.notes-note")).not.toBeNull();
    // mono 13px: the field's rule of cerebro-v2's stylesheet
    expect(text.className).toContain("note-editor-field");
    const css = fs.readFileSync(path.join(__dirname, "..", "noteEditor.css"), "utf8");
    const rule = /textarea\.input\.note-editor-field\s*\{([^}]*)\}/.exec(css)![1]!;
    expect(rule).toMatch(/font-family:\s*var\(--font-mono\)/);
    expect(rule).toMatch(/font-size:\s*var\(--fs-3\)/);
    // the panel stays, and nothing is a dialog
    expect(screen.getByRole("complementary", { name: "Painel da nota" })).toBeTruthy();
    expect(screen.queryByRole("dialog")).toBeNull();

    const is = (label: string, icon: string) => {
      expect(state().textContent).toBe(label);
      expect(state().querySelector(`svg.${icon}`), label).not.toBeNull();
    };
    is("Salvo", "lucide-check");
    await user.type(text, "Mais.");
    is("Alterações não salvas", "lucide-circle");
    await user.click(screen.getByRole("button", { name: "Salvar" }));
    await waitFor(() => is("Salvando…", "lucide-loader-circle"));
    await act(async () => open());
    await waitFor(() => is("Salvo", "lucide-check"));
    expect((saves()[0]!.body as { content: string }).content).toBe("# Plano\n\nO corpo.\nMais.");

    // Ctrl+S, overtaken by the disk
    net.writes.set("PUT /api/memory/notes", () =>
      Promise.reject(new NetError(409, "edit_conflict", "The file changed after it was read")),
    );
    await user.type(field(), " E mais.");
    await user.keyboard("{Control>}s{/Control}");
    await waitFor(() => is("Conflito", "lucide-triangle-alert"));
    expect(saves()).toHaveLength(2);
    const banner = screen
      .getByText("Esta nota mudou no disco depois que você a abriu.")
      .closest<HTMLElement>('[role="alert"]')!;
    expect(banner.textContent).toContain("Esta nota mudou no disco depois que você a abriu.");
    await user.click(within(banner).getByRole("button", { name: "Carregar a versão do disco" }));
    await waitFor(() => is("Salvo", "lucide-check"));
    expect(field().value).toBe("# Plano\n\nO corpo.\nMais.");

    // a save that fails
    net.writes.set("PUT /api/memory/notes", () =>
      Promise.reject(new NetError(500, "boom", "O disco falhou.")),
    );
    await user.type(field(), "!");
    await user.click(screen.getByRole("button", { name: "Salvar" }));
    await waitFor(() => is("Erro ao salvar", "lucide-circle-alert"));
    expect(screen.getByText("O disco falhou.")).toBeTruthy();

    // Ler: the body again
    await user.click(screen.getByRole("button", { name: "Ler" }));
    expect(screen.queryByRole("textbox", { name: "Texto da nota" })).toBeNull();
    expect(document.querySelector(".notes-note-body .brain-md")).not.toBeNull();
    expect(screen.getByRole("button", { name: "Editar" })).toBeTruthy();
  });
});

describe("C65 [[ lists the notes to link", () => {
  it("C65 typing [[pla lists at most 8 notes whose title or name holds pla accent-folded; Enter inserts [[Planejamento]] and closes it; Esc closes it with nothing inserted", async () => {
    note(1, MEM, "notes/agenda.md", { title: "Agenda", content: "# Agenda\n" });
    note(2, MEM, "notes/planejamento.md", { title: "Planejamento" });
    note(3, MEM, "notes/plancton.md", { title: "Plâncton" });
    for (let i = 0; i < 8; i++) note(10 + i, MEM, `notes/z${i}-plano.md`, { title: `Plano ${i}` });
    view();
    const user = await openNote(/Agenda/);
    await user.click(screen.getByRole("button", { name: "Editar" }));
    const text = field();
    await user.click(text);
    await user.keyboard("{Control>}{End}{/Control}");
    await user.type(text, "Veja [[[[pla", { initialSelectionStart: text.value.length });
    const list = await screen.findByRole("listbox", { name: "Notas para ligar" });
    const names = within(list)
      .getAllByRole("option")
      .map((o) => o.querySelector(".notes-search-title")!.textContent);
    expect(names.length).toBeLessThanOrEqual(8);
    expect(names).toContain("Planejamento");
    expect(names).toContain("Plâncton");
    expect(names).not.toContain("Agenda");
    expect(names[0]).toBe("Planejamento");
    await user.keyboard("{Enter}");
    expect(text.value).toBe("# Agenda\nVeja [[Planejamento]]");
    expect(screen.queryByRole("listbox", { name: "Notas para ligar" })).toBeNull();

    await user.type(text, " e [[[[pla");
    await screen.findByRole("listbox", { name: "Notas para ligar" });
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("listbox", { name: "Notas para ligar" })).toBeNull();
    expect(text.value).toBe("# Agenda\nVeja [[Planejamento]] e [[pla");
  });
});

describe("C66 after a save", () => {
  it("C66 the tab loses its unsaved mark, the body and the panel show the saved text, and the tree the new title after the next index.finished", async () => {
    const f = note(1, MEM, "notes/plano.md", { title: "Plano", content: "# Plano\n\nO corpo.\n" });
    answerSaves(f);
    view();
    const user = await openNote(/Plano/);
    await user.click(screen.getByRole("button", { name: "Editar" }));
    await user.clear(field());
    await user.type(field(), "# Plano novo\n\n## Seção nova\n\nTexto salvo.\n");
    const tab = screen.getByRole("tab", { name: /Plano/ });
    await waitFor(() => expect(tab.textContent).toContain("alterações não salvas"));
    expect(tab.querySelector(".notes-tab-dot")).not.toBeNull();
    await user.click(screen.getByRole("button", { name: "Salvar" }));
    await waitFor(() => expect(state().textContent).toBe("Salvo"));
    expect(tab.textContent).not.toContain("alterações não salvas");
    expect(tab.querySelector(".notes-tab-dot")).toBeNull();

    // the panel reads the saved text
    const panel = screen.getByRole("complementary", { name: "Painel da nota" });
    await waitFor(() => expect(within(panel).getByRole("button", { name: "Seção nova" })).toBeTruthy());
    // the body, read again
    await user.click(screen.getByRole("button", { name: "Ler" }));
    await waitFor(() => expect(screen.getByText("Texto salvo.")).toBeTruthy());

    // the tree, once the index pass that follows the save ends
    const tree = screen.getByRole("tree");
    expect(within(tree).queryByRole("treeitem", { name: /Plano novo/ })).toBeNull();
    f.title = "Plano novo";
    act(() => push({ type: "index.finished", payload: {} } as unknown as OsEvent));
    await waitFor(() => expect(within(tree).getByRole("treeitem", { name: /Plano novo/ })).toBeTruthy(), {
      timeout: 3000,
    });
  });
});

describe("C67 a note that cannot be edited", () => {
  it("C67 shows in its header the badge Somente leitura with its reason, and no Editar", async () => {
    note(1, "/work", "projeto.md", {
      title: "Projeto",
      editable: false,
      noteReason: "Only notes under memory/ can be edited.",
    });
    note(2, MEM, "notes/plano.md", { title: "Plano" });
    view();
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: /Memória/ }));
    await user.click(await screen.findByRole("menuitemcheckbox", { name: /work/ }));
    await user.click(await screen.findByRole("treeitem", { name: /Projeto/ }));
    const article = await screen.findByRole("article", { name: "Projeto" });
    const head = article.querySelector("header")!;
    const badge = within(head).getByText("Somente leitura");
    expect(badge.className).toContain("notes-badge");
    expect(badge.parentElement!.textContent).toBe("Somente leituraOnly notes under memory/ can be edited.");
    expect(within(head).queryByRole("button", { name: "Editar" })).toBeNull();
  });
});
