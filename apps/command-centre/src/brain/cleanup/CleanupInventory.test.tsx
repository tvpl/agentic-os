// @vitest-environment jsdom
/**
 * Step 2 of the guided cleanup (.specs/features/cerebro-faxina-guiada, C55, C56, C57; design.md "Etapa 2"): the
 * cards in their order with what each holds, the grid's columns, the loading skeleton, the number that rises from
 * zero (or not, under reduced motion), and the scan's phase, count and bar below the cards.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import postcss from "postcss";
import type * as ApiModule from "../../api";
import { installPage, motion } from "../../ui/testkit";
import { renderWith } from "../../contexts/testkit";
import { emit, resetNet } from "../notes/testnet";
import { InventoryCards } from "./CleanupInventory";
import { atStep, cleanup, context, inventory, openWizard, resetCleanup, scan } from "./testkit";

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

const css = () => postcss.parse(readFileSync(join(__dirname, "cleanup.css"), "utf8"));
const follows = (a: Element, b: Element) =>
  (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
const cardOf = (title: string) =>
  [...document.querySelectorAll(".cln-card")].find(
    (c) => c.querySelector("h3")?.textContent === title,
  ) as HTMLElement;

describe("C55 the cards of what a scope holds", () => {
  it("C55 Arquivos, Por tipo, Idade, Maiores pastas and Grupos, in that order, each with what it holds", () => {
    motion.reduced = true;
    renderWith(<InventoryCards data={inventory(10, 14)} />, { lang: "pt-BR" });
    const cards = [...document.querySelectorAll(".cln-grid > .cln-card")];
    expect(cards.map((c) => c.querySelector("h3")!.textContent)).toEqual([
      "Arquivos",
      "Por tipo",
      "Idade",
      "Maiores pastas",
      "Grupos",
    ]);
    // Arquivos: the total and its bytes.
    expect(cardOf("Arquivos").querySelector(".cln-big")!.textContent).toBe("14");
    expect(cardOf("Arquivos").textContent).toContain("5.0 KB");
    // Por tipo: six bars, each with its number.
    const bars = [...cardOf("Por tipo").querySelectorAll("li")];
    expect(
      bars.map((b) => [b.querySelector(".cln-label")!.textContent, b.querySelector(".cln-num")!.textContent]),
    ).toEqual([
      ["notas", "6"],
      ["texto", "5"],
      ["PDF", "4"],
      ["imagem", "3"],
      ["código", "2"],
      ["outros", "1"],
    ]);
    for (const b of bars) expect(b.querySelector(".cln-track .cln-fill")).not.toBeNull();
    // Idade: four columns in band order, the number above each; the last one warns and says "parados".
    const cols = [...cardOf("Idade").querySelectorAll("ol > li")];
    expect(cols.map((c) => c.querySelector(".cln-label")!.textContent)).toEqual([
      "até 30 dias",
      "31-90",
      "91-365",
      "mais de um ano",
    ]);
    expect(cols.map((c) => c.querySelector(".cln-num")!.textContent)).toEqual(["5", "4", "3", "2 parados"]);
    for (const c of cols)
      expect(follows(c.querySelector(".cln-num")!, c.querySelector(".cln-col")!)).toBe(true);
    expect(cols.map((c) => c.classList.contains("cln-warn"))).toEqual([false, false, false, true]);
    const warn: string[] = [];
    css().walkRules((r) => {
      if (r.selector.includes(".cln-warn")) r.walkDecls((d) => void warn.push(d.value));
    });
    expect(warn.length).toBeGreaterThan(0);
    expect(warn.every((v) => v === "var(--warn)")).toBe(true);
    // Maiores pastas: ten rows, name, size and a bar.
    const folders = [...cardOf("Maiores pastas").querySelectorAll("li")];
    expect(folders).toHaveLength(10);
    expect(folders.map((f) => f.querySelector(".cln-label")!.textContent)).toEqual(
      Array.from({ length: 10 }, (_, i) => `pasta-${i}`),
    );
    expect(folders[0]!.querySelector(".cln-num")!.textContent).toBe("9.8 KB");
    for (const f of folders) expect(f.querySelector(".cln-fill")).not.toBeNull();
    // Grupos: up to twelve pills, name and count.
    const pills = [...cardOf("Grupos").querySelectorAll(".cln-pill")];
    expect(pills).toHaveLength(12);
    expect(pills[0]!.textContent).toBe("grupo-0 20");
    expect(pills[0]!.querySelector(".cln-num")!.textContent).toBe("20");
  });

  it("C55 the grid has two columns, and one under 760 px (the browser measures 1 280 px and 600 px)", () => {
    const columns: Array<[string, string]> = [];
    css().walkRules(".cln-grid", (r) => {
      r.walkDecls("grid-template-columns", (d) => {
        columns.push([r.parent?.type === "atrule" ? (r.parent as postcss.AtRule).params : "", d.value]);
      });
    });
    expect(columns).toEqual([
      ["", "1fr 1fr"],
      ["(max-width: 760px)", "1fr"],
    ]);
  });

  it("C55 while the inventory loads: the cards' skeletons, a spinner and Lendo o índice…", () => {
    renderWith(<InventoryCards data={undefined} />, { lang: "pt-BR" });
    const grid = document.querySelector(".cln-grid")!;
    expect(grid.getAttribute("aria-busy")).toBe("true");
    const status = within(grid as HTMLElement).getByRole("status");
    expect(status.textContent).toBe("Lendo o índice…");
    expect(status.querySelector(".spinner")).not.toBeNull();
    expect(grid.querySelectorAll(".cln-card.cln-ghost")).toHaveLength(5);
  });
});

describe("C56 the Arquivos number rises from zero", () => {
  it("C56 with motion allowed it reads 0 on the first frame and its final value 300 ms later", async () => {
    vi.useFakeTimers({
      toFake: ["requestAnimationFrame", "cancelAnimationFrame", "performance", "setTimeout"],
    });
    motion.reduced = false;
    renderWith(<InventoryCards data={inventory()} />, { lang: "pt-BR" });
    const big = () => cardOf("Arquivos").querySelector(".cln-big")!.textContent;
    expect(big()).toBe("0");
    act(() => void vi.advanceTimersByTime(150));
    expect(Number(big())).toBeGreaterThan(0);
    expect(Number(big())).toBeLessThan(14);
    act(() => void vi.advanceTimersByTime(170));
    expect(big()).toBe("14");
  });

  it("C56 under prefers-reduced-motion: reduce it reads the final value on the first frame", () => {
    motion.reduced = true;
    renderWith(<InventoryCards data={inventory()} />, { lang: "pt-BR" });
    expect(cardOf("Arquivos").querySelector(".cln-big")!.textContent).toBe("14");
  });
});

describe("C57 a running scan below the cards", () => {
  const phases: Array<[string, string]> = [
    ["inventory", "Lendo o índice"],
    ["signatures", "Calculando assinaturas"],
    ["links", "Conferindo links"],
    ["findings", "Separando achados"],
  ];
  for (const [phase, text] of phases)
    it(`C57 the phase ${phase} reads ${text}, with 120/3000, the bar at 120 of 3000 and Cancelar`, async () => {
      context("alfa", "Alfa");
      cleanup.starts.push("scan-1");
      scan("scan-1", [], { status: "running", phase: "inventory", finishedAt: null });
      const { dialog } = await openWizard({ context: "alfa", step: 2 });
      await atStep("Etapa 2 de 5 · O que tem aqui");
      const go = within(dialog).getByRole("button", { name: "Procurar o que decidir" });
      await waitFor(() => expect((go as HTMLButtonElement).disabled).toBe(false));
      fireEvent.click(go);
      await waitFor(() => expect(dialog.querySelector(".cln-progress")).not.toBeNull());
      act(() => emit("cleanup.progress", { scanId: "scan-1", phase, done: 120, total: 3000 }));
      const box = dialog.querySelector(".cln-progress") as HTMLElement;
      expect(follows(dialog.querySelector(".cln-grid")!, box)).toBe(true);
      expect(box.querySelector(".cln-phase")!.textContent).toBe(text);
      expect(box.textContent).toContain("120/3000");
      const bar = within(box).getByRole("progressbar");
      expect(bar.getAttribute("aria-valuenow")).toBe("120");
      expect(bar.getAttribute("aria-valuemax")).toBe("3000");
      expect(within(box).getByRole("button", { name: "Cancelar" })).toBeTruthy();
      // Another scan's progress is not this one's.
      act(() => emit("cleanup.progress", { scanId: "outra", phase, done: 7, total: 9 }));
      expect(box.textContent).toContain("120/3000");
      void screen;
    });
});
