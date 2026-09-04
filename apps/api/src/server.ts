import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { Writable } from "node:stream";
import { fileURLToPath } from "node:url";
import Fastify, {
  LogController,
  type FastifyInstance,
  type FastifyReply,
  type FastifyRequest,
} from "fastify";
import fastifyStatic from "@fastify/static";
import { ZodError } from "zod";
import { JsonlLogger, PathAccessError, redactSecrets } from "@mordomo/core";
import { AppContext } from "./context.js";
import { registerSystemRoutes } from "./routes/system.js";
import { registerSkillRoutes } from "./routes/skills.js";
import { registerRunRoutes } from "./routes/runs.js";
import { registerSessionRoutes } from "./routes/sessions.js";
import { registerNotificationRoutes } from "./routes/notifications.js";
import { registerChannelRoutes } from "./routes/channels.js";
import { registerMemoryRoutes } from "./routes/memory.js";
import { registerRoutineRoutes } from "./routes/routines.js";
import { registerConnectorRoutes } from "./routes/connectors.js";
import { registerMicroappRoutes } from "./routes/microapps.js";
import { registerEventRoutes } from "./routes/events.js";
import { closeAllSse } from "./routes/sse.js";

const here = path.dirname(fileURLToPath(import.meta.url));

export interface ServerHandle {
  app: FastifyInstance;
  ctx: AppContext;
  url: string;
  close: () => Promise<void>;
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
export function isAllowedHost(hostHeader: string | string[] | undefined): boolean {
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
  return ALLOWED_HOSTNAMES.has(url.hostname.toLowerCase());
}

export function tokenMatches(supplied: unknown, expected: string): boolean {
  if (typeof supplied !== "string" || supplied.length === 0) return false;
  const a = Buffer.from(supplied, "utf8");
  const b = Buffer.from(expected, "utf8");
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

/** Strip the token from a URL before it reaches any log line. */
export function safeUrl(url: string): string {
  return url.replace(/([?&]token=)[^&#]*/gi, "$1[REDACTED]");
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

export async function buildServer(ctx: AppContext): Promise<FastifyInstance> {
  const app = Fastify({
    logger: buildLoggerOptions(ctx),
    // Our own onResponse hook writes the request line; Fastify's default
    // "incoming request"/"request completed" pair would double it.
    logController: new LogController({ disableRequestLogging: true }),
    bodyLimit: 5 * 1024 * 1024,
  });
  const token = ctx.token();

  app.addHook("onRequest", async (req: FastifyRequest, reply: FastifyReply) => {
    if (!isAllowedHost(req.headers.host)) {
      return reply.code(403).send(errorBody("forbidden_host", "Forbidden host"));
    }
    if (req.url.startsWith("/api/")) {
      const isMeta = req.url === "/api/meta";
      const supplied =
        (req.headers["x-mordomo-token"] as string | undefined) ??
        (req.query as Record<string, string | undefined>)?.token;
      if (!isMeta && !tokenMatches(supplied, token)) {
        return reply.code(401).send(errorBody("unauthorized", "Missing or invalid local token"));
      }
    }
  });

  app.addHook("onSend", async (_req, reply, payload) => {
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
      if (status < 500) {
        const code = typeof err.code === "string" && err.code ? err.code : (STATUS_CODES[status] ?? "error");
        return reply.code(status).send(errorBody(code, err.message));
      }
      // Never leak internals (paths, stack, SQL) to the client; keep them in the log.
      req.log.error({ err, reqId: req.id, url: safeUrl(req.url), msg: "unhandled error" });
      return reply.code(500).send(errorBody("internal", "Internal error"));
    },
  );

  app.addHook("onClose", async () => {
    closeAllSse();
  });

  // ---- API routes -----------------------------------------------------------
  registerSystemRoutes(app, ctx);
  registerSkillRoutes(app, ctx);
  registerRunRoutes(app, ctx);
  registerSessionRoutes(app, ctx);
  registerNotificationRoutes(app, ctx);
  registerChannelRoutes(app, ctx);
  registerMemoryRoutes(app, ctx);
  registerRoutineRoutes(app, ctx);
  registerConnectorRoutes(app, ctx);
  registerMicroappRoutes(app, ctx);
  registerEventRoutes(app, ctx);

  // ---- Command Centre static UI --------------------------------------------
  const uiDist = path.resolve(here, "..", "..", "command-centre", "dist");
  const indexFile = path.join(uiDist, "index.html");
  if (fs.existsSync(indexFile)) {
    await app.register(fastifyStatic, {
      root: uiDist,
      wildcard: false,
      index: false,
    });
    const serveIndex = (_req: FastifyRequest, reply: FastifyReply) => {
      // The local token is injected into the same-origin page only; foreign
      // origins cannot read it (CORS) nor send it (custom header + no CORS).
      const html = fs
        .readFileSync(indexFile, "utf8")
        .replace(
          /<meta name="mordomo-token" content=""\s*\/?>/,
          `<meta name="mordomo-token" content="${token}" />`,
        );
      reply.type("text/html; charset=utf-8").send(html);
    };
    app.get("/", serveIndex);
    app.setNotFoundHandler((req, reply) => {
      if (req.url.startsWith("/api/")) return reply.code(404).send(errorBody("not_found", "Not found"));
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

export async function startServer(homeOverride?: string): Promise<ServerHandle> {
  const ctx = new AppContext(homeOverride, { applyPendingRestore: true });
  const settings = ctx.settings();
  const app = await buildServer(ctx);

  if (ctx.restoredAtBoot) {
    app.log.info({ backup: ctx.restoredAtBoot.name, msg: "applied staged restore at boot" });

    console.log(`[mordomo] applied staged restore of backup ${ctx.restoredAtBoot.name}`);
  }
  const recovered = ctx.runs.recoverInterrupted();
  if (recovered > 0) {
    app.log.info({ recovered, msg: "marked orphaned runs as interrupted" });

    console.log(`[mordomo] marked ${recovered} orphaned run(s) as interrupted`);
  }
  ctx.scheduler.start();
  // The sentinels observe on the same lifecycle as the scheduler; their hourly
  // pass rides the sweep below instead of arming a timer of its own.
  ctx.sentinels.start();

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

  await app.listen({ port: settings.port, host: settings.bindAddress });
  const url = `http://127.0.0.1:${settings.port}`;

  const pidFile = path.join(ctx.paths.run, "server.pid");
  fs.mkdirSync(ctx.paths.run, { recursive: true });
  fs.writeFileSync(pidFile, JSON.stringify({ pid: process.pid, port: settings.port, startedAt: Date.now() }));

  // ---- Lifecycle: idempotent close, signal + unhandledRejection safety net ---
  let closing: Promise<void> | null = null;
  const close = (): Promise<void> => {
    if (closing) return closing;
    closing = (async () => {
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

  return { app, ctx, url, close };
}
