import { zodToJsonSchema } from "zod-to-json-schema";
import type { z } from "zod";
import {
  EVENT_SCHEMAS,
  EVENT_VERSIONS,
  OS_EVENT_TYPES,
  RUN_FRAME_SCHEMAS,
  RUN_FRAME_TYPES,
  RUN_FRAME_VERSIONS,
  type OsEventTypeName,
  type RunFrameType,
} from "@mordomo/contracts";

/**
 * `docs/events.md`, generated from the contract: the event types and the frames of a run's stream, the versions each
 * has had and the fields of each version. The file is checked in; `tests/events.contract.test.ts` regenerates it and
 * fails when the checked-in text differs (`UPDATE_EVENTS_DOC=1` rewrites it). Only the one-line descriptions below
 * are written by hand; the type system makes them exhaustive.
 */

const EVENT_DESCRIPTIONS: Record<OsEventTypeName, string> = {
  "run.created": "A run row was created (queued, or parked waiting for approval).",
  "run.started": "The provider process of a run was spawned.",
  "run.event":
    "One event of a run (the same events the run stream sends), for a client that follows many runs.",
  "run.finished": "A run reached a terminal status.",
  "routine.fired": "A routine started a run.",
  "routine.alert": "A routine's run needs attention, or its daily budget stopped a fire.",
  "routine.changed": "A routine was created, edited, enabled, disabled, ended or deleted.",
  "index.started":
    "A memory index pass started, in a worker thread of the service or (without the worker script) in its own thread.",
  "index.progress": "The memory index advanced; `phase` and `runId` name where, when the pass reports them.",
  "index.finished": "The memory index finished.",
  "index.failed": "The memory index could not finish; the previous index is kept when it says so.",
  "index.cancelled": "A memory index pass was cancelled; the blocks it had committed stay.",
  "approval.requested": "An approval is waiting for a human.",
  "approval.resolved": "An approval was decided.",
  "approval.expired": "Pending approvals past their time to live were swept to expired.",
  "session.created": "A conversation was created.",
  "session.updated":
    "A conversation changed: a provider session id, a finished turn, a new title or its deletion.",
  "objective.changed": "An objective or one of its steps changed or was deleted.",
  "settings.changed": "The settings were saved.",
  "backup.created": "A backup was made.",
  "notification.created": "A row was appended to the persisted inbox.",
  "notification.read": "Inbox rows were marked read.",
  "budget.crossed": "Today's spend passed a share of the daily budget.",
  "sentinel.fired": "A sentinel saw something worth a look.",
  "stream.reset":
    "Sent first on a feed whose resume point is ahead of this process's last id (the service restarted).",
};

const FRAME_DESCRIPTIONS: Record<RunFrameType, string> = {
  started: "The provider process was spawned.",
  text: "A line of the process's output (stdout, or stderr for the service's own notes).",
  assistant: "A piece of the assistant's reply.",
  tool_use: "A tool the agent used, at its start and at its end.",
  permission: "A tool asked for approval.",
  session: "The provider's own conversation id for this run.",
  result: "The end of the run: exit code, summary and duration.",
  error: "The run failed to execute.",
  usage: "Tokens and cost the provider reported.",
  run_state: "Sent last: the run's final status; the stream closes after it.",
};

type Json = Record<string, unknown>;

function toJson(schema: z.ZodTypeAny): Json {
  const out = zodToJsonSchema(schema, {
    $refStrategy: "none",
    target: "jsonSchema7",
    removeAdditionalStrategy: "strict",
  }) as Json;
  delete out.$schema;
  return out;
}

/** A short reading of the type of a JSON Schema node: `string`, `number | null`, `"a" | "b"`, `string[]`, `object`. */
function typeOf(node: Json): string {
  if (Array.isArray(node.enum)) return (node.enum as unknown[]).map((v) => JSON.stringify(v)).join(" | ");
  if ("const" in node) return JSON.stringify(node.const);
  const union = (node.anyOf ?? node.oneOf) as Json[] | undefined;
  if (union) return [...new Set(union.map(typeOf))].join(" | ");
  const type = node.type;
  if (type === "array") return `${typeOf((node.items as Json) ?? {})}[]`;
  if (Array.isArray(type)) return type.join(" | ");
  if (type === "object" && node.additionalProperties && typeof node.additionalProperties === "object") {
    return `map of ${typeOf(node.additionalProperties as Json)}`;
  }
  if (typeof type === "string") return type;
  return "any";
}

