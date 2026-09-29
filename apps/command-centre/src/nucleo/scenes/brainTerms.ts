/**
 * The Brain scene's key terms (immersive shell): the few words that say what
 * a note is about, and the stars that share them. A TF-IDF over what the
 * graph already knows of every note — title, path, tags, fields, the terms
 * the indexer found in common between similar notes, and whatever text has
 * been read — so it costs nothing extra. Portuguese and English. Pure.
 */

const STOP = new Set(
  // English
  (
    "the and for are but not you all any can had her was one our out day get has him his how man new now old see two way who boy did its let put say she too use that with have this will your from they know want been good much some time very when come here just like long make many more only over such take than them well were what which while about after again also back because before being below between both could does doing down during each even every first into itself last might most must never other same should since still their there these those through under until upon where whether would yet able across already always among another anything around away became become becomes behind beyond cannot done else enough ever everything few further however indeed instead less made makes maybe mine near need needs neither nothing often once others own perhaps please quite rather really seem seems several shall sure then thing things though thus together toward towards unless used using usually various via what whatever whom whose within without yes yours yourself " +
    // Portuguese
    "que com para por uma umas uns dos das nos nas num numa não nao mais mas como sem sobre entre até ate pelo pela pelos pelas este esta estes estas esse essa esses essas isso isto aquele aquela aquilo ele ela eles elas você voce vocês voces seu sua seus suas meu minha meus minhas nosso nossa nossos nossas também tambem quando onde qual quais quem porque pois então entao ainda muito muita muitos muitas pouco pouca cada todo toda todos todas outro outra outros outras mesmo mesma mesmos mesmas depois antes agora sempre nunca aqui ali lá tem têm tinha tinham ter ser são sao foi foram era eram será sera está estao estão estava estavam fazer feito faz fez pode podem poder deve devem vai vão vao ver vez vezes bem sim coisa coisas dia dias ano anos hoje ontem amanhã amanha " +
    // Markdown / file noise
    "md markdown txt http https www com org net html png jpg pdf todo done null true false undefined none file files index"
  ).split(/\s+/),
);

/** Lower-case words of 3–24 letters (digits allowed inside), minus stopwords. */
export function tokenize(text: string): string[] {
  const out: string[] = [];
  const clean = text
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`[^`]*`/g, " ")
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .toLowerCase();
  const re = /[\p{L}][\p{L}\p{N}]*(?:[-'][\p{L}\p{N}]+)*/gu;
  let m: RegExpExecArray | null;
  while ((m = re.exec(clean))) {
    const w = m[0].replace(/'s$/, "");
    if (w.length < 3 || w.length > 24 || STOP.has(w)) continue;
    if (/^\d+$/.test(w)) continue;
    out.push(w);
  }
  return out;
}

export function termCounts(tokens: readonly string[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const t of tokens) m.set(t, (m.get(t) ?? 0) + 1);
  return m;
}

export interface Corpus {
  /** Unique terms of each document (a note), same index as the notes. */
  docs: Array<Set<string>>;
  /** Documents containing each term. */
  df: Map<string, number>;
}

export function buildCorpus(texts: readonly string[]): Corpus {
  const docs = texts.map((t) => new Set(tokenize(t)));
  const df = new Map<string, number>();
  for (const d of docs) for (const t of d) df.set(t, (df.get(t) ?? 0) + 1);
  return { docs, df };
}

export interface KeyTerm {
  term: string;
  score: number;
  /** Times it appears in the note. */
  count: number;
}

/**
 * The note's key terms: frequent in it, rare in the brain. Words in the
 * title or a heading weigh more. A term that is everywhere (in more than
 * half of the notes) is not a key to anything.
 */
export function keyTerms(
  text: string,
  corpus: Pick<Corpus, "df" | "docs">,
  opts: { max?: number; emphasis?: string } = {},
): KeyTerm[] {
  const n = Math.max(1, corpus.docs.length);
  const counts = termCounts(tokenize(text));
  const emph = new Set(tokenize(opts.emphasis ?? ""));
  const out: KeyTerm[] = [];
  let top = 1;
  for (const c of counts.values()) top = Math.max(top, c);
  for (const [term, count] of counts) {
    const df = corpus.df.get(term) ?? 0;
    if (n >= 4 && df > n * 0.5) continue;
    const idf = Math.log((n + 1) / (df + 1)) + 1;
    const tf = 0.4 + (0.6 * count) / top;
    const boost = emph.has(term) ? 1.6 : 1;
    // Single mentions of long-tail words are noise unless emphasised.
    if (count === 1 && !emph.has(term) && counts.size > 40) continue;
    out.push({ term, score: tf * idf * boost, count });
  }
  out.sort((a, b) => b.score - a.score || b.count - a.count || a.term.localeCompare(b.term));
  return out.slice(0, opts.max ?? 8);
}

/** Notes (indices) whose document holds the term, except `self`. */
export function notesWith(term: string, corpus: Pick<Corpus, "docs">, self = -1): number[] {
  const out: number[] = [];
  corpus.docs.forEach((d, i) => {
    if (i !== self && d.has(term)) out.push(i);
  });
  return out;
}

/**
 * Notes that share the most key terms with `self` (not counting the ones in
 * `exclude`, e.g. already linked): "related, but not linked".
 */
export function sharedTermNeighbours(
  terms: readonly string[],
  corpus: Pick<Corpus, "docs">,
  self: number,
  exclude: ReadonlySet<number>,
  max = 6,
): Array<{ index: number; shared: string[] }> {
  const scored: Array<{ index: number; shared: string[] }> = [];
  corpus.docs.forEach((d, i) => {
    if (i === self || exclude.has(i)) return;
    const shared = terms.filter((t) => d.has(t));
    if (shared.length > 0) scored.push({ index: i, shared });
  });
  scored.sort((a, b) => b.shared.length - a.shared.length || a.index - b.index);
  return scored.slice(0, max);
}

/** The terms an indexer "why" carries: "Similar content (76%): settings, area, assign." → the words. */
export function whyTerms(why: string): string[] {
  const m = /:\s*([^.]+)\.?\s*$/.exec(why);
  if (!m || !/similar|parecid|semelhan/i.test(why)) return [];
  return m[1]!
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter((s) => s.length > 0);
}
