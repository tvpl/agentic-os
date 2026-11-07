# Cérebro: correções de base verification

**Verdict**: FAIL
**Profile**: ui
**Diff range**: 8148d42..f3d3663 (fix diff 8aa08bc..f3d3663)
**Round**: 3 - scoped (the last round; the open gap goes to the owner, not to a fourth fix round)
**Verifier**: independent sub-agent (author != verifier; not the builder, not the round 1 or round 2 verifier)

Verified at `f3d3663` in a fresh detached worktree (`git worktree add --detach`, `npm ci`). In that worktree
`npm run build`, `npm run typecheck` and `npm run lint` all exit 0. The real tree's `git status --porcelain` was empty
before and after. This file is the only change to it, plus the lesson that step 7 records in `.specs/lessons.json` and
`.specs/LESSONS.md`.

The fix diff is two commits:

- `9cdca69` is the round 2 report and lesson L-031. It touches no code.
- `f3d3663` adds one test to `tests/memory.correcoes.test.ts` (`C8 with a name two files share…`, `:262-284`).
  It also renames the C13 test (`:428`), amends the text of C8 and adds a Handoff line to `checks.md`.

No source file changed. `core/src/memory/recall.ts` is byte-identical to `8aa08bc`. The insertion moves every line of
`memory.correcoes.test.ts` after `:261` by +24. Those citations are refreshed below.

## Round 2's gap, re-checked

Round 2's one gap was mutant M8, which survived on C8: the recall resolves wikilinks again over every file
(`() => true` at `recall.ts:437`). **It is closed.** I applied M8 myself, and the new test fails at
`tests/memory.correcoes.test.ts:280` (`expected false to be true`). I also applied M8b, which checks readability on the
root instead of the file (`isReadable(scope, row.root)`). The same assertion kills it. The test's premise holds as
written:

- `privado8p/alvo8p.md` has the shorter relative path, so `rankWikilink` (`core/src/memory/links.ts:93-97`) ranks it
  first.
- Its folder is excluded after the pass.
- `candidates[0]` is the source (`:279`), with `k: 1`. So the readable homonym can only arrive through the pointer.

## Ranked gaps (the FAIL)

1. **Surviving mutant on C8's surface: the recall can follow a different homonym than the links panel.** I changed
   `recall.ts:437` to take the last-ranked readable file instead of the first (`)[0]?.path` -> `).at(-1)?.path`). This is
   mutant M8c. It survives C3 and both C8 tests. It also survives all 18 root files that reach the recall or the
   resolver, 457 tests in all:
   - `api.contract`, `api.mcp`, `api.memory.v2`, `api.openapi`, `api.recall-quality`, `builtin-context`
   - `contracts.api`, `core.memory`, `core.memory.v2`, `data.settings`, `device-scopes`, `legal.network`
   - `memory.correcoes`, `memory.links`, `memory.notes.cli`, `memory.notes`, `memory.semantic`, `security-reads`

   A scratch-only probe shows the behaviour really changes. A note holds `[[Alvo8q]]`, and two readable homonyms exist:
   `q/alvo8q.md` and `aa/bb/cc/alvo8q.md`. At HEAD the recall's pointer is the file that `GET /api/memory/links`
   resolves (`near`). Under M8c, `/links` still says `near` but the recall follows `far`.

   The plan forbids exactly this:
   - Path hop 2: the recall resolves "pelo mesmo resolvedor".
   - "nenhuma segunda implementação de resolução".
   - The outcome line: "o recall contam os mesmos links que o painel de backlinks".

   No check pins it:
   - C4 (AC 4) proves the ambiguous-key rule for the graph only.
   - Amended C8 proves only that a refused homonym is skipped. Its "it follows the one it may read" still holds under
     M8c.

   This is also a **precision gap in C8**: with several readable files sharing the name, the check does not say which
   one the recall follows. The fix this needs:
   - C8's text gains "and among readable homonyms, the file `GET /api/memory/links` resolves".
   - One assertion proves it: two readable homonyms, and the pointer's `via` path equals the `/links` resolution.

   This is round 3, so the gap is escalated to the owner, not routed to a fourth fix round. The owner either orders that
   one test or accepts the gap.