function fields(node: Json): string[] {
  const props = (node.properties ?? {}) as Record<string, Json>;
  const required = new Set((node.required ?? []) as string[]);
  const lines = Object.entries(props).map(
    ([name, child]) =>
      `| \`${name}\` | ${typeOf(child).replace(/\|/g, "\\|")} | ${required.has(name) ? "yes" : "no"} |`,
  );
  return lines.length > 0
    ? ["| Field | Type | Required |", "| --- | --- | --- |", ...lines]
    : ["_No fields._"];
}

/** The shapes a schema can have: each member of a union, or the schema itself. */
function shapes(node: Json): Json[] {
  const union = (node.anyOf ?? node.oneOf) as Json[] | undefined;
  return union ? union : [node];
}

function versionSection(label: string, schema: z.ZodTypeAny): string[] {
  const out: string[] = [];
  const members = shapes(toJson(schema));
  members.forEach((member, index) => {
    out.push(members.length > 1 ? `${label}, shape ${index + 1} of ${members.length}:` : `${label}:`, "");
    out.push(...fields(member), "");
  });
  return out;
}

export function eventsDocument(): string {
  const lines: string[] = [
    "# Events",
    "",
    "<!-- Generated from the contract by apps/api/src/eventsDoc.ts; do not edit by hand.",
    "     Rewrite with: UPDATE_EVENTS_DOC=1 npx vitest run tests/events.contract.test.ts -t C29 -->",
    "",
    "What the service announces, and how a client reads it. There are two feeds, both server-sent events:",
    "",
    "- `GET /api/v1/events`: one feed over the engine's event bus. Each message is `id: <event id>`, `event: <type>` and",
    "  `data: <envelope>`, where the envelope is `{ id, type, ts, v, payload }`. A client resumes with `Last-Event-ID` (or `?since=`).",
    "- `GET /api/v1/runs/:id/stream`: the events of one run. Each message is `data: <frame>` (with the persisted event id as the",
    "  SSE `id`), where the frame is the event itself plus `v`, and the last frame is `run_state`.",
    "",
    "## Evolution policy",
    "",
    "Every event type has its own list of versions (`EVENT_VERSIONS` in `@mordomo/contracts`), oldest first and contiguous from 1.",
    "The version of an event is the `v` in its envelope (or its frame).",
    "",
    "1. **A field added is compatible.** A new field in an envelope or a payload keeps the version. A reader ignores a key it does not know.",
    "2. **An incompatible change adds a version.** A field removed, renamed, retyped or given another meaning adds `version + 1` to the",
    "   type's list. The schema of the old version stays in the contract and the server keeps sending what its clients understand.",
    "3. **A client ignores what it does not know.** An event whose type is not in `OS_EVENT_TYPES`, or whose `v` is above the highest",
    "   version the client knows for that type, is dropped without an error and without closing the stream (`classifyEvent`, also at",
    "   `@mordomo/contracts/events`, which does not pull in zod). A run frame without `v` was sent by a server that predates it and reads as version 1.",
    "",
    "The schemas are the contract: `EVENT_SCHEMAS[type][v]` for the bus and `RUN_FRAME_SCHEMAS[type][v]` for the run stream. The files",
    "`tests/fixtures/events/v1/` are frozen examples of version 1 of every type, and the tests fail if a change makes one stop parsing.",
    "",
    `## Events of the bus (${OS_EVENT_TYPES.length})`,
    "",
  ];
  for (const type of OS_EVENT_TYPES) {
    const versions = EVENT_VERSIONS[type];
    lines.push(
      `### \`${type}\``,
      "",
      EVENT_DESCRIPTIONS[type],
      "",
      `Versions: ${versions.join(", ")} (current ${versions[versions.length - 1]}).`,
      "",
    );
    for (const v of versions) lines.push(...versionSection(`Payload, version ${v}`, EVENT_SCHEMAS[type][v]!));
  }
  lines.push(`## Frames of a run's stream (${RUN_FRAME_TYPES.length})`, "");
  for (const type of RUN_FRAME_TYPES) {
    const versions = RUN_FRAME_VERSIONS[type];
    lines.push(
      `### \`${type}\``,
      "",
      FRAME_DESCRIPTIONS[type],
      "",
      `Versions: ${versions.join(", ")} (current ${versions[versions.length - 1]}).`,
      "",
    );
    for (const v of versions)
      lines.push(...versionSection(`Frame, version ${v}`, RUN_FRAME_SCHEMAS[type][v]!));
  }
  return (
    lines
      .join("\n")
      .replace(/\n{3,}/g, "\n\n")
      .trimEnd() + "\n"
  );
}
