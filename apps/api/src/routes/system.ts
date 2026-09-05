import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import type { FastifyInstance } from "fastify";
import {
  ProviderId,
  ProviderSettingsSchema,
  SettingsSchema,
  createBackup,
  events,
  isInside,
  listBackups,
  planStartupService,
  redactSecrets,
  resolveInsideRoots,
  type Settings,
  dailyPoints,
} from "@mordomo/core";
import { clearRestorePending, readRestorePending, writeRestorePending, type AppContext } from "../context.js";
import { runDoctor } from "../doctor.js";
import { resolveApproval } from "../approvalActions.js";
import { tlsListenerFor } from "../server.js";

function tlsInfo(ctx: AppContext): { port: number; fingerprint: string; hosts: string[] } | null {
  try {
    const t = tlsListenerFor(ctx);
    return t ? { port: t.port, fingerprint: t.material.fingerprint, hosts: t.hosts } : null;
  } catch {
    return null;
  }
}
import { grantedRoots, httpError } from "./common.js";
import { BackupNameParams, UuidParams } from "./params.js";

const here = path.dirname(fileURLToPath(import.meta.url));

/** Version from the repository root package.json (falls back to apps/api's own). */
export function readPackageVersion(): string {
  for (const candidate of [
    path.resolve(here, "..", "..", "..", "..", "package.json"),
    path.resolve(here, "..", "..", "package.json"),
  ]) {
    try {
      const pkg = JSON.parse(fs.readFileSync(candidate, "utf8")) as { version?: unknown };
      if (typeof pkg.version === "string" && pkg.version) return pkg.version;
    } catch {
      /* try next */
    }
  }
  return "0.0.0";
}
export const PKG_VERSION = readPackageVersion();

// ---- Settings patch: deep-merge for providers.* and limits ------------------

const ProviderPatch = ProviderSettingsSchema.partial();
export const SettingsPatchSchema = SettingsSchema.partial().extend({
  providers: z
    .object({
      claude: ProviderPatch.optional(),
      cursor: ProviderPatch.optional(),
      codex: ProviderPatch.optional(),
    })
    .optional(),
  limits: SettingsSchema.shape.limits.removeDefault().partial().optional(),
});
export type SettingsPatch = z.infer<typeof SettingsPatchSchema>;

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function mergeObjects(
  base: Record<string, unknown>,
  patch: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) continue;
    const current = out[key];
    out[key] = isPlainObject(value) && isPlainObject(current) ? mergeObjects(current, value) : value;
  }
  return out;
}

/**
 * Merge a partial settings patch over the current settings. `providers.*` and
 * `limits` merge field by field so `{providers:{claude:{enabled:true}}}` keeps
 * `binaryPath`; arrays and every other key replace wholesale.
 */
export function deepMergeSettings(current: Settings, patch: SettingsPatch): Settings {
  const merged: Record<string, unknown> = { ...current };
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) continue;
    if ((key === "providers" || key === "limits") && isPlainObject(value)) {
      merged[key] = mergeObjects(merged[key] as Record<string, unknown>, value);
    } else {
      merged[key] = value;
    }
  }
  return SettingsSchema.parse(merged);
}

function assertIndexableFolder(ctx: AppContext, folderPath: string): void {
  if (!path.isAbsolute(folderPath)) throw httpError(400, `Folder path must be absolute: ${folderPath}`);
  let stat: fs.Stats;
  try {
    stat = fs.statSync(folderPath);
  } catch {
    throw httpError(400, `Folder does not exist: ${folderPath}`);
  }
  if (!stat.isDirectory()) throw httpError(400, `Not a directory: ${folderPath}`);
  const real = fs.realpathSync(folderPath);
  const config = fs.existsSync(ctx.paths.config) ? fs.realpathSync(ctx.paths.config) : ctx.paths.config;
  if (isInside(config, real) || isInside(real, config)) {
    throw httpError(400, "The MordomoOS config directory cannot be indexed");
  }
}

