# Cérebro: faxina guiada checks

Profile: ui
Plan: `.specs/features/cerebro-faxina-guiada/plan.md`
Design: `.specs/features/cerebro-faxina-guiada/design.md` (binding for the screens)

83 checks in 5 slices + cross-cutting · 6 one-way doors · 2 open questions of the plan (1 `blocks go-live`, 2 `open`), both
with their defaults in force, and 5 new ones the reconciliation raised (plan.md, "Emendas", questions 3-7), none blocking ·
17 amendments for what `cerebro-correcoes`, `cerebro-contextos`, `cerebro-organizar` and `cerebro-vista-notas` built after
the plan and for what this derivation found (`plan.md`, "Emendas depois da aprovação"; each names the check that resolves it).

The plan's slices mix the core, the API and the screens; here S1-S4 are the core and the API of plan S1-S4, and S5 is every
screen of plan S1, S3, S4 and S5, so a batch cut never splits a check slice.

Every proof is `npx vitest run <file> -t "<C-id> "` from the repository root (root tests) or
`npm run test -w apps/command-centre -- <file> -t "<C-id> "` (UI tests); a test title starts with its check id followed by a
space. `E2E` proofs use `MORDOMO_E2E_PORT=4901 npx playwright test --config tests/e2e/playwright.config.ts <spec> -g "<C-id> "`.
`tests/cleanup.layer.test.ts` calls the deciding code itself (`cleanupInventory`, the scanner's finding rules, the MinHash, the
decision rules, the apply planner, the undo, `moveWorkspaceFile`), with no HTTP (`Test policy` rows 1 and 2); the other root
files go through `app.inject` against `buildServer` over a real home. "Now" in every claim is a fixed clock the test sets,
and a file's age is `now - mtime` in whole days. The screens' axe runs over the whole page and counts `serious` and
`critical` violations (the convention of `design-system` C8 and `tests/e2e/a11y.spec.ts`). A claim that names a status and
a code asserts both (plan.md, "Emendas" 4).

## Checks

### S1 - o que tem aqui: inventário, core e rota (plan S1) · 8 files · 142 KB · ~35k

**C1** - `GET /api/memory/cleanup/inventory?context=<id>` with the owner token answers `200` with `scope` = `{ kind: "context", id: "<id>" }`, `total` = the number of the scope's indexed files and their bytes, and the keys `byKind`, `bySize`, `byAge`, `topFolders`, `clusters`, each computed over the same 14 rows of the fixture (AC 1, door 5)
Proof: `npx vitest run tests/cleanup.inventory.test.ts -t "C1 "`

**C2** - `byKind` holds six groups in the order `notes`, `text`, `pdf`, `image`, `code`, `other`, each with `count` and `bytes`, one asserted case per group: `a.md` and `b.markdown` count in `notes`, `c.txt` in `text`, `d.pdf` in `pdf`, `e.png` in `image`, `f.ts` in `code`, `g.xyz` in `other`; a group with no file answers `count: 0, bytes: 0` (AC 1)
Proof: `npx vitest run tests/cleanup.inventory.test.ts -t "C2 "`
Proof: `npx vitest run tests/cleanup.layer.test.ts -t "C2 "`

**C3** - `byAge` holds four bands in the order 0-30, 31-90, 91-365, more than 365 days since `mtime`; files aged 0, 30, 31, 90, 91, 365 and 366 days land in bands 1, 1, 2, 2, 3, 3, 4 (counts `[2, 2, 2, 1]`) (AC 1)
Proof: `npx vitest run tests/cleanup.layer.test.ts -t "C3 "`

**C4** - `topFolders` holds the 10 folders of the scope with the most bytes (a folder's bytes are its files' at any depth), in descending order of bytes, each with its path and bytes; the 11th folder of a scope with 11 is absent (AC 1)
Proof: `npx vitest run tests/cleanup.layer.test.ts -t "C4 "`

**C5** - For a scope with files under the first-level subfolders `clientes/` and `projetos/`, `clusters` holds two groups named after them with their counts and their top 3 shared terms from `file_terms`; for a scope of one folder only, the groups are the connected components of `file_related` edges with score ≥ 0.3 (an edge of 0.29 joins nothing, one of 0.30 joins); a scope with 14 subfolders answers 12 groups, the 12 largest (AC 5)
Proof: `npx vitest run tests/cleanup.layer.test.ts -t "C5 "`

**C6** - After an index pass the scope's files are deleted from disk and the inventory still answers the same `total` and `byKind`: it is computed from the `files` rows alone; a row excluded by today's policy (a user exclude added after the pass, a secret-named `.env`) is counted nowhere (AC 2)
Proof: `npx vitest run tests/cleanup.inventory.test.ts -t "C6 "`
Proof: `npx vitest run tests/cleanup.layer.test.ts -t "C6 "`

**C7** - For a context whose paths are `<R>/projetos/app` (`ok`) and a deleted folder (`missing`), and whose notes folder `<home>/memory/notes/<id>/` holds `_resumo.md`, the `context=<id>` scope counts the rows under `<R>/projetos/app` and under `<home>/memory/notes/<id>/`, and never a row of `<R>/projetos/app-antigo/` nor a row left in the index under the missing path (AC 2, amendment 3)
Proof: `npx vitest run tests/cleanup.inventory.test.ts -t "C7 "`
Proof: `npx vitest run tests/cleanup.layer.test.ts -t "C7 "`

**C8** - `dir=<R>/projetos` (inside an enabled indexed folder) and `dir=<home>/memory/notes/clientes` each scope the inventory to that folder and its subfolders (`scope` = `{ kind: "dir", path: "<the absolute folder>" }`); `dir=/tmp/fora` (outside every indexed root), `dir=<home>/config` and `dir=<a disabled indexed folder>` answer `400` with code `scope_required` and no `total` (AC 3)
Proof: `npx vitest run tests/cleanup.inventory.test.ts -t "C8 "`

**C9** - The scope refusals, each with its status and code: `context=nao-existe` → `404 context_not_found`; no `context` and no `dir` → `400 scope_required`; `context=all` → `400 scope_required`; `context=<id>&dir=<R>` → `400 validation`; the same four through `POST /api/memory/cleanup/scans` answer the same pairs, and none starts a scan (AC 4, amendments 3 and 4)
Proof: `npx vitest run tests/cleanup.inventory.test.ts -t "C9 "`

### S2 - os achados: varredura, assinaturas, eventos e limiares (plan S2) · 15 files · 229 KB · ~57k

**C10** - `POST /api/memory/cleanup/scans {context}` answers `202 { scanId }`; while it runs the bus carries `cleanup.progress` events whose `phase` goes through `inventory`, `signatures`, `links`, `findings` in that order with `done` ≤ `total`, and then one `cleanup.finished`; each payload equals `{ scanId, phase, done, total }` and `{ scanId, findings }` exactly (`toEqual`), all with `v: 1`, and `findings` is the number `GET /scans/:id` lists (AC 7, door 6)
Proof: `npx vitest run tests/cleanup.scan.test.ts -t "C10 "`

**C11** - `GET /api/memory/cleanup/scans/<scanId>` answers `200` with `status: "running"` and the current `phase` while the scan runs, and `status: "finished"`, `findings[]` (each `{ key, kind, files[], detail, suggested }`) and `decided` (the number of findings hidden by a stored decision) once it ends; `GET /api/memory/cleanup/scans/nao-existe` answers `404 not_found` (AC 7, door 5, amendment 12)
Proof: `npx vitest run tests/cleanup.scan.test.ts -t "C11 "`

