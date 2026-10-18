# Releasing MordomoOS

How the desktop installers are built, signed, verified, updated and rolled back. For the owner who registers the
secrets and cuts the releases; the CI workflows and scripts it names are in the repository.

> **Resumo em português.** Uma tag `v<versão>` constrói os instaladores (macOS arm64 e Intel, Windows x64, Linux x64) e
> cria um **release rascunho**; ele nunca publica sozinho. Sem os segredos de assinatura o build sai, mas **marcado
> `UNSIGNED`**. O que você faz uma vez: cadastrar os segredos (seção 2) e gerar a chave do atualizador. A cada release:
> `node scripts/version-sync.mjs --write <versão>`, renomear `Unreleased` no `CHANGELOG.md`, commit, `git tag v<versão>`,
> `git push origin v<versão>`, olhar o rascunho, verificar as assinaturas (seção 4) e publicar. A seção 8 diz, com honestidade,
> o que **não** foi executado: o Windows e o macOS nunca rodaram nesta feature.

## 1. What a release is

Pushing a tag `v<version>` runs [`.github/workflows/release.yml`](../.github/workflows/release.yml):

| Job | What it does |
| --- | --- |
| `plan` | Checks that the tag is `v` + the version of `package.json` and of everything else that carries one (`node scripts/version-sync.mjs --check --tag`), that `CHANGELOG.md` has a section for it, and that the updater configuration is well formed; then reads which signing secrets are registered and writes the answer in the run's summary. |
| `verify` | The same gate as CI on Linux: typecheck, lint, the whole `vitest` suite, the npm and Rust license checks, the network scan, and the Rust tests of the shell. |
| `package` (4 in parallel) | Builds the payload (`scripts/package.mjs --payload`: the API and CLI bundle, the SQLite addon, the Command Centre, the seed data, a Node.js runtime) builds the installers with Tauri, starts the **installed** app's service to prove it serves the Command Centre, verifies the signatures it made, names the files and writes `status-<platform>.json`. |
| `publish` | Only on a tag. Downloads the four sets, writes the release notes (the CHANGELOG section plus a signature table), the updater manifest `latest.json` **if every platform signed**, the SBOMs, the third-party notices and `SHA256SUMS.txt`, and creates or refreshes a **draft** release. |

It never publishes. `workflow_dispatch` (Actions › Release › Run workflow) runs everything except `publish`: the installers
stay as artifacts of the run, which is how you try the pipeline without a tag.

| Platform | Runner | Files | Signed with |
| --- | --- | --- | --- |
| macOS arm64 | `macos-14` | `MordomoOS_<v>_macos-arm64.dmg`, `.app.tar.gz` (+ `.sig`) | Developer ID Application, hardened runtime, notarized and stapled |
| macOS Intel | `macos-15-intel` | `MordomoOS_<v>_macos-x64.dmg`, `.app.tar.gz` (+ `.sig`) | same |
| Windows x64 | `windows-2022` | `MordomoOS_<v>_windows-x64-setup.exe` (+ `.sig`) | Authenticode (SHA-256, RFC 3161 timestamp) |
| Linux x64 | `ubuntu-22.04` | `MordomoOS_<v>_linux-x64.deb` and `.AppImage` (+ `.sig` each) | no operating-system signature exists for them; `SHA256SUMS.txt`, and the minisign `.sig` |

Without the secrets of a platform, its files are still built and are named `MordomoOS_<v>_<platform>_UNSIGNED…`; the first
lines of the release notes say which platforms are unsigned, and a signed release has no such banner. A release with
an unsigned macOS or Windows file gets **no `latest.json`**: an update must not replace a trusted app with one the system
refuses to open.

Not published by this workflow: the portable archive (`npm run dist` still writes it for anyone who wants it), Windows
ARM64, Linux ARM64 and `.rpm`.

## 2. One-time setup: the secrets

Settings › Secrets and variables › Actions › *New repository secret*. All of them are optional; register the ones of the
platforms you want signed. The repository never holds one and no workflow prints one.

