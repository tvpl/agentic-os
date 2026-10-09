import crypto from "node:crypto";
import {
  MordomoEngine,
  ProviderSettingsSchema,
  budgetDedupeKey,
  events,
  localDay,
  installedVersion,
  versionStatus,
  type BudgetCrossedPayload,
  type HealthStatus,
  type MetricsSample,
  type PermissionBroker,
  type ProviderCapabilities,
  type ProviderId,
  type SecurityProfile,
  type TelegramPoller,
  type TestedVersions,
  type VersionStatus,
} from "@mordomo/core";
import { cliEntry, seedDir } from "./entry.js";
import { buildProviderRegistry } from "./providers.js";

export interface ProviderSnapshot {
  id: ProviderId;
  displayName: string;
  capabilities: ProviderCapabilities;
  installHint: string;
  /** What a person runs in a terminal to sign the CLI in (from the manifest). */
  loginCommand: string;
  enabled: boolean;
  isDefault: boolean;
  health: HealthStatus;
  /** The `major.minor.patch` read from `health.version` (the CLI's own `--version` text); null when there is none. */
  installedVersion: string | null;
  /** `installedVersion` against `testedVersions`; only informs, never blocks a run. */
  versionStatus: VersionStatus;
  /** The range this MordomoOS release was developed against; null when the provider declares none. */
  testedVersions: TestedVersions | null;
  defaultModel: string | null;
  defaultEffort: string;
}

export {
  RESTORE_PENDING_DIR,
  applyPendingRestore,
  clearRestorePending,
  readRestorePending,
  restorePendingDir,
  writeRestorePending,
  type RestorePending,
} from "@mordomo/core";

export interface AppContextOptions {
  /**
   * Apply a restore staged by `POST /api/backups/:name/restore` before the
   * database is opened. Only the long-running server passes this; CLI
   * commands that merely open the context must not silently restore.
   */
  applyPendingRestore?: boolean;
}

/**
 * The engine plus what only the HTTP API needs: the local token, the
 * permission-broker credentials, the provider health cache and the Telegram
 * poller. Building one changes nothing (every CLI command builds one); the
 * service calls `start()` to own the home (`startServer`).
 */
export class AppContext extends MordomoEngine {
  /** Telegram inbound poller; created and started by the server (needs the approval actions). */
  telegramPoller: TelegramPoller | null = null;

  private healthCache = new Map<ProviderId, { at: number; health: HealthStatus }>();
  private healthInFlight = new Map<ProviderId, Promise<HealthStatus>>();

  constructor(homeOverride?: string, opts: AppContextOptions = {}) {
    super({
      ...(homeOverride ? { home: homeOverride } : {}),
      providers: buildProviderRegistry(),
      // Packaged installs ship their skills/routines/connectors next to the bundle.
      seedDir: seedDir(),
      applyPendingRestore: opts.applyPendingRestore === true,
    });
  }

  /** Re-create the provider adapters from the settings on disk (binaryPath etc.). */
  override reloadAdapters(): void {
    super.reloadAdapters();
    this.invalidateProviderCache();
  }

  /**
   * The permission MCP server for a write run: `mordomo mcp permission`,
   * spawned by the provider CLI with the local URL, the local token and the
   * run id in its environment. Profiles that answer prompts themselves
   * (approved_automation) and read-only runs get none.
   */
  override permissionBrokerFor(run: {
    id: string;
    permissionProfile: SecurityProfile | null;
  }): PermissionBroker | null {
    const settings = this.settings();
    const profile = run.permissionProfile ?? settings.securityProfile;
    if (profile !== "review_before_write" && profile !== "controlled_write") return null;
    // Its own credential, never the local token: it can raise, read and deny
    // this run's approvals only, and dies with the run (AD-002).
    const credential = `brk_${crypto.randomBytes(32).toString("base64url")}`;
    this.brokerCredentials.set(credential, run.id);
    return {
      command: process.execPath,
      args: [cliEntry(), "mcp", "permission"],
      env: {
        MORDOMO_URL: `http://127.0.0.1:${settings.port}`,
        MORDOMO_TOKEN: credential,
        MORDOMO_RUN_ID: run.id,
        MORDOMO_APPROVAL_TIMEOUT_MS: String(settings.limits.toolApprovalTimeoutMs ?? 600_000),
        ...(this.paths.home ? { MORDOMO_HOME: this.paths.home } : {}),
      },
    };
  }

