// @vitest-environment jsdom
/**
 * The charts' tooltip and table view (.specs/features/cerebro-paineis, C79; design.md "Interação", the `dataviz`
 * method): a KPI's sparkline and a `bars` widget each have "Ver como tabela" (a `Switch`) that swaps the chart for a
 * table of the same values; pointing at or focusing a point shows a tooltip, the value then the label, written with
 * `textContent`; `Escape` closes it; every value a tooltip shows is in that widget's table.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, waitFor, within } from "@testing-library/react";
import type * as ApiModule from "../api";
import type * as EventsModule from "../hooks/useEventStream";
import { installPage } from "../ui/testkit";
import { resetDash } from "./testnet";
import { HOUR, card, definition, mountBoard, ok, read, serve, snapshot, tile, w } from "./testkit";

vi.mock("../api", async (importOriginal) =>
  (await import("./testnet")).dashMockApi(await importOriginal<typeof ApiModule>()),
);
vi.mock("../hooks/useEventStream", async (importOriginal) => ({
  ...(await importOriginal<typeof EventsModule>()),
  useOsEvent: (await import("../brain/notes/testnet")).useOsEventMock,
}));
vi.setConfig({ testTimeout: 30_000 });

installPage();
beforeEach(() => {
  resetDash();
});

const T = new Date(2026, 9, 30, 9).getTime();
const series = [3, 7, 4, 9].map((value, i) => ({ at: T + i * HOUR, value }));
const categories = [
  { label: "<b>rascunho</b>", count: 13 },
  { label: "feito", count: 6 },
];

function mount() {
  serve(
    "visao-geral",
    read(
      definition("overview", [
        w("k", "kpi", { kind: "notes" }, { measure: "count" }, "Notas"),
        w("b", "bars", { kind: "notes", groupBy: "status" }, undefined, "Por status"),
      ]),
      snapshot("visao-geral", [
        ok("k", "kpi", { value: 9, delta: 6, deltaPct: 200, direction: "up", good: true, series }),
        ok("b", "bars", { categories }),
      ]),
    ),
  );
  mountBoard();
}

/** The tooltip's text as the reader has it: the value (`strong`), then the label. */
const tipOf = (el: Element) => {
  const tip = el.querySelector<HTMLElement>(".dsh-tip")!;
  return {
    hidden: tip.hidden,
    value: tip.querySelector("strong")?.textContent ?? null,
    label: tip.querySelector("span")?.textContent ?? null,
  };
};
/** Every value of a table as `label|value`. */
const tableRows = (el: Element) =>
  [...el.querySelectorAll(".dsh-values tr")].map(
    (tr) => `${tr.querySelector("th")!.textContent}|${tr.querySelector("td")!.textContent}`,
  );

/** Walk every point by keyboard and collect what the tooltip said. */
function walk(frame: HTMLElement, n: number) {
  frame.focus();
  fireEvent.focus(frame);
  const seen = [tipOf(frame.parentElement!.closest(".dsh-kpi, .dsh-card")!)];
  for (let i = 1; i < n; i++) {
    fireEvent.keyDown(frame, { key: "ArrowLeft" });
    seen.push(tipOf(frame.parentElement!.closest(".dsh-kpi, .dsh-card")!));
  }
  return seen;
}

describe("C79 the tooltip is never the only way to a value", () => {
  it("C79 the sparkline: focus shows the last point, the value first and the label after; Escape closes it; pointing at a point shows that one", async () => {
    mount();
    await waitFor(() => expect(tile("k").querySelector(".dsh-spark")).not.toBeNull());
    const frame = tile("k").querySelector<HTMLElement>(".dsh-spark")!;
    expect(tipOf(tile("k")).hidden).toBe(true);
    fireEvent.focus(frame);
    const shown = tipOf(tile("k"));
    expect(shown.hidden).toBe(false);
    expect(shown.value).toBe("9");
    expect(shown.label).toMatch(/30 de out\. \d\d:00$/);
    const tip = tile("k").querySelector(".dsh-tip")!;
    expect([...tip.childNodes].map((n) => n.nodeName)).toEqual(["STRONG", "#text", "SPAN"]);
    fireEvent.keyDown(frame, { key: "Escape" });
    expect(tipOf(tile("k")).hidden).toBe(true);
    fireEvent.pointerMove(frame.querySelector('rect[data-point="1"]')!);
    expect(tipOf(tile("k")).value).toBe("7");
  });

  it("C79 the bars: pointing at a bar shows its value and its label as text, never as markup", async () => {
    mount();
    await waitFor(() => expect(card("b").querySelector(".dsh-bar-row")).not.toBeNull());
    fireEvent.pointerMove(card("b").querySelectorAll(".dsh-bar-row")[0]!);
    const shown = tipOf(card("b"));
    expect([shown.value, shown.label]).toEqual(["13", "<b>rascunho</b>"]);
    expect(card("b").querySelector(".dsh-tip b")).toBeNull();
    fireEvent.keyDown(card("b").querySelector(".dsh-bars")!, { key: "Escape" });
    expect(tipOf(card("b")).hidden).toBe(true);
  });

  it("C79 Ver como tabela is a Switch on the KPI and on the bars; on, the chart is a table of the same values, and every tooltip's value is in it", async () => {
    mount();
    await waitFor(() => expect(tile("k").querySelector(".dsh-spark")).not.toBeNull());
    const kpiTips = walk(tile("k").querySelector<HTMLElement>(".dsh-spark")!, series.length);
    const barTips = walk(card("b").querySelector<HTMLElement>(".dsh-bars")!, categories.length);
    for (const [el, tips] of [
      [tile("k"), kpiTips],
      [card("b"), barTips],
    ] as const) {
      const sw = within(el).getByRole("switch", { name: "Ver como tabela" });
      expect(sw.getAttribute("aria-checked")).toBe("false");
      fireEvent.click(sw);
      await waitFor(() => expect(el.querySelector(".dsh-values")).not.toBeNull());
      expect(el.querySelector(".dsh-spark, .dsh-bars")).toBeNull();
      const table = tableRows(el);
      expect(table).toHaveLength(tips.length);
      for (const tip of tips) expect(table).toContain(`${tip.label}|${tip.value}`);
      fireEvent.click(sw);
      await waitFor(() => expect(el.querySelector(".dsh-spark, .dsh-bars")).not.toBeNull());
    }
    expect(kpiTips.map((t) => t.value)).toEqual(["9", "4", "7", "3"]);
    expect(barTips.map((t) => t.value)).toEqual(["6", "13"]);
  });
});
