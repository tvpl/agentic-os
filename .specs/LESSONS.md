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

### L-005 - Prove a state-gated credential in every state it must accept, not only the first one a fixture can reach

- signal: `surviving_mutant` · recurrence: 1 feature(s) · scope: `auth` · harmful: 0
- features: seguranca-p0
- evidence: apps/api/src/context.ts:337 (F3, verification round 1) (auth)
- last seen: 2026-10-06T13:30:13Z

### L-006 - An allow-list check needs one case per allowed member and one asserting the set has nothing else

- signal: `ac_gap` · recurrence: 1 feature(s) · scope: `validation` · harmful: 0
- features: seguranca-p0
- evidence: apps/api/src/routes/memory.ts:52-57 (round 1 coverage) (validation)
- last seen: 2026-10-06T13:30:13Z

### L-007 - A rule applied by a shared handler must be proven on every route that reaches the handler

- signal: `ac_gap` · recurrence: 1 feature(s) · scope: `routes` · harmful: 0
- features: seguranca-p0
- evidence: apps/api/src/server.ts:313 (round 1 coverage) (routes)
- last seen: 2026-10-06T13:30:13Z

### L-008 - Assert a configuration filter by its exact value, never by a pattern that a look-alike value also matches

- signal: `surviving_mutant` · recurrence: 1 feature(s) · scope: `config` · harmful: 0
- features: ci-gate
- evidence: tests/ci.workflow.test.ts:30 (P4, round 1) (config)
- last seen: 2026-10-06T14:01:28Z

### L-009 - A claim about every event of a kind must also assert that no filter narrows it

- signal: `spec_precision_gap` · recurrence: 1 feature(s) · scope: `config` · harmful: 0
- features: ci-gate
- evidence: tests/ci.workflow.test.ts:26 (P2/P3, round 1) (config)
- last seen: 2026-10-06T14:01:28Z

### L-010 - A hand-written reader of a structured file needs a proof with comments and reordered keys

- signal: `surviving_mutant` · recurrence: 1 feature(s) · scope: `config` · harmful: 0
- features: ci-gate
- evidence: tests/ci.workflow.test.ts:18 (P6, round 2) (config)
- last seen: 2026-10-06T14:01:28Z

## Quarantined (failed when applied - ignore)

A confirmed lesson that recurred alongside failure. Kept for the maintainer to review.

_none_
