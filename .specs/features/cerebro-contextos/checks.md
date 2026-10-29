# Cérebro: contextos de trabalho checks

Profile: ui
Plan: `.specs/features/cerebro-contextos/plan.md`

53 checks in 6 slices + cross-cutting (C48-C53 added after the verification, round 1) · 9 one-way doors (doors 8 and 9
added mid-build) · 0 open questions of the plan (as duas foram respondidas pelo dono em 29/10/2026); one owner question
from the build, `.specs/STATE.md` "Perguntas ao dono", cerebro-contextos 1 (C22).

Every proof is `npx vitest run <file> -t "<C-id> "` from the repository root (root tests) or
`npm run test -w apps/command-centre -- <file> -t "<C-id> "` (UI tests); a test title starts with its check id. `E2E`
proofs use `MORDOMO_E2E_PORT=4901 npx playwright test --config tests/e2e/playwright.config.ts <spec> -g "<C-id> "`.
A proof `-t "<C-id> own layer"` in `tests/contexts.layer.test.ts` calls the deciding code itself, with no HTTP
(`Test policy` rows 1 and 2).

## Checks

### S1 - definir contextos · ~10 files · ~190 KB · ~47k

**C1** - `POST /api/contexts {name:"App do cliente X", paths:["<pasta indexada>/clientes/x"]}` answers `201` with `id` `app-do-cliente-x`, the path as given, `notesDir` `<home>/memory/notes/app-do-cliente-x`, `brief` `null`, `map` `<home>/memory/contexts/app-do-cliente-x.md`, and `settings.contexts` holds it (AC 1)
Proof: `npx vitest run tests/contexts.test.ts -t "C1 "`

**C2** - A derived `id` that exists becomes `-2`, then `-3`; a given `id` that exists answers `409 context_exists` and `settings.contexts` is unchanged (AC 2)
Proof: `npx vitest run tests/contexts.test.ts -t "C2 "`

**C3** - Each of: a path outside every enabled indexed folder and outside `memory/`, the home's `config/`, the home's `logs/`, a user-excluded folder, a secret file name, and a folder holding a link into the home's `config/`, answers `400 context_path_not_indexed` naming the path and stores nothing (AC 3)
Proof: `npx vitest run tests/contexts.test.ts -t "C3 "`
Proof: `npx vitest run tests/contexts.layer.test.ts -t "C3 own layer"`

**C4** - An empty or whitespace name, a name of 61 characters, a name with a line break, `paths: []`, 9 paths, two paths with the same real path, and a 51st context each answer `400 validation` and store nothing (AC 4)
Proof: `npx vitest run tests/contexts.test.ts -t "C4 "`

**C5** - `PATCH /api/contexts/:id` with `name` changes only the name, with `paths` only the paths (checked as C3 checks them, a bad one answering `400 context_path_not_indexed`), and the `id` never changes (AC 5)
Proof: `npx vitest run tests/contexts.test.ts -t "C5 "`

**C6** - `DELETE /api/contexts/:id` removes the entry, leaves `memory/notes/<id>/` and its files byte for byte, deletes `memory/contexts/<id>.md`, and sets `UiPreferences.activeContext` to `null` when it named that context (and leaves it when it named another) (AC 6)
Proof: `npx vitest run tests/contexts.test.ts -t "C6 "`

**C7** - `GET /api/contexts` gives each path `state` `ok`, `missing` (folder deleted) or `not_indexed` (its indexed folder disabled, or a new exclude covering it), and `files` equal to the number of indexed rows that belong to the context by door 6 (AC 7)
Proof: `npx vitest run tests/contexts.test.ts -t "C7 "`
Proof: `npx vitest run tests/contexts.layer.test.ts -t "C7 own layer"`

**C8** - A `settings.json` with one unreadable `contexts` entry (bad `id`, 9 paths, a name with a line break) starts with that entry dropped and the others kept (AC 8)
Proof: `npx vitest run tests/contexts.test.ts -t "C8 "`

