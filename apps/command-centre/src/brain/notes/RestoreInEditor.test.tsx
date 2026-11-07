// @vitest-environment jsdom
/**
 * A restore against the note open in the editor (.specs/features/cerebro-memoria-confiavel, C170, C171; design.md
 * "Binding sources", cerebro-v2 row: "o conflito ao restaurar usa o texto e a faixa de conflito do editor; a nota
 * restaurada recarrega no mesmo estado «Salvo»"), through the real notes view: the editor of cerebro-v2 in place, the
 * panel's "Histórico" and the dialog of a version. The network is `./testnet`.
 *
 * The reading of the cerebro-v2 row (settled, G37): the text of a restore conflict is AC 42's (`history.conflict`, with
 * "Recarregar"), because the editor's own text ("Esta nota mudou no disco...", "Carregar a versão do disco", "Salvar como
 * cópia") names actions a restore does not have; the band is the editor's: a `role="alert"` with `AlertTriangle` first,
 * the same border, ground, radius and icon colour as `.note-editor-banner`.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import postcss from "postcss";
import type * as ApiModule from "../../api";
import { installPage } from "../../ui/testkit";
import { renderWith } from "../../contexts/testkit";
import NotesView from "./NotesView";
import { MEM, NetError, asked, net, note, pathOf, resetNet, type Asked, type FileDef } from "./testnet";

vi.mock("../../api", async (importOriginal) =>
  (await import("./testnet")).mockApi(await importOriginal<typeof ApiModule>()),
);
vi.setConfig({ testTimeout: 30_000 });

installPage();

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

const BEFORE = "# A\n\nO texto de agora.\n";
const RESTORED = "# A\n\nO texto de antes.\n";
const H = 3_600_000;
let f: FileDef;
const OLD = { id: 7, at: Date.now() - 5 * H, author: "owner", origin: "save", sha256: "sha256:old" };

beforeEach(() => {
  resetNet();
  f = note(1, MEM, "notes/a.md", { title: "A", content: BEFORE, version: "sha256:now" });
  net.overrides.push((u: Asked) => {
    if (u.pathname === "/api/memory/history") {
      return Promise.resolve({
        versions: [
          {
            ...OLD,
            path: "notes/a.md",
            size: RESTORED.length,
            exists: true,
          },
          {
            id: 8,
            path: "notes/a.md",
            at: Date.now() - 6 * H,
            author: "owner",
            origin: "create",
            size: 3,
            sha256: "sha256:first",
            exists: true,
          },
        ],
      });
    }
    if (u.pathname === "/api/memory/history/7")
      return Promise.resolve({
        ...OLD,
        path: "notes/a.md",
        content: RESTORED,
        diff: "--- a/notes/a.md\n+++ b/notes/a.md\n@@ -1,3 +1,3 @@\n # A\n \n-O texto de agora.\n+O texto de antes.\n",
        current: f.version,
      });
    return undefined;
  });
});

function view() {
  return renderWith(<NotesView onShowInGraph={() => undefined} />, { lang: "pt-BR" });
}
/** The note open in the editor in place, with its panel. */
async function editing() {
  const user = userEvent.setup();
  view();
  await user.click(await screen.findByRole("treeitem", { name: /^notes/ }));
  await user.click(await screen.findByRole("treeitem", { name: /^A/ }));
  await screen.findByRole("article", { name: /A/ });
  await user.click(screen.getByRole("button", { name: "Editar" }));
  return user;
}
const state = () => document.querySelector<HTMLElement>('.notes-editor [role="status"]')!;
// By its class: while a dialog is up the page behind it is inert, and the role query leaves it out.
const field = () => document.querySelector<HTMLTextAreaElement>("textarea.note-editor-field")!;
const reads = () => asked("/api/memory/note").filter((q) => q.get("p") === pathOf(f)).length;
const restores = () =>
  net.calls.filter((c) => c.method === "POST" && c.url === "/api/memory/history/restore");
async function openVersion(user: ReturnType<typeof userEvent.setup>) {
  const fold = await waitFor(() => {
    const el = [...document.querySelectorAll<HTMLElement>(".notes-panel-body > .notes-fold")].find(
      (s) => s.querySelector(".notes-fold-head")?.textContent === "Histórico",
    );
    expect(el?.querySelectorAll(".hf-pick")).toHaveLength(2);
    return el!;
  });
  await user.click(fold.querySelector<HTMLElement>(".hf-pick")!);
  return screen.findByRole("dialog", { name: /^Versão de / });
}
const rule = (file: string, selector: string): Record<string, string> => {
  const out: Record<string, string> = {};
  postcss.parse(readFileSync(join(__dirname, file), "utf8")).walkRules((r) => {
    if (r.parent?.type === "root" && r.selectors.includes(selector))
      r.walkDecls((d) => void (out[d.prop] = d.value));
  });
  return out;
};

