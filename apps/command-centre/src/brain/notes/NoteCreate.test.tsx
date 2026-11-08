// @vitest-environment jsdom
/**
 * Creating in the tree (.specs/features/cerebro-vista-notas, C68-C71; design.md "Tela - Nova nota / Nova pasta"):
 * "Nova nota" opens the create dialog of cerebro-v2 with the selected folder chosen and opens the new note in a tab to
 * edit, "Nova pasta" asks a name and a first note, the fixed structure disables what the service would refuse, and
 * both controls live only under the root `memory/`. The editor's host is mounted as the shell mounts it; the network is
 * `./testnet`.
 */
import fs from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type * as ApiModule from "../../api";
import { installPage } from "../../ui/testkit";
import { renderWith } from "../../contexts/testkit";
import { NoteEditorHost } from "../NoteEditorHost";
import NotesView from "./NotesView";
import { MEM, WORK, net, note, resetNet } from "./testnet";

vi.mock("../../api", async (importOriginal) =>
  (await import("./testnet")).mockApi(await importOriginal<typeof ApiModule>()),
);
vi.setConfig({ testTimeout: 30_000 });

installPage();
beforeEach(() => resetNet());

function view() {
  return renderWith(
    <>
      <NotesView onShowInGraph={() => undefined} />
      <NoteEditorHost />
    </>,
    { lang: "pt-BR" },
  );
}
const heading = () => screen.getByRole("heading", { name: "NOTAS" }).parentElement as HTMLElement;
const creates = () => net.calls.filter((c) => c.method === "POST" && c.url === "/api/memory/notes");
/** `POST /api/memory/notes` as the server answers it: the note exists on the network from then on. */
function answerCreate() {
  net.writes.set("POST /api/memory/notes", (body) => {
    const b = body as { title: string; folder?: string };
    const rel = `notes/${b.folder ? `${b.folder}/` : ""}${b.title.toLowerCase()}.md`;
    note(90, MEM, rel, { title: b.title, content: `# ${b.title}\n` });
    return Promise.resolve({
      path: `${MEM}/${rel}`,
      name: `${b.title.toLowerCase()}.md`,
      version: "sha256:90",
      size: 10,
      mtime: 1,
    });
  });
}
async function selectFolder(...names: RegExp[]) {
  const user = userEvent.setup();
  for (const name of names) await user.click(await screen.findByRole("treeitem", { name }));
  return user;
}

describe("C68 Nova nota", () => {
  it("C68 with memory/notes/clientes selected, the create Modal of cerebro-v2 has the read-only field Pasta with clientes and Trocar; Criar sends folder clientes and opens the note in a tab in edit mode", async () => {
    note(1, MEM, "notes/clientes/acme.md", { title: "Acme" });
    answerCreate();
    view();
    const user = await selectFolder(/^notes/, /^clientes/);
    await user.click(within(heading()).getByRole("button", { name: "Nova nota" }));
    const dialog = await screen.findByRole("dialog", { name: "Nova nota" });
    const folder = within(dialog).getByRole("textbox", { name: "Pasta" }) as HTMLInputElement;
    expect(folder.value).toBe("clientes");
    expect(folder.readOnly).toBe(true);
    expect(within(dialog).getByRole("button", { name: "Trocar" })).toBeTruthy();
    await user.type(within(dialog).getByRole("textbox", { name: "Título" }), "Proposta");
    await user.click(within(dialog).getByRole("button", { name: "Criar" }));
    await waitFor(() => expect(creates()).toHaveLength(1));
    expect(creates()[0]!.body).toEqual({ title: "Proposta", folder: "clientes" });
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Nova nota" })).toBeNull());
    const tab = await screen.findByRole("tab", { name: /Proposta/ });
    expect(tab.getAttribute("aria-selected")).toBe("true");
    const text = (await screen.findByRole("textbox", { name: "Texto da nota" })) as HTMLTextAreaElement;
    expect(text.value).toBe("# Proposta\n");
  });
});

