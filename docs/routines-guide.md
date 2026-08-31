# Creating routines

A routine is a JSON file in `routines/<id>.json` — a prompt or skill your agent
runs on a schedule. The UI (Routines → New routine) writes these files for you.

## Reference

```jsonc
{
  "id": "daily-workspace-digest",       // slug, file name
  "name": "Daily workspace digest",
  "skillSlug": "workspace-digest",      // OR use "prompt" for a free prompt
  "prompt": null,
  "inputs": { "focus": "Projetos" },    // skill inputs for each firing
  "schedule": "30 7 * * 1-5",           // 5-field cron
  "timezone": "America/Sao_Paulo",
  "provider": "claude",
  "model": null,                        // null = provider default
  "effort": "low",
  "workingDir": null,                   // null = MordomoOS home
  "missedPolicy": "run_on_boot",        // or "skip"
  "timeoutMs": 600000,
  "maxAttempts": 2,                     // retries with linear backoff
  "backoffMs": 120000,
  "notify": true,
  "profile": "read_only",               // security profile for the run
  "enabled": false                      // routines start paused
}
```

## Behaviour

- The internal scheduler (croner) runs inside the MordomoOS service; enabled
  routines fire while `mordomo start` is up. `mordomo service install` keeps
  the service alive at login (approval-gated; systemd --user / launchd / Task
  Scheduler units are generated and shown before anything is installed).
- **Missed runs**: with `run_on_boot`, a schedule missed while the machine was
  off fires once when the service starts (recorded as `caught_up` in history);
  with `skip`, it is skipped.
- **Retries**: a failed firing retries up to `maxAttempts` with
  `backoffMs × attempt` waits.
- Every firing creates a normal run (origin `routine`) — full event log,
  artifacts in `artifacts/<runId>/`, cancellation, timeout.
- **Health**: 2+ failures in 3 days marks the routine unhealthy on the
  Dashboard and in `mordomo doctor`.

## Testing and operating

- **Test now** in the UI (or `POST /api/routines/<id>/run`) fires immediately
  without touching the schedule.
- Pause/enable is one click; **Duplicate** clones as disabled; **History**
  lists every firing with a link to its run.
- Prove the boot behaviour: enable a routine with `run_on_boot`, stop the
  service over a scheduled slot, `mordomo start`, then check History for the
  `caught_up` entry.

## Good defaults

Start `read_only` with artifacts as the output; only move to a write profile
once you trust the routine. Use the skill form (not free prompts) for anything
recurring — skills carry guardrails and success criteria into every firing.
