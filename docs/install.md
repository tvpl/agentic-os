# Installing MordomoOS

Two ways to install. Both end at the same place: the Command Centre at
`http://127.0.0.1:4777`, with your data in your user profile.

| | **A. Packaged app** (recommended for users) | **B. From source** (developers, contributors) |
| --- | --- | --- |
| Needs | nothing — Node.js is bundled | Node.js ≥ 22, git |
| Setup | in the browser | guided terminal setup (`mordomo setup`) or in the browser |
| Code | one minified bundle, no sources | the full checkout |
| Updates | install the new installer (or the signed updater), or replace the folder, then `mordomo restart` | `git pull && npm run build && mordomo restart` |

Provider CLIs (Claude Code, Cursor Agent, Codex) are **not** bundled: they are
personal tools with their own login. The setup screen detects the ones already
on the computer — on PATH and in the usual install folders (`~/.local/bin`,
Homebrew, npm/pnpm/bun global prefixes, fnm/nvm/volta/asdf/n, `%APPDATA%\npm`…)
— and shows the install or login command for the missing ones, with a
**Detect again** button. Nothing is installed on your behalf.

## License and terms

The installer carries the license ([`LICENSE`](../LICENSE): Functional Source License 1.1, Apache-2.0
future license), the notices of the third-party components it bundles, and the draft terms and privacy policy
in its `legal/` folder (the same files as [`legal/`](../legal/) in the repository, plus a CycloneDX SBOM).
Those legal texts are **drafts for the owner's review, not legal advice**. MordomoOS orchestrates the
provider CLIs and does not bundle or sublicense them: each follows its supplier's terms and uses your own
account.

## A. Packaged app

Two forms: the **desktop app** (an installer; recommended) and the **portable
archive** (what `npm run dist` writes; extract and run). Both carry the same
service, the same Command Centre and the same bundled Node.js.

### Desktop app (installers)

Download the installer of your system from the releases page of the repository.
Every release is a draft until the owner publishes it; an installer built
without the owner's signing certificate carries `UNSIGNED` in its file name and
the operating system will warn before opening it.

| System | File | Install |
| --- | --- | --- |
| macOS 12+ (arm64, Intel) | `MordomoOS_<version>_macos-<arch>.dmg` | open it, drag **MordomoOS** to Applications |
| Windows 10+ (x64) | `MordomoOS_<version>_windows-x64-setup.exe` | run it; it installs for your user, no administrator needed |
| Linux (x64) | `MordomoOS_<version>_linux-x64.deb` or `.AppImage` | `sudo apt install ./<file>.deb` (needs `libwebkit2gtk-4.1-0` and `libgtk-3-0`), or `chmod +x` the AppImage and run it |

What the app does when you open it: starts the bundled service on a free port of
`127.0.0.1` (the last port it used, when that is still free, so the interface
keeps its settings), with a secret that exists only for this launch and is what
lets the window, and nothing else on the computer, receive your token; shows the
Command Centre in its own window; and stops the service when you close the
window or quit. If the service cannot start the window says why, in English or
Portuguese, with **Try again** and **Quit**. A second launch brings the first
window forward. The data folder is the same as the archive's (below).

Limits worth knowing:

- Closing the app stops the service, so routines do not run while it is closed.
  To keep them running use the login service (`mordomo service install`, from the
  terminal CLI of the archive or a checkout); then the app and the login service
  cannot both own the data folder, and the app says "MordomoOS is already
  running" until you stop the service (`mordomo stop`).
- On Linux the single-instance lock needs a D-Bus session, which every desktop
  has; without one (a bare X server) two launches are not stopped, and the second
  one finds the data folder taken and says so.
- The menu is in English like the operating system's; the screens of the app
  speak English and Portuguese.
- **Updates.** Only a build made with the owner's update key has an updater
  (*About* says when there is none). It asks the releases page for `latest.json`
  at start only if *Settings › Identity › check for updates* is on (off by
  default), or when you choose **MordomoOS › Check for Updates…**; it installs a
  file only after its signature verifies against the public key inside the app.
  What is contacted: [`legal/PRIVACY.md`](../legal/PRIVACY.md) §4. How releases are
  cut and verified: [release.md](release.md).

### Portable archive

Build it (see *Building a distributable* below) or take it from a release that
publishes one, and extract it.

### macOS (archive)

1. Move `MordomoOS.app` to `/Applications` (optional, but do it before enabling
   *start at login*).
