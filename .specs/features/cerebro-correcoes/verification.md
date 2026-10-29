# Cérebro: correções de base verification

**Verdict**: FAIL
**Profile**: ui
**Diff range**: 8148d42..8aa08bc (fix diff 7966925..8aa08bc)
**Round**: 2 - scoped
**Verifier**: independent sub-agent (author != verifier; not the builder, not the round 1 verifier)

Verified at `8aa08bc` in a fresh detached worktree (`git worktree add --detach`, `npm ci`, `npm run build`,
`npm run typecheck` and `npm run lint` all exit 0). The real tree's `git status --porcelain` was empty before and after.
This file is the only change to it, plus the lesson that step 7 records in `.specs/lessons.json` and `.specs/LESSONS.md`.
The fix changed one source file, `core/src/memory/recall.ts`. It also changed tests (`tests/memory.correcoes.test.ts`,
`tests/e2e/brain-errors.spec.ts`, new `apps/command-centre/src/nucleo/scenes/BrainSceneReader.related.test.tsx`), the
text of 13 checks, the plan (a new section, "Emendas depois da aprovação") and `.specs/STATE.md`. No interface source
changed.

## Round 1 in short (FAIL at `7966925`)

Round 1 found 10 ranked gaps:

1. C22 duplicate mutant survived
2. C17 stopword mutant survived
3. C25 absence assertion was vacuous
4. C26 floor of 12px contradicted the 13px rule for messages
5. C26 measured only one error state
6. placement in C23/C25 was unasserted
7. the own-layer Test policy row was unmet
8. the worker assembly of AC 27 was unproven
9. home `logs/`, a secret name on the graph and `4xx` had no proof
10. C21 strictness was a precision gap

Every one is re-checked below with my own mutants or probes. All ten are closed.

## Ranked gaps (the FAIL)

1. **Surviving mutant, C8, on the surface the fix created.** The fix made the recall resolve a wikilink only among the
   files its scope may read (`core/src/memory/recall.ts:437`, `(row) => isReadable(scope, path.join(row.root, row.rel))`).
   I reverted that one argument to the round 1 `() => true`, and every proof that reaches the recall stayed green:
   C3, C8 and `security-reads` C22.

   The behaviour is real. I wrote a probe (scratch only, not committed): a note holds `[[Alvo8p]]`, the
   shortest-path homonym sits in a folder excluded after the pass, and a readable homonym sits elsewhere. At HEAD the
   recall follows the wikilink to the readable file (`via` = the source). Under the mutant it follows nothing
   (`answerContext` = the source only). That breaks C8's claim ("returns B's section with `via` = the source path"),
   and no proof has it. The checks' Handoff lists this change as a round 1 fix ("the recall resolves wikilinks within
   its readable scope"), but no assertion pins it. The fix needed is one test.

Non-gating notes:

- **C27's last clause and AD-038(b) narrow approved AC 27, and the owner has not answered yet.** Approved AC 27
  regenerates the routers after any pass that changed rows. C27 now also asserts "on a home with no routers a pass
  creates none" (`tests/memory.correcoes.test.ts:807-808`), and `core/src/engine.ts:308-317` implements it. This is
  amended text, not approved text. It is recorded correctly: plan "Emendas depois da aprovação", AD-038(b) (pending),
  and owner question "cerebro-correcoes 1" with a default and a revert path. The verdict on C27 holds only if the owner
  takes the default. If not, the fresh-home test and the `ENOENT` early return flip.
- **C25's browser absence assertion still has no precondition.** `brain-errors.spec.ts:111-113` expects no "Close, but
  not linked" section, but the e2e home shows none for either node even with the guard removed: mutant M5 survives the
  e2e. The component proof kills M5 (`BrainSceneReader.related.test.tsx:96-97`, with the precondition at `:88-89`), and
  the amended C25 assigns the guard to the component. So the claim is proven, but the browser line on its own is
  vacuous. The scene also clears the previous node's related files on every selection
  (`apps/command-centre/src/nucleo/scenes/BrainScene.tsx:695`).
- The C13 test title still names only "an excluded row and a stale row under the home's config/"
  (`tests/memory.correcoes.test.ts:404`). The body covers `logs/` and `*.pem` too.
