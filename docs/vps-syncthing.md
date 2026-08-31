# Always-on runner: VPS + Syncthing (optional — skip freely)

> ARMS Routines L2: routines fire 24/7 with your laptop closed. Nothing in this
> guide is installed automatically; every step is yours to run, and the guide
> is safe to skip entirely — MordomoOS is complete without it.

## Architecture

```
your machine                          VPS (always on)
┌──────────────────┐   Syncthing    ┌──────────────────┐
│ mordomo-os repo  │◄──────────────►│ mordomo-os repo  │
│ (skills, memory, │   (bidirect.)  │ MORDOMO_HOME     │
│  routines, cfg)  │                │ mordomo service  │──► routines fire here
└──────────────────┘                └──────────────────┘
```

Skills, routines, routers and settings are plain files, so syncing the folder
gives the VPS agent your full context. Run history DBs are per-machine
(excluded from sync) — each side keeps its own runs.

## Step by step

1. **VPS**: any small instance (1 vCPU / 1–2 GB) with Ubuntu 22.04+. Create a
   non-root user; SSH keys only; enable unattended-upgrades and a firewall
   (ufw: allow SSH only — Syncthing will connect out, no inbound port needed).
2. **Install Node ≥ 20 + git**, clone your mordomo-os repo, `npm install &&
   npm run build`.
3. **Install the provider CLI(s)** you want on the VPS and log in once
   (`claude`, `codex login`, …). Headless login flows print a URL you open
   from your machine.
4. **Syncthing on both sides** (https://syncthing.net — official packages):
   - Add the mordomo-os folder on your machine; share it to the VPS device ID.
   - Accept on the VPS; set the path to the cloned repo.
   - **Ignore patterns** (both sides) — never sync machine state or secrets:
     ```
     node_modules
     dist
     config/db
     config/run
     config/backups
     config/token
     logs
     .env*
     ```
   - **Never expose the Syncthing web UI to the internet.** It binds
     127.0.0.1 by default; administer it through an SSH tunnel
     (`ssh -L 8384:127.0.0.1:8384 vps`).
5. **Run MordomoOS on the VPS**: `mordomo setup --defaults`, enable the
   provider, then `mordomo service install` (systemd --user) and
   `loginctl enable-linger $USER` so it survives logout/reboot.
6. **Enable the routine on the VPS side** (routines sync as files, but the
   `enabled` flag syncs too — if you want it firing only on the VPS, keep two
   routine files, e.g. `daily-digest-vps.json`, and leave the local one
   paused).
7. **Verify**: `mordomo doctor` on the VPS, test-fire the routine, confirm the
   artifact lands in `artifacts/` and syncs back if you chose to sync
   artifacts (add `artifacts` to the ignore list if not).

## Security notes

- The MordomoOS panel on the VPS stays bound to 127.0.0.1; if you ever need it
  remotely, use an SSH tunnel — do not change the bind address.
- Provider credentials live only where you logged in; Syncthing ignores above
  keep tokens and DBs out of sync.
- Treat the VPS as semi-trusted: prefer `read_only` routine profiles there
  until you have reviewed a few runs.
