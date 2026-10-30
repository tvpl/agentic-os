# Cérebro: vista de notas checks

Profile: ui
Plan: `.specs/features/cerebro-vista-notas/plan.md`
Design: `.specs/features/cerebro-vista-notas/design.md` (binding for the screens)

81 checks in 8 slices + cross-cutting · 5 one-way doors · 0 open questions of the plan (as duas foram respondidas pelo dono
em 29/10/2026 com os padrões recomendados: a Home e as abas por máquina em `UiPreferences`, door 4; a estrutura fixa desligada,
door 5) · 14 amendments for what C1, C2 and C3 built after the plan (`plan.md` and `design.md`, "Emendas depois da
aprovação"; each names the check that resolves it).

The plan's slices mix the core, the API and the screens; here each is split where the surface changes (core and API, then
the screen), so a batch cut never splits a check slice. S1-S3 are the core and the API of plan S1, S3, S5 and S7; S4-S7 are
the screens of plan S1-S5 and S7; S8 is plan S6.

Every proof is `npx vitest run <file> -t "<C-id> "` from the repository root (root tests) or
`npm run test -w apps/command-centre -- <file> -t "<C-id> "` (UI tests); a test title starts with its check id. `E2E` proofs
use `MORDOMO_E2E_PORT=4901 npx playwright test --config tests/e2e/playwright.config.ts <spec> -g "<C-id> "`. A proof
`-t "<C-id> own layer"` in `tests/notesview.layer.test.ts` calls the deciding code itself (`memoryTree`, `parseProperties`,
`setProperties`, the folder and fixed-structure rules, the `brain.notes` schema), with no HTTP (`Test policy` rows 1 and 2).
The screens' axe runs over the whole page and counts `serious` and `critical` violations (the convention of
`design-system` C8 and `tests/e2e/a11y.spec.ts`).

## Checks

### S1 - a árvore: rota e core (plan S1, S7) · 8 files · 134 KB · ~34k

**C1** - `GET /api/memory/tree` with the owner token and no `root` or `context` answers `200` with `roots[0]` = `<home>/memory` (`editable: true`), then each enabled folder of `settings.indexedFolders` in settings order (`editable: false`; a disabled one absent), `root` = `<home>/memory`, `dir` = `""`, and the entries of the top level of `memory/` (AC 2, door 1)
Proof: `npx vitest run tests/notesview.tree.test.ts -t "C1 "`

**C2** - `GET /api/memory/tree?root=<R>&dir=<D>` answers only the direct subfolders of D and the files directly in D, folders first; each folder's `count` is its number of indexed files at any depth; with no `sort` or `sort=name` each group is ordered by name case-insensitively and accent-folded (`Ábaco`, `abelha`, `Zebra`), with `sort=updated` by `mtime` descending (AC 3, door 1)
Proof: `npx vitest run tests/notesview.tree.test.ts -t "C2 "`
Proof: `npx vitest run tests/notesview.layer.test.ts -t "C2 own layer"`

**C3** - After an index pass, the files of a folder are deleted from disk and `GET /api/memory/tree` for that folder still answers each of them with the `title` and `mtime` the index holds: the answer comes from the `files` rows only, and no file is opened (AC 4, amendment 3)
Proof: `npx vitest run tests/notesview.tree.test.ts -t "C3 "`

**C4** - A row excluded by today's policy (a user exclude added after the pass, a secret-named file `.env`, a file under the home's `config/`) is absent from `files[]` and is not counted in its folder's `count`, and a folder whose only rows are excluded is absent from `folders[]` (AC 5)
Proof: `npx vitest run tests/notesview.tree.test.ts -t "C4 "`
Proof: `npx vitest run tests/notesview.layer.test.ts -t "C4 own layer"`

**C5** - A `root` that is neither `<home>/memory` nor an enabled indexed folder (`/tmp/fora`, a disabled indexed folder) answers `400 unknown_root`; a `dir` with no indexed row under it (`nao-existe`) and a `dir` of `../<another root's folder>` answer `404 not_found`, with no entry of the other root (AC 6, door 1)
Proof: `npx vitest run tests/notesview.tree.test.ts -t "C5 "`

**C6** - A folder of 1 003 entries (1 001 files and 2 subfolders) answers the first 1 000 in the requested order, `truncated: true` and `omitted: 3`; a folder of 1 000 answers `truncated: false` and `omitted: 0` (AC 7, amendment 10)
Proof: `npx vitest run tests/notesview.tree.test.ts -t "C6 "`

**C7** - `editable` and `reason` per entry: a file or folder of an indexed folder outside `memory/` answers `editable: false, reason: "outside_memory"`; `memory/ROUTER.md`, the folders `memory/areas`, `memory/journal`, `memory/contexts` and the files under them answer `reason: "generated"`; a non-`.md` file under `memory/` (`memory/notes/x.txt`) answers `reason: "not_markdown"`; a `.md` under `memory/notes/` and under `memory/maps/` answers `editable: true` with no `reason` (AC 8, amendment 9)
Proof: `npx vitest run tests/notesview.tree.test.ts -t "C7 "`
Proof: `npx vitest run tests/notesview.layer.test.ts -t "C7 own layer"`

**C8** - `indexNote` is the id of the indexed row of the folder's `_index.md` where `cerebro-organizar` puts it (`memory/notes/clientes/_index.md`; for `<R>/projetos`, `memory/maps/<rootSlug(R)>/projetos/_index.md`) even when the folder also holds `README.md`; without it, the first of `index.md`, `README.md`, `CLAUDE.md`, `AGENTS.md` in the folder (`README.md` before `AGENTS.md`, `index.md` before `README.md`); `null` with none; an `_index.md` written after the last pass is not the index note until the next pass (AC 9, amendments 3 and 4)
Proof: `npx vitest run tests/notesview.tree.test.ts -t "C8 "`
Proof: `npx vitest run tests/notesview.layer.test.ts -t "C8 own layer"`

**C9** - Each entry of `files[]` carries `type` from its row's `fields.type`: `"context"` for a note whose front matter holds `type: context`, `null` for one without it (AC 9, amendment 5)
Proof: `npx vitest run tests/notesview.tree.test.ts -t "C9 "`

**C10** - For a context whose paths are `<R>/projetos/app` (`ok`), a deleted folder (`missing`) and `<home>/memory/notes/app-x/clientes` (`ok`), `GET /api/memory/tree?context=<id>` answers `roots` = the two `ok` paths in the context's order (`editable: false`, then `editable: true`), then `<home>/memory/notes/<id>/` (`editable: true`) because it exists; `root` defaults to the first; and the entries are only the context's (`<R>/projetos/app-antigo/` is never listed) (AC 53, amendment 2)
Proof: `npx vitest run tests/notesview.tree.test.ts -t "C10 "`

**C11** - `context=<id that names no context>` answers `404 context_not_found`; with a context, a `root` that is not one of its roots (`<home>/memory`, an indexed folder outside the context) answers `400 unknown_root`; `context=all` answers exactly what no `context` answers (AC 55, amendment 2)
Proof: `npx vitest run tests/notesview.tree.test.ts -t "C11 "`

**C12** - While an index pass runs (`GET /api/memory/status` `indexing.state` `running`) every root answers `indexing: true`, and once it ends every root answers `indexing: false` (door 1, amendment 11)
Proof: `npx vitest run tests/notesview.tree.test.ts -t "C12 "`

### S2 - propriedades: leitura, escrita e formato (plan S3, S7 door 3) · 4 files (+ S1's route and contract) · 50 KB · ~12k

**C13** - `GET /api/memory/note` for a note whose header holds `type: context`, `status: active`, `tags: [offer, accelerator]` and `updated: 2026-10-14` answers `properties` = `type`/`text`/`"context"`, `status`/`status`/`"active"`, `tags`/`list`/`["offer","accelerator"]`, `updated`/`date`/`"2026-10-14"` in that file order, `otherProperties: null`, and `bodyStart` = the offset of the first character after the closing `---` line (AC 25, door 2)
Proof: `npx vitest run tests/notesview.properties.test.ts -t "C13 "`

**C14** - The kind of each key, one asserted case per row: `tags` and `aliases` → `list` (inline `[a, b]` and block `- a`); `created`, `updated`, `last_reviewed`, `due` → `date`; `status` → `status`; `natureza`, `escopo` → `select`; `review_every` → `interval`; `title`, `type`, `children-digest`, `generated-by`, `owner` → `text`; `title: "Plano \"A\""` reads `Plano "A"`; `created: 2026-10-29T19:03:23.000Z` (as `createNote` writes it) stays `date` with that value; `status: blocked` and `natureza: certeza` read as written (door 3, amendment 6)
Proof: `npx vitest run tests/notesview.layer.test.ts -t "C14 own layer"`

