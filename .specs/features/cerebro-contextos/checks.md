# Cérebro: contextos de trabalho checks

Profile: ui
Plan: `.specs/features/cerebro-contextos/plan.md`

47 checks in 6 slices + cross-cutting · 7 one-way doors · 0 open questions (as duas foram respondidas pelo dono em 29/10/2026).

Every proof is `npx vitest run <file> -t "<C-id> "` from the repository root (root tests) or
`npm run test -w apps/command-centre -- <file> -t "<C-id> "` (UI tests); a test title starts with its check id. `E2E`
proofs use `MORDOMO_E2E_PORT=4901 npx playwright test --config tests/e2e/playwright.config.ts <spec> -g "<C-id> "`.

## Checks

### S1 - definir contextos · ~10 files · ~190 KB · ~47k

**C1** - `POST /api/contexts {name:"App do cliente X", paths:["<pasta indexada>/clientes/x"]}` answers `201` with `id` `app-do-cliente-x`, the path as given, `notesDir` `<home>/memory/notes/app-do-cliente-x`, `brief` `null`, `map` `<home>/memory/contexts/app-do-cliente-x.md`, and `settings.contexts` holds it (AC 1)
Proof: `npx vitest run tests/contexts.test.ts -t "C1 "`

**C2** - A derived `id` that exists becomes `-2`, then `-3`; a given `id` that exists answers `409 context_exists` and `settings.contexts` is unchanged (AC 2)
Proof: `npx vitest run tests/contexts.test.ts -t "C2 "`

**C3** - Each of: a path outside every enabled indexed folder and outside `memory/`, the home's `config/`, the home's `logs/`, a user-excluded folder, a secret file name, and a folder holding a link into the home's `config/`, answers `400 context_path_not_indexed` naming the path and stores nothing (AC 3)
Proof: `npx vitest run tests/contexts.test.ts -t "C3 "`

**C4** - An empty or whitespace name, a name of 61 characters, a name with a line break, `paths: []`, 9 paths, two paths with the same real path, and a 51st context each answer `400 validation` and store nothing (AC 4)
Proof: `npx vitest run tests/contexts.test.ts -t "C4 "`

**C5** - `PATCH /api/contexts/:id` with `name` changes only the name, with `paths` only the paths (checked as C3 checks them, a bad one answering `400 context_path_not_indexed`), and the `id` never changes (AC 5)
Proof: `npx vitest run tests/contexts.test.ts -t "C5 "`

**C6** - `DELETE /api/contexts/:id` removes the entry, leaves `memory/notes/<id>/` and its files byte for byte, deletes `memory/contexts/<id>.md`, and sets `UiPreferences.activeContext` to `null` when it named that context (and leaves it when it named another) (AC 6)
Proof: `npx vitest run tests/contexts.test.ts -t "C6 "`

**C7** - `GET /api/contexts` gives each path `state` `ok`, `missing` (folder deleted) or `not_indexed` (its indexed folder disabled, or a new exclude covering it), and `files` equal to the number of indexed rows that belong to the context by door 6 (AC 7)
Proof: `npx vitest run tests/contexts.test.ts -t "C7 "`

**C8** - A `settings.json` with one unreadable `contexts` entry (bad `id`, 9 paths, a name with a line break) starts with that entry dropped and the others kept (AC 8)
Proof: `npx vitest run tests/contexts.test.ts -t "C8 "`

**C9** - A device token with every scope answers `403 owner_only` for `POST`, `PATCH` and `DELETE /api/contexts`; a device holding `content` gets `200` from `GET /api/contexts` and one holding only `monitor` gets `403` (AC 9)
Proof: `npx vitest run tests/contexts.test.ts -t "C9 "`

### S2 - as leituras valem para o contexto · ~6 files · ~77 KB · ~19k

**C10** - With `projetos/app` and `projetos/app-antigo` indexed and a context on `projetos/app`, `GET /api/memory/search?context=<id>&q=<palavra dos dois>` returns only files under `projetos/app/`, and none under `app-antigo` (AC 10, door 6)
Proof: `npx vitest run tests/contexts.test.ts -t "C10 "`

**C11** - `GET /api/memory/recall?context=<id>` returns candidates and sections only of the context, and a pointer from a context note to a file outside it is not followed (AC 11)
Proof: `npx vitest run tests/contexts.test.ts -t "C11 "`

