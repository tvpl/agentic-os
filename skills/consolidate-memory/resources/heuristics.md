# Promotion heuristics (Generative Agents × OpenClaw "dreaming")

Every journal bullet gets `score = recall × importance × recency`.

| Signal | How to compute | Range |
|---|---|---|
| **recall** | `1 + count` for the journal file in `GET $MORDOMO_URL/api/memory/recall/stats` (`paths[].count`); bullets mentioning a path that appears in the stats inherit that path's count | 1 … |
| **importance** | 1 = routine chatter (run finished, file opened); 2 = fact with a number, a name or a date; 3 = a decision, a commitment, a deadline, a change of plan; 4 = something that affects money, health, legal or a client | 1–4 |
| **recency** | 1.0 today, 0.9 yesterday, decaying ×0.9 per day (7 days ≈ 0.48) | 0.4–1 |

Promote when `score ≥ 3`, or when the line sits under **Decisions**, or when the
same fact appears on two or more days (repetition is memory's own vote).

A journal line ending in `(autor:: agente)` is never promoted by the "Decisions" rule: an agent wrote it, not the owner.
It is promoted only by its score or by repetition, like any other line, and its op is proposed unticked.

## What each op proposes for MEMORY.md

Every op becomes one operation of `proposal.json`; MordomoOS applies the ones the owner accepts and writes each new line
as `- <text> (fonte:: <source>:<line>) (autor:: agente) (em:: <day>)`.

- `Facts` (`add`) — stable statements: `subject — predicate — object`.
  Propose a `fact` op as well, so the statement becomes queryable by date once accepted.
- `Decisions` (`add`) — one line each, with the "why" when the journal has it.
- `Open loops` (`add`) — unresolved items; when a later journal closes one, a `close_loop` op
  (`→ closed YYYY-MM-DD` is appended to the line instead of deleting it).
- `Reflections` (`add`) — 2-4 sentences, only when accumulated importance in the window ≥ 15.
- `Superseded` — a `supersede` op moves the replaced line there, with `valid_to:: YYYY-MM-DD` on the same line.
- `move_to_topic` — when a section passes about 30 lines, move a group of related lines to a topic file; MEMORY.md keeps
  one line pointing to it. The whole file stays under 200 lines and 25 000 bytes.

## Never

- Delete a line, a journal file or a fact. Supersede, close, move to a topic.
- Promote run bookkeeping ("run … done in 3s") unless it carries a decision.
- Promote secrets, tokens or credentials, even if the journal quotes them.
