/**
 * Contratos REST (.specs/features/contratos-rest, C7, C8, C30): a handler is held to the entry of its route, the
 * wire schemas infer the types the engine uses, and a call from the interface is typed by the table.
 * Compiled by `npm run typecheck` against the built .d.ts.
 */
import type { z } from "zod";
import type {
  API,
  ApiCallInput,
  ApiCallResult,
  Approval,
  DeviceRecord,
  MetricsSample,
  NotificationRecord,
  ProviderCapabilities,
  RunEvent,
  RunRecord,
  RunUsage,
  SessionRecord,
  Settings,
} from "@mordomo/contracts";
import type { Routine, RoutineStatus } from "@mordomo/core/internal";
import type { Handler } from "../apps/api/dist/contract.js";

type Table = typeof API;
type Out<Id extends keyof Table, Status extends number> = Table[Id]["responses"] extends infer R
  ? Status extends keyof R
    ? R[Status] extends z.ZodTypeAny
      ? z.output<R[Status]>
      : never
    : never
  : never;
type Mutual<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;

// C8 — each wire schema infers a type mutually assignable to the interface the engine uses.
export const runRecord: Mutual<Out<"runs.get", 200>["run"], RunRecord> = true;
export const runEvent: Mutual<Out<"runs.get", 200>["events"][number], RunEvent> = true;
export const runUsage: Mutual<NonNullable<Out<"runs.get", 200>["run"]["usage"]>, RunUsage> = true;
export const approval: Mutual<Out<"approvals.get", 200>, Approval> = true;
export const notification: Mutual<Out<"notifications.list", 200>["items"][number], NotificationRecord> = true;
export const session: Mutual<Out<"sessions.get", 200>["session"], SessionRecord> = true;
export const capabilities: Mutual<Out<"providers.list", 200>[number]["capabilities"], ProviderCapabilities> =
  true;
export const sample: Mutual<Out<"metrics.history", 200>["samples"][number], MetricsSample> = true;
export const device: Mutual<Out<"devices.list", 200>["devices"][number], DeviceRecord> = true;
export const settings: Mutual<Out<"settings.get", 200>, Settings> = true;
// The routine the core stores and the status the scheduler reports are the ones the table describes.
export const routine: Mutual<Out<"routines.create", 200>, Routine> = true;
export const routineStatus: Mutual<Out<"routines.list", 200>[number], RoutineStatus> = true;

declare const run: RunRecord;

// C7 — a handler returns the body of one of the statuses of its entry, and nothing else.
export const ok: Handler<"runs.get"> = async () => ({ run, events: [] });
// A key the entry does not name is structural subtyping, which TypeScript accepts through an async arrow: the
// development server and the tests catch it at runtime (checkResponse, C9), not the compiler.
export const extra: Handler<"runs.get"> = async () => ({ run, events: [], more: 1 });
// @ts-expect-error a field the entry requires is missing
export const missing: Handler<"runs.get"> = async () => ({ run });
// @ts-expect-error a field with the wrong type
export const wrong: Handler<"runs.get"> = async () => ({ run, events: "none" });
// A route with two success statuses takes either body.
export const queued: Handler<"runs.create"> = async () => ({ runId: "r", status: "queued", sessionId: "s" });
export const parked: Handler<"runs.create"> = async () => ({ runId: "r", status: "waiting_approval" });
// @ts-expect-error a status that is in neither body
export const unknownStatus: Handler<"runs.create"> = async () => ({ runId: "r", status: "done" });
// A route that answers a stream answers through the reply.
export const streaming: Handler<"runs.stream"> = async (_call, _req, reply) => reply;
// @ts-expect-error the stream route does not answer a JSON body
export const notStreaming: Handler<"runs.stream"> = async () => ({ ok: true });
// The handler receives the parts already parsed.
export const parsed: Handler<"runs.list"> = async ({ query }, _req, reply) => {
  const limit: number = query.limit;
  void reply;
  void limit;
  return [];
};

// C30 — a call is typed by the entry of the route it names.
export const callParams: ApiCallInput<"GET /api/runs/:id"> = { params: { id: "x" } };
// @ts-expect-error params.id is a string
export const callBadParams: ApiCallInput<"GET /api/runs/:id"> = { params: { id: 1 } };
// @ts-expect-error a route that has params needs them
export const callNoParams: ApiCallInput<"GET /api/runs/:id"> = {};
export const callBody: ApiCallInput<"POST /api/runs"> = { body: { prompt: "p" } };
// @ts-expect-error the body requires a prompt
export const callBadBody: ApiCallInput<"POST /api/runs"> = { body: { mode: "write" } };
export const callExtraBody: ApiCallInput<"POST /api/runs/:id/cancel"> = {
  params: { id: "x" },
  // @ts-expect-error the cancel route takes no body
  body: { x: 1 },
};
export const callQuery: ApiCallInput<"GET /api/runs"> = { query: { limit: 5 } };
export const callNoQuery: ApiCallInput<"GET /api/runs"> = {};
// @ts-expect-error a route that does not exist
export type CallMissing = ApiCallInput<"GET /api/nao-existe">;
export const result: ApiCallResult<"GET /api/runs/:id"> = { run, events: [] };
export const field: string = ({} as ApiCallResult<"GET /api/runs/:id">).run.id;
// @ts-expect-error the response has no such field
export const noField = ({} as ApiCallResult<"GET /api/runs/:id">).run.nope;
