# Events

<!-- Generated from the contract by apps/api/src/eventsDoc.ts; do not edit by hand.
     Rewrite with: UPDATE_EVENTS_DOC=1 npx vitest run tests/events.contract.test.ts -t C29 -->

What the service announces, and how a client reads it. There are two feeds, both server-sent events:

- `GET /api/v1/events`: one feed over the engine's event bus. Each message is `id: <event id>`, `event: <type>` and
  `data: <envelope>`, where the envelope is `{ id, type, ts, v, payload }`. A client resumes with `Last-Event-ID` (or `?since=`).
- `GET /api/v1/runs/:id/stream`: the events of one run. Each message is `data: <frame>` (with the persisted event id as the
  SSE `id`), where the frame is the event itself plus `v`, and the last frame is `run_state`.

## Evolution policy

Every event type has its own list of versions (`EVENT_VERSIONS` in `@mordomo/contracts`), oldest first and contiguous from 1.
The version of an event is the `v` in its envelope (or its frame).

1. **A field added is compatible.** A new field in an envelope or a payload keeps the version. A reader ignores a key it does not know.
2. **An incompatible change adds a version.** A field removed, renamed, retyped or given another meaning adds `version + 1` to the
   type's list. The schema of the old version stays in the contract and the server keeps sending what its clients understand.
3. **A client ignores what it does not know.** An event whose type is not in `OS_EVENT_TYPES`, or whose `v` is above the highest
   version the client knows for that type, is dropped without an error and without closing the stream (`classifyEvent`, also at
   `@mordomo/contracts/events`, which does not pull in zod). A run frame without `v` was sent by a server that predates it and reads as version 1.

The schemas are the contract: `EVENT_SCHEMAS[type][v]` for the bus and `RUN_FRAME_SCHEMAS[type][v]` for the run stream. The files
`tests/fixtures/events/v1/` are frozen examples of version 1 of every type, and the tests fail if a change makes one stop parsing.

## Events of the bus (29)

### `run.created`

A run row was created (queued, or parked waiting for approval).

Versions: 1 (current 1).

Payload, version 1:

| Field | Type | Required |
| --- | --- | --- |
| `runId` | string | yes |
| `origin` | "manual" \| "skill" \| "routine" \| "api" \| "sentinel" | yes |
| `provider` | string | yes |
| `sessionId` | string | no |

### `run.started`

The provider process of a run was spawned.

Versions: 1 (current 1).

Payload, version 1:

| Field | Type | Required |
| --- | --- | --- |
| `runId` | string | yes |
| `pid` | number \| null | yes |

### `run.event`

One event of a run (the same events the run stream sends), for a client that follows many runs.

Versions: 1 (current 1).

Payload, version 1:

| Field | Type | Required |
| --- | --- | --- |
| `runId` | string | yes |
| `event` | object | yes |

### `run.finished`

A run reached a terminal status.

Versions: 1 (current 1).

Payload, version 1:

| Field | Type | Required |
| --- | --- | --- |
| `runId` | string | yes |
| `status` | "queued" \| "running" \| "waiting_approval" \| "done" \| "failed" \| "cancelled" \| "timed_out" \| "interrupted" | yes |
| `durationMs` | number \| null | yes |

### `routine.fired`

A routine started a run.

Versions: 1 (current 1).

Payload, version 1:

| Field | Type | Required |
| --- | --- | --- |
| `routineId` | string | yes |
| `runId` | string | yes |

### `routine.alert`

A routine's run needs attention, or its daily budget stopped a fire.

Versions: 1 (current 1).

Payload, version 1, shape 1 of 2:

| Field | Type | Required |
| --- | --- | --- |
| `routineId` | string | yes |
| `runId` | null | yes |
| `summary` | string | yes |
| `reason` | "budget" | yes |
| `spentUsd` | number | yes |
| `budgetUsd` | number | yes |

Payload, version 1, shape 2 of 2:

| Field | Type | Required |
| --- | --- | --- |
| `routineId` | string | yes |
| `runId` | string | yes |
| `status` | "queued" \| "running" \| "waiting_approval" \| "done" \| "failed" \| "cancelled" \| "timed_out" \| "interrupted" | yes |
| `summary` | string | yes |

### `routine.changed`

A routine was created, edited, enabled, disabled, ended or deleted.

Versions: 1 (current 1).

Payload, version 1:

