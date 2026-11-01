# Cérebro: memória confiável checks

Profile: ui
Plan: `.specs/features/cerebro-memoria-confiavel/plan.md`
Design: `.specs/features/cerebro-memoria-confiavel/design.md` (binding for the screens)

148 checks in 9 slices (part A: S1, S2, S3, cross-cutting A, screens A; part B: S4, S4r, S5, screens B; C148 added in
batch A2 with door 16) · 16 one-way doors · the plan's 6 questions answered by the owner on 31/10/2026 with their recommended defaults (AD-045: internal
SQLite history; consolidation off for new installs; MCP writes go to the inbox; Codex and Cursor refused on a hidden
folder; 50 versions and 256 MiB; S4-S5 in this feature, own batch) · 23 gaps this derivation found (`## Gaps found by
this derivation`, G1-G23), each written into the checks with its safe default and none blocking the build.

The plan's slices mix the core, the API and the screens. Here S1-S3 are the core and the API of plan S1-S3, "screens A"
is every screen of plan S1-S3 (AC 39-44, 80-86, the facts widget), S4 and S4r are the core and the API of plan S4 (reads
and runs), S5 the core and the API of plan S5, and "screens B" every screen of plan S4-S5 (AC 103-105, 113-114), so a
batch cut never splits a check slice and the plan's own cut (S3/S4, part A then part B) is a slice boundary.

