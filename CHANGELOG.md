# Changelog

## 0.1.0 — 2026-08-31

Initial release of MordomoOS.

- Vendor-neutral core (TypeScript strict, SQLite/FTS5, versioned migrations
  with automatic pre-migration backups).
- Provider adapters for Claude Code, Cursor Agent and OpenAI Codex CLI:
  detection with `--help` capability probing, credential-free auth checks,
  normalized streaming events, mechanically enforced read-only mode, effort
  mapping per provider capability.
- Skills: canonical catalog with progressive disclosure, thick-skill
  detection, run buttons with per-run provider/model/effort, 9 seed skills.
- Sync compiler: one canonical source exported to CLAUDE.md / AGENTS.md /
  `.claude` / `.cursor` / `.agents` with manifest, backup, diff and per-file
  conflict approval.
- Memory: incremental indexer honoring exclusions, FTS5 search, master +
  per-area routers with staleness detection, Visual Second Brain (graph +
  grid, safe preview, related-file explanations).
- Routines: cron + timezone scheduling, missed-run policy with boot catch-up,
  retries/backoff, manual test runs, per-firing history and health; OS
  startup-service generation (approval-gated); seeded paused daily digest.
- Connectors: registry (MCP/CLI/API/micro-app) with risk metadata,
  credential-free auditor recommending at most 3 additions.
- Command Centre: dashboard (provider switcher, favorites, routines,
  artifacts, failures, metrics), dark/light themes, EN/pt-BR, keyboard
  navigation, 127.0.0.1-only with local-token protection.
- CLI: setup (guided, idempotent), doctor, start/stop/status, index, sync,
  run, backup/restore, service, uninstall (data-preserving by default).
- 70 automated tests + live validation with the real Claude Code CLI.
