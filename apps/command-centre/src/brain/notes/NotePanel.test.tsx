// @vitest-environment jsdom
/**
 * The note panel (.specs/features/cerebro-vista-notas, C52; design.md "Painel da nota"): the links section of
 * `cerebro-v2` (Backlinks, Links quebrados), "Relacionadas" with each `why`, and "Nesta nota" with the `##` headings,
 * in that order, each loading and failing on its own. The network is `./testnet`.
 */
import fs from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type * as ApiModule from "../../api";
import { installPage } from "../../ui/testkit";
import { renderWith } from "../../contexts/testkit";
import { NotePanel } from "./NotePanel";
import { NoteReader } from "./NoteReader";
import { MEM, NetError, fileRow, net, note, pathOf, resetNet } from "./testnet";

vi.mock("../../api", async (importOriginal) =>
  (await import("./testnet")).mockApi(await importOriginal<typeof ApiModule>()),
);

installPage();
beforeEach(() => resetNet());

const sections = () =>
  [...document.querySelectorAll<HTMLElement>(".notes-panel-body > .notes-fold")].map(
    (s) => s.querySelector(".notes-fold-head")!.textContent,
  );

describe("C52 the note panel", () => {
  it("C52 Backlinks and Links quebrados, Relacionadas with each why at 12px, and Nesta nota with the ## headings, in this order; a backlink and a related note open, a heading scrolls to itself", async () => {
    const vizinha = note(2, MEM, "notes/vizinha.md", { title: "Vizinha" });
    const prima = note(3, MEM, "notes/prima.md", { title: "Prima" });
    const f = note(1, MEM, "notes/plano.md", {
      title: "Plano",
      content: "# Plano\n\n## Contexto\n\ntexto\n\n### Detalhe\n\n## Próximos passos\n\nmais\n",
    });
    net.links[1] = {
      backlinks: [{ file: fileRow(vizinha), kind: "wikilink", line: 4, label: null }],
      outgoing: [
        { kind: "wikilink", target: "sumida", label: null, line: 9, resolved: null, alternatives: [] },
      ],
    };
    net.related[1] = [{ id: 3, why: "Compartilham: oferta, acelerador." }];
    const onOpen = vi.fn();
    const scrolled: string[] = [];
    Element.prototype.scrollIntoView = function (this: Element) {
      scrolled.push(this.id);
    };
    renderWith(
      <>
        <NoteReader
          path={pathOf(f)}
          id={1}
          meta={{ id: 1, title: "Plano" }}
          onOpen={onOpen}
          onShowInGraph={() => undefined}
          onSetHome={() => undefined}
        />
        <NotePanel path={pathOf(f)} id={1} onOpen={onOpen} />
      </>,
      { lang: "pt-BR" },
    );
    const panel = document.querySelector<HTMLElement>(".notes-panel-body")!;
    await within(panel).findByText("Backlinks (1)");
    expect(sections()).toEqual(["Links", "Relacionadas", "Nesta nota"]);
    expect(within(panel).getByText("Links quebrados (1)")).toBeTruthy();
    const why = await within(panel).findByText("Compartilham: oferta, acelerador.");
    expect(why.className).toBe("notes-why");
    const css = fs.readFileSync(path.join(path.resolve(__dirname), "notes.css"), "utf8");
    expect(/\.notes-why\s*\{([^}]*)\}/.exec(css)![1]).toMatch(/font-size:\s*var\(--fs-2\)/);
    const outline = within(panel)
      .getAllByRole("listitem")
      .filter((li) => li.closest(".notes-outline"));
    expect(outline.map((li) => li.textContent)).toEqual(["Contexto", "Próximos passos"]);

    const user = userEvent.setup();
    await user.click(within(panel).getByRole("button", { name: "Vizinha" }));
    expect(onOpen).toHaveBeenLastCalledWith(pathOf(vizinha), { id: 2, title: "Vizinha" });
    await user.click(within(panel).getByRole("button", { name: "Prima" }));
    expect(onOpen).toHaveBeenLastCalledWith(pathOf(prima), { id: 3, title: "Prima" });
    await user.click(within(panel).getByRole("button", { name: "Próximos passos" }));
    const heading = screen.getAllByText("Próximos passos").find((el) => /^H\d$/.test(el.tagName))!;
    expect(heading.id).toBeTruthy();
    expect(scrolled).toEqual([heading.id]);
  });

  it("C52 each section has its own spinner and its own error with Tentar de novo, which asks again", async () => {
    const f = note(1, MEM, "notes/plano.md", { title: "Plano", content: "# Plano\n\n## Um\n" });
    const state = { links: "wait", related: "wait", note: "wait" } as Record<string, "wait" | "fail" | "ok">;
    net.overrides.push((u) => {
      const key = u.pathname.split("/").pop()!;
      const mode = state[key];
      if (!mode || mode === "ok") return undefined;
      if (mode === "wait") return new Promise(() => undefined);
      return Promise.reject(new NetError(500, "boom", `falhou: ${key}`));
    });
    const { unmount } = renderWith(<NotePanel path={pathOf(f)} id={1} onOpen={() => undefined} />, {
      lang: "pt-BR",
    });
    const folds = () => [...document.querySelectorAll<HTMLElement>(".notes-fold")];
    await waitFor(() => expect(folds()).toHaveLength(3));
    for (const fold of folds()) {
      expect(fold.querySelector(".spinner"), fold.textContent!).not.toBeNull();
      expect(fold.textContent).toContain("Carregando…");
    }
    unmount();

    state.links = "fail";
    state.related = "fail";
    state.note = "fail";
    renderWith(<NotePanel path={pathOf(f)} id={1} onOpen={() => undefined} />, { lang: "pt-BR" });
    await waitFor(() => expect(document.querySelectorAll('.notes-fold [role="alert"]')).toHaveLength(3));
    const [links, related, outline] = folds();
    expect(links!.textContent).toContain("falhou: links");
    expect(related!.textContent).toContain("Não foi possível carregar os relacionados.");
    expect(outline!.textContent).toContain("falhou: note");
    const user = userEvent.setup();
    // each asks again on its own
    state.related = "ok";
    await user.click(within(related!).getByRole("button", { name: "Tentar de novo" }));
    expect(await within(related!).findByText("Nada relacionado ainda.")).toBeTruthy();
    expect(within(links!).getByRole("button", { name: "Tentar de novo" })).toBeTruthy();
    state.links = "ok";
    await user.click(within(links!).getByRole("button", { name: "Tentar de novo" }));
    expect(await within(links!).findByText("Backlinks (0)")).toBeTruthy();
    state.note = "ok";
    await user.click(within(outline!).getByRole("button", { name: "Tentar de novo" }));
    expect(await within(outline!).findByRole("button", { name: "Um" })).toBeTruthy();
  });
});
