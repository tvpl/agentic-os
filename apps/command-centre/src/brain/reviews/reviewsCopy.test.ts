/**
 * The copy of "Revisões" (.specs/features/cerebro-natureza, C93; design.md "Texto" and "Selo de natureza"; plan.md
 * amendment 23): every row of the design's table (28 keys, `nature.fato` … `nature.none` as 6 and `scope.pessoal` …
 * `scope.externo` as 3) and every key amendment 23 lists (16) is a key of `en` and `ptBR` with that text, read from
 * the two documents themselves, and both locales hold the same keys.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import * as brain from "../../locales/brain";
import * as apps from "../../locales/apps";

const FEATURE = join(__dirname, "..", "..", "..", "..", "..", ".specs", "features", "cerebro-natureza");
const DESIGN = readFileSync(join(FEATURE, "design.md"), "utf8");
const PLAN = readFileSync(join(FEATURE, "plan.md"), "utf8");
const cells = (line: string) =>
  line
    .split("|")
    .slice(1, -1)
    .map((c) => c.trim());

/** key → [pt-BR, en], from design.md's "Texto" table, its two range rows read from "Selo de natureza" and its own cells. */
function designRows(): { rows: number; keys: Array<[string, string, string]> } {
  const table = DESIGN.slice(DESIGN.indexOf("## Texto"))
    .split("\n")
    .filter((l) => /^\|\s*`/.test(l));
  const keys: Array<[string, string, string]> = [];
  const badges = DESIGN.slice(DESIGN.indexOf("## Selo de natureza"), DESIGN.indexOf("## Tela - Revisões"))
    .split("\n")
    .filter((l) => /^\|\s*(`\w+`|\(nenhuma\))/.test(l))
    .map(cells);
  for (const line of table) {
    const [key, pt, en] = cells(line) as [string, string, string];
    if (key.startsWith("`nature.fato`")) {
      for (const [n, text] of badges) {
        const [p, e] = text!.split(" / ");
        keys.push([`nature.${n === "(nenhuma)" ? "none" : n!.replace(/`/g, "")}`, p!, e!]);
      }
    } else if (key.startsWith("`scope.pessoal`")) {
      const p = pt.split(", ");
      const e = en.split(", ");
      ["pessoal", "equipe", "externo"].forEach((s, i) => keys.push([`scope.${s}`, p[i]!, e[i]!]));
    } else keys.push([key.replace(/`/g, ""), pt, en]);
  }
  return { rows: table.length, keys };
}

/** key → [pt-BR, en], from the text of amendment 23. */
function amendmentKeys(): Array<[string, string, string]> {
  const start = PLAN.indexOf("23. **O texto que a tabela");
  const text = PLAN.slice(start, PLAN.indexOf("Perguntas novas ao dono", start)).replace(/\s+/g, " ");
  return [...text.matchAll(/`([\w.]+)` "([^"]+)" \/ "([^"]+)"/g)].map((m) => [m[1]!, m[2]!, m[3]!]);
}

describe("C93 the design's copy and amendment 23 in both locales", () => {
  it("C93 design.md's table has its 30 rows (37 keys) and amendment 23 its 16 keys, 53 in all, each in en and ptBR with that text", () => {
    const design = designRows();
    expect(design.rows).toBe(30);
    expect(design.keys).toHaveLength(28 + 6 + 3);
    const amendment = amendmentKeys();
    expect(amendment).toHaveLength(16);
    const all = [...design.keys, ...amendment];
    expect(new Set(all.map(([k]) => k)).size).toBe(53);
    for (const [key, pt, en] of all) {
      const mod = key.startsWith("apps.") ? apps : brain;
      expect((mod.ptBR as Record<string, string>)[key], `${key} (pt-BR)`).toBe(pt);
      expect((mod.en as Record<string, string>)[key], `${key} (en)`).toBe(en);
    }
  });

  it("C93 en and ptBR hold the same keys, in locales/brain.ts and in locales/apps.ts", () => {
    expect(Object.keys(brain.ptBR).sort()).toEqual(Object.keys(brain.en).sort());
    expect(Object.keys(apps.ptBR).sort()).toEqual(Object.keys(apps.en).sort());
  });
});
