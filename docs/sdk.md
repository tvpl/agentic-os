# SDK: `@mordomo/core`

`@mordomo/core` is the MordomoOS engine as a library. A program builds an engine over a home, starts runs, follows
them, cancels them and approves the writes the security profile parks - with the same rules as the app, because the
HTTP API and the CLI are clients of the same `engine.execution`.

Nothing is published yet (the owner decides where and when; see `.specs/STATE.md`). `npm pack -w @mordomo/core` builds
the package; the tests install it into an empty project and run the example below.

## Entry points

| Import                    | What it is                                                                                                                                                         |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `@mordomo/core`           | The public surface of this page: `createEngine`, the types around it, the errors and the provider contract. Documented, and changed only with a version bump.      |
| `@mordomo/core/internal`  | What the MordomoOS app and the adapter packages are made of (stores, readers, the spawn layer, the old barrel). No stability promise: it can change in any release. |
| anything else (`dist/...`) | Not reachable: the package `exports` name the two entry points and nothing more.                                                                                  |

While the version is `0.x`, an incompatible change to the public surface raises the minor number.

## Concepts

- **Engine.** `createEngine({ home, providers })`. It opens (and migrates) the database of one home and changes nothing
  else; `start()` makes the process the owner of the home. Two engines in one process share nothing: events, the
  allowlist of executables, caches and locks are per engine. Two engines on the same home cannot both `start()`.
- **Provider.** A manifest (data: id, binary, capabilities) and an adapter factory (code). The core knows no provider by
  name; the adapters for Claude Code, Cursor Agent and Codex are separate packages in the repository.
- **Run.** One execution of a provider: `queued`, `running`, then `done`, `failed`, `cancelled`, `timed_out` or
  `interrupted`; `waiting_approval` while a human has to decide.
- **`startedBy`.** Who asked, a required field of every call that starts work: `null` is your own program, `"owner"`
  the person at the machine, `"device:<id>"` a paired phone. Rules depend on it (a device only runs on providers whose
  reads stay in the working folder, always has its writes parked, and never approves what it asked for).
- **Home.** The folder with the engine's state: `config/` (settings, database, token), `skills/`, `memory/`,
  `artifacts/`, `logs/` and `workspace/`, the default working directory of a run.

## A first run

The runnable example is in [`core/README.md`](../core/README.md); the tests run it as written.

## API

### `createEngine`

