# LESSONS - auto-maintained by scripts/lessons.py

> Machine-owned. Do NOT hand-edit. Changes are overwritten on the next `lessons.py` write.
> Canonical state lives in `.specs/lessons.json`. Edit lessons only via the script.
> promote_threshold=2 distinct features · window_days=45 · quarantine_threshold=2

## Confirmed (load these at Plan/Checks)

Corroborated across multiple features. Safe to apply as guidance.

### L-015 - List every entry point that can start the guarded action before claiming a policy holds

- signal: `ac_gap` · recurrence: 2 feature(s) · scope: `policy` · harmful: 0
- features: capacidades-aplicadas, cerebro-organizar
- evidence: apps/api/src/cli.ts:1377 (round 1, CLI) (policy) (+1 more)
- last seen: 2026-10-30T01:11:41Z

### L-034 - When the Test policy asks for an own-layer proof of a decision table, name a unit test per table row against the module; boundary tests alone leave the row unmet.

- signal: `ac_gap` · recurrence: 2 feature(s) · scope: `checks` · harmful: 0
- features: cerebro-contextos, cerebro-organizar
- evidence: verification.md Test policy row 1; core/src/memory/contexts.ts:215 (checks) (+1 more)
- last seen: 2026-10-30T01:11:41Z

### L-039 - Each case of a refused-kind table must be refused for its own reason alone; a case another rule also refuses stays green when its rule is removed.

- signal: `spec_precision_gap` · recurrence: 2 feature(s) · scope: `validation` · harmful: 0
- features: cerebro-contextos, cerebro-organizar
- evidence: C3; tests/contexts.test.ts:169 (validation) (+1 more)
- last seen: 2026-10-30T01:11:41Z

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

### L-011 - Prove every state a lock or guard file can be found in, including unreadable and owned by the current process

- signal: `ac_gap` · recurrence: 1 feature(s) · scope: `concurrency` · harmful: 0
- features: motor-composicao
- evidence: core/src/engine.ts:310-322 (round 1, lock states) (concurrency)
- last seen: 2026-10-06T14:27:38Z

### L-012 - A lifecycle method needs one assertion per side effect it promises, not only the first

- signal: `ac_gap` · recurrence: 1 feature(s) · scope: `lifecycle` · harmful: 0
- features: motor-composicao
- evidence: core/src/engine.ts:279 (round 1, start effects) (lifecycle)
- last seen: 2026-10-06T14:27:38Z

### L-013 - Prove a rule by every value of the field it branches on, including the ones that must keep the old behaviour

- signal: `surviving_mutant` · recurrence: 1 feature(s) · scope: `policy` · harmful: 0
- features: capacidades-aplicadas
- evidence: core/src/runs/runManager.ts:580 (F5, round 1) (policy)
- last seen: 2026-10-06T14:56:25Z

### L-014 - A rule about every child process must be proven on each spawn path, not only the main one

- signal: `ac_gap` · recurrence: 1 feature(s) · scope: `security` · harmful: 0
- features: capacidades-aplicadas
- evidence: core/src/spawn/safeSpawn.ts:274 (round 1, probes) (security)
- last seen: 2026-10-06T14:56:25Z

### L-016 - Size a Coverage set from the AC's own list, not from the subset the author thought of: when an AC says 'each of those names', the set size is the count in the AC it points back to.

- signal: `ac_gap` · recurrence: 1 feature(s) · scope: `checks` · harmful: 0
- features: contratos
- evidence: contratos round 1: AC3 named 14 re-exported names, Coverage sized the set at 3 (checks)
- last seen: 2026-10-06T17:33:09Z

### L-017 - A 'derives from X' claim needs a behavioral proof (stub X and show the output follows the stub); a text check that X is imported survives the old duplicated logic kept beside the import.

- signal: `surviving_mutant` · recurrence: 1 feature(s) · scope: `checks` · harmful: 0
- features: contratos
- evidence: contratos round 1 P1: C11 text check passed with the duplicated if-chain restored (checks)
- last seen: 2026-10-06T17:33:09Z

### L-018 - When the build adds anything to a one-way door's literal shape (an extra package export, a new field), amend the Landing row in the same commit and add a check that pins the whole shape with toEqual.

- signal: `spec_precision_gap` · recurrence: 1 feature(s) · scope: `build` · harmful: 0
- features: contratos
- evidence: contratos round 1: exports['./policy'] shipped beyond the Landing literal shape (build)
- last seen: 2026-10-06T17:33:09Z

