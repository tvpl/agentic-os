import crypto from "node:crypto";
import type { HealthStatus, PermissionBroker, ProviderCapabilities, RunMode } from "@mordomo/core";
import {
  MordomoEngine,
  ProviderSettingsSchema,
  budgetDedupeKey,
  localDay,
  installedVersion,
  versionStatus,
  type BudgetCrossedPayload,
  type HostResolver,
  type MetricsSample,
  type ProviderId,
  type SecurityProfile,
  type TelegramPoller,
  type TestedVersions,
  type VersionStatus,
} from "@mordomo/core/internal";
import { cliEntry, seedDir } from "./entry.js";
import { buildProviderRegistry } from "./providers.js";
import { TicketStore } from "./tickets.js";

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
} from "@mordomo/core/internal";

export interface AppContextOptions {
  /** How long to wait for a restore running in another process before refusing (ms). */
  restoreWaitMs?: number;
  /**
   * Apply a restore staged by `POST /api/backups/:name/restore` before the
   * database is opened. Only the long-running server passes this; CLI
   * commands that merely open the context must not silently restore.
   */
  applyPendingRestore?: boolean;
  /** How a push endpoint's host is resolved (tests replace the system's DNS). */
  pushResolver?: HostResolver;
}

/**
 * The engine plus what only the HTTP API needs: the local token, the
 * permission-broker credentials, the provider health cache and the Telegram
 * poller. Building one changes nothing (every CLI command builds one); the
 * service calls `start()` to own the home (`startServer`).
 */
/** Writes (journal lines, facts) one run credential may make, and all of them together in a day. */
const MEMORY_WRITES_PER_RUN = 100;
const MEMORY_WRITES_PER_DAY = 500;

export class AppContext extends MordomoEngine {
  /** Telegram inbound poller; created and started by the server (needs the approval actions). */
  telegramPoller: TelegramPoller | null = null;

  /** The tickets that open the two SSE streams without a credential in the URL (`POST /api/stream-tickets`). */
  readonly streamTickets = new TicketStore();

  private healthCache = new Map<ProviderId, { at: number; health: HealthStatus }>();
  private healthInFlight = new Map<ProviderId, Promise<HealthStatus>>();

  constructor(homeOverride?: string, opts: AppContextOptions = {}) {
    super({
      ...(homeOverride ? { home: homeOverride } : {}),
      providers: buildProviderRegistry(),
      // Packaged installs ship their skills/routines/connectors next to the bundle.
      seedDir: seedDir(),
      applyPendingRestore: opts.applyPendingRestore === true,
      ...(opts.pushResolver ? { pushResolver: opts.pushResolver } : {}),
      ...(opts.restoreWaitMs !== undefined ? { restoreWaitMs: opts.restoreWaitMs } : {}),
    });
    this.unsubscribeCredentials = this.events.subscribe((e) => {
      if (e.type !== "run.finished") return;
      const runId = (e.payload as { runId?: string }).runId;
      if (runId) this.forgetCredentialsOf(runId);
    });
  }

  private readonly unsubscribeCredentials: () => void;

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

  /** Run-scoped API credential → the run it was issued for and whether that run may write (same lifetime rule as the broker's). */
  private readonly runApiCredentials = new Map<string, { runId: string; writable: boolean }>();

  /**
   * A run of a memory skill calls the memory routes of this API with a credential of its own
   * (`MORDOMO_RUN_TOKEN`), never with the owner token it cannot read: `rc_` + 32 random bytes, accepted only while
   * the run is queued or running, only on the routes in `RUN_API_*_ROUTES`, and for the routes that write only
   * when the run itself may write (docs/security.md, AD-012).
   */
  override runApiAccessFor(run: { id: string }, mode: RunMode): { url: string; token: string } | null {
    const credential = `rc_${crypto.randomBytes(32).toString("base64url")}`;
    this.runApiCredentials.set(credential, { runId: run.id, writable: mode === "write" });
    return { url: `http://127.0.0.1:${this.settings().port}`, token: credential };
  }

  runApiRunFor(credential: string): { runId: string; active: boolean; writable: boolean } | null {
    const entry = this.runApiCredentials.get(credential);
    if (!entry) return null;
    const status = this.runs.get(entry.runId)?.status;
    if (status === "queued" || status === "running") return { ...entry, active: true };
    this.runApiCredentials.delete(credential);
    return { ...entry, active: false };
  }

  /** A finished run keeps no credential: both maps drop its entries the moment it settles. */
  private forgetCredentialsOf(runId: string): void {
    for (const [credential, id] of this.brokerCredentials)
      if (id === runId) this.brokerCredentials.delete(credential);
    for (const [credential, entry] of this.runApiCredentials) {
      if (entry.runId === runId) this.runApiCredentials.delete(credential);
    }
  }

  /** How many writes (journal lines, facts) run credentials made today, and per run. */
  private readonly memoryWrites = { day: "", total: 0, perRun: new Map<string, number>() };

  /**
   * One more write by a run credential, or a `429`: a run that loops (or an injected prompt that makes it) cannot
   * fill the journal or the fact table. The caps are per run and per day across runs.
   */
  noteMemoryWrite(runId: string): void {
    const day = new Date().toISOString().slice(0, 10);
    if (this.memoryWrites.day !== day) {
      this.memoryWrites.day = day;
      this.memoryWrites.total = 0;
      this.memoryWrites.perRun.clear();
    }
    const mine = (this.memoryWrites.perRun.get(runId) ?? 0) + 1;
    if (mine > MEMORY_WRITES_PER_RUN || this.memoryWrites.total + 1 > MEMORY_WRITES_PER_DAY) {
      throw Object.assign(new Error("Too many memory writes by runs; try later"), {
        statusCode: 429,
        code: "too_many_requests",
      });
    }
    this.memoryWrites.perRun.set(runId, mine);
    this.memoryWrites.total += 1;
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
    this.events.emit("budget.crossed", payload);
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
    this.unsubscribeCredentials();
    this.telegramPoller?.stop();
    super.close();
  }
}