**C12** - `GET /api/memory/graph?context=<id>` returns only nodes of the context, edges only between them, and `totalFiles` counting only them (AC 12)
Proof: `npx vitest run tests/contexts.test.ts -t "C12 "`

**C13** - `GET /api/memory/related?context=<id>&id=<X>` returns no file outside the context, and answers `404 not_found` when X is outside it (AC 13)
Proof: `npx vitest run tests/contexts.test.ts -t "C13 "`

**C14** - `GET /api/memory/status?context=<id>` counts `facets` (areas, extensions, tags, `total`) only over the context's files, and every other field equals the answer without `context` (AC 14)
Proof: `npx vitest run tests/contexts.test.ts -t "C14 "`

**C15** - Each of the five routes answers `404 context_not_found` for an unknown `context`, and with `context=all` or no `context` (owner token) the same answer as before this feature (AC 15)
Proof: `npx vitest run tests/contexts.test.ts -t "C15 "`

**C16** - With one of two context paths deleted from disk, or its indexed folder disabled, the five routes answer `200` from the other path (AC 16)
Proof: `npx vitest run tests/contexts.test.ts -t "C16 "`

### S3 - execuções com contexto · ~10 files · ~158 KB · ~40k

**C17** - `POST /api/runs` and `POST /api/skills/:slug/run` with `contextId` and no `cwd` record `cwd` equal to the real path of the first `ok` path (the first deleted, the second used) and `RunRecord.contextId` equal to the id (AC 17)
Proof: `npx vitest run tests/contexts.runs.test.ts -t "C17 "`

**C18** - The run's `readDirs` hold the other `ok` paths and the context's `notesDir` when it exists, in that order, besides the folders it already receives (AC 18)
Proof: `npx vitest run tests/contexts.runs.test.ts -t "C18 "`

**C19** - With `cwd` and `contextId`, a `cwd` inside a context path is kept; one outside every context path answers `400 validation` and no run is recorded (AC 19)
Proof: `npx vitest run tests/contexts.runs.test.ts -t "C19 "`

**C20** - An unknown `contextId` answers `404 context_not_found` and a context with no `ok` path `409 context_unavailable` on the three routes, and no run is recorded (AC 20)
Proof: `npx vitest run tests/contexts.runs.test.ts -t "C20 "`

**C21** - The prompt of a run with a context starts with a block holding `Work context: <name>`, the paths, the path of `memory/contexts/<id>.md`, the first 2 000 characters of `_resumo.md` (and not the 2 001st), and the line naming `memory/ROUTER.md` for anything outside the context (AC 21)
Proof: `npx vitest run tests/contexts.runs.test.ts -t "C21 "`

**C22** - With a run credential of a run that has a context, `GET /api/memory/recall` and `GET /api/memory/search` without `context` answer only files of the context, and with `context=all` files of the whole index; with a run credential of a run without a context, the whole index (AC 22, door 7)
Proof: `npx vitest run tests/contexts.runs.test.ts -t "C22 "`

**C23** - `POST /api/sessions/:id/continue` of a session whose first run had a context records the new run with the same `contextId`; a different `contextId` in the body answers `409 context_unavailable` (AC 23)
Proof: `npx vitest run tests/contexts.runs.test.ts -t "C23 "`

**C24** - After the context of a recorded run is deleted, `GET /api/runs/:id` still answers its `contextId`, and the run detail of the interface shows the id with "Contexto apagado" / "Context deleted" (AC 24)
Proof: `npx vitest run tests/contexts.runs.test.ts -t "C24 "`
Proof: `npm run test -w apps/command-centre -- src/contexts/RunContext.test.tsx -t "C24 "`

**C25** - Migration 23 on a database at version 22 with runs and sessions adds `context_id` (`TEXT`, nullable) to both, every old row reads `NULL`, every other column is unchanged, and running its SQL again leaves the same schema; `user_version` is 23 (AC 25, door 4)
Proof: `npx vitest run tests/contexts.runs.test.ts -t "C25 "`

### S4 - o mapa do contexto · ~5 files · ~40 KB · ~10k

**C26** - `generateRouters` writes `memory/contexts/<id>.md` with the generated header, the name, the paths with their `state`, the link to `_resumo.md` when it exists, and up to 30 files of the context, the most linked to from inside it first and then the most recent, each as `- <título ou nome> → <caminho>` (AC 26)
Proof: `npx vitest run tests/contexts.test.ts -t "C26 "`

