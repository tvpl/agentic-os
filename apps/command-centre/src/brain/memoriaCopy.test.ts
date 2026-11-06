// @vitest-environment jsdom
/**
 * The copy and the stylesheets of trustworthy memory's part A (.specs/features/cerebro-memoria-confiavel, C104, C105;
 * design.md "Texto" and "Rótulos de autor, origem e confiança"; design-system binding).
 *
 * C104: every key of the "Texto" rows part A uses (rows 1-35 and 64-65: 60 keys) is a key of `en` and `ptBR` in
 * `locales/brain.ts` with the text of the table, read from design.md itself (and from the "Rótulos" table for the last
 * two rows), both locales hold the same keys, and each is spelled by the production source (the reader of
 * `i18n.orphans.test.ts`).
 *
 * C105: the new stylesheets set no text under 12px and prose at 13px, the repository's stylelint (tokens only) has
 * nothing to say about them, every `animation` and `transition` sits inside `@media (prefers-reduced-motion:
 * no-preference)`, and every trust badge and op state renders an icon and a text.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createElement as h } from "react";
import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import postcss from "postcss";
import stylelint from "stylelint";
import * as brain from "../locales/brain";
import { I18nContext } from "../i18n";
import { loadTree, productionFiles, spelledIn } from "../testing/sourceGraph";
import { OpState, TrustBadge } from "./memoria";

const ROOT = join(__dirname, "..", "..", "..", "..");
const DESIGN = readFileSync(
  join(ROOT, ".specs", "features", "cerebro-memoria-confiavel", "design.md"),
  "utf8",
);
const cells = (line: string) =>
  line
    .split("|")
    .slice(1, -1)
    .map((c) => c.trim());

/** The "Rótulos" table: the label of each value, `[pt, en]`, by key (`author.owner`, `origin.save`, `trust.usuario`). */
function labels(): Map<string, [string, string]> {
  const out = new Map<string, [string, string]>();
  const rows = DESIGN.slice(DESIGN.indexOf("## Rótulos"), DESIGN.indexOf("## Tela - Revisões"))
    .split("\n")
    .filter((l) => /^\|\s*(autor|origem|confiança|estado)\s/.test(l))
    .map(cells);
  const prefix: Record<string, string> = {
    autor: "author",
    origem: "origin",
    confiança: "trust",
    estado: "opState",
  };
  for (const [value, text] of rows) {
    const kind = value!.split(" ")[0]!;
    const names = [...value!.matchAll(/`([^`]+)`/g)].map((m) => m[1]!.replace(/:<id>$/, ""));
    const texts = names.length > 1 ? text!.split(", ") : [text!];
    names.forEach((name, i) => {
      const [pt, en = pt] = texts[i]!.split(" / ");
      // "Execução <id curto>" / "Run <short id> (link para a execução)": the id is the key's {id}
      const norm = (s: string) => s.replace(/\s*\(link[^)]*\)/, "").replace(/<[^>]+>/, "{id}");
      out.set(`${prefix[kind]}.${name}`, [norm(pt!), norm(en ?? pt!)]);
    });
  }
  return out;
}

/** key → [pt-BR, en] for rows 1-35 and 64-65 of "Texto". */
function partA(): { rows: number; keys: Array<[string, string, string]> } {
  const table = DESIGN.slice(DESIGN.indexOf("## Texto"))
    .split("\n")
    .filter((l) => /^\|\s*`/.test(l))
    .map(cells);
  const keys: Array<[string, string, string]> = [];
  const named = labels();
  table.forEach(([key, pt, en], i) => {
    const row = i + 1;
    if (row > 35 && row < 64) return;
    if (row >= 64) {
      const prefixes = [...key!.matchAll(/`(\w+)\.\*`|`(\w+)\.\w+`/g)].map((m) => m[1] ?? m[2]!);
      for (const p of new Set(prefixes))
        for (const [k, [lp, le]] of named) if (k.startsWith(`${p}.`)) keys.push([k, lp, le]);
      return;
    }
    const names = [...key!.matchAll(/`([^`]+)`/g)].map((m) => m[1]!);
    const pts = names.length > 1 ? pt!.split(" / ") : [pt!];
    const ens = names.length > 1 ? en!.split(" / ") : [en!];
    names.forEach((n, j) => keys.push([n, pts[j]!, ens[j]!]));
  });
  return { rows: table.length, keys };
}

describe("C104 the part-A copy of design.md in both locales", () => {
  it("C104 rows 1-35 and 64-65 of Texto give 60 keys (selectAll/selectNone as 2, trust 3, author 6, origin 13, opState 2), each in en and ptBR with the table's text", () => {
    const { rows, keys } = partA();
    expect(rows).toBe(65);
    expect(keys).toHaveLength(60);
    expect(new Set(keys.map(([k]) => k)).size).toBe(60);
    const count = (p: string) => keys.filter(([k]) => k.startsWith(p)).length;
    expect([count("trust."), count("author."), count("origin."), count("opState.")]).toEqual([3, 6, 13, 2]);
    expect(keys.map(([k]) => k)).toEqual(
      expect.arrayContaining(["proposals.selectAll", "proposals.selectNone"]),
    );
    for (const [key, pt, en] of keys) {
      expect((brain.ptBR as Record<string, string>)[key], `${key} (pt-BR)`).toBe(pt);
      expect((brain.en as Record<string, string>)[key], `${key} (en)`).toBe(en);
    }
  });

  it("C104 en and ptBR hold the same keys", () => {
    expect(Object.keys(brain.ptBR).sort()).toEqual(Object.keys(brain.en).sort());
  });

  it(
    "C104 every one of the 60 is spelled by the production source (no unused key)",
    { timeout: 60_000 },
    () => {
      const tree = loadTree();
      const defines = (file: string) => file === "i18n.ts" || file.startsWith("locales/");
      const spelled = spelledIn(tree, productionFiles(tree), defines);
      const unused = partA()
        .keys.filter(([k]) => !spelled.words.has(k))
        .map(([k]) => k);
      expect(unused).toEqual([]);
    },
  );
});

/** key → [pt-BR, en] for rows 36-63 of "Texto" (part B); `.read` after `access.agents.write` is `access.agents.read`. */
function partB(): Array<[string, string, string]> {
  const table = DESIGN.slice(DESIGN.indexOf("## Texto"))
    .split("\n")
    .filter((l) => /^\|\s*`/.test(l))
    .map(cells);
  const keys: Array<[string, string, string]> = [];
  table.slice(35, 63).forEach(([key, pt, en]) => {
    const raw = [...key!.matchAll(/`([^`]+)`/g)].map((m) => m[1]!);
    const names = raw.map((n) => (n.startsWith(".") ? raw[0]!.replace(/\.[^.]+$/, n) : n));
    const pts = names.length > 1 ? pt!.split(" / ") : [pt!];
    const ens = names.length > 1 ? en!.split(" / ") : [en!];
    names.forEach((n, j) => keys.push([n, pts[j]!, ens[j]!]));
  });
  return keys;
}

describe("C145 the part-B copy of design.md in both locales", () => {
  it("C145 rows 36-63 of Texto give 35 keys (access.agents / access.devices 2, access.agents.* 3, access.devices.* 3, export.menu / import.menu 2, import.source / import.sourceHint 2), each in en and ptBR with the table's text", () => {
    const keys = partB();
    expect(keys).toHaveLength(35);
    expect(new Set(keys.map(([k]) => k)).size).toBe(35);
    expect(keys.map(([k]) => k)).toEqual(
      expect.arrayContaining([
        "access.agents",
        "access.devices",
        "access.agents.write",
        "access.agents.read",
        "access.agents.hide",
        "access.devices.write",
        "access.devices.read",
        "access.devices.hide",
        "export.menu",
        "import.menu",
        "import.source",
        "import.sourceHint",
      ]),
    );
    expect(keys[0]![0]).toBe("access.menu");
    expect(keys.at(-1)![0]).toBe("import.forbidden");
    for (const [key, pt, en] of keys) {
      expect((brain.ptBR as Record<string, string>)[key], `${key} (pt-BR)`).toBe(pt);
      expect((brain.en as Record<string, string>)[key], `${key} (en)`).toBe(en);
    }
  });

  it("C145 en and ptBR hold the same keys", () => {
    expect(Object.keys(brain.ptBR).sort()).toEqual(Object.keys(brain.en).sort());
  });

  it(
    "C145 every one of the 35 is spelled by the production source (no unused key)",
    { timeout: 60_000 },
    () => {
      const tree = loadTree();
      const defines = (file: string) => file === "i18n.ts" || file.startsWith("locales/");
      const spelled = spelledIn(tree, productionFiles(tree), defines);
      expect(
        partB()
          .filter(([k]) => !spelled.words.has(k))
          .map(([k]) => k),
      ).toEqual([]);
    },
  );
});

/**
 * key → [pt-BR, en] for the table of "Emenda 1" of design.md (what accepting a fact does, round 3 finding 6): read from
 * the section before "Texto", so rows 1-65 of "Texto" (C104, C145) keep their numbers.
 */
function amendment1(): Array<[string, string, string]> {
  const section = DESIGN.slice(DESIGN.indexOf("## Emenda 1"), DESIGN.indexOf("## Texto"));
  return section
    .split("\n")
    .filter((l) => /^\|\s*`effects\./.test(l))
    .map(cells)
    .map(([key, pt, en]) => [key!.replace(/`/g, ""), pt!, en!]);
}

describe("C190 the copy of design.md's Emenda 1 in both locales", () => {
  it("C190 the amendment's table gives the 5 keys effects.close, .retract, .refuses, .unchanged and .error, each in en and ptBR with its text", () => {
    const keys = amendment1();
    expect(keys.map(([k]) => k)).toEqual([
      "effects.close",
      "effects.retract",
      "effects.refuses",
      "effects.unchanged",
      "effects.error",
    ]);
    // the amendment sits before "Texto": the 65 rows of that table are still 65
    expect(DESIGN.indexOf("## Emenda 1")).toBeLessThan(DESIGN.indexOf("## Texto"));
    expect(
      DESIGN.slice(DESIGN.indexOf("## Texto"))
        .split("\n")
        .filter((l) => /^\|\s*`/.test(l)),
    ).toHaveLength(65);
    for (const [key, pt, en] of keys) {
      expect((brain.ptBR as Record<string, string>)[key], `${key} (pt-BR)`).toBe(pt);
      expect((brain.en as Record<string, string>)[key], `${key} (en)`).toBe(en);
    }
  });

  it("C190 en and ptBR hold the same keys, and the placeholders of each text are the same in both", () => {
    expect(Object.keys(brain.ptBR).sort()).toEqual(Object.keys(brain.en).sort());
    for (const [key] of amendment1()) {
      const holes = (t: string) => [...t.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
      expect(holes((brain.ptBR as Record<string, string>)[key]!), key).toEqual(
        holes((brain.en as Record<string, string>)[key]!),
      );
    }
  });

  it(
    "C190 every one of the 5 is spelled by the production source (no unused key)",
    { timeout: 60_000 },
    () => {
      const tree = loadTree();
      const defines = (file: string) => file === "i18n.ts" || file.startsWith("locales/");
      const spelled = spelledIn(tree, productionFiles(tree), defines);
      expect(
        amendment1()
          .filter(([k]) => !spelled.words.has(k))
          .map(([k]) => k),
      ).toEqual([]);
    },
  );
});

const SHEETS = ["memoria.css", "memoriaDiff.css", "reviews/agent.css", "notes/history.css"].map((f) => ({
  file: f,
  path: join(__dirname, f),
  css: readFileSync(join(__dirname, f), "utf8"),
}));

/** The `animation`/`transition` declarations not inside `@media (prefers-reduced-motion: no-preference)`. */
function motionOutside(css: string): string[] {
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

/** The font sizes a sheet sets (`font-size`, and the `font` shorthand), by selector; `only` keeps `font-size`. */
function sizes(css: string, only = false): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  postcss.parse(css).walkDecls(only ? /^font-size$/ : /^font(-size)?$/, (d) => {
    out.push([(d.parent as postcss.Rule).selector, d.value]);
  });
  return out;
}
/** A size is at least 12px: one of the scale's tokens from --fs-2, `inherit`, or a px of 12 or more. */
const atLeast12 = (v: string) =>
  v === "inherit" ||
  /^var\(--fs-([2-8]|hero)\)$/.test(v) ||
  (/^(\d+)px$/.test(v) && Number(v.slice(0, -2)) >= 12);

describe("C105 the new stylesheets and the marks", () => {
  it("C105 no text under 12px; the prose classes at 13px", () => {
    for (const s of SHEETS)
      for (const [sel, v] of sizes(s.css)) expect(atLeast12(v), `${s.file} ${sel}: ${v}`).toBe(true);
    // the sentences: the summary, the banners, the states and notices, the op text, the dialogs' titles
    const prose: Array<[string, string]> = [
      ["reviews/agent.css", ".ag-summary"],
      ["reviews/agent.css", ".ag-banner"],
      ["reviews/agent.css", ".ag-op"],
      ["notes/history.css", ".hf-state"],
      ["notes/history.css", ".hf-notice"],
      ["notes/history.css", ".vd-failure"],
      ["notes/history.css", ".hf-pick"],
      ["notes/history.css", ".mh-row"],
    ];
    for (const [file, sel] of prose) {
      const found = sizes(SHEETS.find((s) => s.file === file)!.css, true).filter(([s]) =>
        s.split(/,\s*/).includes(sel),
      );
      expect(
        found.map(([, v]) => v),
        `${file} ${sel}`,
      ).toEqual(["var(--fs-3)"]);
    }
  });

  it("C105 the reader finds a size under 12px and a motion outside the block, and leaves the ones that are fine", () => {
    // the retired step, spelled in two pieces: typography.test.ts C1 forbids the token's name in src
    expect(atLeast12(`var(--fs-${1})`)).toBe(false);
    expect(atLeast12("11px")).toBe(false);
    expect(atLeast12("var(--fs-2)")).toBe(true);
    expect(motionOutside(".a { transition: opacity 1s }")).toEqual([".a { transition: opacity 1s }"]);
    expect(
      motionOutside("@media (prefers-reduced-motion: no-preference) { .a { animation: x 1s } }"),
    ).toEqual([]);
  });

  it("C105 every animation and transition, the item leaving the list in 150 ms included, is inside prefers-reduced-motion: no-preference", () => {
    for (const s of SHEETS) expect(motionOutside(s.css), s.file).toEqual([]);
    // the item that leaves "Do agente" is the list's own `.rv-item[data-leaving]`, folding in 150 ms
    const reviews = readFileSync(join(__dirname, "reviews", "reviews.css"), "utf8");
    expect(motionOutside(reviews)).toEqual([]);
    expect(reviews).toMatch(/\.rv-item\[data-leaving\]\s*\{\s*animation: rv-fold 150ms/);
  });

  it("C105 the repository's stylelint config reports no warning on the new sheets, and does report a colour literal", async () => {
    const configFile = join(ROOT, "stylelint.config.mjs");
    for (const s of SHEETS) {
      const { results } = await stylelint.lint({ code: s.css, codeFilename: s.path, configFile });
      expect(
        results[0]!.warnings.map((w) => w.text),
        s.file,
      ).toEqual([]);
    }
    const { results } = await stylelint.lint({
      code: ".mc-x { color: #ff0000; }\n",
      codeFilename: SHEETS[0]!.path,
      configFile,
    });
    expect(results[0]!.warnings.length).toBeGreaterThan(0);
  }, 60_000);

  it("C105 every trust badge and op state renders an icon and a text", () => {
    const wrap = (el: ReturnType<typeof h>) =>
      render(h(I18nContext.Provider, { value: { lang: "pt-BR", setLang: () => undefined } }, el));
    for (const trust of ["usuario", "ferramenta", "inferido"] as const) {
      const { container, unmount } = wrap(h(TrustBadge, { trust }));
      expect(container.querySelector("svg"), trust).not.toBeNull();
      expect(container.textContent!.trim().length, trust).toBeGreaterThan(0);
      unmount();
    }
    for (const state of ["invalid", "conflict"] as const) {
      const { container, unmount } = wrap(h(OpState, { state }));
      expect(container.querySelector("svg"), state).not.toBeNull();
      expect(container.textContent!.trim().length, state).toBeGreaterThan(0);
      unmount();
    }
  });
});
