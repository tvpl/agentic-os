import crypto from "node:crypto";
import fs from "node:fs";
import https from "node:https";
import type { AddressInfo } from "node:net";
import path from "node:path";
import { Writable } from "node:stream";
import type { TLSSocket } from "node:tls";
import Fastify, {
  LogController,
  type FastifyContextConfig,
  type FastifyInstance,
  type FastifyReply,
  type FastifyRequest,
} from "fastify";
import fastifyStatic from "@fastify/static";
import { ZodError } from "zod";
import { EngineLockedError, PathAccessError } from "@mordomo/core";
import { API, type RouteDefinition } from "@mordomo/contracts";
import {
  JsonlLogger,
  TelegramPoller,
  certificateHosts,
  ensureTlsMaterial,
  redactSecrets,
  type DeviceScope,
  type TlsMaterial,
} from "@mordomo/core/internal";
import { AppContext } from "./context.js";
import { uiDistCandidates } from "./entry.js";
import {
  instanceSnapshot,
  listServiceProcesses,
  orphanProcesses,
  portHolder,
  terminate,
} from "./instances.js";
import { type UpdateChecker } from "./updates.js";
import { registerSystemRoutes } from "./routes/system.js";
import { registerSkillRoutes } from "./routes/skills.js";
import { registerRunRoutes } from "./routes/runs.js";
import { registerSessionRoutes } from "./routes/sessions.js";
import { registerNotificationRoutes } from "./routes/notifications.js";
import { registerDeviceRoutes } from "./routes/devices.js";
import { registerChannelRoutes } from "./routes/channels.js";
import { registerPushRoutes } from "./routes/push.js";
import { resolveApprovalForChat } from "./approvalActions.js";
import { registerMemoryRoutes } from "./routes/memory.js";
import { registerRoutineRoutes } from "./routes/routines.js";
import { registerConnectorRoutes } from "./routes/connectors.js";
import { registerMicroappRoutes } from "./routes/microapps.js";
import { registerEventRoutes } from "./routes/events.js";
import { registerObjectiveRoutes } from "./routes/objectives.js";
import { registerSentinelRoutes } from "./routes/sentinels.js";
import { closeAllSse } from "./routes/sse.js";
import { isApiRequest, isApiRoutePath, rewriteApiUrl, successorHeaders } from "./apiVersion.js";
import { SlidingWindow } from "./rateLimit.js";
import { registerOpenApiRoute } from "./openapi.js";
import { installResponseCheck, responsesValidated } from "./contract.js";
import { principalName, type Principal } from "./routes/common.js";
import { ticketKey } from "./tickets.js";
import { ignoredBindMessage, listenPlan } from "./transport.js";

export interface ServerHandle {
  app: FastifyInstance;
  ctx: AppContext;
  url: string;
  close: () => Promise<void>;
  /** The https URL for remote devices when remote.tls is on. */
  tlsUrl: string | null;
  /** Where the listeners bound: the one without TLS (loopback only) and the TLS one, when there is one. */
  listeners: { plain: { host: string; port: number }; tls: { host: string; port: number } | null };
}

/** Uniform error envelope. `message` is duplicated at the top level for older clients. */
export interface ApiErrorBody {
  error: { code: string; message: string; issues?: unknown[] };
  message: string;
}

export function errorBody(code: string, message: string, issues?: unknown[]): ApiErrorBody {
  return { error: issues ? { code, message, issues } : { code, message }, message };
}

// ---- Host / token checks (docs/security.md, threats T1/T2) -----------------

const ALLOWED_HOSTNAMES = new Set(["127.0.0.1", "localhost", "[::1]"]);

/**
 * Only loopback hosts may talk to the API (DNS-rebinding defence). Parsed with
 * `new URL` so bracketed IPv6 and ports are handled; a missing Host is refused.
 */
export function isAllowedHost(
  hostHeader: string | string[] | undefined,
  extraHosts: readonly string[] = [],
): boolean {
  const raw = Array.isArray(hostHeader) ? hostHeader[0] : hostHeader;
  if (!raw || !raw.trim()) return false;
  let url: URL;
  try {
    url = new URL(`http://${raw.trim()}`);
  } catch {
    return false;
  }
  // Reject anything that smuggled userinfo/path into the header.
  if (url.username || url.password || url.pathname !== "/" || url.search || url.hash) return false;
  const host = url.hostname.toLowerCase();
  if (ALLOWED_HOSTNAMES.has(host)) return true;
  // Remote access (Onda 3): hosts the user listed, matched on the host name
  // (with or without the port they wrote).
  return extraHosts.some((h) => {
    const entry = h.trim().toLowerCase();
    if (!entry) return false;
    try {
      const u = new URL(`http://${entry}`);
      return u.hostname === host && (!u.port || u.port === url.port);
    } catch {
      return false;
    }
  });
}

