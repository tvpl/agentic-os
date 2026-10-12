# Cérebro v2 checks

Profile: ui
Plan: `.specs/features/cerebro-v2/plan.md`

58 checks in 5 slices (S1 core/API/CLI/MCP, S1b editor, S2 backlinks, S3 worker, S4 semantic) + cross-cutting · 6 one-way doors · 3 open questions, 1 blocks go-live.

Every proof is `npx vitest run <file> -t "<C-id> "` from the repository root (root tests) or `npm run test -w apps/command-centre -- <file> -t "<C-id> "` (UI tests); a test title starts with its check id. `E2E` proofs use `MORDOMO_E2E_PORT=4901 npx playwright test --config tests/e2e/playwright.config.ts <spec>`.

## Checks

### S1 - captura e edição pelo núcleo, API, CLI e MCP · ~14 files · ~190 KB · ~75k

**C1** - `POST /api/memory/notes {title:"Reunião de planejamento"}` answers `201`, creates `memory/notes/reuniao-de-planejamento.md` holding `# Reunião de planejamento\n\n`, and `version` matches `^sha256:[0-9a-f]{64}$` and equals the SHA-256 of the bytes on disk (AC 1)
Proof: `npx vitest run tests/memory.notes.test.ts -t "C1 "`

**C2** - A title whose name exists creates `-2` (then `-3`…`-99`) leaving the existing file's bytes unchanged; with `-2`…`-99` all present the answer is `409 note_exists` (AC 2)
Proof: `npx vitest run tests/memory.notes.test.ts -t "C2 "`

**C3** - The file name from a title is the slug rule for every row of a table of 24 titles: accents removed, lower-case, runs of non-`a-z0-9` to one `-`, trimmed, 80 characters, `nota` when empty, `-nota` appended to each of the 22 Windows device names (`con`,`prn`,`aux`,`nul`,`com1`-`com9`,`lpt1`-`lpt9`) (AC 3)
Proof: `npx vitest run tests/memory.notes.test.ts -t "C3 "`

**C4** - `area` in `settings.areas` creates under `memory/notes/<slug>/`; an unknown area answers `400 unknown_area` and creates no file or folder (AC 4)
Proof: `npx vitest run tests/memory.notes.test.ts -t "C4 "`

**C5** - `frontMatter:true` writes the `---` block with `title`, `tags` and a `created` ISO UTC date; a Markdown file with `title:` and `tags:` in front matter is indexed with that title and the tags merged with the inline `#tags` (AC 5)
Proof: `npx vitest run tests/memory.notes.test.ts -t "C5 "`

**C6** - An empty or whitespace title, a title of 201 characters, 21 tags, and a tag of 1 or 31 characters or with a space each answer `400 validation` and write nothing (AC 6)
Proof: `npx vitest run tests/memory.notes.test.ts -t "C6 "`

**C7** - `PUT` with the `baseVersion` of the disk answers `200` with the new `version` and the file holds the new text; a second `PUT` with the old `baseVersion` answers `409 edit_conflict` (AC 7)
Proof: `npx vitest run tests/memory.notes.test.ts -t "C7 "`

**C8** - A `PUT` whose `baseVersion` is not the disk's (the file edited outside, in the same millisecond too) answers `409 edit_conflict` and the file's bytes and `mtimeMs` are exactly as before (AC 8)
Proof: `npx vitest run tests/memory.notes.test.ts -t "C8 "`

**C9** - `PUT` on a path that does not exist answers `404 note_missing` and the file is not created (AC 9)
Proof: `npx vitest run tests/memory.notes.test.ts -t "C9 "`

**C10** - A body of exactly the limit (in UTF-8 bytes, with multi-byte characters) is written; one byte more answers `413 note_too_large` for `PUT` and `POST` and writes nothing; the limit is `min(maxIndexedFileBytes, 1048576)` for two settings values (AC 10)
Proof: `npx vitest run tests/memory.notes.test.ts -t "C10 "`

**C11** - `editable:false` with a reason, and `PUT` answering `403 note_not_editable` with the file unchanged, for each of: a path outside `memory/`, `memory/ROUTER.md`, `memory/areas/x.md`, `memory/journal/2026-01-01.md`, `memory/notes/x.txt`, `memory/notes/x` (no extension) (AC 11)
Proof: `npx vitest run tests/memory.notes.test.ts -t "C11 "`

