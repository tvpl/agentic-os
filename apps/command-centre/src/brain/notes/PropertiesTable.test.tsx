// @vitest-environment jsdom
/**
 * The properties of a note on screen (.specs/features/cerebro-vista-notas, C56-C63; design.md "Área de leitura", item
 * 3): the table right below the note's header, a value edited in place and written through
 * `PUT /api/memory/notes/properties`, `review_every` and its rule, the conflict banner, a note that cannot be edited,
 * the lock while the text has unsaved changes, "+ Adicionar propriedade" and "Remover". The network is `./testnet`.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type * as ApiModule from "../../api";
import { installPage, tick } from "../../ui/testkit";
import { renderWith } from "../../contexts/testkit";
import { NoteReader } from "./NoteReader";
import NotesView from "./NotesView";
import { MEM, NetError, net, note, pathOf, resetNet, type FileDef } from "./testnet";

vi.mock("../../api", async (importOriginal) =>
  (await import("./testnet")).mockApi(await importOriginal<typeof ApiModule>()),
);
vi.setConfig({ testTimeout: 20_000 });

installPage();
beforeEach(() => resetNet());

const HEAD = "---\ntype: context\n---\n";
const PROPS: NonNullable<FileDef["properties"]> = [
  { key: "type", kind: "text", value: "context" },
  { key: "tags", kind: "list", value: ["offer", "accelerator"] },
  { key: "updated", kind: "date", value: "2026-10-14" },
  { key: "created", kind: "date", value: "2026-10-29T19:03:23.000Z" },
  { key: "status", kind: "status", value: "active" },
  { key: "natureza", kind: "select", value: "plano" },
  { key: "escopo", kind: "select", value: "equipe" },
  { key: "review_every", kind: "interval", value: "30d" },
];

function plan(over: Partial<FileDef> = {}) {
  return note(1, MEM, "notes/plano.md", {
    title: "Plano",
    content: `${HEAD}# Plano\n\nO corpo.\n`,
    bodyStart: HEAD.length,
    properties: PROPS,
    ...over,
  });
}

function read(f: FileDef) {
  const onOpen = vi.fn();
  renderWith(
    <NoteReader
      path={pathOf(f)}
      id={f.id}
      meta={{ id: f.id, title: f.title }}
      onOpen={onOpen}
      onShowInGraph={() => undefined}
      onSetHome={() => undefined}
    />,
    { lang: "pt-BR" },
  );
  return { onOpen };
}

const table = () => screen.findByRole("region", { name: "Propriedades" });
const row = (key: string) => {
  const th = screen.getByRole("rowheader", { name: key });
  return th.closest("tr") as HTMLElement;
};
/** Every `PUT /api/memory/notes/properties` the screen sent, by body. */
const writes = () =>
  net.calls.filter((c) => c.method === "PUT" && c.url === "/api/memory/notes/properties").map((c) => c.body);
/** The route answers as the server does, and the note on the network is then that new version. */
function answerWrites(f: FileDef) {
  let n = 1;
  net.writes.set("PUT /api/memory/notes/properties", (body) => {
    const b = body as { set?: Record<string, string | string[]>; remove?: string[] };
    const props = (f.properties ?? [])
      .filter((p) => !b.remove?.includes(p.key))
      .map((p) => (b.set && p.key in b.set ? { ...p, value: b.set[p.key]! } : p));
    f.properties = props;
    f.version = `sha256:${++n}`;
    return Promise.resolve({
      path: pathOf(f),
      name: "plano.md",
      version: f.version,
      size: 10,
      mtime: 2,
      properties: props,
    });
  });
}

