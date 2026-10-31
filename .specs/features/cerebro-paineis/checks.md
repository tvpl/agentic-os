# Painéis checks

Profile: ui
Plan: `.specs/features/cerebro-paineis/plan.md`
Design: `.specs/features/cerebro-paineis/design.md` (binding for the screens)

97 checks in 5 slices + 2 cross-cutting groups · 7 one-way doors (door 1's `source` and `options` keys completed by
amendment 5; door 6 gains `problems[]` on the list, amendment 11) · 3 open questions of the plan (1 `blocks go-live`, 2 and 3
`open`), all three in their defaults (the snapshot stores connector titles and `legal/PRIVACY.md` says so; reminders on, 3 a
day from 08:30, no shared cap with the reviews' daily reminder; Today gains only the link), and 7 new ones (plan.md,
"Emendas", questions 4-10), none blocking · 28 amendments for what `cerebro-correcoes`, `cerebro-contextos`,
`cerebro-organizar`, `cerebro-vista-notas`, `cerebro-faxina-guiada` and `cerebro-natureza` built after the plan and for what
this derivation found (`plan.md`, "Emendas depois da aprovação"; each names the checks that resolve it).

The plan's slices mix the core, the API and the screens; here S1-S4 are the core and the API of plan S1, S2, S3, S5 and S6,
and S5 is every screen of plan S4, S5 and S6, so a batch cut never splits a check slice.

Every proof is `npx vitest run <file> -t "<C-id> "` from the repository root (root tests) or
`npm run test -w apps/command-centre -- <file> -t "<C-id> "` (UI tests); a test title starts with its check id followed by a
space. `E2E` proofs build the CLI and the interface first and then run
`MORDOMO_E2E_PORT=4901 npx playwright test --config tests/e2e/playwright.config.ts <spec> -g "<C-id> "`: the e2e server runs
`apps/api/dist/cli.js` and serves the built interface, so a proof without the build runs yesterday's code (L-056); the same
holds for `bundle:check`, which weighs `apps/command-centre/dist`. `tests/paineis.layer.test.ts` calls the deciding code itself
(the definition validator, the task parser, the evaluator with a source map, each source's rule, the KPI maths, the
highlight and reminder rules, the scheduling and `stale` maths, the question result validator, the export renderer) with no
HTTP (`Test policy` rows 1 and 2); the other root files go through `app.inject` against `buildServer` over a real home.
"Now" in every claim is a fixed clock the test sets; "today" is its local day as `sentinelDay` writes it. Every claim that
names a local day, a local week or a local time is proven in a file that pins `process.env.TZ = "America/Sao_Paulo"` at its
top and asserts the pin holds (AD-043 b, L-053): `tests/paineis.localday.test.ts` and
`apps/command-centre/src/dashboards/dashboardsTime.test.tsx`; the claim about the local hour of a series point is proven in
`tests/paineis.localhour.test.ts`, which pins `Asia/Kolkata` (UTC+05:30), where the local hour and the UTC hour start at
different instants. A claim that names a status and a code asserts both. A claim that says "as before" asserts the value by
name (L-044); a claim about a stored value reads back what the route wrote, never a row the test seeded (L-051); every list
writer has a one-item case (L-050); every UI mock answers by the query it receives and fails on a query it was not given
(L-052); a claim about where something sits on screen asserts the order of the elements (L-046).

## Checks

### S1 - definição, avaliação e snapshot (plan S1) · 17 files · 217 KB · ~54k

**C1** - On a home with no dashboard, `POST /api/dashboards` with `{ "template": "overview" }` answers `201` with `id:
"visao-geral"`, `definition` and `version` matching `^sha256:[0-9a-f]{64}$`; the file `memory/dashboards/visao-geral.json`
exists, its bytes hash to that `version`, and its parsed content equals `definition`: `v: 1`, `kind: "overview"`, `refresh:
"15m"`, `title: "Visão geral"`, no `contextId`, and the ten widgets in this order by `kind` and `title`: `kpi` "Prioridades de
hoje" (`tasks` `today`, `measure: "done_of_due"`, `chip: "remaining"`), `kpi` "Decisões da semana" (`decisions` `week`,
`count`, `chip: "open"`), `kpi` "Projetos no prazo" (`projects`, `on_track_of_active`, `chip: "behind"`), `kpi` "Revisões
vencidas" (`reviews`, `count`, `upIsGood: false`), `kpi` "Execuções em 24 h" (`metrics` `runs24h`, `latest`), `checklist`
"Prioridades de hoje" (`tasks` `today`, `m`), `list` "Decisões da semana" (`decisions` `week`, `m`), `list` "Em andamento"
(`projects`, `health` without `done` and `paused`, `m`), `list` "Agentes agora" (`runs`, `m`), `agenda` "Agenda de hoje"
(`connector` `calendar-google` `list`, `l`) (AC 1, amendments 5, 6)
Proof: `npx vitest run tests/paineis.routes.test.ts -t "C1 "`

**C2** - `POST /api/dashboards` with `template: "area"` and no `contextId` answers `400 validation` with an issue at
`contextId`; with `contextId: "projeto-x"` of an existing context named "Projeto X" it answers `201` with `id:
"contexto-projeto-x"`, `kind: "area"`, `contextId: "projeto-x"`, `title: "Projeto X"`, `refresh: "15m"` and eight widgets in
this order: `kpi` "Tarefas abertas" (`tasks` `week`, `open`), `kpi` "Decisões da semana", `kpi` "Notas atualizadas na
semana" (`notes`, `changed: "week"`, `count`), `kpi` "Revisões vencidas", `checklist` "Próximas tarefas" (`tasks` `week`),
`bars` "Notas por status" (`notes`, `groupBy: "status"`), `list` "Mudou nesta semana" (`notes`, `changed: "week"`), `list`
"Decisões abertas" (`decisions`, `state: "open"`), and no `connector` widget; with `contextId: "nao-existe"` it answers `404
context_not_found` and the listing of `memory/dashboards/` is the same before and after; `contextId` with `template:
"overview"` is `400 validation` (AC 2, amendment 6)
Proof: `npx vitest run tests/paineis.routes.test.ts -t "C2 "`

**C3** - `POST /api/dashboards` with `template: "question"`: no `question`, `question: "   "` and a `question` of 501
characters after trimming each answer `400 validation` with an issue at `question` and write nothing; `question: "  Por que o
onboarding demora?  "` answers `201` with `id: "pergunta"`, `refresh: "manual"`, `question` and `title` both `"Por que o
onboarding demora?"`; a question of exactly 500 characters is accepted; no `template` is `400 validation` (AC 3, amendment 6)
Proof: `npx vitest run tests/paineis.routes.test.ts -t "C3 "`

**C4** - With only `visao-geral.json` present, a second `POST` with `template: "overview"` answers `201` with `id:
"visao-geral-2"` (one existing file); with `visao-geral.json` and `visao-geral-2.json` to `visao-geral-99.json` present it
answers `409 dashboard_exists` and the listing of `memory/dashboards/` is unchanged; a file in
`memory/archive/dashboards/` named `visao-geral-2026-10-30.json` does not count (AC 4)
Proof: `npx vitest run tests/paineis.routes.test.ts -t "C4 "`

**C5** - The definition validator refuses, each case for its own reason alone (every other field valid, L-039), at the
route (`PUT /api/dashboards/:id` answers `400 validation` with an issue whose `path` names the field, and the file's bytes and
`mtime` are unchanged) and at its own layer: an unknown top-level key; an unknown widget key; 13 widgets; a widget `kind`
`pie`; a source `kind` `files`; `refresh` `30m`, `daily@24:00` and `daily@7:30`; a definition of 65 537 bytes; two widgets
with one `id`; a `question` dashboard with `refresh: "15m"`; a `notes` source with the key `owner`; a `tasks` source with
`window: "month"`; `options.limit` 51 and 0; `options.measure: "done_of_due"` on a `notes` source; a `metrics` source with
`series: "costToday"`; a `connector` source with `key` and `read: "list"`; `title` of 121 characters; and accepts exactly
12 widgets, `daily@00:00`, `daily@23:59`, `options.limit` 50 and a definition of exactly 65 536 bytes (AC 5, door 1,
amendments 5, 9, 12)
Proof: `npx vitest run tests/paineis.routes.test.ts -t "C5 "`
Proof: `npx vitest run tests/paineis.layer.test.ts -t "C5 "`

**C6** - `PUT /api/dashboards/visao-geral` with the `version` the `POST` answered and a definition whose second widget has
another `title` answers `200` with a `version` that is the hash of the file's new bytes (read back from disk) and a
`definition` equal to what `GET /api/dashboards/visao-geral` then answers; a second `PUT` with the first `version` answers
`409 edit_conflict` and the file's bytes and `mtime` are those of the first `PUT`; `PUT /api/dashboards/nao-existe` answers
`404 dashboard_not_found` and creates no file (AC 6, Surface)
Proof: `npx vitest run tests/paineis.routes.test.ts -t "C6 "`

**C7** - On a home with two indexed notes holding tasks due today and a fake `calendar-google` read returning two events,
`POST /api/dashboards/visao-geral/refresh` answers `200` with a `snapshot` whose keys are exactly `v`, `dashboardId`,
`generatedAt`, `sources`, `widgets` (`v: 1`, `dashboardId: "visao-geral"`, `generatedAt` = the clock), one `widgets[]` entry
per widget of the definition in its order with `status: "ok"` and `data`, and one `sources[]` entry per distinct source
with `status: "ok"`; `GET /api/dashboards/visao-geral` then answers that same snapshot (`toEqual`, read back, L-051); the
bus carried exactly one `dashboard.refreshed` with `v: 1` and payload `{ id: "visao-geral", generatedAt, status: "ok" }`
(AC 7, door 4)
Proof: `npx vitest run tests/paineis.refresh.test.ts -t "C7 "`

**C8** - A failing source marks only its widgets, one case per kind of failure (L-049): (a) the `calendar-google` read
rejects after `dataTimeoutMs` → the `agenda` widget is `{ status: "error", error: <the message> }`, the source
`connector:calendar-google` is `status: "error"` with that `message`, every other widget is `ok` with the same `data` as the
refresh before, and `dashboard.refreshed` carries `status: "partial"`; (b) at the evaluator's layer, a `reviews` source that
throws → only the "Revisões vencidas" widget is `error`; (c) every source throws → every widget `error` and the event
`status: "error"`; in all three a snapshot is stored and read back (AC 8)
Proof: `npx vitest run tests/paineis.refresh.test.ts -t "C8 "`
Proof: `npx vitest run tests/paineis.layer.test.ts -t "C8 "`

**C9** - While a refresh of `visao-geral` waits on a connector read held open by the test, a second `POST
/api/dashboards/visao-geral/refresh` answers `409 refresh_in_progress` and stores nothing, a refresh of
`contexto-projeto-x` at the same time answers `200`, and after the first settles a third refresh of `visao-geral` answers
`200`; a refresh that failed releases the lock too; `POST /api/dashboards/nao-existe/refresh` answers `404
dashboard_not_found` (AC 9)
Proof: `npx vitest run tests/paineis.refresh.test.ts -t "C9 "`

