import { describe, expect, it } from "vitest";
import {
  axisTicks,
  countRuns,
  filterRuns,
  inWindow,
  laneOf,
  layoutRiver,
  neighbour,
  pickRange,
  runEnd,
  runLabel,
  tickFormat,
  timeToX,
  toneOf,
  worstTone,
  type RiverItem,
  type RiverRun,
  type RunMark,
} from "./runsRiver";

const H = 3_600_000;
const NOW = new Date(2026, 8, 26, 12, 0, 0).getTime();

function run(over: Partial<RiverRun & { provider: string }> = {}): RiverRun & { provider: string } {
  return {
    id: over.id ?? "r1",
    createdAt: NOW - H,
    startedAt: null,
    finishedAt: NOW - H + 60_000,
    durationMs: 60_000,
    status: "done",
    origin: "manual",
    parentRunId: null,
    skillSlug: null,
    promptSummary: "do the thing",
    provider: "claude",
    ...over,
  };
}

function item(id: string, start: number, end: number, over: Partial<RiverItem> = {}): RiverItem {
  return { id, lane: "you", start, end, tone: "ok", label: id, ...over };
}

describe("lanes and tones", () => {
  it("puts a run in the lane of whoever started it", () => {
    expect(laneOf({ origin: "routine" })).toBe("routine");
    expect(laneOf({ origin: "manual" })).toBe("you");
    expect(laneOf({ origin: "skill" })).toBe("you");
    expect(laneOf({ origin: "sentinel" })).toBe("sentinel");
    expect(laneOf({ origin: "api" })).toBe("api");
    expect(laneOf({ origin: "manual", parentRunId: "p" })).toBe("agent");
  });

  it("colours by status", () => {
    expect(toneOf("done")).toBe("ok");
    expect(toneOf("failed")).toBe("fail");
    expect(toneOf("timed_out")).toBe("fail");
    expect(toneOf("interrupted")).toBe("fail");
    expect(toneOf("cancelled")).toBe("cancel");
    expect(toneOf("running")).toBe("live");
    expect(toneOf("queued")).toBe("live");
    expect(toneOf("waiting_approval")).toBe("wait");
    expect(worstTone(["ok", "live", "fail"])).toBe("fail");
    expect(worstTone(["ok", "cancel"])).toBe("ok");
  });

  it("counts done, failed, cancelled and live", () => {
    const c = countRuns([
      { status: "done" },
      { status: "failed" },
      { status: "timed_out" },
      { status: "cancelled" },
      { status: "running" },
    ]);
    expect(c).toEqual({ total: 5, done: 1, failed: 2, cancelled: 1, live: 1 });
  });

  it("titles a run by its skill, else the start of the prompt", () => {
    expect(runLabel({ id: "abc", skillSlug: "consolidate-memory", promptSummary: "x" })).toBe(
      "/consolidate-memory",
    );
    expect(runLabel({ id: "abc", skillSlug: null, promptSummary: "a  b\nc" })).toBe("a b c");
    expect(runLabel({ id: "abcdefghij", skillSlug: null, promptSummary: "" })).toBe("abcdefgh");
    expect(runLabel({ id: "a", skillSlug: null, promptSummary: "x".repeat(60) }, 10)).toHaveLength(10);
  });
});

describe("time", () => {
  it("maps time to x and clamps to the axis", () => {
    expect(timeToX(NOW - 12 * H, NOW - 24 * H, NOW, 1000)).toBe(500);
    expect(timeToX(NOW - 48 * H, NOW - 24 * H, NOW, 1000)).toBe(0);
    expect(timeToX(NOW + H, NOW - 24 * H, NOW, 1000)).toBe(1000);
    expect(timeToX(NOW, NOW, NOW, 1000)).toBe(0);
  });

  it("lets a live run end now and grow with it", () => {
    const live = run({ status: "running", finishedAt: null, durationMs: null, startedAt: NOW - 2 * H });
    expect(runEnd(live, NOW)).toBe(NOW);
    expect(runEnd(live, NOW + H)).toBe(NOW + H);
    expect(runEnd(run({ finishedAt: null, durationMs: 5000, createdAt: NOW - H }), NOW)).toBe(NOW - H + 5000);
  });

  it("keeps runs whose span touches the window", () => {
    const old = run({ id: "old", createdAt: NOW - 30 * H, finishedAt: NOW - 29 * H });
    const long = run({ id: "long", createdAt: NOW - 25 * H, finishedAt: NOW - 23 * H });
    const fresh = run({ id: "fresh" });
    expect(inWindow([old, long, fresh], NOW - 24 * H, NOW).map((r) => r.id)).toEqual(["long", "fresh"]);
  });

  it("opens on the smallest range that has enough to read", () => {
    const runs = [NOW - H, NOW - 3 * 24 * H, NOW - 4 * 24 * H, NOW - 5 * 24 * H].map((createdAt) => ({
      createdAt,
    }));
    expect(pickRange(runs, NOW)).toBe("7d");
    expect(pickRange(runs.slice(0, 1), NOW)).toBe("30d");
    expect(pickRange([{ createdAt: NOW }, { createdAt: NOW }, { createdAt: NOW }], NOW)).toBe("24h");
  });
});