### L-019 - Prove 'module M does not pull dependency D' by walking M's value-import graph (imports, re-exports, side-effect and dynamic imports, either quote style, type-only skipped) and asserting the reachable set, not by filtering lines that start with import.

- signal: `surviving_mutant` · recurrence: 1 feature(s) · scope: `checks` · harmful: 0
- features: contratos
- evidence: contratos rounds 2-3: a value re-export, then a single-quoted import, reached zod through the ./policy subpath (checks)
- last seen: 2026-10-06T17:33:09Z

### L-020 - Build a typed envelope with an annotation or satisfies, never an as-cast: the cast lets the compiler accept a missing required field that only a runtime test would catch.

- signal: `spec_precision_gap` · recurrence: 1 feature(s) · scope: `build` · harmful: 0
- features: contratos
- evidence: contratos round 1: event envelope built with 'as OsEvent<K>', tsc accepted it without v (build)
- last seen: 2026-10-06T17:33:09Z

### L-021 - When a screen switches data source, prove it with a render test where the old and new sources serve different values; a source regex misses reformatting, aliases and destructuring.

- signal: `surviving_mutant` · recurrence: 1 feature(s) · scope: `checks` · harmful: 0
- features: preferencias-ui
- evidence: preferencias-ui round 1 P1-P3: reverting screens to read/write the old source passed a regex source check (checks)
- last seen: 2026-10-07T00:14:29Z

### L-022 - To forbid moved fields, remove them from the read type (so any read is TS2339) and give every write path one patch type with the keys as never; back it with a runtime guard at the single request function.

- signal: `spec_precision_gap` · recurrence: 1 feature(s) · scope: `build` · harmful: 0
- features: preferencias-ui
- evidence: preferencias-ui round 2 N1-N3/M21: '?: never' keys still compiled reads and a Partial<> write path let spreads through (build)
- last seen: 2026-10-07T00:14:29Z

### L-023 - Prove an 'only after X succeeds' claim by making X fail and asserting the dependent step never runs; call order alone survives a missing await.

- signal: `surviving_mutant` · recurrence: 1 feature(s) · scope: `checks` · harmful: 0
- features: preferencias-ui
- evidence: preferencias-ui round 3 S2: 'only after both writes succeed' proven by call order; dropping the await survived (checks)
- last seen: 2026-10-07T00:14:29Z

### L-024 - When a migration moves data between files, add an AC for restoring a backup made before the migration; restore bypasses the upgrade path the migration was tested on.

- signal: `ac_gap` · recurrence: 1 feature(s) · scope: `plan` · harmful: 0
- features: preferencias-ui
- evidence: preferencias-ui round 1 B2: restoring a pre-feature backup lost its UI preferences (plan)
- last seen: 2026-10-07T00:14:29Z

### L-025 - A 'kept byte for byte' claim needs a non-canonical fixture (other indentation, key order, no trailing newline), or re-serializing passes as copying.

- signal: `surviving_mutant` · recurrence: 1 feature(s) · scope: `checks` · harmful: 0
- features: preferencias-ui
- evidence: preferencias-ui round 1 F2: byte-for-byte .bak check passed with re-serialization because the fixture was already canonical (checks)
- last seen: 2026-10-07T00:14:30Z

### L-026 - Size the 'routes that take X' set by grepping every route for X in params, bodies and the stored record it replays (retry, resolve, run-now), not from the routes the plan named.

- signal: `ac_gap` · recurrence: 1 feature(s) · scope: `checks` · harmful: 0
- features: provedores-plugaveis
- evidence: provedores-plugaveis round 1: retry, routine run and approval resolve took a provider but were not in the route list (checks)
- last seen: 2026-10-07T01:20:30Z

### L-027 - Enforce a safety rule where the value is used (the engine building adapters), not only where it is written (the PUT route); stored, hand-edited and migrated values bypass write-time checks.

- signal: `spec_precision_gap` · recurrence: 1 feature(s) · scope: `plan` · harmful: 0
- features: provedores-plugaveis
- evidence: provedores-plugaveis round 1: a stored mismatched binaryPath was still executed because only new values were checked (plan)
- last seen: 2026-10-07T01:20:30Z

### L-028 - Prove platform-dependent code by simulating process.platform and calling it the way production does (no explicit platform argument); a test that always passes the platform cannot see a wrong default.