**C12** - Two allowed files of the scope with the same bytes (`a.md`, `copia/a.md`) give exactly one `duplicate` finding listing both; three files with the same bytes give one `duplicate` finding listing the three; two files of the same size and different bytes give none (AC 8)
Proof: `npx vitest run tests/cleanup.scan.test.ts -t "C12 "`
Proof: `npx vitest run tests/cleanup.layer.test.ts -t "C12 "`

**C13** - Two notes whose 5-word shingle sets have an exact Jaccard similarity of 0.95 give one `near-duplicate` finding whose `detail` holds the estimate, a number ≥ 0.8; two whose exact Jaccard is 0.5 give none; a pair with the same bytes is one `duplicate` and no `near-duplicate` (AC 8, door 2)
Proof: `npx vitest run tests/cleanup.layer.test.ts -t "C13 "`

**C14** - The signature of a text is 64 `Uint32` values written little-endian (256 bytes) with `algo` = `minhash-v1:64:w5`; the same text computed in two child processes with different `LANG` and `TZ` gives the same 256 bytes; `Plano de Vendas para 2027 com metas` and `plano de vendas para 2027 com METAS` give the same signature (words are folded) (AC 9, door 2)
Proof: `npx vitest run tests/cleanup.layer.test.ts -t "C14 "`

**C15** - After migration 24, `PRAGMA table_info(file_minhash)` equals `file_id INTEGER PK`, `algo TEXT NOT NULL`, `sig BLOB NOT NULL`, `mtime INTEGER NOT NULL`, `size INTEGER NOT NULL` (`toEqual` over name, type, notnull, pk); running the migrations again leaves the same schema; migration 23 is still `run-context`; an index pass that removes a file deletes its `file_minhash` row (door 2, amendment 1)
Proof: `npx vitest run tests/cleanup.layer.test.ts -t "C15 "`

**C16** - A second scan over unchanged files rewrites no `file_minhash` row (each row's `sig` and the table's `changes()` count stay); a file whose `mtime` changed, one whose `size` changed, and a row stored with `algo` = `minhash-v0:test` are each recomputed in that scan, and only those three (AC 9, door 2)
Proof: `npx vitest run tests/cleanup.layer.test.ts -t "C16 "`

**C17** - After migration 24, `PRAGMA table_info(cleanup_decisions)` equals `scope TEXT NOT NULL`, `key TEXT NOT NULL`, `decision TEXT NOT NULL`, `keep_file_id INTEGER`, `until INTEGER`, `decided_at INTEGER NOT NULL`, with the primary key `(scope, key)` (`toEqual`); a second insert with the same `(scope, key)` fails the constraint (door 3, amendment 1)
Proof: `npx vitest run tests/cleanup.layer.test.ts -t "C17 "`

**C18** - With no `memory.cleanup` in the settings, a file aged 181 days is a `stale` finding and one aged 180 is not; with `memory.cleanup.staleDays` = 90 in `settings.json`, a file aged 91 days is `stale` and one aged 90 is not (AC 10, amendment 14)
Proof: `npx vitest run tests/cleanup.scan.test.ts -t "C18 "`
Proof: `npx vitest run tests/cleanup.layer.test.ts -t "C18 "`

**C19** - A note aged 2 days whose front matter has `last_reviewed: <now - 200 days>` is a `stale` finding whose `detail` names that date; one with `last_reviewed: <now - 10 days>` and `mtime` 200 days old is `stale` by its `mtime`; one with `last_reviewed: ontem` and `mtime` 2 days old is not `stale`; one with `review_every: 7d` and `mtime` 30 days old is not `stale` (the rule reads `fields.last_reviewed`, never `review_every`) (AC 10, amendments 6 and 8)
Proof: `npx vitest run tests/cleanup.layer.test.ts -t "C19 "`

**C20** - A Markdown note of the scope with no `note_links` link in either direction that resolves is an `orphan` finding; a note reached only by a `[[wikilink]]` from another note, and the note that holds it, are not; a `.pdf` with no link is never `orphan`; a note whose only link points to a file today's policy excludes is `orphan` (AC 11, amendment 2)
Proof: `npx vitest run tests/cleanup.layer.test.ts -t "C20 "`

**C21** - A note holding `[[nao-existe]]` on line 4 and `[x](./sumiu.md)` on line 9 gives two `broken-link` findings, one per link, whose `detail` carries the target and the line (4 and 9); for that note `GET /api/memory/links?id=<id>` answers `outgoing[].resolved` `null` for exactly those two targets; a link that resolves gives no finding (AC 11, amendments 2 and 10)
Proof: `npx vitest run tests/cleanup.scan.test.ts -t "C21 "`

**C22** - In the scope, a folder `vazia/` with nothing in it, and a folder `pai/` holding only the empty `pai/oca/`, are each one `empty-folder` finding; a folder holding one indexed file is none; the folders are listed through `listWorkspaceDir` (AC 12)
Proof: `npx vitest run tests/cleanup.layer.test.ts -t "C22 "`

**C23** - With no `memory.cleanup`, a file of 5 242 881 bytes is a `large-file` finding and one of 5 242 880 is not; with `memory.cleanup.largeBytes` = 1 048 576, a file of 1 048 577 bytes is `large-file` (AC 12, amendment 14)
Proof: `npx vitest run tests/cleanup.layer.test.ts -t "C23 "`

**C24** - A `.md` with no front matter `title` and no line starting with `# ` is an `untitled` finding; one with `title: Plano` is not; one with `# Plano` is not; a `.txt` with neither is never `untitled` (AC 12, amendment 6)
Proof: `npx vitest run tests/cleanup.layer.test.ts -t "C24 "`

**C25** - Every finding's `key` is `<kind>:` followed by 64 lowercase hex characters; two scans over unchanged members give the same key; changing one byte of one member of a `duplicate` gives a different key in the next scan (AC 13, door 3)
Proof: `npx vitest run tests/cleanup.layer.test.ts -t "C25 "`

**C26** - One asserted case per stored decision on a finding's key in its scope: `keep` hides it from the next scan, `archive` hides it, `merge` hides it, `snooze` with `until` = now + 1 day hides it, `snooze` with `until` = now - 1 day reports it, `unsure` reports it; a `keep` stored under another scope hides nothing here; after one member changes its bytes, a finding under `keep` is reported again with its new key (AC 13, AC 21)
Proof: `npx vitest run tests/cleanup.layer.test.ts -t "C26 "`
Proof: `npx vitest run tests/cleanup.scan.test.ts -t "C26 "`

**C27** - A scope of `<home>/memory` whose only candidates are files under `memory/archive/`, `memory/ROUTER.md`, `memory/areas/`, `memory/journal/` and `memory/contexts/` (each an orphan, untitled and 400 days old) gives no finding, one asserted case per place; a note under `memory/maps/` and one under `memory/inbox/` with the same traits give findings; a file today's policy excludes gives none (AC 14, amendment 5)
Proof: `npx vitest run tests/cleanup.layer.test.ts -t "C27 "`

**C28** - While a scan of a scope runs, a second `POST /api/memory/cleanup/scans` for the same scope answers `409 scan_running` with the running `scanId` in the body, and one for another scope answers `202` with another `scanId` (AC 15)
Proof: `npx vitest run tests/cleanup.scan.test.ts -t "C28 "`

**C29** - While a test holds the exclusive restore lock, `POST /api/memory/cleanup/scans` answers `409 restore_in_progress` and starts nothing; while a scan runs, an exclusive acquire with a 0 ms wait fails; after the scan finishes, and after a scan that failed, the exclusive acquire succeeds (AC 15, AC 16)
Proof: `npx vitest run tests/cleanup.scan.test.ts -t "C29 "`