**C12** - `PUT` and `POST` through a final symbolic link (to `config/token` and to an outside file), through a folder that is a link, and onto a hard link of `config/token` answer `403 forbidden_path` and the target keeps its bytes (AC 12)
Proof: `npx vitest run tests/memory.notes.test.ts -t "C12 "`

**C13** - `GET /api/memory/note?p=` answers the full `content`, the `version` and `editable:true` for an editable note, `413 note_too_large` for a file past the limit, `404` for a missing one and `403 forbidden_path` for a path under `config/` (AC 13)
Proof: `npx vitest run tests/memory.notes.test.ts -t "C13 "`

**C14** - With a device token holding every scope `POST` and `PUT` answer `403 owner_only`; with a run credential `rc_…` they answer `403`; a device holding `content` reads `GET /api/memory/note` and `GET /api/memory/links` (200) and one holding only `monitor` gets `403` (AC 14)
Proof: `npx vitest run tests/memory.notes.test.ts -t "C14 "`

**C15** - After a `POST` or a `PUT` the path-scoped pass runs, `index.finished` is announced, and `GET /api/memory/search?q=<word of the note>` returns that note once; the pass reads no other file (AC 15)
Proof: `npx vitest run tests/memory.notes.test.ts -t "C15 "`

**C16** - `mordomo note new "T"` prints the path and the version; `note show` prints the content; `note save <path> --base <v>` with stdin saves; with a stale `--base` the exit code is 1 and stderr names `edit_conflict` (AC 16)
Proof: `npx vitest run tests/memory.notes.cli.test.ts -t "C16 "`

**C17** - The MCP tools `note_create`, `note_read` and `note_save` return the route's result and a stale save returns an error result naming `edit_conflict` (AC 17)
Proof: `npx vitest run tests/memory.notes.cli.test.ts -t "C17 "`

**C57** - `writeWorkspaceFile(scope, path, data, {mode:"replace", expectSha256})` replaces only when the file's bytes hash to `expectSha256`: with a mismatch it throws `EditConflictError` and leaves bytes and `mtimeMs` unchanged, it never truncates before the check, and it still refuses a link, a hard link of a private file and a folder (door 5)
Proof: `npx vitest run tests/security-writes.test.ts -t "C57 "`

### S1b - o editor na interface · ~10 files · ~120 KB · ~45k

**C18** - Running "Nova nota" (palette or `N` on the Second Brain screen) opens the creation dialog with a title field focused and an area select; "Criar" is disabled with an empty title, creates the note through `POST /api/memory/notes` and opens the editor on it (AC 18)
Proof: `npm run test -w apps/command-centre -- src/brain/NoteEditor.test.tsx -t "C18 "`

**C19** - "Editar" in the preview of an editable note opens the editor with the file's text; each state (`Salvo`, `Alterações não salvas`, `Salvando…`, `Conflito`, `Erro ao salvar`) shows its text and its own icon, and the status text is the same in the accessible name of the status region (AC 19)
Proof: `npm run test -w apps/command-centre -- src/brain/NoteEditor.test.tsx -t "C19 "`
Proof: `npm run test -w apps/command-centre -- src/brain/PreviewPanel.test.tsx -t "C19 "`

**C20** - "Salvar" is disabled while the text equals the saved one and while saving; closing by Esc, "Fechar" or the veil with changes asks "Descartar as alterações não salvas?" (initial focus "Continuar editando"), and without changes closes at once (AC 20)
Proof: `npm run test -w apps/command-centre -- src/brain/NoteEditor.test.tsx -t "C20 "`

**C21** - After `409 edit_conflict` a `role="alert"` banner offers "Carregar a versão do disco" and "Salvar como cópia", the person's text stays in the field, "Salvar" is disabled, and each button does what it says (AC 21)
Proof: `npm run test -w apps/command-centre -- src/brain/NoteEditor.test.tsx -t "C21 "`