**C10** - The scheduling rule, one asserted case per row, at its own layer: `15m` with the last snapshot 14 min 59 s old →
not due, 15 min → due; `1h` at 59 min → not, 60 min → due; `6h` at 5 h 59 min → not, 6 h → due; `manual` 30 days old →
never; a `question` dashboard whose file says `15m` → never; no snapshot → due (every kind but `manual` and `question`);
and in the pinned zone `daily@08:30`: at 08:29 local → not, at 08:30 → due, at 09:10 with a snapshot of 08:31 the same local
day → not, at 08:30 of the next local day → due; the service's tick, driven by the test's clock, refreshes `visao-geral`
whose snapshot is 16 min old and leaves a `manual` and a `question` dashboard untouched (their `generatedAt` read back is
unchanged); an engine that is built and never started runs no tick (AC 10, AD-004, amendment 12)
Proof: `npx vitest run tests/paineis.layer.test.ts -t "C10 "`
Proof: `npx vitest run tests/paineis.localday.test.ts -t "C10 "`
Proof: `npx vitest run tests/paineis.refresh.test.ts -t "C10 "`

**C11** - `GET /api/dashboards/visao-geral` with a `15m` snapshot 20 min old answers `200` with that snapshot (its
`generatedAt` unchanged) and `stale: true`, and afterwards (the test awaits the bus) a new snapshot with the clock's
`generatedAt` is stored and read back; the same `GET` on a `manual` dashboard and on a `question` dashboard stores no new
snapshot; a `GET` while that refresh still runs starts no second one (one `dashboard.refreshed`) (AC 10, amendments 12, 13)
Proof: `npx vitest run tests/paineis.refresh.test.ts -t "C11 "`

**C12** - `GET /api/dashboards/:id` evaluates no source (the evaluator's source map and the connector fetch are spied and
called 0 times) and answers `definition`, `version`, `snapshot` and `highlights`; `stale`, one case per row: `15m` at
exactly 15 min → `false`, 15 min + 1 ms → `true`; `1h` at 60 min + 1 ms → `true`; `6h` at 6 h → `false`; `daily@08:30` at 48 h
→ `false`, 48 h + 1 ms → `true`; `manual` at 30 days → `false`; no snapshot → `snapshot: null` and `stale: false`;
`GET /api/dashboards/nao-existe` answers `404 dashboard_not_found` (AC 11, amendment 13)
Proof: `npx vitest run tests/paineis.routes.test.ts -t "C12 "`

**C13** - For `contexto-projeto-x`, whose context has the `ok` path `/w/proj` and the notes folder
`memory/notes/projeto-x/`: a note in `/w/proj`, one in `memory/notes/projeto-x/` and one in `/w/proj-old` (a look-alike
prefix, L-054) — each a project, a decision note, holding a task due today and an open fact source — show the first two
and never the third in every memory source (`notes`, `tasks`, `decisions`, `projects`, `reviews`, `facts`, and the counts of
their KPIs); after the context is deleted from `settings.contexts`, a refresh answers `200` and every widget of a memory
source is `error` with "O contexto deste painel não existe mais." while a `metrics` widget of the same dashboard stays `ok`
(AC 12, amendment 4)
Proof: `npx vitest run tests/paineis.refresh.test.ts -t "C13 "`

**C14** - After a folder holding a project note with a task due today is added to `settings.excludes` (the row still in
`files`), a refresh of `visao-geral` shows that note and its task in no widget's `data`, no KPI counts it, no highlight and
no reminder names it (every path an item arrives by, L-055); during the refresh the read audit of `tests/fsReadAudit.ts`
records no read of any file under the home or the indexed folders (door 2: the index and the routes' data only) (AC 13,
door 2, amendment 4)
Proof: `npx vitest run tests/paineis.refresh.test.ts -t "C14 "`

**C15** - In the pinned zone at 2026-10-30 23:30 local (02:30 UTC the next day), `DELETE /api/dashboards/visao-geral`
answers `200` with `archived` ending in `memory/archive/dashboards/visao-geral-2026-10-30.json`, that file holds the
dashboard's bytes, `memory/dashboards/visao-geral.json` is gone, `GET /api/dashboards/visao-geral` answers `404
dashboard_not_found`, and `SELECT COUNT(*)` over `dashboard_snapshots` and `dashboard_series` for `visao-geral` is 0 (rows
the refreshes wrote, read back before the delete as 1 and 3); a recreated `visao-geral` deleted the same local day goes to
`visao-geral-2026-10-30-2.json`; `DELETE /api/dashboards/nao-existe` answers `404 dashboard_not_found` (AC 14, amendment 21)
Proof: `npx vitest run tests/paineis.localday.test.ts -t "C15 "`

**C16** - `GET /api/dashboards` answers `200` with `dashboards[]`, each with exactly `id`, `title`, `kind`, `contextId`,
`refresh`, `generatedAt`, `stale`, ordered by kind (`overview`, `area`, `question`), then title, then `id`: with one
dashboard, a one-element list; with `pergunta`, `contexto-b` ("B"), `contexto-a` ("A") and `visao-geral` the order is
`visao-geral`, `contexto-a`, `contexto-b`, `pergunta`; a hand-edited `memory/dashboards/quebrado.json` with an unknown key is
not in `dashboards[]`, is in `problems[]` as `{ id: "quebrado", message }` with a non-empty message, `GET
/api/dashboards/quebrado` answers `404 dashboard_not_found`, and the service's tick never refreshes it (amendments 11, 13)
Proof: `npx vitest run tests/paineis.routes.test.ts -t "C16 "`

**C17** - At the evaluator's layer, with a source map that has no `reviews` entry, the "Revisões vencidas" widget is `{
status: "error" }` with the text "Esta fonte ainda não existe nesta versão.", the source `reviews` is `status:
"unavailable"`, and every other widget is evaluated (`ok`); with the full map, no source of the eleven is `unavailable`
(AC 25, amendment 11)
Proof: `npx vitest run tests/paineis.layer.test.ts -t "C17 "`

**C18** - `EVENT_VERSIONS["dashboard.refreshed"]` is `[1]`; its v1 schema accepts `{ id, generatedAt, status }` with `status`
`ok`, `partial` and `error` and refuses `status: "done"` and a missing `id`; `tests/fixtures/events/v1/dashboard.refreshed.json`
validates; `docs/events.md` regenerated lists `dashboard.refreshed`; the 28 types that existed keep `[1]` each (`toEqual`
over the whole map, as before by value) (AC 7, AC 56, door 6)
Proof: `npx vitest run tests/paineis.contract.test.ts -t "C18 "`

### S2 - tarefas no índice e as fontes (plan S2) · 14 files · 240 KB · ~60k

**C19** - After migration 26, `PRAGMA table_info` of `note_tasks` equals `src_id INTEGER NOT NULL`, `line INTEGER NOT NULL`,
`done INTEGER NOT NULL`, `text TEXT NOT NULL`, `due TEXT`, `priority INTEGER NOT NULL DEFAULT 0` with the primary key `(src_id,
line)`; `PRAGMA index_info(idx_note_tasks_due)` is `done`, `due`; `dashboard_snapshots` is `dashboard_id TEXT PK`,
`generated_at INTEGER NOT NULL`, `json TEXT NOT NULL`; `dashboard_series` is `dashboard_id TEXT NOT NULL`, `widget_id TEXT NOT
NULL`, `at INTEGER NOT NULL`, `value REAL NOT NULL` with the primary key `(dashboard_id, widget_id, at)` (`toEqual` over name,
type, notnull, default, pk); running the migrations again leaves the same schema; migrations 22 to 25 are still
`drop-file-links`, `run-context`, `cleanup` and `natureza`; the rows of `files`, `note_links`, `note_passages` and
`review_state` of a database migrated from 25 are the same before and after (AC 16, doors 3 and 4, amendment 1)
Proof: `npx vitest run tests/paineis.layer.test.ts -t "C19 "`

**C20** - A Markdown note whose line 4 is `- [ ] Mandar a proposta 📅 2026-10-30 ⏫` has the `note_tasks` row `{ line: 4,
done: 0, due: "2026-10-30", priority: 2, text: "Mandar a proposta" }`; and, one asserted case per form: `- [ ] Ligar
[due:: 2026-10-30]` → `due: "2026-10-30"`, text "Ligar"; `* [x] Feito` → `done: 1`; `- [X] Feito` → `done: 1`; `- [ ] Revisar
🔼` → `priority: 1`; no marker → `priority: 0`, `due: null`; `    - [ ] Sub` (indented) → a task; a text of 320 characters →
300; `- [ ] Data ruim 📅 2026-02-30` → `due: null` and text "Data ruim 📅 2026-02-30" (AC 15, door 3, amendment 3)
Proof: `npx vitest run tests/paineis.index.test.ts -t "C20 "`
Proof: `npx vitest run tests/paineis.layer.test.ts -t "C20 "`

**C21** - No task is stored, one asserted case per form: `- [ ] x` inside a ` ``` ` fence, inside a `~~~` fence, inside the
front matter, `- [] x`, `-[ ] x`, `- [ ]` with nothing after it, `+ [ ] x`, `1. [ ] x`, and `- [ ] x` in a `.txt` file of an
indexed folder (door 3, amendment 3)
Proof: `npx vitest run tests/paineis.layer.test.ts -t "C21 "`

**C22** - The task writer, with one item and with several: a note with one task has 1 row; with three tasks on lines 2, 5
and 9 it has 3 rows in line order; after the file is changed to hold none and indexed again it has 0 rows; after a file
with two tasks is deleted and the pass runs, no row has its old `src_id` (the rows go with the file) (door 3, Relations,
L-050)
Proof: `npx vitest run tests/paineis.index.test.ts -t "C22 "`

**C23** - On a database migrated to 26 with 3 Markdown files indexed before it (no `note_tasks` row, no `index.note_tasks`
marker, `fields` without `due`): the next pass fills the tasks of the 2 that hold tasks from the stored text without opening
them (the read audit of `tests/fsReadAudit.ts` and a spy on `readWorkspaceText` see no read of those paths), writes the
marker, and adds `due: "2026-11-02"` to the `fields` of the project note whose header holds `due: 2026-11-02`, every other key
of its `fields` equal by value to before; a second pass leaves the same rows (`toEqual`); a pass stopped after the first
slice (no marker) is done again by the next and ends with the same rows (AC 16, amendments 1, 2)
Proof: `npx vitest run tests/paineis.index.test.ts -t "C23 "`

**C24** - `FRONT_MATTER_FIELDS` equals `type`, `status`, `updated`, `last_reviewed`, `natureza`, `escopo`, `review_every`,
`abandoned`, `due` in this order (the eight of before, as before by value, then `due`); a note with `due: 2026-11-02` has
`fields.due: "2026-11-02"`; with also a body line `due:: 2026-11-03` it has `"2026-11-03"`; a `due` of 65 characters is
left out of `fields` (amendment 2)
Proof: `npx vitest run tests/paineis.index.test.ts -t "C24 "`

