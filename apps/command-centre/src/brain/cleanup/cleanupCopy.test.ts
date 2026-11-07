/**
 * The guided cleanup's copy (.specs/features/cerebro-faxina-guiada, C83; design.md "Texto"): every row of the design's
 * table is a key of `en` and `ptBR` in `locales/brain.ts` with that text, and both locales hold the same keys.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { en, ptBR } from "../../locales/brain";

const DESIGN = join(
  __dirname,
  "..",
  "..",
  "..",
  "..",
  "..",
  ".specs",
  "features",
  "cerebro-faxina-guiada",
  "design.md",
);

/** The rows of the "Texto" table: key, pt-BR, en. */
function rows(): Array<[key: string, pt: string, en: string]> {
  const text = readFileSync(DESIGN, "utf8");
  const table = text.slice(text.indexOf("## Texto"));
  return table
    .split("\n")
    .filter((l) => /^\|\s*`cleanup\./.test(l))
    .map((l) => {
      const cells = l
        .split("|")
        .slice(1, -1)
        .map((c) => c.trim());
      return [cells[0]!.replace(/`/g, ""), cells[1]!, cells[2]!];
    });
}

describe("C83 the design's copy in both locales", () => {
  it("C83 the table has its 27 rows, each a key of en and ptBR with that text", () => {
    const all = rows();
    expect(all).toHaveLength(27);
    const enOf = en as Record<string, string>;
    const ptOf = ptBR as Record<string, string>;
    for (const [key, pt, english] of all) {
      expect(ptOf[key], `${key} (pt-BR)`).toBe(pt);
      expect(enOf[key], `${key} (en)`).toBe(english);
    }
  });

  it("C83 en and ptBR hold the same keys", () => {
    expect(Object.keys(ptBR).sort()).toEqual(Object.keys(en).sort());
  });
});
