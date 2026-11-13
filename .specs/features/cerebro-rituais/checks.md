# Cérebro: rituais checks

Profile: ui
Plan: `.specs/features/cerebro-rituais/plan.md`
Design: `.specs/features/cerebro-rituais/design.md` (binding for the screens)

101 checks in 8 slices + cross-cutting · 7 one-way doors · open questions: none, the plan's three answered by the owner on
09/11/2026 with their recommended defaults (AD-048: the weekly reminder on, Friday 16:00, at most one a week and none after
the review is finished; the next action is the first open `- [ ]` task of the note; a ~30 minute walk through the screens
with the owner after the build and before the independent verifier) · 39 gaps this derivation found (`## Lacunas do
plano`, G1-G39), each written into the checks with its default; none blocks the build, and four of them (G4, G20, G22, G24)
add a key to a Surface row, which the owner should confirm.

The plan's slices mix the core, the API and the screens. Here S1-S4 and S6-S8 are the core and the API of plan S1-S4 and
S6-S8, "Cross-cutting, API" holds what every new route owes together (the route table, the pins, who may call), and S5 is
every screen of the plan (the weekly page of plan S2-S6, the mention fold of plan S8, the sentinel row and the
notification of plan S7), so a batch cut never splits a check slice.

Every proof is `npx vitest run <file> -t "<C-id> "` from the repository root (root tests) or
`npm run test -w apps/command-centre -- <file> -t "<C-id> "` (UI tests); a test title starts with its check id followed by
a space, and every case a check is credited for carries that id in its title (L-062). `E2E` proofs build the CLI and the
interface first and then run `MORDOMO_E2E_PORT=4901 npx playwright test --config tests/e2e/playwright.config.ts <spec> -g "<C-id> "`:
the e2e server runs `apps/api/dist/cli.js` and serves the built interface, so a proof without the build runs yesterday's
code (L-056); the same holds for `bundle:check`, whose proof line builds first. New root files: `tests/rituais.loops.test.ts`
(S1), `tests/rituais.projects.test.ts` (S2, S3), `tests/rituais.tasks.test.ts` (door 3), `tests/rituais.archive.test.ts`
(S4), `tests/rituais.finish.test.ts` (S6), `tests/rituais.sentinel.test.ts` (S7), `tests/rituais.mentions.test.ts` (S8),
`tests/rituais.access.test.ts` (who may call, the audience differential), `tests/rituais.contract.test.ts` (the route table
and the pins), `tests/rituais.localday.test.ts` (every claim about a local day or a local hour) and `tests/rituais.layer.test.ts`,
which calls the deciding code itself with no HTTP (`Test policy` rows 1 and 2): the loop collector and its key, the window,
the decision rules, the project list's filter, `nextAction`, `reviewBy`, the order, the archive's path check, the finish
counts, the sentinel's rule, the mention terms, the matcher and its exclusion zones, and the link rewrite. The root files
that go through HTTP use `app.inject` against `buildServer` over a real home through a new `tests/helpers/rituaisWorld.ts`
built on `tests/helpers/memoriaWorld.ts` (owner, device and run headers, `put`, `index`, a fixed clock). New UI files live
under `apps/command-centre/src/brain/weekly/` (`WeeklyReview.test.tsx`, `weeklyEntries.test.tsx`, `weeklyMotion.test.ts`,
`weeklyCopy.test.ts`) and `apps/command-centre/src/brain/notes/MentionsFold.test.tsx`; the E2E spec is `tests/e2e/weekly.spec.ts`.

"Now" in every claim is a fixed clock the test sets; "today" is its local day as `sentinelDay` writes it; "the week" is the
local week that starts on Monday (`weekDays` of the dashboards), named by its Monday, `AAAA-MM-DD`. Unless a claim says
otherwise, now is Monday 2026-11-09 10:00 local. Every claim that names a local day, a local hour or a week boundary is
proven in `tests/rituais.localday.test.ts`, which pins `process.env.TZ = "America/Sao_Paulo"` at its top and asserts the pin
holds (that zone has had no daylight saving since 2019, so a week boundary there is a plain UTC-3 boundary), with the clock
where the local and the UTC day differ (L-053). A claim that names a status and a code asserts both. A claim that says "as
before" or "unchanged" asserts the value by name (L-044); a claim about a stored value reads back what the route wrote, never
a row the test seeded (L-051); every list writer has a one-item case (L-050); every bound has its accepted edge and its
refused edge (L-057); every option is proven to reach the result (L-058); every UI mock answers by the query or body it
receives and fails on one it was not given (L-052); a claim about where something sits on screen asserts the order of the
elements (L-046).

## Checks

### S1 - todo laço aberto tem uma decisão (plan S1, door 1) · 13 files · 184 KB · ~46k

**C1** - `GET /api/memory/weekly-review` lists under `loops` each bullet of the level-2 `## Open loops` of the journal days
in the window and of `MEMORY.md`: a journal `memory/journal/2026-11-04.md` with `- 09:15 Ligar para a Ana` on line 12 gives
the item `{ key, text: "Ligar para a Ana", day: "2026-11-04", ageDays: 5, sources: [{ path: <that file>, line: 12 }] }`
(`toEqual` over the key set `key`, `text`, `day`, `ageDays`, `sources`; the `HH:MM ` stamp is not part of the text), with
`key` = the SHA-256 hex of `ligar para a ana`; items come oldest `day` first; a bullet under `### Open loops`, a bullet of
`## Decisions` and a bullet of a level-2 `## Open loops` in `memory/notes/x.md` (not generated) are not listed; with exactly
one loop, `items` has 1 entry and `total` is 1 (AC 1, door 1, L-050)
Proof: `npx vitest run tests/rituais.loops.test.ts -t "C1 "`
Proof: `npx vitest run tests/rituais.layer.test.ts -t "C1 "`

**C2** - The window's edge, at 23:30 of 2026-11-09 local (02:30 of 2026-11-10 in UTC), with `loopsWindowDays` 90: a loop of
the journal day 2026-08-12 (exactly 89 local days back) is listed with `ageDays: 89`, one of 2026-08-11 (90 days back) is
not, and one of a journal day after today (2026-11-10) is not; with `memory.weeklyReview.loopsWindowDays` set to 7 by
`PUT /api/settings`, 2026-11-03 (6 days back) is listed and 2026-11-02 is not (AC 1, AC 2, door 4, L-057, L-058)
Proof: `npx vitest run tests/rituais.localday.test.ts -t "C2 "` (the file pins `TZ=America/Sao_Paulo` itself)
Proof: `npx vitest run tests/rituais.layer.test.ts -t "C2 "`

**C3** - The cut of `loops`: with exactly 50 loops `items` has 50 and `total` 50; with 51 `items` has the 50 oldest (the
newest is absent) and `total` 51; with `memory.weeklyReview.maxItems` set to 3, `items` has the 3 oldest and `total` 51;
with none, `items` is `[]` and `total` 0 (AC 1, Assumptions "Teto das listas", L-057, L-058)
Proof: `npx vitest run tests/rituais.loops.test.ts -t "C3 "`

**C4** - The key's normalization, one asserted case per transform at its own layer, each giving the key of
`ligar para a ana`: `"  Ligar para a Ana  "` (trim), `"Ligar  para\ta Ana"` (whitespace collapsed), `"LIGAR PARA A ANA"`
(case), and `"Revisar orçamento"` and `"revisar orcamento"` give one key (accents folded, G1); `"Ligar para o Ana"` gives
another key; through the route, the three spellings on three journal days are one item whose `text` is the oldest
occurrence as written (G1, AC 3, door 1)
Proof: `npx vitest run tests/rituais.layer.test.ts -t "C4 "`
Proof: `npx vitest run tests/rituais.loops.test.ts -t "C4 "`

**C5** - The same loop on the journal days 2026-11-02, 2026-11-04 and 2026-11-06 and in `MEMORY.md` as
`- Ligar para a Ana (journal 2026-10-30)` is one item with `day: "2026-10-30"` and `sources` holding the four places
(`path`, `line`), oldest day first; a `MEMORY.md` line `(journal 2026-01-05)`, older than the window, is listed with that
day (the window binds the journal, not `MEMORY.md`) (AC 3, Assumptions "Janela dos laços")
Proof: `npx vitest run tests/rituais.loops.test.ts -t "C5 "`
Proof: `npx vitest run tests/rituais.layer.test.ts -t "C5 "`

**C6** - `MEMORY.md`'s other lines, one case each: a line with no `(journal AAAA-MM-DD)` has `day` = the local day of the
file's `mtime` (an `mtime` of 23:30 of 2026-11-03 local, 2026-11-04 in UTC, gives `2026-11-03`); a line ending
`→ closed 2026-11-05` and one ending `(journal 2026-11-02) → closed 2026-11-05` are not listed; a line ending
`(fonte:: memory/journal/2026-11-04.md:12) (autor:: agente) (em:: 2026-11-04)` is listed with the text before the marks, its
key equal to the same text's key from the journal, and `day` from the `mtime` (G2) (AC 4, Assumptions "Linha do MEMORY.md")
Proof: `npx vitest run tests/rituais.localday.test.ts -t "C6 "` (the file pins `TZ=America/Sao_Paulo` itself)
Proof: `npx vitest run tests/rituais.layer.test.ts -t "C6 "`

**C7** - `POST /api/memory/weekly-review/loops {key, action: "close"}` on a listed key answers `200 { key, state: "closed",
previous: null }`; the row read back from `loop_decisions` is `{ key, text: "Ligar para a Ana", action: "closed", week:
"2026-11-09", target: null, decided_at: <now> }`; a hash of every file under the home is the same before and after; the next
`GET` lists it in neither `loops` nor `someday.loops`; the dashboards' `openLoops` source (`POST
/api/dashboards/<id>/refresh` of a board with that widget) counts `total` 1 where it counted 2, the other loop still listed
(AC 5, door 1, L-051)
Proof: `npx vitest run tests/rituais.loops.test.ts -t "C7 "`

**C8** - The `openLoops` widget, one asserted case per stored state: a loop decided `closed`, `project`, `task` or `someday`
is not in its `items` nor counted in `total`; a loop decided `keep` this week is still listed and counted (the Impact row
names four actions, not `keep`); an undecided loop is listed; its other behaviour is the same by value: only the current
week's journal days and `MEMORY.md` lines with an origin in the week, each `natureza: "plano"`, ordered newest day first,
the journal's line winning over the `MEMORY.md` line of the same day and text (C6b's C27 stays green) (AC 5, Impact
"painéis")
Proof: `npx vitest run tests/rituais.loops.test.ts -t "C8 "`
Proof: `npx vitest run tests/paineis.localday.test.ts -t "C27 "`

**C9** - `keep` lasts the local week: stored at 10:00 of Monday 2026-11-09 (`week: "2026-11-09"`), the loop is absent from
`loops` at 23:59 of Sunday 2026-11-15 local (02:59 of Monday 2026-11-16 in UTC, already the next week there) and listed
again at 00:00 of Monday 2026-11-16 local, with the row still `{ action: "keep", week: "2026-11-09" }`; at the decision
layer, `keep` of week W hides in W and not in W + 7 days (AC 6, door 1)
Proof: `npx vitest run tests/rituais.localday.test.ts -t "C9 "` (the file pins `TZ=America/Sao_Paulo` itself)
Proof: `npx vitest run tests/rituais.layer.test.ts -t "C9 "`

**C10** - `someday` takes the loop out of `loops` and lists it in `someday.loops` with the fields of C1, and it is still there
a week later (now + 7 days); when its journal day has left the window, it is still listed, with the stored `text`,
`sources: []`, `day` = the decision's `week` and `ageDays` from that day (G3) (AC 7, AC 28)
Proof: `npx vitest run tests/rituais.loops.test.ts -t "C10 "`

**C11** - `action: "project"` with no `name` on a loop of 130 characters creates, through `createNote`, a note in
`memory/notes/` whose title is the first 120 characters of the text and whose front matter holds `type: project`, `status:
active`, `natureza: plano` and `last_reviewed: 2026-11-09` (bare), read back from the file; the answer's `created` is
`{ path, version }` with `version` = the SHA-256 of the bytes read back; the row is `{ action: "project", target: <path> }`;
with `name: "Curso de Março"` the title is that name; with `context: "proj-x"` in the body the note is under
`memory/notes/proj-x/` (G4); the history holds one version of the path with origin `create` and author `owner` (AC 8,
Assumptions "Pasta do projeto")
Proof: `npx vitest run tests/rituais.loops.test.ts -t "C11 "`

**C12** - `project` again on a key whose row is already `project` answers `200` with the same `created.path`, and a listing of
every file under `memory/notes/` has one note more than before the first post, not two; a second post with another `name`
gets the same path and renames nothing; two identical posts sent together each answer `200` with one path, and there is one
note and one row (AC 9, Swept concurrency)
Proof: `npx vitest run tests/rituais.loops.test.ts -t "C12 "`

**C13** - `action: "task"` with `project: "<home>/memory/notes/app.md"` (a `type: project` note) and its `baseVersion`
appends `- [ ] Ligar para a Ana` to that note by door 3 (the bytes read back are the old ones plus that line, C27), stores
`{ action: "task", target: <that path> }`, answers `created: { path, version }` with the version of the bytes read back
(G5), and the loop leaves `loops`; a loop text of 340 characters appends its first 300 (G6) (AC 10, door 3)
Proof: `npx vitest run tests/rituais.loops.test.ts -t "C13 "`

**C14** - `restore` puts back the state `previous` names, one asserted case per prior state, each writing no file: after a
`close` on an undecided key (`previous: null`), `restore` with `previous: null` deletes the row and the loop is listed
again; after a `close` on a key whose row was `someday`, `restore` with the `previous` that `close` answered puts the row
back to exactly that `action`, `week`, `target` and `decided_at` (read back) and the loop is in `someday.loops` again;
after a `project`, `restore` deletes the row, the loop is listed again, and the created note is still there byte for byte;
after a `task`, the appended line is still in the note (AC 11, door 2)
Proof: `npx vitest run tests/rituais.loops.test.ts -t "C14 "`
Proof: `npx vitest run tests/rituais.layer.test.ts -t "C14 "`

**C15** - A `key` that is in neither `loops` nor `someday.loops` and has no stored row answers `404 loop_not_found` and stores
nothing, one case each: 64 hex digits of no loop, and the key of a bullet of a non-generated note's `## Open loops`; a key
whose row exists (`closed`, so listed nowhere) is accepted by `restore` and by a repeated `close` (G7) (AC 12)
Proof: `npx vitest run tests/rituais.loops.test.ts -t "C15 "`

**C16** - Each refused body answers `400 validation` alone and stores nothing: `action: "delete"`; no `key`; `name` of 121
characters (120 accepted, C11); `name: ""`; `task` without `project`; `task` without `baseVersion`; `restore` without
`previous`; `restore` with `previous.action: "deleted"` (AC 13)
Proof: `npx vitest run tests/rituais.loops.test.ts -t "C16 "`

**C17** - `task` refusals, each with no row and the target's bytes unchanged: a `type: project` note of an indexed folder
outside `memory/`, `memory/journal/2026-11-09.md`, a `type: status` note and a `type: projects` note (the look-alike value,
L-054) each answer `403 note_not_editable`; a stale `baseVersion` answers `409 edit_conflict` (AC 14)
Proof: `npx vitest run tests/rituais.loops.test.ts -t "C17 "`

