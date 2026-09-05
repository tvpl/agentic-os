/**
 * Coalesce bursts of identical work (plan follow-up 3: event-driven cache).
 * `run.event` can fire many times a second while a reply streams; each one
 * invalidates the same query keys, so the invalidation is collapsed to at
 * most one per key per `windowMs`, trailing edge, keeping views live without
 * a refetch storm.
 */
export interface Coalescer<K> {
  push(key: K): void;
  /** Fire everything pending now (tests, teardown). */
  flush(): void;
  clear(): void;
}

export function createCoalescer<K>(
  run: (key: K) => void,
  windowMs = 300,
  timers: { set: (fn: () => void, ms: number) => unknown; clear: (h: unknown) => void } = {
    set: (fn, ms) => setTimeout(fn, ms),
    clear: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
  },
): Coalescer<K> {
  const pending = new Map<K, unknown>();
  return {
    push(key) {
      if (pending.has(key)) return; // already scheduled: the trailing call covers this one
      const handle = timers.set(() => {
        pending.delete(key);
        run(key);
      }, windowMs);
      pending.set(key, handle);
    },
    flush() {
      for (const [key, handle] of pending) {
        timers.clear(handle);
        run(key);
      }
      pending.clear();
    },
    clear() {
      for (const handle of pending.values()) timers.clear(handle);
      pending.clear();
    },
  };
}