**C15** - A header holding a nested map (`meta:` then `  a: 1`), a multi-line string (`desc: |` then `  x`) and a comment line `# c` answers those lines in `otherProperties` exactly as in the file, none of them in `properties`; a note with no header answers `properties: []`, `otherProperties: null` and `bodyStart: 0` (AC 26)
Proof: `npx vitest run tests/notesview.properties.test.ts -t "C15 "`

**C16** - `PUT /api/memory/notes/properties` with `set: { "status": "archived" }` and the current `baseVersion` answers `200` with `version` = `sha256:` of the new bytes and `properties` showing `archived`; the file differs from before only in the `status:` line; the row's `fields.status` reads `archived` after the index pass it requests; the same request again with the new version answers `200` and leaves the bytes unchanged (AC 27, door 2)
Proof: `npx vitest run tests/notesview.properties.test.ts -t "C16 "`
Proof: `npx vitest run tests/notesview.layer.test.ts -t "C16 own layer"`

**C17** - `set: { "last_reviewed": "2026-10-30", "due": "2026-11-01" }` on a header without them adds `last_reviewed:` then `due:` right before the closing `---`; on a note with no header the file becomes `---`, the two lines, `---` and the old content byte for byte (AC 28, door 3)
Proof: `npx vitest run tests/notesview.properties.test.ts -t "C17 "`
Proof: `npx vitest run tests/notesview.layer.test.ts -t "C17 own layer"`

**C18** - `remove: ["type"]` deletes the `type:` line, and `remove: ["tags"]` on a block list deletes `tags:` and its three `- item` lines; every other byte is kept (AC 29, door 3)
Proof: `npx vitest run tests/notesview.properties.test.ts -t "C18 "`
Proof: `npx vitest run tests/notesview.layer.test.ts -t "C18 own layer"`

**C19** - Each of `updated: "14/10/2026"`, `status: "blocked"`, a `text` value with a line break, a `text` value of 501 characters, a `list` of 21 entries, a `tags` entry `a` and one `com espaço`, the keys `Status`, `1x` and one of 41 characters, `natureza: "certeza"`, `escopo: "publico"`, and `review_every` `0d`, `1000d` and `30` answers `400 validation` and leaves the file byte for byte (AC 30, AC 56, door 3, amendment 6)
Proof: `npx vitest run tests/notesview.properties.test.ts -t "C19 "`
Proof: `npx vitest run tests/notesview.layer.test.ts -t "C19 own layer"`

**C20** - A header longer than 4 096 bytes, and one with no closing `---`, answer `409 front_matter_unreadable` and leave the file byte for byte (AC 31, door 3)
Proof: `npx vitest run tests/notesview.properties.test.ts -t "C20 "`
Proof: `npx vitest run tests/notesview.layer.test.ts -t "C20 own layer"`

**C21** - A file changed on disk after `baseVersion` answers `409 edit_conflict` and keeps the bytes of that change (AC 32)
Proof: `npx vitest run tests/notesview.properties.test.ts -t "C21 "`

**C22** - `memory/ROUTER.md`, `memory/contexts/<id>.md` and a file of an indexed folder outside `memory/` answer `403 note_not_editable`; a note under `memory/` reached through a symbolic link answers `403 forbidden_path`; a deleted note `404 note_missing`; a note above the editing limit `413 note_too_large`; none is written (AC 33, Surface)
Proof: `npx vitest run tests/notesview.properties.test.ts -t "C22 "`

**C23** - `GET /api/memory/note` answers `200` with the three new fields, `400 validation` for an empty `p`, `403 forbidden_path` for a file under the home's `config/`, `404 note_missing` for a deleted note, and `413 note_too_large` above the limit (Surface, the changed route)
Proof: `npx vitest run tests/notesview.properties.test.ts -t "C23 "`

### S3 - pasta nova e estrutura fixa: core, API, CLI e MCP (plan S5) · 5 files · 85 KB · ~21k

**C24** - `POST /api/memory/notes` with `title: "Proposta"` and `folder: "clientes/acme"` answers `201` with `path` = `<home>/memory/notes/clientes/acme/proposta.md`, creating both folders (AC 42, door 2)
Proof: `npx vitest run tests/notesview.create.test.ts -t "C24 "`

**C25** - `folder` of 5 levels, `a//b`, `../x`, `..`, `!!!` (a segment that slugs to nothing) and `/etc` answer `400 validation`; a `folder` under `memory/notes/` that is a symbolic link answers `403 forbidden_path`; a `content` above the editing limit with a new `folder` answers `413 note_too_large`; in each case no file and no folder is created (AC 42, door 2)
Proof: `npx vitest run tests/notesview.create.test.ts -t "C25 "`
Proof: `npx vitest run tests/notesview.layer.test.ts -t "C25 own layer"`

**C26** - With `memory.notes.fixedStructure: true`, `POST /api/memory/notes` with a `folder` that does not exist, with an `area` whose folder does not exist, and with neither (directly in `memory/notes/`) answer `409 structure_fixed` and write nothing; with a `folder` that exists it answers `201` (AC 44, door 5, amendment 12)
Proof: `npx vitest run tests/notesview.create.test.ts -t "C26 "`
Proof: `npx vitest run tests/notesview.layer.test.ts -t "C26 own layer"`

**C27** - With `fixedStructure: true`, `mordomo note new "Solta"` prints `structure_fixed:` on stderr, exits 1 and writes nothing, and the MCP tool `note_create` with `title: "Solta"` answers an error naming `structure_fixed` and writes nothing (AC 44, door 5)
Proof: `npx vitest run tests/notesview.create.test.ts -t "C27 "`

**C28** - `settings.memory.notes.fixedStructure` reads `false` in a `settings.json` without it and in one where it is `"sim"`; `PUT /api/settings {memory:{notes:{fixedStructure:true}}}` stores `true` and keeps `memory.journalBudgetTokens`, `memory.agentStance` and `memory.embeddings` as they were (door 5, amendment 12)
Proof: `npx vitest run tests/notesview.create.test.ts -t "C28 "`

### S4 - a vista na tela: Grafo | Notas, contexto, raiz, índice e árvore (plan S1, S7) · 14 files · 125 KB · ~31k

**C29** - On `/brain` of the moldura the view row shows "Grafo" and "Notas" as two `.btn.sm` with `aria-pressed`; choosing "Notas" goes to `/brain/notes` and shows the notes view; choosing "Grafo" goes back to `/brain` with the selected node and the camera as they were; the Núcleo's brain scene shows the same two buttons and its "Notas" mode (AC 1)
Proof: `npm run test -w apps/command-centre -- src/brain/notes/NotesView.test.tsx -t "C29 "`
Proof: `MORDOMO_E2E_PORT=4901 npx playwright test --config tests/e2e/playwright.config.ts notes-view.spec.ts -g "C29 "`

**C30** - The command registry holds "Ver notas", "Ver grafo", "Definir como Home" and "Fechar aba"; the key `v` in the `view:brain` scope switches between the two views and does nothing while the focus is in a text field; the keyboard-listener allowlist does not grow (AC 1, amendment 13)
Proof: `npm run test -w apps/command-centre -- src/brain/notes/notesCommands.test.ts -t "C30 "`

**C31** - The top of the notes sidebar is a button with the `Crosshair` icon and the active context's name (with no context "Todo o cérebro"), read from `useWorkContext`; choosing it opens the menu of the shell's `ContextSelector` (`action:switch-context`); with the notes view mounted the registry holds `action:switch-context` once (AC 53, amendment 1)
Proof: `npm run test -w apps/command-centre -- src/brain/notes/NotesSidebar.test.tsx -t "C31 "`

**C32** - The root button shows the root's name ("Memória" for `memory/`), its path in mono 12px, and opens a `DropdownMenu` listing `roots` in the answer's order, each with name, path and the badge "Editável" or "Somente leitura" (and "Indexando" while `indexing`); choosing one asks the tree with `root=<path>`, and with a context active every tree request carries `context=<id>` (AC 2, AC 53, amendments 1 and 2)
Proof: `npm run test -w apps/command-centre -- src/brain/notes/NotesSidebar.test.tsx -t "C32 "`

**C33** - Switching the context in the shell's selector reloads the tree with the new context's `roots`, makes its first root the current root, and keeps the open tabs (AC 54)
Proof: `npm run test -w apps/command-centre -- src/brain/notes/NotesSidebar.test.tsx -t "C33 "`

