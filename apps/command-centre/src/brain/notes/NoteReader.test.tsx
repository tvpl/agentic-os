// @vitest-environment jsdom
/**
 * A note, read, in the notes view (.specs/features/cerebro-vista-notas, C50, C51, C53-C55; design.md "Área de
 * leitura", items 2 and 4, and "Estados"): the body from `bodyStart` by the one renderer, its links, "Ver no grafo",
 * the "Mais" menu, and the callouts of a note's nature. The network is `./testnet`.
 */
import fs from "node:fs";
import path from "node:path";
import { Suspense, type ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, useLocation } from "react-router-dom";
import type * as ApiModule from "../../api";
import { I18nContext } from "../../i18n";
import { ToastProvider } from "../../components/ui";
import { ConfirmProvider } from "../../hooks/useConfirm";
import { CommandRegistry, CommandsProvider } from "../../commands/registry";
import { installPage, tick } from "../../ui/testkit";
import { renderWith } from "../../contexts/testkit";
import SecondBrain from "../../views/SecondBrain";
import { NoteReader } from "./NoteReader";
import { MEM, NetError, fileRow, net, note, pathOf, resetNet, type FileDef } from "./testnet";

vi.mock("../../api", async (importOriginal) =>
  (await import("./testnet")).mockApi(await importOriginal<typeof ApiModule>()),
);
// The graph paints on a canvas jsdom does not have.
vi.mock("../BrainCanvas", () => ({ BrainCanvas: () => null }));

installPage();
beforeEach(() => resetNet());

function read(f: FileDef, over: Partial<Parameters<typeof NoteReader>[0]> = {}) {
  const onOpen = vi.fn();
  const onShowInGraph = vi.fn();
  const r = renderWith(
    <NoteReader
      path={pathOf(f)}
      id={f.id}
      meta={{ id: f.id, title: f.title }}
      onOpen={onOpen}
      onShowInGraph={onShowInGraph}
      onSetHome={() => undefined}
      {...over}
    />,
    { lang: "pt-BR" },
  );
  return { ...r, onOpen, onShowInGraph };
}

const NOTES_DIR = path.resolve(__dirname);

describe("C50 the body, by the one renderer", () => {
  it("C50 the body is drawn by Markdown in shape panel from bodyStart on (no front-matter line), a pipe table is a <table>, and no file of the view holds dangerouslySetInnerHTML", async () => {
    const head = "---\ntitle: Plano\nstatus: active\n---\n";
    const f = note(1, MEM, "notes/plano.md", {
      title: "Plano",
      content: `${head}# Plano\n\nO texto.\n\n| a | b |\n|---|---|\n| 1 | 2 |\n`,
      bodyStart: head.length,
    });
    read(f);
    const body = (await screen.findByText("O texto.")).closest(".brain-md")!;
    expect(body).not.toBeNull();
    expect(body.textContent).not.toContain("title:");
    expect(body.textContent).not.toContain("status: active");
    const table = within(body as HTMLElement).getByRole("table");
    expect(table.tagName).toBe("TABLE");
    expect(
      within(table)
        .getAllByRole("cell")
        .map((c) => c.textContent),
    ).toEqual(["1", "2"]);
    const files = fs.readdirSync(NOTES_DIR).filter((n) => /\.tsx?$/.test(n) && !/\.test\./.test(n));
    expect(files.length).toBeGreaterThan(5);
    for (const name of files)
      expect(fs.readFileSync(path.join(NOTES_DIR, name), "utf8"), name).not.toContain(
        "dangerouslySetInnerHTML",
      );
  });

  it("C50 while the note loads a spinner with Carregando…; a failed read shows its message and Tentar de novo in a role=alert, which asks again", async () => {
    const f = note(1, MEM, "notes/plano.md", { title: "Plano", content: "# Plano\n\nDe volta.\n" });
    let mode: "wait" | "fail" | "ok" = "wait";
    net.overrides.push((u) => {
      if (u.pathname !== "/api/memory/note") return undefined;
      if (mode === "wait") return new Promise(() => undefined);
      if (mode === "fail") return Promise.reject(new NetError(500, "boom", "O serviço não respondeu."));
      return undefined;
    });
    const { unmount } = read(f);
    const loading = await waitFor(() => {
      const el = document.querySelector<HTMLElement>('.notes-reader-state[role="status"]');
      expect(el).not.toBeNull();
      return el!;
    });
    expect(loading.textContent).toContain("Carregando…");
    expect(loading.querySelector(".spinner")).not.toBeNull();
    unmount();
    mode = "fail";
    read(f);
    const alert = (await screen.findByText("O serviço não respondeu.")).closest(
      '[role="alert"]',
    ) as HTMLElement;
    expect(alert).not.toBeNull();
    mode = "ok";
    await userEvent.setup().click(within(alert).getByRole("button", { name: "Tentar de novo" }));
    expect(await screen.findByText("De volta.")).toBeTruthy();
  });
});