Non-gating notes:

- **AD-038(b) is still pending the owner.** The fresh-home half of C27 narrows approved AC 27: a pass on a home with no
  routers creates none (`tests/memory.correcoes.test.ts:831-832`, `core/src/engine.ts:308-317`). It is recorded
  correctly in three places:
  - the plan's section "Emendas depois da aprovação"
  - AD-038, with a revert path
  - `.specs/STATE.md`, "Perguntas ao dono", cerebro-correcoes 1 (open)

  C27's verdict holds only if the owner takes the default. AD-038(a) waits on the same question.

- **C8's amended text strengthens the approved check.** It adds a case that AC 8 implies (follow B "like a Markdown
  link" — a pointer to a refused file is never opened). It needs no owner answer.
- **Carried from `8aa08bc`:** C25's browser absence line (`tests/e2e/brain-errors.spec.ts:111-113`) has no precondition
  of its own. The component proof carries the guard.
- **Closed:** round 2's note on the C13 title. The title now names `config/`, `logs/` and the secret name
  (`tests/memory.correcoes.test.ts:428`).

## Binding sources

**Carried from `8aa08bc`.** The fix touched no interface source and no screen check (C23, C25 and C26 are unchanged
since round 2), so step 1 has nothing new to compare.

| Source                                                                                                  | Opened                                      | Contradiction | Uncovered |
| ------------------------------------------------------------------------------------------------------- | ------------------------------------------- | ------------- | --------- |
| `.specs/features/design-system/design.md` (messages 13px, labels 12px, tokens, not by colour, axe A/AA) | carried from `8aa08bc` (re-read in round 2) | none          | -         |
| `.specs/features/cerebro-v2/design.md`, links section: message + "Tentar de novo", in place of the list | carried from `8aa08bc` (re-read in round 2) | none          | -         |
| `.specs/features/moldura-app/design.md` + AD-005 (both shells, same data)                               | carried from `7966925`                      | none          | -         |

The per-screen enumeration is carried from `8aa08bc`, unchanged:

- moldura search: C23 and C26
- Núcleo search: C23 and C26
- Núcleo reader, related files: C25 and C26

## Checks

**Verified at `f3d3663`.** Every `Proof:` line was re-run in full at HEAD, in three batches plus stylelint (see Gate).
Every citation in `tests/memory.correcoes.test.ts` was refreshed for the +24 shift. Citations in the other files are
unchanged since `8aa08bc`, because the fix did not touch them.