| Field | Type | Required |
| --- | --- | --- |
| `id` | string | yes |
| `action` | string | yes |
| `reason` | string \| null | no |

### `index.started`

A memory index pass started, in a worker thread of the service or (without the worker script) in its own thread.

Versions: 1 (current 1).

Payload, version 1:

| Field | Type | Required |
| --- | --- | --- |
| `runId` | string | yes |
| `mode` | "worker" \| "inline" | yes |

### `index.progress`

The memory index advanced; `phase` and `runId` name where, when the pass reports them.

Versions: 1 (current 1).

Payload, version 1:

| Field | Type | Required |
| --- | --- | --- |
| `runId` | string | no |
| `phase` | "scan" \| "index" \| "prune" \| "related" \| "vectors" | no |
| `scanned` | number | yes |
| `total` | number | no |
| `added` | number | yes |
| `updated` | number | yes |
| `removed` | number | yes |

### `index.finished`

The memory index finished.

Versions: 1 (current 1).

Payload, version 1:

| Field | Type | Required |
| --- | --- | --- |
| `stats` | object | yes |
| `runId` | string | no |

### `index.failed`

The memory index could not finish; the previous index is kept when it says so.

Versions: 1 (current 1).

Payload, version 1:

| Field | Type | Required |
| --- | --- | --- |
| `code` | string | yes |
| `previousIndexPreserved` | boolean | yes |
| `runId` | string | no |

### `index.cancelled`

A memory index pass was cancelled; the blocks it had committed stay.

Versions: 1 (current 1).

Payload, version 1:

| Field | Type | Required |
| --- | --- | --- |
| `runId` | string | yes |

### `cleanup.progress`

A cleanup scan of a scope advanced: `phase` is inventory, signatures, links or findings, in that order, with `done` of `total`.

Versions: 1 (current 1).

Payload, version 1:

| Field | Type | Required |
| --- | --- | --- |
| `scanId` | string | yes |
| `phase` | "inventory" \| "signatures" \| "links" \| "findings" | yes |
| `done` | integer | yes |
| `total` | integer | yes |

### `cleanup.finished`

A cleanup scan finished; `findings` is how many it reports (`GET /api/memory/cleanup/scans/:id`).

Versions: 1 (current 1).

Payload, version 1:

| Field | Type | Required |
| --- | --- | --- |
| `scanId` | string | yes |
| `findings` | integer | yes |

### `cleanup.failed`

A cleanup scan could not finish; the signatures it had stored stay.

Versions: 1 (current 1).

Payload, version 1:

| Field | Type | Required |
| --- | --- | --- |
| `scanId` | string | yes |
| `code` | string | yes |

### `dashboard.refreshed`

A dashboard was refreshed and its snapshot stored (`GET /api/dashboards/:id`); `status` is ok, partial (a source failed) or error (every widget failed).

Versions: 1 (current 1).

Payload, version 1:

| Field | Type | Required |
| --- | --- | --- |
| `id` | string | yes |
| `generatedAt` | integer | yes |
| `status` | "ok" \| "partial" \| "error" | yes |

### `approval.requested`

An approval is waiting for a human.

Versions: 1 (current 1).

Payload, version 1:

| Field | Type | Required |
| --- | --- | --- |
| `id` | string | yes |
| `kind` | "write_run" \| "tool_use" \| "install_software" \| "change_global_config" \| "destructive_command" \| "access_new_folder" \| "connector_write" \| "create_startup_service" \| "expose_port" \| "send_external_data" \| "overwrite_existing_config" | yes |
| `description` | string | yes |
| `runId` | string \| null | no |

### `approval.resolved`

An approval was decided.

Versions: 1 (current 1).

Payload, version 1:

| Field | Type | Required |
| --- | --- | --- |
| `id` | string | yes |
| `kind` | "write_run" \| "tool_use" \| "install_software" \| "change_global_config" \| "destructive_command" \| "access_new_folder" \| "connector_write" \| "create_startup_service" \| "expose_port" \| "send_external_data" \| "overwrite_existing_config" | yes |
| `status` | "pending" \| "approved" \| "denied" \| "expired" | yes |
| `runId` | string \| null | yes |

### `approval.expired`

Pending approvals past their time to live were swept to expired.

Versions: 1 (current 1).

Payload, version 1:

| Field | Type | Required |
| --- | --- | --- |
| `count` | number | yes |

### `session.created`

A conversation was created.

Versions: 1 (current 1).

Payload, version 1:

