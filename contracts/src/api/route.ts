/**
 * The shape of one entry of the route table (`API`, `./index.ts`): everything a caller, the server and the route
 * document need to know about a route, in one place.
 *
 * - `params`, `query` and `body` are the zod schemas of what the route reads; the server parses each one before the
 *   handler runs (`bind`, `apps/api/src/contract.ts`) and answers `400 validation` when one fails.
 * - `responses` holds one schema (or one raw kind) for each SUCCESS status the route answers; the errors it answers
 *   are `errors`, plus the `COMMON_ERRORS` that every route can answer (`./errors.ts`).
 * - The access is the one `config` the Fastify route carried before the table existed: `public`, or the `scope`
 *   (`owner`, or the scope a paired device must hold) with the `queryToken` and `ticket` flags of the streams.
 *
 * The schemas describe the JSON as it travels (a response is checked after `JSON.parse(JSON.stringify(body))`), are
 * tolerant of a key they do not name (a client must not break on an additive field) and are closed only by
 * `checkResponse`, which the test and the development server use to reject a response with a key the contract does
 * not name.
 */
import type { z } from "zod";
import type { DeviceScope } from "../devices.js";

export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

/** `owner`: the local token only. Any other value is the scope a paired device must hold. */
export type RouteScope = "owner" | DeviceScope;

/** A success status that carries no JSON: a stream of frames or a file. */
export interface RawResponse {
  readonly raw: "stream" | "binary";
  /** The `Content-Type` values the route answers with (a file route answers one per file kind). */
  readonly contentTypes: readonly string[];
  readonly description: string;
  /** For a stream: the schema of one frame (the data of an SSE message), for the document and the reader. */
  readonly frame?: z.ZodTypeAny;
}

export type ResponseSpec = z.ZodTypeAny | RawResponse;

/** An error a route answers beyond `COMMON_ERRORS`: the status and the `error.code` it carries. */
export interface ErrorDoc {
  readonly status: number;
  readonly code: string;
  readonly description: string;
}

export interface RouteDefinition {
  readonly method: HttpMethod;
  /** As Fastify registers it: `/api/…` with `:name` segments. The versioned spelling is `/api/v1/…`. */
  readonly path: `/api/${string}`;
  readonly summary: string;
  readonly tag: string;
  /** Absent only on a public route. */
  readonly scope?: RouteScope;
  readonly public?: true;
  /** A `GET` that may carry its credential in `?token=` (a stream, an `<img>` source). */
  readonly queryToken?: true;
  /** A `GET` that may carry a stream ticket in `?ticket=`. */
  readonly ticket?: true;
  readonly params?: z.ZodTypeAny;
  readonly query?: z.ZodTypeAny;
  readonly body?: z.ZodTypeAny;
  /** The body may be left out of the request: the handler then receives what the schema makes of `{}`. */
  readonly bodyOptional?: true;
  /** One entry per success status (2xx). */
  readonly responses: { readonly [status: number]: ResponseSpec };
  readonly errors?: readonly ErrorDoc[];
  /** Response headers beyond the common ones, by name, with what they carry. */
  readonly headers?: { readonly [name: string]: string };
}

/** Identity function that keeps the literal types of an entry (method, path, the statuses of `responses`). */
export function route<const R extends RouteDefinition>(definition: R): R {
  return definition;
}

/** Marks a status that answers a stream of server-sent events. */
export function stream(frame: z.ZodTypeAny, description: string): RawResponse {
  return { raw: "stream", contentTypes: ["text/event-stream"], description, frame };
}

/** Marks a status that answers a file. */
export function binary(contentTypes: readonly string[], description: string): RawResponse {
  return { raw: "binary", contentTypes, description };
}

export function isRawResponse(spec: ResponseSpec): spec is RawResponse {
  return typeof spec === "object" && spec !== null && "raw" in spec && !("_def" in spec);
}

// ---- types derived from an entry ------------------------------------------------------------------------------

type Parsed<S> = S extends z.ZodTypeAny ? z.output<S> : undefined;
type Sent<S> = S extends z.ZodTypeAny ? z.input<S> : undefined;

/** What `bind` hands the handler. */
export type RouteCall<R extends RouteDefinition> = {
  params: R extends { params: infer S } ? Parsed<S> : undefined;
  query: R extends { query: infer S } ? Parsed<S> : undefined;
  body: R extends { body: infer S } ? Parsed<S> : undefined;
};

/** The body that stands for a raw status in `SuccessBodies` (the handler answers through `reply`). */
export interface RawBody {
  readonly __raw: true;
}

/** The union of the success bodies of an entry, one member per success status. */
export type SuccessBodies<R extends RouteDefinition> = {
  [S in keyof R["responses"]]: R["responses"][S] extends z.ZodTypeAny ? z.output<R["responses"][S]> : RawBody;
}[keyof R["responses"]];

type IsOptionalInput<T> = Record<never, never> extends T ? true : false;

/** What a client passes for an entry: `params` when it has any, `query` and `body` as the schema allows. */
export type RouteInput<R extends RouteDefinition> = (R extends { params: infer S }
  ? { params: Sent<S> }
  : unknown) &
  (R extends { query: infer S }
    ? IsOptionalInput<Sent<S>> extends true
      ? { query?: Sent<S> }
      : { query: Sent<S> }
    : unknown) &
  (R extends { body: infer S }
    ? R extends { bodyOptional: true }
      ? { body?: Sent<S> }
      : IsOptionalInput<Sent<S>> extends true
        ? { body?: Sent<S> }
        : { body: Sent<S> }
    : unknown);

/** What a client gets back from the 2xx bodies of an entry (a raw status reads as `Response`-less `unknown`). */
export type RouteResult<R extends RouteDefinition> = {
  [S in keyof R["responses"]]: R["responses"][S] extends z.ZodTypeAny ? z.output<R["responses"][S]> : unknown;
}[keyof R["responses"]];
