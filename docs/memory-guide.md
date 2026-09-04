# Memory guide — layered recall, journal, consolidation

MordomoOS keeps your memory in **files you own** (markdown in the folders you
chose) plus a **derived index** (SQLite + FTS5) that is rebuilt from those
files and never edits them. This guide explains how a question is answered
with a fraction of the tokens, how the daily journal works, and how nightly
consolidation promotes what matters into long-term memory.

Related: [user manual](./user-manual.md) · [skills](./skills-guide.md) ·
[routines](./routines-guide.md) · [security](./security.md).

---

## 1. The four layers of recall

The naive way to answer "what did we decide about the Q3 budget?" is to let the
agent grep and read whole files: tens of thousands of tokens, most of them
irrelevant. `core/src/memory/recall.ts` does the same job deterministically in
four layers, and only the last two ever touch the disk.

| Layer | What happens | Cost |
|---|---|---|
| **1. Keywords** | The question is folded (accents removed), English and Portuguese stopwords dropped, tokens stemmed lightly (`approved → approv`, `decisões → decisao`); path-like tokens (`core/src/memory/recall.ts`, `budget-2026.md`) are kept whole. Max 8 keywords. | none |
| **2. Candidates** | One FTS pass per keyword over `files_fts` (name, rel, content) plus row-level signals already in the index: file name (×6), title (×4), tags (×3), path (×1.5), keyword coverage (×5), a **+8 boost when a router points at the file** and **+4 when a keyword names an area**. **No file is opened.** | one query per keyword |
| **3. Sections** | Only the top **K** candidates (default 3, `k=` up to 10) are read. Each file is split by markdown heading (fences respected; non-markdown is chunked in 40-line blocks) and every section is scored: heading hit +3, body hits `1 + log2(1+n)`, coverage ×2, a mild penalty for sections over 4 000 chars. The best section wins. | K file reads |
| **4. Pointers** | Markdown links **inside the winning section** are followed **one level only** (max 2 by default) and kept when the pointed section scores higher than the one that pointed at it. Only indexed files are followed, so the exclusion policy still holds. | ≤ 2 extra reads |

The answer is a list of sections, never whole files:

```json
{
  "question": "What was the Q3 budget approved?",
  "keywords": ["q3", "budget", "approv"],
  "answerContext": [
    { "path": "/…/finance/budget-2026.md", "section": "Q3",
      "excerpt": "The Q3 budget was approved at 42000 BRL…",
      "score": 41.2, "why": "name matches budget; 2/3 keywords in the index; listed in ROUTER.md; section \"Q3\" matches q3, budget" },
    { "path": "/…/vendors/acme.md", "section": "Q3 budget approval",
      "excerpt": "…", "score": 44.9, "why": "pointer from budget-2026.md § \"Q3\"", "via": "/…/finance/budget-2026.md" }
  ],
  "tokensEstimate": 96,
  "candidatesConsidered": 7,
  "opened": 2,
  "candidates": [ { "path": "…", "score": 33.5, "why": "…" } ],
  "durationMs": 4
}
```

`why` is always populated, for every candidate and every returned section: the
retrieval is auditable, and the same index plus the same question always
produces the same answer (unit-tested in `tests/core.memory.v2.test.ts`).

### How to call it

```bash
mordomo recall "what did we decide about the Q3 budget?"          # human output
mordomo recall "what did we decide about the Q3 budget?" --json   # for scripts
```

```bash
# TOKEN = config/token inside the MordomoOS home (the repo root, or $MORDOMO_HOME)
TOKEN=$(cat "${MORDOMO_HOME:-.}/config/token")
curl -s -H "x-mordomo-token: $TOKEN" \
  "http://127.0.0.1:4777/api/memory/recall?q=Q3%20budget&k=3"
```

| Endpoint | Purpose |
|---|---|
| `GET /api/memory/recall?q=&k=&area=&excerptChars=&record=` | The layered retrieval above. `record=false` skips the frequency bookkeeping. |
| `GET /api/memory/recall/stats?limit=` | How often each path was recalled (input to consolidation). |

Agents should use the **`/recall` skill** (`skills/recall/SKILL.md`) instead of
grepping: it forbids opening files before recall, requires `path § section`
citations, and reports the token counters on the last line.

### Measuring the saving (before / after)

Do the measurement on the same question, in the same workspace, twice:

1. **Before** — ask the agent the question with no recall (`claude -p "<question>"`
   in the workspace, letting it grep and read). Read the context report of the
   provider (`/context` in Claude Code, or the run's `usage` badge in
   **Runs → detail**, which MordomoOS captures per run).
2. **After** — run `mordomo recall "<question>" --json` and paste only
   `answerContext[]` into the same agent, or run the `/recall` skill. The
   JSON's `tokensEstimate` (`excerpt chars / 4`) is what recall costs; the run's
   `usage` badge tells you what the whole turn cost.
3. Compare `tokensEstimate + prompt` against the first number, and record
   `candidatesConsidered` (files scored) versus `opened` (files read). The
   reference measurement in the 2026-09 analysis is 50 k → 30 k tokens on a
   35 k-file workspace; the ratio that matters locally is
   **`opened / candidatesConsidered`** — with the defaults it is 3 files read
   out of dozens scored.

Keep the numbers in the journal (`POST /api/memory/journal/append`) so the
improvement is visible over time.

---

## 2. Daily journal

`memory/journal/YYYY-MM-DD.md` is created **on first access each day** from a
fixed template:

```markdown
# 2026-09-03 — Thursday

<!-- daily journal: append, never rewrite history. Promote lasting notes with the consolidate-memory skill. -->

## Today
## Decisions
## Open loops
## Runs
```

- **Append only.** `appendJournal` inserts one bullet at the end of a section
  (with an `HH:MM` stamp unless `timestamp:false`); a missing section is added
  at the end. Nothing is ever rewritten.
- **Runs write themselves.** `installJournalHooks(events, paths, { indexer })`
  subscribes to `run.finished` and leaves `- 14:22 run <id> → done in 4s` under
  **Runs**. It is idempotent per event bus + memory dir, and returns a disposer.
- **The journal is indexed.** The same hook registers `memory/` as an implicit
  index root, so journal notes are searchable and reachable by recall.
- **Today + yesterday are injected into the master router** (`memory/ROUTER.md`,
  between `<!-- journal:start -->` and `<!-- journal:end -->`) under a token
  budget: `settings.memory.journalBudgetTokens` (default **1200**, i.e. 4 800
  characters). Empty sections are dropped, today comes first, and whatever does
  not fit is cut with `…(trimmed)`. The journal block is excluded from the
  router pointer check, since it is free text, not a map.

| Endpoint | Purpose |
|---|---|
| `GET /api/memory/journal?date=YYYY-MM-DD` | One day (created if missing), its sections and the list of available dates. |
| `GET /api/memory/journal?days=N` | The last N days that exist, newest first. |
| `POST /api/memory/journal/append` | `{ text, section?: Today\|Decisions\|Open loops\|Runs, date?, timestamp? }`. |

---

## 3. Consolidation ("sleep")

The journal is a log; `memory/MEMORY.md` is what the agent should remember.
The **`consolidate-memory` skill** promotes one into the other:

1. reads the last N days of journal (`?days=`), the recall statistics and the
   current facts;
2. scores each bullet with **recall frequency × importance × recency**
   (`skills/consolidate-memory/resources/heuristics.md`); every "Decisions"
   line and every line repeated on 2+ days is a candidate;
3. appends the survivors to `memory/MEMORY.md` under `## Facts`,
   `## Decisions`, `## Open loops`, `## Reflections`, each with its source
   (`(journal 2026-09-03)`);
4. **never deletes**: a contradicted line moves to `## Superseded` with
   `valid_to:: <today>`, and the new value is asserted through
   `POST /api/memory/facts`, which closes the previous fact automatically;
5. writes a reflection when accumulated importance crosses the threshold, and
   an artifact `consolidation.md` listing everything it did.

`routines/nightly-consolidation.json` runs it at **03:00** with profile
`review_before_write` and is **disabled by default** — enable it in
**Routines** once you trust the output. Under that profile the run proposes the
new `MEMORY.md` as an artifact instead of writing it.

---

## 4. Bi-temporal facts

A fact is `subject predicate object` valid from `valid_from` until `valid_to`
(`NULL` = still true), with provenance (`source_run_id`, `source_path`).
Asserting a contradicting value **closes the old row instead of deleting it**,
so "what did we believe on 5 August?" stays answerable and the Second Brain can
render expired facts dimmed.