describe("C51 the links of the body", () => {
  it("C51 [[Planejamento]], [[planejamento|o plano]] and [o plano](./planejamento.md) open the note outgoing[].resolved names; a link resolved to null is text with Unlink and the Tooltip Nenhuma nota com este nome", async () => {
    const plan = note(2, MEM, "notes/planejamento.md", { title: "Planejamento" });
    const f = note(1, MEM, "notes/agenda.md", {
      title: "Agenda",
      content:
        "# Agenda\n\nVer [[Planejamento]].\n\nOu [[planejamento|o plano]].\n\nE [o plano](./planejamento.md).\n\nSem [[Sumida]].\n",
    });
    const row = fileRow(plan);
    net.links[1] = {
      backlinks: [],
      outgoing: [
        { kind: "wikilink", target: "planejamento", label: null, line: 3, resolved: row, alternatives: [] },
        {
          kind: "wikilink",
          target: "planejamento",
          label: "o plano",
          line: 5,
          resolved: row,
          alternatives: [],
        },
        {
          kind: "markdown-link",
          target: `${MEM}/notes/planejamento.md`,
          label: "o plano",
          line: 7,
          resolved: row,
          alternatives: [],
        },
        { kind: "wikilink", target: "sumida", label: null, line: 9, resolved: null, alternatives: [] },
      ],
    };
    const { onOpen } = read(f);
    const user = userEvent.setup();
    const wiki = await screen.findByRole("button", { name: "Planejamento" });
    const aliased = screen.getAllByRole("button", { name: "o plano" });
    expect(aliased).toHaveLength(2);
    for (const b of [wiki, ...aliased]) {
      onOpen.mockClear();
      await user.click(b);
      expect(onOpen).toHaveBeenCalledWith(pathOf(plan), { id: 2, title: "Planejamento" });
    }
    const broken = screen.getByRole("img", { name: /Sumida/ });
    expect(broken.textContent).toBe("Sumida");
    expect(broken.querySelector("svg.lucide-unlink")).not.toBeNull();
    expect(broken.getAttribute("aria-label")).toBe("Sumida — Nenhuma nota com este nome");
    expect(screen.queryByRole("button", { name: "Sumida" })).toBeNull();
    await user.hover(broken);
    await waitFor(
      () =>
        expect(screen.getAllByRole("tooltip").map((x) => x.textContent)).toContain(
          "Nenhuma nota com este nome",
        ),
      { timeout: 2000 },
    );
  });
});

/** The frame's brain at a path, with a probe of where the router is. */
function Where() {
  const l = useLocation();
  return <output data-testid="where">{`${l.pathname}${l.search}`}</output>;
}
function mountBrain(at: string, children?: ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const container = document.createElement("div");
  document.getElementById("root")!.appendChild(container);
  return render(
    <I18nContext.Provider value={{ lang: "pt-BR", setLang: () => undefined }}>
      <MemoryRouter initialEntries={[at]}>
        <QueryClientProvider client={qc}>
          <CommandsProvider registry={new CommandRegistry()}>
            <ToastProvider>
              <ConfirmProvider>
                <Suspense fallback={null}>
                  <SecondBrain />
                </Suspense>
                <Where />
                {children}
              </ConfirmProvider>
            </ToastProvider>
          </CommandsProvider>
        </QueryClientProvider>
      </MemoryRouter>
    </I18nContext.Provider>,
    { container },
  );
}