describe("filters", () => {
  const runs = [
    run({ id: "a", status: "failed", origin: "routine", skillSlug: "consolidate-memory" }),
    run({ id: "b", status: "done", promptSummary: "Refactor the parser" }),
    run({ id: "c", status: "running", origin: "sentinel" }),
  ];
  it("filters by status, lane and text", () => {
    expect(filterRuns(runs, { status: "failed", lane: null, query: "" }).map((r) => r.id)).toEqual(["a"]);
    expect(filterRuns(runs, { status: "live", lane: null, query: "" }).map((r) => r.id)).toEqual(["c"]);
    expect(filterRuns(runs, { status: "all", lane: "you", query: "" }).map((r) => r.id)).toEqual(["b"]);
    expect(filterRuns(runs, { status: "all", lane: null, query: "PARSER" }).map((r) => r.id)).toEqual(["b"]);
    expect(filterRuns(runs, { status: "all", lane: null, query: "memory" }).map((r) => r.id)).toEqual(["a"]);
  });
});

describe("layout", () => {
  const since = NOW - 24 * H;
  const opts = { since, until: NOW, width: 960, minW: 10, gap: 4, maxRows: 3 };

  it("places a capsule by start and stretches it by duration, never thinner than minW", () => {
    const [lane] = layoutRiver(
      [item("a", NOW - 12 * H, NOW - 6 * H), item("b", NOW - 3 * H, NOW - 3 * H + 1000)],
      opts,
    );
    const [a, b] = lane!.marks;
    expect(a).toMatchObject({ kind: "run", x: 480, w: 240, row: 0 });
    expect(b!.w).toBe(10);
  });

  it("orders lanes and skips runs outside the window", () => {
    const lanes = layoutRiver(
      [
        item("s", NOW - H, NOW, { lane: "sentinel" }),
        item("r", NOW - 2 * H, NOW - H, { lane: "routine" }),
        item("gone", NOW - 40 * H, NOW - 30 * H, { lane: "agent" }),
      ],
      opts,
    );
    expect(lanes.map((l) => l.lane)).toEqual(["routine", "sentinel"]);
  });

  it("stacks overlapping runs on rows", () => {
    const [lane] = layoutRiver(
      [
        item("a", NOW - 10 * H, NOW - 5 * H),
        item("b", NOW - 8 * H, NOW - 4 * H),
        item("c", NOW - 3 * H, NOW - 2 * H),
      ],
      opts,
    );
    const rows = Object.fromEntries(lane!.marks.map((m) => [m.id, m.row]));
    expect(rows).toEqual({ a: 0, b: 1, c: 0 });
    expect(lane!.rows).toBe(2);
  });

  it("folds a stretch too dense to stack into one cluster, keeping the worst tone", () => {
    const burst = Array.from({ length: 6 }, (_, i) =>
      item(`b${i}`, NOW - 6 * H + i * 60_000, NOW - 5 * H, { tone: i === 2 ? "fail" : "ok" }),
    );
    const [lane] = layoutRiver([...burst, item("far", NOW - H, NOW - H / 2)], opts);
    const cluster = lane!.marks.find((m) => m.kind === "cluster");
    expect(cluster).toBeDefined();
    if (cluster?.kind !== "cluster") throw new Error("no cluster");
    expect(cluster.ids).toHaveLength(6);
    expect(cluster.tone).toBe("fail");
    expect(cluster.tones.fail).toBe(1);
    expect(lane!.marks.find((m) => m.id === "far")?.kind).toBe("run");
  });

  it("shows a label beside the capsule only where it fits, on the left at the now edge", () => {
    const [lane] = layoutRiver(
      [
        item("roomy", NOW - 20 * H, NOW - 19 * H, { label: "/consolidate" }),
        item("cramped", NOW - 10 * H, NOW - 10 * H + 1000, { label: "a-very-long-label-for-a-run" }),
        item("prev", NOW - 10 * H - 30 * 60_000, NOW - 10 * H - 29 * 60_000, { label: "p" }),
        item("next", NOW - 10 * H + 30 * 60_000, NOW - 9 * H, { label: "x" }),
        item("edge", NOW - H / 4, NOW, { label: "/live-one" }),
      ],
      opts,
    );
    const by = Object.fromEntries(lane!.marks.map((m) => [m.id, m]));
    expect(by.roomy).toMatchObject({ tagFits: true, tagLeft: false });
    expect(by.cramped).toMatchObject({ tagFits: false, row: 0 });
    expect(by.edge).toMatchObject({ tagFits: true, tagLeft: true });
  });
});