describe("C56 the table and its kinds", () => {
  it("C56 right below the header, each key with the icon of its kind; text, chips with X, a date field, the selects of status, natureza and escopo, review_every with its suggestions; a date that is not AAAA-MM-DD as text; other properties in mono; no header shows only + Adicionar propriedade", async () => {
    const f = plan({ otherProperties: "meta:\n  a: 1\n# c" });
    read(f);
    const props = await table();
    const head = document.querySelector("article.notes-note > header")!;
    expect(head.nextElementSibling).toBe(props);

    const icon: Record<string, string> = {
      type: "lucide-text",
      tags: "lucide-tag",
      updated: "lucide-calendar",
      created: "lucide-calendar",
      status: "lucide-circle-dot",
      natureza: "lucide-list-checks",
      escopo: "lucide-list-checks",
      review_every: "lucide-repeat",
    };
    const keys = within(props)
      .getAllByRole("rowheader")
      .map((th) => th.textContent);
    expect(keys).toEqual(PROPS.map((p) => p.key));
    for (const [key, cls] of Object.entries(icon))
      expect(row(key).querySelector(`th svg.${cls}`), key).not.toBeNull();

    // text
    expect(
      (within(row("type")).getByRole("textbox", { name: "Valor de type" }) as HTMLInputElement).value,
    ).toBe("context");
    // chips, each with its own X
    const chips = [...row("tags").querySelectorAll(".notes-chip")].map((c) => c.firstChild!.textContent);
    expect(chips).toEqual(["offer", "accelerator"]);
    expect(within(row("tags")).getByRole("button", { name: "Remover offer" })).toBeTruthy();
    expect(within(row("tags")).getByRole("button", { name: "Remover accelerator" })).toBeTruthy();
    // a date field
    const date = row("updated").querySelector<HTMLInputElement>('input[type="date"]')!;
    expect(date.value).toBe("2026-10-14");
    // a date read that is not AAAA-MM-DD: text, with no field
    expect(row("created").querySelector("input")).toBeNull();
    expect(row("created").querySelector("td")!.textContent).toContain("2026-10-29T19:03:23.000Z");
    // the three selects
    const options = (key: string) =>
      [...within(row(key)).getByRole("combobox").querySelectorAll("option")].map((o) => o.textContent);
    expect(options("status")).toEqual(["active", "draft", "paused", "done", "archived"]);
    expect(options("natureza")).toEqual(["Fato", "Opinião", "Plano", "Hipótese", "Relato"]);
    expect(options("escopo")).toEqual(["Pessoal", "Equipe", "Externo"]);
    expect((within(row("natureza")).getByRole("combobox") as HTMLSelectElement).value).toBe("plano");
    // review_every and its suggestions
    const every = within(row("review_every")).getByRole("combobox", {
      name: "Valor de review_every",
    }) as HTMLInputElement;
    expect(every.value).toBe("30d");
    const list = document.getElementById(every.getAttribute("list")!)!;
    expect(list.tagName).toBe("DATALIST");
    expect([...list.querySelectorAll("option")].map((o) => o.getAttribute("value"))).toEqual([
      "7d",
      "30d",
      "90d",
      "180d",
      "365d",
      "never",
    ]);
    // the lines the reader does not understand, in mono, read-only
    const other = screen.getByText("Outras propriedades (somente leitura)").parentElement!;
    const pre = other.querySelector("pre")!;
    expect(pre.className).toContain("mono");
    expect(pre.textContent).toBe("meta:\n  a: 1\n# c");
    expect(other.querySelector("input, textarea, select")).toBeNull();
  });

  it("C56 a note with no header shows only + Adicionar propriedade", async () => {
    const f = note(2, MEM, "notes/solta.md", { title: "Solta", content: "# Solta\n" });
    read(f);
    const props = await table();
    expect(within(props).queryByRole("table")).toBeNull();
    expect(
      within(props)
        .getAllByRole("button")
        .map((b) => b.textContent),
    ).toEqual(["+ Adicionar propriedade"]);
    expect(props.textContent).toBe("+ Adicionar propriedade");
  });
});

