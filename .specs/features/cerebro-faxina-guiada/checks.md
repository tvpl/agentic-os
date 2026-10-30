# Cérebro: faxina guiada checks

Profile: ui
Plan: `.specs/features/cerebro-faxina-guiada/plan.md`
Design: `.specs/features/cerebro-faxina-guiada/design.md` (binding for the screens)

89 checks in 5 slices + cross-cutting (C1-C83 approved, C84-C85 added in build, C86-C89 added in round 1) · 8 one-way
doors (doors 7 and 8 added in build) · 2 open questions of the plan (1 `blocks go-live`, 2 `open`), both with their
defaults in force, and 7 new ones (plan.md, "Emendas", questions 3-9: 3-7 from the reconciliation, 8 and 9 for the doors
added in build), none blocking · 18 amendments (amendment 18 added in round 1) for what `cerebro-correcoes`, `cerebro-contextos`, `cerebro-organizar` and `cerebro-vista-notas` built after
the plan and for what this derivation found (`plan.md`, "Emendas depois da aprovação"; each names the check that resolves it).

The plan's slices mix the core, the API and the screens; here S1-S4 are the core and the API of plan S1-S4, and S5 is every
screen of plan S1, S3, S4 and S5, so a batch cut never splits a check slice.

Every proof is `npx vitest run <file> -t "<C-id> "` from the repository root (root tests) or
`npm run test -w apps/command-centre -- <file> -t "<C-id> "` (UI tests); a test title starts with its check id followed by a
space. `E2E` proofs use `MORDOMO_E2E_PORT=4901 npx playwright test --config tests/e2e/playwright.config.ts <spec> -g "<C-id> "`.
`tests/cleanup.layer.test.ts` calls the deciding code itself (`cleanupInventory`, the scanner's finding rules, the MinHash, the
decision rules, the apply planner, the undo), and `tests/cleanup.move.test.ts` calls `moveWorkspaceFile`, with no HTTP
(`Test policy` rows 1 and 2; the apply planner's and the undo's own-layer proofs were added in round 1); the other root
files go through `app.inject` against `buildServer` over a real home. "Now" in every claim is a fixed clock the test sets,
and a file's age is `now - mtime` in whole days. The screens' axe runs over the whole page and counts `serious` and
`critical` violations (the convention of `design-system` C8 and `tests/e2e/a11y.spec.ts`). A claim that names a status and
a code asserts both (plan.md, "Emendas" 4).

## Checks

### S1 - o que tem aqui: inventário, core e rota (plan S1) · 8 files · 142 KB · ~35k

**C1** - `GET /api/memory/cleanup/inventory?context=<id>` with the owner token answers `200` with `scope` = `{ kind: "context", id: "<id>" }`, `total` = the number of the scope's indexed files and their bytes, and the keys `byKind`, `bySize`, `byAge`, `topFolders`, `clusters`, `newest`, each computed over the same 14 rows of the fixture; `newest` is the largest `mtime` of exactly the rows `total` counts (a context's `memory/notes/<id>/` in, a sibling folder whose name starts the same out) and `null` for a scope with no row (AC 1, door 5, amendment 18; changed in round 1)
Proof: `npx vitest run tests/cleanup.inventory.test.ts -t "C1 "`
Proof: `npx vitest run tests/cleanup.layer.test.ts -t "C1 "`

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
Proof: `npx vitest run tests/cleanup.layer.test.ts -t "C41 "`

**C42** - Between the scan and the apply one archived file gets a byte appended and another is deleted: `skipped` lists them with `reason` `changed` and `missing`, both stay where they are, and the third file is moved (AC 28)
Proof: `npx vitest run tests/cleanup.apply.test.ts -t "C42 "`
Proof: `npx vitest run tests/cleanup.layer.test.ts -t "C42 "`

**C43** - A file reached through a symbolic link on the way, and a file whose destination already exists in the archive folder, are listed in `skipped` with `reason` `forbidden_path` and `exists`; both origin and destination are unchanged byte for byte (AC 29)
Proof: `npx vitest run tests/cleanup.apply.test.ts -t "C43 "`
Proof: `npx vitest run tests/cleanup.layer.test.ts -t "C43 "`

**C44** - With `archive` answers on two files of an indexed folder outside `memory/`, the apply moves and writes nothing in that folder (a hash of every file and folder name under it is the same before and after), writes `<home>/artifacts/cleanup/<AAAA-MM-DD>-<id>.md` holding one line `- [ ] <path> — <decision> — <reason>` per file, returns its path in `proposals`, and creates or changes no file outside `memory/archive/` and `artifacts/cleanup/` (AC 30, amendment 9)
Proof: `npx vitest run tests/cleanup.apply.test.ts -t "C44 "`
Proof: `npx vitest run tests/cleanup.layer.test.ts -t "C44 "`

**C45** - With a `merge` keeping the newest of three duplicates under `memory/notes/`, the apply leaves the kept file where it is and moves the other two to the archive folder (AC 19, AC 27)
Proof: `npx vitest run tests/cleanup.apply.test.ts -t "C45 "`
Proof: `npx vitest run tests/cleanup.layer.test.ts -t "C45 "`

**C46** - After the apply, the indexer is asked to index every origin and every destination path (`requestIndexPaths` receives the four paths of two moves); once `index.finished` is announced, `GET /api/memory/search?q=<a word of a.md>` finds it under `memory/archive/…` and not at its origin, the next scan reports neither file, and `GET /api/memory/maps?root=memory` answers the origin folder, whose `_index.md` was `fresh` before the apply, as `stale` and no folder under `memory/archive/` (AC 31, amendment 15)
Proof: `npx vitest run tests/cleanup.apply.test.ts -t "C46 "`
Proof: `npx vitest run tests/cleanup.layer.test.ts -t "C46 "`

**C47** - `POST /apply` answers `404 not_found` for an unknown `scanId`, `409 scan_running` while the scan runs, `409 scan_stale` for a scan another scan of the scope replaced, and `409 restore_in_progress` while a test holds the exclusive restore lock; none moves a file (amendment 12)
Proof: `npx vitest run tests/cleanup.apply.test.ts -t "C47 "`
Proof: `npx vitest run tests/cleanup.layer.test.ts -t "C47 "`

**C48** - `POST /api/memory/cleanup/undo {manifest}` for a manifest of three moves, after one archived file got a byte appended, one was deleted from the archive and one is untouched, moves the untouched one back to `from` (its bytes intact), answers `restored` with it and `skipped` with `changed` and `missing`; with an untouched one whose `from` now exists the reason is `exists`; the archive folder is removed only when the undo leaves it empty (AC 32)
Proof: `npx vitest run tests/cleanup.apply.test.ts -t "C48 "`
Proof: `npx vitest run tests/cleanup.layer.test.ts -t "C48 "`