- Probe of the Núcleo results after a failed search: the panel reads "NOTHING ABOUT “DEPOIS” IN THE SKY", then
  "Search failed.", then "Try again". The eyebrow counts the sky's name matches (`BrainScene.tsx:1652`, pre-existing),
  not content hits, so it is not the hit list that AC 23 replaces, and no binding source decides it. Recorded for the
  owner, not a finding.
- The round 1 note that AD-037 had been edited after approval is resolved. The AD-037 row at HEAD is byte-identical to
  the row at `8148d42`, and the build amendments moved to AD-038.

### The amended check texts, judged against the approved plan and the binding sources

| Check | Amendment                                                                                                            | Judgment                                                                                                                                                          |
| ----- | -------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| C1    | adds the own-layer `linkEdges` rows (resolved, unresolved, refused)                                                  | strengthens                                                                                                                                                       |
| C13   | adds the home's `logs/` and a secret name (`*.pem`)                                                                  | strengthens - now matches AC 13's four members                                                                                                                    |
| C14   | adds the own-layer `relatedFiles` `null`                                                                             | strengthens                                                                                                                                                       |
| C17   | query token `orçamento17`; stopword-only note absent; first at its own layer                                         | strengthens - the unique token keeps AC 17's sentence and isolates the test                                                                                       |
| C18   | exact answer (each once), order all→more→fewer, route and own layer                                                  | strengthens                                                                                                                                                       |
| C19   | adds the own layer                                                                                                   | strengthens                                                                                                                                                       |
| C21   | query `"sobre entre"`, with a negative note holding only one word                                                    | strengthens - both are stopwords (mutant M3 reaches the stopword-only branch with this query), and the negative note pins "strictly"                              |
| C22   | adds a file matched by both queries, listed once                                                                     | strengthens - the semantic-fusion half is kept                                                                                                                    |
| C23   | adds `403`, placement (after the box / inside the results), message before button, no hit list                       | strengthens - matches AC 23 (`4xx`) and the `cerebro-v2/design.md` "in place of the list"                                                                         |
| C25   | "none of the previous node's related" becomes "the 'Close, but not linked' list is not shown" plus a component proof | keeps - hiding the whole section is at least as strong as hiding the previous node's files, and the component proof carries the guard; see the browser note above |
| C26   | message ≥ 13px and button ≥ 12px; both error states                                                                  | strengthens - aligned with `design-system/design.md` (messages at `--fs-3`); the plan's amendment states this satisfies AC 26 too                                 |
| C27   | adds the worker pass and "settle within three"; adds "a fresh home creates none"                                     | strengthens (worker) / **weakens against approved AC 27 (fresh home), pending the owner** (AD-038(b))                                                             |

## Binding sources

Step 1 is scoped. The fix touched no interface source, but it amended the checks of three screens' states (C23, C25,
C26), so those were compared again. Verified at `8aa08bc`.

| Source                                                                                                                            | Opened                                                                    | Contradiction | Uncovered |
| --------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- | ------------- | --------- |
| `.specs/features/design-system/design.md` (messages at `--fs-3` 13px, labels at 12px, tokens only, not by colour alone, axe A/AA) | yes - re-read the Tipografia and Acessibilidade rules against amended C26 | none          | -         |
| `.specs/features/cerebro-v2/design.md`, links section: message + "Tentar de novo", in place of the list                           | yes - re-read against amended C23 and C25                                 | none          | -         |
| `.specs/features/moldura-app/design.md` + AD-005 (both shells, same data)                                                         | carried from `7966925` (no change in the fix touches it)                  | none          | -         |

Per-screen enumeration, updated at `8aa08bc`:

- **Moldura Second Brain, failed search:**
  - alert role and message: C23 `brain-errors.spec.ts:60`
  - one icon: `:71`
  - "Try again": `:72`
  - old hit absent: `:73`
  - placement right after the search box: `:80`, `.brain2 input.input + .brain-request-failed`; mutant M9b killed
  - no hit list: `:81`
  - message first, button last: `:82-83`; mutant M10 killed
  - message ≥ 13px, button ≥ 12px: `:146-147`
  - axe in dark and light: `:148`
- **Núcleo scene, failed search:**
  - the same assertions as the moldura
  - placement inside `.bs-results`: `:80`; mutant M9 killed
  - no `.bs-hits`: `:81`
- **Núcleo reader, failed related files:**
  - alert and "Try again": `:106-107`
  - placement in a section of the rail: `:110`
  - no "Close, but not linked" list: component `BrainSceneReader.related.test.tsx:96-97`, against the precondition at
    `:88-89`
  - message before the button: `:99`, `:101`
  - retry called once: `:103`
  - message ≥ 13px, button ≥ 12px, axe in both themes: `brain-errors.spec.ts:162-164`
