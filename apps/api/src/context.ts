import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  ApprovalStore,
  ConnectorRegistry,
  MemoryIndexer,
  NotificationStore,
  RoutineScheduler,
  RoutineStore,
  RunManager,
  SettingsStore,
  SkillCatalog,
  SyncCompiler,
  budgetDedupeKey,
  ensureDirs,
  events,
  installJournalHooks,
  installNotificationRecorder,
  localDay,
  openDb,
  resolvePaths,
  restoreBackup,
  type AgentAdapter,
  type BudgetCrossedPayload,
  type Db,
  type HealthStatus,
  type MordomoPaths,
  type ProviderCapabilities,
  type ProviderId,
  type ProviderRegistry,
  type Settings,
  type SecurityProfile,
  type PermissionBroker,
} from "@mordomo/core";
import { buildProviderRegistry } from "./providers.js";

export interface ProviderSnapshot {
  id: ProviderId;
  displayName: string;
  capabilities: ProviderCapabilities;
  installHint: string;
  enabled: boolean;
  isDefault: boolean;
  health: HealthStatus;
  defaultModel: string | null;
  defaultEffort: string;
}

export interface AppContextOptions {
  /**
   * Apply a restore staged by `POST /api/backups/:name/restore` before the
   * database is opened. Only the long-running server passes this; CLI
   * commands that merely open the context must not silently restore.
   */
  applyPendingRestore?: boolean;
}

/** Marker + copy written by the API when a restore cannot run against the open DB. */
export interface RestorePending {
  name: string;
  stagedAt: number;
  stagedPath: string;
}

export const RESTORE_PENDING_DIR = "restore-pending";
const RESTORE_MARKER = "PENDING.json";

export function restorePendingDir(paths: MordomoPaths): string {
  return path.join(paths.config, RESTORE_PENDING_DIR);
}

export function readRestorePending(paths: MordomoPaths): RestorePending | null {
  const marker = path.join(restorePendingDir(paths), RESTORE_MARKER);
  try {
    const raw = JSON.parse(fs.readFileSync(marker, "utf8")) as Partial<RestorePending>;
    if (typeof raw.name !== "string" || typeof raw.stagedAt !== "number") return null;
    return {
      name: raw.name,
      stagedAt: raw.stagedAt,
      stagedPath: path.join(restorePendingDir(paths), raw.name),
    };
  } catch {
    return null;
  }
}

export function writeRestorePending(paths: MordomoPaths, name: string): RestorePending {
  const dir = restorePendingDir(paths);
  const stagedPath = path.join(dir, name);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  fs.cpSync(path.join(paths.backups, name), stagedPath, { recursive: true });
  const info: RestorePending = { name, stagedAt: Date.now(), stagedPath };
  fs.writeFileSync(
    path.join(dir, RESTORE_MARKER),
    JSON.stringify({ name, stagedAt: info.stagedAt }, null, 2) + "\n",
  );
  return info;
}

export function clearRestorePending(paths: MordomoPaths): void {
  fs.rmSync(restorePendingDir(paths), { recursive: true, force: true });
}

/**
 * Apply a staged restore. Must be called with NO database handle open
 * (i.e. before `openDb`). If the original backup directory is gone the
 * staged copy is moved back into `backups/` first.
 */
export function applyPendingRestore(paths: MordomoPaths): { applied: RestorePending | null } {
  const pending = readRestorePending(paths);
  if (!pending) return { applied: null };
  const original = path.join(paths.backups, pending.name);
  if (!fs.existsSync(original) && fs.existsSync(pending.stagedPath)) {
    fs.cpSync(pending.stagedPath, original, { recursive: true });
  }
  try {
    restoreBackup(paths, pending.name);
  } finally {
    clearRestorePending(paths);
  }
  return { applied: pending };
}

function buildAdapters(registry: ProviderRegistry, settings: Settings): Record<ProviderId, AgentAdapter> {
  return registry.createAll((id) => settings.providers[id]?.binaryPath ?? null);
}