**C34** - In a `role="status"` region the index line reads "Indexando 3 de 10" with the `Loader` icon from `index.progress`, "Indexado · <há quanto>" with `Check` after `index.finished`, "Indexação cancelada" with `Ban` after `index.cancelled`, and "Falhou" with `CircleAlert` after `index.failed`, the code translated in its `Tooltip` (AC 10)
Proof: `npm run test -w apps/command-centre -- src/brain/notes/NotesSidebar.test.tsx -t "C34 "`

**C35** - "Reindexar" calls `POST /api/memory/index`, and while the pass runs the same button reads "Cancelar" and calls `POST /api/memory/index/cancel` (AC 11)
Proof: `npm run test -w apps/command-centre -- src/brain/notes/NotesSidebar.test.tsx -t "C35 "`

**C36** - The tree is `role="tree"` with `treeitem`s carrying `aria-level` and, for folders, `aria-expanded`; ArrowDown and ArrowUp move the focus, ArrowRight opens a folder (asking the tree for its `dir`), ArrowLeft closes it, Enter on a file opens it in a tab; "Recolher tudo" leaves every folder `aria-expanded="false"` (AC 12)
Proof: `npm run test -w apps/command-centre -- src/brain/notes/NotesTree.test.tsx -t "C36 "`

**C37** - With no indexed row the tree shows "Nada indexado ainda." and "Reindexar"; while it loads, three skeleton rows and the hidden text "Carregando…"; when it fails, the message and "Tentar de novo" in a `role="alert"`, which asks again; an empty folder shows "Nenhuma nota nesta pasta." and, under `memory/`, "Nova nota" (AC 13, design.md "Estados")
Proof: `npm run test -w apps/command-centre -- src/brain/notes/NotesTree.test.tsx -t "C37 "`

**C38** - A folder answered with `truncated: true` and `omitted: 3` ends with the text "+3 não mostrados", with no action (AC 7, amendment 10)
Proof: `npm run test -w apps/command-centre -- src/brain/notes/NotesTree.test.tsx -t "C38 "`

**C39** - An entry with `editable: false` shows the `Lock` icon whose `Tooltip` and accessible name are "Pasta fora de memory/: somente leitura" for `outside_memory`, "Gerada pelo MordomoOS" for `generated`, and "Só notas .md se editam" for `not_markdown` (AC 8, amendment 9)
Proof: `npm run test -w apps/command-centre -- src/brain/notes/NotesTree.test.tsx -t "C39 "`

**C40** - Selecting a folder whose `indexNote` is set shows that note with the badge "Índice da pasta"; selecting one with `indexNote: null` lists its entries with title, type (`files[].type`) and updated date (AC 9, amendments 4 and 5)
Proof: `npm run test -w apps/command-centre -- src/brain/notes/NotesTree.test.tsx -t "C40 "`

**C41** - "Ordenar" opens a `DropdownMenu` with "Nome" and "Atualizado"; choosing "Atualizado" asks the tree with `sort=updated` and writes `brain.notes.sort: "updated"` (AC 3, door 4)
Proof: `npm run test -w apps/command-centre -- src/brain/notes/NotesTree.test.tsx -t "C41 "`

**C42** - At 1 440 × 900 the view lays out, left to right, the sidebar (260 px), the reading area and the note panel (280 px); dragging the sidebar's edge stops at 200 px and 400 px; at a useful width under 1 100 px the panel is closed; the note title computes to 24 px and no other text of the view is larger (design.md, "Tela - Vista de notas")
Proof: `MORDOMO_E2E_PORT=4901 npx playwright test --config tests/e2e/playwright.config.ts notes-view.spec.ts -g "C42 "`

### S5 - abas, Home, leitura e painel (plan S2, S7) · 8 files · 91 KB · ~23k

**C43** - Opening a note from the tree, the search, a link or the Home focuses its tab when it is open (no second tab) and otherwise opens a new tab right after the active one (AC 14)
Proof: `npm run test -w apps/command-centre -- src/brain/notes/NoteTabs.test.tsx -t "C43 "`

**C44** - With 12 tabs open a 13th closes the least recently focused tab with no unsaved changes; with all 12 unsaved it opens nothing and says "Feche uma aba para abrir outra."; an unsaved tab shows a dot and the hidden text "alterações não salvas" (AC 15, design.md "Abas")
Proof: `npm run test -w apps/command-centre -- src/brain/notes/NoteTabs.test.tsx -t "C44 "`

**C45** - Closing a tab with unsaved changes (its `X`, named "Fechar <título>", or the command "Fechar aba") opens a `Modal` "Descartar as alterações não salvas?" with "Continuar editando" focused; "Continuar editando" keeps the tab and its text, "Descartar" closes it (AC 16)
Proof: `npm run test -w apps/command-centre -- src/brain/notes/NoteTabs.test.tsx -t "C45 "`

**C46** - After a reload the view reopens the root, the tabs in their order, the active tab, the sort and the expanded folders from `UiPreferences.brain.notes` (written by `PUT /api/ui-preferences`), and a tab whose note was deleted shows "Esta nota não existe mais." with "Fechar aba" (AC 17, door 4)
Proof: `npm run test -w apps/command-centre -- src/brain/notes/NoteTabs.test.tsx -t "C46 "`
Proof: `MORDOMO_E2E_PORT=4901 npx playwright test --config tests/e2e/playwright.config.ts notes-view.spec.ts -g "C46 "`

**C47** - `UiPreferencesSchema` reads `brain.notes` with 13 tabs as its first 12 and with 501 expanded folders as the first 500; a field it cannot read (`sort: "size"`, `home: 3`) reads its default (`"name"`, `{}`) while the other `brain.notes` fields and every other `brain` field are kept (door 4)
Proof: `npx vitest run tests/notesview.layer.test.ts -t "C47 own layer"`

**C48** - "Definir como Home" (the "Mais" menu or the command) makes the note the Home of the current root, shown at the top of the sidebar with the `Home` icon and its title; with no tab open the reading area shows the Home; the Home of one root is not the Home of another (AC 18)
Proof: `npm run test -w apps/command-centre -- src/brain/notes/NoteTabs.test.tsx -t "C48 "`

**C49** - With no Home for the current root the sidebar shows "Definir uma Home", and with no tab open and no Home the reading area shows "Abra uma nota na árvore ou defina uma Home." (AC 19)
Proof: `npm run test -w apps/command-centre -- src/brain/notes/NoteTabs.test.tsx -t "C49 "`

**C50** - The body is drawn by `components/Markdown.tsx` in shape `panel` from `bodyStart` on (no front-matter line is drawn), a pipe table becomes a `<table>`, and no file of the notes view holds `dangerouslySetInnerHTML`; while the note loads a spinner with "Carregando…"; a failed read shows its message and "Tentar de novo" in a `role="alert"` (AC 20, design.md "Estados")
Proof: `npm run test -w apps/command-centre -- src/brain/notes/NoteReader.test.tsx -t "C50 "`

**C51** - `[[Planejamento]]`, `[[planejamento|o plano]]` and `[o plano](./planejamento.md)` are buttons that open, in a tab, the note `outgoing[].resolved` of `GET /api/memory/links` names for that link; a link whose `resolved` is `null` is text with the `Unlink` icon and the `Tooltip` "Nenhuma nota com este nome" (AC 21, amendment 7)
Proof: `npm run test -w apps/command-centre -- src/brain/notes/NoteReader.test.tsx -t "C51 "`

**C52** - The panel shows, in this order, "Backlinks" and "Links quebrados" (`LinksSection`), "Relacionadas" from `GET /api/memory/related` with each `why` at 12px, and "Nesta nota" with the note's `##` headings (choosing one scrolls to it); each section has its own spinner and its own error with "Tentar de novo" (AC 22, amendment 7)
Proof: `npm run test -w apps/command-centre -- src/brain/notes/NotePanel.test.tsx -t "C52 "`

**C53** - "Ver no grafo" switches to the graph with that note selected, `local` on and 1 hop (AC 23)
Proof: `npm run test -w apps/command-centre -- src/brain/notes/NoteReader.test.tsx -t "C53 "`

**C54** - "Exportar Markdown" downloads `<nome>.md` whose bytes equal the note's bytes on disk; "Abrir no editor do sistema" calls `POST /api/memory/open` with `p` = the note's path; "Copiar caminho" puts the path on the clipboard (AC 24, design.md "Cabeçalho da nota")
Proof: `npm run test -w apps/command-centre -- src/brain/notes/NoteReader.test.tsx -t "C54 "`
Proof: `MORDOMO_E2E_PORT=4901 npx playwright test --config tests/e2e/playwright.config.ts notes-view.spec.ts -g "C54 "`

