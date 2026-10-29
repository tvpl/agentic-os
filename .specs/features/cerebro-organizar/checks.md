# Cérebro: organizar checks

Profile: ui
Plan: `.specs/features/cerebro-organizar/plan.md`

50 checks in 5 slices + cross-cutting · 10 one-way doors (doors 8-10 added while deriving these checks) · 0 open
questions of the plan (as duas foram respondidas pelo dono em 29/10/2026: postura padrão `neutral`, a skill sob
`controlled_write` em `memory/`). Twelve amendments are recorded in `plan.md`, "Emendas depois da aprovação": every
check names the real routes, files and names `cerebro-contextos` (C2) shipped, and the `Coverage` row "amendments (12)"
joins each to its checks.

Profile `ui` because S4 changes a screen (Configurações › Memória), as `AGENTS.md` declares. Every proof is
`npx vitest run <file> -t "<C-id> "` from the repository root (root tests) or
`npm run test -w apps/command-centre -- <file> -t "<C-id> "` (UI tests); a test title starts with its check id. `E2E`
proofs use `MORDOMO_E2E_PORT=4901 npx playwright test --config tests/e2e/playwright.config.ts <spec> -g "<C-id> "`.
A proof `-t "<C-id> own layer"` in `tests/organize.layer.test.ts` calls the deciding code itself, with no HTTP
(`Test policy` rows 1 and 2). The skill's prose (`SKILL.md`, `resources/`) is proven as `recall` and
`consolidate-memory` are (`tests/builtin-context.test.ts`): by tests that parse the shipped files from a seeded home, and
by runs started through the API against the fake CLI in `tests/fixtures/fake-bin/claude`, with
`ClaudeAdapter.prototype.execute` spied to capture the `AgentRun` the agent is handed.

The plan's `POST /api/runs` row of `Surface` is resolved by `POST /api/skills/:slug/run` (amendment 1): `POST /api/runs`
takes a prompt, no skill and no `inputs`, and does not change.

## Checks

### S1 - a skill, o guia e o banco de perguntas · ~6 files · ~111 KB · ~28k

**C1** - `GET /api/skills/organize-brain` answers `200` with `mode` `write`, `providers` `["claude"]`, the inputs `etapa` (`type` `select`, `options` `["entrevista","aplicar","indexar"]`, `required` `false`, `placeholder` `entrevista`) then `folder` (`type` `path`, `required` `false`), and `i18n["pt-BR"].name` `Organizar o Cérebro` (AC 1, door 1, amendment 12)
Proof: `npx vitest run tests/organize.skill.test.ts -t "C1 "`

**C2** - The catalog's `resources` for `organize-brain` are exactly `["resources/guia.md","resources/perguntas.md"]`, and `GET /api/skills/organize-brain/resource?path=resources/guia.md` and `…perguntas.md` each answer `200` with the file's text (AC 2, door 1)
Proof: `npx vitest run tests/organize.skill.test.ts -t "C2 "`

**C3** - `resources/guia.md` names each of the 11 `type` values `context`, `guide`, `project`, `decision`, `reference`, `log`, `goals`, `profile`, `index`, `inbox`, `brief`; the 5 `status` values `active`, `draft`, `paused`, `done`, `archived`; the 5 `natureza` values `fato`, `opiniao`, `plano`, `hipotese`, `relato` and that an absent one is not classified; the 3 `escopo` values `pessoal`, `equipe`, `externo`; `review_every` with `30d`, `90d`, `never`; the 5 callouts `> [!fato]`, `> [!opiniao]`, `> [!plano]`, `> [!hipotese]`, `> [!relato]`; and a sentence saying the owner may add `type` and `status` values in the interview (AC 3, amendment 6)
Proof: `npx vitest run tests/organize.skill.test.ts -t "C3 "`

**C4** - `resources/guia.md` has a rules section holding the 7 rules of AC 4 (write only under the memory folder; no file at the top of `notes/`; never move, rename, edit or delete outside the memory folder; never overwrite a file without `generated-by: organize-brain`; an index note holds pointers, not copied content; a plan or opinion never written as a fact; classifying a note outside the memory folder is a proposal in the report) plus the one exception: the `_resumo.md` of the run's context, where `aplicar` fills only empty sections, never rewrites text in a section, and creates a missing one with `type: brief`, `status: active` and the four sections `## O que é`, `## O que importa`, `## Metas`, `## O que ignorar` (AC 4, amendment 7)
Proof: `npx vitest run tests/organize.skill.test.ts -t "C4 "`