- Nothing is rendered that the sources do not draw: `RequestFailed.tsx` holds the icon, the text and the button only.

## Checks

The proofs were re-run in full at `8aa08bc`. Evidence citations were refreshed for every file the fix touched.

| Check | Claim                                                                                                                                                   | Proof run                                                                                                                                                                         | Evidence                                                                                                                                                                                                                                                                                                                          | Result |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| C1    | one `wikilink` edge A→B; own layer: resolved yes, unresolved and refused no                                                                             | root batch ✓ (both C1 tests)                                                                                                                                                      | `tests/memory.correcoes.test.ts:112` - `toEqual([{ source: idOf(a), target: idOf(b), kind: "wikilink", … }])`; `:123-127` - `from(() => true)).toEqual([[b,"wikilink"],[hidden,"wikilink"]])` (no edge for `[[Ninguem1b]]`), `from(refuse oculta)).toEqual([[b,"wikilink"]])`                                                     | PASS   |
| C2    | Markdown link with fragment is one edge, twice still one                                                                                                | root batch ✓                                                                                                                                                                      | `tests/memory.correcoes.test.ts:139` - `edges.map((e) => e.kind)).toEqual(["markdown-link"])`                                                                                                                                                                                                                                     | PASS   |
| C3    | fenced / inline-code links: no edge, no related, no orphan rescue, no recall pointer                                                                    | root batch ✓                                                                                                                                                                      | `tests/memory.correcoes.test.ts:150` - `toEqual([])`; `:154` - `not.toContain(b)`; `:159-160` - orphans contain a, b; `:167` - `some((c) => c.via === a)).toBe(false)`                                                                                                                                                            | PASS   |
| C4    | ambiguous key: only the edge `/links` resolves                                                                                                          | root batch ✓                                                                                                                                                                      | `tests/memory.correcoes.test.ts:179` - `resolved!.path).toBe(near)`; `:181` - `toEqual(["wikilink"])`; `:182` - far `toEqual([])`                                                                                                                                                                                                 | PASS   |
| C5    | rename: no edge to C or old id; create: edge to new B, A untouched                                                                                      | root batch ✓                                                                                                                                                                      | `tests/memory.correcoes.test.ts:198-199` - `toEqual([])`, old id `.toBe(false)`; `:203` - `toEqual(["wikilink"])`; `:204-205` - bytes `toEqual`, `mtimeMs).toBe(...)`                                                                                                                                                             | PASS   |
| C6    | hygiene: wikilink-only note is no orphan; unlinked and broken-only are                                                                                  | root batch ✓                                                                                                                                                                      | `tests/memory.correcoes.test.ts:220-223` - `not.toContain(hub)`, `not.toContain(leaf)`, `toContain(alone)`, `toContain(broken)`                                                                                                                                                                                                   | PASS   |
| C7    | related `why` per kind                                                                                                                                  | root batch ✓                                                                                                                                                                      | `tests/memory.correcoes.test.ts:237-238` - `toBe("Connected by a wikilink.")`, `toBe("Connected by a markdown link.")`                                                                                                                                                                                                            | PASS   |
| C8    | recall follows `[[B]]` with `via`; `pointerLimit: 0` follows nothing                                                                                    | root batch ✓                                                                                                                                                                      | `tests/memory.correcoes.test.ts:256` - `some((c) => c.path === target && c.via === src)).toBe(true)`; `:259` - `.toBe(false)`. The fix's scope-limited resolution (`recall.ts:437`) has no assertion: mutant M8 survived                                                                                                          | FAIL   |
| C9    | migration 22 drops table and key, keeps rows, runs fresh, `user_version` 22                                                                             | root batch ✓                                                                                                                                                                      | `tests/memory.correcoes.test.ts:289-293` - `toBe(22)`, `file_links` `toBeUndefined()`, key `toBeUndefined()`, files and note_links `toEqual(before…)`; `:302-303`                                                                                                                                                                 | PASS   |
| C10   | no `file_links` outside migrations.ts                                                                                                                   | root batch ✓                                                                                                                                                                      | `tests/memory.correcoes.test.ts:326` - `found).toEqual([path.join("core", "src", "db", "migrations.ts")])`                                                                                                                                                                                                                        | PASS   |
| C11   | contract kinds: accepts 4, refuses `same-area`; `wikilink` labels in both locales                                                                       | root batch ✓                                                                                                                                                                      | `tests/memory.correcoes.test.ts:338-339` - `success).toBe(true)` / `.toBe(false)`; `:341-342` - `not.toContain("brain.kind.same-area")`, `toHaveLength(2)`                                                                                                                                                                        | PASS   |
| C12   | `linkEdges` executions constant from 30/200 to 3 000/20 000                                                                                             | root batch ✓                                                                                                                                                                      | `tests/memory.correcoes.test.ts:398-399` - `big).toBe(small)`, `toBeLessThanOrEqual(2)`                                                                                                                                                                                                                                           | PASS   |
| C13   | graph: user exclude, `config/`, `logs/`, `*.pem`: no node, no edge, not counted                                                                         | root batch ✓                                                                                                                                                                      | `tests/memory.correcoes.test.ts:453` - `for (const id of refused) expect(ids.has(id)).toBe(false)` over `[closedId, staleId, logsId, secretId]` (`:447`); `:455` - edge touch `.toBe(false)`; `:461` - `totalFiles).toBe(rows.filter(allowed).length)`                                                                            | PASS   |
| C14   | related 404 `not_found` for refused and missing id; allowed lists no excluded; own layer `null`                                                         | root batch ✓                                                                                                                                                                      | `tests/memory.correcoes.test.ts:477-481` - `toBe(404)`, `toBe("not_found")` ×2; `:486` - `not.toContain(hidden)`; `:489-491` - `relatedFiles(...)).toBeNull()` ×2, `not.toContain(hidden)`                                                                                                                                        | PASS   |
| C15   | with the 20 best excluded: 8 allowed in unfiltered order; 5 when only 5                                                                                 | root batch ✓                                                                                                                                                                      | `tests/memory.correcoes.test.ts:509-511` - `toHaveLength(8)`, `toEqual(unfiltered.filter(...).slice(0, 8))`; `:514` - `toHaveLength(5)`                                                                                                                                                                                           | PASS   |
| C16   | empty q: the 4 most recent allowed rows, past 6 excluded                                                                                                | root batch ✓                                                                                                                                                                      | `tests/memory.correcoes.test.ts:542` - `toEqual(["l0.md", "l1.md", "l2.md", "l3.md"])`                                                                                                                                                                                                                                            | PASS   |
| C17   | only kept words searched: stopword note absent, budget note present (first at own layer), strict finds nothing                                          | root batch ✓                                                                                                                                                                      | `tests/memory.correcoes.test.ts:558-559` - `toContain("verba17.md")`, `not.toContain("vazia17.md")`; `:561-562` - `own[0]).toBe("verba17.md")`, `not.toContain("vazia17.md")`; `:564` - strict `toEqual([])`. Mutant M2 killed                                                                                                    | PASS   |
| C18   | exactly all-words note first, then the other two, each once; route and own layer                                                                        | root batch ✓                                                                                                                                                                      | `tests/memory.correcoes.test.ts:574-575` - `names[0]).toBe("todas18.md")`, `sort()).toEqual(["duas18.md", "uma18.md"])`; `:577` - own layer `toEqual(["todas18.md", "duas18.md", "uma18.md"])`. Mutant M1 killed                                                                                                                  | PASS   |
| C19   | 3, 2, 1 words, then BM25; route and own layer                                                                                                           | root batch ✓                                                                                                                                                                      | `tests/memory.correcoes.test.ts:596` - `toEqual(["tres19.md", "duas19a.md", "duas19b.md", "uma19.md"])`; `:597` - own layer `toEqual(names)`                                                                                                                                                                                      | PASS   |
| C20   | fixed corpus, semantic off: ≥ 11 of 12 in the top 3 over HTTP                                                                                           | root batch ✓                                                                                                                                                                      | `tests/memory.correcoes.test.ts:621-622` - `toHaveLength(12)`, `found).toBeGreaterThanOrEqual(11)`                                                                                                                                                                                                                                | PASS   |
| C21   | stopwords only: strict (both-words note in, one-word note out); punctuation only: the listing                                                           | root batch ✓                                                                                                                                                                      | `tests/memory.correcoes.test.ts:639-640` - `toContain("frase21.md")`, `not.toContain("metade21.md")`; `:641` - own layer `toEqual(strict)`; `:645` - `punctuation.json()).toEqual(recent.json())`. Mutant M3 killed                                                                                                               | PASS   |
| C22   | each file once (a file in both queries, route and own layer; `text`, `auto`); `semantic` 409 off, `via: semantic` on                                    | root batch ✓                                                                                                                                                                      | `tests/memory.correcoes.test.ts:657-659` - `bothIds.length).toBe(2)`, `new Set(ids).size).toBe(ids.length)` (route and own layer); `:670-671` - `toBe(409)`, `toBe("semantic_disabled")`; `:686` - `toEqual(new Set(["semantic"]))`. Mutant M1 killed                                                                             | PASS   |
| C23   | failed search (500, 403, network), both shells: message, icon, Try again, in place of the hits, message before button, no old hit                       | e2e batch - 6 C23 tests ✓                                                                                                                                                         | `tests/e2e/brain-errors.spec.ts:60` - alert `toBeVisible()`; `:71` - `svg toHaveCount(1)`; `:72` - Try again; `:73` - `getByText("achado-antes.md")).toHaveCount(0)`; `:80` - placement `toBeVisible()`; `:81` - hit list `toHaveCount(0)`; `:82-83` - last child `BUTTON`, first child `toMatch(FAILED)`                         | PASS   |
| C24   | hook: retry repeats once for the current text; error clears, new hits                                                                                   | UI batch - C24 ✓                                                                                                                                                                  | `apps/command-centre/src/brain/useBrainSearch.test.tsx:25` - `failed).toBe(true)`; `:27` - `hits).toEqual([])`; `:32-35` - `["nova.md"]`, `failed).toBe(false)`, `toHaveBeenCalledTimes(3)`, `calls[2]).toEqual([...{ q: "nova", limit: 8 }])`                                                                                    | PASS   |
| C25   | related fails: message + Try again in a rail section, no "Close, but not linked"; component: list with files, gives way on failure, retry once          | e2e - C25 ✓; UI batch - 2 C25 tests ✓                                                                                                                                             | `tests/e2e/brain-errors.spec.ts:106-107`, `:110` - alert, Try again, `.bs-reader .bs-rail .bs-rail-sec .brain-request-failed` visible; `BrainSceneReader.related.test.tsx:88-89` (precondition), `:96-97` - `queryByText(...)).toBeNull()`, `:99`, `:101`, `:103` - `toHaveBeenCalledTimes(1)`. Mutant M5 killed by the component | PASS   |
| C26   | both error states: message ≥ 13px, button ≥ 12px, `role="alert"`, axe serious/critical none in dark and light; tokens only                              | e2e batch - 6 C26 tests ✓; `npx stylelint --config stylelint.config.mjs "apps/command-centre/src/brain/*.css" "apps/command-centre/src/nucleo/scenes/*.css"` exit 0               | `tests/e2e/brain-errors.spec.ts:146-148` (search, both shells) and `:162-164` (related) - `toBeGreaterThanOrEqual(13)`, `toBeGreaterThanOrEqual(12)`, `seriousViolations(page)).toEqual([])`. Mutant M4 killed in all 6                                                                                                           | PASS   |
| C27   | route, sentinel and worker passes rewrite ROUTER.md before `index.finished`; settle within three; zero-change pass writes none; fresh home creates none | root batch ✓ (3 C27 tests)                                                                                                                                                        | `tests/memory.correcoes.test.ts:719`, `:737` - `atFinish).toContain(...)`; `:750` - `toBeLessThan(3)`; `:752-753` - `changes()).toBe(0)`, `mtimeMs).toBe(quiet)`; `:792-793` - `mode).toBe("worker")`, `toContain(marker)`; `:807-808` - `existsSync(...)).toBe(false)` (AD-038(b), pending the owner). Mutants M6, M7 killed     | PASS   |
| C28   | second `generateRouters` keeps mtime and inode                                                                                                          | root batch ✓                                                                                                                                                                      | `tests/memory.correcoes.test.ts:825` - `map((s) => [s.mtimeMs, s.ino])).toEqual(before)`                                                                                                                                                                                                                                          | PASS   |
| C29   | watcher, 1 s debounce: ≤ 2 passes, second writes no router, no third in 3 s                                                                             | root batch ✓ (9.1 s)                                                                                                                                                              | `tests/memory.correcoes.test.ts:856-858` - `≥ 1`, `≤ 2`, `routerWrites[1]).toBe(routerWrites[0])`; `:861` - `passes).toBe(settled)`                                                                                                                                                                                               | PASS   |
| C30   | ROUTER.md linked out: 200 with stats, announced, one `routers_failed`                                                                                   | root batch ✓                                                                                                                                                                      | `tests/memory.correcoes.test.ts:897-902` - `toBe(200)`, `added).toBeGreaterThan(0)`, `announced).toBe(true)`, target unchanged, `filter(code === "routers_failed")).toHaveLength(1)`                                                                                                                                              | PASS   |
| C31   | C46 amended: strict 5, text ≥ 11, hybrid 11                                                                                                             | root batch - `C46 on the fixed corpus…` ✓                                                                                                                                         | `tests/memory.semantic.test.ts:273-274` - `found.and).toHaveLength(5)`, `found.hybrid).toHaveLength(11)`; `:282` - `found.text.length).toBeGreaterThanOrEqual(11)`                                                                                                                                                                | PASS   |
| C32   | OpenAPI: related 404, graph `wikilink`, validates as 3.1                                                                                                | root batch - C32 ✓ and `api.openapi C16 the document validates as OpenAPI 3.1` ✓                                                                                                  | `tests/memory.correcoes.test.ts:920-922` - `toContain("404")`, `toContain('"wikilink"')`, `not.toContain('"same-area"')`; `tests/api.openapi.test.ts:172` - `validated.openapi).toBe("3.1.0")`                                                                                                                                    | PASS   |
| C33   | fs allowlist and module-state list do not grow, unedited                                                                                                | root batch - `C55 the list holds 70 rows…` ✓, `C30 the module-level mutable state…` ✓; `git diff 8148d42..HEAD -- tests/security-reads.test.ts tests/sdk.instances.test.ts` empty | `tests/security-reads.test.ts:2325` - `ALLOWED).toHaveLength(70)`; `tests/sdk.instances.test.ts:76` - `toEqual(Object.keys(PROCESS_SCOPED).sort())`, `:82` - `toHaveLength(9)`                                                                                                                                                    | PASS   |
| C34   | inline and worker write the same `note_links`, no `file_links`                                                                                          | root batch ✓                                                                                                                                                                      | `tests/memory.correcoes.test.ts:950` - `file_links` `toBeUndefined()`; `:974-975` - `inline.length).toBe(3)`, `worker).toEqual(inline)`                                                                                                                                                                                           | PASS   |