**C55** - `> [!fato]`, `> [!opiniao]`, `> [!plano]`, `> [!hipotese]` and `> [!relato]` are drawn as a box with the icon (`CheckCircle2`, `MessageCircle`, `Map`, `FlaskConical`, `BookOpen`) and the label "Fato", "Opinião", "Plano", "Hipótese", "Relato" as 12px text above the content; `> [!x]` is drawn as a plain quote (AC 57)
Proof: `npm run test -w apps/command-centre -- src/brain/notes/NoteReader.test.tsx -t "C55 "`

### S6 - propriedades e edição no lugar, na tela (plan S3, S4, S7) · 7 files · 88 KB · ~22k

**C56** - The properties table, right below the note header, shows each key with the icon of its kind (`Text`, `Tag`, `Calendar`, `CircleDot`, `ListChecks`, `Repeat`) and its value as text, tag chips each with a remove `X`, a date field, a `<select>` for `status` (the five values), for `natureza` (Fato, Opinião, Plano, Hipótese, Relato) and for `escopo` (Pessoal, Equipe, Externo), and a field for `review_every` with the suggestions `7d`, `30d`, `90d`, `180d`, `365d`, `never`; a `date` value that is not `AAAA-MM-DD` is shown as text; `otherProperties` appears in mono under "Outras propriedades (somente leitura)"; a note with no header shows only "+ Adicionar propriedade" (AC 26, AC 56, amendment 6)
Proof: `npm run test -w apps/command-centre -- src/brain/notes/PropertiesTable.test.tsx -t "C56 "`

**C57** - Editing a value and pressing Enter, or leaving the field, sends `PUT /api/memory/notes/properties` with that key in `set` and the note's `version` as `baseVersion`; Esc restores the value and sends nothing (AC 34)
Proof: `npm run test -w apps/command-centre -- src/brain/notes/PropertiesTable.test.tsx -t "C57 "`

**C58** - Typing `30` in `review_every` shows "Use um número de dias, como 30d, ou never." under the field and sends nothing; `30d` and `never` are sent (AC 56)
Proof: `npm run test -w apps/command-centre -- src/brain/notes/PropertiesTable.test.tsx -t "C58 "`

**C59** - A `409 edit_conflict` from the property route shows over the table the conflict banner of `cerebro-v2` ("Esta nota mudou no disco depois que você a abriu.", "Carregar a versão do disco", "Salvar como cópia") (AC 32)
Proof: `npm run test -w apps/command-centre -- src/brain/notes/PropertiesTable.test.tsx -t "C59 "`

**C60** - For a note with `editable: false` the table has no field to edit, no row menu and no "+ Adicionar propriedade" (AC 33)
Proof: `npm run test -w apps/command-centre -- src/brain/notes/PropertiesTable.test.tsx -t "C60 "`

**C61** - While the body has unsaved changes in the editor the table is read-only and shows "Salve o texto para editar as propriedades." (AC 35)
Proof: `npm run test -w apps/command-centre -- src/brain/notes/PropertiesTable.test.tsx -t "C61 "`

**C62** - "+ Adicionar propriedade" asks the key and the kind, the kind preselected for a known key (`status` → status, `due` → date, `tags` → list, `review_every` → interval), and sends nothing until a value is given (AC 36)
Proof: `npm run test -w apps/command-centre -- src/brain/notes/PropertiesTable.test.tsx -t "C62 "`

**C63** - "Remover" in a row's `DropdownMenu` sends `remove: [<key>]` with no confirmation (Assumptions, "Remover propriedade")
Proof: `npm run test -w apps/command-centre -- src/brain/notes/PropertiesTable.test.tsx -t "C63 "`

**C64** - "Editar" on an editable note turns the reading area into the `cerebro-v2` editor in place (the `textarea` in mono 13px, the `role="status"` line reading, by state, "Salvo", "Alterações não salvas", "Salvando…", "Conflito", "Erro ao salvar", each with its icon, "Salvar", ⌘S / Ctrl+S) with the side panel still visible and no `role="dialog"` open; "Ler" turns it back (AC 37)
Proof: `npm run test -w apps/command-centre -- src/brain/notes/NoteEditInPlace.test.tsx -t "C64 "`

**C65** - Typing `[[pla` shows a `listbox` of at most 8 notes whose title or name contains `pla` accent-folded (it lists "Planejamento" and "Plâncton"); Enter inserts `[[Planejamento]]` and closes it; Esc closes it with nothing inserted (AC 38)
Proof: `npm run test -w apps/command-centre -- src/brain/notes/NoteEditInPlace.test.tsx -t "C65 "`

**C66** - After a save succeeds the tab loses its unsaved mark, the reading body and the panel show the saved text, and the tree shows the new title after the next `index.finished` (AC 39)
Proof: `npm run test -w apps/command-centre -- src/brain/notes/NoteEditInPlace.test.tsx -t "C66 "`

**C67** - A note with `editable: false` shows in its header the badge "Somente leitura" with its reason and no "Editar" (AC 40)
Proof: `npm run test -w apps/command-centre -- src/brain/notes/NoteEditInPlace.test.tsx -t "C67 "`

### S7 - criar nota e pasta na tela (plan S5) · 2 files · 29 KB · ~7k

**C68** - "Nova nota" with `memory/notes/clientes` selected opens the create `Modal` of `cerebro-v2` with the field "Pasta" read-only showing `clientes` and "Trocar"; "Criar" sends `POST /api/memory/notes` with `folder: "clientes"` and opens the new note in a tab in edit mode (AC 41)
Proof: `npm run test -w apps/command-centre -- src/brain/notes/NoteCreate.test.tsx -t "C68 "`

**C69** - "Nova pasta" opens a 420px `Modal` with "Nome da pasta" and "Título da primeira nota"; "Criar" is disabled until both have text, and sends `POST /api/memory/notes` with that title and `folder` = the selected folder plus the new name (AC 43)
Proof: `npm run test -w apps/command-centre -- src/brain/notes/NoteCreate.test.tsx -t "C69 "`

**C70** - With `memory.notes.fixedStructure: true`, "Nova pasta" at the top of `memory/notes` and "Nova nota" with no folder selected are disabled with the `Tooltip` "Estrutura fixa: crie dentro de uma pasta existente"; "Nova nota" with a folder selected is enabled (AC 45)
Proof: `npm run test -w apps/command-centre -- src/brain/notes/NoteCreate.test.tsx -t "C70 "`

**C71** - "Nova nota" and "Nova pasta" are rendered with the root `memory/` and absent with an indexed folder or a context path outside `memory/` as the root (AC 46)
Proof: `npm run test -w apps/command-centre -- src/brain/notes/NoteCreate.test.tsx -t "C71 "`

### S8 - uma só camada de dados (plan S6) · 7 files · 121 KB · ~30k

**C72** - `views/SecondBrain.tsx`, `nucleo/scenes/BrainScene.tsx` and every file of the notes view hold none of `/api/memory/graph`, `/api/memory/search`, `/api/memory/related` (nor their `GET …` route names), and each of the three imports the graph, the search and the related files from one module of `apps/command-centre/src/brain/`, which holds those three (AC 47, amendment 8)
Proof: `npm run test -w apps/command-centre -- src/brain/memoryData.test.ts -t "C72 "`

**C73** - A failed search in the notes view, and a failed related request in the notes view and in the Núcleo's brain scene, show the error and "Tentar de novo" and drop the earlier hits; "Tentar de novo" asks again (AC 48, amendment 8)
Proof: `npm run test -w apps/command-centre -- src/brain/memoryData.test.ts -t "C73 "`

**C74** - With a context active the related request of the notes view and of the brain scene carries `context=<id>`, as the search and the graph do; with none it carries no `context` (AC 47, amendments 1 and 8)
Proof: `npm run test -w apps/command-centre -- src/brain/memoryData.test.ts -t "C74 "`

### Cross-cutting

**C75** - `GET /api/memory/tree` (scope `content`) and `PUT /api/memory/notes/properties` (scope `owner`) are in the `API` table with their schemas and errors, in the OpenAPI document (which validates), in `EXPECTED_ROUTE_SCOPES`, in their row of `docs/security.md`, and each has a scenario of the refusal probe that reaches it; `memory.note` declares `properties`, `otherProperties`, `bodyStart`, and `memory.notes.create` declares `folder` and `409 structure_fixed` (AC 49)
Proof: `npx vitest run tests/notesview.contract.test.ts -t "C75 "`
Proof: `npx vitest run tests/api.openapi.test.ts -t "C16 the document validates"`