describe("C53 Ver no grafo", () => {
  it("C53 switches to the graph with that note selected, local on and 1 hop", async () => {
    note(7, MEM, "plano.md", { title: "Plano" });
    mountBrain("/brain/notes");
    const user = userEvent.setup();
    await user.click(await screen.findByRole("treeitem", { name: /Plano/ }, { timeout: 5000 }));
    await user.click(await screen.findByRole("button", { name: "Ver no grafo" }));
    await waitFor(() => expect(document.querySelector(".brain2")).not.toBeNull(), { timeout: 5000 });
    const where = new URL(`http://x${screen.getByTestId("where").textContent!}`);
    expect(where.pathname).toBe("/brain");
    expect(where.searchParams.get("sel")).toBe("7");
    expect(where.searchParams.get("local")).toBe("1");
    // 1 hop is the graph's default, so the graph does not repeat it in its address: its control says it.
    expect(where.searchParams.get("hops") ?? "1").toBe("1");
    expect(screen.getByRole("button", { name: "Local" }).getAttribute("aria-pressed")).toBe("true");
    expect((document.querySelector("input.brain-hops") as HTMLInputElement).value).toBe("1");
    expect(screen.getByRole("button", { name: "Grafo" }).getAttribute("aria-pressed")).toBe("true");
  });
});

describe("C54 the Mais menu", () => {
  it("C54 Exportar Markdown downloads <nome>.md with the note's bytes; Abrir no editor do sistema calls POST /api/memory/open with p; Copiar caminho puts the path on the clipboard", async () => {
    const content = '---\ntitle: "Plano — ação"\n---\n# Plano\n\nAcentuação, emoji 🧠 e\r\nCRLF.\n';
    const f = note(1, MEM, "notes/plano.md", { title: "Plano", content });
    const blobs: Blob[] = [];
    URL.createObjectURL = vi.fn((b: Blob) => {
      blobs.push(b);
      return "blob:nota";
    }) as typeof URL.createObjectURL;
    URL.revokeObjectURL = vi.fn();
    const downloads: string[] = [];
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
      downloads.push(`${this.download}|${this.getAttribute("href")}`);
    });
    read(f);
    const user = userEvent.setup();
    // (user-event puts a clipboard of its own on the page when it is set up: this one goes after it)
    const writeText = vi.fn(() => Promise.resolve());
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    const more = async (name: string) => {
      await user.click(await screen.findByRole("button", { name: "Mais" }));
      await tick();
      await user.click(screen.getByRole("menuitem", { name }));
    };
    await more("Exportar Markdown");
    expect(downloads).toEqual(["plano.md|blob:nota"]);
    const bytes = new Uint8Array(
      await new Promise<ArrayBuffer>((resolve) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as ArrayBuffer);
        reader.readAsArrayBuffer(blobs[0]!);
      }),
    );
    expect([...bytes]).toEqual([...new TextEncoder().encode(content)]);
    await more("Abrir no editor do sistema");
    expect(net.calls).toContainEqual({ method: "POST", url: "/api/memory/open", body: { p: pathOf(f) } });
    await more("Copiar caminho");
    expect(writeText).toHaveBeenCalledWith(pathOf(f));
  });
});

