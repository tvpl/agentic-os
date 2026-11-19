# Cérebro: busca por significado checks

Profile: ui
Plan: `.specs/features/cerebro-busca-significado/plan.md`
Design: `.specs/features/cerebro-busca-significado/design.md` (binding for the screen of S7)

142 checks (C1-C137, C138 of `## Correções do lote A`, and C139-C142 added after round 1 of the verification, `## Correções da rodada 1`) in 7 slices + cross-cutting (C137 is an opt-in proof against a real model, never credited as a CI proof) · 8 one-way doors · open questions: none, the plan's three answered by the owner on 15/11/2026 with their recommended defaults (AD-050 c: the model-download and Gemma texts are a draft for the owner's legal review, EmbeddingGemma "Recomendado" with the acceptance on screen and Qwen3 Apache-2.0 beside it; macOS Intel has no local model and uses `http` or `hash`; the new Settings block joins the owner's screen walk after the build and before the independent verifier) · 50 gaps this derivation found (`## Lacunas do plano`, G1-G50), each written into the checks with its default; none blocks the build; G1, G31, G32, G34, G40 and G41 change what an existing pin or an approved sentence reads, and the owner should confirm them.

The plan's slices are kept: S1-S6 are the core, the API and the CLI, "Cross-cutting, API" holds what every new or changed route owes together (the route table, the pins, who may call, the startup assemblies), and S7 is the one screen. A batch cut never splits a check slice.

**Level honesty.** CI has no model, no GPU and no network. Every proof of the `local` provider, of the reranker, of the download and of the child process runs against a STUB, and none of them proves anything about a real model: (a) a fake catalog entry (`tests/helpers/buscaStubs.ts`) whose `hosts` hold only `127.0.0.1`, served by a loopback HTTP server the test controls (byte-exact files, a SHA-256 the test computes, throttling, a 302 to a host outside `hosts`, a connection cut mid-body); (b) a stub child script standing in for the real `@huggingface/transformers` child, speaking the same messages (`embed`, `rerank`, `ping`, `exit`), giving deterministic vectors from a table the test sets (so a "synonym" is a test choice, not a model's), writing its pid and every message it receives to a log the test reads, and crashing or delaying on command; (c) a fake reranker answer (a "yes" probability per candidate text) given by the same stub. The stub is handed to the assembly through the same option the service uses for the real child's entry path, so the plumbing (fork, lazy start, batches, idle exit, restarts, prefixes, what is sent) is proven and the model is not. What only a real model on a real machine can prove is listed in `## Not verified here`; C137 is the one opt-in proof of embedding quality, skipped unless `MORDOMO_REAL_MODEL=1`, and no Coverage row credits it.

Every proof is `npx vitest run <file> -t "<C-id> "` from the repository root (root tests) or `npm run test -w apps/command-centre -- <file> -t "<C-id> "` (UI tests); a test title starts with its check id followed by a space, and every case a check is credited for carries that id in its title (L-062). `E2E` proofs build the CLI and the interface first and then run `MORDOMO_E2E_PORT=4901 npx playwright test --config tests/e2e/playwright.config.ts <spec> -g "<C-id> "`: the e2e server runs `apps/api/dist/cli.js`, so a proof without the build runs yesterday's code (L-056). The same holds for the CLI proofs (`tests/busca.cli.test.ts` spawns `apps/api/dist/cli.js`, as `tests/natureza.cli.test.ts` does, and skips without a build), the installer proof (`tests/busca.packaging.test.ts`, skipped without a build like `tests/memory.packaging.test.ts`) and `bundle:check`: each of those proof lines runs `npm run build` first. New root files: `tests/busca.eval.test.ts` (S1's logic at its own layer: format check, metrics, determinism, abstain counting), `tests/busca.cli.test.ts` (the `mordomo eval` and `mordomo recall` surfaces, build first), `tests/busca.stem.test.ts` (S2), `tests/busca.sections.test.ts` (the section splitter and the embedded text, own layer), `tests/busca.vectors.test.ts` (the vectors phase, the status and the search over sections, through `app.inject`), `tests/busca.migration.test.ts` (migration 34), `tests/busca.embedder.test.ts` (the two embedder routes and the download), `tests/busca.localprovider.test.ts` (the child process with the stub, the walker), `tests/busca.recall.test.ts` (S5 through the route), `tests/busca.abstain.test.ts` (the fusion, the abstention, the hops and the budget at their own layer), `tests/busca.rerank.test.ts` (S6), `tests/busca.access.test.ts` (who may call and the audience differentials of search, status, recall and the reranker, with a twin home recomputed from scratch, L-064, L-066), `tests/busca.contract.test.ts` (the route table, the pins, the settings, the docs and the weight), `tests/busca.packaging.test.ts` (build first) and `tests/busca.realmodel.test.ts` (opt-in, C137). The root files that go through HTTP use `app.inject` against `buildServer` over a real home through a new `tests/helpers/buscaWorld.ts` built on `tests/helpers/memoriaWorld.ts` (owner, device and run headers, `put`, `index`, `update` of the settings, a fixed clock, the stub runtime, the stub catalog server and a loopback `/v1/embeddings` server for `http`). New UI files under `apps/command-centre/src/views/settings/`: `semanticSearch.test.tsx`, `semanticSearchCopy.test.ts` and `semanticSearchMotion.test.ts`; the E2E spec is `tests/e2e/busca.spec.ts`.

"Now" in every claim is a fixed clock the test sets (2026-11-16 10:00 local). No claim of this feature names a local day, so no proof pins a time zone; the idle exit of the child (120 s), the progress poll (1 s) and the reranker's timeout are measured with fake timers or a delay the stub is told. A claim that names a status and a code asserts both. A claim that says "as before" or "unchanged" asserts the value by name (L-044); a claim about a stored value reads back what the pass or the route wrote, never a row the test seeded (L-051); every list writer has a one-item case (L-050); every bound has its accepted edge and its refused edge (L-057); every option is proven to reach the result (L-058); a rule a first pass also applies is proven with a second pass (L-059); every UI mock answers by the query or body it receives and fails on one it was not given (L-052); a claim about where something sits on screen asserts the order of the elements (L-046), and one that says "to the right" also asserts rendered geometry in a browser (L-069); a row naming two attributes of a member has a proof of each (L-068).

## Checks

### S1 - medir a busca (plan S1, door 6) · 8 files · 129 KB · ~32k

**C1** - The evaluation set ships in Portuguese: `tests/fixtures/pt-corpus/` holds exactly 40 `.md` notes and `tests/fixtures/pt-queries.json` is `{ "v": 1, "queries": [...] }` with exactly 60 queries, 12 of each kind `single`, `multi`, `latest`, `window` and `abstain` (counted by kind); every `expect` of a non-`abstain` query is a non-empty list whose every path names a file of `tests/fixtures/pt-corpus/` (relative to it, G10); every `multi` query has at least 2 paths; every `abstain` query has `expect: []`; the file passes the eval's own format check (the function `mordomo eval` uses) (AC 1, door 6, G10)
Proof: `npx vitest run tests/busca.eval.test.ts -t "C1 "`

**C2** - The metrics at their own layer, on a hand-built ranking with no index (`evalMetrics(rankings, queries)`): five non-`abstain` queries whose first expected path is at rank 1, 3, 4, 20 and 21 give `1-recall@20` 0.800 (rank 20 counts, rank 21 does not), `hit@3` 0.400 (rank 3 counts, rank 4 does not) and `mrr` 0.327 ((1 + 1/3 + 1/4 + 1/20 + 0) / 5 = 0.32667, rounded half up to 3 decimals); a `multi` query with `expect: [a, b]` and only `b` at rank 2 counts as found with reciprocal rank 0.5 (the first expected path found, G7); with exactly one query at rank 1, all three read 1.000 (AC 2, G7, L-050, L-057)
Proof: `npx vitest run tests/busca.eval.test.ts -t "C2 "`

**C3** - `abstain` queries at their own layer: with 2 non-`abstain` queries found at rank 1 and 3 `abstain` queries whose recall answers `abstained: true`, `false` and `true`, the metrics read `1-recall@20` 1.000, `mrr` 1.000, `hit@3` 1.000 (the three `abstain` queries are in no denominator) and `abstainCorrect` `2/3`; a non-`abstain` query the recall abstains on counts as not found in the `hybrid` row (an empty ranking, G6) (AC 6, G6)
Proof: `npx vitest run tests/busca.eval.test.ts -t "C3 "`

**C4** - `mordomo eval <file>` over a home of 3 notes indexed with `hash` and a file of 2 queries (1 `single` found at rank 1, 1 `abstain`) prints on standard output exactly the five lines `and 1-recall@20=1.000 mrr=1.000 hit@3=1.000`, then `or …`, `semantic …`, `hybrid …` in that order with their values to 3 decimals, then `abstainCorrect=1/1` (G8); standard error is empty and the exit code is 0 (AC 2, G8)
Proof: `npm run build && npx vitest run tests/busca.cli.test.ts -t "C4 "`

**C5** - `mordomo eval <file> --json` prints one JSON object and nothing else (standard output parses whole as JSON, with only the final newline after it): `{ "modes": { "and": { "1-recall@20": 1, "mrr": 1, "hit@3": 1 }, "or": {…}, "semantic": {…}, "hybrid": {…} }, "abstainCorrect": { "n": 1, "total": 1 } }` (G8), the numbers equal to the text run's, the `modes` keys in that order and no `rerank` key; exit 0, standard error empty (AC 3, G8)
Proof: `npm run build && npx vitest run tests/busca.cli.test.ts -t "C5 "`

**C6** - A bad file, one case each, prints nothing on standard output, exits 2 and names the first bad position on standard error as `eval: <position>: <reason>` (G9): a file that is not JSON → `file`; `"v": 2` → `file`; `queries` not a list → `file`; a path that does not exist → `file`; `queries[3]` with `kind: "other"` → `queries[3]`; `queries[0]` with `expect: "a.md"` → `queries[0]`; `queries[1]` with `q: ""` → `queries[1]`; a query with no `q` → its index; with `queries[2]` and `queries[5]` both bad, `queries[2]` is named (AC 4, door 6, G9)
Proof: `npx vitest run tests/busca.eval.test.ts -t "C6 "`
Proof: `npm run build && npx vitest run tests/busca.cli.test.ts -t "C6 "`

**C7** - Two runs over the same file and the same index print byte-identical standard output, in text and in `--json`, over `tests/fixtures/pt-queries.json` with `hash`; at the eval's own layer, two calls over the same rankings return equal objects (AC 5)
Proof: `npx vitest run tests/busca.eval.test.ts -t "C7 "`
Proof: `npm run build && npx vitest run tests/busca.cli.test.ts -t "C7 "`

**C8** - With the provider `hash`, and with `memory.embeddings.enabled` false (off), a run of the eval over `tests/fixtures/pt-queries.json` calls the global `fetch` 0 times and `child_process.fork` 0 times (spied); with the search off the `semantic` row reads `1-recall@20=0.000 mrr=0.000 hit@3=0.000` and the `hybrid` row is the recall's text-only order (G6) (AC 7, G6)
Proof: `npx vitest run tests/busca.eval.test.ts -t "C8 "`

**C9** - With `memory.recall.rerank.enabled` true and the stub reranker `ready`, the text output has six lines with `rerank …` right after `hybrid …` and before `abstainCorrect=…`, and the JSON's `modes` keys are `and`, `or`, `semantic`, `hybrid`, `rerank` in that order; with it off (disabled, or no reranker `ready`) neither has a `rerank` entry (AC 8)
Proof: `npx vitest run tests/busca.eval.test.ts -t "C9 "`

**C10** - The independent test of S1: `mordomo eval tests/fixtures/pt-queries.json` over `tests/fixtures/pt-corpus/` indexed with `hash` exits 0 and prints the four mode rows and `abstainCorrect=<n>/12`, each number equal by value to the baseline the builder records once from this run in the test (G11), so a later change to the search moves a pinned number instead of passing silently (AC 1, AC 2, G11)
Proof: `npm run build && npx vitest run tests/busca.cli.test.ts -t "C10 "`

### S2 - o português nas palavras (plan S2) · 6 files · 105 KB · ~26k

**C11** - The number endings of AC 9 at their own layer (`counterparts(<folded word>)`), one asserted case per row, each a set by value: `piao` → `pioes`, `piaes`, `piaos` (`ao`); `pioes` → `piao` (`oes`); `jornal` → `jornais` (`al`); `jornais` → `jornal` (`ais`); `papel` → `papeis` (`el`); `papeis` → `papel` (`eis`); `barril` → `barris` (`il`); `farol` → `farois` (`ol`); `homem` → `homens` (`m`); `homens` → `homem` (`ns`); `colher` → `colheres` (`r`); `rapaz` → `rapazes` (`z`); `rios` → `rio` (`s` alone); and one rule per word, the longest ending first (G4): `pioes` gives only `piao` (not also `pioe`), `jornais` only `jornal`, `homens` only `homem`, `papeis` only `papel`; `flores` falls to `s` alone and gives `flore` (G3) (AC 9, G3, G4)
Proof: `npx vitest run tests/busca.stem.test.ts -t "C11 "`

**C12** - The length edge after accent folding, at its own layer and through `GET /api/memory/search?mode=text`: `pão` (`pao`, 3 letters) and `pés` (`pes`, 3) get no counterparts, `ação` (`acao`, exactly 4) gets `acoes`, `acaes`, `acaos` and `rios` (exactly 4) gets `rio`; through the route, `q=ação` lists a note whose only form is `ações`, and `q=pão` does not list a note whose only form is `pães` (AC 11, L-057)
Proof: `npx vitest run tests/busca.stem.test.ts -t "C12 "`

**C13** - Through `GET /api/memory/search?mode=text`, one case per direction that today's search misses (the folded word, not the stemmed keyword, is expanded, G2): `jornais` lists a note holding only `jornal`, and `jornal` one holding only `jornais`; `papel` lists `papéis`; `homens` lists `homem`; `farol` lists `faróis`; `rios` lists `rio`; `devolução` lists a note holding only `devoluções`; `jornais papel` lists a note holding `jornal` and `papéis` among the files that hold every word (the first group of `searchFiles`) (AC 9, AC 10, G2)
Proof: `npx vitest run tests/busca.stem.test.ts -t "C13 "`

**C14** - AC 10's example by value: `q=devoluções reclamações solicitações` in `mode=text` lists `politica-de-devolucao.md` first; each of the six `other-number` questions of `tests/fixtures/semantic-morphology.json` has its note in the top 3 of the every-word query of `searchFiles` (words AND) and of its any-word query (words OR), both exported for the test (G1) (AC 10, G1)
Proof: `npx vitest run tests/busca.stem.test.ts -t "C14 "`

