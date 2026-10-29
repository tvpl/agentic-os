# Cérebro: correções de base checks

Profile: ui
Plan: `.specs/features/cerebro-correcoes/plan.md`

34 checks in 5 slices + cross-cutting · 4 one-way doors · 0 open questions (a pergunta 1 virou AD-037).

Every proof is `npx vitest run <file> -t "<C-id> "` from the repository root (root tests) or
`npm run test -w apps/command-centre -- <file> -t "<C-id> "` (UI tests); a test title starts with its check id. `E2E`
proofs use `MORDOMO_E2E_PORT=4901 npx playwright test --config tests/e2e/playwright.config.ts <spec> -g "<C-id> "`.

## Checks

### S1 - uma só verdade sobre links · ~9 files · ~150 KB · ~38k

**C1** - A note A holding `[[B]]` with B an indexed Markdown file gives `GET /api/memory/graph` exactly one edge `{source: A.id, target: B.id, kind: "wikilink"}` while both are nodes (AC 1)
Proof: `npx vitest run tests/memory.correcoes.test.ts -t "C1 "`

**C2** - A holding `[texto](./b.md#parte)` gives one edge `kind: "markdown-link"` A→B; the same link written twice in A still gives one edge (AC 2)
Proof: `npx vitest run tests/memory.correcoes.test.ts -t "C2 "`