/** Loopback requests get the local token injected into the page; remote ones pair instead. */
export function isLoopbackHost(hostHeader: string | string[] | undefined): boolean {
  return isAllowedHost(hostHeader);
}

/** The TCP peer is this machine (the Host header alone can be forged by any client). */
export function isLoopbackAddress(address: string | undefined): boolean {
  if (!address) return false;
  const a = address.toLowerCase();
  return a === "::1" || a.startsWith("127.") || a.startsWith("::ffff:127.");
}

/**
 * The header names that say a proxy or a CDN stands between the visitor and this process: the standard ones
 * (`X-Forwarded-*` including `X-Forwarded-Host`, `Forwarded`, `Via`), the single-address ones proxies and CDNs add
 * (`X-Real-IP`, `X-Client-IP`, `True-Client-IP`, `Fastly-Client-IP`, `X-Envoy-External-Address`) and Cloudflare's own
 * (`CF-*`: `CF-Connecting-IP`, `CF-Ray`, `CF-Visitor`...). The list is closed: a header that is not in it is not read.
 */
const PROXY_HEADER =
  /^(?:x-forwarded-|x-original-forwarded-|x-real-ip$|x-client-ip$|true-client-ip$|fastly-client-ip$|x-envoy-external-address$|forwarded$|via$|cf-)/;

/**
 * Whether the request names a proxy on its way (`PROXY_HEADER`). A browser on this machine sends none of these; a
 * reverse proxy on this machine that forwards a visitor from elsewhere usually adds one, and that visitor must not
 * be handed the owner's token just because the proxy's own socket is loopback and it rewrote the `Host` header to
 * `127.0.0.1`. A proxy that adds none and rewrites `Host` cannot be told from the owner's browser:
 * `docs/security.md` (limits) says to keep the original `Host` or to add one of these.
 */
export function carriesProxyHeaders(headers: FastifyRequest["headers"]): boolean {
  return Object.keys(headers).some((name) => PROXY_HEADER.test(name.toLowerCase()));
}

/**
 * Whether a request for the page is a browser opening it, as opposed to a program fetching it (`curl
 * http://127.0.0.1:4777/`, which any process of this user, an agent's shell included, can do). A browser or a
 * web view that supports Fetch Metadata says `Sec-Fetch-Dest: document` and `Sec-Fetch-Mode: navigate`; one that
 * predates it (WebKit before 16.4) sends neither and a `Mozilla/5.0` user agent; a request from another origin
 * (`Origin` that is not this host) is never one. This is a reduction, not a boundary: a program can send those
 * headers too. Closing it takes a secret the launcher hands the browser; `docs/security.md` describes that design,
 * which `escopos-dispositivo` left unbuilt.
 */
export function looksLikeBrowserNavigation(req: FastifyRequest): boolean {
  const origin = req.headers.origin;
  if (typeof origin === "string" && origin !== "null") {
    try {
      if (new URL(origin).host !== req.headers.host) return false;
    } catch {
      return false;
    }
  }
  const dest = req.headers["sec-fetch-dest"];
  const mode = req.headers["sec-fetch-mode"];
  if (dest === undefined && mode === undefined) {
    return /^Mozilla\/5\.0 /.test(String(req.headers["user-agent"] ?? ""));
  }
  return dest === "document" && mode === "navigate";
}

/** Whether the connection this request arrived on is TLS (the second listener of `startServer`, or an https test). */
export function isTlsConnection(req: FastifyRequest): boolean {
  return (req.raw.socket as Partial<TLSSocket>).encrypted === true;
}

const TLS_REQUIRED_MESSAGE =
  "This service answers other machines over TLS only. Turn on Settings › Security › Remote access › TLS " +
  "(remote.enabled and remote.tls.enabled) and open the https address, or reach the service through a tunnel that runs on " +
  "this machine and forwards to 127.0.0.1 (list its host in remote.allowedHosts)";

const UNAUTHORIZED_MESSAGE = "Missing or invalid local token";

/**
 * Whether a paired device holding `held` may call a route that declares `needed`: a route with no scope, or an
 * `owner` one, is the owner's (denied by default); any other scope must be one the device holds.
 */
export function deviceVerdict(
  held: readonly DeviceScope[],
  needed: RouteScope | undefined,
): "ok" | "owner_only" | "scope_required" {
  if (needed === undefined || needed === "owner") return "owner_only";
  return held.includes(needed) ? "ok" : "scope_required";
}

/**
 * The principal a stream ticket was minted for, if it still counts: a device is checked again now (not revoked, not
 * expired, remote access on, still holding the scope of the route), so a ticket cannot outlive what its device lost.
 */
