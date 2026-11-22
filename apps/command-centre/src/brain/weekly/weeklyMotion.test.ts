// @vitest-environment jsdom
/**
 * The motion of "Revisão semanal" (.specs/features/cerebro-rituais, C92; design.md "Movimento"): every animation and
 * transition of the page's stylesheet inside `@media (prefers-reduced-motion: no-preference)` (ui.source C15's reader,
 * with transitions), the leaving item folding by height and opacity in 150 ms, the step change sliding 12px with
 * opacity in 200 ms, the "Pronto" numbers rising in 300 ms; with motion reduced the item leaves at once and the numbers
 * show their value at once, and every state reads the same text and draws the same icons either way.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, waitFor } from "@testing-library/react";
import postcss from "postcss";
import stylelint from "stylelint";
import type * as ApiModule from "../../api";
import { installPage, motion } from "../../ui/testkit";
import { resetNet } from "../notes/testnet";
import {
  answer,
  button,
  itemWith,
  loop,
  mountWeekly,
  on,
  only,
  project,
  resetWeekly,
  weekly,
} from "./testkit";

vi.mock("../../api", async (importOriginal) =>
  (await import("../notes/testnet")).mockApi(await importOriginal<typeof ApiModule>()),
);
vi.setConfig({ testTimeout: 60_000 });

installPage();
beforeEach(() => {
  resetNet();
  resetWeekly();
});

const FILE = join(__dirname, "weekly.css");
const CSS = readFileSync(FILE, "utf8");
/** The mention fold's stylesheet (design.md "Painel da nota - dobra Menções sem link"), the one its component imports. */
const FOLD_FILE = join(__dirname, "..", "notes", "mentions.css");
const FOLD_CSS = readFileSync(FOLD_FILE, "utf8");

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
function keyframes(name: string, at: "from" | "to"): Record<string, string> {
  const out: Record<string, string> = {};
  postcss.parse(CSS).walkAtRules("keyframes", (k) => {
    if (k.params === name) k.walkRules(at, (r) => r.walkDecls((d) => void (out[d.prop] = d.value)));
  });
  return out;
}

const loopTexts = () => [...document.querySelectorAll(".wk-item .wk-loop")].map((e) => e.textContent);

