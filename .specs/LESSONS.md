# LESSONS - auto-maintained by scripts/lessons.py

> Machine-owned. Do NOT hand-edit. Changes are overwritten on the next `lessons.py` write.
> Canonical state lives in `.specs/lessons.json`. Edit lessons only via the script.
> promote_threshold=2 distinct features · window_days=45 · quarantine_threshold=2

## Confirmed (load these at Plan/Checks)

Corroborated across multiple features. Safe to apply as guidance.

_none_

## Candidates (under observation - do NOT load as guidance yet)

Seen once or not yet corroborated. Tracked, not trusted.

### L-001 - Assert an animated element's start position within a few pixels of its origin; a containment check lets a 30 px drift through.

- signal: `surviving_mutant` · recurrence: 1 feature(s) · scope: `e2e/animation` · harmful: 0
- features: conceito-em-todo-sistema
- evidence: apps/command-centre/src/nucleo/Lamina.tsx:50 (e2e/animation)
- last seen: 2026-09-29T12:28:35Z

### L-002 - Carry the AC's numeric bound (duration, px) into the check text, or the proof will only assert presence.

- signal: `spec_precision_gap` · recurrence: 1 feature(s) · scope: `checks` · harmful: 0
- features: conceito-em-todo-sistema
- evidence: C11 (checks)
- last seen: 2026-09-29T12:28:35Z

### L-003 - An 'X appears once' proof must visit every tab or section that renders X, after each one has loaded.

- signal: `gate_fail` · recurrence: 1 feature(s) · scope: `e2e` · harmful: 0
- features: conceito-em-todo-sistema
- evidence: C18 (e2e)
- last seen: 2026-09-29T12:28:35Z

### L-004 - Every new unit test written for a check must be named as a Proof line of that check.

- signal: `surviving_mutant` · recurrence: 1 feature(s) · scope: `checks` · harmful: 0
- features: conceito-em-todo-sistema
- evidence: apps/command-centre/src/nucleo/pending/model.ts:144 (checks)
- last seen: 2026-09-29T12:28:36Z

## Quarantined (failed when applied - ignore)

A confirmed lesson that recurred alongside failure. Kept for the maintainer to review.

_none_
