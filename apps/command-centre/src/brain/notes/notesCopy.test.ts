/**
 * The copy of the notes view (.specs/features/cerebro-vista-notas, C81; design.md "Texto" and its amendment): every row
 * of the two tables of design.md, read from the file itself, is a key of `locales/brain.ts` with that text in `en` and
 * in `ptBR`, and both locales hold the same keys. A row with several strings (`Grafo / Notas`) is one key per string;
 * a placeholder is a placeholder whatever the table calls it (`{quando}` is the key's `{when}`).
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { en, ptBR } from "../../locales/brain";

const DESIGN = path.resolve(__dirname, "../../../../../.specs/features/cerebro-vista-notas/design.md");

/** The `| pt-BR | en |` rows of every table that has that header, in a section. */
function rowsOf(section: string): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  let inTable = false;
  for (const line of section.split("\n")) {
    const cells = line.trim().startsWith("|")
      ? line
          .trim()
          .slice(1, -1)
          .split("|")
          .map((c) => c.trim())
      : null;
    if (!cells || cells.length !== 2) {
      inTable = false;
      continue;
    }
    if (cells[0] === "pt-BR" && cells[1] === "en") {
      inTable = true;
      continue;
    }
    if (!inTable || /^-+$/.test(cells[0]!)) continue;
    out.push([cells[0]!, cells[1]!]);
  }
  return out;
}

const design = fs.readFileSync(DESIGN, "utf8");
const sectionOf = (title: string) => {
  const at = design.indexOf(`\n## ${title}`);
  const next = design.indexOf("\n## ", at + 1);
  return design.slice(at, next < 0 ? undefined : next);
};
const ROWS = [...rowsOf(sectionOf("Texto")), ...rowsOf(sectionOf("Emendas depois da aprovação"))];

const norm = (s: string) => s.replace(/\{[^}]+\}/g, "{}");
const EN = en as Record<string, string>;
const PT = ptBR as Record<string, string>;

describe("C81 the copy of design.md", () => {
  it("C81 the two tables hold 33 rows: 32 in Texto and the amendment's one", () => {
    expect(rowsOf(sectionOf("Texto"))).toHaveLength(32);
    expect(rowsOf(sectionOf("Emendas depois da aprovação"))).toEqual([
      ["Só notas .md se editam", "Only .md notes can be edited"],
    ]);
    expect(ROWS).toHaveLength(33);
  });

  it.each(ROWS)("C81 %s · %s is a key of en and ptBR with that text", (pt, english) => {
    const pts = pt.split(" / ");
    const ens = english.split(" / ");
    expect(ens.length, `${pt} | ${english}`).toBe(pts.length);
    pts.forEach((p, i) => {
      const e = ens[i]!;
      const keys = Object.keys(EN).filter((k) => norm(EN[k]!) === norm(e) && norm(PT[k] ?? "") === norm(p));
      expect(keys, `${p} | ${e}`).not.toEqual([]);
    });
  });

  it("C81 both locales hold the same keys", () => {
    expect(Object.keys(ptBR).sort()).toEqual(Object.keys(en).sort());
  });
});
