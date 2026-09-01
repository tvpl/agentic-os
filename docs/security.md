# MordomoOS — Security & Threat Model

Security is a product requirement of MordomoOS, not a later phase. This document is the
short threat model plus the concrete controls implemented in code.

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

## Threats and controls

| # | Threat | Controls |
|---|---|---|
| T1 | Remote origin drives the local API (DNS rebinding, malicious web page) | Bind `127.0.0.1` only; strict CORS (same-origin only); `Host` header validation; security headers; state-changing routes require the `x-mordomo-token` header (token generated at setup, stored in `config/`, injected by the served UI — a foreign origin cannot read it), which also serves as CSRF protection |
| T2 | Command injection via prompts/paths | argv arrays only, no shell interpolation, no `eval`; executable allowlist (`claude`, `cursor-agent`, `codex` + resolved absolute paths); Zod validation on every route |
| T3 | Path traversal / symlink escape | every user-supplied path resolved and checked for containment inside granted roots (realpath-based); previews and file reads refuse paths outside indexed roots |
| T4 | Secret exfiltration via index/logs | exclusion list applied *before* reading (`.env*`, keys, `id_rsa*`, `*.pem`, credential stores, private folders); log redaction of token-shaped strings (`sk-…`, `ghp_…`, `xox…`, `AKIA…`, JWTs, `password=`); auth detection never prints, copies or stores tokens |
| T5 | Prompt injection inside indexed files | indexed content is never concatenated into MordomoOS system instructions; skill runs receive file *paths*, not inlined untrusted content; previews are rendered as plain text/escaped HTML; UI marks workspace content as data |
| T6 | Destructive agent runs | security profiles (`read_only` default for smoke tests and audits); write modes are explicit per run; dangerous permission modes are opt-in, clearly labelled, never default; timeouts + concurrency limits + cancellation |
| T7 | Clobbering the owner's existing configs | sync compiler: detect → backup (`config/backups/`) → diff → approval on material conflict; generated files tracked in a hash manifest so hand edits are detected |
| T8 | Malicious third-party connector | auditor prefers official/maintained sources, performs a basic static safety review before install, requires approval, proves with a read-only call first; write operations per-connector opt-in |
| T9 | Supply chain (npm) | small dependency set, exact-pinned via lockfile; no postinstall scripts of our own; `npm audit` in doctor |
| T10 | DB corruption / bad migration | versioned SQL migrations; timestamped DB backup before each migration; WAL mode; `mordomo backup`/`restore` |
| T11 | Orphaned processes after crash | pidfile + process-group kill; on boot, runs left `running` are marked `interrupted` and their processes reaped if still alive |

## Approval-gated actions (never silent)

Installing software · changing global configs · destructive commands · accessing new
folders · enabling connector writes · creating startup services · exposing ports ·
sending data to external services. Each surfaces as a pending approval in the UI/CLI
with an explanation of exactly what will happen.

## Logging rules

- Structured JSONL per run under `logs/`, rotated by size, retention configurable.
- Redaction pass on every persisted line; `.env` contents are never read, therefore
  never logged.
- Diagnostics export bundles logs *after* redaction and lists what it contains.
