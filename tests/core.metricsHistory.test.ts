import { describe, expect, it, beforeAll, afterAll } from "vitest";
import type { FastifyInstance } from "fastify";
import { dailyPoints, HOUR_MS, type MetricsSample } from "@mordomo/core";
import { AppContext } from "../apps/api/src/context.js";
import { buildServer } from "../apps/api/src/server.js";
import { makeTempHome } from "./helpers.js";

let ctx: AppContext;
let app: FastifyInstance;
let token: string;
let cleanup: () => void;

beforeAll(async () => {
  const tmp = makeTempHome();
  cleanup = tmp.cleanup;
  ctx = new AppContext(tmp.paths.home);
  const settings = ctx.settings();
  settings.setupCompleted = true;
  ctx.settingsStore.save(settings);
  token = ctx.token();
  app = await buildServer(ctx);
});

afterAll(async () => {
  await app.close();
  ctx.close();
  cleanup();
});

const auth = () => ({ "x-mordomo-token": token });

describe("metrics history", () => {
  it("samples once per hour bucket (a second sample in the hour overwrites) and serves the series", async () => {
    const t0 = Date.UTC(2026, 8, 5, 10, 20);
    const a = ctx.sampleMetrics(t0);
    expect(a.ts).toBe(Math.floor(t0 / HOUR_MS) * HOUR_MS);
    expect(a.runsTotal).toBe(0);
    expect(a.approvalWaitAvgMs).toBeNull();
    const b = ctx.sampleMetrics(t0 + 15 * 60_000);
    expect(b.ts).toBe(a.ts);
    expect(ctx.metricsHistory.count()).toBe(1);
    ctx.sampleMetrics(t0 + HOUR_MS);
    ctx.sampleMetrics(t0 + 26 * HOUR_MS);
    expect(ctx.metricsHistory.count()).toBe(3);
    // Boot-time samples land in the current hour, so the API series (last 14 days from now) is at least the live one.
    ctx.sampleMetrics();
    const res = await app.inject({ method: "GET", url: "/api/metrics/history?days=14", headers: auth() });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { samples: MetricsSample[]; daily: Array<{ day: string; samples: number }> };
    expect(body.samples.length).toBeGreaterThanOrEqual(1);
    expect(body.daily.length).toBeGreaterThanOrEqual(1);
    const bad = await app.inject({ method: "GET", url: "/api/metrics/history?days=0", headers: auth() });
    expect(bad.statusCode).toBe(400);
  });

  it("folds hourly samples into daily points: max of the day counters, last of the gauges, mean of the waits", () => {
    const mk = (ts: number, over: Partial<MetricsSample>): MetricsSample => ({
      ts,
      runsTotal: 0,
      runs24h: 0,
      failed24h: 0,
      costTodayUsd: 0,
      tokensToday: 0,
      spendWeekUsd: 0,
      inboxUnread: 0,
      approvalsPending: 0,
      approvalWaitAvgMs: null,
      ...over,
    });
    const day = (ts: number) => (ts < 100 ? "d1" : "d2");
    const points = dailyPoints(
      [
        mk(1, { costTodayUsd: 0.1, tokensToday: 100, runs24h: 2, inboxUnread: 3, approvalWaitAvgMs: 1000 }),
        mk(2, {
          costTodayUsd: 0.4,
          tokensToday: 900,
          runs24h: 5,
          failed24h: 1,
          inboxUnread: 1,
          approvalWaitAvgMs: 3000,
        }),
        mk(200, { costTodayUsd: 0.05, tokensToday: 10, runs24h: 1, inboxUnread: 7 }),
      ],
      day,
    );
    expect(points).toEqual([
      {
        day: "d1",
        spendUsd: 0.4,
        tokens: 900,
        runs: 5,
        failed: 1,
        inboxUnread: 1,
        approvalsPending: 0,
        approvalWaitAvgMs: 2000,
        samples: 2,
      },
      {
        day: "d2",
        spendUsd: 0.05,
        tokens: 10,
        runs: 1,
        failed: 0,
        inboxUnread: 7,
        approvalsPending: 0,
        approvalWaitAvgMs: null,
        samples: 1,
      },
    ]);
  });
});