/** A sync target must live inside the home or an enabled indexed folder. */
function resolveSyncTarget(ctx: AppContext, target: string | undefined): string {
  if (!target) return ctx.paths.home;
  return resolveInsideRoots(grantedRoots(ctx), target);
}

// ---- Artifacts list -----------------------------------------------------------

export type ArtifactKind = "image" | "video" | "html" | "markdown" | "code" | "other";

export interface ArtifactListItem {
  id: string;
  file: string;
  path: string;
  runId: string | null;
  skillSlug: string | null;
  createdAt: number;
  kind: ArtifactKind;
  title: string;
  folder: string;
  sizeBytes: number;
  thumbnail: boolean;
}

const RAW_MIME: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
};
const RAW_MAX_BYTES = 25 * 1024 * 1024;
const TITLE_SCAN_BYTES = 16 * 1024;
const LIST_MAX_FILES = 5000;

export function artifactKind(file: string): ArtifactKind {
  const ext = path.extname(file).toLowerCase();
  if ([".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg"].includes(ext)) return "image";
  if ([".mp4", ".webm", ".mov"].includes(ext)) return "video";
  if ([".html", ".htm"].includes(ext)) return "html";
  if ([".md", ".markdown"].includes(ext)) return "markdown";
  if (
    [
      ".ts",
      ".tsx",
      ".js",
      ".mjs",
      ".py",
      ".sh",
      ".json",
      ".css",
      ".yaml",
      ".yml",
      ".sql",
      ".go",
      ".rs",
    ].includes(ext)
  )
    return "code";
  return "other";
}