| Field | Type | Required |
| --- | --- | --- |
| `sessionId` | string | yes |
| `provider` | string | yes |
| `title` | string | yes |

### `session.updated`

A conversation changed: a provider session id, a finished turn, a new title or its deletion.

Versions: 1 (current 1).

Payload, version 1, shape 1 of 4:

| Field | Type | Required |
| --- | --- | --- |
| `sessionId` | string | yes |
| `deleted` | true | yes |
| `runsKept` | number | yes |

Payload, version 1, shape 2 of 4:

| Field | Type | Required |
| --- | --- | --- |
| `sessionId` | string | yes |
| `providerSessionId` | string | yes |

Payload, version 1, shape 3 of 4:

| Field | Type | Required |
| --- | --- | --- |
| `sessionId` | string | yes |
| `lastRunId` | string \| null | yes |
| `turns` | number | yes |
| `costUsd` | number | yes |

Payload, version 1, shape 4 of 4:

| Field | Type | Required |
| --- | --- | --- |
| `sessionId` | string | yes |
| `title` | string | yes |

### `objective.changed`

An objective or one of its steps changed or was deleted.

Versions: 1 (current 1).

Payload, version 1, shape 1 of 3:

| Field | Type | Required |
| --- | --- | --- |
| `objectiveId` | string | yes |
| `deleted` | true | yes |

Payload, version 1, shape 2 of 3:

| Field | Type | Required |
| --- | --- | --- |
| `objectiveId` | string | no |
| `stepId` | string | yes |
| `status` | string | no |

Payload, version 1, shape 3 of 3:

| Field | Type | Required |
| --- | --- | --- |
| `objectiveId` | string | no |
| `status` | string | no |

### `settings.changed`

The settings were saved.

Versions: 1 (current 1).

Payload, version 1:

| Field | Type | Required |
| --- | --- | --- |
| `settings` | object | yes |

### `backup.created`

A backup was made.

Versions: 1 (current 1).

Payload, version 1:

| Field | Type | Required |
| --- | --- | --- |
| `name` | string | yes |
| `path` | string | yes |
| `createdAt` | number | yes |
| `sizeBytes` | number | yes |

### `notification.created`

A row was appended to the persisted inbox.

Versions: 1 (current 1).

Payload, version 1:

| Field | Type | Required |
| --- | --- | --- |
| `id` | string | yes |
| `kind` | "approval" \| "run" \| "routine" \| "index" \| "system" | yes |
| `tone` | "ok" \| "warn" \| "danger" \| "info" \| null | yes |
| `messageKey` | string \| null | no |
| `messageParams` | map of string \| number \| boolean \| null | no |
| `title` | string | yes |
| `body` | string \| null | yes |
| `href` | string \| null | yes |
| `approvalId` | string \| null | yes |
| `runId` | string \| null | yes |
| `ts` | number | yes |
| `read` | boolean | yes |
| `dedupeKey` | string \| null | yes |

### `notification.read`

Inbox rows were marked read.

Versions: 1 (current 1).

Payload, version 1, shape 1 of 2:

| Field | Type | Required |
| --- | --- | --- |
| `ids` | string[] | yes |

Payload, version 1, shape 2 of 2:

| Field | Type | Required |
| --- | --- | --- |
| `all` | true | yes |

### `budget.crossed`

Today's spend passed a share of the daily budget.

Versions: 1 (current 1).

Payload, version 1:

| Field | Type | Required |
| --- | --- | --- |
| `level` | 80 \| 100 | yes |
| `day` | string | yes |
| `spentUsd` | number | yes |
| `budgetUsd` | number | yes |

### `sentinel.fired`

A sentinel saw something worth a look.

Versions: 1 (current 1).

Payload, version 1:

| Field | Type | Required |
| --- | --- | --- |
| `sentinel` | "fsWatch" \| "repeatedFailure" \| "silentRoutine" \| "connectorDelta" \| "reviewDue" | yes |
| `messageParams` | map of string \| number \| boolean | no |
| `title` | string | yes |
| `body` | string | yes |
| `severity` | "info" \| "warn" \| "danger" | yes |
| `href` | string | no |
| `dedupeKey` | string | no |
| `triage` | boolean | no |

### `stream.reset`

Sent first on a feed whose resume point is ahead of this process's last id (the service restarted).

Versions: 1 (current 1).

Payload, version 1:

| Field | Type | Required |
| --- | --- | --- |
| `lastId` | number | yes |