**C18** - The same decision twice, one case per action `close`, `keep` and `someday`: one row for the key, both answers with
the same `state`, the second answer's `previous` = the row the first stored, and the row's `decided_at` still the first's
(G8); two `close` posts sent together give one row; a `keep` stored last week and `keep` again this week updates `week` to
`2026-11-09` (AC 15, Swept idempotency and concurrency)
Proof: `npx vitest run tests/rituais.loops.test.ts -t "C18 "`

**C19** - After migration 33, `PRAGMA table_info(loop_decisions)` equals `key TEXT PK`, `text TEXT NOT NULL`, `action TEXT NOT
NULL`, `week TEXT NOT NULL`, `target TEXT`, `decided_at INTEGER NOT NULL`, and `PRAGMA table_info(weekly_reviews)` equals
`week TEXT PK`, `archived INTEGER NOT NULL DEFAULT 0`, `finished_at INTEGER`, `counts TEXT` (`toEqual` over name, type,
notnull, default, pk); an insert with each of `closed`, `keep`, `someday`, `project`, `task` is accepted and one with
`restore` fails with `SQLITE_CONSTRAINT_CHECK`; a second row with the same `key` fails; both tables are empty on a database
migrated from 32 whose rows of `files`, `note_links`, `note_tasks` and `review_state` are the same before and after;
opening it again applies nothing; `MIGRATIONS.at(-1)` is `{ version: 33, name: "rituais" }` (door 1, Impact "stored data")
Proof: `npx vitest run tests/rituais.layer.test.ts -t "C19 "`

### S2 - todo projeto ativo tem próxima ação e prazo de revisão (plan S2, door 3) · 9 files · 120 KB · ~30k

**C20** - Who is in `projects`, one asserted case per row: `type: project` with `status: active`, `status: draft` and no
`status` are listed; `type: Project` is listed (the value compared after `normalizeFieldKey`, as the dashboards, G37);
`status: paused` is not (it is in `someday.projects`, C32), `status: done` is not (it is in `archive`, C34), `status:
archived` is in none of the three; a `status: active` project under `memory/archive/2026-10-01-ab12cd34/` is in none; a
`type: status` note and a `type: projects` note (look-alike, L-054) are not; a project of an indexed folder outside
`memory/` is listed with `editable: false`; each item has exactly the keys `path`, `title`, `status`, `due`, `health`,
`nextAction`, `lastReviewed`, `reviewBy`, `reviewDue`, `editable`, `version` (G20); with exactly one project, `items` has 1
(AC 16, L-050)
Proof: `npx vitest run tests/rituais.projects.test.ts -t "C20 "`
Proof: `npx vitest run tests/rituais.layer.test.ts -t "C20 "`

**C21** - `health` is the dashboards' `projectHealth`, one case per value the review shows: `status: active`, `due:
2026-11-08` → `behind`; `due: 2026-11-09` → `due_today`; `status: draft`, no `due` → `in_review`; `status: active`, no `due`
→ `on_track`; a paused project in `someday.projects` → `paused`; a `status: done` project is not in `projects` but in
`archive`, whose items carry no `health` (`done` routes it there) (AC 16)
Proof: `npx vitest run tests/rituais.projects.test.ts -t "C21 "`

**C22** - `nextAction` is the first unchecked task by line order, at its own layer and through the route: a note with
`- [x] feito` on line 5, `- [ ] Ligar` on line 7 and `- [ ] Depois` on line 9 → `{ line: 7, text: "Ligar" }`; a `- [ ]`
inside a ` ``` ` block on line 3 and one in the front matter are ignored; `- [ ] Enviar 📅 2026-11-20` → `text: "Enviar"`
(as `note_tasks` stores it); only checked tasks → `null`; no task → `null`; the value is the index's (`note_tasks`): a file
changed on disk after its pass answers the stored task (AC 17, door 3)
Proof: `npx vitest run tests/rituais.layer.test.ts -t "C22 "`
Proof: `npx vitest run tests/rituais.projects.test.ts -t "C22 "`

