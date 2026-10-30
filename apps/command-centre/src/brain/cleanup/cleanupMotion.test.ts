// @vitest-environment jsdom
/**
 * The guided cleanup's motion and stylesheet (.specs/features/cerebro-faxina-guiada, C72 and the unit half of C80;
 * design.md "Movimento"): every animation and transition inside `@media (prefers-reduced-motion: no-preference)`, the
 * bars, the step change and the answered card as the design times them, the same text and icons in every step and
 * state with motion reduced and allowed, and the repository's stylelint config (tokens only) with nothing to say.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createElement as h, type ReactElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup as unmountAll, waitFor } from "@testing-library/react";
import postcss from "postcss";
import stylelint from "stylelint";
import type * as ApiModule from "../../api";
import { installPage, motion } from "../../ui/testkit";
import { renderWith } from "../../contexts/testkit";
import { resetNet } from "../notes/testnet";
import { Band, InventoryCards, ScanProgress } from "./CleanupInventory";
import { FindingCard } from "./CleanupFindings";
import { DoneStep, ReviewStep } from "./CleanupReview";
import { StepBar } from "./CleanupWizard";
import type { Finding, FindingKind } from "./cleanupData";
import { MEM, WORK, atStep, context, finding, inventory, openWizard, resetCleanup } from "./testkit";

vi.mock("../../api", async (importOriginal) =>
  (await import("../notes/testnet")).mockApi(await importOriginal<typeof ApiModule>()),
);
vi.mock("../../hooks/useEventStream", async () => ({
  useOsEvent: (await import("../notes/testnet")).useOsEventMock,
}));
vi.setConfig({ testTimeout: 60_000 });

installPage();
beforeEach(() => {
  resetNet();
  resetCleanup();
});

const FILE = join(__dirname, "cleanup.css");
const CSS = readFileSync(FILE, "utf8");

/** The `animation`/`transition` declarations not inside `@media (prefers-reduced-motion: no-preference)` (ui.source C15's reader, with transitions). */
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

/** The declarations of `selector` inside the no-preference block, and the `from` of a keyframes rule. */
function inMotion(selector: string): Record<string, string> {
  const out: Record<string, string> = {};
  postcss.parse(CSS).walkAtRules("media", (m) => {
    if (!/no-preference/.test(m.params)) return;
    m.walkRules((r) => {
      if (r.selector === selector) r.walkDecls((d) => void (out[d.prop] = d.value));
    });
  });
  return out;
}
function keyframesFrom(name: string): Record<string, string> {
  const out: Record<string, string> = {};
  postcss.parse(CSS).walkAtRules("keyframes", (k) => {
    if (k.params !== name) return;
    k.walkRules("from", (r) => r.walkDecls((d) => void (out[d.prop] = d.value)));
  });
  return out;
}