describe("C69 Nova pasta", () => {
  it("C69 opens a 420px Modal with Nome da pasta and Título da primeira nota; Criar is disabled until both have text, and sends the title with folder = the selected folder plus the new name", async () => {
    note(1, MEM, "notes/clientes/acme.md", { title: "Acme" });
    answerCreate();
    view();
    const user = await selectFolder(/^notes/, /^clientes/);
    await user.click(within(heading()).getByRole("button", { name: "Nova pasta" }));
    const dialog = await screen.findByRole("dialog", { name: "Nova pasta" });
    expect(dialog.className).toContain("notes-folder-dialog");
    const css = fs.readFileSync(path.join(__dirname, "notes.css"), "utf8");
    expect(/\.modal\.notes-folder-dialog\s*\{([^}]*)\}/.exec(css)![1]).toMatch(
      /width:\s*min\(420px,\s*100%\)/,
    );
    const create = within(dialog).getByRole("button", { name: "Criar" }) as HTMLButtonElement;
    expect(create.disabled).toBe(true);
    await user.type(within(dialog).getByRole("textbox", { name: "Nome da pasta" }), "acme-2");
    expect(create.disabled).toBe(true);
    await user.type(within(dialog).getByRole("textbox", { name: "Título da primeira nota" }), "Contrato");
    expect(create.disabled).toBe(false);
    await user.click(create);
    await waitFor(() => expect(creates()).toHaveLength(1));
    expect(creates()[0]!.body).toEqual({ title: "Contrato", folder: "clientes/acme-2" });
  });
});

describe("C70 the fixed structure", () => {
  it("C70 with fixedStructure true, Nova pasta at the top of memory/notes and Nova nota with no folder selected are disabled with the Tooltip; Nova nota with a folder selected is enabled", async () => {
    net.fixedStructure = true;
    note(1, MEM, "notes/clientes/acme.md", { title: "Acme" });
    view();
    const user = userEvent.setup();
    await screen.findByRole("treeitem", { name: /^notes/ });
    const button = (name: string) => within(heading()).getByRole("button", { name });
    await waitFor(() => expect(button("Nova nota").getAttribute("aria-disabled")).toBe("true"));
    const why = "Estrutura fixa: crie dentro de uma pasta existente";
    const tipOf = async (el: HTMLElement) => {
      await user.hover(el);
      await waitFor(() => expect(screen.getAllByRole("tooltip").map((x) => x.textContent)).toContain(why), {
        timeout: 2000,
      });
      await user.unhover(el);
    };
    // no folder selected
    await tipOf(button("Nova nota"));
    await user.click(button("Nova nota"));
    expect(screen.queryByRole("dialog")).toBeNull();
    // the top of memory/notes
    await user.click(screen.getByRole("treeitem", { name: /^notes/ }));
    expect(button("Nova pasta").getAttribute("aria-disabled")).toBe("true");
    await tipOf(button("Nova pasta"));
    await user.click(button("Nova pasta"));
    expect(screen.queryByRole("dialog")).toBeNull();
    // a folder that exists: Nova nota is allowed
    await user.click(await screen.findByRole("treeitem", { name: /^clientes/ }));
    expect(button("Nova nota").getAttribute("aria-disabled")).toBeNull();
    await user.click(button("Nova nota"));
    expect(await screen.findByRole("dialog", { name: "Nova nota" })).toBeTruthy();
  });
});

describe("C71 only under memory/", () => {
  it("C71 Nova nota and Nova pasta are rendered with the root memory/ and absent with an indexed folder or a context path outside memory/ as the root", async () => {
    note(1, MEM, "notes/a.md", { title: "A" });
    note(2, WORK, "projetos/app.md", { title: "App" });
    const { unmount } = view();
    await screen.findByRole("treeitem", { name: /^notes/ });
    expect(within(heading()).getByRole("button", { name: "Nova nota" })).toBeTruthy();
    expect(within(heading()).getByRole("button", { name: "Nova pasta" })).toBeTruthy();
    // an indexed folder
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /Memória/ }));
    await user.click(await screen.findByRole("menuitemcheckbox", { name: /work/ }));
    await screen.findByRole("treeitem", { name: /^projetos/ });
    expect(within(heading()).queryByRole("button", { name: "Nova nota" })).toBeNull();
    expect(within(heading()).queryByRole("button", { name: "Nova pasta" })).toBeNull();
    unmount();

    // a context's path outside memory/
    net.prefs.brain = {};
    net.contexts = [{ id: "alfa", name: "Alfa", paths: [{ path: WORK, state: "ok" }], files: 1 }];
    net.contextRoots.alfa = [{ path: WORK, name: "work", editable: false, indexing: false }];
    net.prefs.activeContext = "alfa";
    view();
    await screen.findByRole("treeitem", { name: /^projetos/ });
    expect(within(heading()).queryByRole("button", { name: "Nova nota" })).toBeNull();
    expect(within(heading()).queryByRole("button", { name: "Nova pasta" })).toBeNull();
  });
});