## Frames of a run's stream (10)

### `started`

The provider process was spawned.

Versions: 1 (current 1).

Frame, version 1:

| Field | Type | Required |
| --- | --- | --- |
| `type` | "started" | yes |
| `ts` | number | yes |
| `pid` | number \| null | yes |
| `attemptId` | string | no |
| `sequence` | number | no |
| `v` | 1 | yes |

### `text`

A line of the process's output (stdout, or stderr for the service's own notes).

Versions: 1 (current 1).

Frame, version 1:

| Field | Type | Required |
| --- | --- | --- |
| `type` | "text" | yes |
| `ts` | number | yes |
| `stream` | "stdout" \| "stderr" | yes |
| `text` | string | yes |
| `attemptId` | string | no |
| `sequence` | number | no |
| `v` | 1 | yes |

### `assistant`

A piece of the assistant's reply.

Versions: 1 (current 1).

Frame, version 1:

| Field | Type | Required |
| --- | --- | --- |
| `type` | "assistant" | yes |
| `ts` | number | yes |
| `text` | string | yes |
| `attemptId` | string | no |
| `sequence` | number | no |
| `v` | 1 | yes |

### `tool_use`

A tool the agent used, at its start and at its end.

Versions: 1 (current 1).

Frame, version 1:

| Field | Type | Required |
| --- | --- | --- |
| `type` | "tool_use" | yes |
| `ts` | number | yes |
| `tool` | string | yes |
| `detail` | string | yes |
| `paths` | string[] | no |
| `callId` | string | no |
| `phase` | "start" \| "end" | no |
| `durationMs` | number | no |
| `outcome` | "ok" \| "error" \| "denied" | no |
| `attemptId` | string | no |
| `sequence` | number | no |
| `v` | 1 | yes |

### `permission`

A tool asked for approval.

Versions: 1 (current 1).

Frame, version 1:

| Field | Type | Required |
| --- | --- | --- |
| `type` | "permission" | yes |
| `ts` | number | yes |
| `detail` | string | yes |
| `attemptId` | string | no |
| `sequence` | number | no |
| `v` | 1 | yes |

### `session`

The provider's own conversation id for this run.

Versions: 1 (current 1).

Frame, version 1:

| Field | Type | Required |
| --- | --- | --- |
| `type` | "session" | yes |
| `ts` | number | yes |
| `providerSessionId` | string | yes |
| `attemptId` | string | no |
| `sequence` | number | no |
| `v` | 1 | yes |

### `result`

The end of the run: exit code, summary and duration.

Versions: 1 (current 1).

Frame, version 1:

| Field | Type | Required |
| --- | --- | --- |
| `type` | "result" | yes |
| `ts` | number | yes |
| `exitCode` | number \| null | yes |
| `summary` | string | yes |
| `durationMs` | number | yes |
| `timedOut` | boolean | yes |
| `cancelled` | boolean | no |
| `attemptId` | string | no |
| `sequence` | number | no |
| `v` | 1 | yes |

### `error`

The run failed to execute.

Versions: 1 (current 1).

Frame, version 1:

| Field | Type | Required |
| --- | --- | --- |
| `type` | "error" | yes |
| `ts` | number | yes |
| `message` | string | yes |
| `attemptId` | string | no |
| `sequence` | number | no |
| `v` | 1 | yes |

### `usage`

Tokens and cost the provider reported.

Versions: 1 (current 1).

Frame, version 1:

| Field | Type | Required |
| --- | --- | --- |
| `type` | "usage" | yes |
| `ts` | number | yes |
| `inputTokens` | number | yes |
| `outputTokens` | number | yes |
| `cacheReadTokens` | number | no |
| `cacheWriteTokens` | number | no |
| `costUsd` | number \| null | no |
| `model` | string | no |
| `scope` | "turn" \| "total" | no |
| `attemptId` | string | no |
| `sequence` | number | no |
| `v` | 1 | yes |

### `run_state`

Sent last: the run's final status; the stream closes after it.

Versions: 1 (current 1).

Frame, version 1:

| Field | Type | Required |
| --- | --- | --- |
| `type` | "run_state" | yes |
| `ts` | number | yes |
| `status` | "queued" \| "running" \| "waiting_approval" \| "done" \| "failed" \| "cancelled" \| "timed_out" \| "interrupted" | no |
| `error` | string \| null | no |
| `v` | 1 | yes |