**C30** - A scan over 3 000 indexed files lets a `setImmediate` callback scheduled right after `POST /scans` run before `cleanup.finished`, and its `signatures` progress events advance `done` by at most 200 at a time (AC 16)
Proof: `npx vitest run tests/cleanup.scan.test.ts -t "C30 "`

**C31** - When the scan fails during `links` (the test makes `note_links` unreadable after `signatures`), the bus carries `cleanup.failed` `{ scanId, code }` with a non-empty `code`, `GET /scans/:id` answers `status: "failed"` with the same `code`, and every `file_minhash` row written before the failure is still there (AC 17)
Proof: `npx vitest run tests/cleanup.scan.test.ts -t "C31 "`

**C32** - `GET /api/settings` of a fresh home answers `memory.cleanup` = `{ staleDays: 180, largeBytes: 5242880 }`; `PUT /api/settings {memory:{cleanup:{staleDays:90}}}` stores `memory.cleanup` = `{ staleDays: 90, largeBytes: 5242880 }` and keeps `memory.notes.fixedStructure`, `memory.journalBudgetTokens`, `memory.agentStance` and `memory.embeddings` at their earlier values; `staleDays: 0` and `largeBytes: -1` answer `400 validation` (AC 10, AC 12, amendment 14)
Proof: `npx vitest run tests/cleanup.scan.test.ts -t "C32 "`

### S3 - perguntar e decidir: a rota das decisões (plan S3) · 3 files · 50 KB · ~13k

**C33** - `PUT /api/memory/cleanup/decisions {scanId, decisions:[{key, decision:"keep"}]}` answers `200 { saved: 1 }` and stores one `cleanup_decisions` row with that scope, key, `decision` `keep`, `keep_file_id` and `until` `NULL` and `decided_at` = now; sending `archive` for the same key replaces the row (one row, `decision` `archive`) (AC 20, door 3)
Proof: `npx vitest run tests/cleanup.decisions.test.ts -t "C33 "`

**C34** - `{decision:"merge", keepFileId:<id of the newest member>}` on a `duplicate` finding stores `decision` `merge` with `keep_file_id` = that id (AC 19)
Proof: `npx vitest run tests/cleanup.decisions.test.ts -t "C34 "`

**C35** - Each refused entry answers `400 validation` for its own reason, alone in a request whose other entries are valid, and the request stores nothing: a key the scan did not report, `decision: "delete"`, `merge` without `keepFileId`, `merge` with a `keepFileId` that is not a member of the finding, `merge` on an `orphan` finding, `snooze` without `until`, `snooze` with `until` = now - 1 s (AC 25, amendment 16)
Proof: `npx vitest run tests/cleanup.decisions.test.ts -t "C35 "`
Proof: `npx vitest run tests/cleanup.layer.test.ts -t "C35 "`

**C36** - `PUT /decisions` with an unknown `scanId` answers `404 not_found`; after a second scan of the same scope has started, a `PUT /decisions` naming the first scan answers `409 scan_stale` and stores nothing (AC 25, amendment 12)
Proof: `npx vitest run tests/cleanup.decisions.test.ts -t "C36 "`

**C37** - One `PUT /decisions` carrying `archive` for each of the 14 `stale` findings of a scan answers `{ saved: 14 }` and stores 14 rows (AC 22)
Proof: `npx vitest run tests/cleanup.decisions.test.ts -t "C37 "`

### S4 - aplicar e desfazer (plan S4) · 8 files · 112 KB · ~28k

**C38** - `moveWorkspaceFile(scope, from, to, { expectSha256 })` on one device moves the file by `rename`: afterwards `to` holds the original bytes with the original inode and `from` does not exist; missing parent folders of `to` are made (door 1)
Proof: `npx vitest run tests/cleanup.move.test.ts -t "C38 "`

**C39** - `moveWorkspaceFile` refuses, each case alone and leaving `from` and `to` byte for byte as they were: a symbolic link as `from`, a link on the way to `to` (a folder of `to` that is a link), an existing `to` (`EEXIST`, a dangling link included), and a `from` whose bytes do not hash to `expectSha256` (the hash is read on the open descriptor: a file swapped after `open` is refused too) (AC 29, door 1)
Proof: `npx vitest run tests/cleanup.move.test.ts -t "C39 "`

**C40** - When `rename` fails with `EXDEV` (simulated), `moveWorkspaceFile` writes `to` with `writeWorkspaceFile(..., { mode: "create" })`, checks the copy's hash and only then removes `from`; when the copy's hash is made to differ, `from` is never removed and `to` holds no unconfirmed copy (door 1, AC 33)
Proof: `npx vitest run tests/cleanup.move.test.ts -t "C40 "`