**C9** - A device token with every scope answers `403 owner_only` for `POST`, `PATCH` and `DELETE /api/contexts`; a device holding `content` gets `200` from `GET /api/contexts` and one holding only `monitor` gets `403` (AC 9)
Proof: `npx vitest run tests/contexts.test.ts -t "C9 "`

### S2 - as leituras valem para o contexto · ~6 files · ~77 KB · ~19k

**C10** - With `projetos/app` and `projetos/app-antigo` indexed and a context on `projetos/app`, `GET /api/memory/search?context=<id>&q=<palavra dos dois>` returns only files under `projetos/app/`, and none under `app-antigo` (AC 10, door 6)
Proof: `npx vitest run tests/contexts.test.ts -t "C10 "`
Proof: `npx vitest run tests/contexts.layer.test.ts -t "C10 own layer"`

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
Proof: `npx vitest run tests/contexts.layer.test.ts -t "C17 own layer"`

**C18** - The run's `readDirs` hold the other `ok` paths and the context's `notesDir` when it exists, in that order, besides the folders it already receives (AC 18)
Proof: `npx vitest run tests/contexts.runs.test.ts -t "C18 "`
Proof: `npx vitest run tests/contexts.layer.test.ts -t "C18 own layer"`

**C19** - With `cwd` and `contextId`, a `cwd` inside a context path is kept; one outside every context path answers `400 validation` and no run is recorded (AC 19)
Proof: `npx vitest run tests/contexts.runs.test.ts -t "C19 "`
Proof: `npx vitest run tests/contexts.layer.test.ts -t "C19 own layer"`

**C20** - An unknown `contextId` answers `404 context_not_found` and a context with no `ok` path `409 context_unavailable` on the three routes, and no run is recorded (AC 20)
Proof: `npx vitest run tests/contexts.runs.test.ts -t "C20 "`
Proof: `npx vitest run tests/contexts.layer.test.ts -t "C20 own layer"`

**C21** - The prompt of a run with a context starts with a block holding `Work context: <name>`, the paths, the path of `memory/contexts/<id>.md`, the first 2 000 characters of `_resumo.md` (and not the 2 001st), and the line naming `memory/ROUTER.md` for anything outside the context (AC 21)
Proof: `npx vitest run tests/contexts.runs.test.ts -t "C21 "`
Proof: `npx vitest run tests/contexts.layer.test.ts -t "C21 own layer"`

