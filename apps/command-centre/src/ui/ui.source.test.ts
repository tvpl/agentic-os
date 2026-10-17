/**
 * The checks that read the source of the primitives (.specs/features/primitivas,
 * C3, C15, C16, C25, C26 and C27). TypeScript is read as a tree and CSS with
 * postcss, never as lines; every reader has self-tests for each shape it must
 * find and each it must leave alone, so a reader that goes blind fails here
 * before it lets something through.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import postcss from "postcss";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { cssSizeOffences, treeRoots } from "../testing/sizeScan";
import { colourOnlyStates, hardShadow, stateGroups } from "../testing/stateScan";

const SRC = join(__dirname, "..");
const UI = join(SRC, "ui");

const parse = (text: string, name = "sample.tsx") =>
  ts.createSourceFile(name, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
function visit(node: ts.Node, fn: (n: ts.Node) => void) {
  fn(node);
  node.forEachChild((child) => visit(child, fn));
}
function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}
/** Every non-test source file of the app, relative to `src`. */
const sources = () =>
  walk(SRC)
    .filter((f) => /\.tsx?$/.test(f) && !/\.test\.tsx?$|typetest/.test(f))
    .map((f) => relative(SRC, f));
const read = (file: string) => readFileSync(join(SRC, file), "utf8");
const cssIn = (dir: string) => walk(dir).filter((f) => f.endsWith(".css"));

/* ---- C3: the folder, its exports, and who may import Radix ------------------------------ */

/** Every module specifier a file pulls in, by any spelling. */
function moduleSpecifiers(code: string): string[] {
  const out: string[] = [];
  visit(parse(code), (n) => {
    if (
      (ts.isImportDeclaration(n) || ts.isExportDeclaration(n)) &&
      n.moduleSpecifier &&
      ts.isStringLiteralLike(n.moduleSpecifier)
    )
      out.push(n.moduleSpecifier.text);
    if (ts.isCallExpression(n) && n.arguments.length > 0 && ts.isStringLiteralLike(n.arguments[0]!)) {
      const callee = n.expression;
      if (
        callee.kind === ts.SyntaxKind.ImportKeyword ||
        (ts.isIdentifier(callee) && callee.text === "require")
      )
        out.push((n.arguments[0] as ts.StringLiteralLike).text);
    }
    if (ts.isImportTypeNode(n) && ts.isLiteralTypeNode(n.argument) && ts.isStringLiteral(n.argument.literal))
      out.push(n.argument.literal.text);
  });
  return out;
}
/** The value names a module exports (types left out). */
function valueExports(code: string): string[] {
  const out: string[] = [];
  visit(parse(code, "index.ts"), (n) => {
    if (ts.isExportDeclaration(n) && !n.isTypeOnly && n.exportClause && ts.isNamedExports(n.exportClause))
      for (const e of n.exportClause.elements) if (!e.isTypeOnly) out.push(e.name.text);
  });
  return out.sort();
}

describe("C3 the primitives live in src/ui, and only there is Radix imported", () => {
  it("C3 the reader finds a module in every spelling", () => {
    const found = (code: string) => moduleSpecifiers(code);
    expect(found('import * as D from "@radix-ui/react-dialog";')).toEqual(["@radix-ui/react-dialog"]);
    expect(
      found('import { Root } from "@radix-ui/react-popover"; export * from "@radix-ui/react-tabs";'),
    ).toEqual(["@radix-ui/react-popover", "@radix-ui/react-tabs"]);
    expect(found('export { Root } from "@radix-ui/react-switch";')).toEqual(["@radix-ui/react-switch"]);
    expect(found('const m = await import("@radix-ui/react-tooltip");')).toEqual(["@radix-ui/react-tooltip"]);
    expect(found('const m = require("@radix-ui/react-dropdown-menu");')).toEqual([
      "@radix-ui/react-dropdown-menu",
    ]);
    expect(found('type T = import("@radix-ui/react-dialog").DialogProps;')).toEqual([
      "@radix-ui/react-dialog",
    ]);
    expect(found('import "./ui.css"; import x from "react"; foo("@radix-ui/x");')).toEqual([
      "./ui.css",
      "react",
    ]);
    expect(
      valueExports(
        'export { A, B } from "./a"; export type { C } from "./c"; export { type D, E } from "./d";',
      ),
    ).toEqual(["A", "B", "E"]);
  });

  it("C3 src/ui exports exactly the primitives and the layer helpers", () => {
    expect(valueExports(read("ui/index.ts"))).toEqual(
      [
        "DialogSurface",
        "DropdownMenu",
        "Modal",
        "Popover",
        "Switch",
        "Tabs",
        "Tooltip",
        "UiProvider",
        "escapeLayerOpen",
        "escapeWasForAnOpenLayer",
        "keyLayerOpen",
        "focusables",
        "getDialogDepth",
        "subscribeDialogDepth",
        "useDialogDepth",
        "useDrawer",
      ].sort(),
    );
  });

  it("C3 no file outside src/ui imports Radix, and none reaches into a file of the folder", () => {
    const outside = sources().filter((f) => !f.startsWith("ui/"));
    expect(outside.length).toBeGreaterThan(100);
    for (const file of outside)
      for (const spec of moduleSpecifiers(read(file))) {
        expect(spec.startsWith("@radix-ui/"), `${file} imports ${spec}`).toBe(false);
        // The folder is its index: `../ui`, never `../ui/Dialog`.
        expect(
          /(^|\/)ui\/(?!ui\.css$)[\w.-]+$/.test(spec) && !spec.includes("components/ui"),
          `${file} imports ${spec}`,
        ).toBe(false);
      }
    // …and the folder does import it (the guard above is not vacuous).
    const inside = sources().filter((f) => f.startsWith("ui/"));
    expect(
      inside.flatMap((f) => moduleSpecifiers(read(f))).filter((s) => s.startsWith("@radix-ui/")).length,
    ).toBeGreaterThanOrEqual(6);
  });

  it("C3 the old homes are gone: no Modal in components/ui, no Popover or Tabs in components/primitives, no components/dialog", () => {
    const exported = (file: string) => {
      const names: string[] = [];
      visit(parse(read(file), file), (n) => {
        if (
          ts.isFunctionDeclaration(n) ||
          ts.isClassDeclaration(n) ||
          ts.isInterfaceDeclaration(n) ||
          ts.isTypeAliasDeclaration(n)
        )
          if (n.name && n.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword))
            names.push(n.name.text);
        if (ts.isVariableStatement(n) && n.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword))
          for (const d of n.declarationList.declarations)
            if (ts.isIdentifier(d.name)) names.push(d.name.text);
        if (ts.isExportDeclaration(n) && n.exportClause && ts.isNamedExports(n.exportClause))
          for (const e of n.exportClause.elements) names.push(e.name.text);
      });
      return names;
    };
    expect(exported("components/ui.tsx")).not.toContain("Modal");
    expect(exported("components/ui.tsx")).not.toContain("ModalProps");
    expect(exported("components/primitives.tsx")).not.toEqual(expect.arrayContaining(["Popover"]));
    expect(exported("components/primitives.tsx")).not.toContain("Tabs");
    expect(exported("components/primitives.tsx")).toEqual(
      expect.arrayContaining(["Button", "Segmented", "ConfirmDialog"]),
    );
    expect(sources()).not.toContain("components/dialog.tsx");
  });
});

