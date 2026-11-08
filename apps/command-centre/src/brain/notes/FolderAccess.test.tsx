// @vitest-environment jsdom
/**
 * "Permissões de <pasta>" and the tree's marks (.specs/features/cerebro-memoria-confiavel, C139-C141; design.md
 * "Diálogo - Permissões da pasta"; G18): the `Menu` at the end of a folder's row ("Permissões…" then "Exportar
 * pasta…"), the 480px `Modal` with the two native selects, their hints, "Herdado de", the footer, what "Salvar",
 * "Remover restrição" and "Cancelar" send (L-042: the whole list), a failed save, the same modal from Settings ›
 * Memória, and the `EyeOff` / `Lock` after a restricted folder's name with its `Tooltip`. The network is `./testnet`.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import postcss from "postcss";
import type * as ApiModule from "../../api";
import { installPage } from "../../ui/testkit";
import { renderWith } from "../../contexts/testkit";
import { MemoryTab } from "../../views/settings/memory";
import type { SettingsShape } from "../../views/settings/shared";
import NotesView from "./NotesView";
import { MEM, NetError, net, note, resetNet } from "./testnet";

vi.mock("../../api", async (importOriginal) =>
  (await import("./testnet")).mockApi(await importOriginal<typeof ApiModule>()),
);
vi.setConfig({ testTimeout: 30_000 });

installPage();
const FIN = `${MEM}/notes/financeiro`;
const NOTES = `${MEM}/notes`;
type Entry = { path: string; agents: string; devices: string };
let saved: unknown[] = [];
beforeEach(() => {
  resetNet();
  note(1, MEM, "notes/financeiro/contas.md", { title: "Contas" });
  note(2, MEM, "notes/plano.md", { title: "Plano" });
  saved = [];
  net.writes.set("PUT /api/settings", (body) => {
    saved.push(body);
    net.folderAccess = (body as { folderAccess: Entry[] }).folderAccess;
    return Promise.resolve({});
  });
});

const view = () => renderWith(<NotesView onShowInGraph={() => undefined} />, { lang: "pt-BR" });
const css = (file: string, selector: string) => {
  const out: Record<string, string> = {};
  postcss.parse(readFileSync(join(__dirname, file), "utf8")).walkRules((r) => {
    if (r.parent?.type === "root" && r.selectors.includes(selector))
      r.walkDecls((d) => void (out[d.prop] = d.value));
  });
  return out;
};

/** The tree with `notes` open, and the row of `financeiro`. */
async function folderRow() {
  const user = userEvent.setup();
  view();
  await user.click(await screen.findByRole("treeitem", { name: /^notes/ }));
  const row = await screen.findByRole("treeitem", { name: /^financeiro/ });
  return { user, row };
}
async function openAccess() {
  const { user, row } = await folderRow();
  await user.click(within(row).getByRole("button", { name: "Opções de financeiro" }));
  await user.click(await screen.findByRole("menuitem", { name: "Permissões…" }));
  const dialog = await screen.findByRole("dialog", { name: "Permissões de financeiro" });
  return { user, dialog };
}
const select = (dialog: HTMLElement, name: string) =>
  within(dialog).getByRole("combobox", { name }) as HTMLSelectElement;
const optionTexts = (s: HTMLSelectElement) => [...s.options].map((o) => o.textContent);
const footer = (dialog: HTMLElement) =>
  [...dialog.querySelectorAll(".modal-actions button")].map((b) => `${b.className}|${b.textContent}`);