describe("C57 a value written in place", () => {
  it("C57 Enter, or leaving the field, sends the key in set with the note's version as baseVersion; Esc restores the value and sends nothing", async () => {
    const f = plan({ version: "sha256:v1" });
    answerWrites(f);
    read(f);
    await table();
    const user = userEvent.setup();
    const field = within(row("type")).getByRole("textbox", { name: "Valor de type" }) as HTMLInputElement;

    // Esc: back to what it was, nothing sent
    await user.clear(field);
    await user.type(field, "projeto");
    await user.keyboard("{Escape}");
    expect(field.value).toBe("context");
    await tick(20);
    expect(writes()).toEqual([]);

    // Enter
    await user.clear(field);
    await user.type(field, "projeto{Enter}");
    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(writes()[0]).toEqual({ path: pathOf(f), baseVersion: "sha256:v1", set: { type: "projeto" } });

    // leaving the field, with the version the last write answered
    const date = row("updated").querySelector<HTMLInputElement>('input[type="date"]')!;
    date.focus();
    fireEvent.change(date, { target: { value: "2026-10-30" } });
    fireEvent.blur(date);
    await waitFor(() => expect(writes()).toHaveLength(2));
    expect(writes()[1]).toEqual({ path: pathOf(f), baseVersion: "sha256:2", set: { updated: "2026-10-30" } });

    // a select writes when it changes
    await user.selectOptions(within(row("status")).getByRole("combobox"), "archived");
    await waitFor(() => expect(writes()).toHaveLength(3));
    expect((writes()[2] as { set: unknown }).set).toEqual({ status: "archived" });
  });
});

