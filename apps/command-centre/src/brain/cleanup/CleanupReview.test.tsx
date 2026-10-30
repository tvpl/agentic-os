// @vitest-environment jsdom
/**
 * Steps 4 and 5 of the guided cleanup (.specs/features/cerebro-faxina-guiada, C68, C69; design.md "Etapa 4" and
 * "Etapa 5"): every change the apply would make, one line per file, and what it did, with "Desfazer" and what came back.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import type * as ApiModule from "../../api";
import { installPage } from "../../ui/testkit";
import { resetNet } from "../notes/testnet";
import type { ApplyResult, Finding } from "./cleanupData";
import { DAY, MEM, WORK, atStep, cleanup, finding, footer, resetCleanup, sent, toFindings } from "./testkit";

vi.mock("../../api", async (importOriginal) =>
  (await import("../notes/testnet")).mockApi(await importOriginal<typeof ApiModule>()),
);
vi.mock("../../hooks/useEventStream", async () => ({
  useOsEvent: (await import("../notes/testnet")).useOsEventMock,
}));
vi.setConfig({ testTimeout: 30_000 });

installPage();
beforeEach(() => {
  resetNet();
  resetCleanup();
});

const card = (file: string) =>
  [...document.querySelectorAll<HTMLElement>(".cln-cards > li")].find(
    (c) => c.querySelector(".cln-file-name, :scope[data-answered] > .cln-mono")?.textContent === file,
  )!;
const answer = async (file: string, label: string) => {
  fireEvent.click(within(card(file)).getByRole("button", { name: label }));
  await waitFor(() => expect(card(file).hasAttribute("data-answered")).toBe(true));
};
const follows = (a: Element, b: Element) =>
  (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;

/** Four findings: one archived under memory/, one outside it, a duplicate merged, and one kept. */
function four(): Finding[] {
  const dup = finding("duplicate", [`${MEM}/notes/a.md`, `${MEM}/notes/a-nova.md`]);
  return [
    dup,
    finding("stale", [`${MEM}/notes/velho.md`], { detail: { ageDays: 400 } }),
    finding("stale", [`${WORK}/relatorio.pdf`], { detail: { ageDays: 500 } }),
    finding("orphan", [`${MEM}/notes/solta.md`]),
  ];
}
async function answerFour() {
  const r = await toFindings(four());
  fireEvent.click(within(card("a.md")).getByRole("button", { name: "Juntar" }));
  fireEvent.click(within(card("a.md")).getByRole("button", { name: "Confirmar" }));
  await waitFor(() => expect(document.querySelector(".cln-cards > li[data-answered]")).not.toBeNull());
  fireEvent.mouseDown(screen.getByRole("tab", { name: /^Parados/ }));
  fireEvent.click(screen.getByRole("tab", { name: /^Parados/ }));
  await answer("velho.md", "Arquivar");
  await answer("relatorio.pdf", "Arquivar");
  fireEvent.mouseDown(screen.getByRole("tab", { name: /^Órfãs/ }));
  fireEvent.click(screen.getByRole("tab", { name: /^Órfãs/ }));
  await answer("solta.md", "Manter");
  fireEvent.click(screen.getByRole("button", { name: "Conferir mudanças" }));
  await atStep("Etapa 4 de 5 · Conferir");
  return r;
}

describe("C68 step 4, Conferir", () => {
  it("C68 the totals on top, Vai para o arquivo (N) above Propostas para você fazer (N), one line per file: origin, arrow, destination or proposta, the decision", async () => {
    vi.useFakeTimers({ toFake: ["Date"], now: Date.UTC(2026, 9, 30, 12) });
    const today = new Date().toLocaleDateString("sv-SE");
    const { dialog } = await answerFour();
    const review = dialog.querySelector(".cln-review")!;
    const [totals, moves, proposals] = [...review.children];
    expect(totals!.textContent).toBe("3 mudanças: 2 ao arquivo, 1 a propor");
    expect(moves!.querySelector("h3")!.textContent).toBe("Vai para o arquivo (2)");
    expect(proposals!.querySelector("h3")!.textContent).toBe("Propostas para você fazer (1)");
    expect(follows(moves!, proposals!)).toBe(true);
    const lines = (section: Element) =>
      [...section.querySelectorAll("li")].map((li) =>
        [...li.children].map((c) =>
          c.classList.contains("cln-mono") ? `mono:${c.textContent}` : c.textContent,
        ),
      );
    expect(lines(moves!)).toEqual([
      [`mono:${MEM}/notes/a.md`, "→", `mono:memory/archive/${today}-…/notes/a.md`, "Juntar"],
      [`mono:${MEM}/notes/velho.md`, "→", `mono:memory/archive/${today}-…/notes/velho.md`, "Arquivar"],
    ]);
    expect(lines(proposals!)).toEqual([[`mono:${WORK}/relatorio.pdf`, "→", "proposta", "Arquivar"]]);
    expect(footer().at(-1)!.textContent).toBe("Aplicar");
    void DAY;
  });

  it("C68 with every answer Manter or Não sei: Nenhuma mudança a aplicar. As respostas ficaram guardadas. and the action Fechar", async () => {
    const [a, b] = [finding("orphan", [`${MEM}/notes/x.md`]), finding("orphan", [`${MEM}/notes/y.md`])];
    const { dialog } = await toFindings([a!, b!]);
    await answer("x.md", "Manter");
    await answer("y.md", "Não sei");
    fireEvent.click(screen.getByRole("button", { name: "Conferir mudanças" }));
    await atStep("Etapa 4 de 5 · Conferir");
    expect(
      within(dialog).getByText("Nenhuma mudança a aplicar. As respostas ficaram guardadas."),
    ).toBeTruthy();
    expect(footer().at(-1)!.textContent).toBe("Fechar");
    expect(footer().at(-1)!.className).toBe("btn primary");
    expect(dialog.querySelector(".cln-review")).toBeNull();
  });
});

