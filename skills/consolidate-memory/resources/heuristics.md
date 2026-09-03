# Promotion heuristics (Generative Agents × OpenClaw "dreaming")

Every journal bullet gets `score = recall × importance × recency`.

| Signal | How to compute | Range |
|---|---|---|
| **recall** | `1 + count` for the journal file in `GET /api/memory/recall/stats` (`paths[].count`); bullets mentioning a path that appears in the stats inherit that path's count | 1 … |
| **importance** | 1 = routine chatter (run finished, file opened); 2 = fact with a number, a name or a date; 3 = a decision, a commitment, a deadline, a change of plan; 4 = something that affects money, health, legal or a client | 1–4 |
| **recency** | 1.0 today, 0.9 yesterday, decaying ×0.9 per day (7 days ≈ 0.48) | 0.4–1 |

Promote when `score ≥ 3`, or when the line sits under **Decisions**, or when the
same fact appears on two or more days (repetition is memory's own vote).

## What goes where in MEMORY.md

- `## Facts` — stable statements: `subject — predicate — object (journal YYYY-MM-DD)`.
  Also assert them through `POST /api/memory/facts` so they become queryable by date.
- `## Decisions` — one line each, with the "why" when the journal has it.
- `## Open loops` — unresolved items; when a later journal closes one, append
  `→ closed YYYY-MM-DD` to the line instead of deleting it.
- `## Reflections` — 2-4 sentences, only when accumulated importance in the window ≥ 15.
- `## Superseded` — every replaced fact, with `valid_to:: YYYY-MM-DD` on the same line.

## Never

- Delete a line, a journal file or a fact. Supersede, close, annotate.
- Promote run bookkeeping ("run … done in 3s") unless it carries a decision.
- Promote secrets, tokens or credentials, even if the journal quotes them.