**C76** - A device token holding `content` gets `200` from `GET /api/memory/tree` and one holding only `monitor` gets `403`; a device token with every scope gets `403 owner_only` from `PUT /api/memory/notes/properties` and the file is unchanged (AC 49)
Proof: `npx vitest run tests/notesview.contract.test.ts -t "C76 "`

**C77** - In the light and the dark theme and in the moldura and the Núcleo, the notes view (sidebar, tabs, properties, body with a callout, panel) has no text under 12px and its sentences at 13px, marks every state with an icon and text, and axe at WCAG A/AA reports no `serious` or `critical` violation on the whole page; the CSS lint (tokens only) exits 0 (AC 50)
Proof: `MORDOMO_E2E_PORT=4901 npx playwright test --config tests/e2e/playwright.config.ts notes-view.spec.ts -g "C77 "`
Proof: `npx stylelint --config stylelint.config.mjs "apps/command-centre/src/brain/notes/*.css"`

**C78** - The component gallery has a notes-view entry (tree, tabs, properties table, callouts), and in both themes it has no `serious` or `critical` axe violation (AC 50)
Proof: `MORDOMO_E2E_PORT=4901 npx playwright test --config tests/e2e/playwright.config.ts notes-view.spec.ts -g "C78 "`

**C79** - The notes view is reached from the entry only by a dynamic `import()`; `scripts/bundle-baseline.json` gains a `cerebro-vista-notas` entry after `cerebro-contextos` with a reason of more than 40 characters and the four numbers, at most 24 KB of JS gzip and 4.5 KB of CSS gzip above `cerebro-contextos`; `bundle:check` exits 0 (AC 51, amendments 14 and 15)
Proof: `npx vitest run tests/notesview.contract.test.ts -t "C79 "`
Proof: `npm run bundle:check`

**C80** - The raw `fs` allowlist and the module-state list do not grow: the tree reads rows and the properties read and write through `openWorkspaceFile` and `writeWorkspaceFile` (AC 52)
Proof: `npx vitest run tests/security-reads.test.ts -t "C55 the list holds 70 rows"`
Proof: `npx vitest run tests/security-reads.test.ts -t "C32 every raw fs read in core/src and apps/api/src is on the reviewed list finds nothing outside the list"`
Proof: `npx vitest run tests/sdk.instances.test.ts -t "C30 the module-level mutable state"`

**C81** - Every row of design.md's "Texto" table (32 rows, plus the amendment's row) is a key in `en` and `ptBR` of `locales/brain.ts` with that text, and both locales hold the same keys (design.md, "Texto")
Proof: `npm run test -w apps/command-centre -- src/brain/notes/notesCopy.test.ts -t "C81 "`

## Coverage

| Set (size)                                                   | Member -> proof                                                                                                                                                                                                                                                                                    | Unproven |
| ------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| `GET /api/memory/tree` statuses (3)                          | 200 C1, C2 · 400 C5, C11 · 404 C5, C11                                                                                                                                                                                                                                                             | -        |
| `PUT /api/memory/notes/properties` statuses (6)              | 200 C16 · 400 C19 · 403 C22 · 404 C22 · 409 C20, C21 · 413 C22                                                                                                                                                                                                                                     | -        |
| `GET /api/memory/note` (muda) statuses (5)                   | 200 C13 · 400 C23 · 403 C23 · 404 C23 · 413 C23                                                                                                                                                                                                                                                    | -        |
| `POST /api/memory/notes` (muda) statuses (5)                 | 201 C24 · 400 C25 · 403 C25 · 409 C26 · 413 C25                                                                                                                                                                                                                                                    | -        |
| error codes this feature answers (11)                        | `unknown_root` C5, C11 · `not_found` C5 · `context_not_found` C11 · `validation` C19, C25 · `note_not_editable` C22 · `forbidden_path` C22, C23, C25 · `note_missing` C22, C23 · `edit_conflict` C21 · `front_matter_unreadable` C20 · `note_too_large` C22, C23, C25 · `structure_fixed` C26, C27 | -        |
| doors of Landing (5)                                         | 1 C1, C2, C5, C6, C8, C10 · 2 C13, C16, C24, C75 · 3 C14, C17, C18, C19, C20 · 4 C46, C47 · 5 C26, C27, C28                                                                                                                                                                                        | -        |
| stored shapes, Relations is None (2 documents)               | `UiPreferences.brain.notes` C46, C47 · `settings.memory.notes.fixedStructure` C28                                                                                                                                                                                                                  | -        |
| root kinds (4)                                               | `memory/` C1 · enabled indexed folder C1, C5 · context `ok` path C10 · context notes folder C10                                                                                                                                                                                                    | -        |
| reason codes (3)                                             | `outside_memory` C7, C39 · `generated` C7, C39 · `not_markdown` C7, C39                                                                                                                                                                                                                            | -        |
| generated places (4)                                         | `ROUTER.md` C7 · `areas/` C7 · `journal/` C7 · `contexts/` C7                                                                                                                                                                                                                                      | -        |
| index-note names in precedence (5)                           | `_index.md` C8 · `index.md` C8 · `README.md` C8 · `CLAUDE.md` C8 · `AGENTS.md` C8                                                                                                                                                                                                                  | -        |
| tree orders (2)                                              | `name` C2 · `updated` C2, C41                                                                                                                                                                                                                                                                      | -        |
| rows refused by today's policy (3)                           | user exclude C4 · secret name C4 · home `config/` C4                                                                                                                                                                                                                                               | -        |
| property kinds (7)                                           | `text` C14 · `list` C14 · `date` C14 · `status` C14 · `select` C14, C56 · `interval` C14, C56, C58 · other lines C15                                                                                                                                                                               | -        |
| property writes (4)                                          | change C16 · add C17 · new header C17 · remove C18                                                                                                                                                                                                                                                 | -        |
| property refusals (10)                                       | date C19 · status C19 · text line break C19 · text length C19 · list length C19 · tag C19 · key C19 · `natureza` C19 · `escopo` C19 · `review_every` C19                                                                                                                                           | -        |
| `folder` refusals (6)                                        | 5 levels C25 · empty level C25 · `..` C25 · slug to nothing C25 · absolute C25 · link on the way C25                                                                                                                                                                                               | -        |
| fixed-structure cases (4)                                    | new `folder` C26 · `area` without folder C26 · directly in `memory/notes/` C26 · existing folder accepted C26                                                                                                                                                                                      | -        |
| entry points of door 5 (3)                                   | API C26 · CLI C27 · MCP `note_create` C27                                                                                                                                                                                                                                                          | -        |
| startup config: `memory.notes.fixedStructure` (2 assemblies) | the service (`AppContext`, behind the API and the MCP) C26, C27 · the CLI (`mordomo note new`) C27                                                                                                                                                                                                 | -        |
| shells (2)                                                   | moldura C29, C42, C77 · Núcleo C29, C77                                                                                                                                                                                                                                                            | -        |
| themes (2)                                                   | light C77, C78 · dark C77, C78                                                                                                                                                                                                                                                                     | -        |
| index states (4)                                             | running C34 · finished C34 · cancelled C34 · failed C34                                                                                                                                                                                                                                            | -        |
| tree states (5)                                              | nothing indexed C37 · loading C37 · error C37 · empty folder C37 · truncated C38                                                                                                                                                                                                                   | -        |
| reading-area states (5)                                      | loading C50 · error C50 · note gone C46 · Home C48 · no tab and no Home C49                                                                                                                                                                                                                        | -        |
| panel sections (4)                                           | Backlinks C52 · Links quebrados C52 · Relacionadas C52 · Nesta nota C52                                                                                                                                                                                                                            | -        |
| editor states (5)                                            | Salvo C64 · Alterações não salvas C64 · Salvando… C64 · Conflito C64, C59 · Erro ao salvar C64                                                                                                                                                                                                     | -        |
| property-table states (4)                                    | editable C57 · not editable C60 · body unsaved C61 · conflict C59                                                                                                                                                                                                                                  | -        |
| callouts (6)                                                 | `fato` C55 · `opiniao` C55 · `plano` C55 · `hipotese` C55 · `relato` C55 · unknown C55                                                                                                                                                                                                             | -        |
| link forms (4)                                               | `[[alvo]]` C51 · aliased wikilink (alvo, texto) C51 · relative link C51 · unresolved C51                                                                                                                                                                                                           | -        |
| ways to open a note (4)                                      | tree C43, C36 · search C43 · link C43, C51 · Home C43, C48                                                                                                                                                                                                                                         | -        |
| tab rules (5)                                                | focus the open one C43 · open after the active C43 · 13th closes the least recent C44 · 12 unsaved refuse C44 · closing unsaved asks C45                                                                                                                                                           | -        |
| "Mais" menu (4)                                              | Definir como Home C48 · Exportar Markdown C54 · Abrir no editor do sistema C54 · Copiar caminho C54                                                                                                                                                                                                | -        |
| commands and key (5)                                         | "Ver notas" C30 · "Ver grafo" C30 · "Definir como Home" C30, C48 · "Fechar aba" C30, C45 · `v` C30                                                                                                                                                                                                 | -        |
| creation controls (4)                                        | Nova nota C68 · Nova pasta C69 · fixed structure disabled C70 · only with root `memory/` C71                                                                                                                                                                                                       | -        |
| screens on the one data module (3)                           | `SecondBrain.tsx` C72 · `BrainScene.tsx` C72, C73, C74 · notes view C72, C73, C74                                                                                                                                                                                                                  | -        |
| arrangements design.md draws (4)                             | three columns with their widths C42 · panel closed under 1 100 px C42 · title 24 px the largest C42 · properties right below the header C56                                                                                                                                                        | -        |
| design.md copy (33 rows)                                     | C81, table-driven over all 33                                                                                                                                                                                                                                                                      | -        |