**C49** - `POST /undo` answers `400 validation` for a path outside `memory/archive/`, for `memory/archive/<x>/outro.json`, and for `memory/archive/../notes/manifest.json`; `404 not_found` for a `manifest.json` under `memory/archive/` that does not exist; `409 undo_conflict` for a manifest with `v: 2`; `409 restore_in_progress` while the exclusive lock is held; none moves a file (AC 34, amendment 12)
Proof: `npx vitest run tests/cleanup.apply.test.ts -t "C49 "`
Proof: `npx vitest run tests/cleanup.layer.test.ts -t "C49 "`

**C50** - Walking the TypeScript syntax tree of the new cleanup modules, and of `moveWorkspaceFile` with each module-private function of `safeWrite.ts` it refers to, in any form (a `function` declaration, or a `const`/`let`/`var` holding an arrow function or a function expression; called or passed as a value; followed transitively, a removal reported with the reference that leads to it), the only calls that remove a name are one `unlink` of `from` inside `moveWorkspaceFile`, reached only after the copy's hash check; one `unlink` of the copy that same call has just written at `to`, when its hash differs, through `removeIfStillOurs(realTo, copy.stat)`, which unlinks only a name that is still that file by device and inode; and one `rmdir` of an empty archive folder in the undo; a call removes a name when its callee resolves, by the file's own bindings, to a removing function (`unlink*`, `rm*`, `rmdir*`) of `node:fs` or `node:fs/promises`, however it is reached (the default, namespace or named import, renamed or not, `promises` and its own module included; a `require`; a destructure, renamed or not; an alias or a `.bind`; a property or an element access; `.call` or `.apply`), and a local name that only spells one is not a removal; the walker's self-tests find every one of those spellings and forms, ignore the word in a comment or a string, and follow a private helper with its arguments but not an exported function (AC 33; changed in rounds 1 and 2)
Proof: `npx vitest run tests/cleanup.layer.test.ts -t "C50 "`

### S5 - o assistente na tela (plan S1, S3, S4, S5) · 15 files · 205 KB · ~51k

**C51** - The four entries, each with its order asserted: in the `ContextSelector` menu, with a context active, "Fazer faxina neste contexto" is the first item after the actions separator and before "Novo contexto…", and choosing it opens the wizard at step 2 with that context; with "Todo o cérebro" active the item is absent; in the moldura's graph, "Faxina" is the third `.btn.sm` of `.brain-topbar-actions`, after "Atualizar índice" and "Modo apresentação (p)" (their accessible names) and before the `os-chip`s; in the Núcleo's brain scene menu "Faxina" is the last row of `bs-menu-acts`, after "Salvar como visão padrão"; the palette's "Faxina guiada" and both "Faxina" buttons open at step 1 with the active context preselected, and none preselected with "Todo o cérebro" (AC 36, amendment 11)
Proof: `npm run test -w apps/command-centre -- src/brain/cleanup/cleanupEntries.test.tsx -t "C51 "`
Proof: `MORDOMO_E2E_PORT=4901 npx playwright test --config tests/e2e/playwright.config.ts cleanup.spec.ts -g "C51 "`

**C52** - The command registry holds "Faxina guiada" with scope `global` and `palette: true`; the keyboard-listener reader of `commands.source.test.ts` finds no new listener (AC 44)
Proof: `npm run test -w apps/command-centre -- src/brain/cleanup/cleanupEntries.test.tsx -t "C52 "`
Proof: `npm run test -w apps/command-centre -- src/commands/commands.source.test.ts -t "C52 "`

**C53** - The wizard is one `Modal` (focus enters it, Esc closes it, focus returns to the opener) whose fixed header holds, top to bottom, the title "Faxina guiada", the scope (the context's name, or the folder's path in the mono 12px class) and the step bar: five numbered circles in the order "Escopo", "O que tem aqui", "Achados", "Conferir", "Pronto", the current one with `aria-current="step"`, the completed ones with the `Check` icon; the current step also reads "Etapa 2 de 5 · O que tem aqui"; the fixed footer holds, left to right, "Fechar", "Voltar" (`.btn`) and the step's action (`.btn.primary`) (AC 36)
Proof: `npm run test -w apps/command-centre -- src/brain/cleanup/CleanupWizard.test.tsx -t "C53 "`

**C54** - Step 1 lists the contexts (name, main path, file count) above the field "Ou uma pasta…" with the indexed folders; a chosen item shows "N arquivos, última mudança há D dias", where N is the `total.count` and D the whole days since the `newest` of the chosen scope's own `GET /api/memory/cleanup/inventory` (asked with that scope's `context` or `dir`, never another route), "N arquivos" alone when `newest` is `null`, and enables "Ver o que tem aqui"; with no context and no indexed folder the step shows "Nada indexado ainda. Adicione uma pasta em Configurações › Pastas." and no action (design.md "Etapa 1", amendment 18; changed in round 1)
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

### Checks acrescentados na construção

Added after approval, while building, one per door a builder added (L-047): the approved C1-C83 are as they were.

**C84** - Door 7's key, as plan.md states it: a `broken-link` finding's key is `broken-link:` and the SHA-256 (hex) of `<member path>\u0000<SHA-256 of its bytes>`, a newline, and `\u0001<linkKind>\u0000<target>\u0000<line>`; an `empty-folder` finding (`files: []`) has `empty-folder:` and the SHA-256 of `\u0001folder\u0000<the folder's real path>`; so the links `[[um-alvo]]` (line 2) and `[[outro-alvo]]` (line 3) of one note and the empty folders `vazia-a/` and `vazia-b/` have four different keys, each equal to that literal, and through the routes a `keep` stored by `PUT /decisions` on the first link's key hides that link from the next scan (`decided` 1) and still reports the other (door 7, AC 11, AC 13; added in batch B for batch A's door 7)
Proof: `npx vitest run tests/cleanup.layer.test.ts -t "C84 "`
Proof: `npx vitest run tests/cleanup.decisions.test.ts -t "C84 "`