Every proof is `npx vitest run <file> -t "<C-id> "` from the repository root (root tests) or
`npm run test -w apps/command-centre -- <file> -t "<C-id> "` (UI tests); a test title starts with its check id followed by
a space. `E2E` proofs build the CLI and the interface first and then run
`MORDOMO_E2E_PORT=4901 npx playwright test --config tests/e2e/playwright.config.ts <spec> -g "<C-id> "`: the e2e server
runs `apps/api/dist/cli.js` and serves the built interface, so a proof without the build runs yesterday's code (L-056);
the same holds for `bundle:check`, which weighs `apps/command-centre/dist`. Root files that go through HTTP use
`app.inject` against `buildServer` over a real home through a new `tests/helpers/memoriaWorld.ts` built on
`tests/helpers/notesViewWorld.ts` (owner, device and run headers, `put`, `update`, `index`) and, for runs of
`consolidate-memory` and write runs, on the `questionWorld` pattern of `tests/helpers/paineisWorld.ts` (the fake Claude CLI
of `tests/fixtures/fake-bin`, a spy on `ClaudeAdapter.prototype.execute` that writes the run's files). A run credential is
`ctx.runApiAccessFor(record, mode)` over a record `ctx.runs.create` made, as `tests/natureza.contract.test.ts` C66 does.
`tests/memoria.layer.test.ts` calls the deciding code itself with no HTTP (`Test policy` rows 1 and 2): `factKey`, the
overlap rule of door 2, the provenance rule of door 3, the versioned-path rule and the retention of door 4, the
proposal.json schema of door 6, the op applier, the trust rule and the budget of door 7, the guard's decision of door 8,
and the folder-level resolver of door 12.

"Now" in every claim is a fixed clock the test sets; "today" is its local day as `sentinelDay` writes it. Every claim that
names a local day or a local minute (`em::`, `valid_to::`, `→ closed`, the sentinel's day, the export folder's
`AAAA-MM-DD-HHMM`, "Versão de <data e hora>") is proven in a file that pins `process.env.TZ = "America/Sao_Paulo"` at its
top and asserts the pin holds, with the clock at 23:30 local (02:30 UTC of the next day), where the local and the UTC day
differ (AD-043 b, L-053): `tests/memoria.localday.test.ts` and `apps/command-centre/src/brain/notes/historyTime.test.tsx`.
A claim that names a status and a code asserts both. A claim that says "as before" or "as today" asserts the value by name
(L-044); a claim about a stored value reads back what the route wrote, never a row the test seeded (L-051); every list
writer has a one-item case (L-050); every bound has its accepted edge and its refused edge (L-057); every UI mock answers
by the query it receives and fails on a query it was not given (L-052); a claim about where something sits on screen
asserts the order of the elements (L-046).

## Checks

### S1 - fatos que se reconhecem e as duas linhas do tempo (plan S1) · 10 files · 99 KB · ~25k

**C1** - `factKey` (door 1), one asserted case per row at its own layer: `Cliente  São Paulo`, `cliente sao paulo` and
`CLIENTE SÃO PAULO` → `cliente sao paulo`; `"  Ação\t\n X "` → `acao x`; `Ångström` → `angstrom`; the ligature `ﬁm` →
`fim` (NFKD); `""` after trimming is refused; and the route uses that same function: asserting `CLIENTE SÃO PAULO ·
Status · a` then `cliente sao paulo · status · b` through `POST /api/memory/facts` closes the first (it is in
`invalidated`) (AC 1, door 1)
Proof: `npx vitest run tests/memoria.layer.test.ts -t "C1 "`
Proof: `npx vitest run tests/memoria.facts.test.ts -t "C1 "`

**C2** - With an open fact `Cliente X · status · ativo` from 2026-01-01, `POST /api/memory/facts` of `cliente x · STATUS ·
prospect` with `validFrom` 2026-06-01 answers `201`, its `invalidated` holds the first fact with `validTo` = 2026-06-01
(`toEqual` over the whole fact), and `GET /api/memory/facts?includeExpired=true` reads back the first with `validTo` =
2026-06-01 and `retractedAt: null` (AC 2, AC 7)
Proof: `npx vitest run tests/memoria.facts.test.ts -t "C2 "`

**C3** - With an open, unretracted `Cliente X · status · ativo  agora`, asserting `cliente x · status · ativo agora`
(whitespace collapsed) answers `200` with `unchanged: true`, `invalidated: []`, the same `fact.id`, and the row count of
`facts` is unchanged; asserting `cliente x · status · Ativo agora` (case differs: the object keeps its case, door 1)
answers `201` and closes the first; asserting the object of a fact that was retracted as `wrong` answers `201` with a new
id (a retracted fact is not "open, unretracted") (AC 3, door 1)
Proof: `npx vitest run tests/memoria.facts.test.ts -t "C3 "`

**C4** - Asserting subject `  Cliente X  ` stores and returns `subject: "Cliente X"` (trimmed, case kept) and `predicate`
as sent; `GET /api/memory/facts?subject=cliente%20x` returns it, `?predicate=STATUS` returns it, `?subject=Cliente%20Y`
returns none (AC 4, door 1)
Proof: `npx vitest run tests/memoria.facts.test.ts -t "C4 "`

**C5** - After migration 28 (name `fact-keys-and-provenance`), `PRAGMA table_info(facts)` holds, besides the columns of
before, `subject_key TEXT NOT NULL`, `predicate_key TEXT NOT NULL`, `retracted_at INTEGER`, `source_line INTEGER`, `author
TEXT NOT NULL`, `trust TEXT NOT NULL`, `proposal_id TEXT` (`toEqual` over name, type, notnull), and `PRAGMA
index_info(idx_facts_key)` is `subject_key`, `predicate_key`; on a database at 27 (`openDb` with
`MIGRATIONS.filter(m => m.version <= 27)`) holding `Cliente  São Paulo · status · a` (open), `cliente sao paulo · Status ·
b` (open) and a closed fact, the migration fills both keys of every row with `factKey`, leaves `valid_from`, `valid_to` and
`object` of every row equal to before (`toEqual`), and leaves the two open facts both open; then (second pass, L-059) a
`POST /api/memory/facts` of `CLIENTE SÃO PAULO · STATUS · c` on that migrated database closes both, so the backfilled key
equals the key the route computes; migrations 26 and 27 keep their names (AC 5, door 1)
Proof: `npx vitest run tests/memoria.migration.test.ts -t "C5 "`

**C6** - Migration 28 gives every existing fact `author` = `run:r-1` for the row whose `source_run_id` is `r-1` and
`unknown` for a row with none, and `trust` = `inferido` for both (read back through `GET /api/memory/facts`, `author` and
`trust` by value) (AC 19, door 3)
Proof: `npx vitest run tests/memoria.migration.test.ts -t "C6 "`

**C7** - `POST /api/memory/facts` with `validTo` equal to `validFrom` and with `validTo` one millisecond before it each
answer `400 validation` with an issue at `validTo` and leave the rows of `facts` equal to before; `validTo` =
`validFrom` + 1 answers `201` and the row reads back with that `validTo` (the option reaches the stored row, L-058)
(AC 6, door 2)
Proof: `npx vitest run tests/memoria.facts.test.ts -t "C7 "`

**C8** - Asserting `[T, ∞)` over an open fact of the same keys and another object whose `valid_from` is T − 1 day sets its
`valid_to` to T and leaves `retracted_at` null; one whose `valid_from` is T − 1 ms gets the same (AC 7, door 2)
Proof: `npx vitest run tests/memoria.facts.test.ts -t "C8 "`
Proof: `npx vitest run tests/memoria.layer.test.ts -t "C8 "`

**C9** - Asserting `[T, U)` leaves unchanged a fact of the same keys and another object whose `valid_from` is exactly U,
and one whose `valid_from` is U + 1 day (`toEqual` over the row before and after) (AC 8, door 2)
Proof: `npx vitest run tests/memoria.facts.test.ts -t "C9 "`
Proof: `npx vitest run tests/memoria.layer.test.ts -t "C9 "`

**C10** - Asserting `[T, ∞)` over a fact of the same keys and another object whose `valid_from` is exactly T, and over one
whose `valid_from` is T + 1 day, sets each one's `retracted_at` to now and leaves its `valid_from` and `valid_to` as they
were; a third whose `valid_from` is T − 1 ms is closed at T instead (C8), so the boundary sits at T (AC 9, door 2)
Proof: `npx vitest run tests/memoria.facts.test.ts -t "C10 "`
Proof: `npx vitest run tests/memoria.layer.test.ts -t "C10 "`

**C11** - Asserting `[T, U)` over a fact of the same keys and another object that starts before T and never ends, and over
one that starts before T and ends at U + 1, each answers `409 fact_overlap` and leaves the rows of `facts` equal to before;
over one that starts before T and ends exactly at U it answers `201` and closes that fact at T (the old fact does not end
after U); the door-2 table at its own layer, one asserted case per row: begins before T and overlaps → `valid_to = T`;
begins at or after T, overlaps, new without U → `retracted_at = now`; begins at or after U → unchanged; new strictly inside
→ refused (AC 10, door 2)
Proof: `npx vitest run tests/memoria.facts.test.ts -t "C11 "`
Proof: `npx vitest run tests/memoria.layer.test.ts -t "C11 "`

**C12** - With four facts (open; closed; retracted as `wrong`; closed then retracted), `GET /api/memory/facts` with none of
`asOf`, `knownAt`, `includeExpired`, `includeRetracted` returns only the open one; `includeRetracted=true` adds the
retracted open one; `includeExpired=true&includeRetracted=true` returns all four; `asOf` at a time the retracted fact's
interval covers leaves it out unless `includeRetracted=true` (G5) (AC 11, door 2)
Proof: `npx vitest run tests/memoria.facts.test.ts -t "C12 "`

**C13** - `GET /api/memory/facts?knownAt=K` returns a fact recorded at exactly K and one recorded at K − 1, not one
recorded at K + 1; returns one retracted at K + 1, not one retracted at exactly K; `knownAt=abc` and `knownAt=1.5` each
answer `400 validation` (AC 12, Observable "API GET /api/memory/facts")
Proof: `npx vitest run tests/memoria.facts.test.ts -t "C13 "`

**C14** - `POST /api/memory/facts/:id/retract` with `{ reason: "wrong" }` on an open fact answers `200` with `retractedAt` =
now and `validTo: null`, and on a closed fact keeps its `validTo` and sets `retractedAt`; both read back so; `{ reason:
"oops" }` answers `400 validation` and changes no row (AC 13, door 2)
Proof: `npx vitest run tests/memoria.facts.test.ts -t "C14 "`

**C15** - `POST /api/memory/facts/:id/retract` with no body and with `{ reason: "ended" }` each set `validTo` to now
(`Math.max(now, validFrom)`, as today) and leave `retractedAt: null`; on a fact already closed it answers `200` with the
fact unchanged (as today); an unknown id answers `404 not_found` (as today) (AC 14, L-044)
Proof: `npx vitest run tests/memoria.facts.test.ts -t "C15 "`

**C16** - Every fact `GET /api/memory/facts` returns has exactly the keys `id`, `subject`, `predicate`, `object`,
`validFrom`, `validTo`, `sourceRunId`, `sourcePath`, `createdAt`, `recordedAt`, `retractedAt`, `sourceLine`, `author`,
`trust`, `proposalId`, `sourceFileId` (`recordedAt` equals `createdAt`); `sourceFileId` is the `files.id` of the indexed row
whose `path` is `sourcePath`, `null` when no row has that path, and `null` when `sourcePath` is null (AC 15, door 2)
Proof: `npx vitest run tests/memoria.facts.test.ts -t "C16 "`

**C17** - The provenance rule at its own layer, each case refused or accepted for its own reason alone (L-039): no
`sourcePath`, `sourceRunId` or `proposalId` with `author` `owner` → accepted; only `sourcePath` with `author` `run:r-1` →
accepted; only `sourceRunId` → accepted; only `proposalId` with `author` `mcp` → accepted; none with `author` `mcp`, with
`unknown` and with `run:r-1` → each `provenance_required`; no route lets a caller name an author (the owner token is
`owner`, C19; a run's fact becomes a proposal, C39), so the refusal is reached at the layer only (AC 16, door 3)
Proof: `npx vitest run tests/memoria.layer.test.ts -t "C17 "`

**C18** - `POST /api/memory/facts` with `sourceLine: 3` and no `sourcePath` answers `400 validation`; with `sourcePath` and
`sourceLine: 0` answers `400 validation`; with `sourcePath` and `sourceLine: 1` answers `201` and reads back `sourceLine:
1` (AC 17, door 3)
Proof: `npx vitest run tests/memoria.facts.test.ts -t "C18 "`

**C19** - A fact the owner token asserts with no source reads back `author: "owner"` and `trust: "usuario"`; one with
`sourcePath` reads back the same author and trust (AC 18, door 3)
Proof: `npx vitest run tests/memoria.facts.test.ts -t "C19 "`

**C20** - `GET /api/memory/facts` leaves out, each case for its own reason: a fact whose `sourcePath` is under a folder of
`settings.excludes`; one whose `sourcePath` is a secret name (`.env`); one whose `sourcePath` is relative
(`journal/2026-01-01.md`, a verdict that cannot be computed); at its own layer, one whose policy function throws (fails
closed, L-061); it returns a fact with `sourcePath: null` and one under `memory/journal/`; `stats` is unchanged in shape
(AC 20)
Proof: `npx vitest run tests/memoria.facts.test.ts -t "C20 "`
Proof: `npx vitest run tests/memoria.layer.test.ts -t "C20 "`

### S2 - histórico de memory/ e restauração (plan S2, AC 21-38) · 15 files · 210 KB · ~53k

**C21** - Each owner write records exactly one version, read back through `GET /api/memory/history?path=<rel>` (never a
seeded row, L-051), with `author: "owner"` and, by route: `POST /api/memory/notes` → `origin: "create"`; `PUT
/api/memory/notes` → `save`; `PUT /api/memory/notes/properties` → `properties`; `PUT /api/memory/tasks` → `task` (the plan
names `POST`; the route is `PUT`, `contracts/src/api/memory.ts:826`, G1); `POST /api/memory/reviews` with `keep` on a note
under `memory/` → `review`; each version's `sha256` is the `version` the route answered and its bytes equal the file's
(AC 21, door 4)
Proof: `npx vitest run tests/memoria.history.test.ts -t "C21 "`

**C22** - `POST /api/memory/cleanup/apply` of a one-move manifest (L-050) taking `notes/velha.md` to `archive/…/velha.md`
records a `cleanup` version (author `owner`) at the archive path with the file's bytes and a `removed` version (no
`sha256`, no blob) at `notes/velha.md`; `POST /api/memory/cleanup/undo` of that manifest records a `cleanup` version at
`notes/velha.md` and a `removed` one at the archive path (AC 22, door 4, G2)
Proof: `npx vitest run tests/memoria.history.test.ts -t "C22 "`

**C23** - After the baseline pass, a file edited with `fs` and an index pass records one version with `author:
"external"` and `origin: "external"` holding the new bytes; a second pass over the same bytes records none (L-059); a file
whose `mtime` changes and bytes do not records none (AC 23, door 4)
Proof: `npx vitest run tests/memoria.history.test.ts -t "C23 "`

**C24** - A versioned file deleted with `fs` and an index pass records one `removed` version (`sha256: null`, author
`external`, no `memory_blobs` row added); a second pass records none more; the file created again and a pass record an
`external` version (not `baseline`) (AC 24, door 4, G2)
Proof: `npx vitest run tests/memoria.history.test.ts -t "C24 "`

**C25** - The versioned set, table-driven over 17 paths at the layer and through an index pass (one version each, or
none): versioned - `MEMORY.md`, `notes/a.md`, `topics/x.md`, `archive/x.md`, `notes/journal/x.md`, `notes/areas/x.md`,
`notes/contexts/x.md`, `notes/ROUTER.md` (look-alikes of the excluded names, L-054) and a `.md` of exactly 1 048 576 bytes;
not versioned - `journal/2026-10-31.md`, `areas/a.md`, `contexts/c.md`, `ROUTER.md`, `notes/a.txt`, `notes/b.json`, a `.md`
of 1 048 577 bytes, and a `.md` in an enabled indexed folder outside `memory/` (AC 25, door 4)
Proof: `npx vitest run tests/memoria.layer.test.ts -t "C25 "`
Proof: `npx vitest run tests/memoria.history.test.ts -t "C25 "`

**C26** - Saving `notes/a.md` with bytes A, then B, then A again records three versions and two `memory_blobs` rows; a
second path saved with bytes A adds no blob; each blob row is `sha256` = the hash of the uncompressed bytes, `codec:
"deflate"`, `size` = the uncompressed length, and `zlib.inflateRawSync(bytes)` equals the file's bytes (AC 26, door 4)
Proof: `npx vitest run tests/memoria.history.test.ts -t "C26 "`

**C27** - A path saved 50 times keeps all 50 versions; the 51st save drops exactly the oldest (by `id`) and the path holds
50; the dropped version's blob is deleted when no other version names it and kept when another path's version names it
(AC 27, door 4)
Proof: `npx vitest run tests/memoria.history.test.ts -t "C27 "`

**C28** - With `memory.history.maxBytes` set through `PUT /api/settings` (the option reaches the retention, L-058) to the
stored size of 12 incompressible blobs, saving a 13th version drops the oldest versions that are not among the newest 5 of
their path until the stored size is at or under the cap, and deletes every blob no version names; a store where every path
holds 5 or fewer versions keeps them all even above the cap (the accepted edge of the floor); a store exactly at the cap
drops nothing (AC 28, door 4)
Proof: `npx vitest run tests/memoria.history.test.ts -t "C28 "`
Proof: `npx vitest run tests/memoria.layer.test.ts -t "C28 "`

**C29** - `GET /api/memory/history?path=notes/a.md` answers `200` with `versions` newest first, each with exactly `id`,
`path`, `at`, `author`, `origin`, `size`, `sha256`, `exists`; `limit=1` returns only the newest (L-050); `path=/abs/a.md`,
`path=../fora.md`, `limit=0` and `limit=abc` each answer `400 validation` (AC 29, Surface)
Proof: `npx vitest run tests/memoria.history.test.ts -t "C29 "`

**C30** - With 101 versions across four paths, `GET /api/memory/history` returns the newest 100 in `id` order descending;
with exactly 100 it returns 100; each carries `exists: true` while its path exists and `exists: false` after the file is
deleted (AC 30)
Proof: `npx vitest run tests/memoria.history.test.ts -t "C30 "`

**C31** - `GET /api/memory/history/:id` answers `200` with `id`, `path`, `at`, `author`, `origin`, `content` (the version's
text), `diff` equal to `unifiedDiff(<current text>, <version text>)` of `core/src/sync/diff.ts`, and `current` = the
current file's version; for a path that no longer exists, `diff` equals `unifiedDiff("", <version text>)` and `current:
null`; an unknown id and the id of a `removed` version each answer `404 not_found` (G4) (AC 31)
Proof: `npx vitest run tests/memoria.history.test.ts -t "C31 "`

**C32** - `POST /api/memory/history/restore` with the id of the second of three versions and `baseVersion` = the file's
version answers `200` with `path` and `version`; the file's bytes equal that version's bytes byte for byte with a
non-canonical fixture (CRLF line ends, no trailing newline, L-025); `version` is the hash of the new bytes; one `restore`
version (author `owner`) is read back as the newest of the path (AC 32, door 4)
Proof: `npx vitest run tests/memoria.history.test.ts -t "C32 "`

**C33** - With `notes/sumiu.md` saved twice, deleted with `fs` and indexed (`removed` newest), a restore of its second
version with no `baseVersion` creates the file with those bytes (create mode), answers `200`, and records a `restore`
version (AC 33)
Proof: `npx vitest run tests/memoria.history.test.ts -t "C33 "`

**C34** - A restore whose `baseVersion` differs from the file on disk answers `409 edit_conflict`, and the file's bytes and
`mtime` and the path's version count are unchanged; a restore with no `baseVersion` of a path whose newest version is
`removed` but which a test created again before any index pass answers `409 edit_conflict` and leaves the new file as it is
(AC 34)
Proof: `npx vitest run tests/memoria.history.test.ts -t "C34 "`

**C35** - A restore of a version row the test inserts at `journal/2026-10-31.md` (no writer records one: C25) answers `403
note_not_editable`; of a version whose path now passes through a link answers `403 forbidden_path`; an unknown id and the id
of a `removed` version each answer `404 not_found`; a body with no `id` answers `400 validation`; none writes a file (AC 35)
Proof: `npx vitest run tests/memoria.history.test.ts -t "C35 "`

**C36** - A device with every scope gets `403 owner_only` from `POST /api/memory/history/restore` and no file or row changes;
a device with `content` gets `200` from `GET /api/memory/history` and `GET /api/memory/history/:id`, one with only
`monitor` gets `403 scope_required`; a memory skill's run credential (`rc_…`, write mode) gets `403 forbidden` from all
three (AC 36, door 10)
Proof: `npx vitest run tests/memoria.history.test.ts -t "C36 "`

**C37** - After migration 29 (name `memory-history`), `memory_blobs` and `memory_versions` have the columns of door 4
(`toEqual` over name, type, notnull, pk, including `AUTOINCREMENT` on `id`) and the index on `(path, id)`; the first index
pass over a home with four versioned and three unversioned files records exactly four `baseline` versions (author
`system`, G2); a second pass over the same files records none (L-059); with a byte cap below the four baselines' size all
four are still written (G3) (AC 37, door 4)
Proof: `npx vitest run tests/memoria.migration.test.ts -t "C37 "`
Proof: `npx vitest run tests/memoria.history.test.ts -t "C37 "`

**C38** - The recursive listing of `memory/` (names and bytes) after ten writes that each record a version differs from the
listing before only by the files those writes changed: no file or folder the history made (no `.git`, no blob file); the
two tables hold the versions (AC 38, door 4)
Proof: `npx vitest run tests/memoria.history.test.ts -t "C38 "`

**C39** - A backup made after versions exist, restored over a fresh home, answers `GET /api/memory/history` with the same
versions and `GET /api/memory/history/:id` with the same `content`; a backup made at schema 27 (before this feature) with
facts, restored, opens at 30 with the facts' keys filled and `author` `unknown` (the migrations run on restore, L-024)
(AD-045, door 4)
Proof: `npx vitest run tests/memoria.migration.test.ts -t "C39 "`

### S3 - caixa de revisão e consolidação revisável (plan S3, AC 45-79) · 24 files · 235 KB · ~59k

**C40** - A write run's credential calling `POST /api/memory/facts` answers `202` with `{ proposal }` whose `kind` is
`fact`, `status` `pending`, `author` `run:<runId>`, `runId` the run's id; no `facts` row is added; `GET
/api/memory/proposals` lists it; the 101st call of one run answers `429 too_many_requests` (`MEMORY_WRITES_PER_RUN`, as
before); a read-only run's credential gets `403 forbidden` (as before) (AC 45, door 9)
Proof: `npx vitest run tests/memoria.proposals.test.ts -t "C40 "`

**C41** - The owner token's `POST /api/memory/facts` answers `201` with `{ fact, invalidated: [], unchanged: false }` for a
new fact and `200` with `{ fact: <same id>, invalidated: [], unchanged: true }` for the same fact again, as today, and no
proposal is stored (AC 46, L-044)
Proof: `npx vitest run tests/memoria.proposals.test.ts -t "C41 "`

**C42** - The owner token's `POST /api/memory/proposals` with `kind` `fact`, `note_create` and `note_save` (each with its
body) answers `201` with a `proposal` of that `kind`, `status: "pending"`, `author: "mcp"`, `runId: null` and an `id`
matching `^mp_[0-9a-f]{16}$`, and stores no fact and no file; a `fact` with no `object`, a `note_save` with no
`baseVersion`, `kind: "consolidation"` and `kind: "memory_edit"` each answer `400 validation` (AC 47, door 5)
Proof: `npx vitest run tests/memoria.proposals.test.ts -t "C42 "`

**C43** - `GET /api/memory/proposals` answers `items` newest first, each with exactly `id`, `kind`, `status`, `author`,
`runId`, `createdAt`, `summary`, `opCount`, and `total`; `status=pending` lists only pending, `status=decided` only
`accepted`, `partial`, `rejected` and `superseded`; `limit=1` returns one (L-050); `status=open` answers `400 validation`
(Surface, door 10)
Proof: `npx vitest run tests/memoria.proposals.test.ts -t "C43 "`

**C44** - The MCP tools `facts_assert`, `note_create` and `note_save` (from `mordomoTools` over an API that records each
call) each send exactly one `POST /api/v1/memory/proposals` with `kind` `fact`, `note_create`, `note_save` and the tool's
fields, never `/api/v1/memory/facts` nor `/api/v1/memory/notes`, and answer exactly `Proposal mp_<16 hex> is waiting for
review in the MordomoOS inbox.`; against a real server, no fact and no note exists afterwards; `facts_query`, `note_read`
and `recall` send the requests of before (AC 48, door 9)
Proof: `npx vitest run tests/memoria.mcp.test.ts -t "C44 "`

**C45** - A journal line appended by a write run's credential, and one appended by the owner token with `author: "agent"`,
each end with ` (autor:: agente)` in the day's file; one appended by the owner token with no `author` has no such suffix
(as before, its text by value); `author: "owner"` answers `400 validation`; a run's 101st append answers `429
too_many_requests` (as before) (AC 49, door 9)
Proof: `npx vitest run tests/memoria.proposals.test.ts -t "C45 "`

**C46** - The MCP tool `journal_append` sends `{ text, author: "agent" }` and, with a section, `{ text, section, author:
"agent" }` (`toEqual` over the body) (AC 50)
Proof: `npx vitest run tests/memoria.mcp.test.ts -t "C46 "`

**C47** - With 199 pending proposals the 200th (`POST /api/memory/proposals`) answers `201`; with 200 pending the next
answers `429 too_many_proposals` and stores nothing, and so does a run credential's `POST /api/memory/facts`; with 200
proposals of which one is `rejected`, a new one answers `201`; the consolidation hook and the guard still store at 200 (G8)
(AC 51, door 5)
Proof: `npx vitest run tests/memoria.proposals.test.ts -t "C47 "`

**C48** - A run of `consolidate-memory` that finishes `done` leaving `artifacts/<runId>/proposal.json` valid by door 6
stores exactly one pending `consolidation` proposal whose `runId` is the run's, whose `summary` is the file's, and whose
`ops` equal the file's (read back through `GET /api/memory/proposals/:id`); the accepted edges each store one: a file of
exactly 262 144 bytes, 200 ops, a `summary` of 2 000 characters, an op `text` of 500 characters, and a one-op file (L-050)
(AC 52, door 6)
Proof: `npx vitest run tests/memoria.consolidation.test.ts -t "C48 "`

**C49** - Each invalid `proposal.json`, refused for its own reason alone (every other field valid, L-039), stores no
proposal and adds exactly one inbox row (`messageKey: "proposals.invalidNotice"`, G23) whose body names the reason: the file
missing ("missing"); 262 145 bytes ("256 KiB"); not JSON ("JSON"); `v: 2`, an op `"op": "rename"`, a `section: "Notes"`, a
`text` of 501 characters, a `summary` of 2 001, a `source` that is absolute and an `on` that is not `AAAA-MM-DD` (each body
naming the issue's path, e.g. `ops.0.section`); 201 ops ("200"); a run that ends `failed`, and a run of another skill that
leaves a `proposal.json`, store no proposal and add no such row (AC 53, door 6)
Proof: `npx vitest run tests/memoria.consolidation.test.ts -t "C49 "`

**C50** - Storing a `consolidation` proposal makes both older pending `consolidation` proposals `superseded` and leaves an
`accepted` consolidation, a pending `fact` and a pending `memory_edit` as they were (AC 54, door 5)
Proof: `npx vitest run tests/memoria.consolidation.test.ts -t "C50 "`

**C51** - In `GET /api/memory/proposals/:id`, an op carries `state: "invalid"` with a `reason`, each for its own reason: its
`source` names a file that does not exist under `memory/`; its `line` is the source's line count + 1 (the last line is
`valid`); its `source` is under a folder of `settings.excludes`; its `source` is `../fora.md` (a verdict that cannot be
computed, fails closed, L-061); accepting the proposal with every valid op leaves those ops unapplied (AC 55)
Proof: `npx vitest run tests/memoria.proposals.test.ts -t "C51 "`
Proof: `npx vitest run tests/memoria.layer.test.ts -t "C51 "`

**C52** - The trust of an op, one asserted case per row at its own layer and on the route: a journal line under `##
Decisions` with no `(autor:: agente)` → `usuario`; a line of `notes/cliente.md` → `usuario`; a journal line under `## Runs`
→ `ferramenta`; a journal line ending `(autor:: agente)` → `inferido`; an op with no `line` → `inferido`; a line of
`MEMORY.md` itself → `inferido`; a `trust` the agent writes into the op is ignored (AC 56, door 2 "calculada pelo sistema")
Proof: `npx vitest run tests/memoria.layer.test.ts -t "C52 "`
Proof: `npx vitest run tests/memoria.proposals.test.ts -t "C52 "`

**C53** - `GET /api/memory/proposals/:id` of a `consolidation` proposal answers `diff` equal to `unifiedDiff(<current
MEMORY.md>, <MEMORY.md with its valid ops applied>)` and `baseVersion` = the version of the `MEMORY.md` it read; of a
`memory_edit` proposal, `diff` = `unifiedDiff(<current>, <the run's bytes>)`; of a `note_save`, the diff of the note to
the proposed content; an unknown id answers `404 not_found` (AC 57, door 10)
Proof: `npx vitest run tests/memoria.proposals.test.ts -t "C53 "`

**C54** - Accepting an `add` op to `Decisions` with `source: "journal/2026-10-30.md"` and `line: 4` at 23:30 local of
2026-10-31 (02:30 UTC of 11-01) writes, as the last line of `## Decisions`, `- <text> (fonte:: journal/2026-10-30.md:4)
(autor:: agente) (em:: 2026-10-31)`; with no `line`, `(fonte:: journal/2026-10-30.md)`; with `source:
"notes/cliente.md#Contrato"`, `(fonte:: notes/cliente.md#Contrato)` (AC 58, door 7)
Proof: `npx vitest run tests/memoria.localday.test.ts -t "C54 "`

**C55** - Accepting a `supersede` op at 23:30 local of 2026-10-31 moves the exact `old` line to the end of `## Superseded`
with ` (valid_to:: 2026-10-31)` appended and adds the new line to the old line's section as in C54 (AC 59, door 7)
Proof: `npx vitest run tests/memoria.localday.test.ts -t "C55 "`

**C56** - Accepting a `close_loop` op with `on: "2026-10-31"` appends ` → closed 2026-10-31` to the exact `old` line and
leaves it in `## Open loops`; a section an op needs that `MEMORY.md` lacks is appended at the end in the order Facts,
Decisions, Open loops, Reflections, Superseded, and a missing `MEMORY.md` is created holding only the sections the ops need
(G10) (door 7)
Proof: `npx vitest run tests/memoria.localday.test.ts -t "C56 "`

**C57** - An op `supersede`, one `close_loop` and one `move_to_topic` whose named line is not in `MEMORY.md` when the
proposal is read (one case each; the same line with a trailing space is "not in") each carry `state: "conflict"`, and an
accept applies none of them (AC 60)
Proof: `npx vitest run tests/memoria.proposals.test.ts -t "C57 "`

**C58** - Accepting a `move_to_topic` op with topic `clientes` and two lines appends both to `memory/topics/clientes.md`,
created with front matter `type: memoria-topico` when missing (and appended to, header unchanged, when present), and puts,
where the first moved line was, the one line `- Clientes → [[topics/clientes]] (autor:: agente) (em:: 2026-10-31)` at
23:30 local of 2026-10-31; the topic file gets a `proposal` version (AC 61, door 7)
Proof: `npx vitest run tests/memoria.localday.test.ts -t "C58 "`

**C59** - The budget of door 7, each case for its own reason, at its own layer and through `decide`: a result of 201 lines
and 24 000 bytes over a current file of 150 lines → `409 memory_over_budget` and nothing written; 180 lines and 25 001 bytes
→ `409 memory_over_budget`; exactly 200 lines and 25 000 bytes → `200`; a result of 220 lines over a current file of 230
lines → `200` (smaller than now) (AC 62, door 7)
Proof: `npx vitest run tests/memoria.layer.test.ts -t "C59 "`
Proof: `npx vitest run tests/memoria.proposals.test.ts -t "C59 "`

**C60** - `decide` with `action: "accept"`, `ops: [0]` of two valid ops and the current `baseVersion` applies only op 0,
answers `200` with `proposal.status: "partial"` and `written` = `[{ path: "MEMORY.md", version }]` where `version` is the
hash of the file's new bytes, and records a `MEMORY.md` version with `origin: "proposal"`, `proposal_id` = the id and
`author` = the proposal's author (G2), read back through the history; `ops: [0, 1]` → `accepted`; with one valid and one
`invalid` op, `ops: [0]` → `accepted`; `ops: [5]`, and an index of an `invalid` op, answer `400 validation` and write
nothing (G9) (AC 63, door 10)
Proof: `npx vitest run tests/memoria.proposals.test.ts -t "C60 "`

**C61** - Accepting a `fact` op with `source: "journal/2026-10-30.md"`, `line: 4` from a run's consolidation stores a fact
that `GET /api/memory/facts` reads back with `sourcePath` = `<memory>/journal/2026-10-30.md`, `sourceLine: 4`, `author:
"run:<runId>"`, the op's `trust` and `proposalId` = the proposal's id (each option reaches the stored row, L-058), and the
answer's `facts[]` holds it (AC 64, door 3)
Proof: `npx vitest run tests/memoria.proposals.test.ts -t "C61 "`

**C62** - `decide` with a `baseVersion` other than the version of `MEMORY.md` on disk answers `409 edit_conflict`; the
file's bytes and `mtime` are unchanged, no fact was asserted (row count), and the proposal reads back `pending` (AC 65)
Proof: `npx vitest run tests/memoria.proposals.test.ts -t "C62 "`

**C63** - When writing a topic file fails after the ops were validated (the test makes `memory/topics` a regular file),
`decide` answers `500 internal` (G6), asserts none of the proposal's facts, records no version, leaves `MEMORY.md` with the
bytes of before (a file written earlier in the same decision is put back) and the proposal `pending`; after the obstacle is
removed, a second `decide` with the same body answers `200`, writes both files and asserts the facts (L-049) (AC 66,
Flow 10)
Proof: `npx vitest run tests/memoria.proposals.test.ts -t "C63 "`

**C64** - `decide` with `action: "reject"` answers `200` with `status: "rejected"` and `decidedAt` = now; the listing of
`memory/` and the rows of `facts` and `memory_versions` are equal to before (AC 67)
Proof: `npx vitest run tests/memoria.proposals.test.ts -t "C64 "`

**C65** - `decide` on a proposal that is `accepted`, one `partial`, one `rejected` and one `superseded` (one case each,
L-039) answers `409 proposal_decided` and changes nothing; `decide` on an unknown id answers `404 not_found` (AC 68)
Proof: `npx vitest run tests/memoria.proposals.test.ts -t "C65 "`

**C66** - Accepting a `note_save` proposal saves its content through the guarded replace with the proposal's `baseVersion`
(the file's bytes equal the content, a `proposal` version is read back); when the note changed after the proposal was made,
`decide` answers `409 edit_conflict` and the proposal stays `pending`; a `note_save` whose content passes the note size
limit (`MAX_NOTE_BYTES`) answers `413 note_too_large` and stays `pending` (AC 69)
Proof: `npx vitest run tests/memoria.proposals.test.ts -t "C66 "`

**C67** - Accepting a `note_create` proposal with `title` and `area` creates the note at the path `POST /api/memory/notes`
would give the same body on a twin home (`toEqual` over path and bytes) and records a version with `origin: "proposal"`
and `author: "mcp"` (AC 70)
Proof: `npx vitest run tests/memoria.proposals.test.ts -t "C67 "`

**C68** - A device with every scope gets `403 owner_only` from `POST /api/memory/proposals` and from `decide`, and nothing
changes; a device with `content` gets `200` from both `GET`s and one with only `monitor` `403 scope_required`; a write
run's credential gets `403 forbidden` from all four (AC 71, door 10)
Proof: `npx vitest run tests/memoria.proposals.test.ts -t "C68 "`

**C69** - A write run of the fake CLI that appends a line to `memory/MEMORY.md` leaves, after `run.finished`, the file with
the bytes of its start, a pending `memory_edit` proposal (author `run:<runId>`) whose diff reaches the run's bytes, and two
`guard` versions of `MEMORY.md` (author `system`): the run's bytes, then the start bytes; a write run that creates
`MEMORY.md` where none was leaves no `MEMORY.md`, the run's file at `memory/archive/guard-<runId>-MEMORY.md`, and the
proposal; a run that changes `memory/notes/MEMORY.md` (L-054) and a read-only run trigger no guard (AC 72, door 8)
Proof: `npx vitest run tests/memoria.guard.test.ts -t "C69 "`

**C70** - When the owner saves `MEMORY.md` through `PUT /api/memory/notes` while a write run is held open, and the run then
changes it too, the file keeps the run's bytes and no proposal is stored; accepting a proposal during the run does not count
as an `owner` version (G2); at `run.started`, a `guard` version is recorded only when the file differs from its newest
version (AC 73, door 8)
Proof: `npx vitest run tests/memoria.guard.test.ts -t "C70 "`

**C71** - When the file changed again after `run.finished` (the put-back's `expectSha256` no longer matches), the guard
leaves the file as it is, still stores the `memory_edit` proposal with the run's bytes and records one `guard` version of
them; a second write run afterwards is guarded as in C69 (G7, L-049) (door 8)
Proof: `npx vitest run tests/memoria.guard.test.ts -t "C71 "`

**C72** - `skills/consolidate-memory/SKILL.md` parses (the skill loader) with `mode: read_only` and `version: 2.0.0`, its
changelog's last entry starts `2.0.0`, its procedure names `proposal.json`, `"v": 1` and the five op names `add`,
`supersede`, `close_loop`, `move_to_topic`, `fact`, and it holds no instruction to write `MEMORY.md` nor
`POST /api/memory/facts` (AC 74)
Proof: `npx vitest run tests/memoria.skill.test.ts -t "C72 "`

**C73** - `skills/consolidate-memory/resources/heuristics.md` holds the sentence that a journal line ending in `(autor::
agente)` is never promoted by the "Decisions" rule (AC 75)
Proof: `npx vitest run tests/memoria.skill.test.ts -t "C73 "`

**C74** - The bundled `routines/nightly-consolidation.json` has `"enabled": false` and its other 31 keys equal to before;
`seedHome` on a fresh home writes it with `enabled: false`, and on a home whose copy says `true` leaves `true` (as before);
`docs/memory-guide.md` says the routine is off by default and that its output is a proposal in "Revisões", and no longer
says it writes `MEMORY.md` (AC 76, question 1)
Proof: `npx vitest run tests/memoria.skill.test.ts -t "C74 "`

**C75** - With 3 pending proposals and no day recorded, `hourly()` at 23:30 local of 2026-10-31 emits exactly one
`sentinel.fired` whose payload is `{ sentinel: "proposalsPending", count: 3, href: "/brain/reviews?tab=agent", … }`
(`toEqual`), and `meta` holds `sentinel.proposalsPending.day` = `2026-10-31`; with exactly 1 pending, `count: 1`; a second
pass the same day emits none; a pass at 00:30 local of 11-01 emits one; with 0 pending, none (AC 77, door 11)
Proof: `npx vitest run tests/memoria.localday.test.ts -t "C75 "`
Proof: `npx vitest run tests/memoria.sentinel.test.ts -t "C75 "`

**C76** - After the day's `proposalsPending` row is deleted by the owner (`DELETE` of the notification), a later pass the
same day emits none and the inbox holds no new row (the day in `meta` survives, L-060) (AC 78, door 11)
Proof: `npx vitest run tests/memoria.sentinel.test.ts -t "C76 "`

**C77** - With `sentinels.proposalsPending.enabled: false` and 3 pending, `hourly()` emits no `proposalsPending` event and
the `reviewDue` check still runs; with the settings of a fresh home (the key absent) it emits one; an unreadable value reads
`false` (`SETTINGS_FAIL_CLOSED` gains `sentinels.proposalsPending.enabled`) (AC 79)
Proof: `npx vitest run tests/memoria.sentinel.test.ts -t "C77 "`
Proof: `npx vitest run tests/data.settings.test.ts -t "C63 an unreadable flag never reads on"`

**C78** - `SENTINEL_IDS` holds `proposalsPending`; the v1 schema of `sentinel.fired` accepts it and refuses `"other"`; the
fixture `tests/fixtures/events/v1/sentinel.fired.proposalsPending.json` parses; `EVENT_VERSIONS["sentinel.fired"]` is still
`[1]`; `docs/events.md` equals the generated text; the inbox row has `href: "/brain/reviews?tab=agent"`, `messageKey:
"sentinel.proposalsPending"` and `messageParams.count` (door 11)
Proof: `npx vitest run tests/memoria.sentinel.test.ts -t "C78 "`
Proof: `npx vitest run tests/events.contract.test.ts -t "C27 the v1 fixtures keep parsing"`
Proof: `npx vitest run tests/events.contract.test.ts -t "C29 docs/events.md equals the generated text"`

**C79** - After migration 30 (name `memory-proposals`), `memory_proposals` has the columns of door 5 (`toEqual`); the
proposal writer refuses a `kind`, `status` or `author` outside door 5's closed sets at its own layer; a proposal whose run
was pruned by `limits.runRetentionDays` still reads back with its `runId` (no foreign key), and a fact accepted from it
keeps `proposalId` (Relations, doors 2, 4, 5)
Proof: `npx vitest run tests/memoria.migration.test.ts -t "C79 "`

**C148** - (added in batch A2 with door 16, L-047) Read back through `GET /api/memory/proposals/:id`, the `payload` a
proposal stores is, per kind: a run credential's `fact` the body of `POST /api/memory/facts` with `sourceRunId` = the
run's id; an mcp `fact` the body of `POST /api/memory/proposals` without `kind`; `note_create` its body without `kind`;
`note_save` `{ path, content, baseVersion }`; `consolidation` `{ v: 1, summary, ops }` as the file's; the guard's
`memory_edit` `{ path: "MEMORY.md", content: <the run's bytes> }` (`toEqual` each); `result` is `null` while pending,
`{ action: "reject" }` after a reject, and `{ action: "accept", ops: [0], written: [{ path: "MEMORY.md", version }],
facts: [] }` after accepting op 0 of a consolidation, the same as the decision's answer (door 16)
Proof: `npx vitest run tests/memoria.proposals.test.ts -t "C148 "`

### Cross-cutting A, API · 10 files · 193 KB · ~48k

**C80** - The `API` table has the seven new routes with these method, path, scope and named errors (`toEqual` over the
codes; the codes as built, plan amendment 2, "Correções de construção"): `GET /api/memory/history` `content`, none; `GET
/api/memory/history/:id` `content`, `403 forbidden_path`, `404 not_a_file`, `404 not_found`; `POST
/api/memory/history/restore` `owner`, `403 forbidden_path`, `403 note_not_editable`, `404 not_a_file`, `404 not_found`,
`409 edit_conflict`; `GET /api/memory/proposals` `content`, none; `GET /api/memory/proposals/:id` `content`, `403
forbidden_path`, `404 not_a_file`, `404 not_found`, `413 file_too_large`; `POST /api/memory/proposals` `owner`, `429
too_many_proposals`; `POST /api/memory/proposals/:id/decide` `owner`, `404 not_found`, `409 edit_conflict`, `409
proposal_decided`, `409 memory_over_budget`, `413 note_too_large`, `403 forbidden_path`, `404 not_a_file`, `413
file_too_large`, `400 unknown_area`, `403 note_not_editable`, `404 note_missing`, `409 note_exists`, `409
structure_fixed`, `409 fact_overlap`, each of the last six answered by accepting a proposal that meets it (one case
each, the proposal left `pending`); and the changed entries: `memory.facts.assert`
declares `202` with `{ proposal }`, `409 fact_overlap` and `429 too_many_proposals`, `memory.facts.retract` takes `reason`,
`memory.journal.append` takes `author`, `memory.facts.list` takes `knownAt` and `includeRetracted`; the OpenAPI document
validates; each new route answers under `/api/v1/` the same as under `/api/` (door 10, AD-024)
Proof: `npx vitest run tests/memoria.contract.test.ts -t "C80 "`
Proof: `npx vitest run tests/api.openapi.test.ts -t "C16 the document validates"`

**C81** - `EXPECTED_ROUTE_SCOPES` lists the seven routes with door 10's scopes; the refusal probe has one scenario per route
(a `content` device `200` on the four reads, a `monitor` device `403 scope_required`, every device `403 owner_only` on the
three writes, a run credential `403 forbidden` on all seven); `RUN_API_READ_ROUTES` and `RUN_API_WRITE_ROUTES` equal the
feature base's (`toEqual`, read from `git show`) (door 10)
Proof: `npx vitest run tests/memoria.contract.test.ts -t "C81 "`
Proof: `npx vitest run tests/api.refusals.test.ts -t "C81 "`

**C82** - `docs/security.md` lists each of the seven routes with its scope (the drift test reads the table) and says that a
run's `POST /api/memory/facts` becomes a proposal and that the MCP authorship mark is provenance, not containment (door 9,
Assumptions)
Proof: `npx vitest run tests/memoria.contract.test.ts -t "C82 "`

**C83** - With `validateResponses`, a `GET /api/memory/facts` answer whose fact lacks `author` fails with `500
response_contract_violation`; so does a `GET /api/memory/history` version without `origin` and a `GET
/api/memory/proposals/:id` op without `trust` (Surface, AD-024)
Proof: `npx vitest run tests/memoria.contract.test.ts -t "C83 "`

**C84** - The static walker of `tests/security-reads.test.ts` (it resolves each `fs` binding to its import; its claim lists
the spellings it does not cover: a `require` built at run time and a call through `Reflect`, L-048) finds no raw `fs` read
or write in the history, proposal, guard and consolidation-hook modules outside its list, and the list gained no entry
(reads go through `readWorkspaceText`, writes through `writeWorkspaceFile` and `moveWorkspaceFile`); `sdk.instances` finds
no new module-level mutable state (the guard's start state lives on the service instance) (L-038)
Proof: `npx vitest run tests/security-reads.test.ts -t "C84 "`
Proof: `npx vitest run tests/security-reads.test.ts -t "finds nothing outside the list"`
Proof: `npx vitest run tests/sdk.instances.test.ts -t "C30 the module-level mutable state"`

**C85** - Every new settings leaf of part A is classified: `memory.history.maxBytes` (default 268435456) is in
`OPENS_NOTHING` with its reason and `sentinels.proposalsPending.enabled` is in `SETTINGS_FAIL_CLOSED` with `closed: false`;
`PUT /api/settings` with `memory.history.maxBytes` reads back that value and keeps `memory.agentStance` (`memory` merges its
own fields) (Impact "settings", L-042)
Proof: `npx vitest run tests/data.settings.test.ts -t "C46 every leaf"`
Proof: `npx vitest run tests/memoria.contract.test.ts -t "C85 "`

**C86** - Existing behaviour that must not change, each asserted by value: "Virou realidade" (`POST /api/memory/reviews`,
`became_fact`) asserts a fact that reads back with `author: "owner"`, `trust: "usuario"` and `sourcePath` = the note;
the dashboards' `facts` source shows an open fact and leaves out a fact retracted as `wrong` and one closed as `ended`, as
it left out a closed fact at the feature's base ("Correções de construção"); the approvals keep
`limits.approvalTtlDays` and `POST /api/approvals/:id/resolve` creates no proposal; the `## Runs` journal line of a finished
run is still written with the text of before; `MEMORY_WRITES_PER_RUN` is 100 (Flow, Impact "domain")
Proof: `npx vitest run tests/memoria.contract.test.ts -t "C86 "`

### Screens A - aba "Do agente", seção "Histórico", diálogos, widget de fatos (plan S1-S3) · 34 files · 313 KB · ~78k

**C87** - The facts widget shows, below each fact's text and in this order, one 12px line with the trust badge (icon and
text: `UserCheck` "Escrito por você", `Wrench` "Saída de ferramenta", `Sparkles` "Inferido pelo agente", one case each), the
author label ("Você", "Execução a1b2c3", "Agente (MCP)", "Origem desconhecida") and, when `sourcePath` is set, the source as
a link `journal/2026-09-03.md:12` (relative to `memory/`, with `sourceLine`); the mock answers `GET /api/memory/facts` with
no `includeRetracted` and fails on a query that carries it (design.md "Widget de fatos", L-052)
Proof: `npm run test -w apps/command-centre -- src/desktop/widgets/FactsWidget.test.tsx -t "C87 "`

**C88** - "Revisões" shows three `Tabs` in this order: "Para revisar (2)", "Sem classificação (5)", "Do agente (3)", N the
`total` the mock answers for `GET /api/memory/proposals?status=pending` (and for no other query); `/brain/reviews?tab=agent`
opens with "Do agente" selected; `?tab=due` and no `tab` open "Para revisar" (AC 80, L-046, L-052)
Proof: `npm run test -w apps/command-centre -- src/brain/reviews/AgentTab.test.tsx -t "C88 "`

**C89** - Each list item, newest first as the route answered, holds line 1 (the 13px weight-600 class) with the title by
kind, one case each: "Consolidação de 30/10/2026", "Mudança no MEMORY.md por Execução a1b2c3", "Fato: Cliente X · status",
"Nova nota: Reunião", "Edição de cliente"; and line 2 (the 12px secondary class) with, in order, the author label, "há 2
horas" and "3 operações" ("1 operação" for one, G22); `j`/`k` move the selection and `Enter` opens it (design.md "Lista")
Proof: `npm run test -w apps/command-centre -- src/brain/reviews/AgentTab.test.tsx -t "C89 "`

**C90** - The detail of a `consolidation`, top to bottom: the summary, the author with its icon, the diff (title "O que muda
no MEMORY.md", the class with `max-height: 50%` and `overflow: auto`, lines with `+`/`-` signs in mono 12px), "Marcar todas"
then "Desmarcar todas", the op rows, and at the foot "Aceitar selecionadas (1)" (`.btn.primary`, `Check`) then "Recusar"
(`.btn`, `X`); each op row holds, left to right, the checkbox, the section, the text, the source as a link that opens the
file in the notes view at the cited line, and the trust badge; a `note_save` shows "O que muda em cliente" and only
"Aceitar" then "Recusar", with no op list (AC 81, design.md "Detalhe", L-045, L-046)
Proof: `npm run test -w apps/command-centre -- src/brain/reviews/AgentTab.test.tsx -t "C90 "`

**C91** - The checkboxes start, one case per row: `valid` + `usuario` ticked; `valid` + `ferramenta` unticked; `valid` +
`inferido` unticked; `invalid` disabled with `CircleSlash` "Origem inválida" and the reason in 12px below the text;
`conflict` disabled with `AlertTriangle` "A linha mudou" and the reason; "Aceitar selecionadas (0)" is disabled with none
ticked; "Marcar todas" ticks only the enabled ones and "Desmarcar todas" unticks them (AC 82)
Proof: `npm run test -w apps/command-centre -- src/brain/reviews/AgentTab.test.tsx -t "C91 "`

**C92** - "Aceitar selecionadas (2)" sends `POST /api/memory/proposals/<id>/decide` with exactly `{ action: "accept", ops:
[0, 2], baseVersion: <the shown baseVersion> }`; on `200` the item leaves the list, the notice "Proposta aceita." with "Ver
histórico" is on screen at 7 999 ms and gone at 8 000 ms (fake timers), and "Ver histórico" opens the "Histórico" fold of
`MEMORY.md`; a `memory_edit`'s "Aceitar" sends `{ action: "accept", baseVersion }` with no `ops` (AC 83)
Proof: `npm run test -w apps/command-centre -- src/brain/reviews/AgentTab.test.tsx -t "C92 "`

**C93** - A decision that answers `409 edit_conflict` shows in the detail `AlertTriangle`, "O MEMORY.md mudou desde que a
proposta foi aberta." and "Recarregar" (which refetches the proposal); one that answers `409 memory_over_budget` shows "Com
estas operações o MEMORY.md passaria de 200 linhas ou 25 KB. Desmarque operações ou peça uma nova consolidação."; in both
the item stays in the list and selected (AC 84)
Proof: `npm run test -w apps/command-centre -- src/brain/reviews/AgentTab.test.tsx -t "C93 "`

**C94** - "Recusar" opens a `Modal` "Recusar esta proposta?" with "Nada será gravado. A proposta fica no histórico de
propostas." and the buttons "Cancelar" then "Recusar" (`.btn.danger`); "Cancelar" sends nothing; only the modal's "Recusar"
sends `{ action: "reject" }` (AC 85)
Proof: `npm run test -w apps/command-centre -- src/brain/reviews/AgentTab.test.tsx -t "C94 "`

**C95** - With `total: 0` the tab shows the 32px `Inbox`, "Nada do agente para revisar." and "Consolidar agora" (`.btn`,
`Sparkles`), which sends `POST /api/skills/consolidate-memory/run` once and then shows "Consolidação iniciada. A proposta
aparece aqui quando terminar."; while the list loads it shows "Carregando…", and when it fails the message and "Tentar de
novo", which refetches (AC 86, Observable "loading state")
Proof: `npm run test -w apps/command-centre -- src/brain/reviews/AgentTab.test.tsx -t "C95 "`

**C96** - On "Do agente", in scope `view:reviews`, `j`/`k`/`Enter` act and no bare key accepts or rejects (`a`, `v`, `r`
and `Enter` on the accept button's absence send no request); in the Núcleo's "Revisões" scene panel the same tab and items
render; the listener reader of `commands.source.test.ts` finds no listener in the new files outside the registry and the
`listenersAllowlist` does not grow (design.md binding `comandos-atalhos`)
Proof: `npm run test -w apps/command-centre -- src/brain/reviews/AgentTab.test.tsx -t "C96 "`
Proof: `npm run test -w apps/command-centre -- src/commands/commands.source.test.ts -t "C96 "`

**C97** - The note panel's fold heads read, in order, the links section, "Relacionadas", "Nesta nota", "Histórico" (the
fourth, open by default); its rows, newest first as the mock answers `GET /api/memory/history?path=notes/a.md&limit=50`
(and no other query), each hold in order the relative time ("há 3 horas", with the full date and time in its `Tooltip`),
the author's icon and label, and the origin label in 12px ("Editada", "Mudou fora do editor", "Primeira versão", one per
origin of design.md's table: 13 cases); the row whose `sha256` equals the open note's version carries "Atual" (AC 39,
L-046)
Proof: `npm run test -w apps/command-centre -- src/brain/notes/HistoryFold.test.tsx -t "C97 "`

**C98** - The fold shows "Sem versões ainda." for `versions: []`, "Carregando…" while pending, and on failure the message
and "Tentar de novo", which refetches (AC 43)
Proof: `npm run test -w apps/command-centre -- src/brain/notes/HistoryFold.test.tsx -t "C98 "`

**C99** - Picking a row opens a 720px `Modal` titled "Versão de <data e hora>" with the author and origin in its header, the
title "Do texto atual para esta versão" over the diff lines (`+`/`-` signs, mono), and in the footer "Fechar" then
"Restaurar esta versão" (`.btn.primary`, `RotateCcw`); the "Atual" version's dialog has no restore button; a version of a
deleted note shows its whole text in mono instead of a diff (AC 40, design.md "Diálogo - Versão")
Proof: `npm run test -w apps/command-centre -- src/brain/notes/HistoryFold.test.tsx -t "C99 "`

**C100** - "Restaurar esta versão" sends `POST /api/memory/history/restore` with exactly `{ id, baseVersion: <the open
note's version> }`; on `200` the dialog closes, the note is fetched again and "Versão restaurada." is on screen at 7 999 ms
and gone at 8 000 ms; on `409 edit_conflict` the dialog stays open with "A nota mudou desde que você abriu. Recarregue e
tente de novo." and "Recarregar", and the note is not fetched again; another error stays in the dialog's body (AC 41,
AC 42)
Proof: `npm run test -w apps/command-centre -- src/brain/notes/HistoryFold.test.tsx -t "C100 "`

**C101** - Under `TZ=America/Sao_Paulo` (pinned and asserted), a version at `2026-11-01T02:30:00Z` is titled "Versão de
31/10/2026 23:30" and its `Tooltip` reads that date and time (L-053)
Proof: `npm run test -w apps/command-centre -- src/brain/notes/historyTime.test.tsx -t "C101 "`

**C102** - "Histórico da memória" is an item (`History` icon) of the NOTAS header's `Menu` (G18) and a registry command
(`global`, `palette: true`); both open a 720px `Modal` listing the rows the mock answers for `GET
/api/memory/history?limit=100` (and no other query), each with, in order, the path in mono 12px, the time, the author and
the origin; a row with `exists: false` carries "Apagada" (`Trash2` + text) and "Restaurar" (`.btn.sm`), which fetches `GET
/api/memory/history?path=<that path>` and opens the dialog of C99 for the newest version with a `sha256`; `versions: []`
shows "Nenhuma mudança registrada ainda."; loading and error as C98 (AC 44)
Proof: `npm run test -w apps/command-centre -- src/brain/notes/MemoryHistoryDialog.test.tsx -t "C102 "`

**C103** - The `proposalsPending` inbox row reads "3 propostas do agente para revisar" (en "3 agent proposals to review")
and activating it navigates to `/brain/reviews?tab=agent` with "Do agente" selected; Settings › Notifications lists the
sentinel "Propostas do agente" with its hint and a switch that sends `PUT /api/settings` with
`sentinels.proposalsPending.enabled` (G19)
Proof: `npm run test -w apps/command-centre -- src/brain/reviews/proposalsNotice.test.tsx -t "C103 "`

**C104** - Every key of design.md's "Texto" rows that part A uses (rows 1-35 and 64-65: 60 keys, `proposals.selectAll` /
`proposals.selectNone` as 2, `trust.*` as 3, `author.*` as 6, `origin.*` as 13, `opState.*` as 2) is a key of `en` and
`ptBR` in `locales/brain.ts` with the table's text (and the "Rótulos" table's for the last four rows), both locales hold
the same keys, and `i18n.orphans.test.ts` finds no unused key (design.md "Texto")
Proof: `npm run test -w apps/command-centre -- src/brain/memoriaCopy.test.ts -t "C104 "`