**C25** - In the pinned zone with today 2026-10-30, a `tasks` source with `window: "today"` returns exactly the open tasks
due 2026-10-30 and the open tasks due before it, overdue first, then priority descending, then `due` ascending, then path
and line, each with `path`, `line`, `fileId`, `due`, `overdue` (`true` only for the overdue), `title` (the note's) and
`natureza`; a done task due today, an open task with no due and one due 2026-10-31 are not in it; with one matching task the
list has one item; `window: "week"` adds the open tasks due 2026-10-31 to 2026-11-05 and leaves out 2026-11-06; at 23:30
local on 2026-10-30 (02:30 UTC on the 31st) a task due 2026-10-30 is still `overdue: false` (AC 17, amendment 5)
Proof: `npx vitest run tests/paineis.localday.test.ts -t "C25 "`

**C26** - In the pinned zone on Friday 2026-10-30 (the week is Monday 2026-10-26 to Sunday 2026-11-01), a `decisions`
source with `window: "week"` returns: the `## Decisions` bullets of `memory/journal/2026-10-26.md` and `2026-10-30.md`, read
from the stored text (the read audit sees no read of them); not the bullets of `2026-10-25.md`; the `## Decisions` lines of
`memory/MEMORY.md` whose origin is `(journal 2026-10-28)`, not one with `(journal 2026-10-20)`; a `MEMORY.md` line and a
journal bullet of 2026-10-30 with the same text once; the notes with `type: decision`; and not a `### Decisions` bullet of
the journal, nor a `## Decisions` bullet of a note that is not a generated file (L-054). `state`, one asserted case per
nature of a decision note: `fato` → `decided`, `relato` → `decided`, none → `decided`, `plano` → `open`, `hipotese` → `open`,
`opiniao` → `open`; a journal bullet inside a `> [!plano]` passage → `open`; `state: "open"` keeps only the open ones (AC 18,
amendment 7, question 5)
Proof: `npx vitest run tests/paineis.localday.test.ts -t "C26 "`

**C27** - In the same week, an `openLoops` source returns the `## Open loops` bullets of the week's journal days and the
`MEMORY.md` lines with an origin in the week, each with `natureza: "plano"`, and not the bullets of `2026-10-25.md` nor a
`## Open loops` section of a note that is not generated (amendments 7, 8)
Proof: `npx vitest run tests/paineis.localday.test.ts -t "C27 "`

**C28** - In the pinned zone with today 2026-10-30, a `projects` source returns the notes with `type: project` and `health`,
one asserted case per row and per precedence: `status: done` → `done`; `status: paused` → `paused`; `status: active`,
`due: 2026-10-29` → `behind`; `due: 2026-10-30` → `due_today`; `status: draft`, no `due` → `in_review`; `status: active`,
`due: 2026-10-31` → `on_track`; `status: active`, no `due` → `on_track`; `status: draft`, `due: 2026-10-29` → `behind`;
`status: done`, `due: 2026-10-29` → `done`; `due: 2026-13-01` → read as no `due`; `type: Project` and `status: DONE` (compared
after `normalizeFieldKey`) → a project, `done`; `status: archived` → not returned; `health: ["behind"]` keeps only `behind`
(AC 19, amendment 2)
Proof: `npx vitest run tests/paineis.localday.test.ts -t "C28 "`
Proof: `npx vitest run tests/paineis.layer.test.ts -t "C28 "`

**C29** - A `notes` source returns only the matching notes, one asserted case per filter: `type: ["decision"]`, `status:
["draft"]`, `tags: ["cliente"]`, `natureza: ["plano"]`, `escopo: ["equipe"]`, `folder: "<memory>/notes/a"` (and not
`<memory>/notes/a-b`, L-054), the dashboard's context, and `changed: "week"`; up to `limit` (default 8, with 9 matches 8 are
returned and `total` is 9; `limit: 50`), ordered by `updated` descending, then `mtime` descending, then path; with one match a
one-item list; `groupBy: "status"` returns `bars` categories in the order `active`, `draft`, `paused`, `done`, `archived`,
then other values alphabetically, then the notes with no status, each with its count (AC 20, amendment 5)
Proof: `npx vitest run tests/paineis.sources.test.ts -t "C29 "`

**C30** - A `runs` source returns the `running` and `queued` runs first, then the runs that finished in the last 24 hours
newest first, each with `skill`, `state` and `durationMs`, and not a run that finished 24 h + 1 min ago; an `approvals` source
returns the `pending` approvals oldest first with `ageMs` (`now - createdAt`), and not a resolved one (AC 21, amendment 8)
Proof: `npx vitest run tests/paineis.sources.test.ts -t "C30 "`

