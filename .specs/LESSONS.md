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

### L-053 - A test about a local day or local midnight must pin a non-UTC zone, or UTC runners cannot tell the mutant apart.

- signal: `surviving_mutant` · recurrence: 1 feature(s) · scope: `tests` · harmful: 0
- features: cerebro-natureza
- evidence: C80 BecameFactDialog.tsx:47 (tests)
- last seen: 2026-10-30T22:47:32Z

### L-054 - A rule that applies only in one place needs a negative case at a look-alike place with the same name.

- signal: `surviving_mutant` · recurrence: 1 feature(s) · scope: `tests` · harmful: 0
- features: cerebro-natureza
- evidence: C16 recall.ts:451 (tests)
- last seen: 2026-10-30T22:47:32Z

### L-055 - A filter on results must be tested on every path a result can arrive by, including followed links.

- signal: `surviving_mutant` · recurrence: 1 feature(s) · scope: `tests` · harmful: 0
- features: cerebro-natureza
- evidence: C19 recall.ts:637 (tests)
- last seen: 2026-10-30T22:47:32Z

### L-056 - A proof that skips without a build passes silently; its proof line must build first.

- signal: `spec_precision_gap` · recurrence: 1 feature(s) · scope: `checks` · harmful: 0
- features: cerebro-natureza
- evidence: C21 tests/natureza.cli.test.ts:32 (checks)
- last seen: 2026-10-30T22:47:32Z

### L-057 - A bound needs its accepted edge asserted (exactly N), not only the refused N+1.

- signal: `surviving_mutant` · recurrence: 1 feature(s) · scope: `tests` · harmful: 0
- features: cerebro-paineis
- evidence: C54 question.ts:70 (tests)
- last seen: 2026-10-31T12:05:33Z

### L-058 - An option must be proven to reach the stored result, not only the helper that takes it.

- signal: `surviving_mutant` · recurrence: 1 feature(s) · scope: `tests` · harmful: 0
- features: cerebro-paineis
- evidence: C40 kpi.ts:111 (tests)
- last seen: 2026-10-31T12:05:33Z

### L-059 - A rule a first-pass backfill also applies needs a second pass in its proof, or the backfill hides the mutant.

- signal: `surviving_mutant` · recurrence: 1 feature(s) · scope: `tests` · harmful: 0
- features: cerebro-paineis
- evidence: C104 indexer.ts:827 (tests)
- last seen: 2026-10-31T12:05:33Z

### L-060 - A once-per-day rule must survive the user deleting what it produced; count a durable record, not live rows.

- signal: `ac_gap` · recurrence: 1 feature(s) · scope: `plan` · harmful: 0
- features: cerebro-paineis
- evidence: C99 reminders.ts:104 (plan)
- last seen: 2026-10-31T12:05:33Z

### L-061 - A policy filter must fail closed when its lookup row is missing, and that case needs its own test.

- signal: `surviving_mutant` · recurrence: 1 feature(s) · scope: `security` · harmful: 0
- features: cerebro-paineis
- evidence: C35 sources.ts:490 (security)
- last seen: 2026-10-31T12:05:33Z

### L-062 - A proof must run the cases it is credited for: name every case with the check id, or the proof command passes while the mutant lives.

- signal: `surviving_mutant` · recurrence: 1 feature(s) · scope: `tests` · harmful: 0
- features: cerebro-memoria-confiavel
- evidence: C69 guard.test.ts (tests)
- last seen: 2026-11-07T02:12:12Z

### L-063 - Test that a relative path leaves its base by its first segment being exactly '..', never by a text prefix.

- signal: `surviving_mutant` · recurrence: 1 feature(s) · scope: `security` · harmful: 0
- features: cerebro-memoria-confiavel
- evidence: folderLevels.ts:178 (security)
- last seen: 2026-11-07T02:12:12Z

### L-064 - A twin comparison must recompute derived data from scratch in the twin world, or it shares the leak it is meant to catch.

- signal: `ac_gap` · recurrence: 1 feature(s) · scope: `security` · harmful: 0
- features: cerebro-memoria-confiavel
- evidence: C113 twin (security)
- last seen: 2026-11-07T02:12:12Z

### L-065 - Trust must come from provenance the agent cannot shape; a quotation test on text an agent writes can be forged.

- signal: `ac_gap` · recurrence: 1 feature(s) · scope: `security` · harmful: 0
- features: cerebro-memoria-confiavel
- evidence: C52 proposals.ts (security)
- last seen: 2026-11-07T02:12:12Z

### L-066 - Probe every audience-readable route with a differential test: hide N more items and require every answer to stay equal.