/** Title for a file: first `# heading` of a .md, `<title>` of an .html, else the base name. Reads at most 16 KB. */
export function artifactTitle(abs: string, kind: ArtifactKind): string {
  const base = path.basename(abs);
  if (kind !== "markdown" && kind !== "html") return base;
  let head = "";
  try {
    const fd = fs.openSync(abs, "r");
    try {
      const buf = Buffer.alloc(TITLE_SCAN_BYTES);
      const n = fs.readSync(fd, buf, 0, TITLE_SCAN_BYTES, 0);
      head = buf.subarray(0, n).toString("utf8");
    } finally {
      fs.closeSync(fd);
    }
  } catch {
    return base;
  }
  if (kind === "markdown") {
    const m = /^\s*#{1,3}\s+(.+?)\s*#*\s*$/m.exec(head);
    if (m?.[1]) return m[1].trim().slice(0, 160);
    const line = head.split(/\r?\n/).find((l) => l.trim() && !l.trim().startsWith("---"));
    return line
      ? line
          .trim()
          .replace(/^[#>*\-\s]+/, "")
          .slice(0, 160) || base
      : base;
  }
  const m = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(head);
  if (m?.[1]) return m[1].replace(/\s+/g, " ").trim().slice(0, 160) || base;
  return base;
}

const ArtifactListQuery = z.object({
  q: z.string().max(200).optional(),
  skill: z.string().max(100).optional(),
  folder: z.string().max(200).optional(),
  kind: z.enum(["image", "video", "html", "markdown", "code", "other"]).optional(),
  since: z.coerce.number().int().min(0).optional(),
  limit: z.coerce.number().int().min(1).max(500).default(200),
});
type ArtifactListQueryT = z.infer<typeof ArtifactListQuery>;

/** Walk artifacts/ (bounded), merge run metadata by relative path, filter and sort newest first. */
export function listArtifacts(
  ctx: AppContext,
  q: ArtifactListQueryT,
): { items: ArtifactListItem[]; total: number; skills: string[]; folders: string[] } {
  const root = ctx.paths.artifacts;
  const byRel = new Map<string, { runId: string; skillSlug: string | null; createdAt: number }>();
  for (const run of ctx.runs.list({ limit: 500 })) {
    for (const rel of run.artifacts) {
      const key = rel.split(path.sep).join("/");
      if (!byRel.has(key))
        byRel.set(key, {
          runId: run.id,
          skillSlug: run.skillSlug,
          createdAt: run.finishedAt ?? run.createdAt,
        });
    }
  }

  const items: ArtifactListItem[] = [];
  const walk = (dir: string, depth: number) => {
    if (items.length >= LIST_MAX_FILES || depth > 6) return;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.name.startsWith(".")) continue;
      const abs = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(abs, depth + 1);
        continue;
      }
      if (!entry.isFile()) continue;
      let stat: fs.Stats;
      try {
        stat = fs.statSync(abs);
      } catch {
        continue;
      }
      const rel = path.relative(root, abs).split(path.sep).join("/");
      const meta = byRel.get(rel);
      const kind = artifactKind(entry.name);
      const folder = rel.split("/")[0] ?? "";
      items.push({
        id: rel,
        file: meta ? rel.split("/").slice(1).join("/") || entry.name : rel,
        path: abs,
        runId: meta?.runId ?? null,
        skillSlug: meta?.skillSlug ?? null,
        createdAt: meta?.createdAt ?? stat.mtimeMs,
        kind,
        title: artifactTitle(abs, kind),
        folder,
        sizeBytes: stat.size,
        thumbnail: Boolean(RAW_MIME[path.extname(entry.name).toLowerCase()]),
      });
      if (items.length >= LIST_MAX_FILES) return;
    }
  };
  if (fs.existsSync(root)) walk(root, 0);

  const skills = [...new Set(items.map((i) => i.skillSlug).filter((s): s is string => !!s))].sort();
  const folders = [...new Set(items.map((i) => i.folder).filter(Boolean))].sort();
  const needle = q.q?.trim().toLowerCase();
  const filtered = items.filter((i) => {
    if (q.skill && i.skillSlug !== q.skill) return false;
    if (q.folder && i.folder !== q.folder) return false;
    if (q.kind && i.kind !== q.kind) return false;
    if (q.since !== undefined && i.createdAt < q.since) return false;
    if (needle && !`${i.title} ${i.file} ${i.skillSlug ?? ""} ${i.folder}`.toLowerCase().includes(needle))
      return false;
    return true;
  });
  filtered.sort((a, b) => b.createdAt - a.createdAt);
  return { items: filtered.slice(0, q.limit), total: filtered.length, skills, folders };
}