| Check | Claim                                                                                                                                              | Proof run                                                                             | Evidence                                                                                                                                                                                                                                                                                     | Result |
| ----- | -------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| C1    | one `wikilink` edge A→B; own layer: resolved yes, unresolved and refused no                                                                        | root batch ✓ (both C1 tests)                                                          | `tests/memory.correcoes.test.ts:112` - `toEqual([{ source: idOf(a), target: idOf(b), kind: "wikilink", … }])`; `:123-127` - own layer `toEqual([[b,"wikilink"],[hidden,"wikilink"]])`, refused `toEqual([[b,"wikilink"]])`                                                                   | PASS   |
| C2    | Markdown link with fragment is one edge, twice still one                                                                                           | root batch ✓                                                                          | `tests/memory.correcoes.test.ts:139` - `edges.map((e) => e.kind)).toEqual(["markdown-link"])`                                                                                                                                                                                                | PASS   |
| C3    | fenced / inline-code links: no edge, no related, no orphan rescue, no recall pointer                                                               | root batch ✓                                                                          | `tests/memory.correcoes.test.ts:150` - `toEqual([])`; `:154` - `not.toContain(b)`; `:159-160` - orphans contain a, b; `:167` - `some((c) => c.via === a)).toBe(false)`                                                                                                                       | PASS   |
| C4    | ambiguous key: graph draws only the edge `/links` resolves                                                                                         | root batch ✓                                                                          | `tests/memory.correcoes.test.ts:179` - `resolved!.path).toBe(near)`; `:181` - `toEqual(["wikilink"])`; `:182` - far `toEqual([])`                                                                                                                                                            | PASS   |
| C5    | rename: no edge to C or old id; create: edge to new B, A untouched                                                                                 | root batch ✓                                                                          | `tests/memory.correcoes.test.ts:198-199` - `toEqual([])`, old id `.toBe(false)`; `:203` - `toEqual(["wikilink"])`; `:204-205` - bytes `toEqual`, `mtimeMs).toBe(...)`                                                                                                                        | PASS   |
| C6    | hygiene: wikilink-only note is no orphan; unlinked and broken-only are                                                                             | root batch ✓                                                                          | `tests/memory.correcoes.test.ts:220-223` - `not.toContain(hub)`, `not.toContain(leaf)`, `toContain(alone)`, `toContain(broken)`                                                                                                                                                              | PASS   |
| C7    | related `why` per kind                                                                                                                             | root batch ✓                                                                          | `tests/memory.correcoes.test.ts:237-238` - `toBe("Connected by a wikilink.")`, `toBe("Connected by a markdown link.")`                                                                                                                                                                       | PASS   |
| C8    | recall follows `[[B]]` with `via`; `pointerLimit: 0` follows nothing; shared name: follows the readable one even when the other ranks first        | root batch ✓ (both C8 tests)                                                          | `tests/memory.correcoes.test.ts:256` - `some((c) => c.path === target && c.via === src)).toBe(true)`; `:259` - `.toBe(false)`; `:280` - `some((c) => c.path === readable && c.via === src)).toBe(true)` (M8, M8b killed). Among readable homonyms nothing is asserted: M8c survived (gap 1)  | FAIL   |
| C9    | migration 22 drops table and key, keeps rows, runs fresh, `user_version` 22                                                                        | root batch ✓                                                                          | `tests/memory.correcoes.test.ts:313-317` - `toBe(22)`, `file_links` `toBeUndefined()`, key `toBeUndefined()`, files and note_links `toEqual(before…)`; `:326-327`                                                                                                                            | PASS   |
| C10   | no `file_links` outside migrations.ts                                                                                                              | root batch ✓                                                                          | `tests/memory.correcoes.test.ts:350` - `found).toEqual([path.join("core", "src", "db", "migrations.ts")])`                                                                                                                                                                                   | PASS   |
| C11   | contract kinds: accepts 4, refuses `same-area`; `wikilink` labels in both locales                                                                  | root batch ✓                                                                          | `tests/memory.correcoes.test.ts:362-363` - `success).toBe(true)` / `.toBe(false)`; `:365-366` - `not.toContain("brain.kind.same-area")`, `toHaveLength(2)`                                                                                                                                   | PASS   |
| C12   | `linkEdges` executions constant from 30/200 to 3 000/20 000                                                                                        | root batch ✓                                                                          | `tests/memory.correcoes.test.ts:422-423` - `big).toBe(small)`, `toBeLessThanOrEqual(2)`                                                                                                                                                                                                      | PASS   |
| C13   | graph: user exclude, `config/`, `logs/`, `*.pem`: no node, no edge, not counted                                                                    | root batch ✓ (renamed title, `:428`)                                                  | `tests/memory.correcoes.test.ts:477` - `for (const id of refused) expect(ids.has(id), …).toBe(false)` over `[closedId, staleId, logsId, secretId]` (`:471`); `:479` - edge touch `.toBe(false)`; `:485` - `totalFiles).toBe(rows.filter(allowed).length)`                                    | PASS   |
| C14   | related 404 `not_found` for refused and missing id; allowed lists no excluded; own layer `null`                                                    | root batch ✓                                                                          | `tests/memory.correcoes.test.ts:501-505` - `toBe(404)`, `toBe("not_found")` ×2; `:510` - `not.toContain(hidden)`; `:513-515` - `relatedFiles(...)).toBeNull()` ×2, `not.toContain(hidden)`                                                                                                   | PASS   |
| C15   | with the 20 best excluded: 8 allowed in unfiltered order; 5 when only 5                                                                            | root batch ✓                                                                          | `tests/memory.correcoes.test.ts:533-535` - `toHaveLength(8)`, `toEqual(unfiltered.filter(...).slice(0, 8))`; `:538` - `toHaveLength(5)`                                                                                                                                                      | PASS   |
| C16   | empty q: the 4 most recent allowed rows, past 6 excluded                                                                                           | root batch ✓                                                                          | `tests/memory.correcoes.test.ts:566` - `toEqual(["l0.md", "l1.md", "l2.md", "l3.md"])`                                                                                                                                                                                                       | PASS   |
| C17   | only kept words searched: stopword note absent, budget note present (first at own layer), strict finds nothing                                     | root batch ✓                                                                          | `tests/memory.correcoes.test.ts:582-583` - `toContain("verba17.md")`, `not.toContain("vazia17.md")`; `:585-586` - `own[0]).toBe("verba17.md")`, `not.toContain("vazia17.md")`; `:588` - strict `toEqual([])`                                                                                 | PASS   |
| C18   | exactly all-words note first, then the other two, each once; route and own layer                                                                   | root batch ✓                                                                          | `tests/memory.correcoes.test.ts:598-599` - `names[0]).toBe("todas18.md")`, `sort()).toEqual(["duas18.md", "uma18.md"])`; `:601` - own layer `toEqual(["todas18.md", "duas18.md", "uma18.md"])`                                                                                               | PASS   |
| C19   | 3, 2, 1 words, then BM25; route and own layer                                                                                                      | root batch ✓                                                                          | `tests/memory.correcoes.test.ts:620` - `toEqual(["tres19.md", "duas19a.md", "duas19b.md", "uma19.md"])`; `:621` - own layer `toEqual(names)`                                                                                                                                                 | PASS   |
| C20   | fixed corpus, semantic off: ≥ 11 of 12 in the top 3 over HTTP                                                                                      | root batch ✓                                                                          | `tests/memory.correcoes.test.ts:645-646` - `toHaveLength(12)`, `found).toBeGreaterThanOrEqual(11)`                                                                                                                                                                                           | PASS   |
| C21   | stopwords only: strict (both-words note in, one-word note out); punctuation only: the listing                                                      | root batch ✓                                                                          | `tests/memory.correcoes.test.ts:663-664` - `toContain("frase21.md")`, `not.toContain("metade21.md")`; `:665` - own layer `toEqual(strict)`; `:669` - `punctuation.json()).toEqual(recent.json())`                                                                                            | PASS   |
| C22   | each file once (a file in both queries, route and own layer; `text`, `auto`); `semantic` 409 off, `via: semantic` on                               | root batch ✓                                                                          | `tests/memory.correcoes.test.ts:681-683` - `bothIds.length).toBe(2)`, `new Set(ids).size).toBe(ids.length)`; `:694-695` - `toBe(409)`, `toBe("semantic_disabled")`; `:710` - `toEqual(new Set(["semantic"]))`                                                                                | PASS   |
| C23   | failed search (500, 403, network), both shells: message, icon, Try again, in place of the hits, message before button, no old hit                  | e2e batch - 6 C23 tests ✓                                                             | `tests/e2e/brain-errors.spec.ts:60` - alert `toBeVisible()`; `:71` - `svg toHaveCount(1)`; `:72` - Try again; `:73` - old hit `toHaveCount(0)`; `:80` - placement; `:81` - hit list `toHaveCount(0)`; `:82-83` - order                                                                       | PASS   |
| C24   | hook: retry repeats once for the current text; error clears, new hits                                                                              | UI batch - C24 ✓                                                                      | `apps/command-centre/src/brain/useBrainSearch.test.tsx:25` - `failed).toBe(true)`; `:27` - `hits).toEqual([])`; `:32-35` - `["nova.md"]`, `failed).toBe(false)`, `toHaveBeenCalledTimes(3)`, `calls[2]).toEqual([...])`                                                                      | PASS   |
| C25   | related fails: message + Try again in a rail section, no "Close, but not linked"; component: list with files, gives way on failure, retry once     | e2e - C25 ✓; UI batch - 2 C25 tests ✓                                                 | `tests/e2e/brain-errors.spec.ts:106-107`, `:110` - alert, Try again, rail section visible; `BrainSceneReader.related.test.tsx:88-89` (precondition), `:96-97` - `queryByText(...)).toBeNull()`, `:99`, `:101`, `:103` - `toHaveBeenCalledTimes(1)`                                           | PASS   |
| C26   | both error states: message ≥ 13px, button ≥ 12px, `role="alert"`, axe serious/critical none in dark and light; tokens only                         | e2e batch - 6 C26 tests ✓; stylelint exit 0                                           | `tests/e2e/brain-errors.spec.ts:146-148` (search, both shells) and `:162-164` (related) - `toBeGreaterThanOrEqual(13)`, `toBeGreaterThanOrEqual(12)`, `seriousViolations(page)).toEqual([])`                                                                                                 | PASS   |
| C27   | route, sentinel and worker passes rewrite ROUTER.md before `index.finished`; settle within three; zero-change writes none; fresh home creates none | root batch ✓ (3 C27 tests)                                                            | `tests/memory.correcoes.test.ts:743`, `:761` - `atFinish).toContain(...)`; `:774` - `toBeLessThan(3)`; `:776-777` - `changes()).toBe(0)`, `mtimeMs).toBe(quiet)`; `:816-817` - `mode).toBe("worker")`, `toContain(marker)`; `:831-832` - `existsSync(...)).toBe(false)` (AD-038(b), pending) | PASS   |
| C28   | second `generateRouters` keeps mtime and inode                                                                                                     | root batch ✓                                                                          | `tests/memory.correcoes.test.ts:849` - `map((s) => [s.mtimeMs, s.ino])).toEqual(before)`                                                                                                                                                                                                     | PASS   |
| C29   | watcher, 1 s debounce: ≤ 2 passes, second writes no router, no third in 3 s                                                                        | root batch ✓                                                                          | `tests/memory.correcoes.test.ts:880-882` - `≥ 1`, `≤ 2`, `routerWrites[1]).toBe(routerWrites[0])`; `:885` - `passes).toBe(settled)`                                                                                                                                                          | PASS   |
| C30   | ROUTER.md linked out: 200 with stats, announced, one `routers_failed`                                                                              | root batch ✓                                                                          | `tests/memory.correcoes.test.ts:921-926` - `toBe(200)`, `added).toBeGreaterThan(0)`, `announced).toBe(true)`, target unchanged, `filter(code === "routers_failed")).toHaveLength(1)`                                                                                                         | PASS   |
| C31   | C46 amended: strict 5, text ≥ 11, hybrid 11                                                                                                        | root batch - `C46 on the fixed corpus…` ✓                                             | `tests/memory.semantic.test.ts:273-274` - `found.and).toHaveLength(5)`, `found.hybrid).toHaveLength(11)`; `:282` - `found.text.length).toBeGreaterThanOrEqual(11)`                                                                                                                           | PASS   |
| C32   | OpenAPI: related 404, graph `wikilink`, validates as 3.1                                                                                           | root batch - C32 ✓ and `api.openapi C16 the document validates as OpenAPI 3.1` ✓      | `tests/memory.correcoes.test.ts:944-946` - `toContain("404")`, `toContain('"wikilink"')`, `not.toContain('"same-area"')`; `tests/api.openapi.test.ts:172` - `validated.openapi).toBe("3.1.0")`                                                                                               | PASS   |
| C33   | fs allowlist and module-state list do not grow, unedited                                                                                           | root batch - `C55 the list holds 70 rows…` ✓, `C30 the module-level mutable state…` ✓ | `tests/security-reads.test.ts:2325` - `ALLOWED).toHaveLength(70)`; `tests/sdk.instances.test.ts:76`, `:82` - `toHaveLength(9)`; `git diff 8148d42..f3d3663 -- tests/security-reads.test.ts tests/sdk.instances.test.ts` is empty                                                             | PASS   |
| C34   | inline and worker write the same `note_links`, no `file_links`                                                                                     | root batch ✓                                                                          | `tests/memory.correcoes.test.ts:974` - `file_links` `toBeUndefined()`; `:998-999` - `inline.length).toBe(3)`, `worker).toEqual(inline)`                                                                                                                                                      | PASS   |