**C85** - After `POST /api/memory/cleanup/undo` moved every entry of a manifest back, the manifest is at `<home>/artifacts/cleanup/<AAAA-MM-DD>-<8 hex>.manifest.json` (the archive folder's name) with the same bytes, and the archive folder is gone, leaving `memory/archive/` empty (door 8, AC 32; added in batch B)
Proof: `npx vitest run tests/cleanup.apply.test.ts -t "C85 "`
Proof: `npx vitest run tests/cleanup.layer.test.ts -t "C85 "`

### Correções da rodada 1

Added after approval, in round 1 of the verification (`verification.md`, round 1): the checks below are new, and each
change to an approved check is listed with what it was. The approved text of every other check is as it was.

- **Own-layer proofs of the apply planner and the undo (finding 1, `Test policy` row 1).** C41-C49 and C85 each gain a
  second `Proof:` line, `npx vitest run tests/cleanup.layer.test.ts -t "<C-id> "`, which calls `applyCleanup`,
  `cleanupScanFor` and `undoCleanup` with no HTTP, one asserted case per row: the apply's moves and manifest (C41), its
  four skip reasons (C42, C43), inside and outside `memory/` with the archive and an empty folder as proposals (C44),
  `merge` (C45), the index request (C46), the scan refusals and the lock (C47); the undo's three skip reasons and the
  folder kept while not empty (C48), its refusals (C49) and the full undo (C85). The claims are unchanged.

- **C1 (changed, amendment 18).** Was: "… and the keys `byKind`, `bySize`, `byAge`, `topFolders`, `clusters`, each
  computed over the same 14 rows of the fixture (AC 1, door 5)". Now the keys include `newest`, and the claim says
  which rows it is the newest of; the proof gains the case "C1 newest is the latest mtime of exactly the rows total
  counts…" in `tests/cleanup.inventory.test.ts` (same `Proof:` line). Why: finding 3, step 1's D was read over the
  search's notion of a scope, not the cleanup's.
- **C54 (changed, amendment 18).** Was: "… a chosen item shows "N arquivos, última mudança há D dias" and enables "Ver o
  que tem aqui" …". Now it names the set D comes from (the chosen scope's own inventory, by its own query) and the
  line with no row. The test kit's inventory route answers each scope by its `context` or `dir` and refuses a request
  that names neither (`400 scope_required`, as C9), so a dropped or a wrong scope fails C54; both faults were injected
  and failed it. The step no longer asks `GET /api/memory/search`. The search's own `dir` prefix
  (`core/src/memory/search.ts:58-60`) is older than this feature and is left as it is.

- **C50 (changed, finding 4).** Was: "Walking the TypeScript syntax tree of the new cleanup modules and of
  `moveWorkspaceFile`, the only calls that remove a name are one `unlink` of `from` inside `moveWorkspaceFile`, reached
  only after the copy's hash check, and one `rmdir` of an empty archive folder in the undo; the walker's self-tests find
  … and ignore the word in a comment or a string (AC 33)". Now the claim names the third removal the code has and C40
  requires (the unconfirmed copy at `to`, by device and inode), and the walker follows the module-private helpers of
  the walked function, reporting the call with its arguments; the verifier's fault F1 (the helper pointed at
  `realFrom, file.stat`) now fails C50 itself. No code changed. Exported primitives (`writeWorkspaceFile`'s own removal
  of a file it created and refused) are not followed: they are other features' approved code with their own proofs.

- **C52 (proof changed, finding 6).** Was: `Proof: npm run test -w apps/command-centre --
src/commands/commands.source.test.ts -t "C16 the reader sees every way to listen on the page, and only those"` (the
  reader's self-test over string samples). Now: `… commands.source.test.ts -t "C52 "`, a test of its own that runs the
  reader over every source file, finds no key listener in the wizard's files nor in its four entries' files, and holds
  the page's listeners to `OUTSIDE_THE_REGISTRY`; a `keydown` listener added to `CleanupHost.tsx` fails it. The claim
  is unchanged.
- **C51 and C59 (tests tightened, finding 7).** C51 now asserts the graph's "Faxina" draws one icon and that it is
  `Sparkles` (amendment 11), in the rendered test and in the browser; C59 asserts the other file's name inside a `code`
  element for the two kinds of duplicate, as design.md writes "92% igual a `plano-v2.md`.", and the screen now draws it
  so (it was plain text, builder decision (l) of batch C, which this replaces). The claims are unchanged.
- **C71 (unchanged, finding 7).** AC 40 says only that reopening within 24 hours resumes at "Achados"; the assumption
  "Retomada" says that after it there is "uma varredura nova", and design.md says nothing of resuming. Neither says the
  new scan starts by itself, so the wizard still opens at "O que tem aqui" and the person starts it.
- **`moldura-app/design.md` (note only).** The binding table cites its "Tela do Segundo Cérebro", which that file does
  not have (Tela 1-4); the brain's action row rests on design.md and amendment 11. No check changes.

- **Gates of round 1, at `5b0f772`.** `npm run build`, `npm run typecheck`, `npm run lint` and `npm run bundle:check`
  exit 0 (JS gzip 546 409 B, 11 477 B above `cerebro-vista-notas`; CSS gzip 76 471 B, 1 792 B above it); `npx vitest
run` at the root is green (148 files, 1948 tests, 1 skipped) and the UI suite too (161 files, 1326 tests); every
  touched `Proof:` line passes alone; the six specs together (`cleanup`, `a11y`, `notes-view`, `contexts`, `gallery`,
  `gallery-contrast`) pass, 119 tests. `notes-view.spec.ts` fails now and then with "apiResponse.json: Response has been
  disposed" in its own route handler (a request the page abandons on a reload), a different test each run; the same
  unchanged spec fails the same way with the sources of `81f331d` and of `0310db6` (before any screen of this feature),
  so it is that spec's harness, not this feature, and it was left as it is.

**C86** - `POST /api/memory/cleanup/undo` for a manifest of this feature answers `409 undo_conflict`, one asserted case per reason the undo has (Handoff batch B, (g)): text that is not JSON, `v` other than 1, an entry whose `from` is outside `memory/`, an entry whose `from` is inside `memory/archive/`, and an entry whose `to` is outside its own archive folder; none moves or writes a file; the same five at the undo's own layer throw `CleanupUndoConflictError` (finding 2; added in round 1)
Proof: `npx vitest run tests/cleanup.apply.test.ts -t "C86 "`
Proof: `npx vitest run tests/cleanup.layer.test.ts -t "C86 "`

**C87** - The step bar draws, in each of its five steps, the numbered circle (24 px, round) and then its name under it, centred on it; every step after the first draws a one-pixel line in the border's token at the circles' middle, from just past the circle before it to just before its own (`.cln-step + .cln-step::before`); in a real browser each name's top is at or below its circle's bottom and its centre within 1 px of the circle's, and each line starts within 3 px of the circle before and ends within 3 px of its own (design.md "Cabeçalho fixo": "cinco círculos numerados ligados por uma linha, cada um com o nome por baixo"; finding 5; added in round 1)
Proof: `npm run test -w apps/command-centre -- src/brain/cleanup/CleanupWizard.test.tsx -t "C87 "`
Proof: `MORDOMO_E2E_PORT=4901 npx playwright test --config tests/e2e/playwright.config.ts cleanup.spec.ts -g "C87 "`

**C88** - In step 2 each bar of "Por tipo" and "Idade" is as long as its count, and each bar of "Maiores pastas" as its bytes, as a share of the largest value in its card in whole percent, at least 2% when the value is not zero and 0% when it is (counts 200, 150, 1, 0, 50, 100 → 100%, 75%, 2%, 0%, 25%, 50%; ages 10, 4, 0, 7 → 100%, 40%, 0%, 70% of the column's height; bytes 8 000, 6 000, 2 000, 10 → 100%, 75%, 25%, 2%), each fill inside its track or column (design.md "Etapa 2": "a altura proporcional", the bars of "Por tipo" and "Maiores pastas"; finding 5; added in round 1)
Proof: `npm run test -w apps/command-centre -- src/brain/cleanup/CleanupInventory.test.tsx -t "C88 "`

**C89** - The wizard's `Modal` is `min(960px, 100%)` wide and at most `88vh` tall, a column whose header and footer stay while its body scrolls; in a real browser its sheet is 960 px wide in a 1 440 × 900 window, no taller than 88% of the window at 900 px and at 500 px, and no wider than a 600 px window (design.md "Tela - Assistente de faxina": "`Modal` largo (até 960px, altura até 88vh)"; finding 5; added in round 1)
Proof: `npm run test -w apps/command-centre -- src/brain/cleanup/CleanupWizard.test.tsx -t "C89 "`
Proof: `MORDOMO_E2E_PORT=4901 npx playwright test --config tests/e2e/playwright.config.ts cleanup.spec.ts -g "C89 "`

### Correções da rodada 2

Added after approval, in round 2 of the verification (`verification.md`, round 2): two checks changed, each listed with
what it was. No product code changed; the verifier found it correct.

- **C50 (changed, finding 1, R2-F5).** Was (round 1): "… of `moveWorkspaceFile` with each module-private function of
  `safeWrite.ts` it calls (followed transitively, a removal reported with the call that leads to it) …; the walker's
  self-tests find `fs.unlinkSync`, `fs.rmSync`, `fs.promises.rm` and a destructured `unlink`, ignore the word in a
  comment or a string, and follow a private helper with its arguments but not an exported function". The walker
  followed `function` declarations only and matched a callee by its local name. Now it follows a module-private
  function in any form (an arrow function or a function expression held by `const`, `let` or `var`, the style of
  `safeWrite.ts`'s own `needsInPlace`), called or passed as a value, and it resolves a callee by the file's bindings to
  its import (renamed imports and destructures, `fs.promises` and `node:fs/promises`, aliases, `.bind`, element access,
  `.call`/`.apply`); a local function that only has a remover's name is not one. The claim now says so, and the
  self-test has a case for each spelling and form. Faults re-injected in `moveWorkspaceFile`'s rename catch, before
  its re-throw: R2-F5 (`const forget = (p) => { try { fs.unlinkSync(p) } catch {} }`, called `forget(realFrom)`), a
  renamed destructure (`const { unlinkSync: drop } = fs`, `drop(realFrom)`) and an element access
  (`fs["unlinkSync"](realFrom)`): each fails C50. `Test policy` row 2's evidence names the walker's rows.
- **C1 (proof added and tightened, finding 2, R2-F3).** The claim is unchanged. Its route case now puts the newest row
  between older ones by path, in a `dir` scope and a context scope, keeps a context whose newest row is its notes
  folder's, a same-prefix sibling with a newer row, and the empty scope; and C1 gains
  `Proof: npx vitest run tests/cleanup.layer.test.ts -t "C1 "`, which calls `cleanupInventory` for a `dir` scope, a
  context scope (an ok path with its newest row in the middle, the notes folder in, a same-prefix sibling and a missing
  path out) and an empty one. R2-F3 re-injected (`if (newest === null) newest = row.mtime;`) fails both.
- **The header's counts (low).** Were "83 checks · 6 one-way doors · … 5 new ones (questions 3-7) · 17 amendments"; now
  89 checks, 8 doors, 7 new questions (3-9) and 18 amendments.

## Coverage

| Set (size)                                                    | Member -> proof                                                                                                                                                                                                                                                                                                                                                                                                       | Unproven |
| ------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| `GET /api/memory/cleanup/inventory` statuses (3)              | 200 C1 · 400 C8, C9 · 404 C9                                                                                                                                                                                                                                                                                                                                                                                          | -        |
| `POST /api/memory/cleanup/scans` statuses (4)                 | 202 C10 · 400 C9 · 404 C9 · 409 C28, C29                                                                                                                                                                                                                                                                                                                                                                              | -        |
| `GET /api/memory/cleanup/scans/:id` statuses (2)              | 200 C11 · 404 C11                                                                                                                                                                                                                                                                                                                                                                                                     | -        |
| `PUT /api/memory/cleanup/decisions` statuses (4)              | 200 C33 · 400 C35 · 404 C36 · 409 C36                                                                                                                                                                                                                                                                                                                                                                                 | -        |
| `POST /api/memory/cleanup/apply` statuses (3)                 | 200 C41 · 404 C47 · 409 C47                                                                                                                                                                                                                                                                                                                                                                                           | -        |
| `POST /api/memory/cleanup/undo` statuses (4)                  | 200 C48 · 400 C49 · 404 C49 · 409 C49                                                                                                                                                                                                                                                                                                                                                                                 | -        |
| named error codes, as (status, code) pairs (9)                | `400 scope_required` C8, C9 · `404 context_not_found` C9 · `400 validation` C9, C35, C49 · `404 not_found` C11, C36, C47, C49 · `409 scan_running` C28, C47 · `409 scan_stale` C36, C47 · `409 restore_in_progress` C29, C47, C49 · `409 undo_conflict` C49 · `403 scope_required` (device) C75                                                                                                                       | -        |
| routes that take a `scanId` (3)                               | `GET /scans/:id` C11 · `PUT /decisions` C33, C36 · `POST /apply` C41, C47                                                                                                                                                                                                                                                                                                                                             | -        |
| doors of Landing (8)                                          | 1 C38, C39, C40 · 2 C14, C15, C16 · 3 C17, C25, C33 · 4 C41, C48 · 5 C74 · 6 C10, C77 · 7 C84 (added in build) · 8 C85 (added in build)                                                                                                                                                                                                                                                                               | -        |
| stored shapes (4)                                             | `file_minhash` C15 · `cleanup_decisions` C17 · `manifest.json` C41 · `settings.memory.cleanup` C32                                                                                                                                                                                                                                                                                                                    | -        |
| startup config: `memory.cleanup` thresholds (1 assembly)      | the service (`AppContext`, behind every cleanup route) C18, C23, C32                                                                                                                                                                                                                                                                                                                                                  | -        |
| scope kinds (7)                                               | context C1, C7 · `dir` in an indexed folder C8 · `dir` under `memory/` C8 · `dir` outside every root C8 · none C9 · `context=all` C9 · `context` and `dir` C9                                                                                                                                                                                                                                                         | -        |
| context path states (3)                                       | `ok` C7 · `missing` C7 · notes folder C7                                                                                                                                                                                                                                                                                                                                                                              | -        |
| `byKind` groups (6)                                           | `notes` C2 · `text` C2 · `pdf` C2 · `image` C2 · `code` C2 · `other` C2                                                                                                                                                                                                                                                                                                                                               | -        |
| `byAge` bands with their edges (4)                            | 0-30 C3 · 31-90 C3 · 91-365 C3 · over 365 C3                                                                                                                                                                                                                                                                                                                                                                          | -        |
| cluster modes (2)                                             | by first-level subfolder C5 · by `file_related` ≥ 0.3 C5                                                                                                                                                                                                                                                                                                                                                              | -        |
| rows refused by today's policy (2)                            | user exclude C6, C27 · secret name C6                                                                                                                                                                                                                                                                                                                                                                                 | -        |
| finding kinds (8)                                             | `duplicate` C12, C59 · `near-duplicate` C13, C59 · `stale` C18, C19, C59 · `orphan` C20, C59 · `broken-link` C21, C59 · `empty-folder` C22, C59 · `large-file` C23, C59 · `untitled` C24, C59                                                                                                                                                                                                                         | -        |
| stale sources (3)                                             | `mtime` C18 · `last_reviewed` C19 · `review_every` ignored C19                                                                                                                                                                                                                                                                                                                                                        | -        |
| decisions (5)                                                 | `keep` C26, C33 · `archive` C26, C33, C41 · `merge` C26, C34, C45 · `snooze` C26, C63 · `unsure` C26, C63                                                                                                                                                                                                                                                                                                             | -        |
| decision refusals (7)                                         | unknown key C35 · decision outside five C35 · merge without id C35 · id outside finding C35 · merge on other kind C35 · snooze without until C35 · until past C35                                                                                                                                                                                                                                                     | -        |
| places the scan ignores (5)                                   | `memory/archive/` C27 · `ROUTER.md` C27 · `areas/` C27 · `journal/` C27 · `contexts/` C27                                                                                                                                                                                                                                                                                                                             | -        |
| scan phases (4)                                               | `inventory` C10, C57 · `signatures` C10, C30, C57 · `links` C10, C31, C57 · `findings` C10, C57                                                                                                                                                                                                                                                                                                                       | -        |
| events (3)                                                    | `cleanup.progress` C10, C77 · `cleanup.finished` C10, C77 · `cleanup.failed` C31, C77                                                                                                                                                                                                                                                                                                                                 | -        |
| restore lock states (3)                                       | exclusive held elsewhere C29, C47, C49 · shared held by a running scan C29 · released after finish and failure C29                                                                                                                                                                                                                                                                                                    | -        |
| apply skip reasons (4)                                        | `changed` C42, C69 · `missing` C42, C69 · `forbidden_path` C43, C69 · `exists` C43, C69                                                                                                                                                                                                                                                                                                                               | -        |
| undo skip reasons (3)                                         | `changed` C48 · `missing` C48 · `exists` C48                                                                                                                                                                                                                                                                                                                                                                          | -        |
| `409 undo_conflict` reasons of the undo, added in round 1 (5) | not JSON C86 · `v` other than 1 C49, C86 · `from` outside `memory/` C86 · `from` inside the archive C86 · `to` outside its folder C86                                                                                                                                                                                                                                                                                 | -        |
| `moveWorkspaceFile` paths (6)                                 | same device C38 · link as origin C39 · link on the way C39 · destination exists C39 · hash differs C39 · other device C40                                                                                                                                                                                                                                                                                             | -        |
| entry points that move or write a user file (2)               | `POST /apply` C41, C44 · `POST /undo` C48, and no other call removes a name C50                                                                                                                                                                                                                                                                                                                                       | -        |
| apply side effects (4)                                        | moves C41 · manifest C41 · proposals C44 · index request C46                                                                                                                                                                                                                                                                                                                                                          | -        |
| wizard entries (4)                                            | `ContextSelector` menu C51 · palette C51, C52 · moldura button C51 · Núcleo menu row C51                                                                                                                                                                                                                                                                                                                              | -        |
| wizard steps (5)                                              | Escopo C53, C54 · O que tem aqui C53, C55 · Achados C53, C58 · Conferir C53, C68 · Pronto C53, C69                                                                                                                                                                                                                                                                                                                    | -        |
| wizard states (11)                                            | nothing indexed C54 · inventory loading C55 · scan running C57 · no finding C67 · save failed C62 · brief conflict C65 · no brief C66 · no changes C68 · undone C69 · failure C70 · cancelled C73                                                                                                                                                                                                                     | -        |
| answer rows (2 variants)                                      | with Juntar C59, C60 · without Juntar C59                                                                                                                                                                                                                                                                                                                                                                             | -        |
| arrangements design.md and amendment 11 draw (15)             | menu item before Novo contexto C51 · third topbar button C51 · last row of bs-menu-acts C51 · header order C53 · step bar order C53 · footer order C53 · card order of step 2 C55 · two columns and one C55 · tab order C58 · card rows order C59 · answered card below C61 · Desfazer before Fechar C69 · circles tied by a line, names under them C87 · bars and columns proportional C88 · Modal 960 px / 88vh C89 | -        |
| motion (4)                                                    | numbers C56 · bars C72 · step change C72 · answered card C72                                                                                                                                                                                                                                                                                                                                                          | -        |
| shells (2)                                                    | moldura C51, C80 · Núcleo C51, C80                                                                                                                                                                                                                                                                                                                                                                                    | -        |
| themes (2)                                                    | light C80, C81 · dark C80, C81                                                                                                                                                                                                                                                                                                                                                                                        | -        |
| design.md copy (27 rows)                                      | C83, table-driven over all 27                                                                                                                                                                                                                                                                                                                                                                                         | -        |

- Claims naming a status code, route or response shape: C1, C8-C11, C21, C28, C29, C32-C37, C41-C49, C74-C77, C79, C84, C85 -
  each proven through `app.inject` against `buildServer`; C2-C7, C12-C20, C22-C27, C35, C50, C84 also or only at their own layer,
  with no HTTP; C38-C40 at the primitive's own layer
- Claims about the screens: C51-C73, C83 in rendered components; C51, C55, C80, C81 also in a real browser, both shells
  where the claim names them

## Binding sources

| Source                                                                                                    | Checked by                           |
| --------------------------------------------------------------------------------------------------------- | ------------------------------------ |
| `cerebro-faxina-guiada/design.md` (the wizard, its steps, states, motion, copy)                           | C51, C53-C73, C83, C87-C89 (round 1) |
| `design-system/design.md` (12px floor, 13px prose, tokens, state never by colour alone, axe, the gallery) | C55, C72, C80, C81                   |
| `primitivas/design.md` (`Modal`, `Tabs`, animations inside `no-preference`)                               | C53, C58, C72                        |
| `comandos-atalhos/design.md` (the registry, no listener outside it)                                       | C52                                  |
| `moldura-app/design.md` (the screen's action row, `.btn.sm`)                                              | C51                                  |
| `cerebro-v2/design.md` (error with "Tentar de novo", spinner with text, progress by phase in text)        | C55, C57, C62, C70                   |
| `desktop/useTweenNumber.ts` (numbers that rise, final at once under reduced motion)                       | C56                                  |
| `cerebro-contextos/design.md` (the selector's menu this feature adds one item to)                         | C51                                  |

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
- the no-removal walker (C50): which calls remove a name (every binding of a removing function of `node:fs` and
  `node:fs/promises`) and which functions it follows (every form of a module-private function) -> decides; its
  self-tests hold one asserted case per spelling and per form (round 2)
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

The estimate exceeds the 150k budget. Mechanism chosen by the owner on 30/10/2026: **handoff, three batches A, B, C** (the cut below), sequential, each only on green.

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

Status of batch A (updated in the commit that closes each piece):

- the inventory (S1: C1-C9) and the scan with its signatures, its events and its thresholds (S2: C10-C32), with the
  three routes of batch A in the contract (`GET /api/memory/cleanup/inventory`, `POST /api/memory/cleanup/scans`,
  `GET /api/memory/cleanup/scans/:id`), migration 24 and `settings.memory.cleanup`: closed, every proof green in
  `tests/cleanup.inventory.test.ts`, `tests/cleanup.scan.test.ts` and `tests/cleanup.layer.test.ts`; with it batch A is
  closed (C1-C32)

- **Boundary (batch A):** C1-C32 closed at `8d91441`, which closes the batch. On the tree of `8d91441`: `npm run build`,
  `npm run typecheck` and `npm run lint` exit 0, `npx vitest run` at the root is green (144 files, 1907 tests, 1 skipped)
  and `npm run test -w apps/command-centre` too (154 files, 1227 tests); each of the 38 `Proof:` lines of C1-C32 passes
  and runs only its check's test. S3-S5 and C33-C83 are untouched (batches B and C): no `PUT /decisions`, no apply, no
  undo, no `moveWorkspaceFile`, no screen. What batch A already moved for its three routes, so that batch B adds three
  more on top: the `API` table (142 routes, 71 owner, 29 content), `EXPECTED_ROUTE_SCOPES`, the rows of
  `docs/security.md`, a scenario each in `tests/helpers/contractWorld.ts`, the three `cleanup.*` types in
  `EVENT_VERSIONS` with their v1 fixtures, and `docs/events.md` regenerated; C74-C79 are still batch B's to prove.
- **Settled mid-build:** nothing by the owner. Builder decisions inside the approved shape: (a) Landing row 7, added
  before its code: the key of a `broken-link` also hashes the link (kind, target, line) and the key of an
  `empty-folder` (which has no member, `files: []`, the folder in `detail.folder`) hashes the folder's real path, so two
  links of one note, or two empty folders, never share a `(scope, key)`; owner question 8 asks about it and the extra
  test "door 7" in `tests/cleanup.layer.test.ts` holds it; (b) the scan reads the bytes of every finding's members, and
  of the files that share a size, through `openWorkspaceFile(...).sha256()`, for the duplicates and for door 3's key
  (Flow hop 3 says so); a file it cannot open is no member of anything; (c) the shapes the Surface left open: `total`
  is `{ count, bytes }`; `byKind` is `{ kind, count, bytes }` with `notes` `.md`/`.markdown`, `text` `.txt .text .csv
.tsv .log .rtf .doc .docx .odt`, `pdf`, `image` (11 extensions), `code` (the index's code and data extensions) and
  `other`; `bySize` is four bands `{ upTo, count, bytes }` (100 KiB, 1 MiB, `memory.cleanup.largeBytes`, then `null`);
  `byAge` is `{ from, to, count }`; `topFolders` are the folders strictly below the scope's roots, nested ones included,
  ties by path; `clusters` are `{ kind: "folder" | "related", name, path, count, terms }`, a `related` group needs two
  files and is named by its terms joined with " · ", shared terms rank by how many files hold them, then weight, then
  name; a finding is `{ key, kind, files: [{ id, path, size, mtime, sha256 }], detail, suggested }` with `detail` by
  kind (`similarity`; `since`, `ageDays`, `lastReviewed`; `target`, `line`, `linkKind`; `folder`; `bytes`, `limit`) and
  `suggested` `merge` for both duplicate kinds, `archive` for `stale` and `empty-folder`, `keep` for the others; a scan
  is `{ scanId, scope, status, phase, code, startedAt, finishedAt, findings, decided }`; (d) the rules the checks left
  open: an empty file is nobody's duplicate; a near-duplicate is one finding per pair; `stale` takes `mtime` first and
  `last_reviewed` (a real `YYYY-MM-DD`, read as midnight UTC) second; an orphan counts links from anywhere in the index
  that today's policy allows; `empty-folder` reports the topmost folder of an empty tree (`pai/`, not also `pai/oca/`),
  "holds no indexed file" by the index rows; `untitled` is a Markdown row whose `title` is null; a failed scan's code is
  always `scan_failed`; findings are ordered by kind, then first path, then line; (e) `409 scan_running` names the
  running scanId in `error.message`, because the error envelope has no other field for it (C28 reads it there); (f)
  `dir` must be absolute (`400 validation` from the schema), and a folder inside the home's `config/` or `logs/` is
  `400 scope_required`; (g) the scanner is the engine's (`engine.cleanup`, `CleanupScanner` in
  `core/src/memory/cleanupScan.ts`), takes the shared restore lock with no wait, keeps the last 100 scans in memory and
  has `latest(scopeKey)` for batch B's `scan_stale`; each record keeps its findings with the members' `sha256` for the
  apply's `changed` check; the routes are in `apps/api/src/routes/cleanup.ts`, their entries in
  `contracts/src/api/memory.ts`; (h) `CLEANUP_PHASES`, `CLEANUP_FINDING_KINDS`, `CLEANUP_DECISIONS`,
  `CLEANUP_KIND_GROUPS` and `CLEANUP_SCAN_STATES` stay inside `contracts/src/api/memory.ts`, not in the package's
  exports (`tests/contracts.test.ts` C41 pins that surface), and `CleanupPhase` is a type of `contracts/src/events.ts`;
  (i) `minhash.ts` imports nothing, so C14 loads it in two child processes by type stripping; (j) the contract world's
  scan scenarios wait for their scan to end, so a scan's reads stay inside its own scenario of the refusal probe; (k)
  pins moved the way the repo moves them: 142 routes, 71 owner and 29 content routes (with their amendments in
  `sdk.api-thin`), 71 raised pairs (`400 scope_required`, `409 scan_running`), 140 checked responses in
  `api.openapi` C21, 28 event types, migration 24 in `data.migration`, `contexts.runs` C22 and `device-scopes` C22, the
  two settings leaves of `data.settings` C46, the v1 `settings.changed` fixture, and `cleanupInventory` and
  `resolveCleanupScope` in the internal barrel (`sdk.surface`).
- **Abandoned:** finding duplicates from the indexed text (a binary has none, and the text is cut at 200 000
  characters); a column for the file's hash in `file_minhash` (door 2's literal shape has none); a route that cancels a
  scan (amendment 17); exporting the cleanup constants from `@mordomo/contracts`.

Status of batch B (updated in the commit that closes each piece):

- the decisions (S3: C33-C37), the apply and the undo with `moveWorkspaceFile` (S4: C38-C50), the API's cross-cutting
  checks (C74-C79) and the checks added in build (C84 for batch A's door 7, C85 for door 8): closed, every proof green in
  `tests/cleanup.decisions.test.ts`, `tests/cleanup.apply.test.ts`, `tests/cleanup.move.test.ts`,
  `tests/cleanup.contract.test.ts` and `tests/cleanup.layer.test.ts`, with the three routes of batch B in the contract
  (`PUT /api/memory/cleanup/decisions`, `POST /api/memory/cleanup/apply`, `POST /api/memory/cleanup/undo`)

- **Boundary (batch B):** C33-C50, C74-C79, C84 and C85 closed at `5e3ce42`, which closes the batch. On that tree:
  `npm run build`, `npm run typecheck` and `npm run lint` exit 0, `npx vitest run` at the root is green (148 files, 1934
  tests, 1 skipped) and `npm run test -w apps/command-centre` too (154 files, 1227 tests); each of the 33 `Proof:` lines
  of batch B passes and runs only its check's test (C50's selector runs its two tests, the walker's self-test and the
  walk). S5 and C51-C73, C80-C83 are untouched (batch C): no screen, no locale key, no bundle entry. What batch C calls:
  the six routes of door 5 as `contracts/src/api/memory.ts` declares them (`manifest` and `proposals` are `string |
null`, `skipped[].reason` is one of `changed`, `missing`, `exists`, `forbidden_path`, the undo's `skipped[].path` is the
  origin), with `until` of a snooze in milliseconds since the epoch.
- **Settled mid-build:** nothing by the owner. Builder decisions inside the approved shape: (a) Landing row 8, added
  before its code, with C85 and owner question 9: after an undo that moved every entry back, the manifest moves to
  `artifacts/cleanup/<archive name>.manifest.json` and the empty archive folder goes by `rmdir`, deepest first; a partial
  undo leaves both; (b) C84 added for batch A's door 7 (L-047), proven at the layer and through the routes, and the old
  "door 7" test is now C84's own-layer test; (c) the apply plans one move per file, the first finding that asks for it
  giving the reason; `archive` moves every member and `merge` every member but `keep_file_id`; an `empty-folder` marked
  `archive` is never moved or removed, anywhere, and becomes a proposal line (`<folder>/ — archive — pasta vazia`); a
  file under `memory/archive/` is a proposal too; (d) the archive folder is the owner's local day and 8 random hex, the
  destination the file's path under `memory/` (by real path), the manifest's `createdAt` is milliseconds and its `scope`
  the scope key of door 3; the manifest is written only when something moved, and is written even if a later move throws
  an error that is no skip reason; a destination equal to the manifest's own path is skipped as `exists`; (e) skip
  reasons: `EditConflictError` and a non-regular file are `changed`, `ENOENT` `missing`, `EEXIST` `exists`, a
  `PathAccessError` (a link on the way, the filter) `forbidden_path`, the undo's included; any other error goes on as
  an error; (f) decisions: `keepFileId` is stored only for `merge` and `until` only for `snooze` (ignored on the other
  kinds); a decision on a scan still running is `400 validation` (its findings are empty: no key is reported); (g) the
  undo validates the path by its spelling (`memory/archive/<one name>/manifest.json`), takes the lock, reads it strictly
  (16 MiB) through the safe reader, and answers `409 undo_conflict` for JSON it cannot read, `v` other than 1, or an
  entry whose `from` is outside `memory/` (or inside the archive) or whose `to` is outside its own folder; because it
  reads through the safe reader, `POST /api/memory/cleanup/undo` is in the three reader-refusal lists of
  `contracts/src/api/errors.ts`, as the probe printed; (h) in the copy branch of `moveWorkspaceFile` a copy whose hash
  differs is taken away by the existing `removeIfStillOurs` (that very file, by device and inode) before
  `EditConflictError`: C40's "to holds no unconfirmed copy"; C50's walker, as its claim says, walks the cleanup modules
  and `moveWorkspaceFile`'s own body, so this call inside `safeWrite.ts` is not one it lists; (i) C44's "no file outside
  `memory/archive/` and `artifacts/cleanup/`" is compared over the whole home but `logs/` and `config/db/`, which the
  server changes for every request it answers (the request log, SQLite's shared memory); (j) C77's "refused by the bus's
  check" runs the check of `tests/helpers/eventGuard.ts` (the envelope's schema by type and version) on the envelope the
  bus stamps: an emission off the schema for real fails the file in the guard's `afterEach`; (k) pins moved the way
  batch A moved them: 145 routes, 74 owner routes, 143 device-scoped routes, `[74, 69]`, 73 raised pairs, 143 checked
  responses in `api.openapi` C21, six chained `device-scopes` amendments in `sdk.api-thin`, the four names of
  `cleanupApply.ts` in the internal barrel (`sdk.surface`), the owner row of `docs/security.md` (74), and three scenarios
  in `tests/helpers/contractWorld.ts` that set up through the engine so a fault reaches only their own request.
- **Abandoned:** an archive folder per file's parent (door 4 rejected it); a `scan_running` answer from `PUT
/decisions` (amendment 12 does not list it); moving an empty folder into the archive (a move of a folder needs an
  `rmdir` of the origin, which C50 does not allow outside the undo).

Status of batch C (updated in the commit that closes each piece):

- the entries (C51, C52), the frame and its flow (C53, C54, C67, C70, C71, C73) and step 2 (C55, C56, C57): closed,
  every UI proof green in `src/brain/cleanup/cleanupEntries.test.tsx`, `CleanupWizard.test.tsx` and
  `CleanupInventory.test.tsx`, and C51's and C55's browser proofs green in `tests/e2e/cleanup.spec.ts`
- step 3 (C58-C66), steps 4 and 5 (C68, C69), the motion (C72), the stylesheet, the type floor, the state marks and
  axe in both themes and both shells (C80), the gallery (C81), the weight (C82) and the copy (C83): closed, every proof
  green in `CleanupFindings.test.tsx`, `CleanupReview.test.tsx`, `cleanupMotion.test.ts`, `cleanupCopy.test.ts`,
  `tests/cleanup.contract.test.ts` (C82) and `tests/e2e/cleanup.spec.ts` (C80, C81); with it batch C is closed
  (C51-C73, C80-C83)

- **Boundary (batch C):** C51-C73 and C80-C83 closed at `93f7a81`, which closes the batch and the feature's 85 checks.
  On that tree: `npm run build`, `npm run typecheck`, `npm run lint` and `npm run bundle:check` exit 0, `npx vitest
run` at the root is green (148 files, 1935 tests, 1 skipped) and `npm run test -w apps/command-centre` too (161
  files, 1321 tests); each of the 29 UI and root `Proof:` lines of batch C passes and runs only its check's tests, and
  the browser proofs (C51, C55, C80, C81) pass in `tests/e2e/cleanup.spec.ts`, run together with `a11y.spec.ts`,
  `notes-view.spec.ts`, `contexts.spec.ts`, `gallery.spec.ts` and `gallery-contrast.spec.ts` (117 tests). The weight,
  measured on the final build: JS gzip 546 389 B (11 457 B above `cerebro-vista-notas`, under the 12 288 B cap), CSS
  gzip 76 471 B (1 792 B above it, under the 2 048 B cap); the wizard's chunk is about 7.2 KB of JS gzip and 1.8 KB of
  CSS gzip, its strings in two languages about 1.9 KB.
- **Settled mid-build:** nothing by the owner, and no new one-way door (no route, stored shape or event changed).
  Builder decisions inside the approved shape: (a) the four entries call `openCleanup(request)`
  (`brain/cleanupEvents.ts`, a window event `mordomo:open-cleanup`), heard by `CleanupHost`, mounted once by `OsShell`
  beside the note editor's host, which `lazy`-loads `brain/cleanup/CleanupWizard.tsx`; the selector's item asks for
  `{ context, step: 2 }`, the palette and both "Faxina" buttons for step 1, and the wizard preselects the active
  context there; the scene menu row takes an optional `onCleanup` (the scene closes its menu first); (b) the UI's
  `invalidationMap` lists `cleanup.progress`, `cleanup.finished` and `cleanup.failed` with no key to refresh, because
  the event stream subscribes only to the types listed there; (c) step 1's "N arquivos, última mudança há D dias":
  N is the inventory's `total.count` and D the whole days since the `mtime` of the most recent row of
  `GET /api/memory/search?q=&mode=text&limit=1` with the scope, since C1 pins the inventory's keys and it has no
  newest date; "Ou uma pasta…" is a text field over a datalist of the enabled `indexedFolders`, an absolute path in it
  is the `dir` scope, and "Nada indexado ainda…" shows when there is no context and no enabled indexed folder; (d)
  resuming (AC 40): `localStorage` `mordomo.cleanup.v1` keeps, per scope key, the scan's id, when it finished and the
  answers given; entering step 2 of a scope within 24 hours of that reads `GET /scans/:id` and opens "Achados" with
  those answers, a scan the server no longer has starts over, and after 24 hours step 2 waits for "Procurar o que
  decidir" (the new scan is the person's to start, not automatic); (e) "Cancelar" forgets the scan (its later events
  open nothing), closes the wizard and says "Varredura cancelada." in an `info` toast, which the toasts' `role="status"`
  region announces; (f) an answered card draws one `Check` with the answer's word and "Respondido", whatever the
  answer, and the kinds' icons are ones the bundle already ships (`Copy`, `Repeat`, `CalendarClock`, `Unlink`, `Ban`,
  `FolderOpen`, `Server`, `FileText`), both for the weight cap; (g) "Juntar" shows the radios and a "Confirmar" that
  sends the merge; "Aplicar a todos deste tipo" sends every finding of the tab, answered or not, a merge keeping each
  one's newest member; (h) "Guardar" reads the brief right before it writes; after a `409 edit_conflict`, "Carregar de
  novo" clears the conflict so the next "Guardar" reads the newest version; a save shows "Salvo" and empties the box;
  any other failure is the band "Não foi possível guardar a resposta."; (i) step 4's lines are computed on screen from
  the findings and the answers as batch B's apply plans them (one line per file, the first finding gives the
  decision; `memory/archive/<local day>-…/<path under memory/>`; a file outside `memory/` or already in its archive,
  and an empty folder, are proposals), the `memory/` folder from `GET /api/system/info`; (j) step 5's "propostas"
  number is the plan's proposal lines when the apply returned a list, else 0, and "Abrir a lista de propostas" closes
  the wizard and opens the list as a document panel (`OPEN_PANEL_EVENT`, `doc:<path>`); (k) the footer: on steps 1-4
  "Fechar" (`.btn.ghost`), "Voltar" (`.btn`, disabled on step 1) and the action (`.btn.primary`); where the action is
  "Fechar" itself (no finding, no change, step 5) the first "Fechar" is not drawn; step 5 has "Desfazer" (`.btn`) in
  "Voltar"'s place while a manifest is there to undo; (l) strings reused where the words are the same: `common.back`,
  `common.close`, `common.cancel`, `common.confirm`, `brain.groups`, `shell.palette.files`, `scene.brain.kind.pdf`,
  `note.state.saved`; the middle age bands read their numbers ("31-90", "91-365"); the reason of a `stale` by
  `last_reviewed` reads "Sem revisão há N dias."; the near-duplicate's sentence names the other file as plain text
  ("92% igual a plano-v2.md."), not in code type; (m) pins moved: the `cerebro-contextos` C31 test of the selector's
  menu (`contexts/ContextSelector.test.tsx`) gains the new row before "New context…" (amendment 11), the closed list
  of files no entry reaches (`legacy.graph.test.ts` C1) gains `brain/cleanup/testkit.tsx`, and
  `scripts/bundle-baseline.json` gains the `cerebro-faxina-guiada` entry; (n) the browser proofs run with motion
  reduced, as the other specs do (C72 compares both settings in rendered components), and the spec's palette helper
  presses Control+K again until the launcher's field is up.
- **Abandoned:** a newest-change field in the inventory (C1 pins its keys); an icon per answer and kind icons new to
  the bundle (the weight cap); file names in code type inside the reasons; starting the new scan by itself after 24
  hours.
