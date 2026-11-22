/**
 * The copy of "Busca por significado" (.specs/features/cerebro-busca-significado, C129; design.md "Texto"): every
 * string of the table's 25 rows, read from the file itself and split at `·` (one key per string), is a key of `en`
 * and `ptBR` in `locales/brain.ts` with that text in each language; the network error is the server's text and not a
 * key. Both locales hold the same keys, and every key this feature adds (`semantic.*`) is spelled by the block.
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import * as brain from "../../locales/brain";

const DESIGN = path.resolve(__dirname, "../../../../../.specs/features/cerebro-busca-significado/design.md");
const design = fs.readFileSync(DESIGN, "utf8");
const at = design.indexOf("\n## Texto");
const section = design.slice(
  at,
  design.indexOf("\n## ", at + 1) < 0 ? undefined : design.indexOf("\n## ", at + 1),
);
const SOURCE = fs.readFileSync(path.join(__dirname, "SemanticSearch.tsx"), "utf8");

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
const norm = (s: string) => s.replace(/\{[^}]+\}/g, "{}");
/** The server's text (design.md "motivos": `{erro de rede}`), shown as it comes: no key. */
const SERVER = new Set(["{erro de rede}|{network error}"]);

describe("C129 the copy of design.md", () => {
  it("C129 the table holds 25 rows", () => {
    expect(ROWS).toHaveLength(25);
  });

  it.each(ROWS)("C129 %s: each string of %s · %s is a key of en and ptBR with that text", (_where, p, e) => {
    const pts = p.split(" · ");
    const ens = e.split(" · ");
    expect(ens.length, `${p} | ${e}`).toBe(pts.length);
    pts.forEach((one, i) => {
      if (SERVER.has(`${one}|${ens[i]}`)) return;
      const keys = Object.keys(en).filter(
        (k) => norm(en[k]!) === norm(ens[i]!) && norm(pt[k] ?? "") === norm(one),
      );
      expect(keys, `${one} | ${ens[i]}`).not.toEqual([]);
      expect(
        keys.some((k) => k.startsWith("semantic.")),
        `${one} | ${ens[i]}`,
      ).toBe(true);
    });
  });

  it("C129 the network error is the server's text, and no other string is left out", () => {
    const skipped = ROWS.flatMap(([, p, e]) => {
      const ens = e.split(" · ");
      return p.split(" · ").filter((one, i) => SERVER.has(`${one}|${ens[i]}`));
    });
    expect(skipped).toEqual(["{erro de rede}"]);
  });

  it("C129 both locales hold the same keys", () => {
    expect(Object.keys(brain.ptBR).sort()).toEqual(Object.keys(brain.en).sort());
  });

  it("C129 every semantic.* key is spelled by the block, and there are as many as the block needs", () => {
    const keys = Object.keys(en).filter((k) => k.startsWith("semantic."));
    expect(keys.length).toBeGreaterThan(50);
    expect(keys.filter((k) => !SOURCE.includes(`"${k}"`))).toEqual([]);
  });
});
