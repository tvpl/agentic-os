/**
 * The engine, assembled (.specs/features/motor-composicao). `createEngine()`
 * builds every store and manager over one MordomoOS home and changes nothing
 * on disk beyond opening (and migrating) the database. Only the process that
 * calls `start()` owns the home: it takes `config/run/engine.lock`, prunes,
 * recovers objective steps and orphaned runs, and starts the scheduler and the
 * sentinels. CLI commands build an engine and never start it, so they cannot
 * disturb a running service.
 *
 * The write policy lives here too (`gateWrite`, `assertWriteAllowed`,
 * `resolveCwd`), so a program embedding the engine gets the same rules the
 * HTTP API applies.
 */
import path from "node:path";
import type { AgentAdapter, PermissionBroker, RunMode } from "./agents/types.js";
import type { ProviderRegistry } from "./agents/registry.js";
import {
  BackupVerificationError,
  applyPendingRestoreLocked,
  readRestorePending,
  recoverLocked,
  type RestorePending,
} from "./backup.js";
import { RestoreLock } from "./restoreLock.js";
import { installPushChannel } from "./channels/pushChannel.js";
import { installTelegramChannel } from "./channels/telegram.js";
import type { EffortLevel, ProviderId, SecurityProfile, Settings } from "./config/schema.js";
import { SettingsStore } from "./config/store.js";
import { UiPreferencesStore } from "./config/preferences.js";
import { ConnectorRegistry } from "./connectors/registry.js";
import { openDb, type Db } from "./db/db.js";
import { events } from "./events.js";
import { MemoryIndexer } from "./memory/indexer.js";
import { installJournalHooks } from "./memory/journal.js";
import { MetricsHistory } from "./metrics/history.js";
import { PushStore } from "./notifications/pushStore.js";
import { installNotificationRecorder } from "./notifications/recorder.js";
import { NotificationStore } from "./notifications/store.js";
import { ObjectiveStore } from "./objectives/objectiveStore.js";
import { OwnerLock } from "./ownerLock.js";
import { ensureDirs, resolvePaths, seedHome, tightenHomeFiles, type MordomoPaths } from "./paths.js";
import { RoutineScheduler } from "./routines/scheduler.js";
import { RoutineStore } from "./routines/store.js";
import { RunManager, providerEnvDrop, type CreateRunInput } from "./runs/runManager.js";
import { ApprovalStore, type Approval } from "./security/approvals.js";
import { DeviceStore } from "./security/devices.js";
import { grantedReadScope, readScope, type ReadScope } from "./security/safeFs.js";
import { writeDecision, type WriteOrigin } from "./security/profiles.js";
import { SentinelRunner } from "./sentinels/runner.js";
import { SkillCatalog } from "./skills/catalog.js";
import { SkillRegistry } from "./skills/registry.js";
import { executableName, setProbeEnvDrop, setProviderBinaries } from "./spawn/safeSpawn.js";
import { SyncCompiler } from "./sync/compiler.js";

export interface EngineOptions {
  /** The MordomoOS home; defaults to `MORDOMO_HOME` / the platform default (`resolvePaths`). */
  home?: string;
  /** Registered providers (manifest + factory per adapter package). */
  providers: ProviderRegistry;
  /** Directory with seed skills/routines/connectors copied into a new home; `null` = none. */
  seedDir?: string | null;
  /** Apply a restore staged by the API before the database is opened (the long-running service only). */
  applyPendingRestore?: boolean;
  /** How long to wait for a restore running in another process before refusing (ms, default 10 000). */
  restoreWaitMs?: number;
  /** How a write run's provider CLI asks a human before a tool runs; absent = never brokered. */
  permissionBroker?: (run: {
    id: string;
    permissionProfile: SecurityProfile | null;
  }) => PermissionBroker | null;
}

/** What a gated write run carries: the prompt or skill run to launch once a human approves. */
export interface PromptRunInput {
  prompt: string;
  provider: ProviderId;
  model: string | null;
  effort: EffortLevel;
  mode: RunMode;
  cwd: string;
  timeoutMs: number;
  /** Conversation this run belongs to, so a run released from approval resumes it. */
  sessionId?: string;
  /** Squad: the run this one was fanned out from. */
  parentRunId?: string;
}

