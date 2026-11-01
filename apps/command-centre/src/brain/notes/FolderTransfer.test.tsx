// @vitest-environment jsdom
/**
 * "Exportar pasta…" and "Importar pasta…" (.specs/features/cerebro-memoria-confiavel, C143, C144; design.md "Diálogos
 * - Exportar pasta e Importar pasta"; G18): the 480px `Modal`s, what each sends (exactly), the spinner while the copy
 * runs, the result with "Abrir pasta" or the names left out, the messages of the codes, the item only with the root
 * `memory/`, and the tree selecting the new folder. The network is `./testnet`.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type * as ApiModule from "../../api";
import { installPage } from "../../ui/testkit";
import { renderWith } from "../../contexts/testkit";
import NotesView from "./NotesView";
import { MEM, NetError, WORK, net, note, resetNet } from "./testnet";

vi.mock("../../api", async (importOriginal) =>
  (await import("./testnet")).mockApi(await importOriginal<typeof ApiModule>()),
);
vi.setConfig({ testTimeout: 30_000 });

installPage();
const PROJ = `${MEM}/notes/projetos`;
const OUT = "/home/me/.mordomo/artifacts/exports/projetos-2026-10-31-2330";
beforeEach(() => {
  resetNet();
  note(1, MEM, "notes/projetos/a.md", { title: "A" });
  note(2, WORK, "doc.md", { title: "Doc" });
});

const view = () => renderWith(<NotesView onShowInGraph={() => undefined} />, { lang: "pt-BR" });
const writes = (url: string) => net.calls.filter((c) => c.method !== "GET" && c.url === url);
/** A write answered when the test says. */
function held(key: string) {
  let settle!: { ok: (v: unknown) => void; fail: (e: unknown) => void };
  net.writes.set(
    key,
    () =>
      new Promise((ok, fail) => {
        settle = { ok, fail };
      }),
  );
  return () => settle;
}

async function openExport() {
  const user = userEvent.setup();
  view();
  await user.click(await screen.findByRole("treeitem", { name: /^notes/ }));
  const row = await screen.findByRole("treeitem", { name: /^projetos/ });
  await user.click(within(row).getByRole("button", { name: "Opções de projetos" }));
  await user.click(await screen.findByRole("menuitem", { name: "Exportar pasta…" }));
  const dialog = await screen.findByRole("dialog");
  return { user, dialog };
}

