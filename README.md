# MordomoOS

**A local, vendor-neutral agentic operating system** — one unified layer over
**Claude Code**, **Cursor Agent** and **OpenAI Codex CLI**, implementing the
ARMS framework: **A**pplications, **R**outines, **M**emory, **S**kills, with a
premium local **Command Centre** and a **Visual Second Brain** on top.

Everything runs on your machine, bound to `127.0.0.1`. The source of truth is
files + SQLite — never the UI. Providers are replaceable adapters over the same
skills catalog, memory index, routines, artifacts and logs.

The **Command Centre** is the local web app, in two interfaces that you switch in Settings › Theme › Interface (the
choice is saved in `config/ui-preferences.json`):

- the **app frame**: a sidebar (Today, Runs, Skills, Routines, Memory; Connectors, Artifacts, Generations and
  Pixel Studio under "More"; Settings), a list-and-detail page for each, and the chat with the agent fixed on the
  right. New installs start here;
- the **Núcleo**: an immersive shell where each place fills the screen as a scene (the core, the brain, runs,
  skills, routines; keys `1`–`5`) around a living core and a single voice line to the agent.

Both show the same data and answer the same keys: the command palette (Ctrl/⌘ K) and the shortcut list (`?`). The
**Second Brain** renders the whole ARMS universe — SKILLS, MEMORY areas with their files, ROUTINES and
APPLICATIONS — as a searchable, safe-to-preview map, and as a constellation in the Núcleo. **Pixel Studio** is a
built-in micro-app to draw and animate pixel art, export PNG/sprite-sheet/SVG or save into artifacts; it loads
only when you open it.

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

| Command                                         | What it does                                                                                                                                                                                                                       |
| ----------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `mordomo setup`                                 | Guided configuration: detects providers (with `--help` capability probing), auth (never printing tokens), folders, exclusions, identity, optional autostart (approval-gated), read-only smoke tests, final diagnostic. Idempotent. |
| `mordomo doctor`                                | Full diagnostic: providers, auth, DB, index, routers, routines health, security posture.                                                                                                                                           |
| `mordomo start` / `stop` / `status`             | Manage the local service + Command Centre.                                                                                                                                                                                         |
| `mordomo launch` / `restart`                    | `launch` starts the service if needed and opens the browser (what the packaged app runs); `restart` reloads the current build, also under the login service.                                                                       |
| `mordomo index`                                 | Re-index the workspace and regenerate memory routers.                                                                                                                                                                              |
| `mordomo sync [dir] --apply`                    | Compile canonical skills/routers into `CLAUDE.md`, `AGENTS.md`, `.claude/`, `.cursor/`, `.agents/` (backup + diff + per-file conflict approval).                                                                                   |
| `mordomo run <skill>`                           | Run a skill headlessly from the terminal.                                                                                                                                                                                          |
| `mordomo backup` / `restore <name>`             | Backup/restore settings, DB, skills, memory, routines, connectors.                                                                                                                                                                 |
| `mordomo service install`                       | Optional startup service (systemd --user / launchd / Task Scheduler) — always asks first.                                                                                                                                          |
| `mordomo recall "<question>"`                   | Layered memory retrieval: only the sections worth reading, offline (`--json`).                                                                                                                                                     |
| `mordomo note new "<title>"`                    | Create a Markdown note under `memory/notes`; `note show <path>` prints it and `note save <path> --base <version>` replaces it (refused with `edit_conflict` if it changed since that version).                                     |
| `mordomo mcp`                                   | Serve MordomoOS as an MCP server (stdio) to Claude, Cursor and Codex.                                                                                                                                                              |
| `mordomo skills publish` / `mordomo skills key` | Publish the canonical skills to a signed registry folder (`publish [dir] --out <dir>`); print this machine's signing public key.                                                                                                   |
| `mordomo uninstall`                             | Stops everything; **data is preserved by default** (`--purge` to remove state).                                                                                                                                                    |

## What's inside

