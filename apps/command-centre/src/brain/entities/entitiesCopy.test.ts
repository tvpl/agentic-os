/**
 * The copy of the two views, the card and the fold (.specs/features/cerebro-entidades-resumos, C129; design.md "Texto"):
 * every string of the table's 30 rows, read from the file itself, is a key of `ptBR` and `en` in `locales/brain.ts`
 * whose values are byte-equal to the table's two cells. A cell with several strings (`Entidades · Resumos`) is one key
 * per string, unless a run of them is one string (`Atual · {day}`): the longest run that is a key wins. Both locales
 * hold the same `entities.` and `summaries.` keys; each of them is a string of the table and is spelled by the
 * production source; and the files of the two views, the card and the fold write no word of their own: no JSX text
 * and no `title`, `aria-label`, `placeholder` or `alt` that is not a key's.
 */
import fs from "node:fs";
import path from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import * as brain from "../../locales/brain";
import { loadTree, productionFiles, spelledIn, syntax, visit } from "../../testing/sourceGraph";

const DESIGN = path.resolve(__dirname, "../../../../../.specs/features/cerebro-entidades-resumos/design.md");
const design = fs.readFileSync(DESIGN, "utf8");
const at = design.indexOf("\n## Texto");
const section = design.slice(
  at,
  design.indexOf("\n## ", at + 1) < 0 ? undefined : design.indexOf("\n## ", at + 1),
);

/** The `| Onde | pt-BR | en |` rows of the section. */
function rows(): Array<[string, string, string]> {
  const out: Array<[string, string, string]> = [];
  let inTable = false;
  for (const line of section.split("\n")) {
    const cells = line.trim().startsWith("|")
      ? line
          .trim()
          .slice(1, -1)
          .split("|")
          .map((c) => c.trim())
      : null;
    if (!cells || cells.length !== 3) {
      inTable = false;
      continue;
    }
    if (cells[1] === "pt-BR" && cells[2] === "en") {
      inTable = true;
      continue;
    }
    if (!inTable || /^-+$/.test(cells[0]!)) continue;
    out.push([cells[0]!, cells[1]!, cells[2]!]);
  }
  return out;
}

const ROWS = rows();
type Dict = Record<string, string>;
const en = brain.en as unknown as Dict;
const pt = brain.ptBR as unknown as Dict;
const OWN = (k: string) => k.startsWith("entities.") || k.startsWith("summaries.");
const KEYS = Object.keys(en).filter(OWN);

/** The keys whose en value is `e` and pt-BR value is `p`, byte for byte. */
const keysWith = (e: string, p: string) => KEYS.filter((k) => en[k] === e && pt[k] === p);

/** Each string of a row as [pt-BR, en, keys]: the longest run of `·`-pieces that is a key, from the left. */
function strings(p: string, e: string): Array<[string, string, string[]]> {
  const ps = p.split(" · ");
  const es = e.split(" · ");
  expect(es.length, `${p} | ${e}`).toBe(ps.length);
  const out: Array<[string, string, string[]]> = [];
  let i = 0;
  while (i < ps.length) {
    let found: [string, string, string[]] | null = null;
    for (let j = ps.length; j > i && !found; j--) {
      const pp = ps.slice(i, j).join(" · ");
      const ee = es.slice(i, j).join(" · ");
      const keys = keysWith(ee, pp);
      if (keys.length > 0) {
        found = [pp, ee, keys];
        i = j;
      }
    }
    if (!found) {
      out.push([ps[i]!, es[i]!, []]);
      i += 1;
    } else out.push(found);
  }
  return out;
}

describe("C129 the copy of design.md", () => {
  it("C129 the table holds the 30 rows of the two views, the card and the fold", () => {
    expect(ROWS.map(([where]) => where)).toEqual([
      "entidades, título",
      "entidades, apoio",
      "abas",
      "busca",
      "lista",
      "tipos",
      "painel",
      "seções",
      "ações",
      "correções",
      "confirmar juntar",
      "confirmar tirar",
      "avisos",
      "conflito",
      "limite",
      "entidades, estados",
      "sugestões",
      "lote",
      "sugestão",
      "dobra",
      "resumos, título",
      "resumos, apoio",
      "grupos",
      "estado",
      "botões",
      "velho",
      "fontes",
      "como foi feito",
      "resumos, estados",
      "entradas",
    ]);
  });

  it.each(ROWS)(
    "C129 %s: %s · %s are keys of en and ptBR in locales/brain.ts, byte-equal",
    (_where, p, e) => {
      for (const [pp, ee, keys] of strings(p, e)) expect(keys, `${pp} | ${ee}`).not.toEqual([]);
    },
  );

  it("C129 both locales hold the same entities. and summaries. keys; each is a string of the table and is spelled by the production source", () => {
    expect(Object.keys(pt).filter(OWN).sort()).toEqual([...KEYS].sort());
    const fromTable = new Set(ROWS.flatMap(([, p, e]) => strings(p, e).flatMap(([, , keys]) => keys)));
    expect(KEYS.filter((k) => !fromTable.has(k))).toEqual([]);
    const tree = loadTree();
    const defines = (file: string) => file === "i18n.ts" || file.startsWith("locales/");
    const spelled = spelledIn(tree, productionFiles(tree), defines);
    // a key is spelled whole, or built behind a prefix (`entities.tab.${kind}`)
    const built = (k: string) => [...spelled.prefixes].some((p) => k.startsWith(p) && p.endsWith("."));
    expect(KEYS.filter((k) => !spelled.words.has(k) && !built(k))).toEqual([]);
  });

  it("C129 the files of the two views, the card and the fold write no word outside the locale: no JSX text, no literal title, aria-label, placeholder or alt", () => {
    const tree = loadTree();
    const files = [...tree.keys()].filter(
      (f) =>
        /^brain\/(entities|summaries)\//.test(f) &&
        /\.tsx?$/.test(f) &&
        !/\.test\./.test(f) &&
        !/testkit/.test(f),
    );
    expect(files).toEqual(
      expect.arrayContaining([
        "brain/entities/EntitiesView.tsx",
        "brain/entities/EntitiesFold.tsx",
        "brain/summaries/SummariesView.tsx",
      ]),
    );
    const words: string[] = [];
    for (const file of files)
      visit(syntax(tree, file), (n) => {
        if (ts.isJsxText(n) && /\p{L}/u.test(n.text)) words.push(`${file}: ${n.text.trim()}`);
        if (
          ts.isJsxAttribute(n) &&
          ["title", "aria-label", "placeholder", "alt"].includes(n.name.getText()) &&
          n.initializer &&
          ts.isStringLiteral(n.initializer) &&
          /\p{L}/u.test(n.initializer.text)
        )
          words.push(`${file}: ${n.name.getText()}="${n.initializer.text}"`);
      });
    expect(words).toEqual([]);
  });
});
