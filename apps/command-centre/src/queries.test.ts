import { describe, expect, it, vi } from "vitest";
import { QueryClient } from "@tanstack/react-query";
// api.ts reads the page token from `document` when it loads; this test only needs the key tables.
vi.mock("./api", () => ({ api: {} }));

import { OS_EVENT_TYPES, invalidationMap, qk } from "./queries";

/** One cache entry for every key the app declares, functions called with sample arguments. */
function everyKey(): (readonly unknown[])[] {
  return Object.values(qk).map((k) =>
    typeof k === "function" ? (k as (...a: string[]) => readonly unknown[])("x") : k,
  );
}

describe("event-driven invalidation", () => {
  it("C13 a stream reset refreshes every query", async () => {
    const keys = everyKey();
    expect(keys.length).toBeGreaterThan(20);
    const qc = new QueryClient();
    for (const key of keys) qc.setQueryData(key, { cached: true });
    expect(keys.every((k) => !qc.getQueryState(k)?.isInvalidated)).toBe(true);

    // The stream subscribes to every type in the map, so `stream.reset` has to be one of them…
    expect(OS_EVENT_TYPES).toContain("stream.reset");
    // …and applies each entry the way useEventStream does: serialised by the coalescer, parsed back.
    for (const key of invalidationMap["stream.reset"] ?? []) {
      await qc.invalidateQueries({ queryKey: JSON.parse(JSON.stringify(key)) as readonly unknown[] });
    }
    for (const key of keys) expect(qc.getQueryState(key)?.isInvalidated, JSON.stringify(key)).toBe(true);
  });
});
