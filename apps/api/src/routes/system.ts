import fs from "node:fs";
import { isDeepStrictEqual } from "node:util";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { SettingsPatchSchema, type HandlerCall, type SettingsPatch } from "@mordomo/contracts";
import type { FastifyInstance } from "fastify";
import type { Settings } from "@mordomo/core";
import {
  SettingsSchema,
  UI_PREFERENCE_KEYS,
  UiPreferencesSchema,
  deepMergeSettings as deepMerge,
  createBackup,
  executableName,
  isDeviceActor,
  isInside,
  listBackups,
  verifyBackup,
  planStartupService,
  NotRegularFileError,
  listWorkspaceDir,
  openWorkspaceFile,
  readWorkspaceText,
  realpathLenient,
  redactSecrets,
  resolveReadable,
  type ReadScope,
  type WorkspaceEntry,
  type WorkspaceFile,
  dailyPoints,
  isStartupServiceInstalled,
  contextSyncTarget,
  generateRouters,
  type SyncPlan,
} from "@mordomo/core/internal";
import { clearRestorePending, readRestorePending, writeRestorePending, type AppContext } from "../context.js";
import { bind } from "../contract.js";
import { runDoctor } from "../doctor.js";
import { cliEntry } from "../entry.js";
import {
  buildStatus,
  installedBuildTime,
  instanceSnapshot,
  invalidateInstanceSnapshot,
  orphanProcesses,
  terminate,
} from "../instances.js";
import { spawn } from "node:child_process";
import { RELEASES_PAGE, UpdateChecker } from "../updates.js";
import { tlsListenerFor } from "../server.js";
import { API_VERSION } from "../apiVersion.js";

function tlsInfo(ctx: AppContext): { port: number; fingerprint: string; hosts: string[] } | null {
  try {
    const t = tlsListenerFor(ctx);
    return t ? { port: t.port, fingerprint: t.material.fingerprint, hosts: t.hosts } : null;
  } catch {
    return null;
  }
}
import { httpError, principalName, requireAdapter, requireProvider, startedByOf } from "./common.js";
import { requireContext } from "./contexts.js";

const here = path.dirname(fileURLToPath(import.meta.url));

/**
 * Version from the repository root package.json, apps/api's own, or the
 * manifest a packaged install writes next to `lib/`. Only MordomoOS manifests
 * count, so an unrelated package.json above the install folder is ignored.
 */
export function readPackageVersion(): string {
  for (const candidate of [
    path.resolve(here, "..", "..", "..", "..", "package.json"),
    path.resolve(here, "..", "..", "package.json"),
    path.resolve(here, "..", "package.json"),
  ]) {
    try {
      const pkg = JSON.parse(fs.readFileSync(candidate, "utf8")) as { name?: unknown; version?: unknown };
      if (pkg.name !== "mordomo-os" && pkg.name !== "@mordomo/api") continue;
      if (typeof pkg.version === "string" && pkg.version) return pkg.version;
    } catch {
      /* try next */
    }
  }
  return "0.0.0";
}
export const PKG_VERSION = readPackageVersion();

// ---- Settings patch: deep-merge for providers.* and limits ------------------

export { SettingsPatchSchema };

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
 * Merge a partial settings patch over the current settings. `providers.*`,
 * `limits` and `memory` merge field by field so `{providers:{claude:{enabled:true}}}`
 * keeps `binaryPath`; arrays and every other key replace wholesale.
 */
export function deepMergeSettings(current: Settings, patch: SettingsPatch): Settings {
  const merged: Record<string, unknown> = { ...current };
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) continue;
    if ((key === "providers" || key === "limits" || key === "memory") && isPlainObject(value)) {
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
  const real = realpathLenient(folderPath);
  const config = realpathLenient(ctx.paths.config);
  if (isInside(config, real) || isInside(real, config)) {
    throw httpError(400, "The MordomoOS config directory cannot be indexed");
  }
}

/** A sync target must live inside the home or an enabled indexed folder. */
/**
 * The plan of the sync: into `target` (or the home) with the master router; with a work context, into the context's
 * first `ok` path with the context's map in the master router's place (.specs/features/cerebro-contextos, AC 30). The
 * map is brought up to date first, as a regeneration of the routers would.
 */
