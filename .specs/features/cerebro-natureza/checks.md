# Cérebro: natureza da informação checks

Profile: ui
Plan: `.specs/features/cerebro-natureza/plan.md`
Design: `.specs/features/cerebro-natureza/design.md` (binding for the screens)

94 checks in 5 slices + cross-cutting · 6 one-way doors (door 4 gains `action: "restore"`, amendment 7) · 2 open
questions of the plan (1 `open`, 2 `blocks go-live`), both with their defaults in force (this vocabulary; the daily
reminder on, at most one notification a day), and 8 new ones (plan.md, "Emendas", questions 3-10), none blocking · 24
amendments for what `cerebro-correcoes`, `cerebro-contextos`, `cerebro-organizar`, `cerebro-vista-notas` and
`cerebro-faxina-guiada` built after the plan and for what this derivation found (`plan.md`, "Emendas depois da aprovação";
each names the checks that resolve it).

The plan's slices mix the core, the API and the screens; here S1-S4 are the core and the API of plan S1-S4 and S6, and S5
is every screen of plan S2, S3, S5 and S6, so a batch cut never splits a check slice.

Every proof is `npx vitest run <file> -t "<C-id> "` from the repository root (root tests) or
`npm run test -w apps/command-centre -- <file> -t "<C-id> "` (UI tests); a test title starts with its check id followed by a
space. `E2E` proofs use `MORDOMO_E2E_PORT=4901 npx playwright test --config tests/e2e/playwright.config.ts <spec> -g "<C-id> "`.
`tests/natureza.layer.test.ts` calls the deciding code itself (the nature reader, the passage parser, the recall's labelling,
`reviewsDue`, the decision rules, the suggestion), with no HTTP (`Test policy` rows 1 and 2); the other root files go
through `app.inject` against `buildServer` over a real home, or run the CLI as `tests/contexts.cli.test.ts` does. "Now" in
every claim is a fixed clock the test sets, "today" is its local day as `sentinelDay` writes it, and an age of N days is
`last_reviewed` (or `mtime`) N local days before today. A claim that names a status and a code asserts both. A claim that
says "as before" asserts the value by name (L-044); a claim about a stored value reads back what the route wrote, never a
row the test seeded (L-051); every list writer has a one-item case (L-050).

## Checks

### S1 - o índice sabe a natureza (plan S1) · 7 files · 108 KB · ~27k

**C1** - A Markdown file under an indexed folder whose front matter holds `natureza: plano` and `escopo: equipe` is
answered by `GET /api/memory/search?q=<a word of it>` with `natureza: "plano"` and `escopo: "equipe"` on its hit, and its
`fields` hold `natureza: "plano"` and `escopo: "equipe"` (AC 1, door 1)
Proof: `npx vitest run tests/natureza.index.test.ts -t "C1 "`

**C2** - The nature is read through the closed lists, one asserted case per row, at the route and at the reader's own
layer: `natureza: talvez` → `natureza: null` on the hit while `fields.natureza` stays `"talvez"` (C3's door 6, amendment
2); `escopo: publico` → `escopo: null`; `natureza: Opinião`, `natureza: PLANO` and `natureza: " plano "` → `opiniao`,
`plano`, `plano`; a body line `natureza:: fato` under a header `natureza: plano` → `fato`; a body line `natureza:: talvez`
under a header `natureza: plano` → `null`; the index pass over these seven files emits `index.finished` and no
`index.failed`, and adds exactly 7 files (`IndexStats` has no `errors` key; round 1); a `natureza: talvez` row stored by a pass before this feature reads `null` with no new pass (AC 2, door 1,
amendment 2)
Proof: `npx vitest run tests/natureza.index.test.ts -t "C2 "`
Proof: `npx vitest run tests/natureza.layer.test.ts -t "C2 "`

**C3** - The cadence read from `review_every`, one asserted case per value: `45d` → 45 days, `1d` → 1, `3650d` → 3650,
`never` → never, `45D` → 45; `0d`, `3651d`, `5000d`, `semana` and `30` → no cadence (the file falls back to `byType` or
`cadence`, C30) (AC 3, door 1, amendment 2)
Proof: `npx vitest run tests/natureza.layer.test.ts -t "C3 "`

**C4** - A file whose lines 5-7 are `> [!plano] Lançamento`, `> em março` and `> com 3 turmas`, followed by a blank line,
has exactly one `note_passages` row `{ natureza: "plano", start_line: 5, end_line: 7 }` (1-based, as `note_links.line`);
`> [!FATO]` on its own line opens a `fato` passage; a block with no title after the marker is a passage; a `>` line right
after a passage's last line extends it (AC 4, door 2)
Proof: `npx vitest run tests/natureza.index.test.ts -t "C4 "`
Proof: `npx vitest run tests/natureza.layer.test.ts -t "C4 "`

**C5** - No passage is stored, one asserted case per form: a `> [!plano]` block inside a ` ``` ` fence, one inside a
`~~~` fence, one inside the front matter, `> [!note]`, `> [!planos]`, and `[!plano]` on a line that does not start with
`>` (AC 5, door 2)
Proof: `npx vitest run tests/natureza.layer.test.ts -t "C5 "`

**C6** - The passage writer, with one item and with several: a note with one `> [!opiniao]` block has 1 row; with three
blocks (`fato`, `plano`, `relato`) it has 3 rows in line order; after the file is changed to hold none and indexed again it
has 0 rows (the rows of a file are replaced, never added to) (door 2, L-050)
Proof: `npx vitest run tests/natureza.index.test.ts -t "C6 "`

**C7** - After migration 25, `PRAGMA table_info(note_passages)` equals `file_id INTEGER NOT NULL`, `natureza TEXT NOT
NULL`, `start_line INTEGER NOT NULL`, `end_line INTEGER NOT NULL` with the primary key `(file_id, start_line)`, and
`PRAGMA table_info(review_state)` equals `path TEXT PK`, `last_reviewed INTEGER`, `snooze_until INTEGER`, `never INTEGER
NOT NULL DEFAULT 0`, `updated_at INTEGER NOT NULL` (`toEqual` over name, type, notnull, default, pk); running the
migrations again leaves the same schema; migrations 22, 23 and 24 are still `drop-file-links`, `run-context` and
`cleanup`; the rows of `files`, `note_links` and `cleanup_decisions` of a database migrated from 24 are the same before and
after (AC 6, doors 2 and 6, amendment 1)
Proof: `npx vitest run tests/natureza.layer.test.ts -t "C7 "`

**C8** - On a database migrated to 25 with 3 Markdown files indexed before it (no `note_passages` rows, no marker), the next
index pass fills the passages of the 2 that hold callouts from the stored text without opening them (the read audit of
`tests/fsReadAudit.ts` and a spy on `readWorkspaceText` see no read of those paths) and writes the marker; a pass stopped
after the first slice leaves no marker, and the pass after it fills the rest (AC 6, amendment 1)
Proof: `npx vitest run tests/natureza.index.test.ts -t "C8 "`

**C9** - When an index pass removes a file, its `note_passages` rows go in the same write transaction as its `files` row
(a failure injected right after the `DELETE FROM files` leaves both the `files` row and the passages), and its
`review_state` row stays with the same values (AC 7)
Proof: `npx vitest run tests/natureza.index.test.ts -t "C9 "`

**C10** - A `snooze` stored through `POST /api/memory/reviews` on a file outside `memory/` still applies after the file
leaves the index and comes back with another `files.id` (the item is still not due before `snooze_until`); after the
file is renamed, the new path has no `review_state` row and is listed when its cadence says so (door 6)
Proof: `npx vitest run tests/natureza.index.test.ts -t "C10 "`

### S2 - busca e recall segregados, a CLI e os agentes (plan S2) · 10 files · 166 KB · ~41k

**C11** - `GET /api/memory/search?q=preço&natureza=fato` returns only files whose nature is `fato` (a `plano`, an
unclassified and a `natureza: talvez` note with the same word are absent), and `natureza=fato,relato` returns the `fato` and
the `relato` notes and no other; the same two cases hold in `mode=text`, `mode=semantic` (the `hash` embeddings) and
`mode=auto`, one asserted case per mode (AC 8)
Proof: `npx vitest run tests/natureza.search.test.ts -t "C11 "`

**C12** - `escopo=pessoal` returns only files whose `escopo` is `pessoal`; `natureza=fato&escopo=pessoal` returns only the
file that is both (a `fato`/`equipe` and a `plano`/`pessoal` note are absent) (AC 9)
Proof: `npx vitest run tests/natureza.search.test.ts -t "C12 "`

**C13** - Each refused search answers `400 validation`, alone: `natureza=talvez`, `natureza=Fato`, `natureza=` (empty),
`natureza=fato,talvez`, `escopo=publico`; `context=nao-existe&natureza=fato` answers `404 context_not_found` and
`mode=semantic&natureza=fato` with the semantic search off answers `409 semantic_disabled`, both as before (AC 9,
amendment 5)
Proof: `npx vitest run tests/natureza.search.test.ts -t "C13 "`

**C14** - Every search hit carries the keys `natureza` and `escopo`: with one hit (`limit=1`) and with three, a classified
hit has the values, and an unclassified one has `natureza: null` and `escopo: null` (the keys present, not missing) (AC 10,
L-050)
Proof: `npx vitest run tests/natureza.search.test.ts -t "C14 "`

**C15** - The nature of a recall excerpt, one asserted case per row of AC 11, at the route and at its own layer: an excerpt
whose lines lie within a `> [!plano]` passage of a `natureza: fato` note → `plano`; an excerpt of that note outside every
passage → `fato`; an excerpt of `<home>/memory/MEMORY.md` under `## Open loops` → `plano` (door 3); an excerpt of a note with
no nature and no passage → `null` (AC 11)
Proof: `npx vitest run tests/natureza.search.test.ts -t "C15 "`
Proof: `npx vitest run tests/natureza.layer.test.ts -t "C15 "`

**C16** - Door 3's table, one asserted case per heading: in `<home>/memory/MEMORY.md`, `## Facts` → `fato`, `## Decisions`
→ `fato`, `## Open loops` → `plano`, `## Reflections` → `opiniao`, `## Superseded` → `fato`; in
`<home>/memory/journal/2026-10-29.md`, `## Decisions` → `fato`, `## Open loops` → `plano`, `## Today` → `relato`, `## Runs` →
`relato`; `## Notas` in `MEMORY.md` → `null`; `## Facts` in `memory/notes/x.md` (not a generated file) → `null`; `### Facts`
(level 3) in `MEMORY.md` → `null` (door 3, AC 16, amendment 14)
Proof: `npx vitest run tests/natureza.layer.test.ts -t "C16 "`

**C17** - A `natureza: fato` note whose best section `## Preço` holds the line `O plano anual custa R$ 900.` and, after
it, a `> [!plano]` block `> Vamos subir para R$ 1 200.`, gives a recall excerpt of that section with `natureza: "fato"`
(the excerpt holds the passage but does not lie within it: the approved AC 11, pending question 4) (AC 11, amendment 14)
Proof: `npx vitest run tests/natureza.layer.test.ts -t "C17 "`

**C18** - `GET /api/memory/recall?q=preço anual&natureza=fato` over a `natureza: plano` note that scores higher than a
`natureza: fato` note on the same question returns the `fato` note's excerpt and no item whose `natureza` is not `fato`; an
unclassified note's excerpt is not returned; a `natureza: plano` note whose best section lies within a `> [!fato]` passage
is returned with `natureza: "fato"` (AC 12)
Proof: `npx vitest run tests/natureza.search.test.ts -t "C18 "`

**C19** - `GET /api/memory/recall?…&escopo=equipe` returns only excerpts whose `escopo` is `equipe`; `natureza=talvez`,
`natureza=` and `escopo=publico` answer `400 validation`; `context=nao-existe` answers `404 context_not_found` as before
(AC 12, Surface, amendment 5)
Proof: `npx vitest run tests/natureza.search.test.ts -t "C19 "`

**C20** - Each `answerContext[]` item carries `natureza` and `escopo` (the file's `escopo`, or `null`) and keeps, as before,
`path`, `section`, `excerpt`, `score`, `why` and `via` with the values the same fixture gave before this feature (`toEqual`
over those six keys of a recorded answer); the MCP tool `recall` prints, as before, `## <path> § <section> (score <n>)` and
the excerpt, with no label (Impact, amendment 11, question 7, L-044)
Proof: `npx vitest run tests/natureza.search.test.ts -t "C20 "`

**C21** - `mordomo recall "<pergunta>"` prints each excerpt's header line, colours stripped, starting with the label, one
asserted case per nature: `plano` → `[Plano — ainda não é realidade] ● <path> § <section> (score <n>)`, `hipotese` →
`[Hipótese] ● …`, `opiniao` → `[Opinião] ● …`, `null` → `[Não classificado] ● …`; a `fato` and a `relato` excerpt print
`● <path> § <section> (score <n>)` with no label, as before (AC 13, amendment 12)
Proof: `npx vitest run tests/natureza.cli.test.ts -t "C21 "`

**C22** - For a note with `status: archived` and `abandoned: 2026-09-01`, the excerpt keeps `natureza` as stored and the
CLI header line ends with `(abandonado em 2026-09-01)`; an excerpt of `## Superseded` in `MEMORY.md` ends with
`(substituído)`; `abandoned` is in `files.fields` of that note; `--json` prints the result with `natureza` and `escopo` on
each `answerContext[]` item (AC 14, door 3, amendments 12 and 13)
Proof: `npx vitest run tests/natureza.cli.test.ts -t "C22 "`

**C23** - `mordomo recall "<pergunta>" --natureza fato` prints only `fato` excerpts, and `--escopo pessoal` only `pessoal`
ones; `--natureza talvez` exits with code 2, prints `fato, opiniao, plano, hipotese, relato` on stderr, and leaves
`recall.stats` in `meta` byte for byte (Observable, amendment 12)
Proof: `npx vitest run tests/natureza.cli.test.ts -t "C23 "`

**C24** - After `mordomo sync --apply`, the compiled `AGENTS.md` and `CLAUDE.md` (both views, one asserted case each) end
with the six lines of `design.md`'s "Texto do bloco para os agentes", exactly, as the last section, after `## Ground
rules` (an index assertion: the block's heading comes after `## Ground rules` and nothing but the block follows it) (AC 15,
amendment 11)
Proof: `npx vitest run tests/natureza.agents.test.ts -t "C24 "`