**C27** - A context of 200 files gives a map of at most 4 800 characters ending with `…(N arquivos a mais; use o recall com o contexto)` where N is the number of files left out (AC 27)
Proof: `npx vitest run tests/contexts.test.ts -t "C27 "`

**C28** - After a context is deleted the next `generateRouters` deletes its map; after one is renamed it rewrites the map with the new name (AC 28)
Proof: `npx vitest run tests/contexts.test.ts -t "C28 "`

**C29** - `PUT /api/memory/notes` on `memory/contexts/<id>.md` answers `403 note_not_editable` with the file unchanged, and `GET /api/memory/note` answers `editable: false` with a `reason` (AC 29)
Proof: `npx vitest run tests/contexts.test.ts -t "C29 "`

**C30** - `GET /api/sync/plan?context=<id>` targets the context's first `ok` path and its `CLAUDE.md`/`AGENTS.md` actions hold the context map's body where the `ROUTER.md` body was; `POST /api/sync/apply` with `context` writes them with a backup, and a file changed by hand is a conflict that needs approval, as today; an unknown context answers `404 context_not_found` (AC 30)
Proof: `npx vitest run tests/contexts.test.ts -t "C30 "`

### S5 - escolher e gerenciar na interface · ~14 files · ~240 KB · ~60k

**C31** - The selector (moldura: below the brand; Núcleo: left of the voice line) lists "Whole brain" first, then each context by name with its file count in the order of `settings.contexts`, marks the active one with `aria-checked`, and offers "New context…" and "Manage contexts" (AC 31)
Proof: `npm run test -w apps/command-centre -- src/contexts/ContextSelector.test.tsx -t "C31 "`
Proof: `MORDOMO_E2E_PORT=4901 npx playwright test --config tests/e2e/playwright.config.ts contexts.spec.ts -g "C31 "`

**C32** - Choosing a context writes `activeContext` by `PUT /api/ui-preferences`, and the next request of the Second Brain search and graph, the Núcleo brain scene, the palette's Files section and the chat carry `context=<id>` (reads) or `contextId` (the run) (AC 32)
Proof: `MORDOMO_E2E_PORT=4901 npx playwright test --config tests/e2e/playwright.config.ts contexts.spec.ts -g "C32 "`

**C33** - With a context active the composer shows the chip "In this context: <name>" whose `X` ("Use the whole brain") sets `activeContext` to `null`, and a run started from the composer carries `contextId`; with none active no chip is rendered (AC 33)
Proof: `npm run test -w apps/command-centre -- src/contexts/ContextChip.test.tsx -t "C33 "`

**C34** - "New context…" opens a dialog with a name field and folders offered from the indexed folders and their subfolders from the index; "Create" is disabled without a name or a folder, and creates the context and makes it active (AC 34)
Proof: `npm run test -w apps/command-centre -- src/contexts/NewContextDialog.test.tsx -t "C34 "`

**C35** - A typed folder outside the indexed folders shows "This folder is not indexed." and "Index and create", which adds it to `indexedFolders` by `PUT /api/settings`, calls `POST /api/memory/index`, then `POST /api/contexts` (in that order) (AC 35)
Proof: `npm run test -w apps/command-centre -- src/contexts/NewContextDialog.test.tsx -t "C35 "`

**C36** - Settings › Memory › Contexts lists each context with its paths and their state as icon plus text ("Ok", "Folder gone", "Outside the indexed folders"), "Edit", "Edit brief" (opens the note editor on `_resumo.md`, creating it from the template when missing) and "Delete", whose confirmation says the notes stay and only then calls `DELETE` (AC 36)
Proof: `npm run test -w apps/command-centre -- src/contexts/ContextsSettings.test.tsx -t "C36 "`

**C37** - With no context the selector shows "Whole brain" and "Create a context to focus the brain on a project."; while the list loads a spinner with "Loading…"; when it fails the error with "Try again", which asks again (AC 37)
Proof: `npm run test -w apps/command-centre -- src/contexts/ContextSelector.test.tsx -t "C37 "`

**C38** - With `activeContext` naming a context `GET /api/contexts` no longer lists, the screens use "Whole brain", send no `context`, and show the notice "The active context no longer exists." once (AC 38)
Proof: `npm run test -w apps/command-centre -- src/contexts/ContextSelector.test.tsx -t "C38 "`

**C39** - The command registry holds "Switch context" and "Whole brain" with scope `global`, in the palette, and the keyboard-listener allowlist of the interface does not grow (AC 39)
Proof: `npm run test -w apps/command-centre -- src/contexts/contextCommands.test.ts -t "C39 "`

