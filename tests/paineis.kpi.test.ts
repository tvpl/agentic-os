import path from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type * as client from "../core/src/connectors/client.js";
import {
  calendarItems,
  dayOf,
  fakeConnectorFetch,
  paineisWorld,
  type Json,
  type PaineisWorld,
} from "./helpers/paineisWorld.js";

/**
 * .specs/features/cerebro-paineis, batch B, S3: what a `kpi` widget's `data` holds after a refresh - the value and the
 * denominator by its measure, the delta and the trend, the chip - through `POST /api/dashboards/:id/refresh` and
 * `GET /api/dashboards/:id` (`app.inject` against `buildServer` over a real home). The delta rules at their own layer
 * are `paineis.layer.test.ts` C40; the local hour of a point is `paineis.localhour.test.ts` C38.
 */

vi.mock("../core/src/connectors/client.js", async (importOriginal) => {
  const actual = await importOriginal<typeof client>();
  return { ...actual, fetchConnectorData: vi.fn(actual.fetchConnectorData) };
});

const NOW = new Date(2026, 9, 30, 12, 0, 0).getTime();
const HOUR = 3_600_000;
const TODAY = dayOf(NOW);
let seq = 0;

beforeAll(() => {
  fakeConnectorFetch(calendarItems(NOW));
});
afterEach(() => {
  vi.useRealTimers();
});
afterAll(() => {
  vi.restoreAllMocks();
});

async function fresh<T>(fn: (world: PaineisWorld) => Promise<T>): Promise<T> {
  const world = await paineisWorld(`mordomo-paineis-kpi-${++seq}-`);
  try {
    return await fn(world);
  } finally {
    await world.close();
  }
}

const kpi = (source: Json, options: Json = {}): Json => ({
  id: "k",
  kind: "kpi",
  title: "K",
  source,
  options,
});

/** A dashboard of `widgets`, refreshed at each instant of `at`; the last refresh's widget `k`, as GET reads it back. */
async function refreshAt(world: PaineisWorld, widgets: Json[], at: number[] = [NOW]): Promise<Json> {
  const created = await world.create({ template: "overview" });
  const put = await world.call("PUT", `/api/dashboards/${created.body.id}`, {
    definition: { ...created.body.definition, refresh: "manual", widgets },
    baseVersion: created.body.version,
  });
  expect(put.status, JSON.stringify(put.body)).toBe(200);
  let last: Json | null = null;
  for (const when of at) {
    vi.useFakeTimers({ toFake: ["Date"], now: when });
    const res = await world.refresh(created.body.id);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    last = res.body.snapshot;
    vi.useRealTimers();
  }
  const back = await world.get(created.body.id);
  expect(back.body.snapshot).toEqual(last);
  return back.body.snapshot.widgets.find((x: Json) => x.id === "k");
}

/** A note of `memory/notes/` with these tasks (each `[done, due]`). */
function tasks(world: PaineisWorld, name: string, list: Array<[boolean, string]>): void {
  const body = list.map(([done, due], i) => `- [${done ? "x" : " "}] Tarefa ${i + 1} 📅 ${due}`).join("\n");
  world.note(path.join(world.memory, "notes", `${name}.md`), {}, `# ${name}\n\n${body}\n`);
}