/* ---- C15 and C16: the stylesheet ------------------------------------------------------- */

/** The declarations of `animation` that are not inside `@media (prefers-reduced-motion: no-preference)`. */
function animationsOutsideNoPreference(css: string): string[] {
  const out: string[] = [];
  postcss.parse(css).walkDecls(/^animation(-name)?$/, (d) => {
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

describe("C15 nothing in the primitives' stylesheet moves for someone who asked for less", () => {
  it("C15 the reader finds an animation outside the no-preference block, and leaves the ones inside", () => {
    expect(animationsOutsideNoPreference(".a { animation: x 1s }")).toHaveLength(1);
    expect(animationsOutsideNoPreference(".a { animation-name: x }")).toHaveLength(1);
    expect(
      animationsOutsideNoPreference("@media (prefers-reduced-motion: reduce) { .a { animation: none } }"),
    ).toHaveLength(1);
    expect(animationsOutsideNoPreference("@media (min-width: 1px) { .a { animation: x 1s } }")).toHaveLength(
      1,
    );
    expect(
      animationsOutsideNoPreference(
        "@media (prefers-reduced-motion: no-preference) { .a { animation: x 1s } }",
      ),
    ).toEqual([]);
    expect(
      animationsOutsideNoPreference(
        "@media (prefers-reduced-motion: no-preference) { @media (min-width: 1px) { .a { animation: x 1s } } }",
      ),
    ).toEqual([]);
    expect(animationsOutsideNoPreference(".a { transition: opacity 1s }")).toEqual([]);
  });

  it("C15 every animation of ui.css is inside @media (prefers-reduced-motion: no-preference), and there are some", () => {
    const css = readFileSync(join(UI, "ui.css"), "utf8");
    expect(animationsOutsideNoPreference(css)).toEqual([]);
    expect(
      postcss
        .parse(css)
        .toString()
        .match(/animation:/g)?.length ?? 0,
    ).toBeGreaterThan(8);
  });
});

describe("C16 the stylesheet obeys the design system's rules on its own", () => {
  const css = () => readFileSync(join(UI, "ui.css"), "utf8");

  it("C16 every state rule of ui.css carries a mark other than colour, with no exemption", () => {
    const sourcesOf = [{ file: "ui.css", css: css() }];
    expect(colourOnlyStates(sourcesOf, {})).toEqual([]);
    // The scan saw the rules this feature added: the tab bar, the switch, the menu item.
    const keys = stateGroups(sourcesOf).map((g) => g.key);
    expect(keys).toEqual(
      expect.arrayContaining([
        '.ui-tabs-list[data-variant="line"] [role="tab"][aria-selected="true"]',
        '.ui-tabs-list[data-variant="list"] [role="tab"][aria-selected="true"]',
        '.ui-tabs-list[data-variant="pill"] [role="tab"][aria-selected="true"]',
        '.ui-switch:not(.chip)[aria-checked="true"]',
        ".ui-menu-item[data-highlighted]",
      ]),
    );
  });

  /** The declarations a rule with exactly this selector makes. */
  const declared = (selector: string, prop: string): string[] => {
    const values: string[] = [];
    postcss.parse(css()).walkRules((rule) => {
      if (rule.selectors.map((x) => x.trim()).includes(selector))
        rule.walkDecls(prop, (d) => void values.push(d.value));
    });
    return values;
  };

  it("C16 the mark each state carries is the one the check names: a bar or ring that is hard, and a thumb that moves", () => {
    // The reader counts any fill as a mark (a 10% tint included); the claim says a bar, so the bar is read.
    for (const selector of [
      '.ui-tabs-list[data-variant="line"] [role="tab"][aria-selected="true"]',
      '.ui-tabs-list[data-variant="list"] [role="tab"][aria-selected="true"]',
      '.ui-tabs-list[data-variant="pill"] [role="tab"][aria-selected="true"]',
      ".ui-menu-item[data-highlighted]",
    ]) {
      const shadows = declared(selector, "box-shadow");
      expect(shadows.length, `${selector} declares a box-shadow`).toBeGreaterThan(0);
      expect(
        shadows.some(hardShadow),
        `${selector} has a bar or ring with no blur: ${shadows.join(" | ")}`,
      ).toBe(true);
    }
    expect(declared('.ui-switch:not(.chip)[aria-checked="true"]::before', "transform")).toEqual([
      "translateX(14px)",
    ]);
    // And the reading itself can tell a bar from a glow and from nothing.
    expect(hardShadow("inset 2px 0 0 var(--accent)")).toBe(true);
    expect(hardShadow("0 0 18px -8px var(--agent)")).toBe(false);
    expect(hardShadow("none")).toBe(false);
  });

  it("C16 no text under 12px and no colour literal in ui.css", () => {
    // The sizes are tokens (--fs-2 … ): the scale is theme.css's, so the whole tree is given for the lookup.
    expect(cssSizeOffences([{ file: "ui.css", css: css() }], treeRoots())).toEqual([]);
    const literal = /#[0-9a-f]{3,8}\b|\b(?:rgb|rgba|hsl|hsla|hwb|lab|lch|oklab|oklch)\(/i;
    const offenders: string[] = [];
    postcss.parse(css()).walkDecls((d) => {
      if (
        !d.prop.startsWith("--ui-") &&
        !d.parent?.toString().includes("@keyframes") &&
        literal.test(d.value)
      )
        offenders.push(`${d.prop}: ${d.value}`);
      if (d.prop.startsWith("--ui-") && literal.test(d.value)) offenders.push(`${d.prop}: ${d.value}`);
    });
    expect(offenders).toEqual([]);
  });
});

/* ---- C25: the hint of an icon-only control ------------------------------------------- */

interface TitleSite {
  tag: string;
  title: string;
  aria: string | null;
  /** The control shows no word of its own: nothing but an icon element or a symbol. */
  wordless: boolean;
}
const normalised = (text: string) => text.replace(/\s+/g, " ").slice(0, 90);
/**
 * Whether an element's content has a word: letters or digits in its text, or an expression that yields
 * text (`{t("x")}`, `{label}`, `{n} items`). An expression that is an icon (`{icon}`, `{<X />}`) or a
 * conditional of icons is not a word: a control with only that is still an icon-only control.
 */
function hasWords(el: ts.JsxElement): boolean {
  const isIcon = (e: ts.Expression): boolean => {
    if (ts.isJsxElement(e) || ts.isJsxSelfClosingElement(e) || ts.isJsxFragment(e)) return true;
    if (ts.isIdentifier(e)) return /icon|glyph|svg/i.test(e.text);
    if (ts.isParenthesizedExpression(e)) return isIcon(e.expression);
    if (ts.isConditionalExpression(e)) return isIcon(e.whenTrue) && isIcon(e.whenFalse);
    if (ts.isBinaryExpression(e)) return isIcon(e.right);
    return false;
  };
  return el.children.some((c) => {
    if (ts.isJsxText(c)) return /[\p{L}\p{N}]/u.test(c.text);
    if (ts.isJsxExpression(c)) return c.expression !== undefined && !isIcon(c.expression);
    if (ts.isJsxElement(c)) return hasWords(c);
    return false;
  });
}
/** The `title` of every button, Button, a and Link, with its `aria-label` when it has one. */
function titleSites(code: string): TitleSite[] {
  const out: TitleSite[] = [];
  visit(parse(code), (n) => {
    if (!(ts.isJsxOpeningElement(n) || ts.isJsxSelfClosingElement(n))) return;
    const tag = n.tagName.getText();
    if (!["button", "Button", "a", "Link"].includes(tag)) return;
    const attrs = n.attributes.properties.filter(ts.isJsxAttribute);
    const title = attrs.find((a) => a.name.getText() === "title");
    const aria = attrs.find((a) => a.name.getText() === "aria-label");
    if (title?.initializer)
      out.push({
        tag,
        title: normalised(title.initializer.getText()),
        aria: aria?.initializer ? normalised(aria.initializer.getText()) : null,
        wordless: !(ts.isJsxOpeningElement(n) && ts.isJsxElement(n.parent) && hasWords(n.parent)),
      });
  });
  return out;
}
/** The elements wrapped in a `Tooltip`: whether the child carries an `aria-label`. */
function tooltips(code: string): Array<{ label: boolean; named: boolean }> {
  const out: Array<{ label: boolean; named: boolean }> = [];
  visit(parse(code), (n) => {
    if (!ts.isJsxElement(n) || n.openingElement.tagName.getText() !== "Tooltip") return;
    const label = n.openingElement.attributes.properties.some(
      (a) => ts.isJsxAttribute(a) && a.name.getText() === "label",
    );
    const child = n.children.find((c) => ts.isJsxElement(c) || ts.isJsxSelfClosingElement(c));
    const attrs = child
      ? (ts.isJsxElement(child) ? child.openingElement : (child as ts.JsxSelfClosingElement)).attributes
          .properties
      : [];
    out.push({ label, named: attrs.some((a) => ts.isJsxAttribute(a) && a.name.getText() === "aria-label") });
  });
  return out;
}

/**
 * The `title` that stay on a control, with the reason (a hint on an icon-only control is a `Tooltip`; these are not that):
 * DATA the title is the thing's own full text (a path, a cut name, a summary);
 * WORDS the control has visible words and the title adds a sentence or a key to them;
 * BINDING the moldura-app design (Tela 1) names the title, and its approved check reads it;
 * DECK the deck's skill cards, which the unit and e2e tests select by their title;
 * TOUR a pill of the guided tour, which is a layer of its own.
 */
const TITLE_STAYS: Record<string, [reason: "DATA" | "WORDS" | "BINDING" | "DECK" | "TOUR", count: number]> = {
  'brain/BrainPanel.tsx :: {`${t("brain.local")} (f)`}': ["WORDS", 1],
  "brain/FileList.tsx :: {n.path}": ["DATA", 1],
  'components/Markdown.tsx :: {t("brain.ring.skills")}': ["WORDS", 1],
  // The title of a note link is the reference itself (a path or an address) or the sentence that says what a click does.
  "components/Markdown.tsx :: {title}": ["DATA", 2],
  'brain/PreviewPanel.tsx :: {t("brain.unpin")}': ["WORDS", 1],
  "brain/PreviewPanel.tsx :: {e.why || e.name}": ["DATA", 1],
  'desktop/DocWindow.tsx :: {t("desktop.doc.reference")}': ["WORDS", 1],
  'desktop/DocWindow.tsx :: {t("desktop.doc.open")}': ["WORDS", 1],
  "desktop/NowPanel.tsx :: {run.promptSummary}": ["DATA", 1],
  "desktop/NowPanel.tsx :: {artifact.path}": ["DATA", 1],
  "desktop/NowPanel.tsx :: {file.path}": ["DATA", 1],
  "desktop/SkillDeck.tsx :: {`/${skill.slug} · ${local.name}`}": ["DECK", 1],
  'desktop/SkillDeck.tsx :: {t("desktop.deck.more", { n: overflow })}': ["WORDS", 1],
  'desktop/console/Console.tsx :: {`${t("desktop.deck.title")} (⌘J)`}': ["WORDS", 1],
  "desktop/console/Console.tsx :: {panel.path ?? panel.title}": ["DATA", 1],
  'desktop/console/ConsoleControls.tsx :: { choice.model ? t("desktop.console.model") : t("desktop.console.autoHint", { provider: pr':
    ["WORDS", 1],
  'desktop/console/ConsoleControls.tsx :: { problem ? `${t("desktop.prompt.provider")}: ${t(`gate.state.${problem}` as "gate.state.l':
    ["WORDS", 1],
  'desktop/console/ConsoleControls.tsx :: {t("desktop.console.conversations")}': ["WORDS", 1],
  'desktop/console/ConsoleControls.tsx :: {t("desktop.cost.budget")}': ["WORDS", 1],
  "desktop/console/ConsoleThread.tsx :: {`${p.path} § ${p.section}`}": ["DATA", 1],
  "desktop/console/ConsoleTray.tsx :: {panel.path ?? panel.title}": ["DATA", 1],
  'desktop/widgets/AttentionWidget.tsx :: {t("desktop.attention.staleHint")}': ["WORDS", 1],
  "desktop/widgets/BoardWidget.tsx :: {r.name}": ["DATA", 1],
  'moldura/Sidebar.tsx :: {collapsed ? t("moldura.nav.expand") : t("moldura.nav.collapse")}': ["BINDING", 1],
  "moldura/Sidebar.tsx :: {collapsed ? name : undefined}": ["BINDING", 1],
  'moldura/TopBar.tsx :: {t("moldura.top.chatHint", { keys: comboLabel(CHAT_TOGGLE) })}': ["WORDS", 1],
  'nucleo/Telemetry.tsx :: { problem ? `${t("dash.activeProvider")}: ${t(`gate.state.${problem}`)}` : t("dash.activeP':
    ["WORDS", 1],
  "nucleo/Telemetry.tsx :: {mission.title}": ["DATA", 1],
  "nucleo/Telemetry.tsx :: {signals.cost.label}": ["DATA", 1],
  "nucleo/Telemetry.tsx :: {signals.runs.label}": ["DATA", 1],
  'nucleo/scenes/BrainSceneGauge.tsx :: {t("scene.brain.zoomTo", { level: t(KEYS[z]) })}': ["WORDS", 1],
  'nucleo/scenes/BrainSceneLegend.tsx :: {`${d === "areas" ? areasLabel : t(DIM_KEYS[d])} · ${t("scene.brain.dimKey", { n: k + 1 })':
    ["WORDS", 1],
  'nucleo/scenes/BrainSceneReader.tsx :: {t("scene.brain.termPin", { term: k.term, n: k.n })}': ["WORDS", 1],
  'nucleo/scenes/BrainSceneReader.tsx :: {t("scene.brain.travel", { name: e.label })}': ["WORDS", 1],
  "nucleo/scenes/BrainSceneTrail.tsx :: {c.label}": ["DATA", 1],
  'nucleo/scenes/RunsScene.tsx :: { on ? t("scene.runs.count.filterOn", { what: t(`scene.runs.count.${key}`, { n }) }) : und':
    ["WORDS", 1],
  'nucleo/scenes/RunsSceneRiver.tsx :: {t("scene.runs.lane.only", { lane: t(`scene.runs.lane.${l.lane}`) })}':
    ["WORDS", 1],
  'nucleo/scenes/RunsSceneRun.tsx :: {t("runs.actions.againTitle")}': ["WORDS", 1],
  "nucleo/scenes/SkillsSceneRing.tsx :: {`/${entry.slug}`}": ["DATA", 1],
  "onboarding/Onboarding.tsx :: {name}": ["TOUR", 1],
  'runs/Replay.tsx :: {t("runs.replay.jumpError")}': ["WORDS", 1],
  'runs/RunDetail.tsx :: {t("runs.actions.copyLogTitle")}': ["WORDS", 2],
  'runs/RunDetail.tsx :: {t("runs.actions.againTitle")}': ["WORDS", 1],
  'runs/RunDetail.tsx :: {t("runs.actions.continueTitle")}': ["WORDS", 1],
  "views/Artifacts.tsx :: {item.path}": ["DATA", 1],
  'plugins/pixel/PixelStudio.tsx :: {t("pixel.onion")}': ["WORDS", 1],
  "views/RoutinesTimeline.tsx :: {`${fmtHour(h.firedAt)} · ${said}`}": ["DATA", 1],
  'views/Skills/SkillDetail.tsx :: {t("skills.notes.promoteHint")}': ["WORDS", 1],
};

describe("C25 an icon-only control names itself and hints with a Tooltip, not with title", () => {
  it("C25 the reader finds titles in every spelling of the element", () => {
    const sites = (code: string) => titleSites(code);
    expect(sites('<button title="Save" aria-label="Save"><X /></button>')).toEqual([
      { tag: "button", title: '"Save"', aria: '"Save"', wordless: true },
    ]);
    expect(sites("<Button title={t('a')} aria-label={t('a')} />")).toEqual([
      { tag: "Button", title: "{t('a')}", aria: "{t('a')}", wordless: true },
    ]);
    expect(sites("<Link to='/x' title={`${a}`} />")).toEqual([
      { tag: "Link", title: "{`${a}`}", aria: null, wordless: true },
    ]);
    expect(sites('<a href="/x" title="Open" aria-label="Open" />')).toHaveLength(1);
    expect(sites('<div title="x" /><span title="y" aria-label="y" /><button aria-label="z" />')).toEqual([]);
    expect(tooltips('<Tooltip label="Save"><button aria-label="Save" /></Tooltip>')).toEqual([
      { label: true, named: true },
    ]);
    expect(tooltips('<Tooltip label="Save"><button /></Tooltip>')).toEqual([{ label: true, named: false }]);
    expect(tooltips("<Tooltip><button aria-label='x' /></Tooltip>")).toEqual([{ label: false, named: true }]);
  });

  it("C25 the reader tells a control with words from one with an icon or a glyph", () => {
    const wordless = (code: string) => titleSites(code).map((s) => s.wordless);
    expect(wordless('<button title="a">Save</button>')).toEqual([false]);
    expect(wordless('<button title="a"><X aria-hidden /> {t("k")}</button>')).toEqual([false]);
    expect(wordless('<button title="a"><span>Run now</span></button>')).toEqual([false]);
    expect(wordless('<button title="a">✈</button>')).toEqual([true]);
    expect(wordless('<button title="a"><X aria-hidden /></button>')).toEqual([true]);
    expect(wordless('<Button title="a" icon={<X />} />')).toEqual([true]);
    expect(wordless('<button title="a">{icon}</button>')).toEqual([true]);
    expect(wordless('<button title="a">{open ? <A /> : <B />}</button>')).toEqual([true]);
    expect(wordless('<button title="a">{open && <A />}</button>')).toEqual([true]);
    expect(wordless('<button title="a">{n} items</button>')).toEqual([false]);
  });

  it("C25 no title that stays 'for visible words' sits on a control that shows none", () => {
    const wrong: string[] = [];
    for (const file of sources().filter((f) => f.endsWith(".tsx") && !f.startsWith("ui/")))
      for (const s of titleSites(read(file)))
        if (TITLE_STAYS[`${file} :: ${s.title}`]?.[0] === "WORDS" && s.wordless && s.aria === null)
          wrong.push(`${file}: ${s.title}`);
    expect(wrong).toEqual([]);
  });

  it("C25 no control has its aria-label and its title say the same thing", () => {
    const same: string[] = [];
    for (const file of sources().filter((f) => f.endsWith(".tsx") && !f.startsWith("ui/")))
      for (const s of titleSites(read(file)))
        if (s.aria !== null && s.aria === s.title) same.push(`${file}: ${s.title}`);
    expect(same).toEqual([]);
  });

  it("C25 the title that stay are exactly the listed ones, each with its reason", () => {
    const found = new Map<string, number>();
    for (const file of sources().filter((f) => f.endsWith(".tsx") && !f.startsWith("ui/")))
      for (const s of titleSites(read(file))) {
        const key = `${file} :: ${s.title}`;
        found.set(key, (found.get(key) ?? 0) + 1);
      }
    expect(Object.fromEntries(found)).toEqual(
      Object.fromEntries(Object.entries(TITLE_STAYS).map(([k, [, n]]) => [k, n])),
    );
    for (const [key, [reason]] of Object.entries(TITLE_STAYS))
      expect(["DATA", "WORDS", "BINDING", "DECK", "TOUR"], key).toContain(reason);
  });

  it("C25 the Sidebar's collapse button still carries the title the frame's design names", () => {
    expect(
      TITLE_STAYS[
        'moldura/Sidebar.tsx :: {collapsed ? t("moldura.nav.expand") : t("moldura.nav.collapse")}'
      ]?.[0],
    ).toBe("BINDING");
  });

  it("C25 each Tooltip has its label and wraps a control that has its own name", () => {
    let count = 0;
    const unnamed: string[] = [];
    for (const file of sources().filter((f) => f.endsWith(".tsx") && !f.startsWith("ui/")))
      for (const t of tooltips(read(file))) {
        count++;
        if (!t.label || !t.named) unnamed.push(file);
      }
    expect(unnamed).toEqual([]);
    expect(count).toBeGreaterThanOrEqual(60);
  });
});

/* ---- C20 to C24: the inventory's positive side ---------------------------------------- */

/** The JSX tags a file renders, and the names it takes from the folder `ui` (through `../ui`, `../../ui`…). */
function usesFromUi(code: string, file: string): { rendered: Set<string>; imported: Set<string> } {
  const rendered = new Set<string>();
  const imported = new Set<string>();
  visit(parse(code), (n) => {
    if (ts.isJsxOpeningElement(n) || ts.isJsxSelfClosingElement(n))
      rendered.add(n.tagName.getText().split(".")[0]!);
    if (
      ts.isImportDeclaration(n) &&
      ts.isStringLiteral(n.moduleSpecifier) &&
      n.moduleSpecifier.text.startsWith(".") &&
      resolve(dirname(join(SRC, file)), n.moduleSpecifier.text) === UI
    )
      if (n.importClause?.namedBindings && ts.isNamedImports(n.importClause.namedBindings))
        for (const e of n.importClause.namedBindings.elements) imported.add((e.propertyName ?? e.name).text);
  });
  return { rendered, imported };
}

/** What each hand-made widget became: the file, and the primitive it renders (taken from `src/ui`). */
const MIGRATED: Array<[file: string, primitive: string]> = [
  ["components/ShortcutsHelp.tsx", "Modal"],
  ["components/primitives.tsx", "Modal"],
  ["views/Skills/ExportModal.tsx", "Modal"],
  ["views/Skills/MarketplaceModal.tsx", "Modal"],
  ["views/Skills/NewSkillModal.tsx", "Modal"],
  ["views/Routines.tsx", "Modal"],
  ["nucleo/scenes/SkillsScene.tsx", "Modal"],
  ["gallery/main.tsx", "Modal"],
  ["components/CommandPalette.tsx", "DialogSurface"],
  ["components/ProviderGate.tsx", "DialogSurface"],
  ["desktop/SkillDeck.tsx", "DialogSurface"],
  ["moldura/BellPopover.tsx", "Popover"],
  ["desktop/ModelEffortPopover.tsx", "Popover"],
  ["desktop/console/ConsoleControls.tsx", "Popover"],
  ["nucleo/scenes/BrainScene.tsx", "Popover"],
  ["views/Settings.tsx", "Tabs"],
  ["nucleo/scenes/RunsSceneRun.tsx", "Tabs"],
  ["views/Skills/SkillDetail.tsx", "Tabs"],
  ["nucleo/scenes/BrainSceneMenu.tsx", "Switch"],
  ["brain/BrainPanel.tsx", "Switch"],
  ["nucleo/scenes/SkillsSceneTools.tsx", "DropdownMenu"],
];

describe("C20 to C24 each widget of the inventory renders its primitive, taken from src/ui", () => {
  it("C20-C24 the reader tells a primitive taken from the folder from one that is not", () => {
    const code =
      'import { Modal, Tabs } from "../ui"; import { Other } from "./ui"; <Modal><Tabs.List /><Other /></Modal>;';
    const { rendered, imported } = usesFromUi(code, "views/Some.tsx");
    expect([...imported].sort()).toEqual(["Modal", "Tabs"]);
    expect([...rendered].sort()).toEqual(["Modal", "Other", "Tabs"]);
  });

  for (const [file, primitive] of MIGRATED)
    it(`C20-C24 ${file} renders ${primitive} from src/ui`, () => {
      const { rendered, imported } = usesFromUi(read(file), file);
      expect(imported.has(primitive), `${file} imports ${primitive} from the folder`).toBe(true);
      expect(rendered.has(primitive), `${file} renders ${primitive}`).toBe(true);
    });

  it("C20-C24 none of them is left with the machinery the primitives replaced", () => {
    const gone = ["useDialog", "usePresence", "DialogPortal", "useOutsidePress", "OPEN_DECK_EVENT"];
    for (const [file] of MIGRATED) {
      const used = new Set<string>();
      visit(parse(read(file), file), (n) => {
        if (ts.isIdentifier(n)) used.add(n.text);
      });
      for (const name of gone) expect(used.has(name), `${file} still uses ${name}`).toBe(false);
    }
  });
});

/* ---- C26: the closed list of hand-made layers ------------------------------------------ */

/** `role="dialog"|"tablist"|"menu"|"switch"` written as a JSX attribute, an object property or a setAttribute call. */
function handMadeRoles(code: string): string[] {
  const ROLES = ["dialog", "alertdialog", "tablist", "menu", "switch"];
  const out: string[] = [];
  visit(parse(code), (n) => {
    if (ts.isJsxAttribute(n) && n.name.getText() === "role" && n.initializer) {
      const text = n.initializer.getText().replace(/["'{}`\s]/g, "");
      if (ROLES.includes(text)) out.push(text);
    }
    if (
      ts.isPropertyAssignment(n) &&
      (n.name.getText() === "role" || n.name.getText() === '"role"') &&
      ts.isStringLiteralLike(n.initializer) &&
      ROLES.includes(n.initializer.text)
    )
      out.push(n.initializer.text);
    if (
      ts.isCallExpression(n) &&
      n.expression.getText().endsWith("setAttribute") &&
      n.arguments.length === 2 &&
      ts.isStringLiteralLike(n.arguments[0]!) &&
      n.arguments[0].text === "role" &&
      ts.isStringLiteralLike(n.arguments[1]!) &&
      ROLES.includes(n.arguments[1].text)
    )
      out.push(n.arguments[1].text);
  });
  return out;
}

/** The layers that are not the primitives', and why. */
const HAND_MADE: Record<string, string> = {
  "moldura/Moldura.tsx":
    "the conversation drawer is the same node as the fixed column on a wide window and a dialog only on a narrow one; it holds a live conversation and cannot remount (useDrawer)",
  "moldura/DocDrawer.tsx":
    "a drawer that stays where it is in the page it belongs to; Radix hides every sibling of an in-place modal from assistive technology, #modal-root included, and the palette opened over it lives there (useDrawer)",
  "nucleo/pending/FocusMode.tsx":
    "the focus mode is a layer of its own (comandos-atalhos design: it stays), the only surface while it is up",
  "onboarding/Onboarding.tsx":
    "the guided tour owns the keyboard while it is up and is not modal in its guided step (comandos-atalhos design: it stays)",
  "gallery/main.tsx":
    "a dialog drawn in place for the layer stories (the real Modal portals to the page and traps focus)",
};

describe("C26 what is still hand-made is on a closed list, with its reason", () => {
  it("C26 the reader finds a role in every spelling", () => {
    expect(handMadeRoles('<div role="dialog" />')).toEqual(["dialog"]);
    expect(handMadeRoles("<div role={'tablist'} />")).toEqual(["tablist"]);
    expect(handMadeRoles('const p = { role: "menu", tabIndex: -1 };')).toEqual(["menu"]);
    expect(handMadeRoles('el.setAttribute("role", "switch");')).toEqual(["switch"]);
    expect(
      handMadeRoles(
        '<div role="presentation" /><button role="radio" /><li role="menuitem" /><div role="tabpanel" />',
      ),
    ).toEqual([]);
    expect(handMadeRoles("<div role={dynamic} />")).toEqual([]);
  });

  it("C26 outside src/ui, a dialog, tablist, menu or switch role is written only in the listed files, and each still is", () => {
    const found: string[] = [];
    for (const file of sources().filter((f) => !f.startsWith("ui/")))
      if (handMadeRoles(read(file)).length > 0) found.push(file);
    expect(found.sort()).toEqual(Object.keys(HAND_MADE).sort());
    for (const [file, why] of Object.entries(HAND_MADE)) expect(why.length, file).toBeGreaterThan(40);
  });

  it("C26 useDrawer is imported by exactly the three panels that stay where they are", () => {
    const users = sources()
      .filter(
        (f) =>
          !f.startsWith("ui/") &&
          moduleSpecifiers(read(f)).some((s) => s.startsWith(".") && /(^|\/)ui$/.test(s)),
      )
      .filter((f) => {
        let uses = false;
        visit(parse(read(f), f), (n) => {
          if (ts.isCallExpression(n) && ts.isIdentifier(n.expression) && n.expression.text === "useDrawer")
            uses = true;
        });
        return uses;
      });
    expect(users.sort()).toEqual(["moldura/DocDrawer.tsx", "moldura/Moldura.tsx", "moldura/Sidebar.tsx"]);
  });
});

/* ---- C27: one language, the shell's material by token -------------------------------- */

const STATIC_PARTS = ["modal", "modal-backdrop", "launcher", "launcher-panel", "popover", "tabs"];
const escapeRe = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/** The subject of a rule is a part when it carries one of these classes (or any `ui-*`). */
const partOf = (extra: readonly string[] = []) =>
  new RegExp(`\\.(${[...STATIC_PARTS, ...extra].map(escapeRe).join("|")}|ui-[\\w-]+)(?![\\w-])`);
const CHROME = /^(background|border|box-shadow|backdrop-filter|clip-path|animation)/;
/** Rules whose subject (last compound selector) is a primitive's part and that declare its chrome. */
function chromeOutside(css: string, file: string, extra: readonly string[] = []): string[] {
  const part = partOf(extra);
  const out: string[] = [];
  postcss.parse(css, { from: file }).walkRules((rule) => {
    for (const selector of rule.selectors) {
      const subject = selector
        .trim()
        .split(/[\s>+~]+(?![^()]*\))/)
        .pop()!;
      if (!part.test(subject)) continue;
      rule.walkDecls((d) => {
        if (d.parent === rule && CHROME.test(d.prop)) out.push(`${file}: ${selector} { ${d.prop} }`);
      });
    }
  });
  return out;
}

/**
 * The classes a screen gives to a primitive's part: whatever string a `className` or `backdrop` attribute
 * of a dialog, popover, menu or tab list carries (`<Popover className="me-popover">`). These are parts too: a
 * rule on `.me-popover` that paints a background is the primitive drawn a second time. (A switch's chip face
 * and a tab panel are the screen's own content, and are left out.)
 */
const PRIMITIVE_TAGS = new Set(["Popover", "Modal", "DialogSurface", "DropdownMenu", "Tabs", "Tabs.List"]);
function wrapperClasses(code: string): string[] {
  const out = new Set<string>();
  const add = (text: string) => {
    for (const c of text.split(/\s+/)) if (c) out.add(c);
  };
  const tree = parse(code);
  /** The strings a name is declared with in this file (`const cls = "a b"`, `const cls = on ? "a" : "b"`). */
  const declared = (name: string) => {
    visit(tree, (n) => {
      if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.name.text === name && n.initializer)
        strings(n.initializer, false);
    });
  };
  const strings = (node: ts.Node, follow: boolean) =>
    visit(node, (n) => {
      if (ts.isStringLiteralLike(n)) add(n.text);
      if (ts.isTemplateHead(n) || ts.isTemplateMiddle(n) || ts.isTemplateTail(n)) add(n.text);
      // A class that reaches the primitive through a variable: read what the variable is given.
      if (follow && ts.isIdentifier(n) && !ts.isPropertyAccessExpression(n.parent)) declared(n.text);
    });
  visit(tree, (n) => {
    const element = ts.isJsxSelfClosingElement(n) ? n : ts.isJsxOpeningElement(n) ? n : null;
    if (!element || !PRIMITIVE_TAGS.has(element.tagName.getText())) return;
    for (const attribute of element.attributes.properties)
      if (
        ts.isJsxAttribute(attribute) &&
        ["className", "backdrop"].includes(attribute.name.getText()) &&
        attribute.initializer
      )
        strings(attribute.initializer, true);
  });
  // `open` is the state a class carries (`skill-deck open`), not a part of a primitive.
  out.delete("open");
  return [...out].sort();
}
/** Screens only: the primitives' own files write the classes of their parts, which ui.css draws. */
const allWrapperClasses = () =>
  [
    ...new Set(
      sources()
        .filter((f) => !f.startsWith("ui/"))
        .flatMap((f) => wrapperClasses(read(f))),
    ),
  ].sort();
const MATERIAL = [
  "--ui-sheet-r",
  "--ui-sheet-bg",
  "--ui-veil",
  "--ui-veil-blur",
  "--ui-pop-r",
  "--ui-pop-bg",
  "--ui-pop-blur",
  "--ui-pop-clip",
];

describe("C27 the two shells draw a primitive with the same rules", () => {
  it("C27 the reader finds chrome on a primitive's part, and leaves size, place and the part's contents alone", () => {
    expect(chromeOutside(".modal { background: red }", "a.css")).toHaveLength(1);
    expect(
      chromeOutside("html:has(.nu-shell) .modal-backdrop { backdrop-filter: blur(2px) }", "a.css"),
    ).toHaveLength(1);
    expect(chromeOutside(".nu-shell .popover.bs-menu { border-radius: 0 }", "a.css")).toHaveLength(1);
    expect(chromeOutside(".launcher-panel { animation: x 1s }", "a.css")).toHaveLength(1);
    expect(chromeOutside(".app-panel .tabs { box-shadow: none }", "a.css")).toHaveLength(1);
    expect(chromeOutside(".x .ui-menu-item { clip-path: none }", "a.css")).toHaveLength(1);
    expect(
      chromeOutside(".modal.sks-sheet { width: 1px; max-height: 2px; position: static }", "a.css"),
    ).toEqual([]);
    expect(chromeOutside(".modal :is(.btn, button) { border-radius: 9px }", "a.css")).toEqual([]);
    expect(chromeOutside(".modal-body { background: red }", "a.css")).toEqual([]);
    expect(chromeOutside(".modal .field { border: 0 }", "a.css")).toEqual([]);
  });

  it("C27 the reader finds the classes a screen gives a primitive, and the chrome on them", () => {
    expect(wrapperClasses('const k = "from-var other"; <Popover className={k} />;')).toEqual([
      "from-var",
      "other",
    ]);
    expect(wrapperClasses('const k = on ? "a" : "b"; <Modal className={`x ${k}`} />;')).toEqual([
      "a",
      "b",
      "x",
    ]);
    expect(wrapperClasses('const k = "unused"; <div className={k} />;')).toEqual([]);
    expect(
      wrapperClasses(
        '<Popover open className="me-popover cons-x" /><Modal className={`a ${b ? "c" : "d"}`}><Tabs.List className="e" /></Modal><div className="not-this" /><DialogSurface backdrop="f g" /><Switch className="chip" /><Tabs.Panel className="panel" />',
      ),
    ).toEqual(["a", "c", "cons-x", "d", "e", "f", "g", "me-popover"]);
    const wrapped = ["me-popover", "mold-popover", "bs-menu"];
    expect(chromeOutside(".me-popover { background: red }", "a.css", wrapped)).toHaveLength(1);
    expect(chromeOutside(".mold-popover { box-shadow: 0 0 0 9px #000 }", "a.css", wrapped)).toHaveLength(1);
    expect(
      chromeOutside("html:has(.nu-shell) .bs-menu { backdrop-filter: none }", "a.css", wrapped),
    ).toHaveLength(1);
    expect(chromeOutside(".me-popover { width: 3px; max-height: 4px }", "a.css", wrapped)).toEqual([]);
    expect(chromeOutside(".me-popover .btn { background: red }", "a.css", wrapped)).toEqual([]);
    // Without the list the reader is blind to them: the gap this closes.
    expect(chromeOutside(".me-popover { background: red }", "a.css")).toEqual([]);
  });

  it("C27 the wrapper classes the reader takes from the source are the ones the screens give", () => {
    const found = allWrapperClasses();
    for (const expected of ["me-popover", "cons-conversations", "mold-popover", "bs-menu", "sks-sheet"])
      expect(found, expected).toContain(expected);
  });

  it("C27 no stylesheet but ui.css gives a primitive's part, or a class a screen hangs on it, its own chrome", () => {
    const files = cssIn(SRC).filter((f) => f !== join(UI, "ui.css"));
    expect(files.length).toBeGreaterThan(8);
    const wrappers = allWrapperClasses();
    const offenders = files.flatMap((f) =>
      chromeOutside(readFileSync(f, "utf8"), relative(SRC, f), wrappers),
    );
    expect(offenders).toEqual([]);
    // luz.css, the Núcleo's skin, no longer rewrites the sheet or the veil.
    expect(readFileSync(join(SRC, "nucleo", "luz.css"), "utf8")).not.toMatch(
      /\.modal-backdrop\s*\{|luz-sheet-in|luz-veil-in/,
    );
  });

  it("C27 the eight tokens of the material are declared for the frame (and the default) and for the Núcleo", () => {
    const root = postcss.parse(readFileSync(join(UI, "ui.css"), "utf8"));
    const declared = (host: string) => {
      const names = new Set<string>();
      root.walkRules((rule) => {
        if (rule.selectors.map((s) => s.trim()).includes(host))
          rule.walkDecls(/^--ui-/, (d) => void names.add(d.prop));
      });
      return names;
    };
    for (const host of [":root", '[data-shell="moldura"]', "html:has(.nu-shell)", ".nu-shell"])
      for (const token of MATERIAL) expect(declared(host).has(token), `${host} declares ${token}`).toBe(true);
  });

  it("C27 the Núcleo's popover glass is at least 90% opaque (the text behind it showed through at the edge at 70% and 86%)", () => {
    const root = postcss.parse(readFileSync(join(UI, "ui.css"), "utf8"));
    const values: string[] = [];
    root.walkRules((rule) => {
      if (rule.selectors.map((x) => x.trim()).includes("html:has(.nu-shell)"))
        rule.walkDecls("--ui-pop-bg", (d) => void values.push(d.value));
    });
    expect(values).toHaveLength(1);
    const share = /var\(--bg\)\s+(\d+)%/.exec(values[0]!);
    expect(share, values[0]).not.toBeNull();
    expect(Number(share![1])).toBeGreaterThanOrEqual(90);
  });

  it("C27 both assemblies load ui.css right after theme.css", () => {
    for (const [file, theme, ui] of [
      ["main.tsx", "./theme.css", "./ui/ui.css"],
      ["gallery/main.tsx", "../theme.css", "../ui/ui.css"],
    ] as const) {
      const specs = moduleSpecifiers(read(file));
      expect(specs, file).toEqual(expect.arrayContaining([theme, ui]));
      expect(specs.indexOf(ui), file).toBe(specs.indexOf(theme) + 1);
    }
  });
});

/* ---- C34 and C35: the scenes that listen on the window before Radix does ----------------- */

/** Whether a file calls `name()` taken from the folder `ui`. */
function asks(code: string, name: string): boolean {
  let imported = false;
  let called = false;
  visit(parse(code), (n) => {
    if (
      ts.isImportDeclaration(n) &&
      ts.isStringLiteral(n.moduleSpecifier) &&
      /(^|\/)ui$/.test(n.moduleSpecifier.text) &&
      n.importClause?.namedBindings &&
      ts.isNamedImports(n.importClause.namedBindings)
    )
      for (const e of n.importClause.namedBindings.elements) if (e.name.text === name) imported = true;
    if (ts.isCallExpression(n) && ts.isIdentifier(n.expression) && n.expression.text === name) called = true;
  });
  return imported && called;
}

/** The `window.addEventListener("keydown", …)` calls of a file, with whether each is in the capture phase. */
function windowKeyListeners(code: string): Array<{ capture: boolean }> {
  const out: Array<{ capture: boolean }> = [];
  visit(parse(code), (n) => {
    if (
      !ts.isCallExpression(n) ||
      !ts.isPropertyAccessExpression(n.expression) ||
      n.expression.name.text !== "addEventListener" ||
      n.expression.expression.getText() !== "window" ||
      n.arguments[0]?.getText() !== '"keydown"'
    )
      return;
    const third = n.arguments[2];
    let capture = third?.getText() === "true";
    if (third && ts.isObjectLiteralExpression(third))
      capture = third.properties.some(
        (p) =>
          ts.isPropertyAssignment(p) && p.name.getText() === "capture" && p.initializer.getText() === "true",
      );
    out.push({ capture });
  });
  return out;
}

describe("C34 and C35 a scene that listens in the window lets the layer that owns the key have it", () => {
  it("C34 the reader tells a file that asks from one that only mentions it", () => {
    const ask = (code: string) => asks(code, "escapeLayerOpen");
    expect(ask('import { escapeLayerOpen } from "../../ui"; if (escapeLayerOpen()) return;')).toBe(true);
    expect(ask('import { escapeLayerOpen } from "../../ui";')).toBe(false);
    expect(ask('import { other } from "../../ui"; escapeLayerOpen();')).toBe(false);
    expect(ask('import { escapeLayerOpen } from "./elsewhere"; escapeLayerOpen();')).toBe(false);
  });

  it("C34 the reader finds a window keydown listener in either spelling of capture", () => {
    expect(windowKeyListeners('window.addEventListener("keydown", f, true);')).toEqual([{ capture: true }]);
    expect(windowKeyListeners('window.addEventListener("keydown", f, { capture: true });')).toEqual([
      { capture: true },
    ]);
    expect(windowKeyListeners('window.addEventListener("keydown", f, { capture: false });')).toEqual([
      { capture: false },
    ]);
    expect(windowKeyListeners('window.addEventListener("keydown", f);')).toEqual([{ capture: false }]);
    expect(
      windowKeyListeners(
        'document.addEventListener("keydown", f, true); window.addEventListener("click", f);',
      ),
    ).toEqual([]);
  });

  const scenes = () =>
    sources().filter((f) => !/^(ui|commands|onboarding)\//.test(f) && windowKeyListeners(read(f)).length > 0);

  it("C34 every file that listens for keys in the window capture asks escapeLayerOpen, and the list of them is closed", () => {
    const capture = scenes().filter((f) => windowKeyListeners(read(f)).some((l) => l.capture));
    expect(capture.sort()).toEqual(
      [
        "nucleo/pending/FocusMode.tsx",
        "nucleo/scenes/BrainScene.tsx",
        "nucleo/scenes/RoutinesScene.tsx",
        "nucleo/scenes/RunsScene.tsx",
      ].sort(),
    );
    for (const file of capture) expect(asks(read(file), "escapeLayerOpen"), `${file} asks`).toBe(true);
  });

  it("C35 the scenes whose plain keys (letters, arrows, Shift+digits) are in the window ask keyLayerOpen, not escapeLayerOpen", () => {
    const keys = ["nucleo/scenes/BrainScene.tsx", "nucleo/scenes/SkillsScene.tsx"];
    for (const file of keys) expect(asks(read(file), "keyLayerOpen"), `${file} asks keyLayerOpen`).toBe(true);
    // The Skills scene has no Escape of its own (its sheet is a Modal): it must not ask the Escape variant.
    expect(asks(read("nucleo/scenes/SkillsScene.tsx"), "escapeLayerOpen")).toBe(false);
  });
});