**C40** - The selector, the dialog and the settings section have no text under 12px (running text at 13px), colours only from tokens (stylelint), state with an icon and text, and axe reports no serious or critical violation in both themes (AC 40)
Proof: `MORDOMO_E2E_PORT=4901 npx playwright test --config tests/e2e/playwright.config.ts contexts.spec.ts -g "C40 "`
Proof: `npx stylelint --config stylelint.config.mjs "apps/command-centre/src/contexts/*.css"`

### S6 - CLI e MCP · ~3 files · ~75 KB · ~19k

**C41** - `mordomo context list` prints one line per context with `id`, name, file count and the state of each path, `*` on the active one, and exits 0 (AC 41)
Proof: `npx vitest run tests/contexts.cli.test.ts -t "C41 "`

**C42** - `mordomo context use <id>` sets `activeContext`, `--none` sets it to `null`, an unknown id prints `context_not_found` on stderr and exits 1 (AC 42)
Proof: `npx vitest run tests/contexts.cli.test.ts -t "C42 "`

**C43** - `mordomo context show <id>` prints the body of `memory/contexts/<id>.md` (AC 43)
Proof: `npx vitest run tests/contexts.cli.test.ts -t "C43 "`

**C44** - `mordomo recall` and `mordomo run` with `--context <id>` scope as the API does; without it they use the machine's active context; with `--context all` the whole index (AC 44)
Proof: `npx vitest run tests/contexts.cli.test.ts -t "C44 "`

**C45** - The MCP tools `recall` and `skills_run` accept `context` and pass it to the route; without it the answer is for the whole index (AC 45)
Proof: `npx vitest run tests/contexts.cli.test.ts -t "C45 "`

### Cross-cutting

**C46** - The four new routes are in the `API` table with schemas, scope and errors, in the OpenAPI document (which validates), in `EXPECTED_ROUTE_SCOPES`, in `docs/security.md`, and each has a scenario in the refusal probe; the changed routes declare their new query or body field and errors (AC 46)
Proof: `npx vitest run tests/contexts.test.ts -t "C46 "`
Proof: `npx vitest run tests/api.openapi.test.ts -t "C16 the document validates"`

**C47** - The raw `fs` allowlist and the module-state list do not grow (AC 47)
Proof: `npx vitest run tests/security-reads.test.ts -t "C55 the list holds 70 rows"`
Proof: `npx vitest run tests/sdk.instances.test.ts -t "C30 the module-level mutable state"`

## Coverage

| Set (size)                                              | Member -> proof                                                                                                                   | Unproven |
| ------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- | -------- |
| `GET /api/contexts` statuses (1)                        | 200 C7, C9                                                                                                                        | -        |
| `POST /api/contexts` statuses (3)                       | 201 C1 · 400 C3, C4 · 409 C2                                                                                                      | -        |
| `PATCH /api/contexts/:id` statuses (3)                  | 200 C5 · 400 C5 · 404 C15                                                                                                         | -        |
| `DELETE /api/contexts/:id` statuses (2)                 | 200 C6 · 404 C15                                                                                                                  | -        |
| memory reads with `context` (5)                         | search C10, C15 · recall C11, C15 · graph C12, C15 · related C13, C15 · status C14, C15                                           | -        |
| run routes with `contextId` (3)                         | runs C17, C20 · skills run C17, C20 · sessions continue C20, C23                                                                  | -        |
| sync routes with `context` (2)                          | plan C30 · apply C30                                                                                                              | -        |
| error codes (4)                                         | `context_not_found` C15, C20, C30, C42 · `context_path_not_indexed` C3, C5 · `context_exists` C2 · `context_unavailable` C20, C23 | -        |
| path states (3)                                         | `ok` C7 · `missing` C7, C16 · `not_indexed` C7, C16                                                                               | -        |
| refused path kinds (6)                                  | outside C3 · `config/` C3 · `logs/` C3 · user exclude C3 · secret name C3 · link into `config/` C3                                | -        |
| doors (7)                                               | 1 C1, C2, C8 · 2 C26, C29 · 3 C46 · 4 C25 · 5 C6, C32, C42 · 6 C10 · 7 C22                                                        | -        |
| entities of Relations (4)                               | contexto C1 · runs C17, C25 · sessions C23, C25 · mapa C26                                                                        | -        |
| selector states (4)                                     | empty C37 · loading C37 · error C37 · gone C38                                                                                    | -        |
| shells with the selector (2)                            | moldura C31, C32 · Núcleo C31, C32                                                                                                | -        |
| CLI subcommands and flags (5)                           | `list` C41 · `use` C42 · `use --none` C42 · `show` C43 · `--context` C44                                                          | -        |
| MCP tools (2)                                           | `recall` C45 · `skills_run` C45                                                                                                   | -        |
| startup config: `settings.contexts` read (2 assemblies) | the service (`AppContext`) C8 · the CLI C41                                                                                       | -        |