export class AppContext {
  readonly paths: MordomoPaths;
  readonly settingsStore: SettingsStore;
  readonly db: Db;
  readonly runs: RunManager;
  readonly skills: SkillCatalog;
  readonly indexer: MemoryIndexer;
  readonly routines: RoutineStore;
  readonly scheduler: RoutineScheduler;
  readonly connectors: ConnectorRegistry;
  readonly sync: SyncCompiler;
  readonly approvals: ApprovalStore;
  /** Persisted inbox (Onda 2): approvals, failed runs, alerts, budget warnings. */
  readonly notifications: NotificationStore;
  /** Registered providers (manifests + factories); the single place the API learns which providers exist. */
  readonly providers: ProviderRegistry;
  readonly startedAt = Date.now();
  /** Restore applied at boot (see `applyPendingRestore`), for the startup log. */
  readonly restoredAtBoot: RestorePending | null = null;

  private adapterRecord: Record<ProviderId, AgentAdapter>;
  private healthCache = new Map<ProviderId, { at: number; health: HealthStatus }>();

  constructor(homeOverride?: string, opts: AppContextOptions = {}) {
    this.paths = resolvePaths(homeOverride);
    ensureDirs(this.paths);
    if (opts.applyPendingRestore) {
      this.restoredAtBoot = applyPendingRestore(this.paths).applied;
    }
    this.settingsStore = new SettingsStore(this.paths);
    this.db = openDb(this.paths).db;
    this.providers = buildProviderRegistry();
    this.adapterRecord = buildAdapters(this.providers, this.settingsStore.load());
    this.skills = new SkillCatalog(this.paths);
    // The adapter callback reads the CURRENT record, so `reloadAdapters()`
    // takes effect for the next run without rebuilding the RunManager.
    this.runs = new RunManager(
      this.db,
      this.paths,
      () => this.settings(),
      (id) => this.adapters[id],
      { permissionBroker: (run) => this.permissionBrokerFor(run) },
    );
    this.indexer = new MemoryIndexer(this.db, () => this.settings());
    this.routines = new RoutineStore(this.paths);
    this.scheduler = new RoutineScheduler(this.db, this.paths, this.routines, this.runs, this.skills, () =>
      this.settings(),
    );
    this.connectors = new ConnectorRegistry(this.paths);
    this.sync = new SyncCompiler(
      this.paths,
      () => this.settings(),
      () => this.skills.list(),
      () => this.providers.manifests(),
    );
    this.approvals = new ApprovalStore(this.db, () => this.settings().limits.approvalTtlDays * 86_400_000);
    // The daily journal listens for finished runs. Installing it here (and not
    // only when the HTTP routes are registered) means CLI paths — `mordomo
    // index`, `mordomo run` — also index `memory/journal/**` and log their run
    // line. The install is idempotent, so the route-level one is a no-op.
    this.disposeJournalHooks = installJournalHooks(events, this.paths, {
      indexer: this.indexer,
      runs: { get: (id) => this.runs.get(id), lastReply: (id) => this.runs.lastAssistantText(id) },
    });
    // The inbox listens on the same bus: approvals, failed runs, heartbeat
    // alerts and budget thresholds become rows that survive a closed tab.
    this.notifications = new NotificationStore(this.db);
    this.disposeNotificationRecorder = installNotificationRecorder(events, this.notifications, {
      runs: this.runs,
      routines: this.routines,
    });
  }

  private readonly disposeJournalHooks: () => void;
  private readonly disposeNotificationRecorder: () => void;

  /** Live adapters — rebuilt by `reloadAdapters()` whenever settings change. */
  get adapters(): Record<ProviderId, AgentAdapter> {
    return this.adapterRecord;
  }

  /** Re-create the provider adapters from the settings on disk (binaryPath etc.). */
  reloadAdapters(): void {
    this.adapterRecord = buildAdapters(this.providers, this.settings());
    this.invalidateProviderCache();
  }

  settings(): Settings {
    return this.settingsStore.load();
  }