describe("C55 the callouts of a note's nature", () => {
  it("C55 > [!fato], [!opiniao], [!plano], [!hipotese] and [!relato] are a box with the icon and the label as 12px text above the content; > [!x] is a plain quote", async () => {
    const f = note(1, MEM, "notes/natureza.md", {
      title: "Natureza",
      content: [
        "# Natureza",
        "> [!fato] A sede fica em Recife.",
        "> [!opiniao] O plano é bom.",
        "> [!plano] Abrir em março.",
        "> [!hipotese] O preço cai.",
        "> [!relato] Ana contou ontem.",
        "> [!x] Uma citação.",
      ].join("\n\n"),
    });
    read(f);
    await screen.findByText("Uma citação.", { exact: false });
    const boxes = [...document.querySelectorAll<HTMLElement>(".brain-md .md-callout")];
    const expected: Array<[string, string, string, string]> = [
      ["fato", "lucide-circle-check", "Fato", "A sede fica em Recife."],
      ["opiniao", "lucide-message-circle", "Opinião", "O plano é bom."],
      ["plano", "lucide-map", "Plano", "Abrir em março."],
      ["hipotese", "lucide-flask-conical", "Hipótese", "O preço cai."],
      ["relato", "lucide-book-open", "Relato", "Ana contou ontem."],
    ];
    expect(boxes.map((b) => b.dataset.kind)).toEqual(expected.map((e) => e[0]));
    boxes.forEach((box, i) => {
      const [, icon, label, text] = expected[i]!;
      const head = box.firstElementChild as HTMLElement;
      expect(head.className).toBe("md-callout-label");
      expect(head.querySelector(`svg.${icon}`)).not.toBeNull();
      expect(head.textContent).toBe(label);
      expect(box.lastElementChild!.textContent).toBe(text);
    });
    const quote = screen.getByText("[!x] Uma citação.", { exact: false });
    expect(quote.closest("blockquote")).not.toBeNull();
    expect(quote.closest(".md-callout")).toBeNull();
    // The label is 12px text (design.md): its rule in the view's stylesheet.
    const css = fs.readFileSync(path.join(NOTES_DIR, "notes.css"), "utf8");
    const rule = /\.md-callout-label\s*\{([^}]*)\}/.exec(css)![1]!;
    expect(rule).toMatch(/font-size:\s*var\(--fs-2\)/);
  });
});

describe("C86 the note's header", () => {
  it("C86 the title then, under it, the path in mono 12px; the actions on the right as .btn.sm; Mais holds Definir como Home, Exportar Markdown, Abrir no editor do sistema and Copiar caminho in that order", async () => {
    const f = note(1, MEM, "notes/plano.md", { title: "Plano", content: "# Plano\n" });
    read(f, { onEdit: () => undefined });
    const article = await screen.findByRole("article", { name: "Plano" });
    const head = article.querySelector("header")!;
    // the titles block first, the actions after it (drawn on its right: notes.css, a row with space between)
    const [titles, actions] = [...head.children] as HTMLElement[];
    expect(titles!.className).toBe("notes-note-titles");
    expect(actions!.className).toBe("notes-note-actions");
    expect(head.children).toHaveLength(2);
    const [title, where] = [...titles!.children] as HTMLElement[];
    expect(title!.tagName).toBe("H1");
    expect(title!.textContent).toBe("Plano");
    expect(where!.className).toBe("notes-note-path");
    expect(where!.textContent).toBe(pathOf(f));
    const css = fs.readFileSync(path.join(NOTES_DIR, "notes.css"), "utf8");
    const rule = (sel: string) => new RegExp(`\\${sel}\\s*\\{([^}]*)\\}`).exec(css)![1]!;
    expect(rule(".notes-note-path")).toMatch(/font-family:\s*var\(--font-mono\)/);
    expect(rule(".notes-note-path")).toMatch(/font-size:\s*var\(--fs-2\)/);
    expect(rule(".notes-note-head")).toMatch(/justify-content:\s*space-between/);
    const buttons = within(actions!).getAllByRole("button");
    expect(buttons.map((b) => b.getAttribute("aria-label") ?? b.textContent)).toEqual([
      "Editar",
      "Ver no grafo",
      "Mais",
    ]);
    for (const b of buttons) expect([...b.classList].sort(), b.textContent!).toEqual(["btn", "sm"]);
    const user = userEvent.setup();
    await user.click(within(actions!).getByRole("button", { name: "Mais" }));
    await tick();
    const menu = await screen.findByRole("menu");
    expect(
      within(menu)
        .getAllByRole("menuitem")
        .map((m) => m.textContent),
    ).toEqual(["Definir como Home", "Exportar Markdown", "Abrir no editor do sistema", "Copiar caminho"]);
  });
});