describe("C37 a kpi's data, by its measure", () => {
  it("C37 done_of_due with 5 tasks due today of which 2 are done: value 2, of 5, and, after a second refresh, the delta, the direction, good, the chip and the series", async () => {
    await fresh(async (world) => {
      tasks(world, "hoje", [
        [true, TODAY],
        [true, TODAY],
        [false, TODAY],
        [false, TODAY],
        [false, TODAY],
      ]);
      await world.index();
      const got = await refreshAt(
        world,
        [kpi({ kind: "tasks", window: "today" }, { measure: "done_of_due", chip: "remaining" })],
        [NOW - HOUR, NOW],
      );
      expect(got.status).toBe("ok");
      expect(Object.keys(got.data).sort()).toEqual([
        "chip",
        "delta",
        "deltaPct",
        "direction",
        "good",
        "items",
        "of",
        "series",
        "value",
      ]);
      expect(got.data).toMatchObject({
        value: 2,
        of: 5,
        delta: 0,
        deltaPct: 0,
        direction: "flat",
        good: true,
        chip: { rule: "remaining", n: 3, tone: "warn" },
      });
      expect(got.data.series.map((p: Json) => p.value)).toEqual([2, 2]);
    });
  });

  it("C37 open with 4 open tasks in the week: value 4 and no of", async () => {
    await fresh(async (world) => {
      tasks(world, "semana", [
        [false, TODAY],
        [false, dayOf(NOW, 2)],
        [false, dayOf(NOW, 4)],
        [false, dayOf(NOW, 6)],
        [true, dayOf(NOW, 1)],
        [false, dayOf(NOW, 9)],
      ]);
      await world.index();
      const got = await refreshAt(world, [kpi({ kind: "tasks", window: "week" }, { measure: "open" })]);
      expect(got.data.value).toBe(4);
      expect(got.data).not.toHaveProperty("of");
    });
  });

  it("C37 count on decisions with 6 decisions: 6", async () => {
    await fresh(async (world) => {
      for (let i = 1; i <= 6; i++)
        world.note(
          path.join(world.memory, "notes", `decisao-${i}.md`),
          { type: "decision" },
          `# Decisão ${i}\n`,
        );
      await world.index();
      const got = await refreshAt(world, [kpi({ kind: "decisions", window: "week" }, { measure: "count" })]);
      expect(got.data.value).toBe(6);
      expect(got.data).not.toHaveProperty("of");
    });
  });

  it("C37 on_track_of_active with 3 on_track, 1 behind, 1 due_today, 1 done: value 3, of 5", async () => {
    await fresh(async (world) => {
      const project = (name: string, fields: Record<string, string>) =>
        world.note(
          path.join(world.memory, "notes", `${name}.md`),
          { type: "project", ...fields },
          `# ${name}\n`,
        );
      project("a", { status: "active", due: dayOf(NOW, 5) });
      project("b", { status: "active" });
      project("c", { status: "active", due: dayOf(NOW, 1) });
      project("atrasado", { status: "active", due: dayOf(NOW, -1) });
      project("hoje", { status: "active", due: TODAY });
      project("feito", { status: "done" });
      await world.index();
      const got = await refreshAt(world, [kpi({ kind: "projects" }, { measure: "on_track_of_active" })]);
      expect({ value: got.data.value, of: got.data.of }).toEqual({ value: 3, of: 5 });
    });
  });

  it("C37 latest on runs24h 12: 12", async () => {
    await fresh(async (world) => {
      world.ctx.metricsHistory.sample(
        {
          runs: { total: 12, last24h: 12, failed24h: 0, costTodayUsd: 0, tokensToday: 0, spendWeekUsd: 0 },
          inboxUnread: 0,
          approvalsPending: 0,
          approvalWaitAvgMs: null,
        },
        NOW - 10 * 60_000,
      );
      const got = await refreshAt(world, [
        kpi({ kind: "metrics", series: "runs24h" }, { measure: "latest" }),
      ]);
      expect(got.data.value).toBe(12);
      expect(got.data).not.toHaveProperty("of");
    });
  });
});

// After round 3: a KPI's `upIsGood` reaches its stored data through the route (C40 at the boundary).
describe("C40 upIsGood at the boundary", () => {
  it("C40 a KPI with upIsGood false whose value rises from 1 to 3 is stored and read back good false, direction up", async () => {
    await fresh(async (world) => {
      const created = await world.create({ template: "overview" });
      const widgets = [kpi({ kind: "metrics", series: "runs24h" }, { measure: "latest", upIsGood: false })];
      expect(
        (
          await world.call("PUT", `/api/dashboards/${created.body.id}`, {
            definition: { ...created.body.definition, refresh: "manual", widgets },
            baseVersion: created.body.version,
          })
        ).status,
      ).toBe(200);
      const at = async (when: number, value: number) => {
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
          expect((await world.refresh(created.body.id)).status).toBe(200);
        } finally {
          vi.useRealTimers();
        }
      };
      await at(NOW - HOUR, 1);
      await at(NOW, 3);
      const got = (await world.get(created.body.id)).body.snapshot.widgets.find(
        (x: Json) => x.id === "k",
      ).data;
      expect(got).toMatchObject({ value: 3, delta: 2, direction: "up", good: false });
    });
  });
});

