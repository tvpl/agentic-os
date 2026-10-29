// @vitest-environment jsdom
/**
 * Settings › Memory › Contexts (.specs/features/cerebro-contextos, C36; design.md "Tela - Configurações › Memória ›
 * Contextos"): each context with its paths and their state as icon plus text, "Edit", "Edit brief" (the note editor
 * on `_resumo.md`, made from the template when missing) and "Delete", which asks first and says the notes stay. The
 * network is `./testnet`.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type * as ApiModule from "../api";
import { installPage } from "../ui/testkit";
import { OPEN_NOTE_EVENT, type NoteEditorRequest } from "../brain/noteEvents";
import { MemoryTab } from "../views/settings/memory";
import type { SettingsShape } from "../views/settings/shared";
import { ContextsSettings } from "./ContextsSettings";
import { CONTEXT, HOME, net, resetNet } from "./testnet";
import { renderWith } from "./testkit";

vi.mock("../api", async (importOriginal) =>
  (await import("./testnet")).mockApi(await importOriginal<typeof ApiModule>()),
);

installPage();
beforeEach(() => {
  resetNet();
  net.contexts = [
    CONTEXT("cliente-x", "App do cliente X", {
      files: 12,
      paths: [
        { path: "/work/x", state: "ok" },
        { path: "/work/x-old", state: "missing" },
        { path: "/work/x-hidden", state: "not_indexed" },
      ],
    }),
  ];
});

const row = async () => (await screen.findByText("App do cliente X")).closest("li.ctx-row") as HTMLElement;
const writes = () => net.calls.filter((c) => c.method !== "GET");

describe("C36 Settings › Memory › Contexts", () => {
  it("C36 each context with its id, file count and every path with its state as an icon and a text", async () => {
    renderWith(<ContextsSettings />);
    const r = await row();
    expect(within(r).getByText("cliente-x").classList.contains("mono")).toBe(true);
    expect(r.textContent).toContain("12 files");
    const paths = [...r.querySelectorAll(".ctx-row-path")].map((p) => ({
      path: p.querySelector(".ctx-row-path-t")!.textContent,
      state: p.querySelector(".ctx-state")!.textContent,
      icon: p.querySelector(".ctx-state svg") !== null,
    }));
    expect(paths).toEqual([
      { path: "/work/x", state: "Ok", icon: true },
      { path: "/work/x-old", state: "Folder is gone", icon: true },
      { path: "/work/x-hidden", state: "Outside the indexed folders", icon: true },
    ]);
    for (const name of ["Edit", "Edit brief", "Delete"])
      expect(within(r).getByRole("button", { name })).toBeTruthy();
    // With contexts, the section draws no "New context…" (design.md draws it in the empty state; the selector has it).
    expect(screen.queryByRole("button", { name: "New context…" })).toBeNull();
  });

  it("C36 the states in pt-BR: Ok, Pasta sumiu, Fora das pastas indexadas, and Editar, Editar resumo, Apagar", async () => {
    renderWith(<ContextsSettings />, { lang: "pt-BR" });
    const r = await row();
    expect([...r.querySelectorAll(".ctx-state")].map((s) => s.textContent)).toEqual([
      "Ok",
      "Pasta sumiu",
      "Fora das pastas indexadas",
    ]);
    for (const name of ["Editar", "Editar resumo", "Apagar"])
      expect(within(r).getByRole("button", { name })).toBeTruthy();
  });

  it("C36 Edit brief makes the brief when it is missing and opens the note editor on _resumo.md", async () => {
    const asked: NoteEditorRequest[] = [];
    const listen = (e: Event) => asked.push((e as CustomEvent<NoteEditorRequest>).detail);
    window.addEventListener(OPEN_NOTE_EVENT, listen);
    try {
      renderWith(<ContextsSettings />);
      await userEvent.setup().click(within(await row()).getByRole("button", { name: "Edit brief" }));
      await waitFor(() => expect(asked).toHaveLength(1));
      expect(writes()).toEqual([{ method: "PATCH", url: "/api/contexts/cliente-x", body: { brief: true } }]);
      expect(asked[0]).toEqual({ mode: "edit", path: `${HOME}/memory/notes/cliente-x/_resumo.md` });
    } finally {
      window.removeEventListener(OPEN_NOTE_EVENT, listen);
    }
  });

  it("C36 Edit opens the dialog filled in, and saving changes the name with PATCH, never the id", async () => {
    renderWith(<ContextsSettings />);
    const user = userEvent.setup();
    await user.click(within(await row()).getByRole("button", { name: "Edit" }));
    const dialog = await screen.findByRole("dialog", { name: "Edit context" });
    const name = within(dialog).getByRole("textbox", { name: "Name" }) as HTMLInputElement;
    expect(name.value).toBe("App do cliente X");
    expect([...dialog.querySelectorAll(".ctx-folder-path")].map((p) => p.textContent)).toEqual([
      "/work/x",
      "/work/x-old",
      "/work/x-hidden",
    ]);
    await user.clear(name);
    await user.type(name, "Cliente X");
    await user.click(within(dialog).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(writes()).toEqual([
      {
        method: "PATCH",
        url: "/api/contexts/cliente-x",
        body: { name: "Cliente X", paths: ["/work/x", "/work/x-old", "/work/x-hidden"] },
      },
    ]);
  });

  it("C36 Delete asks first, saying the notes stay; Cancel calls nothing, Delete calls DELETE", async () => {
    renderWith(<ContextsSettings />);
    const user = userEvent.setup();
    await user.click(within(await row()).getByRole("button", { name: "Delete" }));
    const confirm = await screen.findByRole("dialog");
    expect(confirm.textContent).toContain(
      "Delete the context App do cliente X? The notes in memory/notes/cliente-x/ stay where they are.",
    );
    await user.click(within(confirm).getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(writes()).toEqual([]);
    await user.click(within(await row()).getByRole("button", { name: "Delete" }));
    const again = await screen.findByRole("dialog");
    const del = within(again).getByRole("button", { name: "Delete" });
    expect(del.classList.contains("danger")).toBe(true);
    await user.click(del);
    await waitFor(() =>
      expect(writes()).toEqual([{ method: "DELETE", url: "/api/contexts/cliente-x", body: undefined }]),
    );
    expect(await screen.findByText("No contexts yet.")).toBeTruthy();
  });

  it("C36 with none: No contexts yet. and New context…", async () => {
    net.contexts = [];
    renderWith(<ContextsSettings />);
    expect(await screen.findByText("No contexts yet.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "New context…" })).toBeTruthy();
  });
});

describe("C52 the Contexts section on Settings › Memory", () => {
  it("C52 the section comes after the indexed folders (their rows and the field that adds one) and before the next setting", async () => {
    const s = {
      indexedFolders: [{ path: "/work", area: null, enabled: true }],
      areas: ["Projetos"],
      excludes: [],
      marketplace: { registries: [] },
    } as unknown as SettingsShape;
    renderWith(<MemoryTab s={s} put={vi.fn()} />);
    const section = (await screen.findByText("App do cliente X")).closest(".ctx-settings")!;
    expect(section).not.toBeNull();
    const folderRow = screen.getByText("/work", { selector: ".folder-row span" });
    const addFolder = document.getElementById("st-newfolder")!;
    const areas = document.getElementById("st-areas")!;
    const follows = (a: Node, b: Node) =>
      Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
    expect(follows(folderRow, section)).toBe(true);
    expect(follows(addFolder, section)).toBe(true);
    expect(follows(section, areas)).toBe(true);
    // The first field after the indexed folders' block is the section itself.
    const fields = [...document.querySelectorAll(".card > .field, .card > section")];
    const at = fields.indexOf(section);
    expect(at).toBeGreaterThan(0);
    expect(fields[at - 1]!.contains(addFolder)).toBe(true);
  });
});
