/**
 * The copy of the weekly review, the mention fold, the sentinel row and the notification (.specs/features/cerebro-rituais,
 * C97; design.md "Texto"): every string of the table's 41 rows, read from the file itself, is a key of `en` and `ptBR`
 * with that text, in `locales/brain.ts`, except the sentinel row's two, in `locales/apps.ts`; the journal line is the
 * engine's and no key. A cell with several strings (`Voltar · Próxima etapa`) is one key per string, unless the whole
 * cell is one string (`Etapa {n} de 5 · {name}`); a note in parentheses after a string (`(a chave da C6)`) is not part
 * of it. The toast of G21 is a key too. Both locales of each file hold the same keys.
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import * as apps from "../../locales/apps";
import * as brain from "../../locales/brain";

const DESIGN = path.resolve(__dirname, "../../../../../.specs/features/cerebro-rituais/design.md");
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
const JOURNAL = ROWS.filter(([where]) => where.startsWith("linha do diário"));
const KEYED = ROWS.filter(([where]) => !where.startsWith("linha do diário"));
const norm = (s: string) => s.replace(/\{[^}]+\}/g, "{}");
const noNote = (s: string) => s.replace(/\s*\((a chave|the) [^)]*\)$/, "");
type Dict = Record<string, string>;

function keysWith(en: Dict, pt: Dict, e: string, p: string) {
  return Object.keys(en).filter((k) => norm(en[k]!) === norm(e) && norm(pt[k] ?? "") === norm(p));
}

describe("C97 the copy of design.md", () => {
  it("C97 the table holds 41 rows, the journal line the engine's (pt-BR only)", () => {
    expect(ROWS).toHaveLength(41);
    expect(JOURNAL).toHaveLength(1);
    expect(JOURNAL[0]![2]).toBe("-");
  });

  it.each(KEYED)("C97 %s: %s · %s are keys of en and ptBR with that text", (where, pt, english) => {
    const [en, ptBR] = (where === "sentinela" ? [apps.en, apps.ptBR] : [brain.en, brain.ptBR]) as unknown as [
      Dict,
      Dict,
    ];
    const p = noNote(pt);
    const e = noNote(english);
    const whole = keysWith(en, ptBR, e, p);
    if (whole.length > 0) return;
    const pts = p.split(" · ");
    const ens = e.split(" · ");
    expect(ens.length, `${p} | ${e}`).toBe(pts.length);
    pts.forEach((one, i) => {
      expect(keysWith(en, ptBR, ens[i]!, one), `${one} | ${ens[i]}`).not.toEqual([]);
    });
  });

  it("C97 the toast of G21: Reativado: {title}. / Reactivated: {title}.", () => {
    expect(
      keysWith(brain.en as Dict, brain.ptBR as Dict, "Reactivated: {title}.", "Reativado: {title}."),
    ).toEqual(["weekly.toast.reactivated"]);
  });

  it("C97 both locales hold the same keys, in brain.ts and in apps.ts", () => {
    expect(Object.keys(brain.ptBR).sort()).toEqual(Object.keys(brain.en).sort());
    expect(Object.keys(apps.ptBR).sort()).toEqual(Object.keys(apps.en).sort());
  });
});