describe("C170 the restored note reloads in the Salvo state", () => {
  it("C170 with the note open in the editor (Salvo), restoring a version closes the dialog, says Versão restaurada., and the editor shows the restored text in the same Salvo state, with Salvar off", async () => {
    net.writes.set("POST /api/memory/history/restore", () => {
      f.content = RESTORED;
      f.version = "sha256:restored";
      return Promise.resolve({ path: "notes/a.md", version: "sha256:restored" });
    });
    const user = await editing();
    expect(state().textContent).toBe("Salvo");
    expect(field().value).toBe(BEFORE);
    const dialog = await openVersion(user);
    const readsBefore = reads();
    await user.click(await within(dialog).findByRole("button", { name: "Restaurar esta versão" }));
    // exactly the open note's version is sent
    await waitFor(() => expect(restores()).toHaveLength(1));
    expect(restores()[0]!.body).toEqual({ id: 7, baseVersion: "sha256:now" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    await waitFor(() => expect(document.querySelector(".hf-notice")?.textContent).toBe("Versão restaurada."));
    // the note is read again, and the editor follows the disk: the restored text, in the state it started from
    await waitFor(() => expect(reads()).toBeGreaterThan(readsBefore));
    await waitFor(() => expect(field().value).toBe(RESTORED));
    expect(state().textContent).toBe("Salvo");
    expect(state().className).toBe("note-state saved");
    expect(state().querySelector("svg.lucide-check")).not.toBeNull();
    expect(screen.getByRole("button", { name: "Salvar" }).hasAttribute("disabled")).toBe(true);
    expect(screen.queryByText("Alterações não salvas")).toBeNull();
    // the editor saved nothing: the restore was the only write
    expect(net.calls.filter((c) => c.method !== "GET" && c.url === "/api/memory/notes")).toEqual([]);
  });
});

describe("C171 a restore against a stale version shows the editor's conflict band", () => {
  const stale = () =>
    net.writes.set("POST /api/memory/history/restore", () =>
      Promise.reject(new NetError(409, "edit_conflict", "The file is not the version named")),
    );

  it("C171 the dialog stays open with the band: role=alert, AlertTriangle first, A nota mudou desde que você abriu. Recarregue e tente de novo. and Recarregar; the note and the editor stay as they were", async () => {
    stale();
    const user = await editing();
    await user.type(field(), "Mais um pouco.");
    expect(state().textContent).toBe("Alterações não salvas");
    const dialog = await openVersion(user);
    const readsBefore = reads();
    await user.click(await within(dialog).findByRole("button", { name: "Restaurar esta versão" }));
    const band = await within(dialog).findByRole("alert");
    expect(band.className).toBe("vd-failure");
    expect(band.firstElementChild!.matches("svg.lucide-triangle-alert, svg.lucide-alert-triangle")).toBe(
      true,
    );
    expect(band.textContent).toBe("A nota mudou desde que você abriu. Recarregue e tente de novo.Recarregar");
    expect(screen.getByRole("dialog", { name: /^Versão de / })).toBe(dialog);
    expect(restores()).toHaveLength(1);
    // nothing changed: not read again, the typed text kept, the state still the editor's own
    expect(reads()).toBe(readsBefore);
    expect(field().value).toBe(`${BEFORE}Mais um pouco.`);
    expect(f.content).toBe(BEFORE);
    // Recarregar reads the note again and clears the band
    await user.click(within(band).getByRole("button", { name: "Recarregar" }));
    await waitFor(() => expect(reads()).toBeGreaterThan(readsBefore));
    await waitFor(() => expect(within(dialog).queryByRole("alert")).toBeNull());
    expect(field().value).toBe(`${BEFORE}Mais um pouco.`);
  });

  it("C171 the band is the editor's: the editor's own conflict banner has the same role and icon first, and the two stylesheets give them the same border, ground, radius, text and icon colour", async () => {
    stale();
    const user = await editing();
    const dialog = await openVersion(user);
    await user.click(await within(dialog).findByRole("button", { name: "Restaurar esta versão" }));
    const band = await within(dialog).findByRole("alert");
    const mine = [band.getAttribute("role"), band.firstElementChild!.getAttribute("class")];
    await user.click(
      within(dialog.querySelector<HTMLElement>(".modal-actions")!).getByRole("button", { name: "Fechar" }),
    );
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    // the editor's banner, from a save the disk overtook
    net.writes.set("PUT /api/memory/notes", () =>
      Promise.reject(new NetError(409, "edit_conflict", "The file changed after it was read")),
    );
    await user.type(field(), "!");
    await user.keyboard("{Control>}s{/Control}");
    const theirs = (
      await screen.findByText("Esta nota mudou no disco depois que você a abriu.")
    ).closest<HTMLElement>('[role="alert"]')!;
    expect(theirs.className).toBe("note-editor-banner");
    expect([theirs.getAttribute("role"), theirs.firstElementChild!.getAttribute("class")]).toEqual(mine);

    const a = rule("history.css", ".vd-failure");
    const b = rule("../noteEditor.css", ".note-editor-banner");
    for (const prop of ["border", "border-radius", "background", "color", "font-size"])
      expect(a[prop], prop).toBe(b[prop]);
    expect(a.border).toBe("1px solid var(--warn)");
    expect(a.background).toBe("var(--warn-bg)");
    const iconA = rule("history.css", ".vd-failure > svg");
    const iconB = rule("../noteEditor.css", ".note-editor-banner > svg");
    for (const prop of ["width", "height", "color"]) expect(iconA[prop], `icon ${prop}`).toBe(iconB[prop]);
  });
});
