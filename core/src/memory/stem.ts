/**
 * The other number of a Portuguese word (.specs/features/cerebro-busca-significado, S2, AC 9 and AC 11): the forms the
 * text query of the search adds to a word so the plural finds the singular and the singular the plural. SQLite's
 * porter stemmer is English and leaves `jornal` and `jornais` apart; this table joins them in the query, not in the
 * index, so nothing stored changes.
 */

/** Each ending and what replaces it, the longest ending first: one rule per word, the first that matches (G4). */
const ENDINGS: ReadonlyArray<readonly [string, readonly string[]]> = [
  ["oes", ["ao"]],
  ["ais", ["al"]],
  ["eis", ["el"]],
  ["ao", ["oes", "aes", "aos"]],
  ["al", ["ais"]],
  ["el", ["eis"]],
  ["il", ["is"]],
  ["ol", ["ois"]],
  ["ns", ["m"]],
  ["m", ["ns"]],
  ["r", ["res"]],
  ["z", ["zes"]],
  ["s", [""]],
];

/** Shorter than this after folding, a word gets no counterpart (AC 11): `pao`, `pes`. */
const MIN_LENGTH = 4;

/**
 * The counterparts of a word already folded (lower case, no accents), in the order of the table: `jornais` → `jornal`,
 * `acao` → `acoes`, `acaes`, `acaos`. A word of fewer than 4 letters, or with no ending of the table, has none.
 */
export function counterparts(word: string): string[] {
  if (word.length < MIN_LENGTH) return [];
  for (const [ending, replacements] of ENDINGS) {
    if (!word.endsWith(ending)) continue;
    const stem = word.slice(0, -ending.length);
    return replacements.map((r) => stem + r);
  }
  return [];
}
