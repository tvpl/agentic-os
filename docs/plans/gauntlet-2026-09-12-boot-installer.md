# Gauntlet loop — boot failure, provider detection, packaged installer (2026-09-12)

Request: the Command Centre showed a black "Starting your workspace…" screen
with MIME-type errors; review and fix the app, and replace the terminal-only
install with a friendly, distributable one that finds Claude/Cursor/Codex and
does not ship the source.

## Criteria → reproduction → initial → fix → final

| # | Criterion | Reproduction | Initial | Fix | Final |
| --- | --- | --- | --- | --- | --- |
| 1 | Hashed assets are served with the right MIME type after a rebuild | `curl -sI 127.0.0.1:4777/assets/main-*.js` against the running service | `text/html` (service started 09-09 with `wildcard:false`, UI rebuilt 09-12) | `wildcard:true` + 404 for missing assets (`apps/api/src/server.ts`); `mordomo restart`; service worker rejects HTML-as-JS; boot screen probes the entry module | `application/javascript`; `tests/api.ui-assets.test.ts` (4) and `tests/e2e/boot-recovery.spec.ts` (2) pass |
| 2 | A rebuild can be applied to the login service without launchctl knowledge | `kill <pid>` → launchd restarts the old binary; `mordomo stop` reported "Not running" | pidfile lost, `status` blind | `mordomo restart` (login-service aware), `status` reports a foreign MordomoOS on the port, pidfile ownership accepts the bundle name | `restart` → "Restarted by the login service (pid …)" |
| 3 | Provider CLIs installed outside the service's PATH are detected | daemon PATH = `/usr/bin:/bin:/usr/sbin:/sbin`; `claude` in `~/.local/bin` | found only because `binaryPath` had been pinned by an earlier setup; a later install of `codex` would stay invisible | `findExecutable` searches native/Homebrew/npm/pnpm/bun/fnm/nvm/volta/asdf/n/Windows folders; children get an augmented PATH | packaged app with `PATH=/usr/bin:/bin` reports claude 2.1.217 and cursor-agent; `tests/core.discovery.test.ts` (7) |
| 4 | Setup without a terminal, showing install/login guidance | fresh home → browser | wizard listed providers with a bare "not found" line, no way to re-detect | providers step: version + login state, install/login command with copy, **Detect again** (`POST /api/providers/:id/detect`), terminal path folded into a disclosure | walked the 5 steps in the packaged build, finished → OS shell + guide |
| 5 | A distributable that runs without Node.js and without shipping sources | `npm run dist` | none | `scripts/package.mjs`: rolldown single minified bundle, SQLite addon, UI, seeds, bundled Node (SHA-256 checked), `MordomoOS.app` (ad-hoc signed, icon), Linux/Windows launchers, CLI shim; per-user data dir + first-run seeding | `release/MordomoOS-0.8.0-macos-arm64.zip` (37 MB); extracted and run with `env -i PATH=/usr/bin:/bin` |
| 6 | Existing suites stay green | vitest, UI vitest, eslint, tsc, Playwright | 467/467 unit, 10 lint errors (boot-recovery.js), e2e 90 pass / 2 fail | lint globals for `public/*.js`; e2e `backup-restore` given the returning-user storage state (the new guide covered the page); `boot-recovery` made deterministic by blocking the worker | see *Evidence* |

## Evidence

- Unit: `npx vitest run` → 60 files, 475 tests passed.
- UI: `npm run test -w apps/command-centre` → 37 files, 212 tests passed.
- `npm run lint` and `npm run typecheck` → exit 0.
- E2E: `npx playwright test --config tests/e2e/playwright.config.ts` → 92
  passed, 2 skipped (platform-gated soak/objective fixtures), 0 failed, 4.3 min
  (baseline before the fixes: 90 passed, 2 failed).
- Packaged smoke: `status --json`, `start`, `restart`, `launch --no-browser`,
  `doctor`, `service plan`, `stop`, `/` and `/assets/*.js` MIME, seeds copied
  into a fresh home (skills 14, routines 3).
- Browser: the user's instance at 127.0.0.1:4777 now boots (screenshot in the
  session); the only remaining console line is the service-worker registration
  refused by the desktop app's preview webview, not present in Chromium.

## Findings from the adversarial pass (all fixed)

- Setup wizard re-enabled a provider the user had unchecked whenever the list
  refreshed → only flips entries whose *installed* state changed.
- macOS fnm folder was added as a directory instead of its version bins.
- `augmentedPath()` stat-ed ~30 folders on every spawn → 30 s memo per PATH.
- Packager could pair a host-ABI SQLite addon with a different Node major →
  fetches the matching prebuild when platform, arch or Node major differ.
- `readPackageVersion()` could pick an unrelated package.json above an
  extracted archive → only MordomoOS manifests count.
- `planStartupService()` hard-coded `apps/api/dist/cli.js` under the home →
  takes the real CLI entry (bundle-aware).
- `scripts/setup.sh|ps1` accepted Node 20 while `engines`/`doctor` need 22.

## Not executed / simulated

- Linux and Windows packages were not produced or run on those platforms
  (launchers and download logic are written but only the macOS/arm64 path was
  executed end to end). Cross-target `prebuild-install` was not exercised.
- Provider runs used the fake CLIs in e2e; the real `claude` on this machine
  is installed but not logged in (`claude auth status` → `loggedIn:false`),
  so no real provider run was made.
- Gatekeeper behaviour of the ad-hoc-signed app on another Mac was not tested.

## Risks and rollback

- The packaged app is unsigned/not notarized: users must right-click → Open once.
- A minified bundle is not encryption; the docs say so.
- Rollback: `git checkout -- .` on the listed files removes everything (the
  onboarding files are additions); `mordomo restart` reloads the service.