2. Open the app once from the Finder. Official builds are signed with a
   Developer ID and notarized, so macOS verifies them and opens directly. A
   build you made yourself without `--sign` is only ad-hoc signed: use
   **right-click → Open → Open** the first time, or remove the quarantine flag:
   ```bash
   xattr -dr com.apple.quarantine /Applications/MordomoOS.app
   ```
   Until that first open, the `mordomo` script refuses to start from a
   terminal (macOS stops quarantined binaries with signal 133) and says so.
3. Open MordomoOS. The local service starts in the background and the
   Command Centre opens in the app's own window (a native WebKit window, no
   Electron). *View → Open in Browser* shows the same page in your browser.
   Closing the window or *Quit* leaves the service running for routines;
   *Stop the background service and quit* stops it.
4. First run: the setup screen, then, if no enabled provider is installed and
   signed in, a "Connect your AI first" screen with the exact command to run.
5. Terminal (optional): the `mordomo` script next to the app is the CLI
   (`./mordomo status`). Add it to your PATH if you use it often.

### Linux (archive)

1. Extract the archive anywhere (for example `~/Apps/mordomo-os`).
2. Run `./MordomoOS` (double-click in most file managers) — or install the
   launcher: edit `mordomo-os.desktop`, replace `INSTALL_DIR` with the folder,
   and copy it to `~/.local/share/applications/`.
3. Terminal (optional): `bin/mordomo`.

### Windows (archive)

1. Extract the archive (for example `C:\Users\you\MordomoOS`).
2. Double-click `MordomoOS.cmd`. Windows Defender SmartScreen may ask once
   (*More info → Run anyway*): the launcher is a plain script.
3. Terminal (optional): `bin\mordomo.cmd`.
4. WSL is still the best home for the provider CLIs; see [windows.md](windows.md).

### Where the data lives

| Platform | Home |
| --- | --- |
| macOS | `~/Library/Application Support/MordomoOS` |
| Linux | `$XDG_DATA_HOME/mordomo-os` (default `~/.local/share/mordomo-os`) |
| Windows | `%LOCALAPPDATA%\MordomoOS` |

Settings, the SQLite database, memory index, artifacts, logs, skills, routines
and connectors are all there (`MORDOMO_HOME` overrides it). The bundled
`seed/` skills, routines and connectors are copied in on first run and never
overwritten afterwards. Backups: `mordomo backup` ([details](backup-restore-uninstall.md)).

### Start at login

Settings → Identity → *Start at login*, or `mordomo service install` from the
terminal. The service points at the app's current location: if you move the
app later, run `mordomo service install` again.

### Uninstall

`mordomo uninstall` stops the service and removes the login service; your data
stays unless you add `--purge`. Then delete the app/folder.

## B. From source

```bash
git clone <this-repo> mordomo-os && cd mordomo-os
scripts/setup.sh              # npm install + build + guided terminal setup
mordomo start                 # or: mordomo launch  (starts and opens the browser)
```

`scripts/setup.ps1` is the Windows equivalent. Prefer the browser? Run
`npx mordomo launch` right after `npm run build`; the setup screen appears
because the configuration is not complete yet.

In a checkout the data lives **in the repository** (`config/`, `memory/`,
`artifacts/`, `logs/` are git-ignored). Set `MORDOMO_HOME` to keep it elsewhere.

## Building a distributable

```bash
npm run dist                  # release/MordomoOS-<version>-macos-arm64.zip (host platform)
npm run dist:quick            # stage only, no archive, system Node — for a fast local check
node scripts/package.mjs --help
```

What `scripts/package.mjs` does:

1. builds every workspace (`npm run build`, skip with `--skip-build`);
2. bundles the API and CLI into **one minified file** (`lib/mordomo.mjs`, via
   rolldown) — no TypeScript sources, no source maps;
3. copies the only native dependency, the SQLite addon, next to it;
4. copies the built Command Centre (`ui/`) and the seed data (`seed/`);
5. downloads the official Node.js binary for the target (`--node <version>`,
   default: the version running the script; `--node none` to rely on the
   system Node) and verifies its SHA-256;
6. writes the launchers (`MordomoOS.app` with an ad-hoc signature and icon,
   `MordomoOS` + `mordomo-os.desktop`, `MordomoOS.cmd`) and the CLI shim;
7. archives to `release/` (`.zip` on macOS/Windows, `.tar.gz` on Linux).