| Secret | What it is | Where it comes from |
| --- | --- | --- |
| `MACOS_CERT_P12_BASE64` | the *Developer ID Application* certificate with its private key, as a `.p12`, in base64 | Keychain Access › export the certificate and key as `.p12`; `base64 -i cert.p12 \| pbcopy` |
| `MACOS_CERT_PASSWORD` | the password you gave that `.p12` | you chose it at export |
| `MACOS_SIGN_IDENTITY` | the identity name, `Developer ID Application: Your Name (TEAMID)` | `security find-identity -v -p codesigning` |
| `APPLE_ID` | the Apple ID of the developer account | |
| `APPLE_TEAM_ID` | the 10-character team id | developer.apple.com › Membership |
| `APPLE_APP_PASSWORD` | an *app-specific* password for that Apple ID (not the account password) | appleid.apple.com › Sign-In and Security › App-Specific Passwords |
| `WINDOWS_CERT_PFX_BASE64` | the Authenticode certificate with its private key as a `.pfx`, in base64 | `[Convert]::ToBase64String([IO.File]::ReadAllBytes("cert.pfx"))` in PowerShell |
| `WINDOWS_CERT_PASSWORD` | the password of that `.pfx` | |
| `TAURI_SIGNING_PRIVATE_KEY` | the minisign private key of the updater | `npx tauri signer generate -w ~/.tauri/mordomo.key` (see below) |
| `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | its password (empty when you gave none) | |

What each group turns on:

- **macOS signed**: the three `MACOS_*` secrets. **Notarized** too: also the three `APPLE_*` ones (without them the app is
  signed but not notarized, and Gatekeeper will still warn).
- **Windows signed**: the two `WINDOWS_*` secrets. A certificate that lives on a hardware token or in a cloud HSM (most EV
  certificates) cannot be exported as a `.pfx` and is **not supported** by this workflow; it would need a custom sign command.
- **Updater**: the private key **and** the matching public key committed in
  [`apps/desktop/src-tauri/tauri.updater.conf.json`](../apps/desktop/src-tauri/tauri.updater.conf.json).

Generating the updater key (once, on your machine):

```bash
npx tauri signer generate -w ~/.tauri/mordomo.key     # prints the public key and writes the private one
```

1. Put the printed **public** key in `plugins.updater.pubkey` of `tauri.updater.conf.json` (it replaces the
   `[A PREENCHER PELO DONO…]` placeholder) and commit it. `node scripts/updater-config.mjs --check` accepts it.
2. Register the **private** key file's content as `TAURI_SIGNING_PRIVATE_KEY` and its password as
   `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`.
3. **Keep a copy of the private key somewhere safe and offline.** If it is lost, no installed copy can ever be updated:
   people would have to install a new build by hand, because the old ones only accept the old public key.

Until both halves exist the build has no updater at all (no plugin, no menu item, *About* says so).

## 3. Cutting a release

```bash
# 1. The version: every package.json, the lockfile, tauri.conf.json, Cargo.toml and Cargo.lock, together.
node scripts/version-sync.mjs --write 0.9.0
# 2. CHANGELOG.md: rename "## Unreleased" to "## 0.9.0 — 2026-MM-DD" (the workflow refuses a version with no section).
# 3. The gate, then commit.
npm run version:check && npm run typecheck && npm run lint && npx vitest run && npm run network:scan -- --check
git commit -am "chore(release): 0.9.0"
# 4. The tag. Pushing it is what starts the release; nothing else does.
git tag v0.9.0 && git push origin main v0.9.0
```

Then:

1. Open the run. The `plan` job's summary says which platforms will be signed, notarized, and whether the updater is on.
   Fix a missing secret now and re-run; it is cheaper than a draft with `UNSIGNED` files.
2. When it finishes, open the **draft** under Releases. The notes start with a banner if anything is unsigned, then the
   CHANGELOG section, then a table of what was signed. Check the files against section 1.
3. Verify the signatures (section 4) on a machine of each kind, install, open the app once.
4. **Publish** from the draft (*Edit › Publish release*). Publishing is what makes `latest.json` the release the updater
   reads (`…/releases/latest/download/latest.json`); a draft, and a pre-release, are not offered. For a release candidate
   tag `v0.9.0-rc.1` and publish as a pre-release.

Re-running the workflow for the same tag refreshes the draft (`--clobber`); it refuses to touch a release that is already
published.

## 4. Verifying a release

**Checksums** (every platform): put the files next to `SHA256SUMS.txt`, then `sha256sum -c SHA256SUMS.txt` (macOS:
`shasum -a 256 -c SHA256SUMS.txt`; Windows: `Get-FileHash <file>` and compare).

**macOS**:

```bash
codesign --verify --deep --strict --verbose=2 /Applications/MordomoOS.app
codesign -dv --verbose=4 /Applications/MordomoOS.app 2>&1 | grep -E "Authority|TeamIdentifier|flags"   # runtime flag, your Team ID
spctl --assess --type execute --verbose=4 /Applications/MordomoOS.app                                   # accepted, source=Notarized Developer ID
xcrun stapler validate /Applications/MordomoOS.app
```

**Windows** (PowerShell):

```powershell
Get-AuthenticodeSignature .\MordomoOS_0.9.0_windows-x64-setup.exe | Format-List Status, SignerCertificate, TimeStamperCertificate
signtool verify /pa /v .\MordomoOS_0.9.0_windows-x64-setup.exe
```

**The minisign signature** (the updater files and the `.deb`): each `.sig` is the base64 of a `.minisig`. With
[minisign](https://jedisct1.github.io/minisign/) and the public key line from `tauri.updater.conf.json`
(`pubkey` is the base64 of a two-line file; its second line is the key):

```bash
node -e 'const c=require("./apps/desktop/src-tauri/tauri.updater.conf.json");console.log(Buffer.from(c.plugins.updater.pubkey,"base64").toString().split("\n")[1])'
base64 -d MordomoOS_0.9.0_linux-x64.AppImage.sig > MordomoOS_0.9.0_linux-x64.AppImage.minisig
minisign -Vm MordomoOS_0.9.0_linux-x64.AppImage -x MordomoOS_0.9.0_linux-x64.AppImage.minisig -P <that key line>
```

**`latest.json`**: `version`, `notes`, `pub_date` and four platforms, each with the `.sig` content and a
`https://github.com/tvpl/agentic-os/releases/download/<tag>/<file>` address. If it is not attached, the notes say not every
platform was signed.