export interface SkillRunInput {
  slug: string;
  inputs: Record<string, string>;
  provider: ProviderId;
  model: string | null;
  effort: EffortLevel;
  cwd: string;
  timeoutMs: number;
  /** First run in the lineage when this is a deliberate retry. */
  parentRunId?: string | null;
}

/** What an approved `write_run` approval replays (also its stored payload shape). */
export type GatedRunPayload =
  { kind: "prompt"; input: PromptRunInput } | { kind: "skill"; input: SkillRunInput };

export interface WriteGate {
  /** Pending approval created instead of launching the run (profile `review_before_write`). */
  pendingApproval: Approval | null;
  /** Run row parked in `waiting_approval` and linked to that approval. */
  runId: string | null;
}

/** A stored `binaryPath` the engine refuses to run: its basename is not the manifest's `binary`. */
export interface IgnoredBinaryPath {
  provider: ProviderId;
  binaryPath: string;
  /** The executable the provider's manifest names. */
  binary: string;
}

/**
 * Stored `providers.<id>.binaryPath` values that do not name their manifest's
 * `binary` (basename, without `.exe`/`.cmd`/`.bat` on Windows). However such a
 * value got into `settings.json` (written before the check existed, edited by
 * hand), the engine never pins it: the adapter discovers the binary on PATH
 * instead, and `mordomo doctor` names the ignored path.
 */
export function ignoredBinaryPaths(
  registry: ProviderRegistry,
  settings: Settings,
  platform: NodeJS.Platform = process.platform,
): IgnoredBinaryPath[] {
  const ignored: IgnoredBinaryPath[] = [];
  for (const manifest of registry.manifests()) {
    const binaryPath = settings.providers[manifest.id]?.binaryPath;
    if (binaryPath && executableName(binaryPath, platform) !== manifest.binary)
      ignored.push({ provider: manifest.id, binaryPath, binary: manifest.binary });
  }
  return ignored;
}

/** One adapter per registered provider; their executables become the spawn allowlist. */
function buildAdapters(registry: ProviderRegistry, settings: Settings): Record<ProviderId, AgentAdapter> {
  setProviderBinaries(registry.manifests().map((m) => m.binary));
  const ignored = new Set(ignoredBinaryPaths(registry, settings).map((i) => i.provider));
  return registry.createAll((id) => (ignored.has(id) ? null : (settings.providers[id]?.binaryPath ?? null)));
}

export class MordomoEngine {
  readonly paths: MordomoPaths;
  readonly settingsStore: SettingsStore;
  /** What only the Command Centre reads and writes (`config/ui-preferences.json`). */
  readonly uiPreferences: UiPreferencesStore;
  readonly db: Db;
  readonly runs: RunManager;
  readonly objectives: ObjectiveStore;
  readonly skills: SkillCatalog;
  readonly indexer: MemoryIndexer;
  readonly routines: RoutineStore;
  readonly scheduler: RoutineScheduler;
  readonly connectors: ConnectorRegistry;
  readonly sync: SyncCompiler;
  readonly approvals: ApprovalStore;
  /** Persisted inbox: approvals, failed runs, alerts, budget warnings. */
  readonly notifications: NotificationStore;
  /** Paired devices for remote access. */
  readonly devices: DeviceStore;
  /** Skill registries: cached indexes and verified staging. */
  readonly skillRegistry: SkillRegistry;
  /** Sentinels: the cheap observers plus the triage listener; watching starts with `start()`. */
  readonly sentinels: SentinelRunner;
  /** Registered providers (manifests + factories). */
  readonly providers: ProviderRegistry;
  /** Web Push subscriptions and the VAPID pair. */
  readonly push: PushStore;
  /** Hourly metrics snapshots. */
  readonly metricsHistory: MetricsHistory;
  readonly startedAt = Date.now();
  /** Restore applied while building (see `EngineOptions.applyPendingRestore`). */
  readonly restoredAtBoot: RestorePending | null = null;
  /**
   * A restore staged for this boot that failed verification (a backup that is tampered, truncated or unsealed):
   * nothing was changed, the service starts with the data it has, and the owner is told why.
   */
  readonly restoreRejectedAtBoot: { name: string; message: string } | null = null;

  private adapterRecord: Record<ProviderId, AgentAdapter>;
  private readonly disposers: Array<() => void> = [];
  private readonly brokerFactory: EngineOptions["permissionBroker"];
  private ownerLock: OwnerLock | null = null;

