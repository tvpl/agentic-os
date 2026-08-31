import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import type { FastifyInstance } from "fastify";
import {
  SettingsSchema,
  createBackup,
  listBackups,
  restoreBackup,
  planStartupService,
  redactSecrets,
  ProviderId,
} from "@mordomo/core";
import type { AppContext } from "../context.js";
import { runDoctor } from "../doctor.js";

const PKG_VERSION = "0.1.0";

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

  app.get("/api/health", async () => ({
    ok: true,
    uptimeMs: Date.now() - ctx.startedAt,
    version: PKG_VERSION,
  }));

  app.get("/api/settings", async () => ctx.settings());

  app.put("/api/settings", async (req) => {
    const patch = SettingsSchema.partial().parse(req.body);
    const before = ctx.settings();

    // Approval-gated transitions (docs/security.md).
    if (patch.bindAddress && patch.bindAddress !== "127.0.0.1" && patch.bindAddress !== before.bindAddress) {
      const approval = ctx.approvals.request(
        "expose_port",
        `Bind the MordomoOS server to ${patch.bindAddress} instead of 127.0.0.1 (exposes the panel beyond this machine).`,
        { bindAddress: patch.bindAddress },
      );
      delete patch.bindAddress;
      const saved = ctx.settingsStore.update(patch);
      return { settings: saved, pendingApproval: approval };
    }
    const newFolders = (patch.indexedFolders ?? []).filter(
      (f) => !before.indexedFolders.some((b) => path.resolve(b.path) === path.resolve(f.path)),
    );
    for (const folder of newFolders) {
      if (!fs.existsSync(folder.path)) {
        throw Object.assign(new Error(`Folder does not exist: ${folder.path}`), { statusCode: 400 });
      }
    }
    const saved = ctx.settingsStore.update(patch);
    ctx.invalidateProviderCache();
    ctx.scheduler.reload();
    return { settings: saved, pendingApproval: null };
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
    }
    ctx.invalidateProviderCache();
    return { detection, auth, models };
  });

  app.put("/api/providers/default", async (req) => {
    const { provider } = z.object({ provider: ProviderId }).parse(req.body);
    const s = ctx.settings();
    if (!s.providers[provider].enabled) {
      throw Object.assign(new Error(`Provider ${provider} is not enabled`), { statusCode: 400 });
    }
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
    const events = ctx.runs.eventsFor(run.id);
    const sawOk = events.some(
      (e) => (e.event.type === "assistant" || e.event.type === "result") && JSON.stringify(e.event).includes("MORDOMO_OK"),
    );
    return { run: finished, passed: finished.status === "done" && sawOk };
  });

  app.get("/api/doctor", async () => runDoctor(ctx));

  app.get("/api/approvals", async () => ctx.approvals.list("pending"));
  app.post("/api/approvals/:id/resolve", async (req) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const { decision } = z.object({ decision: z.enum(["approved", "denied"]) }).parse(req.body);
    const approval = ctx.approvals.resolve(id, decision);
    if (!approval) throw Object.assign(new Error("Approval not found"), { statusCode: 404 });
    // Act on approved effects we know how to apply.
    if (approval.status === "approved" && approval.kind === "expose_port") {
      ctx.settingsStore.update({ bindAddress: String(approval.payload.bindAddress ?? "127.0.0.1") });
    }
    return approval;
  });

  app.get("/api/backups", async () => listBackups(ctx.paths));
  app.post("/api/backups", async (req) => {
    const { includeArtifacts } = z.object({ includeArtifacts: z.boolean().default(false) }).parse(req.body ?? {});
    return createBackup(ctx.paths, includeArtifacts);
  });
  app.post("/api/backups/:name/restore", async (req) => {
    const { name } = z.object({ name: z.string().regex(/^full-[A-Za-z0-9-]+$/) }).parse(req.params);
    const result = restoreBackup(ctx.paths, name);
    ctx.scheduler.reload();
    ctx.invalidateProviderCache();
    return { restored: name, safetyBackup: result.safetyBackup, note: "Restart the service to reload the restored database: mordomo stop && mordomo start" };
  });

  app.get("/api/sync/plan", async (req) => {
    const { target } = z.object({ target: z.string().optional() }).parse(req.query);
    return ctx.sync.plan(target ?? ctx.paths.home);
  });
  app.post("/api/sync/apply", async (req) => {
    const body = z
      .object({ target: z.string().optional(), approvedConflicts: z.array(z.string()).default([]) })
      .parse(req.body ?? {});
    const plan = ctx.sync.plan(body.target ?? ctx.paths.home);
    return ctx.sync.apply(plan, body.approvedConflicts);
  });

  app.get("/api/startup-plan", async () => planStartupService(ctx.paths, process.execPath));

  app.get("/api/diagnostics/export", async () => {
    const doctor = await runDoctor(ctx);
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
