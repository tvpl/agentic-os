// @vitest-environment jsdom
/**
 * "New context…" (.specs/features/cerebro-contextos, C34, C35; design.md "Tela - Novo contexto"): opened from the
 * selector, a name and folders offered from the indexed folders and the subfolders the index knows, "Create" only with
 * both, and a typed folder outside the indexed ones that is indexed first ("Index and create"). The network is
 * `./testnet`.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type * as ApiModule from "../api";
import { installPage, tick } from "../ui/testkit";
import { ContextSelector } from "./ContextSelector";
import { folderChoices } from "./NewContextDialog";
import { net, resetNet, WORK } from "./testnet";
import { renderWith } from "./testkit";

vi.mock("../api", async (importOriginal) =>
  (await import("./testnet")).mockApi(await importOriginal<typeof ApiModule>()),
);

installPage();
beforeEach(() => {
  resetNet();
  net.graphDirs = [
    WORK,
    `${WORK}/clientes`,
    `${WORK}/clientes/x`,
    `${WORK}/clientes/x/src/deep`,
    "/elsewhere/z",
  ];
});

async function openDialog(lang: "en" | "pt-BR" = "en") {
  const user = userEvent.setup();
  renderWith(<ContextSelector variant="frame" />, { lang });
  await user.click(
    await screen.findByRole("button", { name: lang === "en" ? /Whole brain/ : /Todo o cérebro/ }),
  );
  await tick();
  await user.click(screen.getByRole("menuitem", { name: lang === "en" ? "New context…" : "Novo contexto…" }));
  const dialog = await screen.findByRole("dialog");
  return { user, dialog };
}
const writes = () => net.calls.filter((c) => c.method !== "GET").map((c) => `${c.method} ${c.url}`);

describe("C34 New context… asks for a name and folders, and makes the context active", () => {
  it("C34 the folders offered are the indexed folders and their subfolders from the index, two levels down", () => {
    expect(
      folderChoices(
        ["/work"],
        ["/work", "/work/a", "/work/a/b", "/work/a/b/c", "/work/d/e", "/other/f"],
      ).sort(),
    ).toEqual(["/work", "/work/a", "/work/a/b", "/work/d", "/work/d/e"].sort());
    // A sibling whose name starts like the folder is not under it.
    expect(folderChoices(["/work"], ["/work-old/a"])).toEqual(["/work"]);
  });

  it("C34 the dialog has the name field and offers those folders; Create is disabled without a name or a folder", async () => {
    const { user, dialog } = await openDialog();
    const name = within(dialog).getByRole("textbox", { name: "Name" });
    const create = within(dialog).getByRole("button", { name: "Create" });
    expect((create as HTMLButtonElement).disabled).toBe(true);
    await user.type(name, "App do cliente X");
    expect((create as HTMLButtonElement).disabled).toBe(true);
    await user.click(within(dialog).getByRole("button", { name: "Add folder" }));
    const picker = await screen.findByRole("dialog", { name: "Add folder" });
    await waitFor(() => expect(within(picker).getAllByRole("button").length).toBeGreaterThan(1));
    const offered = within(picker)
      .getAllByRole("button")
      .map((b) => b.textContent);
    expect(offered).toEqual(expect.arrayContaining([WORK, `${WORK}/clientes`, `${WORK}/clientes/x`]));
    expect(offered).not.toContain(`${WORK}/clientes/x/src`);
    expect(offered).not.toContain("/elsewhere/z");
    // Found by name.
    await user.type(within(picker).getByRole("textbox", { name: "Search folders" }), "clientes/x");
    expect(
      within(picker)
        .getAllByRole("button")
        .map((b) => b.textContent),
    ).toEqual([`${WORK}/clientes/x`]);
    await user.click(within(picker).getByRole("button", { name: `${WORK}/clientes/x` }));
    expect(within(dialog).getByText(`${WORK}/clientes/x`)).toBeTruthy();
    expect(within(dialog).getByText("Primary")).toBeTruthy();
    expect((create as HTMLButtonElement).disabled).toBe(false);
    // Without a name again, disabled again.
    await user.clear(name);
    expect((create as HTMLButtonElement).disabled).toBe(true);
  });

  it("C34 Create makes the context with POST /api/contexts and then makes it active", async () => {
    const { user, dialog } = await openDialog();
    await user.type(within(dialog).getByRole("textbox", { name: "Name" }), "App do cliente X");
    await user.type(within(dialog).getByRole("textbox", { name: "or type a path" }), `${WORK}/clientes/x`);
    await user.click(within(dialog).getByRole("button", { name: "Add" }));
    await user.click(within(dialog).getByRole("button", { name: "Create" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(writes()).toEqual(["POST /api/contexts", "PUT /api/ui-preferences"]);
    expect(net.calls.find((c) => c.method === "POST")!.body).toEqual({
      name: "App do cliente X",
      paths: [`${WORK}/clientes/x`],
    });
    expect(net.calls.find((c) => c.method === "PUT")!.body).toEqual({ activeContext: "app-do-cliente-x" });
    // The selector names it, and it is not taken for a context that is gone.
    expect(await screen.findByRole("button", { name: /App do cliente X/ })).toBeTruthy();
    expect(screen.queryByText("The active context no longer exists.")).toBeNull();
  });

  it("C34 the second folder can be made primary, and a refusal of the route stays in the open dialog", async () => {
    net.answers.set("POST /api/contexts", () =>
      Promise.reject(Object.assign(new Error("The path is not inside an indexed folder."), { status: 400 })),
    );
    const { user, dialog } = await openDialog();
    await user.type(within(dialog).getByRole("textbox", { name: "Name" }), "Dois");
    for (const p of [`${WORK}/a`, `${WORK}/b`]) {
      await user.type(within(dialog).getByRole("textbox", { name: "or type a path" }), p);
      await user.click(within(dialog).getByRole("button", { name: "Add" }));
    }
    await user.click(within(dialog).getByRole("button", { name: `More for ${WORK}/b` }));
    await tick();
    await user.click(screen.getByRole("menuitem", { name: "Make primary" }));
    const paths = [...dialog.querySelectorAll(".ctx-folder-path")].map((el) => el.textContent);
    expect(paths).toEqual([`${WORK}/b`, `${WORK}/a`]);
    await user.click(within(dialog).getByRole("button", { name: "Create" }));
    const alert = await within(dialog).findByRole("alert");
    expect(alert.textContent).toContain("The path is not inside an indexed folder.");
    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(writes()).toEqual(["POST /api/contexts"]);
  });
});

describe("C35 a folder outside the indexed ones is indexed first", () => {
  it("C35 it says This folder is not indexed. and Index and create adds it by PUT /api/settings, indexes, then creates, in that order", async () => {
    const { user, dialog } = await openDialog();
    await user.type(within(dialog).getByRole("textbox", { name: "Name" }), "Fora");
    await user.type(within(dialog).getByRole("textbox", { name: "or type a path" }), "/fora/projeto");
    await user.click(within(dialog).getByRole("button", { name: "Add" }));
    expect(within(dialog).getByText("This folder is not indexed.")).toBeTruthy();
    expect(within(dialog).queryByRole("button", { name: "Create" })).toBeNull();
    await user.click(within(dialog).getByRole("button", { name: "Index and create" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(writes()).toEqual([
      "PUT /api/settings",
      "POST /api/memory/index",
      "POST /api/contexts",
      "PUT /api/ui-preferences",
    ]);
    expect(net.calls.find((c) => c.url === "/api/settings" && c.method === "PUT")!.body).toEqual({
      indexedFolders: [
        { path: WORK, area: null, enabled: true },
        { path: "/fora/projeto", area: null, enabled: true },
      ],
    });
    expect(net.calls.find((c) => c.method === "POST" && c.url === "/api/contexts")!.body).toEqual({
      name: "Fora",
      paths: ["/fora/projeto"],
    });
  });

  it("C35 a folder inside an indexed one, or inside memory/, needs no index pass; pt-BR says Esta pasta não está indexada.", async () => {
    const { user, dialog } = await openDialog("pt-BR");
    await user.type(within(dialog).getByRole("textbox", { name: "ou digite um caminho" }), "/fora/b");
    await user.click(within(dialog).getByRole("button", { name: "Adicionar" }));
    expect(within(dialog).getByText("Esta pasta não está indexada.")).toBeTruthy();
    expect(within(dialog).getByRole("button", { name: "Indexar e criar" })).toBeTruthy();
    await user.click(within(dialog).getByRole("button", { name: "Tirar /fora/b" }));
    await user.type(
      within(dialog).getByRole("textbox", { name: "ou digite um caminho" }),
      "/home/me/.mordomo/memory/notas",
    );
    await user.click(within(dialog).getByRole("button", { name: "Adicionar" }));
    await waitFor(() => expect(within(dialog).queryByText("Esta pasta não está indexada.")).toBeNull());
    expect(within(dialog).getByRole("button", { name: "Criar" })).toBeTruthy();
  });
});
