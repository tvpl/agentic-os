// @vitest-environment jsdom
/**
 * The strip exists to answer one question at a glance: does anything need me?
 * That only works if idle readings stay dark — so the levels, not just the
 * numbers, are what these tests pin.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import AmbientStrip from "./AmbientStrip";

/** One fake endpoint map per test: the strip reads six of them. */
function mockApi(data: Record<string, unknown>) {
  vi.spyOn(globalThis, "fetch").mockImplementation((input) => {
    const url = typeof input === "string" ? input : (input as Request).url;
    const key = Object.keys(data).find((k) => url.includes(k));
    return Promise.resolve(
      new Response(JSON.stringify(key ? data[key] : []), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
  });
}

function setup(activeRuns = 0, onExpand?: (id: string) => void) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return render(
    <QueryClientProvider client={client}>
      <AmbientStrip activeRuns={activeRuns} onExpand={onExpand} />
    </QueryClientProvider>,
  );
}

const level = (name: RegExp) => screen.getByTitle(name).getAttribute("data-level");

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("ambient strip", () => {
  it("leaves a calm desktop entirely unlit", async () => {
    mockApi({
      "/api/metrics": { cost: { todayUsd: 0, burnRatePerHour: 0 } },
      "/api/settings": { limits: { dailyBudgetUsd: 3 } },
      "/api/routines": [],
      "/api/runs": [],
      "/api/skills": [],
      "/api/approvals": [],
      "/api/memory/status": { facets: { total: 0 } },
    });
    const { container } = setup(0);
    await screen.findByTitle(/nothing needs attention/i);
    expect(container.querySelectorAll(".sig.lit").length).toBe(0);
    expect(level(/nothing needs attention/i)).toBe("idle");
    expect(level(/nothing running/i)).toBe("idle");
  });

  it("lights attention when runs failed, and counts each source once", async () => {
    mockApi({
      "/api/metrics": { cost: { todayUsd: 0.08, burnRatePerHour: 0 } },
      "/api/settings": { limits: { dailyBudgetUsd: 3 } },
      "/api/routines": [{ id: "r1", enabled: true, healthy: false }],
      "/api/runs": [
        { id: "a", status: "failed" },
        { id: "b", status: "timed_out" },
      ],
      "/api/skills": [],
      "/api/approvals": [],
      "/api/memory/status": { facets: { total: 4 } },
    });
    setup(0);
    // 2 failures + 1 unhealthy routine = 3, and the budget is nowhere near hot.
    const attention = await screen.findByTitle(/3 items need a decision/i);
    expect(attention.getAttribute("data-level")).toBe("warn");
    expect(attention.className).toContain("lit");
  });

  it("treats work in flight as information, never as an alarm", async () => {
    mockApi({
      "/api/metrics": { cost: { todayUsd: 0, burnRatePerHour: 900 } },
      "/api/settings": {},
      "/api/routines": [],
      "/api/runs": [],
      "/api/skills": [],
      "/api/approvals": [],
      "/api/memory/status": { facets: { total: 0 } },
    });
    const { container } = setup(3);
    await screen.findByTitle(/3 runs in flight/i);
    expect(level(/3 runs in flight/i)).toBe("info");
    expect(container.querySelectorAll(".sig.lit").length).toBe(0);
  });

  it("opens the widget behind a reading when it is pressed", async () => {
    mockApi({
      "/api/metrics": { cost: { todayUsd: 0, burnRatePerHour: 0 } },
      "/api/settings": {},
      "/api/routines": [],
      "/api/runs": [],
      "/api/skills": [],
      "/api/approvals": [],
      "/api/memory/status": { facets: { total: 0 } },
    });
    const onExpand = vi.fn();
    setup(0, onExpand);
    fireEvent.click(await screen.findByTitle(/nothing needs attention/i));
    expect(onExpand).toHaveBeenCalledWith("attention");
  });

  it("names a reading fully for screen readers, not just its number", async () => {
    mockApi({
      "/api/metrics": { cost: { todayUsd: 0, burnRatePerHour: 0 } },
      "/api/settings": {},
      "/api/routines": [],
      "/api/runs": [],
      "/api/skills": [],
      "/api/approvals": [],
      "/api/memory/status": { facets: { total: 0 } },
    });
    setup(0, vi.fn());
    const attention = await screen.findByTitle(/nothing needs attention/i);
    expect(attention.getAttribute("aria-label")).toMatch(/nothing needs attention/i);
  });
});
