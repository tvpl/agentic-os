/** The event feed, the tickets that open a stream without a credential in the URL, and the route document itself. */
import { z } from "zod";
import { OsEventSchema } from "../eventSchemas.js";
import { UuidParam, err } from "./common.js";
import { route, stream } from "./route.js";

export const streamRoutes = {
  "streams.ticket": route({
    method: "POST",
    path: "/api/stream-tickets",
    summary:
      "A one-use ticket (30 seconds) to open the event feed or one run's stream without a credential in the URL",
    tag: "streams",
    scope: "monitor",
    body: z.discriminatedUnion("target", [
      z.object({ target: z.literal("events") }),
      z.object({ target: z.literal("run"), runId: UuidParam }),
    ]),
    bodyOptional: true,
    responses: { 200: z.object({ ticket: z.string(), expiresAt: z.number() }) },
    errors: [err(429, "too_many_requests", "The caller already holds 32 tickets that were not used")],
  }),
  "events.stream": route({
    method: "GET",
    path: "/api/events",
    summary: "One server-sent feed over the process event bus; Last-Event-ID (or since) resumes after an id",
    tag: "streams",
    scope: "monitor",
    queryToken: true,
    ticket: true,
    query: z.object({
      since: z.string().optional(),
      ticket: z.string().optional(),
      token: z.string().optional(),
    }),
    responses: {
      200: stream(
        OsEventSchema,
        "Messages `id: <event id>`, `event: <type>`, `data: {id, type, ts, v, payload}`; a resume point ahead of this process starts with a stream.reset message",
      ),
    },
  }),
  "openapi.get": route({
    method: "GET",
    path: "/api/openapi.json",
    summary: "This document: the OpenAPI 3.1 description of the API, generated from the route table",
    tag: "system",
    scope: "monitor",
    responses: {
      200: z.object({
        openapi: z.literal("3.1.0"),
        info: z.object({
          title: z.string(),
          version: z.string(),
          description: z.string(),
          license: z.object({ name: z.string(), url: z.string() }),
        }),
        servers: z.array(z.object({ url: z.string(), description: z.string() })),
        /** The operations by path: their own shape is the OpenAPI specification's. */
        paths: z.record(z.record(z.unknown())),
        components: z.record(z.unknown()),
      }),
    },
  }),
} as const;