**C23** - `reviewBy` and `reviewDue` at 23:30 of 2026-11-09 local (2026-11-10 in UTC), one case per row: `last_reviewed:
2026-11-02` (exactly 7 days) → `reviewBy: "2026-11-09"`, `reviewDue: true`; `2026-11-03` (6 days) → `"2026-11-10"`,
`false`; a `review_state.last_reviewed` later than the front matter's wins; no `last_reviewed` and an `mtime` at 23:30 of
2026-11-02 local (2026-11-03 in UTC) → due by the `mtime`'s local day; `review_every: 3d` with `last_reviewed:
2026-11-06` → `"2026-11-09"`, `true`, and `2026-11-07` → `false`; `review_every: never` → `reviewBy: null`, `reviewDue: false`;
after `PUT /api/settings` with `memory.weeklyReview.projectEvery` = `"14d"`, the 7-day project answers `reviewBy:
"2026-11-16"`, `reviewDue: false` (AC 18, AC 19, AC 20, door 4, L-057, L-058)
Proof: `npx vitest run tests/rituais.localday.test.ts -t "C23 "` (the file pins `TZ=America/Sao_Paulo` itself)
Proof: `npx vitest run tests/rituais.layer.test.ts -t "C23 "`
Proof: `npx vitest run tests/rituais.projects.test.ts -t "C23 "`

**C24** - The order of `projects`, one case per tie-break: a `reviewDue: true` project with `due: 2026-12-01` comes before a
`reviewDue: false` one with `due: 2026-11-10`; between two of the same `reviewDue`, `due: 2026-11-12` before `due:
2026-11-20`, and any `due` before no `due`; with the same `due`, "Alfa" before "Beta"; with the same title, by `path` (G12)
(AC 21)
Proof: `npx vitest run tests/rituais.layer.test.ts -t "C24 "`
Proof: `npx vitest run tests/rituais.projects.test.ts -t "C24 "`

**C25** - The cut of the other lists: with 51 projects `projects.items` has the first 50 in the order of C24 and `total` 51;
with exactly 50, 50 and 50; `archive` and `inbox` are cut at 50 with their `total` the same way; `someday.loops` and
`someday.projects` with 51 entries each list all 51 (no `total` in the Surface, G27); with `maxItems: 3`, `projects` has 3
(Assumptions "Teto das listas", L-057, L-058)
Proof: `npx vitest run tests/rituais.projects.test.ts -t "C25 "`

**C26** - The server side of "Revisado": after `POST /api/memory/reviews {path, action: "keep", baseVersion}` on a project
with `reviewDue: true`, the next `GET /api/memory/weekly-review` answers it with `reviewDue: false`, `lastReviewed:
"2026-11-09"` and `reviewBy: "2026-11-16"`; the same holds for a project outside `memory/` (no `baseVersion`, stored in
`review_state`) (AC 22, L-051)
Proof: `npx vitest run tests/rituais.projects.test.ts -t "C26 "`

**C27** - `POST /api/memory/tasks {path, text: "Ligar", baseVersion}` on an editable note answers `200 { path, version, task:
{ line, done: false, text: "Ligar" } }` with `version` = the SHA-256 of the bytes read back, and the bytes are the old ones
plus the line, one case per tail of the file, at its own layer and through the route: ending `texto\n` (last line neither
task nor blank) → `texto\n\n- [ ] Ligar\n`; ending `- [ ] a\n` → `- [ ] a\n- [ ] Ligar\n`; ending `texto\n\n` →
`texto\n\n- [ ] Ligar\n`; ending `- [ ] a` with no final newline → `- [ ] a\n- [ ] Ligar\n`; a CRLF file gets the line with
`\r\n` (G36); a text of exactly 300 characters and one of 1 character are accepted; the history holds one version with origin
`task` and author `owner`; with no other open task, the next `GET` gives the project that `nextAction` (AC 23, door 3)
Proof: `npx vitest run tests/rituais.tasks.test.ts -t "C27 "`
Proof: `npx vitest run tests/rituais.layer.test.ts -t "C27 "`

**C28** - `POST /api/memory/tasks` refusals, each alone with the file's bytes unchanged: a note of an indexed folder outside
`memory/`, `memory/journal/2026-11-09.md`, `memory/ROUTER.md`, `memory/areas/vendas.md` and `memory/contexts/x.md` →
`403 note_not_editable`; a path through a link out of the granted folders → `403 forbidden_path`; a stale `baseVersion` →
`409 edit_conflict`; `text: ""`, a text of 301 characters, `"a\nb"` and `"a\rb"` → `400 validation`; a note that does not
exist → `404 note_missing`; a note above the editing limit → `413 note_too_large` (AC 24)
Proof: `npx vitest run tests/rituais.tasks.test.ts -t "C28 "`

**C29** - `PUT /api/memory/tasks` is unchanged by value: its entry `memory.tasks.save` still has `method: "PUT"`, the same
path, `scope: "owner"`, the body keys `path`, `line`, `done`, `baseVersion` and the same errors; the new entry is another id
with `method: "POST"`; C6b's C47 and C50 stay green (Surface, Swept)
Proof: `npx vitest run tests/rituais.contract.test.ts -t "C29 "`
Proof: `npx vitest run tests/paineis.tasks.test.ts -t "C47 "`
Proof: `npx vitest run tests/paineis.tasks.test.ts -t "C50 "`

**C30** - The server side of "Concluído" and "Pausar": after `PUT /api/memory/notes/properties` writes `status: done` on a
listed project, the next `GET` has it in `archive` and not in `projects`; after `status: paused`, in `someday.projects` and
not in `projects` (AC 25, L-051)
Proof: `npx vitest run tests/rituais.projects.test.ts -t "C30 "`

**C31** - The context, for a context whose paths are `<R>/projetos/app` (`ok`): `context=<id>` keeps in `projects`,
`someday.projects` and `archive` only files under `<R>/projetos/app` and `<home>/memory/notes/<id>/`, and never one of
`<R>/projetos/app-antigo/` (the look-alike prefix); `loops` and `inbox` equal (`toEqual`) the answer with no `context`;
`context=all` equals no `context`; `context=nao-existe` answers `400 validation` (G26) (AC 27, Assumptions "Laço com contexto
ativo", Observable)
Proof: `npx vitest run tests/rituais.projects.test.ts -t "C31 "`
Proof: `npx vitest run tests/rituais.layer.test.ts -t "C31 "`

### S3 - algum dia (plan S3) · 2 files · 12 KB · ~3k

**C32** - `someday.projects` lists each `type: project` note with `status: paused` outside `memory/archive/`, with the keys of
C20; a paused one under `memory/archive/` is not listed; after `PUT /api/memory/notes/properties` writes `status: active`
("Reativar"), the next `GET` has it in `projects` and not in `someday.projects` (AC 28, AC 29)
Proof: `npx vitest run tests/rituais.projects.test.ts -t "C32 "`

**C33** - A loop of `someday.loops` (its key not in `loops`) accepts `close`, `project` and `task`, one case each, and after
each it is no longer in `someday.loops` (AC 30)
Proof: `npx vitest run tests/rituais.loops.test.ts -t "C33 "`

### S4 - o que terminou vai para o arquivo (plan S4, door 5) · 7 files · 84 KB · ~21k

**C34** - `archive` lists each `type: project` note with `status: done` outside `memory/archive/`, with exactly `path`,
`title`, `editable` and `doneSince`; `doneSince` is the local day of the `mtime` (an `mtime` at 23:30 of 2026-11-03 local
gives `2026-11-03`); a done project outside `memory/` has `editable: false`; one under `memory/archive/` and a `type: status`
note with `status: done` are not listed (AC 31)
Proof: `npx vitest run tests/rituais.archive.test.ts -t "C34 "`
Proof: `npx vitest run tests/rituais.localday.test.ts -t "C34 "` (the file pins `TZ=America/Sao_Paulo` itself)

**C35** - `inbox` lists each indexed file under `memory/inbox/` at any depth (`memory/inbox/a.md` and
`memory/inbox/sub/b.pdf`) with exactly `path`, `title` and `ageDays`, oldest first; `memory/inboxes/x.md` (the look-alike
folder) is not listed; with one file, `items` has 1 (AC 32, L-050, L-054)
Proof: `npx vitest run tests/rituais.archive.test.ts -t "C35 "`

**C36** - `POST /api/memory/weekly-review/archive {week: "2026-11-09", paths: [<memory/notes/p.md, done>,
<memory/inbox/a.md>]}` answers `200` and moves both to `memory/archive/2026-11-09-<8 hex>/notes/p.md` and
`.../inbox/a.md` with their bytes; `manifest.json` there reads back as `{ v: 1, createdAt: <now>, scope:
"weekly:2026-11-09", entries: [{ from, to, sha256, size }, …] }`; the answer is `{ manifest, moved: [{ from, to }, …],
skipped: [], proposals: null }`; one `cleanup` version is recorded per move; with exactly one path, one move and one entry
(AC 33, door 5, L-050)
Proof: `npx vitest run tests/rituais.archive.test.ts -t "C36 "`

**C37** - A listed path outside `memory/` (a done project of an indexed folder) is neither moved nor written (bytes and
`mtime` unchanged) and is a line of `artifacts/cleanup/2026-11-09-<8 hex>.md`, named in `proposals`; a call with only such
paths answers `manifest: null`, `moved: []` and the proposal file (AC 34, AD-047 a)
Proof: `npx vitest run tests/rituais.archive.test.ts -t "C37 "`

**C38** - Each refused body answers `400 validation` and moves nothing, alone: a path listed in `projects`; one listed in
`someday.projects`; one listed nowhere; one under `memory/archive/`; a listed path together with an unlisted one (nothing of
the call moves); `paths: []`; 101 listed paths (exactly 100 are accepted and moved); the list checked is the one with no
`context` (G31) (AC 35, L-057)
Proof: `npx vitest run tests/rituais.archive.test.ts -t "C38 "`

**C39** - `week` other than the Monday of the current local week answers `409 week_mismatch` and moves nothing: `2026-11-02`,
`2026-11-16` and `2026-11-10` (not a Monday); `week: "2026-W46"` answers `400 validation`; at 23:30 of Sunday 2026-11-15
local (Monday in UTC), `2026-11-09` is accepted and `2026-11-16` answers `409 week_mismatch` (AC 35)
Proof: `npx vitest run tests/rituais.archive.test.ts -t "C39 "`
Proof: `npx vitest run tests/rituais.localday.test.ts -t "C39 "` (the file pins `TZ=America/Sao_Paulo` itself)

**C40** - The skips, one case per reason, each with the other listed file still moved and the manifest naming only the moved
one: a file deleted after the `GET` → `missing`; a destination made to exist (the archive id fixed by a spy on
`crypto.randomBytes` and the file there beforehand) → `exists`; a folder on the way replaced by a link → `forbidden_path`; a
path replaced by a folder after the `GET` → `changed` (G9); origin and destination of a skipped file stay byte for byte
(AC 36, L-049)
Proof: `npx vitest run tests/rituais.archive.test.ts -t "C40 "`

**C41** - `weekly_reviews` read back after the calls: a call that moves 2 makes the row `{ week: "2026-11-09", archived: 2,
finished_at: null }`; a second that moves 1 makes it 3; a call with only skips and proposals leaves 3; the undo of C42 leaves
3 (AC 37, Assumptions "Contador de arquivados", L-051)
Proof: `npx vitest run tests/rituais.archive.test.ts -t "C41 "`

**C42** - `POST /api/memory/cleanup/undo {manifest}` with a weekly manifest answers `200`, both files are back at their paths
with their bytes, the manifest is at `artifacts/cleanup/2026-11-09-<8 hex>.manifest.json`, and the next `GET` lists them
again in `archive` and `inbox`; a partial undo (one archived file changed) moves back the other and skips it as `changed`, and
a second undo after the file is put back moves it (AC 38, L-049)
Proof: `npx vitest run tests/rituais.archive.test.ts -t "C42 "`

**C43** - The mover taken out of `applyCleanup` keeps the cleanup as it was: C5's apply, skip, proposal, undo and partial undo
proofs and C7's history of a move stay green (Impact "faxina")
Proof: `npx vitest run tests/cleanup.apply.test.ts -t "C41 "`
Proof: `npx vitest run tests/cleanup.apply.test.ts -t "C42 "`
Proof: `npx vitest run tests/cleanup.apply.test.ts -t "C43 "`
Proof: `npx vitest run tests/cleanup.apply.test.ts -t "C44 "`
Proof: `npx vitest run tests/cleanup.apply.test.ts -t "C48 "`
Proof: `npx vitest run tests/memoria.history.test.ts -t "C22 "`

**C44** - Two archive calls naming the same listed file, sent together: the file is under `memory/archive/` once, one answer
moved it and the other has it in `skipped` with `missing`, and `archived` grew by 1; the same call again after both answer
`400 validation` (the file is no longer listed) (Swept concurrency)
Proof: `npx vitest run tests/rituais.archive.test.ts -t "C44 "`

### S6 - fechar a semana (plan S6) · 6 files · 46 KB · ~11k

**C45** - At 23:30 of 2026-11-09 local, with three decisions stored this week (`close`, `keep`, `someday`), one stored with
`week: "2026-11-02"` and one stored and restored to none, two projects whose last review day falls in 2026-11-09…2026-11-15
(a `keep` through `POST /api/memory/reviews`, a project created from a loop), one reviewed 2026-11-08, and two files archived,
`POST /api/memory/weekly-review/finish {week: "2026-11-09"}` answers `200 { week, finishedAt: <now>, counts: { loops: 3,
projects: 2, archived: 2 }, journal: { path, line } }`; the row reads back `finished_at` = now and `counts` = that JSON;
`memory/journal/2026-11-09.md` (made when missing) holds under `## Today` the bullet `- 23:30 Revisão semanal de
2026-11-09: 3 laços decididos, 2 projetos revisados, 2 arquivados.` (G10), and `journal.line` is it (AC 51, G28)
Proof: `npx vitest run tests/rituais.finish.test.ts -t "C45 "`
Proof: `npx vitest run tests/rituais.localday.test.ts -t "C45 "` (the file pins `TZ=America/Sao_Paulo` itself)
Proof: `npx vitest run tests/rituais.layer.test.ts -t "C45 "`

**C46** - `finish` again answers `200` with the first `finishedAt` and the stored `counts` (G29), adds no row and no journal
line (the line occurs once in the file); two `finish` posts sent together give one row, one line and the same `finishedAt`;
after the owner deletes the journal line by hand, a third `finish` writes no line (the row is the durable record, L-060)
(AC 52)
Proof: `npx vitest run tests/rituais.finish.test.ts -t "C46 "`

**C47** - `finish` with `week` `2026-11-02` (past Monday), `2026-11-16` (next Monday) or `2026-11-10` answers `409
week_mismatch`, stores no row and leaves the journal's bytes; no `week` and `week: "W46"` answer `400 validation` (AC 53)
Proof: `npx vitest run tests/rituais.finish.test.ts -t "C47 "`

**C48** - The header of `GET /api/memory/weekly-review`, one case per field: `week: "2026-11-09"`; `finishedAt: null`, then
the `finish` time; `counts` = the week so far by C45's rules, then the stored ones (G22); `reviewsDue` = the `total` of
`GET /api/memory/reviews?kind=due` with the same `context` (3 with three due notes); `nextReminder` = the epoch ms of
16:00 of Friday 2026-11-13 local on Monday 2026-11-09, of 16:00 of 2026-11-20 after the week is finished and on Saturday
2026-11-14 with it unfinished (the next one strictly after now, G23), of 23:00 of Sunday 2026-11-15 with `weekday: 0,
hour: 23`, and `null` with `enabled: false` (AC 48, AC 49, door 4)
Proof: `npx vitest run tests/rituais.localday.test.ts -t "C48 "` (the file pins `TZ=America/Sao_Paulo` itself)
Proof: `npx vitest run tests/rituais.finish.test.ts -t "C48 "`

### S7 - o lembrete da semana (plan S7, door 4) · 14 files · 158 KB · ~40k

**C49** - `GET /api/settings` of a fresh home answers `memory.weeklyReview` = `{ projectEvery: "7d", loopsWindowDays: 90,
maxItems: 50 }` and `sentinels.weeklyReview` = `{ enabled: true, weekday: 5, hour: 16 }`, and `memory.reviews.byType` has
no `project` key; each edge through `PUT /api/settings`, accepted and read back or refused with `400 validation` and nothing
stored: `projectEvery` `"1d"`, `"3650d"`, `"never"` accepted, `"0d"`, `"3651d"`, `"semana"` refused; `loopsWindowDays` 7 and
3650 accepted, 6 and 3651 refused; `maxItems` 1 and 200 accepted, 0 and 201 refused; `weekday` 0 and 6 accepted, -1 and 7
refused; `hour` 0 and 23 accepted, -1 and 24 refused; `PUT {memory:{weeklyReview:{maxItems:10}}}` stores `{ projectEvery:
"7d", loopsWindowDays: 90, maxItems: 10 }` and keeps `memory.reviews`, `memory.notes`, `memory.cleanup` at their earlier
values (G30, L-042); the top-level keys are still 30, and the booleans on by default gain `sentinels.weeklyReview.enabled`
(door 4, L-057)
Proof: `npx vitest run tests/rituais.sentinel.test.ts -t "C49 "`
Proof: `npx vitest run tests/data.settings.test.ts -t "C19 "`
Proof: `npx vitest run tests/data.settings.test.ts -t "C63 "`

**C50** - With two open loops and one project due, `SentinelRunner.hourly()` at 15:59 of Friday 2026-11-13 local emits no
`weeklyReview` event, and at 16:00 (19:00 in UTC) emits exactly one `sentinel.fired` whose payload equals `{ sentinel:
"weeklyReview", title, body, severity: "info", href: "/brain/weekly", dedupeKey: "sentinel:weeklyReview:2026-11-09:all",
messageParams: { loops: 2, projects: 1 } }` (`toEqual`, `title` and `body` non-empty texts) (AC 55, AC 56)
Proof: `npx vitest run tests/rituais.localday.test.ts -t "C50 "` (the file pins `TZ=America/Sao_Paulo` itself)
Proof: `npx vitest run tests/rituais.layer.test.ts -t "C50 "`

**C51** - The window of a week, one case each with no earlier pass that week: the first pass at 10:00 of Saturday 2026-11-14
emits one; the first at 23:00 of Sunday 2026-11-15 emits one; the first at 00:30 of Monday 2026-11-16 (the previous week's
Friday never ran) emits none; a pass at 16:00 of Thursday 2026-11-12 emits none (AC 55, AC 57)
Proof: `npx vitest run tests/rituais.localday.test.ts -t "C51 "` (the file pins `TZ=America/Sao_Paulo` itself)

**C52** - Once a week: after the 16:00 pass of 2026-11-13, a pass at 17:00 emits none; after the owner deletes that inbox row,
a pass at 18:00 emits none (the `meta` row `sentinel.weeklyReview.week` = `"2026-11-09"`, G11, not the inbox); the pass at
16:00 of Friday 2026-11-20 emits one with `sentinel:weeklyReview:2026-11-16:all` (AC 58, L-060)
Proof: `npx vitest run tests/rituais.sentinel.test.ts -t "C52 "`

**C53** - No event, one case each: `sentinels.weeklyReview.enabled` = `false` at 16:00 of Friday (no inbox row either, and
`silentRoutine` still emits); the week finished on Thursday 2026-11-12 (`finish` posted) at 16:00 of Friday; and the settings
reach the rule: with `weekday: 0, hour: 23` a pass at 23:00 of Saturday 2026-11-14 emits none and one at 23:00 of Sunday
2026-11-15 emits one; with `weekday: 1, hour: 0` the pass at 00:00 of Monday 2026-11-09 emits one (AC 59, door 4, L-058)
Proof: `npx vitest run tests/rituais.sentinel.test.ts -t "C53 "`
Proof: `npx vitest run tests/rituais.localday.test.ts -t "C53 "` (the file pins `TZ=America/Sao_Paulo` itself)

**C54** - The counts are the totals, not the cut lists: with 60 open loops (`maxItems` 50), one decided and one kept this week
not counted, and 2 projects with `reviewDue` among 55, `messageParams` is `{ loops: 60, projects: 2 }` (G32); the inbox row
the recorder makes has `kind: "system"`, `href: "/brain/weekly"`, `messageKey: "sentinel.weeklyReview"` and those
`messageParams` (AC 55, AC 60)
Proof: `npx vitest run tests/rituais.sentinel.test.ts -t "C54 "`

**C55** - When the count query throws (the test drops `loop_decisions`), `hourly()` resolves, `onError` is called once with
`"weeklyReview"`, no `meta` row is written (so the next pass can still emit), and `reviewDue` and `silentRoutine` of the
same pass still emit their events; C6's `reviewDue` rule answers as before (Observable "scheduled task")
Proof: `npx vitest run tests/rituais.sentinel.test.ts -t "C55 "`
Proof: `npx vitest run tests/natureza.sentinel.test.ts -t "C40 "`

**C56** - The engine's own runner emits it: `ctx.sentinels.hourly()` of the `AppContext` the service builds (not a runner the
test makes) at 16:00 of Friday 2026-11-13 returns a report whose `weeklyReview` holds one payload, and the inbox has one
`sentinel.weeklyReview` row (startup configuration: the `SentinelRunner` the API drives hourly)
Proof: `npx vitest run tests/rituais.sentinel.test.ts -t "C56 "`

**C57** - `SENTINEL_IDS` holds `weeklyReview` (seven ids); the v1 schema of `sentinel.fired` accepts `sentinel:
"weeklyReview"`; the fixture `tests/fixtures/events/v1/sentinel.fired.weeklyReview.json` parses; `EVENT_VERSIONS` of
`sentinel.fired` is still `[1]`; `docs/events.md` equals the text generated with `UPDATE_EVENTS_DOC=1` (door 4)
Proof: `npx vitest run tests/rituais.contract.test.ts -t "C57 "`
Proof: `npx vitest run tests/events.contract.test.ts -t "C27 the v1 fixtures keep parsing"`
Proof: `npx vitest run tests/events.contract.test.ts -t "C29 docs/events.md equals the generated text"`

### S8 - menções sem link (plan S8, doors 6 and 7) · 12 files · 172 KB · ~43k

**C58** - With the target `memory/notes/Curso de Março.md` (title "Curso de Março") and `memory/notes/diario.md` whose line
5 is `o curso de marco atrasou`, `GET /api/memory/mentions?id=<target id>` answers `200 { file, terms: ["Curso de Março"],
items: [{ file: <diario's row>, line: 5, excerpt: "o curso de marco atrasou", term: "Curso de Março", editable: true,
version }], total: 1 }` (G24, G35); a line of 400 characters gives an `excerpt` of at most 160 characters holding the term as
written; a source with the term on lines 5 and 9 gives two items (AC 61, L-050)
Proof: `npx vitest run tests/rituais.mentions.test.ts -t "C58 "`

**C59** - The terms, one case per source, at its own layer and through the route: the `title` ("Curso de Março" of
`cm.md`); the file name with `-` and `_` as spaces (`plano_de-vendas.md` with no title → `"plano de vendas"`); each
`aliases` item (`aliases: [CM 2026, Curso Março]` → both); a term of exactly 4 characters (`Rede`) is kept and one of 3
(`Ana`) dropped; terms that fold equal are one, the first of title, file name, aliases (G35); `terms` answers them in that
order (AC 62, AC 63, L-057)
Proof: `npx vitest run tests/rituais.layer.test.ts -t "C59 "`
Proof: `npx vitest run tests/rituais.mentions.test.ts -t "C59 "`

**C60** - Whole words after the fold, one case per line, for the term `Rede`: `a rede caiu`, `Rede: ok` (start of line, next to
punctuation), `caiu a REDE` (end of line, case) and `(rede)` are listed; `redes`, `parede` and `Redenção` are not; for the
term `Café`: `um cafe` and `CAFÉ!` are listed and `cafeteria` is not (G1) (AC 61, door 6)
Proof: `npx vitest run tests/rituais.layer.test.ts -t "C60 "`
Proof: `npx vitest run tests/rituais.mentions.test.ts -t "C60 "`

**C61** - No item, one case per place: the source's front matter (`title: Rede`); a ` ``` ` block; a `~~~` block; inline code
`` `rede` ``; the text of a Markdown link `[a rede](x.md)`; its URL `[x](https://rede.example/rede)`; a wikilink `[[Rede]]`;
a wikilink alias `[[x|rede]]`; a line `` `rede` e a rede `` is one item (the plain one), and a line holding the two terms
`Rede` and `Café` is one item with `term` = the first that matches (AC 64, Observable "collection menções")
Proof: `npx vitest run tests/rituais.layer.test.ts -t "C61 "`
Proof: `npx vitest run tests/rituais.mentions.test.ts -t "C61 "`

**C62** - A source whose `note_links` row resolves to the target is left out with all its lines, one case per kind: a
wikilink `[[Rede]]` on line 2 and a plain mention on line 8; a Markdown link `[r](../notes/Rede.md)`; a source whose link
does not resolve (`[[Redes]]`, or `[[Rede]]` resolving to another `Rede.md` closer to it) is not left out; the target's own
body mentioning its title is never an item (AC 65)
Proof: `npx vitest run tests/rituais.mentions.test.ts -t "C62 "`

**C63** - Order and limits: items by the source's `mtime`, newest first, then by `path`, then by `line` (G12); with 25
sources and no `limit`, 20 items and `total` 25; `limit=1` → 1; `limit=50` → 25; `limit=0`, `limit=51` and no `id` each
answer `400 validation`; an `id` that names no file answers `404 not_found` (AC 61, L-057)
Proof: `npx vitest run tests/rituais.mentions.test.ts -t "C63 "`

**C64** - The audience differential: with `notes/fin` `hide` for devices, a `content` device's answer equals, by value, the
owner's answer with `<memory>/notes/fin` in `settings.excludes` (the twin, recomputed from scratch in its own world, L-064):
`terms`, `items` and `total`; a source under `notes/fin` is neither an item nor counted, and its text is in no `excerpt`;
a target under `notes/fin` answers `404 not_found`; hiding two more folders that hold no visible item leaves every answer
about the visible target equal, `total` included (L-066); the same comparisons hold at its own layer for the audience
`agents`; a device holding only `monitor` gets `403 scope_required`; a run's credential gets `403 forbidden` (G13); the
owner's answer leaves out a source excluded by `settings.excludes` (AC 66, L-015, L-055)
Proof: `npx vitest run tests/rituais.access.test.ts -t "C64 "`
Proof: `npx vitest run tests/rituais.layer.test.ts -t "C64 "`