**C5** - `resources/perguntas.md` has exactly the 15 theme sections `perfil`, `estrategia`, `cliente-ideal`, `marca`, `voz`, `oferta`, `organizacao`, `stakeholders`, `dores`, `crencas`, `respostas`, `metas`, `estrutura`, `escopo`, `preferencias`, each with 3 to 8 questions (a section with 2 or 9 fails the test's own fixture) and the note it fills, which for the 12 themes of door 2 is `notes/negocio/<tema>.md`; besides them, the section `contexto` that C47 uses with a work context (AC 5, door 2)
Proof: `npx vitest run tests/organize.skill.test.ts -t "C5 "`

**C6** - `SKILL.md` has one procedure section per `etapa` and says that an absent `etapa` runs `entrevista`: `entrevista` writes only `<pasta de memória>/inbox/entrevista-AAAA-MM-DD.md` with the questions still unanswered; `aplicar` reads the newest interview note and writes `<pasta de memória>/notes/negocio/*.md`; `indexar` calls `GET /api/memory/maps` with `MORDOMO_RUN_TOKEN` and writes `_index.md` at the entry's `indexPath` only when its `state` is `missing` or `stale`, with the front matter of door 3 (`type: index`, `status: active`, `tags`, `source`, `children-digest`, `generated-by: organize-brain`, `updated`, `last_reviewed`) (AC 6, doors 2 and 3, amendments 5, 8 and 12)
Proof: `npx vitest run tests/organize.skill.test.ts -t "C6 "`

**C7** - The `entrevista` section of `SKILL.md` tells the agent to skip a question whose note under `notes/negocio/` already answers it and to list it under the heading `Já respondido` of the interview note (AC 7)
Proof: `npx vitest run tests/organize.skill.test.ts -t "C7 "`

**C8** - The prompt of a run of `organize-brain` with `folder` = an indexed subfolder holds the lines `Memory folder (an added folder of this run): <home>/memory`, `  long-term memory: <home>/memory/MEMORY.md`, `  daily journal: <home>/memory/journal/YYYY-MM-DD.md` and `Folder to organize (read-only): <real path of folder>`; without `folder` it holds no `Folder to organize` line (AC 8)
Proof: `npx vitest run tests/organize.skill.test.ts -t "C8 "`

**C9** - A new home's `settings.memorySkills` is `["recall","consolidate-memory","organize-brain"]`, and a `settings.json` that stores `memorySkills: ["recall","consolidate-memory"]` still reads exactly that list (AC 9, Impact settings)
Proof: `npx vitest run tests/organize.skill.test.ts -t "C9 "`

**C10** - With `memorySkills` `["recall","consolidate-memory"]`, the prompt of a run of `organize-brain` has no `Memory folder` line, no `MORDOMO_RUN_TOKEN` in its environment, and a line saying `organize-brain` is not in `memorySkills` and that the owner adds it with `PUT /api/settings` (AC 9)
Proof: `npx vitest run tests/organize.skill.test.ts -t "C10 "`

**C11** - Every file `organize-brain` ships passes the two existing sweeps of seguranca-p1 C49: no line names a path relative to the home (`memory/…`, `config/…`) and none reaches the owner token; and the skill mentions `MORDOMO_RUN_TOKEN` because it is a memory skill, so the sweep's list of memory skills is `consolidate-memory`, `organize-brain`, `recall` (amendment 8)
Proof: `npx vitest run tests/builtin-context.test.ts -t "no built-in skill names a path relative to the home"`
Proof: `npx vitest run tests/builtin-context.test.ts -t "a skill that talks of the run credential is one the owner's settings name"`

**C12** - With `securityProfile` `controlled_write`, `POST /api/skills/organize-brain/run {inputs:{etapa:"entrevista"}}` answers `200` with `status` `queued`, the run's `permissionProfile` is `controlled_write`, and against the fake CLI it ends `done`; with `review_before_write` the same request answers `202` with `status` `waiting_approval` and the adapter is not called (owner answer to question 2)
Proof: `npx vitest run tests/organize.skill.test.ts -t "C12 "`

### S2 - uma pasta do usuário, só para ler · ~10 files · ~151 KB · ~38k

**C13** - `POST /api/skills/organize-brain/run` with `folder` = `<pasta indexada>/clientes` gives the `AgentRun` `cwd` `<home>/workspace`, `readDirs` holding the skill folder, `<home>/memory` and the real path of `clientes`, and `protectedDirs` holding the skill folder and that real path; a `cwd` sent with it (the folder itself) is not used, the run still starts in `<home>/workspace` (AC 10, door 5, door 9)
Proof: `npx vitest run tests/organize.runs.test.ts -t "C13 "`
Proof: `npx vitest run tests/organize.layer.test.ts -t "C13 own layer"`

**C14** - A `folder` outside every `settings.indexedFolders` entry, and one inside an indexed folder that is disabled, each answer `400 folder_not_indexed` naming the folder, and no run is recorded (`GET /api/runs` unchanged) (AC 11)
Proof: `npx vitest run tests/organize.runs.test.ts -t "C14 "`

**C15** - Each of: the home's `config/`, the home's `logs/`, a user-excluded folder, a folder with a secret name (`.ssh`), and an indexed folder holding a link into the home's `config/`, answers `400 folder_not_indexed` and records no run (AC 12)
Proof: `npx vitest run tests/organize.runs.test.ts -t "C15 "`
Proof: `npx vitest run tests/organize.layer.test.ts -t "C15 own layer"`

**C16** - A memory skill fixture with a `folder` input and `providers: [claude, codex, cursor]` run with `provider` `codex`, and with `cursor`, and a `folder` answers `409 folder_protection_unsupported` and records no run; the same request without `folder` answers `200`; `organize-brain` with `codex` answers `400 bad_request` (the skill declares only Claude) (AC 13)
Proof: `npx vitest run tests/organize.runs.test.ts -t "C16 "`

**C17** - `ClaudeAdapter.buildInvocation` of that run, in `read_only` and in `write` (`controlled_write`), holds `--add-dir <real folder>` and, in `--disallowedTools`, `Edit(/<real folder>/**)`, `Write(/<real folder>/**)` and `MultiEdit(/<real folder>/**)` (AC 14)
Proof: `npx vitest run tests/organize.runs.test.ts -t "C17 "`

**C18** - With `organize-brain` removed from `memorySkills`, a run with `folder` keeps the folder only as the prompt line `- … (folder): <folder>`, and its `readDirs` and `protectedDirs` are exactly the skill folder (AC 15)
Proof: `npx vitest run tests/organize.runs.test.ts -t "C18 "`

**C19** - The manifests declare `capabilities.protectsDirs` `true` for `claude` and `false` for `codex` and `cursor`, and `GET /api/providers` carries the field for each (AC 16, Impact contract)
Proof: `npx vitest run tests/organize.runs.test.ts -t "C19 "`

**C20** - Under `review_before_write`, a parked run of `organize-brain` whose `folder`'s indexed folder is disabled before the approval ends `failed` with `failure.code` `folder_not_indexed` when approved, and the adapter is never called (door 5 read when the run launches)
Proof: `npx vitest run tests/organize.runs.test.ts -t "C20 "`

**C21** - A `folder` under `<home>/memory/notes/` is accepted (`200`), `<home>/memory` appears once in `readDirs`, and `protectedDirs` is exactly the skill folder (door 9, amendment 3)
Proof: `npx vitest run tests/organize.runs.test.ts -t "C21 "`

**C22** - `mordomo run organize-brain --input folder=<outside>` prints `folder_not_indexed` on stderr and exits 1, and the MCP tool `skills_run {slug:"organize-brain", inputs:{folder:"<outside>"}}` returns an error naming `folder_not_indexed`; with an indexed `folder` both start the run with the readDirs of C13 (Observable, command `mordomo run`)
Proof: `npx vitest run tests/organize.runs.test.ts -t "C22 "`

**C23** - A routine whose skill is `organize-brain` with `inputs.folder` = an indexed subfolder, fired under `approved_automation`, hands the agent the `readDirs` and `protectedDirs` of C13 (the same rule for every way a run of the skill starts)
Proof: `npx vitest run tests/organize.runs.test.ts -t "C23 "`

### S3 - mapa de pastas, notas-índice e o roteador · ~11 files · ~273 KB · ~68k

**C24** - Over an indexed root holding `a.md`, `b.md`, `sub/c.md`, `sub/deep/d.md` and `vazia/` (no file), `GET /api/memory/maps?root=<root>` answers `200` with exactly the entries for `<root>` (`children` 3), `sub` (`children` 2) and `sub/deep` (`children` 1), each with `path`, `rel`, `children`, `digest`, `index`, `indexDigest`, `state` and `indexPath`; without `root` the answer also holds every folder of `<home>/memory/notes/` that holds an indexed file (AC 17, amendment 5)
Proof: `npx vitest run tests/organize.maps.test.ts -t "C24 "`

**C25** - For a folder holding `b.md`, `a.md`, `sub/`, `.oculto.md` and `_index.md`, `digest` is `"sha256:" + hex(SHA-256("d:sub\nf:a.md\nf:b.md"))` computed in the test with `node:crypto`, and two calls over the same index return the same digest (AC 18, door 4)
Proof: `npx vitest run tests/organize.maps.test.ts -t "C25 "`
Proof: `npx vitest run tests/organize.layer.test.ts -t "C25 own layer"`

**C26** - A folder with no `_index.md` has `state` `missing`, `index` `null` and `indexDigest` `null`, and its `indexPath` is `<folder>/_index.md` for a folder under `<home>/memory/notes/` and `<home>/memory/maps/<slug da raiz>/<rel>/_index.md` for a user folder (`<home>/memory/maps/<slug da raiz>/_index.md` for the root itself) (AC 19, door 8)
Proof: `npx vitest run tests/organize.maps.test.ts -t "C26 "`

**C27** - An `_index.md` at `indexPath` whose front matter `children-digest` equals `digest` gives `state` `fresh` with `index` = its path and `indexDigest` = that value; one with another digest, and one with no `children-digest`, give `stale` (AC 20, door 3)
Proof: `npx vitest run tests/organize.maps.test.ts -t "C27 "`
Proof: `npx vitest run tests/organize.layer.test.ts -t "C27 own layer"`

**C28** - After a file is added to a `fresh` folder and the index pass finishes, the next call reports it `stale`; after a child's text is edited (no child added or removed) and the pass finishes, it stays `fresh` with the same `digest` (AC 21)
Proof: `npx vitest run tests/organize.maps.test.ts -t "C28 "`

**C29** - `root` = an absolute path that is no indexed root answers `404 not_found`; `root` = `relativo/pasta` and `root` = `../x` answer `400 validation`; `root=memory` answers `200` with only folders under `<home>/memory/notes/` (AC 22)
Proof: `npx vitest run tests/organize.maps.test.ts -t "C29 "`

**C30** - A user-excluded subfolder, a folder with a secret name and the home's `config/` are not entries and are not counted in their parent's `children` nor in its `digest` (AC 23)
Proof: `npx vitest run tests/organize.maps.test.ts -t "C30 "`

**C31** - The credential of a running `organize-brain` run with `folder` = `<root A>/sub` gets `200` with entries only under `<home>/memory/notes/` and `<root A>/sub`, and `404 not_found` for `root` = `<root B>`; a run of a context gets entries under its `ok` paths too; a device holding `content` gets `200` with every root's folders and one holding only `monitor` gets `403 scope_required` (AC 24, door 10, amendment 4)
Proof: `npx vitest run tests/organize.maps.test.ts -t "C31 "`

**C32** - The slug of a root named `Projetos Cliente` is `projetos-cliente-` plus the first 8 hex of SHA-256 of its absolute path; two roots named `Projetos` in different parents get different slugs; a root named `###` gets `pasta-<8 hex>`; a name of 60 letters is cut to 40 before the hash (door 8, amendment 5)
Proof: `npx vitest run tests/organize.layer.test.ts -t "C32 own layer"`

**C33** - A Markdown file whose front matter holds `type: index`, `status: active`, `updated: 2026-10-29`, `last_reviewed: 2026-10-29`, `natureza: plano`, `escopo: equipe` and `review_every: 90d` has those 7 keys with those values in its `fields` (`GET /api/memory/query?where=natureza:plano` returns it with them), an inline `status:: draft` in its body makes `fields.status` `draft`, a value of 64 characters is stored and one of 65 is not (AC 25, door 6)
Proof: `npx vitest run tests/organize.maps.test.ts -t "C33 "`
Proof: `npx vitest run tests/organize.layer.test.ts -t "C33 own layer"`

**C34** - After `generateRouters`, `ROUTER.md` holds `## Folder indexes` with one link per `fresh` or `stale` index note and its folder, and `## Folders without an index` with at most 20 `missing` or `stale` folders ordered by `children`, most first (25 such folders give 20 lines); with none of either kind both headings are absent (AC 26)
Proof: `npx vitest run tests/organize.maps.test.ts -t "C34 "`

### S4 - metas e postura no mapa dos agentes · ~6 files · ~120 KB · ~30k

**C35** - With `<home>/memory/notes/negocio/metas.md` holding `## Metas` with 12 first-level items (one of 200 characters) and nested items, the compiled `AGENTS.md` and `CLAUDE.md` of `GET /api/sync/plan` hold `## Goals and priorities` as the first `##` after `# <systemName>`, with the first 10 items only, the long one cut at 160 characters, no nested item, then the line `Full goals: <home>/memory/notes/negocio/metas.md` (AC 27, door 7)
Proof: `npx vitest run tests/organize.sync.test.ts -t "C35 "`
Proof: `npx vitest run tests/organize.layer.test.ts -t "C35 own layer"`

**C36** - `GET /api/sync/plan?context=<id>` (the compile into a context's first `ok` path, `cerebro-contextos` C30) holds the same `## Goals and priorities` section in its `AGENTS.md` and `CLAUDE.md` actions (amendment 11)
Proof: `npx vitest run tests/organize.sync.test.ts -t "C36 "`

**C37** - With `metas.md` missing, with no `## Metas` section, and as a link to a file outside `memory/`, the compiled files have no `## Goals and priorities` and `mordomo sync` (`POST /api/sync/apply`) answers `200` and writes them (AC 28)
Proof: `npx vitest run tests/organize.sync.test.ts -t "C37 "`

**C38** - With `memory.agentStance` `contest-conflicts` the goals section ends with the line `- When a request conflicts with these goals, say so and propose the alternative that serves them before doing it.`; with `neutral` that line is absent from both files (AC 29, door 7)
Proof: `npx vitest run tests/organize.sync.test.ts -t "C38 "`

**C39** - A new home reads `memory.agentStance` `neutral`; a `settings.json` holding `"agentStance": "loud"` starts reading `neutral`; `PUT /api/settings {memory:{agentStance:"loud"}}` answers `400 validation` and leaves the setting unchanged, and `{memory:{agentStance:"contest-conflicts"}}` answers `200` and stores it (AC 30, door 7)
Proof: `npx vitest run tests/organize.sync.test.ts -t "C39 "`

**C40** - In pt-BR, Settings › Memória shows the group `Postura dos agentes` with the two radio options `Neutra` and `Contestar o que conflita com as metas`, the current value's option checked, and a line naming `mordomo sync`; choosing the other sends `PUT /api/settings {memory:{agentStance:"contest-conflicts"}}`; every new key has an English text (AC 31)
Proof: `npm run test -w apps/command-centre -- src/views/settings/AgentStance.test.tsx -t "C40 "`

**C41** - The group `Postura dos agentes` is the last block of the Memory tab, after the registries field, and the Contexts section still comes right after the indexed folders (amendment 10; `cerebro-contextos` C52 unchanged)
Proof: `npm run test -w apps/command-centre -- src/views/settings/AgentStance.test.tsx -t "C41 "`
Proof: `MORDOMO_E2E_PORT=4901 npx playwright test --config tests/e2e/playwright.config.ts organize.spec.ts -g "C41 "`

**C42** - When `PUT /api/settings` answers `500` the group shows the error text beside an icon and the previous option stays checked (AC 32)
Proof: `npm run test -w apps/command-centre -- src/views/settings/AgentStance.test.tsx -t "C42 "`

**C43** - On `/settings?tab=memory` in the light and the dark theme the group's text computes to 12px or more, axe reports no violation at WCAG A/AA, and the CSS lint over the interface's stylesheets (raw colours refused, tokens only) exits 0 (AC 33)
Proof: `MORDOMO_E2E_PORT=4901 npx playwright test --config tests/e2e/playwright.config.ts organize.spec.ts -g "C43 "`
Proof: `npm run lint:css`

### S5 - o contexto de trabalho · ~4 files · ~119 KB · ~30k (~5k beyond S2's files)

**C44** - `POST /api/skills/organize-brain/run` with `contextId` of a context whose first path is deleted and whose second (`ok`) and third (`ok`) are indexed folders, and no `folder`, gives the prompt line `Folder to organize (read-only): <real second path>`, `cwd` `<home>/workspace`, `readDirs` holding both `ok` paths and `memory/notes/<id>/` (when it exists), and `protectedDirs` holding the skill folder and both `ok` paths but not `memory/notes/<id>/`; `RunRecord.contextId` is the id (AC 34, door 9, amendment 2)
Proof: `npx vitest run tests/organize.runs.test.ts -t "C44 "`
Proof: `npx vitest run tests/organize.layer.test.ts -t "C44 own layer"`

**C45** - With `contextId` and a `folder` outside every path of the context the route answers `400 validation` and records no run; a `folder` inside the context's second path is kept as the folder (AC 35)
Proof: `npx vitest run tests/organize.runs.test.ts -t "C45 "`

**C46** - With an unknown `contextId` the route answers `404 context_not_found`, and with a context none of whose paths is `ok` `409 context_unavailable`, before any `folder` check, and no run is recorded (`cerebro-contextos` C20 on this skill)
Proof: `npx vitest run tests/organize.runs.test.ts -t "C46 "`

**C47** - The `SKILL.md` context section says: when the prompt starts with `Work context:`, take `<id>` from the file name of the line `Map of the context`; `entrevista` writes `<pasta de memória>/inbox/entrevista-<id>-AAAA-MM-DD.md` with the questions of the section `contexto` of `perguntas.md` (what it is, what matters, goals, what to ignore); `aplicar` writes into `<pasta de memória>/notes/<id>/_resumo.md` under its four headings, keeps `type: brief`, and marks `## Metas` with `> [!plano]` (AC 36, amendments 6, 7 and 9)
Proof: `npx vitest run tests/organize.skill.test.ts -t "C47 "`

**C48** - The prompt of a run of `organize-brain` with `contextId` starts with the context block of `cerebro-contextos` (`Work context: <name>`, `Map of the context (its key files): <home>/memory/contexts/<id>.md`) and holds the `Folder to organize (read-only)` line and the memory lines of C8 (AC 36, AC 8)
Proof: `npx vitest run tests/organize.skill.test.ts -t "C48 "`

### Cross-cutting

**C49** - `GET /api/memory/maps` is in the `API` table with its query, `200` schema and errors (`400 validation`, `404 not_found`), in the OpenAPI document (which validates), in `EXPECTED_ROUTE_SCOPES` as `content`, in `RUN_API_READ_ROUTES`, in the `content` row of `docs/security.md`, and has a scenario in the refusal probe that reaches it; `skills.run` declares `400 folder_not_indexed` and `409 folder_protection_unsupported` (Surface, doors 4 and 5)
Proof: `npx vitest run tests/organize.maps.test.ts -t "C49 "`
Proof: `npx vitest run tests/api.openapi.test.ts -t "C16 the document validates"`

**C50** - The raw `fs` allowlist and the module-state list do not grow: the maps read the `files` rows and the front matter of `_index.md` through the existing readers (door 4)
Proof: `npx vitest run tests/security-reads.test.ts -t "C55 the list holds 70 rows"`
Proof: `npx vitest run tests/security-reads.test.ts -t "C32 every raw fs read in core/src and apps/api/src is on the reviewed list finds nothing outside the list"`
Proof: `npx vitest run tests/sdk.instances.test.ts -t "C30 the module-level mutable state"`

## Coverage

| Set (size)                                                 | Member -> proof                                                                                                                        | Unproven |
| ---------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| `POST /api/skills/:slug/run` statuses (5)                  | 200 C12, C13 · 202 C12 · 400 C14, C15, C16, C45 · 404 C46 · 409 C16, C46                                                               | -        |
| `GET /api/memory/maps` statuses (4)                        | 200 C24, C31 · 400 C29 · 403 C31 · 404 C29, C31                                                                                        | -        |
| `PUT /api/settings` with `memory.agentStance` statuses (2) | 200 C39 · 400 C39                                                                                                                      | -        |
| new error codes (2)                                        | `folder_not_indexed` C14, C15, C20, C22 · `folder_protection_unsupported` C16                                                          | -        |
| `etapa` values (3)                                         | `entrevista` C6, C7, C12 · `aplicar` C6 · `indexar` C6                                                                                 | -        |
| `type` values of the guide (11)                            | C3, table-driven over all 11                                                                                                           | -        |
| `status` values (5)                                        | C3, table-driven over all 5                                                                                                            | -        |
| `natureza` values (5)                                      | C3, table-driven over all 5 (absent = not classified, C3)                                                                              | -        |
| callouts (5)                                               | C3, table-driven over all 5                                                                                                            | -        |
| `escopo` values (3)                                        | C3, table-driven over all 3                                                                                                            | -        |
| guide rules (8)                                            | C4, table-driven over all 8 (the 7 of AC 4 and the `_resumo.md` exception)                                                             | -        |
| question themes (15)                                       | C5, table-driven over all 15                                                                                                           | -        |
| question section with a context (1)                        | `contexto` C5, C47                                                                                                                     | -        |
| business notes of door 2 (12)                              | C5, table-driven over all 12                                                                                                           | -        |
| refused folder kinds (7)                                   | outside C14 · disabled indexed folder C14 · `config/` C15 · `logs/` C15 · user exclude C15 · secret name C15 · link into `config/` C15 | -        |
| provider manifests (3)                                     | `claude` C17, C19 · `codex` C16, C19 · `cursor` C16, C19                                                                               | -        |
| run modes for the deny rules (2)                           | `read_only` C17 · `write` C17                                                                                                          | -        |
| ways a run of the skill starts (5 places)                  | route C13 · CLI C22 · MCP `skills_run` C22 · routine C23 · approval of a parked run C20                                                | -        |
| where a folder comes from (3)                              | the `folder` input C13 · the context's first `ok` path C44 · a folder under `memory/` C21                                              | -        |
| index states (3)                                           | `missing` C26 · `stale` C27, C28 · `fresh` C27, C28                                                                                    | -        |
| `indexPath` locations (3)                                  | folder of `memory/notes/` C26 · user subfolder C26 · user root C26                                                                     | -        |
| digest exclusions (3)                                      | `_index.md` C25 · name starting with `.` C25 · folder hidden by policy C30                                                             | -        |
| `root` values (5)                                          | absent C24 · `memory` C29 · indexed root C24 · unknown absolute C29 · relative C29                                                     | -        |
| callers of the maps route (4)                              | owner C24 · device with `content` C31 · device with `monitor` C31 · run credential (folder, context) C31                               | -        |
| front-matter keys into `fields` (7)                        | C33, table-driven over all 7                                                                                                           | -        |
| `fields` value bound (2 edges)                             | 64 C33 · 65 C33                                                                                                                        | -        |
| ROUTER sections (2)                                        | `Folder indexes` C34 · `Folders without an index` C34                                                                                  | -        |
| goals bounds (3)                                           | 10 of 12 items C35 · 160 characters C35 · nested items left out C35                                                                    | -        |
| goals absent cases (3)                                     | `metas.md` missing C37 · no `## Metas` C37 · link out of `memory/` C37                                                                 | -        |
| `memory.agentStance` values (3)                            | `neutral` C38, C39 · `contest-conflicts` C38, C39 · unreadable C39                                                                     | -        |
| compile targets (2)                                        | the home's sync C35, C37 · a context's sync C36                                                                                        | -        |
| compiled files (2)                                         | `AGENTS.md` C35, C36, C38 · `CLAUDE.md` C35, C36, C38                                                                                  | -        |
| stance setting states (3)                                  | loaded C40 · error C42 · themes C43                                                                                                    | -        |
| doors (10)                                                 | 1 C1, C2 · 2 C5, C6 · 3 C6, C27 · 4 C25, C49 · 5 C13, C16 · 6 C33 · 7 C35, C38, C39 · 8 C26, C32 · 9 C13, C21, C44 · 10 C31            | -        |
| owner answers of the plan (2)                              | `neutral` by default C39 · `controlled_write` C12                                                                                      | -        |
| startup config: default `memorySkills` read (2 assemblies) | the service (`AppContext`, `GET /api/skills`) C9 · the CLI (`mordomo run`) C22                                                         | -        |
| amendments (12)                                            | 1 C12 · 2 C13, C44 · 3 C21 · 4 C31 · 5 C24, C26, C32 · 6 C3, C47 · 7 C4, C47 · 8 C6, C11 · 9 C47 · 10 C41 · 11 C36 · 12 C1, C6         | -        |

- Claims naming a status code, route or response shape: C1, C2, C12-C16, C19-C22, C24-C31, C33, C35-C37, C39, C44-C46
  and C49, each proven through `app.inject` against `buildServer` (or the CLI and MCP entry points for C22); C13, C15,
  C25, C27, C33, C35 and C44 also at their own layer, with no HTTP
- Claims about the skill's prose: C3-C7, C47 by parsing the shipped files of a seeded home; C8, C10, C12, C48 by a run
  against the fake CLI
- Claims about the screen: C40-C42 in rendered components; C41 and C43 also in a real browser
- Relations: `None` in the plan; no entity row is owed

## Binding sources

| Source                                                                   | Checked by    |
| ------------------------------------------------------------------------ | ------------- |
| `cerebro-organizar/plan.md` AC 31-33 (copy and states of the stance)     | C40, C42, C43 |
| `cerebro-contextos/design.md` (Settings › Memória › Contextos placement) | C41           |
| `design-system/design.md` (sizes, tokens, contrast)                      | C43           |
| `cerebro-v2/design.md` (error pattern: text beside an icon)              | C42           |

## Test policy

| Code                                                                                                   | Required proofs                                       | Coverage expectation                                                                           |
| ------------------------------------------------------------------------------------------------------ | ----------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| Decides, reached across a boundary (the folder verdict, the run's folders, the maps state, the fields) | one at the HTTP boundary **and** one at its own layer | the contract at the boundary; one asserted case per row of the decision table at its own layer |
| Decides, not reached across a boundary (the digest, the root slug, the goals extraction)               | one at its own layer                                  | one asserted case per row                                                                      |
| Skill prose (SKILL.md, resources)                                                                      | a parse of the shipped file and a run on the fake CLI | each set the plan enumerates, member by member                                                 |
| Screen                                                                                                 | one in rendered components per state                  | each state AC 31-32 name; both themes for axe in the browser                                   |

Evidence:

- the folder verdict (new, beside `Execution.startSkill` and `RunManager.skillContext`): 7 refused kinds, 3 sources of the
  folder, the provider capability and the memory-skill test, ~12 branch points -> decides
- `RunManager.skillContext`/`contextDirs` with a protected folder: `cwd` choice, `readDirs` order, which dirs are
  protected (folder, context paths, `memory/`) -> decides
- the maps (new module): 3 states, 3 `indexPath` locations, 3 exclusions, the caller's reach -> decides
- `parseFrontMatter` + the indexer's `fields`: 7 keys, the 64-character bound, inline precedence -> decides
- `agentsFileContent` goals: 3 absent cases, 2 stances, 2 bounds -> decides
- own layer: `tests/organize.layer.test.ts` calls the folder verdict, `RunManager` (the folders it hands over), the digest,
  the maps state, the root slug, `parseFrontMatter` and the goals extraction, with no HTTP
- closest analogue: `tests/contexts.layer.test.ts` (`cerebro-contextos`, the path verdict and the run's folders proven at
  the boundary and in the core); for prose, `tests/builtin-context.test.ts` (seguranca-p1 C49, `recall` and
  `consolidate-memory`)

Cost: 7 proofs at their own layer in one new file. Without these rows the folder verdict, the run's folders and the maps
state are proven only through the HTTP path that happens to reach them.

## Swept

- validation: C14, C15, C29, C33 (the 64/65 bound), C39, C45
- failure modes: C20 (the folder stops being indexed before the run launches), C37 (no goals file), C42 (saving fails)
- idempotency: C25 (same index, same digest), C28 (an edit keeps `fresh`), C4 (the skill never overwrites a file it did not make)
- authorization: C31 (the run credential sees only its folders; `content` device; `monitor` device `403`), C13 and C17 (the folder is read-only to the agent), C18 (no memory skill, no folder), existing - `PUT /api/settings` is `owner` (AD-015), so the stance is the owner's only
- concurrency: n/a - the maps route only reads the index; the stance is one field written through the `SettingsStore`, whose writes are atomic and serialized (AD-013)
- data lifecycle: C9 (a stored `memorySkills` is kept), C4 (nothing outside the memory folder is moved or deleted), C28 (a new child ages the index)
- dependency failure: C20, C37 (a goals file that is a link out), C46 (a context with no `ok` path)
- state transitions: C27, C28 (`missing` → `fresh` → `stale`), C12 (`queued` vs `waiting_approval`), C20 (`waiting_approval` → `failed`)
- observability: n/a - no new log or event; `settings.changed` already announces a stance write (AD-013), and the skill's report goes to its run's `artifacts/`

## Handoff

The estimate exceeds the 150k budget, so the build stops here for the mechanism choice (`build.md`).

- Arithmetic (`wc -c` of the files each slice touches, / 4; new files estimated):
  - S1: `contracts/src/settings.ts`, `core/src/skills/catalog.ts`, `tests/builtin-context.test.ts`,
    `tests/fixtures/events/v1/settings.changed.json`, `skills/consolidate-memory/SKILL.md` (the model) = 78 467 B, plus
    the new `SKILL.md`, `guia.md`, `perguntas.md` ≈ 32 KB → ≈ 111 KB → ≈ 28k
  - S2: `core/src/execution/service.ts`, `core/src/runs/runManager.ts`, `contracts/src/records.ts`,
    `contracts/src/api/wire.ts`, the three `manifest.ts`, `adapters/claude/src/index.ts`, `contracts/src/api/skills.ts`,
    `core/src/errors.ts` = 151 204 B → ≈ 38k
  - S3: `core/src/memory/frontMatter.ts`, `indexer.ts`, `routers.ts`, `apps/api/src/routes/memory.ts`,
    `contracts/src/api/memory.ts`, `apps/api/src/server.ts`, `tests/helpers/routeScopes.ts`, `docs/security.md`,
    `tests/helpers/contractWorld.ts`, `core/src/internal.ts` = 263 329 B, plus a new maps module ≈ 10 KB → ≈ 273 KB → ≈ 68k
  - S4: `core/src/sync/compiler.ts`, `contracts/src/settings.ts`, `apps/command-centre/src/views/settings/memory.tsx`,
    `apps/command-centre/src/i18n.ts`, `apps/command-centre/src/views/SettingsFields.tsx` = 115 512 B, plus the new
    `AgentStance.tsx` ≈ 4 KB → ≈ 120 KB → ≈ 30k
  - S5: `core/src/execution/service.ts`, `core/src/runs/runManager.ts`, `core/src/memory/contexts.ts`,
    `core/src/execution/launch.ts` = 119 254 B → ≈ 30k (≈ 5k beyond the files S2 already holds)
  - slices alone ≈ 194k; the new tests (`tests/organize.skill.test.ts` ≈ 18 KB, `organize.runs.test.ts` ≈ 25 KB,
    `organize.maps.test.ts` ≈ 30 KB, `organize.layer.test.ts` ≈ 18 KB, `organize.sync.test.ts` ≈ 12 KB,
    `AgentStance.test.tsx` ≈ 8 KB, `tests/e2e/organize.spec.ts` ≈ 8 KB ≈ 119 KB) add ≈ 30k: ≈ 224k in all, over 150k
- Proposed cut, at the surface boundaries (batches sequential, each only on green); S5 packs with S2 because it changes
  the same run surface and files, and none of S1, S2, S5 needs S3 (the skill's prose names the maps route; its tests only
  parse it):
  - **A** (the skill and its run: catalog, run start, adapter, contexts): S1 + S2 + S5 ≈ 28k + 38k + 5k = ≈ 71k, plus
    tests (`organize.skill`, `organize.runs`, the run half of `organize.layer`) ≈ 52 KB → ≈ 13k = ≈ 84k; C1-C23, C44-C48
  - **B** (index, maps route, routers, compiler and the screen, then the cross-cutting pins): S3 + S4 ≈ 68k + 30k = ≈ 98k,
    plus tests (`organize.maps`, the other half of `organize.layer`, `organize.sync`, `AgentStance.test.tsx`, the e2e spec)
    ≈ 67 KB → ≈ 17k = ≈ 115k; C24-C43, C49, C50
- Mechanism: handoff (the owner chose it on 2026-10-29: two batches A, B, sequential, each only on green)

Status of batch A (updated in the commit that closes each piece):

- S1 without the folder line of the prompt (C1-C7, C9-C12, C47): closed, every proof green in
  `tests/organize.skill.test.ts` and `tests/builtin-context.test.ts`
- the folder of a run of a memory skill, only to read (S2: C13-C23), the folder line of the prompt (C8) and the work
  context (S5: C44-C48): closed, every proof green in `tests/organize.runs.test.ts`, `tests/organize.layer.test.ts` and
  `tests/organize.skill.test.ts`; with it batch A is closed (C1-C23 and C44-C48)

- **Boundary (batch A):** C1-C23 and C44-C48 closed. S1 without the folder line of the prompt (C1-C7, C9-C12, C47) at
  `0d1cbf5`; S2, the folder line (C8) and S5 at `46a48c0`, which closes the batch. On the tree of `46a48c0`:
  `npm run build`, `npm run typecheck` and `npm run lint` exit 0, `npx vitest run` at the root is green (134 files, 1783
  tests, 1 skipped) and `npm run test -w apps/command-centre` too (140 files, 1125 tests); each of the 32 `Proof:` lines
  of the batch passes and runs only its check's tests (C13 and C22 run two each, one per entry point). S3, S4, C49 and
  C50 are untouched (batch B): there is no maps route, no index note logic, no goals section and no stance setting.
- **Settled mid-build:** nothing by the owner. Builder decisions inside the approved shape, for batch B: (a) door 11
  added in `46a48c0` (`RunFailure.code` gains `folder_not_indexed` and `folder_protection_unsupported`; the route
  refusals are `FolderNotIndexedError` and `FolderProtectionUnsupportedError` in `core/src/runs/protectedFolder.ts`,
  outside `ENGINE_ERROR_CODES`), with an Impact row; `skills.run` already declares both codes, so C49 only has to prove
  them; (b) a skill takes a folder when the owner's `memorySkills` names it and it declares the input `folder`; the
  folder is kept in the run's `request.inputs.folder` (filled from the context's first `ok` path when absent), so the
  `RunManager` reads door 5 again at launch for an approval, a routine or a retry; (c) any run handed a folder starts in
  `<home>/workspace`, a folder under `memory/` included, and its `readDirs` are the skill folder, `memory/`, the folder,
  then the context's `ok` paths and `memory/notes/<id>/`; (d) `capabilities.protectsDirs` is optional in the manifest
  type and on the wire (absent reads `false`), and `GET /api/providers` always fills it; (e) C2's proof reads the
  resource route with `?rel=`, the route's only query parameter (`contracts/src/api/skills.ts`), where the check's text
  says `?path=`: the claim (each file served with `200` and its text) is unchanged; (f) the hint of C10 is given to any
  built-in memory skill (the default `memorySkills`, read from `defaultSettings()`) the owner took out of the list;
  (g) `mordomo run` prints `folder_not_indexed: ` or `folder_protection_unsupported: ` before the message on stderr;
  (h) the input `folder` is labelled "Folder (an indexed folder, read-only)", so the input line of the prompt is not
  read as the `Folder to organize (read-only)` line; (i) pins moved the way the repo moves them:
  `tests/builtin-context.test.ts` names three memory skills (its title says "the three memory skills are"), the v1
  `settings.changed` fixture carries the new default, and `tests/api.contract.test.ts` C13 counts 66 raised pairs;
  `tests/data.settings.test.ts` needed no change; (j) `tests/helpers/organizeWorld.ts` is the shared world (a seeded
  home, an indexed folder, the three fake providers, the Claude adapter spied) and `tests/organize.layer.test.ts` holds
  the run half of the own-layer proofs, for batch B to extend; the skill's prose already names `GET /api/memory/maps`
  with `root`, and each entry's `state`, `digest` and `indexPath`.
- **Abandoned:** adding the two codes to `ENGINE_ERROR_CODES` (the sdk C50 pin is another feature's Landing); a public
  `DEFAULT_MEMORY_SKILLS` in `@mordomo/contracts` (contracts C41 pins the package's exports) and `folderFailureCode` in
  `@mordomo/core/internal` (sdk C38 pins that barrel): the catalog reads `defaultSettings()` and the CLI the error's
  `code`; making `protectsDirs` required as `readConfinement` is (every manifest written before it would stop
  compiling, while absent already fails closed).