## 5. The updater

- One endpoint: `https://github.com/tvpl/agentic-os/releases/latest/download/latest.json`; one channel (the newest
  published, non-pre-release release). No beta channel.
- It is **off unless asked**: at start only when `updates.check` is on (Settings › Identity; off by default, as the privacy
  policy promises), or when the person picks **MordomoOS › Check for Updates…**. Turning `updates.check` off is the opt-out;
  the menu item always asks first.
- A found update is shown with its version, the person confirms, the app downloads it, **verifies the minisign signature
  against the public key inside the app** (nothing is installed if it does not verify), stops its service so the installer
  can replace the files, installs and restarts. The request goes to `github.com` and the download to `github.com`, which
  redirects to `release-assets.githubusercontent.com`; a manifest that names another host is refused.
- What is sent: an anonymous `GET` with the user agent `tauri-plugin-updater/<version>`; no identifier, no version, no
  platform in the URL. GitHub sees the IP address. It is declared in `legal/network-policy.json` and `legal/PRIVACY.md` §4.1.

To rehearse a roundtrip once, before the first published release: build version N and N+1 with a throwaway key (never the
real one), point the N build's `plugins.updater.endpoints` at an HTTPS server you control, serve a `latest.json` for N+1
there, open N and choose *Check for Updates…*. A pre-release on GitHub is not enough: `releases/latest` does not offer it.

## 6. Rolling back