describe("axis", () => {
  it("ticks round hours across a day, clear of now", () => {
    const since = NOW - 24 * H + 17 * 60_000;
    const ticks = axisTicks(since, NOW, 1200, 120);
    expect(ticks.length).toBeGreaterThan(3);
    for (const tk of ticks) {
      const d = new Date(tk.t);
      expect(d.getMinutes()).toBe(0);
      expect(tk.t).toBeGreaterThan(since);
      expect(1200 - tk.x).toBeGreaterThanOrEqual(64);
    }
    const steps = ticks.slice(1).map((tk, i) => tk.t - ticks[i]!.t);
    expect(new Set(steps).size).toBe(1);
  });

  it("ticks midnights across a week and minutes when zoomed", () => {
    const week = axisTicks(NOW - 7 * 24 * H, NOW, 1200, 120);
    for (const tk of week) expect(new Date(tk.t).getHours()).toBe(0);
    const zoom = axisTicks(NOW - 40 * 60_000, NOW, 1000, 110);
    expect(zoom.length).toBeGreaterThan(2);
    for (const tk of zoom) expect(new Date(tk.t).getMinutes() % 5).toBe(0);
  });

  it("formats by span", () => {
    expect(tickFormat(NOW - 24 * H, NOW)).toBe("time");
    expect(tickFormat(NOW - 7 * 24 * H, NOW)).toBe("weekday");
    expect(tickFormat(NOW - 30 * 24 * H, NOW)).toBe("date");
  });
});

describe("keyboard neighbours", () => {
  const since = NOW - 24 * H;
  const lanes = layoutRiver(
    [
      item("r1", NOW - 20 * H, NOW - 19 * H, { lane: "routine" }),
      item("r2", NOW - 4 * H, NOW - 3 * H, { lane: "routine" }),
      item("y1", NOW - 18 * H, NOW - 17 * H),
      item("y2", NOW - 5 * H, NOW - 4 * H),
    ],
    { since, until: NOW, width: 960 },
  );
  it("walks a lane in time and jumps lanes to the nearest in time", () => {
    expect(neighbour(lanes, "r1", "right")).toBe("r2");
    expect(neighbour(lanes, "r2", "right")).toBe("r2");
    expect(neighbour(lanes, "r2", "left")).toBe("r1");
    expect(neighbour(lanes, "r2", "down")).toBe("y2");
    expect(neighbour(lanes, "y1", "up")).toBe("r1");
    expect(neighbour(lanes, "y1", "down")).toBe("y1");
    expect(neighbour(lanes, null, "right")).toBe("r1");
    expect(neighbour(lanes, "y2", "home")).toBe("r1");
    expect(neighbour(lanes, "r1", "end")).toBe("y2");
    expect(neighbour([], "r1", "right")).toBeNull();
  });
});

describe("river labels", () => {
  it("hides the older of two colliding labels", () => {
    const item = (id: string, start: number, label: string): RiverItem => ({
      id,
      lane: "routine",
      start,
      end: start + 5,
      tone: "fail",
      label,
    });
    // P (oldest) would label rightwards; Q has a neighbour on its right, so its label
    // goes left — straight over P's. R (newest) has room.
    const [lane] = layoutRiver(
      [item("p", 0, "p".repeat(15)), item("q", 200, "q".repeat(15)), item("r", 215, "r")],
      { since: 0, until: 1000, width: 1000 },
    );
    const mark = (id: string) => lane!.marks.find((m) => m.id === id) as RunMark;
    expect(mark("q").tagFits).toBe(true);
    expect(mark("q").tagLeft).toBe(true);
    expect(mark("r").tagFits).toBe(true);
    expect(mark("p").tagFits).toBe(false);
  });
});