**C15** - The strict query is not expanded: `strictWordsSearch` for `devoluções` sends the FTS query `"devoluções"*` exactly (the query builder's output asserted) and lists no `politica-de-devolucao.md`; the morphology table of cerebro-v2's C46 still reads `[other-number, false, false, true, true]` six times and `[control, true, true, true, true]` twice, and the strict AND of the 12-question corpus still finds 5, the same five by question text; the look-alike `zoom` (ends in `m`) has the counterpart `zoons` in the any-word query only, the strict query for it is `"zoom"*`, and `q=zoom` still lists the note `zoom` first (AC 12, AD-037, L-054)
Proof: `npx vitest run tests/busca.stem.test.ts -t "C15 "`
Proof: `npx vitest run tests/memory.semantic.test.ts -t "C46 "`

**C16** - `hashEmbed` and its id are unchanged: the SHA-256 of `vectorToBlob(hashEmbed(<a fixed 400-character Portuguese text with plurals>))` equals the golden value the builder records from the base `c2b510b` before touching S2; `HASH_PROVIDER_ID` is `hash-v1:256`; `stemLite` gives by value `devolucoes` → `devolucao`, `jornais` → `jornai`, `flores` → `flor`, `homem` → `homem` as on the base (the hash provider stems with it) (AC 13)
Proof: `npx vitest run tests/busca.stem.test.ts -t "C16 "`

**C17** - No stored vector is recomputed by S2: a second index pass over an unchanged corpus with `hash` calls the provider's `embed` 0 times (spied) and every `section_vectors.vec` reads back byte-identical to the first pass's (AC 13, L-059)
Proof: `npx vitest run tests/busca.stem.test.ts -t "C17 "`

**C18** - The expansion lives only in the text query of the search (G5): the recall's per-keyword FTS term is still `"<keyword>"*` (the term builder asserted), and with the embeddings off the recall's `candidates` (paths, scores, `why`) for `jornais` over a home with `jornal.md` and `jornais.md` equal, by value, the answer recorded on the base (AC 9, G5, L-044)
Proof: `npx vitest run tests/busca.stem.test.ts -t "C18 "`

### S3 - a seção é a unidade do significado (plan S3, door 1) · 13 files · 222 KB · ~56k

**C19** - The Markdown splitter at its own layer, one asserted case each: H1 to H6 (`#` to `######` followed by a space) each start a section; `####### x` (7) and `#x` (no space) do not; `# x` inside a ` ``` ` fence and inside a `~~~` fence does not; the text before the first heading is the section `(top)`; a setext `Título\n======` is not a heading (its two lines are body); a heading with an empty body gives no row, and its title is still in its children's path; a CRLF file gives the same rows as its LF twin, with no `\r` in any heading or body (AC 14, G47)
Proof: `npx vitest run tests/busca.sections.test.ts -t "C19 "`

**C20** - Files that are not Markdown are cut in blocks of 40 lines: a `.txt` of exactly 40 lines (with a final newline) gives 1 row (`start_line` 1, `end_line` 40), one of 41 lines gives 2 (the second `start_line` 41, `end_line` 41) and one of 80 gives 2; a `.markdown` file splits by headings like `.md`; a `.json` and a `.pdf` get no row (AC 14, L-057)
Proof: `npx vitest run tests/busca.sections.test.ts -t "C20 "`
Proof: `npx vitest run tests/busca.vectors.test.ts -t "C20 "`

**C21** - What an index pass writes, read back from `section_vectors`: a note `# A`, `## B`, `### C` with a body under each gives 3 rows `ord` 0, 1, 2 with `heading` `A`, `A > B`, `A > B > C` (G13) and their `start_line`/`end_line` by value; an H1 `A` followed by an H3 `C` gives `A > C`; an H2 `D` after `### C` gives `A > D`; a preamble is `ord` 0 with `heading` `(top)`; a note with one section gives one row (L-050); `ord` runs 0..n-1 with no gap when an empty section is skipped; `provider`, `dim`, `mtime` and `size` are the provider's and the file's; `PRAGMA table_info(section_vectors)` equals door 1's ten columns (name, type, notnull, pk) with the key `(file_id, ord)` (AC 14, AC 16, door 1, G13)
Proof: `npx vitest run tests/busca.vectors.test.ts -t "C21 "`

**C22** - The 64-section limit: a note with exactly 64 non-empty sections has 64 rows (`ord` 0..63); one with 65 has 64, and no row carries the 65th heading (AC 15, L-057)
Proof: `npx vitest run tests/busca.vectors.test.ts -t "C22 "`

**C23** - The embedded text, captured by a recording provider at its own layer and through a pass: area `Vendas`, note title `Política de devolução`, heading path `Prazos > Exceções` and body `Até 30 dias.` give exactly `Vendas > Política de devolução > Prazos > Exceções\nAté 30 dias.`; with no area, `Política de devolução > Prazos > Exceções\nAté 30 dias.`; the preamble and a block of a `.txt` add no path part (`Vendas > Política de devolução\n…`, G12); with a provider of `maxChars` 100, a text of exactly 100 characters is sent whole and one of 101 is cut to its first 100 (AC 16, G12, L-057)
Proof: `npx vitest run tests/busca.sections.test.ts -t "C23 "`

**C24** - Only what changed is recomputed, with a spy on the provider's `embed` (L-059, a second pass): three notes indexed; then one note's text changes (its `mtime` and size) and the next pass sends exactly that note's section texts (count = its sections) while the other two notes' rows read back byte-identical; a section removed from the changed note has its row deleted and the remaining `ord` run with no gap; a third pass with nothing changed sends nothing; a deleted file has no row left (AC 17, Observable "retries and duplicates", G45)
Proof: `npx vitest run tests/busca.vectors.test.ts -t "C24 "`

**C25** - A difference of provider, dimension or model recomputes every row, one case each, every row read back after the pass: `hash` → `http` (loopback server, 8 dimensions) gives `provider` `http:<model>:8` on every row; `dimensions` 8 → 16 gives `dim` 16 on every row; with the stub catalog, `local.model` A → B gives `local:<B>:<dims>` on every row (G16); `memory.embeddings.enabled` false empties the table (0 rows) and `GET /api/memory/status` reads `semantic.sections` 0 (AC 18, G16, L-058)
Proof: `npx vitest run tests/busca.vectors.test.ts -t "C25 "`

**C26** - A provider failure mid-pass keeps what was written: an `http` server answering `500` to the second batch leaves the first batch's rows, `index.semantic_error` reads back from `meta` as `{ at, kind: "status", message }`, the pass ends with `index.finished` on the bus, and `GET /api/memory/status` reads `semantic.error` with that message; the next pass with the server fixed fills the rest and `semantic.error` reads `null` (AC 19, Observable "scheduled task")
Proof: `npx vitest run tests/busca.vectors.test.ts -t "C26 "`

**C27** - `http` never sends what today's policy refuses (`rowFilter`, G17): with a file under an `excludes` pattern, one under the home's `config/` and one in a folder whose grant was revoked after a pass, each holding a unique token, no request body the loopback server received holds any of the three tokens; a file whose folder is `hide` for devices only (owner reads it) is embedded, and no device answer counts, ranks or names it (C28) (AC 20, G17)
Proof: `npx vitest run tests/busca.vectors.test.ts -t "C27 "`

**C28** - The audience differential of the search and the status (L-066, L-064): a device for which one folder is `hide` and a twin home that never had that folder's files, indexed from nothing with the same provider; with N = 1 and N = 60 hidden notes nearer to each question than the visible ones, for six questions in `mode=semantic` and `mode=auto`, the device's `GET /api/memory/search` answer equals the twin's (`toEqual` over path, order, `score`, `via`, `section`, `line`), and its `GET /api/memory/status` `semantic.sections` and `semantic.vectors` equal the twin's (AC 20, AC 24, G44)
Proof: `npx vitest run tests/busca.access.test.ts -t "C28 "`

**C29** - A semantic hit names its best section: a note with three sections and the question a phrase of the second gives, in `mode=semantic` and `mode=auto`, a hit with `section: "Nota > Segunda"` and `line` = that section's first body line (G13); a file's similarity is its best section's: at its own layer, a file with one section at 0.9 ranks above a file with three sections at 0.6; a `mode=text` hit has no `section` and no `line` key (G13) (AC 21, Surface)
Proof: `npx vitest run tests/busca.vectors.test.ts -t "C29 "`

**C30** - Migration 34 over a populated database at 33: before it, `file_vectors` holds rows; after it, `sqlite_master` has no `file_vectors` and has `section_vectors` with 0 rows, the rows of `files`, `note_links`, `loop_decisions` and `weekly_reviews` are byte-identical to before, `GET /api/memory/status` reads `semantic.vectors` 0 and `semantic.sections` 0, and the next pass fills `section_vectors`; opening the database again applies nothing; `MIGRATIONS.at(-1)` is `{ version: 34, name: "section-vectors" }` (AC 22, door 1)
Proof: `npx vitest run tests/busca.migration.test.ts -t "C30 "`

**C31** - `GET /api/memory/status` answers `semantic` with exactly `enabled`, `provider`, `backend`, `vectors`, `sections`, `model`, `blocked`, `error`, and `local` only when the provider is `local` (G15): with `hash` on over 3 notes of 2, 1 and 3 sections, `sections` 6, `vectors` 3 (files with a row, G14) and `model` `null`; with the stub catalog's model active, `model` is its id; a device with a hidden folder reads `sections` without the hidden rows; the owner with `context=<id>` reads the same `semantic` as without it (G14) (AC 23, Surface, G14, G15)
Proof: `npx vitest run tests/busca.vectors.test.ts -t "C31 "`

**C32** - The readers of the old table read sections, and the search's own refusals stay: with `hash` on and 0 section rows, `mode=auto` answers by value what `mode=text` answers and `mode=semantic` answers `[]` (the "no vectors" shortcut, G45); `mode=other` answers `400 validation`, `context=nao-existe` `404 context_not_found` and `mode=semantic` with the search off `409 semantic_disabled`, each as before; no source file under `core/`, `apps/` or `contracts/` names `file_vectors` outside migration 21's and 34's SQL (AC 22, Surface, G45)
Proof: `npx vitest run tests/busca.vectors.test.ts -t "C32 "`

**C33** - The two backends rank sections the same way: with sqlite-vec loaded and with the loader failing, the same question gives the same sections in the same order, a tie (distance within 1e-6) going to the lower file id then the lower `ord` on both (door 1, cerebro-v2 C47's shape over sections)
Proof: `npx vitest run tests/busca.vectors.test.ts -t "C33 "`

**C34** - Concurrency of passes: two `POST /api/memory/index` sent together give one pass at a time (the second as today's host answers it), and after both the table holds exactly one row per `(file_id, ord)` and as many rows as sections; a `mordomo eval` run while a pass runs exits 0 with its five lines (Swept concurrency)
Proof: `npx vitest run tests/busca.vectors.test.ts -t "C34 "`
Proof: `npm run build && npx vitest run tests/busca.cli.test.ts -t "C34 "`

**C35** - The search reads every row in JavaScript in O(sections): with the JavaScript backend forced and 20 000 section rows of 256 dimensions, one `mode=semantic` search answers in under 1 000 ms on the test machine (Assumptions "Custo de busca em JavaScript", G48)
Proof: `npx vitest run tests/busca.vectors.test.ts -t "C35 "`

**C36** - The splitter is shared, not copied: the recall's `openFile` and the vectors phase call the same exported section function (one definition, asserted by import identity), and the recall's sections of a note equal by value what `splitSections` gave on the base for the same text (Flow 1, "sem mudar o recall")
Proof: `npx vitest run tests/busca.sections.test.ts -t "C36 "`

**C37** - A file whose text has no letter or digit in a section gets no row for that section, and a section whose vector is all zeros (only stop words with `hash`) gets no row and leaves no older row behind (cerebro-v2's rule kept per section) (AC 14)
Proof: `npx vitest run tests/busca.vectors.test.ts -t "C37 "`

**C38** - The vectors phase announces progress as before over sections: `index.progress` events with `phase: "vectors"` carry `scanned` and `total` counted in sections, the last one with `scanned` = `total` (Observable "scheduled task")
Proof: `npx vitest run tests/busca.vectors.test.ts -t "C38 "`

**C39** - The independent test of S3: a note with three titled sections gives three rows with their heading paths, and `GET /api/memory/search?q=<a phrase of the second section>&mode=semantic` answers the note with `section` and `line` of the second (AC 14, AC 21)
Proof: `npx vitest run tests/busca.vectors.test.ts -t "C39 "`

**C40** - Sections and the pass's write lock: the vectors phase writes each batch's rows in one transaction, so a reader during a pass sees either all or none of a batch (a reader polling between batches never counts a partial batch) (AC 17, Swept concurrency)
Proof: `npx vitest run tests/busca.vectors.test.ts -t "C40 "`

### S4 - um modelo de verdade, neste computador ou no seu servidor (plan S4, doors 2, 3, 7, 8) · 19 files · 324 KB · ~81k

**C41** - `GET /api/memory/embedder` as the owner answers `200` `{ active, platform: { ok: true }, models }` with one entry per catalog entry in catalog order, each with exactly `id`, `kind`, `name`, `bytes`, `dimensions` (embedders only), `license: { name, acceptRequired }` and `state: "absent"`, and no `progress` and no `reason` key while absent; `active` is `null` with `hash` and the id of `memory.embeddings.local.model` when the provider is `local` (G23) (AC 25, Surface)
Proof: `npx vitest run tests/busca.embedder.test.ts -t "C41 "`

**C42** - The catalog's literal shape at its own layer, table-driven over its 3 entries × 5 attributes: exactly `embeddinggemma-300m-q4` (`kind: "embedder"`, repo `onnx-community/embeddinggemma-300m-ONNX`, 768 dimensions, license `Gemma` with `acceptRequired: true`), `qwen3-embedding-0.6b-q4f16` (`embedder`, `onnx-community/Qwen3-Embedding-0.6B-ONNX`, 1024 dimensions, `Apache-2.0`, `acceptRequired: false`) and `qwen3-reranker-0.6b-q4` (`reranker`, `onnx-community/Qwen3-Reranker-0.6B-ONNX`, no `dimensions`, `Apache-2.0`, `false`), in that order; every file has a `path`, `bytes` > 0 and a `sha256` of 64 hex digits; every `hosts` entry is in `legal/network-policy.json`'s model-repository entry; each embedder has `maxChars` > 0 and `minSimilarity` in (0, 1); `queryPrefix` and `documentPrefix` are strings or absent; the values themselves are the builder's from the real files (G39) (door 3, G39)
Proof: `npx vitest run tests/busca.embedder.test.ts -t "C42 "`

**C43** - Install against the stub host: `POST /api/memory/embedder {action: "install", id: <stub entry>, acceptTerms: true}` answers `200 { state: "downloading" }` before the first byte is served; a `GET` while the server throttles reads `downloading` with `progress: { done, total }`, `total` = the sum of the entry's `bytes` and `done` never decreasing across reads; it ends `ready`; each file is at `<home>/models/<id>/<path>` byte-equal to what was served; the sequence of states the `GET`s read is exactly `absent`, `downloading`, `ready` (AC 27, door 8, Observable "what the person does next")
Proof: `npx vitest run tests/busca.embedder.test.ts -t "C43 "`

**C44** - Terms: an entry with `acceptRequired: true` without `acceptTerms`, and with `acceptTerms: false`, answers `400 terms_not_accepted`, the stub server receives 0 requests and `<home>/models/<id>/` does not exist; an entry with `acceptRequired: false` installs without `acceptTerms` (AC 28)
Proof: `npx vitest run tests/busca.embedder.test.ts -t "C44 "`

**C45** - A checksum mismatch (the server serves one byte changed): the file is deleted (no file of the entry under `<home>/models/<id>/`), the `GET` reads `state: "failed"`, `reason: "checksum"`, and with `provider: "local"` and that `local.model` the status reads `blocked: "model_missing"` (the model is not activated) (AC 29)
Proof: `npx vitest run tests/busca.embedder.test.ts -t "C45 "`

**C46** - Redirects: a `302` to `http://localhost:<another port>/x` (`localhost` is not in the stub entry's `hosts`) stops the download, deletes the partial files, reads `failed` with `reason: "host_not_allowed"`, and the other server receives 0 requests; a `302` to another path of `127.0.0.1` (in `hosts`) is followed and the model ends `ready` (AC 30, door 3)
Proof: `npx vitest run tests/busca.embedder.test.ts -t "C46 "`

**C47** - A network failure (the server cuts the connection mid-body) deletes the partial files and reads `failed` with `reason` = `network: <the error's message>` (G21); a later `install` of the same id starts again from nothing and ends `ready` (AC 68's reasons, G21, Swept dependency failure)
Proof: `npx vitest run tests/busca.embedder.test.ts -t "C47 "`

**C48** - One download at a time and the refused bodies, each alone with no request to the server and no folder written: `install` of another id while one downloads → `409 download_in_progress`, and of the same id → `409 download_in_progress`; two `install`s sent together → one `200` and one `409 download_in_progress`; an unknown `id` (`nao-existe`, and `../x`) → `404 model_not_found`; no `id` → `400 validation`; `action: "delete"` → `400 validation`; `acceptTerms: "yes"` → `400 validation` (AC 31, door 8, Swept concurrency)
Proof: `npx vitest run tests/busca.embedder.test.ts -t "C48 "`

**C49** - `cancel` during a download answers `200`, the server sees the connection aborted, `<home>/models/<id>/` holds no file, and the `GET` reads `absent`; `cancel` with nothing downloading answers `200` with the model's state unchanged (G22); after a `cancel`, `install` again ends `ready` (AC 32, G22)
Proof: `npx vitest run tests/busca.embedder.test.ts -t "C49 "`

**C50** - `remove` of a `ready` model that is not active answers `200`, its folder is gone and the `GET` reads `absent`; of the active one (`provider: "local"` and `local.model` = its id, G23) answers `409 model_in_use` and its folder is byte-identical; of an `absent` model answers `200 { state: "absent" }` (G22) (AC 33, G22, G23)
Proof: `npx vitest run tests/busca.embedder.test.ts -t "C50 "`

**C51** - A platform without the runtime, one case each through the platform the assembly is given: `darwin`/`x64`, and `linux`/`x64` with the runtime package unresolvable; each `GET` reads `platform: { ok: false, reason: "platform_unsupported" }` and `install` answers `409 local_unavailable` with 0 requests and no folder; `linux`/`x64` with the runtime resolvable reads `platform: { ok: true }` (AC 26)
Proof: `npx vitest run tests/busca.embedder.test.ts -t "C51 "`

**C52** - The child process with the stub: with the stub model `ready` and the provider `local`, no child exists after `GET /api/memory/status` and a `mode=text` search (the stub's pid log is empty); the first `mode=auto` search starts one, whose pid is not `process.pid`; a pass over 17 sections sends batches of exactly `[8, 8, 1]` and one over exactly 8 sections `[8]`; the service process never resolves `@huggingface/transformers` (a spy on module resolution records no call for it) (AC 34, door 2)
Proof: `npx vitest run tests/busca.localprovider.test.ts -t "C52 "`

**C53** - The static walker (L-048): from `apps/api/src/cli.ts`, `apps/api/src/server.ts` and `core/src/memory/indexWorker.ts`, following static `import`, `export … from`, `import()` with a literal, `require` and `createRequire(…)(…)` with their bindings resolved to the import, the specifiers `@huggingface/transformers`, `onnxruntime-node` and `onnxruntime-common` are reached only from the child's entry file, which the service reaches only as the path string given to `child_process.fork`; the walker fails its own self-test case for each spelling it covers (static, dynamic, `require`, `createRequire`, re-export, an aliased binding). It does not cover, and the claim does not reach: a module name computed at run time (`import(variable)`), `process.dlopen`, a `require` reached through `module.constructor`, `Function` or `eval`, and a loader hook (AC 34, door 2, L-048)
Proof: `npx vitest run tests/busca.localprovider.test.ts -t "C53 "`

**C54** - The idle exit with fake timers: after the last request the child is alive at 119 999 ms and has received `exit` and ended at 120 000 ms; the next search starts a new child (a new pid in the log) (AC 35, L-057)
Proof: `npx vitest run tests/busca.localprovider.test.ts -t "C54 "`

**C55** - A child that ends unasked during a pass: told to crash on every batch, the pass starts it 4 times (1 + 3 restarts), stops embedding, records `index.semantic_error` with `kind: "local_crashed"` (read back from `meta`), ends with `index.finished`, and the rows of the batches before the first crash are kept; told to crash once on batch 2, the restarted child takes batch 3 onward, batch 2's sections have no row (owed, G19) and the error is recorded; a third pass with a sound stub fills batch 2's sections and `semantic.error` reads `null` (AC 36, G19, L-059)
Proof: `npx vitest run tests/busca.localprovider.test.ts -t "C55 "`

**C56** - No network while local: with the provider `local`, a pass and a `mode=auto` search call the global `fetch` 0 times (spied) and the stub catalog server receives 0 requests; the real child's source sets `env.allowRemoteModels = false`, `env.allowLocalModels = true` and its model and cache paths to `<casa>/models/` (asserted on the source text), and the network scan finds no site in the child's entry file; the only network site of the local mode is the downloader's `fetch` (AC 37, door 2)
Proof: `npx vitest run tests/busca.localprovider.test.ts -t "C56 "`
Proof: `npx vitest run tests/busca.contract.test.ts -t "C56 "`

**C57** - `action: "test"`, one case per outcome, each answering `200` with `test` by value: `http` against a loopback server of 8 dimensions → `{ ok: true, dimensions: 8, ms }` (`ms` ≥ 0) and the server received exactly one request whose `input` is `[<the fixed phrase>]`; `timeout` (`AbortSignal.timeout` spied to 150 ms, the server never answers), `status` (`500`), `dimension` (9 numbers), `malformed` (not JSON) and `network` (a closed port) → `{ ok: false, kind }`; the stub `local` model → `{ ok: true, dimensions: <the stub's>, ms }`, and a stub told to crash → `{ ok: false, kind: "local_crashed" }`; a provider the policy blocks (`http` to a remote `http:` endpoint) → `400 validation` naming the reason, nothing sent (G24); `hash` → `{ ok: true, dimensions: 256, ms }` (AC 38, G24)
Proof: `npx vitest run tests/busca.embedder.test.ts -t "C57 "`

**C58** - Blocked reads and `auto` as text, one case per reason: `provider: "local"` with its model `absent` reads `blocked: "model_missing"` and `provider: null` in `GET /api/memory/status`; with the platform unsupported, `blocked: "platform_unsupported"`; in both, `GET /api/memory/search?mode=auto` answers by value what `mode=text` answers, and `mode=semantic` answers `409 semantic_disabled` (AC 39, door 7)
Proof: `npx vitest run tests/busca.embedder.test.ts -t "C58 "`

**C59** - Settings of the local model: `PUT /api/settings` with `memory.embeddings.local.model: "nao-existe"` answers `400 validation` and `settings.json` is byte-identical; a catalog id is accepted and read back by `GET /api/settings`; a `settings.json` edited by hand with `local.model: "nao-existe"` reads `local.model` absent, keeps the other `memory.embeddings` fields, and with `provider: "local"` the status reads `blocked: "model_missing"`; `provider: "gemma"` (a fourth value) is `400 validation` through `PUT` and reads `provider: "hash"`, `enabled: false` from a hand-edited file (the existing fail-closed rule) (AC 40, door 7)
Proof: `npx vitest run tests/busca.embedder.test.ts -t "C59 "`

**C60** - Who may call the two routes, through `/api/...` and `/api/v1/...`: a device holding every scope gets `403 owner_only` from `GET /api/memory/embedder` and from `POST /api/memory/embedder` (each `action`); a run's credential gets `403 forbidden` from both; on each refusal the stub server receives 0 requests and a listing of `<home>/models/` and the bytes of `settings.json` are the same before and after (AC 41, door 8, Observable "who may call")
Proof: `npx vitest run tests/busca.access.test.ts -t "C60 "`

**C61** - Prefixes, read from the stub child's log: a stub entry with `queryPrefix: "Q: "` and `documentPrefix: "D: "` gets `D: <the section text>` for each section and `Q: <the question>` for a search; an entry with neither gets the texts unchanged; with `hash` the embedder is called with each section text exactly (no prefix), and with `http` the loopback server's `input` entries equal the section texts exactly; a `documentPrefix` counts toward `maxChars` (G25) (AC 42, G25)
Proof: `npx vitest run tests/busca.localprovider.test.ts -t "C61 "`

**C62** - The new settings close when unreadable, one case each from a hand-edited file: `memory.embeddings.local` = `7` reads absent; `memory.recall.rerank.enabled` = `"yes"` reads `false`; `memory.recall.hops` = `"x"` reads `2`; `memory.recall.abstain` = `"x"` reads `true` (G34); `SETTINGS_FAIL_CLOSED` holds `memory.embeddings.local.model` (closed: absent) and `memory.recall.rerank.enabled` (closed: `false`) and the three rules of `memory.embeddings` it held (AC 54, door 7, G34)
Proof: `npx vitest run tests/busca.contract.test.ts -t "C62 "`
Proof: `npx vitest run tests/data.settings.test.ts -t "C46 "`

**C63** - The status of the local model: with the stub model `ready` and active, `semantic.model` is its id and `semantic.local` is `{ state: "ready", platform: { ok: true } }` (G15); with `hash`, `semantic.model` is `null` and there is no `local` key (AC 23, Surface, G15)
Proof: `npx vitest run tests/busca.embedder.test.ts -t "C63 "`

**C64** - Installs and passes together: an `install` while a pass with `hash` runs ends `ready` and the pass ends `index.finished` with its rows; `remove` of the active local model while a pass runs answers `409 model_in_use`; `cancel` sent while `install`'s first response is in flight leaves `absent` and no file (Swept concurrency)
Proof: `npx vitest run tests/busca.embedder.test.ts -t "C64 "`

**C65** - The model's state survives what it should: after a restart of the context (a new `AppContext` on the same home) a `ready` model reads `ready` (every file with its catalog `bytes` and the install's verification record, G20) and a `failed` one reads `absent`; a file of a `ready` model truncated by hand reads `absent` (G20) (AC 25, G20, Swept data lifecycle)
Proof: `npx vitest run tests/busca.embedder.test.ts -t "C65 "`

**C66** - The installer carries the runtime and no weights: on a Linux x64 build, the staged payload holds `lib/node_modules/@huggingface/transformers` at 4.3.2 and `onnxruntime-node` with only `linux/x64` binaries (no `darwin`, `win32` or `arm64` folder), no file named like `libonnxruntime_providers_cuda*` or `*tensorrt*`, no `onnxruntime-web` folder anywhere, no `*.onnx` file anywhere; the child's entry lands next to `lib/mordomo.mjs` and the bundle names it; the runtime folders add at most 120 MB (Assumptions "Crescimento do instalador"); the proof fails, not skips, when the build is there and the optional dependency is not (door 2, Impact "instalador")
Proof: `npm run build && npx vitest run tests/busca.packaging.test.ts -t "C66 "`

**C67** - The network policy, the privacy text and the notices move together: `legal/network-policy.json` gains one host entry (19 entries, from 18) for the model repository whose `match` holds every catalog `hosts` entry, gated on the owner's `install` (`memory.embeddings.local.model`), default off; the sites are 44 (from 43), the new one the downloader's `fetch` with count 1 (G40); `legal.network` C24 and C25 are green at those values; `legal/PRIVACY.md` names the download (a `GET` of the catalog's files, no note text, the hosts) and says the question of each recall goes where the question of each search goes (G46); `THIRD_PARTY_NOTICES.md` exists and names `@huggingface/transformers` 4.3.2 (Apache-2.0) and `onnxruntime-node` (MIT) (G38); `provider.embed([question]` still occurs exactly once in `core/src/memory/semantic.ts` and `provider.embed(` occurs nowhere in `core/src/memory/recall.ts` (Impact "rede", cerebro-v2 C52, G46)
Proof: `npx vitest run tests/busca.contract.test.ts -t "C67 "`
Proof: `npx vitest run tests/legal.network.test.ts -t "C24 "`
Proof: `npx vitest run tests/legal.network.test.ts -t "C25 "`
Proof: `npx vitest run tests/legal.network.test.ts -t "C52 "`

**C68** - The dependency is exact and optional: `core/package.json` has `"@huggingface/transformers": "4.3.2"` (no range) under `optionalDependencies`, next to `sqlite-vec` `0.1.9`, and not under `dependencies`; `package-lock.json` resolves it at 4.3.2 (door 2)
Proof: `npx vitest run tests/busca.contract.test.ts -t "C68 "`

### S5 - recall híbrido que sabe dizer "não encontrei" (plan S5, door 4) · 12 files · 125 KB · ~31k

**C69** - The fusion at its own layer, on hand-built rankings: text `[A (id 5), B (id 2)]` and vectors `[B, C (id 9)]` with k 60 give `B` (1/61 + 1/61), then `A` (1/61), then `C` (1/62); two files with equal scores go lower id first (`D (id 3)` before `A (id 5)`); a file in neither list is absent (AC 43, Observable "candidatas do recall")
Proof: `npx vitest run tests/busca.abstain.test.ts -t "C69 "`

**C70** - Through `GET /api/memory/recall`, with the stub `local` model whose table makes a note with no word of the question nearest to it: the note is in `answerContext` with the vector section's heading, its file counts once in `candidatesConsidered` and appears once in `candidates` even when the words also find it (AC 43, Observable "um arquivo aparece uma vez")
Proof: `npx vitest run tests/busca.recall.test.ts -t "C70 "`

**C71** - The depth of 50 sections: a file whose only near section is the 50th nearest is added to the candidates and one whose only near section is the 51st is not (neither found by words); with 60 sections of files hidden from a device nearer than the visible ones, the device still gets the 50 nearest sections it may see (the depth counts admitted sections) (AC 43, L-057)
Proof: `npx vitest run tests/busca.recall.test.ts -t "C71 "`

**C72** - Today's filters on every vector candidate, one case each, each file absent from `answerContext`, `candidates` and `candidatesConsidered`: a file under the home's `config/` (`isReadable`); a file outside the `context` (`within`, and its look-alike prefix folder `<R>/projetos/app-antigo/`, L-054); a file hidden from the device's audience; for a run's credential, a file outside `memory/` and its context; and the same four as the target of a followed link (L-055); `context=nao-existe` answers `404 context_not_found` as before (AC 43, L-054, L-055)
Proof: `npx vitest run tests/busca.recall.test.ts -t "C72 "`

**C73** - Which section `openFile` takes from a fused file, one case each: the vector-nearest section scoring higher than the best text section → the vector section, and the context's `section` names it; scoring exactly equal → the vector section; scoring lower → the best text section (AC 44, L-057)
Proof: `npx vitest run tests/busca.abstain.test.ts -t "C73 "`
Proof: `npx vitest run tests/busca.recall.test.ts -t "C73 "`

**C74** - Every answer carries the three keys: a found answer reads `abstained: false`, `abstainReason: null`, `rerank: "off"`; an abstained one `abstained: true` with its reason; through the route, the MCP tool's request and `mordomo recall --json`; the route's response schema declares `abstained` (boolean), `abstainReason` (`"no_match" | "weak" | null`) and `rerank` (the five values) as required keys (AC 45, door 4)
Proof: `npx vitest run tests/busca.recall.test.ts -t "C74 "`

**C75** - `no_match`, one case each, with `memory.recall.abstain` true and with it false (G30): a question of only stop words (`o que é isso?`) → `abstained: true`, `abstainReason: "no_match"`, `answerContext: []`; keywords with no candidate (`xenobiologiaquantica`) → the same (AC 46, G30)
Proof: `npx vitest run tests/busca.recall.test.ts -t "C75 "`

**C76** - The weak rule at its own layer (`decideAbstention`), one asserted case per row (G29): 4 keywords and a section matching exactly 2 → not weak, whatever the cosine; 4 keywords, best match 1, best cosine 0.19 with `minSimilarity` 0.2 → `weak`; best match 1, cosine exactly 0.2 → not weak (equal is not below); best match 1 and no vectors → `weak`; 5 keywords, a section matching 3 → not weak; 5 keywords, best match 2, cosine 0.1 → `weak`; any row with `abstain` false → not weak (AC 47, AC 48, G29, L-057)
Proof: `npx vitest run tests/busca.abstain.test.ts -t "C76 "`

**C77** - The weak rule through the route with `hash` (minimum 0.2): a question whose best section matches 1 of 4 keywords and whose nearest section is under 0.2 answers `abstained: true`, `abstainReason: "weak"`, `answerContext: []`; the same question with the embeddings off (no vectors) also answers `weak` (G31) (AC 47, G31)
Proof: `npx vitest run tests/busca.recall.test.ts -t "C77 "`

**C78** - With `memory.recall.abstain` false set by `PUT /api/settings`, C77's question answers `abstained: false`, `abstainReason: null` and an `answerContext` equal by value to the one this recall gives for it with abstention off (the excerpts the weak match finds, as today), not `[]` (AC 48, L-058)
Proof: `npx vitest run tests/busca.recall.test.ts -t "C78 "`

**C79** - The answer's entries are today's: with the embeddings off and `memory.recall.hops: 1` (G32), cerebro-natureza's C20 recorded answer (`path`, `section`, `excerpt`, `score`, `why`, `via`) and its `natureza` and `escopo` are equal by value, and `tests/api.recall-quality.test.ts`'s four first contexts are the same paths and excerpts; each entry has exactly the keys `path`, `section`, `excerpt`, `score`, `why`, `natureza`, `escopo` and, when followed, `via` (AC 49, L-044, G32)
Proof: `npx vitest run tests/busca.recall.test.ts -t "C79 "`
Proof: `npx vitest run tests/natureza.search.test.ts -t "C20 "`

**C80** - Hops, a chain `A → B → C → D` where each linked section scores higher than the one that pointed to it: `hops` 1 gives A and B, 2 gives A, B, C and 3 gives A, B, C, D, each set through `PUT /api/settings`; each followed entry's `via` is the path that pointed to it (B's is A, C's is B, G32); with C scoring no higher than B, C is not added and D is not reached (G32); `hops` 0 and 4 answer `400 validation` and 1 and 3 are read back (AC 50, AC 54, G32, L-057, L-058)
Proof: `npx vitest run tests/busca.recall.test.ts -t "C80 "`
Proof: `npx vitest run tests/busca.abstain.test.ts -t "C80 "`

**C81** - A link at the second level is followed only to a file the caller may read: a target outside the `context`, one hidden from the device, one not indexed and one under the home's `config/` are not followed and do not appear (L-055) (AC 50)
Proof: `npx vitest run tests/busca.recall.test.ts -t "C81 "`

**C82** - The token budget at its own layer, over the answer in its order (G33): budget 500 with excerpts of 1 996, 8 and 4 characters (499, 2 and 1 tokens) keeps the first, drops the second, keeps the third, and `tokensEstimate` is exactly 500; an excerpt of 2 000 characters alone with budget 500 fits (500); one of 2 004 (501) alone is dropped and `tokensEstimate` is 0; through the route with `tokenBudget: 500` set by `PUT /api/settings` and `excerptChars=2000`, `tokensEstimate` ≤ 500 over every question of the Portuguese corpus (AC 51, G33, L-057, L-058)
Proof: `npx vitest run tests/busca.abstain.test.ts -t "C82 "`
Proof: `npx vitest run tests/busca.recall.test.ts -t "C82 "`

**C83** - The MCP tool `recall` on an abstained answer returns exactly `Nothing found: no indexed section answers this (weak).`, and `Nothing found: no indexed section answers this (no_match).` for `no_match`; a found answer prints as before (`## <path> § <section> (score <n>)` blocks); a non-abstained empty answer prints `No indexed section matched.` as before (AC 52, Observable "texto da abstenção")
Proof: `npx vitest run tests/busca.recall.test.ts -t "C83 "`

**C84** - `mordomo recall "<C77's question>"` prints the line `Nothing found: no indexed section answers this (weak).` as its last line of standard output, prints no `No indexed section matched.`, and exits 0; with `--json` the object has `abstained: true` and `abstainReason: "weak"` (AC 52)
Proof: `npm run build && npx vitest run tests/busca.cli.test.ts -t "C84 "`

**C85** - The audience differential of the recall (L-066, L-064): a device with one folder `hide` and the twin home recomputed from nothing, with N = 1 and N = 60 hidden notes nearer to the questions, for six questions (one abstaining as `weak`, one whose nearest sections are all hidden, one that follows a link): the device's `GET /api/memory/recall` answer equals the twin's in `abstained`, `abstainReason`, `rerank`, `candidatesConsidered`, `keywords` and `answerContext` (paths, sections, order) (AC 53, G44)
Proof: `npx vitest run tests/busca.access.test.ts -t "C85 "`

**C86** - `memory.recall` defaults and bounds: with no `memory.recall` in `settings.json` it reads `{ abstain: true, hops: 2, tokenBudget: 3000, rerank: { enabled: false, candidates: 20, timeoutMs: 15000 } }`; through `PUT /api/settings`, each accepted edge read back and each refused edge answering `400 validation` with `settings.json` byte-identical: `hops` 1, 3 / 0, 4; `tokenBudget` 500, 20000 / 499, 20001; `rerank.candidates` 1, 50 / 0, 51; `rerank.timeoutMs` 1000, 120000 / 999, 120001; `abstain: "yes"` refused; a `PUT` of `memory.recall` without `rerank` reads `rerank` at its default (G43) (AC 54, door 4, G43, L-057)
Proof: `npx vitest run tests/busca.contract.test.ts -t "C86 "`

**C87** - The recall's query flag: `rerank=false` and `rerank=0` are accepted (`rerank: "off"`), `rerank=maybe` answers `400 validation`, and `q` of 2 001 characters `400 validation` as before (Observable "error shape and codes", AC 54)
Proof: `npx vitest run tests/busca.recall.test.ts -t "C87 "`

**C88** - The question is embedded once per recall, through the search's single call: with the stub `local` model, one recall sends exactly one query `embed` message to the child (with `Q: ` when the entry has a `queryPrefix`), and with `http` one request whose `input` is `[<the question>]` (G46) (AC 43, G46)
Proof: `npx vitest run tests/busca.recall.test.ts -t "C88 "`

### S6 - reranker local opcional (plan S6, door 5) · 5 files · 29 KB · ~7k

**C89** - `used`: with `rerank.enabled` true, `candidates: 3` and the stub reranker `ready`, the stub's log shows one `rerank` message holding exactly the texts of the 3 best fused sections, in the fused order; the answer takes them in the order of the stub's "yes" probabilities, then the rest in the fused order; `rerank: "used"` (AC 55, door 5)
Proof: `npx vitest run tests/busca.rerank.test.ts -t "C89 "`

**C90** - The five outcomes, one case each through the route and at the deciding function's own layer: `off` (disabled), `off` (enabled with `rerank=false`), `rerank=true` with it disabled stays `off` (G27), `skipped` (enabled and no reranker `ready`), `skipped` (platform unsupported), `timeout`, `failed` (the stub ends during `rerank`); every outcome but `used` keeps the fused order by value (AC 56, G27)
Proof: `npx vitest run tests/busca.rerank.test.ts -t "C90 "`

**C91** - The timeout's two sides, with `timeoutMs: 1000` set through `PUT /api/settings`: a stub that answers after 1 500 ms gives `rerank: "timeout"` and the fused order, the answer arriving before 1 500 ms; one that answers after 900 ms gives `used`; a late answer is ignored and the next recall's `rerank` reaches the same child (G28) (AC 57, G28, L-058)
Proof: `npx vitest run tests/busca.rerank.test.ts -t "C91 "`

**C92** - The candidates' edges with 60 fused sections: `candidates: 1` sends 1 text, `50` sends 50, and the default sends 20 (AC 55, L-057, L-058)
Proof: `npx vitest run tests/busca.rerank.test.ts -t "C92 "`

**C93** - Only what the caller may read reaches the reranker: no text of a file under `config/`, outside the `context` or hidden from the device is in the stub's log; and the device's answer with the reranker on equals the twin's (L-066) (AC 58)
Proof: `npx vitest run tests/busca.access.test.ts -t "C93 "`

**C94** - The search never reranks: with the reranker enabled and `ready`, `GET /api/memory/search` in `text`, `semantic` and `auto` leaves 0 `rerank` messages in the stub's log (AC 59)
Proof: `npx vitest run tests/busca.rerank.test.ts -t "C94 "`

**C95** - The eval's `rerank` row: the candidate lists the stub receives during `mordomo eval` equal those a recall of each question receives; with a stub that always times out, the `rerank` row equals the `hybrid` row by value (AC 60)
Proof: `npx vitest run tests/busca.eval.test.ts -t "C95 "`

**C96** - An abstained answer never calls the reranker: 0 `rerank` messages, and `rerank` reads `"off"` when disabled or `rerank=false` and `"skipped"` otherwise (G26) (AC 56, G26)
Proof: `npx vitest run tests/busca.rerank.test.ts -t "C96 "`

### Cross-cutting, API · 14 files · 305 KB · ~76k

**C97** - The two new routes are in the `API` table as door 8 says (`toEqual` over method, path and scope): `GET /api/memory/embedder` and `POST /api/memory/embedder`, both `owner`; each declares exactly the (status, code) pairs of `Coverage`; the entries of `GET /api/memory/recall`, `GET /api/memory/search` and `GET /api/memory/status` keep their method, path, scope (`content`, `content`, `monitor`) and errors, and their response schemas gain exactly the keys of the Surface; each new route is in `EXPECTED_ROUTE_SCOPES` and has its row in `docs/security.md`; the OpenAPI document validates; the contracts package still publishes three entry points (door 8, Surface)
Proof: `npx vitest run tests/busca.contract.test.ts -t "C97 "`
Proof: `npx vitest run tests/api.openapi.test.ts -t "C16 the document validates"`
Proof: `npx vitest run tests/device-scopes.test.ts -t "C39 docs list every route"`
Proof: `npx vitest run tests/contracts.test.ts -t "C16 the contracts package publishes exactly three entry points"`

**C98** - The pins move together, each green at its new value: routes 171 → 173 (`tests/api.contract.test.ts` entries, router and sets, `tests/contracts.api.test.ts`, `tests/api.openapi.test.ts` operations); the refusal probe's scenarios 171 → 173 with one scenario per new route; the non-public routes 169 → 171; `EFFECT_ROUTES` stays 23; the raised codes grow by the five of door 8 (`terms_not_accepted`, `model_not_found`, `local_unavailable`, `model_in_use`, `download_in_progress`), each documented (Impact "contratos e pinos")
Proof: `npx vitest run tests/api.contract.test.ts -t "C1 every route of the router has an entry"`
Proof: `npx vitest run tests/api.contract.test.ts -t "C12 every route answers what its entry declares"`
Proof: `npx vitest run tests/api.contract.test.ts -t "C12 a key the schema would fill in is mandatory on the wire"`
Proof: `npx vitest run tests/api.contract.test.ts -t "C13 every error a handler raises is documented"`
Proof: `npx vitest run tests/api.refusals.test.ts -t "C45 the probe runs one scenario for each route"`
Proof: `npx vitest run tests/device-scopes.test.ts -t "C3 the route table is the expected one"`
Proof: `npx vitest run tests/api.openapi.test.ts -t "C15 every route has parameters"`
Proof: `npx vitest run tests/contracts.api.test.ts -t "C58 the table itself is frozen"`

**C99** - The migration pins of the earlier features move to 34 and stay green, each naming `section-vectors` as the last migration; cerebro-v2's `file_vectors` shape pin becomes "absent after 34, `section_vectors` with door 1's shape" (door 1, G45)
Proof: `npx vitest run tests/data.migration.test.ts -t "C7 MIGRATIONS is contiguous"`
Proof: `npx vitest run tests/data.migration.test.ts -t "C56 "`
Proof: `npx vitest run tests/contexts.runs.test.ts -t "C25 "`
Proof: `npx vitest run tests/device-scopes.test.ts -t "C22 "`
Proof: `npx vitest run tests/memoria.migration.test.ts -t "C39 "`
Proof: `npx vitest run tests/natureza.layer.test.ts -t "C7 "`
Proof: `npx vitest run tests/rituais.layer.test.ts -t "C19 "`

**C100** - The settings pins: the top-level keys stay 30; `memory.embeddings` has eight leaves (the seven plus `local.model`); every new leaf (`memory.embeddings.local.model`, `memory.recall.abstain`, `hops`, `tokenBudget`, `rerank.enabled`, `rerank.candidates`, `rerank.timeoutMs`) is classified in C46's table; the list of booleans on by default gains only `memory.recall.abstain` (G34); the `settings.changed` v1 fixture parses with the new leaves (Impact "contratos e pinos", G34)
Proof: `npx vitest run tests/data.settings.test.ts -t "C19 "`
Proof: `npx vitest run tests/data.settings.test.ts -t "C52 "`
Proof: `npx vitest run tests/data.settings.test.ts -t "C63 "`

**C101** - The SDK surface: the public names of `@mordomo/core` are unchanged by name, and the internal barrel gains only the names this feature adds, listed in the test (Impact "contratos e pinos")
Proof: `npx vitest run tests/sdk.surface.test.ts -t "C37 "`
Proof: `npx vitest run tests/sdk.surface.test.ts -t "C38 "`

**C102** - No event is added: `OS_EVENT_TYPES` and the v1 schemas are unchanged by name and `docs/events.md` is byte-identical to the base (the download's progress is read by the `GET`, the failure is in `meta`) (Impact, Swept observability)
Proof: `npx vitest run tests/busca.contract.test.ts -t "C102 "`

**C103** - The raw `fs` allowlist grows by exactly one row, the downloader's writes under `<home>/models/` (in `core/src/models/`, so the rule "the only row under `core/src/memory` is the indexer's scan" holds); and the module-state list does not grow: the child's handle, the download in progress and the idle timer belong to an `AppContext` instance (Test policy evidence)
Proof: `npx vitest run tests/security-reads.test.ts -t "C55 the list holds"`
Proof: `npx vitest run tests/security-reads.test.ts -t "finds nothing outside the list"`
Proof: `npx vitest run tests/sdk.instances.test.ts -t "C30 the module-level mutable state"`

**C104** - Startup assembly, the service: the `AppContext` behind the routes is given the real catalog, `<home>/models/` and the real child's entry path; the test harness passes the stub's through the same option, and nothing else differs (asserted on the option object both build) (Coverage "startup config")
Proof: `npx vitest run tests/busca.localprovider.test.ts -t "C104 "`

**C105** - Startup assembly, the index worker: a pass run in the worker thread (`IndexWorkerHost`) with the provider `local` fills `section_vectors` from the stub, and while it runs together with a `mode=auto` search exactly one child exists (one pid in the stub's log): the worker reaches the service's child through the host and never forks (G18) (AC 34, G18)
Proof: `npx vitest run tests/busca.localprovider.test.ts -t "C105 "`

**C106** - Startup assembly, the CLI offline: the built `mordomo recall` with `provider: "local"` and its model `absent` answers by words (as `text`) and its `--json` reads `abstained` and `rerank: "off"`; `mordomo eval` with `hash` runs with no service (C4); the CLI builds the same `AppContext` the service does (AC 39, AC 7)
Proof: `npm run build && npx vitest run tests/busca.cli.test.ts -t "C106 "`

**C107** - Existing behaviour this feature must not change, each by value through its own proof: cerebro-v2's 12-question corpus (strict AND 5, OR 11, hybrid 11, the one missed the `synonym` question), the `hash` provider (C16), cerebro-memoria-confiavel's device semantic twin (C173) and run differential (C120), cerebro-natureza's search filters (C11-C14), and cerebro-rituais' `PUT /api/memory/tasks` entry (C29) (Impact, AD-037)
Proof: `npx vitest run tests/memory.semantic.test.ts -t "C46 on the fixed corpus"`
Proof: `npx vitest run tests/memoria.access-round2.test.ts -t "C173 "`
Proof: `npx vitest run tests/memoria.access-runs.test.ts -t "C120 "`
Proof: `npx vitest run tests/natureza.search.test.ts -t "C11 "`
Proof: `npx vitest run tests/natureza.search.test.ts -t "C13 "`
Proof: `npx vitest run tests/rituais.contract.test.ts -t "C29 "`

**C108** - The docs: `docs/memory-guide.md` has a section headed `Busca por significado` that names the three providers, how to install Ollama and point `endpoint` at it, the model download and its license step, and `mordomo eval <file> [--json]` with the door 6 format; `docs/security.md` has the rows of C97 (design.md "Rodapé do bloco", door 6)
Proof: `npx vitest run tests/busca.contract.test.ts -t "C108 "`

### S7 - a tela "Busca por significado" (plan S7, design.md) · 23 files · 368 KB · ~92k

**C109** - The block's place and its five parts, in order: in Settings › Memória the second `.card.stack`, after the indexed folders' card; inside it, in order, the header, the provider radiogroup, the chosen provider's detail, the index state line (only with the search on; absent when off) and the footer link; the same in the moldura and the Núcleo (AC 61, design.md "Bloco", L-046)
Proof: `npm run test -w apps/command-centre -- src/views/settings/semanticSearch.test.tsx -t "C109 "`
Proof: `MORDOMO_E2E_PORT=4901 npx playwright test --config tests/e2e/playwright.config.ts busca.spec.ts -g "C109 "`

**C110** - The header, in order: the title "Busca por significado" (13px, weight-600 class), then on its right the state "Ligada" with `CircleCheck` (`--tone-ok` class) or "Desligada" with `CircleDashed` (`--tone-muted` class), then the on/off button with `aria-pressed`; below, "Acha a nota que responde mesmo quando ela não usa as mesmas palavras da pergunta." (12px, secondary class); the button sends `PUT /api/settings` with `memory.embeddings` = the current object with `enabled` flipped, and the kit answers only that body (AC 61, design.md "Cabeçalho", L-052)
Proof: `npm run test -w apps/command-centre -- src/views/settings/semanticSearch.test.tsx -t "C110 "`

**C111** - The provider options: `role="radiogroup"` holding three `role="radio"` in order "Palavras e vetor simples", "Servidor seu", "Modelo neste computador" (13px, weight-600 class), each with its one line (12px): "Funciona sem baixar nada e sem rede. Entende plurais e variações de grafia, não sinônimos.", "Ollama ou outro servidor com o formato OpenAI de embeddings.", "Baixa um modelo e roda aqui, sem enviar nada para fora." (G35); the chosen one has `aria-checked="true"`, `CircleDot` and "Em uso", the others `aria-checked="false"` and `Circle`; choosing another with no ready index sends `PUT /api/settings` with `memory.embeddings.provider` set and no dialog (AC 61, design.md "Provedor", G35, G42)
Proof: `npm run test -w apps/command-centre -- src/views/settings/semanticSearch.test.tsx -t "C111 "`

**C112** - With `platform: { ok: false }`, "Modelo neste computador" is `aria-disabled="true"`, shows `Lock` and, below its description, "Este computador não tem o runtime do modelo local (macOS Intel). Use um servidor seu."; activating it sends no request (AC 64, design.md "Sem runtime")
Proof: `npm run test -w apps/command-centre -- src/views/settings/semanticSearch.test.tsx -t "C112 "`

**C113** - The detail of "Palavras e vetor simples" is only the sentence "Funciona sem baixar nada e sem rede. Entende plurais e variações de grafia, não sinônimos." (G36) (design.md "Detalhe")
Proof: `npm run test -w apps/command-centre -- src/views/settings/semanticSearch.test.tsx -t "C113 "`

**C114** - The detail of "Servidor seu", in order: the `Field`s "Endereço" (mono class), "Modelo", "Dimensões" (`type="number"`) and "Variável da chave" (mono class); the checkbox "Permitir servidor fora deste computador" with, beside it, `AlertTriangle` and "Seus textos e suas perguntas serão enviados para este endereço." (`--tone-warn` class); then "Testar conexão"; each field saves through `PUT /api/settings` with `memory.embeddings` = the current object with that field changed (`sendRemote` for the checkbox), and the kit answers only those bodies (AC 65, design.md "Servidor seu", L-052)
Proof: `npm run test -w apps/command-centre -- src/views/settings/semanticSearch.test.tsx -t "C114 "`

**C115** - "Testar conexão" sends `POST /api/memory/embedder {action: "test"}` exactly, shows "Testando…" with a spinner, then, right after the button, one case per answer: `{ ok: true, dimensions: 768, ms: 143 }` → "OK: 768 dimensões, 143 ms" with `CircleCheck` (`--tone-ok` class); `kind` `timeout` → "Falhou: timeout", `status` → "Falhou: status", `dimension` → "Falhou: dimensão", `malformed` → "Falhou: resposta inválida", `network` → "Falhou: rede", `local_crashed` → "Falhou: o modelo parou", each with `AlertTriangle` (`--tone-warn` class) (AC 65, AC 38, design.md "Teste de conexão")
Proof: `npm run test -w apps/command-centre -- src/views/settings/semanticSearch.test.tsx -t "C115 "`

**C116** - The model list, one row per embedder in catalog order and the reranker's row in the reranker block (G49): line 1 holds, in order, the name (13px, weight-600 class), "Recomendado" only on `embeddinggemma-300m-q4`, and "Embedding" or "Reranker"; line 2 (12px, secondary class) "209 MB · 768 dimensões · licença Gemma" for a model of 209 000 000 bytes (G37), and then the state, one case per state with its text and icon: "Não baixado" `CircleDashed`; "Baixando: 120 de 209 MB" `Download`; "Pronto" `CircleCheck` (`--tone-ok` class); "Falhou: soma de verificação diferente" `AlertTriangle` (`--tone-warn` class) (AC 62, design.md "Lista de modelos", G37, G49)
Proof: `npm run test -w apps/command-centre -- src/views/settings/semanticSearch.test.tsx -t "C116 "`

**C117** - The actions per state, each with its class and its icon read on the same button (L-068) and the exact body it sends: "Baixar" `.btn.primary` `Download` on "Não baixado"; "Tentar de novo" `.btn.primary` `Download` on "Falhou"; "Cancelar" `.btn` `X` on "Baixando" (`{action: "cancel", id}`); "Remover" `.btn.ghost` `Trash2` on "Pronto", disabled with the `title` "Em uso: troque o provedor antes de remover." on the active model; "Usar este modelo" `.btn` `Check` on a "Pronto" model that is not active and absent on the active one, saving `memory.embeddings.local.model` through `PUT /api/settings` (AC 62, design.md "Lista de modelos")
Proof: `npm run test -w apps/command-centre -- src/views/settings/semanticSearch.test.tsx -t "C117 "`

**C118** - The license dialog: "Baixar" on a model with `license.acceptRequired` opens a `Modal` titled "Termos do modelo" holding, in order, the license's `name` as a link (`target="_blank"`, `rel` with `noopener`), "O MordomoOS não distribui este modelo: ele é baixado do repositório do autor para o seu computador, sob estes termos.", the unchecked native checkbox "Li e aceito os termos", then "Cancelar" and "Baixar" (`.btn.primary`, disabled); focus is on the checkbox; Esc closes it with no request; checking the box enables "Baixar", which sends `{action: "install", id, acceptTerms: true}`; on a model with `acceptRequired: false`, "Baixar" sends `{action: "install", id}` with no dialog (AC 62, AC 28, design.md "Diálogo")
Proof: `npm run test -w apps/command-centre -- src/views/settings/semanticSearch.test.tsx -t "C118 "`

**C119** - While a model downloads: below line 2 a `role="progressbar"` with `aria-valuenow` = the percentage of `done`/`total` (`aria-valuemin` 0, `aria-valuemax` 100), the text "Baixando: 120 de 209 MB" and "Cancelar"; with fake timers the screen asks `GET /api/memory/embedder` once by 999 ms and a second time at 1 000 ms, and stops asking once the state reads "Pronto" (AC 63, design.md "Enquanto baixa", L-057)
Proof: `npm run test -w apps/command-centre -- src/views/settings/semanticSearch.test.tsx -t "C119 "`

**C120** - With no model downloaded, "Escolha um modelo para baixar. O download não começa sem o seu pedido." sits above the list; with one "Pronto" it is absent (AC 62, design.md "Nenhum modelo baixado", Observable "empty state")
Proof: `npm run test -w apps/command-centre -- src/views/settings/semanticSearch.test.tsx -t "C120 "`

**C121** - A failed download shows its reason in text, one case each: `checksum` → "Falhou: soma de verificação diferente", `host_not_allowed` → "Falhou: endereço fora da lista", `network: socket hang up` → "Falhou: socket hang up" (G21), each with "Tentar de novo" (AC 68, design.md "Download falho", G21)
Proof: `npm run test -w apps/command-centre -- src/views/settings/semanticSearch.test.tsx -t "C121 "`

**C122** - The recompute confirmation, with a ready index (`enabled` and `semantic.sections` 1234, G42), one case per change: choosing another provider, "Usar este modelo" and a new "Dimensões" open the confirmation titled "Recalcular o índice?" with "As 1234 seções serão calculadas de novo." and, only when the new provider is "Servidor seu", "Seus textos serão enviados de novo para http://127.0.0.1:11434/v1/embeddings."; "Continuar" sends the `PUT`, and cancelling sends nothing; with no ready index the change is saved with no dialog (AC 66, design.md "Confirmações", G42, Observable "destructive action confirms")
Proof: `npm run test -w apps/command-centre -- src/views/settings/semanticSearch.test.tsx -t "C122 "`

**C123** - The remove confirmation: "Remover" on "EmbeddingGemma 300m" (`bytes` 209 000 000) asks "Remover EmbeddingGemma 300m?" with "Libera 209 MB. Você pode baixar de novo." and the `danger` action "Remover", which sends `{action: "remove", id}`; cancelling sends nothing (design.md "Confirmações")
Proof: `npm run test -w apps/command-centre -- src/views/settings/semanticSearch.test.tsx -t "C123 "`

**C124** - The reranker block, only inside "Modelo neste computador" and after the list: the on/off button of `memory.recall.rerank.enabled` with `aria-pressed="false"` by default, disabled while no reranker is "Pronto" and enabled when one is; beside it "Mais lento: cerca de meio segundo por seção candidata. Só vale para agentes."; below, the reranker model's row; switching it sends `PUT /api/settings` with `memory.recall` = the current object with `rerank.enabled` true (G43) (AC 67, design.md "Releitura mais cuidadosa", G43)
Proof: `npm run test -w apps/command-centre -- src/views/settings/semanticSearch.test.tsx -t "C124 "`

**C125** - The index state line with the search on, one case each: `hash` with 1234 sections → "1234 seções indexadas com o vetor simples"; the local model → "1234 seções indexadas com EmbeddingGemma 300m"; `http` with `model: "nomic-embed-text"` → "… com nomic-embed-text"; with `semantic.error` set, its text and `AlertTriangle`; after "Continuar" of C122, "Recalculando…" with a spinner until the status's `indexing` reads idle (design.md "Estado do índice" and "Troca em andamento")
Proof: `npm run test -w apps/command-centre -- src/views/settings/semanticSearch.test.tsx -t "C125 "`

**C126** - Loading and failure: while `GET /api/memory/embedder` is pending, a spinner and "Carregando…" stand where the list goes, and the header and the options are already there; when it fails, `role="alert"` with `AlertTriangle`, "Não deu para carregar os modelos." and "Tentar de novo", which asks again (AC 68, design.md "Estados", Observable "loading state" and "error state")
Proof: `npm run test -w apps/command-centre -- src/views/settings/semanticSearch.test.tsx -t "C126 "`

**C127** - The footer link "Como instalar o Ollama" is an `<a>` with `target="_blank"`, a `rel` holding `noopener`, and an `href` ending in `docs/memory-guide.md#busca-por-significado` (G41); that anchor is the slug of a heading of `docs/memory-guide.md` (C108) (design.md "Rodapé do bloco", G41)
Proof: `npm run test -w apps/command-centre -- src/views/settings/semanticSearch.test.tsx -t "C127 "`

**C128** - Motion: every `animation` and `transition` of the block's stylesheet sits inside `@media (prefers-reduced-motion: no-preference)` (the reader of `ui/ui.source.test.ts` C15 run on it); the progress bar grows by `transform: scaleX` in 240 ms `ease-out`, the progress number tweens through `useTweenNumber` in 300 ms, a new provider's detail enters by `opacity` in 200 ms; with motion reduced the values show at once and every state keeps its text and icon (AC 69, design.md "Movimento")
Proof: `npm run test -w apps/command-centre -- src/views/settings/semanticSearchMotion.test.ts -t "C128 "`

**C129** - Every string of design.md's "Texto" table (25 rows, each string split at `·` its own key; the network error is the server's text and not a key) is a key of `en` and `ptBR` in `locales/brain.ts` with that text in each language, both locales hold the same keys, and no new key is unused (design.md "Texto", `limpeza-legado`)
Proof: `npm run test -w apps/command-centre -- src/views/settings/semanticSearchCopy.test.ts -t "C129 "`

**C130** - No text of the block under 12px, prose at 13px, colours only from tokens: the repository's stylelint config reports no warning on the new stylesheet, run programmatically as `typography.test.ts` runs it (AC 69, `design-system/design.md`)
Proof: `npm run test -w apps/command-centre -- src/views/settings/semanticSearchMotion.test.ts -t "C130 "`

**C131** - The keyboard: `Tab` goes, in order, to the on/off button, to the radiogroup (one stop, the arrows move the choice), to the detail's controls in their order, to the model actions, to the reranker button and to the footer link; `Enter` and `Space` activate a button; in the license dialog `Tab` stays inside it (AC 69)
Proof: `npm run test -w apps/command-centre -- src/views/settings/semanticSearch.test.tsx -t "C131 "`
Proof: `MORDOMO_E2E_PORT=4901 npx playwright test --config tests/e2e/playwright.config.ts busca.spec.ts -g "C131 "`

**C132** - In a real browser, in the light and the dark theme and in the moldura and the Núcleo, the block with each provider chosen, a model downloading, a failed one and the license dialog open has no axe violation `serious` or `critical` at WCAG A/AA, and no text under 12px (AC 69)
Proof: `MORDOMO_E2E_PORT=4901 npx playwright test --config tests/e2e/playwright.config.ts busca.spec.ts -g "C132 "`

**C133** - Rendered geometry (L-069): at 1 440 px in both shells, a model row's state and its actions sit to the right of line 1 and line 2 (their left edge right of the name's right edge) and level with the row, and the warning sits beside the checkbox (same line box) (design.md "Lista de modelos", "Servidor seu")
Proof: `MORDOMO_E2E_PORT=4901 npx playwright test --config tests/e2e/playwright.config.ts busca.spec.ts -g "C133 "`

**C134** - The component gallery has a "Busca por significado" entry (the header, the three options with one disabled, a model row in each of the four states, the license dialog) and in both themes it has no `serious` or `critical` axe violation (`design-system/design.md`, "a galeria cobre as duas camadas")
Proof: `MORDOMO_E2E_PORT=4901 npx playwright test --config tests/e2e/playwright.config.ts busca.spec.ts -g "C134 "`

**C135** - The weight: `scripts/bundle-baseline.json` gains a `cerebro-busca-significado` entry right after `cerebro-rituais` with a reason of more than 40 characters and the four numbers, at most 12 288 B of JS gzip and 2 048 B of CSS gzip above `cerebro-rituais` (604 839 B and 83 496 B, so at most 617 127 B and 85 544 B); `bundle:check` exits 0 on a fresh build (Assumptions "Teto de peso", AD-047 h)
Proof: `npx vitest run tests/busca.contract.test.ts -t "C135 "`
Proof: `npx vitest run tests/bundle-size.test.ts -t "C31 a build within 5% of the latest recorded one passes"`
Proof: `npm run build -w apps/command-centre && npm run bundle:check`

**C136** - In a real browser, both shells, the independent test of S7 with a loopback `/v1/embeddings` server of 768 dimensions in place of a model: choose "Servidor seu", fill "Endereço", "Modelo" and "Dimensões", "Testar conexão" reads "OK: 768 dimensões, <n> ms", the on/off button turns the state to "Ligada", and after a pass the index line reads "<n> seções indexadas com <modelo>"; the local download flow (license, "Baixar", progress, "Pronto", "Usar este modelo") runs against `page.route` answers that honour the body sent (L-052) (AC 61-AC 66, plan S7 independent test)
Proof: `MORDOMO_E2E_PORT=4901 npx playwright test --config tests/e2e/playwright.config.ts busca.spec.ts -g "C136 "`

### Opt-in, not a CI proof · 1 file · ~4k

**C137** - OPT-IN, NOT CREDITED: with `MORDOMO_REAL_MODEL=1` and the real `embeddinggemma-300m-q4` already in `<casa>/models/` (the test skips when the variable is unset, as `tests/memory.packaging.test.ts` skips without a build), the Portuguese corpus indexed with the real local model gives a `semantic` row of `mordomo eval` whose `1-recall@20` is at least the `hash` baseline of C10, and the C46 `synonym` question of cerebro-v2's corpus finds its note in the top 3; the measured `minSimilarity` is printed for the catalog (Assumptions "Limiar de abstenção"). No Coverage row and no Swept line credits it
Proof: `MORDOMO_REAL_MODEL=1 npx vitest run tests/busca.realmodel.test.ts -t "C137 "`

## Correções do lote A

Added after batch A by the coordinator (16/11/2026), from a defect the builder of batch A reported: AC 9 asks the OR of
"the word and its counterparts", and G2's default (today's stemmed term and the counterparts) left the word itself out,
so a question word missed a note that holds it literally when `stemLite` moved it off porter's stem (`ações` → `acao`,
missing "ações", which porter indexes as `acoe`; true on the base too). Additive to G2; no existing claim changes.

**C138** - Through `GET /api/memory/search?mode=text`, the folded word itself is in each keyword's OR next to today's stemmed term and its counterparts (AC 9): over a home with a note holding exactly "ações", one holding "ação", one holding only "jornal" and one holding only "jornais", `q=ações` lists both the "ações" note and the "ação" note; `q=jornais` still lists the `jornal` note and the `jornais` note; the strict query is unchanged by value (`strictQuery("ações")` is `"ações"*` and `strictWordsSearch` lists exactly the "ações" note); and cerebro-v2's C46 morphology table still reads `[other-number, false, false, true, true]` six times and `[control, true, true, true, true]` twice (AC 9, AC 12, G2, L-044)
Proof: `npx vitest run tests/busca.stem.test.ts -t "C138 "`
Proof: `npx vitest run tests/memory.semantic.test.ts -t "C46 "`

## Correções do lote D

Decisões do dono de 17/11/2026 sobre o que o lote D achou (nenhum check reescrito além do que se diz aqui):

1. **C77, a cláusula tirada.** "The corpus's `abstain` questions answer `abstained: true`" foi tirada da afirmação: com a regra
   aprovada do AC 47 (metade das palavras-chave já casa; cosseno igual ao mínimo não é abaixo), 2 das 12 perguntas de abstenção
   abstêm com o `hash` e 8 com a busca desligada, porque o limiar do `hash` (0,2) é baixo e várias perguntas têm uma seção que
   casa metade dos termos. O C77 afirma as duas cláusulas restantes, provadas. A abstenção só vale para uma medição com um
   modelo real (Gemma 0,62, Qwen 0,45): ela entra na prova opt-in C137 do lote E, e se não bastar vira uma emenda de regra, com
   número, não uma reabertura do plano agora. O `abstainCorrect` do hash fica gravado no C10 como 2/12.
2. **G29, o casamento de uma seção.** Ao contar "metade das palavras-chave casam" (AC 47), uma seção casa pelo texto do seu
   corpo **e** pelo seu caminho de títulos (`Banco financeiro > Pagamento`), o nome que a door 1 dá à seção. Sem isso, a pergunta
   "Quem aprovou a transferência…" casa 2 de 5 e abstém mesmo achando a nota certa. É a decisão (c) de "Settled mid-build" do lote
   D, confirmada pelo dono; o C76 e o C77 a afirmam.
3. **C69, a aritmética.** O texto diz que `B` vale `1/61 + 1/61`; com `B` em segundo lugar na lista de texto o RRF dá `1/62 + 1/61`.
   A prova afirma o valor do RRF e a ordem `B`, `A`, `C`; o texto do check fica corrigido aqui, sem mudar a ordem nem a prova.

## Correções da rodada 1

Round 1 of the verification (`verification.md`, FAIL at `43a6be7`, 136 of 138 checks proven and every proof green)
found one surviving mutant, two design statements with no assertion, and three precision gaps. What follows was added
after approval, at the coordinator's request; it is recorded here rather than rewritten into the approved checks, whose
claims are unchanged (the one edit to an approved check is C98's added Proof line, finding 4). No build defect was found
and no product code changed. Each new proof was made to fail by a fault injected in a scratch worktree (`git worktree add
--detach`, `node_modules` symlinked, the real tree's `git status --porcelain` identical before and after, the worktree
removed and pruned), as each entry says.

Findings and what closes them:

- **Finding 1, the size and SHA-256 of every file (door 3, the surviving mutant).** C45 corrupted only the stub entry's
  last file, so a download that verified only `.onnx` files passed every `busca.*` test. **C139** gives the stub Qwen
  entry four files, the `.onnx` graph neither first nor last, and corrupts each in turn, then makes each one byte short
  and one long while its SHA-256 is that of the bytes served. Faults: the Verifier's mutant (size and SHA-256 checked
  only for paths ending `.onnx`, `core/src/models/downloads.ts:232`) fails six C139 cases (`config.json`,
  `tokenizer.json` and `onnx/model.onnx_data`, each corrupted and each short); the size test removed from that line
  fails the four short cases; the SHA-256 test removed fails the four corrupted cases. Coverage: a new row, file × guard
  (8); the failure reason `checksum` and door 3 credit C139.
- **Finding 2, "Testar conexão" `.btn` with `Plug` (design.md "Servidor seu").** **C140** reads the class and the icon on
  the button. The buttons row of Coverage was enumerated again from design.md ("Lista de modelos", "Servidor seu",
  "Diálogo"): seven buttons are given a class and an icon (Baixar, Tentar de novo, Cancelar, Remover, Usar este modelo,
  Testar conexão, the dialog's Baixar, whose design gives a class only); the dialog's "Cancelar" and the two on/off
  buttons get neither, so nothing else was uncredited. Faults: `Plug` replaced by `CircleCheck` fails C140; the button
  as `variant="ghost"` fails C140. `.btn` reads as `btn secondary` on the button, as C117 reads "Cancelar" and "Usar este
  modelo".
- **Finding 3, C110's "on its right" (design.md "Cabeçalho").** **C141** measures the header in a real browser, both
  shells, with the search off ("Desligada") and on ("Ligada"). `semanticSearch.css` has no width breakpoint: `.ss-head`
  is a wrapping flex row whose title takes `margin-right: auto`, so the state could only drop below the title where the
  block grows narrower than the header's content. The block narrows only between the shells' own layout changes,
  measured at this commit as the first width of each new layout: moldura 1 308, 899 and 730 px, Núcleo 780, 760 and 680
  px; the header is narrowest one pixel above each (363 px at 1 309 in the moldura), and never narrower than 363 px down
  to 300 px (probed every 10 px). C141 asserts at 1 440 px, exactly on each change and one
  pixel above it (L-067), and every 10 px from 1 440 down to 320 px. The code puts the state to the right everywhere:
  no build defect. Fault: `.ss-head { flex-direction: column }` under `max-width: 760px` fails both shells (moldura
  first at 731 px, Núcleo at 760 px). Coverage: the arrangements row credits C141 on the header.
  (Superseded by `## Correções da rodada 2`: the 730 and the 363 px were artifacts of a long folder path.)
- **Finding 4, three precision gaps.** (a) C98's claim names `tests/contracts.api.test.ts`, whose 173 pin
  (`Object.keys(API)).toHaveLength(173)`) sits in "C58 the table itself is frozen…": C98 gains that Proof line; the test
  is unchanged. (b) C99's "naming `section-vectors`": `tests/memoria.migration.test.ts` C39 and
  `tests/natureza.layer.test.ts` C7 pin the version 34 and not the name; the name of 34 is pinned by C30
  (`tests/busca.migration.test.ts:16`, `MIGRATIONS.at(-1)` `toMatchObject({ version: 34, name: "section-vectors" })`) and
  by `tests/rituais.layer.test.ts` C19 (C99's own Proof line), so a pin at 34 elsewhere names the same migration; no test
  was changed. (c) `## Not verified here` gains the real child's network behaviour at run time and Landing row 9's
  `pooling` values.
- **Finding 5, the host guard's scheme and port (the Verifier's observations).** **C142**: a `302` to `http://` on a
  host of the entry that is not this machine (`192.0.2.1`, added to the entry's `hosts`) and a `302` to `ftp://` on
  `127.0.0.1` both stop the download with `host_not_allowed` and no file left; a `302` to `https://` on a host of the
  entry passes the guard (the stub speaks plain `http`, so the TLS request fails as `network: …`). Faults: the scheme
  clause removed from `fetchWithin` (`downloads.ts:250-252`) and `http` allowed on any host of the entry both fail C142.
  **The port, a noted limit:** `hostAllowed` compares the host name only and `fetchWithin` reads no port, so today any
  port of an allowed host is accepted (C46's own followed redirect goes to `127.0.0.1:<the stub's random port>`); for the
  real catalog `https://huggingface.co:8443/…` or any port of `*.cdn.hf.co` would be fetched. Door 3 names hosts only and
  the SHA-256 of every file (C139) is the content guard, so this is recorded and the behaviour is not changed; the
  owner can decide to restrict the port to 443.
- **Finding 6, the one surviving mutant of the Faults table.** It is finding 1's (`downloads.ts:232`, `.onnx` only):
  killed by C139.

New checks:

**C139** - The size and the SHA-256 of every file of an entry: with the stub Qwen entry holding four files in this order,
`config.json`, `tokenizer.json`, `onnx/model.onnx` and `onnx/model.onnx_data`, an install untouched ends `ready` with
each file on disk byte for byte; then, one case per file, the file served with one byte changed, and the file served one
byte shorter than the catalog's `bytes` with the catalog's SHA-256 set to the bytes served, each ends `state: "failed"`,
`reason: "checksum"`, with no file of the entry and no `<home>/models/<id>/` folder left, the file requested, and with
`provider: "local"` and that `local.model` the status reads `blocked: "model_missing"` and `provider: null` (the model is
not activated); a file served one byte longer, its SHA-256 that of the bytes served, ends the same way (round 1 finding
1, door 3 "a soma SHA-256 de cada arquivo", AC 29)
Proof: `npx vitest run tests/busca.embedder.test.ts -t "C139 "`

**C140** - "Testar conexão" is `.btn` (read as `btn secondary`, as C117 reads `.btn`) with the `Plug` icon, its only
icon (round 1 finding 2, design.md "Servidor seu")
Proof: `npm run test -w apps/command-centre -- src/views/settings/semanticSearch.test.tsx -t "C140 "`

**C141** - In a real browser, in the moldura and in the Núcleo, with the search off and on, with the indexed folder
`/Users/ana/Notas` (a realistic short path, in place of the e2e home's own), at every width from 1 440 down to 300 px
(1 px steps): the header's state ("Desligada", "Ligada") sits to the right of the title (its left edge at or after the
title's right edge) and on the title's line (vertically overlapping it) while the header is at least as wide as the
title, a gap and the state (243.78 px with "Desligada", 222.64 px with "Ligada"), and wraps to the next line below it;
the on/off button sits after the state on that same line while the header is at least as wide as the three and their two
gaps (347.52 px with "Desligada", 305.02 px with "Ligada"), and wraps to a later line below it, as a normal flex-wrap;
the Settings grid changes layout exactly at moldura 1 308, 899 and 736 px and Núcleo 780, 760 and 680 px (the first
width of each new layout); the narrowest header is 170 px (moldura) and 226 px (Núcleo), and a header within 1 px on
each side of each limit it reaches is measured (round 1 finding 3, round 2 finding 1 and the owner's decision of
19/11/2026 in `## Correções da rodada 2`, design.md "Cabeçalho", L-067, L-069)
Proof: `npm run build && MORDOMO_E2E_PORT=4901 npx playwright test --config tests/e2e/playwright.config.ts tests/e2e/busca.spec.ts -g "C141 "`

**C142** - A download reaches a host of its entry over `https` only, plain `http` only to this machine: a `302` to
`http://192.0.2.1/x` with `192.0.2.1` in the entry's `hosts`, and a `302` to `ftp://127.0.0.1/x`, each end `state:
"failed"`, `reason: "host_not_allowed"`, with no file of the entry left; a `302` to `https://127.0.0.1:<port>/x` passes the
guard and ends `failed` with a `network: …` reason (round 1 finding 5, door 3)
Proof: `npx vitest run tests/busca.embedder.test.ts -t "C142 "`

## Correções da rodada 2

Round 2 of the verification (`verification.md`, FAIL at `10510ca`, scoped) found one gap, C141: its claim was false at
narrow widths, and its proof was green only because the e2e home's indexed folder (a long path under the checkout)
widened the one-column Settings grid (`apps/command-centre/src/views/apps.css:706`, `grid-template-columns: 1fr` under
`@container (max-width: 640px)`) to the "Pastas indexadas" card's min-content (873 px), so the header was never measured
under 363 px; and `LAYOUT_CHANGES` named 730 where the moldura changes at 736. The Verifier noted the grid defect itself
as pre-existing and not counted. **The owner decided on 19/11/2026** (in the coordinator's session): (a) reduce C141's
claim to the design (the state to the right of the title; the button after it on that line only while the header holds
it, with a case on each side of the limit, L-067), with a realistic short folder path in the fixture and a test that the
header really narrows, and 736 in place of 730; this is the one edit allowed to an approved claim; (b) fix the grid
defect (`1fr` to `minmax(0, 1fr)`), an owner-approved change to a screen outside C9's scope, proven by a new browser
check, C143; (c) say whether the moldura's 1 250 and 1 000 px rate changes still add no minimum once the grid is fixed.
Every number below was measured again with a 1 px sweep from 1 440 to 300 px, both shells, both states, with the folder
`/Users/ana/Notas` and with a long path, before and after the grid fix. Each new proof was made to fail by a fault
injected in a scratch worktree (`git worktree add --detach`, `node_modules` symlinked, its own `npm run build`, E2E on
port 4902; the real tree's `git status --porcelain` empty before and after; the worktree removed and pruned).

Findings and what closes them:

- **Finding 1, C141 (design.md "Cabeçalho").** The header is a wrapping flex row, gap 8 px, whose title (148.45 px)
  takes `margin-right: auto`; the state is 87.33 px ("Desligada") or 66.19 px ("Ligada"), the button 95.73 px or
  74.38 px. So the button stays on the title's line while the header is at least 347.52 px ("Desligada") or 305.02 px
  ("Ligada"), in whole pixels 348 and 306; 363 was not a limit but the narrowest header the long path allowed. With the
  short path and the grid fixed, the button wraps at moldura 969-900 and 477-300 px ("Desligada"), 927-900 and 435-300
  px ("Ligada"), Núcleo 421-300 and 379-300 px.
  **Departure from decision (a), for the owner to ratify.** The decision keeps the state to the right of the title "at
  every width", which the Verifier measured true at `10510ca`; it was true only because the grid defect kept the header
  at 299 px or more even with a short path (another min-content of the tab held the `1fr` column). With (b) applied the
  header falls to 170 px (moldura) and 226 px (Núcleo) at 300 px, and the state wraps under the title, as the same normal
  flex-wrap, where the header is narrower than the title, a gap and the state (243.78 px "Desligada", 222.64 px
  "Ligada"): moldura 373-300 px ("Desligada") and 352-300 px ("Ligada"), Núcleo 317-300 px ("Desligada"; "Ligada"
  never). Keeping the state on the title's line there needs a change to the header's CSS that nobody approved; C141
  therefore states the state with the same rule as the button, with a case on each side of its limit. If the owner wants
  the state to the right at every width, that is a product change to `semanticSearch.css` and a new claim.
  **The proof.** C141 replaces the indexed folders the screen reads with `/Users/ana/Notas` (through the
  `GET /api/v1/settings` route its `feign` helper already answers, now given an optional `folders` argument), so it no
  longer depends on the length of the checkout's path; it sweeps every pixel from 1 440 to 300 px; at each width it
  asserts the title, gap and state, and the three with both gaps, equal the two limits (to 1/1 000 px), and the state and
  the button on the title's line or wrapped below it by the header's width against them; it reads the layout changes
  from the grid's own column count and asserts them (moldura 1 308, 899, 736; Núcleo 780, 760, 680), asserts the
  narrowest header (170 px moldura, 226 px Núcleo) and that a header within 1 px on each side of each limit it reaches
  was measured. Faults: the Verifier's deduced mutant (`.ss` an inline-size container, `.ss-head { flex-direction:
column }` under `@container (max-width: 340px)`) fails both shells ("right of the title", moldura at 962 px, Núcleo at
  414 px, header 340 px); `.ss .ss-head { flex-wrap: nowrap }` fails both (moldura at 969 px, Núcleo at 421 px, header
  347 px: the items shrink); the grid back to `1fr` fails both (the narrowest header).
  **The layout changes**, re-derived from the shells' code and read from the grid's column count in the sweep: moldura
  1 308 (one column: the settings page, an inline-size container, reaches `@container (max-width: 640px)`), 899
  (`moldura/useFrameLayout.ts:23` `NARROW = "(max-width: 899px)"`, two columns again), 736 (one column; 737 is the last
  two-column width); Núcleo 780 (one column), 760 (`nucleo/nucleo.css:769` `@media (max-width: 760px)`, two columns),
  680 (one column). They are the same before and after the grid fix.
- **Finding 2, the one-column Settings grid (the Verifier's note; owner-approved change).** `apps.css:706`
  `grid-template-columns: 1fr` becomes `minmax(0, 1fr)`: a `1fr` track's minimum is its content's min-content, so a long
  indexed folder path (the row's `span.mono.truncate` is an inline span the `truncate` class cannot clip) made the column
  wider than the panel and `.app-panel { overflow-x: hidden }` cut off the rest of the Memória tab, this block's header
  included. The only twin in the file, `.apps-ma-row { grid-template-columns: 1fr }` under `@media (max-width: 760px)`
  (`apps.css:386`, Settings › Desktop micro-apps), holds three inputs and a button, whose min-content does not grow with
  what is typed: checked, not changed. **C143** proves the fix. Fault: `1fr` back fails C143 in both shells (the column
  945.22 px in a 448 px panel at moldura 1 000 px, 945.22 px in 638 px at Núcleo 770 px). Files touched:
  `apps/command-centre/src/views/apps.css` (one line) and `tests/e2e/busca.spec.ts` (C141, C143, `feign`'s `folders`).
  Rerun with nothing moved: `npm run test -w apps/command-centre -- src/views/settings` and `src/views/Settings*`; the
  e2e specs that open Settings (`approval-longword-layout`, `approval-request-layout`, `device-card-layout`,
  `contexts`, `organize`, `desktop-parity`, `desktop-regressions`, `onboarding`, `provider-readiness`, `render-profile`,
  `smoke`, `memoria`, `a11y`); CSS gzip 84 193 B, unchanged (CSS raw +10 B), under the 85 544 B ceiling of C135.
  **Still pre-existing, not fixed (outside the approval):** with a long path the folder row itself is as wide as its
  path at every width, two columns included, and runs past its card; the panel clips it, so the tab's `scrollWidth`
  still exceeds its `clientWidth`. C143 therefore asserts the grid's column and the Busca block inside the panel, not the
  whole tab's `scrollWidth`. Clipping that row is a separate decision for the owner.
- **Note (c), the moldura's 1 250 and 1 000 px changes.** Still no new minimum after the grid fix: the header's local
  minima over 1 440-300 px are at 1 309 px (363 px), 900 px (278 px) and 737 px (363 px) in the moldura and 781 and
  681 px (363 px) in the Núcleo, each one pixel above a layout change; under the last change of each shell (736, 680) the
  header narrows steadily to the sweep's floor, which C141 pins. (Before the fix, with the long path, the minima were
  1 309 and 737 only, the column pinned at the card's 873 px below each one-column switch.)

C141's claim before this edit, for the record: "In a real browser, in the moldura and in the Núcleo, with the search off
and on, the header's state ("Desligada", "Ligada") sits to the right of the title (its left edge at or after the title's
right edge) and on the title's line (vertically overlapping it), and the on/off button after the state on the same line,
at 1 440 px, exactly on and one pixel above each width where the shell's layout changes (moldura 1 308, 899, 730; Núcleo
780, 760, 680), and every 10 px from 1 440 down to 320 px". Its new text is in `## Correções da rodada 1`.

New check:

**C143** - In a real browser, in the moldura and in the Núcleo, with the search on and one indexed folder whose path is
longer than the panel is wide (`/Users/ana/Library/Mobile Documents/iCloud~md~obsidian/Documents/Cofre pessoal/Notas do
trabalho/2026`), at one width inside each one-column range of the Settings grid (moldura 1 000 and 600 px, Núcleo 770
and 500 px): the grid has one column, no wider than its panel; the "Busca por significado" block lies wholly inside the
panel (left and right edges), each part of its header too, and its header is wholly in view (round 2 finding 2, the
owner's approved change to `views/apps.css`)
Proof: `npm run build && MORDOMO_E2E_PORT=4901 npx playwright test --config tests/e2e/playwright.config.ts tests/e2e/busca.spec.ts -g "C143 "`

## Coverage

| Set (size)                                                                          | Member -> proof                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | Unproven |
| ----------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| `GET /api/memory/embedder` statuses, as (status, code) (3)                          | 200 C41, C43 · `403 owner_only` (device) C60 · `403 forbidden` (run) C60                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | -        |
| `POST /api/memory/embedder` statuses (9)                                            | 200 C43, C49, C50, C57 · `400 validation` C48, C57 · `400 terms_not_accepted` C44 · `403 owner_only` C60 · `403 forbidden` (run) C60 · `404 model_not_found` C48 · `409 local_unavailable` C51 · `409 model_in_use` C50, C64 · `409 download_in_progress` C48, C64                                                                                                                                                                                                                                                                                                                                                                                                                                                    | -        |
| `GET /api/memory/recall` statuses (3)                                               | 200 C70, C74 · `400 validation` C87 · `404 context_not_found` C72                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | -        |
| `GET /api/memory/search` statuses (4)                                               | 200 C29, C39 · `400 validation` C32 · `404 context_not_found` C32 · `409 semantic_disabled` C32, C58                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | -        |
| `GET /api/memory/status` statuses (1)                                               | 200 C31, C63                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | -        |
| `POST /api/memory/embedder` actions (4)                                             | `install` C43 · `cancel` C49 · `remove` C50 · `test` C57                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | -        |
| changed response keys (8)                                                           | recall `abstained` C74 · recall `abstainReason` C74 · recall `rerank` C74, C90 · search `section` C29 · search `line` C29 · status `sections` C31 · status `model` C31, C63 · status `local` C63                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | -        |
| AC 9 ending rows (13)                                                               | `ao` C11 · `oes` C11 · `al` C11, C13 · `ais` C11, C13 · `el` C11, C13 · `eis` C11 · `il` C11 · `ol` C11, C13 · `m` C11, C13 · `ns` C11, C13 · `r` C11 · `z` C11 · `s` alone C11, C13                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | -        |
| ending table both directions through the route (8)                                  | `jornais`→`jornal` C13 · `jornal`→`jornais` C13 · `papel`→`papéis` C13 · `homens`→`homem` C13 · `farol`→`faróis` C13 · `rios`→`rio` C13 · `devolução`→`devoluções` C13 · the word itself, `ações`→"ações" C138                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | -        |
| length edge after folding (4)                                                       | 3 letters `pao` C12 · 3 letters `pes` C12 · exactly 4 `acao` C12 · exactly 4 `rios` C12                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | -        |
| words searches (4)                                                                  | every word, expanded C13, C14 · any word, expanded C14 · strict, not expanded C15 · recall term, not expanded C18                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | -        |
| section splitting cases (13)                                                        | H1-H6 C19 · 7 hashes C19 · no space C19 · ` ``` ` fence C19 · `~~~` fence C19 · preamble `(top)` C19, C21 · setext C19 · empty section C19, C21 · CRLF C19 · 40 lines C20 · 41 lines C20 · `.markdown` C20 · not text (`.json`, `.pdf`) C20                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | -        |
| heading path cases (4)                                                              | ancestors C21 · skipped level C21 · sibling reset C21 · preamble C21, C23                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | -        |
| sections per file edges (3)                                                         | 1 C21 · 64 C22 · 65 C22                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | -        |
| embedded text parts (5)                                                             | area C23 · no area C23 · title C23 · heading path C23 · `maxChars` edge C23, C61                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | -        |
| recomputation triggers (7)                                                          | file changed C24 · section removed C24 · nothing changed C17, C24 · provider C25 · dimension C25 · local model C25 · embeddings off C25                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | -        |
| abstention conditions (8)                                                           | no keywords C75 · no candidate C75 · exactly half C76 · one fewer and below C76, C77 · cosine equal C76 · no vectors C76, C77 · `abstain` false C76, C78 · `no_match` with `abstain` false C75                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | -        |
| `openFile` section choice (3)                                                       | vector higher C73 · equal C73 · text higher C73                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | -        |
| hops (5)                                                                            | 1 C80 · 2 C80 · 3 C80 · 0 refused C80, C86 · 4 refused C80, C86                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | -        |
| token budget edges (3)                                                              | exactly at budget C82 · one over, dropped C82 · a later one that fits C82                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | -        |
| rerank outcomes (5)                                                                 | `used` C89 · `off` C90, C96 · `skipped` C90, C96 · `timeout` C90, C91 · `failed` C90                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | -        |
| rerank `candidates` edges (3)                                                       | 1 C92 · 20 C92 · 50 C92                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | -        |
| embedding error kinds (6)                                                           | `timeout` C57, C115 · `status` C26, C57, C115 · `dimension` C57, C115 · `malformed` C57, C115 · `network` C57, C115 · `local_crashed` C55, C57, C115                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | -        |
| model states (4)                                                                    | `absent` C41, C49, C50, C65 · `downloading` C43, C119 · `ready` C43, C65, C116 · `failed` C45, C46, C47, C116                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | -        |
| download failure reasons (3)                                                        | `checksum` C45, C121, C139 · `host_not_allowed` C46, C121, C142 · network C47, C121, C142                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | -        |
| door 3: size and SHA-256 of every file of an entry, file × guard (8)                | `config.json` size C139 · `config.json` SHA-256 C139 · `tokenizer.json` size C139 · `tokenizer.json` SHA-256 C139 · `onnx/model.onnx` size C139 · `onnx/model.onnx` SHA-256 C45, C139 · `onnx/model.onnx_data` size C139 · `onnx/model.onnx_data` SHA-256 C139                                                                                                                                                                                                                                                                                                                                                                                                                                                        | -        |
| door 3: a hop by scheme on a host of the entry (4)                                  | `https` passes the guard C142 · `http` to this machine followed C46 · `http` to a host not this machine refused C142 · another scheme (`ftp`) refused C142                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | -        |
| catalog entries × attributes (license, hosts, sha256, dimensions, prefixes) (15)    | C42, table-driven over all 15                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | -        |
| blocked reasons of door 7 (2)                                                       | `model_missing` C45, C58, C59 · `platform_unsupported` C58                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | -        |
| platform cases (3)                                                                  | `darwin`/`x64` C51 · runtime unresolvable C51 · `linux`/`x64` with runtime C51                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | -        |
| child process lifecycle (6)                                                         | lazy start C52 · batch of 8 C52 · idle 120 s C54 · crash, 3 restarts C55 · one child for service and worker C105 · no runtime in the service C52, C53                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | -        |
| doors of Landing (8)                                                                | 1 C21, C30, C33 · 2 C52, C53, C56, C66, C68 · 3 C42, C46, C139, C142 · 4 C74, C76, C86 · 5 C89, C90 · 6 C1, C6 · 7 C58, C59 · 8 C43, C48, C97                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | -        |
| slices (7)                                                                          | S1 C1-C10 · S2 C11-C18 · S3 C19-C40 · S4 C41-C68 · S5 C69-C88 · S6 C89-C96 · S7 C109-C136                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | -        |
| eval query kinds (5)                                                                | `single` C1, C2 · `multi` C1, C2 · `latest` C1 · `window` C1 · `abstain` C1, C3                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | -        |
| eval modes (5)                                                                      | `and` C4, C14 · `or` C4, C14 · `semantic` C4, C8 · `hybrid` C3, C4 · `rerank` C9, C95                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | -        |
| eval metrics (4)                                                                    | `1-recall@20` C2 · `mrr` C2 · `hit@3` C2 · `abstainCorrect` C3                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | -        |
| eval exits and streams (4)                                                          | 0 with stdout C4, C5 · 2 with stderr C6 · `--json` only JSON C5 · deterministic C7                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | -        |
| provider values (3)                                                                 | `hash` C16, C25, C61 · `http` C25, C26, C27, C57 · `local` C52, C58, C61                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | -        |
| readers of `memory.embeddings.provider` (7)                                         | `embeddings.ts` `chooseProvider` C25, C58 · `vectors.ts` C25, C32 · `semantic.ts` C58, C88 · `failClosed` C59, C62 · `GET /api/memory/status` C31, C58 · `docs/security.md` C97 · `legal/network-policy.json` C67                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | -        |
| who may call: owner (5)                                                             | embedder GET C41 · embedder POST C43 · recall C70 · search C29 · status C31                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | -        |
| who may call: paired device (5)                                                     | embedder GET C60 · embedder POST C60 · recall C85 · search C28 · status C28, C31                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | -        |
| who may call: run credential (3)                                                    | embedder GET C60 · embedder POST C60 · recall C72                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | -        |
| audience differentials (4)                                                          | search C28 · status C28 · recall C85 · reranker C93                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | -        |
| startup config: the catalog, the models folder and the child's entry (4 assemblies) | the service's `AppContext` behind the routes C104 · the index worker's assembly C105 · the CLI offline assembly of `mordomo eval` and `mordomo recall` C106 · the test harness `buscaWorld` C104                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | -        |
| settings with bounds (5)                                                            | `hops` C80, C86 · `tokenBudget` C82, C86 · `rerank.candidates` C86, C92 · `rerank.timeoutMs` C86, C91 · `local.model` C59                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | -        |
| new settings fail-closed (4)                                                        | `local.model` C59, C62 · `rerank.enabled` C62 · `abstain` C62 · `hops` C62                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | -        |
| count pins (15)                                                                     | routes 173 C98 · refusal scenarios 173 C98 · non-public 171 C98 · `EFFECT_ROUTES` 23 C98 · raised codes C98 · OpenAPI C97 · migrations 34 C30, C99 · top-level keys 30 C100 · `memory.embeddings` leaves 8 C100 · booleans on by default C100 · network sites 44 C67 · network hosts 19 C67 · `provider.embed([question]` once C67 · events unchanged C102 · bundle ceiling C135                                                                                                                                                                                                                                                                                                                                      | -        |
| documents moved (4)                                                                 | `legal/PRIVACY.md` C67 · `THIRD_PARTY_NOTICES.md` C67 · `docs/memory-guide.md` C108 · `docs/security.md` C97, C108                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | -        |
| existing behaviour kept, by value (8)                                               | 12-question corpus C107 · morphology table C15 · `hash` C16 · strict AND C15 · recall candidate scoring C18 · recall answer C79 · memoria-confiavel twins C107 · natureza filters C107                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | -        |
| one-item list writers (3)                                                           | section rows C21 · eval with one query C2 · model list C116                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | -        |
| Observable rows (22)                                                                | screen empty state C112, C120 · loading state C126 · error state C126 · unauthorised C60 · density and ordering C111, C116 · destructive action confirms C122, C123 · what the person does next C115, C119 · embedder GET errors C60 · embedder POST errors C44, C48, C50, C51 · who may call C60 · versioning and rate limits C48, C97 · recall response shape C74, C79 · recall errors C87 · search response shape C29 · status response shape C31 · retries and duplicates C24, C48 · `mordomo eval` output C4, C5, C6 · `mordomo recall` abstention C84 · evaluation file structure C1, C6 · MCP abstention text C83 · the pass's output and failure C26, C55 · sections and candidates collections C21, C22, C69 | -        |
| screen parts in order (5)                                                           | header C109, C110 · provider options C109, C111 · detail C109, C113, C114 · index state C109, C125 · footer link C109, C127                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | -        |
| screen states (8)                                                                   | loading C126 · read error C126 · no runtime C112 · no model C120 · downloading C119 · failed download C121 · test running and result C115 · recompute running C125                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | -        |
| buttons with the class and icon design.md gives (7)                                 | Baixar C117 · Tentar de novo C117 · Cancelar C117 · Remover C117 · Usar este modelo C117 · Testar conexão C140 (C114, C115 find it by name) · dialog Baixar C118                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | -        |
| arrangements design.md draws (8)                                                    | five parts order C109 · header order C110, the state to the right of the title on its line in a browser C141 (at every width of both shells while the header holds the title, a gap and the state; narrower, it wraps: `## Correções da rodada 2`) · options order C111 · server fields order C114 · row line 1 then line 2 C116 · state and actions to the right C133 · warning beside the checkbox C114, C133 · reranker block after the list C124                                                                                                                                                                                                                                                                  | -        |
| one-column ranges of the Settings grid, shell × range, with a long folder path (4)  | moldura 1 308-900 px C143 · moldura 736-300 px C143 · Núcleo 780-761 px C143 · Núcleo 680-300 px C143                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | -        |
| confirmations (2)                                                                   | recompute C122 · remove C123                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | -        |
| shells (2)                                                                          | moldura C109, C132 · Núcleo C109, C132                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | -        |
| themes (2)                                                                          | light C132, C134 · dark C132, C134                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | -        |
| design.md copy (25 rows)                                                            | C129, table-driven over all 25                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | -        |

- Claims naming a status code, route or response shape: C24-C32, C34, C38, C39, C41, C43-C52, C55, C57-C60, C63-C65, C70-C75, C77-C81, C83, C85-C94, C96 and C97, each proven through `app.inject` against `buildServer`; C2, C3, C6, C7, C11, C12, C19, C20, C23, C29, C69, C73, C76, C80, C82 and C90 also or only at their own layer, with no HTTP; C4-C7, C10, C34, C84 and C106 through the built CLI
- Claims about the screen: C109-C131 in rendered components; C109, C131-C134, C136, C141 and C143 also in a real browser, both shells where the claim names them
- C137 is opt-in and proves nothing in CI; no row above credits it

## Binding sources

| Source                                                                                                                                                                                      | Checked by                   |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------- |
| `cerebro-busca-significado/design.md` (the block, its five parts, the model list, the license dialog, the reranker block, the confirmations, the states, motion, the copy)                  | C109-C136                    |
| `design-system/design.md` (12px floor, 13px prose, tokens through stylelint, state never by colour alone, axe, the gallery)                                                                 | C110, C116, C130, C132, C134 |
| `primitivas/design.md` (`Modal` for the license, `useConfirm` for the two confirmations, `Field` with label, motion inside `no-preference`, no CSS outside `ui/ui.css` drawing a primitive) | C114, C118, C122, C123, C128 |
| `apps/command-centre/src/views/settings/memory.tsx` (a second `.card.stack` under the indexed folders, the same `Field` and `Button`)                                                       | C109, C114                   |
| `cerebro-faxina-guiada/design.md` (the progress bar with "N de M" in text, `useTweenNumber`)                                                                                                | C119, C128                   |
| `cerebro-natureza/design.md` and `cerebro-rituais/design.md` (error with "Tentar de novo", loading with "Carregando…", the lock with the reason, `role="status"`)                           | C112, C125, C126             |
| `limpeza-legado/design.md` (no unused CSS or key)                                                                                                                                           | C129                         |

## Test policy

| Code                                                                                                                                                                                                                                                                                                                                        | Required proofs                                                          | Coverage expectation                                                                                                                                                                                                                                                                                                                          |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Decides, reached across a boundary (the ending table, the splitter and the embedded text, the recompute rule, the eval's format check and metrics, the catalog check and the download's verdicts, the choice of provider and its blocked reasons, the fusion, the abstention, the section choice, the hops, the budget, the rerank outcome) | one at the boundary (HTTP or the built CLI) **and** one at its own layer | the contract at the boundary; one asserted case per row of the decision table at its own layer                                                                                                                                                                                                                                                |
| Decides, not reached across a boundary (migration 34, the child's batch, idle and restart rules, the static walker)                                                                                                                                                                                                                         | one at its own layer                                                     | one asserted case per row                                                                                                                                                                                                                                                                                                                     |
| Screens (the Settings block, its dialog and confirmations)                                                                                                                                                                                                                                                                                  | one in rendered components per element and state                         | each state, arrangement and copy design.md names; both themes and both shells for axe in the browser; the header's arrangement in a real browser at every width of both shells, with a case on each side of each fit width and a short folder path (C141); the block inside its panel with a long folder path in each one-column range (C143) |

Evidence:

- the ending table (new, beside `extractKeywords`): 13 endings, the length rule, the precedence -> decides, 15 branch points
- the splitter and the embedded text (`splitSections` shared, the new text builder): six heading rules, two fence kinds, the preamble, the 40-line cut, the limit of 64, the path stack, the `maxChars` cut, the missing parts -> decides, ~16 branch points
- `embedPending` over sections: seven recompute triggers, the empty-text rule, the failure kinds -> decides, ~12 branch points
- the eval (new): the format check over five fields and two positions, three metrics with two edges each, the abstain split, five modes -> decides, ~18 branch points
- the download (new): terms, platform, one at a time, redirects inside `hosts`, the SHA-256, cancel, remove of the active, four states -> decides, ~16 branch points; the catalog check: 3 entries × 5 attributes
- `chooseProvider` with `local`: three providers, two blocked reasons, `auto` as text -> decides, 9 branch points (was 6)
- the hybrid recall: the fusion with a tie rule, the depth of 50 admitted sections, four filters, the section choice (3 rows), the abstention (8 rows), the hops (3 levels and a stop), the budget (3 rows) -> decides, ~28 branch points
- the reranker: five outcomes, the candidates bound, the timeout -> decides, 8 branch points
- the child host: lazy start, batch of 8, idle 120 s, 3 restarts in a pass -> decides, 7 branch points
- own layer: `tests/busca.eval.test.ts`, `tests/busca.stem.test.ts`, `tests/busca.sections.test.ts` and `tests/busca.abstain.test.ts` call those functions with no HTTP, as `tests/rituais.layer.test.ts` and `tests/natureza.layer.test.ts` do for the same shape
- closest analogue: `tests/memory.semantic.test.ts` (cerebro-v2's providers and fusion, a loopback server the test controls, `AbortSignal.timeout` spied) and `tests/memoria.access-round2.test.ts` (C173, the device's semantic twin), the same split proven at the boundary and in the core

Cost: about 70 own-layer cases across the four own-layer files and about 25 stub-driven cases in `tests/busca.localprovider.test.ts`. Without these rows the 13 endings, the eight abstention rows and the crash rule are proven only by the requests that happen to traverse them.

## Swept

- validation: C6, C44, C48, C59, C80, C86, C87 (each bound with its accepted and refused edge), C42 (the catalog's literal shape)
- failure modes: C26 (a provider failing mid-pass), C45, C46, C47 (a download that fails deletes what it wrote), C55 (the child crashing), C57 (each test failure kind), C90, C91 (a reranker that fails or is slow keeps the fused order), C126 (the screen's read failure)
- idempotency: C17, C24 (a second pass recomputes nothing), C49, C50 (cancel and remove with nothing to do), C34 (no duplicate rows)
- authorization: C60 (owner only for both new routes, through `/api` and `/api/v1`, a run refused), C28, C85, C93 (the device's differentials), C27, C72 (what the policy refuses is never sent, counted or named)
- concurrency: C34 (two passes at once, an eval during a pass), C48 (two installs at once), C64 (an install during a pass, a remove during a pass, a cancel during an install), C105 (one child for a pass and a search), C40 (a reader between batches)
- data lifecycle: C30 (migration 34 over a populated database), C25 (embeddings off empties the table), C24 (a deleted file's rows go), C65 (a model's state across a restart, a truncated file), C50 (remove deletes the folder)
- dependency failure: C26, C57 (the endpoint), C47 (the model repository), C51 (no runtime on the platform), C55 (the child process), C91 (the reranker's timeout)
- state transitions: C43 (absent to downloading to ready), C45-C47 (to failed), C49 (downloading to absent), C50 (ready to absent), C54 (the child running to ended and back), C25 (vectors of one provider to another)
- observability: C26, C55 (`index.semantic_error` with its kind, read in `semantic.error`), C38 (`index.progress` in sections), C102 (no event added), C125 (the screen shows the last error)

Existing behaviour this feature must not change, each asserted by value: cerebro-v2's 12-question corpus and morphology table (C15, C107), the `hash` provider and its id (C16), AD-037's strict AND (C15), the recall's candidate scoring with the embeddings off (C18), the recall's answer with the embeddings off and one hop (C79), cerebro-memoria-confiavel's semantic twin and run differential (C107), cerebro-natureza's filters (C107) and cerebro-rituais' routes (C107).

## Lacunas do plano

Each is a line for an owner question; the default is what the checks above assert until the owner answers. None blocks the build. G1, G31, G32 and G34 change what an approved sentence or an existing pin reads; G40 and G41 touch the network policy and a link's target.

| #   | Gap                                                                                                                                                                                                                                                                                                                                                                                                 | Default (asserted by)                                                                                                                                                                                                                                                                                                              |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| G1  | AC 10 asks the six `other-number` questions to be found "by words (AND) and by words (OR)", and AC 12 keeps the strict AND of AD-037 unchanged; cerebro-v2's C46 table measures "AND" with `strictWordsSearch` and "OR" with a test helper (`wordsAnyOf`), and measured for this derivation, `mode=text` already finds the six today, because `stemLite` folds `-ções` into `-ção` before the query | "words AND" and "words OR" are the every-word and any-word queries of `searchFiles` (expanded); `strictWordsSearch` and the C46 table stay as they are; the proof that fails on the base is the other direction (C13), not AC 10's example (C14, C15)                                                                              |
| G2  | AC 9 expands "a keyword"; `extractKeywords` has already stemmed it (`jornais` → `jornai`), so the ending table would never see `ais`                                                                                                                                                                                                                                                                | the folded word before `stemLite` is expanded; the query term is the OR of today's stemmed term and the counterparts (C13)                                                                                                                                                                                                         |
| G3  | "`r` and `z` with `res` and `zes`" can be read crosswise; the table has no row from `res`/`zes` back to the singular                                                                                                                                                                                                                                                                                | respectively (`r` → `res`, `z` → `zes`); `flores` falls to `s` alone and gives `flore`, as written (C11)                                                                                                                                                                                                                           |
| G4  | A word can end in two endings of the table (`pioes` in `oes` and in `s`)                                                                                                                                                                                                                                                                                                                            | the longest ending wins, one rule per word (C11)                                                                                                                                                                                                                                                                                   |
| G5  | AC 9 says "the text query", and both the search and the recall build FTS queries from keywords; the plan also keeps the recall's scoring                                                                                                                                                                                                                                                            | only the search's text query is expanded; the recall's term stays `"<keyword>"*` (C18)                                                                                                                                                                                                                                             |
| G6  | Door 6 names the modes, not what each runs, and `1-recall@20` needs 20 ranked files where the recall answers 3                                                                                                                                                                                                                                                                                      | `and` and `or`: the two queries of `searchFiles`; `semantic`: `SemanticSearch` in `semantic`; `hybrid`: the recall's fused file order before opening, 20 deep; `rerank`: that order after the reranker; `abstainCorrect`: the recall's `abstained`; with the search off, `semantic` reads 0.000 and `hybrid` is text only (C3, C8) |
| G7  | `1-recall@20`, `mrr` and `hit@3` are not defined for a query with several `expect` paths                                                                                                                                                                                                                                                                                                            | a query is found when at least one expected path is in the top 20 (top 3 for `hit@3`); `mrr` is 1/rank of the first expected path found within 20, else 0; values rounded half up to 3 decimals (C2)                                                                                                                               |
| G8  | AC 2 and AC 3 give the values, not the literal lines                                                                                                                                                                                                                                                                                                                                                | text: `<mode> 1-recall@20=<x.xxx> mrr=<x.xxx> hit@3=<x.xxx>` per mode, then `abstainCorrect=<n>/<total>`; JSON: `{ modes: { <mode>: { "1-recall@20", mrr, "hit@3" } }, abstainCorrect: { n, total } }` (C4, C5)                                                                                                                    |
| G9  | AC 4's "position" has no literal                                                                                                                                                                                                                                                                                                                                                                    | `eval: file: <reason>` or `eval: queries[<0-based index>]: <reason>` (C6)                                                                                                                                                                                                                                                          |
| G10 | AC 1 says the corpus is in `tests/fixtures/` without a layout, and door 6 makes `expect` relative to "memory/ ou à pasta indexada"                                                                                                                                                                                                                                                                  | `tests/fixtures/pt-corpus/*.md` indexed as a folder, `expect` relative to it; `abstain` queries carry `expect: []` (C1)                                                                                                                                                                                                            |
| G11 | No number is given for the eval over the shipped corpus                                                                                                                                                                                                                                                                                                                                             | the builder records the `hash` numbers once and the test pins them by value (C10)                                                                                                                                                                                                                                                  |
| G12 | Door 1's text `<área> > <título> > <caminho>` says nothing of a file with no area, the preamble or a `.txt` block                                                                                                                                                                                                                                                                                   | a missing part is left out with its separator; the preamble and a block add no path part (C23)                                                                                                                                                                                                                                     |
| G13 | AC 21's `section` and `line` and AC 16's "joined by `>`" leave the separator and the line open; a text hit has no section                                                                                                                                                                                                                                                                           | the path is joined by `>`; `line` is the section's first body line (`splitSections`' `startLine`); a `mode=text` hit carries neither key (C21, C29)                                                                                                                                                                                |
| G14 | After `file_vectors` goes, `semantic.vectors` has no table; AC 23 does not say whether `context` narrows `semantic.sections`                                                                                                                                                                                                                                                                        | `vectors` counts files with at least one section row; neither count is narrowed by `context` (as `vectors` today) (C31)                                                                                                                                                                                                            |
| G15 | The Surface's `semantic.local?` has no shape                                                                                                                                                                                                                                                                                                                                                        | `{ state, platform }`, present only when the provider is `local` (C31, C63)                                                                                                                                                                                                                                                        |
| G16 | Door 1 recomputes on a model change, and `provider` is a string                                                                                                                                                                                                                                                                                                                                     | the local provider's id is `local:<model id>:<dimensions>` (C25)                                                                                                                                                                                                                                                                   |
| G17 | AC 20 speaks of "the caller's audience" at index time, when there is no caller                                                                                                                                                                                                                                                                                                                      | the pass sends what `rowFilter` admits; a file hidden only from devices is embedded (the owner reads it) and never counted, ranked, named or reranked for a device (C27, C28)                                                                                                                                                      |
| G18 | AC 34 says the service starts the child; the vectors phase runs in the index worker thread                                                                                                                                                                                                                                                                                                          | one child per service process, reached by the worker through the host; the CLI's process starts its own (C105)                                                                                                                                                                                                                     |
| G19 | AC 36 restarts the child "for the next batch" and says nothing of the batch that crashed or of the error after a recovered crash                                                                                                                                                                                                                                                                    | the crashed batch is owed to the next pass; the error is recorded and stays until a clean pass clears it (C55)                                                                                                                                                                                                                     |
| G20 | The model's `state` has no stated source after a restart                                                                                                                                                                                                                                                                                                                                            | `ready` when every file has its catalog size and the install's verification record is there; `failed` lives in memory and reads `absent` after a restart (C65)                                                                                                                                                                     |
| G21 | AC 68 shows "the network error" and the Surface's `reason?` is one string                                                                                                                                                                                                                                                                                                                           | `reason` is `network: <message>` and the screen shows the message (C47, C121)                                                                                                                                                                                                                                                      |
| G22 | `cancel` with nothing running and `remove` of an absent model are not given                                                                                                                                                                                                                                                                                                                         | `200` with the state as it is (C49, C50)                                                                                                                                                                                                                                                                                           |
| G23 | `active` and "the active embedder" of AC 33 are not defined while the search is off                                                                                                                                                                                                                                                                                                                 | the id in `local.model` when the provider is `local`, enabled or not (C41, C50)                                                                                                                                                                                                                                                    |
| G24 | AC 38's `test` with a provider that is blocked, or with `hash`                                                                                                                                                                                                                                                                                                                                      | blocked: `400 validation` naming the reason, nothing sent; `hash`: `{ ok: true, dimensions: 256 }`; it tests the configured provider even with the search off (C57)                                                                                                                                                                |
| G25 | `documentPrefix` and `maxChars` are not ordered                                                                                                                                                                                                                                                                                                                                                     | the prefix is part of the text cut at `maxChars` (C61)                                                                                                                                                                                                                                                                             |
| G26 | AC 56 does not give `rerank` for an abstained answer                                                                                                                                                                                                                                                                                                                                                | the reranker is not called; `off` when disabled or `rerank=false`, else `skipped` (C96)                                                                                                                                                                                                                                            |
| G27 | `rerank=true` in the query with the reranker disabled                                                                                                                                                                                                                                                                                                                                               | stays `off`: the query can only turn it off (C90)                                                                                                                                                                                                                                                                                  |
| G28 | A reranker answer that arrives after the timeout                                                                                                                                                                                                                                                                                                                                                    | ignored; the child is kept (C91)                                                                                                                                                                                                                                                                                                   |
| G29 | AC 47's "a section matches half of the keywords" and "the best section's cosine" do not say over which sections                                                                                                                                                                                                                                                                                     | `scoreSection`'s matched keywords over every section of the files the recall opens; the best cosine over the sections the caller may see (C76)                                                                                                                                                                                     |
| G30 | AC 46 has no `WHILE abstain`                                                                                                                                                                                                                                                                                                                                                                        | `no_match` holds with `abstain` false (C75)                                                                                                                                                                                                                                                                                        |
| G31 | With the embeddings off there are no vectors, so AC 47 makes every match under half the keywords abstain by default: today such an answer returns the excerpts                                                                                                                                                                                                                                      | as written: `weak` (C77); `tests/api.recall-quality.test.ts` and natureza C20 match at least half, so they stay; the owner should confirm                                                                                                                                                                                          |
| G32 | AC 49 keeps "the values it has today", and `hops: 2` by default follows a second link that today's single level does not (natureza C20's `amora-d` → `tabela.md`); AC 50 does not say what `via` is after two levels or whether a section not taken stops the walk                                                                                                                                  | AC 49 is asserted with `hops: 1`; `via` is the path that pointed directly; a section not taken stops that branch (C79, C80)                                                                                                                                                                                                        |
| G33 | AC 51 drops an excerpt that does not fit, and does not say whether a later, smaller one is tried                                                                                                                                                                                                                                                                                                    | yes, in the answer's order, until the sum reaches the budget (C82)                                                                                                                                                                                                                                                                 |
| G34 | `memory.recall.abstain` is on by default: the Impact says the list of default-on booleans does not change, data.settings C63 reads every unreadable default-on flag as off, and AC 54 reads an unreadable `memory.recall` as door 4's defaults                                                                                                                                                      | `abstain` unreadable reads `true` (abstaining says less) and is the one addition to the default-on list; `rerank.enabled` closes to `false` (C62, C100); the owner should confirm                                                                                                                                                  |
| G35 | AC 61 titles the options "Palavras e vetor simples (neste computador)" and "Servidor seu (Ollama ou outro)"; design.md gives "Palavras e vetor simples" and "Servidor seu" with a description line                                                                                                                                                                                                  | design.md binds (C111)                                                                                                                                                                                                                                                                                                             |
| G36 | design.md gives option 1 the same sentence as its description and as its detail                                                                                                                                                                                                                                                                                                                     | both, as written (C111, C113)                                                                                                                                                                                                                                                                                                      |
| G37 | "209 MB" does not say decimal or binary                                                                                                                                                                                                                                                                                                                                                             | bytes / 1 000 000, rounded; `done` rounded down (C116, C119)                                                                                                                                                                                                                                                                       |
| G38 | The Impact says `THIRD_PARTY_NOTICES.md` moves; there is none in the repository                                                                                                                                                                                                                                                                                                                     | the build creates it at the root (C67)                                                                                                                                                                                                                                                                                             |
| G39 | The SHA-256 of each file, the hosts, the prefixes, `maxChars` and the local models' `minSimilarity` cannot be known by the plan                                                                                                                                                                                                                                                                     | the checks assert the mechanism and the shape; the builder fixes the values from the real files and `mordomo eval` (C42, C137)                                                                                                                                                                                                     |
| G40 | "Um host novo na política de rede" does not count the sites                                                                                                                                                                                                                                                                                                                                         | 19 host entries and 44 sites (the downloader's `fetch`); if the scan counts the help link of G41, the builder records 45 and the owner confirms (C67)                                                                                                                                                                              |
| G41 | design.md opens "o guia `docs/memory-guide.md`", and the interface has no way to open a repository file                                                                                                                                                                                                                                                                                             | an external link to the guide's section on the repository's site, opened outside; the owner should confirm the target (C127)                                                                                                                                                                                                       |
| G42 | AC 66's "a ready index"                                                                                                                                                                                                                                                                                                                                                                             | the search on and `semantic.sections` > 0 (C111, C122)                                                                                                                                                                                                                                                                             |
| G43 | Door 4 does not say how deep `PUT /api/settings` merges `memory.recall` (L-042)                                                                                                                                                                                                                                                                                                                     | replaced whole, as the other `memory` fields: an omitted key takes its default (C86, C124)                                                                                                                                                                                                                                         |
| G44 | AC 24, AC 53 and AC 58 each ask a differential; one twin could hide a leak in derived data                                                                                                                                                                                                                                                                                                          | one twin home per proof, recomputed from nothing (L-064), shared by the search, the status, the recall and the reranker cases (C28, C85, C93)                                                                                                                                                                                      |
| G45 | `file_vectors` goes; `countVectors`, the search's "no vectors" shortcut, `indexer.ts`'s delete and cerebro-v2's shape pin read it                                                                                                                                                                                                                                                                   | each reads `section_vectors`; the shape pin reads "absent after 34" (C24, C32, C99)                                                                                                                                                                                                                                                |
| G46 | The recall now embeds the question, and C52 of cerebro-v2 pins one `provider.embed([question]` in `semantic.ts`                                                                                                                                                                                                                                                                                     | the recall asks `SemanticSearch` for the question's vector, so the pin holds; `PRIVACY.md` adds the recall to what the search sends (C67, C88)                                                                                                                                                                                     |
| G47 | `splitSections` toggles a fence on any ` ``` ` or `~~~`, so a `~~~` inside a ` ``` ` block closes it                                                                                                                                                                                                                                                                                                | kept as is ("sem mudar o recall"); not asserted (C19)                                                                                                                                                                                                                                                                              |
| G48 | The Assumption's 1 s search over 20 000 sections is a measurement, and CI machines differ                                                                                                                                                                                                                                                                                                           | asserted on the test machine as a guard; the real budget is in `## Not verified here` (C35)                                                                                                                                                                                                                                        |
| G49 | design.md puts the reranker's row "na mesma lista de modelos" and also below the reranker block's text                                                                                                                                                                                                                                                                                              | the reranker's row sits in the reranker block; the list above holds the embedders (C116, C124)                                                                                                                                                                                                                                     |
| G50 | The plan's independent test of S4 installs the real EmbeddingGemma, which CI cannot                                                                                                                                                                                                                                                                                                                 | the stub stands in for it in CI (C43, C52); the real install is the owner's walk and C137                                                                                                                                                                                                                                          |

## Not verified here

What only a real model on a real machine can prove, and no proof above does:

- the quality of the real vectors: that EmbeddingGemma or Qwen3-Embedding finds the synonym and the section that answers in Portuguese (C137 is opt-in and uncredited)
- the real latency (8 sections in about 150 ms, 475 ms per reranked candidate), the real memory (about 520 MB and 1.8 GB) and the real load time (3 s and 12 s)
- that `@huggingface/transformers` 4.3.2 and `onnxruntime-node` load and run in the child on Linux x64, macOS arm64 and Windows x64, and that macOS Intel and Windows ARM really have no binary
- the real SHA-256 of each catalog file, the real hosts of the model repository and its redirects, and the real `queryPrefix`/`documentPrefix` of each model card
- the cosine scale of each real model and the `minSimilarity` the build records for it; whether the abstention threshold is right for the owner's notes
- the reranker's real "yes" probability from the last token of the Qwen3 prompt
- the installer's real size on each target (only Linux x64 is staged in CI, C66)
- the Gemma Terms of Use text and the legal reading of the download and notices (a draft for the owner's legal review, AD-050 c)
- the 1 s budget of C35 on the owner's hardware
- that the real child (`core/src/models/localChild.ts` on `@huggingface/transformers` 4.3.2) makes no network request at run time: C56 proves it by the source flags and the scan only, never by watching the real child run
- the `pooling` values of Landing row 9 (`mean`, `last_token`): only the real child applies them to real token vectors; the stub child ignores them

## Handoff

The estimate exceeds the 150k budget.

- Arithmetic (`wc -c` of the files each slice touches at the head of `claude/beautiful-volta-6xmhok`, / 4; new files estimated; a file read again in a later slice is counted again):
  - S1: the eval module ≈ 12 000, `apps/api/src/cli.ts` ≈ 15 000 of 73 869, `core/src/memory/recall.ts` 30 872, `core/src/memory/search.ts` 11 704, `core/src/memory/semantic.ts` 8 238, the corpus and queries ≈ 40 000, `tests/natureza.cli.test.ts` 8 716 (the model), `tests/helpers/childBundle.ts` 2 414 = ≈ 129 KB → ≈ 32k
  - S2: the stem module ≈ 4 000, `recall.ts` 30 872, `search.ts` 11 704, `core/src/memory/embeddings.ts` 11 885, `tests/memory.semantic.test.ts` 44 197, `tests/fixtures/semantic-morphology.json` ≈ 2 600 = ≈ 105 KB → ≈ 26k
  - S3: the sections module ≈ 6 000, `core/src/memory/vectors.ts` 10 833, `semantic.ts` 8 238, `embeddings.ts` 11 885, `recall.ts` ≈ 8 000, `core/src/memory/indexer.ts` ≈ 15 000 of 57 742, `core/src/db/migrations.ts` 29 177, `contracts/src/api/memory.ts` ≈ 15 000 of 84 120, `apps/api/src/routes/memory.ts` 30 048, `core/src/memory/audienceIndex.ts` 10 094, `core/src/memory/folderAccess.ts` 9 502, `tests/memory.semantic.test.ts` 44 197, `tests/memoria.access-round2.test.ts` 24 179 = ≈ 222 KB → ≈ 56k
  - S4: the local provider and its child ≈ 15 000, the catalog ≈ 4 000, the downloader ≈ 14 000, the routes ≈ 8 000, the contract ≈ 10 000, `embeddings.ts` 11 885, `contracts/src/settings.ts` 28 640, `core/src/config/failClosed.ts` 4 995, `core/src/config/tolerant.ts` 8 924, `core/src/memory/indexHost.ts` 16 498, `core/src/memory/indexWorker.ts` 4 310, `apps/api/src/context.ts` 16 731, `legal/network-policy.json` 30 209, `scripts/network-scan.mjs` 26 375, `legal/PRIVACY.md` 25 802, `scripts/package.mjs` 30 345, `tests/memory.packaging.test.ts` 4 120, `tests/memory.worker.test.ts` 44 564, `tests/data.settings.test.ts` ≈ 15 000 of 48 780 = ≈ 324 KB → ≈ 81k
  - S5: `recall.ts` 30 872, `semantic.ts` 8 238, `vectors.ts` 10 833, `apps/api/src/mcp/mordomo.ts` 10 602, `cli.ts` ≈ 8 000, `routes/memory.ts` ≈ 8 000, the contract ≈ 6 000, `settings.ts` ≈ 6 000, `tests/natureza.search.test.ts` 18 523, `core/src/memory/linkParser.ts` 4 531, `core/src/memory/links.ts` 10 172, `tests/api.recall-quality.test.ts` 2 739 = ≈ 125 KB → ≈ 31k
  - S6: the reranker ≈ 6 000, the child again ≈ 6 000, `recall.ts` ≈ 10 000, the eval ≈ 4 000, `settings.ts` ≈ 3 000 = ≈ 29 KB → ≈ 7k
  - cross-cutting, API (C97-C108): `tests/helpers/contractWorld.ts` 49 233, `tests/helpers/routeScopes.ts` 10 712, `tests/api.refusals.test.ts` 28 703, `tests/api.contract.test.ts` ≈ 15 000 of 59 894, `tests/api.openapi.test.ts` 32 065, `tests/device-scopes.test.ts` ≈ 15 000 of 87 747, `docs/security.md` ≈ 15 000 of 86 813, `contracts/src/api/errors.ts` 10 532, `tests/data.migration.test.ts` ≈ 5 000 of 25 174, `tests/sdk.surface.test.ts` 10 108, `tests/contracts.test.ts` 14 451, `tests/legal.network.test.ts` 63 625, `tests/security-reads.test.ts` ≈ 10 000 of 111 618, `tests/sdk.instances.test.ts` 25 526 = ≈ 305 KB → ≈ 76k
  - S7: `views/settings/memory.tsx` 6 696, `views/Settings.tsx` 8 910, `views/SettingsFields.tsx` 17 076, `views/settings/shared.ts` 1 205, `locales/brain.ts` 53 820, `ui/Dialog.tsx` 8 409, `hooks/useConfirm.tsx` 1 834, `components/primitives.tsx` 7 383, `api.ts` 34 218, `queries.ts` 9 064, `brain/cleanup/CleanupWizard.tsx` 16 517 (the progress bar), `desktop/useTweenNumber.ts` ≈ 1 500, `ui/ui.css` 14 347, the new block and its stylesheet ≈ 35 000, `docs/memory-guide.md` 24 213, `views/settings/sentinels.test.tsx` 6 539 (the model), `typography.test.ts` ≈ 10 000 of 43 135, `tests/e2e/a11y.spec.ts` 17 550, `tests/e2e/shell.ts` 11 753, `tests/e2e/weekly.spec.ts` 31 090 (the model), `gallery/main.tsx` 29 986, `tests/bundle-size.test.ts` 10 659, `scripts/bundle-baseline.json` 7 937 = ≈ 368 KB → ≈ 92k
  - slices alone ≈ 32k + 26k + 56k + 81k + 31k + 7k + 76k + 92k = ≈ 401k; the new tests (fourteen root files, the world and the stubs ≈ 300 KB, three UI files ≈ 70 KB, `tests/e2e/busca.spec.ts` ≈ 25 KB: ≈ 395 KB) add ≈ 99k: ≈ 500k in all, over 150k
- Proposed cut, at the surface boundaries (batches sequential, each only on green; core and API first, the screen last):
  - **A** (measuring and the Portuguese words): S1 + S2 ≈ 32k + 26k = ≈ 58k, plus `tests/busca.eval.test.ts`, `tests/busca.cli.test.ts` and `tests/busca.stem.test.ts` ≈ 50 KB → ≈ 13k = ≈ 71k; C1-C18 (C9 and C95 need the stub reranker of batch C: they close in C)
  - **B** (sections and migration 34): S3 ≈ 56k, plus `tests/busca.sections.test.ts`, `tests/busca.vectors.test.ts`, `tests/busca.migration.test.ts`, the world and the search/status half of `tests/busca.access.test.ts` ≈ 80 KB → ≈ 20k = ≈ 76k; C17, C19-C40 (C17 moved here from A, confirmed by the orchestrator on 16/11/2026: its claim reads `section_vectors`, which migration 34 creates)
  - **C** (the local model, the download and the two routes): S4 ≈ 81k, plus `tests/busca.embedder.test.ts`, `tests/busca.localprovider.test.ts`, `tests/busca.packaging.test.ts` and the stubs ≈ 100 KB → ≈ 25k = ≈ 106k; C41-C68, C9 and the local-provider cases of C25 and C31 (moved here on 17/11/2026: each has one case that needs the S4 provider, batch B closed the rest)
  - **D** (the hybrid recall, the reranker and the API's closing pins): S5 + S6 + C97-C108 ≈ 31k + 7k + 76k = ≈ 114k, plus `tests/busca.recall.test.ts`, `tests/busca.abstain.test.ts`, `tests/busca.rerank.test.ts`, `tests/busca.contract.test.ts` and the rest of `tests/busca.access.test.ts` ≈ 90 KB → ≈ 23k = ≈ 137k; C69-C108, C95 (C97 and C98 need every route, so they close after S4)
  - **E** (the screen, the copy, the browser and the weight): S7 ≈ 92k, plus the three UI files, `tests/e2e/busca.spec.ts` and the C135 part of `tests/busca.contract.test.ts` ≈ 95 KB → ≈ 24k = ≈ 116k; C109-C136
  - A + B ≈ 147k is at the edge with no room for a fix round, and every other pair is over the budget, so each batch stays apart; A lands first because B's sections reuse S2's search, C's routes and the stub need B's table, D's recall fuses B's sections and C's provider, and E calls C's routes and D's settings
- Mechanism: handoff - chosen by the owner on 16/11/2026 (five batches, sequential, only on green; the next builder reads `checks.md` and the diff of what landed)

Status of batch A (updated in the commit that closes each piece):

- the Portuguese words (S2: C11-C16, C18): closed, every proof green in `tests/busca.stem.test.ts` and in
  `tests/memory.semantic.test.ts` C46; C17 moved to batch B, where it closes (its claim reads `section_vectors`, which
  migration 34 of S3 creates; moved by the orchestrator on 16/11/2026)
- the correction C138 (the folded word itself in the OR, `## Correções do lote A`): closed, its proof green in
  `tests/busca.stem.test.ts` and `tests/memory.semantic.test.ts` C46; it moved C10's `or` mrr from 0.800 to 0.799
- measuring the search (S1: C1-C8, C10): closed, every proof green in `tests/busca.eval.test.ts` and
  `tests/busca.cli.test.ts` (built CLI); the corpus is `tests/fixtures/pt-corpus/` (40 notes) and
  `tests/fixtures/pt-queries.json` (60 queries); C9 stays open for batch C (it needs the stub reranker)

- **Boundary (batch A):** C1-C8, C10-C16 and C18 closed at `3178e05` (S2 in `fc42344`, S1 in `20488c5`, the two pins it
  moved in `3178e05`), with C9 open (batch C, the stub reranker); C17 moved to batch B and closes there (its
  claim reads `section_vectors.vec`, which migration 34 creates; S2 changes no stored vector and C16 pins `hashEmbed`
  by a golden SHA-256). C138 (`## Correções do lote A`) closed after the boundary, in the commit that adds it. On that tree, after `npm run build`, `npm run typecheck` and `npm run lint` exit 0, every `Proof:` line of
  the closed checks passes and runs only its check's tests, and `npx vitest run` at the root has one failure,
  `tests/paineis.refresh.test.ts` C13 (date-dependent, fails the same way on the base). Pins batch A moved: the README's
  command table (`docs.drift` C30), the internal barrel `EvalFormatError`, `formatEvalText`, `runEval` (`sdk.surface`
  C38), the command list of `rituais.access` C73 (exactly `eval`, after `recall`), and the vectors-only example of
  cerebro-v2 C45 (`memory.semantic`): since S2 the words find "ação" against "ações" (C12), so C45 now asserts that pair
  `both` and takes `pauta-ata.md` (a file-name-shaped question the words read as one phrase) as the vectors-only case.
  No route, setting, migration or door added. The `hash` baseline C10 pins: `and` 0.146/0.146/0.146, `or`
  0.938/0.799/0.896 (0.800 before C138), `semantic` 0.729/0.613/0.646, `hybrid` 0.938/0.784/0.896, `abstainCorrect=5/12`; batch D's fused
  recall and its abstention will move the `hybrid` row and `abstainCorrect`, and batch B's sections the `semantic` row.
- **Settled mid-build:** nothing by the owner. Builder decisions inside the approved shape: (a) the ending table is
  `core/src/memory/stem.ts` (`counterparts`); `recall.ts` gains `keywordForms` (the keyword and its folded word,
  `extractKeywords` maps it) and exports `ftsTerm` and `recallOrder`; `search.ts` exports `strictQuery`,
  `everyWordQuery`, `anyWordQuery`, `everyWordSearch` and `anyWordSearch`, and `searchFiles` is built from them; (b) the
  every-word query joins the terms with an explicit `AND` (FTS5 refuses two bracketed groups side by side); since
  C138 each keyword's OR holds the stemmed keyword, the folded word and its counterparts, each form once; (c) the eval is `core/src/memory/eval.ts`: `hybrid` is the recall's
  `scoreCandidates` order 20 deep and, until door 4 lands, the recall "abstains" when its `answerContext` is empty; ranked
  files are matched to `expect` by their `rel`; (d) the format check also refuses a non-`abstain` question with an empty
  `expect` and an `abstain` question with paths; reasons read e.g. `"v" must be 1`, `"queries" must be a list`,
  `"kind" must be one of …`, `cannot read <file>: <error>`; (e) the file is read through `readWorkspaceText` with its
  own folder as the scope; (f) the CLI runs the routes' functions offline, not the routes; the coordinator corrected
  `plan.md` Flow to say so (hop 6 and the `EV` arrows now name `searchFiles`/`SemanticSearch` and `scoreCandidates`); (g) `tests/helpers/buscaWorld.ts` holds `buscaWorld` (memoria world +
  `note`, `search`) and `corpusHome` (a home indexing a copy of the corpus with fixed mtimes, `hash` or off).
- **Abandoned:** an implicit-`AND` every-word query (FTS5 syntax error with bracketed groups); reading the eval file with
  a raw `fs.readFileSync` (it would grow the reviewed raw-read list of `security-reads` C55).

Status of batch B (updated in the commit that closes each piece):

- the shared splitter (S3: C19): closed, its proof green in `tests/busca.sections.test.ts`; `splitSections` moved
  unchanged from `recall.ts` to `core/src/memory/sections.ts` (the recall re-exports it), with `sectionRows` (the rows,
  the heading path, the 64 limit) and `embeddedText` (door 1's text) beside it
- one vector per section (S3: C17, C20-C24, C26-C30, C32-C40; C25 and C31 in part): closed, every proof green in
  `tests/busca.sections.test.ts`, `tests/busca.vectors.test.ts`, `tests/busca.migration.test.ts`,
  `tests/busca.access.test.ts`, `tests/busca.stem.test.ts` (C17) and `tests/busca.cli.test.ts` (C34, built CLI);
  migration 34 creates `section_vectors` and drops `file_vectors`; `embedPending` embeds the sections of a file that
  owes them, one transaction per batch; the search names a hit's best section (`section`, `line`) and the status adds
  `sections` and `model` (`null` until batch C). C25's `local.model` A → B case and C31's "with the stub catalog's
  model active, `model` is its id" stay open for batch C: both need the stub catalog and the `local` provider of S4,
  which this batch does not build; every other case of the two is green. The sections moved C10's `semantic` row:
  mrr 0.613 → 0.632, hit@3 0.646 → 0.667 (recall@20 0.729 unchanged), re-pinned with a comment

- **Boundary (batch B):** C17, C19-C24, C26-C30 and C32-C40 closed at `166d7ee` (the splitter moved in `5e553cd`, the
  section rows and the embedded text in `93a4871`, migration 34 and everything that reads it in `166d7ee`), with C25
  and C31 closed but for one case each that needs batch C's stub catalog and `local` provider (C25's `local.model`
  A → B recompute, C31's `model` = the stub model's id): batch C closes them. On that tree, after `npm run build`,
  `npm run typecheck` and `npm run lint` exit 0, every `Proof:` line of the closed checks passes, and `npx vitest run`
  has one failure, `tests/paineis.refresh.test.ts` C13 (date-dependent, as on the base). Pins batch B moved:
  migrations 33 → 34 (`data.migration` C56 reads `file_vectors` absent after 34, G45; `contexts.runs` C25,
  `memoria.migration` C79 and C39, `natureza.layer` C7, `paineis.layer` C19 and C98, `rituais.layer` C19,
  `device-scopes` C22 with two `sdk.api-thin` C29 amendments); `memory.semantic` reads `section_vectors` (every note of
  its corpora is one section), its C43 status gains `sections` and `model`, and its C45 example "ação" →
  `reuniao-semanal.md` is `text` now (door 1's text adds the title and the H1, 0.219 → 0.199, under hash's 0.2); C10's
  `semantic` row is 0.729/0.632/0.667. No route, setting, export or door added. Measured: C35 280 ms for 20 000
  sections in JavaScript; cerebro-v2 C32 with hash on and 8 sections per note (24 000 sections, worker): the pass
  17.8 s, the longest service write 18.6 ms, loop p99 11.4 ms, no write of 100 ms.
- **Settled mid-build:** nothing by the owner. Builder decisions inside the approved shape: (a) `sections.ts` holds
  `splitSections` (moved unchanged, re-exported by `recall.ts`), `sectionRows` and `embeddedText`; a section with no
  letter or digit is not a section for `ord` and the 64 limit; a block of a `.txt` keeps the splitter's heading
  (`lines 1-40`) as its row's `heading` and its trimmed lines as `start_line`/`end_line`; (b) `embedPending` takes an
  optional `provider` (a test's recording provider); a file whose sections run past a batch is written with `size` -1
  until its last batch settles it, so a pass that stops between leaves the file owed instead of complete with sections
  missing; (c) the vectors phase also requires the row's root to be a root granted today (C27 found a pass over a few
  paths sending a revoked folder's file: `rowFilter` knows excludes and `config/`, not grants); (d) `VectorIndex.rank`
  reads every section row, sorts by distance (1e-6 ties), then file id, then `ord`, and keeps each file's first
  (`Ranked` gains `ord`, `section`, `line`); a hit carries `section`/`line` only when the vectors ranked its file, so an
  `auto` hit found by the words alone has neither; (e) `countVectors` returns `{ files, sections }`; (f) the frontmatter
  of a note is its `(top)` section, as the recall reads it; (g) `tests/helpers/buscaWorld.ts` gains `hashOn`, `rowsOf`,
  `allRows` and `embeddingsServer` (a loopback `/v1/embeddings` with `fail` and `hold`).
- **Abandoned:** leaving `legal/PRIVACY.md`'s table row and `legal/network-policy.json` unchanged was chosen over
  rewording them for sections (`paineis.contract` C62 pins both to its base and the plan's Impact says the text already
  covers the sending); only section 3's "um vetor numérico por nota" moved. The row still says "até 8000 caracteres de
  cada um", now per section: batch C's C67 rewrites that row anyway.

Status of batch C (updated in the commit that closes each piece):

- the local models (S4: C41-C65, C67, C68; C9; the local cases of C25 and C31): closed, every proof green in
  `tests/busca.embedder.test.ts`, `tests/busca.localprovider.test.ts`, `tests/busca.contract.test.ts` (C56, C62, C67,
  C68), `tests/busca.access.test.ts` (C60), `tests/busca.eval.test.ts` (C9), `tests/busca.vectors.test.ts` (C25's
  `local.model` A → B, C31's `model` = the stub model's id), `tests/data.settings.test.ts` C46 and `tests/legal.network.test.ts`
  C24, C25 and C52; against the stubs of "Level honesty" (`tests/helpers/buscaStubs.ts`, `tests/helpers/stubChild.mjs`)
- the installer (S4: C66): closed, its proof green in `tests/busca.packaging.test.ts` (built first): a Linux x64
  payload carries `lib/localChild.mjs` and the runtime, 68.0 MB of it, and the runtime loads from where it lands

- **Boundary (batch C):** C41-C68, C9 and C25 and C31 (their local cases) closed at `366a16b` (the settings in
  `d5416e3`, the local models, the routes, the legal texts and every pin in `a8817ab`, the installer in `366a16b`). On
  that tree, after `npm run build`, `npm run typecheck` and `npm run lint` exit 0, every `Proof:` line of the closed
  checks passes, and `npx vitest run` has one failure, `tests/paineis.refresh.test.ts` C13 (date-dependent, as on the
  base). Pins batch C moved: routes 171 → 173 and non-public 169 → 171 (`api.contract`, `contracts.api`,
  `api.openapi`, `device-scopes` with six `sdk.api-thin` C29 amendments), owner 92 → 94 (and the owner counts of
  `docs/security.md` in `paineis.contract` C60 and `memoria.contract` C82), raised codes 89 → 94 (the five of door 8),
  refusal and event scenarios 171 → 173 (`contractWorld`, `events.contract`), `legal.network` sites 43 → 44 and hosts
  18 → 19 (G40: no help link yet, so 44; batch E's link of G41 may make it 45), `legal.network` C34 accepts the
  model repository's gate being absent by default, `paineis.contract` C62 compares the policy and the 4.1 table to
  its base minus exactly C67's change, `security-reads` C55 70 → 71 rows (the downloader, `api: "*"`; C61 and C84 compare
  to their bases minus that row; the test title keeps its "70 rows" prefix for the older proof lines), the internal
  barrel (`LocalModels`, `LocalModelsOptions`, `ModelRefusal`, `testProvider`), the contracts exports
  (`LOCAL_EMBEDDER_IDS`), the settings pins of `data.settings` C46, C52 and C63 (G34) and the `settings.changed` v1
  fixture. No eval baseline moved: C10's rows are unchanged. Measured: the installer's runtime on Linux x64 adds
  68.0 MB; the CPU-only `onnxruntime-node` folder is 44 MB.
- **Settled mid-build:** nothing by the owner. Catalog values (G39), fixed on 16/11/2026 from the repository's tree
  at pinned commits (`embeddinggemma-300m-ONNX` `5090578d…`, `Qwen3-Embedding-0.6B-ONNX` `c25a394d…`,
  `Qwen3-Reranker-0.6B-ONNX` `9995c50e…`): the files are `config.json`, `tokenizer.json`, `tokenizer_config.json` and
  the dtype's `onnx/model_<dtype>.onnx` (+ `_data` for Gemma; + `generation_config.json` for the reranker), sizes and
  SHA-256 in `core/src/models/catalog.ts`; each of the three was then downloaded through `ModelDownloads` and verified
  (an ad hoc spike, not a proof). Hosts: `huggingface.co` and `*.cdn.hf.co` (the 302 of a large file went to
  `us.aws.cdn.hf.co` from curl and `us.gcp.cdn.hf.co` from Node: an exact host failed the first real download with
  `host_not_allowed`, so the entry names the CDN domain; the policy's `covers` already reads `*.`). Prefixes from the
  model cards: Gemma `task: search result | query: ` / `title: none | text: `, Qwen3-Embedding the
  `Instruct: … \nQuery:` query prefix and no document prefix. `maxChars` 2000 for both embedders. `minSimilarity`
  measured over the Portuguese corpus with the real models on Linux x64 (best cosine of the 12 `abstain` questions
  against the 48 others): Gemma 0.62 (0.48-0.65 against 0.63-0.84), Qwen3-Embedding 0.45 (0.25-0.61 against 0.41-0.83);
  the same spike gave the `semantic` row 1.000/0.891/0.979 (Gemma) and 1.000/0.889/1.000 (Qwen) against hash's
  0.729/0.632/0.667, a batch of 8 in 676 ms (Gemma) and 1 695 ms (Qwen), and the reranker 0.999 against 0.001 on a
  pair in 9.8 s (C137 is still batch D/E's opt-in proof). Builder decisions inside the approved shape: (a) Landing
  row 9 adds `name`, `source` (the pinned `resolve/<commit>/` URL) and `pooling` to door 3's entry and the
  `.verified.json` record of G20; (b) the catalog lives in `core/src/models/` and the settings take its embedders
  from `LOCAL_EMBEDDER_IDS` in the contracts, so a test's stub catalog reuses the real ids (with its files on
  127.0.0.1); (c) `chooseProvider(config, local?)` takes the engine's `LocalEmbedding`; without one `local` reads
  `platform_unsupported`; the platform is unsupported off linux/x64, linux/arm64, darwin/arm64 and win32/x64, without
  a child entry, or when no `node_modules/@huggingface/transformers/package.json` is found walking up from the child
  (by file name: the service never resolves the package); (d) `EmbeddingProvider.embed` takes a `purpose` (`query`
  for the search's one call, so the C52 pin still reads `provider.embed([question]`) and a `batch`; (e) the worker's
  pass asks the host for each batch (`EmbedRequest`/`EmbedReply` in `indexProtocol.ts`) with a snapshot of the ready
  embedder; (f) a crashed batch marks its files' rows `size` -1 so the next pass embeds them again, and a pass that
  recovered keeps `semantic.error`; (g) the POST answers `{ state }` for install, cancel and remove and
  `{ state, model?, test }` for `test` (the state of the active local model, `absent` for hash and http); a remove
  of a model being downloaded is `409 download_in_progress`; (h) the eval's `rerank` row reorders the 20-deep
  hybrid file order's best `candidates` by the reranker's score of each file's first 2 000 characters (batch D aligns
  it with the recall's sections for C95); (i) the license addresses of the catalog are `ignored` in the network
  policy (shown, never contacted), so the hosts stay 19; (j) the installer copies the runtime only when the target is
  the packaging machine (like sqlite-vec: sharp's natives are per-platform packages); `@huggingface/tokenizers` and
  `jinja` are inside the runtime's node build and are not copied; (k) `tests/helpers/buscaStubs.ts` holds
  `stubHost`, `stubCatalog`, `stubChild` and `localWorld`; `notesViewWorld`, `memoriaWorld`, `buscaWorld` and
  `corpusHome` take `AppContextOptions`.
- **Abandoned:** an exact CDN host (`us.aws.cdn.hf.co`) in the catalog and the policy (Node's fetch was sent to
  `us.gcp.cdn.hf.co`); module-level caches in the child (the module-state pin of `sdk.instances` C30: they live in
  `main`'s closure); copying `@huggingface/tokenizers` and `jinja` into the installer.

Status of batch D (updated in the commit that closes each piece):

- the hybrid recall (S5: C69-C76, C78-C88): closed, every proof green in `tests/busca.abstain.test.ts`,
  `tests/busca.recall.test.ts`, `tests/busca.access.test.ts` (C85), `tests/busca.contract.test.ts` (C86),
  `tests/busca.cli.test.ts` (C84, built CLI) and `tests/natureza.search.test.ts` C20; the recall of the route, of
  `mordomo recall` and of `mordomo eval` is `hybridRecall`/`runRecall` in `core/src/memory/recall.ts` (the synchronous
  `recall` stays, by words alone, with the same abstention, hops and budget). C77 is closed by the owner's decision of 17/11/2026 (see `## Correções do lote D`): its last clause ("the
  corpus's `abstain` questions answer `abstained: true`") does not hold under AC 47 on the shipped corpus (with `hash`
  2 of the 12 abstain, with the search off 8: several have a section matching half of their keywords, e.g. "quem
  fornece o chocolate?", or a `hash` cosine at or above 0.2); its other two clauses are proven. Reported to the
  coordinator for the owner. C10's baseline moved: `hybrid` 0.938/0.735/0.875 (was 0.938/0.784/0.896, now the fused
  order) and `abstainCorrect=2/12` (was 5/12, an empty answer; now the recall's own abstention)
- the closing checks so far (C97, C102, C106, C108): closed, their proofs green in `tests/busca.contract.test.ts`,
  `tests/busca.cli.test.ts` (C106, built CLI) and the existing pin files their proof lines name
- the reranker (S6: C89-C96): closed, every proof green in `tests/busca.rerank.test.ts`, `tests/busca.access.test.ts`
  (C93) and `tests/busca.eval.test.ts` (C95: the eval's `rerank` row is now the recall's own reranked order, the
  candidate lists the stub receives during an eval equal those of a recall of each question)
- the rest of the closing checks (C98-C101, C103-C105, C107): closed; C104 and C105 in
  `tests/busca.localprovider.test.ts`, the others by the existing pin files their proof lines name, green at the values
  batches A-C moved them to (batch D adds no route, setting, migration, event or `fs` row; the internal barrel gains
  `hybridRecall`, listed in `sdk.surface` C38)

- **Boundary (batch D):** C69-C76, C78-C108 and C95 closed at `29fdc3d` (S5 and C97, C102, C106, C108 in `72017ac`;
  S6, C95, C104, C105 and the remaining pins in `29fdc3d`), with C77 OPEN: its clause "the corpus's `abstain`
  questions answer `abstained: true`" cannot hold under AC 47 on `tests/fixtures/pt-corpus/` (with `hash` 2 of 12
  abstain, with the search off 8: "quem fornece o chocolate?" has a section matching half of its keywords, and ten
  have a `hash` cosine at or above 0.2); its other two clauses are proven in `tests/busca.recall.test.ts` C77, and the
  owner decides whether the clause goes or the rule changes. C69's text gives B's score as 1/61 + 1/61; RRF gives
  1/62 + 1/61 (B is second in the text list) and the proof asserts that, with the claim's order. On that tree, after
  `npm run build`, `npm run typecheck` and `npm run lint` exit 0, every `Proof:` line of the closed checks passes, and
  `npx vitest run` has one failure, `tests/paineis.refresh.test.ts` C13 (date-dependent, as on the base). Pins batch D
  moved: C10's baseline (`hybrid` 0.938/0.735/0.875, `abstainCorrect=2/12`), the internal barrel (`hybridRecall`,
  `sdk.surface` C38), and `natureza.contract` C65's mock, which wraps `hybridRecall` too now that the route calls it
  (its asserted fact unchanged). No route, setting, migration, event, `fs` row or door added.
- **Settled mid-build:** nothing by the owner. Builder decisions inside the approved shape: (a) `recall` stays
  synchronous (words only: the many callers and tests that read it at once), with door 4's abstention, the hops and
  the budget; `hybridRecall` (the route, `mordomo recall`) and `runRecall` (the eval: the fused order and the reranked
  one) add the vectors and the reranker; (b) the vector candidates are the 50 nearest admitted sections at or above
  the provider's `minSimilarity` (as the search's), while the abstention's cosine is the nearest admitted section's with
  no floor; (c) what a section "matches" for AC 47 is `scoreSection` over the section with its heading path (door 1's
  name of a section, `Banco financeiro > Pagamento`), over every section with a body of every file the recall opens,
  links included: with the section's own heading alone, `tests/api.recall-quality.test.ts`'s second question matches
  2 of 5 and would abstain, against G31; (d) the reranker gets each of the first `candidates` fused files' section (the
  one the answer would take, its body cut at 2 000 characters), and when it is `used` the answer keeps the reranked
  order instead of today's order by score; a head with no section is `skipped`; (e) the hops: a link is followed from
  each taken section up to `hops` levels, `via` the file that pointed, a link's score the candidate's plus the section's
  (as the first level today); (f) `SemanticSearch.nearestSections` embeds the question through the same private
  `embedQuestion` as the search (the one `provider.embed([question]` of C67); `VectorIndex.sections` is `rank` without
  the floor and the one-per-file cut, and `rank` is built on it; (g) the MCP tool and the CLI print
  `abstentionText(reason)` from `apps/api/src/mcp/mordomo.ts`.
- **Abandoned:** making `recall` asynchronous (it would change every synchronous caller and test); fusing every
  admitted section with no floor (with `hash`, a noise file at the vectors' rank 1 ties the words' first hit and beats
  their second); counting a section's own heading alone for AC 47 (see (c)).

Status of batch E (updated in the commit that closes each piece):

- the screen in rendered components (S7: C110-C130): closed, every proof green in
  `apps/command-centre/src/views/settings/semanticSearch.test.tsx`, `semanticSearchCopy.test.ts` and
  `semanticSearchMotion.test.ts`; the block is `views/settings/SemanticSearch.tsx` with `semanticSearch.css`, the second
  card of `MemoryTab`, and the network of its tests is `semanticSearchNet.ts` (answers only the bodies a test allows,
  L-052). C109 and C131 have their component proofs green and close with their browser proofs (`tests/e2e/busca.spec.ts`)
- the browser (C109, C131-C134, C136): closed, every proof green in `tests/e2e/busca.spec.ts` (built first) in both
  shells, both themes where the claim names them; the gallery's entry is `gallery/semanticStory.tsx` (`#story-semantic`);
  C127 also asserts that `busca-por-significado` is the slug of a heading of `docs/memory-guide.md`, whose section gains
  the paragraph on the block; the license link's two hosts (`ai.google.dev`, `www.apache.org`) are ignored in the UI file
  too (`legal/network-policy.json`, their `files`), and the help link is a `github.com` link the policy already covers:
  the sites stay 44 and the hosts 19 (G40: an `<a href>` is not a network site of the scan)
- the weight (C135): closed, its proofs green (`tests/busca.contract.test.ts` C135, `tests/bundle-size.test.ts` C31,
  `npm run build -w apps/command-centre && npm run bundle:check`); measured on a fresh build: JS gzip 612 336 B
  (+7 497 over cerebro-rituais' 604 839, ceiling 617 127), CSS gzip 84 193 B (+697 over 83 496, ceiling 85 544), JS raw
  1 873 695, CSS raw 378 823; the entry is in `scripts/bundle-baseline.json`
- the opt-in real-model proof (C137, NOT CREDITED): written in `tests/busca.realmodel.test.ts`, skipped unless
  `MORDOMO_REAL_MODEL=1` (the models are linked from `MORDOMO_REAL_MODEL_HOME`'s `models/`, default `~/.mordomo`); run
  once on Linux x64 on 18/11/2026 with both embedders downloaded through `ModelDownloads` and verified: 2 passed.
  EmbeddingGemma: `semantic` 0.979/0.889/0.979, `hybrid` 0.979/0.870/0.958, `abstainCorrect=6/12`, best cosine of the
  abstain questions 0.48-0.65 against 0.63-0.84 (catalog 0.62), the synonym question at hit@3 1.000; Qwen3-Embedding:
  `semantic` 0.875/0.806/0.875, `hybrid` 0.938/0.814/0.917, `abstainCorrect=6/12`, 0.25-0.61 against 0.41-0.83 (catalog
  0.45), synonym hit@3 1.000 (`and` and `or` as C10's). The abstention measurement the owner moved here from C77: with a
  real model 6 of the 12 `abstain` questions abstain (hash: 2/12); no rule was changed

- **Boundary (batch E):** C109-C137 closed at `c2db1a7` (the block and its component proofs in `f440cec`, the browser
  proofs, the gallery's story, the guide's paragraph and the policy's two `files` in `f0214b6`, the weight and C137's
  run in `c2db1a7`), C137 opt-in and not credited. On that tree, after `npm run build`, `npm run typecheck`,
  `npm run lint` and `npm run lint:css` exit 0; `npm run test -w apps/command-centre` passes 1981 of 1981;
  `npx vitest run` has one failure, `tests/paineis.refresh.test.ts` C13 (date-dependent, as on the base), and skips
  C137; `tests/e2e/busca.spec.ts` passes its 32 cases (with `contexts.spec.ts`, `organize.spec.ts` and
  `gallery.spec.ts` beside it: `contexts.spec.ts` C32 failed once in that run, the palette's combobox read as the
  console's folder select, and passes alone: flaky, not this block). Pins batch E moved: `legacy.graph` C1 (the
  closed list gains `views/settings/semanticSearchNet.ts`, test material), `ui.source` C25 (the `title` of the active
  model's disabled "Remover", WORDS) and C26 (`gallery/semanticStory.tsx`'s license dialog drawn in place),
  `legal/network-policy.json`'s two license hosts naming the UI file too (sites 44 and hosts 19 unchanged, G40), the
  baseline's new `after` entry (C135). No route, setting, migration, event or door added.
- **Settled mid-build:** nothing by the owner. Builder decisions inside the approved shape: (a) the block is
  `views/settings/SemanticSearch.tsx` with `semanticSearch.css`, the second card `MemoryTab` returns; a partial
  `memory` (an older service, a test) reads as the defaults; (b) `GET /api/memory/embedder` carries the license's name
  only (the Surface, C41's `toEqual`), so the dialog's link takes the license text's address from a map by name in the
  block (the catalog's two), and the policy ignores those two hosts in that file too; (c) G41: the help link is
  `https://github.com/tvpl/agentic-os/blob/main/docs/memory-guide.md#busca-por-significado` (the owner should confirm),
  and G40: an `<a href>` is no network site, so the sites stay 44; (d) after "Continuar" the block starts a pass
  (`POST /api/memory/index`, exists) and reads "Recalculando…" until a status read after it is idle (plan Flow hop 7
  says so); a new "Modelo" of the own server asks it too (design.md "modelo ou dimensões"); a cancelled "Dimensões"
  reads the stored value again; (e) the index line of `hash` puts "com o vetor simples" in place of "com {model}" (the
  table's two strings); (f) the two on/off buttons are the sentinels' (`Ligado`/`Desligado`, `aria-pressed`) named by
  the block's and the reranker's titles; "Modelos" labels the list; the catalog is read again after a save (its
  `active` follows the settings); (g) C131's order follows design.md and G49: the reranker's own row sits below its
  button, so its action comes after the reranker button and before the footer link; (h) the remote warning keeps to
  the checkbox's line and wraps its own text (a 494 px card in the moldura with the conversation open); (i) C137 links
  the models from `MORDOMO_REAL_MODEL_HOME`'s `models/` (default `~/.mordomo`) into fresh homes, indexes through the
  built CLI and measures the cosines through the built core (the source tree has no child).
- **Abandoned:** adding `license.url` to the GET (a Surface change that C41's `toEqual` refuses); marking the chosen
  option by a coloured border (a state told by colour alone, `states.test` C16); letting the remote warning wrap
  below the checkbox (C133).

Whole feature: C1-C138 are all closed (C137 opt-in, not credited; C77 by the owner's decision of `## Correções do
lote D`), with the proof list run on the tree of `c2db1a7`: `npm run build`, `npx vitest run` (3395 passed, the one
known date-dependent failure `tests/paineis.refresh.test.ts` C13, C137 skipped), `npm run test -w apps/command-centre`
(1981 passed), `MORDOMO_E2E_PORT=4901 npx playwright test --config tests/e2e/playwright.config.ts busca.spec.ts`
(32 passed), `npm run bundle:check` (exit 0), and C137 once with `MORDOMO_REAL_MODEL=1` (2 passed).

Round 1 fixes (`## Correções da rodada 1`):

- **Boundary (round 1 fixes):** C139-C142 closed at `0bcae3d` (the corrections and Coverage in `63f5a28`, C139 and C142
  in `67b78a7`, C140 in `52a558f`, C141 in `0bcae3d`); C98 gains the `tests/contracts.api.test.ts` Proof line, no other
  approved claim changed, no product code changed. After `npm run build`: `tests/busca.embedder.test.ts` 44 passed;
  C98's and C99's Proof lines and C30 passed; `npm run test -w apps/command-centre -- src/views/settings` 154 passed;
  `tests/e2e/busca.spec.ts` 34 passed; `npm run typecheck`, `npm run lint` and `npm run lint:css` exit 0. Faults shown
  killed in a scratch worktree: `.onnx`-only verification (C139, six cases), size test removed and SHA-256 test removed
  (C139, four cases each), the scheme clause removed and `http` allowed off this machine (C142), `Plug` swapped and the
  ghost variant (C140), the header as a column under 760 px (C141, both shells).
- **Settled mid-build:** nothing by the owner. Recorded, not changed: any port of an allowed host is accepted today
  (finding 5); C99's name of 34 rests on C30 and `rituais.layer` C19 (finding 4 b).
- **Abandoned:** adding a name assertion to the 34 pins of `memoria.migration` C39 and `natureza.layer` C7 (C30 already
  ties 34 to `section-vectors`); a 1 px sweep of every width for C141 (about 40 s a shell-state; the layout changes are
  measured exactly and the rest every 10 px).
