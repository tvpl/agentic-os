import { vi } from "vitest";

/**
 * A clock set to a fixed instant that goes on ticking: `Date.now()` answers `start` plus the real time since. The
 * indexer waits for `Date.now()` to move between two of its steps (`indexer.ts`, the related phase), so a frozen fake
 * `Date` would hang an index pass; this one does not. For an exact instant with no pass in between, freeze it with
 * `vi.useFakeTimers({ toFake: ["Date"], now })` and go back with `vi.useRealTimers()`.
 */
export function movingClock(start: number): { set(at: number): void; restore(): void } {
  const real = Date.now.bind(Date);
  let shift = start - real();
  const spy = vi.spyOn(Date, "now").mockImplementation(() => real() + shift);
  return {
    set(at) {
      shift = at - real();
    },
    restore() {
      spy.mockRestore();
    },
  };
}