**C31** - A `metrics` source, table-driven over the six names `runs24h`, `failed24h`, `costTodayUsd`, `tokensToday`,
`inboxUnread`, `approvalsPending`, returns as `value` the field of the newest hourly sample and as `points` the 14 days of
`dailyPoints` for that field (with two samples on one day, 0.40 and 0.25 of `costTodayUsd` give that day 0.40, and 7 and 5 of
`runs24h` give 5, the day's last); with no sample the widget is `empty` (AC 22, amendment 9)
Proof: `npx vitest run tests/paineis.sources.test.ts -t "C31 "`

**C32** - A `connector` source of a connector with a read mapping returns, through `fetchConnectorData` called with
`timeoutMs` = `settings.connectors.dataTimeoutMs`, `allowedCommands` and `tz` from the settings, its `list` items (`id`,
`title`, `subtitle`, `ts`, `flagged`, `href`) up to the widget's `limit` (with 12 items and `limit: 8`, the snapshot read
back holds 8); `read: "flagged"` keeps only `flagged: true`; `read: "summary"` with `key: "unread"` returns the number; a
connector with no mapping is `not_configured` with its `name` and its `setup` lines (`toEqual` the connector file's); an id
the registry does not have is `not_configured` with `name` = the id (AC 23, amendment 10)
Proof: `npx vitest run tests/paineis.sources.test.ts -t "C32 "`

**C33** - The connector cache is one per service: `GET /api/connectors/calendar-google/data` followed, within the TTL, by a
refresh the service's tick starts calls the fake fetch once; `POST /api/dashboards/visao-geral/refresh` then calls it again
(the button passes over the cache); a read that answered `error` is not cached (the next tick calls again); the route and the
evaluator are handed the same `ConnectorDataCache` instance in `buildServer` and in the service's start (one assembly)
(amendment 10)
Proof: `npx vitest run tests/paineis.sources.test.ts -t "C33 "`

**C34** - The `reviews` source is C6's queue: with `reviewsDue` replaced by a stub that returns one item `{ path: "/x/stub.md"
}` and `total: 7`, the widget's items are that item and the KPI `value` is 7 (L-017); with the real queue and the setting
`memory.reviews.cadence` 90 days, a note last reviewed 91 days ago is an item and one snoozed until tomorrow is not; in a
context dashboard the stub receives that context (AC 24, amendment 8)
Proof: `npx vitest run tests/paineis.sources.test.ts -t "C34 "`

**C35** - A `facts` source returns the open facts newest first with `subject`, `predicate`, `object`, `validFrom` and
`sourcePath`, and not a retracted one; in a context dashboard only the facts whose `sourcePath` is inside the context's scope
(amendment 8)
Proof: `npx vitest run tests/paineis.sources.test.ts -t "C35 "`

**C36** - Every item a source returns from a note carries the note's `natureza` read through C6's closed list, in `notes`,
`tasks`, `decisions`, `projects` and `reviews`: `natureza: hipotese` → `"hipotese"`, `natureza: talvez` → `null`, none →
`null` (AC 24)
Proof: `npx vitest run tests/paineis.sources.test.ts -t "C36 "`

### S3 - KPIs, destaques, lembretes e tarefas (plan S3, S5) · 14 files · 239 KB · ~60k

**C37** - A `kpi` widget's `data` holds `value`, `of` (when the measure has one), `delta`, `deltaPct`, `direction`, `good`,
`chip` and `series` (at most 30 points); one asserted case per measure: `done_of_due` with 5 tasks due today of which 2 are
done → `value: 2`, `of: 5`; `open` with 4 open tasks in the week → `value: 4`, no `of`; `count` on `decisions` with 6
decisions → 6; `on_track_of_active` with 3 `on_track`, 1 `behind`, 1 `due_today`, 1 `done` → `value: 3`, `of: 5`; `latest`
on `runs24h` 12 → 12 (AC 26, amendment 5)
Proof: `npx vitest run tests/paineis.kpi.test.ts -t "C37 "`

**C38** - In the pinned `Asia/Kolkata` zone, three refreshes at 10:05, 11:10 and 12:20 local with the KPI's value 3, 4 and 2
store three `dashboard_series` rows (read back) at 10:00, 11:00 and 12:00 local (`at` = 04:30, 05:30 and 06:30 UTC), and the
third refresh's `data` has `delta: -1` and `direction: "down"`; a refresh at 12:40 with 5 replaces the 12:00 point (still 3
rows, the last 5); a row 90 days + 1 hour old is deleted at the next refresh and one 89 days old is kept (AC 27, door 4,
amendment 14)
Proof: `npx vitest run tests/paineis.localhour.test.ts -t "C38 "`

**C39** - A KPI with one stored point has `series` of one point and no `delta`, `deltaPct`, `direction` or `good` key; with
none, `series: []` and no `delta` (AC 28)
Proof: `npx vitest run tests/paineis.kpi.test.ts -t "C39 "`

**C40** - The delta rules at their own layer, one case each: `period: "week"` compares with the oldest point of the last 7
days (points 10 at −8 d, 4 at −6 d, 6 now → `delta: 2`); `upIsGood: false` with `direction: "up"` → `good: false`;
`upIsGood` absent, up → `good: true`; base 0 → `deltaPct: null`; equal values → `direction: "flat"`, `delta: 0`; base 20, now 23
→ `deltaPct: 15` (amendment 14)
Proof: `npx vitest run tests/paineis.layer.test.ts -t "C40 "`

**C41** - A KPI's `chip`, one asserted case per rule and its edge: `remaining` with `of: 5`, `value: 3` → `{ rule:
"remaining", n: 2, tone: "warn" }`, with `value: 5` → no `chip`; `open` with 2 open decisions → `{ rule: "open", n: 2, tone:
"warn" }`, with 0 → none; `behind` with 3 `behind` projects → `{ rule: "behind", n: 3, tone: "danger" }`, with 0 → none (AC 29,
amendment 14)
Proof: `npx vitest run tests/paineis.kpi.test.ts -t "C41 "`

**C42** - `GET /api/dashboards/visao-geral?since=<ms>` answers `highlights` with at most 8 items in the order of door 5, each
with exactly `rule`, `title`, `tone` and `target`: with 11 candidates over six rules, 8 items, the first rules' items first;
a task that is both `overdue` and in a project `behind` appears once, under `overdue`; `new_since_visit` holds only the items
whose `ts` or `mtime` is after `since` (one 1 ms after → in, one equal → out); with no `since`, no `new_since_visit` item;
with one candidate, a one-item list; tones and targets as amendment 15 (`overdue` `danger` `/brain?sel=<id>`,
`connector_flagged` `info` the item's `href`, `review_due` `info` `/brain/reviews?path=<path>`) (AC 44, amendment 15)
Proof: `npx vitest run tests/paineis.highlights.test.ts -t "C42 "`

**C43** - The highlight rules at their own layer, one asserted case per rule with its edge: `overdue` (due yesterday → in,
today → out); `due_today` (today → in, tomorrow → out); `decided_this_week` (a `decided` decision of the week → in, an
`open` one → out); `open_decision_7d` (an open decision 8 local days old → in, 7 → out); `project_behind`; `review_due`;
`connector_flagged` (`flagged: true` → in, `false` → out); `new_since_visit` (amendment 15); and the order of the output is
the order of door 5 whatever the order of the input (door 5)
Proof: `npx vitest run tests/paineis.layer.test.ts -t "C43 "`

**C44** - In the pinned zone with `settings.dashboards.reminders` `{ maxPerDay: 2, at: "08:30" }`, a refresh at 08:31 on
2026-10-30 with one overdue task, two tasks due today and one project `behind` creates exactly 2 notifications, read back from
`GET /api/notifications`: `kind: "reminder"`, the overdue first (`dedupeKey` `reminder:overdue:task:<path>:<line>:2026-10-30`,
`tone: "warn"`, `messageKey: "reminder.overdue"`, `messageParams.text` the task's text, `href` `/brain?sel=<id>`), then the
first due-today one (`tone: "info"`); a second refresh at 10:00 the same day creates none; a refresh at 08:29 on 2026-10-31
creates none, and one at 08:30 creates 2 again; with only one candidate, one reminder (AC 46, amendment 16)
Proof: `npx vitest run tests/paineis.localday.test.ts -t "C44 "`

**C45** - With `maxPerDay: 0` no refresh creates a `reminder` row (read back over a day with four candidates); `PUT
/api/settings` with `dashboards.reminders.maxPerDay` 21, −1 and 2.5, and `at` `"8:30"` and `"24:00"`, each answers `400
validation` and the stored settings are unchanged; `{ dashboards: { reminders: { maxPerDay: 0 } } }` stores `maxPerDay: 0`
and `at: "08:30"` after an `at: "07:00"` was stored (the object is replaced whole, L-042), and every other top-level key of
the settings is equal by value to before (AC 47, amendment 16)
Proof: `npx vitest run tests/paineis.highlights.test.ts -t "C45 "`

**C46** - `NOTIFICATION_KINDS` equals `approval`, `run`, `routine`, `index`, `system`, `reminder` (the five of before, as
before by value, then `reminder`); the wire schema of a notification and the v1 schema of `notification.created` accept
`kind: "reminder"` and refuse `kind: "lembrete"`; `EVENT_VERSIONS["notification.created"]` is still `[1]`; a reminder's
`title` is `"Overdue: <text>"`, `"Due today: <text>"` or `"Project behind: <title>"`; the push channel sends a `reminder` of
`tone: "warn"` when `minTone` is `warn` and skips one of `tone: "info"` (the tone gate, as before) (amendment 16)
Proof: `npx vitest run tests/paineis.highlights.test.ts -t "C46 "`

**C47** - `PUT /api/memory/tasks` with `{ path, line: 3, done: true, baseVersion }` on a note under `memory/` whose bytes have
CRLF line ends, a tab-indented line and no final newline (L-025) answers `200` with `path`, a `version` that is the hash of
the file read back, and `task: { line: 3, done: true, text }`; the new bytes differ from the old only at the 3 bytes `[ ]` of
line 3, now `[x]`; `done: false` on a `[x]` line and on a `[X]` line writes `[ ]` there and nothing else; `done: true` on a
line already `[x]` answers `200` with the bytes unchanged (AC 48, amendment 17)
Proof: `npx vitest run tests/paineis.tasks.test.ts -t "C47 "`

**C48** - `PUT /api/memory/tasks` answers `403 note_not_editable` and changes no byte, one case per place: a note outside
`memory/` (an indexed folder), `memory/journal/2026-10-30.md`, `memory/ROUTER.md`, `memory/areas/a.md` and
`memory/contexts/c.md`; the same body on `memory/notes/a.md` answers `200` (AC 49, amendment 17)
Proof: `npx vitest run tests/paineis.tasks.test.ts -t "C48 "`

**C49** - `PUT /api/memory/tasks` answers `409 edit_conflict` and changes no byte, one case each: a `baseVersion` the file no
longer has; a `line` that holds text but no task; a `line` past the end of the file (AC 50, amendment 17)
Proof: `npx vitest run tests/paineis.tasks.test.ts -t "C49 "`

**C50** - `PUT /api/memory/tasks` answers, writing nothing: `400 validation` for `line: 0`, for no `baseVersion` and for
`done: "yes"`; `403 forbidden_path` for a path through a link out of the granted folders; `404 note_missing` for a note that
does not exist; `404 not_a_file` for a folder; `413 note_too_large` for a note above the editing limit (Surface, amendment 17)
Proof: `npx vitest run tests/paineis.tasks.test.ts -t "C50 "`

**C51** - After `PUT /api/memory/tasks` marks done the only task due today, the next `POST /api/dashboards/visao-geral/refresh`
(after the index pass the route requested) answers the "Prioridades de hoje" checklist without it and the KPI with `value:
1`, `of: 1`, read from what the route and the refresh wrote, not from seeded rows (L-051, amendment 17)
Proof: `npx vitest run tests/paineis.tasks.test.ts -t "C51 "`

### S4 - pergunta e exportação (plan S6) · 9 files · 115 KB · ~29k

**C52** - `POST /api/dashboards/pergunta/refresh` answers `202` with `runId`; that run is the skill `dashboard-answer` with
`inputs.question` the dashboard's question and `contextId` its context (or none); until the run's result is accepted, `GET
/api/dashboards/pergunta` answers the previous snapshot (same `generatedAt`); a second `refresh` while the run is
`running` answers `409 refresh_in_progress` and starts no run (AC 51, amendment 19)
Proof: `npx vitest run tests/paineis.question.test.ts -t "C52 "`

**C53** - `refresh` on a question dashboard answers `409 skill_unavailable` and starts no run (the runs list is unchanged),
one case each: no `skills/dashboard-answer/`, the skill disabled, `settings.memorySkills` without `dashboard-answer`; with the
skill's daily budget spent it answers `409 budget_exhausted` (amendment 19)
Proof: `npx vitest run tests/paineis.question.test.ts -t "C53 "`

**C54** - When the run finishes `succeeded`, its `artifacts/<run>/dashboard.json` is refused, each case for its own reason
alone (every other part valid, L-039): it does not validate against the snapshot schema; a widget has no citation; a citation
names a path the index does not have; a path today's policy excludes; a path outside the context's scope at the look-alike
`/w/proj-old` (L-054); an item of natureza `plano` without its label; 7 widgets; 256 KB + 1 byte; and the run finishing
`failed`; on each, the stored snapshot is unchanged (same `generatedAt`), its `sources[]` has `{ id: "question", kind:
"question", status: "error", message }` with the reason, and `dashboard.refreshed` carries `status: "error"`; a valid result
with two widgets, each with one citation, becomes the snapshot (read back) with `status: "ok"` (AC 52, AC 53, door 7)
Proof: `npx vitest run tests/paineis.question.test.ts -t "C54 "`
Proof: `npx vitest run tests/paineis.layer.test.ts -t "C54 "`

**C55** - The citation rules apply on every path a cited file reaches the snapshot by (L-055): a widget's `citations[]`, a
`list` item's `path` and a `table` row's `path`; an excluded file on any one of them refuses the result, and the same file
nowhere lets a valid result through (amendment 19)
Proof: `npx vitest run tests/paineis.layer.test.ts -t "C55 "`

**C56** - `skills/dashboard-answer/SKILL.md` parses with `mode: "read_only"` and the inputs `question` (required) and
`contextId` (optional); `SettingsSchema.parse({}).memorySkills` equals `recall`, `consolidate-memory`, `organize-brain`,
`dashboard-answer`; a home whose stored `memorySkills` is `["recall"]` keeps `["recall"]`; `GET /api/skills` shows
`dashboard-answer` with `memoryAccess: true` on a fresh home (door 7, amendment 19, question 9)
Proof: `npx vitest run tests/paineis.question.test.ts -t "C56 "`

**C57** - In the pinned zone at 2026-10-30 14:07 local, `POST /api/dashboards/visao-geral/export` answers `200` with `path`
ending in `artifacts/dashboards/visao-geral-2026-10-30T1407.html`; that file has no `<script`, no `src=`, no `url(`, no
`@import`, no `<link`; each chart is an inline `<svg>` followed by a `<table>` holding the same values; a widget title
`<b>x</b>` appears as `&lt;b&gt;x&lt;/b&gt;`; the footer reads "Exportado do MordomoOS em 30/10/2026"; a question dashboard's
file holds its citations as `nome § seção`; a second export in the same minute ends in `-2.html`; a dashboard with no
snapshot answers `409 no_snapshot` and writes nothing; `nao-existe` answers `404 dashboard_not_found` (AC 55, amendment 20)
Proof: `npx vitest run tests/paineis.localday.test.ts -t "C57 "`
Proof: `npx vitest run tests/paineis.layer.test.ts -t "C57 "`

### Cross-cutting, API · 11 files · 204 KB · ~51k

**C58** - The `API` table has the eight routes of the Surface with these method, path, scope and named errors (`toEqual` over
the codes): `GET /api/dashboards` `content`; `POST /api/dashboards` `owner`, `404 context_not_found`, `409 dashboard_exists`;
`GET /api/dashboards/:id` `content`, `404 dashboard_not_found`; `PUT /api/dashboards/:id` `owner`, `404 dashboard_not_found`,
`409 edit_conflict`; `DELETE /api/dashboards/:id` `owner`, `404 dashboard_not_found`; `POST /api/dashboards/:id/refresh`
`owner`, `404 dashboard_not_found`, `409 refresh_in_progress`, `409 skill_unavailable`, `409 budget_exhausted`; `POST
/api/dashboards/:id/export` `owner`, `404 dashboard_not_found`, `409 no_snapshot`; `PUT /api/memory/tasks` `owner`, `403
forbidden_path`, `403 note_not_editable`, `404 note_missing`, `404 not_a_file`, `409 edit_conflict`, `413 note_too_large`;
the regenerated OpenAPI document has the eight paths with `x-mordomo-scope`, and each answers under `/api/v1/` the same as
under `/api/` (AC 56, door 6)
Proof: `npx vitest run tests/paineis.contract.test.ts -t "C58 "`

**C59** - `EXPECTED_ROUTE_SCOPES` lists the eight routes; the refusal probe has one scenario per route: a device with
`content` gets `200` from both `GET`s, a device with only `monitor` gets `403 scope_required` from both, every device gets
`403 owner_only` from the six writes, and a run's own credential (`rc_…`) gets `403 forbidden` from all eight (amendment 27)
Proof: `npx vitest run tests/paineis.contract.test.ts -t "C59 "`
Proof: `npx vitest run tests/api.refusals.test.ts -t "C59 "`

**C60** - `docs/security.md` lists each of the eight routes with its scope (the drift test reads the table) (AC 56)
Proof: `npx vitest run tests/paineis.contract.test.ts -t "C60 "`

**C61** - The static walker of `tests/security-reads.test.ts` (it resolves each `fs` binding to its import; its claim lists
the spellings it does not cover: a `require` built at run time and a call through `Reflect`, L-048) finds no raw `fs` read or
write in `core/src/dashboards/`, `apps/api/src/routes/dashboards.ts` or the new tasks writer outside its list, and the list
gained no entry; `tests/sdk.instances.test.ts` finds no module-level mutable state in those files outside its list (the
refresh locks, the timer and the pending question runs live on the service instance) (AC 57, L-038)
Proof: `npx vitest run tests/security-reads.test.ts -t "C61 "`
Proof: `npx vitest run tests/sdk.instances.test.ts -t "C61 "`

**C62** - `legal/PRIVACY.md` section 3 holds the sentence that a dashboard snapshot keeps, in the local database and its
backups, the titles and subtitles of the connector items it shows, replaced at each refresh and deleted with the dashboard;
`legal/network-policy.json` and the destinations table of section 4.1 are equal by value to before (no new destination)
(AC 58, question 1)
Proof: `npx vitest run tests/paineis.contract.test.ts -t "C62 "`

**C63** - The snapshot of a dashboard with a `connector` widget, read back from `dashboard_snapshots.json`, holds the items'
`title` and `subtitle` and no other field of the connector's raw answer (the fake read returns an extra `body` field that is
absent); after `DELETE` no row of `dashboard_snapshots` holds the item's title (AC 58, door 4)
Proof: `npx vitest run tests/paineis.contract.test.ts -t "C63 "`

**C64** - Existing behaviour, each asserted by value: `GET /api/connectors/calendar-google/data` answers the same body for
the same fake read as before the shared cache (`toEqual` over a recorded body); the `connectorDelta` sentinel still fetches
on its own (one fetch per hourly pass, not through the cache); `MetricsHistory.sample` writes the same row for the same
source; `GET /api/memory/reviews?kind=due` answers the same items for the same home; the `reviewDue` sentinel fires once a
day with the count of before, with or without reminders on the same day (question 2's default: no shared cap)
Proof: `npx vitest run tests/paineis.contract.test.ts -t "C64 "`

### S5 - a tela Painéis, nas duas interfaces (plan S4, S5, S6) · 31 files · 285 KB · ~71k

**C65** - Opening "Painéis" when `GET /api/dashboards` answers `dashboards: []` sends `POST /api/dashboards` with `{
template: "overview" }` once, then `POST /api/dashboards/visao-geral/refresh` once, then shows the widgets of the returned
snapshot, and below them the actions "Painel de um contexto" and "Painel de uma pergunta" in that order; when the list is
not empty no `POST` is sent (the mock answers by method and path and fails on any other request) (AC 30)
Proof: `npm run test -w apps/command-centre -- src/dashboards/DashboardsPage.test.tsx -t "C65 "`

**C66** - In the pinned zone, the header of an `overview` reads "Bom dia" at 05:00 and 11:59, "Boa tarde" at 12:00 and
17:59, "Boa noite" at 18:00 and 04:59 (24px); an `area` dashboard shows its title. The left block's lines, in order: the
greeting or title; then the kind ("Visão geral", "Contexto: Projeto X", "Pergunta"), the long date, "Atualizado às 14:07"
and the sources as small badges, each an icon then the name (`Check` ok, `AlertTriangle` error, `Plug` not configured,
`CircleSlash` unavailable) in the snapshot's order; the right block, in order: the dashboard selector (`DropdownMenu`: the
dashboards by kind, then "Novo painel…"), "Atualizar" (`.btn.sm` with `RefreshCw`), and "Mais" (AC 31, amendment 25)
Proof: `npm run test -w apps/command-centre -- src/dashboards/dashboardsTime.test.tsx -t "C66 "`

**C67** - After "Atualizar", the header shows a spinning `Loader` and "Atualizando…" in an element with `role="status"`, the
widgets keep the previous values (a KPI still reads 3) until a `dashboard.refreshed` event for this id arrives on the stream,
and then show the new snapshot (the KPI reads 4); an event for another id changes nothing (AC 32)
Proof: `npm run test -w apps/command-centre -- src/dashboards/DashboardsPage.test.tsx -t "C67 "`

**C68** - With `stale: true` the header shows `Clock`, "Desatualizado — atualizado às 09:15" and the "Atualizar" button; with
`snapshot: null` it shows "Ainda sem dados" and "Atualizar", and the cards show the skeleton (AC 33, design "Estados do
cabeçalho")
Proof: `npm run test -w apps/command-centre -- src/dashboards/DashboardsPage.test.tsx -t "C68 "`

**C69** - Each widget state renders on that widget alone, one asserted case per state: `error` → `AlertTriangle`, the message,
"Tentar de novo" (`.btn.sm`, which sends the refresh) in an element with `role="alert"`, the other widgets unchanged;
`unavailable` → `CircleSlash` and "Esta fonte ainda não existe nesta versão."; `not_configured` → `Plug`, "Conecte Calendar
(Google Calendar MCP) para ver isto." and a link to `/connectors#calendar-google`; `empty`, table-driven over the empty texts
of `design.md` and amendment 26 per widget kind and per source (`checklist` "Nada com prazo para hoje." with "Como marcar um
prazo", `list` of `decisions` "Nenhuma decisão nesta semana.", of `projects` "Nenhum projeto ativo.", … `agenda` "Agenda livre
hoje."); loading (no snapshot yet) → the skeleton; every state shows an icon and a text, never a colour alone (AC 34, AC 35,
AC 41, amendment 26)
Proof: `npm run test -w apps/command-centre -- src/dashboards/DashboardsPage.test.tsx -t "C69 "`

**C70** - A `kpi` tile shows, in order: the label (12px, no colon), the value compacted ("1.284", "12,9 mil" in pt-BR), `of`
as "/5", the sparkline (an SVG `path` whose `d` is `sparkline()`'s line for the `series`, the history in `--chart-muted`, the
last point a dot), the signed delta as text ("↑ 15% na semana", "−1 hoje") with the class of `good`/bad, and the chip text
of `{ rule: "remaining", n: 2 }` "2 restantes"; with no `delta` it shows "Sem histórico ainda" where the sparkline was; a
value 0 reads "0" (AC 26, AC 28, AC 36, amendment 14)
Proof: `npm run test -w apps/command-centre -- src/dashboards/widgets.test.tsx -t "C70 "`

**C71** - In the pinned zone with today 2026-10-30, a `checklist` row shows, in order: the checkbox, `ChevronsUp` before the
text when `priority` is 2, the text, the note's name, and the due badge: due 2026-10-28 → `danger` "Atrasada há 2 d", due
2026-10-30 → `warn` "Vence hoje", due 2026-10-31 → `info` "Amanhã", due 2026-11-04 → the short date; a task of a note outside
`memory/` has a disabled checkbox with `Lock` and the `title` "Fora de memory/: abra a nota para marcar."; one of
`memory/journal/` has a disabled checkbox with "Gerada pelo MordomoOS" (AC 36, AC 49, amendment 17)
Proof: `npm run test -w apps/command-centre -- src/dashboards/dashboardsTime.test.tsx -t "C71 "`

**C72** - Checking the task of `memory/notes/a.md` line 3 sends `GET /api/memory/note?p=<path>` and then `PUT
/api/memory/tasks` with `{ path, line: 3, done: true, baseVersion: <the version the GET answered> }`, and the row shows
checked; when the `PUT` answers `409 edit_conflict` the row is unchecked again and shows "A nota mudou; atualize o painel."
(AC 48, AC 50, amendment 17)
Proof: `npm run test -w apps/command-centre -- src/dashboards/widgets.test.tsx -t "C72 "`

**C73** - A `list` row shows its title, subtitle and, at the right, the state badge, one asserted case per state (icon, text,
tone): `decided` `Check` "Decidido" ok, `open` `CircleDot` "Aberta" warn, `on_track` "No prazo" ok, `behind` "Atrasado"
danger, `due_today` "Vence hoje" warn, `in_review` "Em revisão" info, `paused` "Pausado" neutral, `running` `Loader`
"Executando" info; an item of natureza `plano`, `hipotese` or `opiniao` shows C6's `NatureBadge` (icon and "Plano — ainda não
é realidade", "Hipótese", "Opinião") and no "Decidido" badge even when its `state` reads `decided`; a `fato` decided item
shows "Decidido" (AC 36, AC 38, amendment 22)
Proof: `npm run test -w apps/command-centre -- src/dashboards/widgets.test.tsx -t "C73 "`

**C74** - A `table` widget shows the header row, at most 20 rows (with 23, 20 and "Ver todas (23)"), numbers right-aligned
with `tabular-nums`, and state badges as in C73 (AC 36)
Proof: `npm run test -w apps/command-centre -- src/dashboards/widgets.test.tsx -t "C74 "`

**C75** - A `bars` widget shows one bar per category in the data's order, each with the label at the left, the bar
(`--chart-mark` on a `--chart-muted` track) and the value at the right; with `ordered` and `funnel`, a conversion column
("46%") after the values; no legend (AC 36)
Proof: `npm run test -w apps/command-centre -- src/dashboards/widgets.test.tsx -t "C75 "`

**C76** - In the pinned zone at 14:20, an `agenda` widget shows each event as time (`tabular-nums`), title and prep note in
that order; the 14:00-15:00 event carries the current mark and the 09:00 event the past class; with no events, "Agenda livre
hoje." (AC 36)
Proof: `npm run test -w apps/command-centre -- src/dashboards/dashboardsTime.test.tsx -t "C76 "`

**C77** - A `note` widget renders its excerpt through `components/Markdown.tsx` (no other renderer is imported by the
dashboards folder), at most 12 lines, followed by "Abrir nota"; an empty excerpt reads "Esta nota está vazia." (AC 36)
Proof: `npm run test -w apps/command-centre -- src/dashboards/widgets.test.tsx -t "C77 "`

**C78** - The highlights row sits above the KPI row and shows the response's `highlights` in their order, each pill an icon,
the text and the tone; activating a pill opens its `target`; with `highlights: []` the row is absent; with one highlight, one
pill (AC 44, design "Corpo")
Proof: `npm run test -w apps/command-centre -- src/dashboards/widgets.test.tsx -t "C78 "`

**C79** - Every chart (a KPI's sparkline, a `bars` widget) has "Ver como tabela" (a `Switch`) that swaps the chart for a
table with the same values; pointing at or focusing a point shows a tooltip whose text is the value then the label, set
through `textContent`, and `Escape` closes it; every value a tooltip shows is in that widget's table (AC 39)
Proof: `npm run test -w apps/command-centre -- src/dashboards/charts.test.tsx -t "C79 "`

**C80** - Activating a `list` or `checklist` item from a note goes to `/brain?sel=<fileId>`; a connector item with `href`
calls `window.open(href, "_blank", "noopener")` and the app's route does not change; a connector item with no `href` is not a
button; a citation "plano.md § Metas" goes to `/brain?sel=<its fileId>` (AC 37, AC 54, amendment 18)
Proof: `npm run test -w apps/command-centre -- src/dashboards/widgets.test.tsx -t "C80 "`

**C81** - The moldura's main group is, in order, "Hoje", "Painéis", then the items of before in their order; `MAIN_SCENES`
ids are `nucleo`, `brain`, `runs`, `skills`, `routines`, `dashboards` and the key `6` goes to `/dashboards`; the palette has
`action:dashboards` "Abrir painéis" everywhere and `action:dashboard-refresh` "Atualizar painel" only while a dashboard is on
screen, both distinct from `action:open-panel`; in both shells the page shows the same snapshot and the same selector
entries; in a real browser, pressing `6` in the Núcleo opens the scene (AC 40, amendment 25)
Proof: `npm run test -w apps/command-centre -- src/dashboards/dashboardsEntries.test.tsx -t "C81 "`
Proof: `npm run test -w apps/command-centre -- src/nucleo/shell.test.ts -t "C81 "`
Proof: `npm run build:server && npm run build -w apps/command-centre && MORDOMO_E2E_PORT=4901 npx playwright test --config tests/e2e/playwright.config.ts dashboards.spec.ts -g "C81 "`

**C82** - With an `overview` dashboard listed, the Today header shows, after the date, the link "Ver a visão geral →" to
`/dashboards/visao-geral`; with none, no link; the six cards are `approvals`, `now`, `routines`, `inbox`, `journal`, `cost`
in this order (as before by value) (AC 43, amendment 25)
Proof: `npm run test -w apps/command-centre -- src/dashboards/dashboardsEntries.test.tsx -t "C82 "`

**C83** - When `GET /api/dashboards` answers `403 scope_required`, the page shows "Este dispositivo não tem permissão para ver
painéis." and no selector, widget or `POST` (AC 42)
Proof: `npm run test -w apps/command-centre -- src/dashboards/DashboardsPage.test.tsx -t "C83 "`

**C84** - Leaving `visao-geral` (another dashboard chosen, or the page left) sends `PUT /api/ui-preferences` with `dashboards:
{ lastViewed: { "visao-geral": <now> } }` keeping the other entries; the next open of `visao-geral` requests `GET
/api/dashboards/visao-geral?since=<that now>` (the mock answers only that query); with no entry, the request has no `since`
(AC 45, amendment 28)
Proof: `npm run test -w apps/command-centre -- src/dashboards/DashboardsPage.test.tsx -t "C84 "`

**C85** - "Novo painel…" opens a `Modal` with three cards in order "Visão geral", "Contexto" (a select of the contexts),
"Pergunta" (a field of at most 500 characters), then "Criar" and "Cancelar"; with no context, the "Contexto" card shows "Crie
um contexto primeiro" and a link to the contexts settings; "Criar" on "Pergunta" sends `POST /api/dashboards` with
`template: "question"` and the text, then `POST /api/dashboards/pergunta/refresh`, and the page shows `pergunta`; "Cancelar"
sends nothing (design "Novo painel", amendment 25)
Proof: `npm run test -w apps/command-centre -- src/dashboards/DashboardDialogs.test.tsx -t "C85 "`

**C86** - "Personalizar" opens a `Modal` listing the widgets in the definition's order, each with a `Switch` "mostrar"; with a
row focused, `ArrowDown` moves it one down and `ArrowUp` one up; saving sends `PUT /api/dashboards/:id` with the `version` it
read, the widgets in the new order and `options.hidden: true` on the hidden one; a `409 edit_conflict` shows "Este painel
mudou em outro lugar." and "Recarregar", which reloads the definition (design "Personalizar")
Proof: `npm run test -w apps/command-centre -- src/dashboards/DashboardDialogs.test.tsx -t "C86 "`

**C87** - "Mais" lists, in order, "Exportar HTML", "Personalizar", "Editar no editor do sistema", "Arquivar painel":
"Exportar HTML" sends `POST /api/dashboards/:id/export` and shows the answered `path`; "Editar no editor do sistema" sends `POST
/api/memory/open` with `p` the dashboard's file; "Arquivar painel" sends `DELETE /api/dashboards/:id` and the page moves to
the first remaining dashboard (design "Página", amendment 25)
Proof: `npm run test -w apps/command-centre -- src/dashboards/DashboardDialogs.test.tsx -t "C87 "`

**C88** - A `question` dashboard shows the question as its title; under each widget, "Fontes" and its citations as `nome §
seção`; a last `note` card "Como esta resposta foi feita" with the run's date and a link to `/runs/<runId>`; when the source
`question` is `error`, the message and "Tentar de novo" (AC 53, AC 54)
Proof: `npm run test -w apps/command-centre -- src/dashboards/DashboardsPage.test.tsx -t "C88 "`

**C89** - In the Núcleo, the scene shows the header as the voice line, the KPIs in a strip at the top, then the cards as
lâminas in the definition's order in two columns, and the selector in the scene's menu; it has no camera movement (design
"Cena - Painéis")
Proof: `npm run test -w apps/command-centre -- src/dashboards/dashboardsEntries.test.tsx -t "C89 "`

**C90** - In the moldura, the body is, top to bottom, the highlights row, the KPI row (up to 5 tiles of equal width) and the
cards in the definition's order on a 12-column grid, a card spanning 4, 6, 8 or 12 columns for `s`, `m`, `l`, `xl`; in a real
browser at 1280 px the five KPI tiles share one row, at 900 px two per row, at 520 px one per row (design "Corpo")
Proof: `npm run test -w apps/command-centre -- src/dashboards/dashboardsEntries.test.tsx -t "C90 "`
Proof: `npm run build:server && npm run build -w apps/command-centre && MORDOMO_E2E_PORT=4901 npx playwright test --config tests/e2e/playwright.config.ts dashboards.spec.ts -g "C90 "`

**C91** - The inbox shows a `reminder` row through its `messageKey`: "Atrasada: Mandar a proposta", "Vence hoje: Ligar",
"Projeto atrasado: Site novo" in pt-BR and "Overdue: Mandar a proposta" in en; a `reminder` row with an unknown
`messageKey` shows its `title` (amendment 16)
Proof: `npm run test -w apps/command-centre -- src/hooks/notificationText.test.ts -t "C91 "`

### Cross-cutting, screens · 10 files · 150 KB · ~38k

**C92** - Every `animation` and `transition` of the dashboards' stylesheets sits inside `@media (prefers-reduced-motion:
no-preference)` (the reader of `ui/ui.source.test.ts` C15 run on them): the KPI number counts from the old value to the new in
400 ms when `dashboard.refreshed` arrives, the bars grow from the base in 300 ms on first paint, a new highlight pill fades in
in 150 ms; with motion reduced, every state renders the final values at once and the same texts and icons (AC 41, design
"Movimento")
Proof: `npm run test -w apps/command-centre -- src/dashboards/dashboardsMotion.test.ts -t "C92 "`

**C93** - `theme.css` defines `--chart-mark` `#ea580c` (dark) and `#c2410c` (light), `--chart-mark-soft` as `--chart-mark` at
10%, `--chart-muted` `var(--text-faint)` and `--chart-grid` `var(--border)`; `contrastRatio` of `color.ts` gives `--chart-mark`
at least 3:1 over `--bg-raise` of each of the ten theme and preset pairs; no chart mark uses `--accent`; the dashboards'
stylesheets have no text under 12px and prose at 13px, and the repository's stylelint config (tokens only) reports no warning
on them, run programmatically as `typography.test.ts` runs it (AC 41, amendment 23)
Proof: `npm run test -w apps/command-centre -- src/dashboards/dashboardsMotion.test.ts -t "C93 "`

**C94** - In the light and the dark theme and in the moldura and the Núcleo, the page over a snapshot fixture with one widget
of each of the eight kinds, one `error` and one `empty`, has every action reached by `Tab` in reading order and activated by
`Enter`, and axe at WCAG A/AA reports no `serious` or `critical` violation on the whole page (AC 41, the S4 independent test)
Proof: `npm run build:server && npm run build -w apps/command-centre && MORDOMO_E2E_PORT=4901 npx playwright test --config tests/e2e/playwright.config.ts dashboards.spec.ts -g "C94 "`

**C95** - The component gallery has a dashboards entry (a KPI tile with and without history, each widget kind, the header in
its four states, the highlights row), and in both themes it has no `serious` or `critical` axe violation
(`design-system/design.md`, "a galeria cobre as duas camadas")
Proof: `npm run build:server && npm run build -w apps/command-centre && MORDOMO_E2E_PORT=4901 npx playwright test --config tests/e2e/playwright.config.ts dashboards.spec.ts -g "C95 "`

**C96** - The page and the scene are reached from both entries (`main.tsx`, `gallery/main.tsx`) only by a dynamic `import()`;
`scripts/bundle-baseline.json` gains a `cerebro-paineis` entry after `cerebro-natureza` with a reason of more than 40
characters and the four numbers, at most 24 KB of JS gzip and 4 KB of CSS gzip above `cerebro-natureza` (556 121 B and
77 763 B); `bundle:check` exits 0 on a fresh build (amendment 24, question 10)
Proof: `npx vitest run tests/paineis.contract.test.ts -t "C96 "`
Proof: `npx vitest run tests/bundle-size.test.ts -t "C31 a build within 5% of the latest recorded one passes"`
Proof: `npm run build -w apps/command-centre && npm run bundle:check`

**C97** - Every key of design.md's "Texto" table (29 rows, 41 keys: `dash.greet.*` as 3, `dash.kind.*` as 3, `dash.new*` as
3, `dash.task.overdue`/`today`/`tomorrow` as 3, `dash.state.*` as 8) and every key of amendment 26 (36 keys) is a key of `en`
and `ptBR` in `locales/dashboards.ts` with that text, both locales hold the same keys, and no key of the file is unused
(`i18n.orphans.test.ts`) (design.md "Texto", amendment 26)
Proof: `npm run test -w apps/command-centre -- src/dashboards/dashboardsCopy.test.ts -t "C97 "`