**C25** - `buildRunPrompt` for a skill in `settings.memorySkills` holds the same six lines right after the locations block
(the memory folder and the API lines) and before the resources line; with a work context, the context block is still
first; for a skill not in `settings.memorySkills` the block is absent (AC 15, amendment 11)
Proof: `npx vitest run tests/natureza.agents.test.ts -t "C25 "`

**C26** - `skills/consolidate-memory/SKILL.md` names the five section titles `## Facts`, `## Decisions`, `## Open loops`,
`## Reflections` and `## Superseded`, each as written, and an excerpt under `## Reflections` of a `MEMORY.md` written in
that shape is recalled with `natureza: "opiniao"` (AC 16, door 3)
Proof: `npx vitest run tests/natureza.agents.test.ts -t "C26 "`

### S3 - o que venceu a revisão e a cobrança diária (plan S3) · 17 files · 238 KB · ~60k

**C27** - A note with `natureza: opiniao`, no `review_every`, no `type` and `last_reviewed` 91 days ago is an item of
`GET /api/memory/reviews?kind=due` with `dueSince` = the day before today; at 90 days it is an item with `dueSince` = today;
at 89 days it is not an item (AC 17, amendment 6)
Proof: `npx vitest run tests/natureza.reviews.test.ts -t "C27 "`
Proof: `npx vitest run tests/natureza.layer.test.ts -t "C27 "`

**C28** - The base of the due date, one asserted case per row: no `last_reviewed` and `mtime` 91 days ago → due, by the
`mtime`; `last_reviewed: ontem` and `mtime` 91 days ago → due, by the `mtime`; `last_reviewed` 100 days ago and a
`review_state.last_reviewed` (stored by a `keep`, C46) 10 days ago → not due, and `lastReviewed` is that later day (AC 18,
amendment 6)
Proof: `npx vitest run tests/natureza.layer.test.ts -t "C28 "`
Proof: `npx vitest run tests/natureza.reviews.test.ts -t "C28 "`

**C29** - A `natureza: opiniao` note last reviewed 400 days ago with `review_every: never` is not due; the same note with no
`review_every` and a `review_state.never = 1` stored by `action: "never"` on a copy outside `memory/` (C49) is not due; one
asserted case per nature (`fato`, `opiniao`, `plano`, `hipotese`, `relato`) with `review_every: never` and age 400 is not due
(AC 19)
Proof: `npx vitest run tests/natureza.layer.test.ts -t "C29 "`

**C30** - The cadence precedence, one asserted case per row: `type: status` + `natureza: fato`, 31 days → due, 29 → not
(`byType.status` 30 over `cadence.fato` never); `type: Status` reads as `status`; `type: status` + `review_every: 10d`, 11
days → due (the note wins over `byType`); `type: conceito` + `natureza: opiniao`, 179 days → not due, 181 → due (`byType` over
`cadence`); with no `type` and no `review_every`, `plano` at 31 → due and 29 → not, `hipotese` at 61 → due and 59 → not,
`opiniao` at 91 → due, `relato` and `fato` at 4 000 → not; a note with none of `natureza`, `type`, `review_every` at 4 000
days → not due (AC 20, door 5, amendment 18)
Proof: `npx vitest run tests/natureza.layer.test.ts -t "C30 "`

**C31** - After `action: "snooze"` with `days: 14` on a due note, the note is not an item of `kind=due` until now + 14 days
and is an item again at now + 14 days + 1 ms (fake clock); a snoozed note under `memory/notes` with no nature is not an item
of `kind=unclassified` until then either (AC 21, amendment 6)
Proof: `npx vitest run tests/natureza.reviews.test.ts -t "C31 "`

**C32** - For a context whose paths are `<R>/projetos/app` (`ok`) and a deleted folder (`missing`), `context=<id>` lists the
due notes under `<R>/projetos/app` and under `<home>/memory/notes/<id>/`, and never a due note of `<R>/projetos/app-antigo/`
nor one left in the index under the missing path; `context=all` and no `context` list all of them; `context=nao-existe`
answers `404 context_not_found` (AC 22, amendment 5)
Proof: `npx vitest run tests/natureza.reviews.test.ts -t "C32 "`
Proof: `npx vitest run tests/natureza.layer.test.ts -t "C32 "`

**C33** - A due note excluded by today's policy (a user exclude added after the pass, a secret-named `.env.md`) is listed
neither in `kind=due` nor in `kind=unclassified`, and is not counted in `total` (AC 23)
Proof: `npx vitest run tests/natureza.reviews.test.ts -t "C33 "`

**C34** - `GET /api/memory/reviews` answers `200 { items, total, nextDue }`; each `kind=due` item has exactly the keys
`path`, `name`, `natureza`, `type`, `escopo`, `lastReviewed`, `dueSince`, `editable`, `mtime` (`toEqual` over the key set),
and each `kind=unclassified` item those and `suggested`; `items` are ordered by `dueSince`, oldest first, and by path on a
tie (three notes due 40, 10 and 10 days ago, the last two named `b.md` and `a.md`, come as 40, `a.md`, `b.md`); `editable` is
`true` for `memory/notes/a.md` and `false` for a file of an indexed folder; `natureza=plano` and `escopo=equipe` narrow
`items` and `total`; `kind` missing reads `due`; `kind=other`, `limit=0`, `limit=201`, `natureza=talvez` and `escopo=publico`
each answer `400 validation` (Surface, amendment 6)
Proof: `npx vitest run tests/natureza.reviews.test.ts -t "C34 "`

**C35** - The list's length and cut: with exactly one due note, `items` has 1 entry and `total` is 1; with 25 due notes and
no `limit`, `items` has the 20 oldest (`maxPerDay`) and `total` is 25; with `limit=5`, the 5 oldest; with
`memory.reviews.maxPerDay` = 3 and no `limit`, 3 (Assumptions "Teto da fila", amendment 6, L-050)
Proof: `npx vitest run tests/natureza.reviews.test.ts -t "C35 "`

**C36** - With no due note and two notes that fall due in 12 and 30 days, `items` is `[]`, `total` 0 and `nextDue` today +
12 days; with no note that has a cadence, `nextDue` is `null` (AC 43, amendment 6)
Proof: `npx vitest run tests/natureza.reviews.test.ts -t "C36 "`

**C37** - What is never listed, one asserted case per place: a `natureza: opiniao` note aged 400 days under
`<home>/memory/archive/2026-10-01-ab12cd34/` is not in `kind=due` nor in `kind=unclassified`; a `natureza: plano` note with
`status: archived` aged 400 days is not in `kind=due`; a `natureza: plano` note with `status: active` aged 400 days is
(amendment 6)
Proof: `npx vitest run tests/natureza.layer.test.ts -t "C37 "`

**C38** - `GET /api/settings` of a fresh home answers `memory.reviews` = `{ cadence: { opiniao: "90d", plano: "30d",
hipotese: "60d", relato: "never", fato: "never" }, byType: { status: "30d", conceito: "180d" }, maxPerDay: 20 }` and
`sentinels.reviewDue` = `{ enabled: true }`; `PUT /api/settings {memory:{reviews:{maxPerDay:10}}}` stores `memory.reviews` =
`{ cadence: <the defaults>, byType: <the defaults>, maxPerDay: 10 }` and keeps `memory.notes`, `memory.cleanup`,
`memory.journalBudgetTokens`, `memory.agentStance` and `memory.embeddings` at their earlier values (read back from
`GET /api/settings`); `cadence.opiniao: "0d"`, `cadence.plano: "3651d"`, `byType.status: "semana"`, `maxPerDay: 0` and
`maxPerDay: 201` each answer `400 validation` and store nothing (door 5, amendment 17, question 2 default)
Proof: `npx vitest run tests/natureza.sentinel.test.ts -t "C38 "`

**C39** - After `PUT /api/settings` with `memory.reviews.cadence.opiniao` = `"30d"`, the next `GET /api/memory/reviews`
lists an `opiniao` note aged 31 days that it did not list before the change (the list reads the settings at each request)
(door 5, amendment 17)
Proof: `npx vitest run tests/natureza.sentinel.test.ts -t "C39 "`

**C40** - With three due notes and no `reviewDue` notification today, `SentinelRunner.hourly()` emits exactly one
`sentinel.fired` whose payload equals `{ sentinel: "reviewDue", title: "3 items to review", body, severity: "info", href:
"/brain/reviews", dedupeKey: "sentinel:reviewDue:<today>:all", messageParams: { count: 3, display: "3" } }` (`toEqual`, the
`body` a non-empty text); with exactly one due note it emits one with `count: 1`; a second `hourly()` the same day emits none; one the next day emits one with the new day in the
key; with no due note, none (AC 24, door 5, amendment 16)
Proof: `npx vitest run tests/natureza.sentinel.test.ts -t "C40 "`
Proof: `npx vitest run tests/natureza.layer.test.ts -t "C40 "`

**C41** - With `settings.sentinels.reviewDue.enabled` = `false` and three due notes, `hourly()` emits no `reviewDue` event
and creates no inbox row, and `silentRoutine` still runs; with the settings of a fresh home (`enabled` absent from
`settings.json`) it emits one (AC 25, question 2 default)
Proof: `npx vitest run tests/natureza.sentinel.test.ts -t "C41 "`

**C42** - The inbox row the recorder makes from the event has `href` `/brain/reviews`, `messageKey` `sentinel.reviewDue`
and `messageParams` `{ count, display }`; with 3 due notes `display` is `"3"`, with exactly 20 it is `"20"`, and with 21 it is
`"20+"` and `title` is `"20+ items to review"` (AC 26, amendment 16)
Proof: `npx vitest run tests/natureza.sentinel.test.ts -t "C42 "`

**C43** - When the `reviewDue` query throws (the test makes `review_state` unreadable), `hourly()` resolves, `onError` is
called once with `"reviewDue"`, and the `silentRoutine` and `connectorDelta` checks of the same pass still emit their events
(Observable "scheduled task", amendment 16)
Proof: `npx vitest run tests/natureza.sentinel.test.ts -t "C43 "`

**C44** - `SENTINEL_IDS` holds `reviewDue`; the v1 schema of `sentinel.fired` accepts `sentinel: "reviewDue"` and refuses
`sentinel: "other"`; the v1 fixture `tests/fixtures/events/v1/sentinel.fired.reviewDue.json` parses; `EVENT_VERSIONS` of
`sentinel.fired` is still `[1]` (door 5, amendment 16)
Proof: `npx vitest run tests/natureza.contract.test.ts -t "C44 "`
Proof: `npx vitest run tests/events.contract.test.ts -t "C27 the v1 fixtures keep parsing"`
Proof: `npx vitest run tests/events.contract.test.ts -t "C29 docs/events.md equals the generated text"`

### S4 - decidir num clique, e classificar (plan S4, S6) · 8 files · 116 KB · ~29k

**C45** - `POST /api/memory/reviews {path:"<home>/memory/notes/a.md", action:"keep", baseVersion}` on a due `natureza:
opiniao` note answers `200` with `version` = the SHA-256 of the new bytes and `previous: null`; the file's bytes are the
old ones with only `last_reviewed: <today>` changed (or added before the closing `---`), written bare; the next
`GET /api/memory/reviews?kind=due` (read back, never seeded) does not list it; `review_state` has no row for it (AC 27,
L-051)
Proof: `npx vitest run tests/natureza.decisions.test.ts -t "C45 "`

