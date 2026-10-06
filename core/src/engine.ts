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
import fs from "node:fs";
import path from "node:path";
import type { AgentAdapter, PermissionBroker, RunMode } from "./agents/types.js";
import type { ProviderRegistry } from "./agents/registry.js";
import { applyPendingRestore, type RestorePending } from "./backup.js";
import { installPushChannel } from "./channels/pushChannel.js";
import { installTelegramChannel } from "./channels/telegram.js";
import type { EffortLevel, ProviderId, SecurityProfile, Settings } from "./config/schema.js";
import { SettingsStore } from "./config/store.js";
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
import { ensureDirs, resolvePaths, seedHome, type MordomoPaths } from "./paths.js";
import { RoutineScheduler } from "./routines/scheduler.js";
import { RoutineStore } from "./routines/store.js";
import { RunManager, providerEnvDrop, type CreateRunInput } from "./runs/runManager.js";
import { ApprovalStore, type Approval } from "./security/approvals.js";
import { DeviceStore } from "./security/devices.js";
import { resolveInsideRoots } from "./security/paths.js";
import { writeDecision, type WriteOrigin } from "./security/profiles.js";
import { SentinelRunner } from "./sentinels/runner.js";
import { SkillCatalog } from "./skills/catalog.js";
import { SkillRegistry } from "./skills/registry.js";
import { setProbeEnvDrop } from "./spawn/safeSpawn.js";
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
  /** How a write run's provider CLI asks a human before a tool runs; absent = never brokered. */
  permissionBroker?: (run: {
    id: string;
    permissionProfile: SecurityProfile | null;
  }) => PermissionBroker | null;
}

/** `start()` found another live process owning this home. */
export class EngineLockedError extends Error {
  readonly code = "engine_locked";
  constructor(readonly holderPid: number | null) {
    super(
      holderPid === null
        ? "Another MordomoOS engine owns this home."
        : `Another MordomoOS engine (pid ${holderPid}) owns this home.`,
    );
    this.name = "EngineLockedError";
  }
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

function buildAdapters(registry: ProviderRegistry, settings: Settings): Record<ProviderId, AgentAdapter> {
  return registry.createAll((id) => settings.providers[id]?.binaryPath ?? null);
}

function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === "EPERM";
  }
}

export class MordomoEngine {
  readonly paths: MordomoPaths;
  readonly settingsStore: SettingsStore;
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

  private adapterRecord: Record<ProviderId, AgentAdapter>;
  private readonly disposers: Array<() => void> = [];
  private readonly brokerFactory: EngineOptions["permissionBroker"];
  private lockHeld = false;

  constructor(opts: EngineOptions) {
    this.paths = resolvePaths(opts.home);
    ensureDirs(this.paths);
    if (opts.seedDir) seedHome(this.paths, opts.seedDir);
    if (opts.applyPendingRestore) this.restoredAtBoot = applyPendingRestore(this.paths).applied;
    this.brokerFactory = opts.permissionBroker;
    this.settingsStore = new SettingsStore(this.paths);
    this.db = openDb(this.paths).db;
    this.providers = opts.providers;
    this.adapterRecord = buildAdapters(this.providers, this.settingsStore.load());
    setProbeEnvDrop(providerEnvDrop(this.settingsStore.load()));
    this.skills = new SkillCatalog(this.paths);
    // The adapter callback reads the CURRENT record, so `reloadAdapters()`
    // takes effect for the next run without rebuilding the RunManager.
    // Pruning is the owner's job (`start()`), never a side effect of building.
    this.runs = new RunManager(
      this.db,
      this.paths,
      () => this.settings(),
      (id) => this.adapters[id],
      { pruneOnBoot: false, permissionBroker: (run) => this.permissionBrokerFor(run) },
    );
    this.objectives = new ObjectiveStore(this.db, this.paths);
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
   * Take `config/run/engine.lock`. The file appears in one step — a fully
   * written temporary file hard-linked into place, which fails if the lock
   * exists — so no reader ever sees a lock without its pid. A lock naming a
   * dead process, this process, or nothing readable is stale and taken over.
   */
  private acquireLock(): void {
    fs.mkdirSync(this.paths.run, { recursive: true });
    const temp = `${this.lockFile}.${process.pid}.${Date.now()}.tmp`;
    fs.writeFileSync(temp, JSON.stringify({ pid: process.pid, startedAt: Date.now() }), { mode: 0o600 });
    try {
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          fs.linkSync(temp, this.lockFile);
          this.lockHeld = true;
          return;
        } catch (err) {
          if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
        }
        const holder = this.lockHolder();
        if (holder !== null && holder !== process.pid && pidAlive(holder))
          throw new EngineLockedError(holder);
        fs.rmSync(this.lockFile, { force: true });
      }
      throw new EngineLockedError(this.lockHolder());
    } finally {
      fs.rmSync(temp, { force: true });
    }
  }

  /** The pid recorded in the lock file, or null when it is missing or unreadable. */
  lockHolder(): number | null {
    try {
      const pid = (JSON.parse(fs.readFileSync(this.lockFile, "utf8")) as { pid?: unknown }).pid;
      return typeof pid === "number" && Number.isInteger(pid) && pid > 0 ? pid : null;
    } catch {
      return null;
    }
  }

  private releaseLock(): void {
    if (!this.lockHeld) return;
    this.lockHeld = false;
    if (this.lockHolder() === process.pid) fs.rmSync(this.lockFile, { force: true });
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

  /** A run's working directory, realpath-resolved inside the granted roots (`PathAccessError` otherwise). */
  resolveCwd(cwd: string): string {
    return resolveInsideRoots(this.grantedRoots(), cwd);
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
    const confinement = this.providers.manifest(payload.input.provider).capabilities.writeConfinement;
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