- signal: `surviving_mutant` · recurrence: 1 feature(s) · scope: `checks` · harmful: 0
- features: provedores-plugaveis
- evidence: provedores-plugaveis rounds 2-3: platform-dependent check passed with a hard-coded platform, first in the body then in the default parameter (checks)
- last seen: 2026-10-07T01:20:30Z

### L-029 - Write source-shape checks on the TypeScript syntax tree, with self-tests for each shape the claim covers and each false positive it must not flag; regexes over source text miss and over-match.

- signal: `surviving_mutant` · recurrence: 1 feature(s) · scope: `checks` · harmful: 0
- features: provedores-plugaveis
- evidence: provedores-plugaveis rounds 1-3: regex source detector missed computed/shorthand/cast keys and flagged strings and destructuring (checks)
- last seen: 2026-10-07T01:20:30Z

### L-030 - When a guard covers several payload kinds, prove it table-driven over every kind; one representative lets a guard narrowed to that kind survive.

- signal: `surviving_mutant` · recurrence: 1 feature(s) · scope: `checks` · harmful: 0
- features: provedores-plugaveis
- evidence: provedores-plugaveis round 3 MA2: approval guard proven only on prompt payloads (checks)
- last seen: 2026-10-07T01:20:30Z

### L-031 - A fix that changes behaviour needs a test where the old and the new code answer differently; otherwise reverting the fix leaves every proof green.

- signal: `surviving_mutant` · recurrence: 1 feature(s) · scope: `fixes` · harmful: 0
- features: cerebro-correcoes
- evidence: verification.md M8 - core/src/memory/recall.ts:437 (C8) (fixes)
- last seen: 2026-10-29T17:53:41Z

### L-032 - When the plan says two readers share one resolver, a check must assert that both return the same answer on an ambiguous input; a check that only one reader picks correctly lets the other diverge.

- signal: `surviving_mutant` · recurrence: 1 feature(s) · scope: `resolution` · harmful: 0
- features: cerebro-correcoes
- evidence: verification.md M8c - core/src/memory/recall.ts:437 (C8) (resolution)
- last seen: 2026-10-29T18:03:56Z

### L-033 - A check about following a name that several files share must say which file wins, not only which files are refused.

- signal: `spec_precision_gap` · recurrence: 1 feature(s) · scope: `resolution` · harmful: 0
- features: cerebro-correcoes
- evidence: C8 - several readable homonyms (resolution)
- last seen: 2026-10-29T18:03:56Z

### L-035 - Every status a Surface row gains mid-build needs a check whose proof drives that status, not only a test that the route declares it.

- signal: `ac_gap` · recurrence: 1 feature(s) · scope: `checks` · harmful: 0
- features: cerebro-contextos
- evidence: verification.md Coverage; apps/api/src/routes/system.ts:156 (checks)
- last seen: 2026-10-29T22:08:22Z

### L-036 - Give every variant a design draws for a component its own rendered-component check, including the variant shown only for a continued session.

- signal: `ac_gap` · recurrence: 1 feature(s) · scope: `ui` · harmful: 0
- features: cerebro-contextos
- evidence: apps/command-centre/src/contexts/ContextChip.tsx:18 (ui)
- last seen: 2026-10-29T22:08:22Z

### L-037 - A Landing row added mid-build that narrows an approved row is a renegotiation: get the owner's sign-off and reword every check that quotes the old shape in the same commit.

- signal: `spec_deviation` · recurrence: 1 feature(s) · scope: `build` · harmful: 0
- features: cerebro-contextos
- evidence: C22; tests/contexts.runs.test.ts:376 (build)
- last seen: 2026-10-29T22:08:22Z

### L-038 - Prove that no new raw fs read was added with the sweep that audits the code, not with the length of the test's own allowlist.

- signal: `spec_precision_gap` · recurrence: 1 feature(s) · scope: `checks` · harmful: 0
- features: cerebro-contextos
- evidence: C47; tests/security-reads.test.ts:2325 (checks)
- last seen: 2026-10-29T22:08:22Z

### L-040 - When a check is reworded, rename its proof's test title and comments in the same commit, or the test name keeps stating the old claim its assertions now contradict.

- signal: `spec_precision_gap` · recurrence: 1 feature(s) · scope: `tests` · harmful: 0
- features: cerebro-contextos
- evidence: tests/contexts.runs.test.ts:297 (tests)
- last seen: 2026-10-29T23:05:57Z

### L-041 - Assert every field a failure record promises, not only its code