**C65** - The context, for a context whose paths are `<R>/projetos/app`: `context=<id>` lists only sources under it and under
`<home>/memory/notes/<id>/`, never one of `<R>/projetos/app-antigo/`; a target outside the context is still answered;
`context=nao-existe` answers `400 validation` (G26) (AC 67, L-054)
Proof: `npx vitest run tests/rituais.mentions.test.ts -t "C65 "`

**C66** - `aliases` is indexed: after a pass, a note with `aliases: [CM 2026]` answers `terms` with `"CM 2026"`; a row
indexed before this feature (its stored fields have no `aliases`) answers without it until the file is indexed again; after
the aliases change in the file and a second pass, the new ones are answered and the old ones are not (G33, L-059); `[[CM
2026]]` in another note is still a broken link (the resolution of `[[...]]` does not change) (Impact "domain", door 6)
Proof: `npx vitest run tests/rituais.mentions.test.ts -t "C66 "`

**C67** - `POST /api/memory/mentions/link {source, line: 5, term: "Curso de Março", target, baseVersion}` on the line `o
curso de marco atrasou, o curso de marco` answers `200 { path, version, link: "[[Curso de Março|curso de marco]]" }` and
the file reads back with line 5 = `o [[Curso de Março|curso de marco]] atrasou, o curso de marco` and every other byte as it
was (the whole file compared); on the line `o curso de março atrasou` (equal after `foldName`) it writes `[[Curso de
Março]]` (G14); `version` is the SHA-256 of the bytes read back; one history version with origin `save` and author `owner`
is recorded (G15), and restoring the one before it gives the old bytes; the next `GET /api/memory/mentions` no longer lists
the source (AC 68, door 7)
Proof: `npx vitest run tests/rituais.mentions.test.ts -t "C67 "`
Proof: `npx vitest run tests/rituais.layer.test.ts -t "C67 "`

**C68** - The first match outside code and links: on `` `curso de marco` e [curso de marco](x.md) e curso de marco `` only the
third is rewritten, and the line reads back as `` `curso de marco` e [curso de marco](x.md) e [[Curso de Março|curso de
marco]] `` (door 7)
Proof: `npx vitest run tests/rituais.layer.test.ts -t "C68 "`
Proof: `npx vitest run tests/rituais.mentions.test.ts -t "C68 "`

**C69** - Refusals, each alone with the file unchanged: the line no longer holds the term, the term now only inside inline
code, and a `line` past the end → `409 mention_gone`; a stale `baseVersion` → `409 edit_conflict`, also when the term is
gone too (G16); a source outside `memory/` and `memory/journal/2026-11-04.md` → `403 note_not_editable`; a source that does
not exist → `404 note_missing`; a `target` id that names no file → `404 not_found` (G16); a source above the editing limit →
`413 note_too_large`; `line: 0` and `term: ""` → `400 validation` (AC 69)
Proof: `npx vitest run tests/rituais.mentions.test.ts -t "C69 "`

**C70** - Two link posts on one source with the same `baseVersion`, sent together: one `200`, one `409 edit_conflict`, and
the file holds one link (Swept concurrency)
Proof: `npx vitest run tests/rituais.mentions.test.ts -t "C70 "`

### Cross-cutting, API · 13 files · 222 KB · ~56k

**C71** - The seven routes are in the `API` table as the Surface and doors 2, 3, 6 and 7 say (`toEqual` over method, path and
scope): `GET /api/memory/weekly-review`, `POST /api/memory/weekly-review/loops`, `POST /api/memory/weekly-review/archive`,
`POST /api/memory/weekly-review/finish`, `POST /api/memory/tasks` and `POST /api/memory/mentions/link` with `owner`, and
`GET /api/memory/mentions` with `content`; each declares exactly the (status, code) pairs of `Coverage`; each is in
`EXPECTED_ROUTE_SCOPES` and has its row in `docs/security.md`; the OpenAPI document validates; the contracts package still
publishes three entry points (doors 2, 6, 7, AD-024)
Proof: `npx vitest run tests/rituais.contract.test.ts -t "C71 "`
Proof: `npx vitest run tests/api.openapi.test.ts -t "C16 the document validates"`
Proof: `npx vitest run tests/device-scopes.test.ts -t "C39 docs list every route"`
Proof: `npx vitest run tests/contracts.test.ts -t "C16 the contracts package publishes exactly three entry points"`

**C72** - The pins move together, each green at its new value: the routes 164 → 171 (`tests/api.contract.test.ts` entries,
router and sets, `tests/api.openapi.test.ts` operations); the refusal probe's scenarios 164 → 171 with one scenario per new
route; the non-public routes 162 → 169 (`tests/device-scopes.test.ts`, the OpenAPI scope check); `EFFECT_ROUTES` stays 23 (no
new response schema has a default, a catch, a preprocess or a transform); every error code a new handler raises
(`loop_not_found`, `week_mismatch`, `mention_gone` and the others of `Coverage`) is documented (Impact "contratos e pinos")
Proof: `npx vitest run tests/api.contract.test.ts -t "C1 every route of the router has an entry"`
Proof: `npx vitest run tests/api.contract.test.ts -t "C12 every route answers what its entry declares"`
Proof: `npx vitest run tests/api.contract.test.ts -t "C13 every error a handler raises is documented"`
Proof: `npx vitest run tests/api.refusals.test.ts -t "C45 the probe runs one scenario for each route"`
Proof: `npx vitest run tests/device-scopes.test.ts -t "C3 the route table is the expected one"`
Proof: `npx vitest run tests/api.openapi.test.ts -t "C15 every route has parameters"`
Proof: `npx vitest run tests/api.openapi.test.ts -t "C21 a real response satisfies the schema of the document"`

**C73** - Who may call, one asserted case per route and per entry point (`/api/...` and its `/api/v1/...` alias): a device
holding every scope gets `403 owner_only` from `GET /api/memory/weekly-review`, `POST /api/memory/weekly-review/loops`,
`POST /api/memory/weekly-review/archive`, `POST /api/memory/weekly-review/finish`, `POST /api/memory/tasks` and
`POST /api/memory/mentions/link`; a run's credential gets `403 forbidden` from those six and from `GET
/api/memory/mentions`; on each refusal a hash of the home and the rows of `loop_decisions`, `weekly_reviews` and `meta` are
the same before and after; `RUN_API_READ_ROUTES` and `RUN_API_WRITE_ROUTES` equal their lists before this feature; no MCP tool
and no CLI command reaches the routes (the MCP tool list and the `mordomo` command list are unchanged by name) (AC 54,
door 2, L-015)
Proof: `npx vitest run tests/rituais.access.test.ts -t "C73 "`

**C74** - The raw `fs` allowlist and the module-state list do not grow: the new modules read the index and the database and
write through `createNote`, `saveNote`, `writeWorkspaceFile`, `appendJournal` and the cleanup mover (Test policy, evidence)
Proof: `npx vitest run tests/security-reads.test.ts -t "C55 the list holds"`
Proof: `npx vitest run tests/security-reads.test.ts -t "finds nothing outside the list"`
Proof: `npx vitest run tests/sdk.instances.test.ts -t "C30 the module-level mutable state"`

**C75** - The migration pins of the earlier features move to 33 and stay green, each naming `rituais` as the last migration
(door 1, Impact "contratos e pinos")
Proof: `npx vitest run tests/data.migration.test.ts -t "C7 MIGRATIONS is contiguous"`
Proof: `npx vitest run tests/data.migration.test.ts -t "C56 "`
Proof: `npx vitest run tests/contexts.runs.test.ts -t "C25 "`
Proof: `npx vitest run tests/device-scopes.test.ts -t "C22 "`
Proof: `npx vitest run tests/memoria.migration.test.ts -t "C39 "`
Proof: `npx vitest run tests/natureza.layer.test.ts -t "C7 "`

### S5 - as telas: Revisão semanal, a dobra de menções, o lembrete (plan S2-S8) · 52 files · 612 KB · ~153k

**C76** - The entries, each with its order asserted: in the moldura's graph, "Revisão semanal" (`.btn.sm`, `CalendarCheck`)
is the `.btn.sm` right after "Revisões (3)" and before the `os-chip`s, and right after "Faxina" when "Revisões" is absent (N = 0) (G17); with the week finished its icon is `Check` and its `title` "Concluída em 12/11" (G18); in the Núcleo's brain scene menu
the row "Revisão semanal" is the last of `bs-menu-acts`, after "Revisões (3)", or after "Faxina" with N = 0 (G17); the
palette's "Revisão semanal" (`global`, `palette: true`) opens `/brain/weekly` in the moldura and the brain's panel at
`/brain/weekly` in the Núcleo; activating a `weeklyReview` inbox row navigates to `/brain/weekly` (AC 39)
Proof: `npm run test -w apps/command-centre -- src/brain/weekly/weeklyEntries.test.tsx -t "C76 "`
Proof: `MORDOMO_E2E_PORT=4901 npx playwright test --config tests/e2e/playwright.config.ts weekly.spec.ts -g "C76 "`

**C77** - The registry holds "Revisão semanal" (`global`, `palette: true`) and, in scope `view:weekly`, `j` and `k` (next and
previous item), `f` ("Fechar" on the selected loop), `m` ("Manter") and `r` ("Revisado" on the selected project); `f`
typed inside the "Próxima ação" field and inside the "Virar projeto" name field does not act and sends no request; the
keyboard-listener reader of `commands.source.test.ts` finds no listener in the screen's files outside the registry
(design.md binding `comandos-atalhos`)
Proof: `npm run test -w apps/command-centre -- src/brain/weekly/weeklyEntries.test.tsx -t "C77 "`
Proof: `npm run test -w apps/command-centre -- src/commands/commands.source.test.ts -t "C77 "`

**C78** - The page, top to bottom: the title "Revisão semanal", on its right "Semana de 9 a 15/11" (and "Semana de 30/11 a
6/12" across a month, G19) and the active context as text; then the step bar with five buttons in the order "Esvaziar",
"Atualizar", "Algum dia", "Arquivar", "Pronto", the current one with `aria-current="step"` and the text "Etapa 1 de 5 ·
Esvaziar"; activating "Arquivar" from step 1 shows "Etapa 4 de 5 · Arquivar" and then "Atualizar" shows "Etapa 2 de 5 ·
Atualizar" (any order, none locked); a step left by "Próxima etapa" shows `Check`; the footer holds "Voltar" then "Próxima
etapa", and "Concluir revisão" in its place on "Pronto"; the `role="status"` region reads "12 laços abertos" (AC 39)
Proof: `npm run test -w apps/command-centre -- src/brain/weekly/WeeklyReview.test.tsx -t "C78 "`

**C79** - Step "Esvaziar", in order: the block "Laços abertos (3)", each item with line 1 the text and line 2 "há 18 dias" and,
with three sources, "em 3 lugares" whose `title` lists the paths (absent with one source), and the actions in the order
"Fechar" (`.btn.primary`, `Check`), "Manter", "Algum dia", "Virar projeto", "Virar tarefa"; "Mostrando 50 de 73" above the
block when `total` > `items.length`, absent at 50 of 50; then "Caixa de entrada (2)" with name, path (mono 12px class), "há
4 dias", "Abrir" and "Arquivar", absent with no inbox file; then, with `reviewsDue` 5, `Bell`, "5 notas para revisar" and the
link "Abrir Revisões" to `/brain/reviews`, absent with 0 (AC 40)
Proof: `npm run test -w apps/command-centre -- src/brain/weekly/WeeklyReview.test.tsx -t "C79 "`

**C80** - "Virar projeto" opens in the item a field holding the loop text, all selected, and "Criar", which sends `POST
/api/memory/weekly-review/loops {key, action: "project", name, context: <the active context>}` (G4); "Virar tarefa" opens the
primitives' `Menu` with the editable projects of step 2 (a project with `editable: false` is not offered), and choosing one
sends `{key, action: "task", project: <its path>, baseVersion: <its version>}` (G20); with no editable project the button is
disabled with the `title` "Nenhum projeto ativo em memory/."; the kit answers only those exact bodies (AC 41, L-052)
Proof: `npm run test -w apps/command-centre -- src/brain/weekly/WeeklyReview.test.tsx -t "C80 "`

**C81** - Step "Atualizar", each project item in order: line 1 the title (13px, weight-600 class) then the health badge, one
case per value, icon and text ("Atrasado", "Vence hoje", "Em revisão", "No prazo"); line 2 "Próxima ação: Ligar" or
`AlertTriangle` with "Sem próxima ação" (`--tone-warn` class), then "revisado há 9 dias" ("nunca revisado" with
`lastReviewed: null`), then, only when `reviewDue`, "revisão vencida" with `CalendarClock`; line 3 the field (placeholder "O que
é o próximo passo concreto?") and "Adicionar", which sends `POST /api/memory/tasks {path, text, baseVersion: <the item's
version>}`; the actions "Revisado", "Concluído", "Pausar", "Abrir" in that order; the items keep the order the route answered
(AC 42, AC 21)
Proof: `npm run test -w apps/command-centre -- src/brain/weekly/WeeklyReview.test.tsx -t "C81 "`

**C82** - A project with `editable: false` has no "Próxima ação" field and only "Revisado" then "Abrir", with `Lock` and "Fora de
memory/: a decisão fica no MordomoOS, o arquivo não muda." above them; its "Revisado" sends `{path, action: "keep"}` with no
`baseVersion` (AC 26)
Proof: `npm run test -w apps/command-centre -- src/brain/weekly/WeeklyReview.test.tsx -t "C82 "`

**C83** - "Revisado" sends `POST /api/memory/reviews {path, action: "keep", baseVersion: <the item's version>}`; on `200` the
item stays, shows "revisado hoje" with `Check` (`--tone-ok` class), and is the last item of the list (AC 22, AC 45)
Proof: `npm run test -w apps/command-centre -- src/brain/weekly/WeeklyReview.test.tsx -t "C83 "`

**C84** - After a saved decision the item leaves and focus goes to the next item, and the notice is on screen at 7 999 ms and
gone at 8 000 ms (fake timers), one case per action with its text and its button: `close` "Fechado." + "Desfazer"; `keep`
"Mantido até segunda." + "Desfazer"; `someday` "Foi para algum dia." + "Desfazer"; "Concluído" "Concluído: App." + "Desfazer";
"Pausar" "Pausado: App." + "Desfazer"; "Reativar" "Reativado: App." + "Desfazer" (G21); `project` "Projeto criado: Ligar
para a Ana." + "Abrir" (no "Desfazer"); `task` "Tarefa adicionada em App." + "Abrir"; a `404 loop_not_found` takes the item
out with "Este laço já tinha decisão." (AC 44)
Proof: `npm run test -w apps/command-centre -- src/brain/weekly/WeeklyReview.test.tsx -t "C84 "`

**C85** - "Desfazer", one asserted case per side: after `close`, `keep` or `someday` it sends `POST
/api/memory/weekly-review/loops {key, action: "restore", previous: <the previous the decision answered>}`; after "Concluído",
"Pausar" or "Reativar" it sends `PUT /api/memory/notes/properties` with `baseVersion` = the version that `PUT` answered and
the earlier `status` (or its removal when it had none); after "Arquivar" of an inbox file it sends `POST
/api/memory/cleanup/undo {manifest}`; the item comes back to its place; the kit answers only the body it expects (AC 44,
L-052)
Proof: `npm run test -w apps/command-centre -- src/brain/weekly/WeeklyReview.test.tsx -t "C85 "`

**C86** - A save answering `409 edit_conflict` ("Adicionar", "Revisado", "Concluído", "Virar tarefa", one case each) keeps the
item where it was with `AlertTriangle`, "A nota mudou desde que a lista foi carregada." and "Recarregar", which asks `GET
/api/memory/weekly-review` again with the same `context`; a save answering `500` shows "Não deu para salvar." and "Tentar de
novo", which sends the same body again (AC 46)
Proof: `npm run test -w apps/command-centre -- src/brain/weekly/WeeklyReview.test.tsx -t "C86 "`

**C87** - The states, one case each: step 1 empty → `CircleCheck` (32px), "Nada solto. Todo laço tem decisão." and "Próxima
etapa"; step 2 empty → `FolderOpen`, "Nenhum projeto ativo." then "Um laço vira projeto na etapa Esvaziar."; step 3 empty →
`CloudMoon` and "Nada em algum dia."; step 4 empty → `Archive` and "Nenhum projeto concluído para arquivar."; while the
list loads, the step bar and a spinner with "Carregando…"; when it fails, `role="alert"` with `AlertTriangle`, "Não deu para
carregar a revisão." and "Tentar de novo", which asks again (AC 47)
Proof: `npm run test -w apps/command-centre -- src/brain/weekly/WeeklyReview.test.tsx -t "C87 "`

**C88** - Step "Algum dia", in order: "Laços para algum dia (2)" with "Fechar", "Virar projeto", "Virar tarefa" and "Manter em
algum dia" (`.btn.ghost`), which sends no request and moves focus to the next item; then "Projetos pausados (1)" with
"Reativar" (`Play`), which sends `PUT /api/memory/notes/properties` with `status: active` and the item's version, and "Abrir"
(AC 28, AC 29)
Proof: `npm run test -w apps/command-centre -- src/brain/weekly/WeeklyReview.test.tsx -t "C88 "`

**C89** - Step "Arquivar", in order: "Vão para memory/archive/ com desfazer. Nada é apagado.", then each done project with a
checkbox (checked), its title, its path (mono 12px class) and "concluído em 3/11", and for one outside `memory/` "vira
proposta" with `Lock` in place of the path; "Arquivar 2"; unchecking one reads "Arquivar 1"; unchecking both reads
"Arquivar 0" and is disabled; "Arquivar 1" sends `POST /api/memory/weekly-review/archive {week: "2026-11-09", paths: [<the
checked one>]}` exactly; the result reads "Arquivados: 1.", and with a skip "Pulados: 1" with the path and the reason, one
case per reason ("mudou", "não existe mais", "o destino já existe", "caminho com link"), "Abrir a lista de propostas" when
`proposals` is set, and "Desfazer", which sends the undo and then reads "Desfeito: 1 arquivos voltaram." (AC 43)
Proof: `npm run test -w apps/command-centre -- src/brain/weekly/WeeklyReview.test.tsx -t "C89 "`

**C90** - Step "Pronto": three numbers (the 20px class) labelled, in order, "laços decididos", "projetos revisados",
"arquivados", read from `counts` (G22); "Ainda sem próxima ação: 2" with `AlertTriangle` when two listed projects have
`nextAction: null`, absent with none; "Concluir revisão" sends `POST /api/memory/weekly-review/finish {week: "2026-11-09"}`
and then shows `CircleCheck`, "Revisão da semana concluída.", the answered `counts` and "Próximo lembrete: sexta, 20/11,
16:00" (from `nextReminder`, G23); with `nextReminder: null`, "Lembrete semanal desligado." with the link "Ligar em
Configurações" (AC 48)
Proof: `npm run test -w apps/command-centre -- src/brain/weekly/WeeklyReview.test.tsx -t "C90 "`

**C91** - With `finishedAt` set (12/11), the page opens on "Etapa 5 de 5 · Pronto" with "Revisão desta semana concluída em
12/11." and the stored numbers, and "Esvaziar" in the step bar still opens step 1 (AC 49)
Proof: `npm run test -w apps/command-centre -- src/brain/weekly/WeeklyReview.test.tsx -t "C91 "`

**C92** - Every `animation` and `transition` of the page's and the fold's stylesheet sits inside `@media
(prefers-reduced-motion: no-preference)` (the reader of `ui/ui.source.test.ts` C15 run on it): an item that leaves folds by
height and `opacity` in 150 ms, a step change slides 12px with `opacity` in 200 ms, the "Pronto" numbers tween in 300 ms;
with motion reduced, the item leaves at once and the numbers show their value at once, and every state has the same text
and icons (AC 44, AC 50, design.md "Movimento")
Proof: `npm run test -w apps/command-centre -- src/brain/weekly/weeklyMotion.test.ts -t "C92 "`

**C93** - The note panel's folds, in order: the links fold (Backlinks and Links quebrados), "Menções sem link (2)",
"Relacionadas", "Nesta nota", "Histórico"; the fold is closed (`aria-expanded="false"`) with N = 0 and open with N > 0; each
item holds, in order, the source's name (13px, weight-600 class), the excerpt with the term in `<mark>` as written, and
"Linkar" (`.btn.sm`, `Link2`) only when `editable`; activating the item opens the source in the notes view at its line;
below, "Procurando: Curso de Março, CM 2026"; "Mostrando 20 de 25" with `total` 25; the request is `GET
/api/memory/mentions?id=<id>&context=<the active context>` and the kit answers only that query (AC 70, L-046, L-052)
Proof: `npm run test -w apps/command-centre -- src/brain/notes/MentionsFold.test.tsx -t "C93 "`

**C94** - The fold's states and "Linkar", one case each: none → "Nenhuma menção sem link."; `terms: []` → only "O nome desta
nota é curto demais para procurar menções."; loading → "Carregando…"; failure → the error and "Tentar de novo", which asks
again; "Linkar" sends `POST /api/memory/mentions/link {source, line, term, target, baseVersion: <the item's version>}` (G24),
then the item leaves and the notice reads "Linkado em diario."; a `409 mention_gone` or `409 edit_conflict` keeps the item
with "A nota mudou; a menção não está mais nessa linha." and "Recarregar" (AC 69, AC 70)
Proof: `npm run test -w apps/command-centre -- src/brain/notes/MentionsFold.test.tsx -t "C94 "`

**C95** - Configurações › Notificações › Sentinelas lists nine rows, and "Revisão semanal" with the hint "Lembra uma vez por
semana, no dia e hora escolhidos, se a revisão ainda não foi feita." sits right after "Revisões vencidas" and right before
"Triagem com modelo" (G25); in en it reads "Weekly review"; its switch sends `PUT /api/settings` with `sentinels` = every
current sentinel and `weeklyReview: { enabled: false, weekday: 5, hour: 16 }` (AC 59, design.md "Lista de sentinelas")
Proof: `npm run test -w apps/command-centre -- src/views/settings/sentinels.test.tsx -t "C95 "`

**C96** - The inbox shows a `sentinel.weeklyReview` row with `messageParams { loops: 3, projects: 2 }` as "Hora da revisão
semanal: 3 laços abertos, 2 projetos para revisar." in pt-BR and "Time for the weekly review: 3 open loops, 2 projects to
review." in en (AC 60)
Proof: `npm run test -w apps/command-centre -- src/hooks/notificationText.test.ts -t "C96 "`

**C97** - Every string of design.md's "Texto" table (41 rows, each string its own key; the journal line is the engine's and
not a key) and the toast of G21 is a key of `en` and `ptBR` in `locales/brain.ts` (the sentinel row's two in
`locales/apps.ts`) with that text, and both locales hold the same keys (design.md "Texto")
Proof: `npm run test -w apps/command-centre -- src/brain/weekly/weeklyCopy.test.ts -t "C97 "`

