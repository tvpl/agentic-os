# MordomoOS — Product Specification

> Phase 2 record. Source: the ARMS guide PDF ("Build your Agentic OS", RoboNuggets, 17 pp.)
> plus the owner's answers of 2026-08-31. This document is the single reference for
> requirements, decisions and acceptance criteria.

## 1. What MordomoOS is

MordomoOS is a **local, vendor-neutral agentic operating system**: a unified layer over
Claude Code, Cursor Agent and OpenAI Codex CLI that implements the ARMS framework —
**A**pplications, **R**outines, **M**emory, **S**kills — with a visual **Command Centre**
and a **Visual Second Brain** on top.

The core is provider-independent. Claude, Cursor and Codex are replaceable **adapters**
over the same database, memory index, skill catalog, routines, artifacts and logs.
Everything binds to `127.0.0.1` only.

## 2. Decisions from the owner (2026-08-31)

| Topic | Decision |
|---|---|
| Name / CLI | **MordomoOS**, command `mordomo` (`mordomo start`, `mordomo doctor`, …) |
| Install dir | The repository clone itself (default), changeable later in the Settings screen |
| Providers | All three implemented; owner has all three installed on their machine |
| Default provider | **Claude Code** |
| Memory areas | Worker, Documentos, Finanças, Projetos (renameable) |
| Seed skills | daily tech/AI news, workspace digest, Claude Code resource cleanup/optimization, agent-usage report, single-file explanatory HTML, SDD coding plan, project harness analysis, code review, brainstorming |
| Seed routine | Daily workspace digest — created **paused**; enabling is one explicit click |
| Connectors focus | Email, Calendar, Playwright + generic auditor; nothing pre-connected |
| Privacy | Standard secret blocking + default exclusions |
| Identity | Default visual identity (dark default + light, accessible electric-blue accent) |
| Autostart | Manual by default (`mordomo start`); autostart opt-in during setup |
| VPS/Syncthing | Architecture prepared + step-by-step guide, skippable; nothing installed |
| Language | UI in English by default with **pt-BR selectable in the menu**; docs in English + PT quick start |

## 3. PDF → implementation matrix

| ARMS requirement (PDF) | MordomoOS implementation |
|---|---|
| **S L1** — repeated task becomes a named command; SKILL.md < 60 lines; guardrails; test a real run | Canonical catalog in `skills/`, UI + CLI creation, size lint, 9 functional seed skills, live run validation |
| **S L2** — skill trees; router SKILL.md; agent reads only the file matching the task | Canonical format `SKILL.md` + `resources/`; thick-skill detector (≥150 lines); assisted split with diff + approval |
| **S L3** — headless buttons; model/effort per run; runs.log | Adapter headless execution; run buttons with provider/model/effort picker; SQLite history + JSONL logs |
| **M L1** — workspace is a folder | Indexed-folder selection in setup; nothing indexed without explicit selection |
| **M L2** — master router + one short index per area; stale pointer rule | Router generator (master + per-area) compiled into CLAUDE.md/AGENTS.md; staleness/broken-link detection in `mordomo doctor` |
| **M L3** — visual second brain: graph, search-as-you-type, preview, copy path, refresh script | Incremental indexer → SQLite FTS5; graph + grid views; filters; safe preview; manual & auto refresh |
| **R L1** — schedule + timezone; missed-run policy; run-once test; one-line log per run | Routine manager with croner engine, catch-up policy, run-now, per-run history and health |
| **R L2/L3** — always-on VPS + Syncthing / full cloud agent | Architecture ready (runner decoupled); step-by-step guide in `docs/vps-syncthing.md`; nothing installed without approval |
| **A L1** — audit; recommend ≤ 3; connect nothing without approval | Read-only connector auditor; never reveals credentials; max-3 ranked recommendations |
| **A L2** — search/vet/install with safety scan; prove with read-only call | Registry with origin/maintainer/auth/permissions/risk/health; approval-gated install flow; read-only proof step |
| **A L3** — micro-apps with real data, no placeholders | Micro-app foundation; every visible feature uses real data or is explicitly marked "not configured" |
| **Command Centre** — one address, survives restart, window-not-store, artifacts one click away, second brain centrepiece, widgets earn their place | React app served by the local API at a fixed `127.0.0.1` port; `mordomo start/stop/status`; reads only from files + SQLite |
| Starter prompts / guardrails / "done when" criteria | Embedded as skill templates; the per-part "you're done when" checks are `mordomo doctor` checks and the validation report |
| 7-day plan & weekly maintenance | `docs/user-manual.md` adoption guide; `doctor` covers weekly maintenance (stale routers, silent routines, thick skills) |