- signal: `surviving_mutant` · recurrence: 1 feature(s) · scope: `security` · harmful: 0
- features: cerebro-memoria-confiavel
- evidence: C176 doctor.ts:189 (security)
- last seen: 2026-11-07T02:12:12Z

### L-067 - A layout claim with a breakpoint needs a browser case on each side of the boundary, one pixel under and exactly on it, or any breakpoint between the two measured widths passes.

- signal: `ac_gap` · recurrence: 1 feature(s) · scope: `layout` · harmful: 0
- features: cerebro-rituais
- evidence: tests/e2e/weekly.spec.ts:622 C106 round 2 gap 1 (layout)
- last seen: 2026-11-14T02:44:30Z

### L-068 - A Coverage row that names two attributes of a member, such as class and icon, needs a proof of each attribute for each member, not an icon assertion standing for both.

- signal: `ac_gap` · recurrence: 1 feature(s) · scope: `screens` · harmful: 0
- features: cerebro-rituais
- evidence: WeeklyReview.test.tsx:933 C88 round 2 gap 2 (screens)
- last seen: 2026-11-14T02:44:30Z

### L-069 - A check that says an element sits to the right of another needs a rendered-geometry assertion in a browser, because an element-order assertion passes while the layout wraps below.

- signal: `ac_gap` · recurrence: 1 feature(s) · scope: `layout` · harmful: 0
- features: cerebro-rituais
- evidence: C106 round 2, WeeklyReview.test.tsx item actions (layout)
- last seen: 2026-11-14T02:44:30Z

### L-070 - When the built screen differs from a binding design on a component choice, the owner decides which one yields and the design is amended in a dated list, never silently.

- signal: `ac_gap` · recurrence: 1 feature(s) · scope: `design` · harmful: 0
- features: cerebro-rituais
- evidence: verification.md round 1 gap 1, C84/C85 notice vs primitivas row (design)
- last seen: 2026-11-14T02:44:30Z

### L-071 - Give every screen an arrangement check in the first checks pass (its regions in order, the column's width, what sits inside what); copy and state checks alone pass a different composition.

- signal: `ac_gap` · recurrence: 1 feature(s) · scope: `checks/ui` · harmful: 0
- features: cerebro-perguntar
- evidence: verification.md round 1 gap 1 (AskView.tsx arrangement) (checks/ui)
- last seen: 2026-11-23T18:36:17Z

### L-072 - Prove a filter that hides what the caller may not see with a visible item that points at a hidden one; a hidden item alone never reaches the filter.

- signal: `surviving_mutant` · recurrence: 1 feature(s) · scope: `validation/access` · harmful: 0
- features: cerebro-perguntar
- evidence: F4 core/src/memory/hygiene.ts:201-202 (validation/access)
- last seen: 2026-11-23T18:36:17Z

### L-073 - Take a status set's members from its type, not from the statuses the feature thought of; a mapping over a union owes one case per member.

- signal: `ac_gap` · recurrence: 1 feature(s) · scope: `checks` · harmful: 0
- features: cerebro-perguntar
- evidence: verification.md round 1 gap 3 (RunStatus 8 members, 6 proven) (checks)
- last seen: 2026-11-23T18:36:17Z

### L-074 - Prove a claim about a restart through the real start path; a context that was never started skips the recovery that changes the state.

- signal: `ac_gap` · recurrence: 1 feature(s) · scope: `checks` · harmful: 0
- features: cerebro-perguntar
- evidence: verification.md round 1 gap 3 (C6 without ctx.start, recoverInterrupted) (checks)
- last seen: 2026-11-23T18:36:17Z

### L-075 - For a state that replaces part of a screen, check what stays on screen as well as what appears.

- signal: `ac_gap` · recurrence: 1 feature(s) · scope: `ui` · harmful: 0
- features: cerebro-perguntar
- evidence: verification.md round 2 gap 1 (C85 off state) (ui)
- last seen: 2026-11-23T18:36:17Z

### L-076 - Scope every selector of a lazily loaded view under its root and prove in a browser that another screen sharing a class name is unchanged after the view loads.

- signal: `ac_gap` · recurrence: 1 feature(s) · scope: `ui/css` · harmful: 0
- features: cerebro-perguntar
- evidence: verification.md round 2 gap 2 (ask.css .ask-fields vs Console.tsx) (ui/css)
- last seen: 2026-11-23T18:36:17Z

## Quarantined (failed when applied - ignore)

A confirmed lesson that recurred alongside failure. Kept for the maintainer to review.

_none_