**C98** - In the light and the dark theme and in the moldura and the Núcleo, the page on each step with a list, step 1
empty, step 5 finished and the note panel with the mention fold open have no text under 12px and prose at 13px, every action
is reached by `Tab` in the order of C79, C81 and C89 and `Enter` activates it, and axe at WCAG A/AA reports no `serious` or
`critical` violation; the repository's stylelint config (tokens only) reports no warning on the new stylesheets, run
programmatically as `typography.test.ts` runs it (AC 50)
Proof: `MORDOMO_E2E_PORT=4901 npx playwright test --config tests/e2e/playwright.config.ts weekly.spec.ts -g "C98 "`
Proof: `npm run test -w apps/command-centre -- src/brain/weekly/weeklyMotion.test.ts -t "C98 "`

**C99** - The component gallery has a weekly-review entry (the step bar, a loop item, a project item, a locked project item,
the archive list, a mention item), and in both themes it has no `serious` or `critical` axe violation
(`design-system/design.md`, "a galeria cobre as duas camadas")
Proof: `MORDOMO_E2E_PORT=4901 npx playwright test --config tests/e2e/playwright.config.ts weekly.spec.ts -g "C99 "`

**C100** - The weekly page is reached from both entries (`main.tsx`, `gallery/main.tsx`) only by a dynamic `import()`;
`scripts/bundle-baseline.json` gains a `cerebro-rituais` entry right after `cerebro-memoria-confiavel` with a reason of more
than 40 characters and the four numbers, at most 16 384 B of JS gzip and 2 048 B of CSS gzip above `cerebro-memoria-confiavel`
(591 435 B and 81 852 B); `bundle:check` exits 0 on a fresh build (Assumptions "Teto de peso", AD-047 h)
Proof: `npx vitest run tests/rituais.contract.test.ts -t "C100 "`
Proof: `npx vitest run tests/bundle-size.test.ts -t "C31 a build within 5% of the latest recorded one passes"`
Proof: `npm run build -w apps/command-centre && npm run bundle:check`

