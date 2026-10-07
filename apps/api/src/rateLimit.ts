/**
 * Attempt limits (docs/security.md, door 5 of `.specs/features/api-v1`): a
 * sliding window of event times per key, the key being the client address.
 * The state lives in this process and starts empty on every restart: one
 * local service per machine, so persisting it would protect nothing more.
 */
export class SlidingWindow {
  private readonly hits = new Map<string, number[]>();

  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
  ) {}

  /** Whole seconds until `key` may try again (at least 1), or 0 while it is under the limit. */
  retryAfter(key: string): number {
    const live = this.live(key);
    if (live.length < this.limit) return 0;
    return Math.max(1, Math.ceil((live[0]! + this.windowMs - Date.now()) / 1000));
  }

  /** Count one event for `key`. */
  hit(key: string): void {
    // Addresses that stopped trying are dropped on the way, so the map cannot grow without bound.
    if (this.hits.size > 10_000) for (const k of [...this.hits.keys()]) this.live(k);
    this.hits.set(key, [...this.live(key), Date.now()]);
  }

  private live(key: string): number[] {
    const cutoff = Date.now() - this.windowMs;
    const kept = (this.hits.get(key) ?? []).filter((t) => t > cutoff);
    if (kept.length > 0) this.hits.set(key, kept);
    else this.hits.delete(key);
    return kept;
  }
}
