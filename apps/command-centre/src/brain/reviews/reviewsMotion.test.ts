// @vitest-environment jsdom
/**
 * The motion and the stylesheet of "Revisões" (.specs/features/cerebro-natureza, C89 and the unit half of C90;
 * design.md "Depois de decidir"): every animation and transition inside `@media (prefers-reduced-motion:
 * no-preference)`, the item that leaves folding by height and opacity in 150 ms, the same text and icons with motion
 * reduced and allowed, the item leaving at once when reduced, and the repository's stylelint config with nothing to say.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createElement as h } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, waitFor } from "@testing-library/react";
import postcss from "postcss";
import stylelint from "stylelint";
import type * as ApiModule from "../../api";
import { installPage, motion } from "../../ui/testkit";
import { renderWith } from "../../contexts/testkit";
import { resetNet } from "../notes/testnet";
import { BecameFactDialog } from "./BecameFactDialog";
import { WORK, decided, item, list, mountReviews, names, resetReviews, reviews } from "./testkit";

vi.mock("../../api", async (importOriginal) =>
  (await import("../notes/testnet")).mockApi(await importOriginal<typeof ApiModule>()),
);
vi.setConfig({ testTimeout: 60_000 });

installPage();
beforeEach(() => {
  resetNet();
  resetReviews();
});

const FILE = join(__dirname, "reviews.css");
const CSS = readFileSync(FILE, "utf8");
const BADGES = join(__dirname, "..", "natureza.css");

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

describe("C89 nothing moves for someone who asked for less", () => {
  it("C89 the reader finds an animation or a transition outside the no-preference block, and leaves the ones inside", () => {
    expect(motionOutsideNoPreference(".a { transition: opacity 1s }")).toEqual([
      ".a { transition: opacity 1s }",
    ]);
    expect(
      motionOutsideNoPreference("@media (prefers-reduced-motion: no-preference) { .a { animation: x 1s } }"),
    ).toEqual([]);
  });

  it("C89 every animation and transition of reviews.css and natureza.css is inside the no-preference block, and there is one", () => {
    expect(motionOutsideNoPreference(CSS)).toEqual([]);
    expect(motionOutsideNoPreference(readFileSync(BADGES, "utf8"))).toEqual([]);
    expect(CSS).toMatch(/animation:/);
  });

  it("C89 an item that leaves folds by height and opacity in 150 ms", () => {
    let animation = "";
    const to: Record<string, string> = {};
    postcss.parse(CSS).walkAtRules("media", (m) => {
      if (/no-preference/.test(m.params))
        m.walkRules(".rv-item[data-leaving]", (r) =>
          r.walkDecls("animation", (d) => void (animation = d.value)),
        );
    });
    postcss.parse(CSS).walkAtRules("keyframes", (k) => {
      if (k.params === "rv-fold") k.walkRules("to", (r) => r.walkDecls((d) => void (to[d.prop] = d.value)));
    });
    expect(animation.split(/\s+/)).toEqual(["rv-fold", "150ms", "ease-out", "forwards"]);
    expect(to).toEqual({ "max-height": "0", opacity: "0" });
  });

  async function screenRead(reduced: boolean) {
    motion.reduced = reduced;
    resetNet();
    resetReviews();
    list({}, [
      item("notes/a.md", { natureza: "plano", escopo: "equipe" }),
      item("fora.md", { root: WORK, natureza: "opiniao" }),
    ]);
    const r = mountReviews();
    await waitFor(() => expect(document.querySelector(".rv-acts")).not.toBeNull());
    const root = document.querySelector(".rv")!;
    const out = { text: root.textContent, icons: root.querySelectorAll("svg").length };
    r.unmount();
    return out;
  }

  it("C89 the screen with a list reads the same text and draws the same icons with motion reduced and allowed", async () => {
    const allowed = await screenRead(false);
    const reduced = await screenRead(true);
    expect(allowed).toEqual(reduced);
    expect(reduced.icons).toBeGreaterThan(4);
  });

  it("C89 the empty screen and the dialog read the same with motion reduced and allowed", async () => {
    const read = async (reduced: boolean) => {
      motion.reduced = reduced;
      resetNet();
      resetReviews();
      list({}, []);
      const r = mountReviews();
      await waitFor(() => expect(document.querySelector(".rv-empty")).not.toBeNull());
      const empty = document.querySelector(".rv")!.textContent;
      r.unmount();
      const d = renderWith(
        h(BecameFactDialog, { onCancel: () => undefined, onConfirm: () => Promise.resolve() }),
        {
          lang: "pt-BR",
        },
      );
      const dialog = document.querySelector('[role="dialog"]')!;
      const out = { empty, dialog: dialog.textContent, icons: dialog.querySelectorAll("svg").length };
      d.unmount();
      return out;
    };
    expect(await read(false)).toEqual(await read(true));
  });

  for (const reduced of [true, false])
    it(`C89 with motion ${reduced ? "reduced the item leaves at once" : "allowed the item folds and leaves after 150 ms"}`, async () => {
      motion.reduced = reduced;
      list({}, [item("notes/a.md", { natureza: "opiniao" }), item("notes/b.md")]);
      reviews.decide = (b) =>
        Promise.resolve(decided((b as { path: string }).path, { version: "sha256:v2" }));
      mountReviews();
      await waitFor(() => expect(document.querySelector(".rv-acts")).not.toBeNull());
      vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
      fireEvent.click([...document.querySelectorAll<HTMLButtonElement>(".rv-acts button")][0]!);
      await act(async () => {
        for (let i = 0; i < 20; i++) await Promise.resolve();
      });
      if (reduced) {
        expect(names()).toEqual(["b.md"]);
        return;
      }
      expect(names()).toEqual(["a.md", "b.md"]);
      expect(document.querySelector(".rv-item[data-leaving] .rv-name")?.textContent).toBe("a.md");
      act(() => void vi.advanceTimersByTime(149));
      expect(names()).toEqual(["a.md", "b.md"]);
      act(() => void vi.advanceTimersByTime(1));
      expect(names()).toEqual(["b.md"]);
    });
});

describe("C90 the stylesheet and the tokens", () => {
  const config = join(__dirname, "..", "..", "..", "..", "..", "stylelint.config.mjs");
  const warnings = async (code: string, codeFilename: string) => {
    const { results } = await stylelint.lint({ code, codeFilename, configFile: config });
    return results.flatMap((r) => r.warnings.map((w) => `${w.rule}: ${w.text}`));
  };

  it("C90 the repository's stylelint config reports no warning on reviews.css and natureza.css, and does report a colour literal", async () => {
    expect(await warnings(CSS, FILE)).toEqual([]);
    expect(await warnings(readFileSync(BADGES, "utf8"), BADGES)).toEqual([]);
    expect((await warnings(".rv-x { color: #fff; }\n", FILE)).join("\n")).toContain("color-no-hex");
  });
});