Every named test exists and appears in the runner's verbose output individually, as passed:

- root batch: 73 tests, `--reporter=verbose`
- UI batch: 3 tests
- e2e batch: 13 tests, listed by name

No filter matched nothing. Five root tests are new since round 1: C1 at its own layer, C27 worker, C27 fresh home, plus
the new C14/C17-C22 assertions inside existing tests. All five ran.

## Coverage

Recomputed at `8aa08bc` for the rows the fix touched: policy exclusions, query branches, search error kinds, error
states, themes and router triggers. The other rows are carried from `7966925` (round 1 recomputed them, the fix
changed none of their authorities, and their proofs re-ran green above).

| Set (size)                                    | Recomputed from                                                           | Member -> proof                                                                                                                                         | Unproven |
| --------------------------------------------- | ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| `GET /api/memory/related` statuses (2)        | carried from `7966925` - contract `memory.related`                        | 200 C7, C14 · 404 C14 (refused and missing)                                                                                                             | -        |
| `GET /api/memory/graph` statuses (1)          | carried from `7966925`                                                    | 200 C1, C13                                                                                                                                             | -        |
| `GET /api/memory/search` statuses (2)         | carried from `7966925`                                                    | 200 C15-C22 · 409 C22                                                                                                                                   | -        |
| graph edge kinds (4)                          | carried from `7966925` - contract enum                                    | `wikilink` C1 · `markdown-link` C2 · `same-dir`, `related` C11                                                                                          | -        |
| readers moved to `note_links` (4)             | carried from `7966925`                                                    | graph C1 · related C7 · hygiene C6 · recall C8                                                                                                          | -        |
| link places ignored (3)                       | carried from `7966925`                                                    | ``` , ~~~, inline code: C3                                                                                                                              | -        |
| link lifecycle (3)                            | carried from `7966925`                                                    | rename C5 · create C5 · ambiguous key C4                                                                                                                | -        |
| policy exclusions on read (4 kinds × routes)  | AC 13 (user exclude, home `config/`, home `logs/`, secret name), AC 14-16 | user exclude: graph C13, related C14, search C15/C16 · `config/`: graph C13 · `logs/`: graph C13 (`:453`) · secret name: graph C13 (`:453`), search C16 | -        |
| reads filtered before the cut (2)             | carried from `7966925`                                                    | text C15 · empty C16                                                                                                                                    | -        |
| query branches (4)                            | `core/src/memory/search.ts:138-158`                                       | all words C18 (M1 killed) · some words C19 · stopwords only C21 (M3 killed) · nothing left C21; only kept words searched C17 (M2 killed)                | -        |
| search modes (3)                              | carried from `7966925`                                                    | `text` C20, C22, C31 · `auto` C22 · `semantic` C22                                                                                                      | -        |
| search error kinds (3)                        | AC 23 ("network, `4xx`, `5xx`")                                           | `5xx` C23 (500) · `4xx` C23 (403) · network C23 (abort)                                                                                                 | -        |
| error states on screens (3)                   | AC 23, AC 25, design-system Acessibilidade                                | moldura search C23, C26 · Núcleo search C23, C26 · Núcleo related C25, C26 (`:162-164`)                                                                 | -        |
| themes for axe (2)                            | design-system                                                             | dark, light: C26 for all three states                                                                                                                   | -        |
| router regeneration triggers / assemblies (3) | plan `Flow` 6 (`indexer.ts:354`, `indexer.ts:665`, `indexHost.ts:286`)    | service-thread pass (route) C27 · paths pass (sentinel) C27, C29 · `IndexWorkerHost` pass C27 worker (`:792-793`, M6 killed)                            | -        |
| router write outcomes (3 + amended 1)         | AC 27-30, AD-038(b)                                                       | changed C27 · unchanged C28 · failed C30 · no routers yet C27 fresh home (M7 killed)                                                                    | -        |
| doors (4)                                     | carried from `7966925` - plan `Landing`                                   | 1 C9, C10, C34 · 2 C1, C12 · 3 C17-C21, C31 · 4 C14, C32                                                                                                | -        |
| startup config: link writer (2 assemblies)    | carried from `7966925` - `indexHost.ts` worker vs inline                  | inline C34 · worker C34                                                                                                                                 | -        |

The `Swept` rows marked existing are carried from `7966925`: route scope `content`, the pass lock, and `mordomo index`
regenerating routers. The fix touched none of those files.

## Test policy rows

| Row                                    | Files it classifies                                                                                                                | Required proof                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | Expectation met |
| -------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------- |
| Decides, reached across a boundary     | `core/src/memory/search.ts` (`searchFiles`), `core/src/memory/links.ts` (`linkEdges`), `core/src/memory/graph.ts` (`relatedFiles`) | Boundary: C13-C22, C1-C7, C14 via `app.inject`. Own layer, one case per row: `searchFiles` all (`memory.correcoes:577`), some (`:597`), stopwords only (`:641`), nothing left (`core.memory.test.ts:290`, query `""`); `linkEdges` wikilink resolved, unresolved and refused (`memory.correcoes:123-127`; the policy is one filter over the file set for both kinds, `links.ts:120-122`), markdown resolved (`core.memory.test.ts:185-188`); `relatedFiles` refused, missing and allowed (`memory.correcoes:489-491`) | yes             |
| Decides, not reached across a boundary | `core/src/memory/routers.ts`, `core/src/db/migrations.ts` (carried from `7966925`)                                                 | own layer: C28, C27, C9                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | yes             |
| Screens                                | `BrainPanel.tsx`, `BrainScene.tsx`, `BrainSceneReader.tsx`                                                                         | real browser per screen and state: C23 (both shells, 3 error kinds), C25 and C26 (related state, both themes)                                                                                                                                                                                                                                                                                                                                                                                                         | yes             |

## Faults injected

Re-injected on every round 1 survivor and on the surfaces the fix touched or created. Each mutant was applied alone in
the scratch worktree and reverted with `git checkout <file>`. The UI was rebuilt (`npm run build -w apps/command-centre`)
for each interface mutant and once more after the last one. The scratch's porcelain was empty after each revert. The
cap of five is exceeded on purpose: the brief asks for every round 1 gap to be re-checked with my own mutants.

| Mutation                                                                                       | Location                                                         | Killed                                                                          |
| ---------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| M1 - drop the `seen` skip of the second FTS query (round 1 gap 1)                              | `core/src/memory/search.ts:147`                                  | yes - C18 and C22 fail                                                          |
| M2 - search the typed words, stopwords included, instead of `extractKeywords` (gap 2)          | `core/src/memory/search.ts:140`                                  | yes - C17 fails                                                                 |
| M3 - a stopword-only question searched relaxed (`OR`) instead of strictly (gap 10)             | `core/src/memory/search.ts:140-141`                              | yes - C21 `:640` `expected [...] to not include 'metade21.md'`                  |
| M4 - error text `--fs-3` to `--fs-2` (12px), UI rebuilt (gap 4)                                | `apps/command-centre/src/brain/requestFailed.css:8`              | yes - all 6 C26 tests, `Expected: >= 13, Received: 12`                          |
| M5 - show the reader's "nearby" section even when related failed (gap 3)                       | `apps/command-centre/src/nucleo/scenes/BrainSceneReader.tsx:252` | yes - component C25 fails (the e2e C25 stays green, see notes)                  |
| M6 - the worker host stops calling `finishPass` (gap 8)                                        | `core/src/memory/indexHost.ts:286`                               | yes - C27 worker `:793`, `to contain 'marcador27-worker'`                       |
| M7 - a pass on a home with no routers creates them (drop the `ENOENT` return)                  | `core/src/engine.ts:317`                                         | yes - C27 fresh home `:807`                                                     |
| M8 - the recall resolves wikilinks over every file again (`() => true`), the fix's new surface | `core/src/memory/recall.ts:437`                                  | no - survived C3, C8, `security-reads` C22; a probe shows the behaviour differs |
| M9 - Núcleo: the search error moved out of `.bs-results`, above it (gap 6)                     | `apps/command-centre/src/nucleo/scenes/BrainScene.tsx:1654`      | yes - 3 Núcleo C23 tests, `:80`                                                 |
| M9b - moldura: the search error rendered before the search box (gap 6)                         | `apps/command-centre/src/brain/BrainPanel.tsx:167`               | yes - 3 moldura C23 tests, `:80`                                                |
| M10 - the button before the message inside the alert (gap 6, order)                            | `apps/command-centre/src/brain/RequestFailed.tsx:13-20`          | yes - component C25 and e2e C23 fail                                            |

Other checks on what the fix could have broken (it changed `recall.ts`): every root test file that touches the recall
(16 files: `api.contract`, `api.mcp`, `api.memory.v2`, `api.openapi`, `api.recall-quality`, `builtin-context`,
`contracts.api`, `core.memory.v2`, `data.settings`, `device-scopes`, `legal.network`, `memory.correcoes`,
`memory.notes.cli`, `memory.notes`, `memory.semantic`, `security-reads`) ran 413 passed, 0 failed.

## Gate

All in the scratch worktree at `8aa08bc`:

- `npm run build` - exit 0. `npm run typecheck` - exit 0. `npm run lint` (eslint and stylelint) - exit 0.
- Root batch - 73 passed, 0 failed. Every named proof is among them:

  ```
  npx vitest run tests/memory.correcoes.test.ts tests/memory.semantic.test.ts tests/api.openapi.test.ts tests/security-reads.test.ts tests/sdk.instances.test.ts --reporter=verbose -t "C([1-9]|1[0-9]|2[0-9]|30|32|34) |C46 on the fixed corpus|C16 the document validates|C55 the list holds 70 rows|C30 the module-level mutable state"
  ```

- UI batch - 3 passed, 0 failed:

  ```
  npm run test -w apps/command-centre -- src/brain/useBrainSearch.test.tsx src/nucleo/scenes/BrainSceneReader.related.test.tsx --reporter=verbose -t "C24 |C25 "
  ```

- e2e batch - 13 passed, 0 failed:

  ```
  MORDOMO_E2E_PORT=4901 npx playwright test --config tests/e2e/playwright.config.ts brain-errors.spec.ts -g "C23 |C25 |C26 "
  ```

- `npx stylelint --config stylelint.config.mjs "apps/command-centre/src/brain/*.css" "apps/command-centre/src/nucleo/scenes/*.css"` - exit 0.

Every proof is green, and every round 1 gap is closed. The FAIL is one surviving mutant (M8): the fix added scoped
wikilink resolution to the recall and gave it no assertion. Separately from the verdict, the fresh-home half of C27
holds only if the owner accepts AD-038(b).