  constructor(opts: EngineOptions) {
    this.paths = resolvePaths(opts.home);
    ensureDirs(this.paths);
    // The files of the home are not ours to build on while a restore replaces them: wait for it to finish, or
    // refuse (`RestoreInProgressError`) - never open (and so create) a database the restore is about to put
    // in place. The lock is held until the database is open, so a restore that starts next finds it open.
    const restoreLock = RestoreLock.acquire(this.paths, opts.restoreWaitMs ?? 10_000);
    try {
      if (opts.seedDir) seedHome(this.paths, opts.seedDir);
      // Whatever command built this engine, a restore that died half way is undone before the database opens.
      recoverLocked(this.paths);
      if (opts.applyPendingRestore) {
        const pending = readRestorePending(this.paths);
        try {
          this.restoredAtBoot = applyPendingRestoreLocked(this.paths).applied;
        } catch (error) {
          if (!(error instanceof BackupVerificationError) || pending === null) throw error;
          this.restoreRejectedAtBoot = { name: pending.name, message: error.message };
        }
      }
      this.brokerFactory = opts.permissionBroker;
      this.settingsStore = new SettingsStore(this.paths);
      // A saved preference is announced like a settings change, so every open
      // Command Centre refreshes it (the event map has no separate type for it).
      this.uiPreferences = new UiPreferencesStore(this.paths, () =>
        events.emit("settings.changed", { settings: this.settings() }),
      );
      this.db = openDb(this.paths).db;
    } finally {
      restoreLock.release();
    }
    tightenHomeFiles(this.paths);
    this.providers = opts.providers;
    this.adapterRecord = buildAdapters(this.providers, this.settingsStore.load());
    setProbeEnvDrop(providerEnvDrop(this.settingsStore.load()));
    this.skills = new SkillCatalog(this.paths, () => this.settings().memorySkills);
    // The adapter callback reads the CURRENT record, so `reloadAdapters()`
    // takes effect for the next run without rebuilding the RunManager.
    // Pruning is the owner's job (`start()`), never a side effect of building.
    this.runs = new RunManager(
      this.db,
      this.paths,
      () => this.settings(),
      (id) => this.adapters[id],
      {
        pruneOnBoot: false,
        permissionBroker: (run) => this.permissionBrokerFor(run),
        skillAccess: (slug) => {
          const skill = this.skills.load(slug);
          return skill ? { memory: skill.memoryAccess } : null;
        },
        runApiAccess: (run, mode) => this.runApiAccessFor(run, mode),
      },
    );
    this.objectives = new ObjectiveStore(this.db, this.paths);
    this.indexer = new MemoryIndexer(this.db, () => this.settings(), { homeDir: this.paths.home });
    // An index from before the home's config/ was private may hold rows of it: they go now, not at the next pass.
    try {
      this.indexer.purgeExcluded();
    } catch {
      /* best effort: the next index pass removes them as well, and readers filter rows as they read */
    }
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
    this.devices = new DeviceStore(this.db);
    this.skillRegistry = new SkillRegistry();
    // The daily journal listens for finished runs, also in CLI paths (`mordomo
    // index`, `mordomo run`); the install is idempotent.
    this.disposers.push(
      installJournalHooks(events, this.paths, {
        indexer: this.indexer,
        runs: { get: (id) => this.runs.get(id), lastReply: (id) => this.runs.lastAssistantText(id) },
      }),
    );
    // The inbox listens on the same bus: approvals, failed runs, heartbeat
    // alerts and budget thresholds become rows that survive a closed tab.
    this.notifications = new NotificationStore(this.db);
    this.disposers.push(
      installNotificationRecorder(events, this.notifications, { runs: this.runs, routines: this.routines }),
    );
    this.disposers.push(
      events.subscribe((event) => {
        if (event.type !== "run.finished") return;
        const runId = (event.payload as { runId?: string }).runId;
        const run = runId ? this.runs.get(runId) : null;
        if (run) this.objectives.syncRun(run, this.runs);
      }),
    );
    // Alerts leave the tab: Telegram (bot token read from the environment at
    // send time) and Web Push to installed PWAs.
    this.disposers.push(installTelegramChannel(events, { getSettings: () => this.settings() }));
    this.push = new PushStore(this.db, this.paths.config);
    this.metricsHistory = new MetricsHistory(this.db);
    this.disposers.push(installPushChannel(events, { getSettings: () => this.settings(), store: this.push }));
    // The observers themselves. Nothing is watched or polled until `start()`.
    this.sentinels = new SentinelRunner({
      db: this.db,
      paths: this.paths,
      getSettings: () => this.settings(),
      runs: this.runs,
      notifications: this.notifications,
      scheduler: this.scheduler,
      connectors: this.connectors,
      skills: this.skills,
      indexer: this.indexer,
      bus: events,
      selfSchedule: false,
    });
  }