**C22** - With a run credential of a run that has a context, `GET /api/memory/recall` and `GET /api/memory/search` without `context` answer only files of the context, and with `context=all` everything that credential reads (the context's files and the notes of `memory/`); a run credential of a run without a context finds the notes of `memory/`; neither ever answers a file of an indexed folder outside its run, which the owner token without `context` still finds (AC 22 and door 7 as narrowed by door 8: `plan.md`, "Emendas depois da aprovação"; owner question cerebro-contextos 1)
Proof: `npx vitest run tests/contexts.runs.test.ts -t "C22 "`

**C23** - `POST /api/sessions/:id/continue` of a session whose first run had a context records the new run with the same `contextId`; a different `contextId` in the body answers `409 context_unavailable` (AC 23)
Proof: `npx vitest run tests/contexts.runs.test.ts -t "C23 "`
Proof: `npx vitest run tests/contexts.layer.test.ts -t "C23 own layer"`

**C24** - After the context of a recorded run is deleted, `GET /api/runs/:id` still answers its `contextId`, and the run detail of the interface shows the id with "Contexto apagado" / "Deleted context" (AC 24)
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

**C36** - Settings › Memory › Contexts lists each context with its paths and their state as icon plus text ("Ok", "Folder is gone", "Outside the indexed folders"), "Edit", "Edit brief" (opens the note editor on `_resumo.md`, creating it from the template when missing) and "Delete", whose confirmation says the notes stay and only then calls `DELETE` (AC 36)
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
Proof: `npx vitest run tests/security-reads.test.ts -t "C32 every raw fs read in core/src and apps/api/src is on the reviewed list finds nothing outside the list"`

### Added after the verification, round 1 (Surface rows and design.md elements that had no check)

**C48** - `GET /api/sync/plan?context=<id>` and `POST /api/sync/apply` with `context` for a context none of whose paths is `ok` (one deleted, one excluded since) answer `409 context_unavailable`, with or without `approvedConflicts`, and write nothing in the context's folder (Surface row "contexto sem caminho `ok`", S4)
Proof: `npx vitest run tests/contexts.test.ts -t "C48 "`

**C49** - `PATCH /api/contexts/:id {brief:true}` answers `200` with `brief` = `<home>/memory/notes/<id>/_resumo.md`, made from design.md's template (front matter `type: brief`, `status: active`, `# <nome>` and the four sections) when missing, keeps every byte of one that exists, does not write `settings.json` without `name` or `paths`, and answers `404 context_not_found` for an unknown id (door 9, Surface row "com `brief`", S1)
Proof: `npx vitest run tests/contexts.test.ts -t "C49 "`

**C50** - `PUT /api/ui-preferences` with an `activeContext` that is not in the shape of an id (`"Cliente X"`, `""`, `"-x"`, 41 characters, a number, `"../config"`) answers `400 validation` and leaves `ui-preferences.json` byte for byte; an id or `null` is stored (door 5, Surface row of `PUT /api/ui-preferences`, S5)
Proof: `npx vitest run tests/contexts.test.ts -t "C50 "`

**C51** - A conversation the composer continues shows its own context, the session's, as the chip "Conversation in the context <name>" / "Conversa no contexto <nome>" above the field, and not the chip of the active context; a continued conversation without a context shows no chip (design.md, "Tela - Chip no chat", S5)
Proof: `npm run test -w apps/command-centre -- src/contexts/ContextChip.test.tsx -t "C51 "`

**C52** - On Settings › Memory the Contexts section comes after the indexed folders (their rows and the field that adds one) and before the next setting, in the page's order and drawn below them (design.md, "Tela - Configurações › Memória › Contextos", S5)
Proof: `npm run test -w apps/command-centre -- src/contexts/ContextsSettings.test.tsx -t "C52 "`
Proof: `MORDOMO_E2E_PORT=4901 npx playwright test --config tests/e2e/playwright.config.ts contexts.spec.ts -g "C52 "`

**C53** - In the frame the selector's file count sits below the name, in one column, the name at 13px and the count at 12px; the Núcleo's compact selector shows the name only (design.md, "Tela - Seletor de contexto", S5)
Proof: `npm run test -w apps/command-centre -- src/contexts/ContextSelector.test.tsx -t "C53 "`
Proof: `MORDOMO_E2E_PORT=4901 npx playwright test --config tests/e2e/playwright.config.ts contexts.spec.ts -g "C53 "`

## Coverage

| Set (size)                                              | Member -> proof                                                                                                                        | Unproven |
| ------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| `GET /api/contexts` statuses (1)                        | 200 C7, C9                                                                                                                             | -        |
| `POST /api/contexts` statuses (3)                       | 201 C1 · 400 C3, C4 · 409 C2                                                                                                           | -        |
| `PATCH /api/contexts/:id` statuses (3)                  | 200 C5 · 400 C5 · 404 C15                                                                                                              | -        |
| `PATCH /api/contexts/:id` with `brief: true` (2)        | 200 C49 · 404 C49                                                                                                                      | -        |
| `DELETE /api/contexts/:id` statuses (2)                 | 200 C6 · 404 C15                                                                                                                       | -        |
| memory reads with `context` (5)                         | search C10, C15 · recall C11, C15 · graph C12, C15 · related C13, C15 · status C14, C15                                                | -        |
| run routes with `contextId` (3)                         | runs C17, C20 · skills run C17, C20 · sessions continue C20, C23                                                                       | -        |
| sync routes with `context` (2)                          | plan C30 · apply C30                                                                                                                   | -        |
| sync routes, context with no `ok` path (2)              | plan `409` C48 · apply `409` C48                                                                                                       | -        |
| `PUT /api/ui-preferences` with `activeContext` (2)      | `200` C50 · `400 validation` C50                                                                                                       | -        |
| error codes (4)                                         | `context_not_found` C15, C20, C30, C42 · `context_path_not_indexed` C3, C5 · `context_exists` C2 · `context_unavailable` C20, C23, C48 | -        |
| path states (3)                                         | `ok` C7 · `missing` C7, C16 · `not_indexed` C7, C16                                                                                    | -        |
| refused path kinds (6)                                  | outside C3 · `config/` C3 · `logs/` C3 · user exclude C3 · secret name C3 · link into `config/` C3                                     | -        |
| doors (9)                                               | 1 C1, C2, C8 · 2 C26, C29 · 3 C46 · 4 C25 · 5 C6, C32, C42, C50 · 6 C10 · 7 C22 · 8 C22 · 9 C49                                        | -        |
| entities of Relations (4)                               | contexto C1 · runs C17, C25 · sessions C23, C25 · mapa C26                                                                             | -        |
| selector states (4)                                     | empty C37 · loading C37 · error C37 · gone C38                                                                                         | -        |
| chip variants (3)                                       | active context C33 · none C33 · continued conversation C51                                                                             | -        |
| arrangements design.md draws (2)                        | Contexts after the indexed folders C52 · the frame count below the name C53                                                            | -        |
| shells with the selector (2)                            | moldura C31, C32 · Núcleo C31, C32                                                                                                     | -        |
| CLI subcommands and flags (5)                           | `list` C41 · `use` C42 · `use --none` C42 · `show` C43 · `--context` C44                                                               | -        |
| MCP tools (2)                                           | `recall` C45 · `skills_run` C45                                                                                                        | -        |
| startup config: `settings.contexts` read (2 assemblies) | the service (`AppContext`) C8 · the CLI C41                                                                                            | -        |

- Claims naming a status code, route or response shape: C1-C7, C9-C20, C22-C24, C29, C30, C46, C48-C50 - each proven
  through `app.inject` against `buildServer`; C3, C7, C10, C17-C21 and C23 also at their own layer, with no HTTP
- Claims about the screens: C31-C40 and C51-C53 in rendered components; C31, C32, C40, C52, C53 also in a real browser

## Binding sources

| Source                                                     | Checked by                 |
| ---------------------------------------------------------- | -------------------------- |
| `cerebro-contextos/design.md` (the four surfaces and copy) | C31, C33-C38, C40, C51-C53 |
| `design-system/design.md`                                  | C40                        |
| `primitivas/design.md` (Menu, Modal, Tooltip)              | C31, C34, C36              |
| `comandos-atalhos/design.md`                               | C39                        |
| `moldura-app/design.md` (place in the sidebar)             | C31                        |
| `cerebro-v2/design.md` (editor, error and loading pattern) | C36, C37                   |

## Test policy

| Code                                                                                         | Required proofs                                       | Coverage expectation                                                                           |
| -------------------------------------------------------------------------------------------- | ----------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| Decides, reached across a boundary (`contexts.ts` validation and membership, run resolution) | one at the HTTP boundary **and** one at its own layer | the contract at the boundary; one asserted case per row of the decision table at its own layer |
| Decides, not reached across a boundary (map generation, migration 23, the prompt block)      | one at its own layer                                  | one asserted case per row                                                                      |
| Screens                                                                                      | one in rendered components per screen and state       | each state the design names; both themes for axe in the browser                                |

Evidence:

- `contexts.ts` (new): path validation over 6 refused kinds and 3 states, membership by real path and separator -> decides
- `RunManager` with a context: `cwd` precedence (given, first `ok`, none `ok`) and `readDirs` order -> decides
- own layer: `tests/contexts.layer.test.ts` calls `newContext`/`changedContext` (each refused kind and the ok case),
  `contextPathStates`, `contextMembership`/`insideContext` (equal, child, the sibling with the same prefix, by real
  path, the platform's case folding), `contextPromptBlock` and `SkillCatalog.buildRunPrompt`, `Execution.startPrompt`
  and `startSkill` (where a run of a context starts) and the `RunManager` (the folders it hands over), with no HTTP
- closest analogue: `tests/memory.notes.test.ts` (`cerebro-v2` S1), the same validation table proven at the boundary and
  in the core

## Swept

- validation: C3, C4, C19
- failure modes: C16 (a path gone or not indexed), C20 and C48 (no `ok` path), C37 (the list fails to load)
- idempotency: C2 (an id that exists), C25 (migration twice), C28 (map rewritten on rename)
- authorization: C9 (owner-only writes), C22 (the run credential reads `memory/` and its context's `ok` paths, `all`
  included, never the owner's other folders), C50 (the active context is written only in the shape of an id)
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

Status of batch A (updated in the commit that closes each piece):

- S1 (C1-C9), S2 (C10-C16) and the S4 map with its notes rule (C26-C29): closed, every proof green in
  `tests/contexts.test.ts`
- the S4 sync into the context's folder (C30): closed, its proof green in `tests/contexts.test.ts`; with it batch A
  is closed (C1-C16 and C26-C30)

- **Boundary (batch A):** C1-C16 and C26-C30 closed. S1, S2 and the S4 map with its notes rule at `2727246`; the S4 sync
  (C30) at `6a4ee5b`, which closes the batch. On the tree of `6a4ee5b`: `npm run build`, `npm run typecheck` and
  `npm run lint` exit 0, `npx vitest run` at the root is green (128 files, 1721 tests, 1 skipped) and
  `npm run test -w apps/command-centre` too (134 files, 1086 tests); each of the 21 `Proof:` lines runs exactly its one
  test and passes. `RunRecord`, the run routes and the migrations are untouched (batch B).
- **Settled mid-build:** nothing by the owner. Builder decisions inside the approved shape, for the next batches: (a)
  door 6 counts only the `ok` paths of a context, for the reads (AC 16) and for `files` alike, so the rows a missing or
  disabled path left in the index until the next pass are not the context's; (b) the membership is a `within` beside
  the `allow` in the graph, the related files, the recall and the facets (only the search merges it into `allow`), so a
  link resolves as it does for the whole index and only then is kept or dropped; (c) the sync with a context none of
  whose paths is `ok` answers `409 context_unavailable` (a Surface row added in `6a4ee5b`); (d) a context path must exist
  and be a folder when it is given (else `400 context_path_not_indexed`), and the link check is `findPrivateLink`, which
  refuses a folder past 100 000 entries; (e) the recall reads up to 5 000 rows per keyword within a context and keeps its
  usual 60; (f) a map line is `- <title or name> → <path>` with no backticks, the header is exactly
  `<!-- generated by MordomoOS -->`, and `generateRouters` deletes only a file under `memory/contexts/` that starts with
  it; (g) the context pieces of the contracts live in `contracts/src/workContext.ts`, and only `CONTEXT_ID`,
  `CONTEXT_LIMITS` and the `WorkContext` type leave the package; the core barrel gains seven functions (listed in
  `sdk.surface` C38); the refusals are one error class per status so `api.contract` C13 reads their codes; (h) the pins
  moved the way the repo moves them: 136 routes, `owner` 69 and `content` 25, 64 raised pairs, the C29 amendments of
  `sdk.api-thin`, a scenario per new route and two seeded contexts in `contractWorld`, `memory.status` in
  `ACCEPTS_ANYTHING`, the `contexts` leaf classified in `data.settings` C46, and the frozen v1 `settings.changed` fixture
  gains `"contexts": []` (as it gained `memory.embeddings`); (i) left for batch C: `PUT /api/ui-preferences` still reads
  an unreadable `activeContext` as `null` (the patch inherits the `.catch`), and `PUT /api/settings` can write
  `contexts` without the path checks (owner only, like every setting).
- **Abandoned:** the membership merged into `allow` everywhere (it resolved a wikilink among the context's files only,
  so a link could mean another file inside a context than outside it); exporting `ContextSchema`, the path states and
  the error classes from the package roots; creating `memory/notes/<id>/` when a context is made.

Status of batch B (updated in the commit that closes each piece):

- S3 in the API and the core (C17-C23, C25, and the API half of C24): closed, every proof green in
  `tests/contexts.runs.test.ts`
- the interface half of C24 (the run detail shows a deleted context's id with "Context deleted"): closed, its proof
  green in `apps/command-centre/src/contexts/RunContext.test.tsx`; with it S3 is closed (C17-C25)
- S6, the CLI and the MCP tools (C41-C45): closed, every proof green in `tests/contexts.cli.test.ts`; with it batch B
  is closed (C17-C25 and C41-C45)

- **Boundary (batch B):** C17-C25 and C41-C45 closed. S3 in the API and the core (C17-C23, C25, the API half of C24) at
  `322d74d`, the interface half of C24 at `82f4af6`, S6 (C41-C45) at `55c2ed1`, which closes the batch. On the tree of
  `55c2ed1`: `npm run build`, `npm run typecheck` and `npm run lint` exit 0, `npx vitest run` at the root is green (130
  files, 1735 tests, 1 skipped) and `npm run test -w apps/command-centre` too (135 files, 1090 tests); each of the 36
  `Proof:` lines of batches A and B runs exactly its one test (the UI line of C24, its file's four) and passes. S5, C46
  and C47 are untouched (batch C); C46's and C47's proofs stay green.
- **Settled mid-build:** nothing by the owner. Builder decisions inside the approved shape, for batch C: (a) door 8, a
  `Landing` row added in `322d74d`: the run credential reaches `GET /api/memory/search`, and its recall and search read
  `memory/` plus the `ok` paths of its run's context (a context deleted since: `memory/` only), so `context=all` is
  everything the credential reads, never the owner's other folders (`docs/security.md`, `device-scopes` C9 and its
  `sdk.api-thin` amendment); (b) `contextId` is any text up to 64 characters (`ContextIdField`), an id that names no
  context is `404 context_not_found` before any session check, a different one on a conversation is `409
context_unavailable`, and a conversation without a context does not take one on; a conversation whose context was
  deleted answers `404 context_not_found` on continue; (c) a given `cwd` is checked against the context's `ok` paths
  (door 6 rules, on its real path) before `resolveCwd`, so a folder outside the context is `400 validation` even when it
  is outside the granted folders; a continuation keeps the conversation's folder while it is inside the context, else
  the first `ok` path; (d) `readDirs` = the skill's folders first, then the context's `ok` paths other than the working
  directory, then `memory/notes/<id>/` when it exists, each judged as a working directory and refused if it holds a link
  into `config/`/`logs/`, read when the run launches; (e) the block is `contextPromptBlock` (`core/src/memory/contexts.ts`):
  `Work context: <name>`, the paths with `(main)`/`(missing)`/`(not indexed)`, the map, the first 2 000 characters of
  `_resumo.md` as they are, and the line naming `<home>/memory/ROUTER.md`; a prompt run is block + blank line + prompt,
  a skill run passes it to `buildRunPrompt(skill, inputs, artifactsDir, contextBlock?)`; a write approved after its
  context was deleted launches without a block; (f) `RunRecord.contextId` is required and nullable (contract, wire,
  `typetests`); `SessionRecord` does not change: `sessions.context_id` is read by `SessionStore.contextIdOf`, so the
  chat's "Conversation in the context" reads the `contextId` of the conversation's runs (`GET /api/sessions/:id`); (g)
  `contextUnavailable` moved to `contracts/src/api/contexts.ts` beside `ContextIdField`, `runContextErrors` lives in
  `runs.ts`, the core gains `ContextUnavailableError` and the barrel `contextOkPaths` (`sdk.surface` C38); (h) the pins
  moved the way the repo moves them: migration 23 `run-context` in `data.migration` C56 (title now "23 since
  cerebro-contextos"), `memory.correcoes` C9 migrates to 22 only, `device-scopes` C22 lists `run-context` (amended in
  `sdk.api-thin`), the `contracts.api` C38 fixture and the interface fixtures (`gallery/main.tsx`,
  `commands/testserver.ts`) gain `contextId: null`, and the README lists `mordomo context` (`docs.drift` C30); (i) the
  interface has `qk.contexts` and `useOsContexts` in `queries.ts` (no entry in `invalidationMap` yet: `settings.changed`
  should invalidate `["contexts"]` once the selector reads it), the `RunContext` component (class `run-work-context`, no
  CSS file) and the key `context.deleted` in `locales/brain.ts` with C24's English "Context deleted" (design.md's table
  says "Deleted context": the check was followed, batch C may align the design); (j) the CLI prints
  `<*| > <id>  <name>  <n> files  <path> (<state>), …` (and `--json`), `context show` regenerates the routers when the
  map is missing, an active context that no longer exists reads as the whole index, and an unknown `--context` prints
  `context_not_found: …` on stderr and exits 1; the MCP `skills_run` sends no `contextId` for `all`. Left open:
  `POST /api/runs/:id/retry` and `POST /api/runs/:id/children` carry no context (a retry of a context run runs without
  one).
- **Abandoned:** holding `contextId` to the id pattern (a malformed id would be `400`, not `404 context_not_found`);
  resolving a given `cwd` before checking it against the context (a folder outside the granted ones would be `403
forbidden_path`); keeping the run credential's reads in `memory/` (a project context would recall nothing); a
  `contextId` on `SessionRecord`; continuing a conversation whose context was deleted without a context.

Status of batch C (updated in the commit that closes each piece):

- the cross-cutting checks (C46, C47): closed, C46's proofs green in `tests/contexts.test.ts` (the four new routes in
  the table, `EXPECTED_ROUTE_SCOPES`, `docs/security.md`, the OpenAPI document and a scenario each that reaches the
  route; the changed routes' fields and errors) and `api.openapi` C16, C47's two sweeps green and unchanged (70 rows;
  the module-state list); with them `PUT /api/ui-preferences` refuses an `activeContext` that is not an id and
  `PATCH /api/contexts/:id` makes the brief (door 9)
- S5 in rendered components (C33-C39, and the component half of C31): closed, every proof green in
  `apps/command-centre/src/contexts/*.test.tsx` and `contextCommands.test.ts`; with them the copy of C24 and C36
  follows design.md ("Deleted context", "Folder is gone"), and `settings.changed` refreshes the list of contexts
- S5 in a real browser (C31, C32, C40): closed, every proof green in `tests/e2e/contexts.spec.ts` (and C40's
  stylelint line); with them S5 is closed (C31-C40) and batch C is closed (C31-C40, C46, C47)

- **Boundary (batch C):** C31-C40, C46 and C47 closed; with them every check of the feature is closed (C1-C47). The
  brief and the strict `activeContext` with C46 at `cd86075`, S5 in rendered components at `4d1e242`, the browser
  proofs (C31, C32, C40) at `7222df0`, the feature's bundle entry at `dd504ec`, which closes the batch. On the tree of
  `dd504ec`: `npm run build`, `npm run typecheck`, `npm run lint` and `npm run bundle:check` exit 0, `npx vitest run`
  at the root is green (130 files, 1740 tests, 1 skipped) and `npm run test -w apps/command-centre` too (140 files,
  1120 tests); each of the 52 `Proof:` lines of batches A, B and C exits 0 and runs only its check's tests;
  `tests/e2e/contexts.spec.ts` (7) and `tests/e2e/a11y.spec.ts` (57) pass, and so do `moldura`, `console-context`,
  `brain-errors` and `note-editor`. `nucleo-shell`'s "the spine travels…" times out at its 30 s on this machine: its
  run measured 30.2 s and 30.7 s on a build of `231a455` (before batch C) and 27.1-32.8 s on `dd504ec`, so it sits on
  its budget on both trees; it passed with a longer timeout and is not changed here.
- **Settled mid-build:** by the orchestrator: C24's English is design.md's "Deleted context" (the check said "Context
  deleted"; the check's wording, the key and its test follow the binding table now), `settings.changed` invalidates
  `["contexts"]`, and `PUT /api/ui-preferences` refuses an `activeContext` that is not an id with `400 validation`
  while a stored unreadable one still reads `null`. By the builder, on the same ground as C24: C36's "Folder gone" is
  design.md's "Folder is gone" (`context.state.missing`), check wording aligned. Builder decisions inside the
  approved shape: (a) door 9, a `Landing` and a `Surface` row added in `cd86075`: "Edit brief" is `PATCH
/api/contexts/:id` with `brief: true`, which makes `_resumo.md` from design.md's template in `create` mode (never
  over one that exists) and, without `name` or `paths`, does not write `settings.json`; the probe's PATCH scenario
  sends it, so the route now declares `403 forbidden_path` (`FORBIDDEN_PATH_ROUTES`) and `ensureContextBrief` joins
  the core barrel (`sdk.surface` C38); (b) the primitives' `DropdownMenu` gains checked items (`menuitemcheckbox`
  with a `Check` mark), separators, lines of text (`Label`), `keepOpen` and a controlled `open`; (c) `useWorkContext`
  (`contexts/useWorkContext.ts`) keeps the stored id only while `GET /api/contexts` lists it, judges a context gone
  only when the list is settled (not refetching), sends the stored id when the list cannot be read, and the selector
  says "The active context no longer exists." once and writes `activeContext: null`; reads wait (`enabled: ready`)
  while a stored id awaits the list; (d) only a new conversation sends `contextId`; a continued one sends none and
  its chip reads the context of the session's runs; (e) "New context…" takes subfolders from the whole index's
  graph (`maxNodes=3000`, two levels) and judges "not indexed" against the enabled indexed folders and
  `<home>/memory` (`GET /api/system/info`); (f) "Manage contexts" goes to `/settings?tab=memory`; "Switch context"
  (`action:switch-context`) opens the selector's menu 220 ms after the palette closes, "Whole brain"
  (`action:whole-brain`) is always listed; (g) the Núcleo selector sits right of the spine (`left: calc(var(--nu-spine)
  - 8px)`), above the line below 1300 px; (h) pins moved the way the repo moves them: `legacy.graph`C1 lists the
specs'`contexts/testkit.tsx`and`contexts/testnet.ts`, and `scripts/bundle-baseline.json`gains the`cerebro-contextos`entry (pixel.plugin C28). Left open, out of this batch:`POST /api/runs/:id/retry`and`/children`carry no`contextId`; `PUT /api/settings`can write`contexts` without the path checks; the Núcleo's
universal search (`useUniversalSearch`), the Second Brain's facets (`GET /api/memory/status`) and the desktop's
    700-node graph still read the whole index.
- **Abandoned:** a fifth route `POST /api/contexts/:id/brief` (the pins of four routes would all move and C46 counts
  four); making the brief through `POST /api/memory/notes` (it cannot name `memory/notes/<id>/_resumo.md`); an Enter
  handler on the dialog's typed path (the form's submit adds the typed path instead, so no key listener is added);
  the Núcleo selector at the shell's gutter (it covered the spine's Settings module).