Cross-targets (`--platform`, `--arch`) fetch the matching SQLite prebuild with
`prebuild-install` and the matching Node binary; the Linux package built this
way was run inside a clean Debian container (bundled Node, SQLite addon, UI,
seeds, `stop`). Build on the target platform when you can, and always try
the archive on a clean machine before publishing.

### Signing and notarization (macOS)

```bash
security find-identity -v -p codesigning                 # your "Developer ID Application: …"
xcrun notarytool store-credentials mordomo --apple-id … --team-id … --password …
node scripts/package.mjs --sign "Developer ID Application: Name (TEAMID)" --notarize mordomo
```

`--sign` signs every native binary (the Node runtime, the SQLite addon) and
the app with the hardened runtime and a secure timestamp — the Node binary
with the JIT entitlements (`allow-jit`, `allow-unsigned-executable-memory`)
that V8 needs under the hardened runtime, and the packager starts the signed
runtime once to prove it before uploading; `--notarize`
submits the zip, waits for Apple, prints the notary log when the answer is
not *Accepted*, staples the ticket and rebuilds the archive. Without these
the app is ad-hoc signed and Gatekeeper asks once. Verified on 2026-09-12:
`spctl --assess` reports *Notarized Developer ID* on a quarantined download. Windows: sign
`MordomoOS.cmd` is not meaningful (it is a script); sign `runtime\node.exe`
only if your policy requires it (`signtool sign /fd SHA256 …`).

### Releases from CI

Nothing runs in GitHub Actions on its own: both workflows are manual
(`workflow_dispatch`). `.github/workflows/release.yml`, when you trigger it
from the Actions tab with a tag, builds macOS (arm64, x64), Linux (x64,
arm64) and Windows (x64), smoke-tests every package (`launch --no-browser`,
MIME types, `stop`), uploads the archives and opens a **draft** GitHub
release with `SHA256SUMS.txt`; add the `MACOS_*` / `APPLE_*` secrets
described at the top of the workflow if you want it to sign and notarize.
`ci.yml` runs the test suites and `npm run dist:quick` on demand. The
signed and notarized release is otherwise produced locally, as above.

On code privacy: a minified bundle keeps casual readers out and ships none of
the source, comments or types. JavaScript that runs on the user's machine can
always be inspected with effort; there is no stronger protection short of
running the engine on a server you control.

## Updating

- Desktop app: install the newer installer over it, or let the updater do it (see
  *Desktop app*). Data and settings are untouched.
- Portable archive: replace the app/folder with the new one, then `mordomo restart`
  (or open the app again). Data and settings are untouched.
- Source: `git pull && npm install && npm run build && mordomo restart`.
- Settings › Identity shows the running version, whether it is a packaged app
  or a checkout, the data folder and the process id. **Check now** asks the
  public releases page once (an anonymous request, nothing about you is sent);
  the checkbox repeats it at most daily. Off by default.
- An open tab survives an update: the first navigation after a rebuild reloads
  the page once instead of showing a broken route.

`mordomo restart` also restarts the login service (launchd/systemd/Task
Scheduler): a service started before a rebuild keeps serving the old build —
the symptom is a black "Starting your workspace…" screen with MIME-type errors
in the browser console.

## Troubleshooting

- **Black screen, console says "Expected a JavaScript module… MIME type
  text/html"** → the service is older than the UI build: `mordomo restart`.
- **"Provider: codex — not found"** although it works in your terminal → the
  CLI is installed somewhere unusual. Run `mordomo doctor`; if it still cannot
  see it, set `providers.codex.binaryPath` in Settings › Providers (or
  `config/settings.json`) to the absolute path.
- **"login required"** → run the shown command (`claude auth login`,
  `codex login`, `cursor-agent login`) in a terminal, then *Detect again*.
- **Port 4777 busy** → `mordomo status` tells whether another MordomoOS
  answers there; change the port in Settings › Identity.
- **Which MordomoOS am I looking at?** Settings › Identity shows the data
  folder and build serving this page; `mordomo status` says when another
  MordomoOS answers on the port.
- **Cursor** installed but "not found" → the editor is not the agent: install
  `cursor-agent` (the hint on the providers step says so).
- **The CLI is somewhere unusual** → Settings › Providers › *Binary path*
  takes an absolute path; leave it empty to search automatically.
- **Reporting a problem** → Settings › Diagnostics › *Export diagnostics*
  saves a JSON with settings (secrets removed), doctor checks, metrics and the
  last 30 run summaries.
- Logs: `<home>/logs/service.out.log`.