describe("C72 nothing moves for someone who asked for less, and what moves is timed as the design says", () => {
  it("C72 the reader finds an animation or a transition outside the no-preference block, and leaves the ones inside", () => {
    expect(motionOutsideNoPreference(".a { animation: x 1s }")).toHaveLength(1);
    expect(motionOutsideNoPreference(".a { transition: opacity 1s }")).toHaveLength(1);
    expect(motionOutsideNoPreference(".a { animation-delay: 1s }")).toHaveLength(1);
    expect(
      motionOutsideNoPreference("@media (prefers-reduced-motion: reduce) { .a { animation: x 1s } }"),
    ).toHaveLength(1);
    expect(motionOutsideNoPreference("@media (min-width: 1px) { .a { transition: x 1s } }")).toHaveLength(1);
    expect(
      motionOutsideNoPreference(
        "@media (prefers-reduced-motion: no-preference) { .a { animation: x 1s; transition: y 1s } }",
      ),
    ).toEqual([]);
  });

  it("C72 every animation and transition of the wizard's stylesheet is inside @media (prefers-reduced-motion: no-preference), and there are some", () => {
    expect(motionOutsideNoPreference(CSS)).toEqual([]);
    expect((CSS.match(/animation:/g) ?? []).length).toBeGreaterThanOrEqual(4);
  });

  it("C72 the bars grow by scaleX and the columns by scaleY, in 240 ms ease-out, 40 ms apart", () => {
    for (const [selector, axis] of [
      [".cln-fill", "scaleX"],
      [".cln-col-fill", "scaleY"],
    ] as const) {
      const d = inMotion(selector);
      const [name, ...rest] = d.animation!.split(/\s+/);
      expect(rest).toEqual(["240ms", "ease-out", "both"]);
      expect(d["animation-delay"]).toBe("calc(var(--i, 0) * 40ms)");
      expect(keyframesFrom(name!)).toEqual({ transform: `${axis}(0)` });
    }
    // Each bar carries its place in the row, so the delay steps by 40 ms.
    motion.reduced = true;
    renderWith(h(InventoryCards, { data: inventory() }), { lang: "pt-BR" });
    const kinds = [...document.querySelectorAll<HTMLElement>(".cln-bars .cln-fill")].map((el) =>
      el.style.getPropertyValue("--i"),
    );
    expect(kinds).toEqual(["0", "1", "2", "3", "4", "5"]);
    const cols = [...document.querySelectorAll<HTMLElement>(".cln-col-fill")].map((el) =>
      el.style.getPropertyValue("--i"),
    );
    expect(cols).toEqual(["0", "1", "2", "3"]);
  });

  it("C72 a step enters by 12 px and opacity in 200 ms (back by -12 px), and an answered card folds in 200 ms", () => {
    const stage = inMotion(".cln-stage");
    const [enter, ...rest] = stage.animation!.split(/\s+/);
    expect(rest).toEqual(["200ms", "ease-out", "both"]);
    expect(keyframesFrom(enter!)).toEqual({ opacity: "0", transform: "translateX(12px)" });
    expect(keyframesFrom(inMotion(".cln-stage[data-back]")["animation-name"]!)).toEqual({
      opacity: "0",
      transform: "translateX(-12px)",
    });
    const fold = inMotion(".cln-finding[data-answered]");
    expect(fold.animation!.split(/\s+/).slice(1)).toEqual(["200ms", "ease-out", "both"]);
  });

  /** What a piece of the wizard says and how many icons it draws, once anything that moves has settled. */
  async function read(ui: () => ReactElement, reduced: boolean): Promise<{ text: string; icons: number }> {
    motion.reduced = reduced;
    vi.useFakeTimers({ toFake: ["requestAnimationFrame", "cancelAnimationFrame", "performance"] });
    renderWith(ui(), { lang: "pt-BR" });
    act(() => void vi.advanceTimersByTime(400));
    const root = document.getElementById("root")!;
    const out = { text: root.textContent ?? "", icons: root.querySelectorAll("svg").length };
    unmountAll();
    vi.useRealTimers();
    return out;
  }
  const KINDS: FindingKind[] = [
    "duplicate",
    "near-duplicate",
    "stale",
    "orphan",
    "broken-link",
    "empty-folder",
    "large-file",
    "untitled",
  ];
  const card = (f: Finding, answered: boolean) => () =>
    h(
      "ul",
      null,
      h(FindingCard, {
        finding: f,
        answer: answered ? { decision: "archive" } : undefined,
        busy: false,
        failed: !answered,
        onAnswer: () => undefined,
        onRetry: () => undefined,
      }),
    );
  const pieces: Array<[string, () => ReactElement]> = [
    ...[1, 2, 3, 4, 5].map(
      (n) => [`the step bar at ${n}`, () => h(StepBar, { step: n })] as [string, () => ReactElement],
    ),
    ["the inventory cards", () => h(InventoryCards, { data: inventory() })],
    ["the inventory loading", () => h(InventoryCards, { data: undefined })],
    [
      "a scan running",
      () => h(ScanProgress, { phase: "links", done: 120, total: 3000, onCancel: () => undefined }),
    ],
    ["a failure", () => h(Band, { text: "A faxina falhou. x", onRetry: () => undefined })],
    ...KINDS.flatMap((k) => {
      const f = finding(k, k === "empty-folder" ? [] : [`${MEM}/notes/a.md`, `${MEM}/notes/b.md`], {
        detail: { folder: `${WORK}/v` },
      });
      return [
        [`a ${k} card`, card(f, false)],
        [`a ${k} card answered`, card(f, true)],
      ] as Array<[string, () => ReactElement]>;
    }),
    [
      "the review",
      () =>
        h(ReviewStep, {
          plan: [
            { from: `${MEM}/notes/a.md`, to: "memory/archive/x/notes/a.md", decision: "archive" },
            { from: `${WORK}/b.md`, to: null, decision: "merge" },
          ],
        }),
    ],
    ["the review with nothing", () => h(ReviewStep, { plan: [] })],
    [
      "the done step, undone",
      () =>
        h(DoneStep, {
          result: {
            manifest: "/m.json",
            moved: [{ from: "/a", to: "/b" }],
            skipped: [{ path: "/c", reason: "exists" }],
            proposals: "/p.md",
          },
          proposals: 1,
          undone: { restored: [{ from: "/a", to: "/b" }], skipped: [{ path: "/d", reason: "changed" }] },
          onOpen: () => undefined,
        }),
    ],
  ];
  for (const [label, ui] of pieces)
    it(`C72 ${label} reads the same text and draws the same icons with motion reduced and allowed`, async () => {
      const reduced = await read(ui, true);
      const allowed = await read(ui, false);
      expect(allowed).toEqual(reduced);
      expect(reduced.text.length).toBeGreaterThan(0);
    });

  it("C72 the wizard at O que tem aqui reads the same with motion reduced and allowed", async () => {
    const at = async (reduced: boolean) => {
      motion.reduced = reduced;
      vi.useFakeTimers({ toFake: ["requestAnimationFrame", "cancelAnimationFrame", "performance"] });
      resetNet();
      resetCleanup();
      context("alfa", "Alfa");
      const { dialog, unmount } = await openWizard({ context: "alfa", step: 2 });
      await atStep("Etapa 2 de 5 · O que tem aqui");
      await waitFor(() => expect(dialog.querySelector(".cln-grid:not([aria-busy])")).not.toBeNull());
      // The frames jsdom never paints: the numbers' 300 ms, played at once.
      act(() => void vi.advanceTimersByTime(400));
      const out = { text: dialog.textContent, icons: dialog.querySelectorAll("svg").length };
      unmount();
      return out;
    };
    expect(await at(false)).toEqual(await at(true));
  });

  it("C72 the wizard at Escopo reads the same with motion reduced and allowed", async () => {
    const at = async (reduced: boolean) => {
      motion.reduced = reduced;
      resetNet();
      resetCleanup();
      context("alfa", "Alfa");
      const { dialog, unmount } = await openWizard({});
      await atStep("Etapa 1 de 5 · Escopo");
      await waitFor(() => expect(dialog.querySelectorAll('input[type="radio"]')).toHaveLength(1));
      const out = { text: dialog.textContent, icons: dialog.querySelectorAll("svg").length };
      unmount();
      return out;
    };
    expect(await at(false)).toEqual(await at(true));
  });
});

describe("C80 the wizard's stylesheet and the tokens", () => {
  const config = join(__dirname, "..", "..", "..", "..", "..", "stylelint.config.mjs");
  const warnings = async (code: string, codeFilename: string) => {
    const { results } = await stylelint.lint({ code, codeFilename, configFile: config });
    return results.flatMap((r) => r.warnings.map((w) => `${w.rule}: ${w.text}`));
  };

  it("C80 the repository's stylelint config reports no warning on cleanup.css, and does report a colour literal", async () => {
    expect(await warnings(CSS, FILE)).toEqual([]);
    expect((await warnings(".cln-x { color: #fff; }\n", FILE)).join("\n")).toContain("color-no-hex");
  });
});