describe("C143 the export dialog", () => {
  it("C143 a 480px Modal with the intro and Exportar, which sends exactly { folder }; while pending a spinner and Copiando…; on 200 CircleCheck, 12 arquivos, 48 KB em, the path in mono, Abrir pasta (POST /api/memory/open { p }) then Fechar", async () => {
    const answer = held("POST /api/memory/export");
    const { user, dialog } = await openExport();
    expect(dialog.className).toContain("ft-modal");
    expect(dialog.textContent).toContain(
      "Copia esta pasta para a pasta de exportações do MordomoOS, com um manifesto que confere cada arquivo.",
    );
    const run = within(dialog).getByRole("button", { name: "Exportar" });
    expect(run.className).toBe("btn primary");
    await user.click(run);
    expect(writes("/api/memory/export").map((c) => c.body)).toEqual([{ folder: PROJ }]);
    const status = await within(dialog).findByRole("status");
    expect(status.querySelector(".spinner")).not.toBeNull();
    expect(status.textContent).toContain("Copiando…");
    answer().ok({ path: OUT, files: 12, bytes: 48 * 1024 });
    const done = await within(dialog).findByText(/12 arquivos, 48 KB em/);
    expect(
      done.querySelector("svg.lucide-circle-check, svg.lucide-check-circle-2, svg.lucide-circle-check-big"),
    ).not.toBeNull();
    const path = within(dialog).getByText(OUT);
    expect(path.className).toBe("mono");
    expect(
      done.compareDocumentPosition(path) & Node.DOCUMENT_POSITION_FOLLOWING || done.contains(path),
    ).toBeTruthy();
    expect(within(dialog).queryByRole("status")).toBeNull();
    const actions = [...dialog.querySelectorAll(".modal-actions button")].map((b) => b.textContent);
    expect(actions).toEqual(["Abrir pasta", "Fechar"]);
    await user.click(within(dialog).getByRole("button", { name: "Abrir pasta" }));
    expect(writes("/api/memory/open").map((c) => c.body)).toEqual([{ p: OUT }]);
    await user.click(
      within(dialog.querySelector<HTMLElement>(".modal-actions")!).getByRole("button", { name: "Fechar" }),
    );
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("C143 on 413 folder_too_large the body says A pasta passa do limite de 2 000 arquivos ou 64 MB.", async () => {
    const answer = held("POST /api/memory/export");
    const { user, dialog } = await openExport();
    await user.click(within(dialog).getByRole("button", { name: "Exportar" }));
    answer().fail(
      new NetError(413, "folder_too_large", "Folder is too large to copy (more than 2000 files)"),
    );
    const alert = await within(dialog).findByRole("alert");
    expect(alert.textContent).toBe("A pasta passa do limite de 2 000 arquivos ou 64 MB.");
    expect(screen.getByRole("dialog")).toBe(dialog);
  });
});

async function headingMenu(user: ReturnType<typeof userEvent.setup>) {
  const side = await screen.findByRole("complementary", { name: "Notas" });
  const tools = within(side).getByRole("heading", { name: "NOTAS" }).parentElement!;
  await user.click(await within(tools).findByRole("button", { name: "Opções das notas" }));
  return screen.findAllByRole("menuitem");
}
async function openImport() {
  const user = userEvent.setup();
  view();
  await screen.findByRole("treeitem", { name: /^notes/ });
  const items = await headingMenu(user);
  await user.click(items.find((i) => i.textContent === "Importar pasta…")!);
  const dialog = await screen.findByRole("dialog");
  return { user, dialog };
}

describe("C144 the import dialog", () => {
  it("C144 the NOTAS Menu holds Importar pasta… (FolderInput) with the root memory/, and not with another root", async () => {
    const user = userEvent.setup();
    view();
    await screen.findByRole("treeitem", { name: /^notes/ });
    const items = await headingMenu(user);
    expect(items.map((i) => i.textContent)).toEqual(["Histórico da memória", "Importar pasta…"]);
    expect(items[1]!.querySelector("svg.lucide-folder-input")).not.toBeNull();
    await user.keyboard("{Escape}");
    await user.click(screen.getByRole("button", { name: /Memória/ }));
    await user.click(await screen.findByRole("menuitemcheckbox", { name: /work/ }));
    await screen.findByRole("treeitem", { name: /Doc/ });
    const other = await headingMenu(user);
    expect(other.map((i) => i.textContent)).toEqual(["Histórico da memória"]);
  });

  it("C144 a 480px Modal: Pasta de origem with its hint, Nome da pasta nova filled with the source's last name as it is typed; Importar sends { sourceDir, folder }; on 200 7 arquivos importados. and 2 deixados de fora with the two names, and the tree selects notes/vault-antigo", async () => {
    note(3, MEM, "notes/vault-antigo/x.md", { title: "X" });
    const answer = held("POST /api/memory/import");
    const { user, dialog } = await openImport();
    expect(dialog.className).toContain("ft-modal");
    const source = within(dialog).getByLabelText("Pasta de origem") as HTMLInputElement;
    expect(document.getElementById(source.getAttribute("aria-describedby")!)!.textContent).toBe(
      "Uma pasta que o MordomoOS já lê: uma pasta indexada ou do home.",
    );
    const name = within(dialog).getByLabelText("Nome da pasta nova") as HTMLInputElement;
    expect(source.compareDocumentPosition(name) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    await user.type(source, "/work/vault");
    expect(name.value).toBe("vault");
    await user.type(source, "-antigo");
    expect(name.value).toBe("vault-antigo");
    await user.click(within(dialog).getByRole("button", { name: "Importar" }));
    expect(writes("/api/memory/import").map((c) => c.body)).toEqual([
      { sourceDir: "/work/vault-antigo", folder: "vault-antigo" },
    ]);
    answer().ok({
      folder: `${MEM}/notes/vault-antigo`,
      files: 7,
      bytes: 900,
      skipped: [".env", "atalho.md"],
    });
    await within(dialog).findByText("7 arquivos importados.");
    const left = within(dialog).getByText("2 deixados de fora");
    const names = [...left.parentElement!.querySelectorAll("li")].map((li) => li.textContent);
    expect(names).toEqual([".env", "atalho.md"]);
    // behind the dialog (the page is inert while it is up), the tree has opened notes and selected the new folder
    await waitFor(() =>
      expect(
        document
          .querySelector(`[role="treeitem"][data-path="${MEM}/notes/vault-antigo"]`)
          ?.getAttribute("aria-selected"),
      ).toBe("true"),
    );
    expect(document.querySelector(`[data-path="${MEM}/notes"]`)!.getAttribute("aria-expanded")).toBe("true");
  });

  it("C144 a name typed by hand is sent as typed", async () => {
    const { user, dialog } = await openImport();
    await user.type(within(dialog).getByLabelText("Pasta de origem"), "/work/vault");
    const name = within(dialog).getByLabelText("Nome da pasta nova");
    await user.clear(name);
    await user.type(name, "outra");
    await user.click(within(dialog).getByRole("button", { name: "Importar" }));
    expect(writes("/api/memory/import").map((c) => c.body)).toEqual([
      { sourceDir: "/work/vault", folder: "outra" },
    ]);
  });

  for (const [code, status, text] of [
    ["exists", 409, "Já existe uma pasta com esse nome em notes/."],
    ["forbidden_path", 403, "O MordomoOS não lê essa pasta. Adicione-a como pasta indexada antes."],
  ] as const)
    it(`C144 ${status} ${code} shows ${text}`, async () => {
      net.writes.set("POST /api/memory/import", () =>
        Promise.reject(new NetError(status, code, "server text")),
      );
      const { user, dialog } = await openImport();
      await user.type(within(dialog).getByLabelText("Pasta de origem"), "/work/vault");
      await user.click(within(dialog).getByRole("button", { name: "Importar" }));
      const alert = await within(dialog).findByRole("alert");
      expect(alert.textContent).toBe(text);
    });
});