```bash
# assert (201, or 200 + "unchanged": true when the same fact is already open)
curl -X POST -H "x-mordomo-token: $TOKEN" -H 'content-type: application/json' \
  -d '{"subject":"acme","predicate":"status","object":"client","sourcePath":"/…/journal/2026-09-03.md"}' \
  http://127.0.0.1:4777/api/memory/facts

curl -H "x-mordomo-token: $TOKEN" "…/api/memory/facts?subject=acme"                     # valid now
curl -H "x-mordomo-token: $TOKEN" "…/api/memory/facts?subject=acme&asOf=1754352000000"  # valid then
curl -H "x-mordomo-token: $TOKEN" "…/api/memory/facts?subject=acme&includeExpired=true" # history
curl -X POST -H "x-mordomo-token: $TOKEN" "…/api/memory/facts/12/retract"               # close, no replacement
```

---

## 5. Inline fields (Dataview style)

Any markdown line of the form `key:: value` (also `- key:: value`) is parsed at
index time into a JSON `fields` column on the file row — keys are folded and
slugified (`Due Date::` → `due_date`), the first occurrence of a key wins, code
fences and URLs are ignored, 50 fields per file maximum.

```markdown
owner:: Ana
status:: approved
due_date:: 2026-09-10
```

```bash
curl -H "x-mordomo-token: $TOKEN" "…/api/memory/query?where=status:approved"  # exact, case-insensitive
curl -H "x-mordomo-token: $TOKEN" "…/api/memory/query?where=owner:~an"        # substring
curl -H "x-mordomo-token: $TOKEN" "…/api/memory/query?where=due_date"         # key present
```

Fields also ride along on `GraphNode.fields` in `/api/memory/graph`, so the
Second Brain and declarative widgets can group and colour by attribute.

---

## 6. Hygiene

`GET /api/memory/hygiene` turns the "audit by density" into an actionable list:

| Kind | Meaning | Suggested action |
|---|---|---|
| `orphan` | Markdown note with no link in or out (generated routers excluded) | `link` |
| `dangling-link` | Router pointer to a file that no longer exists | `open` |
| `stale` | Untouched for more than `staleDays` (default 90) | `archive` |
| `skill-never-run` | Skill with no run in the database | `open` |
| `silent-routine` | No firing within `silentRoutineDays` (default 30); routines younger than the window are not judged | `archive` |
| `unused-connector` | `lastUsedAt` older than `unusedConnectorDays` (default 30), or never used | `disconnect` |

Silent routines come from the scheduler (`RoutineScheduler.silent(days)`, the
same source as `GET /api/routines/silent`, which also flags routines that only
fail); without a scheduler — CLI, tests — the report falls back to the firing
history and ignores routines younger than the window.

The response is `{ generatedAt, counts, items, thresholds }` where `counts`
holds the **full** count per kind and `items` carries up to `perKind`
(default 50) entries of `{ kind, id, name, detail, action }` — `id` is the
absolute path for file kinds and the slug/id otherwise. Query parameters:
`staleDays`, `silentRoutineDays`, `unusedConnectorDays`, `perKind`.

The Second Brain's hygiene panel computes orphans/stale/unopened hubs
client-side from the loaded graph; the server report is the superset (it also
sees skills, routines and connectors, and counts beyond the graph cap). Mapping
for the panel: `items.filter(i => i.kind === "orphan")` → orphans,
`"stale"` → stale, `"dangling-link"` → dangling references; "unopened hubs"
stays client-side, since only the canvas knows what was expanded.

---

## 7. Where things live

| File | Role |
|---|---|
| `core/src/memory/recall.ts` | Keywords, candidate scoring, section split/score, pointers, recall statistics |
| `core/src/memory/journal.ts` | Daily notes, append, hooks, `memory/` as an index root |
| `core/src/memory/routers.ts` | `ROUTER.md` + `areas/*.md`, journal injection under budget |
| `core/src/memory/hygiene.ts` | The report above |
| `core/src/memory/facts.ts` | Bi-temporal facts (`facts` table, migration 3) |
| `core/src/memory/fields.ts` | `key:: value` parsing and `where=` queries |
| `core/src/memory/indexer.ts` | Incremental index, links, inline fields |
| `apps/api/src/routes/memory.ts` | All endpoints above; installs the journal hooks |
| `skills/recall/`, `skills/consolidate-memory/` | The agent-facing side |
| `routines/nightly-consolidation.json` | 03:00, disabled by default, `review_before_write` |