**C41** - `POST /api/memory/cleanup/apply {scanId}` after `archive` answers on `memory/notes/clientes/a.md` and `memory/notes/b.md` answers `200` with `manifest` = `<home>/memory/archive/<AAAA-MM-DD>-<8 hex>/manifest.json`, `moved` naming the two, and the files at `<that folder>/notes/clientes/a.md` and `<that folder>/notes/b.md`; `manifest.json` equals `{ v: 1, createdAt, scope, entries: [{ from, to, sha256, size }, …] }` exactly (`toEqual`, one entry per move with the bytes' SHA-256 and size) (AC 27, door 4)
Proof: `npx vitest run tests/cleanup.apply.test.ts -t "C41 "`

**C42** - Between the scan and the apply one archived file gets a byte appended and another is deleted: `skipped` lists them with `reason` `changed` and `missing`, both stay where they are, and the third file is moved (AC 28)
Proof: `npx vitest run tests/cleanup.apply.test.ts -t "C42 "`

**C43** - A file reached through a symbolic link on the way, and a file whose destination already exists in the archive folder, are listed in `skipped` with `reason` `forbidden_path` and `exists`; both origin and destination are unchanged byte for byte (AC 29)
Proof: `npx vitest run tests/cleanup.apply.test.ts -t "C43 "`

**C44** - With `archive` answers on two files of an indexed folder outside `memory/`, the apply moves and writes nothing in that folder (a hash of every file and folder name under it is the same before and after), writes `<home>/artifacts/cleanup/<AAAA-MM-DD>-<id>.md` holding one line `- [ ] <path> — <decision> — <reason>` per file, returns its path in `proposals`, and creates or changes no file outside `memory/archive/` and `artifacts/cleanup/` (AC 30, amendment 9)
Proof: `npx vitest run tests/cleanup.apply.test.ts -t "C44 "`

**C45** - With a `merge` keeping the newest of three duplicates under `memory/notes/`, the apply leaves the kept file where it is and moves the other two to the archive folder (AC 19, AC 27)
Proof: `npx vitest run tests/cleanup.apply.test.ts -t "C45 "`

**C46** - After the apply, the indexer is asked to index every origin and every destination path (`requestIndexPaths` receives the four paths of two moves); once `index.finished` is announced, `GET /api/memory/search?q=<a word of a.md>` finds it under `memory/archive/…` and not at its origin, the next scan reports neither file, and `GET /api/memory/maps?root=memory` answers the origin folder, whose `_index.md` was `fresh` before the apply, as `stale` and no folder under `memory/archive/` (AC 31, amendment 15)
Proof: `npx vitest run tests/cleanup.apply.test.ts -t "C46 "`

**C47** - `POST /apply` answers `404 not_found` for an unknown `scanId`, `409 scan_running` while the scan runs, `409 scan_stale` for a scan another scan of the scope replaced, and `409 restore_in_progress` while a test holds the exclusive restore lock; none moves a file (amendment 12)
Proof: `npx vitest run tests/cleanup.apply.test.ts -t "C47 "`

**C48** - `POST /api/memory/cleanup/undo {manifest}` for a manifest of three moves, after one archived file got a byte appended, one was deleted from the archive and one is untouched, moves the untouched one back to `from` (its bytes intact), answers `restored` with it and `skipped` with `changed` and `missing`; with an untouched one whose `from` now exists the reason is `exists`; the archive folder is removed only when the undo leaves it empty (AC 32)
Proof: `npx vitest run tests/cleanup.apply.test.ts -t "C48 "`

**C49** - `POST /undo` answers `400 validation` for a path outside `memory/archive/`, for `memory/archive/<x>/outro.json`, and for `memory/archive/../notes/manifest.json`; `404 not_found` for a `manifest.json` under `memory/archive/` that does not exist; `409 undo_conflict` for a manifest with `v: 2`; `409 restore_in_progress` while the exclusive lock is held; none moves a file (AC 34, amendment 12)
Proof: `npx vitest run tests/cleanup.apply.test.ts -t "C49 "`

**C50** - Walking the TypeScript syntax tree of the new cleanup modules and of `moveWorkspaceFile`, the only calls that remove a name are one `unlink` of `from` inside `moveWorkspaceFile`, reached only after the copy's hash check, and one `rmdir` of an empty archive folder in the undo; the walker's self-tests find `fs.unlinkSync`, `fs.rmSync`, `fs.promises.rm` and a destructured `unlink`, and ignore the word in a comment or a string (AC 33)
Proof: `npx vitest run tests/cleanup.layer.test.ts -t "C50 "`

### S5 - o assistente na tela (plan S1, S3, S4, S5) · 15 files · 205 KB · ~51k

**C51** - The four entries, each with its order asserted: in the `ContextSelector` menu, with a context active, "Fazer faxina neste contexto" is the first item after the actions separator and before "Novo contexto…", and choosing it opens the wizard at step 2 with that context; with "Todo o cérebro" active the item is absent; in the moldura's graph, "Faxina" is the third `.btn.sm` of `.brain-topbar-actions`, after "Atualizar índice" and "Modo apresentação (p)" (their accessible names) and before the `os-chip`s; in the Núcleo's brain scene menu "Faxina" is the last row of `bs-menu-acts`, after "Salvar como visão padrão"; the palette's "Faxina guiada" and both "Faxina" buttons open at step 1 with the active context preselected, and none preselected with "Todo o cérebro" (AC 36, amendment 11)
Proof: `npm run test -w apps/command-centre -- src/brain/cleanup/cleanupEntries.test.tsx -t "C51 "`
Proof: `MORDOMO_E2E_PORT=4901 npx playwright test --config tests/e2e/playwright.config.ts cleanup.spec.ts -g "C51 "`

**C52** - The command registry holds "Faxina guiada" with scope `global` and `palette: true`; the keyboard-listener reader of `commands.source.test.ts` finds no new listener (AC 44)
Proof: `npm run test -w apps/command-centre -- src/brain/cleanup/cleanupEntries.test.tsx -t "C52 "`
Proof: `npm run test -w apps/command-centre -- src/commands/commands.source.test.ts -t "C16 the reader sees every way to listen on the page, and only those"`

**C53** - The wizard is one `Modal` (focus enters it, Esc closes it, focus returns to the opener) whose fixed header holds, top to bottom, the title "Faxina guiada", the scope (the context's name, or the folder's path in the mono 12px class) and the step bar: five numbered circles in the order "Escopo", "O que tem aqui", "Achados", "Conferir", "Pronto", the current one with `aria-current="step"`, the completed ones with the `Check` icon; the current step also reads "Etapa 2 de 5 · O que tem aqui"; the fixed footer holds, left to right, "Fechar", "Voltar" (`.btn`) and the step's action (`.btn.primary`) (AC 36)
Proof: `npm run test -w apps/command-centre -- src/brain/cleanup/CleanupWizard.test.tsx -t "C53 "`

**C54** - Step 1 lists the contexts (name, main path, file count) above the field "Ou uma pasta…" with the indexed folders; a chosen item shows "N arquivos, última mudança há D dias" and enables "Ver o que tem aqui"; with no context and no indexed folder the step shows "Nada indexado ainda. Adicione uma pasta em Configurações › Pastas." and no action (design.md "Etapa 1")
Proof: `npm run test -w apps/command-centre -- src/brain/cleanup/CleanupWizard.test.tsx -t "C54 "`

**C55** - Step 2 shows the cards in the order "Arquivos" (total and bytes), "Por tipo" (six bars in the order notas, texto, PDF, imagem, código, outros, each with its number), "Idade" (four columns in band order, the number above each; the "mais de um ano" column carries the warning token's class and the word "parados"), "Maiores pastas" (ten rows, name, size and a bar) and "Grupos" (up to twelve pills, name and count); the grid has two columns at 1 280 px and one at 600 px; while the inventory loads, the card skeletons with a spinner and "Lendo o índice…" (AC 1, AC 5, design.md "Etapa 2")
Proof: `npm run test -w apps/command-centre -- src/brain/cleanup/CleanupInventory.test.tsx -t "C55 "`
Proof: `MORDOMO_E2E_PORT=4901 npx playwright test --config tests/e2e/playwright.config.ts cleanup.spec.ts -g "C55 "`

**C56** - With motion allowed, the "Arquivos" number reads 0 on the first frame after the inventory arrives and its final value 300 ms later (`useTweenNumber`, fake timers); under `prefers-reduced-motion: reduce` it reads the final value on the first frame (AC 6)
Proof: `npm run test -w apps/command-centre -- src/brain/cleanup/CleanupInventory.test.tsx -t "C56 "`

**C57** - While a scan runs, below the cards the wizard shows the phase as text, one asserted case per phase ("Lendo o índice", "Calculando assinaturas", "Conferindo links", "Separando achados"), `done/total` as "120/3000", a progress bar with `aria-valuenow` = `done` and `aria-valuemax` = `total`, and "Cancelar" (AC 37)
Proof: `npm run test -w apps/command-centre -- src/brain/cleanup/CleanupInventory.test.tsx -t "C57 "`

**C58** - Step 3 shows `Tabs` in the order Duplicatas, Quase iguais, Parados, Órfãs, Links quebrados, Pastas vazias, Grandes, Sem título, each named with its count ("Parados (14)"); a kind with no finding has no tab (with findings of three kinds, three tabs in that relative order) (AC 18, design.md "Etapa 3")
Proof: `npm run test -w apps/command-centre -- src/brain/cleanup/CleanupFindings.test.tsx -t "C58 "`

**C59** - One rendered card per kind, eight cases: each card holds, top to bottom, the kind's icon with the reason in one sentence ("Não muda há 410 dias." for `stale`, "92% igual a `plano-v2.md`." for `near-duplicate`, and the kind's sentence for the other six), then the files (name, folder, age, size), then the answers as one row in the order "Manter", "Arquivar", "Juntar", "Revisar depois", "Não sei", with "Juntar" only on `duplicate` and `near-duplicate`; no card offers an answer that rewrites a note (AC 18, amendment 10)
Proof: `npm run test -w apps/command-centre -- src/brain/cleanup/CleanupFindings.test.tsx -t "C59 "`

**C60** - Choosing "Juntar" shows a radio "Manter este" per file with the newest checked; confirming sends `{key, decision:"merge", keepFileId:<the checked file's id>}` (AC 19)
Proof: `npm run test -w apps/command-centre -- src/brain/cleanup/CleanupFindings.test.tsx -t "C60 "`

**C61** - Answering a card sends `PUT /api/memory/cleanup/decisions` and the card stays in place until it answers `200`; then it shows the chosen answer with an icon and text, "Respondido", and moves below the unanswered cards; the tab's top reads "1 de 14 respondidos" beside "Aplicar a todos deste tipo" (AC 20, design.md "Etapa 3")
Proof: `npm run test -w apps/command-centre -- src/brain/cleanup/CleanupFindings.test.tsx -t "C61 "`

**C62** - When the decision request fails, the card stays unanswered where it was with "Não foi possível guardar a resposta." and "Tentar de novo", and "Tentar de novo" sends the same request again (AC 20)
Proof: `npm run test -w apps/command-centre -- src/brain/cleanup/CleanupFindings.test.tsx -t "C62 "`

**C63** - "Revisar depois" sends `decision: "snooze"` with `until` = now + 30 days (fake clock, to the millisecond); "Não sei" sends `decision: "unsure"` with no `until` (AC 21)
Proof: `npm run test -w apps/command-centre -- src/brain/cleanup/CleanupFindings.test.tsx -t "C63 "`

**C64** - "Aplicar a todos deste tipo" with "Arquivar" on the "Parados (14)" tab sends one `PUT /decisions` with 14 entries, every one `archive`, and the tab then reads "14 de 14 respondidos" (AC 22)
Proof: `npm run test -w apps/command-centre -- src/brain/cleanup/CleanupFindings.test.tsx -t "C64 "`

**C65** - Below the tabs, the box "O que importa aqui?" is a three-row `<textarea>` in the 13px class with "Vai para a nota-resumo do contexto." and "Guardar"; "Guardar" reads the brief with `GET /api/memory/note` and sends `PUT /api/memory/notes` with its `version` as `baseVersion` and a content where the text is the last paragraph of the `## O que importa` section, before `## Metas`, every other byte as it was (a fixture with CRLF line ends and no final newline); a brief with no such section gets `## O que importa` and the text at the end; a `409 edit_conflict` keeps the text in the box and shows "Carregar de novo" (AC 23, amendment 7)
Proof: `npm run test -w apps/command-centre -- src/brain/cleanup/CleanupFindings.test.tsx -t "C65 "`

**C66** - For a `dir` scope, and for a context whose `brief` is `null`, the box is disabled with "Este escopo não tem nota-resumo." and the wizard sends no `PUT /api/memory/notes` and no `PATCH /api/contexts/:id` (AC 24, amendment 7)
Proof: `npm run test -w apps/command-centre -- src/brain/cleanup/CleanupFindings.test.tsx -t "C66 "`

**C67** - A scan with no finding shows the `Sparkles` icon, "Nada para decidir aqui. Este contexto está em ordem." and the action "Fechar", with the inventory cards still on screen, and the step bar never reaches "Conferir" (AC 38)
Proof: `npm run test -w apps/command-centre -- src/brain/cleanup/CleanupWizard.test.tsx -t "C67 "`

**C68** - Step 4 lists "Vai para o arquivo (N)" above "Propostas para você fazer (N)", the totals on top, one line per file: origin (mono 12px), an arrow, destination (mono 12px) or "proposta", and the decision as text; with every answer "Manter" or "Não sei" it shows "Nenhuma mudança a aplicar. As respostas ficaram guardadas." and the action "Fechar" (AC 26, design.md "Etapa 4")
Proof: `npm run test -w apps/command-centre -- src/brain/cleanup/CleanupReview.test.tsx -t "C68 "`

**C69** - Step 5 shows three numbers in the order movidos, pulados, propostas, the skipped list with each reason translated, one asserted case per reason (`changed` "mudou depois da varredura", `missing` "não existe mais", `exists` "o destino já existe", `forbidden_path` "caminho com link"), "Abrir a lista de propostas" only with proposals, and "Desfazer" (`.btn`) before "Fechar" (`.btn.primary`); "Desfazer" sends `POST /api/memory/cleanup/undo` with the apply's `manifest`, and then the step reads "Desfeito: 2 arquivos voltaram." with the undo's skipped files and reasons (AC 35, design.md "Etapa 5")
Proof: `npm run test -w apps/command-centre -- src/brain/cleanup/CleanupReview.test.tsx -t "C69 "`

**C70** - When the inventory, the scan or the apply fails, the step shows a band with `role="alert"`, the `AlertTriangle` icon, "A faxina falhou." with the failure, and "Tentar de novo", one asserted case per failure; after a failed scan the answers already stored are still answered when the next scan's cards come (AC 39, design.md "Estados de erro")
Proof: `npm run test -w apps/command-centre -- src/brain/cleanup/CleanupWizard.test.tsx -t "C70 "`

**C71** - After answering 2 of 5 cards and closing the wizard, reopening it on the same scope 1 hour later opens at "Achados" ("Etapa 3 de 5 · Achados") with the 3 unanswered cards; reopening 25 hours later starts at "O que tem aqui" with a new scan, whose cards leave out the 2 decided findings (AC 40)
Proof: `npm run test -w apps/command-centre -- src/brain/cleanup/CleanupWizard.test.tsx -t "C71 "`

**C72** - Every `animation` and `transition` of the wizard's stylesheet sits inside `@media (prefers-reduced-motion: no-preference)` (the reader of `ui/ui.source.test.ts` C15 run on it): the bars grow by `transform: scaleY`/`scaleX` in 240 ms `ease-out` with 40 ms between them, a step enters by 12px and `opacity` in 200 ms, an answered card folds in 200 ms; with motion reduced and allowed, every step and state renders the same text and icons (AC 41, design.md "Movimento")
Proof: `npm run test -w apps/command-centre -- src/brain/cleanup/cleanupMotion.test.ts -t "C72 "`

**C73** - "Cancelar" while a scan runs closes the wizard, sends no `POST /apply` and no `PUT /decisions`, and shows "Varredura cancelada." once in a `role="status"` notice; "Procurar de novo" is drawn nowhere (AC 37, amendment 17)
Proof: `npm run test -w apps/command-centre -- src/brain/cleanup/CleanupWizard.test.tsx -t "C73 "`

### Cross-cutting

**C74** - The six routes are in the `API` table exactly as door 5 says (`toEqual` over method, path and scope: `owner` for `POST /scans`, `PUT /decisions`, `POST /apply`, `POST /undo`; `content` for `GET /inventory` and `GET /scans/:id`), declare `400 scope_required`, `404 context_not_found`, `409 scan_running`, `409 scan_stale`, `409 restore_in_progress` and `409 undo_conflict` where the claims above answer them, are in `EXPECTED_ROUTE_SCOPES`, in their rows of `docs/security.md`, and each has a scenario of the refusal probe; the OpenAPI document validates; `docs/events.md` equals the generated text (AC 45, door 5, amendment 4)
Proof: `npx vitest run tests/cleanup.contract.test.ts -t "C74 "`
Proof: `npx vitest run tests/api.openapi.test.ts -t "C16 the document validates"`
Proof: `npx vitest run tests/events.contract.test.ts -t "C29 docs/events.md equals the generated text"`

**C75** - A device token holding `content` gets `200` from `GET /inventory` and `GET /scans/:id`, and one holding only `monitor` gets `403 scope_required` from both; a device token with every scope gets `403 owner_only` from `POST /scans`, `PUT /decisions`, `POST /apply` and `POST /undo`, and no row, file or manifest changes (AC 46)
Proof: `npx vitest run tests/cleanup.contract.test.ts -t "C75 "`

**C76** - The credential of a memory skill's run gets `403 forbidden` from each of the six routes, `GET /inventory` and `GET /scans/:id` included; `RUN_API_READ_ROUTES` and `RUN_API_WRITE_ROUTES` are unchanged (AC 46, amendment 12)
Proof: `npx vitest run tests/cleanup.contract.test.ts -t "C76 "`

**C77** - `EVENT_VERSIONS` holds `cleanup.progress`, `cleanup.finished` and `cleanup.failed` with `[1]`, each has a v1 fixture that parses, and an emission off the schema (`phase: "other"`) is refused by the bus's check (door 6)
Proof: `npx vitest run tests/cleanup.contract.test.ts -t "C77 "`
Proof: `npx vitest run tests/events.contract.test.ts -t "C27 the v1 fixtures keep parsing"`

**C78** - The raw `fs` allowlist and the module-state list do not grow: the new modules read through `openWorkspaceFile`/`readWorkspaceFile`/`listWorkspaceDir` and write through `writeWorkspaceFile`/`moveWorkspaceFile` (AC 47)
Proof: `npx vitest run tests/security-reads.test.ts -t "C55 the list holds 70 rows"`
Proof: `npx vitest run tests/security-reads.test.ts -t "finds nothing outside the list"`
Proof: `npx vitest run tests/sdk.instances.test.ts -t "C30 the module-level mutable state"`

**C79** - `GET /api/memory/hygiene` answers as before, by value: `counts` has the six keys `orphan`, `dangling-link`, `stale`, `skill-never-run`, `silent-routine`, `unused-connector`, `thresholds.staleDays` is 90 with no `memory.cleanup` and still 90 with `memory.cleanup.staleDays` = 180, and a file aged 100 days is a `stale` item (Impact, "higiene")
Proof: `npx vitest run tests/cleanup.contract.test.ts -t "C79 "`

**C80** - In the light and the dark theme and in the moldura and the Núcleo, the wizard at each of its five steps has no text under 12px and its prose at 13px, marks every state with an icon and text, and axe at WCAG A/AA reports no `serious` or `critical` violation on the whole page; the repository's stylelint config (tokens only) reports no warning on the wizard's stylesheet, run programmatically as `typography.test.ts` runs it (AC 42)
Proof: `MORDOMO_E2E_PORT=4901 npx playwright test --config tests/e2e/playwright.config.ts cleanup.spec.ts -g "C80 "`
Proof: `npm run test -w apps/command-centre -- src/brain/cleanup/cleanupMotion.test.ts -t "C80 "`

**C81** - The component gallery has a cleanup-wizard entry (the step bar, an inventory card, a finding card of each answer row, the review list), and in both themes it has no `serious` or `critical` axe violation (AC 42, design-system "a galeria cobre as duas camadas")
Proof: `MORDOMO_E2E_PORT=4901 npx playwright test --config tests/e2e/playwright.config.ts cleanup.spec.ts -g "C81 "`

**C82** - The wizard is reached from both entries (`main.tsx`, `gallery/main.tsx`) only by a dynamic `import()`; `scripts/bundle-baseline.json` gains a `cerebro-faxina-guiada` entry after `cerebro-vista-notas` with a reason of more than 40 characters and the four numbers, at most 12 KB of JS gzip and 2 KB of CSS gzip above `cerebro-vista-notas` (534 932 B and 74 679 B); `bundle:check` exits 0 (AC 43, amendment 13)
Proof: `npx vitest run tests/cleanup.contract.test.ts -t "C82 "`
Proof: `npx vitest run tests/bundle-size.test.ts -t "C31 a build within 5% of the latest recorded one passes"`
Proof: `npm run bundle:check`

**C83** - Every row of design.md's "Texto" table (27 rows) is a key of `en` and `ptBR` in `locales/brain.ts` with that text, and both locales hold the same keys (design.md, "Texto")
Proof: `npm run test -w apps/command-centre -- src/brain/cleanup/cleanupCopy.test.ts -t "C83 "`

## Coverage

| Set (size)                                               | Member -> proof                                                                                                                                                                                                                                                                                          | Unproven |
| -------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| `GET /api/memory/cleanup/inventory` statuses (3)         | 200 C1 · 400 C8, C9 · 404 C9                                                                                                                                                                                                                                                                             | -        |
| `POST /api/memory/cleanup/scans` statuses (4)            | 202 C10 · 400 C9 · 404 C9 · 409 C28, C29                                                                                                                                                                                                                                                                 | -        |
| `GET /api/memory/cleanup/scans/:id` statuses (2)         | 200 C11 · 404 C11                                                                                                                                                                                                                                                                                        | -        |
| `PUT /api/memory/cleanup/decisions` statuses (4)         | 200 C33 · 400 C35 · 404 C36 · 409 C36                                                                                                                                                                                                                                                                    | -        |
| `POST /api/memory/cleanup/apply` statuses (3)            | 200 C41 · 404 C47 · 409 C47                                                                                                                                                                                                                                                                              | -        |
| `POST /api/memory/cleanup/undo` statuses (4)             | 200 C48 · 400 C49 · 404 C49 · 409 C49                                                                                                                                                                                                                                                                    | -        |
| named error codes, as (status, code) pairs (9)           | `400 scope_required` C8, C9 · `404 context_not_found` C9 · `400 validation` C9, C35, C49 · `404 not_found` C11, C36, C47, C49 · `409 scan_running` C28, C47 · `409 scan_stale` C36, C47 · `409 restore_in_progress` C29, C47, C49 · `409 undo_conflict` C49 · `403 scope_required` (device) C75          | -        |
| routes that take a `scanId` (3)                          | `GET /scans/:id` C11 · `PUT /decisions` C33, C36 · `POST /apply` C41, C47                                                                                                                                                                                                                                | -        |
| doors of Landing (6)                                     | 1 C38, C39, C40 · 2 C14, C15, C16 · 3 C17, C25, C33 · 4 C41, C48 · 5 C74 · 6 C10, C77                                                                                                                                                                                                                    | -        |
| stored shapes (4)                                        | `file_minhash` C15 · `cleanup_decisions` C17 · `manifest.json` C41 · `settings.memory.cleanup` C32                                                                                                                                                                                                       | -        |
| startup config: `memory.cleanup` thresholds (1 assembly) | the service (`AppContext`, behind every cleanup route) C18, C23, C32                                                                                                                                                                                                                                     | -        |
| scope kinds (7)                                          | context C1, C7 · `dir` in an indexed folder C8 · `dir` under `memory/` C8 · `dir` outside every root C8 · none C9 · `context=all` C9 · `context` and `dir` C9                                                                                                                                            | -        |
| context path states (3)                                  | `ok` C7 · `missing` C7 · notes folder C7                                                                                                                                                                                                                                                                 | -        |
| `byKind` groups (6)                                      | `notes` C2 · `text` C2 · `pdf` C2 · `image` C2 · `code` C2 · `other` C2                                                                                                                                                                                                                                  | -        |
| `byAge` bands with their edges (4)                       | 0-30 C3 · 31-90 C3 · 91-365 C3 · over 365 C3                                                                                                                                                                                                                                                             | -        |
| cluster modes (2)                                        | by first-level subfolder C5 · by `file_related` ≥ 0.3 C5                                                                                                                                                                                                                                                 | -        |
| rows refused by today's policy (2)                       | user exclude C6, C27 · secret name C6                                                                                                                                                                                                                                                                    | -        |
| finding kinds (8)                                        | `duplicate` C12, C59 · `near-duplicate` C13, C59 · `stale` C18, C19, C59 · `orphan` C20, C59 · `broken-link` C21, C59 · `empty-folder` C22, C59 · `large-file` C23, C59 · `untitled` C24, C59                                                                                                            | -        |
| stale sources (3)                                        | `mtime` C18 · `last_reviewed` C19 · `review_every` ignored C19                                                                                                                                                                                                                                           | -        |
| decisions (5)                                            | `keep` C26, C33 · `archive` C26, C33, C41 · `merge` C26, C34, C45 · `snooze` C26, C63 · `unsure` C26, C63                                                                                                                                                                                                | -        |
| decision refusals (7)                                    | unknown key C35 · decision outside five C35 · merge without id C35 · id outside finding C35 · merge on other kind C35 · snooze without until C35 · until past C35                                                                                                                                        | -        |
| places the scan ignores (5)                              | `memory/archive/` C27 · `ROUTER.md` C27 · `areas/` C27 · `journal/` C27 · `contexts/` C27                                                                                                                                                                                                                | -        |
| scan phases (4)                                          | `inventory` C10, C57 · `signatures` C10, C30, C57 · `links` C10, C31, C57 · `findings` C10, C57                                                                                                                                                                                                          | -        |
| events (3)                                               | `cleanup.progress` C10, C77 · `cleanup.finished` C10, C77 · `cleanup.failed` C31, C77                                                                                                                                                                                                                    | -        |
| restore lock states (3)                                  | exclusive held elsewhere C29, C47, C49 · shared held by a running scan C29 · released after finish and failure C29                                                                                                                                                                                       | -        |
| apply skip reasons (4)                                   | `changed` C42, C69 · `missing` C42, C69 · `forbidden_path` C43, C69 · `exists` C43, C69                                                                                                                                                                                                                  | -        |
| undo skip reasons (3)                                    | `changed` C48 · `missing` C48 · `exists` C48                                                                                                                                                                                                                                                             | -        |
| `moveWorkspaceFile` paths (6)                            | same device C38 · link as origin C39 · link on the way C39 · destination exists C39 · hash differs C39 · other device C40                                                                                                                                                                                | -        |
| entry points that move or write a user file (2)          | `POST /apply` C41, C44 · `POST /undo` C48, and no other call removes a name C50                                                                                                                                                                                                                          | -        |
| apply side effects (4)                                   | moves C41 · manifest C41 · proposals C44 · index request C46                                                                                                                                                                                                                                             | -        |
| wizard entries (4)                                       | `ContextSelector` menu C51 · palette C51, C52 · moldura button C51 · Núcleo menu row C51                                                                                                                                                                                                                 | -        |
| wizard steps (5)                                         | Escopo C53, C54 · O que tem aqui C53, C55 · Achados C53, C58 · Conferir C53, C68 · Pronto C53, C69                                                                                                                                                                                                       | -        |
| wizard states (11)                                       | nothing indexed C54 · inventory loading C55 · scan running C57 · no finding C67 · save failed C62 · brief conflict C65 · no brief C66 · no changes C68 · undone C69 · failure C70 · cancelled C73                                                                                                        | -        |
| answer rows (2 variants)                                 | with Juntar C59, C60 · without Juntar C59                                                                                                                                                                                                                                                                | -        |
| arrangements design.md and amendment 11 draw (12)        | menu item before Novo contexto C51 · third topbar button C51 · last row of bs-menu-acts C51 · header order C53 · step bar order C53 · footer order C53 · card order of step 2 C55 · two columns and one C55 · tab order C58 · card rows order C59 · answered card below C61 · Desfazer before Fechar C69 | -        |
| motion (4)                                               | numbers C56 · bars C72 · step change C72 · answered card C72                                                                                                                                                                                                                                             | -        |
| shells (2)                                               | moldura C51, C80 · Núcleo C51, C80                                                                                                                                                                                                                                                                       | -        |
| themes (2)                                               | light C80, C81 · dark C80, C81                                                                                                                                                                                                                                                                           | -        |
| design.md copy (27 rows)                                 | C83, table-driven over all 27                                                                                                                                                                                                                                                                            | -        |

- Claims naming a status code, route or response shape: C1, C8-C11, C21, C28, C29, C32-C37, C41-C49, C74-C77, C79 -
  each proven through `app.inject` against `buildServer`; C2-C7, C12-C20, C22-C27, C35, C50 also or only at their own layer,
  with no HTTP; C38-C40 at the primitive's own layer
- Claims about the screens: C51-C73, C83 in rendered components; C51, C55, C80, C81 also in a real browser, both shells
  where the claim names them

## Binding sources

| Source                                                                                                    | Checked by         |
| --------------------------------------------------------------------------------------------------------- | ------------------ |
| `cerebro-faxina-guiada/design.md` (the wizard, its steps, states, motion, copy)                           | C51, C53-C73, C83  |
| `design-system/design.md` (12px floor, 13px prose, tokens, state never by colour alone, axe, the gallery) | C55, C72, C80, C81 |
| `primitivas/design.md` (`Modal`, `Tabs`, animations inside `no-preference`)                               | C53, C58, C72      |
| `comandos-atalhos/design.md` (the registry, no listener outside it)                                       | C52                |
| `moldura-app/design.md` (the screen's action row, `.btn.sm`)                                              | C51                |
| `cerebro-v2/design.md` (error with "Tentar de novo", spinner with text, progress by phase in text)        | C55, C57, C62, C70 |
| `desktop/useTweenNumber.ts` (numbers that rise, final at once under reduced motion)                       | C56                |
| `cerebro-contextos/design.md` (the selector's menu this feature adds one item to)                         | C51                |

## Test policy

| Code                                                                                                                                  | Required proofs                                       | Coverage expectation                                                                                 |
| ------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| Decides, reached across a boundary (`cleanupInventory`, the scanner's finding rules, the decision rules, the apply planner, the undo) | one at the HTTP boundary **and** one at its own layer | the contract at the boundary; one asserted case per row of the decision table at its own layer       |
| Decides, not reached across a boundary (the MinHash and its recompute rule, `moveWorkspaceFile`'s branches, the no-removal walker)    | one at its own layer                                  | one asserted case per row                                                                            |
| Screens (the five steps, the cards, the entries)                                                                                      | one in rendered components per screen and state       | each state, arrangement and copy design.md names; both themes and both shells for axe in the browser |

Evidence:

- `cleanupInventory` (new): a mapping of six extension groups, four age bands with three edges, a top-10 cut, two cluster
  modes with a 0.3 edge and a 12 cap, the policy and the scope filters -> decides, ~16 branch points
- the scanner (new): eight finding kinds, two stale sources, a decision filter over five values plus `until`, five ignored
  places, the 3 000-file block rule, the lock and the failure path -> decides, ~25 branch points
- the decision rules (new): seven refusals and the upsert -> decides; the apply planner: four skip reasons, inside or
  outside `memory/`, `merge` -> decides; the undo: three skip reasons and four refusals -> decides
- `moveWorkspaceFile` (new, door 1): rename or copy, five refusals, the hash-before-remove order -> decides
- own layer: `tests/cleanup.layer.test.ts` and `tests/cleanup.move.test.ts` call those functions with no HTTP, as
  `tests/notesview.layer.test.ts`, `tests/contexts.layer.test.ts` and `tests/organize.layer.test.ts` do for the same shape
- closest analogue: `tests/memory.notes.test.ts` (`cerebro-v2` S1) and `tests/notesview.tree.test.ts`, the same rules
  proven at the boundary and in the core

Cost: 7 own-layer proofs files' worth of cases (about 30 tests across `tests/cleanup.layer.test.ts` and
`tests/cleanup.move.test.ts`). Without these rows, the scanner's eight kinds and the move's six paths are proven only by
the scans that happen to traverse them.

## Swept

- validation: C8, C9, C32, C35, C49
- failure modes: C31 (the scan fails, signatures kept), C42 and C43 (a file changed, gone, behind a link or with its destination taken), C40 (the copy's hash differs), C62 and C70 (the screens keep the answers)
- idempotency: C16 (a second scan rewrites no signature), C25 (the same members, the same key), C33 (the same key replaces its row), C48 (an undo moves back only what is still as it was left)
- authorization: C75 (`content` for the two reads, owner only for the four writes), C76 (a run's credential), C6 and C27 (today's policy), C44 (no write outside `memory/archive/` and `artifacts/cleanup/`)
- concurrency: C28 (one scan per scope), C29 (the restore lock, both modes), C36 and C47 (`scan_stale`), C30 (the loop yields)
- data lifecycle: C15 (signatures go with the file), C26 (`snooze` expires), C46 (the moves reach the index and the folder map), C48 (the archive folder goes when the undo empties it), C71 (24-hour resumption)
- dependency failure: C31 (the database fails mid-scan), C29 (a restore holds the home), C65 (the brief changed: `409 edit_conflict`)
- state transitions: C11 (`running` to `finished` or `failed`), C53 (the five steps), C67 and C68 (steps skipped when there is nothing), C69 (applied to undone)
- observability: C10 and C77 (`cleanup.progress`, `cleanup.finished`, `cleanup.failed` on the bus, with `docs/events.md` regenerated in C74)

## Handoff

The estimate exceeds the 150k budget, so the build stops here for the mechanism choice (`build.md`).

- Arithmetic (`wc -c` of the files each slice touches at `108f27f`, / 4; new files estimated):
  - S1: `contracts/src/api/memory.ts` 29 592, `apps/api/src/routes/memory.ts` 14 893, `core/src/memory/contexts.ts` 15 924,
    `core/src/memory/tree.ts` 13 324 (the rows-under-a-folder walk), `core/src/memory/indexer.ts` 41 534 (`rowFilter`,
    `storedRowFilter`, `requestIndexPaths`), `apps/api/src/routes/contexts.ts` 3 623, `core/src/internal.ts` 14 909, the new
    inventory module ≈ 8 000 = ≈ 142 KB → ≈ 35k
  - S2: `core/src/db/migrations.ts` 18 623, `core/src/memory/links.ts` 10 172, `core/src/memory/hygiene.ts` 8 106,
    `core/src/restoreLock.ts` 9 451, `core/src/memory/indexHost.ts` 16 498 (the lock and events pattern),
    `contracts/src/events.ts` 7 074, `contracts/src/eventSchemas.ts` 8 671, `contracts/src/eventRegistry.ts` 5 499,
    `contracts/src/settings.ts` 21 352, `core/src/security/safeFs.ts` 19 259, `core/src/memory/notes.ts` 20 208,
    `docs/events.md` 15 039, `tests/fixtures/events/v1/settings.changed.json` 4 283, `tests/data.settings.test.ts` 44 969
    (the settings leaf pin), the new scanner and MinHash ≈ 20 000 = ≈ 229 KB → ≈ 57k
  - S3: `contracts/src/api/memory.ts` 29 592 and `apps/api/src/routes/memory.ts` 14 893 again, the new decision rules
    ≈ 6 000 = ≈ 50 KB → ≈ 13k
  - S4: `core/src/security/safeWrite.ts` 19 679, `core/src/security/paths.ts` 3 210, `core/src/paths.ts` 7 382,
    `core/src/security/safeFs.ts` 19 259, the new apply and undo ≈ 12 000 and `moveWorkspaceFile` ≈ 6 000, the routes and the
    contract again 44 485 = ≈ 112 KB → ≈ 28k
  - S5: `locales/brain.ts` 21 322, `commands/registry.ts` 12 630, `commands/global.ts` 11 458,
    `contexts/ContextSelector.tsx` 6 669, `contexts/useWorkContext.ts` 2 700, `brain/BrainChrome.tsx` 10 295,
    `nucleo/scenes/BrainSceneMenu.tsx` 10 044, `nucleo/scenes/BrainScene.tsx` ≈ 15 000 of 70 924 (the menu's props, read in
    parts), `views/SecondBrain.tsx` 30 277, `ui/Dialog.tsx` 8 409, `ui/Tabs.tsx` 5 875, `ui/ui.css` 14 347, `queries.ts`
    8 868, `desktop/useTweenNumber.ts` 1 791, the new wizard, its steps and stylesheet ≈ 45 000 = ≈ 205 KB → ≈ 51k
  - cross-cutting, API (C74-C79): `tests/helpers/routeScopes.ts` 8 457, `tests/helpers/contractWorld.ts` 35 340,
    `tests/api.refusals.test.ts` 23 916, `docs/security.md` ≈ 15 000 of 66 565 (read in parts), `apps/api/src/server.ts`
    ≈ 10 000 of 44 090 (the credential lists), `contracts/src/api/errors.ts` 9 570, `tests/api.openapi.test.ts` 32 065,
    `tests/security-reads.test.ts` ≈ 10 000 of 101 206 (the pins), `tests/sdk.instances.test.ts` 21 846 = ≈ 166 KB → ≈ 42k
  - cross-cutting, screens (C80-C83): `gallery/main.tsx` 28 560, `gallery/gallery.css` 2 569, `scripts/bundle-baseline.json`
    3 823, `tests/e2e/a11y.spec.ts` 17 550, `tests/e2e/shell.ts` 11 753, `tests/e2e/notes-view.spec.ts` 26 478 (the model),
    `tests/bundle-size.test.ts` 10 659, `commands/commands.source.test.ts` 35 266 = ≈ 137 KB → ≈ 34k
  - slices alone ≈ 35k + 57k + 13k + 28k + 51k + 42k + 34k = ≈ 260k; the new tests (seven root files ≈ 140 KB, seven UI
    files ≈ 100 KB with the kits read, `contexts/testkit.tsx` 1 911 and `brain/notes/testnet.ts` 13 956, and
    `tests/e2e/cleanup.spec.ts` ≈ 25 KB: ≈ 281 KB) add ≈ 70k: ≈ 330k in all, over 150k
- Proposed cut, at the surface boundaries (batches sequential, each only on green):
  - **A** (the inventory and the scan, core and API): S1 + S2 ≈ 35k + 57k = ≈ 92k, plus `tests/cleanup.inventory.test.ts`,
    `tests/cleanup.scan.test.ts` and the S1-S2 half of `tests/cleanup.layer.test.ts` ≈ 72 KB → ≈ 18k = ≈ 110k; C1-C32
  - **B** (decisions, apply, undo, and the API's cross-cutting checks): S3 + S4 + C74-C79 ≈ 13k + 28k + 42k = ≈ 83k, plus
    `tests/cleanup.decisions.test.ts`, `tests/cleanup.apply.test.ts`, `tests/cleanup.move.test.ts`,
    `tests/cleanup.contract.test.ts` and the rest of the layer file ≈ 68 KB → ≈ 17k = ≈ 100k; C33-C50, C74-C79
  - **C** (the wizard and the screens' cross-cutting checks): S5 + C80-C83 ≈ 51k + 34k = ≈ 85k, plus the seven UI test
    files and `tests/e2e/cleanup.spec.ts` ≈ 141 KB → ≈ 35k = ≈ 120k; C51-C73, C80-C83
  - A + B ≈ 210k and B + C ≈ 220k are over the budget, so the three stay apart; A lands first because B's routes take its
    `scanId`, and C calls the routes of A and B
- Mechanism: to be chosen by the owner (handoff in three batches A, B, C, or one builder with compaction accepted)
