import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from "fastify";
import fastifyStatic from "@fastify/static";
import { AppContext } from "./context.js";
import { registerSystemRoutes } from "./routes/system.js";
import { registerSkillRoutes } from "./routes/skills.js";
import { registerRunRoutes } from "./routes/runs.js";
import { registerMemoryRoutes } from "./routes/memory.js";
import { registerRoutineRoutes } from "./routes/routines.js";
import { registerConnectorRoutes } from "./routes/connectors.js";

const here = path.dirname(fileURLToPath(import.meta.url));

export interface ServerHandle {
  app: FastifyInstance;
  ctx: AppContext;
  url: string;
  close: () => Promise<void>;
}

export async function buildServer(ctx: AppContext): Promise<FastifyInstance> {
  const app = Fastify({ logger: false, bodyLimit: 5 * 1024 * 1024 });
  const token = ctx.token();

  // ---- Security layer (see docs/security.md, threats T1/T2) -----------------
  app.addHook("onRequest", async (req: FastifyRequest, reply: FastifyReply) => {
    // Host-header validation blocks DNS-rebinding style access.
    const host = (req.headers.host ?? "").split(":")[0];
    if (host && !["127.0.0.1", "localhost", "[::1]", "::1"].includes(host)) {
      return reply.code(403).send({ error: "Forbidden host" });
    }
    if (req.url.startsWith("/api/")) {
      const isMeta = req.url === "/api/meta";
      const supplied =
        (req.headers["x-mordomo-token"] as string | undefined) ??
        (req.query as Record<string, string | undefined>)?.token;
      if (!isMeta && supplied !== token) {
        return reply.code(401).send({ error: "Missing or invalid local token" });
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

  app.setErrorHandler((err: Error & { statusCode?: number }, _req, reply) => {
    const status = err.statusCode && err.statusCode >= 400 ? err.statusCode : 500;
    reply.code(status).send({ error: err.message });
  });

  // ---- API routes -----------------------------------------------------------
  registerSystemRoutes(app, ctx);
  registerSkillRoutes(app, ctx);
  registerRunRoutes(app, ctx);
  registerMemoryRoutes(app, ctx);
  registerRoutineRoutes(app, ctx);
  registerConnectorRoutes(app, ctx);

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
      if (req.url.startsWith("/api/")) return reply.code(404).send({ error: "Not found" });
      return serveIndex(req, reply);
    });
  } else {
    app.get("/", async () => ({
      name: "MordomoOS API",
      note: "Command Centre UI build not found. Run: npm run build -w apps/command-centre",
    }));
  }

  return app;
}

export async function startServer(homeOverride?: string): Promise<ServerHandle> {
  const ctx = new AppContext(homeOverride);
  const settings = ctx.settings();
  const app = await buildServer(ctx);

  const recovered = ctx.runs.recoverInterrupted();
  if (recovered > 0) {
    // eslint-disable-next-line no-console
    console.log(`[mordomo] marked ${recovered} orphaned run(s) as interrupted`);
  }
  ctx.scheduler.start();

  await app.listen({ port: settings.port, host: settings.bindAddress });
  const url = `http://127.0.0.1:${settings.port}`;

  const pidFile = path.join(ctx.paths.run, "server.pid");
  fs.mkdirSync(ctx.paths.run, { recursive: true });
  fs.writeFileSync(pidFile, JSON.stringify({ pid: process.pid, port: settings.port, startedAt: Date.now() }));

  const close = async () => {
    try {
      fs.unlinkSync(pidFile);
    } catch {
      /* already gone */
    }
    await app.close();
    ctx.close();
  };
  return { app, ctx, url, close };
}
