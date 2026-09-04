import fs from "node:fs";
import path from "node:path";
import type { Settings } from "../config/schema.js";
import type { EventBus } from "../events.js";
import { makeWorkspaceFilter } from "../memory/excludes.js";
import { emitSentinel, type SentinelFiredPayload } from "./types.js";

/**
 * "Files moved under your feet." A recursive `fs.watch` on each enabled
 * indexed folder, debounced so a `git checkout` or an editor save storm
 * produces one finding instead of hundreds, and followed by the same
 * re-index `POST /api/memory/index` triggers.
 *
 * OFF by default: a recursive watch over a large tree costs memory and
 * wakeups on every platform, and on Linux one inotify watch per directory.
 * The exclusion policy is the settings one (`makeWorkspaceFilter`), so a
 * folder nobody indexes never wakes anything either.
 */

export interface FsWatchDeps {
  bus: EventBus;
  getSettings: () => Settings;
  /** `MemoryIndexer` satisfies this; the re-index is the point of the watch. */
  indexer?: { indexAllAsync(): Promise<unknown>; isIndexing?(): boolean };
  /** Overridable for tests. */
  watch?: typeof fs.watch;
  onError?: (err: unknown, folder: string) => void;
}

export function fsWatchPayload(folder: string, changed: number): SentinelFiredPayload {
  return {
    sentinel: "fsWatch",
    title: `${changed} file${changed === 1 ? "" : "s"} changed in ${path.basename(folder) || folder}`,
    body: `${changed} file${changed === 1 ? "" : "s"} changed under ${folder}; the memory index is catching up.`,
    severity: "info",
    href: "/brain",
    dedupeKey: `sentinel:fsWatch:${folder}`,
  };
}

/**
 * One debounced watcher per indexed folder. `start()` is idempotent and
 * `stop()` releases every handle and timer; both are safe to call twice.
 */
export class FsWatchSentinel {
  private watchers = new Map<string, fs.FSWatcher>();
  private pending = new Map<string, Set<string>>();
  private timers = new Map<string, NodeJS.Timeout>();
  private running = false;

  constructor(private readonly deps: FsWatchDeps) {}

  isRunning(): boolean {
    return this.running;
  }

  /** Folders currently watched (absolute paths). */
  watched(): string[] {
    return [...this.watchers.keys()];
  }

  start(): void {
    if (this.running) return;
    const settings = this.deps.getSettings();
    if (!settings.sentinels.fsWatch.enabled) return;
    this.running = true;
    const watch = this.deps.watch ?? fs.watch;
    const filter = makeWorkspaceFilter(settings.excludes);
    for (const folder of settings.indexedFolders.filter((f) => f.enabled)) {
      const root = path.resolve(folder.path);
      if (this.watchers.has(root)) continue;
      try {
        const watcher = watch(root, { recursive: true, persistent: false }, (_event, filename) => {
          const rel = typeof filename === "string" ? filename : null;
          if (!rel) return;
          if (filter.isExcluded(rel, path.join(root, rel))) return;
          this.record(root, rel);
        });
        watcher.on("error", (err) => this.deps.onError?.(err, root));
        this.watchers.set(root, watcher);
      } catch (err) {
        // A missing folder, a platform without recursive watch, too many
        // watches: the sentinel degrades to "not watching that one".
        this.deps.onError?.(err, root);
      }
    }
  }

  stop(): void {
    this.running = false;
    for (const timer of this.timers.values()) clearTimeout(timer);
    this.timers.clear();
    this.pending.clear();
    for (const watcher of this.watchers.values()) {
      try {
        watcher.close();
      } catch {
        /* already closed */
      }
    }
    this.watchers.clear();
  }

  /** Note one changed path and (re)arm the debounce for its folder. */
  private record(root: string, rel: string): void {
    const set = this.pending.get(root) ?? new Set<string>();
    set.add(rel);
    this.pending.set(root, set);
    const existing = this.timers.get(root);
    if (existing) clearTimeout(existing);
    const debounceMs = this.deps.getSettings().sentinels.fsWatch.debounceMs;
    const timer = setTimeout(() => this.flush(root), debounceMs);
    timer.unref?.();
    this.timers.set(root, timer);
  }

  /** Fire once for everything that piled up, then let the indexer catch up. */
  flush(root: string): SentinelFiredPayload | null {
    this.timers.delete(root);
    const changed = this.pending.get(root);
    this.pending.delete(root);
    if (!changed || changed.size === 0) return null;
    const payload = emitSentinel(this.deps.bus, fsWatchPayload(root, changed.size));
    const indexer = this.deps.indexer;
    if (indexer) {
      // Same call as POST /api/memory/index: chunked and non-blocking.
      void Promise.resolve()
        .then(() => indexer.indexAllAsync())
        .catch((err: unknown) => this.deps.onError?.(err, root));
    }
    return payload;
  }
}
