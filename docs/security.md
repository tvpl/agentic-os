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
| T1 | Remote origin drives the local API (DNS rebinding, malicious web page) | Bind `127.0.0.1` only; `Host` header parsed with `new URL` and restricted to `127.0.0.1`, `localhost`, `[::1]` (IPv6 works, a *missing* Host is refused); security headers + CSP (`default-src 'self'`, `frame-ancestors 'none'`); every `/api/*` route requires a credential (see *Authentication* below) via the `x-mordomo-token` header (or `?token=` on the four stream/file `GET`s only, redacted from logs), compared with `crypto.timingSafeEqual`. The token is generated at setup, stored in `config/` (0600) and injected only into the same-origin page served to a loopback socket, so it doubles as CSRF protection. There is **no CORS layer**: no CORS headers are sent, so the browser's same-origin policy is what stops a foreign page from reading responses, and the token stops it from writing. Changing `bindAddress` is approval-gated; with remote access on (`settings.remote`), the Host allowlist also accepts the hosts the owner listed, and remote devices authenticate with their own paired token, never the page's (`apps/api/src/server.ts`, `apps/api/src/routes/devices.ts`). |
| T2 | Command injection via prompts/paths | argv arrays only, `shell: false`, no `eval`; executable allowlist **by basename**: `node` plus the `binary` of every registered provider manifest (on Windows without `.exe`/`.cmd`/`.bat`), set by the engine whenever it builds the adapters, plus an optional pinned absolute `binaryPath` per provider, which `PUT /api/settings` only accepts when its basename is that manifest's `binary` (`400 binary_mismatch`) — the basename check does not prove *which* binary runs, it only rules out arbitrary executables (`core/src/spawn/safeSpawn.ts`); prompts go to Claude over stdin and to Cursor/Codex as an argv element (visible in `ps`), prefixed with a space when they begin with `-` so they are never parsed as an option; captured stdout/stderr are capped at 1 MiB each (tail kept); Zod validation on every route with a `400 {error:{code:"validation", issues}}` envelope |
| T3 | Path traversal / symlink escape | every `:id` / `:slug` route parameter is validated against `^[a-z0-9][a-z0-9._-]{0,80}$` with no `..` (`apps/api/src/routes/params.ts`, `core/src/security/ids.ts`) and the file stores re-check that `<dir>/<id>` stays inside `<dir>`; every user-supplied path (preview, open, run `cwd`, skill import `sourceDir`, sync `target`) is realpath-resolved and must sit inside the home or an enabled indexed folder (`resolveInsideRoots`); new `indexedFolders` must be absolute, existing directories and may not overlap `config/`; backup names match `full-…` and restores are staged (see T10) |
| T4 | Secret exfiltration via index/logs | one shared exclusion policy for the indexer, preview and open (`core/src/memory/excludes.ts`): user `excludes` globs, a **hard directory blocklist** the user cannot switch off (`.git`, `.aws`, `.ssh`, `.gnupg`, `.kube`, `.docker`, `node_modules`) and the secret-file basename patterns (`.env*`, `*.pem`, `*.key`, `*.p12`, `id_rsa*`, `id_ed25519*`, `credentials*.json`, `.npmrc`, …), all applied *before* reading; binary files detected by content (NUL byte in the first 8 KiB); redaction of token-shaped strings (`sk-…`, `sk-ant-…`, `ghp_…`, `xox…`, `AKIA…`, JWTs, `Bearer …`, `password=`/`token=` pairs) on every persisted log line, including the API request log; auth detection never prints, copies or stores tokens |
| T5 | Prompt injection inside indexed files | indexed content is never concatenated into MordomoOS system instructions; skill runs receive file *paths*, not inlined untrusted content; previews are rendered as plain text/escaped HTML; UI marks workspace content as data |
| T6 | Destructive agent runs | security profiles (`read_only` default; see below); write modes are explicit per run; `bypassPermissions` / `danger-full-access` are never used; read-only is **mechanically enforced for Claude and Codex only** — the Cursor adapter has no sandbox flag and can only ask for read-only in the prompt (see [architecture.md](architecture.md#adapters)); timeouts, concurrency limit, bounded queue (10 × `maxConcurrentRuns`), cancellation (process-group SIGTERM, SIGKILL after grace) |
| T7 | Clobbering the owner's existing configs | sync compiler: detect → backup (`config/backups/`) → diff → approval on material conflict; generated files tracked in a hash manifest so hand edits are detected |
| T8 | Malicious third-party connector | auditor prefers official/maintained sources, performs a basic static safety review before install, requires approval, proves with a read-only call first; write operations per-connector opt-in |
| T9 | Supply chain (npm) | small dependency set, exact-pinned via lockfile; no postinstall scripts of our own; `mordomo doctor` runs `npm audit --audit-level=high` (20 s budget, `MORDOMO_SKIP_NPM_AUDIT=1` to skip) and CI fails on high-severity advisories |
| T10 | DB corruption / bad migration | versioned SQL migrations; timestamped DB backup before each migration; WAL mode; backups copy the DB with SQLite's online backup API (`db.backup()`), so a backup taken while the service runs is consistent; a restore requested through the API is **staged** in `config/restore-pending/` (refused while runs are active) and applied at the next service boot before the DB is opened, after a safety backup; `mordomo restore` on the CLI refuses while the service is running |
| T11 | Orphaned processes after crash | pidfile carries pid, port, start time and a per-boot token so a recycled PID is not mistaken for a live service; graceful shutdown (SIGTERM/SIGINT) cancels active runs and waits up to 10 s before closing the DB, marking them `interrupted`; on boot, runs left `running`/`queued` are marked `interrupted`. Persisted PIDs do not prove process identity after restart: live PIDs are recorded as unverified and are not signalled by `RunManager.recoverInterrupted`. Automatic reaping after a crash requires durable ownership verification and is not currently guaranteed. Live processes owned by the current manager remain cancellable through their handles. |

## Authentication

The rules below hold for every route, present and future (`.specs/STATE.md`, AD-001 and AD-002).

- **Denied by default, decided on the matched route.** The `onRequest` hook in
  `apps/api/src/server.ts` reads the route the router matched (`req.routeOptions.url`),
  never the raw URL: the router decodes the path, so `/%61pi/settings` is `/api/settings`
  and needs a credential like any other spelling. A route is reachable without one only
  when it declares `config: { public: true }` — today `GET /api/meta` and
  `POST /api/pair/claim`. The SPA fallback answers `GET`/`HEAD` only.
- **Three credentials, three principals.** The local token is the `owner`; a paired device
  token (only while `remote.enabled`) is a `device`; a permission-broker credential is a
  `broker` bound to one run. The hook records which one called in `req.principal`.
- **Owner-only routes.** A route marked `config: { scope: "owner" }` refuses a device with
  `403 owner_only` before its handler runs, so a lost phone cannot take over the machine:
  `PUT /api/settings`, `PUT /api/providers/default`, `POST /api/providers/:id/detect`,
  `POST /api/system/restart`, `POST /api/system/reap`, `POST /api/backups`,
  `POST /api/backups/:name/restore`, `DELETE /api/backups/restore-pending`,
  `POST /api/sync/apply`, `POST /api/skills/install`, `POST /api/skills/import`,
  `POST /api/connectors`, `PUT`/`DELETE /api/connectors/:id`, `POST /api/pair/start`,
  `DELETE /api/devices/:id`, `POST /api/memory/open` and `GET /api/diagnostics/export`.
  Everything else (runs, approvals, reading settings) stays open to a paired device.
- **No token in the URL, except where a header is impossible.** `?token=` is accepted only
  on `GET` of the routes marked `config: { queryToken: true }`: `/api/events`,
  `/api/runs/:id/stream` (EventSource), `/api/artifacts/raw` and
  `/api/skills/:slug/resource` (`<img>`/`<iframe>`). Anywhere else under `/api` (the public
  `/api/meta` and `/api/pair/claim` included), or on another method, it is
  `401 unauthorized` even next to a valid header.
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
- **The page only carries the token to this machine.** `GET /` injects the local token
  into `<meta name="mordomo-token">` only when both the TCP peer (`req.socket.remoteAddress`)
  and the `Host` header are loopback; a forged `Host: localhost` from the network gets an
  empty meta and pairs instead.
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

Not covered: a one-time ticket for SSE instead of `?token=` (needed once access leaves
the local network), and fine-grained scopes per resource. A process running as the owner
can still read `config/token` from disk; that needs an OS sandbox and is outside this
model.

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
- **The CLI follows the same policy.** `mordomo run` passes a write skill through
  the engine's `gateWrite`: refused under `read_only` (exit 1), parked as a
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
- Files under `logs/`, `artifacts/` and the DB inherit the process umask.