describe("C69 step 5, Pronto", () => {
  const MANIFEST = `${MEM}/archive/2026-10-30-0a1b2c3d/manifest.json`;
  const RESULT = (proposals: string | null): ApplyResult => ({
    manifest: MANIFEST,
    moved: [
      { from: `${MEM}/notes/a.md`, to: `${MEM}/archive/2026-10-30-0a1b2c3d/notes/a.md` },
      { from: `${MEM}/notes/velho.md`, to: `${MEM}/archive/2026-10-30-0a1b2c3d/notes/velho.md` },
    ],
    skipped: [
      { path: `${MEM}/notes/m1.md`, reason: "changed" },
      { path: `${MEM}/notes/m2.md`, reason: "missing" },
      { path: `${MEM}/notes/m3.md`, reason: "exists" },
      { path: `${MEM}/notes/m4.md`, reason: "forbidden_path" },
    ],
    proposals,
  });

  it("C69 movidos, pulados, propostas in that order; each skip reason in words; the proposals link; Desfazer before Fechar; Desfazer undoes by the manifest and says what came back", async () => {
    cleanup.apply = () => Promise.resolve(RESULT(`${MEM}/../artifacts/cleanup/2026-10-30-0a1b2c3d.md`));
    cleanup.undo = () =>
      Promise.resolve({
        restored: RESULT(null).moved,
        skipped: [{ path: `${MEM}/notes/m1.md`, reason: "changed" }],
      });
    const { dialog } = await answerFour();
    fireEvent.click(screen.getByRole("button", { name: "Aplicar" }));
    await atStep("Etapa 5 de 5 · Pronto");
    expect(sent("POST", "/api/memory/cleanup/apply")).toEqual([{ scanId: "scan-1" }]);
    const numbers = [...dialog.querySelectorAll(".cln-totals > li")].map((li) => [
      li.querySelector(".cln-big")!.textContent,
      li.querySelector(".cln-label")!.textContent,
    ]);
    expect(numbers).toEqual([
      ["2", "movidos"],
      ["4", "pulados"],
      ["1", "propostas"],
    ]);
    const skipped = [...dialog.querySelectorAll(".cln-done > .cln-plan li")].map((li) => li.textContent);
    expect(skipped).toEqual([
      `${MEM}/notes/m1.mdmudou depois da varredura`,
      `${MEM}/notes/m2.mdnão existe mais`,
      `${MEM}/notes/m3.mdo destino já existe`,
      `${MEM}/notes/m4.mdcaminho com link`,
    ]);
    expect(within(dialog).getByRole("button", { name: "Abrir a lista de propostas" })).toBeTruthy();
    const foot = footer();
    expect(foot.map((b) => [b.textContent, b.className])).toEqual([
      ["Desfazer", "btn"],
      ["Fechar", "btn primary"],
    ]);
    fireEvent.click(foot[0]!);
    await waitFor(() => expect(within(dialog).getByText("Desfeito: 2 arquivos voltaram.")).toBeTruthy());
    expect(sent("POST", "/api/memory/cleanup/undo")).toEqual([{ manifest: MANIFEST }]);
    const undone = [...dialog.querySelectorAll(".cln-done > .cln-plan")].at(-1)!;
    expect(follows(within(dialog).getByText("Desfeito: 2 arquivos voltaram."), undone)).toBe(true);
    expect([...undone.querySelectorAll("li")].map((li) => li.textContent)).toEqual([
      `${MEM}/notes/m1.mdmudou depois da varredura`,
    ]);
  });

  it("C69 with no proposals there is no link, and propostas reads 0", async () => {
    cleanup.apply = () => Promise.resolve(RESULT(null));
    const { dialog } = await answerFour();
    fireEvent.click(screen.getByRole("button", { name: "Aplicar" }));
    await atStep("Etapa 5 de 5 · Pronto");
    expect(within(dialog).queryByRole("button", { name: "Abrir a lista de propostas" })).toBeNull();
    expect(dialog.querySelectorAll(".cln-totals .cln-big")[2]!.textContent).toBe("0");
  });
});
