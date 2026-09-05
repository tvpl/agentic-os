import type { Db } from "../db/db.js";
import type { MordomoPaths } from "../paths.js";
import type { Settings } from "../config/schema.js";
import { events as defaultBus, type EventBus, type OsEvent } from "../events.js";
import type { Connector } from "../connectors/registry.js";
import type { RoutineStatus, SilentRoutine } from "../routines/types.js";
import type { NotificationInput } from "../notifications/store.js";
import { checkRepeatedFailure } from "./repeatedFailure.js";
import { checkSilentRoutines } from "./silentRoutine.js";
import { checkConnectorDeltas, type ConnectorDeltaDeps } from "./connectorDelta.js";
import { FsWatchSentinel } from "./fsWatch.js";
import { installSentinelTriage, type TriageInbox, type TriageRunner } from "./triage.js";
import { detectRepeatedPrompts } from "../skills/repeatDetector.js";
import type { DedupeLookup, SentinelFiredPayload } from "./types.js";

/**
 * The one object the service starts and stops (Onda 2, item 1).
 *
 * It owns three things and nothing else:
 *  - the bus subscription that reacts to a run finishing badly;
 *  - the file-system watcher (off unless the settings turn it on);
 *  - the hourly pass (silent routines, connector deltas, the did-it-twice
 *    detector), which the service drives from its existing hourly sweep.
 *
 * Every timer is unref'd: sentinels must never be the reason a process
 * refuses to exit, and every pass swallows its own errors — a proactive
 * feature that can crash the service is worse than no proactive feature.
 */

export interface SentinelRunnerDeps {
  db: Db;
  paths: MordomoPaths;
  getSettings: () => Settings;
  /** The RunManager: read for failures, used by triage to launch its short run. */
  runs: TriageRunner;
  /** The persisted inbox: dedupe source and destination of triage/repeat rows. */
  notifications: TriageInbox & DedupeLookup & { add(input: NotificationInput): { id: string } };
  scheduler: { status(): RoutineStatus[]; silent(days?: number): SilentRoutine[] };
  connectors: { list(): Connector[] };
  skills: { list(): ReadonlyArray<{ name: string; description: string }> };
  indexer?: { indexAllAsync(): Promise<unknown> };
  bus?: EventBus;
  /** Own hourly timer. The API passes false: it drives `hourly()` from its own sweep. */
  selfSchedule?: boolean;
  /** Injected by tests (see `checkConnectorDeltas`). */
  fetchData?: ConnectorDeltaDeps["fetchData"];
  now?: () => number;
  onError?: (err: unknown, where: string) => void;
}

export interface HourlyReport {
  silentRoutines: SentinelFiredPayload[];
  connectorDeltas: SentinelFiredPayload[];
  repeatSuggestions: number;
}

const HOUR_MS = 3_600_000;

export class SentinelRunner {
  private readonly bus: EventBus;
  private readonly fsWatch: FsWatchSentinel;
  private disposers: Array<() => void> = [];
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(private readonly deps: SentinelRunnerDeps) {
    this.bus = deps.bus ?? defaultBus;
    this.fsWatch = new FsWatchSentinel({
      bus: this.bus,
      getSettings: deps.getSettings,
      ...(deps.indexer ? { indexer: deps.indexer } : {}),
      onError: (err, folder) => this.report(err, `fsWatch:${folder}`),
    });
  }

  isRunning(): boolean {
    return this.running;
  }

  /** Folders the fs sentinel is watching (empty when it is off). */
  watchedFolders(): string[] {
    return this.fsWatch.watched();
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    // React to a run finishing badly (the only event-driven sentinel).
    this.disposers.push(
      this.bus.subscribe((event: OsEvent) => {
        if (event.type !== "run.finished") return;
        const cfg = this.deps.getSettings().sentinels.repeatedFailure;
        if (!cfg.enabled) return;
        try {
          checkRepeatedFailure(
            {
              db: this.deps.db,
              bus: this.bus,
              dedupe: this.deps.notifications,
              threshold: cfg.threshold,
              windowHours: cfg.windowHours,
              ...(this.deps.now ? { now: this.deps.now } : {}),
            },
            (event.payload ?? {}) as { runId?: unknown; status?: unknown },
          );
        } catch (err) {
          this.report(err, "repeatedFailure");
        }
      }),
    );
    // Triage answers the findings that ask for it, inside its own daily budget.
    this.disposers.push(
      installSentinelTriage({
        db: this.deps.db,
        bus: this.bus,
        runs: this.deps.runs,
        notifications: this.deps.notifications,
        getSettings: this.deps.getSettings,
        cwd: this.deps.paths.home,
        ...(this.deps.now ? { now: this.deps.now } : {}),
        onError: (err) => this.report(err, "triage"),
      }),
    );
    try {
      this.fsWatch.start();
    } catch (err) {
      this.report(err, "fsWatch");
    }
    if (this.deps.selfSchedule !== false) {
      this.timer = setInterval(() => void this.hourly(), HOUR_MS);
      this.timer.unref?.();
    }
  }

  stop(): void {
    this.running = false;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    for (const dispose of this.disposers.splice(0)) {
      try {
        dispose();
      } catch {
        /* already gone */
      }
    }
    this.fsWatch.stop();
  }

  /**
   * The hourly pass. Called by the service inside its existing sweep (and by
   * the runner's own timer when it schedules itself). Never rejects.
   */
  async hourly(): Promise<HourlyReport> {
    const report: HourlyReport = { silentRoutines: [], connectorDeltas: [], repeatSuggestions: 0 };
    const settings = this.deps.getSettings();
    if (settings.sentinels.silentRoutine.enabled) {
      try {
        report.silentRoutines = checkSilentRoutines({
          bus: this.bus,
          scheduler: this.deps.scheduler,
          dedupe: this.deps.notifications,
          timezone: settings.timezone,
          factor: settings.sentinels.silentRoutine.factor,
          ...(this.deps.now ? { now: this.deps.now } : {}),
        });
      } catch (err) {
        this.report(err, "silentRoutine");
      }
    }
    if (settings.sentinels.connectorDelta.enabled) {
      try {
        report.connectorDeltas = await checkConnectorDeltas({
          db: this.deps.db,
          bus: this.bus,
          connectors: this.deps.connectors,
          getSettings: this.deps.getSettings,
          cwd: this.deps.paths.home,
          ...(this.deps.fetchData ? { fetchData: this.deps.fetchData } : {}),
          ...(this.deps.now ? { now: this.deps.now } : {}),
        });
      } catch (err) {
        this.report(err, "connectorDelta");
      }
    }
    try {
      report.repeatSuggestions = detectRepeatedPrompts({
        db: this.deps.db,
        getSettings: this.deps.getSettings,
        skills: this.deps.skills,
        notifications: this.deps.notifications,
        ...(this.deps.now ? { now: this.deps.now } : {}),
      }).length;
    } catch (err) {
      this.report(err, "repeatDetector");
    }
    return report;
  }

  private report(err: unknown, where: string): void {
    if (this.deps.onError) this.deps.onError(err, where);
    else console.error(`[sentinels] ${where} failed`, err);
  }
}
