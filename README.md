# MordomoOS

**A local, vendor-neutral agentic operating system** — one unified layer over
**Claude Code**, **Cursor Agent** and **OpenAI Codex CLI**, implementing the
ARMS framework: **A**pplications, **R**outines, **M**emory, **S**kills, with a
premium local **Command Centre** and a **Visual Second Brain** on top.

Everything runs on your machine, bound to `127.0.0.1`. The source of truth is
files + SQLite — never the UI. Providers are replaceable adapters over the same
skills catalog, memory index, routines, artifacts and logs.

The Command Centre is a fullscreen **OS desktop**, not a web page: a
starfield wallpaper with a glowing particle core built from your real files,
**drag-and-drop widgets** that snap to a grid (layout persisted), an app
launcher (Ctrl/⌘ M), and fullscreen apps with a "Back to the OS" chip. The
**Second Brain** renders the whole ARMS universe as concentric animated rings
— SKILLS sparks, MEMORY area hubs with expandable file nebulas, ROUTINES
clocks and APPLICATIONS hex badges — with Force/Circle/Hex/Rings layouts,
search-as-you-type and safe previews. **Pixel Studio** is a built-in
micro-app to draw and animate pixel art, export PNG/sprite-sheet/SVG or save
into artifacts.

> Guia rápido em português: [`docs/README.pt-BR.md`](docs/README.pt-BR.md)

## Quick start

**Packaged app** (no Node.js, no terminal): download the archive for your
platform, extract it and open **MordomoOS** (`MordomoOS.app`, `MordomoOS` or
`MordomoOS.cmd`). The local service starts and the browser opens the setup
screen, which detects Claude Code, Cursor Agent and Codex on the computer and
tells you how to install or sign in to each one. Data lives in your user
profile. Details and platform notes: [docs/install.md](docs/install.md).

**From source** (Node.js ≥ 22, git):

```bash
git clone <this-repo> mordomo-os && cd mordomo-os
scripts/setup.sh            # installs deps, builds, runs the guided terminal setup
```

or step by step:

```bash
npm install
npm run build
npx mordomo launch          # starts the service and opens the browser (setup happens there)
npx mordomo setup           # …or the guided terminal setup — idempotent, re-run anytime
```

`scripts/mordomo` is a convenience wrapper; add the repo's `scripts/` to your
PATH (or `alias mordomo="npx --prefix /path/to/mordomo-os mordomo"`).
Build your own distributable with `npm run dist` ([how it works](docs/install.md#building-a-distributable)).

## Commands

| Command                             | What it does                                                                                                                                                                                                                       |
| ----------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `mordomo setup`                     | Guided configuration: detects providers (with `--help` capability probing), auth (never printing tokens), folders, exclusions, identity, optional autostart (approval-gated), read-only smoke tests, final diagnostic. Idempotent. |
| `mordomo doctor`                    | Full diagnostic: providers, auth, DB, index, routers, routines health, security posture.                                                                                                                                           |
| `mordomo start` / `stop` / `status` | Manage the local service + Command Centre.                                                                                                                                                                                         |
| `mordomo launch` / `restart`        | `launch` starts the service if needed and opens the browser (what the packaged app runs); `restart` reloads the current build, also under the login service.                                                                       |
| `mordomo index`                     | Re-index the workspace and regenerate memory routers.                                                                                                                                                                              |
| `mordomo sync [dir] --apply`        | Compile canonical skills/routers into `CLAUDE.md`, `AGENTS.md`, `.claude/`, `.cursor/`, `.agents/` (backup + diff + per-file conflict approval).                                                                                   |
| `mordomo run <skill>`               | Run a skill headlessly from the terminal.                                                                                                                                                                                          |
| `mordomo backup` / `restore <name>` | Backup/restore settings, DB, skills, memory, routines, connectors.                                                                                                                                                                 |
| `mordomo service install`           | Optional startup service (systemd --user / launchd / Task Scheduler) — always asks first.                                                                                                                                          |
| `mordomo uninstall`                 | Stops everything; **data is preserved by default** (`--purge` to remove state).                                                                                                                                                    |

## What's inside

```
core/                # provider-independent engine (config, db, security, runs,
                     # skills, memory, routines, connectors, sync compiler)
adapters/{claude,cursor,codex}
skills/              # canonical skill catalog (files = source of truth)
memory/              # generated master router + per-area indexes
routines/            # routine definitions (JSON files)
connectors/          # connector registry entries
artifacts/  logs/  config/
apps/api             # Fastify API on 127.0.0.1 + mordomo CLI
apps/command-centre  # React Command Centre (dark/light, EN/pt-BR)
tests/  docs/  scripts/
```

## Documentation

- [User manual](docs/user-manual.md) — day-to-day usage + the 7-day adoption plan
- [Architecture](docs/architecture.md) · [Security & threat model](docs/security.md)
- [Creating skills](docs/skills-guide.md) · [Creating routines](docs/routines-guide.md) · [Adding adapters](docs/adapters-guide.md)
- [Installing & building a distributable](docs/install.md) · [Backup, restore & uninstall](docs/backup-restore-uninstall.md)
- [Windows / WSL](docs/windows.md) · [Always-on VPS + Syncthing (optional)](docs/vps-syncthing.md)
- [Product spec](docs/product-spec.md) · [Validation report](docs/validation-report.md)
- [Análise: vídeo RoboNuggets/RUBRIC × MordomoOS × open-source (set. 2026)](docs/analysis-2026-09/README.md) · [Audit Sept 2026](docs/audit-2026-09/README.md)

## Security in one paragraph

Server bound to `127.0.0.1` with a local token (CSRF/DNS-rebinding safe), argv-only
process spawning against an executable allowlist, path containment with symlink
resolution, secret-file blocklist and log redaction, read-only run modes enforced
per provider (`--sandbox read-only`, permission rules, no `--force`), and explicit
approval gates for the risky actions that exist today (connector writes, exposing
ports, write-mode runs under `review_before_write`), and security profiles that are
enforced per run (`read_only` → `review_before_write` → `controlled_write` →
`approved_automation`).
Details: [docs/security.md](docs/security.md).

## License

MIT — see [LICENSE](LICENSE).