**C3** - A link inside a ``` fence, a ~~~ fence and an inline code span produces no graph edge, no related row, does not save its target from `orphan`, and is not followed by the recall (AC 3)
Proof: `npx vitest run tests/memory.correcoes.test.ts -t "C3 "`

**C4** - With two files matching `[[alvo]]`, the graph draws only the edge to the file `GET /api/memory/links` resolves (same folder first), and none to the other (AC 4)
Proof: `npx vitest run tests/memory.correcoes.test.ts -t "C4 "`

**C5** - After B is renamed to C and reindexed, the graph has no edge from A to C nor to B's old id; after a file named B is created and only it is indexed, the graph has the edge A→new B, with A's `mtime` and bytes unchanged (AC 5)
Proof: `npx vitest run tests/memory.correcoes.test.ts -t "C5 "`

**C6** - `GET /api/memory/hygiene` does not list as `orphan` a note linked only by wikilinks (in and out); it lists a Markdown file with no resolving link in either direction, and one whose only link is broken (AC 6)
Proof: `npx vitest run tests/memory.correcoes.test.ts -t "C6 "`

**C7** - `GET /api/memory/related?id=A` lists B with `why` `"Connected by a wikilink."` for a wikilink and `"Connected by a markdown link."` for a Markdown link (AC 7)
Proof: `npx vitest run tests/memory.correcoes.test.ts -t "C7 "`

**C8** - A recall whose winning section holds `[[B]]` returns B's section with `via` = the source path, and with `pointerLimit: 0` it follows nothing (AC 8)
Proof: `npx vitest run tests/memory.correcoes.test.ts -t "C8 "`

**C9** - Migration 22 on a database with `file_links` rows and `meta.index.pending_links` drops the table and the key, leaves the `files` and `note_links` rows byte for byte, and succeeds on a database without them; `user_version` is 22 (AC 9)
Proof: `npx vitest run tests/memory.correcoes.test.ts -t "C9 "`

**C10** - No file under `core/src`, `apps/api/src` or `apps/command-centre/src` other than `core/src/db/migrations.ts` contains the text `file_links` (AC 10)
Proof: `npx vitest run tests/memory.correcoes.test.ts -t "C10 "`

**C11** - The `memory.graph` success schema of the `API` table accepts edge kinds `markdown-link`, `wikilink`, `same-dir`, `related` and refuses `same-area`; no interface label table holds the key `brain.kind.same-area` and each holds `brain.kind.wikilink` in both locales (AC 11)
Proof: `npx vitest run tests/memory.correcoes.test.ts -t "C11 "`

**C12** - `linkEdges` over 3 000 files and 20 000 `note_links` rows runs the same number of prepared-statement executions as over 30 files and 200 rows (AC 12)
Proof: `npx vitest run tests/memory.correcoes.test.ts -t "C12 "`

### S2 - a política em toda leitura · ~4 files · ~45 KB · ~12k

**C13** - With a user exclude added after the pass (no reindex), and with a stale row under the home's `config/`, `GET /api/memory/graph` returns neither as a node, no edge touching them, and a `totalFiles` that does not count them (AC 13)
Proof: `npx vitest run tests/memory.correcoes.test.ts -t "C13 "`

**C14** - `GET /api/memory/related` answers `404 not_found` for an excluded row's id and for an id with no row; for an allowed row no file in the answer is an excluded one (AC 14)
Proof: `npx vitest run tests/memory.correcoes.test.ts -t "C14 "`

**C15** - With 30 matching files of which the 20 best by BM25 are excluded, `GET /api/memory/search?q=…&limit=8` returns 8 allowed rows, in the order the unfiltered matches had them; with 5 allowed matches it returns 5 (AC 15)
Proof: `npx vitest run tests/memory.correcoes.test.ts -t "C15 "`

**C16** - With an empty `q`, 12 rows of which the 6 most recent are excluded, `limit=4` returns the 4 most recent allowed rows (AC 16)
Proof: `npx vitest run tests/memory.correcoes.test.ts -t "C16 "`

### S3 - uma frase acha notas · ~4 files · ~80 KB · ~20k

**C17** - The query "o que decidimos sobre o orçamento" searches only the words `extractKeywords` keeps, and returns a note holding "orçamento" and not "decidimos" (AC 17)
Proof: `npx vitest run tests/memory.correcoes.test.ts -t "C17 "`

**C18** - With notes holding all kept words, some, and one, every note holding all comes before any holding only some (AC 18)
Proof: `npx vitest run tests/memory.correcoes.test.ts -t "C18 "`

**C19** - With no note holding all kept words, notes holding 3, 2 and 1 of them come in that order, and two holding the same number come by BM25 (AC 19)
Proof: `npx vitest run tests/memory.correcoes.test.ts -t "C19 "`

**C20** - On the fixed corpus (`tests/fixtures/semantic-corpus.json`) with the semantic search off, `GET /api/memory/search` puts the expected note in the first three for at least 11 of the 12 questions (AC 20)
Proof: `npx vitest run tests/memory.correcoes.test.ts -t "C20 "`

**C21** - A query made only of stopwords ("o que é") searches the typed words strictly; a query that is only punctuation ("?!") answers the empty-query listing (AC 21)
Proof: `npx vitest run tests/memory.correcoes.test.ts -t "C21 "`

**C22** - No answer of `GET /api/memory/search` holds the same file id twice, across the two queries and the semantic fusion (`mode=auto` with the `hash` provider on); the other modes still behave: `mode=semantic` answers `409 semantic_disabled` with the semantic search off and only `via: "semantic"` rows with it on (AC 22, `cerebro-v2` AC 43 unchanged)
Proof: `npx vitest run tests/memory.correcoes.test.ts -t "C22 "`

**C31** - The C46 of `cerebro-v2`, amended by AD-037: the strict query (`strictWordsSearch`) finds 5 of the 12 questions and `mode=text` finds at least 11, the hybrid still 11 (AD-037, AC 20)
Proof: `npx vitest run tests/memory.semantic.test.ts -t "C46 on the fixed corpus"`

### S4 - erro de busca é erro · ~6 files · ~140 KB · ~36k

**C23** - With `/api/v1/memory/search` answering `500` (and, in a second run, aborted as a network failure), the Second Brain screen (moldura) and the Núcleo brain scene each show "Search failed." / "A busca falhou." with an icon and a "Try again" / "Tentar de novo" button in the place of the hits, and no hit of the earlier successful query (AC 23)
Proof: `MORDOMO_E2E_PORT=4901 npx playwright test --config tests/e2e/playwright.config.ts brain-errors.spec.ts -g "C23 "`

**C24** - The shared search hook, after a failed request, on "Tentar de novo" repeats the request for the current text once; when it succeeds the error is cleared and the new hits are returned (AC 24)
Proof: `npm run test -w apps/command-centre -- src/brain/useBrainSearch.test.tsx -t "C24 "`

**C25** - With `/api/v1/memory/related` failing, the Núcleo brain scene shows "Could not load related files." / "Não foi possível carregar os relacionados." with "Try again" in place of the list, and none of the previously selected node's related files (AC 25)
Proof: `MORDOMO_E2E_PORT=4901 npx playwright test --config tests/e2e/playwright.config.ts brain-errors.spec.ts -g "C25 "`

**C26** - The two error states have computed font size ≥ 12px, `role="alert"`, and axe (WCAG 2 A/AA) reports no violation on both screens in the dark and the light theme; the new CSS uses only tokens (stylelint) (AC 26)
Proof: `MORDOMO_E2E_PORT=4901 npx playwright test --config tests/e2e/playwright.config.ts brain-errors.spec.ts -g "C26 "`
Proof: `npx stylelint --config stylelint.config.mjs "apps/command-centre/src/brain/*.css" "apps/command-centre/src/nucleo/scenes/*.css"`

### S5 - o mapa acompanha o índice · ~5 files · ~60 KB · ~15k

**C27** - `POST /api/memory/index` after a note changed rewrites `memory/ROUTER.md` with today's journal block before `index.finished` is announced; a pass started by `FsWatchSentinel.flush` does the same; a pass with `added + updated + removed = 0` writes no router file (AC 27)
Proof: `npx vitest run tests/memory.correcoes.test.ts -t "C27 "`

**C28** - `generateRouters` called twice with nothing changed writes nothing the second time: `ROUTER.md` and each `areas/*.md` keep their `mtimeMs` and inode (AC 28)
Proof: `npx vitest run tests/memory.correcoes.test.ts -t "C28 "`

**C29** - With the `fsWatch` sentinel on and a 50 ms debounce, editing one note leads to at most two index passes and the second writes no router file; three seconds later no third pass has started (AC 29)
Proof: `npx vitest run tests/memory.correcoes.test.ts -t "C29 "`

**C30** - With `memory/ROUTER.md` replaced by a link out of `memory/`, `POST /api/memory/index` still answers `200` with `stats`, `index.finished` is announced, and the log holds one line with the code `routers_failed` (AC 30)
Proof: `npx vitest run tests/memory.correcoes.test.ts -t "C30 "`

### Cross-cutting

**C32** - The OpenAPI document carries `404` for `memory.related` and the edge kind `wikilink` for `memory.graph`, and still validates as OpenAPI 3.1 (door 4, AD-024)
Proof: `npx vitest run tests/memory.correcoes.test.ts -t "C32 "`
Proof: `npx vitest run tests/api.openapi.test.ts -t "C16 the document validates"`

**C33** - The raw `fs` allowlist and the module-state list do not grow: the existing sweeps stay green without an edit to their lists
Proof: `npx vitest run tests/security-reads.test.ts -t "C55 the list holds 70 rows"`
Proof: `npx vitest run tests/sdk.instances.test.ts -t "C30 the module-level mutable state"`

**C34** - The inline indexer and the worker (`core/dist/memory/indexWorker.js`) write the same `note_links` rows and no `file_links` for the same tree (door 1)
Proof: `npx vitest run tests/memory.correcoes.test.ts -t "C34 "`

## Coverage

| Set (size)                                 | Member -> proof                                                                                  | Unproven |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------ | -------- |
| `GET /api/memory/related` statuses (2)     | 200 C7, C14 · 404 C14                                                                            | -        |
| `GET /api/memory/graph` statuses (1)       | 200 C1, C13                                                                                      | -        |
| `GET /api/memory/search` statuses (2)      | 200 C15-C22 · 409 C22                                                                            | -        |
| graph edge kinds (4)                       | `markdown-link` C2 · `wikilink` C1 · `same-dir` C11 (schema; emission unchanged) · `related` C11 | -        |
| readers moved to `note_links` (4)          | graph C1 · related C7 · hygiene orphans C6 · recall pointers C8                                  | -        |
| link places ignored (3)                    | ``` fence C3 · ~~~ fence C3 · inline code C3                                                     | -        |
| link lifecycle (3)                         | rename C5 · create C5 · ambiguous key C4                                                         | -        |
| policy exclusions on read (3)              | user exclude C13, C14, C15 · home `config/` C13 · secret name C16                                | -        |
| reads filtered before the cut (2)          | text query C15 · empty query C16                                                                 | -        |
| query branches (4)                         | all words C18 · some words C19 · stopwords only C21 · punctuation only C21                       | -        |
| search modes (3)                           | `text` C20, C31 · `auto` C22 · `semantic` C22                                                    | -        |
| search error kinds (2)                     | HTTP `500` C23 · network C23                                                                     | -        |
| screens with the error state (2)           | moldura Second Brain C23, C26 · Núcleo brain scene C23, C25, C26                                 | -        |
| themes for axe (2)                         | dark C26 · light C26                                                                             | -        |
| router regeneration triggers (2)           | `POST /api/memory/index` C27 · `fsWatch` pass C27, C29                                           | -        |
| router write outcomes (3)                  | changed C27 · unchanged C28 · failed C30                                                         | -        |
| doors (4)                                  | 1 C9, C10, C34 · 2 C1, C12 · 3 C17-C21, C31 · 4 C14, C32                                         | -        |
| entities of Relations (1)                  | `note_links` C1, C9, C34                                                                         | -        |
| startup config: link writer (2 assemblies) | inline indexer (vitest source tree) C34 · worker build (`core/dist`) C34                         | -        |

- `mordomo index` already regenerated the routers before this feature (`apps/api/src/cli.ts:1394`) and is not a member of the trigger set
- Claims naming a status code, route or response shape: C1, C2, C6, C7, C13-C22, C27, C30, C32 - each has a proof
  that crosses the HTTP boundary (`app.inject` against `buildServer`)
- Claims about the screens (C23, C25, C26) are proven in a real browser against the built interface; C24 in the hook
- No other check claims more than the single case its proof exercises

## Binding sources

| Source                                                                                    | Checked by                                |
| ----------------------------------------------------------------------------------------- | ----------------------------------------- |
| `design-system/design.md`: 12px floor, tokens only, state not by colour alone, axe A/AA   | C23 (icon + text), C26                    |
| `cerebro-v2/design.md`: the error state of the links section (message + "Tentar de novo") | C23, C25 (the same copy shape and button) |
| `moldura-app/design.md` and AD-005: both shells show the same data                        | C23 (both screens)                        |

## Test policy

| Code                                                                                        | Required proofs                                       | Coverage expectation                                                                           |
| ------------------------------------------------------------------------------------------- | ----------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| Decides, reached across a boundary (`searchFiles` query branches, `linkEdges`, related 404) | one at the HTTP boundary **and** one at its own layer | the contract at the boundary; one asserted case per row of the decision table at its own layer |
| Decides, not reached across a boundary (`generateRouters` write-if-changed, migration 22)   | one at its own layer                                  | one asserted case per row                                                                      |
| Screens                                                                                     | one in a real browser per screen                      | each state the plan names, both themes for axe                                                 |

Evidence:

- `core/src/memory/search.ts`: after the change, 4 query branches (all, some, stopwords only, nothing left) and the
  filter-before-cut loop -> decides
- `core/src/memory/links.ts` `linkEdges`: 2 link kinds × resolved / unresolved / refused by policy -> decides
- `core/src/memory/routers.ts`: write when bytes differ, skip otherwise -> decides
- closest analogue: `tests/memory.links.test.ts` (S2 of `cerebro-v2`), the same layers proven at the HTTP boundary and
  in the core

## Swept

- validation: C21 (a query that is only stopwords or punctuation)
- failure modes: C30 (router regeneration fails without failing the pass), C23 (a failed search)
- idempotency: C2 (a duplicated link is one edge), C9 (migration on a database without the table), C28
- authorization: C13, C14, C15, C16 (today's policy on every read); route scopes unchanged (existing `content`)
- concurrency: C29 (the sentinel does not loop on its own write); the pass itself keeps the `cerebro-v2` lock (existing, its AC 37)
- data lifecycle: C5 (rename and create without rewriting sources), C9 (the dropped table)
- dependency failure: C23 (network failure of the search), C25
- state transitions: C24 (error → retry → hits)
- observability: C30 (`routers_failed` in the log)

## Handoff

- S1 = 38k (core memory + migrations + API + contracts), S2 enters the API routes at 50k, S3 the search at 70k, S4 the
  interface at 106k, S5 the routers and the sentinel at 121k, cross-cutting ~5k → 126k, under the 150k budget - one
  builder. Arithmetic: `wc -c` of the touched files (links 7 KB, graph 7 KB, hygiene 8 KB, recall 23 KB, indexer 44 KB,
  search 5 KB, semantic 7 KB, routers 9 KB, migrations 18 KB, routes/memory 11 KB, contracts/api/memory 21 KB, fsWatch
  5 KB, SecondBrain 29 KB, BrainScene 70 KB read in parts, BrainPanel 22 KB, locales/brain 9 KB) ≈ 315 KB / 4 ≈ 79k,
  plus ~45k of new tests and the e2e spec.
- Mechanism: one builder (fits)
