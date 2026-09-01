# MordomoOS — Validation report (0.1.0)

Executed 2026-08-31 in the build environment (Linux x86_64, Node 22.22.2).
Provider availability there: **Claude Code 2.1.251 installed and
authenticated**; `cursor-agent` and `codex` **not installed** — their adapters
were validated against faithful fake CLIs (committed in
`tests/fixtures/fake-bin/`, exercising `--version`, `--help` probing, auth
probes and the providers' real streaming JSON shapes), and their *absence
handling* was validated for real. Live end-to-end validation of Cursor/Codex
happens on the owner's machine via `mordomo doctor` + the Settings smoke test.

## Automated tests — 70/70 passing

`npx vitest run` → 7 files, 70 tests, 0 failures:

- **Security**: secret redaction patterns; path containment incl. symlink
  escape; exclusion/secret-file matchers; argv-only spawn (command substitution
  NOT evaluated), allowlist rejection, timeout kill.
- **Foundation**: settings round-trip + idempotency; token creation; DB
  migrations reopen-safe; skill catalog (thick detection, run-prompt); sync
  compiler create→unchanged→conflict→approved-overwrite with backup; diff;
  backup/restore round-trip.
- **Memory**: indexing honors exclusions (`.env` and `node_modules` never
  indexed; secret value absent from FTS), incremental updates, deletion
  cleanup, FTS search with snippet + injection-safe query escaping, facets,
  graph + markdown-link relations with explanations, preview (text OK, `.env`
  blocked, outside-root 403), router generation + broken-pointer detection.
- **Adapters ×3**: detection/probing, invocation building (no bypass flags,
  read-only rules, `--sandbox read-only`, no `--force` on read-only),
  streaming normalization, auth without credential exposure, missing-CLI
  handling.
- **Runs**: end-to-end execute with redacted persisted events + JSONL,
  artifact collection, failure messages, cancellation, timeout, interrupted
  recovery, metrics.
- **Seeds**: all 9 skills valid/thin/guardrailed; routine paused by default;
  connectors not-configured with risks; auditor leaks no credentials, max 3
  recommendations; scheduler manual fire records history.
- **API surface**: 401 without token; 403 foreign Host; security headers;
  approval gates (expose_port leaves bind unchanged; connector write held);
  skill run button → done with events; provider-not-enabled rejection;
  memory search/preview protections; routine toggle/next-run; sync
  plan/apply; artifact path traversal 403; doctor; diagnostics export free of
  the token.

## Live validation (real Claude Code)

| Check | Result |
|---|---|
| Clean-clone install (`git clone` → `npm install` → build → `setup --defaults` → doctor) | ✅ doctor: 9 ok / 1 warn (no folders yet) / 0 fail |
| Setup executed twice | ✅ second run added 0 files, changed nothing, doctor 10 ok/0/0 |
| Provider detection + `--help` capability probing | ✅ claude 2.1.251 detected; cursor/codex reported "not installed" with install hints |
| Read-only smoke test (`POST /api/providers/claude/smoke`) | ✅ passed, 4.5 s, no file changes |
| Skill from a button (`workspace-digest` via API) | ✅ done in 40.7 s, real artifact `artifacts/<run>/digest.md` with a correct 3-section digest of the actual repo |
| Provider switch | ✅ default switch API + dashboard segmented control (rejects disabled providers) |
| Missing CLI handling | ✅ enabling cursor (not installed) → doctor shows ✘ with actionable message; runs rejected with "not enabled" |
| Cancellation of a live run | ✅ status `cancelled`, "Cancelled by user", process killed |
| Timeout | ✅ (automated) status failed with "Timed out after … ms" guidance |
| Routine manual test-run | ✅ fired via API: origin=routine, done in 107.8 s, artifact produced, history entry `fired` |
| Second Brain on real data | ✅ 46 files indexed across 3 areas; search finds real files; graph renders; `.env` preview blocked |
| Service restart + crash recovery | ✅ `kill -9` during a live run → restart → run marked `interrupted` ("Interrupted by service restart") |
| Backup & restore | ✅ deleted a skill folder, restored backup → folder back; safety backup created |
| Secrets in logs | ✅ redaction verified in DB events, JSONL and diagnostics export (token absent) |
| Excluded-file protection | ✅ `.env`/`node_modules` never indexed, previewed or FTS-searchable |
| Local-only binding | ✅ 127.0.0.1 bind; foreign Host → 403; missing token → 401; exposing gated behind approval |

## Visual inspection (Playwright + Chromium)

`node tests/e2e/visual-check.mjs` against the live server:

- 8 routes × 3 widths (1440/1024/768): **0 console errors, 0 page errors,
  0 horizontal-overflow failures**.
- Keyboard navigation: Tab reaches all sidebar links in order; Enter activates.
- Screenshots reviewed manually: dark dashboard (real metrics/artifacts),
  Second Brain graph with real files colored by area, skill detail with run
  form, light theme + pt-BR dashboard (translations verified).

## Known limitations (0.1.0)

- Cursor/Codex live runs not yet exercised against real CLIs (unavailable in
  the build environment); adapters degrade explicitly and `doctor`/smoke will
  verify on first contact.
- Cursor read-only mode relies on not passing `--force` plus the prompt
  contract — Cursor's CLI has no sandbox flag to enforce it mechanically.
- Provider model lists are static defaults (editable per run); CLIs don't
  expose a model-list command.
- The graph view caps at 350 nodes per query (narrow with search/filters);
  larger workspaces stay responsive by design.