## Coverage

| Set (size)                                                         | Member -> proof                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | Unproven |
| ------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| `GET /api/dashboards` statuses (1)                                 | 200 C16                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | -        |
| `POST /api/dashboards` statuses (4)                                | 201 C1, C2, C3 · 400 C2, C3 · 404 C2 · 409 C4                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | -        |
| `GET /api/dashboards/:id` statuses (2)                             | 200 C12, C11 · 404 C12, C16                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | -        |
| `PUT /api/dashboards/:id` statuses (4)                             | 200 C6 · 400 C5 · 404 C6 · 409 C6                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | -        |
| `DELETE /api/dashboards/:id` statuses (2)                          | 200 C15 · 404 C15                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | -        |
| `POST /api/dashboards/:id/refresh` statuses (4)                    | 200 C7, C8 · 202 C52 · 404 C9 · 409 C9, C52, C53                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | -        |
| `POST /api/dashboards/:id/export` statuses (3)                     | 200 C57 · 404 C57 · 409 C57                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | -        |
| `PUT /api/memory/tasks` statuses, with amendment 17's 413 (6)      | 200 C47 · 400 C50 · 403 C48, C50 · 404 C50 · 409 C49 · 413 C50                                                                                                                                                                                                                                                                                                                                                                                                                                                              | -        |
| named error codes, as (status, code) pairs (17)                    | `400 validation` C2, C3, C5, C45, C50 · `404 dashboard_not_found` C6, C9, C12, C15, C16, C57 · `404 context_not_found` C2 · `409 dashboard_exists` C4 · `409 edit_conflict` C6, C49 · `409 refresh_in_progress` C9, C52 · `409 no_snapshot` C57 · `409 skill_unavailable` C53 · `409 budget_exhausted` C53 · `403 note_not_editable` C48 · `403 forbidden_path` C50 · `404 note_missing` C50 · `404 not_a_file` C50 · `413 note_too_large` C50 · `403 owner_only` C59 · `403 scope_required` C59, C83 · `403 forbidden` C59 | -        |
| doors of Landing (7)                                               | 1 C1, C5, C6 · 2 C12, C14, C17 · 3 C19, C20, C21, C22 · 4 C7, C19, C38, C63 · 5 C42, C43, C44 · 6 C18, C58, C59 · 7 C52, C54, C56                                                                                                                                                                                                                                                                                                                                                                                           | -        |
| entities and stored shapes (7)                                     | `memory/dashboards/<id>.json` C1, C6, C15 · `note_tasks` (with the file) C19, C22 · `dashboard_snapshots` (one per dashboard) C7, C15, C63 · `dashboard_series` (per hour, 90 days) C38, C15 · `fields.due` C23, C24 · `settings.dashboards.reminders` C45 · `UiPreferences.dashboards` C84                                                                                                                                                                                                                                 | -        |
| startup config: shared connector cache and the tick (2 assemblies) | the service's start (`server.ts` after `ctx.start()`) C10, C33 · the test harness `buildServer` C7, C33                                                                                                                                                                                                                                                                                                                                                                                                                     | -        |
| templates (3)                                                      | `overview` C1 · `area` C2 · `question` C3                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | -        |
| refresh values (5)                                                 | `15m` C10, C12 · `1h` C10, C12 · `6h` C10, C12 · `daily@HH:MM` C10, C12 · `manual` C10, C11, C12                                                                                                                                                                                                                                                                                                                                                                                                                            | -        |
| definition refusals (C5's cases) (19)                              | C5, table-driven over all 19 (and the 5 accepted edges)                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | -        |
| widget kinds (8)                                                   | `kpi` C37, C70 · `checklist` C25, C71 · `list` C73 · `table` C74 · `bars` C29, C75 · `agenda` C76 · `highlights` C42, C78 · `note` C77                                                                                                                                                                                                                                                                                                                                                                                      | -        |
| source kinds (11)                                                  | `notes` C29 · `tasks` C25 · `decisions` C26 · `openLoops` C27 · `projects` C28 · `reviews` C34 · `facts` C35 · `runs` C30 · `approvals` C30 · `metrics` C31 · `connector` C32                                                                                                                                                                                                                                                                                                                                               | -        |
| memory sources under a context (7)                                 | `notes` C13 · `tasks` C13 · `decisions` C13 · `projects` C13 · `reviews` C13, C34 · `facts` C13, C35 · `openLoops` C27                                                                                                                                                                                                                                                                                                                                                                                                      | -        |
| source statuses (4)                                                | `ok` C7 · `error` C8 · `not_configured` C32, C69 · `unavailable` C17, C69                                                                                                                                                                                                                                                                                                                                                                                                                                                   | -        |
| widget statuses (3)                                                | `ok` C7 · `empty` C31, C69 · `error` C8, C13, C69                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | -        |
| failure outcomes of a refresh (3)                                  | one source C8 · every source C8 · deleted context C13                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | -        |
| task forms stored (9)                                              | C20, table-driven over all 9                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | -        |
| task forms refused (9)                                             | ` ``` ` C21 · `~~~` C21 · front matter C21 · `- []` C21 · `-[ ]` C21 · empty C21 · `+` C21 · `1.` C21 · `.txt` C21                                                                                                                                                                                                                                                                                                                                                                                                          | -        |
| task windows (2)                                                   | `today` C25 · `week` C25                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | -        |
| decision natures and the passage (7)                               | `fato` C26 · `relato` C26 · none C26 · `plano` C26 · `hipotese` C26 · `opiniao` C26 · passage C26                                                                                                                                                                                                                                                                                                                                                                                                                           | -        |
| places decisions are read from (4)                                 | journal day of the week C26 · `MEMORY.md` with an origin in the week C26 · `type: decision` note C26 · look-alike heading or note, refused C26, C27                                                                                                                                                                                                                                                                                                                                                                         | -        |
| project health rows (6) and precedences (2)                        | `done` C28 · `paused` C28 · `behind` C28 · `due_today` C28 · `in_review` C28 · `on_track` C28 · draft past due C28 · done past due C28                                                                                                                                                                                                                                                                                                                                                                                      | -        |
| `notes` filters (8)                                                | `type` C29 · `status` C29 · `tags` C29 · `natureza` C29 · `escopo` C29 · `folder` C29 · context C29, C13 · `changed` C29                                                                                                                                                                                                                                                                                                                                                                                                    | -        |
| metrics series (6)                                                 | C31, table-driven over all 6                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | -        |
| connector reads (5)                                                | `list` C32 · `flagged` C32 · `summary` C32 · no mapping C32 · not in the registry C32                                                                                                                                                                                                                                                                                                                                                                                                                                       | -        |
| KPI measures (5)                                                   | `done_of_due` C37 · `open` C37 · `count` C37, C34 · `on_track_of_active` C37 · `latest` C37                                                                                                                                                                                                                                                                                                                                                                                                                                 | -        |
| delta rules (6)                                                    | `day` C38 · `week` C40 · `upIsGood: false` C40 · base 0 C40 · flat C40 · fewer than 2 points C39                                                                                                                                                                                                                                                                                                                                                                                                                            | -        |
| chip rules (3)                                                     | `remaining` C41, C70 · `open` C41 · `behind` C41                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | -        |
| highlight rules of door 5 (8)                                      | `overdue` C43, C42 · `due_today` C43 · `decided_this_week` C43 · `open_decision_7d` C43 · `project_behind` C43 · `review_due` C43, C42 · `connector_flagged` C43, C42 · `new_since_visit` C43, C42                                                                                                                                                                                                                                                                                                                          | -        |
| reminder rules (3)                                                 | `overdue` C44 · `due_today` C44 · `project_behind` C44                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | -        |
| reminder outcomes (5)                                              | created up to the cap C44 · deduped the same day C44 · next day C44 · before `at` C44 · `maxPerDay: 0` C45                                                                                                                                                                                                                                                                                                                                                                                                                  | -        |
| places a task is not editable (5)                                  | outside `memory/` C48, C71 · `journal/` C48, C71 · `ROUTER.md` C48 · `areas/` C48 · `contexts/` C48                                                                                                                                                                                                                                                                                                                                                                                                                         | -        |
| question result refusals (9)                                       | schema C54 · no citation C54 · not indexed C54 · policy C54 · outside the context C54 · unlabelled `plano` C54 · 7 widgets C54 · size C54 · run failed C54                                                                                                                                                                                                                                                                                                                                                                  | -        |
| paths a cited file arrives by (3)                                  | `citations[]` C55 · a `list` item's `path` C55 · a `table` row's `path` C55                                                                                                                                                                                                                                                                                                                                                                                                                                                 | -        |
| skill unavailable cases (3)                                        | missing C53 · disabled C53 · not in `memorySkills` C53                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | -        |
| one-item list writers (5)                                          | `note_tasks` C22 · `tasks` items C25 · dashboards list C16 · highlights C42, C78 · reminders C44                                                                                                                                                                                                                                                                                                                                                                                                                            | -        |
| local-day and local-time places, in a pinned zone (11)             | `daily@` C10 · archive name C15 · tasks today C25 · week C26, C27 · project due C28 · reminders' day and `at` C44 · export name C57 · greeting C66 · due badges C71 · agenda now C76 · series hour (Kolkata) C38                                                                                                                                                                                                                                                                                                            | -        |
| screen states (10)                                                 | first open C65 · loading skeleton C68, C69 · refreshing C67 · stale C68 · never C68 · widget error C69 · empty C69 · unavailable C69 · not configured C69 · unauthorised C83                                                                                                                                                                                                                                                                                                                                                | -        |
| entries to the screen (4)                                          | sidebar C81 · Núcleo key `6` C81 · palette C81 · Today link C82                                                                                                                                                                                                                                                                                                                                                                                                                                                             | -        |
| arrangements design.md and the amendments draw (15)                | header left lines C66 · header right order C66 · source badges order C66 · highlights above KPIs C78, C90 · KPI row ≤ 5 C90 · card spans C90 · KPI tile order C70 · checklist row order C71 · list row C73 · agenda row C76 · bars columns C75 · new-dashboard cards C85 · "Mais" order C87 · Today link after the date C82 · sidebar second C81                                                                                                                                                                            | -        |
| shells (2)                                                         | moldura C81, C94 · Núcleo C81, C89, C94                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | -        |
| themes (2)                                                         | light C93, C94, C95 · dark C93, C94, C95                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | -        |
| list state badges (8)                                              | C73, table-driven over all 8                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | -        |
| natureza labels on items, and `fato` (4)                           | `plano` C73 · `hipotese` C73 · `opiniao` C73 · `fato` C73                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | -        |
| copy: design.md "Texto" and amendment 26 (77)                      | C97, table-driven over all 77                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | -        |

- Claims naming a status code, route or response shape: C1-C4, C6, C7, C9, C11-C16, C25-C36, C42, C44-C54, C57-C59, and
  also C63 and C64, each proven through `app.inject` against `buildServer`; C5, C8, C10, C17, C19-C21, C28, C40, C43, C54, C55, C57 also
  or only at their own layer, with no HTTP
- Claims about the screens: C65-C93, C97 in rendered components; C81, C90, C94, C95 also in a real browser, both shells
  where the claim names them

## Binding sources

| Source                                                                                                                          | Checked by                          |
| ------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------- |
| `cerebro-paineis/design.md` (the page, the scene, the three templates, each widget and its states, motion, Today, export, copy) | C1, C2, C57, C65-C92, C94, C95, C97 |
| `design-system/design.md` (12px floor, 13px prose, tokens, state never by colour alone, axe, the gallery)                       | C69, C93, C94, C95                  |
| `primitivas/design.md` (`DropdownMenu`, `Switch`, `Modal`, `Badge`, motion inside `no-preference`)                              | C66, C79, C85, C86, C92             |
| `moldura-app/design.md` (main group after "Hoje", `.page`, no right detail panel, the chat stays)                               | C81, C90                            |
| `comandos-atalhos/design.md` (registry commands `global`, the Núcleo's key through the scene list)                              | C81                                 |
| `cerebro-natureza/design.md` (the nature label with its icon, a plan never "Decidido")                                          | C73                                 |
| method of the `dataviz` skill (stat tile, one series, thin marks, tooltip never the only path, table view, validated colour)    | C70, C75, C79, C93                  |
| `limpeza-legado/design.md` (one Markdown renderer, no unused CSS or key)                                                        | C77, C97                            |

## Test policy

| Code                                                                                                                                                                                                                                                                     | Required proofs                                       | Coverage expectation                                                                                                   |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Decides, reached across a boundary (the definition validator, the evaluator and its source rules, project health, decision state, the KPI maths, the highlight and reminder rules, the scheduling and `stale` maths, the question result validator, the export renderer) | one at the HTTP boundary **and** one at its own layer | the contract at the boundary; one asserted case per row of the decision table at its own layer                         |
| Decides, not reached across a boundary (the migration, the task parser, the backfill)                                                                                                                                                                                    | one at its own layer                                  | one asserted case per row                                                                                              |
| Screens (the page, the scene, each widget, the two modals, the entries, the Today link, the inbox row)                                                                                                                                                                   | one in rendered components per screen and state       | each state, arrangement and copy design.md and the amendments name; both themes and both shells for axe in the browser |

Evidence:

- the definition validator (new): 11 source kinds with closed filter keys, 8 widget kinds, 5 refresh forms, the size, the
  count, duplicate ids, the `question`/`refresh` pairing, 5 measures and their sources -> decides, ~45 branch points
- the evaluator (new): a dispatch over 11 source kinds, the context scope, the policy, a source that throws, a missing
  kind -> decides, ~15 branch points; project health 6 rows and 2 precedences; decision state 6 natures and the passage;
  the week's journal days and the `MEMORY.md` origin rule -> decides, ~20
- the task parser (new): the marker, 3 box states, 2 due forms, 2 priority markers, the invalid date, 2 fences, the front
  matter, the length cut -> decides, ~12 branch points
- the KPI maths, highlights and reminders (new): 5 measures, 6 delta rules, 3 chips, 8 highlight rules, dedupe, the cap,
  `at`, the day key -> decides, ~30 branch points
- the scheduling and `stale` maths (new): 5 refresh forms, the `question` exception, the double interval of `daily` ->
  decides, ~10; the question validator: 9 refusals and 3 citation paths -> decides, ~12; the export renderer: escaping,
  chart plus table, the name collision -> decides, ~5
- own layer: `tests/paineis.layer.test.ts` calls those functions with no HTTP, as `tests/natureza.layer.test.ts`,
  `tests/cleanup.layer.test.ts` and `tests/notesview.layer.test.ts` do for the same shape
- closest analogue: `tests/natureza.layer.test.ts` with `tests/natureza.reviews.test.ts` (C6), the same split of a rule set
  proven at the boundary and in the core

Cost: about 60 own-layer cases in `tests/paineis.layer.test.ts`. Without these rows, the 19 refusals of the definition, the
six health rows, the six decision natures and the eight highlight rules are proven only by the requests that happen to
traverse them.

## Swept

- validation: C2, C3, C5, C45, C50, C54
- failure modes: C8 (one source, every source), C13 (a deleted context), C53 (the skill cannot run), C54 (a refused result or a failed run keeps the snapshot), C67 and C69 (the screen keeps the data and offers a retry), C72 (a task conflict reverts the box)
- idempotency: C22 (task rows replaced, never added), C23 (the backfill marker, a cut pass done again), C38 (one point per hour, replaced), C44 (one reminder per item per day by `dedupeKey`), C47 (`done` on a done task writes nothing)
- authorization: C59 (`content` for the reads, owner only for the writes, a run's credential refused), C14 (today's policy on every path), C48 (no task write outside what is editable), C54 and C55 (no citation of a file the policy refuses); existing - the `API` table's scopes and `onRoute` (AD-024) guard every route
- concurrency: C9 (one refresh per dashboard; another dashboard runs), C11 (a stale `GET` starts no second refresh), C52 (one question run at a time), C6 and C49 (`edit_conflict` on a changed file)
- data lifecycle: C19 (migration 26 over existing rows), C23 (backfill of tasks and `due`), C22 (tasks go with the file), C15 (archive, and the snapshot and series rows go), C38 (90 days of series), C63 (connector titles replaced and deleted)
- dependency failure: C8 (a connector times out), C33 (an error read is not cached), C53 (the skill is missing or out of budget), C54 (the run fails)
- state transitions: C7 (no snapshot to snapshot), C11 (stale to refreshed), C47 (`[ ]` to `[x]` and back), C52 and C54 (question run pending to accepted or refused), C15 (dashboard to archived)
- observability: C7, C8 and C18 (`dashboard.refreshed` with `ok`, `partial`, `error`, `docs/events.md` regenerated), C46 (`notification.created` carries `reminder`), C16 (`problems[]` names an unreadable file)

Existing behaviour this feature must not change, each asserted by value: the connector data route's body and the
`connectorDelta` sentinel's own fetch, `MetricsHistory.sample`, C6's review queue and the `reviewDue` sentinel's count (C64);
the 28 event types and their versions (C18); the five notification kinds of before (C46) and the push tone gate (C46); the
eight `FRONT_MATTER_FIELDS` of before (C24); migrations 22-25 and the rows of `files`, `note_links`, `note_passages` and
`review_state` (C19); Today's six cards (C82); the moldura's main group after "Painéis" and the five main scenes before
`dashboards` (C81); `legal/network-policy.json` (C62).

## Handoff

The estimate exceeds the 150k budget. Mechanism chosen by the owner on 31/10/2026: **handoff, four batches A, B, C, D** (the cut below,
batches sequential, each only on green).

- Arithmetic (`wc -c` of the files each slice touches at `4537fb2`, / 4; new files estimated; a large file read in parts
  counts the part):
  - S1 (C1-C18): `contracts/src/api/index.ts` 2 596, the new `contracts/src/api/dashboards.ts` ≈ 16 000,
    `contracts/src/api/errors.ts` 10 005, `contracts/src/events.ts` 7 780, `contracts/src/eventSchemas.ts` 9 057,
    `contracts/src/eventRegistry.ts` 5 642, `core/src/security/safeWrite.ts` 24 862, `core/src/memory/cleanup.ts` 15 631,
    `core/src/memory/contexts.ts` 15 924, `apps/api/src/routes/connectors.ts` 4 241, `apps/api/src/context.ts` 14 433,
    `apps/api/src/server.ts` ≈ 12 000 of 44 280 (the sweep and the registration), `apps/api/src/contract.ts` 5 989,
    `core/src/internal.ts` 15 299, `docs/events.md` 15 978, the new `core/src/dashboards/` ≈ 30 000 and
    `apps/api/src/routes/dashboards.ts` ≈ 12 000 = ≈ 217 KB → ≈ 54k
  - S2 (C19-C36): `core/src/memory/indexer.ts` 44 615, `core/src/db/migrations.ts` 20 285, `core/src/memory/frontMatter.ts`
    18 700, `core/src/memory/fields.ts` 4 147, `core/src/memory/natureza.ts` 6 915, `core/src/memory/recall.ts` 30 367,
    `core/src/memory/journal.ts` 12 352, `core/src/memory/reviews.ts` 10 991, `core/src/memory/facts.ts` 5 535,
    `core/src/memory/search.ts` 10 538, `core/src/metrics/history.ts` 5 120, `core/src/connectors/client.ts` 33 853,
    `core/src/runs/runManager.ts` ≈ 12 000 of 76 015 (the lists), the new sources ≈ 25 000 = ≈ 240 KB → ≈ 60k
  - S3 (C37-C51): `core/src/notifications/store.ts` 7 881, `core/src/notifications/recorder.ts` 10 065,
    `contracts/src/records.ts` 6 323, `contracts/src/api/wire.ts` 8 966, `contracts/src/settings.ts` 23 761,
    `contracts/src/api/system.ts` 22 786, `apps/api/src/routes/system.ts` ≈ 8 000 of 30 810 (the merge),
    `core/src/sentinels/types.ts` 2 004, `core/src/sentinels/reviewDue.ts` 2 059 (the model), `core/src/memory/notes.ts`
    20 208, `contracts/src/api/memory.ts` 46 425, `apps/api/src/routes/memory.ts` 15 576, `tests/data.settings.test.ts`
    46 593 (the settings leaf pin), the new rules, KPI maths and task writer ≈ 18 000 = ≈ 239 KB → ≈ 60k
  - S4 (C52-C57): `core/src/execution/launch.ts` 3 908, `core/src/skills/catalog.ts` 22 037, `contracts/src/skills.ts`
    4 486, `contracts/src/settings.ts` 23 761 again (`memorySkills`), `core/src/runs/runManager.ts` ≈ 10 000 of 76 015 (the
    artifacts and the finish), `core/src/security/safeFs.ts` 19 259, the new `skills/dashboard-answer/SKILL.md` ≈ 4 000, the
    new validator and renderer ≈ 16 000, the dashboards route again ≈ 12 000 = ≈ 115 KB → ≈ 29k
  - cross-cutting, API (C58-C64): `tests/helpers/routeScopes.ts` 8 818, `tests/helpers/contractWorld.ts` 39 089,
    `tests/api.refusals.test.ts` 23 916, `docs/security.md` ≈ 15 000 of 66 848, `apps/api/src/server.ts` ≈ 10 000 of 44 280
    (the credential lists), `contracts/src/api/errors.ts` 10 005, `tests/api.openapi.test.ts` 32 065,
    `tests/security-reads.test.ts` ≈ 10 000 of 101 206, `tests/sdk.instances.test.ts` 21 846, `legal/PRIVACY.md` 25 412,
    `tests/legal.network.test.ts` ≈ 8 000 of 63 625 = ≈ 204 KB → ≈ 51k
  - S5 (C65-C91): `moldura/nav.ts` 1 572, `moldura/Sidebar.tsx` 4 233, `moldura/Today.tsx` 2 669, `moldura/moldura.css`
    15 620, `desktop/apps.tsx` 5 098, `desktop/appRows.tsx` 2 177, `nucleo/scenes.ts` 3 974, `nucleo/sceneViews.ts` 679,
    `nucleo/index.tsx` ≈ 8 000 of 33 988, `commands/global.ts` 12 418, `commands/registry.ts` 12 630, `i18n.ts` ≈ 8 000 of
    58 710, `components/primitives.tsx` 7 383, `ui/Menu.tsx` 4 818, `ui/Dialog.tsx` 8 409, `ui/Switch.tsx` 1 275,
    `ui/Tooltip.tsx` 3 693, `ui/ui.css` 14 347, `components/Markdown.tsx` 12 114, `brain/natureza.tsx` 6 874,
    `runs/sparkline.ts` 1 780, `theme.css` ≈ 10 000 of 79 371, `queries.ts` 9 064, `api.ts` ≈ 8 000 of 34 218, `apiCall.ts`
    3 497, `hooks/useNotifications.ts` ≈ 6 000 of 20 978, `hooks/notificationText.ts` 6 228, `views/Trends.tsx` 8 419 (the
    analogue: one series, table view), `App.tsx` ≈ 6 000 of 17 141, `brain/noteEvents.ts` 962, `brain/state.ts` 9 054, the
    new page, header, eight widgets, two modals, scene, stylesheets and locales ≈ 80 000 = ≈ 285 KB → ≈ 71k
  - cross-cutting, screens (C92-C97): `gallery/main.tsx` 29 165, `tests/e2e/a11y.spec.ts` 17 550, `tests/e2e/shell.ts`
    11 753, `tests/e2e/reviews.spec.ts` 16 469 (the model), `tests/bundle-size.test.ts` 10 659,
    `scripts/bundle-baseline.json` 5 339, `commands/commands.source.test.ts` 37 992, `typography.test.ts` ≈ 10 000 of
    42 961, `nucleo/shell.test.ts` 3 502, `tests/e2e/nucleo-shell.spec.ts` ≈ 8 000 of 65 024 = ≈ 150 KB → ≈ 38k
  - slices alone ≈ 54k + 60k + 60k + 29k + 51k + 71k + 38k = ≈ 363k; the new tests (twelve root files ≈ 200 KB, eight UI
    files ≈ 95 KB with `brain/reviews/testkit.tsx` 6 830 read as the kit's model, and `tests/e2e/dashboards.spec.ts`
    ≈ 25 KB: ≈ 327 KB) add ≈ 82k: ≈ 445k in all, over 150k
- Intended cut, at the surface boundaries (batches sequential, each only on green):
  - **A** (the definition, the evaluator, the index of tasks and the sources, core and API): S1 + S2 ≈ 54k + 60k = ≈ 114k,
    plus `tests/paineis.routes.test.ts`, `tests/paineis.refresh.test.ts`, `tests/paineis.index.test.ts`,
    `tests/paineis.sources.test.ts`, the S1-S2 half of `tests/paineis.layer.test.ts` and of
    `tests/paineis.localday.test.ts` ≈ 100 KB → ≈ 25k = ≈ 139k; C1-C36
  - **B** (KPIs, highlights, reminders, the tasks route, the question and the export): S3 + S4 ≈ 60k + 29k = ≈ 89k, plus
    `tests/paineis.kpi.test.ts`, `tests/paineis.localhour.test.ts`, `tests/paineis.highlights.test.ts`,
    `tests/paineis.tasks.test.ts`, `tests/paineis.question.test.ts` and the rest of the layer and local-day files ≈ 80 KB →
    ≈ 20k = ≈ 109k; C37-C57
  - **C** (the API's cross-cutting checks): ≈ 51k, plus `tests/paineis.contract.test.ts` ≈ 22 KB → ≈ 6k = ≈ 57k; C58-C64
  - **D** (the screens and their cross-cutting checks): S5 + C92-C97 ≈ 71k + 38k = ≈ 109k, plus the eight UI test files and
    `tests/e2e/dashboards.spec.ts` ≈ 120 KB → ≈ 30k = ≈ 139k; C65-C97
  - B + C ≈ 166k and A + C ≈ 196k are over the budget, so C stays apart; A lands first because B's KPIs, highlights and
    question read A's evaluator and sources, C asserts the routes of A and B, and D calls the routes of A and B
- Mechanism: handoff, four batches A, B, C, D (owner, 31/10/2026)

Status of batch A (updated in the commit that closes each piece):

- the definition, the evaluation and the snapshot (S1: C1-C18) and the tasks in the index and the eleven sources (S2:
  C19-C36), with migration 26, `due` in `FRONT_MATTER_FIELDS`, the six routes of `/api/dashboards` (export and
  `PUT /api/memory/tasks` are batch B's), `dashboard.refreshed` v1, one connector cache per service and the service's
  one-minute clock: closed, every proof green in `tests/paineis.routes.test.ts`, `tests/paineis.refresh.test.ts`,
  `tests/paineis.index.test.ts`, `tests/paineis.sources.test.ts`, `tests/paineis.layer.test.ts`,
  `tests/paineis.localday.test.ts` and `tests/paineis.contract.test.ts` (C18). Two clauses can only be vacuous before
  batch B: C14's "no highlight and no reminder names it" (`highlights` is `[]` and no reminder exists until S3's rules)
  and C12's `highlights` key (always `[]`); batch B re-runs both proofs over its rules