- signal: `surviving_mutant` · recurrence: 1 feature(s) · scope: `runs` · harmful: 0
- features: cerebro-organizar
- evidence: core/src/runs/runManager.ts:1005 (mutant 3, C20) (runs)
- last seen: 2026-10-30T01:11:41Z

### L-042 - A field-by-field settings merge must say how deep it goes, and a proof must show a patch that omits an optional nested key keeps or drops it as the contract says

- signal: `spec_deviation` · recurrence: 1 feature(s) · scope: `config` · harmful: 0
- features: cerebro-organizar
- evidence: apps/api/src/routes/system.ts:105,119 (door 12, finding 4) (config)
- last seen: 2026-10-30T01:11:41Z

### L-043 - Name a request in a check with the query parameters the route contract declares

- signal: `spec_precision_gap` · recurrence: 1 feature(s) · scope: `checks` · harmful: 0
- features: cerebro-organizar
- evidence: C2 (check says ?path=, route takes ?rel=) (checks)
- last seen: 2026-10-30T01:11:41Z

### L-044 - A clause like 'as before' in a check still needs its value asserted by name, not only what it is not.

- signal: `spec_precision_gap` · recurrence: 1 feature(s) · scope: `tests` · harmful: 0
- features: cerebro-vista-notas
- evidence: C83 tests/notesview.create.test.ts:111 (tests)
- last seen: 2026-10-30T06:34:11Z

### L-045 - When a proof asserts an arrangement its claim does not name, put it in the claim and in the Coverage row.

- signal: `spec_precision_gap` · recurrence: 1 feature(s) · scope: `checks` · harmful: 0
- features: cerebro-vista-notas
- evidence: C42 tests/e2e/notes-view.spec.ts:234 (checks)
- last seen: 2026-10-30T06:34:11Z

### L-046 - A check that says where something sits on screen needs an order assertion, not a find-anywhere query.

- signal: `surviving_mutant` · recurrence: 1 feature(s) · scope: `ui` · harmful: 0
- features: cerebro-vista-notas
- evidence: C31 NotesSidebar.tsx:78 (ui)
- last seen: 2026-10-30T06:34:11Z

### L-047 - A one-way door a builder adds mid-build owes a check and an owner question in the same commit.

- signal: `ac_gap` · recurrence: 1 feature(s) · scope: `plan` · harmful: 0
- features: cerebro-vista-notas
- evidence: plan.md Landing doors 6-8 (plan)
- last seen: 2026-10-30T06:34:11Z

### L-048 - A static walker that proves an absence must resolve bindings to the import and list in its claim the spellings it does not cover.

- signal: `surviving_mutant` · recurrence: 1 feature(s) · scope: `tests` · harmful: 0
- features: cerebro-faxina-guiada
- evidence: C50 tests/cleanup.layer.test.ts (tests)
- last seen: 2026-10-30T16:00:19Z

### L-049 - A partial outcome of a multi-step undo needs its own case, asserting both what stays and that a second run still works.

- signal: `surviving_mutant` · recurrence: 1 feature(s) · scope: `tests` · harmful: 0
- features: cerebro-faxina-guiada
- evidence: C48 cleanupApply.ts:433 (tests)
- last seen: 2026-10-30T16:00:19Z

### L-050 - Test a list writer with exactly one item, not only with several.

- signal: `surviving_mutant` · recurrence: 1 feature(s) · scope: `tests` · harmful: 0
- features: cerebro-faxina-guiada
- evidence: C44 cleanupApply.ts:307 (tests)
- last seen: 2026-10-30T16:00:19Z

### L-051 - A test that seeds stored rows by hand does not prove the writer stores them; read back what the route wrote.

- signal: `ac_gap` · recurrence: 1 feature(s) · scope: `tests` · harmful: 0
- features: cerebro-faxina-guiada
- evidence: C26 tests/cleanup.layer.test.ts:681 (tests)
- last seen: 2026-10-30T16:00:19Z

### L-052 - A UI test mock must honour the query it receives, or the scope the screen sends goes unproven.

- signal: `spec_precision_gap` · recurrence: 1 feature(s) · scope: `ui` · harmful: 0
- features: cerebro-faxina-guiada
- evidence: C54 testkit.tsx:137 (ui)
- last seen: 2026-10-30T16:00:19Z

## Quarantined (failed when applied - ignore)

A confirmed lesson that recurred alongside failure. Kept for the maintainer to review.

_none_