**C105** - The new stylesheets have no text under 12px and prose at 13px, the repository's stylelint (tokens only) reports
no warning on them (run as `typography.test.ts` runs it), and every `animation` and `transition` (the item leaving the list
in 150 ms) sits inside `@media (prefers-reduced-motion: no-preference)` (the reader of `ui/ui.source.test.ts` C15);
every trust badge, op state and access mark renders an icon and a text (design-system binding)
Proof: `npm run test -w apps/command-centre -- src/brain/memoriaCopy.test.ts -t "C105 "`

**C106** - In the light and the dark theme and in the moldura and the Núcleo, "Revisões" on "Do agente" with a consolidation
(one op of each trust and state) and the note panel's "Histórico" with its version dialog open have every action reached
by `Tab` in reading order and activated by `Enter`, and axe at WCAG A/AA reports no `serious` or `critical` violation
(design-system binding)
Proof: `npm run build:server && npm run build -w apps/command-centre && MORDOMO_E2E_PORT=4901 npx playwright test --config tests/e2e/playwright.config.ts memoria.spec.ts -g "C106 "`

**C107** - In a real browser over the e2e home: a `fact` proposal made by `POST /api/v1/memory/proposals` shows on "Do
agente"; accepting it makes `GET /api/v1/memory/facts` return the fact with `author: "mcp"` and `proposalId`; a note saved
twice through the API shows three rows in "Histórico" (create, save, save), and restoring the first makes the file on disk
equal to its first bytes and adds a fourth row "Restaurada" (the S2 and S3 independent tests, through the interface)
Proof: `npm run build:server && npm run build -w apps/command-centre && MORDOMO_E2E_PORT=4901 npx playwright test --config tests/e2e/playwright.config.ts memoria.spec.ts -g "C107 "`