  token(): string {
    return this.settingsStore.getOrCreateToken();
  }

  /** Permission-broker credential → the run it was issued for. In memory: a restart interrupts every run anyway. */
  private readonly brokerCredentials = new Map<string, string>();

  /**
   * The run a broker credential belongs to, and whether it still counts: only
   * while that run is queued or running. A dead credential is forgotten.
   */
  brokerRunFor(credential: string): { runId: string; active: boolean } | null {
    const runId = this.brokerCredentials.get(credential);
    if (!runId) return null;
    const status = this.runs.get(runId)?.status;
    if (status === "queued" || status === "running") return { runId, active: true };
    this.brokerCredentials.delete(credential);
    return { runId, active: false };
  }

  async providerSnapshot(force = false): Promise<ProviderSnapshot[]> {
    const settings = this.settings();
    const out: ProviderSnapshot[] = [];
    for (const id of this.providers.ids()) {
      const manifest = this.providers.manifest(id);
      const health = await this.providerHealth(id, force);
      const prefs = settings.providers[id] ?? ProviderSettingsSchema.parse({});
      out.push({
        id,
        displayName: manifest.displayName,
        capabilities: manifest.capabilities,
        installHint: manifest.installHint,
        loginCommand: manifest.loginCommand,
        enabled: prefs.enabled,
        isDefault: settings.defaultProvider === id,
        health,
        installedVersion: installedVersion(health.version),
        versionStatus: versionStatus(manifest.testedVersions, health.version),
        testedVersions: manifest.testedVersions ?? null,
        defaultModel: prefs.defaultModel,
        defaultEffort: prefs.defaultEffort,
      });
    }
    return out;
  }

  private providerHealth(id: ProviderId, force: boolean): Promise<HealthStatus> {
    const cached = this.healthCache.get(id);
    if (!force && cached && Date.now() - cached.at < 60_000) return Promise.resolve(cached.health);
    const pending = this.healthInFlight.get(id);
    if (pending) return pending;
    const adapter = this.adapters[id];
    const request = Promise.resolve()
      .then(() => adapter!.healthCheck())
      .then((health) => {
        // An invalidation/reload may replace this request while its CLI is running.
        if (this.healthInFlight.get(id) === request) {
          this.healthCache.set(id, { at: Date.now(), health });
        }
        return health;
      })
      .finally(() => {
        if (this.healthInFlight.get(id) === request) this.healthInFlight.delete(id);
      });
    this.healthInFlight.set(id, request);
    return request;
  }

  invalidateProviderCache(): void {
    this.healthCache.clear();
    this.healthInFlight.clear();
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

  /** One hourly snapshot of the live numbers into `metrics_samples` (the sweep calls this). */
  sampleMetrics(now = Date.now()): MetricsSample {
    const m = this.runs.metrics();
    const dayAgo = now - 86_400_000;
    const last24 = this.db
      .prepare(
        "SELECT COUNT(*) c, SUM(CASE WHEN status IN ('failed','timed_out') THEN 1 ELSE 0 END) f FROM runs WHERE created_at >= ?",
      )
      .get(dayAgo) as { c: number; f: number | null };
    const wait = this.db
      .prepare(
        "SELECT AVG(resolved_at - created_at) w FROM approvals WHERE resolved_at IS NOT NULL AND resolved_at >= ?",
      )
      .get(dayAgo) as { w: number | null };
    return this.metricsHistory.sample(
      {
        runs: {
          total: m.total,
          last24h: last24.c,
          failed24h: last24.f ?? 0,
          costTodayUsd: m.cost.todayUsd,
          tokensToday: m.cost.tokensToday,
          spendWeekUsd: m.cost.weekUsd,
        },
        inboxUnread: this.notifications.unreadCount(),
        approvalsPending: this.approvals.list("pending").length,
        approvalWaitAvgMs: wait.w == null ? null : Math.round(wait.w),
      },
      now,
    );
  }

  override close(): void {
    this.telegramPoller?.stop();
    super.close();
  }
}