function redeemTicket(
  ctx: AppContext,
  ticket: string,
  key: string,
  config: FastifyContextConfig,
): Principal | null {
  const principal = ctx.streamTickets.redeem(ticket, key);
  if (!principal) return null;
  if (principal.kind === "owner") return principal;
  if (principal.kind !== "device" || !ctx.settings().remote.enabled) return null;
  const device = ctx.devices.active(principal.deviceId);
  if (!device || deviceVerdict(device.scopes, config.scope) !== "ok") return null;
  return principal;
}

/** The only routes a permission-broker credential may call (docs/security.md, AD-002). */
const BROKER_ROUTES = new Set([
  "POST /api/approvals/tool",
  "GET /api/approvals/:id",
  "POST /api/approvals/:id/resolve",
]);

/**
 * The only routes the credential of a memory skill's run may call (AD-012): the memory the skill works on, and
 * nothing of settings, devices, providers, approvals or other runs. The first set reads and is open to every run
 * with the credential; the second writes (a journal line, a fact) and only to a run that may write itself.
 */
const RUN_API_READ_ROUTES = new Set([
  "GET /api/memory/recall",
  "GET /api/memory/recall/stats",
  "GET /api/memory/journal",
  "GET /api/memory/facts",
]);
const RUN_API_WRITE_ROUTES = new Set(["POST /api/memory/journal/append", "POST /api/memory/facts"]);

declare module "fastify" {
  interface FastifyRequest {
    /** Set when the request carries a permission-broker credential: the run it is bound to. */
    brokerRunId: string | null;
    /** Who called an authenticated /api route (null on public routes and outside /api). */
    principal: Principal | null;
  }
  interface FastifyContextConfig {
    /** Reachable without a credential. Every other /api route is denied by default. */
    public?: boolean;
    /**
     * Who may call it (.specs/features/escopos-dispositivo, door 2). Required on every `/api` route that is not
     * `public`: registering one without it throws. `owner` - only the local token; a paired device gets
     * `403 owner_only`. Any other value is the scope a paired device must hold (`403 scope_required` otherwise).
     */
    scope?: RouteScope;
    /** A `GET` that may carry its credential in `?token=` (streams and `<img>`/`<iframe>` sources). */
    queryToken?: boolean;
    /** A `GET` that may carry a stream ticket in `?ticket=` (`POST /api/stream-tickets`), and refuses a device's `?token=`. */
    ticket?: boolean;
    /** The entry of the route table (`API`) this route was bound from (`bind`): the id its contract is known by. */
    route?: string;
  }
  interface FastifyInstance {
    /** Every /api route as registered (filled by an `onRoute` hook): the OpenAPI document's source. */
    apiRoutes: ApiRoute[];
    /**
     * Entries that belong to this server alone, beside the route table: empty in the service, filled only by the test
     * suite (`tests/helpers/syntheticEntry.ts`) to prove what the server does with an entry of its own. The table
     * `API` is frozen; nothing in the service writes here.
     */
    readonly syntheticEntries: Map<string, RouteDefinition>;
  }
}

/** The scope a route declares: the owner alone, or the scope of a paired device it needs. */
export type RouteScope = "owner" | DeviceScope;

export interface ApiRoute {
  method: string;
  url: string;
  config: FastifyContextConfig;
}

/** The entries of `table` that no route of the router was bound to, as the message the server stops with. */
export function unboundEntries(
  table: Readonly<Record<string, RouteDefinition>>,
  routes: readonly ApiRoute[],
): string[] {
  const bound = new Set(routes.map((r) => r.config.route));
  return Object.entries(table)
    .filter(([id]) => !bound.has(id))
    .map(
      ([id, entry]) =>
        `${entry.method} ${entry.path} (${id}) is in the route table but no route was bound to it`,
    );
}