**C46** - `action: "keep"` on a due file of an indexed folder outside `memory/` answers `200` with no `version`, stores
`review_state.last_reviewed` = now (read back from `GET`'s `lastReviewed` = today and from the table), leaves the file's
bytes, `mtime` and inode as they were, and the next `GET` does not list it (AC 28, L-051)
Proof: `npx vitest run tests/natureza.decisions.test.ts -t "C46 "`

**C47** - `action: "keep"` on files of `memory/` that are not editable goes to `review_state` and writes no file, one
asserted case per place: `memory/journal/2026-10-01.md`, `memory/areas/vendas.md`, `memory/ROUTER.md`,
`memory/contexts/x.md`, `memory/notes/b.markdown` (amendment 4)
Proof: `npx vitest run tests/natureza.decisions.test.ts -t "C47 "`

**C48** - `action: "snooze"` with `days: 14` stores `review_state.snooze_until` = now + 14 × 86 400 000 ms, for an editable
note and for a file outside `memory/`, one case each, and writes neither file (bytes and `mtime` unchanged); `days` 1 and 365
are stored; `days` 0, 366, 1.5 and missing each answer `400 validation` and store nothing (AC 29)
Proof: `npx vitest run tests/natureza.decisions.test.ts -t "C48 "`
Proof: `npx vitest run tests/natureza.layer.test.ts -t "C48 "`

**C49** - `action: "never"` gives an editable note the line `review_every: never` (its other bytes unchanged) and no
`review_state` row, and gives a file outside `memory/` `review_state.never = 1` with the file unchanged; each then leaves
the due list (AC 30)
Proof: `npx vitest run tests/natureza.decisions.test.ts -t "C49 "`

**C50** - `action: "became_fact"` on an editable `natureza: plano` note writes, in its front matter, `natureza: fato`, `was:
plano`, `became_fact: <today>` and `last_reviewed: <today>`, each date bare (the lines read exactly so), and every other byte
as it was; with `fact: { subject: "curso", predicate: "lançamento", object: "março", validFrom: <ms> }` it asserts one fact
with those values, `source_path` = the note's path and `valid_from` = that `validFrom`, and the answer's `fact` is it; with
no `validFrom`, `valid_from` = now; with no `fact`, `GET /api/memory/facts` has no new row; on a `hipotese` note `was` is
`hipotese` (AC 31, amendments 3 and 8)
Proof: `npx vitest run tests/natureza.decisions.test.ts -t "C50 "`

**C51** - The order of `became_fact`'s two writes: with a stale `baseVersion` it answers `409 edit_conflict` and asserts no
fact; with `fact.subject` = `""` it answers `400 validation` before anything is written (the note's bytes and the facts
table unchanged); when the fact's assertion is made to throw after the note was written, the answer is `500` and the note
keeps the new front matter (the partial outcome is the note written and no fact) (AC 31, L-049)
Proof: `npx vitest run tests/natureza.decisions.test.ts -t "C51 "`

**C52** - `action: "abandon"` on an editable `natureza: plano` note writes `status: archived` and `abandoned: <today>` (bare),
keeps `natureza: plano`, and leaves the file at the same path (amendment 24: not the same inode), with no file created or removed under
the home (a listing of every name before and after); the note then leaves the due list (AC 32, amendment 6)
Proof: `npx vitest run tests/natureza.decisions.test.ts -t "C52 "`

**C53** - `became_fact`, `abandon` and `classify` (with `natureza: "fato"`) each answer `403 note_not_editable`, write nothing
and leave `review_state` as it was, one asserted case per place and action: a file of an indexed folder outside `memory/`,
`memory/ROUTER.md`, `memory/areas/vendas.md`, `memory/journal/2026-10-01.md`, `memory/contexts/x.md` (AC 33, amendment 4)
Proof: `npx vitest run tests/natureza.decisions.test.ts -t "C53 "`

**C54** - With a `baseVersion` that is not the file's, `keep`, `never`, `became_fact`, `abandon` and `classify` on an editable
note each answer `409 edit_conflict`, leave the file byte for byte, leave `review_state` without a row for it, and assert no
fact (AC 34)
Proof: `npx vitest run tests/natureza.decisions.test.ts -t "C54 "`

**C55** - The other refusals, each alone and writing nothing: a `path` that names no indexed file → `404 not_found` with no
`review_state` row; a path excluded by today's policy → `404 not_found`; an editable note reached through a link on the way
→ `403 forbidden_path`; a note whose front matter has no closing `---` → `409 front_matter_unreadable`; a note past the
editing limit → `413 note_too_large`; `action: "delete"`, `classify` without `natureza`, `classify` with `natureza:
"talvez"`, and `keep` on an editable note without `baseVersion` → `400 validation` (door 4, amendment 4)
Proof: `npx vitest run tests/natureza.decisions.test.ts -t "C55 "`

**C56** - Every `POST /api/memory/reviews` answer carries `previous`: `null` for a file with no `review_state` row, and the
row as it was (`{ lastReviewed, snoozeUntil, never }`) for one with a row; `action: "restore"` with `state` = the `previous`
of a `snooze` on a file that had a `keep` row puts the row back to exactly those values (read back), with `state: null`
deletes the row, writes no file, and works on an editable note too; after a restore the file is listed (or not) as before
the decision (door 4, AC 41, amendment 7, question 5)
Proof: `npx vitest run tests/natureza.decisions.test.ts -t "C56 "`
Proof: `npx vitest run tests/natureza.layer.test.ts -t "C56 "`

**C57** - `action: "restore"` without `state`, with `state.never` = 2, and with `state.snoozeUntil` = `"amanhã"` each answer
`400 validation` and leave the row as it was (door 4, amendment 7)
Proof: `npx vitest run tests/natureza.decisions.test.ts -t "C57 "`

**C58** - After each decision, one asserted case per action (`keep`, `snooze`, `never`, `abandon`, `became_fact`, `classify`,
`restore`), the next `GET /api/memory/reviews` reflects it (read back) and `requestIndexPaths` was called exactly once with
`[<that path>]` (AC 36)
Proof: `npx vitest run tests/natureza.decisions.test.ts -t "C58 "`

**C59** - `action: "classify"` with `natureza: "plano"` on an unclassified editable note writes only `natureza: plano` in its
front matter (no `last_reviewed`, no other line changed) and the note leaves `kind=unclassified` (AC 48)
Proof: `npx vitest run tests/natureza.decisions.test.ts -t "C59 "`

**C60** - `GET /api/memory/reviews?kind=unclassified` lists the Markdown notes under `<home>/memory/notes/` with no nature
(one with no `natureza`, one with `natureza: talvez`, one `_index.md`, one `_resumo.md`), each with `suggested` as a nature
or `null`, ordered by `mtime`, oldest first; a classified note under `memory/notes/`, a note under `memory/inbox/` and an
unclassified file of an indexed folder are not listed; with exactly one such note, `items` has 1 entry (AC 46, amendment
6, L-050)
Proof: `npx vitest run tests/natureza.reviews.test.ts -t "C60 "`

**C61** - The suggestion, one asserted case per row, at its own layer and through the route: "Vamos lançar em março;
planejamos três turmas." → `plano`; "We will ship it. We plan to grow." → `plano`; "Acho que o preço está alto." → `opiniao`;
"In my view this is wrong." → `opiniao`; "vamos" once and "lançamos" twice → `null`; "vamos" once and "fizemos" once →
`null`; "Vamos lançar. Acho que vai dar certo." → `plano` (the plano rule first); "PLANEJAMOS" and "planejamos" count the
same; a note with none → `null`; the text read is the one the index stored: a file changed on disk after its pass gets the
suggestion of the stored text (AC 47, amendment 20)
Proof: `npx vitest run tests/natureza.layer.test.ts -t "C61 "`
Proof: `npx vitest run tests/natureza.reviews.test.ts -t "C61 "`

**C62** - `GET /api/memory/reviews` of both kinds writes nothing: a hash of every file and folder name under the home and
the indexed folders, and the rows of `review_state`, are the same before and after; walking the TypeScript syntax tree of
`core/src/memory/reviews.ts` and of the suggestion's module, neither imports `node:fs`, `node:fs/promises`,
`security/safeWrite.ts` or `memory/notes.ts`, nor calls `setProperties`, `saveProperties` or `writeWorkspaceFile`, by a
default, namespace, named or renamed import, or a `require`; the walker does not cover, and the claim does not cover, a
dynamic `import()`, a writer received as a parameter, `Reflect`, `eval` or `Function`; its self-tests hold one case per
covered form (AC 48, L-048)
Proof: `npx vitest run tests/natureza.reviews.test.ts -t "C62 "`
Proof: `npx vitest run tests/natureza.layer.test.ts -t "C62 "`

**C63** - Two `action: "keep"` requests on the same editable note with the same `baseVersion`, sent together, give one `200`
and one `409 edit_conflict`, and the note holds one `last_reviewed` line (door 4, Swept concurrency)
Proof: `npx vitest run tests/natureza.decisions.test.ts -t "C63 "`

### Cross-cutting, API · 9 files · 170 KB · ~43k

**C64** - The two routes are in the `API` table as door 4 says (`toEqual` over method, path and scope: `content` for
`GET /api/memory/reviews`, `owner` for `POST /api/memory/reviews`), declare `400 validation`, `403 note_not_editable`, `403
forbidden_path`, `404 not_found`, `404 context_not_found`, `409 edit_conflict`, `409 front_matter_unreadable` and `413
note_too_large` where the claims above answer them, take the `action` values `keep`, `snooze`, `never`, `abandon`,
`became_fact`, `classify` and `restore`, are in `EXPECTED_ROUTE_SCOPES`, in their rows of `docs/security.md`, and each has a
scenario of the refusal probe; the OpenAPI document validates (door 4, AD-024, amendments 4 and 7)
Proof: `npx vitest run tests/natureza.contract.test.ts -t "C64 "`
Proof: `npx vitest run tests/api.openapi.test.ts -t "C16 the document validates"`

**C65** - The entries `memory.search` and `memory.recall` take the query keys `natureza` and `escopo`, and their response
schemas carry `natureza` and `escopo` (`string | null`) on each hit and each `answerContext[]` item, required; a response
that leaves either out fails `validateResponses` with `500 response_contract_violation` (Surface, AD-024)
Proof: `npx vitest run tests/natureza.contract.test.ts -t "C65 "`

**C66** - A device token holding `content` gets `200` from `GET /api/memory/reviews` and one holding only `monitor` gets `403
scope_required`; a device token with every scope gets `403 owner_only` from `POST /api/memory/reviews` and no file or row
changes; the credential of a memory skill's run gets `403 forbidden` from both routes; `RUN_API_READ_ROUTES` and
`RUN_API_WRITE_ROUTES` are unchanged (AC 35, amendment 22)
Proof: `npx vitest run tests/natureza.contract.test.ts -t "C66 "`

**C67** - The raw `fs` allowlist and the module-state list do not grow: the new modules read the index and the database
only, and write through `saveProperties` (Test policy, evidence)
Proof: `npx vitest run tests/security-reads.test.ts -t "C55 the list holds"`
Proof: `npx vitest run tests/security-reads.test.ts -t "finds nothing outside the list"`
Proof: `npx vitest run tests/sdk.instances.test.ts -t "C30 the module-level mutable state"`

**C68** - The cleanup answers as before, by value (amendment 19, question 3): a scan over a `natureza: plano` note aged 400
days, an unclassified note and a note with `review_every: 7d` aged 30 days reports the kinds of C5 only (each finding's
`kind` is one of `duplicate`, `near-duplicate`, `stale`, `orphan`, `broken-link`, `empty-folder`, `large-file`, `untitled`),
the 400-day note as `stale`, and the `review_every: 7d` note not as `stale`; `GET /api/memory/cleanup/inventory` has exactly
the keys `scope`, `total`, `byKind`, `bySize`, `byAge`, `topFolders`, `clusters`, `newest`; C5's C19 stays green
Proof: `npx vitest run tests/natureza.contract.test.ts -t "C68 "`
Proof: `npx vitest run tests/cleanup.layer.test.ts -t "C19 "`

**C69** - C3 and C4 answer as before, by value: `GET /api/memory/query?where=natureza:talvez` still returns the file with
`fields.natureza` = `"talvez"`, and C3's C33 is green; `PUT /api/memory/notes/properties` still refuses `review_every:
1000d` (C4's C19 green) and now refuses `became_fact: "ontem"` and `abandoned: "ontem"` with `400 validation`, while
`became_fact: 2026-10-30` is written bare and read back with the kind `date` (amendments 2, 3 and 13)
Proof: `npx vitest run tests/natureza.contract.test.ts -t "C69 "`
Proof: `npx vitest run tests/organize.maps.test.ts -t "C33 "`
Proof: `npx vitest run tests/notesview.properties.test.ts -t "C19 "`

### S5 - a tela Revisões, os selos e os filtros (plan S2, S3, S5, S6) · 24 files · 309 KB · ~77k

**C70** - The entries, each with its order asserted: in the moldura's graph, "Revisões (3)" is the fourth `.btn.sm` of
`.brain-topbar-actions`, after "Atualizar índice", "Modo apresentação (p)" and "Faxina" (their accessible names) and before
the `os-chip`s, with N the `total` of `GET /api/memory/reviews?kind=due&context=<the active context>` the test kit answers
for that query, and absent when it answers 0; in the Núcleo's brain scene menu "Revisões (3)" is the last row of
`bs-menu-acts`, after "Faxina", and absent with 0; the palette's "Revisões" (scope `global`, `palette: true`) opens
`/brain/reviews` in the moldura and the brain's panel at `/brain/reviews` in the Núcleo; activating a `reviewDue` inbox row
navigates to `/brain/reviews` (AC 37, amendment 10)
Proof: `npm run test -w apps/command-centre -- src/brain/reviews/reviewsEntries.test.tsx -t "C70 "`
Proof: `MORDOMO_E2E_PORT=4901 npx playwright test --config tests/e2e/playwright.config.ts reviews.spec.ts -g "C70 "`

**C71** - The command registry holds "Revisões" (`global`, `palette: true`) and, in scope `view:reviews`, `j` and `k` (next
and previous item), `v` ("Ainda vale" on the selected item) and `a` (opens "Adiar"); `v` typed inside the fact dialog's
field does not act; in "Revisões" (`/brain/reviews`, the moldura and the Núcleo) the brain's "Ver grafo" holds no key and
`v` never leaves the screen: on an item it sends "Ainda vale", on an empty list and on the "Sem classificação" tab it does
nothing, and the hash stays `#/brain/reviews` (round 1); the keyboard-listener reader of `commands.source.test.ts` finds no
listener in the screen's files outside the registry (design.md binding `comandos-atalhos`)
Proof: `npm run test -w apps/command-centre -- src/brain/reviews/reviewsEntries.test.tsx -t "C71 "`
Proof: `npm run test -w apps/command-centre -- src/commands/commands.source.test.ts -t "C71 "`

**C72** - The screen, top to bottom and left to right: the title "Revisões"; the `Tabs` "Para revisar (2)" then "Sem
classificação (5)", each N the `total` of its kind; on the header's right, the "Natureza" filters then the "Escopo" filters,
and the active context as "Contexto: Projeto X" (or "Contexto: Todo o cérebro"); below, the list on the left and the detail
of the selected item on the right (design.md "Tela - Revisões", AC 37)
Proof: `npm run test -w apps/command-centre -- src/brain/reviews/ReviewsScreen.test.tsx -t "C72 "`

**C73** - Each list item holds, in order, line 1 with the note's name (the 13px, weight-600 class) then its nature badge,
and line 2 (the 12px secondary class) with the relative path, then "revisado há 4 meses" (an item with `lastReviewed` 4
months before today) or "nunca revisado · alterado há 5 meses" (`lastReviewed: null`, `mtime` 5 months back), then the
scope badge; the items keep the order the route answered (oldest first); `j`/`k` move the selection and `Enter` opens the
detail (AC 37, design.md "Lista")
Proof: `npm run test -w apps/command-centre -- src/brain/reviews/ReviewsScreen.test.tsx -t "C73 "`

**C74** - The nature badge, one rendered case per row of design.md's "Selo de natureza": `fato` → `CircleCheck` + "Fato" with
the `--tone-ok` class, `relato` → `FileText` + "Relato" / `--tone-muted`, `plano` → `Compass` + "Plano — ainda não é
realidade" / `--tone-info`, `hipotese` → `FlaskConical` + "Hipótese" / `--tone-warn`, `opiniao` → `MessageCircle` + "Opinião"
/ `--accent`, none → `CircleDashed` + "Não classificado" / `--tone-muted`; each badge holds an icon and a text, never the
colour alone; the scope badge is text only ("Pessoal", "Equipe", "Externo"); the abandoned badge is `Archive` + "Abandonado
em 2026-09-01"; in the dense variant the plano badge reads "Plano" with `title` "Plano — ainda não é realidade" (AC 44,
design.md "Selo de natureza")
Proof: `npm run test -w apps/command-centre -- src/brain/reviews/natureBadges.test.tsx -t "C74 "`