- Claims naming a status code, route or response shape: C1-C13, C15-C28, C75, C76 - each proven through `app.inject`
  against `buildServer` (C27 through the built CLI and the MCP tools over real HTTP); C2, C4, C7, C8, C14, C16-C20, C25,
  C26, C47 also at their own layer, with no HTTP
- Claims about the screens: C29-C41, C43-C74, C81 in rendered components; C29, C42, C46, C54, C77, C78 also in a real
  browser, both shells where the claim names them

## Binding sources

| Source                                                                   | Checked by                        |
| ------------------------------------------------------------------------ | --------------------------------- |
| `cerebro-vista-notas/design.md` (the view, its states, copy, amendments) | C29, C31-C46, C48-C71, C81        |
| `design-system/design.md` (12px floor, 13px text, tokens, axe)           | C77, C78                          |
| `primitivas/design.md` (`Tabs`, `DropdownMenu`, `Modal`, `Tooltip`)      | C32, C39, C41, C43, C45, C63, C69 |
| `comandos-atalhos/design.md` (registry, `v`, ⌘S)                         | C30, C64                          |
| `moldura-app/design.md` Tela 1 (the `main` of `/brain`)                  | C29, C42                          |
| `limpeza-legado/design.md` (one Markdown renderer)                       | C50                               |
| `cerebro-v2/design.md` (editor states, conflict, links section)          | C52, C59, C64                     |
| `cerebro-contextos/design.md` (the selector)                             | C31, C33                          |

## Test policy

| Code                                                                                                                | Required proofs                                       | Coverage expectation                                                                           |
| ------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| Decides, reached across a boundary (`memoryTree`, `parseProperties`/`setProperties`, the `folder` and door 5 rules) | one at the HTTP boundary **and** one at its own layer | the contract at the boundary; one asserted case per row of the decision table at its own layer |
| Decides, not reached across a boundary (the `brain.notes` schema caps)                                              | one at its own layer                                  | one asserted case per row                                                                      |
| Screens (tabs, properties table, tree keyboard, editor in place)                                                    | one in rendered components per screen and state       | each state and copy design.md names; both themes and both shells for axe in the browser        |

Evidence:

- `core/src/memory/tree.ts` (new): root validation (memory, indexed, context, other), order over 2 sorts, folders first,
  the 1 000 cap, the policy filter, a reason over 3 codes and the index note over 5 names -> decides, ~14 branch points
- `frontMatter.ts` properties (new): kind dispatch over 7 rows, value validation over 10 refusals, 4 write operations and
  the unreadable header -> decides
- `notes.ts` `createNote` with `folder` and `fixedStructure`: 6 refusals and 4 structure cases -> decides
- own layer: `tests/notesview.layer.test.ts` calls those functions with no HTTP, as `tests/contexts.layer.test.ts` and
  `tests/organize.layer.test.ts` do for the same shape of code
- closest analogue: `tests/memory.notes.test.ts` (`cerebro-v2` S1), the note rules proven at the boundary and in the core

## Swept