**C108** - The component gallery has a "memória confiável" entry (a list item of each kind, an op row of each trust and
state, the detail's two error banners, a history row, the version dialog) and in both themes it has no `serious` or
`critical` axe violation (design-system binding, "a galeria cobre as duas camadas")
Proof: `npm run build:server && npm run build -w apps/command-centre && MORDOMO_E2E_PORT=4901 npx playwright test --config tests/e2e/playwright.config.ts memoria.spec.ts -g "C108 "`

### S4 - acesso por pasta, leituras (plan S4, AC 87-95, 102-104) · 27 files · 287 KB · ~72k

**C109** - `PUT /api/settings` with `folderAccess` of one entry `{ path: <memory>/notes/financeiro, agents: "read",
devices: "hide" }` answers `200` and `GET /api/settings` reads it back (L-050); 200 entries are accepted and 201 answer `400
validation`; an entry with `agents: "secret"`, a relative `path`, and a `path` outside every enabled indexed folder and
`memory/` each answer `400 validation` and store nothing; the default is `[]`, under which a device and a run reach every
folder as before (AC 87, door 12)
Proof: `npx vitest run tests/memoria.access.test.ts -t "C109 "`

**C110** - The resolver, one asserted case per row at its own layer: no entry → `write`/`write`; entries `notes` (`read`)
and `notes/fin` (`hide`) → a file in `notes/fin/` is `hide`, one in `notes/outra/` is `read`, one in `notes/fin2/` is `read`
(prefix followed by the separator); an entry written through a symlink to `notes/fin` decides for `notes/fin/` by real
path; at the route, a device's search finds the `notes/outra/` note and not the `notes/fin/` one (AC 88, door 12)
Proof: `npx vitest run tests/memoria.layer.test.ts -t "C110 "`
Proof: `npx vitest run tests/memoria.access.test.ts -t "C110 "`

**C111** - A `settings.json` edited by hand whose entry for `notes/fin` has `devices: "secret"` reads that entry as `hide`
for both audiences (a device's search leaves `notes/fin/` out and a run started there gets `403 folder_hidden`) and keeps
the other entries as written; at the resolver's layer an entry whose path cannot be resolved (a link loop) is `hide` for
both and covers its lexical path (G17) (AC 89, L-061)
Proof: `npx vitest run tests/memoria.access.test.ts -t "C111 "`
Proof: `npx vitest run tests/memoria.layer.test.ts -t "C111 "`

**C112** - A `settings.json` whose `folderAccess` is `"x"` reads every root as `hide` for devices (a device's search, tree
and `GET /api/memory/note` find nothing: `200` with no hit, no folder, `404 not_found`) and `read` for agents (a write run in
`memory/` gets `403 folder_read_only`, a read-only run starts); the owner token reads and writes as before; the file is kept
as `settings.json.invalid` (as before); `folderAccess` is in `SETTINGS_FAIL_CLOSED` (AC 90, L-061)
Proof: `npx vitest run tests/memoria.access.test.ts -t "C112 "`
Proof: `npx vitest run tests/data.settings.test.ts -t "C46 every leaf"`

**C113** - With `notes/fin` `hide` for devices, a `content` device's answer from each index reader equals, by value, the
owner's answer with `<memory>/notes/fin` added to `settings.excludes` (the twin): `GET /api/memory/search`, `recall` (a
visible note whose link points into `notes/fin/` does not bring the hidden note through the followed link, L-055),
`graph`, `related` (of a visible note linked to a hidden one), `links` (a backlink from a hidden note is absent) and `query`
(AC 91, L-015, L-055)
Proof: `npx vitest run tests/memoria.access.test.ts -t "C113 "`

**C114** - With `notes/fin` (and, for the journal case, `journal/`) `hide` for devices, a `content` device's answer equals
the twin's from `GET /api/memory/tree` (the hidden folder is neither listed nor counted), `maps`, `hygiene`, `journal?days=7`
(`days: []`), `routers/check` and `recall/stats` (G11); `GET /api/memory/journal?date=<today>` answers `404 not_found` and
creates no journal file (G15); `GET /api/contexts` omits a context path under the hidden folder (G11) (AC 91)
Proof: `npx vitest run tests/memoria.access.test.ts -t "C114 "`

**C115** - With `notes/fin` `hide` for devices, a `content` device gets from `GET /api/memory/facts` no fact whose
`sourcePath` is under it; from `GET /api/memory/reviews` (both kinds) no item under it; from `GET
/api/memory/cleanup/inventory` and `GET /api/memory/cleanup/scans/:id` answers equal to the twin's (no `topFolders` entry,
no finding, no count from the hidden files) (AC 91)
Proof: `npx vitest run tests/memoria.access.test.ts -t "C115 "`

**C116** - With `notes/fin` `hide` for devices, a `content` device gets: from `GET /api/dashboards/:id` no widget item whose
`path` or `sourcePath` is under it (G13); from `GET /api/memory/history` no version under it and `404 not_found` from `GET
/api/memory/history/:id` of one; from `GET /api/memory/proposals` no proposal with an op or target under it and `404
not_found` from its `GET …/:id` (G14); from `GET /api/artifacts/list`, `recent`, `file` and `raw` nothing under
`artifacts/exports/` (G11); from `GET /api/runs/:id/diff` no hunk of a file under it (G11) (AC 91)
Proof: `npx vitest run tests/memoria.access.test.ts -t "C116 "`

