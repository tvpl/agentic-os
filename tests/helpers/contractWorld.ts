import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { vi } from "vitest";
import type { FastifyInstance } from "fastify";
import { API, routeKey, type RouteDefinition } from "@mordomo/contracts";
import { SkillRegistry, b64url, createNote, type Fetcher } from "@mordomo/core/internal";
import { AppContext } from "../../apps/api/src/context.js";
import { buildServer } from "../../apps/api/src/server.js";
import { FAKE_BIN, makeTempHome, withFakeBinPath } from "../helpers.js";

/**
 * The world the contract tests call: a home with everything a route needs to answer with success (a finished run and
 * its conversation, an approval, a device, an objective, facts, a backup, a push subscription, files), and one
 * scenario for each route of the table. A scenario is how that route is called so that it answers a success status.
 */

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
export const TELEGRAM_ENV = "MORDOMO_CONTRACT_TEST_TELEGRAM_TOKEN";
const REGISTRY = "https://skills.example/index.json";
const REGISTRY_SKILL = "---\nname: Hello Registry\ndescription: says hi\n---\n\n# Hello\n\nSay hi.\n";
const sha = (text: string) => crypto.createHash("sha256").update(text).digest("hex");

const registryFetcher: Fetcher = async (url) => {
  const enc = (s: string) => new TextEncoder().encode(s);
  if (url === REGISTRY) {
    const index = {
      name: "Test",
      skills: [
        {
          slug: "hello-registry",
          name: "Hello Registry",
          description: "says hi",
          version: "1.2.0",
          files: {
            "SKILL.md": { url: "https://skills.example/hello/SKILL.md", sha256: sha(REGISTRY_SKILL) },
          },
        },
      ],
    };
    return { ok: true, status: 200, bytes: enc(JSON.stringify(index)) };
  }
  if (url === "https://skills.example/hello/SKILL.md")
    return { ok: true, status: 200, bytes: enc(REGISTRY_SKILL) };
  return { ok: false, status: 404, bytes: new Uint8Array() };
};

export interface Answer {
  status: number;
  body: unknown;
  headers: Record<string, unknown>;
  /** For a stream: the frames read. For a file: the byte length. */
  raw?: { frames?: unknown[]; bytes?: number };
}

export interface World {
  ctx: AppContext;
  app: FastifyInstance;
  token: string;
  home: string;
  workspace: string;
  /** Where the app listens, for the routes that stream. */
  baseUrl: string;
  ids: {
    runId: string;
    sessionId: string;
    approvalId: string;
    deviceId: string;
    deviceToken: string;
    objectiveId: string;
    stepId: string;
    routineId: string;
    connectorId: string;
    factId: number;
    notificationId: string;
    backupName: string;
    pushId: string;
    pushEndpoint: string;
    skillSlug: string;
    noteFile: string;
    imageFile: string;
  };
  /** Which spelling of the path the scenarios use: `/api/v1/…` (default) or the unversioned alias. */
  spelling: "v1" | "legacy";
  call(method: string, url: string, payload?: unknown, headers?: Record<string, string>): Promise<Answer>;
  stream(url: string, opts: { emit?: () => void; frames: number; waitMs: number }): Promise<Answer>;
  close(): Promise<void>;
}

const png1x1 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgYGD4DwABBAEAwS2OUAAAAABJRU5ErkJggg==",
  "base64",
);