- validation: C5, C19, C25, C58
- failure modes: C20 (unreadable header), C37 (the tree fails), C46 (a tab's note is gone), C50, C52 (each section fails alone), C73
- idempotency: C16 (the same write twice changes no byte), C43 (opening an open note focuses it)
- authorization: C76 (`content` for the tree, owner only for properties), C22 (not editable, a link on the way), C4 (today's policy), C11 (a context's roots only)
- concurrency: C21 and C59 (`baseVersion` and `409 edit_conflict`, checked on the descriptor by `writeWorkspaceFile`)
- data lifecycle: C17 (a header is created only when a property is written), C46, C47 (caps cut on read), C8 (an index note counts after its pass)
- dependency failure: C34 (the index pass fails), C37, C73 (the search or the related request fails)
- state transitions: C34 (index states), C64 (editor states), C45 (closing unsaved), C61 (the table locks while the body is unsaved)
- observability: n/a - no new log or event; a property write requests an index pass (C16), whose `index.*` events already exist

## Handoff

The estimate exceeds the 150k budget, so the build stops here for the mechanism choice (`build.md`).

- Arithmetic (`wc -c` of the files each slice touches, / 4; new files estimated):
  - S1: `core/src/memory/maps.ts` 10 018, `contexts.ts` 15 924, `indexer.ts` 41 534 (its `rowFilter`, read in parts),
    `apps/api/src/routes/memory.ts` 14 168, `routes/contexts.ts` 3 623, `contracts/src/api/memory.ts` 23 905,
    `core/src/internal.ts` 14 846, the new `tree.ts` ≈ 10 000 = ≈ 134 KB → ≈ 34k
  - S2: `frontMatter.ts` 3 541 plus ≈ 12 000 new, `notes.ts` 14 511, `security/safeWrite.ts` 19 679 = ≈ 50 KB → ≈ 12k
  - S3: `contracts/src/settings.ts` 19 645, `cmdNote` of `apps/api/src/cli.ts` ≈ 6 000 (of 71 171), `mcp/mordomo.ts` 10 214,
    `tests/fixtures/events/v1/settings.changed.json` 4 219, `tests/data.settings.test.ts` 44 810 (the C46 leaves) = ≈ 85 KB
    → ≈ 21k
  - S4: the new view, sidebar, tree and `notes.css` ≈ 36 000, `IndexProgress.tsx` 1 971, `desktop/apps.tsx` 5 098,
    `nucleo/scenes.ts` 3 974, `locales/brain.ts` 12 538, `queries.ts` 8 868, `brain/state.ts` 9 054, `useBrainState.ts`
    12 013, `ContextSelector.tsx` 6 635, `commands/registry.ts` 12 630, `commands/global.ts` 11 458, `ui/Menu.tsx` 4 818 =
    ≈ 125 KB → ≈ 31k (the two screens counted in S8)
  - S5: the new tabs, reader and panel ≈ 25 000, `components/Markdown.tsx` 10 691, `brain/markdown.ts` 11 612,
    `LinksSection.tsx` 3 240, `contracts/src/preferences.ts` 5 492, `contracts/src/settings.ts` 19 645
    (`BrainSettingsSchema`), `PreviewPanel.tsx` 9 292, `ui/Tabs.tsx` 5 875 = ≈ 91 KB → ≈ 23k
  - S6: the new properties table ≈ 15 000 and `[[` list ≈ 6 000, `NoteEditor.tsx` 14 343, `noteEditor.css` 2 713,
    `NoteEditorHost.tsx` 954, the view again ≈ 36 000, `locales/brain.ts` 12 538 = ≈ 88 KB → ≈ 22k
  - S7: the new folder dialog ≈ 5 000, `contracts/src/api/memory.ts` 23 905 = ≈ 29 KB → ≈ 7k
  - S8: `useBrainSearch.ts` 1 723, `contexts/useWorkContext.ts` 2 897, the new data module ≈ 4 000, `views/SecondBrain.tsx`
    29 326, `nucleo/scenes/BrainScene.tsx` 70 284 (read in parts), `contexts/NewContextDialog.tsx` 11 627,
    `RequestFailed.tsx` 835 = ≈ 121 KB → ≈ 30k
  - cross-cutting, API (C75, C76, C80): `tests/helpers/routeScopes.ts` 8 241, `tests/helpers/contractWorld.ts` 34 788,
    `docs/security.md` 66 501 (read in parts) = ≈ 110 KB → ≈ 27k
  - cross-cutting, screens (C77-C79, C81): `gallery/main.tsx` 28 251, `gallery.css` 2 447, `scripts/bundle-baseline.json`
    3 074, `tests/e2e/a11y.spec.ts` 17 550, `tests/e2e/shell.ts` 11 753, `tests/e2e/contexts.spec.ts` 16 797 (the model),
    `tests/bundle-size.test.ts` 10 659 = ≈ 91 KB → ≈ 23k
  - slices alone ≈ 34k + 12k + 21k + 31k + 23k + 22k + 7k + 30k + 27k + 23k = ≈ 230k; the new tests (five root files
    ≈ 105 KB, twelve UI files ≈ 130 KB, `tests/e2e/notes-view.spec.ts` ≈ 28 KB, the UI test kits read ≈ 8 KB: ≈ 271 KB)
    add ≈ 68k: ≈ 298k in all, over 150k
- Proposed cut, at the surface boundaries (batches sequential, each only on green):
  - **A** (core and API: tree, properties, folders and fixed structure, their pins): S1 + S2 + S3 + C75, C76, C80 ≈ 34k +
    12k + 21k + 27k = ≈ 94k, plus the five root test files ≈ 105 KB → ≈ 26k = ≈ 120k; C1-C28, C75, C76, C80
  - **B** (the screens' data layer, then the view, the tree, the tabs and the reading): S8 + S4 + S5 ≈ 30k + 31k + 23k =
    ≈ 84k, plus their tests (`memoryData`, `NotesView`, `notesCommands`, `NotesSidebar`, `NotesTree`, `NoteTabs`,
    `NoteReader`, `NotePanel`, the e2e of C29, C42, C46, C54, the kits) ≈ 92 KB → ≈ 23k = ≈ 107k; C29-C55, C72-C74
  - **C** (properties and editing on screen, creation, and the screens' cross-cutting checks): S6 + S7 + C77-C79, C81 ≈
    22k + 7k + 23k = ≈ 52k, plus their tests (`PropertiesTable`, `NoteEditInPlace`, `NoteCreate`, `notesCopy`, the e2e of
    C77, C78) ≈ 74 KB → ≈ 19k = ≈ 71k; C56-C71, C77-C79, C81
  - B + C together ≈ 178k is over the budget, so the three stay apart; A must land first because B and C call its routes
- Mechanism: handoff (the owner chose it on 2026-10-30: three batches A, B, C, sequential, each only on green)

Status of batch A (updated in the commit that closes each piece):

- a new note's folder and the fixed structure through the API, the CLI and the MCP (S3: C24-C28): closed, every proof
  green in `tests/notesview.create.test.ts` and `tests/notesview.layer.test.ts`
- the tree (S1: C1-C12), the properties (S2: C13-C23) and the two routes in the contract, its scopes and its readers
  (C75, C76, C80): closed, every proof green in `tests/notesview.tree.test.ts`, `tests/notesview.properties.test.ts`,
  `tests/notesview.layer.test.ts`, `tests/notesview.contract.test.ts`, `tests/api.openapi.test.ts`,
  `tests/security-reads.test.ts` and `tests/sdk.instances.test.ts`; with it batch A is closed (C1-C28, C75, C76, C80)

- **Boundary (batch A):** C1-C28, C75, C76 and C80 closed. S3 (C24-C28) at `91e177e`; S1 (C1-C12), S2 (C13-C23),
  C75, C76 and C80 at `03e578c`, which closes the batch. On the tree of `03e578c`: `npm run build`, `npm run typecheck`
  and `npm run lint` exit 0, `npx vitest run` at the root is green (141 files, 1851 tests, 1 skipped) and
  `npm run test -w apps/command-centre` too (141 files, 1128 tests); each of the 45 `Proof:` lines of the batch passes
  and runs only its check's test. S4-S8 and C77-C79, C81 are untouched (batches B and C): no screen, no data module, no
  `brain.notes` preference (C47's own-layer proof is batch B's to add to `tests/notesview.layer.test.ts`), no gallery
  entry and no bundle baseline.
- **Settled mid-build:** nothing by the owner. Builder decisions inside the approved shape: (a) Landing rows 6 (`root`
  is `null` only when a context has no root, with `roots: []`), 7 (`area` with `folder` is `400 validation`) and 8 (the
  details of the property writer: a value set to what it holds keeps its line, a block list stays a block list, the
  quoting rule of a text, a trailing ` # comment` of an unquoted value is not part of it, a repeated key's later lines
  are other properties, a key in both `set` and `remove` is `400`, an unreadable header reads as none on `GET`), each in
  the commit of its code; Flow hop 3 names `saveProperties` in `notes.ts`, which checks and writes around
  `setProperties`; (b) for batch B: `files[]`/`folders[]` carry `reason` only when `editable` is false; `roots[].name`
  is the folder's base name (the screen says "Memória"); `rel` is relative to the root with `/`, and a folder's `rel`
  is what `dir` takes back; the rows of a context's notes folder are the context's; the tree reads the rows of every
  index root that holds the folder by real path (so a context path inside an indexed folder, and a root nested in the
  folder, both list); the `_index.md` of a user folder is found under the longest enabled indexed folder holding it;
  `GET /api/memory/tree` is not a read of a run's credential (`403`); (c) the properties route also declares `404
not_a_file` (the safe reader's answer for a path that is not a regular file); its body caps each value at 4 000
  characters and 1 000 entries in the contract (the core's 500 and 20 decide `400 validation`), because a bound equal to
  a `RUN_LIMITS` number fails sdk C68; (d) pins moved the way the repo moves them: 139 routes, 70 owner and 27 content
  routes (with their amendments in `sdk.api-thin`), 69 raised pairs, `memoryTree` and `saveProperties` in the internal
  barrel, `CEREBRO_V2_ROUTES` (the create route declares `409 structure_fixed`), the `named` list of api.contract C53
  (the properties route names the note codes), the v1 `settings.changed` fixture and the settings leaf of
  data.settings C46; (e) `tests/helpers/notesViewWorld.ts` is the shared world (a real home, a server, indexed folders
  outside the home, `row()` for stale rows, `device()`); C12 runs a real pass over 3 000 notes and reads the tree
  between two `running` statuses.
- **Abandoned:** a `folder` argument for the MCP `note_create` and `--folder` for `mordomo note new` (no check asks for
  them; with the structure fixed both still create inside an existing area folder); a YAML parser (door 3's rejected
  alternative); answering the tree from `folderDigests` (amendment 3: it reads `_index.md` from disk and has no files).

Status of batch B (updated in the commit that closes each piece):

- the notes view's preferences, `UiPreferences.brain.notes` with its caps on read (door 4: C47): closed, the proof green
  in `tests/notesview.layer.test.ts`
- the notes sidebar and its tree (S4: C31-C41): closed, every proof green in
  `apps/command-centre/src/brain/notes/NotesSidebar.test.tsx` and `NotesTree.test.tsx`
- the tabs, the Home, the reader and the panel (S5): C43-C45, C47-C53 and C55 closed, every proof green in
  `apps/command-centre/src/brain/notes/NoteTabs.test.tsx`, `NoteReader.test.tsx` and `NotePanel.test.tsx`; C46 and
  C54 have their unit proofs green there, and close with their browser proofs
- one data layer for the three screens (S8: C72-C74): closed, every proof green in
  `apps/command-centre/src/brain/memoryData.test.ts`; "Grafo | Notas" and its commands and key (C30) closed in
  `notesCommands.test.ts`; C29 has its unit proof green in `NotesView.test.tsx` and closes with its browser proof
- in a real browser (C29, C42, C46, C54): closed, every proof green in `tests/e2e/notes-view.spec.ts`; with it S4
  (C29-C42) and S5 (C43-C55) are closed

- **Boundary (batch B):** C29-C55 and C72-C74 closed. The data module at `298493b`, door 4 (C47) at `ed5759f`, the
  view with its sidebar and tree (C31-C41) at `12967c6`, the tabs, Home, reader and panel (C43-C45, C47-C53, C55) at
  `89caace`, S8 with C29 and C30 at `ee9ab4b`, the browser proofs (C29, C42, C46, C54) at `8a485ad`, and the sidebar's
  fold with the kept-true Flow and Impact and the batch-B bundle entry at `5a4c94c`, which closes the batch. On the tree
  of `5a4c94c`: `npm run build`, `npm run typecheck`, `npm run lint` and `npm run bundle:check` exit 0; `npx vitest run`
  at the root is green (141 files, 1852 tests, 1 skipped) and `npm run test -w apps/command-centre` too (149 files,
  1170 tests); each of the 78 non-browser `Proof:` lines of batches A and B passes and runs only its check's tests, and
  `tests/e2e/notes-view.spec.ts`, `a11y.spec.ts`, `contexts.spec.ts` and `brain-errors.spec.ts` pass (84 tests; two
  light-theme cases of a11y C29 failed once on a gallery hint's timing and a service banner over a button, and pass
  alone and in the next full run). S6, S7 and C77-C79, C81 are untouched: no properties table, no editor in place, no
  create controls in the tree's heading (the empty folder's "Nova nota" opens the `cerebro-v2` dialog), no gallery
  entry, no `notesview.contract` C79 test.
- **Settled mid-build:** nothing by the owner. Builder decisions inside the approved shape: (a) the switch and the
  `v` key live in `brain/BrainViewSwitch.tsx`, registered once per brain on screen (`exclusive: "brain.view"`, the
  Núcleo's classic map mounts the frame's brain); "Ver notas" carries `v` on the graph and "Ver grafo" on the notes,
  never both; (b) the graph is unmounted on `/brain/notes` and its selection and camera come back through
  `useBrainState`'s navigation snapshot; "Ver no grafo" is `/brain?sel=<id>&local=1&hops=1` (the graph drops `hops=1`,
  its default); (c) the view's preferences are written whole (`PUT /api/ui-preferences {brain:{notes}}`, 400 ms after
  the last change), because the route merges objects and a partial `notes` would be filled with defaults; (d) tabs are
  paths, a tab read back after a reload finds its id and title in its folder's tree row (in the active context), and
  every tree request carries the context; `<home>/memory` comes from `GET /api/system/info`; (e) the close buttons of
  the tabs sit outside the tab list (axe's required-children forbids a button in a `tablist`): one grid, each `X` in the
  column after its tab, the list `display: contents`; (f) a tree item is named by its row (`aria-labelledby`), not by its
  open children; the lock is a `role="img"` with the reason as its name and hint, as are a broken link and "Falhou";
  (g) the callouts are a block of `brain/markdown.ts` drawn in every shape; their box style lives in `notes.css`; (h)
  for batch C: `useNotesState().markUnsaved(path, on)` is how the editor marks a tab, `NoteReader` leaves the place of
  the properties table between its header and its body, and `brain/notes/testnet.ts` is the specs' network (it also
  answers the note's `properties` as `[]`); (i) pins moved the way the repo moves them: `.notes-why` in typography's
  reviewed 12px list, `brain/notes/testnet.ts` among the files no entry reaches, the `cerebro-vista-notas` entry of
  `scripts/bundle-baseline.json` measured on this build (526 977 B JS gzip, 15.2 KB above `cerebro-contextos`, NotesView
  about 10.5 KB of it) so pixel C28's 2% holds — C79's 8 KB bound over `cerebro-contextos` is already exceeded by this
  batch alone, so batch C either slims the chunk or the bound needs the owner (flagged, not renegotiated here).
- **Abandoned:** a second `ContextSelector` in the notes sidebar (amendment 1); the graph kept mounted and hidden on
  `/brain/notes` (its loop and canvas would keep running behind the notes); a `GET /api/memory/tree` with no context
  to find a tab's id (it broke "every tree request carries context=<id>"); `title=` hints on the locks and links (AD-017
  f: hints are `Tooltip`s).

Status of batch C (updated in the commit that closes each piece):

- the properties table and editing in place (S6: C56-C67), and creating a note or a folder in the tree (S7: C68-C71):
  closed, every proof green in `apps/command-centre/src/brain/notes/PropertiesTable.test.tsx`,
  `NoteEditInPlace.test.tsx` and `NoteCreate.test.tsx`
- the copy table (C81), the gallery's entry (C78), the type floor, the state marks and axe in both shells and both
  themes (C77), and the weight (C79): closed, every proof green in `brain/notes/notesCopy.test.ts`,
  `tests/e2e/notes-view.spec.ts`, `tests/notesview.contract.test.ts`, the CSS lint of `brain/notes/*.css` and
  `npm run bundle:check`; the `cerebro-vista-notas` entry of `scripts/bundle-baseline.json` is this build's (534 932 B
  of JS gzip, 23.0 KB above `cerebro-contextos`; 74 679 B of CSS gzip, 3.2 KB above it); with it batch C is closed

- **Boundary (batch C):** C56-C71, C77-C79 and C81 closed. S6 and S7 (C56-C71) at `1cd4a41`; C77, C78, C79 and C81
  at `6adb1f9`, which closes the batch and the last batch of the feature. On the tree of `6adb1f9`: `npm run build`,
  `npm run typecheck`, `npm run lint` and `npm run bundle:check` exit 0, and the build measures exactly the recorded
  entry (534 932 B JS gzip, 74 679 B CSS gzip); `npx vitest run` at the root is green (141 files, 1853 tests, 1
  skipped) and `npm run test -w apps/command-centre` too (153 files, 1222 tests); each of the 22 `Proof:` lines of the
  batch passes and runs only its check's tests; `tests/e2e/notes-view.spec.ts`, `a11y.spec.ts`, `contexts.spec.ts`
  and `brain-errors.spec.ts` pass together (90 tests; in the first of two full runs notes-view C29 in the frame timed
  out once at 30.9 s, and it passed alone, in its spec alone and in the next full run), and `gallery.spec.ts` with
  `gallery-contrast.spec.ts` pass (27). The Verifier has not run: it is the orchestrator's, over every check.
- **Settled mid-build:** nothing by the owner (C79's bound is amendment 15; question cerebro-vista-notas 1 in
  `.specs/STATE.md` stays the owner's). Builder decisions inside the approved shape: (a) the create dialog of
  cerebro-v2 takes `folder` and `onCreated` in its request (`brain/noteEvents.ts`): "Pasta" is read-only with
  "Trocar" (which makes it a field), the area is hidden while a folder is chosen (door 7), and the caller's
  `onCreated` opens the note in a tab in edit mode instead of the dialog's editor; "Nova pasta" sends the name as
  typed (the service makes each level a name); (b) with the structure fixed, "Nova pasta" is disabled everywhere (a
  new folder is always refused) and "Nova nota" wherever no folder of `memory/notes` is selected, both `aria-disabled`
  so their `Tooltip` shows; (c) the heading's two controls are hidden while the root is empty or nothing is indexed,
  where the tree's own "Nova nota" stands (C37 asks for one such button), under the same rule; (d) the editor in place
  is the view's own (`brain/notes/NoteEditInPlace.tsx`) on the classes, strings and stylesheet of cerebro-v2's,
  because cerebro-v2 C23 keeps `brain/NoteEditor.tsx` imported only by its host; a tab's draft is kept by path while
  the tab is in the background (and "Ler" keeps it with the tab's mark) and dropped when the tab closes; an unchanged
  editor follows the disk (a property write is a new version); ⌘S / Ctrl+S is `brain.notes.save` in `view:brain`; the
  index note of a folder edits in its own tab; (e) over the properties, "Salvar como cópia" writes the note as it was
  read, plus the change, into a copy and opens it; a date read that is not `AAAA-MM-DD` is text with no field; a
  `status`/`select` value outside its list is an extra option; a list grows by a field "Acrescentar a <chave>"; (f)
  the `[[` list asks the brain's search (20 hits, in the active context) and keeps the first 8 whose title or name
  holds the text, accent-folded; (g) the gallery story is an `import()` of the gallery and takes `NoteReader`,
  `NoteTabs` and `NotesTree` from `NotesView.tsx` (re-exported there), so both pages fetch the view's one chunk, and
  `SWITCH_CONTEXT_ID` / `WHOLE_BRAIN_ID` moved to `contexts/useWorkContext.ts` (`ContextSelector` re-exports them), so
  the view no longer pulls the selector and the New context dialog in: without both the gallery split chunks and the
  build measured 24 916 B above `cerebro-contextos`, over the bound; (h) the specs' network (`brain/notes/testnet.ts`)
  answers a note's `properties`, `otherProperties`, `version` and `reason` from its table and `GET /api/settings` with
  `fixedStructure`, and its search folds accents as the index's `unicode61` does; C79's test reads the static closure
  of both entries (`main.tsx`, `gallery/main.tsx`) and the two `import()` ways in; (i) no pinned registry or allowlist
  test changed; plan.md's Impact interface row is kept true in `1cd4a41`.
- **Abandoned:** importing `StateBadge` or the dialog's parts from `brain/NoteEditor.tsx` into the view (cerebro-v2
  C23); the gallery story importing the parts from their own files (it split the view's chunk: 25 142 B above
  `cerebro-contextos`); the kinds' labels as template keys `notes.props.kind.${kind}` (i18n orphans C7 counts only
  spelled keys); a disabled "+ Adicionar propriedade" while the text is unsaved (the table only reads, C61).
