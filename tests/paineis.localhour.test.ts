// The local hour of a series point (amendment 14, L-053): in a half-hour zone the local hour and the UTC hour start at
// different instants, so a point keyed by the UTC hour is told apart. Set before any date is built.
process.env.TZ = "Asia/Kolkata";

import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type * as client from "../core/src/connectors/client.js";
import { calendarItems, fakeConnectorFetch, paineisWorld, type Json } from "./helpers/paineisWorld.js";

/**
 * .specs/features/cerebro-paineis, batch B, C38: one point per KPI per local hour in `dashboard_series`, replacing the
 * point of the same hour, 90 days kept, through `POST /api/dashboards/:id/refresh` (`app.inject` against
 * `buildServer` over a real home), in Kolkata (UTC+05:30).
 */

vi.mock("../core/src/connectors/client.js", async (importOriginal) => {
  const actual = await importOriginal<typeof client>();
  return { ...actual, fetchConnectorData: vi.fn(actual.fetchConnectorData) };
});

const at = (h: number, m: number) => new Date(2026, 9, 30, h, m).getTime();
const HOUR = 3_600_000;
const DAY = 24 * HOUR;

beforeAll(() => {
  fakeConnectorFetch(calendarItems(at(10, 0)));
});
afterEach(() => {
  vi.useRealTimers();
});
afterAll(() => {
  vi.restoreAllMocks();
});

describe("the local hour and the UTC hour start apart here", () => {
  it("C38 the zone is pinned: 10:00 local is 04:30 UTC", () => {
    expect(process.env.TZ).toBe("Asia/Kolkata");
    expect(new Date(at(10, 0)).toISOString()).toBe("2026-10-30T04:30:00.000Z");
  });
});

describe("C38 one point per KPI per local hour", () => {
  it("C38 three refreshes at 10:05, 11:10 and 12:20 store points at 10:00, 11:00 and 12:00 local with delta -1 at the third; 12:40 replaces 12:00; a point 90 days + 1 h old goes and one 89 days old stays", async () => {
    const world = await paineisWorld("mordomo-paineis-localhour-");
    try {
      const created = await world.create({ template: "overview" });
      const put = await world.call("PUT", "/api/dashboards/visao-geral", {
        definition: {
          ...created.body.definition,
          refresh: "manual",
          widgets: [
            {
              id: "k",
              kind: "kpi",
              title: "Execuções",
              source: { kind: "metrics", series: "runs24h" },
              options: { measure: "latest" },
            },
          ],
        },
        baseVersion: created.body.version,
      });
      expect(put.status, JSON.stringify(put.body)).toBe(200);
      const refreshWith = async (when: number, value: number): Promise<Json> => {
        world.ctx.metricsHistory.sample(
          {
            runs: {
              total: value,
              last24h: value,
              failed24h: 0,
              costTodayUsd: 0,
              tokensToday: 0,
              spendWeekUsd: 0,
            },
            inboxUnread: 0,
            approvalsPending: 0,
            approvalWaitAvgMs: null,
          },
          when,
        );
        vi.useFakeTimers({ toFake: ["Date"], now: when });
        try {
          const res = await world.refresh("visao-geral");
          expect(res.status, JSON.stringify(res.body)).toBe(200);
          return res.body.snapshot.widgets.find((x: Json) => x.id === "k").data;
        } finally {
          vi.useRealTimers();
        }
      };
      const rows = () =>
        world.ctx.db
          .prepare(
            "SELECT at, value FROM dashboard_series WHERE dashboard_id = 'visao-geral' AND widget_id = 'k' ORDER BY at",
          )
          .all() as Array<{ at: number; value: number }>;

      await refreshWith(at(10, 5), 3);
      await refreshWith(at(11, 10), 4);
      const third = await refreshWith(at(12, 20), 2);
      expect(rows()).toEqual([
        { at: Date.UTC(2026, 9, 30, 4, 30), value: 3 },
        { at: Date.UTC(2026, 9, 30, 5, 30), value: 4 },
        { at: Date.UTC(2026, 9, 30, 6, 30), value: 2 },
      ]);
      expect(rows().map((r) => r.at)).toEqual([at(10, 0), at(11, 0), at(12, 0)]);
      expect(third.delta).toBe(-1);
      expect(third.direction).toBe("down");

      await refreshWith(at(12, 40), 5);
      expect(rows()).toHaveLength(3);
      expect(rows().at(-1)).toEqual({ at: at(12, 0), value: 5 });

      // Points the series kept from before: one 90 days + 1 hour old, one 89 days old.
      const next = at(13, 5);
      const hourStart = at(13, 0);
      const old = hourStart - 90 * DAY - HOUR;
      const kept = hourStart - 89 * DAY;
      const put2 = world.ctx.db.prepare(
        "INSERT INTO dashboard_series (dashboard_id, widget_id, at, value) VALUES ('visao-geral', 'k', ?, ?)",
      );
      put2.run(old, 9);
      put2.run(kept, 8);
      await refreshWith(next, 6);
      const ats = rows().map((r) => r.at);
      expect(ats).not.toContain(old);
      expect(ats).toContain(kept);
      expect(rows()).toEqual([
        { at: kept, value: 8 },
        { at: at(10, 0), value: 3 },
        { at: at(11, 0), value: 4 },
        { at: at(12, 0), value: 5 },
        { at: hourStart, value: 6 },
      ]);
    } finally {
      await world.close();
    }
  });
});