function syncPlan(ctx: AppContext, target: string | undefined, contextId: string | undefined): SyncPlan {
  const context = contextId === undefined ? null : requireContext(ctx, contextId);
  if (!context) return ctx.sync.plan(resolveSyncTarget(ctx, target));
  const settings = ctx.settings();
  const into = contextSyncTarget({ paths: ctx.paths, settings }, context);
  if (!into) {
    throw httpError(409, `None of the paths of the context ${context.id} is ok.`, "context_unavailable");
  }
  generateRouters(ctx.db, ctx.paths, settings);
  return ctx.sync.plan(resolveSyncTarget(ctx, into.target), into.map);
}

function resolveSyncTarget(ctx: AppContext, target: string | undefined): string {
  if (!target) return ctx.paths.home;
  // Granted folders, on the real path, outside the home's config/ and logs/ (PathAccessError → 403).
  return resolveReadable(ctx.readScope(), target).real;
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
export function artifactTitle(scope: ReadScope, abs: string, kind: ArtifactKind): string {
  const base = path.basename(abs);
  if (kind !== "markdown" && kind !== "html") return base;
  let head = "";
  try {
    head = readWorkspaceText(scope, abs, { maxBytes: TITLE_SCAN_BYTES }).text;
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

type ArtifactListQueryT = HandlerCall<"artifacts.list">["query"];

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
  // Listed and sized through the safe-read primitive: a link in artifacts/ is not an artifact.
  const scope = ctx.scopeOf([root]);
  const realRoot = realpathLenient(root);
  const walk = (dir: string, depth: number) => {
    if (items.length >= LIST_MAX_FILES || depth > 6) return;
    let entries: WorkspaceEntry[];
    try {
      entries = listWorkspaceDir(scope, dir);
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.name.startsWith(".")) continue;
      if (entry.isDirectory) {
        walk(entry.path, depth + 1);
        continue;
      }
      if (!entry.isFile) continue;
      const rel = path.relative(realRoot, entry.path).split(path.sep).join("/");
      const abs = path.join(root, ...rel.split("/"));
      const meta = byRel.get(rel);
      const kind = artifactKind(entry.name);
      const folder = rel.split("/")[0] ?? "";
      items.push({
        id: rel,
        file: meta ? rel.split("/").slice(1).join("/") || entry.name : rel,
        path: abs,
        runId: meta?.runId ?? null,
        skillSlug: meta?.skillSlug ?? null,
        createdAt: meta?.createdAt ?? entry.mtimeMs,
        kind,
        title: artifactTitle(scope, abs, kind),
        folder,
        sizeBytes: entry.size,
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

export interface SystemRouteOptions {
  /** Release checker (tests inject a fake fetch). */
  updates?: UpdateChecker;
}

export function registerSystemRoutes(
  app: FastifyInstance,
  ctx: AppContext,
  opts: SystemRouteOptions = {},
): void {
  const updates = opts.updates ?? new UpdateChecker(PKG_VERSION);

  /**
   * Where this service runs from: the answer to "which MordomoOS am I looking
   * at?" when a checkout and a packaged app share a machine. Token-protected
   * (paths are not for the pre-auth page).
   */
  bind(app, "system.info", async () => {
    const snap = await instanceSnapshot();
    return {
      version: PKG_VERSION,
      home: ctx.paths.home,
      packaged: /\.mjs$/.test(cliEntry()),
      entry: cliEntry(),
      node: process.versions.node,
      execPath: process.execPath,
      platform: process.platform,
      arch: process.arch,
      pid: process.pid,
      startedAt: ctx.startedAt,
      serviceInstalled: isStartupServiceInstalled(ctx.paths),
      releases: RELEASES_PAGE,
      // Is the build on disk newer than this process, and are there other
      // service processes lingering? The UI turns either into a banner.
      build: buildStatus(installedBuildTime(), ctx.startedAt),
      siblings: orphanProcesses(snap.processes, process.pid, process.pid, undefined, snap.listening).map(
        (p) => ({
          pid: p.pid,
          command: p.command,
        }),
      ),
    };
  });

  /**
   * Restart this service with the build on disk. The detached CLI child
   * terminates us (or the login service does) and starts a fresh process;
   * the UI polls `/api/meta` and reloads once it answers again.
   */
  bind(app, "system.restart", async () => {
    const child = spawn(process.execPath, [cliEntry(), "restart"], {
      detached: true,
      stdio: "ignore",
      env: { ...process.env, MORDOMO_HOME: ctx.paths.home },
    });
    child.on("error", () => undefined);
    child.unref();
    return { ok: true as const, pid: process.pid };
  });

  /** Stop lingering sibling service processes (never this one). */
  bind(app, "system.reap", async () => {
    const snap = await instanceSnapshot(process.pid, 0);
    const orphans = orphanProcesses(snap.processes, process.pid, process.pid, undefined, snap.listening);
    const stopped = await terminate(orphans);
    invalidateInstanceSnapshot();
    return { stopped };
  });

  /** Release check: only when enabled in settings, or explicitly asked for (`?force=1`). */
  bind(app, "updates.check", async ({ query }) => {
    const force = query.force === "1";
    const enabled = ctx.settings().updates.check;
    if (!enabled && !force) return { enabled, current: PKG_VERSION, url: RELEASES_PAGE, status: null };
    return { enabled, current: PKG_VERSION, url: RELEASES_PAGE, status: await updates.check(force) };
  });

  // Public (no token): only non-sensitive branding needed before the UI boots.
  bind(app, "meta.get", async () => {
    const s = ctx.settings();
    return {
      name: s.systemName,
      theme: s.theme,
      accentColor: s.accentColor,
      language: s.language,
      setupCompleted: s.setupCompleted,
      version: PKG_VERSION,
      // The contract this service speaks under /api/v1 (the unversioned /api is its alias).
      apiVersion: API_VERSION,
      // Remote TLS (follow-up 10): the pairing screen shows the fingerprint so a phone can check what it trusts.
      tls: tlsInfo(ctx),
      // Which build answers here (pre-auth on purpose: `mordomo launch` uses it to decide whether to restart an older service).
      build: buildStatus(installedBuildTime(), ctx.startedAt),
      entry: cliEntry(),
    };
  });

  bind(app, "health.get", async () => {
    // A closed database is an honest 503 in the envelope (a poller reads it as "not ready", and it is
    // not an unhandled error to log on every poll), never a 200 with `ok: false`.
    if (!ctx.db.open) throw httpError(503, "The database is closed", "service_unavailable");
    const runs = ctx.activeRunCount();
    return {
      // Always true here, and always `db.open`: the soak script and the e2e soak read both of them.
      ok: true as const,
      uptimeMs: Date.now() - ctx.startedAt,
      version: PKG_VERSION,
      db: { open: true as const, path: ctx.paths.dbFile },
      scheduler: { running: ctx.schedulerRunning() },
      activeRuns: runs.running,
      queuedRuns: runs.queued,
      pendingApprovals: ctx.approvals.list("pending").length,
      lastEventId: ctx.events.lastId,
      restorePending: readRestorePending(ctx.paths),
    };
  });

  bind(app, "settings.get", async () => ctx.settings());

  // ---- UI preferences (config/ui-preferences.json) ---------------------------
  bind(app, "uiPreferences.get", async () => ctx.uiPreferences.load());

  bind(app, "uiPreferences.update", async ({ body }) => {
    const { dashboardLayoutBase, ...patch } = body;
    const before = ctx.uiPreferences.load();
    if (
      patch.dashboardLayout &&
      dashboardLayoutBase !== undefined &&
      !isDeepStrictEqual(dashboardLayoutBase, before.dashboardLayout)
    ) {
      throw Object.assign(
        new Error("Layout changed in another window. Reload it or explicitly save your local version."),
        { statusCode: 409, code: "layout_conflict" },
      );
    }
    // Objects merge and arrays replace, like settings; a layout replaces the stored one whole.
    const { dashboardLayout, ...rest } = patch;
    const merged = deepMerge(before, rest as Record<string, unknown>);
    if (dashboardLayout) merged.dashboardLayout = dashboardLayout;
    return ctx.uiPreferences.save(UiPreferencesSchema.parse(merged));
  });

  bind(app, "settings.update", async ({ body: patch }, req) => {
    // What only the Command Centre reads moved to /api/ui-preferences (settings version 2).
    // A body that is not an object (a string, a number) falls through to the schema's 400.
    const body = (req.body && typeof req.body === "object" ? req.body : {}) as Record<string, unknown>;
    const moved = UI_PREFERENCE_KEYS.filter((key) => key in body);
    if (moved.length > 0) {
      throw httpError(
        400,
        `${moved.join(", ")} moved to /api/ui-preferences; save them there.`,
        "moved_to_ui_preferences",
      );
    }
    const before = ctx.settings();
    // A pinned binary is allowlisted by its path: a new one must be the program the manifest names.
    for (const [id, provider] of Object.entries(patch.providers ?? {})) {
      if (!provider.binaryPath || provider.binaryPath === before.providers[id]?.binaryPath) continue;
      requireProvider(ctx, id);
      const { binary } = ctx.providers.manifest(id);
      if (executableName(provider.binaryPath) !== binary) {
        throw httpError(
          400,
          `providers.${id}.binaryPath must point to the "${binary}" executable, not "${provider.binaryPath}".`,
          "binary_mismatch",
        );
      }
    }

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

  bind(app, "providers.list", async ({ query }) => {
    const force = query.force === "1";
    return ctx.providerSnapshot(force);
  });

  bind(app, "providers.detect", async ({ params: { id } }) => {
    const adapter = requireAdapter(ctx, id);
    const detection = await adapter.detect();
    const auth = await adapter.authenticate();
    const models = await adapter.listModels();
    if (detection.binaryPath) {
      const s = ctx.settings();
      s.providers[id] = { ...requireProvider(ctx, id, s), binaryPath: detection.binaryPath };
      ctx.settingsStore.save(s);
      ctx.reloadAdapters();
    }
    ctx.invalidateProviderCache();
    return { detection, auth, models };
  });

  bind(app, "providers.models", async ({ params: { id } }) => {
    return requireAdapter(ctx, id).listModels();
  });

  bind(app, "providers.setDefault", async ({ body: { provider } }) => {
    if (!requireProvider(ctx, provider).enabled) throw httpError(400, `Provider ${provider} is not enabled`);
    return ctx.settingsStore.update({ defaultProvider: provider });
  });

  /** Safe, file-change-free smoke test for one provider. */
  bind(app, "providers.smoke", async ({ params: { id } }, req) => {
    const { run, passed } = await ctx.execution.smokeTest(id, startedByOf(req));
    return { run, passed };
  });

  bind(app, "doctor.get", async ({ query: { audit } }, req) => {
    // The HUD of a paired phone asks for the report too; `npm audit` (a network call, 20 s) is for the owner at the desk.
    return runDoctor(ctx, { npmAudit: audit !== "0" && req.principal?.kind !== "device" });
  });

  /** Hourly samples of the last N days plus their daily fold (Settings › Trends). */
  bind(app, "metrics.history", async ({ query: q }) => {
    const samples = ctx.metricsHistory.series(q.days);
    return { days: q.days, samples, daily: dailyPoints(samples) };
  });

  bind(app, "approvals.list", async () => ctx.approvals.list("pending"));
  /** One approval by id, any status (the permission tool polls this). */
  bind(app, "approvals.get", async ({ params: { id } }, req) => {
    const approval = ctx.approvals.get(id);
    if (!approval) throw httpError(404, "Approval not found");
    if (req.brokerRunId && approval.payload.runId !== req.brokerRunId)
      throw httpError(403, "This approval belongs to another run", "forbidden");
    return approval;
  });
  /**
   * A tool prompt raised inside a running agent (plan Onda 1 §3): the
   * permission MCP server parks it here; the Console, the run page and the
   * inbox offer Approve / Deny; the server answers the CLI when resolved.
   */
  bind(app, "approvals.requestTool", async ({ body }, req) => {
    if (req.brokerRunId && body.runId !== req.brokerRunId)
      throw httpError(403, "The permission broker can only ask for its own run", "forbidden");
    const run = ctx.runs.get(body.runId);
    if (!run) throw httpError(404, "Run not found");
    if (run.status !== "running" && run.status !== "queued") throw httpError(409, "Run is not active");
    const detail = summarizeToolInput(body.toolName, body.input);
    const description = `${body.toolName}: ${detail}`;
    // The tool is the run's request, so it is whoever started the run who asked (a device cannot approve it).
    const approval = ctx.approvals.request(
      "tool_use",
      description,
      {
        runId: body.runId,
        toolName: body.toolName,
        input: body.input,
        ...(body.toolUseId ? { toolUseId: body.toolUseId } : {}),
        // The device that started the run, by the name it was paired with, for the person who decides.
        ...(isDeviceActor(run.startedBy) && run.startedBy
          ? (() => {
              const name = ctx.devices.get(run.startedBy.slice("device:".length))?.name;
              return name ? { requestedByName: name } : {};
            })()
          : {}),
      },
      run.startedBy,
    );
    ctx.runs.annotate(body.runId, {
      type: "permission",
      ts: Date.now(),
      detail: `${description} (approval ${approval.id})`,
    });
    ctx.events.emit("approval.requested", {
      id: approval.id,
      kind: approval.kind,
      description,
      runId: body.runId,
    });
    return approval;
  });
  bind(app, "approvals.resolve", async ({ params: { id }, body: { decision, answers } }, req) => {
    if (req.brokerRunId) {
      // The broker only gives up on its own prompt (timeout); approving is the owner's.
      const approval = ctx.approvals.get(id);
      if (!approval) throw httpError(404, "Approval not found");
      if (approval.payload.runId !== req.brokerRunId)
        throw httpError(403, "This approval belongs to another run", "forbidden");
      if (decision !== "denied") throw httpError(403, "The permission broker cannot approve", "forbidden");
    }
    const onError = (err: unknown, runId: string) =>
      req.log.error({ err, runId, msg: "approved run failed to execute" });
    const by = req.principal ? principalName(req.principal) : null;
    const result = await ctx.execution.resolveApproval(id, decision, by, {
      onError,
      ...(answers ? { answers } : {}),
    });
    return { ...ctx.approvals.get(id)!, runId: result.runId };
  });

  // ---- Backups ---------------------------------------------------------------
  bind(app, "backups.list", async () => listBackups(ctx.paths));
  bind(app, "backups.create", async ({ body: { includeArtifacts } }) => {
    return createBackup(ctx.paths, ctx.db, {
      bus: ctx.events,
      includeArtifacts,
      keep: ctx.settings().limits.backupRetention,
    });
  });

  /**
   * Restore is STAGED, never applied against the open database (audit B2):
   * the backup is copied to config/restore-pending/ and applied by the server
   * on its next boot, before the DB is opened (see AppContext.applyPendingRestore).
   * Refused while any run is active.
   */
  bind(app, "backups.restore", async ({ params: { name } }, _req, reply) => {
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
    // Verified before it is staged: a backup that fails is a `422` now, not a rejection at the next boot.
    await verifyBackup(ctx.paths, name);
    const staged = writeRestorePending(ctx.paths, name);
    reply.code(202);
    return {
      staged: true as const,
      restored: false as const,
      name,
      stagedAt: staged.stagedAt,
      apply: "mordomo stop && mordomo start",
      message:
        "Restore staged. The database is in use, so the backup will be applied on the next service start " +
        "(a safety backup is taken first). Restart with: mordomo stop && mordomo start",
    };
  });
  bind(app, "backups.pending", async () => ({
    restorePending: readRestorePending(ctx.paths),
  }));
  bind(app, "backups.cancelPending", async () => {
    const pending = readRestorePending(ctx.paths);
    clearRestorePending(ctx.paths);
    return { cancelled: pending?.name ?? null };
  });

  // ---- Sync ------------------------------------------------------------------
  bind(app, "sync.plan", async ({ query: { target, context } }) => {
    return syncPlan(ctx, target, context);
  });
  bind(app, "sync.apply", async ({ body }) => {
    const plan = syncPlan(ctx, body.target, body.context);
    return ctx.sync.apply(plan, body.approvedConflicts);
  });

  // ---- Artifacts gallery (desktop search, /artifacts, /generations) --------
  bind(app, "artifacts.list", async ({ query: q }) => {
    return listArtifacts(ctx, q);
  });

  /** Binary artifact (images / video) for thumbnails — strictly inside the artifacts dir, allow-listed types only. */
  bind(app, "artifacts.raw", async ({ query: { p } }, _req, reply) => {
    let file: WorkspaceFile;
    try {
      // PathAccessError → 403; the descriptor, not the path, is what gets streamed.
      file = openWorkspaceFile(ctx.scopeOf([ctx.paths.artifacts]), p);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT" || err instanceof NotRegularFileError)
        throw httpError(404, "Artifact not found");
      throw err;
    }
    const mime = RAW_MIME[path.extname(file.path).toLowerCase()];
    if (!mime) {
      file.close();
      throw httpError(415, "Not a previewable artifact type");
    }
    if (file.stat.size > RAW_MAX_BYTES) {
      file.close();
      throw httpError(413, "Artifact larger than 25 MB — open it from disk.");
    }
    reply.header("content-type", mime);
    reply.header("cache-control", "private, max-age=300");
    reply.header("x-content-type-options", "nosniff");
    return reply.send(file.createReadStream());
  });

  bind(app, "startup.plan", async () => planStartupService(ctx.paths, process.execPath));

  bind(app, "diagnostics.export", async () => {
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
