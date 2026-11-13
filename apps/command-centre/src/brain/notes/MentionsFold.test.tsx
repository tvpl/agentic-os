// @vitest-environment jsdom
/**
 * "Menções sem link (N)" of the note panel (.specs/features/cerebro-rituais, C93, C94; design.md "Painel da nota -
 * dobra Menções sem link"; plan.md AC 69, AC 70): its place among the folds, open or closed by N, each item's parts in
 * order, the terms and the cut below, the exact query, a source opened at its line in the notes view, the states and
 * "Linkar". The network is `./testnet`, which answers `GET /api/memory/mentions` only for the query a case gives it.
 */
import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type * as ApiModule from "../../api";
import { installPage } from "../../ui/testkit";
import { renderWith } from "../../contexts/testkit";
import { NotePanel } from "./NotePanel";
import NotesView from "./NotesView";
import { MEM, NetError, WORK, asked, fileRow, net, note, pathOf, resetNet, type FileDef } from "./testnet";

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

const DIARIO_TEXT = "# diario\n\nUma linha.\n\nHoje o curso de marco atrasou de novo.\n";
let target: FileDef;
let diario: FileDef;
let ata: FileDef;
beforeEach(() => {
  resetNet();
  target = note(1, MEM, "notes/curso-de-marco.md", { title: "Curso de Março" });
  diario = note(2, MEM, "notes/diario.md", { content: DIARIO_TEXT });
  ata = note(3, WORK, "ata.md", { title: "Ata" });
});

const mention = (file: FileDef, over: Record<string, unknown> = {}) => ({
  file: fileRow(file),
  line: 5,
  excerpt: "Hoje o curso de marco atrasou de novo.",
  term: "Curso de Março",
  editable: true,
  version: "sha256:d1",
  ...over,
});
const TWO = () => ({
  file: fileRow(target),
  terms: ["Curso de Março", "CM 2026"],
  items: [
    mention(diario),
    mention(ata, {
      line: 7,
      excerpt: "Pauta: o CM 2026 e o orçamento.",
      term: "CM 2026",
      editable: false,
      version: null,
    }),
  ],
  total: 2,
});
/** The answer to `id=1&context=alfa`, the only query the kit answers. */
const answer = (body: unknown, key = "1|alfa") => {
  net.mentions[key] = body;
};

