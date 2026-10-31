// @vitest-environment jsdom
/**
 * The widgets (.specs/features/cerebro-paineis, C70, C72, C73, C74, C75, C77, C78, C80; design.md "Widgets"): the KPI
 * tile, checking a task, the state and nature badges of a list row, the table, the bars, the note, the highlights row,
 * and where an item goes. Mounted on the page over the table of `./testnet`.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, waitFor, within } from "@testing-library/react";
import postcss from "postcss";
import type * as ApiModule from "../api";
import type * as EventsModule from "../hooks/useEventStream";
import { installPage } from "../ui/testkit";
import { MEM, NetError, net, note } from "../brain/notes/testnet";
import { sparkline } from "../runs/sparkline";
import { dash, resetDash, sent } from "./testnet";
import {
  HOUR,
  card,
  definition,
  icons,
  mountBoard,
  ok,
  read,
  serve,
  snapshot,
  tile,
  w,
  where,
} from "./testkit";

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

const CSS = postcss.parse(readFileSync(join(__dirname, "dashboards.css"), "utf8"));
const decl = (selector: string, prop: string) => {
  let v = "";
  CSS.walkRules(selector, (r) => r.walkDecls(prop, (d) => void (v = d.value)));
  return v;
};
const one = (widgets: Parameters<typeof definition>[1], snaps: Parameters<typeof snapshot>[1], over = {}) => {
  serve("visao-geral", read(definition("overview", widgets), snapshot("visao-geral", snaps), over));
  return mountBoard();
};

describe("C70 the KPI tile", () => {
  const series = [3, 5, 4, 6, 5].map((value, i) => ({ at: 1_700_000_000_000 + i * HOUR, value }));
  const kpis = [
    w(
      "a",
      "kpi",
      { kind: "tasks", window: "today" },
      { measure: "done_of_due", chip: "remaining" },
      "Prioridades de hoje",
    ),
    w("b", "kpi", { kind: "notes" }, { measure: "count", period: "week" }, "Notas"),
    w("c", "kpi", { kind: "notes" }, { measure: "count" }, "Sem tendência"),
    w("d", "kpi", { kind: "notes" }, { measure: "count" }, "Zero"),
  ];
  const snaps = [
    ok("a", "kpi", {
      value: 1284,
      of: 5,
      delta: -1,
      deltaPct: -16.7,
      direction: "down",
      good: false,
      chip: { rule: "remaining", n: 2, tone: "warn" },
      series,
    }),
    ok("b", "kpi", { value: 12900, delta: 1700, deltaPct: 15, direction: "up", good: true, series }),
    ok("c", "kpi", { value: 4, series: [{ at: 1, value: 4 }] }),
    ok("d", "kpi", { value: 0, series: [{ at: 1, value: 0 }] }),
  ];

  it("C70 in order: the label, the value compacted, /5, the sparkline, the signed delta with its class, the chip text", async () => {
    one(kpis, snaps);
    await waitFor(() => expect(tile("a").querySelector(".dsh-spark")).not.toBeNull());
    const a = tile("a");
    const order = [
      ...a.querySelectorAll(".dsh-kpi-label, .dsh-kpi-value, .dsh-kpi-of, .dsh-spark, .dsh-delta, .dsh-chip"),
    ];
    expect(order.map((e) => [...e.classList].find((c) => c.startsWith("dsh-")))).toEqual([
      "dsh-kpi-label",
      "dsh-kpi-value",
      "dsh-kpi-of",
      "dsh-spark",
      "dsh-delta",
      "dsh-chip",
    ]);
    expect(order.map((e) => e.textContent?.trim())).toEqual([
      "Prioridades de hoje",
      "1.284",
      "/5",
      "",
      "−1 hoje",
      "2 restantes",
    ]);
    expect(a.querySelector(".dsh-kpi-label")!.textContent).not.toContain(":");
    expect(a.querySelector(".dsh-delta")!.classList.contains("bad")).toBe(true);
    const b = tile("b");
    // Intl joins the number and "mil" with a no-break space.
    expect(b.querySelector(".dsh-kpi-value")!.textContent).toBe("12,9\u00a0mil");
    expect(b.querySelector(".dsh-delta")!.textContent).toBe("↑ 15% na semana");
    expect(b.querySelector(".dsh-delta")!.classList.contains("good")).toBe(true);
  });

  it("C70 the sparkline: the path of sparkline() for the series, the history in --chart-muted, the last point a dot", async () => {
    one(kpis, snaps);
    await waitFor(() => expect(tile("a").querySelector(".dsh-spark")).not.toBeNull());
    const svg = tile("a").querySelector(".dsh-spark svg")!;
    const geo = sparkline([3, 5, 4, 6, 5], 96, 32);
    expect(svg.querySelector("path.dsh-spark-hist")!.getAttribute("d")).toBe(geo.line);
    expect(decl(".dsh-spark-hist", "stroke")).toBe("var(--chart-muted)");
    expect(decl(".dsh-spark-now", "stroke")).toBe("var(--chart-mark)");
    const dot = svg.querySelector("circle.dsh-spark-dot")!;
    expect([dot.getAttribute("cx"), dot.getAttribute("cy"), dot.getAttribute("r")]).toEqual([
      String(geo.last!.x),
      String(geo.last!.y),
      "4",
    ]);
  });

  it("C70 with no delta: Sem histórico ainda where the sparkline was; a value 0 reads 0", async () => {
    one(kpis, snaps);
    await waitFor(() => expect(tile("c").querySelector(".dsh-nohist")).not.toBeNull());
    expect(tile("c").querySelector(".dsh-spark")).toBeNull();
    expect(tile("c").querySelector(".dsh-nohist")!.textContent).toBe("Sem histórico ainda");
    expect(tile("c").querySelector(".dsh-nohist")!.previousElementSibling!.className).toContain(
      "dsh-kpi-value",
    );
    expect(tile("d").querySelector(".dsh-kpi-value")!.textContent).toBe("0");
  });
});

describe("C72 checking a task", () => {
  const path = `${MEM}/notes/a.md`;
  const tasks = [w("t", "checklist", { kind: "tasks", window: "today" })];
  const snaps = [
    ok("t", "checklist", {
      items: [
        {
          path,
          line: 3,
          fileId: 9,
          text: "Mandar a proposta",
          done: false,
          due: null,
          priority: 0,
          title: "A",
        },
      ],
      total: 1,
    }),
  ];
  const box = () => card("t").querySelector<HTMLInputElement>('input[type="checkbox"]')!;

  it("C72 GET the note's version, then PUT /api/memory/tasks with path, line 3, done and that version; the row shows checked", async () => {
    note(9, MEM, "notes/a.md", { version: `sha256:${"9".repeat(64)}` });
    dash.writes.set("PUT /api/memory/tasks", async (b) => ({
      path,
      version: `sha256:${"8".repeat(64)}`,
      task: { line: 3, done: (b as { done: boolean }).done, text: "Mandar a proposta" },
    }));
    one(tasks, snaps);
    await waitFor(() => expect(box().disabled).toBe(false));
    fireEvent.click(box());
    await waitFor(() => expect(sent("PUT", "/api/memory/tasks")).toHaveLength(1));
    expect(sent("PUT", "/api/memory/tasks")[0]).toEqual({
      path,
      line: 3,
      done: true,
      baseVersion: `sha256:${"9".repeat(64)}`,
    });
    const get = net.calls.findIndex((c) => c.method === "GET" && c.url.startsWith("/api/memory/note?"));
    const put = net.calls.findIndex((c) => c.method === "PUT" && c.url === "/api/memory/tasks");
    expect(get).toBeGreaterThanOrEqual(0);
    expect(get).toBeLessThan(put);
    expect(new URLSearchParams(net.calls[get]!.url.split("?")[1]).get("p")).toBe(path);
    await waitFor(() => expect(box().disabled).toBe(false));
    expect(box().checked).toBe(true);
    expect(card("t").querySelector(".dsh-task")!.hasAttribute("data-done")).toBe(true);
  });

  it("C72 a 409 edit_conflict unchecks the row and says A nota mudou; atualize o painel.", async () => {
    note(9, MEM, "notes/a.md");
    dash.writes.set("PUT /api/memory/tasks", () => Promise.reject(new NetError(409, "edit_conflict")));
    one(tasks, snaps);
    await waitFor(() => expect(box().disabled).toBe(false));
    fireEvent.click(box());
    await within(card("t")).findByText("A nota mudou; atualize o painel.");
    expect(box().checked).toBe(false);
  });
});

describe("C73 the badges of a list row", () => {
  const STATES: Array<[string, Record<string, unknown>, string | null, string, string]> = [
    ["decisions", { text: "d", state: "decided", natureza: "fato" }, "lucide-check", "Decidido", "ok"],
    ["decisions", { text: "d", state: "open", natureza: null }, "lucide-circle-dot", "Aberta", "warn"],
    ["projects", { title: "p", health: "on_track" }, null, "No prazo", "ok"],
    ["projects", { title: "p", health: "behind" }, null, "Atrasado", "danger"],
    ["projects", { title: "p", health: "due_today" }, null, "Vence hoje", "warn"],
    ["projects", { title: "p", health: "in_review" }, null, "Em revisão", "info"],
    ["projects", { title: "p", health: "paused" }, null, "Pausado", "dim"],
    ["runs", { id: "r1", skill: "s", state: "running" }, "lucide-loader", "Executando", "info"],
  ];
  for (const [source, itemData, icon, text, tone] of STATES)
    it(`C73 ${text}: ${icon ?? "an icon"}, the text and the tone ${tone}, at the right of the title and subtitle`, async () => {
      const src =
        source === "decisions"
          ? { kind: "decisions" as const, window: "week" as const }
          : { kind: source as "projects" };
      one(
        [w("l", "list", src)],
        [ok("l", "list", { items: [{ ...itemData, day: "2026-10-28", due: "2026-11-02" }], total: 1 })],
      );
      await waitFor(() => expect(card("l").querySelector(".dsh-row")).not.toBeNull());
      const row = card("l").querySelector(".dsh-row")!;
      expect([...row.children].map((c) => c.className)).toEqual(["dsh-row-main", "dsh-row-badges"]);
      const badge = row.querySelector(".dsh-row-badges .dsh-state")!;
      expect(badge.textContent).toBe(text);
      expect(badge.classList.contains(tone)).toBe(true);
      expect(badge.querySelectorAll("svg")).toHaveLength(1);
      if (icon) expect(icons(badge)).toEqual([icon]);
    });

  const NATURES: Array<[string, string]> = [
    ["plano", "Plano — ainda não é realidade"],
    ["hipotese", "Hipótese"],
    ["opiniao", "Opinião"],
  ];
  for (const [natureza, label] of NATURES)
    it(`C73 a ${natureza} item shows C6's NatureBadge (${label}) and no Decidido, though its state reads decided`, async () => {
      one(
        [w("l", "list", { kind: "decisions", window: "week" })],
        [ok("l", "list", { items: [{ text: "Talvez", state: "decided", natureza }], total: 1 })],
      );
      await waitFor(() => expect(card("l").querySelector(".dsh-row")).not.toBeNull());
      const badges = card("l").querySelector(".dsh-row-badges")!;
      const nb = badges.querySelector(".badge.meta.nb")!;
      expect(nb.textContent).toBe(label);
      expect(nb.querySelectorAll("svg")).toHaveLength(1);
      expect(badges.textContent).not.toContain("Decidido");
    });

  it("C73 a fato decided item shows Decidido and no nature badge", async () => {
    one(
      [w("l", "list", { kind: "decisions", window: "week" })],
      [ok("l", "list", { items: [{ text: "Usar Postgres", state: "decided", natureza: "fato" }], total: 1 })],
    );
    await waitFor(() => expect(card("l").querySelector(".dsh-row")).not.toBeNull());
    expect(card("l").querySelector(".dsh-row-badges")!.textContent).toBe("Decidido");
    expect(card("l").querySelector(".nb")).toBeNull();
  });
});

describe("C74 the table", () => {
  it("C74 the header row, 20 of 23 rows and Ver todas (23), numbers at the right in tabular-nums, the state badges of C73", async () => {
    const rows = Array.from({ length: 23 }, (_, i) => ({
      cells: [`Cliente ${i + 1}`, i + 10],
      state: "behind",
    }));
    one([w("tb", "table", { kind: "notes" })], [ok("tb", "table", { columns: ["Cliente", "Dias"], rows })]);
    await waitFor(() => expect(card("tb").querySelector("table")).not.toBeNull());
    const table = card("tb").querySelector("table")!;
    expect([...table.querySelectorAll("thead th")].map((th) => th.textContent)).toEqual([
      "Cliente",
      "Dias",
      "",
    ]);
    const body = [...table.querySelectorAll("tbody tr")];
    expect(body).toHaveLength(20);
    expect(body[0]!.querySelector("td")!.textContent).toBe("Cliente 1");
    const n = body[0]!.querySelectorAll("td")[1]!;
    expect(n.textContent).toBe("10");
    expect(n.classList.contains("dsh-num")).toBe(true);
    expect(decl(".dsh-table .dsh-num", "text-align")).toBe("right");
    expect(decl(".dsh-num", "font-variant-numeric")).toBe("tabular-nums");
    const badge = body[0]!.querySelector(".dsh-state")!;
    expect(badge.textContent).toBe("Atrasado");
    expect(badge.classList.contains("danger")).toBe(true);
    expect(within(card("tb")).getByRole("button", { name: "Ver todas (23)" })).toBeTruthy();
  });
});

describe("C75 the bars", () => {
  const categories = [
    { label: "draft", count: 13 },
    { label: "done", count: 6 },
    { label: "active", count: 3 },
  ];
  it("C75 one bar per category in order: the label, the bar on its track, the value; no legend", async () => {
    one([w("br", "bars", { kind: "notes", groupBy: "status" })], [ok("br", "bars", { categories })]);
    await waitFor(() => expect(card("br").querySelector(".dsh-bar-row")).not.toBeNull());
    const rows = [...card("br").querySelectorAll(".dsh-bar-row")];
    expect(rows.map((r) => r.querySelector(".dsh-bar-label")!.textContent)).toEqual([
      "draft",
      "done",
      "active",
    ]);
    expect(rows.map((r) => r.querySelector(".dsh-bar-value")!.textContent)).toEqual(["13", "6", "3"]);
    expect([...rows[0]!.children].map((c) => c.getAttribute("class")!.split(" ")[0])).toEqual([
      "dsh-bar-label",
      "dsh-bar-svg",
      "dsh-bar-value",
    ]);
    expect(rows[0]!.querySelector(".dsh-bar-track")).not.toBeNull();
    expect(rows[0]!.querySelector(".dsh-bar rect")!.getAttribute("width")).toBe("100%");
    expect(rows[1]!.querySelector(".dsh-bar rect")!.getAttribute("width")).toBe(`${(6 / 13) * 100}%`);
    expect(decl(".dsh-bar", "fill")).toBe("var(--chart-mark)");
    expect(decl(".dsh-bar-track", "fill")).toContain("var(--chart-muted)");
    expect(card("br").querySelector(".dsh-bar-conv")).toBeNull();
    expect(card("br").querySelector('[class*="legend"]')).toBeNull();
  });

  it("C75 ordered and funnel: the conversion 46% in a column after the values", async () => {
    one(
      [w("br", "bars", { kind: "notes", groupBy: "status" }, { ordered: true, funnel: true })],
      [ok("br", "bars", { categories })],
    );
    await waitFor(() => expect(card("br").querySelector(".dsh-bar-row")).not.toBeNull());
    const rows = [...card("br").querySelectorAll(".dsh-bar-row")];
    expect(rows.map((r) => r.querySelector(".dsh-bar-conv")!.textContent)).toEqual(["", "46%", "50%"]);
    expect(rows[1]!.lastElementChild!.className).toContain("dsh-bar-conv");
  });
});

describe("C77 the note", () => {
  it("C77 the excerpt through components/Markdown, at most 12 lines, then Abrir nota", async () => {
    const lines = Array.from({ length: 15 }, (_, i) => `Linha **${i + 1}**`).join("\n\n");
    one([w("n", "note", { kind: "notes" })], [ok("n", "note", { text: lines, fileId: 4 })]);
    await waitFor(() => expect(card("n").querySelector(".apps-md.dsh-md")).not.toBeNull());
    const md = card("n").querySelector(".apps-md.dsh-md")!;
    expect(md.querySelector("strong")!.textContent).toBe("1");
    expect(md.textContent).toContain("Linha 6");
    expect(md.textContent).not.toContain("Linha 7");
    const open = within(card("n")).getByRole("button", { name: "Abrir nota" });
    expect(md.compareDocumentPosition(open) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    fireEvent.click(open);
    await waitFor(() => expect(`${where.pathname}${where.search}`).toBe("/brain?sel=4"));
  });

  it("C77 an empty excerpt reads Esta nota está vazia.", async () => {
    one([w("n", "note", { kind: "notes" })], [ok("n", "note", { text: "" })]);
    await within(document.body).findByText("Esta nota está vazia.");
  });

  it("C77 no file of the dashboards folder imports a Markdown renderer other than components/Markdown", () => {
    const files = readdirSync(__dirname).filter((f) => /\.tsx?$/.test(f) && !/\.test\./.test(f));
    const renderers = files.flatMap((f) =>
      [...readFileSync(join(__dirname, f), "utf8").matchAll(/from\s+"([^"]+)"/g)]
        .map((m) => m[1]!)
        .filter((spec) => /markdown|marked|remark|mdx/i.test(spec))
        .map((spec) => `${f}: ${spec}`),
    );
    expect(renderers).toEqual(["widgets.tsx: ../components/Markdown"]);
  });
});

describe("C78 the highlights row", () => {
  const H = [
    { rule: "overdue", title: "Mandar a proposta", tone: "danger", target: "/brain?sel=5" },
    { rule: "due_today", title: "Ligar", tone: "warn", target: "/brain?sel=6" },
    { rule: "new_since_visit", title: "Nova nota", tone: "info", target: "/brain?sel=8" },
  ];
  const widgets = [w("k", "kpi", { kind: "notes" }, { measure: "count" }, "Notas")];
  const snaps = [ok("k", "kpi", { value: 2, series: [] })];

  it("C78 above the KPI row, in the response's order, each an icon, the text and the tone; a pill opens its target", async () => {
    one(widgets, snaps, { highlights: H });
    await waitFor(() => expect(document.querySelector(".dsh-highlights")).not.toBeNull());
    const row = document.querySelector(".dsh-highlights")!;
    expect(
      row.compareDocumentPosition(document.querySelector(".dsh-kpis")!) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    const pills = [...row.querySelectorAll<HTMLButtonElement>(".dsh-pill")];
    expect(pills.map((p) => p.textContent)).toEqual(["Mandar a proposta", "Ligar", "Nova nota"]);
    expect(pills.map((p) => p.classList.contains(H[pills.indexOf(p)]!.tone))).toEqual([true, true, true]);
    expect(pills.map((p) => icons(p).length)).toEqual([1, 1, 1]);
    fireEvent.click(pills[1]!);
    await waitFor(() => expect(`${where.pathname}${where.search}`).toBe("/brain?sel=6"));
  });

  it("C78 with highlights: [] the row is absent; with one, one pill", async () => {
    const view = one(widgets, snaps, { highlights: [] });
    await waitFor(() => expect(tile("k").querySelector(".dsh-kpi-value")).not.toBeNull());
    expect(document.querySelector(".dsh-highlights")).toBeNull();
    view.unmount();
    resetDash();
    one(widgets, snaps, { highlights: [H[0]] });
    await waitFor(() => expect(document.querySelectorAll(".dsh-pill")).toHaveLength(1));
  });
});

describe("C80 where an item goes", () => {
  const widgets = [
    w("l", "list", { kind: "notes" }),
    w("t", "checklist", { kind: "tasks", window: "today" }),
    w("c", "list", { kind: "connector", id: "gmail", read: "list" }),
  ];
  const snaps = [
    ok("l", "list", { items: [{ title: "Plano de março", fileId: 12 }], total: 1 }),
    ok("t", "checklist", {
      items: [{ path: `${MEM}/notes/a.md`, line: 2, fileId: 9, text: "Ligar", done: false, due: null }],
      total: 1,
    }),
    ok("c", "list", {
      connector: { id: "gmail", name: "Gmail" },
      items: [
        { id: "m1", title: "Proposta", href: "https://mail.example.com/m1" },
        { id: "m2", title: "Sem link" },
      ],
      total: 2,
    }),
  ];

  it("C80 a note's list and checklist items go to /brain?sel=<fileId>", async () => {
    one(widgets, snaps);
    fireEvent.click(await within(document.body).findByRole("button", { name: "Plano de março" }));
    await waitFor(() => expect(`${where.pathname}${where.search}`).toBe("/brain?sel=12"));
  });

  it("C80 a checklist item from a note goes to its note", async () => {
    one(widgets, snaps);
    fireEvent.click(await within(document.body).findByRole("button", { name: "Ligar" }));
    await waitFor(() => expect(`${where.pathname}${where.search}`).toBe("/brain?sel=9"));
  });

  it("C80 a connector item with href opens it outside with noopener and the route stays; one with no href is not a button", async () => {
    const opened = vi.spyOn(window, "open").mockReturnValue(null);
    one(widgets, snaps);
    fireEvent.click(await within(document.body).findByRole("button", { name: "Proposta" }));
    expect(opened).toHaveBeenCalledWith("https://mail.example.com/m1", "_blank", "noopener");
    expect(where.pathname).toBe("/dashboards");
    const plain = within(card("c")).getByText("Sem link");
    expect(plain.tagName.toLowerCase()).toBe("span");
    expect(plain.closest("button")).toBeNull();
    opened.mockRestore();
  });

  it("C80 a citation plano.md § Metas goes to /brain?sel=<its fileId>", async () => {
    serve(
      "pergunta",
      read(
        definition("question", []),
        snapshot("pergunta", [
          ok("q", "list", {
            title: "Motivos",
            items: [{ title: "Contrato" }],
            citations: [{ path: `${MEM}/notes/plano.md`, section: "Metas", name: "plano.md", fileId: 7 }],
          }),
        ]),
      ),
    );
    mountBoard({ path: "/dashboards/pergunta" });
    fireEvent.click(await within(document.body).findByRole("button", { name: "plano.md § Metas" }));
    await waitFor(() => expect(`${where.pathname}${where.search}`).toBe("/brain?sel=7"));
  });
});
