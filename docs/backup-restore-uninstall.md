# Backup, restore & uninstall

## What a backup contains

`mordomo backup` copies into `config/backups/full-<timestamp>/`:

- `skills/`, `memory/`, `routines/`, `connectors/` (your canonical content)
- `config/settings.json`, `config/ui-preferences.json`, `config/sync-manifest.json`
- `config/db/mordomo.db` (runs, events, memory index, history, approvals)

A backup made before UI preferences moved out (settings version 2) has no `ui-preferences.json`: its theme, layouts, HUD and Second
Brain view still sit inside its `settings.json`. Restoring it removes the live
`ui-preferences.json`, so the next start migrates the backup's own values out of its
`settings.json` (the `settings.json.v1.bak` from the first upgrade is kept as it was).

Artifacts and logs are excluded by default (`--include-artifacts` adds
artifacts). Backups are plain directories — restorable by hand with `cp -r`.

Each backup is **sealed** with `manifest.json` at its root: the SHA-256 and size of every
file in it and the target of every link. `mordomo restore` (and the Restore button) checks
the copies it is about to install against it and refuses a backup that is truncated,
edited, missing a file or carrying one more, naming the files, before anything of yours
is touched. A backup made before backups were sealed has no manifest: it is refused with
`backup_unsealed` unless you restore it from the terminal with `--allow-unverified`.
`mordomo backup --list` marks those `unsealed`.

The number of backups kept is `limits.backupRetention` (default 10, set through
`PUT /api/settings`): a new backup deletes the older **sealed** ones beyond that, oldest by
the time in the backup's name (copying the folder does not change its age). A backup
without a manifest, and the one a staged restore points at, are never deleted.

```bash
mordomo backup                  # create
mordomo backup --list           # list
mordomo restore full-2026-…     # restore (service must be stopped)
mordomo restore full-2026-… --allow-unverified   # an unsealed backup from an older version
```

`restore` always creates a **safety backup of the current state first**, so a
restore can itself be undone. Restart the service after restoring. A restore applies
all of it or none of it: if it fails, every file is put back, and if the process dies in
the middle the next command that opens the home (any `mordomo` command, the service) undoes
it; a backup waits a few seconds for a restore that is still running and is then refused (`409`), and a restore waits
for a backup or for a command that is starting. A backup is never taken half way through a restore: it is all of the
files before the restore or all of them after it. If a `.restore-…` folder in the home cannot be undone by itself (a damaged
`JOURNAL.json`, for instance) it is left as it is and every backup, restore and command is refused with a message that
names it: look inside, move back by hand whatever belongs to the home (`old-N` is the original of the Nth entry),
delete the folder and try again. If `config/run/restore.lock` is reported as unusable, remove it by hand (only when no
MordomoOS process is running).

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
