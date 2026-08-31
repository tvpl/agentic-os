# Backup, restore & uninstall

## What a backup contains

`mordomo backup` copies into `config/backups/full-<timestamp>/`:

- `skills/`, `memory/`, `routines/`, `connectors/` (your canonical content)
- `config/settings.json`, `config/sync-manifest.json`
- `config/db/mordomo.db` (runs, events, memory index, history, approvals)

Artifacts and logs are excluded by default (`--include-artifacts` adds
artifacts). Backups are plain directories — restorable by hand with `cp -r`.

```bash
mordomo backup                  # create
mordomo backup --list           # list
mordomo restore full-2026-…     # restore (service must be stopped)
```

`restore` always creates a **safety backup of the current state first**, so a
restore can itself be undone. Restart the service after restoring.

Automatic backups also happen before: DB migrations, sync-compiler overwrites
of existing files, and restores.

## Moving the installation

All state lives under the MordomoOS home (the repo by default). To move it:
copy the folder (or just the data dirs) and set `MORDOMO_HOME=/new/path`
before `mordomo start`. The Settings screen documents this under
*Data directory*.

## Uninstall

```bash
mordomo uninstall
```

Default behaviour — **data preserved**:

1. Stops the running service.
2. If a startup service is installed, prints the exact removal commands
   (systemd --user / launchd / Task Scheduler).
3. Leaves `skills/`, `memory/`, `routines/`, `connectors/`, `config/`,
   `artifacts/`, `logs/` untouched and tells you so.

Full removal — explicit and double-confirmed:

```bash
mordomo uninstall --purge    # deletes config/, logs/, artifacts/ (asks first)
```

Even `--purge` keeps `skills/`, `memory/`, `routines/`, `connectors/` — those
are your files. To remove everything, delete the repository folder afterwards.
Your indexed workspace folders are never touched by any of this.
