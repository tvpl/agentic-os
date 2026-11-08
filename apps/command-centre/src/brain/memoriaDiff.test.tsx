// @vitest-environment jsdom
/**
 * The diff of the trustworthy-memory screens and the tones of its marks (.specs/features/cerebro-memoria-confiavel,
 * C166, C167; design.md "Binding sources", "Rótulos de autor, origem e confiança"): the two line-number columns of every
 * row by value, in order, and the tone each mark draws through a token, with an icon and a text or a sign so that the
 * colour never carries the meaning alone.
 *
 * What design.md draws, and the tokens the repository has for it: it names `--tone-ok`, `--tone-warn`, `--tone-info` and
 * `--tone-danger`, which are not custom properties here; the tones are `--ok`, `--warn`, `--info` and `--danger`, their
 * soft grounds `--ok-bg` and `--danger-bg` (a translucent fill), and `.badge.ok` and the run diff already read them so.
 * The badge is the text and the icon in the tone; a row added has the ground `--ok-bg` and a removed one `--danger-bg`,
 * with `+` and `-` in the tone; a context row has no ground and the dim text colour.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createElement as h } from "react";
import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import postcss from "postcss";
import { I18nContext } from "../i18n";
import { edgesOf, loadTree } from "../testing/sourceGraph";
import { DiffLines } from "./memoriaDiff";
import { TrustBadge, type Trust } from "./memoria";

const SRC = join(__dirname, "..");
const sheet = (file: string) => postcss.parse(readFileSync(join(SRC, file), "utf8"));
/** The declarations of the root rules whose selector list holds `selector`. */
function rule(file: string, selector: string): Record<string, string> {
  const out: Record<string, string> = {};
  sheet(file).walkRules((r) => {
    if (r.parent?.type !== "root" || !r.selectors.includes(selector)) return;
    r.walkDecls((d) => void (out[d.prop] = d.value));
  });
  return out;
}
const wrap = (el: ReturnType<typeof h>) =>
  render(h(I18nContext.Provider, { value: { lang: "pt-BR", setLang: () => undefined } }, el));

/** Two hunks: old lines 3-6 become new 3-7, and old 20-21 become new 21. */
const DIFF = [
  "--- a/MEMORY.md",
  "+++ b/MEMORY.md",
  "@@ -3,4 +3,5 @@",
  " a",
  "-b",
  "-c",
  "+B",
  "+C",
  "+D",
  " e",
  "@@ -20,2 +21,1 @@",
  " x",
  "-y",
  "",
].join("\n");

/** Every row as `[class, old, new, sign, text]`, from the cells. */
const rows = (root: ParentNode) =>
  [...root.querySelectorAll("tbody tr")].map((tr) => [
    tr.className,
    ...[...tr.children].map((c) => c.textContent),
  ]);

describe("C166 the diff's two line-number columns", () => {
  it("C166 each row holds, left to right, the old number, the new number, the sign and the text, the numbers by value over two hunks", () => {
    const { container } = wrap(h(DiffLines, { diff: DIFF, label: "O que muda no MEMORY.md" }));
    expect(rows(container)).toEqual([
      ["mc-hunk", "", "", "", "@@ -3,4 +3,5 @@"],
      ["mc-ctx", "3", "3", "", "a"],
      ["mc-del", "4", "", "-", "b"],
      ["mc-del", "5", "", "-", "c"],
      ["mc-add", "", "4", "+", "B"],
      ["mc-add", "", "5", "+", "C"],
      ["mc-add", "", "6", "+", "D"],
      ["mc-ctx", "6", "7", "", "e"],
      ["mc-hunk", "", "", "", "@@ -20,2 +21,1 @@"],
      ["mc-ctx", "20", "21", "", "x"],
      ["mc-del", "21", "", "-", "y"],
    ]);
    // the file header lines (--- and +++) are not rows
    expect(container.textContent).not.toContain("--- a/MEMORY.md");
    expect(container.querySelectorAll("tbody tr > td")).toHaveLength(11 * 4);
  });

  it("C166 the two number columns are the first two cells, hidden from assistive technology (the sign and the text are what is read), and one added or removed row has only its own side's number", () => {
    const { container } = wrap(h(DiffLines, { diff: DIFF, label: "O que muda no MEMORY.md" }));
    for (const tr of container.querySelectorAll("tbody tr")) {
      const [oldNo, newNo, sign, text] = [...tr.children] as HTMLElement[];
      expect(oldNo!.getAttribute("aria-hidden"), tr.className).toBe("true");
      expect(newNo!.getAttribute("aria-hidden"), tr.className).toBe("true");
      expect(sign!.className).toBe("mc-sign");
      expect(sign!.hasAttribute("aria-hidden")).toBe(false);
      expect(text!.hasAttribute("aria-hidden")).toBe(false);
      if (tr.className === "mc-add")
        expect([oldNo!.textContent, newNo!.textContent !== ""]).toEqual(["", true]);
      if (tr.className === "mc-del")
        expect([oldNo!.textContent !== "", newNo!.textContent]).toEqual([true, ""]);
    }
    const group = container.querySelector(".mc-diff")!;
    expect([
      group.getAttribute("role"),
      group.getAttribute("aria-label"),
      group.getAttribute("tabindex"),
    ]).toEqual(["group", "O que muda no MEMORY.md", "0"]);
  });

  it("C166 the three leading columns are right-aligned, as narrow as their text, in mono 12px and not selectable; the text column takes the rest", () => {
    expect(rule("brain/memoriaDiff.css", ".mc-diff td:nth-child(-n + 3)")).toMatchObject({
      width: "1%",
      "text-align": "right",
      "white-space": "pre",
      "user-select": "none",
    });
    expect(rule("brain/memoriaDiff.css", ".mc-diff table")).toMatchObject({
      "font-family": "var(--font-mono)",
      "font-size": "var(--fs-2)",
    });
    expect(rule("brain/memoriaDiff.css", ".mc-diff td")).toMatchObject({ "white-space": "pre-wrap" });
  });

  it("C166 the version dialog and the agent tab draw their diffs with this one component, not each with a copy", () => {
    const tree = loadTree(SRC);
    const importers = [...tree.keys()]
      .filter((f) => !/\.test\./.test(f) && edgesOf(tree, f).some((e) => e.to === "brain/memoriaDiff.tsx"))
      .sort();
    expect(importers).toEqual(["brain/notes/VersionDialog.tsx", "brain/reviews/AgentTab.tsx"]);
  });
});