**C75** - The detail's action row, left to right, one asserted case per kind of item: an editable `plano` (and an editable
`hipotese`) shows "Ainda vale" (`.btn.primary`, `Check`), "Atualizar" (`.btn`, `PencilLine`), "Virou realidade" (`.btn`,
`CircleCheck`), "Mudei de ideia" (`.btn`, `Archive`), "Adiar" (the primitives' menu) and "Não cobrar mais" (`.btn.ghost`,
`BellOff`); an editable `opiniao` and an editable note with no nature show the same five without "Virou realidade"; an item
with `editable: false` shows only "Ainda vale", "Adiar" and "Não cobrar mais", with the `Lock` icon and "Fora de memory/: a
decisão fica no MordomoOS, o arquivo não muda." above them; the detail shows up to 600 characters of the note's start through
`components/Markdown.tsx` and the list of its passages, each with its badge (AC 37, AC 38, amendment 8)
Proof: `npm run test -w apps/command-centre -- src/brain/reviews/ReviewsScreen.test.tsx -t "C75 "`

**C76** - "Ainda vale" sends `POST /api/memory/reviews {path, action: "keep", baseVersion: <the item's version>}` (and no
`baseVersion` for an item with `editable: false`); on `200` the item leaves the list, focus goes to the next item, the
notice "Marcado como ainda vale." with "Desfazer" is on screen at 7 999 ms and gone at 8 000 ms (fake timers), and the
`role="status"` region reads "2 itens para revisar" (from "3 itens…"); the same notice text for each other action, one case
each: "Adiado por 14 dias.", "Não vou cobrar mais.", "Marcado como abandonado.", "Marcado como realidade.", "Classificado
como Plano." (AC 41, amendment 23)
Proof: `npm run test -w apps/command-centre -- src/brain/reviews/ReviewsScreen.test.tsx -t "C76 "`

**C77** - "Desfazer", one asserted case per side: after a `keep` on an editable note it sends
`PUT /api/memory/notes/properties` with `baseVersion` = the version the `POST` answered and the change that puts back the
old `last_reviewed` (or removes it when it was absent), and the item returns to the list in its place; after a `snooze` on a
file outside `memory/` it sends `POST /api/memory/reviews {path, action: "restore", state: <the previous the snooze
answered>}`; after a `became_fact` with a fact it sends both the properties change and
`POST /api/memory/facts/<id>/retract`; the test kit answers each request only for the body it expects (L-052) (AC 41,
amendment 7)
Proof: `npm run test -w apps/command-centre -- src/brain/reviews/ReviewsScreen.test.tsx -t "C77 "`

**C78** - A partial undo: after a `became_fact` with a fact, when the properties change answers `200` and the retract fails,
the note stays restored (no second properties change is sent), the notice reads "Não foi possível desfazer tudo." with
"Tentar de novo", and "Tentar de novo" sends only the retract again, which then succeeds and clears the notice (AC 41,
amendment 7, L-049)
Proof: `npm run test -w apps/command-centre -- src/brain/reviews/ReviewsScreen.test.tsx -t "C78 "`

**C79** - "Atualizar" calls `openNoteEditor({ mode: "edit", path: <the item's path> })`, sends no `POST
/api/memory/reviews`, and the item stays in the list and selected (AC 39, amendment 9)
Proof: `npm run test -w apps/command-centre -- src/brain/reviews/ReviewsScreen.test.tsx -t "C79 "`

**C80** - "Virou realidade" opens one `Modal` 480 px wide titled "Virou realidade", holding top to bottom the field "Desde"
(`<input type="date">`, today), the section "Registrar como fato" closed by default with "O quê", "Atributo" and "Valor"
(each `maxLength` 200), and the footer "Cancelar" then "Confirmar" (`.btn.primary`); "Confirmar" with the section closed sends
`{action: "became_fact", baseVersion}` with no `fact`; with it open and the three fields filled, `fact: { subject,
predicate, object, validFrom: <the chosen day at local midnight, in ms> }`; a failed save shows the error inside the dialog,
which stays open with what was typed (AC 40, amendment 8)
Proof: `npm run test -w apps/command-centre -- src/brain/reviews/BecameFactDialog.test.tsx -t "C80 "`

**C81** - "Adiar" opens the primitives' menu with "7 dias", "14 dias", "30 dias", "90 dias" in that order, and choosing "30
dias" sends `{action: "snooze", days: 30}` (AC 40)
Proof: `npm run test -w apps/command-centre -- src/brain/reviews/ReviewsScreen.test.tsx -t "C81 "`

**C82** - When a save answers `409 edit_conflict`, the item stays where it was and shows `AlertTriangle`, "A nota mudou desde
que a lista foi carregada." and "Recarregar"; "Recarregar" asks `GET /api/memory/reviews` again with the same query (AC 42)
Proof: `npm run test -w apps/command-centre -- src/brain/reviews/ReviewsScreen.test.tsx -t "C82 "`

**C83** - The states, one asserted case each: an empty list with `nextDue` 12 days ahead shows the 32 px `CircleCheck`, "Nada
para revisar hoje." and below it "Próxima revisão em 12 dias"; with `nextDue: null`, the first two and no third line; while
the list loads, a spinner with "Carregando…"; when it fails, the error with "Tentar de novo", which asks the list again
(AC 43, amendment 6)
Proof: `npm run test -w apps/command-centre -- src/brain/reviews/ReviewsScreen.test.tsx -t "C83 "`

**C84** - The filters: five nature buttons (Fato, Relato, Plano — ainda não é realidade, Hipótese, Opinião, each the badge,
no "Não classificado") and three scope buttons, each with `aria-pressed`; pressing "Plano" and "Equipe" with the context
"proj-x" active asks `GET /api/memory/reviews?kind=due&context=proj-x&natureza=plano&escopo=equipe`, and the list shows what
the test kit answers for exactly that query (the kit answers a request without `context`, or with another one, with a
different list, so a dropped or wrong scope fails this check) (AC 44, amendment 15, L-052)
Proof: `npm run test -w apps/command-centre -- src/brain/reviews/ReviewsScreen.test.tsx -t "C84 "`

**C85** - The tab "Sem classificação": an item with `suggested: "plano"` shows "Sugestão: Plano" (the badge) with "Confirmar",
which sends `{action: "classify", natureza: "plano", baseVersion}`; the five nature badges as buttons, of which "Opinião"
sends `natureza: "opiniao"`; "Não classificar" sends `{action: "snooze", days: 90}`; an item with `suggested: null` shows
"Sem sugestão" and the five buttons; empty, loading and error read as in C83 (AC 49, amendment 23)
Proof: `npm run test -w apps/command-centre -- src/brain/reviews/ReviewsScreen.test.tsx -t "C85 "`

**C86** - In each of the three screens that list `useBrainSearch` hits (the moldura's graph, the Núcleo's brain scene, the
notes view's search), one asserted case per screen: each hit shows its nature badge (dense) right after its name; the row of
five nature filters is absent until "Filtros" is pressed; pressing "Fato" asks `GET /api/memory/search` with `natureza=fato`
and the active `context`, and the hits shown are the kit's answer to exactly that query (design.md "Busca e preview",
amendment 15, L-052)
Proof: `npm run test -w apps/command-centre -- src/brain/reviews/natureBadges.test.tsx -t "C86 "`

**C87** - The preview of a Markdown file with `natureza: plano`, `escopo: equipe`, `status: archived` and `abandoned:
2026-09-01` shows, at the end of `.brain-preview-badges` and after the badges that were there (group, extension, size,
age, edges), the nature badge, then the scope badge, then the abandoned badge; right after the row, "Revisar agora"
(`.btn.sm`) opens `/brain/reviews?path=<path>`, where that item is selected when listed and the first item when it is not;
the preview of a `.pdf` has none of them (design.md "Busca e preview", amendment 10)
Proof: `npm run test -w apps/command-centre -- src/brain/reviews/natureBadges.test.tsx -t "C87 "`

**C88** - The inbox shows a `sentinel.reviewDue` row as "3 itens para revisar" in pt-BR and "3 items to review" in en, and
"20+ itens para revisar" with `display: "20+"`; Configurações › Notificações › Sentinelas lists "Revisões vencidas" with
"Uma vez por dia, as notas que venceram a revisão." after "Folder watch" and before the triage row, and its button sends
`PUT /api/settings` with `sentinels` = every current sentinel and `reviewDue: { enabled: false }` (AC 26, amendment 16)
Proof: `npm run test -w apps/command-centre -- src/hooks/notificationText.test.ts -t "C88 "`
Proof: `npm run test -w apps/command-centre -- src/views/settings/sentinels.test.tsx -t "C88 "`