  /**
   * The permission MCP server for a write run: `mordomo mcp permission`,
   * spawned by the provider CLI with the local URL, the local token and the
   * run id in its environment. Profiles that answer prompts themselves
   * (approved_automation) and read-only runs get none.
   */
  permissionBrokerFor(run: {
    id: string;
    permissionProfile: SecurityProfile | null;
  }): PermissionBroker | null {
    const settings = this.settings();
    const profile = run.permissionProfile ?? settings.securityProfile;
    if (profile !== "review_before_write" && profile !== "controlled_write") return null;
    return {
      command: process.execPath,
      args: [fileURLToPath(new URL("./cli.js", import.meta.url)), "mcp", "permission"],
      env: {
        MORDOMO_URL: `http://127.0.0.1:${settings.port}`,
        MORDOMO_TOKEN: this.token(),
        MORDOMO_RUN_ID: run.id,
        MORDOMO_APPROVAL_TIMEOUT_MS: String(settings.limits.toolApprovalTimeoutMs ?? 600_000),
        ...(this.paths.home ? { MORDOMO_HOME: this.paths.home } : {}),
      },
    };
  }

  token(): string {
    return this.settingsStore.getOrCreateToken();
  }

  async providerSnapshot(force = false): Promise<ProviderSnapshot[]> {
    const settings = this.settings();
    const out: ProviderSnapshot[] = [];
    for (const id of this.providers.ids()) {
      const manifest = this.providers.manifest(id);
      const cached = this.healthCache.get(id);
      let health: HealthStatus;
      if (!force && cached && Date.now() - cached.at < 60_000) {
        health = cached.health;
      } else {
        health = await this.adapters[id].healthCheck();
        this.healthCache.set(id, { at: Date.now(), health });
      }
      out.push({
        id,
        displayName: manifest.displayName,
        capabilities: manifest.capabilities,
        installHint: manifest.installHint,
        enabled: settings.providers[id].enabled,
        isDefault: settings.defaultProvider === id,
        health,
        defaultModel: settings.providers[id].defaultModel,
        defaultEffort: settings.providers[id].defaultEffort,
      });
    }
    return out;
  }

  invalidateProviderCache(): void {
    this.healthCache.clear();
  }

  /** Runs that are executing or waiting for a slot (a restore must not run under them). */
  activeRunCount(): { running: number; queued: number } {
    return {
      running: this.runs.count({ status: "running" }),
      queued: this.runs.count({ status: "queued" }),
    };
  }

  /** Whether the cron scheduler is started. */
  schedulerRunning(): boolean {
    return this.scheduler.isRunning();
  }

  /**
   * Sweep approvals past their TTL and cancel the runs they were gating.
   * Called on boot and hourly by the service. Returns how many expired.
   */
  expireStaleApprovals(): number {
    const expired = this.approvals.expireStale();
    for (const approval of expired) {
      const runId = approval.payload.runId;
      if (typeof runId !== "string") continue;
      void this.runs.cancel(runId, `Approval expired after ${this.settings().limits.approvalTtlDays} days`);
    }
    if (expired.length > 0) events.emit("approval.expired", { count: expired.length });
    return expired.length;
  }

  /**
   * Warn once a day when today's spend crosses 80 % or 100 % of
   * `settings.limits.dailyBudgetUsd` (0 = no budget). Called at boot and
   * hourly by the service; the `budget.crossed` event becomes an inbox row
   * through the recorder. Returns the level announced, or null.
   */
  checkDailyBudget(now = Date.now()): 80 | 100 | null {
    const budgetUsd = this.settings().limits.dailyBudgetUsd;
    if (!(budgetUsd > 0)) return null;
    const spentUsd = this.runs.costMetrics(now).todayUsd;
    const level = spentUsd >= budgetUsd ? 100 : spentUsd >= budgetUsd * 0.8 ? 80 : null;
    if (level === null) return null;
    const day = localDay(now);
    // Once per day per level, even across restarts: the row is the ledger.
    if (this.notifications.hasDedupeKey(budgetDedupeKey(day, level))) return null;
    const payload: BudgetCrossedPayload = { level, day, spentUsd, budgetUsd };
    events.emit("budget.crossed", payload);
    return level;
  }

  close(): void {
    this.disposeJournalHooks();
    this.disposeNotificationRecorder();
    this.scheduler.stop();
    if (this.db.open) this.db.close();
  }
}