**C22** - `413`, `403` and a network failure on save each show their message in the dialog with the text kept and the dialog open; loading shows a spinner with "Carregando…"; a not-editable file shows its `reason` and neither "Editar" nor "Salvar" (AC 22)
Proof: `npm run test -w apps/command-centre -- src/brain/NoteEditor.test.tsx -t "C22 "`
Proof: `npm run test -w apps/command-centre -- src/brain/PreviewPanel.test.tsx -t "C22 "`

**C23** - The editor is a dynamic `import()` (no static import of it from the entry), the entry bundle passes `bundle:check` against its recorded entry, and the open dialog on the Second Brain screen passes axe (no `serious`/`critical`) in the light and dark themes, with prose at 13px and nothing under 12px (AC 23)
Proof: `npm run test -w apps/command-centre -- src/brain/NoteEditor.test.tsx -t "C23 "`
Proof: `npm run bundle:check`
Proof: `MORDOMO_E2E_PORT=4901 npx playwright test --config tests/e2e/playwright.config.ts tests/e2e/note-editor.spec.ts`

### S2 - backlinks e links quebrados · ~9 files · ~110 KB · ~40k

**C24** - The extractor returns one entry (kind, target, label, line) for each of `[[Alvo]]`, `[[pasta/Alvo|texto]]`, `[[Alvo#Título]]`, `![[Alvo]]` and `[texto](./alvo.md#parte)` and none for a link in a fenced block (` ``` ` and `~~~`), an inline code span, `https://…`, `mailto:` or `#âncora`; a table of 13 cases (AC 24)
Proof: `npx vitest run tests/memory.links.test.ts -t "C24 "`

**C25** - `GET /api/memory/links?id=` answers `backlinks` (file, kind, line, label) and `outgoing` (with `resolved` a file or `null`), for a note with two backlinks of two kinds and one broken outgoing link (AC 25)
Proof: `npx vitest run tests/memory.links.test.ts -t "C25 "`

**C26** - A wikilink matching three files resolves to the one in the source's folder, else the shortest relative path, else the first alphabetically, and the others come back as `alternatives` (AC 26)
Proof: `npx vitest run tests/memory.links.test.ts -t "C26 "`

**C27** - Creating the target of a broken link makes `resolved` the new file and gives it the backlink; deleting it makes it `null` again; in both cases no source file was opened by the indexer in the second pass (AC 27)
Proof: `npx vitest run tests/memory.links.test.ts -t "C27 "`

**C28** - After a rename (`fs.renameSync`) and a pass, the sources' links show `resolved:null`, the bytes and `mtime` of every other file are exactly as before, and a rename back restores the links (AC 28)
Proof: `npx vitest run tests/memory.links.test.ts -t "C28 "`

**C29** - A row the policy excludes today (a stale row under the home's `config/`, a secret name, a user exclude) is not returned as a backlink or target, and `links?id=` for its id answers `404` (AC 29)
Proof: `npx vitest run tests/memory.links.test.ts -t "C29 "`

**C30** - Migration 20 on a database at version 19 with indexed Markdown creates `note_links` and its index, changes no existing row, the first pass fills the links from the stored content with zero file opens, and running the migration SQL twice leaves the same rows (AC 30)
Proof: `npx vitest run tests/data.migration.test.ts -t "C30 "`

**C56** - `PRAGMA table_info` and `index_list` of `note_links` and `file_vectors` equal the literal shapes of doors 1 and 2 (names, types, not-null, primary key columns, the index), pinned with `toEqual`, and the user version after the migrations is 21 (doors 1, 2)
Proof: `npx vitest run tests/data.migration.test.ts -t "C56 "`

**C31** - The preview of a note shows "Backlinks (N)" with its list (clicking one selects that note), "Links quebrados (N)" for the unresolved ones, "Nenhuma nota aponta para esta." for none, a spinner with text while loading and an error with "Tentar de novo" that retries (AC 31)
Proof: `npm run test -w apps/command-centre -- src/brain/PreviewPanel.test.tsx -t "C31 "`
Proof: `MORDOMO_E2E_PORT=4901 npx playwright test --config tests/e2e/playwright.config.ts tests/e2e/note-editor.spec.ts -g "C31 "`

### S3 - indexação em worker · ~12 files · ~170 KB · ~60k

**C32** - Indexing 3 000 Markdown files through the real worker keeps the longest event-loop delay of the service thread under 100 ms (measured with `monitorEventLoopDelay` max), while the same pass inline exceeds it on this machine, so the probe can tell the two apart (AC 32)
Proof: `npx vitest run tests/memory.worker.test.ts -t "C32 "`

**C33** - A pass emits `index.started` `{runId, mode:"worker"}`, `index.progress` with each `phase` of `scan`, `index`, `prune`, `related`, `vectors` (the last only when enabled) and the same `runId`, then `index.finished`; a failure emits `index.failed` and a cancel `index.cancelled`; every envelope has `v:1` and parses against `EVENT_SCHEMAS` (AC 33)
Proof: `npx vitest run tests/memory.worker.test.ts -t "C33 "`

**C34** - `POST /api/memory/index/cancel` during a pass stops it in under 2 000 ms, keeps the rows of committed blocks, removes none of the files not yet seen, makes the starting call answer `409 index_cancelled`; with no pass it answers `200 {cancelled:false}` (AC 34)
Proof: `npx vitest run tests/memory.worker.test.ts -t "C34 "`

**C35** - A second pass over unchanged files opens zero files; a worker terminated after the second block and then a new pass give the same `files` rows, FTS rows and stats a clean pass gives (AC 35)
Proof: `npx vitest run tests/memory.worker.test.ts -t "C35 "`

**C36** - A worker that exits with code 1, one that throws, and one over its heap limit each end with `index.failed` `index_worker_crashed` (twice) and `index_worker_out_of_memory`, the caller gets `500` with that code, the restore lock is released, the previous rows stay, and the next pass starts a new worker (AC 36)
Proof: `npx vitest run tests/memory.worker.test.ts -t "C36 "`

**C37** - While another connection holds the exclusive restore lock `POST /api/memory/index` answers `409 restore_in_progress` and no worker starts; during a pass `RestoreLock.acquire(…, "exclusive")` throws `RestoreInProgressError`; after the pass ends (finished, failed and cancelled) an exclusive acquire succeeds (AC 37)
Proof: `npx vitest run tests/memory.worker.test.ts -t "C37 "`

**C38** - A home with `config/token`, `logs/*.jsonl`, `.env`, a user-excluded folder and a symbolic link to `config/` indexed through the worker leaves none of them in `files` or `files_fts` (the same set the inline indexer leaves), and the worker's value-import graph reaches none of `engine`, `ownerLock`, `restoreLock`, `db/db` (AC 38)
Proof: `npx vitest run tests/memory.worker.test.ts -t "C38 "`

**C39** - `engine.close()` during a pass cancels it, terminates the worker, releases the lock and resolves with no worker alive and `isIndexing()` false; calling it twice is harmless; two engines of one process on two homes each run their own pass with their own `runId` and events (AC 39)
Proof: `npx vitest run tests/memory.worker.test.ts -t "C39 "`

**C40** - With no worker script resolvable the pass runs in the service thread, `index.started` says `mode:"inline"`, `GET /api/memory/status` reports `indexing.mode:"inline"`, and the result equals the worker's; with the script present it reports `"worker"` (AC 40)
Proof: `npx vitest run tests/memory.worker.test.ts -t "C40 "`

**C41** - Two concurrent `POST /api/memory/index` share one pass (one `runId`, one worker); three `requestIndexPaths` during a pass produce exactly one follow-up pass over the union of the paths (AC 41)
Proof: `npx vitest run tests/memory.worker.test.ts -t "C41 "`

**C58** - The worker protocol messages (`start`, `progress`, `done`, `failed` and the cancel flag layout) parse against one schema in both directions, an unknown `t` is ignored by the host and a malformed `progress` fails the pass with `index_worker_crashed` (door 6)
Proof: `npx vitest run tests/memory.worker.test.ts -t "C58 "`

**C42** - While a pass runs the Second Brain bar shows the phase text and `scanned/total`, a "Cancelar" button that calls the cancel route, "Indexação cancelada" with its icon after a cancel, and the translated failure after `index.failed` (AC 42)
Proof: `npm run test -w apps/command-centre -- src/brain/IndexProgress.test.tsx -t "C42 "`

### S4 - busca semântica opcional · ~11 files · ~130 KB · ~50k

**C43** - With the defaults no `file_vectors` row exists after a pass, `loadExtension` is never called, `fetch` is never called, `mode=semantic` answers `409 semantic_disabled`, and `mode=auto` returns exactly the text search result (AC 43)
Proof: `npx vitest run tests/memory.semantic.test.ts -t "C43 "`

**C44** - The `hash-v1` provider returns 256 floats with L2 norm 1 (±1e-6), identical bytes for identical text in two runs and across a child process, different vectors for texts with different words, and the zero text returns a zero-norm-safe vector (AC 44)
Proof: `npx vitest run tests/memory.semantic.test.ts -t "C44 "`

**C45** - RRF with k=60 over a text order and a vector order gives the hand-computed fused order on a 6-document case, ties broken by file id, and `via` is `text`, `semantic` or `both` for one document of each kind (AC 45)
Proof: `npx vitest run tests/memory.semantic.test.ts -t "C45 "`

**C46** - On `tests/fixtures/semantic-corpus.json` (24 notes, 12 questions) the hybrid search has the expected note in the top 3 for at least 11 questions and the text search for at most 6 (AC 46)
Proof: `npx vitest run tests/memory.semantic.test.ts -t "C46 "`

**C47** - With `sqlite-vec` loaded the status says `backend:"sqlite-vec"`; with the loader throwing (package missing, unsupported platform simulated by `process.platform`, `loadExtension` throwing) it says `"js"` with no error; both rank the evaluation corpus identically and the scores agree within 1e-5 (AC 47)
Proof: `npx vitest run tests/memory.semantic.test.ts -t "C47 "`

**C48** - The `http` provider sends `POST <endpoint>` with `{model, input}` of at most 16 texts of at most 8 000 characters, `Authorization: Bearer` from the named environment variable and no key in `settings.json`, a 30 s timeout, `redirect:"error"` and a response cap of 8 MB, against a local test server (AC 48)
Proof: `npx vitest run tests/memory.semantic.test.ts -t "C48 "`

**C49** - Nothing is sent and `semantic.blocked` names the reason for each of: `http://example.com` (not https, not loopback), `https://example.com` without `sendRemote`, an endpoint that is not a URL, and a missing `endpoint`; `http://127.0.0.1:<port>` is sent without `sendRemote` (AC 49)
Proof: `npx vitest run tests/memory.semantic.test.ts -t "C49 "`

**C50** - A provider that times out, answers `500`, answers a vector of the wrong dimension or a malformed body leaves the pass finished with the text index complete, `stats.embedded` the count done, `semantic.error` naming the failure, and the next pass embeds the rest (AC 50)
Proof: `npx vitest run tests/memory.semantic.test.ts -t "C50 "`

**C51** - Changing the provider id or dimension recomputes every vector on the next pass; editing a file recomputes its vector; deleting the file, `purgeExcluded` and turning the embeddings off delete the vectors (AC 51)
Proof: `npx vitest run tests/memory.semantic.test.ts -t "C51 "`

**C52** - An unreadable `memory.embeddings` (a string, a wrong type for each field) reads as `enabled:false` and the file is kept as `settings.json.invalid`; the leaves of `memory.embeddings` are classified in the settings table; `network-policy.json` has the destination gated by `memory.embeddings.enabled` and `PRIVACY.md` names it with what it sends (AC 52)
Proof: `npx vitest run tests/data.settings.test.ts -t "C52 "`
Proof: `npx vitest run tests/legal.network.test.ts -t "C52 "`

### Cross-cutting · ~16 files · ~250 KB (docs, contracts, tests helpers) · ~35k

**C53** - The `API` table holds the five new routes (132 routes) with params/query/body, a schema per success status, declared errors and scope; the OpenAPI document and `docs/events.md` equal the generated text; `EXPECTED_ROUTE_SCOPES` and `docs/security.md` list the five routes; the refusal probe has a scenario for each and finds `403 forbidden_path`/`404 not_a_file`/`413 file_too_large` exactly where the lists say (AC 53)
Proof: `npx vitest run tests/api.contract.test.ts tests/api.openapi.test.ts tests/events.contract.test.ts -t "C53 "`
Proof: `npx vitest run tests/api.refusals.test.ts tests/device-scopes.test.ts -t "C53 "`

**C54** - `licenses:check`, `network:scan --check` and `bundle:check` exit 0; `THIRD_PARTY_NOTICES.md` and the SBOM name `sqlite-vec` and its five platform packages; the installer script copies `indexWorker.mjs` and, for the host target, the `sqlite-vec` binary, and the dependency is exact in `core/package.json` (AC 54, door 3)
Proof: `npm run licenses:check`
Proof: `npm run network:scan -- --check`
Proof: `npx vitest run tests/legal.licenses.test.ts tests/bundle-size.test.ts tests/sdk.package.test.ts -t "C54 "`

**C55** - The raw-fs audit (`ALLOWED`) lists no new row except the ones the plan moved, and the module-state list of `sdk.instances` is unchanged (nine) (AC 55)
Proof: `npx vitest run tests/security-reads.test.ts tests/sdk.instances.test.ts -t "C55 "`

## Coverage

| Set (size)                                              | Member -> proof                                                                                                                                  | Unproven |
| ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ | -------- |
| `GET /api/memory/note` statuses (5)                     | 200 C13 · 400 C13 · 403 C13 · 404 C13 · 413 C13                                                                                                  | -        |
| `POST /api/memory/notes` statuses (5)                   | 201 C1 · 400 C4 · 403 C12 · 409 C2 · 413 C10                                                                                                     | -        |
| `PUT /api/memory/notes` statuses (6)                    | 200 C7 · 400 C6 · 403 C11 · 404 C9 · 409 C8 · 413 C10                                                                                            | -        |
| `GET /api/memory/preview` statuses (3)                  | 200 C19 · 403 C13 · 404 C13                                                                                                                      | -        |
| `GET /api/memory/search` statuses (2)                   | 200 C45 · 409 C43                                                                                                                                | -        |
| `GET /api/memory/links` statuses (3)                    | 200 C25 · 400 C25 · 404 C29                                                                                                                      | -        |
| `POST /api/memory/index/cancel` statuses (1)            | 200 C34                                                                                                                                          | -        |
| `POST /api/memory/index` errors (5)                     | `index_scan_incomplete` C35 · `index_cancelled` C34 · `restore_in_progress` C37 · `index_worker_crashed` C36 · `index_worker_out_of_memory` C36  | -        |
| `GET /api/memory/search` errors (1)                     | `semantic_disabled` C43                                                                                                                          | -        |
| `mode` of search (3)                                    | `auto` C43 · `text` C45 · `semantic` C46                                                                                                         | -        |
| `via` of a hit (3)                                      | `text` C45 · `semantic` C45 · `both` C45                                                                                                         | -        |
| Windows device names (22)                               | C3, table-driven over all 22                                                                                                                     | -        |
| non-editable paths (6)                                  | outside `memory/` C11 · `ROUTER.md` C11 · `areas/` C11 · `journal/` C11 · `.txt` C11 · no extension C11                                          | -        |
| link forms extracted (5)                                | wikilink C24 · wikilink with folder and label C24 · wikilink with heading C24 · embed `![[…]]` C24 · relative Markdown link with fragment C24    | -        |
| link forms not extracted (6)                            | fenced ``` C24 · fenced ~~~ C24 · inline code C24 · `https` C24 · `mailto:` C24 · `#âncora` C24                                                  | -        |
| wikilink resolution order (3)                           | same folder C26 · shortest path C26 · alphabetical C26                                                                                           | -        |
| editor states (5)                                       | `Salvo` C19 · `Alterações não salvas` C19 · `Salvando…` C19 · `Conflito` C21 · `Erro ao salvar` C22                                              | -        |
| editor error answers (3)                                | 413 C22 · 403 C22 · network C22                                                                                                                  | -        |
| index phases (5)                                        | `scan` C33 · `index` C33 · `prune` C33 · `related` C33 · `vectors` C33                                                                           | -        |
| index events (5)                                        | `index.started` C33 · `index.progress` C33 · `index.finished` C33 · `index.failed` C33 · `index.cancelled` C33                                   | -        |
| worker end states (5)                                   | finished C33 · cancelled C34 · exit code C36 · throw C36 · out of memory C36                                                                     | -        |
| worker protocol messages (4)                            | `start` C58 · `progress` C58 · `done` C58 · `failed` C58                                                                                         | -        |
| restore lock states (4)                                 | free C37 · held exclusive C37 · held shared by the pass C37 · released after end C37                                                             | -        |
| embeddings blocked endpoints (5)                        | not https C49 · no `sendRemote` C49 · not a URL C49 · missing C49 · loopback allowed C49                                                         | -        |
| provider failures (4)                                   | timeout C50 · status ≥ 400 C50 · wrong dimension C50 · malformed body C50                                                                        | -        |
| vector lifecycle (4)                                    | provider change C51 · file edit C51 · file removal C51 · embeddings off C51                                                                      | -        |
| sqlite-vec backends (2)                                 | `sqlite-vec` C47 · `js` C47                                                                                                                      | -        |
| migrations added (2)                                    | 20 `note_links` C30, C56 · 21 `file_vectors` C56                                                                                                 | -        |
| doors (6)                                               | 1 C24, C30, C56 · 2 C51, C56 · 3 C47, C54 · 4 C53 · 5 C7, C8, C57 · 6 C38, C54, C58                                                              | -        |
| entities of Relations (2)                               | `note_links` C24, C30, C56 · `file_vectors` C51, C56                                                                                             | -        |
| scopes of new routes (5)                                | `GET note` content C14, C53 · `POST notes` owner C14, C53 · `PUT notes` owner C14, C53 · `GET links` content C14, C53 · `index/cancel` owner C53 | -        |
| settings leaves `memory.embeddings` (7)                 | `enabled` C52 · `provider` C52 · `endpoint` C52 · `model` C52 · `apiKeyEnv` C52 · `dimensions` C52 · `sendRemote` C52                            | -        |
| startup config: worker script resolution (3 assemblies) | `tsc` build (`core/dist`) C40 · installer bundle C54 · vitest source tree (inline) C40                                                           | -        |
| startup config: `sqlite-vec` optional (2 assemblies)    | build tree C47 · installer for the host target C54                                                                                               | -        |

- Claims naming a status code, route or response shape: C1, C2, C4, C6-C14, C25, C29, C34, C36, C37, C43, C53 - each has a proof that crosses the HTTP boundary (`app.inject` against `buildServer`)
- Claims about the interface (C18-C23, C31, C42) are proven in rendered components against a test server; C23 adds the browser (axe)
- No other check claims more than the single case its proof exercises

## Binding sources

| Source                                                                                                  | Checked by                                                                    |
| ------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| `design-system/design.md`: 12px floor, 13px prose, tokens only, state not by color alone, axe           | C19, C23 (text + icon per state; computed font sizes; axe)                    |
| `primitivas/design.md`: the dialogs are `Modal`, focus enters and returns, Esc closes the top           | C20, C21, C23 (focus, Esc ladder)                                             |
| `comandos-atalhos/design.md`: commands in the registry, no listener outside it, bare key not in a field | C18, C55 (the allowlist of listeners does not grow; `N` ignored in the field) |
| `moldura-app/design.md`: preview as the `aside` with actions                                            | C19, C31                                                                      |
| `limpeza-legado/design.md`: one Markdown renderer, no orphan CSS or translation keys                    | C55 (the sweeping tests stay green)                                           |

## Test policy

| Code                                                                                                            | Required proofs                                       | Coverage expectation                                                                           |
| --------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| Decides, reached across a boundary (`notes.ts`, `links.ts` resolution, `searchFiles` fusion, `IndexWorkerHost`) | one at the HTTP boundary **and** one at its own layer | the contract at the boundary; one asserted case per row of the decision table at its own layer |
| Decides, not reached across a boundary (slug, extractor, RRF, `hash` provider, `http` endpoint policy)          | one at its own layer                                  | one asserted case per row of the decision table                                                |
| Entry point that decides nothing (the five route handlers, CLI `note`, MCP tools)                               | one at the boundary                                   | accepted input, each rejected input, each error path                                           |
| Instrumentation (re-exports, `internal.ts`, locale maps)                                                        | none of its own                                       | covered by its consumer's proof                                                                |

Evidence (counts of decision points, from the code as built — recomputed at close):

- `core/src/memory/notes.ts`: slug (6 steps + 22 reserved names), editability (6 refusals), size, collision loop, area, front matter -> decides
- `core/src/memory/links.ts`: extractor (5 forms, 6 exclusions), resolution (3 ranks), kind dispatch (2) -> decides
- `core/src/memory/semantic.ts` + `embeddings.ts`: RRF, mode dispatch (3), provider endpoint policy (5), failure kinds (4) -> decides
- `core/src/memory/indexHost.ts`: lock, end states (5), coalescing, protocol (4 messages) -> decides
- `apps/api/src/routes/memory.ts` handlers: forward to the functions above -> entry point
- closest analogue in the repo: `core/src/memory/journal.ts` (`appendJournal`, decides section/date/limits) proven at its layer in `tests/core.memory.v2.test.ts` and through `tests/api.memory.v2.test.ts`

Cost: ~9 proofs at their own layer across 5 modules. Without these rows the slug table, the editability table and the fusion would be proven only by a path that happens to traverse them.

## Swept

- validation: C6, C10, C11, C49
- failure modes: C36, C50, C21
- idempotency: C2, C30, C41
- authorization: C14, C53
- concurrency: C8, C35, C41
- data lifecycle: C51, C28
- dependency failure: C47, C50
- state transitions: C20, C34
- observability: C33

## Out of scope

- Editar fora de `memory/`, renomear com reescrita de links, editor rico, modelo de embeddings embarcado, escrita por dispositivo - ver `plan.md`.

## Handoff

Size, with the arithmetic (`wc -c` of the files each slice touches / 4, plus the new files at the size the slice's checks imply):

- S1 = 75k (safeWrite, notes, routes, contracts, errors, cli 58 KB, mcp, tests); S1b = 45k (PreviewPanel, locales, global.ts, OsShell, editor, tests); S2 = 40k (indexer 24 KB, links, migration, graph, preview section, tests) -> 160k
- S3 = 60k (indexer, engine, host, worker, events, SecondBrain progress, package.mjs, tests) -> 220k
- S4 = 50k (search, embeddings, semantic, settings, failClosed, legal, packaging, tests) -> 270k; cross-cutting 35k -> 305k, over the 150k budget
- Mechanism: **one builder, slices committed apart** — the orchestrator's instruction for this feature authorises the cut at the slice boundaries (S1, S1b, S2, S3, S4, then cross-cutting) as separate verifiable commits and says an unfinished slice must be marked open here rather than delivered half. No mid-slice cut. Compaction accepted.

Status of slices (updated in the commit that closes each):

- S1: closed (C1-C17, C57 green; the hash is on the Boundary line below)
- S1b: closed (C18-C23; the Edit button of the preview is proven in `PreviewPanel.test.tsx` under C19 and C22, an added Proof line)
- S2: closed (C24-C31, C56 for `note_links`; the `file_vectors` half of C56 closes with S4)
- S3: open
- S4: open
- cross-cutting: open

- **Boundary:** S1 (C1-C17, C57) closed at `df74efa`; S1b (C18-C23) closed at `96f05f5`
- **Settled mid-build:** MCP tool names are `note_create`/`note_read`/`note_save` (the server is already namespaced `mordomo`, and the other tools carry no prefix); a link planted on the name a new note would take is `403 forbidden_path` (never skipped silently); the five NoteError classes are one class per status so the contract scan (`api.contract` C13) can read the codes; the internal barrel gains only `createNote`, `readNote`, `saveNote` (the other helpers are imported by path in tests)
- **Deliberate changes to earlier pins:** route totals 127 -> 130 and the scope counts (`owner` 65, `content` 23) in `api.contract`, `api.openapi`, `device-scopes`, `events.contract`, `api.refusals`; the raised-errors set 49 -> 56 (`api.contract` C13); the internal names of `sdk.surface` C38 (+3); `docs/security.md` table
- **Settled mid-build (S1b, S2):** the editor shows no "N notes point here" count and the links section no "(+N)" for ambiguous wikilinks (the editor has a path, the route takes an id; `alternatives` is in the API) - `design.md` was corrected to match; the error icon of the editor is `CircleAlert` (distinct from the conflict's `AlertTriangle`); `outgoing` keeps document order (`ORDER BY line, rowid`); the Núcleo reader sheet got the Edit action too