| Situation | What to do |
| --- | --- |
| The draft is wrong (before publishing) | Delete the draft and the tag (`git push --delete origin v0.9.0 && git tag -d v0.9.0`), fix, tag again. Nothing reached anyone. |
| A published release is bad and few have it | Edit it to *pre-release* (or delete it): `releases/latest` then points at the previous published release and the updater stops offering the bad one. |
| People already updated | The updater only moves **forward** (it offers a version greater than the installed one). Ship `0.9.1` with the fix; there is no "downgrade" push. Someone who must go back installs the older installer by hand. |
| The data was migrated by the bad version | A database written by a newer version is refused by an older one (`DbNewerVersionError`). Before an old version can run, restore the backup the migration took (a snapshot is written before each migration; `docs/backup-restore-uninstall.md`). |
| The updater key leaked | Rotate: generate a new pair, ship a release **signed with the old key** whose `tauri.updater.conf.json` carries the new public key, and from then on sign with the new one. If the old key is also gone, installed copies cannot be updated: publish a new installer and say so. |
| The signing certificate leaked or was revoked | Revoke it with Apple or the CA, register the new one in the secrets, cut a new release. |

## 7. The shell and its service

`apps/desktop` is a Tauri 2 app. It does not contain the product: it starts the same service the CLI starts.

- **Start.** `lib/mordomo.mjs start --foreground --sidecar --port <n>` with the bundled Node, a random 256-bit launch secret in
  `MORDOMO_LAUNCH_TOKEN` (never in argv), and `<n>` the last port it used (kept in `desktop-state.json` in the app's data
  folder, so the interface keeps one origin and its `localStorage`) or `0`. The service prints one line,
  `MORDOMO_READY {"v":1,"pid":…,"port":…,"version":…,"updatesCheck":…}`, once it listens; the shell then asks `GET /` and
  needs `200` and `text/html` before it shows anything.
- **The secret.** The window's first address is `http://127.0.0.1:<port>/?launch=<secret>`; the service answers
  `302 /` with an `HttpOnly` `SameSite=Lax` cookie, and from then on hands the owner's token to a page request only if it
  carries the cookie. A program that merely sends a browser's headers no longer gets the token from that service
  (`docs/security.md`, T1: the design it described is built here for the shell; `mordomo launch` in a browser is unchanged).
  `Lax`, not `Strict`: the first request comes from the shell's own `tauri://` page, another site, and an engine does not send
  a `Strict` cookie through that redirect.
- **Stop.** The shell closes the service's stdin; the service shuts down as for `SIGTERM` (runs finish or are cancelled, the
  lock and pid files are removed) and exits `0`; the shell kills it only after 15 s. If the shell dies, its pipes close and the
  service stops by itself. It never stops another service: a held home is exit `4`, a taken port exit `5`.