**C89** - Every `animation` and `transition` of the screen's stylesheet sits inside `@media (prefers-reduced-motion:
no-preference)` (the reader of `ui/ui.source.test.ts` C15 run on it): an item that leaves folds by height and `opacity` in
150 ms; with motion reduced and allowed, every state renders the same text and icons, and the item leaves at once when
reduced (AC 41, AC 45, design.md "Depois de decidir")
Proof: `npm run test -w apps/command-centre -- src/brain/reviews/reviewsMotion.test.ts -t "C89 "`

**C90** - In the light and the dark theme and in the moldura and the Núcleo, the screen with a list, with an empty list, the
"Sem classificação" tab and the "Virou realidade" dialog has no text under 12px and its prose at 13px, every action is
reached by `Tab` in the order of C75 and `Enter` activates it, and axe at WCAG A/AA reports no `serious` or `critical`
violation on the whole page; the repository's stylelint config (tokens only) reports no warning on the screen's
stylesheet, run programmatically as `typography.test.ts` runs it (AC 45)
Proof: `MORDOMO_E2E_PORT=4901 npx playwright test --config tests/e2e/playwright.config.ts reviews.spec.ts -g "C90 "`
Proof: `npm run test -w apps/command-centre -- src/brain/reviews/reviewsMotion.test.ts -t "C90 "`

**C91** - The component gallery has a reviews entry (the six nature badges, the scope badges, a list item, the three action
rows of C75, the "Virou realidade" dialog), and in both themes it has no `serious` or `critical` axe violation
(`design-system/design.md`, "a galeria cobre as duas camadas")
Proof: `MORDOMO_E2E_PORT=4901 npx playwright test --config tests/e2e/playwright.config.ts reviews.spec.ts -g "C91 "`

**C92** - The screen and the dialog are reached from both entries (`main.tsx`, `gallery/main.tsx`) only by a dynamic
`import()`; `scripts/bundle-baseline.json` gains a `cerebro-natureza` entry after `cerebro-faxina-guiada` with a reason of
more than 40 characters and the four numbers, at most 12 KB of JS gzip and 2 KB of CSS gzip above `cerebro-faxina-guiada`
(546 409 B and 76 471 B); `bundle:check` exits 0 (amendment 21, question 8)
Proof: `npx vitest run tests/natureza.contract.test.ts -t "C92 "`
Proof: `npx vitest run tests/bundle-size.test.ts -t "C31 a build within 5% of the latest recorded one passes"`
Proof: `npm run bundle:check`

**C93** - Every row of design.md's "Texto" table (30 rows: 28 keys, `nature.fato` … `nature.none` as 6 keys and
`scope.pessoal` … `scope.externo` as 3) and every key of amendment 23 (16 keys) is a key of `en` and `ptBR` in
`locales/brain.ts` (the two `apps.settings.sentinel.reviewDue*` in `locales/apps.ts`) with that text, and both locales hold
the same keys (design.md "Texto", amendment 23)
Proof: `npm run test -w apps/command-centre -- src/brain/reviews/reviewsCopy.test.ts -t "C93 "`

**C94** - In the header of "Revisões", after the "Natureza" and "Escopo" filters, the active context "Contexto: Projeto X"
is a button, the `cerebro-contextos` shortcut to switch it (design.md "Cabeçalho"): activating it runs the registry's
`action:switch-context` once and the shell's context menu opens ("Novo contexto…" is listed), in the moldura and in the
Núcleo (design.md "Tela - Revisões", round 1)
Proof: `npm run test -w apps/command-centre -- src/brain/reviews/reviewsEntries.test.tsx -t "C94 "`

## Coverage

| Set (size)                                                                | Member -> proof                                                                                                                                                                                                                                                                                                                                                 | Unproven |
| ------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| `GET /api/memory/reviews` statuses (4)                                    | 200 C27, C34 · 400 C34 · 403 C66 · 404 C32                                                                                                                                                                                                                                                                                                                      | -        |
| `POST /api/memory/reviews` statuses (6)                                   | 200 C45, C46 · 400 C48, C55, C57 · 403 C53, C55, C66 · 404 C55 · 409 C54, C55, C63 · 413 C55                                                                                                                                                                                                                                                                    | -        |
| `GET /api/memory/search` statuses, with the new keys (4)                  | 200 C11, C12, C14 · 400 C13 · 404 C13 · 409 C13                                                                                                                                                                                                                                                                                                                 | -        |
| `GET /api/memory/recall` statuses, with the new keys (3)                  | 200 C15, C18, C20 · 400 C19 · 404 C19                                                                                                                                                                                                                                                                                                                           | -        |
| named error codes, as (status, code) pairs (11)                           | `400 validation` C13, C19, C34, C38, C48, C55, C57 · `403 note_not_editable` C53 · `403 forbidden_path` C55 · `403 owner_only` C66 · `403 scope_required` C66 · `403 forbidden` (run) C66 · `404 not_found` C55 · `404 context_not_found` C13, C19, C32 · `409 edit_conflict` C51, C54, C63 · `409 front_matter_unreadable` C55 · `413 note_too_large` C55      | -        |
| `POST` actions (7)                                                        | `keep` C45, C46, C47 · `snooze` C48 · `never` C49 · `became_fact` C50, C51 · `abandon` C52 · `classify` C59 · `restore` C56, C57 (added, amendment 7)                                                                                                                                                                                                           | -        |
| actions refused outside what is editable (3)                              | `became_fact` C53 · `abandon` C53 · `classify` C53                                                                                                                                                                                                                                                                                                              | -        |
| places that are not editable (6)                                          | outside `memory/` C46, C53 · `ROUTER.md` C47, C53 · `areas/` C47, C53 · `journal/` C47, C53 · `contexts/` C47, C53 · `.markdown` C47                                                                                                                                                                                                                            | -        |
| doors of Landing (6)                                                      | 1 C1, C2, C3 · 2 C4, C5, C6, C7 · 3 C15, C16, C26 · 4 C64, C56 (restore) · 5 C30, C38, C40, C44 · 6 C7, C10                                                                                                                                                                                                                                                     | -        |
| stored shapes (5)                                                         | `note_passages` C7 · `review_state` C7, C46, C56 · `settings.memory.reviews` C38 · `settings.sentinels.reviewDue` C38, C41 · front-matter lines a decision writes C45, C49, C50, C52, C59                                                                                                                                                                       | -        |
| startup config: `memory.reviews` and `sentinels.reviewDue` (2 assemblies) | the service's `AppContext` behind the routes C38, C39 · the `SentinelRunner` the API drives hourly C40, C41                                                                                                                                                                                                                                                     | -        |
| natures, read (5 + none) (6)                                              | `fato` C11, C16 · `opiniao` C2, C16 · `plano` C1, C15 · `hipotese` C21, C30 · `relato` C11, C16 · none C2, C14, C15                                                                                                                                                                                                                                             | -        |
| scopes (3)                                                                | `pessoal` C12 · `equipe` C1, C19 · `externo` C74                                                                                                                                                                                                                                                                                                                | -        |
| nature read rules (6)                                                     | closed list C2 · normalization C2 · inline wins C2 · inline invalid wins as absent C2 · `review_every` bound C3 · rows indexed before C6 C2                                                                                                                                                                                                                     | -        |
| passage forms refused (6)                                                 | ` ``` ` fence C5 · `~~~` fence C5 · front matter C5 · `[!note]` C5 · `[!planos]` C5 · no `>` C5                                                                                                                                                                                                                                                                 | -        |
| recall precedence (4)                                                     | passage C15, C18 · file C15, C17 · generated section C15, C16 · `null` C15                                                                                                                                                                                                                                                                                      | -        |
| door 3 headings (9)                                                       | MEMORY Facts C16 · MEMORY Decisions C16 · Open loops C16 · Reflections C16, C26 · Superseded C16, C22 · journal Decisions C16 · journal Open loops C16 · Today C16 · Runs C16                                                                                                                                                                                   | -        |
| search modes (3)                                                          | `text` C11 · `semantic` C11 · `auto` C11                                                                                                                                                                                                                                                                                                                        | -        |
| CLI labels (6)                                                            | `plano` C21 · `hipotese` C21 · `opiniao` C21 · `null` C21 · `fato` none C21 · `relato` none C21                                                                                                                                                                                                                                                                 | -        |
| places that read the agents' block (3)                                    | `AGENTS.md` C24 · `CLAUDE.md` C24 · run prompt of a memory skill C25                                                                                                                                                                                                                                                                                            | -        |
| cadence sources (4)                                                       | `review_every` C3, C30 · `byType` C30 · `cadence` C30 · none C30                                                                                                                                                                                                                                                                                                | -        |
| due-date bases (3)                                                        | front matter `last_reviewed` C27, C28 · `review_state.last_reviewed` C28, C46 · `mtime` C28                                                                                                                                                                                                                                                                     | -        |
| due edges (3)                                                             | 89 days C27 · 90 days C27 · 91 days C27                                                                                                                                                                                                                                                                                                                         | -        |
| what hides an item (6)                                                    | `review_every: never` C29 · `review_state.never` C29, C49 · snooze C31, C48 · policy C33 · `memory/archive/` C37 · `status: archived` C37, C52                                                                                                                                                                                                                  | -        |
| scope kinds of the list (5)                                               | context `ok` path C32 · context notes folder C32 · `context=all` C32 · none C32 · unknown C32                                                                                                                                                                                                                                                                   | -        |
| list kinds (2)                                                            | `due` C27, C34 · `unclassified` C60, C85                                                                                                                                                                                                                                                                                                                        | -        |
| sentinel outcomes (5)                                                     | one fired C40 · deduped same day C40 · next day C40 · disabled C41 · failure swallowed C43                                                                                                                                                                                                                                                                      | -        |
| notification count display (3)                                            | under 20 C42 · exactly 20 C42 · over 20 C42, C88                                                                                                                                                                                                                                                                                                                | -        |
| suggestion rows (5)                                                       | future over past C61 · opinion C61 · tie C61 · plano first C61 · none C61                                                                                                                                                                                                                                                                                       | -        |
| one-item list writers (4)                                                 | passages C6 · search hits C14 · due list C35 · unclassified list C60                                                                                                                                                                                                                                                                                            | -        |
| entries to the screen (5)                                                 | moldura button C70 · Núcleo menu row C70 · palette C70, C71 · notification C70 · preview "Revisar agora" C87                                                                                                                                                                                                                                                    | -        |
| item action rows (3 variants)                                             | six C75 · five C75 · three C75                                                                                                                                                                                                                                                                                                                                  | -        |
| screen states (7)                                                         | list C72, C73 · empty with next C83 · empty without C83 · loading C83 · error C83 · conflict C82 · partial undo C78                                                                                                                                                                                                                                             | -        |
| undo sides (3)                                                            | note C77 · `review_state` C77 · fact C77, C78                                                                                                                                                                                                                                                                                                                   | -        |
| arrangements design.md and amendment 10 draw (13)                         | fourth topbar button C70 · last row of bs-menu-acts C70 · title then tabs C72 · filters on the right C72 · list left, detail right C72 · item lines C73 · action order C75 · lock above actions C75 · dialog order C80 · snooze menu order C81 · preview badge order C87 · settings row between fsWatch and triage C88 · context shortcut after the filters C94 | -        |
| badges (6 + scope + abandoned) (8)                                        | `fato` C74 · `relato` C74 · `plano` C74 · `hipotese` C74 · `opiniao` C74 · none C74 · scope C74 · abandoned C74, C87                                                                                                                                                                                                                                            | -        |
| search screens (3)                                                        | moldura graph C86 · Núcleo brain scene C86 · notes view search C86                                                                                                                                                                                                                                                                                              | -        |
| shells (2)                                                                | moldura C70, C90 · Núcleo C70, C90                                                                                                                                                                                                                                                                                                                              | -        |
| themes (2)                                                                | light C90, C91 · dark C90, C91                                                                                                                                                                                                                                                                                                                                  | -        |
| design.md copy and amendment 23 (46)                                      | C93, table-driven over all 46                                                                                                                                                                                                                                                                                                                                   | -        |

- Claims naming a status code, route or response shape: C1, C2, C4, C6, C8-C15, C18-C20, C27, C28, C31-C36, C38-C42, and
  also C45-C60, C63-C66, C68, C69 - each proven through `app.inject` against `buildServer`; C2-C5, C7, C15-C17, C27-C30,
  and C32, C37, C40, C48, C56, C61, C62 also or only at their own layer, with no HTTP; C21-C23 through the CLI
- Claims about the screens: C70-C89, C93, C94 in rendered components; C70, C90, C91 also in a real browser, both shells where the
  claim names them

## Binding sources

