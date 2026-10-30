import { normalizeFieldKey } from "./fields.js";
import { proseOf } from "./linkParser.js";

/**
 * The nature of what the second brain holds (.specs/features/cerebro-natureza, doors 1 and 2): what a note or a
 * passage is with regard to reality (`natureza`) and whose it is (`escopo`). Pure: no database, no file.
 *
 * `files.fields` keeps whatever text the header or an inline field gave (cerebro-organizar, door 6); the closed lists
 * hold where the nature is READ (amendment 2): a value outside them reads as absent, never as a nature.
 */

export const NATUREZAS = ["fato", "opiniao", "plano", "hipotese", "relato"] as const;
export type Natureza = (typeof NATUREZAS)[number];
export const ESCOPOS = ["pessoal", "equipe", "externo"] as const;
export type Escopo = (typeof ESCOPOS)[number];

/** The longest cadence `review_every` may say, in days (door 1). */
export const MAX_REVIEW_DAYS = 3650;

const isNatureza = (value: string): value is Natureza => (NATUREZAS as readonly string[]).includes(value);
const isEscopo = (value: string): value is Escopo => (ESCOPOS as readonly string[]).includes(value);

/** The `natureza` of a file's fields, compared after `normalizeFieldKey`; null when absent or outside the list. */
export function readNatureza(fields: Readonly<Record<string, string>>): Natureza | null {
  const raw = fields.natureza;
  if (raw === undefined) return null;
  const value = normalizeFieldKey(raw);
  return isNatureza(value) ? value : null;
}

/** The `escopo` of a file's fields, compared after `normalizeFieldKey`; null when absent or outside the list. */
export function readEscopo(fields: Readonly<Record<string, string>>): Escopo | null {
  const raw = fields.escopo;
  if (raw === undefined) return null;
  const value = normalizeFieldKey(raw);
  return isEscopo(value) ? value : null;
}

/** `review_every` as a cadence: `<n>d` with `n` from 1 to 3650 (days) or `never`; null for anything else (door 1). */
export function readReviewEvery(fields: Readonly<Record<string, string>>): number | "never" | null {
  const raw = fields.review_every;
  if (raw === undefined) return null;
  const value = normalizeFieldKey(raw);
  if (value === "never") return "never";
  const match = /^([1-9][0-9]{0,3})d$/.exec(value);
  if (!match) return null;
  const days = Number(match[1]);
  return days <= MAX_REVIEW_DAYS ? days : null;
}

/** A comma-separated list of natures as a query or a flag gives it; null when any item is outside the list. */
export function parseNaturezaList(raw: string): Natureza[] | null {
  const items = raw.split(",");
  return items.every(isNatureza) ? (items as Natureza[]) : null;
}

/** A comma-separated list of scopes as a query or a flag gives it; null when any item is outside the list. */
export function parseEscopoList(raw: string): Escopo[] | null {
  const items = raw.split(",");
  return items.every(isEscopo) ? (items as Escopo[]) : null;
}

// ---- passages (door 2) ----------------------------------------------------------------------------------------------

/** One `> [!natureza]` block of a Markdown file: its nature and its first and last lines (1-based, as `note_links`). */
export interface Passage {
  natureza: Natureza;
  startLine: number;
  endLine: number;
}

/** The opening line of a passage: `>` then `[!<one of the five>]`, any case, then nothing or a title. */
const PASSAGE_OPEN = /^>[ \t]*\[!([A-Za-z]+)\][-+]?(?:[ \t].*)?$/;

/**
 * The passages of a Markdown file: each block quote that opens with `> [!fato]`, `> [!opiniao]`, `> [!plano]`,
 * `> [!hipotese]` or `> [!relato]` (the callout of Obsidian, capitals accepted, an optional title after it) and runs to
 * the last `>` line that follows. Nothing inside the front matter or a fenced code block counts (`proseOf`).
 */
export function parsePassages(content: string): Passage[] {
  const lines = proseOf(content).split("\n");
  const out: Passage[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (!lines[i]!.startsWith(">")) continue;
    // A block quote, from its first line to the last `>` line that follows: a passage only when it OPENS with a marker.
    let end = i;
    while (end + 1 < lines.length && lines[end + 1]!.startsWith(">")) end++;
    const natureza = PASSAGE_OPEN.exec(lines[i]!)?.[1]?.toLowerCase();
    if (natureza !== undefined && isNatureza(natureza)) out.push({ natureza, startLine: i + 1, endLine: end + 1 });
    i = end;
  }
  return out;
}

// ---- the block the agents read (AC 15, design.md "Texto do bloco para os agentes") ------------------------------------

/** The six lines of "Natureza da informação", as the compiled AGENTS.md/CLAUDE.md and a memory run's prompt hold them. */
export const NATUREZA_AGENT_BLOCK: readonly string[] = [
  "## Natureza da informação",
  "- Cada nota ou trecho pode ter `natureza`: fato, relato, plano, hipotese ou opiniao (e `escopo`: pessoal, equipe, externo).",
  '- Plano, hipótese e opinião não são a realidade. Nunca os apresente como fato; diga "está planejado", "a hipótese é", "na opinião de".',
  '- Ao citar, diga a natureza do que cita. Trecho sem natureza é "não classificado": diga isso quando a resposta depender dele.',
  "- Para só fatos, use o recall com `natureza=fato`.",
  "- Uma nota com `status: archived` e `abandoned` é uma ideia abandonada: não a trate como intenção atual.",
];
