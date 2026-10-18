# MordomoOS — Security & Threat Model

Security is a product requirement of MordomoOS, not a later phase. This document is the
short threat model plus the concrete controls implemented in code. Every claim below
points at the module that implements it; if the code and this page disagree, the code
wins and this page is the bug.

## Assets

1. The owner's files (indexed workspace folders, documents, projects, finances).
2. Provider credentials (Claude/Cursor/Codex auth state on the machine).
3. Connector credentials (email, calendar, …).
4. The integrity of the owner's existing agent configs (CLAUDE.md, .cursor/, .agents/).
5. The local machine itself (arbitrary command execution is the worst case).

## Trust boundaries

- **Browser UI ↔ local API**: same machine, but the browser runs untrusted pages too.
- **API ↔ child agent CLIs**: agents can read/write files within granted scopes.
- **Indexed files ↔ prompts**: indexed content is *data*; it may contain hostile text
  (prompt injection) and must never be treated as instructions by MordomoOS itself.
- **Third-party connectors**: external code/services; install and write access are
  approval-gated.
- **Local user ↔ MordomoOS**: the owner (and any process running as the owner) is
  trusted. Controls below defend against *remote* origins and against *mistakes*;
  they are not a sandbox against the local account itself.

## Threats and controls

| # | Threat | Controls |
|---|---|---|
| T1 | Remote origin drives the local API (DNS rebinding, malicious web page) | The listener without TLS binds loopback only (`127.0.0.1`, or the loopback name `bindAddress` itself gives: `::1`, `localhost`; an address beyond loopback applies to the TLS listener alone); another machine is served over TLS or not at all (see *Remote access needs TLS or a tunnel* below); `Host` header parsed with `new URL` and restricted to `127.0.0.1`, `localhost`, `[::1]` (IPv6 works, a *missing* Host is refused); security headers + CSP (`default-src 'self'`, `frame-ancestors 'none'`); every `/api/*` route requires a credential (see *Authentication* below) via the `x-mordomo-token` header (or `?token=` on the four stream/file `GET`s only, and a one-use `?ticket=` on the two streams; both redacted from logs), compared with `crypto.timingSafeEqual`. The token is generated at setup, stored in `config/` (0600) and injected only into the same-origin page served to a loopback socket, so it doubles as CSRF protection. There is **no CORS layer**: no CORS headers are sent, so the browser's same-origin policy is what stops a foreign page from reading responses, and the token stops it from writing. Changing `bindAddress` is approval-gated; with remote access on (`settings.remote`), the Host allowlist also accepts the hosts the owner listed, and remote devices authenticate with their own paired token, never the page's, and only inside the scopes the owner gave that device (`apps/api/src/server.ts`, `apps/api/src/routes/devices.ts`). |
| T2 | Command injection via prompts/paths | argv arrays only, `shell: false`, no `eval`; executable allowlist **by basename**: `node` plus the `binary` of every registered provider manifest (on Windows without `.exe`/`.cmd`/`.bat`), set by the engine whenever it builds the adapters, plus an optional pinned absolute `binaryPath` per provider, which `PUT /api/settings` only accepts when its basename is that manifest's `binary` (`400 binary_mismatch`) — the basename check does not prove *which* binary runs, it only rules out arbitrary executables (`core/src/spawn/safeSpawn.ts`); prompts go to Claude over stdin and to Cursor/Codex as an argv element (visible in `ps`), prefixed with a space when they begin with `-` so they are never parsed as an option; captured stdout/stderr are capped at 1 MiB each (tail kept); Zod validation on every route with a `400 {error:{code:"validation", issues}}` envelope |
| T3 | Path traversal / symlink escape | every `:id` / `:slug` route parameter is validated against `^[a-z0-9][a-z0-9._-]{0,80}$` with no `..` (`IdParam` in `contracts/src/api/common.ts`, bound by each route's entry in the route table; `core/src/security/ids.ts`) and the file stores re-check that `<dir>/<id>` stays inside `<dir>`; every user-supplied path (preview, open, sync `target`, skill import `sourceDir`, the diff `file`) is realpath-resolved and must sit inside the home or an enabled indexed folder; an agent's working directory follows the same rule and also stays out of the home's `config/` and `logs/` **and is never a folder that holds them**: an agent reads everything below its working directory without asking, so the home itself (it holds `config/token`) is not a working directory: a run with no `cwd`, or with the home as `cwd` (what every run recorded by an older version has), starts in `<home>/workspace` (made on first use, ignored by git), and a granted folder that contains the home is refused (`403`), and a run asked for by a paired device is only accepted on a provider whose manifest declares `readConfinement: "workdir"` (Claude), because Codex's `--sandbox read-only` limits writes and not reads and Cursor has no sandbox, so a run there reads `config/token` on request wherever its `cwd` is (`RunManager.assertMayStart`, `403 device_provider_refused`), and a skill run is also let into its own skill folder (Claude's `--add-dir`, the one place outside the working directory it reads) because its prompt tells it to read `SKILL.md` there; that rule is applied by `RunManager` itself (`RunManager.resolveCwd`), both when a run is created and when it is launched, so it covers every way a run can start: `POST /api/runs`, a session continuation, a squad child, a skill run, an objective dispatch, a routine's `workingDir` (also checked when the routine is created or edited, and again at every fire: a folder that became private or was revoked since fails the fire, recorded in the routine's history), and the repeat of a stored run, whose saved `cwd` is checked again; the throwaway directory of an isolated routine is the one place outside the granted folders, and only because `RunManager` made it; new `indexedFolders` must be absolute, existing directories and may not overlap `config/`; backup names match `full-…` and restores are staged (see T10) |
| T4 | Secret exfiltration via index/logs | one shared exclusion policy for the indexer, preview and open (`core/src/memory/excludes.ts`): user `excludes` globs, a **hard directory blocklist** the user cannot switch off (`.git`, `.aws`, `.ssh`, `.gnupg`, `.kube`, `.docker`, `node_modules`) and the secret-file basename patterns (`.env*`, `*.pem`, `*.key`, `*.p12`, `id_rsa*`, `id_ed25519*`, `credentials*.json`, `.npmrc`, …), all applied *before* reading; **the home's own `config/` and `logs/` are never served** (token, VAPID and signing keys, TLS key, settings, database, backups, prompts and outputs): `GET /api/memory/preview` answers `403 forbidden_path`, and `POST /api/memory/open`, the indexer and the run-diff route refuse them through the same filter, decided on the *real* path so `..`, symlinks (also a link inside `memory/` to `config/token`), a trailing dot or slash and, on macOS and Windows, a different letter case reach the same refusal; only direct children of the home are private, so a `config/` folder inside an indexed project stays readable; this holds for *every* reader, not only those four, because the filter sits where a file is read and not where a call is written (T15); rows an older index holds for those paths are dropped at start and filtered again whenever they are read (search, recall); binary files detected by content (NUL byte in the first 8 KiB); redaction of token-shaped strings (`sk-…`, `sk-ant-…`, `ghp_…`, `xox…`, `AKIA…`, JWTs, `Bearer …`, `password=`/`token=` pairs) on every persisted log line, including the API request log; auth detection never prints, copies or stores tokens |
| T5 | Prompt injection inside indexed files | indexed content is never concatenated into MordomoOS system instructions; skill runs receive file *paths*, not inlined untrusted content; previews are rendered as plain text/escaped HTML; UI marks workspace content as data |
| T6 | Destructive agent runs | security profiles (`read_only` default; see below); write modes are explicit per run; `bypassPermissions` / `danger-full-access` are never used; read-only is **mechanically enforced for Claude and Codex only** — the Cursor adapter has no sandbox flag and can only ask for read-only in the prompt (see [architecture.md](architecture.md#adapters)); timeouts, concurrency limit, bounded queue (10 × `maxConcurrentRuns`), cancellation (process-group SIGTERM, SIGKILL after grace) |
| T7 | Clobbering the owner's existing configs | sync compiler: detect → backup (`config/backups/`) → diff → approval on material conflict; generated files tracked in a hash manifest so hand edits are detected |
| T8 | Malicious third-party connector | auditor prefers official/maintained sources, performs a basic static safety review before install, requires approval, proves with a read-only call first; write operations per-connector opt-in |
| T9 | Supply chain (npm) | small dependency set, exact-pinned via lockfile; no postinstall scripts of our own; `mordomo doctor` runs `npm audit --audit-level=high` (20 s budget, `MORDOMO_SKIP_NPM_AUDIT=1` to skip) and CI fails on high-severity advisories in the shipped dependencies (`npm audit --omit=dev`) |
| T10 | DB corruption / bad migration / a backup that is not what it was | versioned SQL migrations run **once**, in an `EXCLUSIVE` transaction that reads `user_version` again after the lock is taken, so two processes opening the database together (the CLI and the service) cannot both apply them, and a migration that throws rolls the whole run back (`MigrationError`); a database from a newer version is refused untouched (`DbNewerVersionError`: its version is read first - from the 64-byte header when no WAL waits, so SQLite is not even opened and no `-shm` appears; through a read-only connection when one does - so not a byte of the file or its WAL, and not its mode, changes); a consistent snapshot (`VACUUM INTO`) is written before each migration; WAL mode; backups copy the DB with SQLite's online backup API (`db.backup()`), so a backup taken while the service runs is consistent; **every backup is sealed** with `manifest.json` (SHA-256 and size of each file, the target of each link) and a restore compares the copies it is about to install with it before anything live moves: a truncated, edited, shortened or enlarged backup is refused (`422 backup_invalid`), and one from before backups were sealed is refused (`backup_unsealed`) unless the owner passes `--allow-unverified` on the CLI. The manifest detects damage and accidental edits, not someone who can rewrite `config/backups/` (they can rewrite the manifest too); signing waits for a key outside the home. A restore requested through the API is verified, then **staged** in `config/restore-pending/` (refused while runs are active) and applied at the next service boot before the DB is opened, after a safety backup (a staged restore that fails verification at boot is refused and the service starts with the data it has); the install moves the DB's `-wal`/`-shm` first and keeps a journal (`JOURNAL.json`, in a `.restore-<pid>-…` folder of the home) that names the eleven things a restore replaces **by name, never by path** - the place is always taken from the paths of the process that reads it, so a home reached by a link, or moved since, is undone like any other - so a restore whose process died half way is undone by whatever builds the engine next (any CLI command, the service boot, the next restore or backup) instead of leaving the home half restored. The **restore lock** (`config/run/restore.lock`, `0600` in a `0700` folder) is the lock of a small SQLite file, which the kernel releases when its holder dies - no pid to judge, none to recycle. It is *exclusive* for a restore, the undoing of a dead one and the application of a staged one; it is *shared* for a backup (from its first copy to its published manifest, so a backup is never sealed across a restore: it is all before or all after) and for an engine being built (until its database is open, so a restore cannot replace the file under it): any number of shared holders at once, none beside an exclusive one. A restore waits 15 s for it, an engine or a recovery 10 s, a backup 3 s without blocking the service (`POST /api/backups` answers `409`); then `restore_in_progress` (`409`). It is not reentrant (a second lock by the process that holds one is an error: it would release the first). Its limit: the lock belongs to the file's inode, so deleting or replacing `restore.lock`, or removing `config/run`, while it is held lets a second process in; after taking it the path is checked to still name the file that was locked (retrying on the new one if not), which narrows that to the instant between the two. A lock file that is not a regular SQLite file is reported (`restore_lock_unusable`, `409`: remove it by hand) and never overwritten. Recovery acts only on a `.restore-<pid>-…` folder that is a real direct child of the home and whose journal is well formed (only the eleven names, each once, each with `hadTarget` a boolean). **What that bounds, and what it does not:** a journal cannot make recovery touch anything outside those eleven things of the home, but someone who can write to the home can still plant one that makes the next recovery delete or replace one of them (`memory/`, say) - there is no boundary against someone who can write the home, they can edit those files directly. Anything recovery cannot place (a link or file named like a staging folder, a journal that is damaged or not a restore's, originals `old-N` with no journal) is left exactly as it is and refuses the backup, restore and engine (`restore_leftover`, `409`, naming the folder from the home, never by an absolute path) until the owner clears it by hand; `old-N` with no journal can be what a restore that had FINISHED left (an older version deleted the journal before the originals when it cleaned up, and a kill in that window left exactly that), so the message says to delete the folder if the files are the restored ones, and otherwise to move each `old-N` back following `MAPA.txt` (written beside the journal: N, old or new, path from the home) or to restore the safety backup the restore made first. This version cannot produce that state itself: a staging folder is renamed to `.removing-…` (a name recovery treats as plain debris) before it is deleted, so a process killed at any unlink or rmdir leaves a home that works and reads as restored, and the next holder of the exclusive lock sweeps the leftover. When something blocks the home, `mordomo doctor`, `status`, `stop` and `backup --list` do not build the engine (building it recovers and refuses): they read the folder, explain step by step with the full paths and exit `3` (`stop` still stops a live service); every other command fails with the cause and the same exit code. Limits kept in the open: the hash of a backup yields the event loop every 8 MiB, not less; `peekVersion` opens and closes a descriptor on `mordomo.db`, which on POSIX releases the locks another connection of the same process holds on that file, so it is one engine per process (`launch` and `restart` build none); `mordomo restore` on the CLI refuses while the service is running; `limits.backupRetention` (default 10) bounds the sealed backups kept, oldest first by the time in the backup's name, and a backup without a manifest or named by a staged restore is never deleted by it. **A `settings.json` field this version cannot read never opens a permission**: it reads as its schema default, except security fields that read as their most restrictive valid value (`securityProfile` `read_only`, an indexed folder's `enabled` `false`, a provider with an unreadable `binaryPath` switched off, an unreadable Telegram `allowedUserIds` switching the channel off, `memorySkills` `[]`, spend alert `0.01`, approval and device-token lifetimes of one day, no triage budget, the owner's `excludes` kept together with the default list, and every `enabled` flag of the sentinels that is on by default read off); the original is kept in `settings.json.invalid` and each field is logged to `logs/settings.jsonl` |
| T11 | Orphaned processes after crash | pidfile carries pid, port, start time and a per-boot token so a recycled PID is not mistaken for a live service; graceful shutdown (SIGTERM/SIGINT) cancels active runs and waits up to 10 s before closing the DB, marking them `interrupted`; on boot, runs left `running`/`queued` are marked `interrupted`. Persisted PIDs do not prove process identity after restart: live PIDs are recorded as unverified and are not signalled by `RunManager.recoverInterrupted`. Automatic reaping after a crash requires durable ownership verification and is not currently guaranteed. Live processes owned by the current manager remain cancellable through their handles. |
| T12 | A repository's own config runs code when the diff is asked for (`core.fsmonitor`, a `diff` textconv or external driver, a `filter` clean command, hooks) | the run-diff route runs git only through `apps/api/src/routes/git.ts`: every call carries `-c core.fsmonitor=false -c core.hooksPath=<null device> -c core.sshCommand= -c protocol.ext.allow=never`, `diff` adds `--no-ext-diff --no-textconv`, `diff` and `status` add `--ignore-submodules=all`, and each `filter.<driver>` the repository declares is emptied by name (a driver name git cannot take on a `-c` line makes the call refuse instead of run); the environment sets `GIT_CONFIG_NOSYSTEM=1` and `GIT_CONFIG_GLOBAL` to the null device (`/dev/null`, `NUL` on Windows), so neither the system nor the user config is read; the path goes through the workspace filter before git starts, and **what git reads is what the filter judged**: every call is literal (`--literal-pathspecs` and `GIT_LITERAL_PATHSPECS=1`, so `*`, `?`, `[.]`, `:(top)` and `:(glob)` name a file called that), the diff lists the files the pathspec covers (`diff --name-only -z`, which for a directory or a deleted path is every file under it) and refuses the whole diff when the filter blocks any of them, and the repository's location is ours: `--git-dir=<work tree>/.git` and `--work-tree=<work tree>` are explicit (so `core.worktree`, `core.bare` and discovery are never consulted), `.git` must be a real directory (a `.git` file with `gitdir:`, a `.git` symlink, `objects/info/alternates` and `commondir` are refused: the diff falls back to a snapshot of the file) and a config that `include`s another file is refused |
| T13 | Other accounts on a shared machine read the home | on POSIX, `config/`, `config/db/`, `config/backups/`, `config/run/` and `logs/` are created `0700`, and the database (and its `-wal`/`-shm`), backups of it, log files and `config/token` are `0600`; a home made by an older version is tightened on the next start (only what differs is changed). **Windows does not apply POSIX modes**: there the home inherits the folder's ACL, and keeping the folder out of shared locations is the control. `config/token` is published complete and atomically by a hard link (`link(2)`), so two processes starting together agree on one token; only a file system without hard links falls back to an exclusive create (`wx`) |
| T14 | An event stream resumes against a restarted service | event ids restart with the process, so a `Last-Event-ID` (or `?since`) above the process's last id belongs to a previous run: `GET /api/events` then sends `stream.reset` (`{ lastId }`, version 1) as the first frame, replays the whole ring and goes live, and the Command Centre refreshes all its queries as on `stream.reconnected`. The frame is written by the route for that connection and never goes through the event bus |
| T15 | A reader opens a path it was handed (request, stored record, index row, a link in a folder an agent can write to) and serves `config/token` | one safe-read primitive, `core/src/security/safeFs.ts`: the path is resolved to its real path, must lie in a root of the reader's scope, is judged by the workspace filter on that real path (home `config/` and `logs/`, protected directories, secret file names, the user's excludes), is opened with `O_NOFOLLOW` and without blocking on a pipe, is checked again once it is open (the descriptor has the same inode as the path, and the whole path resolved again gives the same real path), and is read through a byte cap. The write side makes the same two checks before it changes a byte (the folder-on-the-way case included). A second name is judged by what it is, not by what it is called: when an open file has more than one link, its device and inode are compared with every file under `<home>/config` and `<home>/logs`, and a hard link to `config/token` planted anywhere (the home, an indexed folder) is refused for a read, a write and a listing. The same primitive WRITES (`writeWorkspaceFile`): the path is judged as above, a link at the last component (dangling ones included) is refused, the file is opened `O_NOFOLLOW` and is not truncated by the open, and the descriptor is checked against the path before a byte is written; the router files, a skill's `SKILL.md` and notes, a journal day, a sync target and a saved drawing are written only this way (the engine's JSON stores of routines and connectors, settings and preferences go through `atomicWrite`: a temporary file with a random name made exclusively, then `rename`, which replaces the name and follows no link), and so is every file of a folder copied by a skill import (links, devices, secret names, protected folders and anything from `config/` stay behind at any depth, a folder that holds the home is refused, and the copy is bounded in files, bytes and depth). Served by it: preview, journal, sync plan and apply, recall and the stored index rows it opens, skills (`SKILL.md`, notes, resources, streamed from the descriptor), artifacts (file, raw, list, recent), the router files, the stores of routines and connectors, the indexer, the objective evidence, the run diff. `tests/security-reads.test.ts` makes this mechanical: it type-checks every file of `core/src` and `apps/api/src` and fails when one calls a raw `fs` read or write (`readFile`, `readdir`, `stat`, `open`, `opendir`, `glob`, `createReadStream`, `realpath`, `copyFile`, `cp`, `writeFile`, `appendFile`, `createWriteStream`, `truncate`, `chmod`, ... through any alias, namespace, `node:fs/promises` or destructuring) with a path that is not a literal, unless the file is on a reviewed list with the reason it is safe (the engine's own fixed files, a directory listing that returns names only, a path the owner configured), and it reads the list of path-taking functions from `@types/node`, so a function Node adds must be classified before the build passes |

## Authentication

The rules below hold for every route, present and future (`.specs/STATE.md`, AD-001 and AD-002).

- **Denied by default, decided on the matched route.** The `onRequest` hook in
  `apps/api/src/server.ts` reads the route the router matched (`req.routeOptions.url`),
  never the raw URL: the router decodes the path, so `/%61pi/settings` is `/api/settings`
  and needs a credential like any other spelling. A route is reachable without one only
  when it declares `config: { public: true }` — today `GET /api/meta` and
  `POST /api/pair/claim`. The SPA fallback answers `GET`/`HEAD` only.
- **A route exists only through its entry in the route table.** `bind` (`apps/api/src/contract.ts`) is the one way to
  register a route under `/api`: the method, the path and the access (`public`, or the scope) come from the entry in
  `API` (`contracts/src/api`), so a route cannot be added without saying who may call it, and `buildServer` refuses a
  route that has no entry and an entry nobody bound (`tests/api.contract.test.ts`, C6). In development and tests every
  JSON answer is also checked against its entry, error code included, so an error the route never documented cannot
  ship unnoticed.
- **Four credentials, four principals.** The local token is the `owner`; a paired device token (only while
  `remote.enabled`) is a `device` and holds the scopes the owner gave it (*Device scopes* below); a
  permission-broker credential is a `broker` bound to one run; the credential of a *memory skill's* run is a `run`
  bound to it. The hook records which one called in `req.principal`.
- **A memory skill's run does not need the owner token, and is not given it.** Which skills work on
  the second brain is a list only the owner changes (`settings.memorySkills`, `PUT /api/settings` is
  owner-only; default `recall` and `consolidate-memory`). It is not a field of any `SKILL.md`: a file an
  agent, a paired device, an imported folder or a link to another skill's file could write cannot grant it
  (`tests/builtin-context.test.ts`). Such a skill is told the absolute paths it needs in its prompt, gets
  `memory/` as an added folder, and gets `MORDOMO_URL` and `MORDOMO_RUN_TOKEN` in its environment: `rc_` +
  32 random bytes, in memory, dropped the moment its run finishes, accepted only while the run is `queued`
  or `running`, and only on `GET /api/memory/recall`, `…/recall/stats`, `…/journal`, `…/facts`; the two
  routes that write (`POST /api/memory/journal/append`, `…/facts`) are open to the credential of a *write*
  run only, are capped (100 writes a run, 500 a day) and record the run as the source (a fact's
  `sourceRunId` is the credential's run, whatever the body says). Anything else is `403`. Recall through
  it reads `memory/` only, not the owner's other granted folders. The request log records who called
  (`owner`, `device:<id>`, `broker:<run>`, `run:<run>`). It replaces the instruction to `cat config/token`
  that those skills used to carry (AD-012). The CLI path (`mordomo recall`) reads the index directly and
  needs no credential. `tests/builtin-context.test.ts` runs every built-in skill and routine against the
  real working directory and the real prompt and fails when one still names a path relative to the home or
  `config/`. **Two honest limits:** the credential is not per device and not hidden from the OS user (the
  environment of a process is readable by `/proc/<pid>/environ` and `ps eww` for processes of the same
  user, and the same holds for the permission broker's `brk_` credential); and the owner token itself is
  still obtainable by a program of this user from the page (next bullet), so this narrows what a run is
  *given*, it does not stop a run that goes looking.
- **A SKILL.md is data, never code.** Every SKILL.md is parsed by one function (`parseSkillFile`,
  `core/src/skills/parse.ts`): `gray-matter` would run a `---js`, `---javascript`, `---coffee` or `---cson`
  frontmatter with `eval`, so those engines are replaced by ones that refuse (`400 invalid_frontmatter`),
  in the catalog, in the import and in `mordomo skills publish`; YAML and JSON remain.
- **Folders handed to an agent.** A skill run is given its own folder (`AgentRun.readDirs`), and a memory
  skill also `memory/`, as real paths inside the home, outside `config/` and `logs/`, and holding no link or
  second name that leads into them (the run fails before the agent starts otherwise). The skill's own
  folder is also `protectedDirs`: the Claude adapter passes `--disallowedTools Edit/Write/MultiEdit` rules
  for it in every mode, so an `acceptEdits` run cannot rewrite the `SKILL.md` the next run trusts. That the
  installed Claude CLI honours those rule strings was not verified here (no binary was run); Codex and
  Cursor have no such rule and ignore `protectedDirs`.
- **Device scopes.** What a paired device may call is decided by the route the router matched
  (`req.routeOptions.config.scope`, never the URL) against the scopes the device holds, which the owner chooses
  when the code is shown and changes later (`POST /api/pair/start { scopes }`, `PATCH /api/devices/:id`; Settings ›
  Security › Remote access). There are four, and a set is always closed: `run` brings `content`, `content` and
  `approve` bring `monitor`. A new device holds `monitor`, `content` and `run`; a device paired before scopes
  existed reads as the same; `approve` is never a default. Every `/api` route that is not `public` must declare
  a `config: { scope }` - registering one without it throws, so the service does not start - and a route whose
  scope is `owner`, or missing, is the owner's alone. A device without the scope gets `403 scope_required`, on an
  `owner` route `403 owner_only`; the broker and run credentials keep their own route lists whatever the scope.
  `monitor` shows what the owner's runs printed: a run's transcript holds whatever the agent read from files, so a device without `content` still sees that part of it. `tests/helpers/routeScopes.ts` holds the same table written by hand and `tests/device-scopes.test.ts` compares
  it with the router and with this page:

| Scope | What it is | Routes |
| --- | --- | --- |
| `monitor` (33) | See runs, approvals, notifications and status (the health report included, without `npm audit` for a device); it reads the inbox (marking rows read and deleting them is the owner's). | `GET /api/approvals`<br>`GET /api/approvals/:id`<br>`GET /api/channels/telegram/status`<br>`GET /api/doctor`<br>`GET /api/events`<br>`GET /api/health`<br>`GET /api/memory/status`<br>`GET /api/metrics`<br>`GET /api/metrics/history`<br>`GET /api/notifications`<br>`GET /api/objectives`<br>`GET /api/objectives/:id`<br>`GET /api/openapi.json`<br>`GET /api/providers`<br>`POST /api/push/unsubscribe`<br>`GET /api/push/vapid`<br>`GET /api/routines`<br>`GET /api/routines/:id/history`<br>`GET /api/routines/silent`<br>`GET /api/routines/summary`<br>`GET /api/runs`<br>`GET /api/runs/:id`<br>`GET /api/runs/:id/children`<br>`GET /api/runs/:id/stream`<br>`GET /api/sentinels`<br>`GET /api/sessions`<br>`GET /api/sessions/:id`<br>`GET /api/settings`<br>`GET /api/skills`<br>`POST /api/stream-tickets`<br>`GET /api/system/info`<br>`GET /api/ui-preferences`<br>`GET /api/updates` |
| `content` (24) | Read what the owner's folders, notes and memory hold: memory, artifacts, run diffs, skills' text and resources, connector data, and register a push subscription at a browser's push service (a push carries inbox text). | `GET /api/artifacts/file`<br>`GET /api/artifacts/list`<br>`GET /api/artifacts/raw`<br>`GET /api/artifacts/recent`<br>`GET /api/connectors`<br>`GET /api/connectors/:id/data`<br>`GET /api/memory/facts`<br>`GET /api/memory/graph`<br>`GET /api/memory/hygiene`<br>`GET /api/memory/journal`<br>`GET /api/memory/links`<br>`GET /api/memory/note`<br>`GET /api/memory/preview`<br>`GET /api/memory/query`<br>`GET /api/memory/recall`<br>`GET /api/memory/recall/stats`<br>`GET /api/memory/related`<br>`GET /api/memory/routers/check`<br>`GET /api/memory/search`<br>`POST /api/push/subscribe`<br>`GET /api/runs/:id/diff`<br>`GET /api/skills/:slug`<br>`GET /api/skills/:slug/notes`<br>`GET /api/skills/:slug/resource` |
| `run` (6) | Ask for runs: read-only on a provider that keeps reads in the working folder, a write waits for a human (see *Separation of duties*); cancel and repeat a run. | `POST /api/runs`<br>`POST /api/runs/:id/cancel`<br>`POST /api/runs/:id/children`<br>`POST /api/runs/:id/retry`<br>`POST /api/sessions/:id/continue`<br>`POST /api/skills/:slug/run` |
| `approve` (1) | Decide what someone else asked for. | `POST /api/approvals/:id/resolve` |
| `owner` (66) | Only the local token. A paired device gets `403 owner_only`: settings, providers (changing them), backups and restore, sync, skills and routines (writing them), objectives, connectors, memory writes (facts, the journal, the notes: creating and saving a note is the owner's alone), devices and pairing, the channels. | `POST /api/approvals/tool`<br>`GET /api/backups`<br>`POST /api/backups`<br>`POST /api/backups/:name/restore`<br>`GET /api/backups/restore-pending`<br>`DELETE /api/backups/restore-pending`<br>`POST /api/channels/telegram/send`<br>`POST /api/channels/telegram/test`<br>`POST /api/connectors`<br>`PUT /api/connectors/:id`<br>`DELETE /api/connectors/:id`<br>`GET /api/connectors/:id/setup`<br>`GET /api/connectors/audit`<br>`GET /api/devices`<br>`PATCH /api/devices/:id`<br>`DELETE /api/devices/:id`<br>`GET /api/diagnostics/export`<br>`POST /api/memory/facts`<br>`POST /api/memory/facts/:id/retract`<br>`POST /api/memory/index`<br>`POST /api/memory/index/cancel`<br>`POST /api/memory/journal/append`<br>`POST /api/memory/notes`<br>`PUT /api/memory/notes`<br>`POST /api/memory/open`<br>`POST /api/memory/routers`<br>`POST /api/microapps/pixel/save`<br>`DELETE /api/notifications/:id`<br>`POST /api/notifications/read`<br>`POST /api/objectives`<br>`DELETE /api/objectives/:id`<br>`POST /api/objectives/:id/dispatch`<br>`POST /api/objectives/:id/steps/:stepId/retry`<br>`POST /api/pair/start`<br>`POST /api/providers/:id/detect`<br>`GET /api/providers/:id/models`<br>`POST /api/providers/:id/smoke`<br>`PUT /api/providers/default`<br>`GET /api/push/subscriptions`<br>`DELETE /api/push/subscriptions/:id`<br>`POST /api/push/test`<br>`POST /api/routines`<br>`PUT /api/routines/:id`<br>`DELETE /api/routines/:id`<br>`POST /api/routines/:id/duplicate`<br>`POST /api/routines/:id/run`<br>`POST /api/routines/:id/toggle`<br>`PATCH /api/sessions/:id`<br>`DELETE /api/sessions/:id`<br>`PUT /api/settings`<br>`POST /api/skills`<br>`PUT /api/skills/:slug`<br>`DELETE /api/skills/:slug`<br>`POST /api/skills/:slug/favorite`<br>`POST /api/skills/:slug/notes`<br>`POST /api/skills/:slug/notes/promote`<br>`POST /api/skills/:slug/toggle`<br>`POST /api/skills/import`<br>`POST /api/skills/install`<br>`GET /api/skills/registry`<br>`GET /api/startup-plan`<br>`POST /api/sync/apply`<br>`GET /api/sync/plan`<br>`POST /api/system/reap`<br>`POST /api/system/restart`<br>`PUT /api/ui-preferences` |

- **Separation of duties.** A device does not approve what it asked for. Every run records `startedBy` and every
  approval `requestedBy` (`owner`, `device:<id>`, or null for a routine, a sentinel, the CLI and what predates
  this). A write run asked for by a device always waits for a human, whatever the profile would have let the
  owner do (`MordomoEngine.gateWrite`); under `read_only` it is refused as before. The approval of a tool a
  device's run asks for inherits the run's `requestedBy`. `engine.execution.resolveApproval`, the one place a
  decision is applied (the Command Centre, Telegram and a program that uses the core as a library all come through it), refuses `approved` from a device when `requestedBy` is that device (`403 self_approval`) or when the
  kind is not `write_run` or `tool_use` (`403 owner_only`: `expose_port`, `connector_write` and the rest are the
  owner's); `denied` is open to every kind, so a device can withdraw its own request. The owner (in the Command
  Centre, after the whole request is shown) and another device holding `approve` can approve a device's write; a
  person on Telegram's `allowedUserIds` can deny it but not approve it (the chat shows a one-line label). The broker still only denies
  its own prompt (AD-002). An approval raised before this existed has no `requestedBy` and a device holding
  `approve` can approve it.
- **What a device may start.** A run asked for by a device is only accepted on a provider whose manifest declares
  `readConfinement: "workdir"` (`403 device_provider_refused`, checked by `RunManager.assertMayStart` for every way a
  run is created, and before a conversation is created). Today only Claude does, on the documentation of the
  Claude Code permission model (a read outside the working folder and the added folders needs a permission that a
  headless run is denied); a partial measurement agrees (see *Not covered*) and the adapter was not run end to end. Codex and Cursor read the disk, so the token
  is one `cat` away from any `cwd`. Routines, objectives and "run now" are `owner`.
- **Remote access needs TLS or a tunnel.** A request whose TCP peer is not loopback must arrive on a TLS
  connection or it gets `403 tls_required` before any header, credential or path is read (the pairing page
  and the static files too); a peer on loopback is not asked, so the CLI, the broker and a tunnel or reverse
  proxy that runs on this machine and forwards to `127.0.0.1` (Tailscale serve, Caddy, cloudflared; list its host
  in `remote.allowedHosts`) keep working. The listener without TLS binds loopback only (`127.0.0.1`, or `::1` or `localhost` when
  `bindAddress` names one of those; it never follows an address beyond loopback); `bindAddress` beyond loopback applies to the TLS listener and only when `remote.enabled` and
  `remote.tls.enabled` are on, and otherwise the service starts on loopback, prints and logs why, and `mordomo
  doctor` reports `warn` (`apps/api/src/transport.ts`). A reverse proxy on another machine is not a tunnel: it
  would reach plain HTTP, which is refused; point it at the TLS listener instead. Behind a tunnel every remote
  client shares the address `127.0.0.1`, which the `401` limit never counts, so the pairing code (five tries,
  ten claims a minute) and 256-bit tokens are what stand there. Whether a connection is TLS, and who the peer is,
  are read from the socket and never from `X-Forwarded-Proto`, `X-Forwarded-For`, `Forwarded` or `X-Real-IP`
  (a plain request from outside does not become TLS by saying so, and the `401` limit counts the socket's address
  whatever those say). **A proxy on this machine is trusted as this machine is:** the page carries the owner's
  token to a request from a loopback socket whose `Host` is a loopback name, and a proxy that forwards a visitor
  from elsewhere while rewriting `Host` to `127.0.0.1` is that request. The page therefore withholds the token
  from a request that carries any of a closed list of proxy and CDN headers: `X-Forwarded-*` (`X-Forwarded-For`,
  `-Host`, `-Proto`...), `X-Original-Forwarded-*`, `Forwarded`, `Via`, `X-Real-IP`, `X-Client-IP`, `True-Client-IP`,
  `Fastly-Client-IP`, `X-Envoy-External-Address` and every `CF-*` (`CF-Connecting-IP`, `CF-Ray`...), which is what
  nginx, Caddy, Envoy, Cloudflare and Fastly add (`carriesProxyHeaders`; any other header is not read); a proxy that adds none and rewrites `Host` cannot be told from the
  owner's browser, so keep the original `Host` (and list it in `remote.allowedHosts`) or add one of those headers.
- **No token in the URL, except where a header is impossible.** `?token=` is accepted only
  on `GET` of the routes marked `config: { queryToken: true }`: `/api/events`,
  `/api/runs/:id/stream` (EventSource), `/api/artifacts/raw` and
  `/api/skills/:slug/resource` (`<img>`/`<iframe>`). Anywhere else under `/api` (the public
  `/api/meta` and `/api/pair/claim` included), or on another method, it is
  `401 unauthorized` even next to a valid header. "Under `/api`" is one rule
  (`isApiRequest`): the router matched an `/api/…` route, or the percent-decoded path is
  `/api` or lies under `/api/` — so `/%61pi/runs`, `/api/v1//runs` and a path that does not
  exist are all refused with `401` (never a `404` that would say which paths exist).
- **Stream tickets.** The two streams (`/api/events`, `/api/runs/:id/stream`) open with
  a ticket, not a credential: `POST /api/stream-tickets { target: "events" }` or `{ target: "run", runId }`
  (scope `monitor`) answers `tk_` + 24 random bytes good for one presentation within 30 seconds, tied to the
  principal that asked and to that one stream; `?ticket=` on the stream opens it as that principal. The first
  presentation consumes it whatever happens, a device is checked again when the ticket is presented (revoked,
  expired, still holding the scope), a principal holds at most 32 at a time (`429 too_many_requests`), and every
  refusal is the same `401 unauthorized`. A device's token in `?token=` on these two routes is `401`; the owner's
  still works there (this machine, a local client). The ticket is redacted from the request log like the token. The
  Command Centre asks for a ticket before every connection and opens a new stream, with `since` set to the last
  event it saw, when one closes. The two file routes keep `?token=` for a device (`<img>`, `<video>` and `<iframe>`
  fetch again and with `Range`, which a one-use ticket cannot serve): the device token is in those URLs.
- **Push subscriptions.** A subscription is a URL the server will `POST` to with its own VAPID credential, so who
  names it and where it points is checked (`core/src/channels/pushEndpoint.ts`): `https` on the default port, no
  credentials, no single-label or local-only name (`localhost`, `.local`, `.internal`...), and every address the name
  resolves to is public (not loopback, private, link-local, `169.254.169.254`, multicast, documentation, `::`,
  IPv4-mapped, IPv4-compatible, 6to4, Teredo, local NAT64 or site-local forms of those); an IP literal is judged the
  same way. It is checked when the subscription is registered and again just before every send (a name can move), and
  a send never follows a redirect. Two limits are said plainly. The check resolves the name and `fetch` resolves it
  again, so a name that changes between the two is not caught by the check; only the owner can name a server of their
  own (a device is held to the browsers' names), and the owner is trusted. And a name that cannot be resolved at send
  time (no network, a resolver that timed out, an empty answer) is **a failed delivery, counted**, like any other:
  the subscription goes after eight failures in a row and not at the first, so a laptop that was offline for one
  notification keeps its phones; only an endpoint that now points inside, or that the policy refuses, is dropped. The owner may
  register any public `https` endpoint (a self-hosted push server included); **a paired device** needs `content`
  (a push carries the inbox's titles and bodies) and may name only the push services of the browsers (five patterns, each anchored at
  both ends: `fcm.googleapis.com`, `android.googleapis.com`, `<label>.push.services.mozilla.com`,
  `<label>.push.apple.com` and `<labels>.notify.windows.com`; an IP literal is never one), cannot take an endpoint someone else registered, and removes only its own. A
  subscription belongs to the device that registered it: revoking the device, its expiry, or taking `content` away
  deletes it. The inbox and the subscriptions are the owner's, shared by every device: a device reads the inbox
  (`monitor`) and does not clear it (`POST /api/notifications/read` and `DELETE /api/notifications/:id` are `owner`).
- **The owner reads the whole request before approving.** The approval of a write asked by a device (or anyone)
  carries the complete request in its payload (the prompt in full; for a skill, every input; the provider, model,
  mode and folder) and the approvals screens show all of it, with who asked, in a box that scrolls and that the
  keyboard reaches; nothing is cut. Who asked is the device's name as it was paired (kept on the approval, so a
  revoked device still has its name), and a request from before who-asked was recorded reads "unknown origin". The
  one-line description keeps only the first 600 characters of a prompt, says it was cut and by how much, and a chat
  message shows that line, so a long request is read on the desktop: **a quick way to approve never approves a
  device's write, or a tool a run it started asks to use, without the request in front of the person.** A tool request is a device's when the run that raised it was started by one (`requestedBy` is inherited from the
  run), and the screens show the tool and every field of its input whole (the one-line description of a tool keeps
  160 characters). The inbox's tick on such a row becomes "review the whole request" (it opens Settings ›
  Security), ⌘⇧A in the Núcleo opens the Resolver instead of approving, and Telegram can deny it but answers an
  approve with where to read it (`resolveApprovalForChat`); the alert itself offers Deny alone. The rule is
  `requiresFullReview`. **A device's name** is chosen by whoever pairs and is not unique: it is cleaned when the
  device pairs (control characters, line breaks, invisible format and bidirectional characters, repeated spaces; 80
  characters) and shown with a short id, `Name · a1b2c3`, in the approvals and the device list.
  Cancelling a write that waits for a human denies its approval (`resolvedBy: system`), so approving it later
  starts nothing; a `submissionId` (and a retry receipt) replays only for the principal that made it.
- **Attempt limits** (`apps/api/src/rateLimit.ts`, in memory, reset on restart).
  `POST /api/pair/claim` takes 10 attempts a minute per address, counted before the code
  is read; an address that collected 20 `401`s in 5 minutes gets `429` on every request
  until the window passes. Both answer `429 too_many_requests` with `Retry-After` in
  seconds. Loopback never counts towards the `401` limit, so the owner is never locked out.
- **The permission broker cannot approve.** A write run under `review_before_write` or
  `controlled_write` gets its own credential (`brk_` + 32 random bytes, base64url), issued
  by `AppContext.permissionBrokerFor` and held in memory. It is accepted only while its run
  is `queued` or `running` (afterwards `401`), and only on `POST /api/approvals/tool`,
  `GET /api/approvals/:id` and `POST /api/approvals/:id/resolve` with `decision: "denied"`
  — always for its own run; anything else is `403`. Approving needs the owner. The Claude
  adapter writes the MCP config that carries it to a `0600` file in a private `0700`
  temporary directory, passes the file path to `--mcp-config` and removes the directory
  when the run ends, so neither credential appears on argv.
- **The page only carries the token to a browser on this machine.** `GET /` injects the local token
  into `<meta name="mordomo-token">` only when the TCP peer (`req.socket.remoteAddress`) and the `Host`
  header are loopback AND the request looks like a browser opening the page: `Sec-Fetch-Dest: document`
  with `Sec-Fetch-Mode: navigate`, or neither header with a `Mozilla/5.0` user agent (a web view that
  predates Fetch Metadata), and no `Origin` that is not this host (`looksLikeBrowserNavigation`). A forged
  `Host: localhost` from the network, `curl http://127.0.0.1:4777/` and a script's `fetch()` get an empty
  meta. **This is a reduction, not a boundary:** a program that sends those headers (it is one line)
  still reads the owner token from the page, and so can any process of this user read `config/token`
  from disk. Closing it needs a secret the launcher hands the browser. The design is known and was not built
  (`escopos-dispositivo` left it as a limit, `.specs/STATE.md`): `mordomo launch` would open the page with a
  nonce derived from the token (HMAC, a minute, one use), the server would answer with an `HttpOnly`,
  `SameSite=Strict` cookie and serve the token only to a request that carries it. It breaks opening the URL by hand
  and a bookmark, needs a "locked" screen, and the e2e suite needs the cookie; and a program that can read the
  page without it can read `config/token` from disk, so it narrows who can ask and not what a run that goes
  looking for the file reaches.
  **Built for the desktop app (`distribuicao`):** the app starts its service with a launch secret
  (`MORDOMO_LAUNCH_TOKEN`, 256 random bits made for that launch, in the environment and never in argv) and opens the window
  on `/?launch=<secret>`; the service trades it for an `HttpOnly`, `SameSite=Lax` cookie with a `302`, and while the secret is
  set it serves the token only to a request that carries the cookie (`GET /` without it answers the page with an empty meta,
  headers of a browser or not). `Lax` and not the design's `Strict` because the first request comes from the shell's
  `tauri://` page, another site, and a `Strict` cookie is not sent through that redirect (seen under WebKitGTK). The service
  started that way (`start --foreground --sidecar`) also refuses to stop another service for the home or the port. The
  secret is not a boundary against a process that can read `config/token`, nor against one that runs as the same user and
  reads `/proc/<pid>/environ` of the service (the environment it was started with; the service deletes the variable from its
  own `process.env`, so what it starts does not inherit it); it removes the "any program that sends a
  browser's headers gets the token from the page" path for the desktop app. `mordomo launch` in a browser is unchanged.
- **Opening a file never runs it.** `POST /api/memory/open` hands the OS only folders and
  files whose extension is in `OPENABLE_EXTENSIONS` (`apps/api/src/routes/memory.ts`:
  documents, images, audio, video, `html`, office files); anything else — `.app`,
  `.command`, `.sh`, `.exe`, an extensionless file — is `415 unsupported_type` before a
  process starts. The opener is `open` (macOS), `xdg-open` (Linux) or `explorer.exe`
  (Windows), argv only, never `cmd /c`.

- **Who decided is recorded.** Every approval keeps `resolvedBy`: `owner`,
  `device:<deviceId>`, `broker:<runId>`, `telegram:<userId>` or `system` (expired); rows
  decided before this was recorded read `null`.
- **Telegram per person.** The poller honours only the configured `chatId`; while
  `channels.telegram.allowedUserIds` lists anyone, a button or command from another
  `from.id` is ignored with no reply, so in a group only the listed people can decide.

Not covered, and said plainly:

- **An agent with a shell, or a provider sandbox that reads the whole disk, reads whatever its operating-system user can.** The filter confines what *MordomoOS* serves and where it starts an agent; it cannot confine a program the agent runs (`cat ~/.mordomo/config/token` works from a shell in any working directory). A run starts in `<home>/workspace`, outside `config/`, which is the part this repository enforces (the working directory and the `--add-dir` folders it passes are tested; `AgentRun.readDirs` holds the skill's own folder and, for a memory skill, `memory/`). What Claude's own file tools then do with a path outside those folders in a headless `read_only` run is behaviour of that program, measured only in part (see the next item); the same holds for the Codex sandbox beyond what its flag documents. Codex's `--sandbox read-only` limits writes, not reads, and Cursor has no sandbox, so a run there reads the token. **A paired device cannot start a run on either** (`readConfinement`, *What a device may start*); the owner still can, from the desktop, and any write run whose shell command the owner approves reads what the user reads. What this feature left in the open: the Claude `workdir` claim is a partial measurement; the owner token is still on disk and on the page for a program of this user; `rc_` (a memory run's credential) is per run and not per device, which holds because a device that starts a run holds `run`, which includes `content`, so the run reads what the device could read; `rc_` and `brk_` are in the environment of the process they were handed to (`/proc/<pid>/environ`, `ps eww`) for the same user; and a device that holds `approve` can approve an approval raised before `requestedBy` existed.
- **Claude's `readConfinement: "workdir"` is a partial measurement, not a proof.** The independent verifier ran Claude Code 2.1.296 in default permission mode, headless (`-p --permission-mode default`, the signals the adapter's `read_only` uses), with a working folder holding a symlink to a folder outside it: 22 ways of reading a file outside the working folder were denied before they ran (`Read` and `Read` through the symlink, `cat`, `head`, `tail`, `grep -r`, `ls`, `sed`, `awk`, `base64`, `strings`, `find -exec`, `cat < file`, `$(< file)`, `cd` outside, `/proc/self/root/...`, `git diff --no-index`, `./../` and `../wd/../` paths), and `python3 -c` and `bash -c` asked for a permission that a run without a terminal denies. What is **not** measured: the repository's adapter end to end, other versions and models of Claude Code, the broker mode that carries write runs (`--permission-prompt-tool` sends the request to a person instead of denying it, which is why a device's tool request is shown whole and approved only by someone who read it), and Codex and Cursor (declared `none`: a device cannot start a run on them). The evidence favours keeping `workdir`, and the decision is the owner's: the safest choice is to declare Claude's `readConfinement` as `"none"` in `adapters/claude/src/manifest.ts`, which stops every paired device from starting a run until the adapter itself is measured.
- **A reverse proxy on this machine that rewrites `Host` and adds no forwarding header** looks like the owner's browser and is handed the page with the owner's token (see *Remote access needs TLS or a tunnel*). The service withholds the token only from a request that names a proxy.
- **A hard link outside the places we can name.** A second name for a private file is recognised by its inode, so a hard link to `config/token` or to a file under `logs/` is refused wherever it lies; what is not recognised is a second name for a file the engine does not keep under `config/` or `logs/`, and Windows, where inode numbers are not reliable.
- **Windows.** There is no `O_NOFOLLOW` (the real-path checks still apply, the descriptor re-check on a changed path is weaker), POSIX modes and `chmod` do nothing, and file ACLs are not set; the case and trailing-dot rules are simulated in tests, not run on Windows.
- **The owner lock never has two owners.** `config/run/engine.lock` records `pid`, `startedAt`, a `token` and the start identity of its process (`procStart`: boot id and start ticks on Linux, `ps` start time on macOS, creation time on Windows), so a pid the system gave to another program after the owner died is not mistaken for the owner. The lock is taken inside `BEGIN IMMEDIATE` on the home's own database, so two processes taking over a stale lock are serialised by SQLite (which releases it if one dies) and only one succeeds. When it cannot be proved stale (an older lock without `procStart`, or a platform that will not say when the pid started) it is held. A release removes the file only if it carries the engine's own `token`. Limits: the mutual exclusion holds between processes of this version that open the same database file (a previous binary still alive uses the old protocol and does not take part), and two processes in different PID namespaces (containers sharing the home) do not recognise each other's pids, so a lock they cannot disprove stays held, the safe side. The start identity is read from procfs, `/bin/ps` or `/usr/bin/ps`, or the Windows PowerShell by absolute path, never through `PATH`.
- **Writes the engine does to its own fixed files.** The files the engine writes by a name it chose (settings, token, keys, pid and lock files, the log files, the sync manifest and backups) are written raw, in folders that are `0700` on POSIX; every write into a folder an agent can also write to goes through the primitive (see T15) or, for the JSON stores, through `atomicWrite`'s exclusive random-named temporary file. `chmod` of a fixed file (`tightenMode`) opens it without following a link.
- **Fixed files the engine reads itself** (its settings, token, VAPID and TLS files, lock and pid files, the sync manifest) are read raw, by fixed name, outside the primitive; so are directory listings that return names only (the index walk, the log and backup folders) and the files an owner-run command points at (`mordomo skills publish`, a `file://` skill registry the owner configured). The reviewed list is in `tests/security-reads.test.ts`.
- **A process running as the owner reading `config/token` from disk** needs an operating-system sandbox, and the device token in the URL of `artifacts/raw` and `skills/:slug/resource` (see *Stream tickets*) stays until a way to serve `<img>`, `<video>` and `Range` without it exists.

## Security profiles

Profiles are the run-level write policy (`core/src/security/profiles.ts`,
`writeDecision()`), applied by the API before a run is created and by the scheduler
before a routine fires:

| Profile | Meaning |
|---|---|
| `read_only` | write runs are refused; agents run in each provider's read-only mode |
| `review_before_write` | interactive write runs are not started: a `write_run` approval is created (`202 waiting_approval`) and the run launches when a human approves it in Settings › Security |
| `controlled_write` | interactive write runs apply immediately on a provider that confines writes (Claude broker, Codex sandbox); on one that does not (Cursor) they are parked for approval; routines cannot write |
| `approved_automation` | routines may also run with write access, unattended |

Read-only enforcement is only as strong as the provider CLI: Claude (permission rules)
and Codex (`--sandbox read-only`, refused if the flag is missing) are enforced
mechanically; **Cursor is prompt-level only** and should not be trusted for
`read_only` work on files you cannot afford to have touched. The engine applies what
each manifest declares (`core/src/agents/registry.ts`):

- **Unattended read-only needs `enforcesReadOnly`.** A `read_only` run started by a
  routine or by sentinel triage on a provider that cannot enforce it ends `failed`
  before the CLI starts. A manual one runs, with a `permission` event in its trace
  saying read-only is only requested in the prompt.
- **An unconfined write needs a human.** Each manifest declares `writeConfinement`:
  `broker` (Claude: every non-edit tool asks), `sandbox` (Codex: writes stay in the
  working directory) or `none` (Cursor `--force`). Under `controlled_write`, a write on
  a `none` provider is parked as a `write_run` approval, as under `review_before_write`;
  only `approved_automation` lets it through.
- **Provider processes do not inherit MordomoOS's secrets.** Every variable whose
  name starts with `MORDOMO_`, and the one named by
  `settings.channels.telegram.botTokenEnv`, is removed from the environment of a
  provider process, including the short probes (`--version`, `--help`,
  `auth status`); everything else (PATH, HOME, the provider's own API keys,
  proxies) passes through.
- **The CLI follows the same policy.** `mordomo run` starts the skill through
  `engine.execution.startSkill`, which passes a write skill through the engine's `gateWrite`: refused under `read_only` (exit 1), parked as a
  `write_run` approval when the profile or the provider asks for one (exit 0,
  `waiting_approval`), run only when the policy allows it.

## Approval-gated actions (never silent)

Exposing the server beyond `127.0.0.1` (`expose_port`), enabling connector writes
(`connector_write`) and write-mode runs under `review_before_write`, or on a provider
without write confinement under `controlled_write` (`write_run`)
create pending approvals in the UI/CLI today. Startup-service
installation is confirmed interactively by the CLI before anything is written. The
remaining `ApprovalKind`s — installing software, changing global configs, destructive
commands, sending data to external services — are declared for connectors and the
agent contract but are not yet raised by any code path. **Adding an indexed folder is
validated (absolute, existing directory, outside `config/`) but not approval-gated.**

## Notes and the index worker

- **Writing a note is the owner's.** `POST /api/memory/notes` and `PUT /api/memory/notes` are `owner` routes
  (a device gets `403 owner_only`, a run credential `403`): writing content is the one thing a lost phone would
  make permanent. Reading a note for editing (`GET /api/memory/note`) is `content`.
- **Every byte goes through the safe primitives.** A note is read with `openWorkspaceFile` and written with
  `writeWorkspaceFile`: `create` for a new one (never over what exists), and for a save a `replace` guarded by
  `expectSha256`, checked on the very descriptor the file was opened through and again before the swap, so a file
  that changed is `409 edit_conflict` with its bytes and mtime untouched. The new text is written to a temporary
  file beside the note, flushed to the disk and renamed over it: a write that fails halfway (disk full, power) leaves
  the old text whole. An editor that saves by renaming its own file over the note while the engine's temporary file is
  being written is `409 edit_conflict` too (its text stays). Where a rename cannot be done (the folder is read-only for
  the user, the note is a bind-mounted file, another device: `EACCES`, `EPERM`, `EBUSY`, `EXDEV`) the note is
  rewritten in place after the same checks (digest, name, link, hard link), and put back if that write fails
  halfway. The temporary file is `.mordomo-save-<32 hex>.tmp`, never removed unless this save created it; one left by
  a process that died is deleted by the next full index pass once it is an hour old (own name, regular file, owned by
  the user). A link on the way, a hard link of a private file, a path
  outside `memory/`, `ROUTER.md`, `areas/` and `journal/` are refused (`403 forbidden_path`, `403
  note_not_editable`).
- **Limit: two processes saving one note at the same instant.** The digest check is made by one process on
  its own descriptor; between processes nothing orders the check and the swap, and there is no lock file. When two
  processes (the service and `mordomo note save`, which runs in the CLI's own process, or two CLIs) save the same
  note with the same `baseVersion` at the same instant, **more than one can be answered success** and the last
  rename wins: one of the two texts is lost, and the loser was told it was saved. Measured with six processes: more
  than one success in 7 of 40 rounds and in 27 of 80, never a round without a winner, and no torn file (each rename is
  whole). Inside one process it is exact (twelve parallel saves: one `200`, eleven `409`). A person editing in the
  Command Centre while an agent saves through the CLI is the case to keep in mind; the guard stays what it is for an
  editor that saves in between by itself (`409 edit_conflict`).
- **The worker is not the engine.** The index worker thread opens its own connection to the database and runs
  the indexer; its imports reach no engine, no owner lock, no restore lock and no migrations (a test walks the
  graph). It applies the same filter and reads through the same safe reader as the pass in the service's
  thread. The host holds the shared restore lock for it, so a restore cannot replace the database under a
  pass, and no pass starts under a restore.
- **Limits.** The worker's heap is capped (512 MB old generation); one that runs past it dies alone
  (`index_worker_out_of_memory`) and the previous index stays. It reads a block of files with no lock, writes it in one short transaction and rests several times as long as that
  transaction held the database's write lock (the service writes to the same file, and waits for the lock with its
  loop stopped), and a cancel is read between blocks (a worker that does not reach its next block is stopped after five seconds).

- **Semantic search sends nothing unless the owner turns it on and names an endpoint.** `memory.embeddings`
  is off by default and reads off when it cannot be read (`SETTINGS_FAIL_CLOSED`). The `hash` provider never
  leaves the process. The `http` provider sends text only to a loopback address, or over `https` with
  `sendRemote` on, never to an address with a credential in it, with no redirects, a 30 s timeout and an 8 MB cap
  on the answer. **What it sends**: the text of every indexed `.md` and `.txt` file (the owner's folders too, not
  only notes), and **the question of each search** in mode `auto` or `semantic` once a vector exists (the screen, the
  CLI, MCP and paired devices alike); `mode=text` and a search with embeddings off send nothing. The API key is read
  from the environment, never stored; `apiKeyEnv` names the variable and its value goes to the endpoint on every
  request, so the name is held to capital letters, digits and `_`, and never `MORDOMO_*` (the service's own); an
  owner who names the variable of another credential sends that credential there (the setting is the owner's). A paired device cannot change these
  settings (`PUT /api/settings` is an owner route). The destination is in `legal/network-policy.json` and
  `legal/PRIVACY.md`. The `sqlite-vec` extension is a native library loaded only when the search is on; it is
  MIT OR Apache-2.0 and is pinned exactly in `core/package.json`.

## Logging rules

- Structured JSONL under `logs/`: `runs.jsonl` (run lifecycle), `scheduler.jsonl`,
  `api.jsonl` (one line per request: method, URL, status, duration, request id —
  never bodies) — all rotated by size and pruned by `limits.logRetentionDays`;
  `service.out.log` keeps one rotated generation.
- Run events in the DB are pruned by the same retention (older than
  `logRetentionDays`; per run, the first 500 and a tail are kept).
- Redaction pass on every persisted line; `.env` contents are never read, therefore
  never logged.
- Diagnostics export bundles logs *after* redaction and lists what it contains.
- Log files and the DB are `0600` inside `0700` folders on POSIX (see T13); `artifacts/` keeps the process umask.
