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
} from "@mordomo/core";
import { clearRestorePending, readRestorePending, writeRestorePending, type AppContext } from "../context.js";
import { runDoctor } from "../doctor.js";
import { grantedRoots, httpError, launchPromptRun, launchSkillRun, type PromptRunInput, type SkillRunInput } from "./common.js";
import { BackupNameParams, UuidParams } from "./params.js";

const here = path.dirname(fileURLToPath(import.meta.url));

/** Version from apps/api/package.json (falls back to the repo root package.json). */
export function readPackageVersion(): string {
  for (const candidate of [
    path.resolve(here, "..", "..", "package.json"),
    path.resolve(here, "..", "..", "..", "..", "package.json"),
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
    .object({ claude: ProviderPatch.optional(), cursor: ProviderPatch.optional(), codex: ProviderPatch.optional() })
    .optional(),
  limits: SettingsSchema.shape.limits.removeDefault().partial().optional(),
});
export type SettingsPatch = z.infer<typeof SettingsPatchSchema>;

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function mergeObjects(base: Record<string, unknown>, patch: Record<string, unknown>): Record<string, unknown> {
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
      (e) => (e.event.type === "assistant" || e.event.type === "result") && JSON.stringify(e.event).includes("MORDOMO_OK"),
    );
    return { run: finished, passed: finished.status === "done" && sawOk };
  });

  app.get("/api/doctor", async (req) => {
    const { audit } = z.object({ audit: z.enum(["0", "1"]).optional() }).parse(req.query);
    return runDoctor(ctx, { npmAudit: audit !== "0" });
  });

  app.get("/api/approvals", async () => ctx.approvals.list("pending"));
  app.post("/api/approvals/:id/resolve", async (req) => {
    const { id } = UuidParams.parse(req.params);
    const { decision } = z.object({ decision: z.enum(["approved", "denied"]) }).parse(req.body);
    const approval = ctx.approvals.resolve(id, decision);
    if (!approval) throw httpError(404, "Approval not found");
    // Act on approved effects we know how to apply.
    let runId: string | null = null;
    if (approval.status === "approved" && approval.kind === "expose_port") {
      ctx.settingsStore.update({ bindAddress: String(approval.payload.bindAddress ?? "127.0.0.1") });
    }
    if (approval.status === "approved" && approval.kind === "write_run") {
      const payload = approval.payload as { kind?: string; input?: unknown };
      const onError = (err: unknown, id: string) => req.log.error({ err, runId: id, msg: "approved run failed to execute" });
      if (payload.kind === "prompt" && payload.input) runId = launchPromptRun(ctx, payload.input as PromptRunInput, onError).runId;
      else if (payload.kind === "skill" && payload.input) runId = launchSkillRun(ctx, payload.input as SkillRunInput, onError).runId;
    }
    events.emit("approval.resolved", { id: approval.id, kind: approval.kind, status: approval.status, runId });
    return { ...approval, runId };
  });

  // ---- Backups ---------------------------------------------------------------
  app.get("/api/backups", async () => listBackups(ctx.paths));
  app.post("/api/backups", async (req) => {
    const { includeArtifacts } = z.object({ includeArtifacts: z.boolean().default(false) }).parse(req.body ?? {});
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
    if (!isInside(ctx.paths.backups, src) || !fs.existsSync(src)) throw httpError(404, `Backup not found: ${name}`);
    const active = ctx.activeRunCount();
    if (active.running + active.queued > 0) {
      throw httpError(409, `Cannot restore while ${active.running + active.queued} run(s) are active. Wait or cancel them first.`);
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