describe("C39 a kpi with fewer than two points", () => {
  it("C39 one stored point: a series of one point and no delta, deltaPct, direction or good key", async () => {
    await fresh(async (world) => {
      tasks(world, "uma", [[false, TODAY]]);
      await world.index();
      const got = await refreshAt(world, [kpi({ kind: "tasks", window: "today" }, { measure: "open" })]);
      const stored = world.ctx.db.prepare("SELECT value FROM dashboard_series").all();
      expect(stored).toEqual([{ value: 1 }]);
      expect(got.data.series).toHaveLength(1);
      expect(got.data.series[0].value).toBe(1);
      for (const key of ["delta", "deltaPct", "direction", "good"]) expect(got.data).not.toHaveProperty(key);
    });
  });

  it("C39 none (a KPI with no value stores no point): series [] and no delta", async () => {
    await fresh(async (world) => {
      const got = await refreshAt(world, [
        kpi({ kind: "metrics", series: "runs24h" }, { measure: "latest" }),
      ]);
      expect(got.status).toBe("empty");
      expect(world.ctx.db.prepare("SELECT COUNT(*) c FROM dashboard_series").get()).toEqual({ c: 0 });
      expect(got.data.series).toEqual([]);
      expect(got.data).not.toHaveProperty("delta");
    });
  });
});

describe("C41 a kpi's chip", () => {
  it("C41 remaining: of 5, value 3 → { remaining, 2, warn }; value 5 → no chip", async () => {
    await fresh(async (world) => {
      tasks(world, "tres", [
        [true, TODAY],
        [true, TODAY],
        [true, TODAY],
        [false, TODAY],
        [false, TODAY],
      ]);
      await world.index();
      const widget = kpi({ kind: "tasks", window: "today" }, { measure: "done_of_due", chip: "remaining" });
      const got = await refreshAt(world, [widget]);
      expect({ value: got.data.value, of: got.data.of }).toEqual({ value: 3, of: 5 });
      expect(got.data.chip).toEqual({ rule: "remaining", n: 2, tone: "warn" });
    });
    await fresh(async (world) => {
      tasks(
        world,
        "todas",
        Array.from({ length: 5 }, () => [true, TODAY] as [boolean, string]),
      );
      await world.index();
      const widget = kpi({ kind: "tasks", window: "today" }, { measure: "done_of_due", chip: "remaining" });
      const got = await refreshAt(world, [widget]);
      expect({ value: got.data.value, of: got.data.of }).toEqual({ value: 5, of: 5 });
      expect(got.data).not.toHaveProperty("chip");
    });
  });

  it("C41 open: 2 open decisions → { open, 2, warn }; 0 → no chip", async () => {
    const widget = kpi({ kind: "decisions", window: "week" }, { measure: "count", chip: "open" });
    await fresh(async (world) => {
      const decision = (name: string, natureza?: string) =>
        world.note(
          path.join(world.memory, "notes", `${name}.md`),
          { type: "decision", ...(natureza ? { natureza } : {}) },
          `# ${name}\n`,
        );
      decision("aberta-1", "plano");
      decision("aberta-2", "hipotese");
      decision("decidida", "fato");
      await world.index();
      const got = await refreshAt(world, [widget]);
      expect(got.data.value).toBe(3);
      expect(got.data.chip).toEqual({ rule: "open", n: 2, tone: "warn" });
    });
    await fresh(async (world) => {
      world.note(path.join(world.memory, "notes", "decidida.md"), { type: "decision" }, "# Decidida\n");
      await world.index();
      const got = await refreshAt(world, [widget]);
      expect(got.data.value).toBe(1);
      expect(got.data).not.toHaveProperty("chip");
    });
  });

  it("C41 behind: 3 behind projects → { behind, 3, danger }; 0 → no chip", async () => {
    const widget = kpi({ kind: "projects" }, { measure: "on_track_of_active", chip: "behind" });
    await fresh(async (world) => {
      for (const name of ["a", "b", "c"])
        world.note(
          path.join(world.memory, "notes", `${name}.md`),
          { type: "project", status: "active", due: dayOf(NOW, -2) },
          `# ${name}\n`,
        );
      world.note(path.join(world.memory, "notes", "ok.md"), { type: "project", status: "active" }, "# ok\n");
      await world.index();
      const got = await refreshAt(world, [widget]);
      expect(got.data.chip).toEqual({ rule: "behind", n: 3, tone: "danger" });
    });
    await fresh(async (world) => {
      world.note(path.join(world.memory, "notes", "ok.md"), { type: "project", status: "active" }, "# ok\n");
      await world.index();
      const got = await refreshAt(world, [widget]);
      expect({ value: got.data.value, of: got.data.of }).toEqual({ value: 1, of: 1 });
      expect(got.data).not.toHaveProperty("chip");
    });
  });
});