- Claims naming a status code, route or response shape: C1-C7, C9-C20, C22-C24, C29, C30, C46 - each proven through
  `app.inject` against `buildServer`
- Claims about the screens: C31-C40 in rendered components; C31, C32, C40 also in a real browser

## Binding sources

| Source                                                     | Checked by        |
| ---------------------------------------------------------- | ----------------- |
| `cerebro-contextos/design.md` (the four surfaces and copy) | C31, C33-C38, C40 |
| `design-system/design.md`                                  | C40               |
| `primitivas/design.md` (Menu, Modal, Tooltip)              | C31, C34, C36     |
| `comandos-atalhos/design.md`                               | C39               |
| `moldura-app/design.md` (place in the sidebar)             | C31               |
| `cerebro-v2/design.md` (editor, error and loading pattern) | C36, C37          |

## Test policy

| Code                                                                                         | Required proofs                                       | Coverage expectation                                                                           |
| -------------------------------------------------------------------------------------------- | ----------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| Decides, reached across a boundary (`contexts.ts` validation and membership, run resolution) | one at the HTTP boundary **and** one at its own layer | the contract at the boundary; one asserted case per row of the decision table at its own layer |
| Decides, not reached across a boundary (map generation, migration 23, the prompt block)      | one at its own layer                                  | one asserted case per row                                                                      |
| Screens                                                                                      | one in rendered components per screen and state       | each state the design names; both themes for axe in the browser                                |

Evidence:

- `contexts.ts` (new): path validation over 6 refused kinds and 3 states, membership by real path and separator -> decides
- `RunManager` with a context: `cwd` precedence (given, first `ok`, none `ok`) and `readDirs` order -> decides
- closest analogue: `tests/memory.notes.test.ts` (`cerebro-v2` S1), the same validation table proven at the boundary and
  in the core

## Swept

- validation: C3, C4, C19
- failure modes: C16 (a path gone or not indexed), C20 (no `ok` path), C37 (the list fails to load)
- idempotency: C2 (an id that exists), C25 (migration twice), C28 (map rewritten on rename)
- authorization: C9 (owner-only writes), C22 (the run credential stays inside its context unless it asks `all`)
- concurrency: n/a - a context write goes through the `SettingsStore`, whose writes are already atomic and serialized (AD-013); no new shared state
- data lifecycle: C6 (deleting keeps the notes, removes the map), C24 (a run keeps a deleted context's id), C28
- dependency failure: C16, C38 (the active context disappears)
- state transitions: C6 (active context reset), C38
- observability: n/a - no new log; `settings.changed` already announces a context write (AD-013)

## Handoff

The estimate exceeds the 150k budget, so the build stops here for the mechanism choice (`build.md`).

- Arithmetic (`du -cb` of the files each slice touches, / 4): S1 ≈ 190 KB → 47k, S2 ≈ 77 KB → 19k, S3 ≈ 158 KB → 40k,
  S4 ≈ 40 KB → 10k, S5 ≈ 240 KB → 60k (plus the Núcleo voice line and the console composer), S6 ≈ 75 KB → 19k; the
  slices alone are ≈ 195k, and the new tests (four root files, five UI files, one e2e spec) add ≈ 60k: ≈ 255k in all.
- Proposed cut, at the surface boundaries (batches sequential, each only on green):
  - **A** (core and API reads): S1 + S2 + S4 ≈ 76k + tests ≈ 30k = ≈ 106k
  - **B** (execution, CLI and MCP): S3 + S6 ≈ 59k + tests ≈ 20k = ≈ 79k
  - **C** (the interface and the cross-cutting checks): S5 + C46, C47 ≈ 65k + tests ≈ 25k = ≈ 90k
- Mechanism: handoff (the owner chose it on 2026-10-29: three batches A, B, C, sequential, each only on green)