  /** Live adapters — rebuilt by `reloadAdapters()` whenever settings change. */
  get adapters(): Record<ProviderId, AgentAdapter> {
    return this.adapterRecord;
  }

  /** Stored `binaryPath` values the adapters ignore because they name another program. */
  ignoredBinaryPaths(): IgnoredBinaryPath[] {
    return ignoredBinaryPaths(this.providers, this.settings());
  }

  /** Re-create the provider adapters from the settings on disk (binaryPath etc.). */
  reloadAdapters(): void {
    this.adapterRecord = buildAdapters(this.providers, this.settings());
    setProbeEnvDrop(providerEnvDrop(this.settings()));
  }

  settings(): Settings {
    return this.settingsStore.load();
  }

  /** The permission broker for a write run; subclasses (the API) issue its credential. */
  permissionBrokerFor(run: {
    id: string;
    permissionProfile: SecurityProfile | null;
  }): PermissionBroker | null {
    return this.brokerFactory?.(run) ?? null;
  }

  /**
   * The credential a run of a memory skill uses for the memory routes of the local API, in place of the owner
   * token it must never see. Null here (no server in this process); the API issues it.
   */
  runApiAccessFor(_run: { id: string }, _mode: RunMode): { url: string; token: string } | null {
    return null;
  }

  private get lockFile(): string {
    return path.join(this.paths.run, "engine.lock");
  }

  /**
   * Become the owner of this home: take the lock, then prune, recover objective
   * steps (before runs are marked, so an unstarted queued run still reads as
   * such), mark orphaned runs `interrupted`, and start the scheduler and the
   * sentinels. Throws `EngineLockedError` — having changed nothing — when
   * another live process owns the home.
   */
  start(): { recovered: number } {
    this.acquireLock();
    this.runs.pruneLogged();
    this.objectives.recover(this.runs);
    const recovered = this.runs.recoverInterrupted();
    this.scheduler.start();
    this.sentinels.start();
    return { recovered };
  }

  /** Stop the timers, cancel and await active runs, release the lock and close the database. */
  async stop(timeoutMs = 10_000): Promise<void> {
    this.sentinels.stop();
    this.scheduler.stop();
    if (this.db.open) await this.runs.shutdown(timeoutMs);
    this.close();
  }

  /** Dispose listeners and timers, release the lock if held, close the database. */
  close(): void {
    for (const dispose of this.disposers.splice(0)) dispose();
    this.sentinels.stop();
    this.scheduler.stop();
    this.releaseLock();
    if (this.db.open) this.db.close();
  }

  /**
   * Take `config/run/engine.lock` (see `OwnerLock`): the file appears in one step, a lock naming a process that is
   * gone, that started at another moment than the owner recorded (its pid was reused), or this process is stale and
   * is taken over, and two processes taking over together cannot both succeed.
   */
  private acquireLock(): void {
    const lock = new OwnerLock(this.lockFile, this.db);
    lock.acquire();
    this.ownerLock = lock;
  }

  private releaseLock(): void {
    this.ownerLock?.release();
    this.ownerLock = null;
  }

  // ---- Write policy ---------------------------------------------------------

  /** Roots a user-supplied path may resolve into: the home plus enabled indexed folders. */
  grantedRoots(): string[] {
    return [
      this.paths.home,
      ...this.settings()
        .indexedFolders.filter((f) => f.enabled)
        .map((f) => f.path),
    ];
  }

  /**
   * A run's working directory, realpath-resolved inside the granted roots and
   * outside the home's `config/` and `logs/` (`PathAccessError` otherwise).
   * The rule lives in `RunManager.resolveCwd`, which also applies it to every
   * run it creates or launches; this is the same function for early 403s.
   */
  resolveCwd(cwd?: string | null): string {
    return this.runs.resolveCwd(cwd);
  }