describe("C139 the folder's menu and the permissions modal", () => {
  it("C139 a folder row ends with a MoreHorizontal Menu trigger holding Permissões… (Shield) then Exportar pasta… (FolderOutput)", async () => {
    const { user, row } = await folderRow();
    const trigger = within(row).getByRole("button", { name: "Opções de financeiro" });
    expect(trigger.querySelector("svg.lucide-ellipsis, svg.lucide-more-horizontal")).not.toBeNull();
    // at the end of the row: after the name, and the last control of the row before the folder's children
    const name = row.querySelector(".notes-name")!;
    expect(name.compareDocumentPosition(trigger) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect([...row.querySelectorAll(":scope > * button")].at(-1)).toBe(trigger);
    await user.click(trigger);
    const items = await screen.findAllByRole("menuitem");
    expect(items.map((i) => i.textContent)).toEqual(["Permissões…", "Exportar pasta…"]);
    expect(items[0]!.querySelector("svg.lucide-shield")).not.toBeNull();
    expect(items[1]!.querySelector("svg.lucide-folder-output")).not.toBeNull();
    // opening the menu neither opened nor closed the folder
    expect(row.getAttribute("aria-expanded")).toBe("false");
  });

  it("C139 Permissões… opens a 480px Modal titled Permissões de financeiro with the path in mono 12px; Agentes then Dispositivos, native selects with the options in order", async () => {
    const { dialog } = await openAccess();
    expect(dialog.className).toContain("ft-modal");
    expect(css("folderTools.css", ".modal.ft-modal")).toMatchObject({ width: "min(480px, 100%)" });
    const path = within(dialog).getByText(FIN);
    expect(path.className).toContain("mono"); // `.mono`: the mono family at var(--fs-2), 12px
    const agents = select(dialog, "Agentes");
    const devices = select(dialog, "Dispositivos");
    expect(agents.tagName).toBe("SELECT");
    expect(devices.tagName).toBe("SELECT");
    expect(agents.compareDocumentPosition(devices) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(path.compareDocumentPosition(agents) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(optionTexts(agents)).toEqual(["Podem escrever", "Só ler", "Esconder"]);
    expect(optionTexts(devices)).toEqual(["Podem pedir escrita", "Só ler", "Esconder"]);
  });

  const HINTS = {
    agents: {
      write: "Execuções podem trabalhar e gravar aqui.",
      read: "Execuções leem, mas não gravam aqui.",
      hide: "O MordomoOS não entrega esta pasta a nenhum agente. Codex e Cursor leem o disco inteiro: com eles, uma execução que contém esta pasta é recusada.",
    },
    devices: {
      write: "Um dispositivo pode pedir uma execução que grava aqui; ela espera sua aprovação.",
      read: "Um dispositivo vê, mas não pede escrita aqui.",
      hide: "Nenhum dispositivo vê esta pasta nem o que há nela.",
    },
  } as const;
  for (const aud of ["agents", "devices"] as const)
    for (const level of ["write", "read", "hide"] as const)
      it(`C139 ${aud} at ${level}: the select preselects it, and the hint below it is the ${level} hint`, async () => {
        const other = aud === "agents" ? "devices" : "agents";
        net.folderAccess = [{ path: FIN, [aud]: level, [other]: "write" } as Entry];
        const { dialog } = await openAccess();
        const s = select(dialog, aud === "agents" ? "Agentes" : "Dispositivos");
        await waitFor(() => expect(s.value).toBe(level));
        const hint = document.getElementById(s.getAttribute("aria-describedby")!)!;
        expect(hint.textContent).toBe(HINTS[aud][level]);
        expect(s.compareDocumentPosition(hint) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
        // a sentence: 13px (design-system), never under the 12px floor
        expect(css("folderTools.css", ".ft-hint")).toMatchObject({ "font-size": "var(--fs-3)" });
      });

  it("C139 a hint follows the level chosen", async () => {
    const { user, dialog } = await openAccess();
    const s = select(dialog, "Agentes");
    await user.selectOptions(s, "read");
    expect(document.getElementById(s.getAttribute("aria-describedby")!)!.textContent).toBe(HINTS.agents.read);
  });

  it("C139 with an entry of notes deciding: Herdado de notes with CornerLeftUp, the levels it inherits; the footer Cancelar then Salvar (no Remover restrição without an own entry)", async () => {
    net.folderAccess = [{ path: NOTES, agents: "read", devices: "hide" }];
    const { dialog } = await openAccess();
    const inherited = await within(dialog).findByText("Herdado de notes");
    expect(inherited.querySelector("svg.lucide-corner-left-up")).not.toBeNull();
    expect([select(dialog, "Agentes").value, select(dialog, "Dispositivos").value]).toEqual(["read", "hide"]);
    expect(footer(dialog)).toEqual(["btn ghost|Cancelar", "btn primary|Salvar"]);
  });

  it("C139 with its own entry: no Herdado de; the footer Cancelar, Remover restrição (.btn.ghost), Salvar (.btn.primary)", async () => {
    net.folderAccess = [
      { path: NOTES, agents: "read", devices: "hide" },
      { path: FIN, agents: "hide", devices: "read" },
    ];
    const { dialog } = await openAccess();
    await waitFor(() => expect(select(dialog, "Agentes").value).toBe("hide"));
    expect(within(dialog).queryByText(/Herdado de/)).toBeNull();
    expect(footer(dialog)).toEqual([
      "btn ghost|Cancelar",
      "btn ghost|Remover restrição",
      "btn primary|Salvar",
    ]);
  });
});

describe("C140 what the permissions modal sends", () => {
  const OTHER: Entry = { path: `${MEM}/notes/outra`, agents: "read", devices: "read" };

  it("C140 Salvar adds the folder's entry to the whole list, every other entry kept", async () => {
    net.folderAccess = [OTHER];
    const { user, dialog } = await openAccess();
    await waitFor(() => expect(select(dialog, "Agentes").value).toBe("write"));
    await user.selectOptions(select(dialog, "Agentes"), "read");
    await user.selectOptions(select(dialog, "Dispositivos"), "hide");
    await user.click(within(dialog).getByRole("button", { name: "Salvar" }));
    await waitFor(() =>
      expect(saved).toEqual([{ folderAccess: [OTHER, { path: FIN, agents: "read", devices: "hide" }] }]),
    );
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("C140 Salvar replaces the folder's own entry in its place; Remover restrição sends the list without it", async () => {
    const own: Entry = { path: FIN, agents: "hide", devices: "hide" };
    net.folderAccess = [own, OTHER];
    const opened = await openAccess();
    const user = opened.user;
    let dialog = opened.dialog;
    await waitFor(() => expect(select(dialog, "Agentes").value).toBe("hide"));
    await user.selectOptions(select(dialog, "Dispositivos"), "read");
    await user.click(within(dialog).getByRole("button", { name: "Salvar" }));
    await waitFor(() =>
      expect(saved).toEqual([{ folderAccess: [{ path: FIN, agents: "hide", devices: "read" }, OTHER] }]),
    );
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    saved = [];
    const row = screen.getByRole("treeitem", { name: /^financeiro/ });
    await user.click(within(row).getByRole("button", { name: "Opções de financeiro" }));
    await user.click(await screen.findByRole("menuitem", { name: "Permissões…" }));
    dialog = await screen.findByRole("dialog", { name: "Permissões de financeiro" });
    await user.click(await within(dialog).findByRole("button", { name: "Remover restrição" }));
    await waitFor(() => expect(saved).toEqual([{ folderAccess: [OTHER] }]));
  });

  it("C140 Cancelar sends nothing", async () => {
    net.folderAccess = [OTHER];
    const { user, dialog } = await openAccess();
    await user.selectOptions(select(dialog, "Agentes"), "hide");
    await user.click(within(dialog).getByRole("button", { name: "Cancelar" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(saved).toEqual([]);
    expect(net.calls.filter((c) => c.method !== "GET" && c.url === "/api/settings")).toEqual([]);
  });

  it("C140 a 400 leaves the Modal open with the message in its body", async () => {
    net.writes.set("PUT /api/settings", () =>
      Promise.reject(
        new NetError(400, "validation", "folderAccess.0.path: inside memory/ or an indexed folder"),
      ),
    );
    const { user, dialog } = await openAccess();
    await user.click(within(dialog).getByRole("button", { name: "Salvar" }));
    const alert = await within(dialog).findByRole("alert");
    expect(alert.textContent).toContain("folderAccess.0.path: inside memory/ or an indexed folder");
    expect(screen.getByRole("dialog", { name: "Permissões de financeiro" })).toBe(dialog);
  });
});

describe("C140 the same modal from Settings › Memória", () => {
  it("C140 the Permissões… button of a row of Pastas com acesso restrito opens Permissões de financeiro, and Salvar sends the whole list", async () => {
    const other: Entry = { path: `${MEM}/notes/outra`, agents: "read", devices: "read" };
    net.folderAccess = [{ path: FIN, agents: "read", devices: "hide" }, other];
    const user = userEvent.setup();
    renderWith(
      <MemoryTab
        s={
          {
            indexedFolders: [],
            areas: [],
            excludes: [],
            marketplace: { registries: [] },
            memory: { agentStance: "neutral" },
          } as unknown as SettingsShape
        }
        put={() => Promise.resolve({ ok: true as const })}
      />,
      { lang: "pt-BR" },
    );
    const row = (await screen.findByText(FIN)).closest(".folder-row") as HTMLElement;
    await user.click(within(row).getByRole("button", { name: "Permissões…" }));
    const dialog = await screen.findByRole("dialog", { name: "Permissões de financeiro" });
    expect(dialog.className).toContain("ft-modal");
    await waitFor(() => expect(select(dialog, "Dispositivos").value).toBe("hide"));
    await user.selectOptions(select(dialog, "Agentes"), "hide");
    await user.click(within(dialog).getByRole("button", { name: "Salvar" }));
    await waitFor(() =>
      expect(saved).toEqual([{ folderAccess: [{ path: FIN, agents: "hide", devices: "hide" }, other] }]),
    );
  });
});

describe("C141 the tree's mark of a restricted folder", () => {
  const mark = (row: HTMLElement) =>
    row.querySelector(":scope > .notes-row .notes-lock") as HTMLElement | null;

  it("C141 an access with a hide shows EyeOff after the name; with read and no hide, Lock; each named by the levels (the Tooltip's text); none without access", async () => {
    note(3, MEM, "notes/leitura/a.md");
    note(4, MEM, "notes/livre/b.md");
    net.access[`${MEM}|notes/financeiro`] = { agents: "read", devices: "hide" };
    net.access[`${MEM}|notes/leitura`] = { agents: "read", devices: "write" };
    const user = userEvent.setup();
    view();
    await user.click(await screen.findByRole("treeitem", { name: /^notes/ }));
    const fin = await screen.findByRole("treeitem", { name: /^financeiro/ });
    const finMark = mark(fin)!;
    expect(finMark.querySelector("svg.lucide-eye-off")).not.toBeNull();
    expect(finMark.getAttribute("aria-label")).toBe("Agentes: Só ler · Dispositivos: Esconder");
    const name = fin.querySelector(":scope > .notes-row .notes-name")!;
    expect(name.compareDocumentPosition(finMark) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    const leitura = screen.getByRole("treeitem", { name: /^leitura/ });
    const lock = mark(leitura)!;
    expect(lock.querySelector("svg.lucide-lock")).not.toBeNull();
    expect(lock.querySelector("svg.lucide-eye-off")).toBeNull();
    expect(lock.getAttribute("aria-label")).toBe("Agentes: Só ler · Dispositivos: Podem pedir escrita");

    expect(mark(screen.getByRole("treeitem", { name: /^livre/ }))).toBeNull();

    // the Tooltip says the same, on hover
    await user.hover(finMark);
    await waitFor(
      () =>
        expect(screen.getAllByRole("tooltip").map((x) => x.textContent)).toContain(
          "Agentes: Só ler · Dispositivos: Esconder",
        ),
      { timeout: 2000 },
    );
  });
});

/* ---------------- C168: the sizes of the hints and of "Herdado de" ---------------- */

/** `--fs-2` and `--fs-3` as the theme defines them, in px. */
const px = (value: string) => {
  const token = /^var\((--[\w-]+)\)$/.exec(value)?.[1];
  const sheet = postcss.parse(readFileSync(join(__dirname, "..", "..", "theme.css"), "utf8"));
  let found: string | undefined;
  sheet.walkRules(":root", (r) => r.walkDecls(token ?? "", (d) => void (found ??= d.value)));
  return Number.parseFloat(found ?? value);
};

describe("C168 the six hints are sentences at 13px and Herdado de is a label at 12px", () => {
  it("C168 each of the six hints is a full sentence in .ft-hint, 13px (--fs-3), and none is under the 12px floor; the feature's design.md says 12px for them, the design-system says 13px for sentences (G37, the design-system wins)", async () => {
    const { user, dialog } = await openAccess();
    const hints: string[] = [];
    for (const [aud, name] of [
      ["agents", "Agentes"],
      ["devices", "Dispositivos"],
    ] as const)
      for (const level of ["write", "read", "hide"] as const) {
        const s = select(dialog, name);
        await user.selectOptions(s, level);
        const hint = document.getElementById(s.getAttribute("aria-describedby")!)!;
        expect(hint.className, `${aud} ${level}`).toBe("ft-hint");
        hints.push(hint.textContent!);
      }
    expect(hints).toHaveLength(6);
    for (const text of hints) expect(text, text).toMatch(/^\p{Lu}.*\.$/u);
    const size = css("folderTools.css", ".ft-hint")["font-size"]!;
    expect(size).toBe("var(--fs-3)");
    expect(px(size)).toBe(13);
    expect(px(size)).toBeGreaterThanOrEqual(12);
  });

  it("C168 Herdado de <pasta> is a short label with CornerLeftUp in .ft-inherited, 12px (--fs-2) as design.md gives it, and not a paragraph", async () => {
    net.folderAccess = [{ path: NOTES, agents: "read", devices: "hide" }];
    const { dialog } = await openAccess();
    const label = await within(dialog).findByText("Herdado de notes");
    expect(label.className).toBe("ft-inherited");
    expect(label.tagName).toBe("DIV");
    expect(label.querySelector("svg.lucide-corner-left-up")).not.toBeNull();
    expect(label.textContent).not.toMatch(/\.$/);
    const size = css("folderTools.css", ".ft-inherited")["font-size"]!;
    expect(size).toBe("var(--fs-2)");
    expect(px(size)).toBe(12);
    // the label is the only 12px text of the modal; the rest is sentences at 13px or the path in mono 12px (.mono)
    expect(css("folderTools.css", ".ft-hint")["font-size"]).toBe("var(--fs-3)");
  });
});
