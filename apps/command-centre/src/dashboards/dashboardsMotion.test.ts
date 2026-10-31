// @vitest-environment jsdom
/**
 * The motion and the stylesheet of the dashboards (.specs/features/cerebro-paineis, C92, C93; design.md "Movimento" and
 * "Cores dos gráficos"; plan.md amendment 23): every animation and transition inside `@media (prefers-reduced-motion:
 * no-preference)`, the KPI that counts in 400 ms, the bars that grow in 300 ms, the pill that fades in in 150 ms, the
 * same texts and icons and the final values at once with motion reduced; the four chart tokens by value, the mark's
 * contrast over every theme and preset, no mark in the accent, the 12px floor, 13px sentences and stylelint's silence.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, screen, waitFor } from "@testing-library/react";
import postcss from "postcss";
import stylelint from "stylelint";
import type * as ApiModule from "../api";
import type * as EventsModule from "../hooks/useEventStream";
import { installPage, motion } from "../ui/testkit";
import { contrastRatio } from "../color";
import { customProperties, cssSizeOffences, proseClasses, proseRules } from "../testing/sizeScan";
import { emit } from "../brain/notes/testnet";
import { answerRead, resetDash } from "./testnet";
import { definition, mountBoard, ok, read, serve, snapshot, tile, w } from "./testkit";

vi.mock("../api", async (importOriginal) =>
  (await import("./testnet")).dashMockApi(await importOriginal<typeof ApiModule>()),
);
vi.mock("../hooks/useEventStream", async (importOriginal) => ({
  ...(await importOriginal<typeof EventsModule>()),
  useOsEvent: (await import("../brain/notes/testnet")).useOsEventMock,
}));
vi.setConfig({ testTimeout: 60_000 });

installPage();
beforeEach(() => {
  resetDash();
});

const FILE = join(__dirname, "dashboards.css");
const CSS_TEXT = readFileSync(FILE, "utf8");
const CSS = postcss.parse(CSS_TEXT);
const THEME_FILE = join(__dirname, "..", "theme.css");
const THEME = postcss.parse(readFileSync(THEME_FILE, "utf8"));

/** The `animation`/`transition` declarations not inside `@media (prefers-reduced-motion: no-preference)`. */
function motionOutsideNoPreference(css: string): string[] {
  const out: string[] = [];
  postcss.parse(css).walkDecls(/^(animation|transition)(-[a-z-]+)?$/, (d) => {
    for (let p: postcss.Container | postcss.Document | undefined = d.parent; p; p = p.parent)
      if (
        p.type === "atrule" &&
        (p as postcss.AtRule).name === "media" &&
        /prefers-reduced-motion:\s*no-preference/.test((p as postcss.AtRule).params)
      )
        return;
    out.push(`${(d.parent as postcss.Rule).selector} { ${d.prop}: ${d.value} }`);
  });
  return out;
}
const inNoPreference = (selector: string) => {
  let v = "";
  CSS.walkAtRules("media", (m) => {
    if (/no-preference/.test(m.params))
      m.walkRules(selector, (r) => r.walkDecls("animation", (d) => void (v = d.value)));
  });
  return v.split(/\s+/);
};
const keyframes = (name: string) => {
  const from: Record<string, string> = {};
  CSS.walkAtRules("keyframes", (k) => {
    if (k.params === name) k.walkRules("from", (r) => r.walkDecls((d) => void (from[d.prop] = d.value)));
  });
  return from;
};

const kpiDef = definition("overview", [w("k", "kpi", { kind: "notes" }, { measure: "count" }, "Notas")]);
const kpiSnap = (value: number) => snapshot("visao-geral", [ok("k", "kpi", { value, series: [] })]);

/** Animation frames under the test's hand: each `step(ms)` runs the pending frames at that time. */
function frames() {
  let now = 0;
  let queue: Array<FrameRequestCallback> = [];
  vi.spyOn(performance, "now").mockImplementation(() => now);
  vi.spyOn(window, "requestAnimationFrame").mockImplementation((cb) => {
    queue.push(cb);
    return queue.length;
  });
  vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => undefined);
  return {
    pending: () => queue.length,
    step(ms: number) {
      now = ms;
      const run = queue;
      queue = [];
      act(() => run.forEach((cb) => cb(ms)));
    },
  };
}