  /** What a reader may open on behalf of a request: the granted roots plus `extraRoots`, under the user's excludes. */
  readScope(extraRoots: readonly string[] = []): ReadScope {
    return grantedReadScope(this.settings(), this.paths.home, extraRoots);
  }

  /** A scope limited to `roots` (the artifacts folder, say), under the user's excludes and the home's private folders. */
  scopeOf(roots: readonly string[]): ReadScope {
    return readScope({ homeDir: this.paths.home, roots, excludes: this.settings().excludes });
  }

  /** Refuse a write run the current security profile does not allow, before anything is created. */
  assertWriteAllowed(mode: RunMode, origin: WriteOrigin): void {
    if (mode !== "write") return;
    if (writeDecision(this.settings().securityProfile, origin) === "refuse") {
      throw Object.assign(
        new Error(
          "The current security profile does not allow write runs; change it in Settings › Security.",
        ),
        { statusCode: 403, code: "profile_refused" },
      );
    }
  }

  /**
   * Apply the security profile to a write run: refuse, ask for approval, or
   * allow. Under `review_before_write` the run is parked in `waiting_approval`
   * and a `write_run` approval carries everything needed to launch it.
   */
  gateWrite(mode: RunMode, origin: WriteOrigin, description: string, payload: GatedRunPayload): WriteGate {
    if (mode !== "write") return { pendingApproval: null, runId: null };
    this.assertWriteAllowed(mode, origin);
    const profile = this.settings().securityProfile;
    const provider = payload.input.provider;
    if (!this.providers.has(provider)) {
      throw Object.assign(new Error(`Unknown provider "${provider}": no adapter is registered for it`), {
        statusCode: 400,
        code: "unknown_provider",
      });
    }
    const confinement = this.providers.manifest(provider).capabilities.writeConfinement;
    // A provider that confines nothing gets a human first, unless the owner
    // chose fully approved automation.
    const unconfined = confinement === "none" && profile !== "approved_automation";
    if (writeDecision(profile, origin) !== "approval" && !unconfined) {
      return { pendingApproval: null, runId: null };
    }
    const fields =
      payload.kind === "skill" ? this.skillRunFields(payload.input) : promptRunFields(payload.input);
    const runId = this.runs.create({
      ...fields,
      profile: this.settings().securityProfile,
      status: "waiting_approval",
    }).id;
    const approval = this.approvals.request("write_run", description, { ...payload, runId });
    events.emit("approval.requested", { id: approval.id, kind: approval.kind, description, runId });
    return { pendingApproval: approval, runId };
  }

  /** The run fields a skill run is created with; the prompt is built when it launches. */
  skillRunFields(input: SkillRunInput): Omit<CreateRunInput, "profile"> {
    const skill = this.skills.load(input.slug);
    if (!skill) throw Object.assign(new Error("Skill not found"), { statusCode: 404 });
    const mode: RunMode = skill.mode === "write" ? "write" : "read_only";
    return {
      origin: "skill",
      provider: input.provider,
      prompt: `(skill: ${input.slug})`,
      request: { version: 1, kind: "skill", skillSlug: input.slug, inputs: input.inputs, mode },
      cwd: input.cwd,
      model: input.model,
      effort: input.effort,
      mode,
      timeoutMs: input.timeoutMs,
      skillSlug: input.slug,
      parentRunId: input.parentRunId ?? null,
    };
  }
}

/** The run fields a free prompt run is created with. */
export function promptRunFields(input: PromptRunInput): Omit<CreateRunInput, "profile"> {
  return {
    origin: "manual",
    provider: input.provider,
    prompt: input.prompt,
    request: { version: 1, kind: "prompt", prompt: input.prompt, mode: input.mode },
    cwd: input.cwd,
    model: input.model,
    effort: input.effort,
    mode: input.mode,
    timeoutMs: input.timeoutMs,
    ...(input.sessionId ? { sessionId: input.sessionId } : {}),
    ...(input.parentRunId ? { parentRunId: input.parentRunId } : {}),
  };
}

/** Build the engine over one home. Building changes nothing; call `start()` to own the home. */
export function createEngine(opts: EngineOptions): MordomoEngine {
  return new MordomoEngine(opts);
}