describe("C58 review_every and its rule", () => {
  it("C58 typing 30 shows Use um número de dias, como 30d, ou never. under the field and sends nothing; 30d and never are sent", async () => {
    const f = plan({ properties: [{ key: "review_every", kind: "interval", value: "7d" }] });
    net.writes.set("PUT /api/memory/notes/properties", () => new Promise(() => undefined));
    read(f);
    await table();
    const user = userEvent.setup();
    const field = within(row("review_every")).getByRole("combobox", { name: "Valor de review_every" });
    await user.clear(field);
    await user.type(field, "30{Enter}");
    const error = await screen.findByText("Use um número de dias, como 30d, ou never.");
    expect(field.parentElement!.contains(error)).toBe(true);
    expect(field.compareDocumentPosition(error) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(field.getAttribute("aria-invalid")).toBe("true");
    await user.tab();
    await tick(20);
    expect(writes()).toEqual([]);

    await user.click(field);
    await user.type(field, "d{Enter}");
    await waitFor(() => expect(writes()).toHaveLength(1));
    expect((writes()[0] as { set: unknown }).set).toEqual({ review_every: "30d" });
    expect(screen.queryByText("Use um número de dias, como 30d, ou never.")).toBeNull();

    await user.clear(field);
    await user.type(field, "never{Enter}");
    await waitFor(() => expect(writes()).toHaveLength(2));
    expect((writes()[1] as { set: unknown }).set).toEqual({ review_every: "never" });
  });
});

describe("C59 the conflict banner", () => {
  it("C59 a 409 edit_conflict shows over the table the banner of cerebro-v2", async () => {
    const f = plan();
    net.writes.set("PUT /api/memory/notes/properties", () =>
      Promise.reject(new NetError(409, "edit_conflict", "The file changed after it was read")),
    );
    read(f);
    const props = await table();
    const user = userEvent.setup();
    await user.selectOptions(within(row("status")).getByRole("combobox"), "done");
    const banner = await within(props).findByRole("alert");
    expect(banner.textContent).toContain("Esta nota mudou no disco depois que você a abriu.");
    expect(within(banner).getByRole("button", { name: "Carregar a versão do disco" })).toBeTruthy();
    expect(within(banner).getByRole("button", { name: "Salvar como cópia" })).toBeTruthy();
    // over the table
    const grid = within(props).getByRole("table");
    expect(banner.compareDocumentPosition(grid) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});

describe("C60 a note that cannot be edited", () => {
  it("C60 with editable false the table has no field, no row menu and no + Adicionar propriedade", async () => {
    const f = plan({ editable: false, noteReason: "Only notes under memory/ can be edited." });
    read(f);
    const props = await table();
    expect(within(props).getAllByRole("rowheader")).toHaveLength(PROPS.length);
    expect(props.querySelector("input, select, textarea")).toBeNull();
    expect(within(props).queryAllByRole("button")).toEqual([]);
    expect(within(props).queryByText("+ Adicionar propriedade")).toBeNull();
    expect(row("natureza").querySelector("td")!.textContent).toBe("Plano");
  });
});

describe("C61 the lock while the text is not saved", () => {
  it("C61 while the body has unsaved changes in the editor the table only reads and says Salve o texto para editar as propriedades.", async () => {
    plan();
    renderWith(<NotesView onShowInGraph={() => undefined} />, { lang: "pt-BR" });
    const user = userEvent.setup();
    await user.click(await screen.findByRole("treeitem", { name: /^notes/ }));
    await user.click(await screen.findByRole("treeitem", { name: /Plano/ }));
    const props = await table();
    expect(props.querySelectorAll("input, select").length).toBeGreaterThan(0);
    await user.click(screen.getByRole("button", { name: "Editar" }));
    const text = await screen.findByRole("textbox", { name: "Texto da nota" });
    await user.type(text, "mais");
    await waitFor(() => expect(props.textContent).toContain("Salve o texto para editar as propriedades."));
    expect(props.querySelector("input, select, textarea")).toBeNull();
    expect(within(props).queryAllByRole("button")).toEqual([]);
    const lock = within(props).getByText("Salve o texto para editar as propriedades.");
    expect(lock.tagName).toBe("P");
  });
});

describe("C62 + Adicionar propriedade", () => {
  it("C62 asks the key and the kind, the kind preselected for a known key, and sends nothing until a value is given", async () => {
    const f = plan({ version: "sha256:v1" });
    answerWrites(f);
    read(f);
    await table();
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "+ Adicionar propriedade" }));
    const form = screen.getByRole("group", { name: "+ Adicionar propriedade" });
    const key = within(form).getByRole("textbox", { name: "Chave" });
    const kind = within(form).getByRole("combobox", { name: "Tipo" }) as HTMLSelectElement;
    const preselected: Array<[string, string]> = [
      ["status", "status"],
      ["due", "date"],
      ["tags", "list"],
      ["review_every", "interval"],
    ];
    for (const [k, expected] of preselected) {
      await user.clear(key);
      await user.type(key, k);
      expect(kind.value, k).toBe(expected);
    }
    // a value is asked before anything is sent
    await user.clear(key);
    await user.type(key, "due");
    const add = within(form).getByRole("button", { name: "Adicionar" });
    expect((add as HTMLButtonElement).disabled).toBe(true);
    await user.click(add);
    await tick(20);
    expect(writes()).toEqual([]);
    const value = form.querySelector<HTMLInputElement>('input[type="date"]')!;
    expect(value).not.toBeNull();
    fireEvent.change(value, { target: { value: "2026-11-01" } });
    expect((add as HTMLButtonElement).disabled).toBe(false);
    await user.click(add);
    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(writes()[0]).toEqual({ path: pathOf(f), baseVersion: "sha256:v1", set: { due: "2026-11-01" } });
  });
});

describe("C63 Remover", () => {
  it("C63 Remover in a row's DropdownMenu sends remove: [key] with no confirmation", async () => {
    const f = plan({ version: "sha256:v1" });
    answerWrites(f);
    read(f);
    await table();
    const user = userEvent.setup();
    await user.click(within(row("type")).getByRole("button", { name: "Opções de type" }));
    await tick();
    await user.click(await screen.findByRole("menuitem", { name: "Remover" }));
    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(writes()[0]).toEqual({ path: pathOf(f), baseVersion: "sha256:v1", remove: ["type"] });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });
});