`createEngine(options: EngineOptions): Engine`. Builds an engine over `options.home` (default: `MORDOMO_HOME`, then the
platform's per-user data folder). Throws `RestoreInProgressError` while a restore is replacing the home,
`DbNewerVersionError` for a database written by a newer release, `MigrationError` when a migration fails. It starts no
timer and recovers nothing: call `engine.start()` for that.

### `Engine`

What `createEngine` returns: `home`, `events`, `execution`, `providers`, `settings()`, `updateSettings(patch)`,
`start()`, `stop(timeoutMs?)` and `close()`. `start()` throws `EngineLockedError` when another engine - in this process
or another - owns the home; `stop()` interrupts the runs in progress (they end `interrupted`), waits for them, releases the home and closes the
database; `close()` does the release and the close at once.

### `EngineOptions`

`home`, `providers` (required), `seedDir` (a folder of seed skills, routines and connectors copied into a new home;
`null`, the default, copies none) and `restoreWaitMs` (how long to wait for a restore running in another process,
default 10 000).

### `ReadonlyProviders`

`engine.providers`: `has(id)`, `ids()`, `manifest(id)` and `manifests()` of the registry the engine was built with.

### `EventFeed`

`engine.events`: `subscribe(listener)` (returns the function that stops it), `since(id)` (the events after an id, from
a ring of the last 500) and `lastId`. Every event is `{ id, type, ts, v, payload }`. An engine announces only its own
events.

### `Execution`

`engine.execution`: the door through which runs start, are followed and are approved.

| Method                                           | What it does                                                                                                                                  |
| ------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `startPrompt(input, options?)`                   | Starts a prompt run. See `StartPromptInput`. Returns at once with a `StartedRun`; the provider works in the background.                       |
| `startSkill(input, options?)`                    | Starts a skill from the home's `skills/` folder, with the skill's own rules (enabled, providers it lists, required inputs, daily budget).     |
| `retry(runId, input, options?)`                  | Repeats the complete request retained with a run. Idempotent per `submissionId` and asker.                                                    |
| `resolveApproval(id, decision, by, options?)`    | Approves or denies. Approving a parked write launches that very run; denying cancels it. Applies the separation of duties of devices.         |
| `pendingApprovals()`                             | The approvals waiting for a decision.                                                                                                         |
| `smokeTest(provider, startedBy)`                 | A read-only run of a fixed prompt; `passed` when the run is `done` and the provider answered `MORDOMO_OK`.                                    |
| `get(runId)`, `list(filter?)`                    | One run (or `null`), and runs newest first.                                                                                                   |
| `cancel(runId, reason?)`                         | Cancels a queued, parked or running run. Resolves whether anything was cancelled.                                                             |
| `events(runId, afterId?)`                        | The persisted events of a run, in order.                                                                                                      |
| `subscribe(runId, listener)`                     | Live events of a run; returns the function that stops them.                                                                                   |
| `wait(runId, options?)`                          | Resolves with the run when it has ended. Aborting `options.signal` rejects with the signal's reason and leaves the run alone.                 |

### `StartPromptInput`

`prompt` (1 to 20 000 characters) and `startedBy` (required: `string | null`). Optional: `provider` (default: the
conversation's, then `settings.defaultProvider`), `model`, `effort`, `mode` (`"read_only"`, the default, or `"write"`),
`cwd`, `timeoutMs` (10 000 to 3 600 000), `sessionId` (continue a conversation: its provider and working folder are
the defaults), `parentRunId` and `submissionId` (a UUID that makes the call idempotent: the same id with the same
body and asker returns the first result, a different body or asker is `submission_conflict`).

Refusals happen before anything is created - no conversation, no run: a `ZodError` for the bounds, `profile_refused`
for a write under `read_only`, `PathAccessError` for a `cwd` outside the home and the indexed folders, `unknown_provider`
or a 400 for a disabled provider, `device_provider_refused` for a device on a provider that reads the whole disk.

### `StartSkillInput`

`slug` and `startedBy` (required); optional `inputs` (name to text), `provider`, `model`, `effort`, `cwd` and
`timeoutMs`. Refusals: 404 for a missing skill, 400 for a disabled one, a provider the skill does not list or a blank
required input, `budget_exhausted` (409) when the skill's daily budget is spent, plus the rules of `StartPromptInput`.

### `RetryInput`

`submissionId` (a UUID) and `startedBy`. A run with no retained request is `request_unavailable`; a skill that no
longer exists is `skill_unavailable`.

### `StartOptions`

`onError(error, runId)`: called when a run that was created could not be handed to its provider. The run records its
own failure; without `onError` nothing else is reported.

### `StartedRun`

`runId`, `status` (`"queued"` or `"waiting_approval"`), `sessionId` (prompt runs) and `pendingApproval` (when parked).

### `ResolveApprovalOptions`

`answers` (the answers to a question the agent asked, question text to chosen answer) and `onError`, as in
`StartOptions`.

### `ResolvedApproval`

`id`, `kind`, `status`, `description` and `runId`: the run an approval launched, or `null`.

### `RunFilter`

`limit` (default 50), `offset`, `status`, `statusGroup` (`"active"` or `"failed"`), `provider`, `order`, `sessionId`,
`parentRunId` and `skillSlug`.

### `WaitOptions`

`signal`: an `AbortSignal` that ends the wait.

### `SmokeResult`

`run` and `passed`.

### `SettingsUpdate`

The keys of `Settings` that change, at any depth; nested objects merge, arrays are replaced. Used by
`engine.updateSettings`, which validates the whole document and saves it. A library caller is as trusted as the person
at the machine: it can change the security profile.

### `Settings`

The settings document (`config/settings.json`): default provider, `providers.<id>.enabled`, security profile, limits,
indexed folders and the rest. A provider starts disabled.

### `SecurityProfile`

`"read_only"`, `"review_before_write"`, `"controlled_write"` or `"approved_automation"`: how a write run is treated.

### `EffortLevel`

The reasoning effort a provider that supports it may be asked for.

### `ProviderId`

A provider's id: 2 to 32 lowercase letters, digits or dashes. Only a format; what is registered is the registry's.

### `RunRecord`

A run as stored: `id`, `status`, `provider`, `cwd`, `startedBy`, `parentRunId`, `sessionId`, `error`, usage and more.

### `RunStatus`

`queued`, `running`, `waiting_approval`, `done`, `failed`, `cancelled`, `timed_out` or `interrupted`.

### `RunMode`

`"read_only"` or `"write"`.

### `RunEvent`

One thing a provider reported: `text`, `assistant`, `tool_use`, `permission`, `session`, `usage`, `result`, `error` or
`started`.

### `RunUsage`

Tokens and cost a run used.

### `SessionRecord`

A conversation: the runs that continue one provider-side thread.

### `NotificationRecord`

A row of the inbox.

### `Approval`

A decision a human has to take: `id`, `kind`, `description`, `payload`, `status`, `requestedBy`, `resolvedBy`.

### `ApprovalKind`

`write_run`, `tool_use`, `install_software`, `change_global_config`, `destructive_command`, `access_new_folder`,
`connector_write`, `create_startup_service`, `expose_port`, `send_external_data` or `overwrite_existing_config`. A
device approves only `write_run` and `tool_use`.

### `OsEvent`

An event of the engine's bus.

### `OsEventMap`

The payload of each event type.

### `OsEventType`

The names of the events: `run.created`, `run.finished`, `approval.requested`, `settings.changed` and the rest.

## Providers

### `ProviderRegistry`

`new ProviderRegistry().register(manifest, factory)` (chainable), `has`, `ids`, `manifest` and `manifests`. Registering
an id twice, or an id that is not well formed, throws `ProviderRegistryError`. A factory must build an adapter whose
`id` is the manifest's.

### `ProviderRegistryError`

A registry rule was broken: a malformed or repeated id, an unknown id, a factory that built another provider's adapter.

### `ProviderManifest`

A provider as data: `id`, `displayName`, `binary` (the executable the engine allows it to spawn), `capabilities`,
`layout`, `writeToolPattern` and the rest.

### `ProviderCapabilities`

What the provider can do and where it stops: `enforcesReadOnly`, `resume`, `writeConfinement` (`broker`, `sandbox` or
`none`; an unconfined write is parked unless the profile is `approved_automation`) and `readConfinement` (`workdir`
or `none`; a device only runs on `workdir`).

### `AgentAdapter`

The code of a provider: `detect`, `authenticate`, `listModels`, `validateConfig`, `buildInvocation`, `execute` (an
async iterable of `RunEvent`) and `healthCheck`. Cancellation arrives as `AgentRun.signal`.

### `AgentRun`

What `execute` receives: the prompt, the working folder, model, effort, mode, timeout, the artifacts folder and the
signal.

### `AdapterFactory`

`(options: AdapterFactoryOptions) => AgentAdapter`.

### `AdapterFactoryOptions`

`binaryPath` (the stored path, or `null`), `homeDir` and `spawn`: the engine's `SpawnPolicy`, to give to the adapter.

### `SpawnPolicy`

What one engine lets its children be and know: the executables its providers run, by name (plus `node`), and the
environment its probes do not inherit. `new SpawnPolicy({ binaries: ["my-cli"] })` for an adapter built alone;
`assertAllowed`, `spawn` and `probe` apply it.

### `DropEnv`

`{ names, prefixes }`: variables of the process a child must not inherit.

### `DetectionResult`

What `detect` found: installed or not, the path, the version, the flags the CLI advertises.

### `AuthStatus`

Whether the provider is signed in.

### `ModelOption`

A model the provider offers.

### `ValidationResult`

`ok` and the issues `validateConfig` found.

### `HealthStatus`

The provider's health at a moment.

### `SafeInvocation`

The command an adapter would run: executable, arguments, environment.

### `PermissionBroker`

The command of the permission server a provider CLI spawns to ask a human before a tool runs.

## Errors

### `MordomoError`

A rule of the engine said no. `statusCode` is the HTTP status the API answers with (a library caller may ignore it);
`code` is one of `ENGINE_ERROR_CODES` when the rule has a stable name. A refusal with no code carries only its status:
404 "Skill not found", 400 "Skill is disabled".

### `ENGINE_ERROR_CODES`

The codes, in this order:

| Code                      | Status | When                                                                                  |
| ------------------------- | ------ | ------------------------------------------------------------------------------------- |
| `profile_refused`         | 403    | A write run under a profile that does not write                                        |
| `unknown_provider`        | 400    | No adapter is registered for the provider                                              |
| `device_provider_refused` | 403    | A device asked for a run on a provider that reads the whole disk                       |
| `self_approval`           | 403    | A device tried to approve what it asked for                                            |
| `owner_only`              | 403    | A device tried to approve a kind of request that is the owner's                        |
| `submission_conflict`     | 409    | A `submissionId` reused with another body, asker or action                             |
| `submission_uncertain`    | 409    | A `submissionId` whose first call left no result: check the history before repeating   |
| `budget_exhausted`        | 409    | The skill's daily budget is spent                                                      |
| `request_unavailable`     | 409    | A run too old to hold a complete request cannot be repeated                            |
| `skill_unavailable`       | 409    | The skill a run or a step names no longer exists                                       |
| `workspace_unavailable`   | 409    | `<home>/workspace` exists and is not a folder                                          |
| `engine_locked`           | -      | Another engine owns the home (`EngineLockedError`)                                     |

### `EngineErrorCode`

The union of the codes above.

### `EngineLockedError`

`engine.start()` found another engine owning the home. `holderPid` is the owner's process (this process, when it is
another engine of the same program), and `code` is `"engine_locked"`.

### `RestoreInProgressError`

A restore is replacing the files of the home; `createEngine` waits up to `restoreWaitMs` and then throws this.

### `DbNewerVersionError`

The database was written by a newer release; nothing was changed.

### `MigrationError`

A database migration failed; the snapshot taken before it is kept.

### `PathAccessError`

A path is outside what the engine may touch: not in the home or an indexed folder, or in `config/` or `logs/`.

## Writing an adapter

An adapter needs `@mordomo/core` for the types only. The shared streaming executor (`executeInvocation`), the parsers'
helpers and `findExecutable` are in `@mordomo/core/internal`, which the three adapters of the repository use; they will
move to a public entry point when someone outside the repository writes one.

## The package

- `exports` has two entry points; `files` ships `dist`, the README and the license, without sourcemaps, tests or
  fixtures.
- The license is the Functional Source License 1.1 with the Apache 2.0 future license (`FSL-1.1-ALv2`), the text of the
  `LICENSE` in the package. The `LICENSE` at the root of the repository stays as it is until the commercial license
  feature.
- `@mordomo/contracts` is the package that `@mordomo/core` depends on, and has the same metadata.
- Native code: `better-sqlite3`. The package has no install script of its own.