describe("C92 nothing moves for someone who asked for less", () => {
  it("C92 the reader finds an animation outside the no-preference block and leaves one inside", () => {
    expect(motionOutsideNoPreference(".a { transition: opacity 1s }")).toEqual([
      ".a { transition: opacity 1s }",
    ]);
    expect(
      motionOutsideNoPreference("@media (prefers-reduced-motion: no-preference) { .a { animation: x 1s } }"),
    ).toEqual([]);
  });

  it("C92 every animation and transition of dashboards.css is inside the no-preference block, and there are some", () => {
    expect(motionOutsideNoPreference(CSS_TEXT)).toEqual([]);
    expect(CSS_TEXT).toMatch(/animation:/);
  });

  it("C92 the bars grow from the base in 300 ms; a highlight pill fades in in 150 ms", () => {
    expect(inNoPreference(".dsh-bar")).toEqual(["dsh-grow", "300ms", "ease-out"]);
    expect(keyframes("dsh-grow")).toEqual({ transform: "scaleX(0)" });
    let origin = "";
    CSS.walkRules(".dsh-bar", (r) => r.walkDecls("transform-origin", (d) => void (origin = d.value)));
    expect(origin).toBe("left center");
    expect(inNoPreference(".dsh-pill")).toEqual(["dsh-fade", "150ms", "ease-out"]);
    expect(keyframes("dsh-fade")).toEqual({ opacity: "0" });
  });

  it("C92 with motion allowed the KPI counts from the old value to the new one in 400 ms after dashboard.refreshed", async () => {
    motion.reduced = false;
    serve("visao-geral", read(kpiDef, kpiSnap(0)));
    mountBoard();
    await waitFor(() => expect(tile("k").querySelector(".dsh-kpi-value")?.textContent).toBe("0"));
    const f = frames();
    answerRead("visao-geral", read(kpiDef, kpiSnap(100)));
    act(() => emit("dashboard.refreshed", { id: "visao-geral", generatedAt: Date.now(), status: "ok" }));
    await waitFor(() => expect(f.pending()).toBeGreaterThan(0));
    const value = () => tile("k").querySelector(".dsh-kpi-value")!.textContent;
    f.step(0);
    expect(value()).toBe("0");
    f.step(200);
    expect(value()).toBe("50");
    f.step(300);
    expect(value()).toBe("75");
    f.step(400);
    expect(value()).toBe("100");
    expect(f.pending()).toBe(0);
  });

  it("C92 with motion reduced the new value is there at once, with no frame asked for", async () => {
    motion.reduced = true;
    serve("visao-geral", read(kpiDef, kpiSnap(0)));
    mountBoard();
    await waitFor(() => expect(tile("k").querySelector(".dsh-kpi-value")?.textContent).toBe("0"));
    const f = frames();
    answerRead("visao-geral", read(kpiDef, kpiSnap(100)));
    act(() => emit("dashboard.refreshed", { id: "visao-geral", generatedAt: Date.now(), status: "ok" }));
    await waitFor(() => expect(tile("k").querySelector(".dsh-kpi-value")!.textContent).toBe("100"));
    expect(f.pending()).toBe(0);
  });

  it("C92 every state reads the same texts and draws the same icons with motion reduced and allowed", async () => {
    const page = async (reduced: boolean) => {
      motion.reduced = reduced;
      resetDash();
      const def = definition("overview", [
        w("k", "kpi", { kind: "notes" }, { measure: "count" }, "Notas"),
        w("b", "bars", { kind: "notes", groupBy: "status" }, undefined, "Por status"),
        w("e", "list", { kind: "facts" }, undefined, "Fatos"),
        w("v", "list", { kind: "decisions", window: "week" }, undefined, "Decisões"),
      ]);
      serve(
        "visao-geral",
        read(
          def,
          snapshot("visao-geral", [
            ok("k", "kpi", {
              value: 3,
              delta: 1,
              deltaPct: 50,
              direction: "up",
              good: true,
              series: [
                { at: 1, value: 2 },
                { at: 2, value: 3 },
              ],
            }),
            ok("b", "bars", { categories: [{ label: "draft", count: 2 }] }),
            { id: "e", kind: "list", status: "error", error: "boom" },
            { id: "v", kind: "list", status: "empty", data: { items: [], total: 0 } },
          ]),
          { highlights: [{ rule: "overdue", title: "Ligar", tone: "danger", target: "/brain?sel=1" }] },
        ),
      );
      const view = mountBoard();
      await screen.findByText("Ligar");
      const root = document.querySelector(".dsh-body")!;
      const out = { text: root.textContent, icons: root.querySelectorAll("svg").length };
      view.unmount();
      return out;
    };
    const allowed = await page(false);
    const reduced = await page(true);
    expect(reduced).toEqual(allowed);
    expect(reduced.icons).toBeGreaterThan(4);
  });
});