**C101** - In a real browser, both shells: the palette opens "Revisão semanal"; "Fechar" takes a loop out; "Adicionar" gives a
project its next action; "Arquivar 1" moves a done project; "Concluir revisão" ends on "Pronto" with "1", "1" and "1"; in the
notes view, the note "Curso de Março" shows the mention of "o curso de marco atrasou", and "Linkar" writes `[[Curso de
Março|curso de marco]]` and the mention leaves the fold (the plan's independent tests of S1, S2, S4, S5, S6 and S8)
Proof: `MORDOMO_E2E_PORT=4901 npx playwright test --config tests/e2e/playwright.config.ts weekly.spec.ts -g "C101 "`

## Coverage

| Set (size)                                                                          | Member -> proof                                                                                                                                                                                                                                                                                                           | Unproven |
| ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| `GET /api/memory/weekly-review` statuses, as (status, code) (4)                     | 200 C1, C20, C48 · `400 validation` C31 · `403 owner_only` C73 · `403 forbidden` (run) C73                                                                                                                                                                                                                                | -        |
| `POST /api/memory/weekly-review/loops` statuses (7)                                 | 200 C7, C11, C13, C14 · `400 validation` C16 · `403 note_not_editable` C17 · `403 owner_only` C73 · `403 forbidden` C73 · `404 loop_not_found` C15 · `409 edit_conflict` C17                                                                                                                                              | -        |
| `POST /api/memory/weekly-review/archive` statuses (5)                               | 200 C36, C37, C40 · `400 validation` C38, C39 · `403 owner_only` C73 · `403 forbidden` C73 · `409 week_mismatch` C39                                                                                                                                                                                                      | -        |
| `POST /api/memory/weekly-review/finish` statuses (5)                                | 200 C45, C46 · `400 validation` C47 · `403 owner_only` C73 · `403 forbidden` C73 · `409 week_mismatch` C47                                                                                                                                                                                                                | -        |
| `POST /api/memory/tasks` statuses (9)                                               | 200 C27 · `400 validation` C28 · `403 note_not_editable` C28 · `403 forbidden_path` C28 · `403 owner_only` C73 · `403 forbidden` C73 · `404 note_missing` C28 · `409 edit_conflict` C28 · `413 note_too_large` C28                                                                                                        | -        |
| `GET /api/memory/mentions` statuses (5)                                             | 200 C58, C63 · `400 validation` C63, C65 · `403 scope_required` C64 · `403 forbidden` (run, G13, G39) C64, C73 · `404 not_found` C63, C64                                                                                                                                                                                 | -        |
| `POST /api/memory/mentions/link` statuses (10)                                      | 200 C67, C68 · `400 validation` C69 · `403 note_not_editable` C69 · `403 owner_only` C73 · `403 forbidden` C73 · `404 note_missing` C69 · `404 not_found` (target, G16) C69 · `409 edit_conflict` C69, C70 · `409 mention_gone` C69 · `413 note_too_large` C69                                                            | -        |
| doors of Landing (7)                                                                | 1 C4, C7, C9, C18, C19 · 2 C14, C71, C73 · 3 C13, C22, C27 · 4 C23, C49, C50, C53 · 5 C36, C40, C42 · 6 C59, C60, C61, C64, C71 · 7 C67, C68, C69                                                                                                                                                                         | -        |
| slices (8)                                                                          | S1 C1-C19 · S2 C20-C31 · S3 C32, C33 · S4 C34-C44 · S5 C76-C101 · S6 C45-C48 · S7 C49-C57 · S8 C58-C70                                                                                                                                                                                                                    | -        |
| loop actions (6)                                                                    | `close` C7, C33 · `keep` C9 · `someday` C10 · `project` C11, C12 · `task` C13, C17 · `restore` C14                                                                                                                                                                                                                        | -        |
| stored states, the `action` CHECK (5)                                               | `closed` C7, C19 · `keep` C9, C19 · `someday` C10, C19 · `project` C11, C19 · `task` C13, C19                                                                                                                                                                                                                             | -        |
| restore from each prior state (4)                                                   | none C14 · an earlier decision C14 · after `project`, note kept C14 · after `task`, line kept C14                                                                                                                                                                                                                         | -        |
| loop sources (2)                                                                    | journal C1, C2 · `MEMORY.md` C5, C6                                                                                                                                                                                                                                                                                       | -        |
| `MEMORY.md` line kinds (5)                                                          | `(journal …)` C5 · no origin C6 · `→ closed` C6 · origin and `→ closed` C6 · provenance marks C6                                                                                                                                                                                                                          | -        |
| key normalization transforms (5)                                                    | trim C4 · whitespace C4 · case C4 · accents C4 · different text C4                                                                                                                                                                                                                                                        | -        |
| window edges (3)                                                                    | 89 days C2 · 90 days C2 · after today C2                                                                                                                                                                                                                                                                                  | -        |
| `maxItems` edges (3)                                                                | 50 C3, C25 · 51 C3, C25 · option reaches C3, C25                                                                                                                                                                                                                                                                          | -        |
| lists cut by `maxItems` (4)                                                         | `loops` C3 · `projects` C25 · `archive` C25 · `inbox` C25                                                                                                                                                                                                                                                                 | -        |
| `keep` week edges (2)                                                               | Sunday 23:59 C9 · Monday 00:00 C9                                                                                                                                                                                                                                                                                         | -        |
| what the `openLoops` widget counts (6)                                              | `closed` C8 · `project` C8 · `task` C8 · `someday` C8 · `keep` still counted C8 · undecided C7, C8                                                                                                                                                                                                                        | -        |
| project list membership (11)                                                        | `active` C20 · `draft` C20 · no `status` C20 · `type: Project` C20 · `paused` C20, C32 · `done` C20, C34 · `archived` C20 · under `memory/archive/` C20, C32, C34 · `type: status` C20 · `type: projects` C20 · outside `memory/` C20                                                                                     | -        |
| project health values (6)                                                           | `behind` C21, C81 · `due_today` C21, C81 · `in_review` C21, C81 · `on_track` C21, C81 · `paused` C21 · `done` C21                                                                                                                                                                                                         | -        |
| `nextAction` cases (6)                                                              | first unchecked C22 · checked skipped C22 · in a fence C22 · in front matter C22 · only checked C22 · no task C22                                                                                                                                                                                                         | -        |
| `reviewBy` rows (7)                                                                 | 7 days C23 · 6 days C23 · `review_state` later C23 · `mtime` C23 · `review_every: 3d` C23 · `never` C23 · `projectEvery` option C23                                                                                                                                                                                       | -        |
| order tie-breaks (4)                                                                | `reviewDue` C24 · `due` C24 · no `due` last C24 · title then path C24                                                                                                                                                                                                                                                     | -        |
| door 3 tails (5)                                                                    | text line C27 · task line C27 · blank line C27 · no final newline C27 · CRLF C27                                                                                                                                                                                                                                          | -        |
| `POST /api/memory/tasks` text edges (5)                                             | 1 C27 · 300 C27 · 301 C28 · empty C28 · line break C28                                                                                                                                                                                                                                                                    | -        |
| places that are not editable (6)                                                    | outside `memory/` C17, C28, C69 · `journal/` C17, C28, C69 · `ROUTER.md` C28 · `areas/` C28 · `contexts/` C28 · not a project C17                                                                                                                                                                                         | -        |
| archive path checks (7)                                                             | listed in `archive` C36 · listed in `inbox` C36 · in `projects` C38 · in `someday.projects` C38 · listed nowhere C38 · under `memory/archive/` C38 · outside `memory/` C37                                                                                                                                                | -        |
| archive `paths` edges (3)                                                           | empty C38 · 100 C38 · 101 C38                                                                                                                                                                                                                                                                                             | -        |
| skip reasons (4)                                                                    | `changed` C40, C89 · `missing` C40, C44, C89 · `exists` C40, C89 · `forbidden_path` C40, C89                                                                                                                                                                                                                              | -        |
| `week` values (5)                                                                   | current Monday C36, C45 · past Monday C39, C47 · next Monday C39, C47 · not a Monday C39, C47 · not a date C39, C47                                                                                                                                                                                                       | -        |
| finish counts (3)                                                                   | `loops` C45 · `projects` C45 · `archived` C41, C45                                                                                                                                                                                                                                                                        | -        |
| GET header fields (5)                                                               | `week` C48 · `finishedAt` C48 · `counts` C48 · `reviewsDue` C48 · `nextReminder` C48                                                                                                                                                                                                                                      | -        |
| sentinel conditions (10)                                                            | before the hour C50 · at the hour C50 · Saturday C51 · Sunday C51 · new week C51 · second pass C52 · after deletion C52 · disabled C53 · finished week C53 · failure C55                                                                                                                                                  | -        |
| settings keys with bounds (6)                                                       | `projectEvery` C49, C23 · `loopsWindowDays` C49, C2 · `maxItems` C49, C3 · `enabled` C53 · `weekday` C49, C53 · `hour` C49, C50, C53                                                                                                                                                                                      | -        |
| mention term sources (3)                                                            | `title` C59 · file name C59 · `aliases` C59, C66                                                                                                                                                                                                                                                                          | -        |
| mention term length edges (2)                                                       | 4 kept C59 · 3 dropped C59                                                                                                                                                                                                                                                                                                | -        |
| mention exclusion zones (4)                                                         | front matter C61 · fenced block C61 · inline code C61 · inside a link C61                                                                                                                                                                                                                                                 | -        |
| mention exclusion forms (8)                                                         | front matter C61 · ` ``` ` C61 · `~~~` C61 · inline code C61 · link text C61 · URL C61 · wikilink C61 · wikilink alias C61                                                                                                                                                                                                | -        |
| already-linked kinds (4)                                                            | wikilink resolving C62 · Markdown link resolving C62 · unresolved not excluded C62 · self C62                                                                                                                                                                                                                             | -        |
| mention `limit` edges (5)                                                           | default 20 C63 · 1 C63 · 50 C63 · 0 C63 · 51 C63                                                                                                                                                                                                                                                                          | -        |
| link rewrite forms (3)                                                              | `[[name]]` C67 · the alias form (the name, a bar, the term as written) C67 · first valid occurrence C68                                                                                                                                                                                                                   | -        |
| context behaviours (7)                                                              | `projects` C31 · `someday.projects` C31 · `archive` C31 · `loops` unchanged C31 · `inbox` unchanged C31 · mention sources C65 · unknown context C31, C65                                                                                                                                                                  | -        |
| who may call: owner (7)                                                             | weekly-review C1 · loops C7 · archive C36 · finish C45 · tasks C27 · mentions C58 · mentions/link C67                                                                                                                                                                                                                     | -        |
| who may call: paired device (7)                                                     | weekly-review C73 · loops C73 · archive C73 · finish C73 · tasks C73 · mentions (content, filtered) C64 · mentions/link C73                                                                                                                                                                                               | -        |
| who may call: run credential (7)                                                    | weekly-review C73 · loops C73 · archive C73 · finish C73 · tasks C73 · mentions C64, C73 · mentions/link C73                                                                                                                                                                                                              | -        |
| startup config: the settings defaults, migration 33 and the sentinel (3 assemblies) | the service's `AppContext` behind the routes C49, C23 · the `SentinelRunner` the API drives hourly C56 · the test harness `rituaisWorld` C1, C50                                                                                                                                                                          | -        |
| count pins (13)                                                                     | routes 171 C72 · non-public 169 C72 · refusal scenarios C72 · `EFFECT_ROUTES` 23 C72 · raised codes C72 · OpenAPI C71 · migrations 33 C19, C75 · `SENTINEL_IDS` C57 · sentinel rows 9 C95 · booleans on by default C49 · top-level keys 30 C49 · `docs/events.md` C57 · bundle ceiling C100                               | -        |
| existing behaviour kept, by value (7)                                               | cleanup C43 · C6 queue and sentinel C26, C55 · `openLoops` widget C8 · `PUT /api/memory/tasks` C29 · wikilink resolution C66 · backlinks C62 · `memory.reviews` C49                                                                                                                                                       | -        |
| one-item list writers (5)                                                           | `loops` C1 · `projects` C20 · `inbox` C35 · archive move C36 · mentions C58                                                                                                                                                                                                                                               | -        |
| entries to the screen (4)                                                           | moldura button C76 · Núcleo menu row C76 · palette C76, C77 · notification C76, C96                                                                                                                                                                                                                                       | -        |
| steps (5)                                                                           | Esvaziar C78, C79 · Atualizar C78, C81 · Algum dia C78, C88 · Arquivar C78, C89 · Pronto C78, C90, C91                                                                                                                                                                                                                    | -        |
| empty texts per step (4)                                                            | step 1 C87 · step 2 C87 · step 3 C87 · step 4 C87                                                                                                                                                                                                                                                                         | -        |
| screen states (6)                                                                   | list C79 · empty C87 · loading C87 · read error C87 · action error C86 · conflict C86                                                                                                                                                                                                                                     | -        |
| toasts (9)                                                                          | `close` C84 · `keep` C84 · `someday` C84 · Concluído C84 · Pausar C84 · Reativar C84 · `project` C84 · `task` C84 · loop gone C84                                                                                                                                                                                         | -        |
| undo sides (3)                                                                      | loop restore C85 · properties C85 · manifest C85, C89                                                                                                                                                                                                                                                                     | -        |
| arrangements design.md draws (12)                                                   | button after Revisões C76 · last menu row C76 · header then step bar C78 · footer order C78 · step 1 block order C79 · loop actions order C79 · project item lines C81 · project actions order C81 · lock above actions C82 · archive list order C89 · Pronto numbers order C90 · fold between links and Relacionadas C93 | -        |
| mention fold states (6)                                                             | list C93 · empty C94 · short name C94 · loading C94 · error C94 · gone or conflict C94                                                                                                                                                                                                                                    | -        |
| shells (2)                                                                          | moldura C76, C98 · Núcleo C76, C98                                                                                                                                                                                                                                                                                        | -        |
| themes (2)                                                                          | light C98, C99 · dark C98, C99                                                                                                                                                                                                                                                                                            | -        |
| design.md copy (41 rows)                                                            | C97, table-driven over all 41                                                                                                                                                                                                                                                                                             | -        |

- Claims naming a status code, route or response shape: C1, C3, C5, C7-C18, C20-C22, C24-C33, C34-C47, C49, C52-C58
  and C60-C73, each proven through `app.inject` against `buildServer`; C1, C2, C4-C6, C9, C14, C19, C20, C22-C24, C27, C31,
  C45, C50, C59-C61, C64, C67, C68 also or only at their own layer, with no HTTP; C2, C6, C9, C23, C34, C39, C45, C48, C50,
  C51, C53 also in the file that pins `America/Sao_Paulo`
- Claims about the screens: C76-C97 in rendered components; C76, C98, C99, C101 also in a real browser, both shells where
  the claim names them

## Binding sources

| Source                                                                                                                           | Checked by         |
| -------------------------------------------------------------------------------------------------------------------------------- | ------------------ |
| `cerebro-rituais/design.md` (the page, its five steps, states, entries, the fold, the sentinel row, motion, the copy)            | C76-C101           |
| `design-system/design.md` (12px floor, 13px prose, tokens, state never by colour alone, axe, the gallery)                        | C81, C98, C99      |
| `primitivas/design.md` (`Menu` for "Virar tarefa", the toast with an action, motion inside `no-preference`)                      | C80, C84, C92      |
| `comandos-atalhos/design.md` (the registry, `view:weekly` keys, no listener outside it, no bare key in a field)                  | C77                |
| `moldura-app/design.md` (the brain's toolbar, `.btn.sm`, next to "Revisões (N)")                                                 | C76                |
| `cerebro-natureza/design.md` (the leaving item, the 8 s toast with "Desfazer", the conflict, the lock sentence, `role="status"`) | C78, C82, C84, C86 |
| `cerebro-faxina-guiada/design.md` (the step bar and its text, "Desfeito: N arquivos voltaram.")                                  | C78, C89           |
| `cerebro-vista-notas/design.md` (the note panel's `Fold`, its header and density)                                                | C93                |
| `limpeza-legado/design.md` (one Markdown renderer, no unused CSS or key)                                                         | C97                |

## Test policy

| Code                                                                                                                                                                                                                                         | Required proofs                                       | Coverage expectation                                                                                 |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| Decides, reached across a boundary (the loop collector and key, the decision rules, the project filter, `nextAction`, `reviewBy`, the order, the archive check, the finish counts, the sentinel's rule, the terms, the matcher, the rewrite) | one at the HTTP boundary **and** one at its own layer | the contract at the boundary; one asserted case per row of the decision table at its own layer       |
| Decides, not reached across a boundary (migration 33, door 3's tails, the audience filter for `agents`)                                                                                                                                      | one at its own layer                                  | one asserted case per row                                                                            |
| Screens (the weekly page, its entries, the mention fold, the sentinel row, the notification text)                                                                                                                                            | one in rendered components per screen and state       | each state, arrangement and copy design.md names; both themes and both shells for axe in the browser |

Evidence:

- the loop collector (new, beside `generatedSections` of `core/src/dashboards/sources.ts`): two sources, a window with two
  edges, five normalization transforms, five `MEMORY.md` line kinds, the oldest-day rule, the cut -> decides, ~16 branch
  points
- the loop decision rules (new): six actions, the `keep` week, `restore` over two prior states, the listed-or-stored rule
  (G7), the repeat rule (G8), four refusals -> decides, ~18 branch points
- the project list (new): eleven membership rows, six health values from `projectHealth`, `nextAction` over six cases,
  `reviewBy` over seven rows, four tie-breaks, the context -> decides, ~30 branch points
- `appendTask` (door 3): five tails, three text edges -> decides, 8 branch points
- the archive check (new, over the mover taken out of `cleanupApply.ts`): seven path kinds, three `paths` edges, the
  `week` check, four skip reasons -> decides, ~14 branch points; the mover itself is C5's, proven by C5's own tests (C43)
- the finish (new): three counts, the `week` check, the once rule -> decides, 6 branch points
- the sentinel `weeklyReview` (new): enabled, finished, the (weekday, hour) window, the week's end, the `meta` record, the
  failure -> decides, ~8 branch points
- the mentions (new): three term sources, the length rule, the fold, whole words, eight exclusion forms, four already-linked
  kinds, the audience, the order, the limit; the rewrite: first valid match, two link forms -> decides, ~30 branch points
- own layer: `tests/rituais.layer.test.ts` calls those functions with no HTTP, as `tests/natureza.layer.test.ts`,
  `tests/cleanup.layer.test.ts` and `tests/memoria.layer.test.ts` do for the same shape
- closest analogue: `tests/natureza.layer.test.ts` with `tests/natureza.decisions.test.ts` (C6), the same split of a decision
  set proven at the boundary and in the core, and `tests/cleanup.layer.test.ts` with `tests/cleanup.apply.test.ts` (C5) for
  the archive

Cost: about 60 own-layer cases in `tests/rituais.layer.test.ts` and about 15 in `tests/rituais.localday.test.ts`. Without
these rows, the normalization, the eleven membership rows, the four tie-breaks, the eight exclusion forms and the sentinel's
window are proven only by the requests that happen to traverse them.

## Swept

- validation: C16, C28, C38, C39, C47, C49, C63, C69 (each bound with its accepted and refused edge)
- failure modes: C40 (a skip leaves the others moved), C42 (a partial undo), C55 (the sentinel's query fails), C86 and C87 (the screen keeps the item and offers a retry), C94 (a link that went away)
- idempotency: C12 (a second `project` creates nothing), C18 (the same decision twice), C46 (`finish` twice, and after the journal line is deleted), C52 (one reminder a week, after the notification is deleted)
- authorization: C73 (owner only for six routes, through `/api` and `/api/v1`, a run refused), C64 (the device's differential and the `agents` audience), C17, C28, C69 (no write outside what is editable)
- concurrency: C12 (two project creations), C18 (two decisions on one key), C44 (two archives of one path), C46 (two finishes), C70 (two links with one `baseVersion`)
- data lifecycle: C19 (migration 33 over existing rows), C41 (`archived` only grows), C42 (the undo through C5), C66 (aliases reach old rows on the next pass), C10 (a someday loop outlives its window)
- dependency failure: C55 (the database fails in the hourly pass), C40 (the file system changes between the list and the move), C43 (the mover C5 relies on)
- state transitions: C7, C9-C11, C13 (undecided to each state), C14 (a decision restored), C30, C32 (active to done, paused and back), C33 (someday to closed, project, task), C45, C46 (open week to finished)
- observability: C50, C54, C57 (`sentinel.fired` with `weeklyReview` on the bus, its inbox row, `docs/events.md` regenerated), C55 (`onError` names `weeklyReview`), C45 (the journal line)

Existing behaviour this feature must not change, each asserted by value: C5's cleanup (C43), C6's queue and decisions
through `POST /api/memory/reviews` (C26), C6's `reviewDue` sentinel (C55) and `memory.reviews` defaults with no `project` key
(C49), C6b's `openLoops` widget beyond the decided loops (C8), `PUT /api/memory/tasks` (C29), the resolution of `[[...]]`
(C66) and the backlinks a resolving link gives (C62).

## Lacunas do plano

Each is a line for an owner question; the default is what the checks above assert until the owner answers. None blocks the
build. G4, G20, G22 and G24 add a key to a Surface row; G17 and G25 move a pin of `cerebro-natureza` (its C70 "last row" and
its C88 "before the triage row").

| #   | Gap                                                                                                                                                                                                                            | Default (asserted by)                                                                                                                                                                                                                                                |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| G1  | Door 1 and door 6 say `foldName` is "minúsculas, sem acento", and S8's independent test matches "curso de marco" to "Curso de Março"; `foldName` (`core/src/memory/linkParser.ts:57`) is NFC and lower case only, accents kept | the loop key and the mention matcher use `foldName` and then drop combining marks (NFD, strip, NFC); door 7's "igual depois de `foldName`" keeps `foldName` as it is, which is what the independent test's `[[Curso de Março\|curso de marco]]` needs (C4, C60, C67) |
| G2  | `MEMORY.md` lines written by the proposals carry `(fonte:: …) (autor:: agente) (em:: …)`; the plan says nothing of them                                                                                                        | the marks are not part of `text` nor of the key; `em::` is not used as `day` (the Assumption's `mtime` day holds) (C6)                                                                                                                                               |
| G3  | AC 7 and AC 28 keep a `someday` loop listed until another decision, with AC 1's fields, but its journal day can leave the window                                                                                               | listed with the stored `text`, `sources: []`, `day` = the decision's `week` (C10)                                                                                                                                                                                    |
| G4  | AC 8 creates the project in the active context's notes folder, but the loops route's body has no context                                                                                                                       | the body takes an optional `context` (the screen sends the active one); with none, `memory/notes/` (C11, C80)                                                                                                                                                        |
| G5  | The Surface's `created?` is named for `project`; after a `task` the screen needs the project's new version                                                                                                                     | `task` answers `created: { path, version }` of the note written (C13)                                                                                                                                                                                                |
| G6  | A loop text may be longer than door 3's 300 characters                                                                                                                                                                         | the first 300 are appended, as AC 8 cuts a name at 120 (C13)                                                                                                                                                                                                         |
| G7  | AC 12 answers `404` for a key in neither list, but AC 9, AC 11 and AC 15 post again on a key that a decision took out of both                                                                                                  | a key with a stored row is accepted; `404 loop_not_found` only when the key is neither listed nor stored (C15)                                                                                                                                                       |
| G8  | AC 15 asks for one row and the same `state`, not what the second post does to the row                                                                                                                                          | an identical decision leaves the row as it was (the first `decided_at`); `keep` again in a later week updates `week` (C18)                                                                                                                                           |
| G9  | `changed` (a skip reason of the mover) needs a hash the weekly archive does not have: there is no scan                                                                                                                         | the weekly archive moves the file as it is now; `changed` is a path that is no longer a regular file (C40)                                                                                                                                                           |
| G10 | AC 51 gives the journal line's text; `appendJournal` writes `- HH:MM <text>`                                                                                                                                                   | the bullet carries the stamp of now; `journal.line` is the bullet as written (C45)                                                                                                                                                                                   |
| G11 | AC 58 requires no second reminder after the notification is deleted; door 1 has no column for it                                                                                                                               | a `meta` row `sentinel.weeklyReview.week` = the Monday, as `sentinel.proposalsPending.day` (C52)                                                                                                                                                                     |
| G12 | The tie orders of mentions (same `mtime`) and projects (same title) are not given                                                                                                                                              | by `path`, then by `line` (C24, C63)                                                                                                                                                                                                                                 |
| G13 | AC 66 names a run's credential as an audience of the mentions, but door 6 gives the route `GET /api/memory/links`' access, which runs do not have (`RUN_API_READ_ROUTES`)                                                      | a run gets `403 forbidden` and the run lists stay as they are; the `agents` audience is proven at the layer so the route can be added later (C64, C73)                                                                                                               |
| G14 | Door 7's alias form says "nome do arquivo alvo" without saying "sem extensão"; the independent test writes no extension                                                                                                        | both forms use the target's name without extension (C67)                                                                                                                                                                                                             |
| G15 | The history origin of a link written by door 7 is not named                                                                                                                                                                    | `save`, author `owner`, as `saveNote` (C67)                                                                                                                                                                                                                          |
| G16 | `POST /api/memory/mentions/link` with a `target` id that names no file, and with both a stale version and a gone term                                                                                                          | `404 not_found`; `edit_conflict` is checked first (C69)                                                                                                                                                                                                              |
| G17 | design.md puts the moldura's button right after "Revisões (N)", which is absent when N = 0, and the Núcleo's row "abaixo da linha da faxina", where "Revisões (N)" already sits                                                | right after "Revisões (N)", or after "Faxina" when it is absent, in both shells; `cerebro-natureza` C70's "Revisões is the last row" becomes "the row before Revisão semanal" (C76)                                                                                  |
| G18 | design.md's `{day}` in "Concluída em {day}" and "Revisão desta semana concluída em {day}." has no format                                                                                                                       | `d/MM`, as "concluído em 3/11": "12/11" (C76, C91)                                                                                                                                                                                                                   |
| G19 | design.md "Semana de 2 a 8/11" gives one month; a week across two months is not shown                                                                                                                                          | "Semana de 30/11 a 6/12" (C78)                                                                                                                                                                                                                                       |
| G20 | "Revisado", "Concluído", "Pausar", "Reativar", "Adicionar" and "Virar tarefa" send the `baseVersion` the screen read, and AC 46's conflict needs the version of the list; the Surface's project items have no version          | each item of `projects` and `someday.projects` carries `version`, the SHA-256 of the file's bytes when listed (`null` when not editable), as C6's items do (C20, C80, C81, C83)                                                                                      |
| G21 | AC 44 gives "Reativar" a toast with "Desfazer"; design.md's text table has no text for it                                                                                                                                      | "Reativado: {title}." / "Reactivated: {title}." (C84, C97)                                                                                                                                                                                                           |
| G22 | "Pronto" shows the three numbers before and after finishing, and a finished week shows them "como ficaram"; the `GET` has no counts                                                                                            | the `GET` answers `counts`: the week so far by AC 51's rules, the stored ones once finished (C48, C90, C91)                                                                                                                                                          |
| G23 | `nextReminder` is not defined; design.md's example "sexta, 13/11" cannot be the next reminder after finishing on 9/11                                                                                                          | the first (weekday, hour) local instant strictly after now, skipping a finished week; `null` when off; after finishing on 9/11 it reads "sexta, 20/11, 16:00" (C48, C90)                                                                                             |
| G24 | "Linkar" sends `baseVersion`; the Surface's mention items have no version                                                                                                                                                      | each item carries `version`, the SHA-256 of the source's bytes when answered (`null` when not editable) (C58, C94)                                                                                                                                                   |
| G25 | design.md adds the sentinel row right after "Revisões vencidas", where `cerebro-natureza` C88 pins "Triagem com modelo"                                                                                                        | the row sits between them; C88's neighbour becomes "Revisão semanal" (C95)                                                                                                                                                                                           |
| G26 | Observable gives `400 validation` for an unknown `context` on the weekly `GET`; the mentions route has no `404 context_not_found` in the Surface either                                                                        | `400 validation` on both (C31, C65)                                                                                                                                                                                                                                  |
| G27 | "50 itens por lista" for six lists, but only four carry a `total` in the Surface                                                                                                                                               | `loops`, `projects`, `archive`, `inbox` are cut at `maxItems` with `total`; the two `someday` lists are not cut (C25)                                                                                                                                                |
| G28 | AC 51's "projects whose last review day falls in this week" does not say which projects; AC 18's base falls back to the `mtime`                                                                                                | every `type: project` note outside `memory/archive/`, by AC 18's base, `mtime` included (a project edited this week with no `last_reviewed` counts) (C45)                                                                                                            |
| G29 | AC 52 fixes `finishedAt` for a repeated `finish`, not `counts`                                                                                                                                                                 | the stored `counts`, not recomputed (C46)                                                                                                                                                                                                                            |
| G30 | Door 4 does not say how deep `PUT /api/settings` merges `memory.weeklyReview` (L-042)                                                                                                                                          | replaced whole, as `memory.reviews`: an omitted key takes its default; the rest of `memory` is kept (C49)                                                                                                                                                            |
| G31 | AC 35 checks paths against "the current list", and the archive's body has no `context`                                                                                                                                         | the list with no `context` (the whole brain) (C38)                                                                                                                                                                                                                   |
| G32 | AC 55's counts could be read from the cut lists                                                                                                                                                                                | the totals: `loops.total` and every project with `reviewDue`; a device reads the inbox row as it reads `reviewDue`'s (C54)                                                                                                                                           |
| G33 | The Impact says the indexed notes gain `aliases` "quando forem reindexadas" and cites `backfillNoteLinks`                                                                                                                      | no backfill marker: a note gains its aliases when its file is indexed again (C66)                                                                                                                                                                                    |
| G34 | design.md's health badge lists four texts; `projectHealth` has six values                                                                                                                                                      | `paused` and `done` take the project to "Algum dia" and "Arquivar" and are never a badge of step 2 (C21, C81)                                                                                                                                                        |
| G35 | AC 61's `term` could be the term or the text as written, and two sources of terms can fold equal                                                                                                                               | `term` is the matched entry of `terms`; terms that fold equal are one, the first of title, file name, aliases (C58, C59)                                                                                                                                             |
| G36 | Door 3 does not say how a file with no final newline or with CRLF line ends gets the line                                                                                                                                      | a newline is added first when missing; the line uses the file's own line break (C27)                                                                                                                                                                                 |
| G37 | AC 16 says `type: project` without saying how the value is compared                                                                                                                                                            | after `normalizeFieldKey`, as the dashboards' `projectsSource` (C20)                                                                                                                                                                                                 |
| G38 | design.md's primitives row names a `Checkbox` primitive; `apps/command-centre/src/ui/` has none                                                                                                                                | a native `<input type="checkbox">` with its label (C89)                                                                                                                                                                                                              |
| G39 | The Surface gives `GET /api/memory/mentions` no `403`, but a device without `content` and a run are refused                                                                                                                    | `403 scope_required` and `403 forbidden`, as every `content` route (C64)                                                                                                                                                                                             |

## Handoff

The estimate exceeds the 150k budget. Mechanism chosen by the owner on 10/11/2026: **handoff, five batches A, B, C, D, E** (the cut below), sequential, each only on green.

- Arithmetic (`wc -c` of the files each slice touches at the head of `claude/beautiful-volta-6xmhok`, / 4; new files
  estimated; a file read again in a later slice is counted again):
  - S1: the new loop and decision module ≈ 20 000, `core/src/dashboards/sources.ts` 26 590, `core/src/memory/reviews.ts`
    10 991, `core/src/memory/linkParser.ts` 4 531, `core/src/memory/journal.ts` 12 763, `core/src/memory/proposals.ts`
    ≈ 6 000 of 46 793 (`→ closed`, `memoryLine`), `core/src/memory/notes.ts` 24 972, `core/src/memory/tasks.ts` 3 290,
    `core/src/db/migrations.ts` 28 434, `contracts/src/api/memory.ts` ≈ 20 000 of 71 118 (read in parts),
    `apps/api/src/routes/reviews.ts` 2 775 (the model), the new route file ≈ 8 000, `core/src/memory/contexts.ts` 16 131 =
    ≈ 184 KB → ≈ 46k
  - S2: the module again ≈ 20 000, `sources.ts` ≈ 6 000 (`projectHealth`), `notes.ts` 24 972 (`saveTask`, the new
    `appendTask`), `tasks.ts` 3 290, `core/src/memory/frontMatter.ts` 18 790, `contexts.ts` 16 131, the contract ≈ 10 000,
    the routes ≈ 8 000, `tests/paineis.tasks.test.ts` 12 625 (the model) = ≈ 120 KB → ≈ 30k
  - S3: the module ≈ 8 000, the contract ≈ 4 000 = ≈ 12 KB → ≈ 3k
  - S4: `core/src/memory/cleanupApply.ts` 19 473, `apps/api/src/routes/cleanup.ts` 4 296, `core/src/memory/history.ts` 9 971,
    `core/src/memory/historyStore.ts` 9 577, the module ≈ 8 000, the routes ≈ 6 000, `tests/cleanup.apply.test.ts` 27 032 =
    ≈ 84 KB → ≈ 21k
  - S6: `journal.ts` 12 763, the module ≈ 6 000, the routes ≈ 4 000, `apps/api/src/server.ts` ≈ 12 000 of 45 631,
    `tests/helpers/memoriaWorld.ts` 6 303, `tests/helpers/notesViewWorld.ts` 4 837 = ≈ 46 KB → ≈ 11k
  - S7: `core/src/sentinels/runner.ts` 8 378, `reviewDue.ts` 2 059, `proposalsPending.ts` 1 954, `meta.ts` 777, `types.ts`
    2 004, `core/src/engine.ts` ≈ 6 000 of 32 271, `contracts/src/settings.ts` 27 350, `contracts/src/events.ts` 8 290,
    `contracts/src/eventSchemas.ts` 9 351, `contracts/src/eventRegistry.ts` 5 697, `docs/events.md` 16 425,
    `core/src/notifications/recorder.ts` 10 065, `tests/natureza.sentinel.test.ts` 12 116, `tests/data.settings.test.ts`
    47 775 = ≈ 158 KB → ≈ 40k
  - S8: `core/src/memory/links.ts` 10 172, `linkParser.ts` 4 531, `core/src/memory/indexer.ts` ≈ 15 000 of 57 428,
    `frontMatter.ts` 18 790, `core/src/memory/audienceIndex.ts` 10 094, `core/src/memory/folderAccess.ts` 9 502,
    `core/src/memory/excludes.ts` 13 099, `notes.ts` 24 972, the new mentions module ≈ 14 000, the contract ≈ 6 000, the
    routes ≈ 5 000, `tests/memoria.access.test.ts` 40 553 (the twin's model) = ≈ 172 KB → ≈ 43k
  - cross-cutting, API (C71-C75): `tests/helpers/routeScopes.ts` 10 065, `tests/helpers/contractWorld.ts` 45 413,
    `tests/api.refusals.test.ts` 28 703, `tests/api.contract.test.ts` ≈ 15 000 of 58 613, `tests/api.openapi.test.ts` 32 065,
    `tests/device-scopes.test.ts` ≈ 15 000 of 87 644, `docs/security.md` ≈ 15 000 of 86 455, `contracts/src/api/errors.ts`
    10 532, `tests/data.migration.test.ts` ≈ 5 000, `tests/security-reads.test.ts` ≈ 10 000 of 111 618,
    `tests/sdk.instances.test.ts` 25 526, `server.ts` ≈ 10 000 = ≈ 222 KB → ≈ 56k
  - S5, the weekly page (C76-C92): `locales/brain.ts` 45 013, `commands/registry.ts` 12 630, `commands/global.ts` 13 636,
    `brain/BrainChrome.tsx` 11 278, `nucleo/scenes/BrainSceneMenu.tsx` 10 732, `nucleo/scenes/BrainScene.tsx` ≈ 15 000 of
    71 805, `views/SecondBrain.tsx` 30 625, `App.tsx` ≈ 6 000 of 17 232, `brain/BrainViewSwitch.tsx` 4 715,
    `brain/natureza.tsx` 6 874, `brain/cleanup/CleanupWizard.tsx` 16 517 (the step bar), `brain/reviews/ReviewsScreen.tsx`
    25 594 (the model), `ui/ui.css` 14 347, `ui/Menu.tsx` 4 818, `queries.ts` 9 064, `desktop/useTweenNumber.ts` ≈ 1 500, the
    new page and its stylesheet ≈ 45 000, `commands/commands.source.test.ts` 39 738 = ≈ 323 KB → ≈ 81k
  - S5, the fold, the sentinel row, the copy and the browser (C93-C101): `locales/brain.ts` 45 013 again, `locales/apps.ts`
    32 781, `brain/notes/NotePanel.tsx` 5 010, `brain/notes/notesData.ts` 3 845, `brain/notes/NotesView.tsx` 13 061,
    `brain/LinksSection.tsx` 3 240, `hooks/notificationText.ts` 7 480, `hooks/useNotifications.ts` ≈ 8 000 of 20 991,
    `views/settings/notifications.tsx` 16 790, the fold ≈ 10 000, `gallery/main.tsx` 29 687, `tests/e2e/a11y.spec.ts`
    17 550, `tests/e2e/shell.ts` 11 753, `tests/e2e/reviews.spec.ts` 16 469 (the model), `tests/bundle-size.test.ts` 10 659,
    `scripts/bundle-baseline.json` 7 103 = ≈ 238 KB → ≈ 60k (S5 in all ≈ 612 KB → ≈ 153k, 52 files)
  - slices alone ≈ 46k + 30k + 3k + 21k + 11k + 40k + 43k + 56k + 153k = ≈ 403k; the new tests (eleven root files and the
    world ≈ 286 KB, four weekly UI files and the fold's ≈ 110 KB with the kits read, `brain/cleanup/testkit.tsx` 8 502 and
    `brain/notes/testnet.ts` 14 591, and `tests/e2e/weekly.spec.ts` ≈ 25 KB: ≈ 444 KB) add ≈ 111k: ≈ 514k in all, over 150k
- Proposed cut, at the surface boundaries (batches sequential, each only on green):
  - **A** (the loops, the projects and someday, core and API, migration 33): S1 + S2 + S3 ≈ 46k + 30k + 3k = ≈ 79k, plus
    `tests/rituais.loops.test.ts`, `tests/rituais.projects.test.ts`, `tests/rituais.tasks.test.ts`, the world and the S1-S3
    half of the layer and local-day files ≈ 115 KB → ≈ 29k = ≈ 108k; C1-C33
  - **B** (the archive, the finish and the reminder, core and API): S4 + S6 + S7 ≈ 21k + 11k + 40k = ≈ 72k, plus
    `tests/rituais.archive.test.ts`, `tests/rituais.finish.test.ts`, `tests/rituais.sentinel.test.ts` and their part of the
    layer and local-day files ≈ 76 KB → ≈ 19k = ≈ 91k; C34-C57
  - **C** (the mentions and the API's cross-cutting checks): S8 + C71-C75 ≈ 43k + 56k = ≈ 99k, plus
    `tests/rituais.mentions.test.ts`, `tests/rituais.access.test.ts`, `tests/rituais.contract.test.ts` and the rest of the
    layer file ≈ 80 KB → ≈ 20k = ≈ 119k; C58-C75 (C73 and C71 need every route, so they close after S8)
  - **D** (the weekly page and its entries): ≈ 81k, plus `WeeklyReview.test.tsx`, `weeklyEntries.test.tsx`,
    `weeklyMotion.test.ts`, the kits and `reviewsEntries.test.tsx` (the model) ≈ 90 KB → ≈ 23k = ≈ 104k; C76-C92
  - **E** (the mention fold, the sentinel row, the notification, the copy, the browser and the weight): ≈ 60k, plus
    `MentionsFold.test.tsx`, `weeklyCopy.test.ts`, `sentinels.test.tsx`, `notificationText.test.ts`,
    `tests/e2e/weekly.spec.ts` and the C100 part of `tests/rituais.contract.test.ts` ≈ 79 KB → ≈ 20k = ≈ 80k; C93-C101
  - B + C ≈ 210k and D + E ≈ 184k are over the budget, so each batch stays apart; A lands first because B's finish counts
    read A's decisions and C's mentions share A's world, C asserts the routes of A, B and C, and D and E call them
- Mechanism: handoff — chosen by the owner on 10/11/2026 (five batches, sequential, only on green; the next builder reads `checks.md` and the diff of what landed)

Status of batch A (updated in the commit that closes each piece):

- the loops (S1: C1-C19), the projects (S2: C20-C31) and someday (S3: C32, C33), with migration 33, the three routes
  `GET /api/memory/weekly-review`, `POST /api/memory/weekly-review/loops` and `POST /api/memory/tasks`, and
  `settings.memory.weeklyReview`: closed, every proof green in `tests/rituais.loops.test.ts`,
  `tests/rituais.projects.test.ts`, `tests/rituais.tasks.test.ts`, `tests/rituais.localday.test.ts`,
  `tests/rituais.layer.test.ts` and `tests/rituais.contract.test.ts` (C29), and in `tests/paineis.localday.test.ts`
  C27 and `tests/paineis.tasks.test.ts` C47 and C50

- **Boundary (batch A):** C1-C33 closed at `aa20017` (code and pins in `cf6f1f0`, proofs and this status in `aa20017`).
  On that tree `npm run typecheck` and `npm run lint` exit 0, every `Proof:` line of C1-C33 passes and runs only its
  check's tests, and `npx vitest run` at the root has one failure, `tests/paineis.refresh.test.ts` C13 (the `execucoes`
  widget answers `empty`), which fails the same way on the untouched base `376013b` (a date-dependent proof, not this
  batch). What batch A already moved, so that B and C add on top: routes 164 → 167 (`api.contract`, `contracts.api`,
  `api.openapi`, the refusal and event scenarios), non-public 162 → 165 and `owner` 86 → 89 (`device-scopes` with its
  chained amendments in `sdk.api-thin` C29, `docs/security.md`, `paineis.contract` C60, `memoria.contract` C82), raised
  codes 86 → 87 (`404 loop_not_found`), migrations 32 → 33 (`rituais`, in every migration pin), the settings leaves
  `memory.weeklyReview.*` (`data.settings` C46, the `settings.changed` v1 fixture) and `appendTask`, `decideLoop`,
  `weeklyReview` in the internal barrel (`sdk.surface` C38). Not built: the `GET`'s `counts` and `nextReminder` (C48,
  batch B adds them to the response schema), `settings.sentinels.weeklyReview`, the archive and finish routes; the
  `GET` already answers `week`, `finishedAt` (read from `weekly_reviews`), `archive` (exactly `path`, `title`,
  `editable`, `doneSince`), `inbox` and `reviewsDue`.
- **Settled mid-build:** nothing by the owner. Builder decisions inside the approved shape, none a new one-way door:
  (a) the core is `core/src/memory/loops.ts` (the collector, the key, `sectionBullets` extracted from the dashboards'
  `sectionItems` and shared by both, the decisions) and `core/src/memory/weeklyReview.ts` (the list); the routes are
  `apps/api/src/routes/weeklyReview.ts` and `memory.tasks.add` in `routes/memory.ts`; `Flow` hop 1 now says so; (b) the
  route ids are `memory.weeklyReview.list`, `memory.weeklyReview.loops` and `memory.tasks.add`; (c) `previous` and
  `restore` carry `{ action, week, target, decidedAt }`, `state` is the stored action or null; (d) the journal's agent
  mark `(autor:: agente)` is stripped like G2's marks, so a loop an agent wrote keys as the owner's; (e) `keep` again in
  a later week rewrites `week` and `decided_at`; an identical decision rewrites nothing (G8); (f) a `project` note is
  made by `createNote` with a new optional `properties` input (bare `key: value` lines after `title`), in the folder
  `memory/notes/<context id>` through `folder`; a project note gone since is made again; (g) a `task` whose project is
  missing answers `403 note_not_editable` (the route's codes have no `note_missing`), and `appendTask` maps a folder
  where the note was to `404 note_missing` (`POST /api/memory/tasks` declares no `not_a_file`); (h) an unknown `context`
  is `400 validation` on both the `GET` and the loops `POST`; (i) `archive` is ordered by `doneSince` then path and
  `inbox` by `mtime` then path; (j) the `API` table's type is now written as the intersection of its parts
  (`contracts/src/api/index.ts`), because three more entries made the inferred type too long for a declaration file
  (TS7056); (k) a review state with `never` stops a project's `reviewBy` as it stops C6's queue; (l) proof readings:
  C2's and C23's layer side change the option in the store, the route side through `PUT /api/settings`; C7's
  `decided_at` is asserted under a frozen `Date`; C23's "review_state later" case seeds the row (its writer is C26's).
- **Abandoned:** reading the loops through the dashboards' `generatedSections` (it reads only the current week);
  recording a `project` note's properties with a second write (two history versions where C11 asks for one).

Status of batch B (updated in the commit that closes each piece):

- the archive of the week (S4: C34-C44), the finish (S6: C45-C48) and the weekly reminder (S7: C49-C57), with the routes
  `POST /api/memory/weekly-review/archive` and `POST /api/memory/weekly-review/finish`, the `GET`'s `counts` and
  `nextReminder`, `settings.sentinels.weeklyReview` and the sentinel `weeklyReview`: closed, every proof green in
  `tests/rituais.archive.test.ts`, `tests/rituais.finish.test.ts`, `tests/rituais.sentinel.test.ts`,
  `tests/rituais.localday.test.ts`, `tests/rituais.layer.test.ts` and `tests/rituais.contract.test.ts` (C57), and in
  `tests/cleanup.apply.test.ts` C41-C44 and C48, `tests/memoria.history.test.ts` C22 (C43), `tests/data.settings.test.ts`
  C19 and C63 (C49), `tests/natureza.sentinel.test.ts` C40 (C55) and `tests/events.contract.test.ts` C27 and C29 (C57)

- **Boundary (batch B):** C34-C57 closed at `d85b165` (the mover taken out in `188e539`, the archive, the finish, the
  `GET`'s `counts` and `nextReminder`, `settings.sentinels.weeklyReview` and their pins in `06600c7`, the sentinel in
  `0184151`, proofs and the status in `d85b165`). On that tree `npm run typecheck` and `npm run lint` exit 0, every
  `Proof:` line of C34-C57 passes and runs only its check's tests, and `npx vitest run` at the root has one failure,
  `tests/paineis.refresh.test.ts` C13, the same pre-existing one batch A named. What batch B moved, so that C adds on top:
  routes 167 → 169 (`api.contract`, `contracts.api`, `api.openapi` with its checked answers 165 → 167, the refusal and
  event scenarios in `contractWorld`), non-public 165 → 167 and `owner` 89 → 91 (`device-scopes` with its chained
  amendments in `sdk.api-thin` C29, `docs/security.md`, `paineis.contract` C60, `memoria.contract` C82, `routeScopes`),
  raised codes 87 → 88 (`409 week_mismatch`), `SENTINEL_IDS` 6 → 7 and the v1 `sentinel.fired` enum (`docs/events.md`
  regenerated, fixture `sentinel.fired.weeklyReview.json`), the default-on booleans and `CLOSED_WHEN_DROPPED` gain
  `sentinels.weeklyReview.enabled` (`data.settings` C19, C63, C46 with `weekday` and `hour`, `failClosed.ts`, the
  `settings.changed` v1 fixture), and `archiveWeek`, `finishWeek` in the internal barrel (`sdk.surface` C38). Not built:
  the desktop sentinel row and the notification text (batch E); `OS_EVENT_TYPES` unchanged (29).
- **Settled mid-build:** nothing by the owner. Builder decisions inside the approved shape, none a new one-way door:
  (a) the mover is `moveToArchive(deps, files, { now, scope, heading, extra })` in `cleanupApply.ts`, which now takes the
  restore lock itself; `applyCleanup` reads its decisions and calls it with the same scope and heading; (b) the archive
  and the finish are `archiveWeek` and `finishWeek` in `weeklyReview.ts` (with `weekCounts`, `nextReminder`,
  `reminderIn`, `reminderCounts`), the list is built from one uncut `reviewLists` and fills `version` only for the items
  it answers; route ids `memory.weeklyReview.archive` and `memory.weeklyReview.finish`; (c) the archive checks the week
  (`409`) before the paths (`400`), de-duplicates `paths`, checks them against the uncut lists (so 100 inbox files pass
  with `maxItems` 50), writes its proposal lines as `- [ ] <path> — arquivar — projeto concluído|caixa de entrada` under
  `# Revisão semanal: propostas de <day>` and `Escopo: weekly:<week>`, records a history version per move as the cleanup,
  and waits up to 2 s for the index of what moved after the synchronous part (so the next `GET` no longer lists it);
  (d) `finish` writes the journal before the row, builds the bullet with the stamp of `now` itself (`appendJournal`
  stamps with `new Date()`, so it is called with `timestamp: false`), and a repeat answers `journal` with the finish day's
  path and the bullet rebuilt from the stored time and counts; the refusal probe found that a hostile journal answers
  `403 forbidden_path`, `404 not_a_file` and `413 file_too_large`, so the finish route declares them; (e) `weekCounts`
  counts every `type: project` note outside `memory/archive/` whatever its `status` (G28); the reminder's `projects` is
  the `projects` list with `reviewDue` (G32); (f) the sentinel lives in `core/src/sentinels/weeklyReview.ts`, emits even
  with zero counts, carries no `count`, title "Time for the weekly review" and body "N open loops, M projects to review."
  (English like `reviewDue`; the screens' text is batch E), and `HourlyReport` gains `weeklyReview`; (g) `nextReminder`
  is this week's instant when unfinished and later than now, else next week's; (h) proof readings: C45's "one stored and
  restored to none" is the `project` decision whose note stays (otherwise the project made from a loop would be a fourth
  decision this week); C55 drops `loop_decisions` and makes it again from migration 33's SQL; C49's fresh home deletes the
  two keys from `settings.json`; "now" is asserted between the instants around the call under the moving clock; `PUT
/api/settings` replaces `sentinels` whole (existing behaviour), so the proofs and the screen send the whole object.
- **Abandoned:** deciding the sentinel's window through `nextReminder(now - 1)` (wrong once the hour has passed);
  `vi.restoreAllMocks()` in the archive proofs (it also restores the world's clock).