**C117** - With `notes/fin` `hide` for devices, `GET /api/memory/note?p=<a note in it>` and `GET /api/memory/preview?p=<it>`
answer a `content` device `404 not_found`, the same as for a path that does not exist (`toEqual` over the two bodies), and
answer the owner `200`; a note outside it answers the device `200` (AC 92, Assumptions "Pasta escondida para um
dispositivo")
Proof: `npx vitest run tests/memoria.access.test.ts -t "C117 "`

**C118** - A `monitor` device's `GET /api/settings` has no `folderAccess` key, no `indexedFolders` entry whose path is
`hide` for devices and no context path that is; the owner's answer has all three; the rest of the two answers is equal
(AC 93)
Proof: `npx vitest run tests/memoria.access.test.ts -t "C118 "`

**C119** - A `run` device's `POST /api/runs` with `cwd` under a folder `hide` for devices answers `404 not_found` and
records no run; under a folder `read` for devices, a write run answers `403 folder_read_only` and a read-only run is
accepted; the owner token's same requests are accepted (AC 94)
Proof: `npx vitest run tests/memoria.access-runs.test.ts -t "C119 "`

**C120** - With `notes/fin` `hide` for agents, a write run's credential gets from `GET /api/memory/search`, `recall`, `maps`
and `journal?days=7` answers equal to the twin's (no hit, map or day under it), and from `GET /api/memory/facts` and `GET
/api/memory/recall/stats` nothing under it (G12) (AC 95)
Proof: `npx vitest run tests/memoria.access-runs.test.ts -t "C120 "`

**C121** - The prompt of a run started in a context one of whose paths is `hide` for agents does not hold that path nor the
hidden folder's name: neither in the context block (its map) nor in the routers the prompt names (AC 95)
Proof: `npx vitest run tests/memoria.access-runs.test.ts -t "C121 "`

**C122** - The owner token, with `notes/fin` `hide` for both audiences, gets `200` and the hidden note from `GET
/api/memory/search`, `GET /api/memory/note` and `GET /api/memory/tree`, and `200` from `PUT /api/memory/notes` of a note in
it (AC 102)
Proof: `npx vitest run tests/memoria.access.test.ts -t "C122 "`

**C123** - `GET /api/memory/tree` gives a folder with a level other than `write` for either audience `access: { agents,
devices }` (`toEqual`) and gives none to a folder with `write`/`write`; a folder whose level is inherited from an ancestor's
entry carries the inherited levels; `root=/nao/e/raiz` answers `400 unknown_root` (as before) (AC 104, Surface)
Proof: `npx vitest run tests/memoria.access.test.ts -t "C123 "`

**C124** - `docs/security.md` has a section on folder access that names the three levels, the two audiences, the owner's
exemption, `404 not_found` for a device, and that Codex and Cursor are refused when a folder is hidden (`409
folder_hide_unsupported`) (Impact "arquivos", AC 98, question 4)
Proof: `npx vitest run tests/memoria.access.test.ts -t "C124 "`

### S4r - acesso por pasta, execuções (plan S4, AC 96-101) · 13 files · 142 KB · ~36k

**C125** - A run refused for a folder `hide` for agents answers `403 folder_hidden` and records no run, each case for its own
reason alone (the folder is `write` for devices and the provider confines reads): `POST /api/runs` with `cwd` inside it;
`POST /api/skills/:slug/run` of a memory skill with the input `folder` naming it (a read folder); a run in a context one of
whose paths is it (handed as `readDirs`) (AC 96, L-039)
Proof: `npx vitest run tests/memoria.access-runs.test.ts -t "C125 "`

**C126** - A Claude run whose working folder contains `notes/fin` (`hide` for agents) launches with `--disallowedTools`
holding `Read(//<abs>/**)`, `Grep(//<abs>/**)`, `Glob(//<abs>/**)`, `Edit(//<abs>/**)` and `Write(//<abs>/**)` for its real
path, in each of the three modes the adapter builds (`read_only`; `write` with the permission broker; `write` with
`acceptEdits`); a run whose folder contains no hidden folder has none of them (AC 97, door 13)
Proof: `npx vitest run tests/memoria.access-runs.test.ts -t "C126 "`
Proof: `npx vitest run tests/memoria.layer.test.ts -t "C126 "`

**C127** - A run whose working folder contains a folder `hide` for agents answers `409 folder_hide_unsupported` and records
no run on Codex (`readConfinement: "none"`), on Cursor, and on a provider whose manifest declares no `readConfinement`
(fails closed, L-061); the same run with no hidden folder inside starts on each (AC 98, door 13, question 4)
Proof: `npx vitest run tests/memoria.access-runs.test.ts -t "C127 "`

**C128** - A write run with `cwd` inside a folder `read` for agents answers `403 folder_read_only` and records no run; a
read-only run there is accepted; a write run in a sibling folder is accepted (AC 99)
Proof: `npx vitest run tests/memoria.access-runs.test.ts -t "C128 "`

**C129** - A memory-skill run handed `memory/` with `notes/fin` `read` for agents launches with the real path of
`notes/fin` in `protectedDirs` beside the skill's folder; on a provider whose manifest lacks `protectsDirs` the run fails
with `failure.code: "folder_protection_unsupported"` (as for a handed folder today) (AC 100)
Proof: `npx vitest run tests/memoria.access-runs.test.ts -t "C129 "`

**C130** - A write run created while its folder is `write` and waiting for approval, whose folder is then set to `hide` for
agents through `PUT /api/settings`, fails at launch with `failure.code: "folder_hidden"` and the adapter's `execute` is never
called; one set to `read` fails with `folder_read_only` (AC 101, G16)
Proof: `npx vitest run tests/memoria.access-runs.test.ts -t "C130 "`

**C131** - Every other way a run is created refuses a folder `hide` for agents, one case each (G16, L-015): `POST
/api/runs/:id/retry`, `POST /api/runs/:id/children`, `POST /api/sessions/:id/continue` and `POST /api/routines/:id/run`
answer `403 folder_hidden` and record no run; a routine fired by the scheduler, an objective's step and a dashboard's
question run fail at launch with `failure.code: "folder_hidden"`; `RunFailure.code` gains `folder_hidden`,
`folder_read_only` and `folder_hide_unsupported`
Proof: `npx vitest run tests/memoria.access-runs.test.ts -t "C131 "`

### S5 - exportar e importar uma pasta (plan S5, AC 106-112) · 6 files · 79 KB · ~20k

**C132** - At 23:30 local of 2026-10-31, `POST /api/memory/export { folder: <memory>/notes/projetos }` answers `200` with
`path` = `<home>/artifacts/exports/projetos-2026-10-31-2330`, `files` and `bytes` equal to the copied files; the folder holds
the `.md` files byte for byte and `mordomo-export.json` = `{ v: 1, exportedAt: <now>, source: <the folder>, files: [{ path,
sha256, size }] }` (`toEqual`, one entry per copied file, each hash read back from disk); a `.env` of the source is not
copied nor listed; a second export the same minute lands in `…-2330-2`; an enabled indexed folder exports the same way; a
one-file folder exports one entry (L-050) (AC 106, door 14)
Proof: `npx vitest run tests/memoria.localday.test.ts -t "C132 "`
Proof: `npx vitest run tests/memoria.transfer.test.ts -t "C132 "`

**C133** - The copy limits, each refused for its own reason with every other limit met (L-039), answer `413
folder_too_large` and leave no folder under `artifacts/exports/`: 2 001 files, 501 folders, 64 MiB + 1 byte in all, 13
levels, one file of 8 MiB + 1 byte (`DEFAULT_COPY_LIMITS.maxFileBytes`); the accepted edges export: exactly 2 000 files,
500 folders, 64 MiB, 12 levels; with `…-2` to `…-99` taken, the export answers `409 exists` (G20) (AC 107, door 14)
Proof: `npx vitest run tests/memoria.transfer.test.ts -t "C133 "`

**C134** - `POST /api/memory/export` with a folder outside the home and every indexed folder answers `403 forbidden_path`;
with the home itself (it holds `config/`) `403 forbidden_path`; with a folder that does not exist `404 not_found`; with a
file `400 validation`; none leaves anything under `artifacts/exports/` (AC 108)
Proof: `npx vitest run tests/memoria.transfer.test.ts -t "C134 "`

**C135** - `POST /api/memory/import { sourceDir: <an enabled indexed folder>/vault, folder: "vault-antigo" }` answers `200`
with `folder` = `<memory>/notes/vault-antigo`, `files`, `bytes` and `skipped` = the names left out (`.env`, a link); each
copied `.md` is byte for byte the source's (no header added; non-canonical fixture, L-025) and has one `import` version
(author `owner`) read back from the history; `folder: "Vault Antigo!"` lands in `notes/vault-antigo/`; no `folder` uses the
source's name by the slug rule; a one-file source imports one (L-050) (AC 109, door 15)
Proof: `npx vitest run tests/memoria.transfer.test.ts -t "C135 "`

**C136** - An import into an existing `memory/notes/vault-antigo/` answers `409 exists`, and the folder's listing and the
history are unchanged (AC 110)
Proof: `npx vitest run tests/memoria.transfer.test.ts -t "C136 "`

**C137** - An import whose `sourceDir` is inside `memory/` answers `400 validation`; one outside the home and every indexed
folder `403 forbidden_path`; one that does not exist `404 not_found`; one past the copy limits `413 folder_too_large`,
leaving no `memory/notes/<folder>/` and no version (G21); each copies nothing (AC 111, door 15)
Proof: `npx vitest run tests/memoria.transfer.test.ts -t "C137 "`

**C138** - A device with every scope gets `403 owner_only` and a run's credential `403 forbidden` from export and import,
and nothing is written; the `API` table has both routes with scope `owner` and their named errors (`toEqual`); they are in
`EXPECTED_ROUTE_SCOPES`, the refusal probe and `docs/security.md`; the OpenAPI document validates (AC 112, doors 14-15)
Proof: `npx vitest run tests/memoria.transfer.test.ts -t "C138 "`
Proof: `npx vitest run tests/api.refusals.test.ts -t "C138 "`
Proof: `npx vitest run tests/api.openapi.test.ts -t "C16 the document validates"`

### Screens B - permissões, marcas, exportar e importar (plan S4-S5) · 12 files · 132 KB · ~33k

**C139** - A folder row of the notes tree has a `MoreHorizontal` `Menu` trigger at its end holding "Permissões…" (`Shield`)
then "Exportar pasta…" (`FolderOutput`) (G18); "Permissões…" opens a 480px `Modal` titled "Permissões de financeiro" with
the path in mono 12px; "Agentes" then "Dispositivos", each a native `<select>` with the options in order ("Podem escrever",
"Só ler", "Esconder" / "Podem pedir escrita", "Só ler", "Esconder") preselected at the current levels and the hint of the
chosen level below (the six hints, one case each); "Herdado de notes" with `CornerLeftUp` when an ancestor's entry decides;
the footer "Cancelar", "Remover restrição" (`.btn.ghost`, only with an own entry), "Salvar" (`.btn.primary`) (AC 103,
L-046)
Proof: `npm run test -w apps/command-centre -- src/brain/notes/FolderAccess.test.tsx -t "C139 "`

**C140** - "Salvar" sends `PUT /api/settings` with `folderAccess` = the whole current list with this folder's entry added or
replaced and every other entry kept (`toEqual`; arrays replace wholesale, L-042); "Remover restrição" sends the list without
it; "Cancelar" sends nothing; a `400` leaves the `Modal` open with the message in its body; the same modal opens from the
"Permissões…" button of a row of Settings › Memória (AC 103)
Proof: `npm run test -w apps/command-centre -- src/brain/notes/FolderAccess.test.tsx -t "C140 "`

**C141** - A tree folder whose `access` has a `hide` shows `EyeOff` after its name, one with `read` and no `hide` shows
`Lock` after its name, each with the `Tooltip` "Agentes: Só ler · Dispositivos: Esconder" (the levels by name); one with no
`access` shows neither (AC 104, L-046)
Proof: `npm run test -w apps/command-centre -- src/brain/notes/FolderAccess.test.tsx -t "C141 "`

**C142** - Settings › Memória shows, after the indexed folders, "Pastas com acesso restrito" with one row per entry holding,
in order, the path, "Agentes: Só ler", "Dispositivos: Esconder", "Permissões…" and "Remover restrição"; with
`folderAccess: []` it shows "Nenhuma pasta restrita." (AC 105, L-046)
Proof: `npm run test -w apps/command-centre -- src/views/settings/memoryAccess.test.tsx -t "C142 "`

**C143** - "Exportar pasta…" opens a 480px `Modal` with "Copia esta pasta para a pasta de exportações do MordomoOS, com um
manifesto que confere cada arquivo." and "Exportar", which sends `POST /api/memory/export` with exactly `{ folder }`;
while pending, a spinner and "Copiando…"; on `200`, `CircleCheck`, "12 arquivos, 48 KB em", the path in mono, then "Abrir
pasta" (which sends `POST /api/memory/open { p: <path> }`) and "Fechar"; on `413 folder_too_large`, "A pasta passa do
limite de 2 000 arquivos ou 64 MB." in the body (AC 113)
Proof: `npm run test -w apps/command-centre -- src/brain/notes/FolderTransfer.test.tsx -t "C143 "`

**C144** - The NOTAS header's `Menu` (G18) holds "Importar pasta…" (`FolderInput`) only when the root is `memory/`; its
480px `Modal` has "Pasta de origem" with the hint "Uma pasta que o MordomoOS já lê: uma pasta indexada ou do home." and
"Nome da pasta nova", filled with the source's last name as it is typed; "Importar" sends `POST /api/memory/import {
sourceDir, folder }`; on `200` the dialog shows "7 arquivos importados." and "2 deixados de fora" with the two names, and
the tree selects `notes/vault-antigo`; `409 exists` shows "Já existe uma pasta com esse nome em notes/." and `403
forbidden_path` "O MordomoOS não lê essa pasta. Adicione-a como pasta indexada antes." (AC 114)
Proof: `npm run test -w apps/command-centre -- src/brain/notes/FolderTransfer.test.tsx -t "C144 "`

**C145** - Every key of design.md's "Texto" rows 36-63 (35 keys: `access.agents` / `access.devices` as 2, `access.agents.*`
as 3, `access.devices.*` as 3, `export.menu` / `import.menu` as 2, `import.source` / `import.sourceHint` as 2) is a key of
`en` and `ptBR` in `locales/brain.ts` with that text, both locales hold the same keys, and no key is unused (design.md
"Texto")
Proof: `npm run test -w apps/command-centre -- src/brain/memoriaCopy.test.ts -t "C145 "`

**C146** - In both themes, the permissions, export and import modals open from the tree have every control reached by `Tab`
in order and axe reports no `serious` or `critical` violation; after "Salvar" with `devices: "hide"`, the folder shows
`EyeOff` and a device token's `GET /api/v1/memory/search` no longer finds its note (the S4 independent test)
Proof: `npm run build:server && npm run build -w apps/command-centre && MORDOMO_E2E_PORT=4901 npx playwright test --config tests/e2e/playwright.config.ts memoria.spec.ts -g "C146 "`

**C147** - The version dialog, the memory history dialog, the permissions modal and the export and import modals are
reached from both entries (`main.tsx`, `gallery/main.tsx`) only by a dynamic `import()`; `scripts/bundle-baseline.json`
gains a `cerebro-memoria-confiavel` entry after `cerebro-paineis` with a reason of more than 40 characters and the four
numbers, at most 16 KB of JS gzip and 3 KB of CSS gzip above `cerebro-paineis` (574 327 B and 80 203 B); `bundle:check`
exits 0 on a fresh build
Proof: `npx vitest run tests/memoria.contract.test.ts -t "C147 "`
Proof: `npx vitest run tests/bundle-size.test.ts -t "C31 a build within 5% of the latest recorded one passes"`
Proof: `npm run build -w apps/command-centre && npm run bundle:check`

## Correções de construção

- **C80, batch A3 (plan amendment 2).** The approved claim's `toEqual` named door 10's codes alone. Batches A1 and A2
  made four of the seven routes declare more: `403 forbidden_path` and `404 not_a_file` on the history's version, the
  restore, the proposal and the decision, and `413 file_too_large` on the last two (they read and write through the safe
  reader and the guarded writer, and the refusal probe, `api.refusals` C46, requires both ways that a route answering
  one of those refusals declares it); and on the decision six codes of accepting a note or a fact (`400 unknown_area`,
  `403 note_not_editable`, `404 note_missing`, `409 note_exists`, `409 structure_fixed`, `409 fact_overlap`), the
  codes the owner's own routes answer for the same write. The claim as approved could not pass without dropping
  declarations the probe requires or rewriting the decision's errors, so the claim names the codes as built: nothing of
  door 10 left out, no scope changed, and each of the six is proven answered (C80's second test). An owner
  question (G26): the safe default is the codes as built; the alternative is to map the acceptance's refusals onto door
  10's codes, a product change that loses the reason today's code gives.

- **C86, batch A3.** The approved claim said the dashboards' `facts` source "keeps one closed as `ended`". That source
  reads the open facts only (`queryFacts` with no `includeExpired`, `core/src/dashboards/sources.ts:494`), at the
  feature's base and after it, and cerebro-paineis proves that a closed fact leaves the dashboard
  (`tests/paineis.sources.test.ts`, the facts case that retracts `gone`). Keeping it would change the behaviour C86
  exists to pin, and break that check, so no implementation can pass the clause as written. The claim asserts the
  behaviour of before by value instead: the open fact is shown, the one retracted as `wrong` and the one closed as
  `ended` are left out. No product code changed. An owner question (G27): the safe default is that the dashboards show
  open facts only, as before; the alternative is to show closed facts there, a product change that also changes
  cerebro-paineis's facts source.

### Correções de construção (G6)

- **G6, a real bug of batch A2 found in batch A3 (C63), fixed.** `writeAll` in `core/src/memory/proposals.ts` put back
  only the files a failed decision had replaced: a file the same decision had created stayed on disk with no version.
  With two `move_to_topic` ops creating `topics/a.md` and `topics/b.md` and the create of `b.md` failing, the decision
  answered `500`, put `MEMORY.md` back, left `topics/a.md`, and a second decision answered `200` and wrote its lines
  twice. A2's Settled mid-build (g) had recorded the gap as a limit ("a file the decision created before a later create
  failed stays") instead of a defect; the A3 status line "A defect found, not fixed (C63, G6)" is closed by this fix.
  The claims of G6 and C63 do not change; the build now meets them:
  - `core/src/security/safeWrite.ts` gains `createWorkspaceFile` (a `create` that answers the real path and the device
    and inode of the very file it made) and `removeCreatedFile` (removes that file only while the same real path inside
    the scope still names a regular file with that device and inode; a file someone else wrote in between, or one that
    is gone, is left alone), built on the private `removeIfStillOurs`; no raw `fs` call outside the primitive, so the
    raw-fs list of `tests/security-reads.test.ts` keeps its size (C84);
  - a failed decision takes back every file it wrote, and only those: a replaced file gets its bytes back (guarded by
    the bytes the decision wrote), a created file is removed; the same holds when a step after the writes fails (the
    versions, the decision's row), for consolidations and `memory_edit`;
  - an accepted `note_create` or `note_save` removes the note it created when anything after `createNote` throws inside
    the decision (`NoteContext.created` tells the decision the file), so a retry makes the note under its own name,
    never a `-2`;
  - proof: C63 gains two cases under its title (`"C63 "`, `tests/memoria.proposals.test.ts`): the two topics with an
    EIO injected into the guarded create of `topics/b.md` (the test of `bug/cerebro-memoria-g6`, folded in), and a
    `note_create` whose version cannot be recorded after the note is made. With the old `writeAll` put back, the topic
    case fails (`topics/a.md` exists); with the note's take-back removed, the note case fails (`notes/nota-g6.md`
    exists); with the whole file of before, both fail

## Gaps found by this derivation

Each is a line for an owner question; the safe default is what the checks above assert until the owner answers. None
blocks the build.

| #   | Gap                                                                                                                                                                                                                                                                                                   | Safe default (asserted by)                                                                                                                                                                                                  |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| G1  | AC 21 names `POST /api/memory/tasks`; the route is `PUT /api/memory/tasks` (`contracts/src/api/memory.ts:826`)                                                                                                                                                                                        | a misprint: the check names `PUT` (C21)                                                                                                                                                                                     |
| G2  | AC 21-24, 32-33, 37, 63, 70, 72 and 109 do not say the `author` of `cleanup`, `restore`, `import`, `baseline`, index `removed`, `guard` and `proposal` versions; door 8 keys on `author = 'owner'`                                                                                                    | `owner` for cleanup, restore, import; `system` for baseline and guard; `external` for the index's removed; the proposal's author for `proposal`, so an acceptance never disarms the guard (C22, C24, C37, C60, C69, C70)    |
| G3  | Impact says the baseline is "limited by the byte cap", but AC 28 never drops a path's only version and AC 37 wants a baseline of every file                                                                                                                                                           | every baseline is written; the cap only drops versions outside the newest 5 of their path (C37)                                                                                                                             |
| G4  | `GET /api/memory/history/:id` of a `removed` version (no bytes) is not specified                                                                                                                                                                                                                      | `404 not_found` (C31)                                                                                                                                                                                                       |
| G5  | AC 11 leaves `asOf` with retracted facts, and `asOf` with `knownAt`, open                                                                                                                                                                                                                             | `asOf` leaves retracted facts out unless `includeRetracted=true`; the two combine with AND (C12)                                                                                                                            |
| G6  | AC 66: when `MEMORY.md` and topic files are written one after another and a later write fails, the earlier file has changed with no version; the status is not in the Surface                                                                                                                         | the earlier files are put back, no version, no fact, `pending`; the answer is `500 internal`; a second decide works (C63)                                                                                                   |
| G7  | Door 8: when putting the start bytes back fails (the file changed again after `run.finished`)                                                                                                                                                                                                         | the file stays as it is, the `memory_edit` proposal is still stored with one `guard` version of the run's bytes (C71)                                                                                                       |
| G8  | AC 51 at 200 pending: the consolidation hook and the guard have no request to answer `429` to                                                                                                                                                                                                         | the cap binds only `POST /api/memory/proposals` and a run's `POST /api/memory/facts`; the hook and the guard always store, and the guard always restores (C47)                                                              |
| G9  | AC 63: `ops` naming an index out of range or an `invalid`/`conflict` op                                                                                                                                                                                                                               | `400 validation`, nothing written (C60)                                                                                                                                                                                     |
| G10 | Door 7: an op whose section is not in `MEMORY.md`, or a missing `MEMORY.md`                                                                                                                                                                                                                           | the section is appended at the end in the order Facts, Decisions, Open loops, Reflections, Superseded; a missing file is created with only the needed sections (C56)                                                        |
| G11 | AC 91 does not list device-readable routes that name files: `GET /api/memory/routers/check`, `GET /api/memory/recall/stats`, `GET /api/contexts`, `GET /api/runs/:id/diff`, and `GET /api/artifacts/*`, where exports land (door 14; the Parts table says "o export respeita o que S4 esconde")       | each leaves out what lies under a folder hidden for devices; `artifacts/exports/` is never served to a device (C114, C116)                                                                                                  |
| G12 | AC 95 does not list `GET /api/memory/facts` and `GET /api/memory/recall/stats`, both in `RUN_API_READ_ROUTES`                                                                                                                                                                                         | both leave out what is hidden for agents (C120)                                                                                                                                                                             |
| G13 | AC 91 lists dashboards, whose snapshot is computed once and stored for every caller                                                                                                                                                                                                                   | a device's `GET /api/dashboards/:id` drops items whose `path` or `sourcePath` is hidden; aggregate numbers stay as computed and `docs/security.md` says so (C116)                                                           |
| G14 | AC 91 lists proposals without saying what a proposal with one op sourced from a hidden folder is to a device                                                                                                                                                                                          | the whole proposal is left out of the device's list and is `404 not_found` (C116)                                                                                                                                           |
| G15 | A device's single-day `GET /api/memory/journal` with `memory/journal/` hidden (the route creates the day on first access)                                                                                                                                                                             | `404 not_found`, no file created; `?days=` answers `days: []` (C114)                                                                                                                                                        |
| G16 | The Surface gives the folder codes only to `POST /api/runs` and `POST /api/skills/:slug/run`; retry, children, sessions continue, routines run-now, the scheduler, objectives and the dashboards' question also create runs, and `RunFailure.code` (`contracts/src/runs.ts:30-39`) is a closed set    | every route that creates a run refuses at request time with the same codes; runs created without a request fail at launch; `RunFailure.code` gains the three codes, with a Landing amendment (C130, C131)                   |
| G17 | AC 89's "path cannot be resolved" has no observable effect when entries compare by real path (door 12)                                                                                                                                                                                                | such an entry compares by its lexical absolute path and is `hide` for both (C111)                                                                                                                                           |
| G18 | design.md places "Histórico da memória", "Importar pasta…", "Permissões…" and "Exportar pasta…" in the NOTAS header's `Menu` and a folder's `Menu` "de lá" (cerebro-vista-notas), but neither menu exists (`NotesSidebar.tsx` heading row: create, collapse, sort; `NotesTree.tsx` rows: none)        | a `MoreHorizontal` `Menu` as the last tool of the NOTAS heading row, after the sort menu, and one at the end of each folder row (C102, C139, C144)                                                                          |
| G19 | Settings › Notifications lists every sentinel with a switch (`views/settings/notifications.tsx:226-235`); design.md has no row for `proposalsPending`                                                                                                                                                 | "Propostas do agente" / "Agent proposals", hint "Uma vez por dia, as propostas do agente esperando revisão." / "Once a day, the agent proposals waiting for review." (C103)                                                 |
| G20 | Door 14 gives the suffixes `-2` … `-99`; past `-99` is not specified, and the export's Surface has no `409`                                                                                                                                                                                           | `409 exists`, and the Surface row gains it (C133)                                                                                                                                                                           |
| G21 | AC 107 says an export over the limits leaves nothing behind; AC 111 says nothing of an import over them                                                                                                                                                                                               | the same: no `memory/notes/<folder>/` and no version (C137)                                                                                                                                                                 |
| G22 | `proposals.ops` is `{n} operações` only                                                                                                                                                                                                                                                               | "1 operação" / "1 operation" for one (C89)                                                                                                                                                                                  |
| G23 | AC 53's notification has a text but no kind or message key                                                                                                                                                                                                                                            | kind `system`, `messageKey: "proposals.invalidNotice"`, the reason in the body (C49)                                                                                                                                        |
| G28 | (batch B1) C113 and C120 compare a device's and a run's answers with the twin "by value", but a search hit's `score` is SQLite FTS5's bm25 over every row of the index: the twin's index has no row of the excluded folder, so the score differs in its last digits (`-1.028e-6` against `-1.046e-6`) | the hits, their order and every other field are compared by value, and the score by the order it gives; `docs/security.md` says the score can differ (C113, C120). Not closed as written: an owner question                 |
| G29 | (batch B1) the twin needs the owner's field query, journal `?days=`, routers' check and recall statistics to respect `settings.excludes`, which they did not (plan amendment 3 f)                                                                                                                     | the four owner readers respect today's policy, like every other reader (T4); the alternative keeps them as they were and compares with the twin only where the owner already respected the excludes                         |
| G30 | (batch B1) door 12 says what an unreadable list reads as, not how that reading is held (Landing 18)                                                                                                                                                                                                   | one entry `{ "path": "*", "agents": "read", "devices": "hide" }`, which a later save keeps; `PUT /api/settings` never accepts `"*"` (C112, `data.settings` C19)                                                             |
| G31 | (batch B1) C121 reads the prompt of "a run started in a context one of whose paths is hide for agents", and C125 refuses that very run when it is asked for (`403 folder_hidden`, the path is handed as `readDirs`)                                                                                   | the prompt is read off a run of that context checked when it launches (`startPrompt` with `folderCheck: "launch"`, as an objective's step is made): it is built as every run of the context is, then fails at launch (C121) |
| G32 | (batch B1) G17 names a link loop; an entry for a folder that is not there (yet) cannot be resolved either                                                                                                                                                                                             | `hide` for both audiences over its path as written, until the folder exists (C111's layer case; `PUT /api/settings` accepts it, inside `memory/` or an indexed folder)                                                      |

## Coverage

| Set (size)                                                                  | Member -> proof                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | Unproven |
| --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| `GET /api/memory/facts` statuses (2)                                        | 200 C12 · 400 C13                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | -        |
| `POST /api/memory/facts` statuses (6)                                       | 200 C41 · 201 C41 · 202 C40 · 400 C7 · 409 C11 · 429 C47                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | -        |
| `POST /api/memory/facts/:id/retract` statuses (3)                           | 200 C14 · 400 C14 · 404 C15                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | -        |
| `POST /api/memory/journal/append` statuses (3)                              | 200 C45 · 400 C45 · 429 C45                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | -        |
| `GET /api/memory/history` statuses (3)                                      | 200 C29 · 400 C29 · 403 C36                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | -        |
| `GET /api/memory/history/:id` statuses (3)                                  | 200 C31 · 403 C36 · 404 C31                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | -        |
| `POST /api/memory/history/restore` statuses (5)                             | 200 C32 · 400 C35 · 403 C35 · 404 C35 · 409 C34                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | -        |
| `GET /api/memory/proposals` statuses (2)                                    | 200 C43 · 400 C43                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | -        |
| `GET /api/memory/proposals/:id` statuses (2)                                | 200 C53 · 404 C53                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | -        |
| `POST /api/memory/proposals` statuses (4)                                   | 201 C42 · 400 C42 · 403 C68 · 429 C47                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | -        |
| `POST /api/memory/proposals/:id/decide` statuses (6)                        | 200 C60 · 400 C60 · 403 C68 · 404 C65 · 409 C62 · 413 C66                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | -        |
| `POST /api/memory/export` statuses (5)                                      | 200 C132 · 400 C134 · 403 C134 · 404 C134 · 413 C133                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | -        |
| `POST /api/memory/import` statuses (6)                                      | 200 C135 · 400 C137 · 403 C137 · 404 C137 · 409 C136 · 413 C137                                                                                                                                                                                                                                                                                                                                                                                                                                                           | -        |
| `GET /api/memory/tree` statuses (2)                                         | 200 C123 · 400 C123                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | -        |
| `POST /api/runs`, `POST /api/skills/:slug/run` new statuses (4)             | 403 `folder_hidden` C125 · 403 `folder_read_only` C128 · 409 `folder_hide_unsupported` C127 · 404 for a device C119                                                                                                                                                                                                                                                                                                                                                                                                       | -        |
| error codes (21)                                                            | `validation` C7 · `provenance_required` C17 · `fact_overlap` C11 · `note_not_editable` C35 · `not_found` C31 · `edit_conflict` C34 · `proposal_decided` C65 · `memory_over_budget` C59 · `note_too_large` C66 · `too_many_proposals` C47 · `owner_only` C36 · `forbidden` C68 · `scope_required` C36 · `folder_hidden` C125 · `folder_read_only` C128 · `folder_hide_unsupported` C127 · `folder_protection_unsupported` C129 · `folder_too_large` C133 · `forbidden_path` C134 · `exists` C136 · `too_many_requests` C40 | -        |
| one-way doors (16)                                                          | 1 C1 · 2 C11 · 3 C17 · 4 C26 · 5 C79 · 6 C48 · 7 C54 · 8 C69 · 9 C40 · 10 C80 · 11 C75 · 12 C110 · 13 C126 · 14 C132 · 15 C135 · 16 C148                                                                                                                                                                                                                                                                                                                                                                                  | -        |
| entities and one-way constraints (8)                                        | keys not null, one function C5 · blob once by sha256 C26 · version by path, survives reindex and removal C24 · closed vocabularies status, kind, author C79 · closed origin and author of versions C21 · closed trust C52 · `run_id`/`proposal_id` text, no FK C79 · `memory_proposals` → `facts` (`proposal_id`) C61                                                                                                                                                                                                     | -        |
| door 2 overlap table (4 rows)                                               | before T, overlaps C8 · at/after T, no U C10 · at/after U C9 · strictly inside C11                                                                                                                                                                                                                                                                                                                                                                                                                                        | -        |
| fact query flags (5)                                                        | none C12 · `knownAt` C13 · `includeRetracted` C12 · `includeExpired` C12 · `asOf` C12                                                                                                                                                                                                                                                                                                                                                                                                                                     | -        |
| retract reasons (3)                                                         | `wrong` C14 · `ended` C15 · none C15                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | -        |
| provenance sources (4)                                                      | `sourcePath` C17 · `sourceRunId` C17 · `proposalId` C17 · author owner C19                                                                                                                                                                                                                                                                                                                                                                                                                                                | -        |
| writers that record a version (13)                                          | create C21 · save C21 · properties C21 · task C21 · review C21 · cleanup apply C22 · cleanup undo C22 · index external C23 · index removed C24 · restore C32 · proposal C60 · guard C69 · import C135                                                                                                                                                                                                                                                                                                                     | -        |
| version origins (13)                                                        | `create` C21 · `save` C21 · `properties` C21 · `task` C21 · `review` C21 · `cleanup` C22 · `proposal` C60 · `restore` C32 · `guard` C69 · `external` C23 · `baseline` C37 · `removed` C24 · `import` C135                                                                                                                                                                                                                                                                                                                 | -        |
| version authors (5)                                                         | `owner` C21 · `run:<id>` C60 · `mcp` C67 · `external` C23 · `system` C37                                                                                                                                                                                                                                                                                                                                                                                                                                                  | -        |
| versioned-path rule (17)                                                    | C25, table-driven over 17 paths                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | -        |
| proposal kinds (5)                                                          | `consolidation` C48 · `memory_edit` C69 · `fact` C40 · `note_create` C67 · `note_save` C66                                                                                                                                                                                                                                                                                                                                                                                                                                | -        |
| proposal statuses (5)                                                       | `pending` C42 · `accepted` C60 · `partial` C60 · `rejected` C64 · `superseded` C50                                                                                                                                                                                                                                                                                                                                                                                                                                        | -        |
| op kinds (5)                                                                | `add` C54 · `supersede` C55 · `close_loop` C56 · `move_to_topic` C58 · `fact` C61                                                                                                                                                                                                                                                                                                                                                                                                                                         | -        |
| op states (3)                                                               | `valid` C60 · `invalid` C51 · `conflict` C57                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | -        |
| trust rule rows (6)                                                         | journal outside Runs C52 · note line C52 · under `## Runs` C52 · `(autor:: agente)` C52 · no line C52 · `MEMORY.md` line C52                                                                                                                                                                                                                                                                                                                                                                                              | -        |
| proposal.json refusals (11)                                                 | missing C49 · over 256 KiB C49 · not JSON C49 · `v` C49 · op name C49 · section C49 · text 501 C49 · summary 2 001 C49 · absolute source C49 · `on` date C49 · 201 ops C49                                                                                                                                                                                                                                                                                                                                                | -        |
| bounds, accepted and refused edges (14)                                     | 50 versions C27 · 100 history rows C30 · 5 newest kept C28 · 1 MiB versioned C25 · 200 pending C47 · 256 KiB file C48 · 200 ops C48 · 2 000 summary C48 · 500 text C48 · 200 lines and 25 000 bytes C59 · `sourceLine` ≥ 1 C18 · `validTo` > `validFrom` C7 · 200 `folderAccess` entries C109 · copy limits C133                                                                                                                                                                                                          | -        |
| one-item writers (8)                                                        | one-move manifest C22 · one version `limit=1` C29 · one-op proposal C48 · `ops: [0]` C60 · one proposal `limit=1` C43 · one `folderAccess` entry C109 · one-file export C132 · one-file import C135                                                                                                                                                                                                                                                                                                                       | -        |
| agent write entry points to memory (7)                                      | run `POST /api/memory/facts` C40 · MCP `facts_assert` C44 · MCP `note_create` C44 · MCP `note_save` C44 · journal append by run C45 · MCP `journal_append` C46 · a run writing `MEMORY.md` on disk C69                                                                                                                                                                                                                                                                                                                    | -        |
| guard cases (5)                                                             | file changed C69 · file created C69 · owner version in between C70 · put-back fails C71 · look-alike `notes/MEMORY.md` C69                                                                                                                                                                                                                                                                                                                                                                                                | -        |
| decision outcomes (7)                                                       | partial C60 · accepted C60 · reject C64 · `edit_conflict` C62 · write fails then retried C63 · over budget C59 · already decided C65                                                                                                                                                                                                                                                                                                                                                                                      | -        |
| sentinel cases (6)                                                          | fires once C75 · one pending C75 · second pass none C75 · next local day C75 · row deleted C76 · disabled C77                                                                                                                                                                                                                                                                                                                                                                                                             | -        |
| new settings leaves (3)                                                     | `memory.history.maxBytes` C85 · `sentinels.proposalsPending.enabled` C77 · `folderAccess` C112                                                                                                                                                                                                                                                                                                                                                                                                                            | -        |
| startup: the run hooks (consolidation, guard, sentinel) (1 shared assembly) | `buildServer` and `AppContext`, which the service and every test assemble, C48                                                                                                                                                                                                                                                                                                                                                                                                                                            | -        |
| local-day claims under a pinned zone (8)                                    | `em::` C54 · `valid_to::` C55 · `→ closed` C56 · topic line `em::` C58 · sentinel day C75 · export folder minute C132 · version title C101 · version tooltip C101                                                                                                                                                                                                                                                                                                                                                         | -        |
| folder-level resolution (6)                                                 | no entry C110 · longest prefix C110 · separator C110 · unknown level C111 · unresolved path C111 · unreadable field C112                                                                                                                                                                                                                                                                                                                                                                                                  | -        |
| device read routes (24)                                                     | search C113 · recall C113 · graph C113 · related C113 · links C113 · query C113 · tree C114 · maps C114 · hygiene C114 · journal C114 · routers/check C114 · recall/stats C114 · contexts C114 · facts C115 · reviews C115 · cleanup inventory C115 · cleanup scans C115 · dashboards C116 · history C116 · proposals C116 · artifacts C116 · runs diff C116 · note C117 · preview C117                                                                                                                                   | -        |
| device settings fields hidden (3)                                           | `folderAccess` C118 · hidden indexed folders C118 · hidden context paths C118                                                                                                                                                                                                                                                                                                                                                                                                                                             | -        |
| run credential read routes (6)                                              | search C120 · recall C120 · maps C120 · journal C120 · facts C120 · recall/stats C120                                                                                                                                                                                                                                                                                                                                                                                                                                     | -        |
| prompt parts that name folders (2)                                          | context map C121 · routers C121                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | -        |
| ways a run is created (11)                                                  | `POST /api/runs` C125 · `POST /api/skills/:slug/run` C125 · context `readDirs` C125 · retry C131 · children C131 · sessions continue C131 · routines run-now C131 · scheduler C131 · objectives C131 · dashboard question C131 · launch after approval C130                                                                                                                                                                                                                                                               | -        |
| Claude adapter modes for deny rules (3)                                     | `read_only` C126 · broker C126 · `acceptEdits` C126                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | -        |
| providers by read confinement (4)                                           | Claude `workdir` C126 · Codex `none` C127 · Cursor `none` C127 · no declaration C127                                                                                                                                                                                                                                                                                                                                                                                                                                      | -        |
| export and import refusals (9)                                              | export outside C134 · export home C134 · export missing C134 · export file C134 · import inside `memory/` C137 · import outside C137 · import missing C137 · import over limits C137 · import exists C136                                                                                                                                                                                                                                                                                                                 | -        |
| copy limits, refused (5)                                                    | files C133 · folders C133 · total bytes C133 · depth C133 · file bytes C133                                                                                                                                                                                                                                                                                                                                                                                                                                               | -        |
| who may call, by caller (4)                                                 | owner C41 · `content` device C36 · `monitor` device C36 · run credential C68                                                                                                                                                                                                                                                                                                                                                                                                                                              | -        |
| arrangements on screen (16)                                                 | tab order C88 · list item lines C89 · detail top to bottom C90 · op row left to right C90 · actions order C90 · reject modal buttons C94 · fold order C97 · history row parts C97 · dialog footer C99 · memory history row parts C102 · NOTAS menu position C102 · folder menu items C139 · selects and footer C139 · tree mark after the name C141 · settings block after folders C142 · export result parts C143                                                                                                        | -        |
| screen states (12)                                                          | agent empty C95 · agent loading C95 · agent error C95 · fold empty C98 · fold loading C98 · fold error C98 · history dialog empty C102 · decision conflict C93 · over budget C93 · restore conflict C100 · restricted empty C142 · export error C143                                                                                                                                                                                                                                                                      | -        |
| checkbox initial states (5)                                                 | valid usuario C91 · valid ferramenta C91 · valid inferido C91 · invalid C91 · conflict C91                                                                                                                                                                                                                                                                                                                                                                                                                                | -        |
| proposal titles by kind (5)                                                 | consolidation C89 · memory_edit C89 · fact C89 · note_create C89 · note_save C89                                                                                                                                                                                                                                                                                                                                                                                                                                          | -        |
| author labels (6)                                                           | `owner` C87 · `run` C87 · `mcp` C87 · `unknown` C87 · `external` C97 · `system` C97                                                                                                                                                                                                                                                                                                                                                                                                                                       | -        |
| origin labels (13)                                                          | C97, table-driven over 13 origins                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | -        |
| access levels, selects and hints (6)                                        | agents write C139 · agents read C139 · agents hide C139 · devices write C139 · devices read C139 · devices hide C139                                                                                                                                                                                                                                                                                                                                                                                                      | -        |
| copy keys of design.md "Texto" (95)                                         | C104 and C145, table-driven over 95 keys (part A 60, part B 35)                                                                                                                                                                                                                                                                                                                                                                                                                                                           | -        |
| shells and themes for axe (4)                                               | moldura light C106 · moldura dark C106 · Núcleo light C106 · Núcleo dark C106                                                                                                                                                                                                                                                                                                                                                                                                                                             | -        |
| owner questions of the plan (6)                                             | 1 off by default C74 · 2 MCP to the inbox C44 · 3 internal history C38 · 4 Codex and Cursor refused C127 · 5 50 versions, 256 MiB C27 · 6 part B here C109                                                                                                                                                                                                                                                                                                                                                                | -        |

- Claims naming a status code, route or response shape: C7, C11-C15, C29-C36, C40-C47, C53, C59-C68, C80-C83,
  checks C109-C120, C122-C123, C125, C127-C128 and C131-C138 - each has a proof that crosses the HTTP boundary; the decision tables among them
  (C1, C8-C11, C17, C20, C25, C28, C51, C52, C59, C110, C111, C126) are also proven at their own layer
- Claims about the screens: C87-C105, C139-C145 in rendered components; C106-C108, C146 also in a real browser, both
  shells where the claim names them
- No other check claims more than the single case its proof exercises

## Binding sources

| Source                                                                                                          | Checked by                                       |
| --------------------------------------------------------------------------------------------------------------- | ------------------------------------------------ |
| `cerebro-memoria-confiavel/design.md` (the tab, the fold, the dialogs, the modals, the marks, the widget, copy) | C87-C104, C139-C145                              |
| `design-system/design.md` (12px floor, 13px prose, tokens, state never by colour alone, axe, the gallery)       | C87, C91, C105, C106, C108, C146                 |
| `primitivas/design.md` (`Tabs`, `Menu`, `Modal`, `Tooltip`, native `<select>`)                                  | C88, C94, C97, C99, C102, C139, C141, C143, C144 |
| `comandos-atalhos/design.md` (`global` command, `j`/`k`/`Enter` only, no bare key decides, allowlist)           | C96, C102                                        |
| `cerebro-natureza/design.md` (list left, detail right, 150 ms exit, focus to next, empty/loading/error)         | C89, C95, C105                                   |
| `cerebro-vista-notas/design.md` (fourth fold after "Nesta nota", the menus, the `Lock` place)                   | C97, C102, C139, C141                            |
| `cerebro-v2/design.md` (conflict text and band of the editor, the note reloads "Salvo")                         | C100                                             |
| `limpeza-legado/design.md` (one Markdown renderer; the diff in mono, never rendered)                            | C90, C99                                         |

## Test policy

| Code                                                                                                                                                                                                                                                                       | Required proofs                                       | Coverage expectation                                                                           |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| Decides, reached across a boundary (`factKey`, the overlap rule, the provenance rule, the policy filter of facts, the versioned-path rule, the retention, the op applier, the trust rule, the budget, the proposal.json schema, the folder-level resolver, the deny rules) | one at the HTTP boundary **and** one at its own layer | the contract at the boundary; one asserted case per row of the decision table at its own layer |
| Decides, not reached across a boundary (migrations 28-30 and the backfill, the guard's decision, the sentinel's day)                                                                                                                                                       | one at its own layer                                  | one asserted case per row                                                                      |
| Screens (the agent tab, the history fold, the four dialogs, the two modals, the marks, the settings block, the widget line, the inbox row)                                                                                                                                 | one in rendered components per screen and state       | each state, arrangement and copy design.md names; both themes and both shells for axe          |

Evidence:

- `core/src/memory/facts.ts` today: 1 contradiction rule, 1 close rule (`facts.ts:83`, `:91`) -> decides; after the change
  the overlap table has 4 rows, the provenance rule 7 cases, the key 5 normalisation steps -> decides, ~18 branch points
- the history (new): 17-path rule, 13 origins, the 50 cap, the byte cap with its floor of 5, blob reuse -> decides, ~15
- the proposals (new): 11 schema refusals, 5 op kinds, 3 states, 6 trust rows, 4 budget rows, 7 decision outcomes ->
  decides, ~40 branch points; the guard: 5 cases -> decides
- the folder access (new): 6 resolution rows, 24 device routes, 6 run-credential routes, 11 run entry points, 4 providers
  -> decides, ~25 branch points in the resolver and the run checks
- own layer: `tests/memoria.layer.test.ts` calls those functions with no HTTP, as `tests/natureza.layer.test.ts`,
  `tests/paineis.layer.test.ts` and `tests/cleanup.layer.test.ts` do for the same shape
- closest analogue: `tests/natureza.layer.test.ts` with `tests/natureza.reviews.test.ts`, and `tests/paineis.layer.test.ts`
  C19 for a migration over existing rows

Cost: about 55 own-layer cases in `tests/memoria.layer.test.ts`. Without these rows, the four overlap rows, the 17
versioned paths, the six trust rows, the eleven schema refusals and the six resolution rows are proven only by the requests
that happen to traverse them.

## Swept

- validation: C7, C13, C14, C18, C29, C42, C43, C49, C59, C60, C109, C133, C134, C137
- failure modes: C63 (a file write fails mid-decision, then a retry), C71 (the guard's put-back fails), C49 (a consolidation that leaves no valid proposal, or fails), C93 and C100 (the screens keep the item and the dialog), C133 (a copy over the limits leaves nothing)
- idempotency: C3 (the same fact twice writes nothing), C23 and C37 (a second index pass records nothing), C26 (the same bytes keep one blob), C65 (a decided proposal cannot be decided again), C75 (one sentinel event a day)
- authorization: C36, C68, C81, C138 (`content` for the reads, owner only for the writes, a run's credential refused); C40 and C44 (agent writes become proposals); C113-C122 (folder levels on every read path and run path); existing - the `API` table's scopes and `onRoute` (AD-024) guard every route, and `RUN_API_*_ROUTES` do not grow (C81)
- concurrency: C70 (the owner edits during a write run), C62 and C34 (`edit_conflict` on a changed file), C130 (a level changed between create and launch), C50 (a new consolidation supersedes the pending one)
- data lifecycle: C5 and C6 (migration 28 over existing facts), C37 (the first baseline), C27 and C28 (retention by count and bytes), C24 (a removed file keeps its history), C39 (backup and restore, including one made before the migrations), C79 (proposals outlive pruned runs)
- dependency failure: C127 (a provider that cannot confine reads), C129 (a provider that cannot protect folders), C49 (the model run leaves nothing usable), C20 and C51 (a policy verdict that cannot be computed fails closed)
- state transitions: C60 and C64 (`pending` to `accepted`, `partial`, `rejected`), C50 (`pending` to `superseded`), C14 and C15 (open to retracted or closed), C69 (a run's write to a `memory_edit` proposal)
- observability: C75 and C78 (`sentinel.fired` with `proposalsPending`, `docs/events.md` regenerated), C49 (the inbox row that names why a consolidation left nothing), C21-C24 (every change of `memory/` has a version with author and origin)

Existing behaviour this feature must not change, each asserted by value: the owner's fact assertion and its `201`/`200`
answers (C41); retract with no body (C15); the owner's journal line (C45); `MEMORY_WRITES_PER_RUN` and its `429` (C40, C45);
a read-only run's credential refused on writes (C40); "Virou realidade" asserting a fact (C86); the dashboards' facts
source (C86); the approvals' TTL and resolution (C86); the `## Runs` journal line (C86); `RUN_API_READ_ROUTES` and
`RUN_API_WRITE_ROUTES` (C81); `EVENT_VERSIONS["sentinel.fired"]` (C78); migrations 26 and 27 (C5); `seedHome` never
overwriting an existing routine (C74); the other 31 keys of the bundled routine (C74); the MCP tools `facts_query`,
`note_read` and `recall` (C44); the owner's reads and writes whatever the folder levels (C122); the "Para revisar" and "Sem
classificação" tabs and their counts (C88); the note panel's first three folds (C97); `settings.json.invalid` kept on an
unreadable field (C112); `protectedDirs` for a handed folder (C129).

## Handoff

The estimate exceeds the 150k budget. Mechanism chosen by the owner on 31/10/2026: **handoff, six batches A1, A2, A3, A4, B1, B2** (the cut below),
sequential, each only on green.

- Arithmetic (`wc -c` of the files each slice touches at `a6dde4e`, / 4; new files estimated; a large file read in parts
  counts the part; a slice heading's size is its source files only, the lines below add its tests and models):
  - S1 (C1-C20): `core/src/memory/facts.ts` 5 535, `core/src/db/migrations.ts` 22 683, `core/src/db/db.ts` 6 962,
    `contracts/src/api/memory.ts` ≈ 12 000 of 47 811 (the facts and journal entries, `FactSchema`),
    `apps/api/src/routes/memory.ts` 15 865, `core/src/memory/reviewDecisions.ts` 9 217, `core/src/dashboards/sources.ts`
    ≈ 6 000 of 26 590, `core/src/memory/excludes.ts` 8 341, `apps/api/src/server.ts` ≈ 6 000 of 45 001, new key and overlap
    code ≈ 6 000 = ≈ 99 KB; tests: `tests/memoria.facts.test.ts` ≈ 30 000, the S1 part of `tests/memoria.layer.test.ts`
    ≈ 12 000, `tests/memoria.migration.test.ts` ≈ 12 000, the new `tests/helpers/memoriaWorld.ts` ≈ 8 000,
    `tests/helpers/notesViewWorld.ts` 4 837, `tests/paineis.layer.test.ts` ≈ 6 000 (the migration model) = ≈ 73 KB;
    ≈ 171 KB → ≈ 43k
  - S2 (C21-C39): `core/src/memory/notes.ts` 23 360, `core/src/memory/cleanupApply.ts` 19 192, `core/src/memory/indexer.ts`
    48 055, `core/src/memory/indexHost.ts` 16 498, `core/src/security/safeWrite.ts` 24 862, `core/src/sync/diff.ts` 1 253,
    `apps/api/src/routes/memory.ts` 15 865, `apps/api/src/routes/cleanup.ts` 2 463, `apps/api/src/routes/reviews.ts` 2 285,
    `contracts/src/settings.ts` ≈ 8 000 of 24 531, `core/src/config/failClosed.ts` 4 006, `core/src/backup.ts` ≈ 8 000 of
    39 558, the new history module ≈ 18 000, routes ≈ 8 000 and contract entries ≈ 10 000 = ≈ 210 KB; tests:
    `tests/memoria.history.test.ts` ≈ 35 000, the S2 part of the layer file ≈ 10 000, `tests/data.backup.test.ts` ≈ 8 000 of
    62 341 = ≈ 53 KB; ≈ 263 KB → ≈ 66k
  - S3 (C40-C79): `core/src/memory/journal.ts` 12 352, `apps/api/src/mcp/mordomo.ts` 10 214, `apps/api/src/context.ts`
    16 653, `core/src/runs/runManager.ts` ≈ 12 000 of 76 015, `core/src/security/safeFs.ts` 19 259,
    `core/src/sentinels/runner.ts` 7 880, `types.ts` 2 004, `reviewDue.ts` 2 059, `meta.ts` 777,
    `core/src/notifications/recorder.ts` 10 065, `store.ts` 7 881, `contracts/src/events.ts` 8 006,
    `contracts/src/eventSchemas.ts` 9 209, `docs/events.md` 16 377, `skills/consolidate-memory/SKILL.md` 4 352,
    `resources/heuristics.md` 1 742, `routines/nightly-consolidation.json` 787, `core/src/paths.ts` 7 382,
    `docs/memory-guide.md` 22 291, `contracts/src/settings.ts` ≈ 6 000, the new proposals module ≈ 30 000, guard ≈ 8 000,
    routes ≈ 10 000, contract entries ≈ 10 000 = ≈ 235 KB; tests: `tests/memoria.proposals.test.ts` ≈ 40 000,
    `tests/memoria.consolidation.test.ts` ≈ 20 000, `tests/memoria.guard.test.ts` ≈ 15 000, `tests/memoria.localday.test.ts`
    ≈ 12 000, `tests/memoria.sentinel.test.ts` ≈ 12 000, `tests/memoria.mcp.test.ts` ≈ 8 000, `tests/memoria.skill.test.ts`
    ≈ 6 000, the S3 part of the layer file ≈ 15 000, `tests/helpers/paineisWorld.ts` 8 230 (the `questionWorld` model),
    `tests/natureza.sentinel.test.ts` 12 116 (the model) = ≈ 148 KB; ≈ 384 KB → ≈ 96k
  - cross-cutting A (C80-C86): `tests/helpers/routeScopes.ts` 9 137, `tests/helpers/contractWorld.ts` 41 448,
    `tests/api.refusals.test.ts` 25 731, `tests/api.openapi.test.ts` 32 065, `docs/security.md` ≈ 15 000 of 67 191,
    `tests/security-reads.test.ts` ≈ 10 000 of 106 411, `tests/sdk.instances.test.ts` 25 526, `tests/data.settings.test.ts`
    ≈ 10 000 of 46 970, `contracts/src/api/errors.ts` 10 360, `tests/events.contract.test.ts` 14 173 = ≈ 193 KB; the new
    `tests/memoria.contract.test.ts` ≈ 25 000; ≈ 218 KB → ≈ 55k
  - screens A (C87-C108): in `apps/command-centre/src/`, `brain/reviews/ReviewsScreen.tsx` 23 960, `testkit.tsx` 7 208,
    `reviews.css` 3 427, `ReviewsScreen.test.tsx` ≈ 10 000 of 36 251, `reviewsEntries.test.tsx` ≈ 6 000 of 16 309,
    `brain/notes/NotePanel.tsx` 4 803, `NotePanel.test.tsx` 6 501, `NotesSidebar.tsx` 14 702, `notesData.ts` 3 845,
    `testnet.ts` 13 956, `NoteReader.tsx` 8 879, `useNotesState.ts` 7 517, `notes.css` ≈ 5 000 of 15 324, `runs/diff.ts`
    4 009, `runs/FilesChanged.tsx` 6 007, `desktop/widgets/FactsWidget.tsx` 3 237, `locales/brain.ts` 33 481,
    `commands/global.ts` 13 026, `commands/registry.ts` 12 630, `hooks/notificationText.ts` 6 824,
    `views/settings/notifications.tsx` 16 632, `locales/apps.ts` ≈ 8 000 of 32 433, `ui/Dialog.tsx` 8 409, `ui/Menu.tsx`
    4 818, `ui/Tooltip.tsx` 3 693, `components/primitives.tsx` 7 383, `api.ts` ≈ 8 000 of 34 218, `queries.ts` 9 064,
    `apiCall.ts` 3 497, `i18n.ts` ≈ 8 000 of 58 807, `brain/natureza.tsx` 6 874, the new tab ≈ 15 000, fold and dialogs
    ≈ 15 000, stylesheets ≈ 4 000 = ≈ 313 KB; tests: `AgentTab.test.tsx` ≈ 30 000, `HistoryFold.test.tsx` ≈ 15 000,
    `MemoryHistoryDialog.test.tsx` ≈ 10 000, `FactsWidget.test.tsx` ≈ 6 000, `historyTime.test.tsx` ≈ 4 000,
    `memoriaCopy.test.ts` ≈ 5 000, `proposalsNotice.test.tsx` ≈ 5 000 = ≈ 75 KB; and their cross-cutting files
    `gallery/main.tsx` 29 380, `gallery/reviewsStory.tsx` 2 217, `tests/e2e/reviews.spec.ts` 16 469 (the model),
    `tests/e2e/a11y.spec.ts` 17 550, `tests/e2e/shell.ts` 11 753, `commands/commands.source.test.ts` 37 992,
    `typography.test.ts` ≈ 10 000 of 42 961, `ui/ui.source.test.ts` ≈ 8 000 of 46 569, `i18n.orphans.test.ts` 6 103, the
    new `tests/e2e/memoria.spec.ts` ≈ 25 000 = ≈ 164 KB; ≈ 552 KB → ≈ 138k
  - S4 (C109-C124): `contracts/src/settings.ts` 24 531, `core/src/config/failClosed.ts` 4 006, `core/src/config/tolerant.ts`
    8 924, `core/src/memory/excludes.ts` 8 341, `core/src/security/safeFs.ts` 19 259, `core/src/memory/contexts.ts` 15 924,
    `core/src/memory/indexer.ts` ≈ 10 000 (`rowFilter`), `apps/api/src/routes/memory.ts` 15 865, `reviews.ts` 2 285,
    `cleanup.ts` 2 463, `dashboards.ts` 2 338, `system.ts` ≈ 8 000 of 30 810, `core/src/memory/recall.ts` 30 367,
    `search.ts` 10 538, `graph.ts` 8 439, `related.ts` 9 109, `links.ts` 10 172, `tree.ts` 13 324, `maps.ts` 10 018,
    `hygiene.ts` 8 106, `reviews.ts` 10 991, `cleanup.ts` 15 631, `cleanupScan.ts` ≈ 6 000, `routers.ts` ≈ 6 000,
    `core/src/dashboards/sources.ts` ≈ 6 000, `apps/api/src/server.ts` ≈ 8 000, the new access module ≈ 12 000 = ≈ 287 KB;
    tests: `tests/memoria.access.test.ts` ≈ 40 000, the S4 part of the layer file ≈ 8 000 = ≈ 48 KB; ≈ 335 KB → ≈ 84k
  - S4r (C125-C131): `core/src/runs/runManager.ts` ≈ 20 000 of 76 015, `core/src/execution/service.ts` 27 228,
    `core/src/runs/protectedFolder.ts` 5 440, `adapters/claude/src/index.ts` 21 242, `core/src/agents/types.ts` 5 415,
    `contracts/src/records.ts` 6 467, `contracts/src/runs.ts` 6 078, `apps/api/src/routes/runs.ts` 15 160, `skills.ts`
    11 051, `sessions.ts` 2 427, `routines.ts` 5 266, `core/src/routines/scheduler.ts` ≈ 6 000, `docs/security.md` ≈ 10 000
    = ≈ 142 KB; tests: `tests/memoria.access-runs.test.ts` ≈ 30 000, `tests/contexts.runs.test.ts` 23 084 and
    `tests/adapters.test.ts` 9 607 (the models) = ≈ 63 KB; ≈ 204 KB → ≈ 51k
  - S5 (C132-C138): `core/src/security/safeWrite.ts` 24 862, `core/src/security/safeFs.ts` 19 259,
    `apps/api/src/routes/skills.ts` ≈ 3 000 (the import model), `apps/api/src/routes/memory.ts` 15 865,
    `contracts/src/api/memory.ts` ≈ 6 000, the new transfer module ≈ 10 000 = ≈ 79 KB; `tests/memoria.transfer.test.ts`
    ≈ 25 000; ≈ 104 KB → ≈ 26k
  - screens B (C139-C147): `brain/notes/NotesTree.tsx` 8 449, `NotesSidebar.tsx` 14 702, `NotesTree.test.tsx` 11 798 (the
    model), `views/settings/memory.tsx` 6 270, `locales/brain.ts` 33 481, `ui/Dialog.tsx` 8 409, `ui/Menu.tsx` 4 818,
    `ui/Tooltip.tsx` 3 693, `api.ts` ≈ 8 000, `brain/notes/testnet.ts` 13 956, the new modal and dialogs ≈ 15 000 and
    stylesheet ≈ 3 000 = ≈ 132 KB; tests and cross-cutting: `FolderAccess.test.tsx` ≈ 15 000, `FolderTransfer.test.tsx`
    ≈ 12 000, `memoryAccess.test.tsx` ≈ 8 000, the part-B half of `tests/e2e/memoria.spec.ts` ≈ 10 000, `gallery/main.tsx`
    29 380, `tests/e2e/a11y.spec.ts` 17 550, `tests/bundle-size.test.ts` 10 659 and `scripts/bundle-baseline.json` 6 166 =
    ≈ 109 KB; ≈ 240 KB → ≈ 60k
  - all slices ≈ 43k + 66k + 96k + 55k + 138k + 84k + 51k + 26k + 60k = ≈ 619k, over 150k
- Intended cut, at the surface boundaries (the plan's cut S3/S4 included), batches sequential and each only on green:
  - **A1** (facts and history, core and API): S1 + S2 ≈ 43k + 66k = ≈ 109k; C1-C39
  - **A2** (proposals, consolidation, guard, sentinel, core and API): S3 ≈ 96k; C40-C79, and C39 (moved from A1 by the
    coordinator on 31/10/2026: a restored backup opens at migration 30, which A2 adds; the claim is unchanged) (A2 reads A1's history and
    `assertFact`)
  - **A3** (part A's cross-cutting API checks): ≈ 55k; C80-C86 (S3 + A3 ≈ 151k is just over the budget, so A3 stays apart)
  - **A4** (part A's screens): ≈ 138k; C87-C108 (calls the routes of A1 and A2)
  - **B1** (folder access, reads and runs): S4 + S4r ≈ 84k + 51k = ≈ 135k; C109-C131 — the plan's cut: part B starts here
  - **B2** (export, import and part B's screens): S5 + screens B ≈ 26k + 60k = ≈ 86k; C132-C147 (C147's bundle bound
    weighs both parts' screens, so it lands last)
- Mechanism: handoff, six batches A1-B2 (owner, 31/10/2026)

Status of batch A1 (C1-C39):

- S1, the facts (C1 to C20): closed, every proof green in `tests/memoria.facts.test.ts`, `tests/memoria.layer.test.ts`
  and `tests/memoria.migration.test.ts`. The defect of `facts.ts:91` is proven fixed: with the old close rule put back
  (`valid_to = max(validFrom, f.validFrom)` on every open fact, no refusal), C9's two cases and C10's two cases fail
- S2, the history (C21 to C38): closed, every proof green in `tests/memoria.history.test.ts`,
  `tests/memoria.layer.test.ts` and `tests/memoria.migration.test.ts`
- C39: **open, moved to A2**. Its second clause is "restored, opens at **30**", and migration 30 (`memory_proposals`,
  door 5) is A2's; at A1 the latest migration is 29, so the check cannot pass as written. No test was written under
  `C39 ` (its proof line runs no test at `d0d7b12`), nothing was retargeted; A2 writes the whole check, its first clause
  (the history read back after a backup restored over a fresh home) included, once migration 30 exists

- **Boundary (batch A1):** C1-C38 closed at `d0d7b12` (code, tests and pins in one commit). On that tree: `npm run
build`, `npm run typecheck` and `npm run lint` exit 0, `npx vitest run` at the root is green (174 files, 2545 tests
  passed, 1 skipped), and `npm run test -w apps/command-centre` is green (176 files, 1538 tests; no file of this batch
  is under `apps/command-centre`). Each of the 47 `Proof:` lines of C1-C38 passes run alone and runs only its check's
  tests; C39's runs none. What A1 leaves for A2 and later to add on top: a run's credential still writes a fact directly
  (`201`, `author: "run:<id>"`, `trust: "inferido"`; C40 turns it into `202` and a proposal); the MCP tools still call
  the owner's routes (`author: "owner"`); no `proposal` or `guard` version is written yet (the writers exist in
  `core/src/memory/historyStore.ts`, `recordVersion`, with `proposal_id`); `trust` of a direct fact is `usuario` for the
  owner and `inferido` for anyone else (C52's trust rule is A2's). The pins A1 moved, so A2 and A3 add on top: 158
  routes and scenarios, 82 owner and 34 content routes (chained amendments in `sdk.api-thin`, and `paineis.contract`
  C60's counts as `32 + 2` and `81 + 1`), 156 checked responses, 79 raised pairs (`400 provenance_required`, `409
fact_overlap`), `POST /api/memory/history/restore` among the routes that name `edit_conflict` and `note_*`, `GET
/api/memory/history/:id` and the restore declaring `403 forbidden_path` and `404 not_a_file` (what the probe of
  `api.refusals` C46 found), migrations 28 and 29 in the lists of `data.migration`, `contexts.runs`, `device-scopes`,
  `natureza.layer` C7 and `paineis.layer` C19 and C98, the scope table, the rows of `docs/security.md`,
  `memory.history.maxBytes` among the leaves that open nothing (`data.settings` C46) and in the v1 `settings.changed`
  fixture, and seven names of the internal barrel (`sdk.surface` C38: `FactAuthor`, `factSourcePolicy`, `getVersion`,
  `listVersions`, `recordFileVersion`, `recordMove`, `restoreVersion`); `docs/events.md` regenerated with no change
- **Settled mid-build:** nothing by the owner. Builder decisions inside the approved shape: (a) **a gap in door 2's
  table** (an owner question, G24): a closed new fact `[T, U)` over an old fact of the same keys that begins inside
  `[T, U)` (at or after T, before U) has no row; it is `409 fact_overlap` and nothing is written, since closing,
  retracting or splitting the old fact would each record a belief nobody stated (proven by an extra test titled
  "settled mid-build" in `tests/memoria.layer.test.ts`, not under a check id); the alternative is to retract it when it
  ends at or before U and refuse otherwise; (b) only facts not retracted take part in the overlap rule and in
  "unchanged"; a retracted fact is never closed or retracted again by an assertion; `retract` with `wrong` on a fact
  already retracted answers it unchanged; (c) `assertFact` takes `author`, default `owner` (the engine's own calls, the
  "Virou realidade" decision); the route sets `owner` or `run:<id>` and no body names it; (d) `knownAt` replaces the
  default "open" filter (it returns what was recorded by K and not retracted by K, closed or not), `asOf` and `knownAt`
  combine with AND (G5), `includeRetracted` lifts the retraction filter of both; (e) today's policy on a fact's source
  (`factSourcePolicy`): no `sourcePath` is shown; a relative one, or one under no enabled indexed folder nor `memory/`,
  is not (no root to judge it by); otherwise the workspace filter on its path relative to the longest root; a verdict
  that throws leaves the fact out (`queryFacts` `allow`), and the limit counts the facts shown; (f) the history's store
  (`historyStore.ts`: the rule, `recordVersion`, the retention) is apart from its reads and restore (`history.ts`), so
  the index worker imports no note code; the note writers take an optional `history` callback on `NoteContext`, the
  review decision and the cleanup's moves one each, and the routes pass `recordFileVersion` / `recordMove` with author
  `owner`; (g) `sha256` of a version and of a blob is stored as the note version is spelled, `sha256:<hex>`; the cap
  measures the stored (deflated) bytes, `SUM(length(bytes))`; a removed version's `size` is `null`; (h) an index pass
  records a version only for a file it read as changed or for a path with no version yet (a file whose `mtime` and
  size are the index's is not read again), reusing the bytes the pass read when they were read whole; the removed sweep
  runs over every path whose newest version is not `removed` on a full pass and over the gone paths on a pass over
  named paths, and a path the policy refuses today is not taken for gone; (i) `GET /api/memory/history?path=` takes a
  path relative to `memory/` (no leading `/`, no drive, no `..`) and `limit` 1 to 100; the restore answers `path`
  relative to `memory/`; a restore with `baseVersion` of a gone file, or without it over a file that exists, is `409
edit_conflict`; (j) `memory.history.maxBytes` is an integer from 1, default 268435456, an unreadable value reads the
  default (it opens nothing); (k) proof readings: an index pass waits for the clock to move, so no proof that runs a
  pass fakes `Date` (C16 and the S2 file run on the real clock); C21's review is `keep` on an indexed note (a
  `properties` write the decision makes, recorded as `review`); C28's "stored size of 12 incompressible blobs" is twelve
  versions of 800 random hex characters, the cap set by `PUT /api/settings` to their stored size plus the thirteenth's
  deflated size (the accepted edge, nothing dropped), then a fourteenth save (the oldest go until the store fits, and no
  fewer); C35's link is `notes/ligado/` made a link to `notes/real/` after its version was written
- **Abandoned:** a repository `git` under `memory/` (door 4's rejected alternative, never started); recording the
  history from the route by reading the file back after the write (it could take another writer's bytes for the
  owner's); a `CHECK` on the closed vocabularies of `memory_versions` (door 4's literal shape has none, and widening a
  `CHECK` takes a table rebuild, as migration 27 did); a raw `fs.lstatSync` for "is the file still there"
  (`security-reads` C32: the safe stat is used)

Status of batch A2 (C39-C79, and C148, added with door 16):

- C39: closed in `tests/memoria.migration.test.ts`, both clauses (the history read back after a backup restored over a
  fresh home; a backup made at schema 27 with facts, restored, opens at 30 with the keys filled and `author` `unknown`)
- S3, the inbox, the consolidation and the guard (C40 to C74, C79): closed, every proof green in
  `tests/memoria.proposals.test.ts`, `memoria.mcp.test.ts`, `memoria.consolidation.test.ts`, `memoria.localday.test.ts`,
  `memoria.guard.test.ts`, `memoria.skill.test.ts`, `memoria.layer.test.ts` and `memoria.migration.test.ts`
- S3, the sentinel (C75 to C78): closed, every proof green in `tests/memoria.sentinel.test.ts`,
  `memoria.localday.test.ts`, `data.settings.test.ts` (C63) and `events.contract.test.ts` (C27, C29)
- C148: closed in `tests/memoria.proposals.test.ts` (door 16, found while building: the JSON a proposal stores)

- **Boundary (batch A2):** C39 to C74, C79 and C148 closed at `134afb4` (code, tests, pins, Landing row 16 and C148 in
  one commit), C75 to C78 at `dfbd035`. On each tree: `npm run build`, `npm run typecheck` and `npm run lint` exit 0, `npx
vitest run` at the root is green (`134afb4`: 180 files, 2616 tests passed, 1 skipped; `dfbd035`: 181 files, 2625
  passed, 1 skipped), and `npm run test -w apps/command-centre` is green (176 files, 1538 tests; no file of this batch is
  under `apps/command-centre`). Each of the 49 `Proof:` lines of C39 to C79 and C148 passes run alone and runs only its
  check's tests (and the local-day file's pin test, titled `C54 C55 C56 C58 C75`). What A2 leaves for A3 and later: no
  screen reads the inbox yet (A4); the inbox rows `sentinel.proposalsPending` and `proposals.invalidNotice` have no
  localized text and Settings › Notifications has no `proposalsPending` switch (G19, C103); C80's `toEqual` over the
  codes of the new routes will find, beside door 10's, what the refusal probe made the two routes declare (`GET
/api/memory/proposals/:id` and `.../decide`: `403 forbidden_path`, `404 not_a_file`, `413 file_too_large`, A1's
  pattern for the history) and what accepting a note or a fact answers on `decide` (`400 unknown_area`, `403
note_not_editable`, `404 note_missing`, `409 note_exists`, `409 structure_fixed`, `409 fact_overlap`): A3 decides
  whether the check counts them. The pins A2 moved, so A3 adds on top: 162 routes and scenarios, 84 owner and 36 content
  routes (chained amendments in `sdk.api-thin`; `paineis.contract` C60 as `32 + 2 + 2` and `81 + 1 + 2`), 160 checked
  responses, 82 raised pairs (`too_many_proposals`, `proposal_decided`, `memory_over_budget`), `POST
/api/memory/proposals/:id/decide` among the routes that name `edit_conflict` and `note_*`, migration 30 in the lists of
  `data.migration`, `contexts.runs`, `device-scopes`, `natureza.layer` C7 and `paineis.layer` C19 and C98, the scope
  table and the rows of `docs/security.md`, two open fields (`memory.ts payload`, `memory.ts result`, `contracts.api`
  C38), four contract exports (`contracts` C41: `PROPOSAL_FILE_MAX_BYTES`, `PROPOSAL_KIND_VALUES`,
  `PROPOSAL_STATUS_VALUES`, `ProposalFileSchema`), six names of the internal barrel (`sdk.surface` C38:
  `ProposalValidationError`, `decideProposal`, `listProposals`, `planNewNote`, `readProposal`, `storeProposal`),
  `sentinels.proposalsPending.enabled` in `data.settings` C19 and C63 and in the v1 `settings.changed` fixture;
  `docs/events.md` regenerated (`proposalsPending` and `count`). `RUN_API_READ_ROUTES` and `RUN_API_WRITE_ROUTES` did not
  change. Older tests whose behaviour AD-045 changes, edited in `134afb4` and named here for the owner:
  `tests/builtin-context.test.ts` (seguranca-p1 C49: a write run's fact is now `202` and a proposal of the run, the body's
  `sourceRunId` still overridden), `tests/memory.notes.cli.test.ts` (cerebro-v2 C17: `note_create` and `note_save` propose,
  accepting writes, a stale save is `409 edit_conflict` at the decision; cerebro-v2 C17's text "return the route's
  result" is superseded by AC 48), `tests/api.contract.test.ts` C12 (the parked write skill is `gauntlet-loop`, since
  `consolidate-memory` only reads)
- **Settled mid-build:** nothing by the owner. Builder decisions inside the approved shape: (a) **a new door, 16** (an
  owner question, G25): the JSON a proposal stores in `payload` and `result`, per kind (Landing row 16, C148); default as
  built; the alternative is a column per field of each kind; (b) the ceiling's "smaller than the file now" is no more
  lines and no more bytes, and fewer of one (C59's 220-over-230 case moves long lines, so both shrink); the alternative
  is fewer lines alone; the ceiling is checked only when the accepted ops change `MEMORY.md` (a fact-only acceptance
  skips it) and only for consolidations, not for a `memory_edit`; (c) C75's `count` is both an optional top-level
  `count` of the v1 `sentinel.fired` payload (additive; `EVENT_VERSIONS` stays `[1]`) and `messageParams.count`, which
  the inbox row carries (C78); (d) the guard: at `run.started` a `guard` version only when `MEMORY.md` exists and
  differs from its newest version ("não existe" is kept on the instance: door 4 allows a null `sha256` only for
  `removed`); a run's mode is its request's (no request: a write unless its profile is `read_only`); a `MEMORY.md` the
  run created is moved aside and recorded as a `guard` version of its bytes and a `removed` version by `system`; a run
  that deleted it gets it back (create) and its `memory_edit` holds an empty text; the put-back is the instance's own
  method `putBack` (C71 watches it); (e) the consolidation hook reads only runs that finished `done` of
  `consolidate-memory`; its inbox row is `kind: system`, `tone: warn`, `messageKey: proposals.invalidNotice`, the AC 53
  title, the reason as body (the first schema issue's path and message), `href: /runs/<id>`; (f) a `note_create`
  proposal is checked when made as `createNote` checks (`planNewNote`: title, tags, area, size, fixed structure) and
  refused with `400 validation` whose message starts with the note's code (`structure_fixed: …`), so cerebro-vista-notas
  C27 (the MCP tool names `structure_fixed`) still holds and `POST /api/memory/proposals` declares no new code; (g)
  `decide`: no `ops` is every valid op; an empty list, an index out of range, an op not `valid`, no valid op, or two
  chosen ops naming the same line are `400 validation`; no `baseVersion` means `MEMORY.md` did not exist; the files the
  decision replaces are written first and the ones it creates after; a failure puts back the replaced ones (a file the
  decision created before a later create failed stays: no primitive removes a file of `memory/` and the raw-fs list does
  not grow); a `fact` op is asserted with `sourcePath` = `<memory>/<path>` (the `#section` dropped) and `sourceRunId` =
  the proposal's run; a topic file is created as `---\ntype: memoria-topico\n---\n\n` and the lines; the pointer's title
  is the slug with hyphens as spaces and its first letter upper-cased; a `supersede` of a line under no heading puts the
  new line in its place; `opCount` is 1 for every kind but `consolidation`; the summary of a `fact` is `s · p · o`, of a
  `note_create` the title, of a `note_save` the file's name; the list's `limit` is 1 to 200 (default 50); `:id` is
  `mp_` and 16 hex digits, anything else `400 validation`; (h) accepting a `fact` proposal gives it the trust of its
  `sourcePath` and `sourceLine` by the trust rule when they are a line of `memory/`, `inferido` otherwise; (i) `decide`
  and `readProposal` take the day from `new Date(Date.now())`; proof readings: the local-day file moves `Date.now` with
  `movingClock` (a frozen `Date` made an index pass spin and hang its worker), and C64's "now" is the real clock between
  the call and its answer; C47 and C148 drive the hook and the guard by emitting `run.started` and `run.finished` for a
  run record on the bus, C48 to C50 and C69 to C71 run the fake Claude CLI (`runWorld` in `tests/helpers/memoriaWorld.ts`,
  the `questionWorld` pattern, with a hook after the `started` event); (j) `facts_assert` still sends `sourceRunId` from
  `MORDOMO_RUN_ID` when it is set
- **Abandoned:** checking a `note_create` proposal with codes of its own (C80 pins that route's codes to `429` alone); a
  raw delete to undo a file a failed decision created (the raw-fs list does not grow, C84); freezing `Date` around a
  decision (an index pass waits for the clock to move); `count` only in `messageParams` (C75 names it in the payload)

Status of batch A3 (C80-C86):

- C80: closed after plan amendment 2 ("Correções de construção", G26), its two proofs green in
  `tests/memoria.contract.test.ts` and `tests/api.openapi.test.ts` (C16)
- C81 to C85: closed, every proof green in `tests/memoria.contract.test.ts`, `tests/api.refusals.test.ts`,
  `tests/security-reads.test.ts`, `tests/sdk.instances.test.ts` (C30) and `tests/data.settings.test.ts` (C46)
- C86: closed after a build correction ("Correções de construção", G27), its proof green in
  `tests/memoria.contract.test.ts`
- **A defect found, not fixed (C63, G6):** when an accepted consolidation creates two topic files and the second
  create fails, the first stays on disk with no version (`writeAll` in `core/src/memory/proposals.ts` puts back only
  the files it replaced), so G6's "the earlier files are put back" and C63's "(a file written earlier in the same
  decision is put back)" do not hold for a created file; the second decision then answers `200` and appends the same
  lines to that file again (`topics/a.md` ends with `- Um` twice), so "a second decide works" holds only in its
  status. C63's test covers the replaced `MEMORY.md` alone. A failing test (an EIO injected into the guarded writer's
  create of `topics/b.md`) is kept out of this branch's suite, on the local branch `bug/cerebro-memoria-g6`

- **Boundary (batch A3):** C80 closed at `89f9b0f` (with plan amendment 2), C81 to C85 at `7251a94`, C86 at `ed7d3dc`.
  On each tree: `npm run build`, `npm run typecheck` and `npm run lint` exit 0, `npx vitest run` at the root is green
  (`89f9b0f`: 182 files, 2627 tests passed, 1 skipped; `7251a94`: 2633 passed, 1 skipped; `ed7d3dc`: 2638 passed, 1
  skipped), and `npm run test -w apps/command-centre` is green (176 files, 1538 tests; no file of this batch is under
  `apps/command-centre`). Each of the 12 `Proof:` lines of C80 to C86 passes run alone. No product code changed in
  this batch; `docs/security.md` gained one paragraph (door 9 and the MCP's mark, C82). No pin moved: the probe's 162
  scenarios, the scope table's counts, the raw-fs list (70 rows) and the module-state list are as A2 left them. What A3
  leaves for A4: the screens (C87-C108) read the routes whose codes C80 now names; C93 gives a text to `409
edit_conflict` and `409 memory_over_budget` alone, so what the detail shows for the other codes of amendment 2 is A4's
  to settle inside design.md
- **Settled mid-build:** nothing by the owner. Builder decisions inside the approved shape: (a) **C80's code list**
  (plan amendment 2, an owner question, G26): the claim names the codes as built; default as built, the alternative
  is mapping the acceptance's refusals onto door 10's codes; (b) **C86's dashboards clause** (an owner question, G27):
  the claim asserts the open-facts-only behaviour of before; the alternative is showing closed facts in the dashboards;
  (c) C80's `toEqual` is read over each new route's own `errors` (the common errors aside, as cerebro-paineis C58
  reads it); for the changed entries "declares" is a containment (`memory.facts.assert` also declares door 3's `400
provenance_required`); (d) C84's "reads go through `readWorkspaceText`" is read as the safe reader: the modules call
  `readWorkspaceFile`, which `readWorkspaceText` wraps; the walker's files are the five part-A modules of
  `core/src/memory/`, `core/src/sentinels/proposalsPending.ts` and `apps/api/src/routes/memory.ts`; (e) C81's two
  halves: the device and run refusals and the run's lists in `memoria.contract`, the probe's per-route comparison and
  its names in `api.refusals`; a run's credential is shown live by `GET /api/memory/facts`, of a write and of a
  read-only run; (f) C86 by value: `MEMORY_WRITES_PER_RUN` as the source's constant and as 100 journal lines written
  and the 101st `429 too_many_requests`; `limits.approvalTtlDays` as 7, `expiresAt - createdAt` of 7 days and the
  expiry's two edges; the `## Runs` line as `- HH:MM run <id> → done in 3s · /organize-brain`, under `## Runs`
- **Abandoned:** mapping the decision's acceptance refusals onto door 10's codes (a product change C80 does not need);
  showing closed facts in the dashboards' facts source (it would break cerebro-paineis); fixing G6 in this batch (C63
  is A2's check, and the brief asked for a report with a failing test); committing that test into this branch's suite
  (the root gate would be red)

Status of batch A4 (C87-C108):

- C87: closed, its proof green in `apps/command-centre/src/desktop/widgets/FactsWidget.test.tsx`
- C88 to C95: closed, every proof green in `apps/command-centre/src/brain/reviews/AgentTab.test.tsx`
- C96: closed, both proofs green (`AgentTab.test.tsx`, the tab's keys and the Núcleo's panel;
  `commands/commands.source.test.ts`, the new files and their entries own no listener and the allowlist stays at 10
  files and 11 listeners)
- C97 to C100: closed, every proof green in `apps/command-centre/src/brain/notes/HistoryFold.test.tsx`
- C101: closed in `apps/command-centre/src/brain/notes/historyTime.test.tsx` (`TZ=America/Sao_Paulo` pinned at the top
  and asserted)
- C102: closed in `apps/command-centre/src/brain/notes/MemoryHistoryDialog.test.tsx`
- C103: closed in `apps/command-centre/src/brain/reviews/proposalsNotice.test.tsx`
- C104 and C105: closed in `apps/command-centre/src/brain/memoriaCopy.test.ts`
- C106 to C108: closed in `tests/e2e/memoria.spec.ts` (each proof line builds first, then runs its `-g`)

- **Boundary (batch A4):** C87 to C95 and C103 closed at `6d790b3`, C96 to C102 at `deda27c`, C104 and C105 at
  `8078135`, C106 to C108 at `3a376f4`. On each tree: `npm run build`, `npm run typecheck`, `npm run lint` and `npm run
bundle:check` exit 0, `npx vitest run` at the root is green (182 files, 2640 tests passed, 1 skipped), and `npm run
test -w apps/command-centre` is green (`6d790b3`: 179 files, 1567 tests; `deda27c`: 182 files, 1589; `8078135` and
  `3a376f4`: 183 files, 1597). Each of the 23 `Proof:` lines of C87 to C108 passes run alone and runs only its check's
  tests. `memoria.spec.ts`, `reviews.spec.ts`, `notes-view.spec.ts`, `a11y.spec.ts`, `gallery.spec.ts` and
  `gallery-contrast.spec.ts` run together pass at `3a376f4` (114 tests); an earlier run of the same six showed
  `notes-view` C85 failing with the known "Response has been disposed" race and C89 failing after it (C85's own
  cleanup could not reset the notes tabs of the shared home), and the rerun passed both. **Weight**, measured on the
  build of `3a376f4` against the `cerebro-paineis` entry (574 327 B JS gzip, 80 203 B CSS gzip): 585 774 B JS gzip
  (+11 447 B, 1.993%) and 81 504 B CSS gzip (+1 301 B); JS raw 1 791 706 B, CSS raw 371 473 B. C147's cap covers both
  screen batches: B2 has 4 937 B of JS gzip and 1 771 B of CSS gzip left under it (16 KB and 3 KB as 16 384 B and
  3 072 B). `tests/pixel.plugin.test.ts` C28 (the newest entry within 2% of the build) passes with 39 B to spare, so
  the first B2 commit that adds weight must also append the `cerebro-memoria-confiavel` entry (C147). The version
  dialog and "Histórico da memória" are already reached from both entries only by an `import()` (C147's first clause):
  `HistoryFold` and `MemoryHistoryHost` take them `lazy`, and the gallery's only static importer is
  `gallery/notesStory.tsx`, itself an `import()`. What A4 leaves for B2: the NOTAS heading's `Menu` (G18) exists with
  one item, for "Importar pasta…" (C144) to join; the folder rows have no `Menu` yet (both its items, "Permissões…" and
  "Exportar pasta…", are C139's, so A4 built none); Settings › Memória is untouched (C142). Pinned tests of other
  features edited because AC 39 and AC 80 add to the arrangement they pinned: `brain/reviews/ReviewsScreen.test.tsx`
  cerebro-natureza C72 (the tabs read `Para revisar (2)`, `Sem classificação (5)` and now `Do agente (0)`, still a
  `toEqual`), `brain/notes/NotePanel.test.tsx` cerebro-vista-notas C52 (the folds `Links`, `Relacionadas`, `Nesta
nota` and now `Histórico`; four folds wait on their own request). No allowlist changed: `listenersAllowlist`,
  `DYNAMIC_PREFIXES` of `i18n.orphans`, `WHOLE_MODULE_IMPORTS` of `legacy.graph` and the importer lists of
  cerebro-natureza C92 and cerebro-vista-notas C79 are as A3 left them
- **Settled mid-build:** nothing by the owner. Builder decisions inside design.md: (a) what the detail shows for a
  decision's other codes (A3 left it to A4): the code's own message from `errorMessage`, in the same banner with
  `AlertTriangle`, and the item stays (no new text); (b) keys beyond design.md's table: `proposals.ops.one` ("1
  operação" / "1 operation", G22, so `proposals.ops` keeps the table's text), `proposals.section.fact` ("Fato") and
  `proposals.section.topic` ("Tópico {slug}") for the sections design.md names, `notes.tree.more` ("Opções das notas" /
  "Notes options") for the NOTAS menu's trigger (a name with "More" collided with the reader's "More" button in
  `notes-view.spec.ts`), and the G19 pair in `locales/apps.ts`; "Restaurar" of "Histórico da memória" reuses
  `settings.restore`; (c) a `fact` proposal shows its one op row with a checkbox (design.md lists only `memory_edit`,
  `note_create` and `note_save` without ops), so it is accepted with "Aceitar selecionadas (k)"; the route ignores `ops`
  for it; `baseVersion` is sent only when the detail answered one; (d) "Ver histórico" opens `MEMORY.md` (a
  consolidation, a `memory_edit`) or the written note in the notes view, and is absent for a fact (nothing written);
  (e) the sources link to `#/brain/notes?open=<absolute path>&line=<n>`: the notes view opens the note in a tab and
  scrolls to the first paragraph, item or `##` heading holding the line's words (the renderer keeps no source lines);
  the link is made by the screens and never stored, so no door; `Flow` hop 12 says so; (f) a note outside `memory/` has
  "Sem versões ainda." and asks nothing; the row's date and time are the `Tooltip` of the row's button, which is named
  by its parts (ui.source C25 wants a named control under a `Tooltip`); (g) the diff and a deleted note's text are
  focusable regions (`tabIndex=0`), so a scrolling one is reached by the keyboard (axe `scrollable-region-focusable`);
  (h) "Propostas do agente" is the last row of the sentinels card, after the triage row (cerebro-natureza C88 pins
  "Revisões vencidas" between "Vigiar pastas" and the triage row), and the card draws only the sentinels the settings
  hold; (i) the `proposalsPending` row's body is translated for pt-BR in `notificationText`; the invalid notice's title
  is localized and its body (the reason) kept as written; (j) C106's consolidation is answered by the page's routes
  (a real one needs a model run); C107's proposal and note are real; (k) the gallery's entry is two halves rendered by
  `reviewsStory` and `notesStory` with `part="memoria"`, so the screens' chunks are shared and the importer pins hold;
  (l) the brief named Settings › Memória and the folder rows' menu under A4; the cut gives both to B2 (C139, C142)
- **Abandoned:** an interim `cerebro-memoria-confiavel` baseline entry (written while A4 measured 2.06% over
  `cerebro-paineis`, dropped once it measured under `pixel.plugin` C28's 2%); a gallery module of its own
  (`memoriaStory.tsx`: it split `AgentTab` and `HistoryFold` out of the screens' chunks, about 1 KB more, and named
  itself among the importers that cerebro-natureza C92 and cerebro-vista-notas C79 pin); `import().then((m) =>
m.X)` for the two halves (`legacy.graph` C2 counts it as taking the module whole); moving the history event to a
  module of its own (it reshuffled the icon chunks for 0.8 KB more); `brain/notes/notesData` in the facts widget
  (cerebro-vista-notas C79: nothing the entries load statically may come from `brain/notes/`)

Status of batch B1 (C109-C131):

- C109 to C112: closed, every proof green in `tests/memoria.access.test.ts`, `tests/memoria.layer.test.ts` (C110,
  C111) and `tests/data.settings.test.ts` (C46 every leaf, for C112)
- C113: **open, stopped on the claim (G28)**. Search, recall with a followed link, graph, related, links and query
  equal the twin's by value in every field but a search hit's `score`, which is FTS5's bm25 over the whole index and
  differs in its last digits; the test compares the hits, their order and every other field, and drops `score`. Its
  proof is green on that reading; the claim as written cannot pass without an index per audience
- C114 to C119: closed, every proof green in `tests/memoria.access.test.ts` (C114 to C118) and
  `tests/memoria.access-runs.test.ts` (C119)
- C120: **open, stopped on the claim (G28)**, as C113: search, recall, maps and `journal?days=7` of a write run's
  credential equal the twin's but for the search `score`; facts and recall/stats hold nothing hidden
- C121: closed on a proof reading (G31): the prompt is read off a run of the context checked when it launches; its
  proof is green in `tests/memoria.access-runs.test.ts`
- C122 to C124: closed in `tests/memoria.access.test.ts`
- C125 to C131: closed, every proof green in `tests/memoria.access-runs.test.ts` and, for C126, in
  `tests/memoria.layer.test.ts`

- **Boundary (batch B1):** C109 to C131 at `69bab24` (code, tests, pins, Landing rows 17 and 18 and plan amendment 3 in
  one commit), C113 and C120 standing open on G28. On that tree: `npm run build`, `npm run typecheck` and `npm run
lint` exit 0, `npx vitest run` at the root is green (184 files, 2676 tests passed, 1 skipped), and `npm run test -w
apps/command-centre` is green (183 files, 1597 tests; no file of this batch is under `apps/command-centre`). Each of
  the 27 `Proof:` lines of C109 to C131 passes run alone and runs only its check's tests. Two mutations checked by
  hand: with the request-time check of `RunManager.create` removed, C125 and C131 fail; with the launch-time check
  removed, C126, C129, C130 and C131 fail. What B1 leaves for B2: `artifacts/exports/` is already never served to a
  device (the access view denies it), so the export (door 14) only writes there; `GET /api/memory/tree` already marks a
  restricted folder (`access`, C123) for the screens of C139 to C143; `PUT /api/settings` already validates a
  `folderAccess` the "Permissões…" modal saves. The pins B1 moved, so B2 adds on top: 85 raised pairs (C13 of
  `api.contract`: `folder_hidden`, `folder_read_only`, `folder_hide_unsupported`), the errors of `GET /api/memory/note` in
  `routeScopes.ts` (`404 not_found`), five contract exports (`contracts` C41: `FOLDER_ACCESS_MAX`,
  `FOLDER_ACCESS_UNREADABLE`, `FOLDER_AUDIENCES`, `FOLDER_LEVELS`, `FolderAccessEntrySchema`), seven names of the
  internal barrel (`sdk.surface` C38: `FolderAccess`, `accessSettings`, `exportsDir`, `proposalPaths`,
  `resolveFolderAccess`, `scanCleanupScope`, `storedRowFilter`), 30 top-level settings and `folderAccess` among the
  closed fields (`data.settings` C19, with a sample entry among the variants), `folderAccess: []` in the v1
  `settings.changed` fixture, and the type of `GET /api/settings` in `typetests/rest.ts` (C8: `folderAccess` optional).
  The raw-fs list keeps its size (`core/src/security/paths.ts` keeps its one `realpathSync`, now behind
  `realpathOf`, shared by `realpathLenient` and the new `realpathStrict`). Pinned tests of other features edited, all
  additive: `tests/helpers/routeScopes.ts` (cerebro-v2 C53), `tests/api.contract.test.ts` (C13),
  `tests/contracts.test.ts` (C41), `tests/sdk.surface.test.ts` (C38), `tests/data.settings.test.ts` (C19 and its
  variants), `tests/fixtures/events/v1/settings.changed.json`, `typetests/rest.ts` (C8)
- **Settled mid-build:** nothing by the owner. Builder decisions inside the approved shape: (a) **two new doors**,
  Landing 17 (the three `RunFailure.code` values, G16; owner question: the default as built, the alternative a single
  `folder_access` code or `permission`) and Landing 18 (the unreadable list held as one `"*"` entry, G30; owner
  question: the default as built, the alternative a mark outside the value, which a later save would turn into `[]`);
  (b) **the twin's exclusion** is the segment glob `fin` (`settings.excludes` match whole segments of a path relative
  to its root, so `<memory>/notes/fin` spelled absolute excludes nothing); no other segment of the test home is `fin`;
  (c) **how the filter reaches every reader**: a device's or a run's view of the settings (`accessSettings`) adds an
  access mark to `excludes` (a NUL-prefixed entry no glob of the owner holds and no segment matches) and drops the
  hidden indexed folders and context paths, so every read scope and stored-row filter made from those settings
  (`makeWorkspaceFilter`, `readScope`, `storedRowFilter`) refuses what the resolver gives `hide`, the links a recall
  follows included (L-055); a mark that cannot be read, or a path with no absolute spelling, is refused (fail closed);
  the owner's reads use the settings as they are; (d) the levels' order is `write` < `read` < `hide`, two entries as
  specific give the stricter, and a path is judged by the stricter of its lexical and real spellings; (e) G32: an entry
  for a folder that is not there is `hide` for both until it exists; (f) for a device, a note or a preview of a hidden
  file and of one that does not exist are both `404 not_found` with one message per route (the owner keeps
  `note_missing` and `source_missing`); a hidden journal day is `404 not_found` and is not made; (g) a finished cleanup
  scan is worked out again over a device's view when the device reads it (`scanCleanupScope`), so a note only a hidden
  one links to is an orphan and a link into a hidden note leads nowhere, as in the twin; a running scan is filtered;
  (h) a dashboard's snapshot for a device drops every list element, at any depth, whose `path` or `sourcePath` is
  hidden, and the highlights whose `path=`/`open=` target is; (i) proposals for a device: hidden when any file it names
  (`MEMORY.md`, a topic, the note saved or created, an op's or a fact's source) is hidden, or when a new note's place
  cannot be worked out; `total` counts what is shown; (j) runs: the check of `RunManager.create` is skipped only by
  `folderCheck: "launch"`, which the scheduler (every fire but "run now", and its retries), an objective's dispatch and
  a dashboard's question pass; a prompt run is also checked before its conversation is made; the launch always checks,
  over the folders it hands (`memory/` of a memory skill, a handed folder, a context's paths; the skill's own folder
  aside); a device-started run is checked as a device first (`404 not_found`, then `403 folder_read_only`), then as an
  agent; nothing is checked, and no adapter is asked, while no entry gives a level other than `write`; (k) a write run
  whose folders hold a folder `read` for agents keeps it in `protectedDirs` (AC 100 is the memory skill's case; every
  write run gets it), and a provider without `protectsDirs` then fails at launch with `folder_protection_unsupported`;
  (l) beyond the checks, narrowing only: a run's credential appending to a journal hidden or read-only for agents is
  `403 folder_hidden` / `403 folder_read_only`; the `settings.changed` events of a device's stream carry the settings as
  `GET /api/settings` gives them; the routers and context maps are written as agents see the folders (for every
  reader), and a change of `folderAccess` rewrites the routers that exist; the context block of a prompt names no
  hidden path; (m) G29: the owner's field query, journal `?days=`, routers' check and recall statistics respect today's
  policy; (n) routes a device may call that name files and that no check covers, left as they were: `GET /api/runs`,
  `/api/runs/:id`, `/api/runs/:id/stream` and the events stream's run, index and notification events (paths of runs
  and tool calls), `GET /api/sessions*`, `/api/approvals*`, `/api/notifications`, `/api/objectives*`,
  `/api/memory/status` (facets: tags and areas counted over every file), `/api/skills/:slug*` and `/api/connectors*`
  (the skills' and connectors' own folders, where no entry can be); (o) proof readings: C113's and C120's `score`
  (G28); C121's run (G31); C126's third mode at the route is the launched write run's `AgentRun` without its broker,
  built by the adapter (a write run of the service always has a broker); C127's "no declaration" is the Claude adapter's
  manifest with `readConfinement` taken out for the test; C129 and C130 run under `controlled_write` and
  `review_before_write` set by the test
- **Abandoned:** an index per audience (what C113's and C120's `score` would need); a post-filter of each answer at
  the route (it leaves counts, groups and followed links computed with the hidden files); adding absolute paths to the
  meaning of `settings.excludes` (it would change what the owner's own excludes do); a sentinel entry outside the value
  for an unreadable list (Landing 18's rejected alternative); refusing every Claude run whose folder holds a hidden
  folder (door 13's rejected alternative)
