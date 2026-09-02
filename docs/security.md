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
| T1 | Remote origin drives the local API (DNS rebinding, malicious web page) | Bind `127.0.0.1` only; `Host` header parsed with `new URL` and restricted to `127.0.0.1`, `localhost`, `[::1]` (IPv6 works, a *missing* Host is refused); security headers + CSP (`default-src 'self'`, `frame-ancestors 'none'`); every `/api/*` route except `/api/meta` requires the local token via the `x-mordomo-token` header (or `?token=` for SSE, redacted from logs), compared with `crypto.timingSafeEqual`. The token is generated at setup, stored in `config/` (0600) and injected only into the same-origin page, so it doubles as CSRF protection. There is **no CORS layer**: no CORS headers are sent, so the browser's same-origin policy is what stops a foreign page from reading responses, and the token stops it from writing. Changing `bindAddress` is approval-gated, but the Host allowlist stays loopback-only, so a non-loopback bind is not a supported way to expose the panel (`apps/api/src/server.ts`). |
| T2 | Command injection via prompts/paths | argv arrays only, `shell: false`, no `eval`; executable allowlist **by basename** (`claude`, `cursor-agent`, `codex`, `node`) plus an optional pinned absolute `binaryPath` per provider — the basename check does not prove *which* binary runs, it only rules out arbitrary executables (`core/src/spawn/safeSpawn.ts`); prompts go to Claude over stdin and to Cursor/Codex as an argv element (visible in `ps`); captured stdout/stderr are capped at 1 MiB each (tail kept); Zod validation on every route with a `400 {error:{code:"validation", issues}}` envelope |
| T3 | Path traversal / symlink escape | every `:id` / `:slug` route parameter is validated against `^[a-z0-9][a-z0-9._-]{0,80}$` with no `..` (`apps/api/src/routes/params.ts`, `core/src/security/ids.ts`) and the file stores re-check that `<dir>/<id>` stays inside `<dir>`; every user-supplied path (preview, open, run `cwd`, skill import `sourceDir`, sync `target`) is realpath-resolved and must sit inside the home or an enabled indexed folder (`resolveInsideRoots`); new `indexedFolders` must be absolute, existing directories and may not overlap `config/`; backup names match `full-…` and restores are staged (see T10) |
| T4 | Secret exfiltration via index/logs | one shared exclusion policy for the indexer, preview and open (`core/src/memory/excludes.ts`): user `excludes` globs, a **hard directory blocklist** the user cannot switch off (`.git`, `.aws`, `.ssh`, `.gnupg`, `.kube`, `.docker`, `node_modules`) and the secret-file basename patterns (`.env*`, `*.pem`, `*.key`, `*.p12`, `id_rsa*`, `id_ed25519*`, `credentials*.json`, `.npmrc`, …), all applied *before* reading; binary files detected by content (NUL byte in the first 8 KiB); redaction of token-shaped strings (`sk-…`, `sk-ant-…`, `ghp_…`, `xox…`, `AKIA…`, JWTs, `Bearer …`, `password=`/`token=` pairs) on every persisted log line, including the API request log; auth detection never prints, copies or stores tokens |
| T5 | Prompt injection inside indexed files | indexed content is never concatenated into MordomoOS system instructions; skill runs receive file *paths*, not inlined untrusted content; previews are rendered as plain text/escaped HTML; UI marks workspace content as data |
| T6 | Destructive agent runs | security profiles (`read_only` default; see below); write modes are explicit per run; `bypassPermissions` / `danger-full-access` are never used; read-only is **mechanically enforced for Claude and Codex only** — the Cursor adapter has no sandbox flag and can only ask for read-only in the prompt (see [architecture.md](architecture.md#adapters)); timeouts, concurrency limit, bounded queue (10 × `maxConcurrentRuns`), cancellation (process-group SIGTERM, SIGKILL after grace) |
| T7 | Clobbering the owner's existing configs | sync compiler: detect → backup (`config/backups/`) → diff → approval on material conflict; generated files tracked in a hash manifest so hand edits are detected |
| T8 | Malicious third-party connector | auditor prefers official/maintained sources, performs a basic static safety review before install, requires approval, proves with a read-only call first; write operations per-connector opt-in |
| T9 | Supply chain (npm) | small dependency set, exact-pinned via lockfile; no postinstall scripts of our own; `mordomo doctor` runs `npm audit --audit-level=high` (20 s budget, `MORDOMO_SKIP_NPM_AUDIT=1` to skip) and CI fails on high-severity advisories |
| T10 | DB corruption / bad migration | versioned SQL migrations; timestamped DB backup before each migration; WAL mode; backups copy the DB with SQLite's online backup API (`db.backup()`), so a backup taken while the service runs is consistent; a restore requested through the API is **staged** in `config/restore-pending/` (refused while runs are active) and applied at the next service boot before the DB is opened, after a safety backup; `mordomo restore` on the CLI refuses while the service is running |
| T11 | Orphaned processes after crash | pidfile carries pid, port, start time and a per-boot token so a recycled PID is not mistaken for a live service; graceful shutdown (SIGTERM/SIGINT) cancels active runs and waits up to 10 s before closing the DB, marking them `interrupted`; on boot, runs left `running`/`queued` are marked `interrupted` and, when the recorded pid still points at a live provider process, its process group is sent SIGTERM (`RunManager.recoverInterrupted`). Processes whose pid was never recorded are not reaped. |

## Security profiles

Profiles are the run-level write policy (`core/src/security/profiles.ts`). They are
being wired into the run pipeline together with the provider registry (see
[adapters-guide.md](adapters-guide.md)):

| Profile | Meaning |
|---|---|
| `read_only` | write runs are refused; agents run in each provider's read-only mode |
| `review_before_write` | write runs wait for a human approval before their changes are applied |
| `controlled_write` | interactive write runs apply immediately (constrained to the working dir); routines cannot write |
| `approved_automation` | routines may also run with write access, unattended |

Read-only enforcement is only as strong as the provider CLI: Claude (permission rules)
and Codex (`--sandbox read-only`, refused if the flag is missing) are enforced
mechanically; **Cursor is prompt-level only** and should not be trusted for
`read_only` work on files you cannot afford to have touched.

## Approval-gated actions (never silent)

Exposing the server beyond `127.0.0.1` (`expose_port`) and enabling connector writes
(`connector_write`) create pending approvals in the UI/CLI today. Startup-service
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