export function tokenMatches(supplied: unknown, expected: string): boolean {
  if (typeof supplied !== "string" || supplied.length === 0) return false;
  const a = Buffer.from(supplied, "utf8");
  const b = Buffer.from(expected, "utf8");
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

/** Strip the token and the stream ticket from a URL before it reaches any log line. */
export function safeUrl(url: string): string {
  return url.replace(/([?&](?:token|ticket)=)[^&#]*/gi, "$1[REDACTED]");
}

/** The `error.code` of an error that raised a status and no code of its own. */
export function defaultErrorCode(status: number): string {
  return STATUS_CODES[status] ?? "error";
}

const STATUS_CODES: Record<number, string> = {
  400: "bad_request",
  401: "unauthorized",
  403: "forbidden",
  404: "not_found",
  409: "conflict",
  413: "payload_too_large",
  415: "unsupported_media_type",
  422: "unprocessable",
  429: "too_many_requests",
};

// ---- Request log: logs/api.jsonl through the secret redactor ---------------

function buildLoggerOptions(ctx: AppContext) {
  const limits = ctx.settings().limits;
  const jsonl = new JsonlLogger(ctx.paths.logs, "api", limits.logMaxFileBytes, limits.logRetentionDays);
  const stream = new Writable({
    write(chunk: Buffer | string, _enc, cb) {
      for (const line of chunk.toString().split("\n")) {
        if (!line.trim()) continue;
        try {
          jsonl.append(JSON.parse(redactSecrets(line)) as Record<string, unknown>);
        } catch {
          /* never let logging break a request */
        }
      }
      cb();
    },
  });
  return {
    level: "info",
    base: null,
    timestamp: false as const,
    messageKey: "msg",
    formatters: { level: (label: string) => ({ level: label }) },
    stream,
  };
}

export async function buildServer(
  ctx: AppContext,
  options: {
    uiDist?: string;
    updates?: UpdateChecker;
    /** Check each JSON response against its entry of the route table (default: `responsesValidated()`). */
    validateResponses?: boolean;
  } = {},
): Promise<FastifyInstance> {
  const app = Fastify({
    logger: buildLoggerOptions(ctx),
    // Our own onResponse hook writes the request line; Fastify's default
    // "incoming request"/"request completed" pair would double it.
    logController: new LogController({ disableRequestLogging: true }),
    bodyLimit: 5 * 1024 * 1024,
    // On close, drop idle keep-alive and SSE connections instead of waiting
    // for them: a browser tab holding `/api/events` open must not keep an old
    // service alive after a restart (that is how leftover processes were born).
    forceCloseConnections: true,
    // `/api/v1/<rest>` is served by the route registered as `/api/<rest>` (apiVersion.ts).
    rewriteUrl: (req) => rewriteApiUrl(req.url ?? "/"),
  });
  const token = ctx.token();
  app.decorateRequest("brokerRunId", null);
  app.decorateRequest("principal", null);
  app.decorate("apiRoutes", [] as ApiRoute[]);
  app.decorate("syntheticEntries", new Map<string, RouteDefinition>());
  app.addHook("onRoute", (route) => {
    if (!isApiRoutePath(route.url)) return;
    // Denied by default: a route that does not say who may call it does not exist.
    if (route.config?.public !== true && route.config?.scope === undefined) {
      throw new Error(
        `${[route.method].flat().join("/")} ${route.url} declares no scope: add config: { scope } (owner, monitor, content, run or approve), or public: true`,
      );
    }
    // One table describes the API: a route registered outside `bind` has no contract, so it does not exist.
    if (
      route.config?.route === undefined ||
      !(Object.hasOwn(API, route.config.route) || app.syntheticEntries.has(route.config.route))
    ) {
      throw new Error(
        `${[route.method].flat().join("/")} ${route.url} declares no contract: register it with bind(app, id, handler) and add its entry to the route table (contracts/src/api)`,
      );
    }
    for (const method of [route.method].flat()) {
      // HEAD twins of GET routes are added by Fastify itself.
      if (method !== "HEAD") app.apiRoutes.push({ method, url: route.url, config: route.config ?? {} });
    }
  });

  // Twenty 401s in five minutes lock an address out until the window passes;
  // this machine itself (loopback) is never locked out.
  const failedAuth = new SlidingWindow(20, 5 * 60_000);

  app.addHook("onRequest", async (req: FastifyRequest, reply: FastifyReply) => {
    // Another machine reaches this service over TLS or not at all (door 6): decided before anything is read from the
    // request, so a credential that crossed the network in the clear is never even compared. A tunnel or a reverse
    // proxy on this machine arrives from loopback and is not asked.
    if (!isLoopbackAddress(req.socket.remoteAddress) && !isTlsConnection(req)) {
      return reply.code(403).send(errorBody("tls_required", TLS_REQUIRED_MESSAGE));
    }
    const remote = ctx.settings().remote;
    const extraHosts = remote.enabled ? remote.allowedHosts : [];
    if (!isAllowedHost(req.headers.host, extraHosts)) {
      return reply.code(403).send(errorBody("forbidden_host", "Forbidden host"));
    }
    const wait = isLoopbackAddress(req.ip) ? 0 : failedAuth.retryAfter(req.ip);
    if (wait > 0) {
      return reply
        .code(429)
        .header("Retry-After", String(wait))
        .send(errorBody("too_many_requests", "Too many failed authentications from this address"));
    }
    // Decided on the route the router matched, never on the raw URL: the
    // router decodes the path, so `/%61pi/settings` is `/api/settings` here.
    const route = req.routeOptions.url;
    const config = req.routeOptions.config;
    const query = req.query as Record<string, string | undefined> | undefined;
    const queryToken = query?.token;
    const queryTicket = query?.ticket;
    const api = isApiRequest(req.url, route);
    // A token in the URL lands in proxy logs and browser history: only the
    // GETs that cannot send a header (EventSource, <img>, <iframe>) take one.
    // Refused on every other /api request (`isApiRequest`: matched or not, public
    // routes and methods without a route included) with 401, also on a path
    // that does not exist: 401 is the safer refusal, it never reveals which
    // spellings are routes (`req.url` is already rewritten from `/api/v1/…`).
    if (api && queryToken !== undefined && !(req.method === "GET" && config.queryToken === true)) {
      return reply
        .code(401)
        .send(
          errorBody("unauthorized", "This route does not accept a token in the URL; send x-mordomo-token"),
        );
    }
    // A ticket is no better than a token anywhere but the two streams it was made for.
    if (api && queryTicket !== undefined && !(req.method === "GET" && config.ticket === true)) {
      return reply.code(401).send(errorBody("unauthorized", UNAUTHORIZED_MESSAGE));
    }
    if (!isApiRoutePath(route) || config.public === true) return;
    if (config.ticket === true && queryTicket !== undefined) {
      const principal = redeemTicket(
        ctx,
        queryTicket,
        ticketKey(route, req.params as Record<string, unknown>),
        config,
      );
      if (!principal) return reply.code(401).send(errorBody("unauthorized", UNAUTHORIZED_MESSAGE));
      req.principal = principal;
      return;
    }
    const supplied = (req.headers["x-mordomo-token"] as string | undefined) ?? queryToken;
    if (tokenMatches(supplied, token)) {
      req.principal = { kind: "owner" };
      return;
    }
    const device = remote.enabled && typeof supplied === "string" ? ctx.devices.verify(supplied) : null;
    if (device) {
      // A device credential never rides in the URL of a stream: it asks for a ticket (door 5).
      if (config.ticket === true && supplied === queryToken && queryToken !== undefined) {
        return reply
          .code(401)
          .send(
            errorBody(
              "unauthorized",
              "A device opens this stream with a ticket: POST /api/v1/stream-tickets, then send ?ticket=",
            ),
          );
      }
      const needed = config.scope;
      const verdict = deviceVerdict(device.scopes, needed);
      if (verdict === "owner_only") {
        return reply
          .code(403)
          .send(errorBody("owner_only", "Only the owner, with the local token, can call this route"));
      }
      if (verdict === "scope_required") {
        return reply
          .code(403)
          .send(
            errorBody(
              "scope_required",
              `This device has no "${String(needed)}" permission; the owner grants it in Settings › Security › Remote access`,
            ),
          );
      }
      req.principal = { kind: "device", deviceId: device.id };
      return;
    }
    const broker = typeof supplied === "string" ? ctx.brokerRunFor(supplied) : null;
    if (broker?.active) {
      if (!BROKER_ROUTES.has(`${req.method} ${route}`)) {
        return reply.code(403).send(errorBody("forbidden", "The permission broker cannot call this route"));
      }
      req.brokerRunId = broker.runId;
      req.principal = { kind: "broker", runId: broker.runId };
      return;
    }
    const runApi = typeof supplied === "string" ? ctx.runApiRunFor(supplied) : null;
    if (runApi?.active) {
      const called = `${req.method} ${route}`;
      if (!RUN_API_READ_ROUTES.has(called) && !RUN_API_WRITE_ROUTES.has(called)) {
        return reply.code(403).send(errorBody("forbidden", "A run's credential cannot call this route"));
      }
      if (RUN_API_WRITE_ROUTES.has(called) && !runApi.writable) {
        return reply
          .code(403)
          .send(errorBody("forbidden", "The credential of a read-only run cannot write to the memory"));
      }
      req.principal = { kind: "run", runId: runApi.runId };
      return;
    }
    return reply.code(401).send(errorBody("unauthorized", UNAUTHORIZED_MESSAGE));
  });

  app.addHook("onSend", async (req, reply, payload) => {
    if (reply.statusCode === 401 && !isLoopbackAddress(req.ip)) failedAuth.hit(req.ip);
    reply.headers(successorHeaders(req));
    reply.header("X-Content-Type-Options", "nosniff");
    reply.header("X-Frame-Options", "DENY");
    reply.header("Referrer-Policy", "no-referrer");
    reply.header(
      "Content-Security-Policy",
      "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
    );
    return payload;
  });

  app.addHook("onResponse", async (req, reply) => {
    req.log.info({
      method: req.method,
      url: safeUrl(req.url),
      status: reply.statusCode,
      ms: Math.round(reply.elapsedTime * 10) / 10,
      reqId: req.id,
      // Who called: `owner`, `device:<id>`, `broker:<run>`, `run:<run>`; null on public routes.
      by: req.principal ? principalName(req.principal) : null,
    });
  });

  app.setErrorHandler(
    (err: Error & { statusCode?: number; code?: string; validation?: unknown }, req, reply) => {
      if (err instanceof ZodError) {
        const message = err.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`).join("; ");
        return reply.code(400).send(errorBody("validation", message, err.issues));
      }
      if (err instanceof PathAccessError || err.name === "PathAccessError") {
        return reply.code(403).send(errorBody("forbidden_path", err.message));
      }
      const status =
        typeof err.statusCode === "number" && err.statusCode >= 400 && err.statusCode <= 599
          ? err.statusCode
          : 500;
      // 502: an upstream (Telegram, a push service) refused; 503: the service cannot answer right now
      // (a closed database). Their reasons were written for the user.
      if (status < 500 || status === 502 || status === 503) {
        // Fastify's own codes (FST_ERR_*) are internal names; clients get the status's code.
        const own = typeof err.code === "string" && err.code && !err.code.startsWith("FST_");
        const code = own ? err.code! : defaultErrorCode(status);
        return reply.code(status).send(errorBody(code, err.message));
      }
      // Never leak internals (paths, stack, SQL) to the client; keep them in the log.
      req.log.error({ err, reqId: req.id, url: safeUrl(req.url), msg: "unhandled error" });
      return reply.code(500).send(errorBody("internal", "Internal error"));
    },
  );

  app.addHook("onClose", async () => {
    closeAllSse(app);
  });

  // Development and tests: a response that departs from its route's entry is a 500 that names the paths.
  if (options.validateResponses ?? responsesValidated()) installResponseCheck(app);

  // ---- API routes -----------------------------------------------------------
  registerSystemRoutes(app, ctx, { updates: options.updates });
  registerSkillRoutes(app, ctx);
  registerRunRoutes(app, ctx);
  registerSessionRoutes(app, ctx);
  registerSentinelRoutes(app, ctx);
  registerNotificationRoutes(app, ctx);
  registerDeviceRoutes(app, ctx);
  registerChannelRoutes(app, ctx);
  registerPushRoutes(app, ctx);
  registerMemoryRoutes(app, ctx);
  registerRoutineRoutes(app, ctx);
  registerConnectorRoutes(app, ctx);
  registerMicroappRoutes(app, ctx);
  registerEventRoutes(app, ctx);
  registerObjectiveRoutes(app, ctx);
  registerOpenApiRoute(app);
  // The table and the router describe the same API: an entry nobody bound is a route that was forgotten.
  const unbound = unboundEntries(API, app.apiRoutes);
  if (unbound.length > 0) throw new Error(unbound[0]);

  // ---- Command Centre static UI --------------------------------------------
  const uiDist =
    options.uiDist ??
    uiDistCandidates().find((dir) => fs.existsSync(path.join(dir, "index.html"))) ??
    uiDistCandidates()[0]!;
  const indexFile = path.join(uiDist, "index.html");
  if (fs.existsSync(indexFile)) {
    await app.register(fastifyStatic, {
      root: uiDist,
      // Vite replaces hashed assets on rebuild. Resolve files at request time
      // instead of freezing the list of routes when the daemon starts.
      wildcard: true,
      index: false,
    });
    const serveIndex = (req: FastifyRequest, reply: FastifyReply) => {
      // The local token is injected into the same-origin page only, and only
      // when the page is opened from this machine (loopback socket AND loopback
      // Host) and names no proxy on the way (`carriesProxyHeaders`); a remote device pairs and keeps its own token in
      // the browser.
      // Foreign origins cannot read the meta (CORS) nor send it (custom header + no CORS).
      const inject =
        isLoopbackHost(req.headers.host) &&
        isLoopbackAddress(req.socket.remoteAddress) &&
        !carriesProxyHeaders(req.headers) &&
        looksLikeBrowserNavigation(req)
          ? token
          : "";
      const html = fs
        .readFileSync(indexFile, "utf8")
        .replace(
          /<meta name="mordomo-token" content=""\s*\/?>/,
          `<meta name="mordomo-token" content="${inject}" />`,
        );
      reply.header("Cache-Control", "no-store").type("text/html; charset=utf-8").send(html);
    };
    app.get("/", serveIndex);
    app.get("/index.html", serveIndex);
    app.setNotFoundHandler((req, reply) => {
      const pathname = req.url.split("?")[0]!;
      if (
        (req.method !== "GET" && req.method !== "HEAD") ||
        isApiRequest(req.url, undefined) ||
        /^\/(?:assets|fonts|icons)(?:\/|$)/.test(pathname) ||
        path.posix.extname(pathname)
      ) {
        // Returning the SPA here makes browsers reject JS with a MIME error
        // and allows service workers to cache HTML under a hashed asset URL.
        return reply.header("Cache-Control", "no-store").code(404).send(errorBody("not_found", "Not found"));
      }
      return serveIndex(req, reply);
    });
  } else {
    app.get("/", async () => ({
      name: "MordomoOS API",
      note: "Command Centre UI build not found. Run: npm run build -w apps/command-centre",
    }));
    app.setNotFoundHandler((_req, reply) => reply.code(404).send(errorBody("not_found", "Not found")));
  }

  return app;
}

/**
 * TLS listener plan: only with remote access AND remote.tls on. The
 * certificate names every allowed host and is kept in config/tls/.
 */
export function tlsListenerFor(
  ctx: AppContext,
): { port: number; hosts: string[]; material: TlsMaterial } | null {
  const s = ctx.settings();
  if (!s.remote.enabled || !s.remote.tls.enabled) return null;
  const hosts = s.remote.allowedHosts.filter((h) => h.trim());
  const material = ensureTlsMaterial(ctx.paths.config, hosts);
  return {
    port: s.remote.tls.port ?? s.port + 1,
    hosts: certificateHosts(hosts).filter((h) => !["localhost", "127.0.0.1", "::1"].includes(h)),
    material,
  };
}

/**
 * Listen, retrying while the port is still held by a service we just asked to
 * stop (graceful shutdown can take a few seconds). Any other error is fatal.
 */
async function listenWithRetry(
  app: FastifyInstance,
  port: number,
  host: string,
  attempts: number,
): Promise<void> {
  for (let i = 1; ; i++) {
    try {
      await app.listen({ port, host });
      return;
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code !== "EADDRINUSE" || i >= attempts) throw err;
      await new Promise((r) => setTimeout(r, 250));
    }
  }
}

export async function startServer(homeOverride?: string): Promise<ServerHandle> {
  const ctx = new AppContext(homeOverride, { applyPendingRestore: true });
  const settings = ctx.settings();
  const app = await buildServer(ctx);

  if (ctx.restoreRejectedAtBoot) {
    app.log.warn({
      backup: ctx.restoreRejectedAtBoot.name,
      msg: `staged restore refused at boot: ${ctx.restoreRejectedAtBoot.message}`,
    });

    console.warn(
      `[mordomo] staged restore of ${ctx.restoreRejectedAtBoot.name} refused: ${ctx.restoreRejectedAtBoot.message}`,
    );
  }
  if (ctx.restoredAtBoot) {
    app.log.info({ backup: ctx.restoredAtBoot.name, msg: "applied staged restore at boot" });

    console.log(`[mordomo] applied staged restore of backup ${ctx.restoredAtBoot.name}`);
  }
  // Own the home: lock, prune, recover objective steps and orphaned runs, and
  // start the scheduler and the sentinels. A leftover MordomoOS service of this
  // same install still holding the lock is stopped first, as the port takeover
  // below does; anything else holding it is reported, never killed.
  let recovered: number;
  try {
    try {
      ({ recovered } = ctx.start());
    } catch (err) {
      if (!(err instanceof EngineLockedError) || err.holderPid === null) throw err;
      const leftover = listServiceProcesses().filter((p) => p.pid === err.holderPid);
      if (leftover.length === 0) throw err;
      const stopped = await terminate(leftover);
      app.log.warn({ pids: stopped, msg: "stopped the MordomoOS service holding the engine lock" });
      ({ recovered } = ctx.start());
    }
  } catch (err) {
    // Never leave a half-built service behind: no listener, no open database.
    await app.close();
    ctx.close();
    throw err;
  }
  if (recovered > 0) {
    app.log.info({ recovered, msg: "marked orphaned runs as interrupted" });

    console.log(`[mordomo] marked ${recovered} orphaned run(s) as interrupted`);
  }
  // Telegram inbound: approve / deny from the phone through the same code path as the UI button.
  ctx.telegramPoller = new TelegramPoller({
    getSettings: () => ctx.settings(),
    resolve: (id, decision, by) => resolveApprovalForChat(ctx, id, decision, by),
    pending: () =>
      ctx.approvals.list("pending").map((a) => ({ id: a.id, kind: a.kind, description: a.description })),
    onError: (message) => app.log.warn({ msg: `telegram inbound: ${message}` }),
  });
  ctx.telegramPoller.start();

  // Approvals nobody answered expire on their own, and the daily budget is
  // checked on the same beat: sweep at boot, then hourly.
  const sweepApprovals = () => {
    try {
      const expired = ctx.expireStaleApprovals();
      if (expired > 0) app.log.info({ expired, msg: "expired stale approvals" });
    } catch (err) {
      app.log.error({ err, msg: "approval sweep failed" });
    }
    try {
      const level = ctx.checkDailyBudget();
      if (level !== null) app.log.info({ level, msg: "daily budget threshold crossed" });
    } catch (err) {
      app.log.error({ err, msg: "budget check failed" });
    }
    try {
      ctx.sampleMetrics();
    } catch (err) {
      app.log.error({ err, msg: "metrics sample failed" });
    }
    // Silent routines, connector deltas and the did-it-twice detector. Async,
    // and it settles on its own: the sweep never waits for a connector read.
    void ctx.sentinels
      .hourly()
      .then((report) => {
        const fired = report.silentRoutines.length + report.connectorDeltas.length;
        if (fired > 0 || report.repeatSuggestions > 0) {
          app.log.info({ ...report, msg: "sentinel sweep" });
        }
      })
      .catch((err: unknown) => app.log.error({ err, msg: "sentinel sweep failed" }));
  };
  sweepApprovals();
  const approvalSweep = setInterval(sweepApprovals, 3_600_000);
  approvalSweep.unref?.();

  // A service that is starting is the one that should be running on its port.
  // Take the port first; only when it is busy do we stop what holds it — the
  // process listening there if it is a MordomoOS service, plus leftovers of
  // this same install (a lost port race, a restart still shutting down) — and
  // retry. Other homes and checkouts on other ports are never touched.
  const plan = listenPlan(settings);
  if (plan.ignoredBind !== null) {
    app.log.warn({ bindAddress: plan.ignoredBind, msg: ignoredBindMessage(plan.ignoredBind) });
    console.warn(`[mordomo] ${ignoredBindMessage(plan.ignoredBind)}`);
  }
  try {
    await app.listen({ port: settings.port, host: plan.plainHost });
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "EADDRINUSE") throw err;
    const snap = await instanceSnapshot(process.pid, 0);
    const holder = portHolder(settings.port);
    const holding = snap.processes.filter((p) => p.pid === holder);
    const leftovers = [
      ...holding,
      ...orphanProcesses(snap.processes, null, process.pid, undefined, snap.listening).filter(
        (p) => p.pid !== holder,
      ),
    ];
    if (leftovers.length === 0) throw err; // something else owns the port: report, never kill
    const stopped = await terminate(leftovers);
    app.log.warn({ pids: stopped, port: settings.port, msg: "stopped MordomoOS processes holding the port" });
    await listenWithRetry(app, settings.port, plan.plainHost, 40);
  }
  const url = `http://127.0.0.1:${settings.port}`;

  // Remote access over TLS (follow-up 10): a second listener with the
  // self-signed certificate, sharing the same request handler. Loopback keeps
  // plain http on `port` so local clients (CLI, MCP broker) never change.
  let tlsServer: https.Server | null = null;
  const tls = tlsListenerFor(ctx);
  if (tls) {
    tlsServer = https.createServer({ key: tls.material.keyPem, cert: tls.material.certPem }, (req, res) => {
      app.server.emit("request", req, res);
    });
    await new Promise<void>((resolve, reject) => {
      tlsServer!.once("error", reject);
      tlsServer!.listen(tls.port, plan.tlsHost ?? plan.plainHost, () => resolve());
    });
    app.log.info({ port: tls.port, fingerprint: tls.material.fingerprint, msg: "tls listener up" });
  }

  const pidFile = path.join(ctx.paths.run, "server.pid");
  fs.mkdirSync(ctx.paths.run, { recursive: true });
  fs.writeFileSync(pidFile, JSON.stringify({ pid: process.pid, port: settings.port, startedAt: Date.now() }));

  // ---- Lifecycle: idempotent close, signal + unhandledRejection safety net ---
  let closing: Promise<void> | null = null;
  const close = (): Promise<void> => {
    if (closing) return closing;
    closing = (async () => {
      if (tlsServer) await new Promise<void>((r) => tlsServer!.close(() => r()));
      process.off("SIGTERM", onSignal);
      process.off("SIGINT", onSignal);
      process.off("unhandledRejection", onRejection);
      clearInterval(approvalSweep);
      ctx.sentinels.stop();
      try {
        fs.unlinkSync(pidFile);
      } catch {
        /* already gone */
      }
      // Cancel/await active runs BEFORE the DB closes (audit item 4).
      try {
        await ctx.runs.shutdown(10_000);
      } catch (err) {
        app.log.error({ err, msg: "run shutdown failed" });
      }
      await app.close();
      ctx.close();
    })();
    return closing;
  };
  const onSignal = (signal: NodeJS.Signals) => {
    app.log.info({ signal, msg: "shutdown requested" });

    console.log(`[mordomo] ${signal} received — shutting down`);
    process.exitCode = 0;
    close().catch((err: unknown) => {
      app.log.error({ err, msg: "shutdown failed" });
      process.exitCode = 1;
    });
  };
  const onRejection = (reason: unknown) => {
    app.log.error({ err: reason, msg: "unhandledRejection" });

    console.error("[mordomo] unhandled rejection:", reason);
  };
  process.on("SIGTERM", onSignal);
  process.on("SIGINT", onSignal);
  process.on("unhandledRejection", onRejection);

  // What the sockets bound to, as the operating system reports it (not what was asked for).
  const bound = (server: { address(): unknown }) => {
    const address = server.address() as AddressInfo;
    return { host: address.address, port: address.port };
  };
  return {
    app,
    ctx,
    url,
    tlsUrl: tls ? `https://${tls.hosts[0] ?? "localhost"}:${tls.port}` : null,
    listeners: { plain: bound(app.server), tls: tlsServer ? bound(tlsServer) : null },
    close,
  };
}