describe("C93 the chart tokens and the stylesheet", () => {
  /** The declarations of one exact selector of theme.css. */
  const block = (selector: string) => {
    const out: Record<string, string> = {};
    THEME.walkRules((r) => {
      if (r.selector === selector) r.walkDecls((d) => void (out[d.prop] = d.value));
    });
    return out;
  };

  it("C93 theme.css: --chart-mark #ea580c dark and #c2410c light, the soft one at 10%, muted the faint text, grid the border", () => {
    const dark = block(":root");
    expect(dark["--chart-mark"]).toBe("#ea580c");
    expect(dark["--chart-mark-soft"]).toBe("color-mix(in srgb, var(--chart-mark) 10%, transparent)");
    expect(dark["--chart-muted"]).toBe("var(--text-faint)");
    expect(dark["--chart-grid"]).toBe("var(--border)");
    expect(block('[data-theme="light"]')["--chart-mark"]).toBe("#c2410c");
  });

  it("C93 --chart-mark is at least 3:1 over --bg-raise in each of the ten theme and preset pairs, and no preset changes it", () => {
    const presets = ["jarvis", "forest", "ocean", "mono"];
    const pairs: Array<[string, string, string]> = [
      ["dark hud-orange", block(":root")["--bg-raise"]!, "#ea580c"],
      ["light hud-orange", block('[data-theme="light"]')["--bg-raise"]!, "#c2410c"],
      ...presets.map((p): [string, string, string] => [
        `dark ${p}`,
        block(`[data-preset="${p}"]`)["--bg-raise"]!,
        "#ea580c",
      ]),
      ...presets.map((p): [string, string, string] => [
        `light ${p}`,
        block(`[data-theme="light"][data-preset="${p}"]`)["--bg-raise"]!,
        "#c2410c",
      ]),
    ];
    expect(pairs).toHaveLength(10);
    for (const [name, surface, mark] of pairs) {
      expect(surface, name).toMatch(/^#[0-9a-f]{6}$/i);
      expect(contrastRatio(mark, surface), name).toBeGreaterThanOrEqual(3);
    }
    const presetBlocks: string[] = [];
    THEME.walkRules((r) => {
      if (
        r.selector.includes("data-preset") &&
        r.some((d) => d.type === "decl" && d.prop.startsWith("--chart-"))
      )
        presetBlocks.push(r.selector);
    });
    expect(presetBlocks).toEqual([]);
  });

  it("C93 no chart mark is painted with --accent", () => {
    const marks: string[] = [];
    CSS.walkDecls(/^(fill|stroke|border-left-color)$/, (d) => {
      if (d.value.includes("--accent")) marks.push(`${(d.parent as postcss.Rule).selector} ${d.prop}`);
    });
    expect(marks).toEqual([]);
    const painted: string[] = [];
    CSS.walkDecls(/^(fill|stroke)$/, (d) => void painted.push(d.value));
    expect(painted).toContain("var(--chart-mark)");
  });

  it("C93 no text under 12px, sentences at 13px, and the repository's stylelint config says nothing (and does refuse a hex)", async () => {
    expect(cssSizeOffences([{ file: FILE, css: CSS_TEXT }], [THEME])).toEqual([]);
    const classes = new Set<string>();
    for (const f of [
      "widgets.tsx",
      "DashboardBoard.tsx",
      "DashboardDialogs.tsx",
      "DashboardsPage.tsx",
      "DashboardsScene.tsx",
      "charts.tsx",
    ])
      for (const c of proseClasses(f, readFileSync(join(__dirname, f), "utf8"))) classes.add(c);
    expect(classes.has("dsh-empty")).toBe(true);
    expect(proseRules([{ file: FILE, css: CSS_TEXT }], classes, customProperties([THEME]))).toEqual([]);
    const config = join(__dirname, "..", "..", "..", "..", "stylelint.config.mjs");
    const lint = async (code: string) => {
      const { results } = await stylelint.lint({ code, codeFilename: FILE, configFile: config });
      return results.flatMap((r) => r.warnings.map((x) => `${x.rule}: ${x.text}`));
    };
    expect(await lint(CSS_TEXT)).toEqual([]);
    expect((await lint(".dsh-x { color: #fff; }\n")).join("\n")).toContain("color-no-hex");
  });
});