export function registerSystemRoutes(app: FastifyInstance, ctx: AppContext): void {
  // Public (no token): only non-sensitive branding needed before the UI boots.
  app.get("/api/meta", async () => {
    const s = ctx.settings();
    return {
      name: s.systemName,
      theme: s.theme,
      accentColor: s.accentColor,
      language: s.language,
      setupCompleted: s.setupCompleted,
      version: PKG_VERSION,
      // Remote TLS (follow-up 10): the pairing screen shows the fingerprint so a phone can check what it trusts.
      tls: tlsInfo(ctx),
    };
  });

  app.get("/api/health", async () => {
    const dbOpen = ctx.db.open;
    const runs = ctx.activeRunCount();
    return {
      ok: dbOpen,
      uptimeMs: Date.now() - ctx.startedAt,
      version: PKG_VERSION,
      db: { open: dbOpen, path: ctx.paths.dbFile },
      scheduler: { running: ctx.schedulerRunning() },
      activeRuns: runs.running,
      queuedRuns: runs.queued,
      pendingApprovals: ctx.approvals.list("pending").length,
      lastEventId: events.lastId,
      restorePending: readRestorePending(ctx.paths),
    };
  });

  app.get("/api/settings", async () => ctx.settings());

  app.put("/api/settings", async (req) => {
    const patch = SettingsPatchSchema.parse(req.body);
    const before = ctx.settings();

    // Approval-gated transitions (docs/security.md).
    let pendingApproval = null;
    if (patch.bindAddress && patch.bindAddress !== "127.0.0.1" && patch.bindAddress !== before.bindAddress) {
      pendingApproval = ctx.approvals.request(
        "expose_port",
        `Bind the MordomoOS server to ${patch.bindAddress} instead of 127.0.0.1 (exposes the panel beyond this machine).`,
        { bindAddress: patch.bindAddress },
      );
      delete patch.bindAddress;
    }
    const newFolders = (patch.indexedFolders ?? []).filter(
      (f) => !before.indexedFolders.some((b) => path.resolve(b.path) === path.resolve(f.path)),
    );
    for (const folder of newFolders) assertIndexableFolder(ctx, folder.path);

    // SettingsStore.save() emits `settings.changed` on the event bus.
    const saved = ctx.settingsStore.save(deepMergeSettings(before, patch));
    ctx.reloadAdapters();
    ctx.invalidateProviderCache();
    ctx.scheduler.reload();
    return { settings: saved, pendingApproval };
  });

  app.get("/api/providers", async (req) => {
    const force = (req.query as { force?: string }).force === "1";
    return ctx.providerSnapshot(force);
  });

  app.post("/api/providers/:id/detect", async (req) => {
    const { id } = z.object({ id: ProviderId }).parse(req.params);
    const detection = await ctx.adapters[id].detect();
    const auth = await ctx.adapters[id].authenticate();
    const models = await ctx.adapters[id].listModels();
    if (detection.binaryPath) {
      const s = ctx.settings();
      s.providers[id].binaryPath = detection.binaryPath;
      ctx.settingsStore.save(s);
      ctx.reloadAdapters();
    }
    ctx.invalidateProviderCache();
    return { detection, auth, models };
  });

  app.get("/api/providers/:id/models", async (req) => {
    const { id } = z.object({ id: ProviderId }).parse(req.params);
    return ctx.adapters[id].listModels();
  });

  app.put("/api/providers/default", async (req) => {
    const { provider } = z.object({ provider: ProviderId }).parse(req.body);
    const s = ctx.settings();
    if (!s.providers[provider].enabled) throw httpError(400, `Provider ${provider} is not enabled`);
    return ctx.settingsStore.update({ defaultProvider: provider });
  });

  /** Safe, file-change-free smoke test for one provider. */
  app.post("/api/providers/:id/smoke", async (req) => {
    const { id } = z.object({ id: ProviderId }).parse(req.params);
    const s = ctx.settings();
    const run = ctx.runs.create({
      origin: "manual",
      provider: id,
      prompt: "Smoke test: reply with exactly MORDOMO_OK and do nothing else.",
      cwd: ctx.paths.home,
      model: s.providers[id].defaultModel,
      effort: "low",
      mode: "read_only",
      timeoutMs: 180_000,
      profile: "read_only",
    });
    const finished = await ctx.runs.execute(
      run.id,
      "Smoke test: reply with exactly MORDOMO_OK and do nothing else. Do not read or write any file.",
      "read_only",
    );
    const runEvents = ctx.runs.eventsFor(run.id);
    const sawOk = runEvents.some(
      (e) =>
        (e.event.type === "assistant" || e.event.type === "result") &&
        JSON.stringify(e.event).includes("MORDOMO_OK"),
    );
    return { run: finished, passed: finished.status === "done" && sawOk };
  });

  app.get("/api/doctor", async (req) => {
    const { audit } = z.object({ audit: z.enum(["0", "1"]).optional() }).parse(req.query);
    return runDoctor(ctx, { npmAudit: audit !== "0" });
  });

  /** Hourly samples of the last N days plus their daily fold (Settings › Trends). */
  app.get("/api/metrics/history", async (req) => {
    const q = z.object({ days: z.coerce.number().int().min(1).max(90).default(14) }).parse(req.query ?? {});
    const samples = ctx.metricsHistory.series(q.days);
    return { days: q.days, samples, daily: dailyPoints(samples) };
  });

  app.get("/api/approvals", async () => ctx.approvals.list("pending"));
  /** One approval by id, any status (the permission tool polls this). */
  app.get("/api/approvals/:id", async (req) => {
    const { id } = UuidParams.parse(req.params);
    const approval = ctx.approvals.get(id);
    if (!approval) throw httpError(404, "Approval not found");
    return approval;
  });
  /**
   * A tool prompt raised inside a running agent (plan Onda 1 §3): the
   * permission MCP server parks it here; the Console, the run page and the
   * inbox offer Approve / Deny; the server answers the CLI when resolved.
   */
  app.post("/api/approvals/tool", async (req) => {
    const body = z
      .object({
        runId: z.string().uuid(),
        toolName: z.string().min(1).max(200),
        input: z.record(z.unknown()).default({}),
        toolUseId: z.string().max(200).optional(),
      })
      .parse(req.body);
    const run = ctx.runs.get(body.runId);
    if (!run) throw httpError(404, "Run not found");
    if (run.status !== "running" && run.status !== "queued") throw httpError(409, "Run is not active");
    const detail = summarizeToolInput(body.toolName, body.input);
    const description = `${body.toolName}: ${detail}`;
    const approval = ctx.approvals.request("tool_use", description, {
      runId: body.runId,
      toolName: body.toolName,
      input: body.input,
      ...(body.toolUseId ? { toolUseId: body.toolUseId } : {}),
    });
    ctx.runs.annotate(body.runId, {
      type: "permission",
      ts: Date.now(),
      detail: `${description} (approval ${approval.id})`,
    });
    events.emit("approval.requested", {
      id: approval.id,
      kind: approval.kind,
      description,
      runId: body.runId,
    });
    return approval;
  });
  app.post("/api/approvals/:id/resolve", async (req) => {
    const { id } = UuidParams.parse(req.params);
    const { decision } = z.object({ decision: z.enum(["approved", "denied"]) }).parse(req.body);
    const onError = (err: unknown, runId: string) =>
      req.log.error({ err, runId, msg: "approved run failed to execute" });
    const result = await resolveApproval(ctx, id, decision, onError);
    return { ...ctx.approvals.get(id)!, runId: result.runId };
  });

  // ---- Backups ---------------------------------------------------------------
  app.get("/api/backups", async () => listBackups(ctx.paths));
  app.post("/api/backups", async (req) => {
    const { includeArtifacts } = z
      .object({ includeArtifacts: z.boolean().default(false) })
      .parse(req.body ?? {});
    return createBackup(ctx.paths, ctx.db, { includeArtifacts });
  });

  /**
   * Restore is STAGED, never applied against the open database (audit B2):
   * the backup is copied to config/restore-pending/ and applied by the server
   * on its next boot, before the DB is opened (see AppContext.applyPendingRestore).
   * Refused while any run is active.
   */
  app.post("/api/backups/:name/restore", async (req, reply) => {
    const { name } = BackupNameParams.parse(req.params);
    const src = path.join(ctx.paths.backups, name);
    if (!isInside(ctx.paths.backups, src) || !fs.existsSync(src))
      throw httpError(404, `Backup not found: ${name}`);
    const active = ctx.activeRunCount();
    if (active.running + active.queued > 0) {
      throw httpError(
        409,
        `Cannot restore while ${active.running + active.queued} run(s) are active. Wait or cancel them first.`,
      );
    }
    const staged = writeRestorePending(ctx.paths, name);
    reply.code(202);
    return {
      staged: true,
      restored: false,
      name,
      stagedAt: staged.stagedAt,
      apply: "mordomo stop && mordomo start",
      message:
        "Restore staged. The database is in use, so the backup will be applied on the next service start " +
        "(a safety backup is taken first). Restart with: mordomo stop && mordomo start",
    };
  });
  app.get("/api/backups/restore-pending", async () => ({ restorePending: readRestorePending(ctx.paths) }));
  app.delete("/api/backups/restore-pending", async () => {
    const pending = readRestorePending(ctx.paths);
    clearRestorePending(ctx.paths);
    return { cancelled: pending?.name ?? null };
  });

  // ---- Sync ------------------------------------------------------------------
  app.get("/api/sync/plan", async (req) => {
    const { target } = z.object({ target: z.string().optional() }).parse(req.query);
    return ctx.sync.plan(resolveSyncTarget(ctx, target));
  });
  app.post("/api/sync/apply", async (req) => {
    const body = z
      .object({ target: z.string().optional(), approvedConflicts: z.array(z.string()).default([]) })
      .parse(req.body ?? {});
    const plan = ctx.sync.plan(resolveSyncTarget(ctx, body.target));
    return ctx.sync.apply(plan, body.approvedConflicts);
  });

  // ---- Artifacts gallery (desktop search, /artifacts, /generations) --------
  app.get("/api/artifacts/list", async (req) => {
    const q = ArtifactListQuery.parse(req.query);
    return listArtifacts(ctx, q);
  });

  /** Binary artifact (images / video) for thumbnails — strictly inside the artifacts dir, allow-listed types only. */
  app.get("/api/artifacts/raw", async (req, reply) => {
    const { p } = z.object({ p: z.string() }).parse(req.query);
    const resolved = resolveInsideRoots([ctx.paths.artifacts], p); // PathAccessError → 403
    if (!isInside(ctx.paths.artifacts, resolved)) throw httpError(403, "Outside artifacts directory");
    const mime = RAW_MIME[path.extname(resolved).toLowerCase()];
    if (!mime) throw httpError(415, "Not a previewable artifact type");
    let stat: fs.Stats;
    try {
      stat = fs.statSync(resolved);
    } catch {
      throw httpError(404, "Artifact not found");
    }
    if (!stat.isFile()) throw httpError(404, "Artifact not found");
    if (stat.size > RAW_MAX_BYTES) throw httpError(413, "Artifact larger than 25 MB — open it from disk.");
    reply.header("content-type", mime);
    reply.header("cache-control", "private, max-age=300");
    reply.header("x-content-type-options", "nosniff");
    return reply.send(fs.createReadStream(resolved));
  });

  app.get("/api/startup-plan", async () => planStartupService(ctx.paths, process.execPath));

  app.get("/api/diagnostics/export", async () => {
    const doctor = await runDoctor(ctx, { npmAudit: false });
    const bundle = {
      generatedAt: new Date().toISOString(),
      version: PKG_VERSION,
      platform: { os: process.platform, arch: process.arch, node: process.versions.node },
      settings: { ...ctx.settings() },
      doctor,
      metrics: ctx.runs.metrics(),
      recentRuns: ctx.runs.list({ limit: 30 }),
      routines: ctx.scheduler.status(),
      contains: "settings (no secrets stored), doctor checks, metrics, last 30 run summaries, routine status",
    };
    return JSON.parse(redactSecrets(JSON.stringify(bundle)));
  });
}

/** One line a human can decide on: the command, the file, the URL — never the whole payload. */
export function summarizeToolInput(tool: string, input: Record<string, unknown>): string {
  const pick = (...keys: string[]): string | null => {
    for (const k of keys) {
      const v = input[k];
      if (typeof v === "string" && v.trim()) return v.trim();
    }
    return null;
  };
  const text =
    pick("command", "file_path", "path", "url", "pattern", "query", "notebook_path") ??
    JSON.stringify(input).slice(0, 200);
  const flat = text.replace(/\s+/g, " ");
  const head = flat.length > 160 ? `${flat.slice(0, 159)}…` : flat;
  return tool.toLowerCase() === "bash" ? `$ ${head}` : head;
}
