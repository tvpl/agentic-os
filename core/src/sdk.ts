import type { ProviderRegistry } from "./agents/registry.js";
import type { SettingsUpdate } from "./config/store.js";
import type { Settings } from "./config/schema.js";
import { MordomoEngine } from "./engine.js";
import type { EventFeed } from "./events.js";
import type { Execution } from "./execution/types.js";

/** The providers an engine was built with (read-only: registering one after the fact does not reach the adapters). */
export type ReadonlyProviders = Pick<ProviderRegistry, "has" | "ids" | "manifest" | "manifests">;

/** What `createEngine` needs: the providers, and optionally the home. */
export interface EngineOptions {
  /** The MordomoOS home. Defaults to `MORDOMO_HOME`, then the platform's per-user data folder. */
  home?: string;
  /** The providers this engine can run: one manifest and one adapter factory each. The engine knows no provider by name. */
  providers: ProviderRegistry;
  /** A folder with seed skills, routines and connectors copied into a new home; `null` (the default) copies none. */
  seedDir?: string | null;
  /** How long to wait for a restore running in another process before refusing (ms, default 10 000). */
  restoreWaitMs?: number;
}

/**
 * A MordomoOS engine over one home: the way to run an agent from a program. Everything else the engine holds (its
 * stores, its database, its schedulers) is internal and may change between releases.
 */
export interface Engine {
  /** The folder this engine works on. */
  readonly home: string;
  /** Everything this engine announces, and nothing another engine in the same process announces. */
  readonly events: EventFeed;
  /** Start, follow, cancel and approve runs. */
  readonly execution: Execution;
  readonly providers: ReadonlyProviders;
  /** The settings in force (a copy: changing it changes nothing). */
  settings(): Settings;
  /** Change settings, validated and merged like a file edit (objects merge, arrays and scalars replace). */
  updateSettings(patch: SettingsUpdate): Settings;
  /**
   * Become the owner of the home: recover what a dead owner left, and start the scheduler. Throws
   * `EngineLockedError` when another engine - in this process or another - owns the home. Building an engine
   * changes nothing; a program that only reads or starts runs need not call this.
   */
  start(): { recovered: number };
  /** Stop the timers, interrupt and wait for the runs in progress, release the home and close the database. */
  stop(timeoutMs?: number): Promise<void>;
  /** Release the home and close the database at once. */
  close(): void;
}

/**
 * Build an engine over one home. Opens (and migrates) the database and changes nothing else; call `start()` to own
 * the home. Two engines in one process share nothing.
 */
export function createEngine(options: EngineOptions): Engine {
  return new MordomoEngine({
    providers: options.providers,
    ...(options.home !== undefined ? { home: options.home } : {}),
    ...(options.seedDir !== undefined ? { seedDir: options.seedDir } : {}),
    ...(options.restoreWaitMs !== undefined ? { restoreWaitMs: options.restoreWaitMs } : {}),
  });
}