describe("C92 nothing moves for someone who asked for less, and what moves is timed as the design says", () => {
  it("C92 the reader finds an animation or a transition outside the no-preference block, and leaves the ones inside", () => {
    expect(motionOutsideNoPreference(".a { animation: x 1s }")).toHaveLength(1);
    expect(motionOutsideNoPreference(".a { transition: opacity 1s }")).toHaveLength(1);
    expect(
      motionOutsideNoPreference("@media (prefers-reduced-motion: reduce) { .a { animation: x 1s } }"),
    ).toHaveLength(1);
    expect(
      motionOutsideNoPreference("@media (prefers-reduced-motion: no-preference) { .a { animation: x 1s } }"),
    ).toEqual([]);
  });

  it("C92 every animation and transition of weekly.css is inside the no-preference block, and there are some", () => {
    expect(motionOutsideNoPreference(CSS)).toEqual([]);
    expect((CSS.match(/animation:/g) ?? []).length).toBeGreaterThanOrEqual(2);
  });

  it("C92 every animation and transition of the fold's stylesheet, mentions.css, the one MentionsFold imports, is inside the no-preference block", () => {
    const fold = readFileSync(join(__dirname, "..", "notes", "MentionsFold.tsx"), "utf8");
    expect([...fold.matchAll(/^import "(.+\.css)";$/gm)].map((m) => m[1])).toEqual(["./mentions.css"]);
    expect(motionOutsideNoPreference(FOLD_CSS)).toEqual([]);
  });

  it("C92 an item that leaves folds by height and opacity in 150 ms; a step slides 12px with opacity in 200 ms (back by -12px)", () => {
    const fold = inMotion(".wk-item[data-leaving]").animation!.split(/\s+/);
    expect(fold.slice(1)).toEqual(["150ms", "ease-out", "forwards"]);
    expect(keyframes(fold[0]!, "to")).toEqual({ "max-height": "0", opacity: "0" });
    const stage = inMotion(".wk-stage").animation!.split(/\s+/);
    expect(stage.slice(1)).toEqual(["200ms", "ease-out", "both"]);
    expect(keyframes(stage[0]!, "from")).toEqual({ opacity: "0", transform: "translateX(12px)" });
    expect(keyframes(inMotion(".wk-stage[data-back]")["animation-name"]!, "from")).toEqual({
      opacity: "0",
      transform: "translateX(-12px)",
    });
  });

  for (const reduced of [true, false])
    it(`C92 with motion ${reduced ? "reduced the item leaves at once" : "allowed the item folds and leaves after 150 ms"}`, async () => {
      motion.reduced = reduced;
      const a = loop("Ligar para a Ana");
      answer(weekly({ loopItems: [a, loop("Pagar o boleto")] }));
      on("loops", only({ key: a.key, action: "close" }, { key: a.key, state: "closed", previous: null }));
      mountWeekly();
      await waitFor(() => expect(loopTexts()).toHaveLength(2));
      vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
      fireEvent.click(button(itemWith("Ligar para a Ana"), "Fechar"));
      await act(async () => {
        for (let i = 0; i < 20; i++) await Promise.resolve();
      });
      if (reduced) {
        expect(loopTexts()).toEqual(["Pagar o boleto"]);
        return;
      }
      expect(loopTexts()).toEqual(["Ligar para a Ana", "Pagar o boleto"]);
      expect(document.querySelector(".wk-item[data-leaving] .wk-loop")?.textContent).toBe("Ligar para a Ana");
      act(() => void vi.advanceTimersByTime(149));
      expect(loopTexts()).toHaveLength(2);
      act(() => void vi.advanceTimersByTime(1));
      expect(loopTexts()).toEqual(["Pagar o boleto"]);
    });

  for (const reduced of [true, false])
    it(`C92 with motion ${reduced ? "reduced the Pronto numbers show their value at once" : "allowed the Pronto numbers rise to their value in 300 ms"}`, async () => {
      motion.reduced = reduced;
      answer(weekly({ counts: { loops: 40, projects: 2, archived: 1 } }));
      vi.useFakeTimers({ toFake: ["requestAnimationFrame", "cancelAnimationFrame", "performance"] });
      mountWeekly();
      await waitFor(() => expect(document.querySelector(".wk-empty")).not.toBeNull());
      fireEvent.click([...document.querySelectorAll<HTMLButtonElement>(".wk-steps button")][4]!);
      const first = () => document.querySelector(".wk-num")!.textContent;
      if (reduced) {
        await waitFor(() => expect(first()).toBe("40"));
        return;
      }
      act(() => void vi.advanceTimersByTime(150));
      const mid = Number(first());
      expect(mid).toBeGreaterThan(0);
      expect(mid).toBeLessThan(40);
      act(() => void vi.advanceTimersByTime(160));
      expect(first()).toBe("40");
    });

  /** What the page says and how many icons it draws on a step, once anything that moves has settled. */
  async function read(reduced: boolean, step: number, list: Record<string, unknown>) {
    motion.reduced = reduced;
    resetNet();
    resetWeekly();
    answer(weekly(list));
    vi.useFakeTimers({ toFake: ["requestAnimationFrame", "cancelAnimationFrame", "performance"] });
    const r = mountWeekly();
    await waitFor(() => expect(document.querySelector(".wk-stage .wk-state")).toBeNull());
    await waitFor(() => expect(document.querySelector(".wk-week")).not.toBeNull());
    fireEvent.click([...document.querySelectorAll<HTMLButtonElement>(".wk-steps button")][step - 1]!);
    act(() => void vi.advanceTimersByTime(400));
    const root = document.querySelector(".wk")!;
    const out = { text: root.textContent, icons: root.querySelectorAll("svg").length };
    r.unmount();
    vi.useRealTimers();
    return out;
  }
  const full = {
    loopItems: [loop("Ligar para a Ana")],
    inboxItems: [{ path: "/home/me/.mordomo/memory/inbox/i.md", title: "Ideia", ageDays: 4 }],
    projectItems: [
      project("App", { nextAction: null, reviewDue: true }),
      project("Fora", { editable: false }),
    ],
    someday: { loops: [loop("Piano")], projects: [project("Velho", { status: "paused" })] },
    archiveItems: [
      { path: "/home/me/.mordomo/memory/notes/x.md", title: "X", editable: true, doneSince: "2026-11-03" },
    ],
    reviewsDue: 2,
    counts: { loops: 3, projects: 1, archived: 2 },
  };
  for (const step of [1, 2, 3, 4, 5])
    for (const [name, list] of [
      ["with lists", full],
      ["empty", {}],
      ["finished", { finishedAt: Date.UTC(2026, 10, 12, 15), nextReminder: Date.UTC(2026, 10, 20, 19) }],
    ] as const)
      it(`C92 step ${step} ${name} reads the same text and draws the same icons with motion reduced and allowed`, async () => {
        const allowed = await read(false, step, list as Record<string, unknown>);
        const reduced = await read(true, step, list as Record<string, unknown>);
        expect(allowed).toEqual(reduced);
        // "Pronto" of an open week with nothing missing has no icon; every other state has some.
        if (!(step === 5 && name === "empty")) expect(reduced.icons).toBeGreaterThan(0);
      });
});

describe("C98 the new stylesheets and the repository's stylelint config", () => {
  const config = join(__dirname, "..", "..", "..", "..", "..", "stylelint.config.mjs");
  const warnings = async (code: string, codeFilename: string) => {
    const { results } = await stylelint.lint({ code, codeFilename, configFile: config });
    return results.flatMap((r) => r.warnings.map((w) => `${w.rule}: ${w.text}`));
  };

  it("C98 stylelint (tokens only) reports no warning on weekly.css and mentions.css, and does report a colour literal", async () => {
    expect(await warnings(CSS, FILE)).toEqual([]);
    expect(await warnings(FOLD_CSS, FOLD_FILE)).toEqual([]);
    expect((await warnings(".wk-x { color: #fff; }\n", FILE)).join("\n")).toContain("color-no-hex");
    expect((await warnings(".mf-x { color: #fff; }\n", FOLD_FILE)).join("\n")).toContain("color-no-hex");
  });
});