```
contracts/           # @mordomo/contracts: the shapes that cross engine, API and UI
core/                # provider-independent engine (config, db, security, runs,
                     # skills, memory, routines, connectors, sync compiler)
adapters/{claude,cursor,codex}
skills/              # canonical skill catalog (files = source of truth)
memory/              # generated master router + per-area indexes
routines/            # routine definitions (JSON files)
connectors/          # connector registry entries
artifacts/  logs/  config/
apps/api             # Fastify API on 127.0.0.1 + mordomo CLI
apps/command-centre  # React Command Centre: the app frame and the Núcleo (dark/light, EN/pt-BR)
tests/  docs/  scripts/  legal/
```

## Documentation

- [User manual](docs/user-manual.md) — day-to-day usage + the 7-day adoption plan
- [Architecture](docs/architecture.md) · [Security & threat model](docs/security.md)
- [Creating skills](docs/skills-guide.md) · [Creating routines](docs/routines-guide.md) · [Adding adapters](docs/adapters-guide.md) · [Using the engine as a library (SDK)](docs/sdk.md)
- [Installing & building a distributable](docs/install.md) · [Backup, restore & uninstall](docs/backup-restore-uninstall.md)
- [Windows / WSL](docs/windows.md) · [Always-on VPS + Syncthing (optional)](docs/vps-syncthing.md)
- [Product spec](docs/product-spec.md) · [Events](docs/events.md) · [Memory guide](docs/memory-guide.md)
- Project history (analyses, audits and plans written while building it; not product documentation): [docs/internal](docs/internal/README.md)

## Development

```bash
npm run build         # compile the engine, the API and the Command Centre
npm run typecheck     # types of every package, the type tests and the interface
npm run lint          # ESLint, and stylelint over the interface's CSS
npm test              # engine, API and SDK tests (vitest)
npm run test:ui       # the interface's tests (vitest, jsdom)
npm run test:e2e      # browser tests (Playwright) over the built interface
npm run bundle:check  # fails if the interface's JS grew more than 5% over the recorded build
npm run gallery       # the component gallery (every primitive, in both interfaces and both themes)
```

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

MordomoOS is licensed under the **Functional Source License, Version 1.1, ALv2 Future License
(FSL-1.1-ALv2)** — see [LICENSE](LICENSE). The source is visible: you may use, copy, modify and
redistribute it for any purpose except a _Competing Use_ (as the license defines it), and **each version
becomes available under the Apache License 2.0 on the second anniversary of the date it was released**.

- **Drafts.** The legal texts of this repository — the license holder's details in `LICENSE`,
  [CONTRIBUTING.md](CONTRIBUTING.md), [EULA](legal/EULA.md), [privacy policy](legal/PRIVACY.md) and
  [NOTICE](legal/NOTICE.md) — are **drafts for the owner's legal review, not legal advice**; every blank is
  marked `[A PREENCHER PELO DONO: …]`. Do not ship an installer with them before that review.
- **Third-party software.** [THIRD_PARTY_NOTICES.md](legal/THIRD_PARTY_NOTICES.md) lists the npm packages of the
  lockfile's runtime dependency set, with the full text of each license, and the runtime and fonts that do not come
  from npm. That set is a **superset** of what the installer's bundles contain (listing more is the safe side).
  It is generated (`npm run licenses:write`); `npm run licenses:check` rejects a license outside
  [the allowed list](legal/license-policy.json); `npm run sbom` writes a CycloneDX SBOM of the same set.
- **Third-party CLIs.** MordomoOS _orchestrates_ Claude Code, Cursor Agent and OpenAI Codex CLI. It does not
  bundle, redistribute or sublicense them: you install each one yourself, sign in with your own account, and
  each follows its supplier's terms. Product names are trademarks of their owners, cited only to say what
  MordomoOS works with, without endorsement ([EULA §4](legal/EULA.md)).
- **Privacy.** Your data stays on your machine, MordomoOS sends nothing to its licensor's servers, and it has
  **no telemetry**. Every network destination the code knows is listed in the
  [privacy policy](legal/PRIVACY.md) and checked by a test (`npm run network:scan`).
- **Contributing.** Commits carry a `Signed-off-by:` line (DCO): see [CONTRIBUTING.md](CONTRIBUTING.md).