function panel() {
  return renderWith(<NotePanel path={pathOf(target)} id={1} context="alfa" onOpen={() => undefined} />, {
    lang: "pt-BR",
  });
}
const heads = () => [
  ...document.querySelectorAll<HTMLElement>(".notes-panel-body > .notes-fold .notes-fold-head button"),
];
const foldOf = () => heads()[1]!.closest<HTMLElement>(".notes-fold")!;
const items = () => [...foldOf().querySelectorAll<HTMLElement>(".mf-item")];
const before = (a: Node, b: Node) => (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
const css = fs.readFileSync(path.join(__dirname, "mentions.css"), "utf8");
const rule = (selector: string) => {
  const at = css.indexOf(`\n${selector} {`);
  return at < 0 ? "" : css.slice(at, css.indexOf("}", at));
};

describe("C93 the fold Menções sem link", () => {
  it("C93 the note panel's folds in order: Links, Menções sem link (2), Relacionadas, Nesta nota, Histórico; open with N > 0", async () => {
    answer(TWO());
    panel();
    await waitFor(() => expect(items()).toHaveLength(2));
    expect(heads().map((h) => h.textContent)).toEqual([
      "Links",
      "Menções sem link (2)",
      "Relacionadas",
      "Nesta nota",
      "Histórico",
    ]);
    expect(heads()[1]!.getAttribute("aria-expanded")).toBe("true");
  });

  it("C93 the fold is closed (aria-expanded false) with N = 0", async () => {
    answer({ file: fileRow(target), terms: ["Curso de Março"], items: [], total: 0 });
    panel();
    await waitFor(() => expect(heads()[1]!.textContent).toBe("Menções sem link (0)"));
    expect(heads()[1]!.getAttribute("aria-expanded")).toBe("false");
    // the other folds stay open
    expect(
      heads()
        .filter((_, i) => i !== 1)
        .map((h) => h.getAttribute("aria-expanded")),
    ).toEqual(["true", "true", "true", "true"]);
  });

  it("C93 each item in order: the source's name (13px, weight-600 class), the excerpt with the term in <mark> as written, Linkar (.btn.sm, Link2) only when editable", async () => {
    answer(TWO());
    panel();
    await waitFor(() => expect(items()).toHaveLength(2));
    const [first, second] = items();
    const name = first!.querySelector(".mf-name")!;
    expect(name.textContent).toBe("diario");
    expect(rule(".mf-name")).toMatch(/font-size:\s*var\(--fs-3\)/);
    expect(rule(".mf-name")).toMatch(/font-weight:\s*600/);
    const excerpt = first!.querySelector(".mf-excerpt")!;
    expect(excerpt.textContent).toBe("Hoje o curso de marco atrasou de novo.");
    expect([...excerpt.querySelectorAll("mark")].map((m) => m.textContent)).toEqual(["curso de marco"]);
    const link = within(first!).getByRole("button", { name: "Linkar" });
    expect(link.className).toBe("btn sm");
    expect(link.querySelector("svg.lucide-link2")).not.toBeNull();
    expect(before(name, excerpt) && before(excerpt, link)).toBe(true);
    // the source outside memory/: its name and excerpt, the term marked, no Linkar
    expect(second!.querySelector(".mf-name")!.textContent).toBe("Ata");
    expect([...second!.querySelectorAll("mark")].map((m) => m.textContent)).toEqual(["CM 2026"]);
    expect(within(second!).queryByRole("button", { name: "Linkar" })).toBeNull();
  });

  it("C93 below the list Procurando: Curso de Março, CM 2026; Mostrando 20 de 25 with total 25, absent with 2 of 2", async () => {
    answer(TWO());
    const { unmount } = panel();
    await waitFor(() => expect(items()).toHaveLength(2));
    const terms = within(foldOf()).getByText("Procurando: Curso de Março, CM 2026");
    expect(before(foldOf().querySelector(".mf-list")!, terms)).toBe(true);
    expect(foldOf().textContent).not.toContain("Mostrando");
    unmount();

    const twenty = Array.from({ length: 20 }, (_, i) => mention(diario, { line: i + 1 }));
    answer({ file: fileRow(target), terms: ["Curso de Março", "CM 2026"], items: twenty, total: 25 });
    panel();
    await waitFor(() => expect(items()).toHaveLength(20));
    expect(heads()[1]!.textContent).toBe("Menções sem link (25)");
    const cut = within(foldOf()).getByText("Mostrando 20 de 25");
    expect(before(foldOf().querySelector(".mf-list")!, cut)).toBe(true);
  });

  it("C93 the request is GET /api/memory/mentions?id=1&context=alfa and the kit answers only that query", async () => {
    answer(TWO());
    const { unmount } = panel();
    await waitFor(() => expect(items()).toHaveLength(2));
    expect(asked("/api/memory/mentions").map((q) => q.toString())).toEqual(["id=1&context=alfa"]);
    unmount();
    // the kit refuses any other query: another context gets an error, not the list
    renderWith(<NotePanel path={pathOf(target)} id={1} context="gama" onOpen={() => undefined} />, {
      lang: "pt-BR",
    });
    const alert = await waitFor(() => within(foldOf()).getByRole("alert"));
    expect(alert.textContent).toContain("not asked: id=1&context=gama");
    expect(items()).toEqual([]);
  });

  it("C93 activating the item opens the source in the notes view at its line, the request carrying the active context", async () => {
    net.contexts = [{ id: "alfa", name: "Alfa", paths: [{ path: MEM, state: "ok" }], files: 3 }];
    net.contextRoots.alfa = [{ path: MEM, name: "memory", editable: true, indexing: false }];
    net.prefs.activeContext = "alfa";
    answer(TWO());
    const scrolled: string[] = [];
    Element.prototype.scrollIntoView = function (this: Element) {
      scrolled.push(this.textContent ?? "");
    };
    const user = userEvent.setup();
    renderWith(<NotesView onShowInGraph={() => undefined} />, { lang: "pt-BR" });
    await user.click(await screen.findByRole("treeitem", { name: /^notes/ }));
    await user.click(await screen.findByRole("treeitem", { name: /^Curso de Março/ }));
    await waitFor(() => expect(items()).toHaveLength(2));
    expect(asked("/api/memory/mentions").map((q) => q.toString())).toEqual(["id=1&context=alfa"]);
    await user.click(within(items()[0]!).getByRole("button", { name: "diario" }));
    await screen.findByText("Hoje o curso de marco atrasou de novo.", { selector: ".notes-main p" });
    await waitFor(() => expect(scrolled).toContain("Hoje o curso de marco atrasou de novo."));
    expect(asked("/api/memory/note").some((q) => q.get("p") === pathOf(diario))).toBe(true);
  });
});

describe("C94 the fold's states and Linkar", () => {
  const body = () => foldOf().querySelector<HTMLElement>("[id]")!;

  it("C94 none: Nenhuma menção sem link.", async () => {
    answer({ file: fileRow(target), terms: ["Curso de Março"], items: [], total: 0 });
    panel();
    await waitFor(() => expect(body().textContent).toContain("Nenhuma menção sem link."));
  });

  it("C94 terms []: only O nome desta nota é curto demais para procurar menções.", async () => {
    answer({ file: fileRow(target), terms: [], items: [], total: 0 });
    panel();
    await waitFor(() =>
      expect(body().textContent).toBe("O nome desta nota é curto demais para procurar menções."),
    );
  });

  it("C94 loading: Carregando…", async () => {
    // no answer in the kit: the request waits
    panel();
    await waitFor(() => expect(heads()).toHaveLength(5));
    expect(body().textContent!.trim()).toBe("Carregando…");
    expect(body().querySelector(".spinner")).not.toBeNull();
  });

  it("C94 failure: the error and Tentar de novo, which asks again", async () => {
    let fail = true;
    net.overrides.push((u) =>
      u.pathname === "/api/memory/mentions" && fail
        ? Promise.reject(new NetError(500, "boom", "Falhou a busca de menções"))
        : undefined,
    );
    answer(TWO());
    panel();
    const alert = await waitFor(() => within(body()).getByRole("alert"));
    expect(alert.textContent).toContain("Falhou a busca de menções");
    expect(asked("/api/memory/mentions")).toHaveLength(1);
    fail = false;
    await userEvent.setup().click(within(alert).getByRole("button", { name: "Tentar de novo" }));
    await waitFor(() => expect(items()).toHaveLength(2));
    expect(asked("/api/memory/mentions").map((q) => q.toString())).toEqual([
      "id=1&context=alfa",
      "id=1&context=alfa",
    ]);
  });

  it("C94 Linkar sends POST /api/memory/mentions/link {source, line, term, target, baseVersion}, then the item leaves and the notice reads Linkado em diario.", async () => {
    answer(TWO());
    const bodies: unknown[] = [];
    net.writes.set("POST /api/memory/mentions/link", (b) => {
      bodies.push(b);
      return Promise.resolve({
        path: pathOf(diario),
        version: "sha256:d2",
        link: "[[Curso de Março|curso de marco]]",
      });
    });
    panel();
    await waitFor(() => expect(items()).toHaveLength(2));
    await userEvent.setup().click(within(items()[0]!).getByRole("button", { name: "Linkar" }));
    await waitFor(() => expect(items()).toHaveLength(1));
    expect(bodies).toEqual([
      { source: pathOf(diario), line: 5, term: "Curso de Março", target: 1, baseVersion: "sha256:d1" },
    ]);
    expect(items()[0]!.querySelector(".mf-name")!.textContent).toBe("Ata");
    expect(within(foldOf()).getByRole("status").textContent).toBe("Linkado em diario.");
    expect(heads()[1]!.textContent).toBe("Menções sem link (1)");
  });

  for (const code of ["mention_gone", "edit_conflict"])
    it(`C94 a 409 ${code} keeps the item with A nota mudou; a menção não está mais nessa linha. and Recarregar, which asks again`, async () => {
      answer(TWO());
      net.writes.set("POST /api/memory/mentions/link", () => Promise.reject(new NetError(409, code, code)));
      panel();
      await waitFor(() => expect(items()).toHaveLength(2));
      const user = userEvent.setup();
      await user.click(within(items()[0]!).getByRole("button", { name: "Linkar" }));
      await waitFor(() =>
        expect(items()[0]!.textContent).toContain("A nota mudou; a menção não está mais nessa linha."),
      );
      expect(items()).toHaveLength(2);
      expect(items()[0]!.querySelector(".mf-name")!.textContent).toBe("diario");
      expect(asked("/api/memory/mentions")).toHaveLength(1);
      await user.click(within(items()[0]!).getByRole("button", { name: "Recarregar" }));
      await waitFor(() => expect(asked("/api/memory/mentions")).toHaveLength(2));
      expect(asked("/api/memory/mentions").at(-1)!.toString()).toBe("id=1&context=alfa");
    });
});