| Source                                                                                                                                            | Checked by                       |
| ------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------- |
| `cerebro-natureza/design.md` (the badges, the screen, its states, the dialog, search and preview, the agents' block, the copy)                    | C24, C25, C70-C87, C89, C93, C94 |
| `design-system/design.md` (12px floor, 13px prose, tokens, state never by colour alone, axe, the gallery)                                         | C74, C90, C91                    |
| `primitivas/design.md` (`Modal`, the menu, `Tabs`, `aria-pressed` filters, motion inside `no-preference`)                                         | C72, C80, C81, C84, C89          |
| `comandos-atalhos/design.md` (the registry, `view:reviews` keys, no listener outside it, no bare key in a field)                                  | C71                              |
| `moldura-app/design.md` (the brain's action row, `.btn.sm`; it has no "Tela do Segundo Cérebro", as C5 noted, so the place rests on amendment 10) | C70                              |
| `cerebro-v2/design.md` (the note editor "Atualizar" opens)                                                                                        | C79                              |
| `limpeza-legado/design.md` (one Markdown renderer, no unused CSS or key)                                                                          | C75, C93                         |

## Test policy

| Code                                                                                                                                                                           | Required proofs                                              | Coverage expectation                                                                                                   |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------- |
| Decides, reached across a boundary (the nature reader, the passage parser, the recall's labelling, `reviewsDue`, the sentinel's emit rule, the decision rules, the suggestion) | one at the HTTP or CLI boundary **and** one at its own layer | the contract at the boundary; one asserted case per row of the decision table at its own layer                         |
| Decides, not reached across a boundary (the migration, door 3's table, the cadence precedence, the no-write walker)                                                            | one at its own layer                                         | one asserted case per row                                                                                              |
| Screens (the reviews screen, its tab, the dialog, the badges, the filters, the entries, the settings row)                                                                      | one in rendered components per screen and state              | each state, arrangement and copy design.md and the amendments name; both themes and both shells for axe in the browser |

Evidence:

- the nature reader (new): five natures, three scopes, a `review_every` pattern with two bounds, normalization, the inline
  rule -> decides, ~12 branch points
- the passage parser (new): five markers, case, title, continuation, two fences, the front matter, the `>` prefix ->
  decides, ~10 branch points
- the recall's labelling (changed `recall.ts`): four precedence rows, nine headings in two files, the filter on two keys ->
  decides, ~16 branch points
- `reviewsDue` (new): three cadence sources, three bases, six hiding rules, five scope kinds, two kinds, the cut ->
  decides, ~25 branch points; the sentinel's rule: enabled, count zero, dedupe, display cap -> decides, 4
- the decision rules (new): seven actions, editable or not, six refusals, the write order of `became_fact` -> decides, ~20
  branch points; the suggestion: two marker sets, a tie, the order -> decides, 5
- own layer: `tests/natureza.layer.test.ts` calls those functions with no HTTP, as `tests/cleanup.layer.test.ts`,
  `tests/notesview.layer.test.ts` and `tests/organize.layer.test.ts` do for the same shape
- closest analogue: `tests/cleanup.layer.test.ts` with `tests/cleanup.decisions.test.ts` (C5), the same split of a rule set
  proven at the boundary and in the core

Cost: about 40 own-layer cases in `tests/natureza.layer.test.ts`. Without these rows, the cadence precedence, door 3's nine
headings and the seven actions are proven only by the requests that happen to traverse them.

## Swept

- validation: C2, C3, C13, C19, C23, C34, C38, C48, C55, C57
- failure modes: C9 (a removal that fails keeps the passages with the file), C43 (the sentinel's query fails), C51 (the fact fails after the note was written), C78 (a partial undo), C82 and C83 (the screen keeps the item and offers a retry)
- idempotency: C6 (passages replaced, never added), C8 (the backfill marker, a cut pass done again), C40 (one notification a day by `dedupeKey`), C45 (a `keep` writes one line, an equal value keeps it)
- authorization: C66 (`content` for the read, owner only for the decision, a run's credential refused), C33 (today's policy), C53 (no write outside what is editable), C62 (the reads write nothing); existing - the `API` table's scopes and `onRoute` (AD-024) guard every route
- concurrency: C63 (two decisions with one `baseVersion`: one wins, one `409`), C54 (`edit_conflict`), C9 (one transaction)
- data lifecycle: C7 (migration 25 over existing rows), C8 (backfill), C9 (passages go with the file, `review_state` stays), C10 (`review_state` keyed by path survives a reindex; a rename loses it), C31 (a snooze expires)
- dependency failure: C51 (the facts store fails mid-decision), C43 (the database fails in the hourly pass), C13 (the semantic search is off: `409 semantic_disabled`)
- state transitions: C45-C52 and C59 (due to reviewed, snoozed, never, abandoned, fact, classified), C56 (a decision restored), C37 (`status: archived` leaves the queue)
- observability: C40 and C44 (`sentinel.fired` with `reviewDue` on the bus, `docs/events.md` regenerated), C43 (`onError` names `reviewDue`)

Existing behaviour this feature must not change, each asserted by value: C3's `fields` (C69), C4's properties refusals
(C69), C5's cleanup kinds, inventory and `stale` rule (C68), the recall's six keys and the MCP tool's text (C20), the CLI
line of a `fato` or `relato` excerpt (C21), the search's `404` and `409` (C13), and `EVENT_VERSIONS` of `sentinel.fired`
(C44).

## Handoff

The estimate exceeds the 150k budget. Mechanism chosen by the owner on 30/10/2026: **handoff, four batches
A, B, C, D** (the cut below), sequential, each only on green.

- Arithmetic (`wc -c` of the files each slice touches at `c672981`, / 4; new files estimated):
  - S1: `core/src/memory/frontMatter.ts` 18 419, `core/src/memory/fields.ts` 4 147, `core/src/memory/indexer.ts` 41 609,
    `core/src/db/migrations.ts` 19 406, `core/src/memory/linkParser.ts` 4 531 (the prose blanking the parser follows),
    `core/src/internal.ts` 15 094, the new passage parser and nature reader ≈ 5 000 = ≈ 108 KB → ≈ 27k
  - S2: `core/src/memory/search.ts` 9 206, `core/src/memory/semantic.ts` 6 690, `core/src/memory/recall.ts` 23 896,
    `contracts/src/api/memory.ts` 40 031, `apps/api/src/routes/memory.ts` 14 893, `apps/api/src/cli.ts` ≈ 15 000 of 71 171
    (`cmdRecall` and its flags, read in parts), `core/src/sync/compiler.ts` 18 188, `core/src/skills/catalog.ts` 21 798,
    `skills/consolidate-memory/SKILL.md` 3 931, `tests/organize.sync.test.ts` 12 356 (the model for the compiled text) =
    ≈ 166 KB → ≈ 41k
  - S3: the new `core/src/memory/reviews.ts` ≈ 12 000, `core/src/memory/contexts.ts` 15 924, `apps/api/src/routes/contexts.ts`
    3 623, `contracts/src/settings.ts` 21 964, `contracts/src/events.ts` 7 654, `contracts/src/eventSchemas.ts` 9 044,
    `contracts/src/eventRegistry.ts` 5 642, `core/src/sentinels/runner.ts` 7 290, `core/src/sentinels/types.ts` 2 004,
    `core/src/sentinels/silentRoutine.ts` 6 184 (the model), `core/src/notifications/recorder.ts` 10 065, `docs/events.md`
    15 963, `tests/fixtures/events/v1/sentinel.fired.json` 280, `apps/api/src/routes/system.ts` ≈ 8 000 of 30 810 (the merge),
    `tests/data.settings.test.ts` 45 272 (the settings leaf pin), `tests/core.sentinels.test.ts` 12 340, the contract and the
    routes again 54 924 = ≈ 238 KB → ≈ 60k
  - S4: `core/src/memory/notes.ts` 20 208, `core/src/memory/frontMatter.ts` 18 419 again (the date keys), `core/src/memory/facts.ts`
    5 535, the new decision rules ≈ 8 000 and suggestion ≈ 4 000, the contract and the routes again 54 924,
    `core/src/memory/indexer.ts` ≈ 5 000 (`requestIndexPaths`) = ≈ 116 KB → ≈ 29k
  - cross-cutting, API (C64-C69): `tests/helpers/routeScopes.ts` 8 739, `tests/helpers/contractWorld.ts` 38 543,
    `tests/api.refusals.test.ts` 23 916, `docs/security.md` ≈ 15 000 of 66 789 (read in parts), `apps/api/src/server.ts`
    ≈ 10 000 of 44 186 (the credential lists), `contracts/src/api/errors.ts` 10 005, `tests/api.openapi.test.ts` 32 065,
    `tests/security-reads.test.ts` ≈ 10 000 of 101 206 (the pins), `tests/sdk.instances.test.ts` 21 846 = ≈ 170 KB → ≈ 43k
  - S5 (C70-C89, C93): `locales/brain.ts` 28 837, `locales/apps.ts` 32 141, `commands/registry.ts` 12 630,
    `commands/global.ts` 11 900, `brain/BrainChrome.tsx` 10 628, `brain/BrainViewSwitch.tsx` 4 247, `brain/PreviewPanel.tsx`
    9 292, `brain/memoryData.ts` 4 217, `brain/notes/NoteSearch.tsx` 3 298, `brain/notes/NotesView.tsx` 11 635,
    `nucleo/scenes/BrainSceneMenu.tsx` 10 379, `nucleo/scenes/BrainScene.tsx` ≈ 15 000 of 71 090 (read in parts),
    `views/SecondBrain.tsx` 30 277, `ui/Dialog.tsx` 8 409, `ui/Tabs.tsx` 5 875, `ui/Menu.tsx` 4 818, `ui/ui.css` 14 347,
    `queries.ts` 9 064, `hooks/notificationText.ts` 5 814, `hooks/useNotifications.ts` ≈ 8 000 of 20 978,
    `views/settings/notifications.tsx` 16 512, `brain/NoteEditorHost.tsx` 954, `App.tsx` ≈ 6 000 of 17 141, the new screen,
    dialog, badges and stylesheet ≈ 45 000 = ≈ 309 KB → ≈ 77k
  - cross-cutting, screens (C90-C92): `gallery/main.tsx` 28 872, `tests/e2e/a11y.spec.ts` 17 550, `tests/e2e/shell.ts`
    11 753, `tests/e2e/cleanup.spec.ts` 23 033 (the model), `tests/bundle-size.test.ts` 10 659, `scripts/bundle-baseline.json`
    4 543, `commands/commands.source.test.ts` 36 614 = ≈ 133 KB → ≈ 33k
  - slices alone ≈ 27k + 41k + 60k + 29k + 43k + 77k + 33k = ≈ 310k; the new tests (nine root files ≈ 160 KB, eight UI files
    ≈ 95 KB with the kits read, `brain/cleanup/testkit.tsx` 8 502 and `brain/notes/testnet.ts` 13 956, and
    `tests/e2e/reviews.spec.ts` ≈ 25 KB: ≈ 302 KB) add ≈ 76k: ≈ 386k in all, over 150k
- Intended cut, at the surface boundaries (batches sequential, each only on green):
  - **A** (the index, the search, the recall, the CLI and the agents): S1 + S2 ≈ 27k + 41k = ≈ 68k, plus
    `tests/natureza.index.test.ts`, `tests/natureza.search.test.ts`, `tests/natureza.cli.test.ts`,
    `tests/natureza.agents.test.ts` and the S1-S2 half of `tests/natureza.layer.test.ts` ≈ 72 KB → ≈ 18k = ≈ 86k; C1-C26
  - **B** (the queue, the sentinel and the decisions, core and API): S3 + S4 ≈ 60k + 29k = ≈ 89k, plus
    `tests/natureza.reviews.test.ts`, `tests/natureza.sentinel.test.ts`, `tests/natureza.decisions.test.ts` and the rest of
    the layer file ≈ 60 KB → ≈ 15k = ≈ 104k; C27-C63, and C10 (moved from A by the coordinator on 30/10/2026: its proof
    stores and reads through B's `POST`/`GET /api/memory/reviews`; the claim and the proof are unchanged)
  - **C** (the API's cross-cutting checks): ≈ 43k, plus `tests/natureza.contract.test.ts` ≈ 20 KB → ≈ 5k = ≈ 48k; C64-C69
  - **D** (the screens and their cross-cutting checks): S5 + C90-C92 ≈ 77k + 33k = ≈ 110k, plus the eight UI test files and
    `tests/e2e/reviews.spec.ts` ≈ 145 KB → ≈ 36k = ≈ 146k; C70-C93
  - B + C ≈ 152k and C + D ≈ 194k are over the budget, so C stays apart; A lands first because B's queue reads A's
    nature reader, C asserts the routes of A and B, and D calls the routes of A and B
- Mechanism: handoff, four batches A, B, C, D (owner, 30/10/2026)

Status of batch A (updated in the commit that closes each piece):

- the index (S1: C1-C9) and the search and the recall by nature (S2: C11-C20), with migration 25, the passages, the
  nature reader, the `natureza`/`escopo` query keys of `GET /api/memory/search` and `GET /api/memory/recall` and the
  two keys on each hit and each `answerContext[]` item: closed, every proof green in `tests/natureza.index.test.ts`,
  `tests/natureza.search.test.ts` and `tests/natureza.layer.test.ts`. C10 is open: its proof stores a `snooze` through
  `POST /api/memory/reviews` and reads `GET /api/memory/reviews`, batch B's routes (C45-C58), so it cannot pass before
  them
- the CLI (C21-C23), the agents' block in the compiled `AGENTS.md`/`CLAUDE.md` and in a memory run's prompt (C24,
  C25) and the `consolidate-memory` guide (C26): closed, every proof green in `tests/natureza.cli.test.ts` and
  `tests/natureza.agents.test.ts`; with it batch A is closed but for C10 (C1-C9, C11-C26)

- **Boundary (batch A):** C1-C9 and C11-C26 closed at `68516ae` (`84daa60` for S1 and S2's code and C1-C20); C10 is
  open, handed to batch B with its routes. On the tree of `68516ae`: `npm run build`, `npm run typecheck` and
  `npm run lint` exit 0, `npx vitest run` at the root is green (153 files, 2034 tests, 1 skipped) and
  `npm run test -w apps/command-centre` too (161 files, 1326 tests); each of the 28 `Proof:` lines of the
  checks of the batch but C10 passes and runs only its check's test (C10's selector finds no test). S3-S5, C27-C93 and C10 are untouched
  (batches B, C and D): no `reviews.ts`, no `GET`/`POST /api/memory/reviews`, no `settings.memory.reviews`, no
  `reviewDue`, no screen. What batch A already moved, so that batch B adds on top: migration 25 (`note_passages` and
  `review_state`, both empty until B writes the second) in `data.migration`, `contexts.runs` C25 and `device-scopes`
  C22 (with its chained amendment in `sdk.api-thin` C29), and `ESCOPOS`, `NATUREZAS`, `parseEscopoList` and
  `parseNaturezaList` in the internal barrel (`sdk.surface` C38). No route, event type or settings leaf was added, so
  those pins did not move. The search and recall entries of `contracts/src/api/memory.ts` already carry the query keys
  and the two response keys (`z.enum(...).nullable()`, required); C65, which proves them, is still batch C's. C10's
  proof needs `POST /api/memory/reviews` (`snooze`) and `GET /api/memory/reviews`; the index side it rests on is in:
  `review_state` is keyed by path and a removal keeps its row (C9 asserts it).
- **Settled mid-build:** nothing by the owner. Builder decisions inside the approved shape, none a new one-way door:
  (a) the reader, the list parsers, the passage parser and the agents' block live in `core/src/memory/natureza.ts`;
  door 3's table, `excerptNature` and the filters in `recall.ts`; (b) a block quote is a passage only when its first
  line is the marker (`>` in column 1, `[!x]` of the five, any case, an Obsidian fold sign `-`/`+` and a title
  allowed); a marker on a later line of a block that opened otherwise is no passage; (c) the passages of a file are
  parsed from the text the index stores (its first 200 000 characters) in the pass and in the backfill alike, so both
  write the same rows; (d) the backfill writes each file that holds passages in its own short transaction with a safe
  point after it and after every 25 rows read, and writes `index.note_passages` = `"1"` in `meta` last; a "slice" of
  C8 is one such write; (e) an excerpt's lines are the first and last non-blank lines of its section's trimmed body
  (`Section.startLine`/`endLine`, 1-based over the whole file), and it lies within a passage when both do; (f) with
  `natureza` or `escopo` the recall neither opens nor counts a candidate whose scope is outside or that cannot give a
  nature asked (no passage, no file nature, no door-3 section of one), so `candidatesConsidered` and `candidates`
  reflect the filter; in a file it opens the best section is the best of the natures asked, and a pointer target
  follows the same rule; (g) the search applies the two filters after today's policy, where `allow` is applied, in
  the three modes; (h) the query keys are strings matched by a regex of the closed list, comma-separated (`natureza=`
  is `400 validation`); the lists stay private to `contracts/src/api/memory.ts`, so the package's surface does not
  grow; (i) the CLI puts the label and one space before `●`; it reads the abandoned day from the row's `fields`
  (`status` `archived` after `normalizeFieldKey`, `abandoned` a `YYYY-MM-DD`), since `RecallContext` has no field for
  it, and `(substituído)` is the section `Superseded` of `<home>/memory/MEMORY.md`; a value outside the lists exits 2
  before the home is opened, with `Invalid --natureza "<v>". Expected one or more of: fato, opiniao, plano, hipotese,
relato` (the scopes for `--escopo`); (j) migration 25 is named `natureza`; (k) the compiled files keep a blank line
  after the ground rules and then the six lines; the run prompt holds them as their own paragraph after the locations
  block; (l) `consolidate-memory` goes to 1.1.0, its step 3 saying recall reads the nature of a line from the five
  titles; (m) proof readings the checks left open: C2's "`errors: 0`" is asserted as `index.finished` with no
  `index.failed` and every file added (`IndexStats` has no `errors` key, and adding one would move the v1 schema of
  `index.finished`), over the seven files of its seven cases (the claim says five); C8's "files indexed before
  migration 25" is a pass's rows with `note_passages` and the marker deleted (an indexer of 24 cannot run with this
  code; C7 migrates a real 24 database), its stop is the second backfill write failing, and its read audit is an
  `fs.openSync` recorder plus a spy on `readWorkspaceText` plus `auditFiles` over `natureza.ts`; C20's record is the
  answer of the same fixture run at `aa687ed`, with fixed mtimes so the candidates' tie-break is stable; C25's work
  context is the `contextBlock` argument of `buildRunPrompt` (the launch's builder is private); C18 has one more note
  than its claim names, whose best section is a plano one beside a fato passage, so that a recall that skipped the
  nature of the best section would fail
- **Abandoned:** an `errors` count in `IndexStats` for C2 (it changes `index.finished` v1); parsing the passages from
  the whole file in the pass and from the stored text in the backfill (they would disagree past 200 000 characters);
  one backfill transaction per 25 rows (three files make one slice, and C8 could not stop between two); filtering the
  recall only after the top `k` files were opened (a higher plano note would take the place of the fato one, C18);
  writing C10's test against batch B's routes before they exist

Status of batch B (updated in the commit that closes each piece):

- the queue, the daily reminder and the decisions (S3: C27-C44; S4: C45-C51, C53-C63) and C10: closed, every proof
  green in `tests/natureza.reviews.test.ts`, `tests/natureza.sentinel.test.ts`, `tests/natureza.decisions.test.ts`,
  `tests/natureza.contract.test.ts` (C44), `tests/natureza.layer.test.ts` and `tests/natureza.index.test.ts` (C10), with
  `GET`/`POST /api/memory/reviews`, `settings.memory.reviews`, `settings.sentinels.reviewDue` and the `reviewDue`
  sentinel. **C52 is open, a stop-and-ask:** its claim says the abandoned note keeps "the same inode", and the guarded
  properties write that door 4 and AC 32 name (`saveProperties` → `writeWorkspaceFile` `replace` → `replaceBeside`,
  `core/src/security/safeWrite.ts`) replaces a note by a temporary file and a `rename`, so the inode always changes (the
  run gave 704521 before and 704522 after). Every other clause of C52 is asserted by a test in
  `tests/natureza.decisions.test.ts` whose title does not carry the id, so C52's selector finds no test
  **Closed by the coordinator after the batch:** amendment 24 drops "the same inode" (AC 32 never said it); the test
  now carries the id and C52's proof passes (1 test).

- **Boundary (batch B):** C10, C27-C51 and C53-C63 closed at `16573a4`; C52 open (stop-and-ask, above). On the tree of
  `16573a4`: `npm run build`, `npm run typecheck` and `npm run lint` exit 0, `npx vitest run` at the root is green
  (157 files, 2134 tests, 1 skipped) and `npm run test -w apps/command-centre` too (161 files, 1326 tests); each of the 48 `Proof:` lines of C10 and C27-C63
  passes and runs only its check's tests, but C52's, whose selector finds no test. C64-C93 are untouched (batches C and
  D): no screen, no locale key, no `natureza.contract` case but C44. What batch B already moved, so that C and D add on
  top: the two routes are in the `API` table (`memory.reviews.list`, scope `content`; `memory.reviews.decide`, scope
  `owner`, errors `403 note_not_editable`, `403 forbidden_path`, `404 not_found`, `409 edit_conflict`, `409
front_matter_unreadable`, `413 note_too_large`, and `400 validation` by the common rule), in `EXPECTED_ROUTE_SCOPES`,
  in `docs/security.md` (`content` 30, `owner` 75) and in `contractWorld.ts` (a `GET kind=due`, and a `keep` on an
  indexed note); neither is in `RUN_API_READ_ROUTES` or `RUN_API_WRITE_ROUTES` (amendment 22, C66 is C's). Pins moved
  the way C5 moved them: 147 routes and scenarios, `owner` 75 and `content` 30, 145 checked responses, the
  device-scopes amendments in `sdk.api-thin`, `api.contract` C53's list of routes that name a note's codes (the POST
  joins it), the raised pairs unchanged at 73, and `ReviewCadenceSchema` kept private so the contracts package's surface (`contracts.test` C41) does not grow. Settings: `memory.reviews` and `sentinels.reviewDue` with their leaves in
  `data.settings` C46, `sentinels.reviewDue.enabled` in `SETTINGS_FAIL_CLOSED` (closed `false`, so C63 and C19 of
  `data.settings` list it), and the v1 `settings.changed` fixture. Events: `SENTINEL_IDS` and the v1 schema of
  `sentinel.fired` hold `reviewDue`, `docs/events.md` regenerated, and the fixture
  `tests/fixtures/events/v1/sentinel.fired.reviewDue.json`; `events.contract` C27 now takes a second example of a type as
  `<type>.<variant>.json` and parses it against that type's schema. `became_fact` and `abandoned` are date keys of the
  properties (amendment 3; C69, which proves the refusal, is C's). The barrel has `decideReview` and `reviewsDue`
  (`sdk.surface` C38). For D: `GET /api/sentinels` lists a `reviewDue` row already (it reads `SENTINEL_IDS`), and the
  inbox row has `messageKey` `sentinel.reviewDue` with `messageParams` `{ count, display }`.
- **Settled mid-build:** nothing by the owner but C52, which waits for an answer. Builder decisions inside the approved
  shape, none a new one-way door: (a) the queue is `core/src/memory/reviews.ts` (`reviewsDue`, and the pure
  `reviewCadence`, `lastReviewedDay`, `dueDay`, `localDay`, `readReviewState`), the decisions
  `core/src/memory/reviewDecisions.ts` (`decideReview`), the sentinel `core/src/sentinels/reviewDue.ts`, the routes
  `apps/api/src/routes/reviews.ts`, and the suggestion `suggestNatureza` in `natureza.ts` (so C62's walker covers
  `reviews.ts` and `natureza.ts`); `reviews.ts` does not import `notes.ts`, so the list's `editable` is a function the
  route hands it (`classifyNotePath`, false on a refusal); (b) the stored decisions answer as `{ lastReviewed,
snoozeUntil, never }` with the two instants in ms or `null` and `never` `0` or `1`, as the row holds it; the `POST`
  answers `path`, `state` (the row after the decision, or `null`), `previous`, and `version` and `fact` when there are
  any; (c) the order of the refusals is the decision itself (`400`), the index row under today's policy (`404
not_found`), the path (`403 forbidden_path`), what may be edited (`403 note_not_editable`), then for a note
  `baseVersion` (`400` without it), its size (`413`), its version (`409 edit_conflict`) and its header (`409
front_matter_unreadable`); a file gone since the pass, or a folder where it was, is `404 not_found` (door 4 lists no
  `not_a_file`; the refusal probe found the case); a `.md` of `memory/` that is not UTF-8 is not editable, so its
  keep and never go to `review_state`; (d) "editable" for the decisions is `readNote`'s answer (`classifyNotePath`
  and UTF-8 text), and a `snooze` or a `restore` never reads the note; `became_fact` writes `was` only when the note had
  a nature, and does not refuse a note that is not `plano` or `hipotese` (the screen offers it only for those); (e) the
  `POST` awaits `requestIndexPaths([path])` for at most 2 s before it answers, so the next list reads the note as it is
  (AC 36); (f) in the queue, a snooze hides a file while `snooze_until` ≥ now (so it is back at now + days + 1 ms);
  `status: archived` and `memory/archive/` leave both kinds; `review_state.never` hides only from `due`; `nextDue` is the
  first day a file that is not listed falls due (a snoozed one counts from the later of its due day and the day its
  snooze ends) and is `null` for `kind=unclassified`; a `kind=unclassified` item carries `dueSince` when its `type` or
  `review_every` give it a cadence, else `null`; (g) `byType` is a record (any `type`, 1-64 characters), its default the
  two entries of door 5; a cadence is `<n>d` from 1 to 3650 or `never`, as `review_every`; (h) the sentinel's title is
  "N items to review" for every N, as amendment 16 writes it (also for 1), its body one fixed sentence, and it skips the
  query when today's key is already in the inbox; (i) the suggestion folds case and accents, counts whole words (a
  marker of two words across any spaces), and reads `files_fts.content` only for the items listed; (j) proof readings:
  the route tests run on `movingClock` (`tests/helpers/movingClock.ts`), a `Date.now()` shifted to `NOW` that goes on
  ticking, because the indexer waits for `Date.now()` to move (`indexer.ts`, the related phase) and a frozen fake `Date`
  hangs every pass; where a claim names an exact instant (C31's now + 14 days and + 1 ms) the clock is frozen only
  around the `GET`s, and a decision's own "now" is read as the `updated_at` of the row it wrote (C46, C48:
  `snooze_until = updated_at + days × 86 400 000`); the layer tests pass `now` to the code. C28's stored keep is read
  back through the list once that later review falls due (`lastReviewed` is that day); C46's likewise at now + 31
  days; C33's secret-named rows are `files` rows a pass would not write (`.env.md` due, `.env.notas.md`
  unclassified), as C5's C6 made them; C41's and C43's runner is a `SentinelRunner` over the home's database, settings,
  bus and inbox with a silent routine and a connector that has news; C43's "unreadable" `review_state` is the table
  renamed away for the pass; C51's failing assertion is a `BEFORE INSERT` trigger on `facts`; C55's link is the note's
  folder moved out and linked back after the pass, its `413` a note of 1 MB + 10 bytes (indexed under the 2 MB index
  limit, over the 1 MB note limit)
- **Abandoned:** a frozen fake `Date` in the route tests (every index pass hangs on it); answering `404 not_a_file`
  from the `POST` (door 4 names `404 not_found`); a `POST` that answers before the pass over its path (the next list
  would read the old header); asserting C52's inode, or an in-place write for `abandon` to keep it (that would take the
  decision off the guarded write door 4 names): left to the owner

Status of batch C (updated in the commit that closes each piece):

- the API's cross-cutting checks (C64-C69): closed, every proof green, the new ones in `tests/natureza.contract.test.ts`
  (C64, C65, C66, C68, C69), and the existing ones they name (`api.openapi` C16, `security-reads` C55 and its
  "finds nothing outside the list", `sdk.instances` C30, `cleanup.layer` C19, `organize.maps` C33, `notesview.properties`
  C19) green and unchanged

- **Boundary (batch C):** C64-C69 closed at `cfe1a9d`. On the tree of `cfe1a9d`: `npm run build`, `npm run typecheck`
  and `npm run lint` exit 0, `npx vitest run` at the root is green (157 files, 2139 tests, 1 skipped) and
  `npm run test -w apps/command-centre` too (161 files, 1326 tests); each of the 12 `Proof:` lines of C64-C69 passes and
  runs only its check's test. No product code changed: the search and recall keys batch A typed (C65), the two routes,
  their scopes, their `docs/security.md` rows and their scenarios batch B added (C64, C66), the date keys of the
  properties (C69) and the cleanup as it was (C68) all held as built. No route, scope, event, settings leaf or
  migration was added, so no pinned count moved and no pinned test was edited; the raw `fs` allowlist and the
  module-state list (C67) are the files of `aa687ed`, untouched by A, B or C. C70-C93 are untouched (batch D): no
  screen, no locale key, no `natureza.contract` case for C92.
- **Settled mid-build:** nothing by the owner. Builder decisions inside the approved shape, none a new one-way door:
  (a) C66's "unchanged" run lists are compared with `apps/api/src/server.ts` at `aa687ed`, the commit before batch A,
  as C5's C76 compares them with its own base; (b) C65's response without a key is made in the test, not in the
  product: the search's by a spy on `ctx.semantic.search` that drops the key from each hit, the recall's by a
  `vi.mock` of `@mordomo/core/internal` that wraps `recall` and drops it from each `answerContext[]` item only when the
  test names a key (it is `recall` itself otherwise, for the whole file); both answers come back `500
response_contract_violation` with the key in the message, from a `notesViewWorld` server (`validateResponses` on
  under test); C65 also reads the two keys as required in the OpenAPI document's hit and item and as query parameters
  of both operations; (c) C64's "where the claims above answer them" is read as `GET` declaring `400 validation` and
  `404 context_not_found` and none of the decision's own codes, and `POST` the other seven (`400 validation` by the
  common rule), asserted on the entry and in the served document; the seven actions are asserted as the body's enum,
  each one accepted and `delete` refused; (d) C66's "no file or row changes" is every file under `memory/`, the
  indexed file outside it, both `mtime`s and every `review_state` row, over three refused decisions (`keep` on the
  editable note with its `baseVersion`, `snooze` and `never` on the file outside); the run credential is first shown
  live on `GET /api/memory/recall`; (e) C68's scan is over `memory/notes/c68` with the default `staleDays` (180), the
  `plano` note's `mtime` 400 days back and the `review_every: 7d` one's 30; (f) C69's "read back with the kind `date`"
  is `GET /api/memory/note`'s `properties` entry `{ key: "became_fact", kind: "date", value: "2026-10-30" }`, and its
  bare line is the file's bytes compared whole
- **Abandoned:** changing product code to make a response leave a key out for C65 (a debug switch in the route would
  be code no check asks for); a test-only route registered beside the real ones for C65 (it would prove the check of a
  synthetic entry, not of `memory.search` and `memory.recall`)

Status of batch D (updated in the commit that closes each piece):

- the screens (S5: C70-C89, C93) and their cross-cutting checks (C90-C92): closed, every proof green, in
  `src/brain/reviews/reviewsEntries.test.tsx` (C70, C71), `src/commands/commands.source.test.ts` (C71),
  `src/brain/reviews/ReviewsScreen.test.tsx` (C72, C73, C75-C79, C81-C85), `src/brain/reviews/natureBadges.test.tsx`
  (C74, C86, C87), `src/brain/reviews/BecameFactDialog.test.tsx` (C80), `src/hooks/notificationText.test.ts` and
  `src/views/settings/sentinels.test.tsx` (C88), `src/brain/reviews/reviewsMotion.test.ts` (C89, C90),
  `src/brain/reviews/reviewsCopy.test.ts` (C93), `tests/e2e/reviews.spec.ts` (C70, C90, C91) and
  `tests/natureza.contract.test.ts` (C92), with `tests/bundle-size.test.ts` C31 and `npm run bundle:check` green

- **Boundary (batch D):** C70-C93 closed at `fdac240` (the screens, their tests and the weight) and `f1756b3` (the
  browser proofs and the gallery's entry). On the tree of `f1756b3`: `npm run build`, `npm run typecheck`, `npm run lint`
  and `npm run bundle:check` exit 0, `npx vitest run` at the root is green (157 files, 2140 tests, 1 skipped) and
  `npm run test -w apps/command-centre` too (168 files, 1404 tests); each of the 30 `Proof:` lines of C70-C93 passes and runs only its
  check's tests; `reviews.spec.ts`, `cleanup.spec.ts`, `a11y.spec.ts`, `notes-view.spec.ts`, `gallery.spec.ts` and
  `gallery-contrast.spec.ts` run together: 118 passed (a first run had 117 and one failure, `notes-view.spec.ts` C85 in the moldura, the known "Response has been disposed" race of that spec's own `ui-preferences` handler at its line 30 during `page.reload()`; that test alone then passed 10 of 11 runs at `f1756b3` and 6 of 6 at `b0c9c6d`; the spec was not edited). Weight, measured on the final build: 556 121 B of JS gzip
  (+9 712 B over `cerebro-faxina-guiada`, under the 12 288 B cap) and 77 763 B of CSS gzip (+1 292 B, under the
  2 048 B cap), recorded as the `cerebro-natureza` entry of `scripts/bundle-baseline.json`. No route, scope, event,
  settings leaf or migration was added. Pinned files edited, each by addition only: `src/legacy.graph.test.ts`
  (`brain/reviews/testkit.tsx` joins the closed list of files no entry reaches, as C5's testkit did),
  `src/commands/commands.source.test.ts` (C71's case beside C5's C52), `src/hooks/notificationText.test.ts` (C88's
  case). No allowlist of listeners, raw `fs` or module state moved. With this batch every check of the feature has a
  closing commit; the Verifier is the coordinator's.
- **Settled mid-build:** nothing by the owner. Builder decisions inside the approved shape, none a new one-way door:
  (a) the light, shared half is `brain/natureza.tsx` and `brain/natureza.css` (the readers of `fields` through the
  closed lists, the badges, the filter rows, the search's "Filtros", `useReviewsDue` and `REVIEWS_PATH`); the screen,
  the dialog and their stylesheet are `brain/reviews/` (`ReviewsScreen.tsx`, `BecameFactDialog.tsx`, `reviews.css`), one
  chunk reached by `ReviewsView = lazyRoute(import("./reviews/ReviewsScreen"))` in `BrainViewSwitch.tsx`, whose
  `BrainMode` gains `"reviews"` for `/brain/reviews` (the frame's `SecondBrain` and the Núcleo's brain scene render it
  where they render the notes view); (b) design.md's tokens `--tone-ok`, `--tone-info`, `--tone-warn`, `--tone-muted`
  do not exist in `theme.css`: each badge carries a class of that name (`tone-ok`, `tone-info`, `tone-warn`,
  `tone-muted`, and `tone-accent` for `--accent`) coloured by the existing token it names (`--ok`, `--info`, `--warn`,
  `--text-dim`, `--accent-text`), which is how C74 reads "the `--tone-ok` class"; (c) the short name of a nature (the
  dense badge, "Sugestão: {natureza}", "Classificado como {natureza}.") is the badge's text, but "Plano" for `plano`
  (`notes.callout.plano`); (d) the nature filters do not apply to "Sem classificação" (its notes have no nature), the
  scope filters and the context do; (e) the list's `role="status"` reads `reviews.notification` ("N itens para
  revisar") for the active tab; the undo notice is a second `role="status"`, 8 s, and a partial undo stays until it is
  retried; the item returns to the list when every part of its undo succeeded; (f) a decision on a note reads the note
  (`GET /api/memory/note`) for its version and its properties when the detail has not read it yet, and the undo puts
  back the keys door 4 writes for that action (`last_reviewed`; `review_every`; `status`, `abandoned`; `natureza`;
  `natureza`, `was` when the note had a nature, `became_fact`, `last_reviewed`) from those properties; a snooze never
  sends `baseVersion`; (g) the list's path is relative to the home (`GET /api/system/info`), as the cleanup wizard
  shows it; (h) the detail's passages are the `> [!nature]` lines of the note's body, outside fences; (i) "Confirmar"
  of the dialog waits while "Registrar como fato" is open with a field empty; (j) the scene menu takes
  `reviewsDue`/`onReviews` from `BrainScene` (the primitives' C23 renders the menu with no query client); (k) every
  Markdown file's preview shows the nature badge ("Não classificado" with none), the scope and abandoned badges only
  when set; every search hit shows its dense badge, "Não classificado" included; (l) the brain's "Ver grafo" keeps no
  `v` in "Revisões" (there `v` is "Ainda vale"), and the shortcuts sheet titles the `view:reviews` block "Revisões"
  (`ShortcutsHelp.tsx`); the two keys `reviews.cmd.next` / `reviews.cmd.prev` ("Próximo item" / "Item anterior") name
  `j` and `k`, beyond the design's table; (m) the pt-BR body of the `reviewDue` inbox row is fixed text in
  `notificationText.ts`, its title `reviews.notification` with `display`; (n) proof readings: C70's moldura half
  renders `BrainChrome` (the order) and the shell (the way in); the Núcleo's runs the scene in the shell; the inbox row
  is the bell's row of a `GET /api/notifications` the kit (and, in the browser, a route) answers; the kit answers any
  other query of `GET /api/memory/reviews` with a different list (99 for the count), so a dropped context fails; C72's
  "on the right" and "list left, detail right" are the DOM order and the stylesheet's rules in jsdom, the boxes in the
  browser (C90); C76's other notices and C77's three sides run on the screen with `userEvent`; C80's dialog is opened
  from the screen; C86's three screens are the moldura's shell (canvas mocked), the Núcleo's shell and the notes view;
  C88's "sends `PUT /api/settings`" is the patch handed to `api.putSettings`, the Settings screen's save; C90's empty
  list is the filters "Hipótese" and "Externo" over the test's notes
- **Abandoned:** the scene menu asking for the count itself (the primitives' C23 renders it bare); a gallery story
  with the dialog open at load (it would cover the gallery): the story opens it from "Virou realidade"; a sixth
  "Não classificado" filter button (amendment 15: the routes take five natures)

## Correções da rodada 1

Changes added after approval, on the findings of `verification.md` round 1 (FAIL at `26ac3ef`), asked for by the
coordinator on 30/10/2026. No product code changed: the shipped code was right in both gaps, and no new test exposed a
bug.

- **C71, the `v` guard (gap 1, fault F8).** The claim gains its round-1 clause: in "Revisões", in both shells, the brain's
  "Ver grafo" holds no key, and `v` sends "Ainda vale" on an item and does nothing on an empty list and on the "Sem
  classificação" tab, with the hash staying `#/brain/reviews`. Proof: six new cases in
  `src/brain/reviews/reviewsEntries.test.tsx` (`-t "C71 "`, now 8 tests), mounted in the shell at `/brain/reviews`
  with the real `BrainViewSwitch`. F8 re-injected (`keys: ["v"]` back on "Ver grafo", `BrainViewSwitch.tsx:84`): the
  6 cases fail; with the assertion on "Ver grafo"'s keys taken out, the behaviour alone still fails all 6 (the hash
  becomes `#/brain`, or no "Ainda vale" is sent because "Ver grafo" takes the key). Reverted.
- **C94, the header's context shortcut (gap 2, fault F9).** New check: the header's "Contexto: Projeto X", after the
  filters, runs `action:switch-context` once and the shell's context menu opens, in both shells. Proof: two cases in
  `src/brain/reviews/reviewsEntries.test.tsx` (`-t "C94 "`). F9 re-injected (the button's `onClick` finds the command
  and does not run it, `ReviewsScreen.tsx:451`): both fail (`expected "run" to be called 1 times, but got 0 times`).
  Reverted. Coverage: the arrangements row grows to 13 with "context shortcut after the filters C94"; the binding
  sources row of design.md and the screens' claims line name C94.
- **C2's wording (gap 3).** The claim says what the proof asserts: seven files, a pass that emits `index.finished` and no
  `index.failed`, and exactly 7 files added (it said "five files" and "`errors: 0`", a key `IndexStats` does not have).
  The proof's `stats.added >= 7` is now `toBe(7)`, with the case list asserted at 7: deterministic, since every test of
  the file indexes what it writes (3 runs of the whole file and the selector alone, green).
- **C74, the muted badge (gap 5).** The stylesheet assertion covers the five tones: `tone-muted` has no rule of its own
  and takes `var(--text-dim)` from `.badge.meta` (`theme.css`), no rule colours every `.nb`, no other tone rule exists,
  and the relato badge carries `badge meta nb tone-muted`. Fault re-injected (`.nb.tone-muted { color: var(--ok) }`):
  fails with `tone-muted: expected 'var(--ok)' to be 'var(--text-dim)'`. Reverted. The claim is unchanged.
- **Bookkeeping (gap 4).** In `plan.md`, amendment 24 moves from after `## Sources` into "Emendas depois da aprovação",
  after amendment 23, and the questions table gains question 10 as `.specs/STATE.md` cerebro-natureza 10 has it (the
  default: the same path, with no name created or removed under the home). The header of this file says 94 checks, 24
  amendments and 8 new questions (3-10).