export async function buildWorld(options: { validateResponses?: boolean } = {}): Promise<World> {
  const restorePath = withFakeBinPath();
  const tmp = makeTempHome("mordomo-contract-");
  const home = tmp.paths.home;
  for (const dir of ["skills", "routines", "connectors"]) {
    fs.cpSync(path.join(repoRoot, dir), path.join(home, dir), { recursive: true });
  }
  const workspace = path.join(home, "ws");
  fs.mkdirSync(workspace);
  fs.writeFileSync(
    path.join(workspace, "plan.md"),
    "# Plano\nOrçamento trimestral do projeto Alfa.\nstatus:: ativo\n",
  );
  fs.writeFileSync(path.join(workspace, "notes.md"), "# Notas\nVeja o [plano](plan.md).\n");

  process.env[TELEGRAM_ENV] = "123:abc";
  const ctx = new AppContext(home, { pushResolver: async () => ["93.184.216.34"] });
  const settings = ctx.settings();
  settings.setupCompleted = true;
  settings.remote.enabled = true;
  settings.providers.claude.enabled = true;
  settings.providers.claude.binaryPath = path.join(FAKE_BIN, "claude");
  settings.indexedFolders = [{ path: workspace, area: "Projetos", enabled: true }];
  settings.areas = ["Projetos"];
  // Two work contexts the scenarios change and delete (cerebro-contextos): they live in settings.json, like the rest.
  settings.contexts = [
    { id: "contract-context", name: "Contexto do contrato", paths: [workspace] },
    { id: "contract-context-gone", name: "Contexto que some", paths: [workspace] },
  ];
  settings.channels.telegram.botTokenEnv = TELEGRAM_ENV;
  settings.channels.telegram.chatId = "12345";
  settings.channels.push.enabled = true;
  settings.marketplace = { registries: [REGISTRY] };
  ctx.settingsStore.save(settings);
  ctx.reloadAdapters();
  (ctx as unknown as { skillRegistry: SkillRegistry }).skillRegistry = new SkillRegistry(registryFetcher);
  const token = ctx.token();
  const app = await buildServer(ctx, { validateResponses: options.validateResponses ?? true });
  await app.listen({ port: 0, host: "127.0.0.1" });
  const address = app.server.address();
  const baseUrl = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`;

  const spell = (url: string) =>
    (world?.spelling ?? "v1") === "v1" ? url.replace(/^\/api\//, "/api/v1/") : url;

  // eslint-disable-next-line prefer-const -- `world` is assigned below, after the seed calls that use `call`
  let world: World;
  const call: World["call"] = async (method, url, payload, headers = {}) => {
    const res = await app.inject({
      method: method as "GET",
      url: spell(url),
      headers: { "x-mordomo-token": token, ...headers },
      ...(payload === undefined ? {} : { payload: payload as object }),
    });
    let body: unknown = res.body;
    if (String(res.headers["content-type"] ?? "").includes("application/json")) body = res.json();
    return {
      status: res.statusCode,
      body,
      headers: res.headers,
      raw: { bytes: res.rawPayload.length },
    };
  };

  const stream: World["stream"] = (url, opts) =>
    new Promise((resolve, reject) => {
      const frames: unknown[] = [];
      let status = 0;
      let headers: Record<string, unknown> = {};
      const req = http.get(`${baseUrl}${spell(url)}`, { headers: { "x-mordomo-token": token } }, (res) => {
        status = res.statusCode ?? 0;
        headers = res.headers;
        let buffer = "";
        const done = () => {
          req.destroy();
          resolve({ status, body: undefined, headers, raw: { frames } });
        };
        res.setEncoding("utf8");
        res.on("data", (chunk: string) => {
          buffer += chunk;
          let at: number;
          while ((at = buffer.indexOf("\n\n")) >= 0) {
            const message = buffer.slice(0, at);
            buffer = buffer.slice(at + 2);
            const data = message
              .split("\n")
              .filter((l) => l.startsWith("data: "))
              .map((l) => l.slice(6))
              .join("\n");
            if (data) frames.push(JSON.parse(data));
          }
          if (frames.length >= opts.frames) done();
        });
        res.on("end", done);
        // The service greets with a comment line (`connected …`): after it, the feed is live.
        setTimeout(() => opts.emit?.(), 150);
      });
      req.on("error", (err) => {
        if ((err as NodeJS.ErrnoException).code !== "ECONNRESET") reject(err);
      });
      setTimeout(() => {
        req.destroy();
        resolve({ status, body: undefined, headers, raw: { frames } });
      }, opts.waitMs);
    });

  // ---- seed: a finished run and its conversation, through the API like a person would
  const created = await call("POST", "/api/runs", { prompt: "olá" });
  const runId = (created.body as { runId: string }).runId;
  const sessionId = (created.body as { sessionId: string }).sessionId;
  await finished(call, runId);

  const approval = ctx.approvals.request("tool_use", "Write: a", { runId });
  const device = (() => {
    ctx.devices.startPairing("phone");
    const code = ctx.devices.pairingOpen()!.code;
    const claimed = ctx.devices.claim(code, "phone")!;
    return { id: claimed.device.id, token: claimed.token };
  })();
  const objective = await call("POST", "/api/objectives", {
    title: "Meta",
    steps: [{ title: "Passo", request: { version: 1, kind: "prompt", prompt: "faça", mode: "read_only" } }],
  });
  const objectiveBody = objective.body as { id: string; steps: Array<{ id: string }> };
  const fact = await call("POST", "/api/memory/facts", {
    subject: "Alfa",
    predicate: "status",
    object: "ativo",
  });
  ctx.events.emit("index.failed", { code: "index_scan_incomplete", previousIndexPreserved: true });
  const notifications = (await call("GET", "/api/notifications")).body as { items: Array<{ id: string }> };
  const backup = await call("POST", "/api/backups", {});
  await call("POST", "/api/memory/index");

  const ua = crypto.createECDH("prime256v1");
  ua.generateKeys();
  const pushEndpoint = "https://push.example.net/sub/abc";
  const pushed = await call("POST", "/api/push/subscribe", {
    subscription: {
      endpoint: pushEndpoint,
      keys: { p256dh: b64url.encode(ua.getPublicKey()), auth: b64url.encode(crypto.randomBytes(16)) },
    },
    label: "browser",
  });

  const skillSlug = "contract-skill";
  await call("POST", "/api/skills", {
    frontmatter: { name: "Contract skill", slug: skillSlug, description: "for the contract tests" },
    body: "# Procedure\nDo the thing.",
  });
  fs.writeFileSync(path.join(home, "skills", skillSlug, "brand.md"), "# Brand\n");
  await call("POST", `/api/skills/${skillSlug}/notes`, { text: "- keep it short" });

  const artifactDir = path.join(ctx.paths.artifacts, runId);
  fs.mkdirSync(artifactDir, { recursive: true });
  const noteFile = path.join(artifactDir, "note.md");
  const imageFile = path.join(artifactDir, "image.png");
  fs.writeFileSync(noteFile, "# Note\nan artifact\n");
  fs.writeFileSync(imageFile, png1x1);

  const routines = (await call("GET", "/api/routines")).body as Array<{ id: string }>;
  const connectors = (await call("GET", "/api/connectors")).body as Array<{ id: string }>;

  world = {
    spelling: "v1",
    ctx,
    app,
    token,
    home,
    workspace,
    baseUrl,
    ids: {
      runId,
      sessionId,
      approvalId: approval.id,
      deviceId: device.id,
      deviceToken: device.token,
      objectiveId: objectiveBody.id,
      stepId: objectiveBody.steps[0]!.id,
      routineId: routines[0]!.id,
      connectorId: connectors.find((c) => c.id === "pixel-studio")?.id ?? connectors[0]!.id,
      factId: (fact.body as { fact: { id: number } }).fact.id,
      notificationId: notifications.items[0]!.id,
      backupName: (backup.body as { name: string }).name,
      pushId: (pushed.body as { id: string }).id,
      pushEndpoint,
      skillSlug,
      noteFile,
      imageFile,
    },
    call,
    stream,
    async close() {
      await app.close();
      ctx.close();
      delete process.env[TELEGRAM_ENV];
      restorePath();
      tmp.cleanup();
    },
  };
  return world;
}

/** Wait until a run is no longer queued or running. */
export async function finished(call: World["call"], runId: string): Promise<void> {
  for (let i = 0; i < 200; i++) {
    const run = (await call("GET", `/api/runs/${runId}`)).body as { run: { status: string } };
    if (!["queued", "running"].includes(run.run.status)) return;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error(`run ${runId} did not finish`);
}

// ---- the scenarios ----------------------------------------------------------------------------------------------

export interface Scenario {
  /** How the route is called so that it answers a success status. */
  run: (w: World) => Promise<Answer>;
  /** The success statuses the call may answer. */
  statuses?: number[];
}

const key = (method: string, path: string) => `${method} ${path}`;

/** A queued run nobody executes: something to cancel, to ask a tool approval for, to be a victim. */
function queuedRun(w: World): string {
  return w.ctx.runs.create({
    origin: "manual",
    provider: "claude",
    prompt: "queued",
    cwd: w.ctx.runs.defaultCwd(),
    model: null,
    effort: "default",
    mode: "read_only",
    timeoutMs: 60_000,
    profile: "read_only",
    startedBy: "owner",
  }).id;
}

const uuid = () => crypto.randomUUID();

/**
 * One scenario for each route, by `METHOD path` as the router knows it. The order matters for the routes that change
 * what the others read: it is the order of this object, destructive ones last.
 */
/** A note made by the engine itself (clean of any fault a probe injects into the request that follows). */
const noteOf = (w: World, title: string) =>
  createNote({ paths: w.ctx.paths, settings: w.ctx.settings() }, { title });

export const SCENARIOS: Record<string, Scenario> = {
  // ---- reads
  [key("GET", "/api/system/info")]: { run: (w) => w.call("GET", "/api/system/info") },
  [key("GET", "/api/updates")]: { run: (w) => w.call("GET", "/api/updates") },
  [key("GET", "/api/meta")]: { run: (w) => w.call("GET", "/api/meta", undefined, { "x-mordomo-token": "" }) },
  [key("GET", "/api/health")]: { run: (w) => w.call("GET", "/api/health") },
  [key("GET", "/api/settings")]: { run: (w) => w.call("GET", "/api/settings") },
  [key("GET", "/api/ui-preferences")]: { run: (w) => w.call("GET", "/api/ui-preferences") },
  [key("GET", "/api/providers")]: { run: (w) => w.call("GET", "/api/providers") },
  [key("GET", "/api/providers/:id/models")]: { run: (w) => w.call("GET", "/api/providers/claude/models") },
  [key("GET", "/api/doctor")]: { run: (w) => w.call("GET", "/api/doctor?audit=0") },
  [key("GET", "/api/metrics/history")]: { run: (w) => w.call("GET", "/api/metrics/history?days=3") },
  [key("GET", "/api/approvals")]: { run: (w) => w.call("GET", "/api/approvals") },
  [key("GET", "/api/approvals/:id")]: { run: (w) => w.call("GET", `/api/approvals/${w.ids.approvalId}`) },
  [key("GET", "/api/backups")]: { run: (w) => w.call("GET", "/api/backups") },
  [key("GET", "/api/backups/restore-pending")]: { run: (w) => w.call("GET", "/api/backups/restore-pending") },
  [key("GET", "/api/sync/plan")]: { run: (w) => w.call("GET", "/api/sync/plan") },
  [key("GET", "/api/artifacts/list")]: { run: (w) => w.call("GET", "/api/artifacts/list") },
  [key("GET", "/api/artifacts/raw")]: {
    run: (w) => w.call("GET", `/api/artifacts/raw?p=${encodeURIComponent(w.ids.imageFile)}`),
  },
  [key("GET", "/api/startup-plan")]: { run: (w) => w.call("GET", "/api/startup-plan") },
  [key("GET", "/api/diagnostics/export")]: { run: (w) => w.call("GET", "/api/diagnostics/export") },
  [key("GET", "/api/runs")]: { run: (w) => w.call("GET", "/api/runs?limit=5") },
  [key("GET", "/api/runs/:id")]: { run: (w) => w.call("GET", `/api/runs/${w.ids.runId}`) },
  [key("GET", "/api/runs/:id/children")]: { run: (w) => w.call("GET", `/api/runs/${w.ids.runId}/children`) },
  [key("GET", "/api/runs/:id/diff")]: {
    run: (w) =>
      w.call(
        "GET",
        `/api/runs/${w.ids.runId}/diff?file=${encodeURIComponent(path.join(w.workspace, "plan.md"))}`,
      ),
  },
  [key("GET", "/api/runs/:id/stream")]: {
    run: (w) => w.stream(`/api/runs/${w.ids.runId}/stream`, { frames: 1000, waitMs: 5000 }),
  },
  [key("GET", "/api/metrics")]: { run: (w) => w.call("GET", "/api/metrics") },
  [key("GET", "/api/artifacts/recent")]: { run: (w) => w.call("GET", "/api/artifacts/recent") },
  [key("GET", "/api/artifacts/file")]: {
    run: (w) => w.call("GET", `/api/artifacts/file?p=${encodeURIComponent(w.ids.noteFile)}`),
  },
  [key("GET", "/api/sessions")]: { run: (w) => w.call("GET", "/api/sessions") },
  [key("GET", "/api/sessions/:id")]: { run: (w) => w.call("GET", `/api/sessions/${w.ids.sessionId}`) },
  [key("GET", "/api/skills")]: { run: (w) => w.call("GET", "/api/skills") },
  [key("GET", "/api/skills/:slug")]: { run: (w) => w.call("GET", `/api/skills/${w.ids.skillSlug}`) },
  [key("GET", "/api/skills/:slug/resource")]: {
    run: (w) => w.call("GET", `/api/skills/${w.ids.skillSlug}/resource?rel=brand.md`),
  },
  [key("GET", "/api/skills/:slug/notes")]: {
    run: (w) => w.call("GET", `/api/skills/${w.ids.skillSlug}/notes`),
  },
  [key("GET", "/api/skills/registry")]: { run: (w) => w.call("GET", "/api/skills/registry") },
  [key("GET", "/api/routines")]: { run: (w) => w.call("GET", "/api/routines") },
  [key("GET", "/api/routines/summary")]: { run: (w) => w.call("GET", "/api/routines/summary") },
  [key("GET", "/api/routines/silent")]: { run: (w) => w.call("GET", "/api/routines/silent?days=7") },
  [key("GET", "/api/routines/:id/history")]: {
    run: (w) => w.call("GET", `/api/routines/${w.ids.routineId}/history`),
  },
  [key("GET", "/api/connectors")]: { run: (w) => w.call("GET", "/api/connectors") },
  [key("GET", "/api/connectors/audit")]: { run: (w) => w.call("GET", "/api/connectors/audit") },
  [key("GET", "/api/connectors/:id/data")]: {
    run: (w) => w.call("GET", `/api/connectors/${w.ids.connectorId}/data?refresh=1`),
  },
  [key("GET", "/api/connectors/:id/setup")]: {
    run: (w) => w.call("GET", `/api/connectors/${w.ids.connectorId}/setup`),
  },
  [key("GET", "/api/objectives")]: { run: (w) => w.call("GET", "/api/objectives") },
  [key("GET", "/api/objectives/:id")]: { run: (w) => w.call("GET", `/api/objectives/${w.ids.objectiveId}`) },
  [key("GET", "/api/sentinels")]: { run: (w) => w.call("GET", "/api/sentinels") },
  [key("GET", "/api/memory/status")]: { run: (w) => w.call("GET", "/api/memory/status") },
  [key("GET", "/api/memory/search")]: { run: (w) => w.call("GET", "/api/memory/search?q=Alfa") },
  [key("GET", "/api/memory/graph")]: { run: (w) => w.call("GET", "/api/memory/graph") },
  [key("GET", "/api/memory/related")]: {
    run: async (w) => {
      const hits = (await w.call("GET", "/api/memory/search?q=Alfa")).body as Array<{ id: number }>;
      return w.call("GET", `/api/memory/related?id=${hits[0]?.id ?? 1}`);
    },
  },
  [key("GET", "/api/memory/preview")]: {
    run: (w) =>
      w.call("GET", `/api/memory/preview?p=${encodeURIComponent(path.join(w.workspace, "plan.md"))}`),
  },
  [key("GET", "/api/memory/routers/check")]: { run: (w) => w.call("GET", "/api/memory/routers/check") },
  // cerebro-organizar, door 4: the folder map over the indexed workspace and memory/notes/.
  [key("GET", "/api/memory/maps")]: { run: (w) => w.call("GET", "/api/memory/maps") },
  // cerebro-vista-notas, door 1: one level of the notes tree, from the index rows.
  [key("GET", "/api/memory/tree")]: { run: (w) => w.call("GET", "/api/memory/tree") },
  [key("GET", "/api/memory/recall")]: { run: (w) => w.call("GET", "/api/memory/recall?q=Alfa&record=false") },
  [key("GET", "/api/memory/recall/stats")]: { run: (w) => w.call("GET", "/api/memory/recall/stats") },
  [key("GET", "/api/memory/journal")]: { run: (w) => w.call("GET", "/api/memory/journal") },
  [key("GET", "/api/memory/hygiene")]: { run: (w) => w.call("GET", "/api/memory/hygiene") },
  [key("GET", "/api/memory/facts")]: { run: (w) => w.call("GET", "/api/memory/facts") },
  [key("GET", "/api/memory/query")]: { run: (w) => w.call("GET", "/api/memory/query?where=status") },
  [key("GET", "/api/memory/links")]: {
    run: async (w) => {
      const hits = (await w.call("GET", "/api/memory/search?q=Alfa")).body as Array<{ id: number }>;
      return w.call("GET", `/api/memory/links?id=${hits[0]?.id ?? 1}`);
    },
  },
  [key("GET", "/api/memory/note")]: {
    run: (w) =>
      w.call("GET", `/api/memory/note?p=${encodeURIComponent(noteOf(w, "Cenário de leitura").path)}`),
  },
  [key("GET", "/api/contexts")]: { run: (w) => w.call("GET", "/api/contexts") },
  [key("GET", "/api/devices")]: { run: (w) => w.call("GET", "/api/devices") },
  [key("GET", "/api/notifications")]: { run: (w) => w.call("GET", "/api/notifications") },
  [key("GET", "/api/push/vapid")]: { run: (w) => w.call("GET", "/api/push/vapid") },
  [key("GET", "/api/push/subscriptions")]: { run: (w) => w.call("GET", "/api/push/subscriptions") },
  [key("GET", "/api/channels/telegram/status")]: {
    run: (w) => w.call("GET", "/api/channels/telegram/status"),
  },
  [key("GET", "/api/openapi.json")]: { run: (w) => w.call("GET", "/api/openapi.json") },
  [key("GET", "/api/events")]: {
    run: (w) =>
      w.stream("/api/events", {
        frames: 1,
        waitMs: 4000,
        emit: () => w.ctx.events.emit("approval.expired", { count: 1 }),
      }),
  },

  // ---- writes that change nothing the reads above need
  [key("POST", "/api/stream-tickets")]: {
    run: (w) => w.call("POST", "/api/stream-tickets", { target: "events" }),
  },
  [key("PUT", "/api/settings")]: { run: (w) => w.call("PUT", "/api/settings", { systemName: "MordomoOS" }) },
  [key("PUT", "/api/ui-preferences")]: {
    run: (w) => w.call("PUT", "/api/ui-preferences", { themePreset: "ocean" }),
  },
  [key("POST", "/api/providers/:id/detect")]: { run: (w) => w.call("POST", "/api/providers/claude/detect") },
  [key("PUT", "/api/providers/default")]: {
    run: (w) => w.call("PUT", "/api/providers/default", { provider: "claude" }),
  },
  [key("POST", "/api/providers/:id/smoke")]: { run: (w) => w.call("POST", "/api/providers/claude/smoke") },
  [key("POST", "/api/approvals/tool")]: {
    run: async (w) => {
      const id = queuedRun(w);
      const answer = await w.call("POST", "/api/approvals/tool", {
        runId: id,
        toolName: "Bash",
        input: { command: "ls" },
      });
      await w.ctx.runs.cancel(id);
      return answer;
    },
  },
  [key("POST", "/api/approvals/:id/resolve")]: {
    run: (w) => w.call("POST", `/api/approvals/${w.ids.approvalId}/resolve`, { decision: "denied" }),
  },
  [key("POST", "/api/backups")]: { run: (w) => w.call("POST", "/api/backups", {}) },
  [key("POST", "/api/sync/apply")]: { run: (w) => w.call("POST", "/api/sync/apply", {}) },
  [key("POST", "/api/runs")]: {
    run: (w) => w.call("POST", "/api/runs", { prompt: "outra" }),
    statuses: [200],
  },
  [key("POST", "/api/runs/:id/children")]: {
    run: (w) => w.call("POST", `/api/runs/${w.ids.runId}/children`, { prompts: ["a", "b"] }),
  },
  [key("POST", "/api/runs/:id/cancel")]: {
    run: (w) => w.call("POST", `/api/runs/${queuedRun(w)}/cancel`),
  },
  [key("POST", "/api/runs/:id/retry")]: {
    run: (w) => w.call("POST", `/api/runs/${w.ids.runId}/retry`, { submissionId: uuid() }),
  },
  [key("POST", "/api/sessions/:id/continue")]: {
    run: (w) => w.call("POST", `/api/sessions/${w.ids.sessionId}/continue`, { prompt: "mais" }),
  },
  [key("PATCH", "/api/sessions/:id")]: {
    run: (w) => w.call("PATCH", `/api/sessions/${w.ids.sessionId}`, { title: "Renomeada" }),
  },
  [key("POST", "/api/skills")]: {
    run: (w) =>
      w.call("POST", "/api/skills", {
        frontmatter: { name: "Second", slug: "contract-second", description: "another" },
        body: "# Body",
      }),
  },
  [key("PUT", "/api/skills/:slug")]: {
    run: (w) =>
      w.call("PUT", `/api/skills/${w.ids.skillSlug}`, {
        frontmatter: { name: "Contract skill", slug: w.ids.skillSlug, description: "edited", enabled: true },
        body: "# Procedure\nDo the thing, better.",
      }),
  },
  [key("POST", "/api/skills/:slug/notes")]: {
    run: (w) => w.call("POST", `/api/skills/${w.ids.skillSlug}/notes`, { text: "another note" }),
  },
  [key("POST", "/api/skills/:slug/notes/promote")]: {
    run: async (w) => {
      w.ctx.settingsStore.update({ securityProfile: "review_before_write" });
      try {
        return await w.call("POST", `/api/skills/${w.ids.skillSlug}/notes/promote`);
      } finally {
        w.ctx.settingsStore.update({ securityProfile: "read_only" });
      }
    },
  },
  [key("POST", "/api/skills/:slug/toggle")]: {
    run: async (w) => {
      await w.call("POST", `/api/skills/${w.ids.skillSlug}/toggle`);
      return w.call("POST", `/api/skills/${w.ids.skillSlug}/toggle`);
    },
  },
  [key("POST", "/api/skills/:slug/favorite")]: {
    run: (w) => w.call("POST", `/api/skills/${w.ids.skillSlug}/favorite`),
  },
  [key("POST", "/api/skills/import")]: {
    run: (w) => {
      const dir = path.join(w.workspace, "to-import");
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(
        path.join(dir, "SKILL.md"),
        "---\nname: To import\ndescription: imported\n---\n\n# Body\n",
      );
      return w.call("POST", "/api/skills/import", { sourceDir: dir });
    },
  },
  [key("POST", "/api/skills/install")]: {
    run: (w) => w.call("POST", "/api/skills/install", { slug: "hello-registry" }),
  },
  [key("POST", "/api/skills/:slug/run")]: {
    run: (w) => w.call("POST", `/api/skills/${w.ids.skillSlug}/run`, { inputs: {} }),
  },
  [key("POST", "/api/routines")]: {
    run: (w) =>
      w.call("POST", "/api/routines", {
        id: "contract-routine",
        name: "Contract routine",
        prompt: "say hi",
        kind: "every",
        every: { value: 1, unit: "hours" },
      }),
  },
  [key("PUT", "/api/routines/:id")]: {
    run: (w) =>
      w.call("PUT", "/api/routines/contract-routine", {
        name: "Contract routine, edited",
        prompt: "say hi again",
        kind: "every",
        every: { value: 2, unit: "hours" },
      }),
  },
  [key("POST", "/api/routines/:id/toggle")]: {
    run: (w) => w.call("POST", "/api/routines/contract-routine/toggle"),
  },
  [key("POST", "/api/routines/:id/duplicate")]: {
    run: (w) => w.call("POST", "/api/routines/contract-routine/duplicate"),
  },
  [key("POST", "/api/routines/:id/run")]: {
    run: (w) => w.call("POST", "/api/routines/contract-routine/run"),
  },
  [key("POST", "/api/connectors")]: {
    run: (w) =>
      w.call("POST", "/api/connectors", {
        id: "contract-connector",
        name: "Contract connector",
        kind: "api",
        origin: "test",
        maintainer: "test",
      }),
  },
  [key("PUT", "/api/connectors/:id")]: {
    run: (w) =>
      w.call("PUT", "/api/connectors/contract-connector", {
        name: "Contract connector, edited",
        kind: "api",
        origin: "test",
        maintainer: "test",
        writeEnabled: true,
        writeOperations: ["send"],
      }),
  },
  [key("POST", "/api/objectives")]: {
    run: (w) =>
      w.call("POST", "/api/objectives", {
        title: "Outra meta",
        steps: [
          { title: "Passo", request: { version: 1, kind: "prompt", prompt: "faça", mode: "read_only" } },
        ],
      }),
  },
  [key("POST", "/api/objectives/:id/dispatch")]: {
    run: (w) => w.call("POST", `/api/objectives/${w.ids.objectiveId}/dispatch`, { limit: 1 }),
  },
  [key("POST", "/api/objectives/:id/steps/:stepId/retry")]: {
    run: async (w) => {
      // Only a blocked step is retried: a step that expects a file its run never writes ends blocked.
      const created = (
        await w.call("POST", "/api/objectives", {
          title: "Meta com artefato",
          steps: [
            {
              title: "Passo",
              request: { version: 1, kind: "prompt", prompt: "faça", mode: "read_only" },
              expectedArtifacts: ["missing.txt"],
            },
          ],
        })
      ).body as { id: string; steps: Array<{ id: string }> };
      await w.call("POST", `/api/objectives/${created.id}/dispatch`, { limit: 1 });
      for (let i = 0; i < 200; i++) {
        const o = (await w.call("GET", `/api/objectives/${created.id}`)).body as {
          steps: Array<{ status: string }>;
        };
        if (o.steps[0]!.status === "blocked") break;
        await new Promise((r) => setTimeout(r, 50));
      }
      return w.call("POST", `/api/objectives/${created.id}/steps/${created.steps[0]!.id}/retry`, {
        effectsReconciled: true,
      });
    },
  },
  [key("POST", "/api/memory/index")]: { run: (w) => w.call("POST", "/api/memory/index") },
  [key("POST", "/api/memory/index/cancel")]: { run: (w) => w.call("POST", "/api/memory/index/cancel") },
  [key("POST", "/api/memory/notes")]: {
    run: (w) => w.call("POST", "/api/memory/notes", { title: "Cenário de criação" }),
  },
  [key("PUT", "/api/memory/notes")]: {
    run: (w) => {
      const note = noteOf(w, "Cenário de escrita");
      return w.call("PUT", "/api/memory/notes", {
        path: note.path,
        content: "# Cenário de escrita\n\nsalva\n",
        baseVersion: note.version,
      });
    },
  },
  // cerebro-vista-notas, door 2: a property of a note made for the scenario.
  [key("PUT", "/api/memory/notes/properties")]: {
    run: (w) => {
      const note = noteOf(w, "Cenário de propriedades");
      return w.call("PUT", "/api/memory/notes/properties", {
        path: note.path,
        baseVersion: note.version,
        set: { status: "draft" },
      });
    },
  },
  [key("POST", "/api/contexts")]: {
    run: (w) => w.call("POST", "/api/contexts", { name: "Cenário de contexto", paths: [w.workspace] }),
  },
  [key("PATCH", "/api/contexts/:id")]: {
    // With the brief too (door 9), so the probe reaches the write that makes it.
    run: (w) =>
      w.call("PATCH", "/api/contexts/contract-context", { name: "Contexto renomeado", brief: true }),
  },
  [key("POST", "/api/memory/open")]: {
    run: (w) => w.call("POST", "/api/memory/open", { p: path.join(w.workspace, "plan.md") }),
  },
  [key("POST", "/api/memory/routers")]: { run: (w) => w.call("POST", "/api/memory/routers") },
  [key("POST", "/api/memory/journal/append")]: {
    run: (w) => w.call("POST", "/api/memory/journal/append", { text: "uma linha", section: "Today" }),
  },
  [key("POST", "/api/memory/facts")]: {
    run: (w) => w.call("POST", "/api/memory/facts", { subject: "Beta", predicate: "status", object: "novo" }),
  },
  [key("POST", "/api/memory/facts/:id/retract")]: {
    run: (w) => w.call("POST", `/api/memory/facts/${w.ids.factId}/retract`),
  },
  [key("POST", "/api/pair/start")]: { run: (w) => w.call("POST", "/api/pair/start", { name: "phone 2" }) },
  [key("POST", "/api/pair/claim")]: {
    run: async (w) => {
      const started = (await w.call("POST", "/api/pair/start", { name: "phone 3" })).body as { code: string };
      return w.call("POST", "/api/pair/claim", { code: started.code, name: "phone 3" });
    },
  },
  [key("PATCH", "/api/devices/:id")]: {
    run: (w) => w.call("PATCH", `/api/devices/${w.ids.deviceId}`, { scopes: ["monitor", "approve"] }),
  },
  [key("POST", "/api/notifications/read")]: {
    run: (w) => w.call("POST", "/api/notifications/read", { all: true }),
  },
  [key("POST", "/api/push/subscribe")]: {
    run: (w) => {
      const ua = crypto.createECDH("prime256v1");
      ua.generateKeys();
      return w.call("POST", "/api/push/subscribe", {
        subscription: {
          endpoint: "https://push.example.net/sub/second",
          keys: { p256dh: b64url.encode(ua.getPublicKey()), auth: b64url.encode(crypto.randomBytes(16)) },
        },
      });
    },
  },
  [key("POST", "/api/push/unsubscribe")]: {
    run: (w) => w.call("POST", "/api/push/unsubscribe", { endpoint: "https://push.example.net/sub/second" }),
  },
  [key("POST", "/api/push/test")]: {
    run: async (w) => {
      vi.stubGlobal("fetch", async () => new Response("", { status: 201 }));
      try {
        return await w.call("POST", "/api/push/test");
      } finally {
        vi.unstubAllGlobals();
      }
    },
  },
  [key("POST", "/api/channels/telegram/send")]: {
    run: async (w) => {
      vi.stubGlobal("fetch", async () => new Response(JSON.stringify({ ok: true }), { status: 200 }));
      try {
        return await w.call("POST", "/api/channels/telegram/send", { text: "oi" });
      } finally {
        vi.unstubAllGlobals();
      }
    },
  },
  [key("POST", "/api/channels/telegram/test")]: {
    run: async (w) => {
      vi.stubGlobal("fetch", async () => new Response(JSON.stringify({ ok: true }), { status: 200 }));
      try {
        return await w.call("POST", "/api/channels/telegram/test");
      } finally {
        vi.unstubAllGlobals();
      }
    },
  },
  [key("POST", "/api/microapps/pixel/save")]: {
    run: (w) =>
      w.call("POST", "/api/microapps/pixel/save", {
        name: "contract",
        dataUrl: `data:image/png;base64,${png1x1.toString("base64")}`,
      }),
  },
  [key("POST", "/api/system/restart")]: { run: (w) => w.call("POST", "/api/system/restart") },
  [key("POST", "/api/system/reap")]: { run: (w) => w.call("POST", "/api/system/reap") },

  // ---- destructive: last
  [key("POST", "/api/backups/:name/restore")]: {
    run: async (w) => {
      // A restore is refused while a run is active: the ones the scenarios started finish first.
      for (let i = 0; i < 400 && w.ctx.activeRunCount().running + w.ctx.activeRunCount().queued > 0; i++) {
        await new Promise((r) => setTimeout(r, 50));
      }
      return w.call("POST", `/api/backups/${w.ids.backupName}/restore`);
    },
  },
  [key("DELETE", "/api/backups/restore-pending")]: {
    run: (w) => w.call("DELETE", "/api/backups/restore-pending"),
  },
  [key("DELETE", "/api/sessions/:id")]: { run: (w) => w.call("DELETE", `/api/sessions/${w.ids.sessionId}`) },
  [key("DELETE", "/api/skills/:slug")]: { run: (w) => w.call("DELETE", `/api/skills/${w.ids.skillSlug}`) },
  [key("DELETE", "/api/routines/:id")]: { run: (w) => w.call("DELETE", "/api/routines/contract-routine") },
  [key("DELETE", "/api/contexts/:id")]: {
    run: (w) => w.call("DELETE", "/api/contexts/contract-context-gone"),
  },
  [key("DELETE", "/api/connectors/:id")]: {
    run: (w) => w.call("DELETE", "/api/connectors/contract-connector"),
  },
  [key("DELETE", "/api/objectives/:id")]: {
    run: (w) => w.call("DELETE", `/api/objectives/${w.ids.objectiveId}`),
  },
  [key("DELETE", "/api/devices/:id")]: { run: (w) => w.call("DELETE", `/api/devices/${w.ids.deviceId}`) },
  [key("DELETE", "/api/notifications/:id")]: {
    run: (w) => w.call("DELETE", `/api/notifications/${w.ids.notificationId}`),
  },
  [key("DELETE", "/api/push/subscriptions/:id")]: {
    run: (w) => w.call("DELETE", `/api/push/subscriptions/${w.ids.pushId}`),
  },
};

/** The entry that a scenario key stands for. */
export function entryOf(scenarioKey: string): { id: string; entry: RouteDefinition } {
  const found = Object.entries(API).find(([, e]) => routeKey(e) === scenarioKey);
  if (!found) throw new Error(`no entry for ${scenarioKey}`);
  return { id: found[0], entry: found[1] as RouteDefinition };
}

export interface Result {
  key: string;
  id: string;
  entry: RouteDefinition;
  answer: Answer;
}

/** Run every scenario in order against one world. */
export async function runScenarios(w: World): Promise<Result[]> {
  const results: Result[] = [];
  for (const [scenarioKey, scenario] of Object.entries(SCENARIOS)) {
    const { id, entry } = entryOf(scenarioKey);
    results.push({ key: scenarioKey, id, entry, answer: await scenario.run(w) });
  }
  return results;
}