Every named test exists and appears in the runner's verbose output individually, as passed:

- root batch: 74 passed. In `memory.correcoes` each id hit at least once: C1 ×2, C8 ×2, C27 ×3, the rest ×1. Also the
  four named tests in `memory.semantic`, `api.openapi`, `security-reads` and `sdk.instances`.
- UI batch: 3 passed (C24, C25 ×2).
- e2e batch: 13 passed, listed by name.

No filter matched nothing. The new C8 test ran and passed. The whole `memory.correcoes` file (no filter) ran 32 passed,
so the new test's leftover files and its `exclude()` / `restore()` disturb none of the later tests.

## Coverage

**Recomputed at `f3d3663`** for the one set whose check was not PASS: the recall's wikilink resolution. Its authority is
the plan: AC 8, Path hop 2 ("pelo mesmo resolvedor"), the outcome line ("os mesmos links que o painel de backlinks") and
AC 4's rule. Every other row is **carried from `8aa08bc`**: the fix changed no source and no authority, and the rows'
proofs re-ran green above.

| Set (size)                                    | Recomputed from                                                    | Member -> proof                                                                                                                                          | Unproven                                                                  |
| --------------------------------------------- | ------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| recall wikilink resolution (4)                | plan AC 8, AC 4, Path hop 2, the outcome line; `recall.ts:428-441` | unique readable target C8 (`:256`) · `pointerLimit: 0` C8 (`:259`) · first-ranked homonym refused C8 (`:280`, M8/M8b killed) · several readable homonyms | several readable homonyms -> the `/links` choice: no proof (M8c survived) |
| `GET /api/memory/related` statuses (2)        | carried from `8aa08bc`                                             | 200 C7, C14 · 404 C14                                                                                                                                    | -                                                                         |
| `GET /api/memory/graph` statuses (1)          | carried from `8aa08bc`                                             | 200 C1, C13                                                                                                                                              | -                                                                         |
| `GET /api/memory/search` statuses (2)         | carried from `8aa08bc`                                             | 200 C15-C22 · 409 C22                                                                                                                                    | -                                                                         |
| graph edge kinds (4)                          | carried from `8aa08bc`                                             | `wikilink` C1 · `markdown-link` C2 · `same-dir`, `related` C11                                                                                           | -                                                                         |
| readers moved to `note_links` (4)             | carried from `8aa08bc`                                             | graph C1 · related C7 · hygiene C6 · recall C8                                                                                                           | -                                                                         |
| link places ignored (3)                       | carried from `8aa08bc`                                             | ``` , ~~~, inline code: C3                                                                                                                               | -                                                                         |
| link lifecycle (3)                            | carried from `8aa08bc`                                             | rename C5 · create C5 · ambiguous key C4 (graph)                                                                                                         | -                                                                         |
| policy exclusions on read (4 kinds × routes)  | carried from `8aa08bc`                                             | user exclude C13-C16 · `config/` C13 · `logs/` C13 (`:477`) · secret name C13 (`:477`), C16                                                              | -                                                                         |
| reads filtered before the cut (2)             | carried from `8aa08bc`                                             | text C15 · empty C16                                                                                                                                     | -                                                                         |
| query branches (4)                            | carried from `8aa08bc`                                             | all C18 · some C19 · stopwords only C21 · nothing left C21; kept words C17                                                                               | -                                                                         |
| search modes (3)                              | carried from `8aa08bc`                                             | `text` C20, C22, C31 · `auto` C22 · `semantic` C22                                                                                                       | -                                                                         |
| search error kinds (3)                        | carried from `8aa08bc`                                             | `5xx`, `4xx`, network: C23                                                                                                                               | -                                                                         |
| error states on screens (3)                   | carried from `8aa08bc`                                             | moldura search C23, C26 · Núcleo search C23, C26 · Núcleo related C25, C26                                                                               | -                                                                         |
| themes for axe (2)                            | carried from `8aa08bc`                                             | dark, light: C26                                                                                                                                         | -                                                                         |
| router regeneration triggers / assemblies (3) | carried from `8aa08bc`                                             | route C27 · sentinel C27, C29 · worker C27                                                                                                               | -                                                                         |
| router write outcomes (3 + amended 1)         | carried from `8aa08bc`                                             | changed C27 · unchanged C28 · failed C30 · no routers yet C27 (AD-038(b), pending)                                                                       | -                                                                         |
| doors (4)                                     | carried from `8aa08bc`                                             | 1 C9, C10, C34 · 2 C1, C12 · 3 C17-C21, C31 · 4 C14, C32                                                                                                 | -                                                                         |
| startup config: link writer (2 assemblies)    | carried from `8aa08bc`                                             | inline C34 · worker C34                                                                                                                                  | -                                                                         |

The `Swept` rows marked existing are carried from `8aa08bc`: route scope `content`, the pass lock, and `mordomo index`
regenerating routers. The fix touched none of those files.

## Test policy rows

**Carried from `8aa08bc`.** All three rows were met in round 2, and the fix touched no file that any row classifies.
`recall.ts` is in no row.

| Row                                    | Files it classifies                                                                 | Required proof                                                                                         | Expectation met |
| -------------------------------------- | ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ | --------------- |
| Decides, reached across a boundary     | `core/src/memory/search.ts`, `core/src/memory/links.ts`, `core/src/memory/graph.ts` | boundary C13-C22, C1-C7, C14; own layer `memory.correcoes:601`, `:621`, `:665`, `:123-127`, `:513-515` | yes             |
| Decides, not reached across a boundary | `core/src/memory/routers.ts`, `core/src/db/migrations.ts`                           | own layer: C28, C27, C9                                                                                | yes             |
| Screens                                | `BrainPanel.tsx`, `BrainScene.tsx`, `BrainSceneReader.tsx`                          | real browser per screen and state: C23, C25, C26                                                       | yes             |

## Faults injected

The fix created one assertion surface, the new C8 test. Faults went there and on the rest of the C8 surface it is meant
to close (`recall.ts:437`). I applied each mutant alone in the scratch worktree and reverted it with `git checkout`.
The scratch's porcelain was empty after each revert. The other surfaces are carried from `8aa08bc` (M1-M7, M9, M9b and
M10 killed there), because the fix touched none of them.

| Mutation                                                                                    | Location                        | Killed                                                                                                       |
| ------------------------------------------------------------------------------------------- | ------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| M8 - the recall resolves wikilinks over every file again (`() => true`), round 2's survivor | `core/src/memory/recall.ts:437` | yes - new C8 `tests/memory.correcoes.test.ts:280` `expected false to be true`                                |
| M8b - readability checked on the file's root, not the file (`isReadable(scope, row.root)`)  | `core/src/memory/recall.ts:437` | yes - new C8 `:280`                                                                                          |
| M8c - the recall follows the last-ranked readable homonym (`[0]` -> `.at(-1)`)              | `core/src/memory/recall.ts:437` | no - survived C3, both C8 tests and 18 root files (457 tests); a probe shows `/links` -> near, recall -> far |

## Gate

All runs were in the scratch worktree at `f3d3663`.

- `npm run build` - exit 0. `npm run typecheck` - exit 0. `npm run lint` (eslint and stylelint) - exit 0.
- Root batch - 74 passed, 0 failed (73 skipped by the filter). Every named proof is among them:

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
- `npx vitest run tests/memory.correcoes.test.ts` (whole file, no filter) - 32 passed, 0 failed.

Every proof is green, and round 2's gap (M8) is closed. The FAIL is one surviving mutant on the same C8 surface, M8c:
among several readable homonyms, nothing ties the recall's pointer to the file the links panel resolves, although the
plan requires it. This was the last round, so it goes to the owner together with AD-038's open question. Closing it
takes one assertion and a clause in C8.