## 4. Architecture

```
agentic-os/
├── core/                    @mordomo/core — config, db, security, runs, skills,
│                            memory, routines, connectors, sync compiler, spawn layer
├── adapters/
│   ├── claude/              @mordomo/adapter-claude   (claude -p, stream-json)
│   ├── cursor/              @mordomo/adapter-cursor   (cursor-agent -p)
│   └── codex/               @mordomo/adapter-codex    (codex exec --json)
├── skills/                  CANONICAL skill catalog (source of truth, files)
├── memory/                  routers + area indexes (generated, files)
├── routines/                routine definitions (source of truth, JSON files)
├── connectors/              connector registry entries (JSON files)
├── artifacts/               run outputs (files)
├── logs/                    rotating JSONL run/event logs
├── config/                  settings.json, db/, backups/, run/ (pid)
├── apps/
│   ├── api/                 @mordomo/api — Fastify on 127.0.0.1 + serves UI
│   └── command-centre/      @mordomo/command-centre — React + Vite
├── scripts/                 setup.sh, setup.ps1, helper scripts
├── tests/                   cross-package integration + e2e (incl. fake CLIs)
└── docs/                    this spec, architecture, security, guides
```

**Source of truth is files + SQLite, never the UI.** Skills, routines, routers,
connectors and settings are readable/editable files. SQLite (`config/db/mordomo.db`)
holds state: run history, events, memory index/FTS, routine history, metrics.

### Key technical decisions

1. **Stack**: TypeScript strict, Node ≥ 20, npm workspaces, Fastify 5 + Zod,
   better-sqlite3 (WAL + FTS5), React 18 + Vite, Vitest, Playwright (visual e2e).
2. **Config compiler, not symlinks**: native files (CLAUDE.md, `.claude/skills/`,
   AGENTS.md, `.cursor/rules/*.mdc`, `.cursor/commands/*.md`, `.agents/skills/`) are
   generated from the canonical source with a **manifest of content hashes**. Before
   writing: detect existing file → back up → diff → require approval on material
   conflict (file exists and was not generated by us, or was hand-edited since).
   Portable to Windows; no symlink reliability issues.
3. **Scheduler**: internal croner-based engine inside the API service (default,
   documented fallback) + generated OS units (`systemd --user`, `launchd`,
   Task Scheduler) that keep the service alive so routines fire without the UI open.
   Installing an OS unit is approval-gated.
4. **Process execution**: `child_process.spawn` with argv arrays only, executable
   allowlist, cwd containment, timeouts, kill-tree cancellation. No shell strings,
   no `eval`.
5. **Effort mapping is per-adapter capability**: Codex → `model_reasoning_effort`;
   Claude → thinking-token budget env; Cursor → unsupported (declared). Flags are
   confirmed against the installed CLI via `--help` probing at setup/doctor time.
6. **Search first, embeddings later**: deterministic FTS5 is the required baseline;
   embeddings are optional and never required for basic operation.

### Security profiles

`read_only` → `review_before_write` → `controlled_write` → `approved_automation`.
Approval is required for: installing software, changing global configs, destructive
commands, accessing new folders, enabling connector writes, creating startup services,
exposing ports, sending data to external services. Full threat model:
`docs/security.md`.

## 5. Acceptance criteria (contract for "done")

- Setup lets me choose Claude, Cursor and/or Codex; the choice is changeable later.
- At least one real flow validated per provider enabled **in the environment at hand**
  (in the build container only `claude` exists; cursor/codex adapters are validated
  against faithful fake CLIs and their absence-handling is validated for real).
- Skills come from one canonical source and export to all three environments.
- Routers + search find a real file; the Second Brain works on real data.
- A skill starts from a button; a routine can be test-run and audited.
- Recent artifacts appear in the Command Centre; logs and errors are understandable.
- No secrets in logs; server bound to 127.0.0.1 by default; setup is idempotent;
  backups precede changes to existing configs; automated tests pass; the UI was
  visually inspected; docs allow a from-scratch install.