- **The window** loads only its own two pages and the service's origin; any other web address goes to the system browser,
  every other scheme is refused, no second window is ever created, and the window may call exactly three app commands
  (`shell_status`, `shell_retry`, `shell_quit`). The Command Centre, being a page of another origin, has no access to the
  shell at all. A click on a link that asks for a new window (`target="_blank"`, which every external link of the Command
  Centre does) reaches the system browser through a small script of the window (`apps/desktop/src-tauri/src/new-window.js`);
  without it that click does nothing in WebKitGTK (seen on Linux; macOS and Windows not observed). Known limit:
  `http(s)://tauri.localhost`, the address of the shell's own pages on Windows, is allowed on every system; on Linux and
  macOS it is a name for this machine's port 80, so a page of the service could send the window to whatever listens there
  (observed in verification round 2: the window left the Command Centre and a server on port 80 got the request; no app
  command is reachable from there, which was read in Tauri's source and not run). Owner question 20 in `.specs/STATE.md`.
- **Checks you can run**: `cd apps/desktop && cargo test -p mordomo-shell-core` (no display needed);
  `mordomo-desktop --self-test` (the payload, the supervisor and the page, without a window; one JSON line, exit `0`/`1`);
  `apps/desktop/smoke/gui.sh <binary>` (Linux: window, token, single instance, close, crash and retry).

## 8. What was not run

Written when the feature was built, on a Linux machine, and left true on purpose: if a line below is still unproven when you
read this, the job named is what proves it.

**Never executed:**

| Not run | What will prove it |
| --- | --- |
| Any build, installer, launch or test on **Windows** (NSIS install, the app, the sidecar's `CREATE_NO_WINDOW`, closing stdin to stop, `Get-AuthenticodeSignature`) | the `windows-x64` job of the release workflow: *Install silently and start the service*, *Verify the Authenticode signature* |
| Any build or launch on **macOS** (bundle, `.dmg`, hardened runtime, nested code signing of Node and the SQLite addon, notarization, stapling, Gatekeeper) | the `macos-*` jobs: *Verify the signature and the notarization*, *The installed app starts its service* |
| **Notarization**, any Developer ID or Authenticode signature (no certificate was available) | a release with the secrets registered; section 4 |
| The release **workflow itself** on GitHub (it was parsed and its guarantees tested, never run; `gh release create` and the artifact hand-offs between jobs are untested) | a `workflow_dispatch` run, then the first tag |
| A **real updater roundtrip** (old build finds, downloads, verifies, installs, restarts into the new one) | section 5's rehearsal, once, before the first published release |
| The **AppImage on other distributions**, the `.deb` on other versions, **Wayland** | the Linux job and a manual check on the machines you care about |
| Windows or Linux **ARM64**, `.rpm` | not built; not promised |
| A click on a link that opens a new window (`target="_blank"`) and the failure screen after an update whose install failed and whose restart failed too. The click was run on **Linux** (real click, Xvfb); macOS and Windows were **not** observed, and the double failure was never provoked (only its decision is tested) | a scenario like `smoke/gui.sh` F in the macOS and Windows jobs; section 5's rehearsal |
| **Saving a file from the window**: `<a download href="blob:…">` (Settings › Diagnostics › export, the Pixel Studio exports). On **Linux** it was run: the click happens and no file is written and nothing is said, because the address policy refuses `blob:` and `data:`. macOS and Windows were **not** observed | not fixed. A fix needs the window to allow the service's own `blob:` addresses and a download handler that picks a destination, which changes the approved address policy (AC 22): it is an owner question (`.specs/STATE.md`, distribuicao, with a default) |

**Run on Linux, with a throwaway key:** the Rust tests (`cargo test`), `clippy -D warnings`; the real window under Xvfb with
a window manager and a D-Bus session (`smoke/gui.sh`: token handshake, single instance, close, crash, retry, held home);
a release build with the updater feature that produced a `.deb`, an `.AppImage` and their `.sig` files; the `.deb` installed
with `dpkg` and its `--self-test`; the AppImage's `--self-test`; the minisign check of section 4 on that AppImage's `.sig` (it verifies, and fails once one byte is
added). A throwaway minisign key was used and discarded; the real key does not exist yet.

Downloads that happen **while building** (not in the product): Node.js and the SQLite prebuild (`nodejs.org`, GitHub), the
Rust crates (`crates.io`), the Tauri bundler's helper tools (`linuxdeploy`, NSIS; GitHub `tauri-apps/binary-releases`), and
the Windows signature's timestamp (`timestamp.digicert.com`).

## 9. When something fails

| You see | Cause | Do |
| --- | --- | --- |
| `UNSIGNED` in a file name and a banner in the notes | the secrets of that platform were not all registered when the run started | register them (section 2) and re-run the workflow for the tag |
| `latest.json` missing from the release | not every platform signed (macOS/Windows unsigned, or no updater key) | the notes say which; fix and re-run |
| The plan job warns the updater key has no public key | `TAURI_SIGNING_PRIVATE_KEY` is set but `tauri.updater.conf.json` still has the placeholder | commit the public key |
| `the tag … is not v<version>` | the tag and `package.json` differ | `node scripts/version-sync.mjs --check`, retag |
| `CHANGELOG.md has no section "## <version>"` | `Unreleased` was not renamed | rename it, move the tag |
| Notarization not accepted | Apple rejected something in the bundle; the log is printed | read it; usually a nested binary without a hardened-runtime signature |
| The app says "MordomoOS is already running" | a login service or a terminal service owns the data folder | `mordomo stop`, open the app again |
| SmartScreen warns on a signed Windows installer | the certificate has no reputation yet (an OV certificate builds it with downloads) | wait, or use an EV certificate |
