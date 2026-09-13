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

## Second pass (same day): the follow-up list

| # | Item | Result |
| --- | --- | --- |
| 1 | Real `claude` login + smoke | **Needs the user**: `claude auth login` is interactive; nothing was run |
| 2 | Two commits | `b1aa8c3` onboarding/boot recovery, `17b9d9f` installer/discovery; this pass is a third commit |
| 3 | Linux / Windows packages | `mordomo-os-0.8.0-linux-arm64.tar.gz` run in a clean Debian container (launch, MIME, doctor, 14 seeds, stop); `MordomoOS-0.8.0-windows-x64.zip` built with the win32 SQLite DLL and node.exe, **not executed** (no Windows machine) |
| 4 | Signing / notarization | Done with the user's Developer ID Application certificate and a `notarytool` keychain profile: first submission **Invalid** (the SQLite addon was unsigned and without timestamp), packager now signs every Mach-O and checks the notary answer; second submission **Accepted**, ticket stapled, `spctl --assess` on a quarantined copy reports *Notarized Developer ID* |
| 5 | CI release matrix | `release.yml` (5 targets, smoke, draft release, checksums); `ci.yml` packager smoke; YAML linted, **not run** (needs a push) |
| 6 | Update check | opt-in `GET /api/updates` (+ `?force=1`), Settings toggle and button; unit + route tests; live check answered "no published release yet" (404) |
| 7 | Doctor / export in UI | Diagnostics tab gained *Export diagnostics* (redacted JSON download) |
| 8 | Which home is serving | `GET /api/system/info`; Identity tab shows home, version, packaged/source, login service, pid |
| 9 | Cursor IDE | `cursorIdeInstalled()` note when the editor exists without `cursor-agent` |
| 10 | Binary path in UI | Providers tab field, absolute-path validation, re-verifies on save |
| 11 | E2E of the wizard | `tests/e2e/setup-wizard.spec.ts`: fresh home, fake CLIs on PATH, Detect again keeps the user's choice, settings persisted with pinned binaries |
| 12 | Clean-machine test | Linux container only; macOS/Windows clean machines **not available** |

Found and fixed on the way: an open tab broke on the first navigation after a
rebuild ("Failed to fetch dynamically imported module") — route chunks now
reload the page once (`src/lazyRoute.ts`); the browser setup did not pin the
detected binaries the way the terminal setup does — it now calls
`/api/providers/:id/detect` before saving.

Third finding, caught only by running the notarized bundle: with the
hardened runtime the Node binary died at startup with SIGTRAP (133) — V8
needs the `allow-jit` / `allow-unsigned-executable-memory` entitlements.
The packager now signs Node with them and starts the signed runtime once
before uploading (third submission Accepted; `launch`, MIME types, doctor
and `stop` verified from the notarized stage and from a fresh extraction of
the zip). A quarantined copy started from this session's shell still gets
133 and the sandbox cannot clear the flag; Gatekeeper's own assessment of
that copy is *accepted · Notarized Developer ID*, and the CLI shim explains
the exit code.

## Third pass: window, layout, "configure the AI first"

| Criterion | Reproduction | Initial | Fix | Final |
| --- | --- | --- | --- | --- |
| The app is a window, not a browser tab | open `MordomoOS.app` | shell script + `open` → browser | Swift WKWebView shell compiled by the packager (`scripts/macos-app/main.swift`), signed with the bundle | `--snapshot` renders the Command Centre at 1440×900 inside the app |
| Widgets never overlap in a small window | 1000×620 CSS viewport (a Retina window at 2000×1250 px) | rows of ~21 px, "Now" content spilled over the console | stack below 1024 px wide or when rows would be < 24 px; widget bodies scroll | screenshot at 1000×620: one readable column; unit tests for `shouldStack` |
| The AI is configured before the first run | provider signed out | header "ready", run fails with an auth error afterwards | provider gate, honest header state, console pre-flight, setup hint | `tests/e2e/provider-gate.spec.ts` (3) |

Real provider run: with the user's `claude` signed in, `POST
/api/providers/claude/smoke` passed (status `done`, 3.8 s, read-only
profile) — the first real provider execution of this work; earlier smoke
runs had failed with "authentication".