/* ---------------- C167: the tones ---------------- */

const THEME = sheet("theme.css");
/** The custom properties a theme block declares (`:root` is the dark theme, `[data-theme="light"]` the light one). */
function tokens(selector: string): Record<string, string> {
  const out: Record<string, string> = {};
  THEME.walkRules((r) => {
    if (r.parent?.type !== "root" || !r.selectors.includes(selector)) return;
    r.walkDecls(/^--/, (d) => void (out[d.prop] = d.value));
  });
  return out;
}
const alpha = (rgba: string) => Number(/^rgba\([^,]+,[^,]+,[^,]+,\s*([\d.]+)\)$/.exec(rgba)?.[1]);

describe("C167 the tones of the trust badges and of the diff rows", () => {
  const BADGES: Array<[Trust, string, string, string, string]> = [
    ["usuario", "tone-ok", "var(--ok)", "lucide-user-check", "Escrito por você"],
    ["ferramenta", "tone-warn", "var(--warn)", "lucide-wrench", "Saída de ferramenta"],
    ["inferido", "tone-info", "var(--info)", "lucide-sparkles", "Inferido pelo agente"],
  ];

  for (const [trust, tone, color, icon, text] of BADGES)
    it(`C167 the ${trust} badge is ${tone}: the text and the icon in ${color}, with its icon and its text`, () => {
      const { container } = wrap(h(TrustBadge, { trust }));
      const badge = container.querySelector(".mc-trust")!;
      expect(badge.className).toBe(`badge meta mc-trust ${tone}`);
      expect(badge.querySelector(`svg.${icon}`), icon).not.toBeNull();
      expect(badge.textContent).toBe(text);
      expect(rule("brain/memoria.css", `.mc-trust.${tone}`)).toEqual({ color });
    });

  it("C167 the three tones are three different tokens", () => {
    const colors = BADGES.map(
      ([trust, tone]) => rule("brain/memoria.css", `.mc-trust.${tone}`).color ?? trust,
    );
    expect(new Set(colors).size).toBe(3);
  });

  it("C167 an added row has the soft --ok-bg ground and its sign and text in --ok, a removed one --danger-bg and --danger, a context row no ground and the dim text, a hunk header --info", () => {
    expect(rule("brain/memoriaDiff.css", ".mc-diff .mc-add")).toEqual({ background: "var(--ok-bg)" });
    expect(rule("brain/memoriaDiff.css", ".mc-diff .mc-del")).toEqual({ background: "var(--danger-bg)" });
    expect(rule("brain/memoriaDiff.css", ".mc-diff .mc-add td:nth-child(n + 3)")).toEqual({
      color: "var(--ok)",
    });
    expect(rule("brain/memoriaDiff.css", ".mc-diff .mc-del td:nth-child(n + 3)")).toEqual({
      color: "var(--danger)",
    });
    expect(rule("brain/memoriaDiff.css", ".mc-diff .mc-hunk td")).toEqual({ color: "var(--info)" });
    // a context row: no rule of its own, so the ground is the box's and the text the cell's dim colour
    expect(rule("brain/memoriaDiff.css", ".mc-diff .mc-ctx")).toEqual({});
    expect(rule("brain/memoriaDiff.css", ".mc-diff td").color).toBe("var(--text-dim)");
    expect(rule("brain/memoriaDiff.css", ".mc-diff").background).toBe("var(--bg)");
  });

  it("C167 the colour is never alone: an added row carries + and a removed one - (the badges carry an icon and their text, above)", () => {
    const { container } = wrap(h(DiffLines, { diff: DIFF, label: "d" }));
    const signs = (kind: string) =>
      [...container.querySelectorAll(`tr.${kind} .mc-sign`)].map((c) => c.textContent);
    expect(signs("mc-add")).toEqual(["+", "+", "+"]);
    expect(signs("mc-del")).toEqual(["-", "-", "-"]);
    expect(signs("mc-ctx")).toEqual(["", "", ""]);
  });

  for (const [theme, selector] of [
    ["dark", ":root"],
    ["light", '[data-theme="light"]'],
  ] as const)
    it(`C167 in the ${theme} theme every token the tones read is defined, and the soft grounds are translucent`, () => {
      const t = tokens(selector);
      for (const name of [
        "--ok",
        "--warn",
        "--info",
        "--danger",
        "--ok-bg",
        "--danger-bg",
        "--text-dim",
        "--bg",
      ])
        expect(t[name], `${theme} ${name}`).toBeTruthy();
      for (const name of ["--ok-bg", "--danger-bg"]) {
        expect(alpha(t[name]!), `${theme} ${name}`).toBeGreaterThan(0);
        expect(alpha(t[name]!), `${theme} ${name}`).toBeLessThanOrEqual(0.12);
      }
      // a tone is not the dim text colour, and the added and removed tones differ
      expect(new Set([t["--ok"], t["--warn"], t["--info"], t["--danger"], t["--text-dim"]]).size).toBe(5);
    });
});
