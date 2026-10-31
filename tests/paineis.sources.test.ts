import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { AppContext } from "../apps/api/src/context.js";
import { buildServer, startServer } from "../apps/api/src/server.js";
import type * as client from "../core/src/connectors/client.js";
import { ConnectorDataCache, setupChecklist } from "../core/src/connectors/client.js";
import { ConnectorSchema } from "../core/src/connectors/registry.js";
import { assertFact, retractFact } from "../core/src/memory/facts.js";
import * as reviews from "../core/src/memory/reviews.js";
import { makeTempHome } from "./helpers.js";
import { movingClock } from "./helpers/movingClock.js";
import {
  calendarItems,
  dayOf,
  fakeConnectorFetch,
  paineisWorld,
  runRow,
  type Json,
  type PaineisWorld,
} from "./helpers/paineisWorld.js";

/**
 * .specs/features/cerebro-paineis, batch A, S2: what each source of door 1 returns, read back from the snapshot that
 * `POST /api/dashboards/:id/refresh` stored (`app.inject` against `buildServer` over a real home). "Now" is `NOW`, a
 * Friday at noon, on a moving clock (`movingClock`) so that the index passes run; the claims that name a local day or
 * week in a pinned zone are in `paineis.localday.test.ts`.
 */

vi.mock("../core/src/connectors/client.js", async (importOriginal) => {
  const actual = await importOriginal<typeof client>();
  return { ...actual, fetchConnectorData: vi.fn(actual.fetchConnectorData) };
});
vi.mock("../core/src/memory/reviews.js", async (importOriginal) => {
  const actual = await importOriginal<typeof reviews>();
  return { ...actual, reviewsDue: vi.fn(actual.reviewsDue) };
});

const NOW = new Date(2026, 9, 30, 12, 0, 0).getTime();
const DAY = 86_400_000;
const HOUR = 3_600_000;
const MIN = 60_000;
/** What a KPI counts (batch B's trend, chip and items ride beside it in `data`). */
const kpiOf = (data: Json) => ({ value: data.value, of: data.of });
const repo = path.resolve(import.meta.dirname, "..");
let clock: ReturnType<typeof movingClock>;
let seq = 0;
let realQueue: typeof reviews.reviewsDue;

beforeAll(async () => {
  clock = movingClock(NOW);
  fakeConnectorFetch(calendarItems(NOW));
  realQueue = (await vi.importActual<typeof reviews>("../core/src/memory/reviews.js")).reviewsDue;
});
afterAll(() => {
  clock.restore();
});
afterEach(() => {
  clock.set(NOW);
  vi.mocked(reviews.reviewsDue).mockReset();
  vi.mocked(reviews.reviewsDue).mockImplementation(realQueue);
});

async function fresh<T>(fn: (world: PaineisWorld) => Promise<T>): Promise<T> {
  const world = await paineisWorld(`mordomo-paineis-sources-${++seq}-`);
  try {
    return await fn(world);
  } finally {
    await world.close();
  }
}

/** A dashboard of `widgets` (an area of `contextId` when given), refreshed now; its widgets by id, read back. */
async function evaluate(
  world: PaineisWorld,
  widgets: Json[],
  contextId?: string,
): Promise<Record<string, Json>> {
  const created = await world.create(contextId ? { template: "area", contextId } : { template: "overview" });
  expect(created.status, JSON.stringify(created.body)).toBe(201);
  const definition = { ...created.body.definition, refresh: "manual", widgets };
  const put = await world.call("PUT", `/api/dashboards/${created.body.id}`, {
    definition,
    baseVersion: created.body.version,
  });
  expect(put.status, JSON.stringify(put.body)).toBe(200);
  const res = await world.refresh(created.body.id);
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  const back = await world.get(created.body.id);
  expect(back.body.snapshot).toEqual(res.body.snapshot);
  return Object.fromEntries(back.body.snapshot.widgets.map((x: Json) => [x.id, x]));
}
const list = (id: string, source: Json, options: Json = { limit: 50 }): Json => ({
  id,
  kind: "list",
  title: id,
  source,
  options,
});

// ---- C29: notes --------------------------------------------------------------------------------------------------

describe("C29 the notes source", () => {
  const filters: Array<[string, Json, Record<string, string>, Record<string, string>, string[]?]> = [
    ["type", { type: ["decision"] }, { type: "decision" }, { type: "project" }],
    ["status", { status: ["draft"] }, { status: "draft" }, { status: "active" }],
    ["natureza", { natureza: ["plano"] }, { natureza: "plano" }, { natureza: "fato" }],
    ["escopo", { escopo: ["equipe"] }, { escopo: "equipe" }, { escopo: "pessoal" }],
  ];
  for (const [name, source, yes, no] of filters) {
    it(`C29 ${name}: only the matching note`, async () => {
      await fresh(async (world) => {
        const dir = path.join(world.memory, "notes", "c29");
        const hit = world.note(path.join(dir, "sim.md"), yes);
        world.note(path.join(dir, "nao.md"), no);
        world.note(path.join(dir, "nada.md"), {});
        await world.index();
        const got = await evaluate(world, [list("n", { kind: "notes", ...source })]);
        expect(got.n!.data.items.map((i: Json) => i.path)).toEqual([hit]);
      });
    });
  }

  it("C29 tags: only the note tagged cliente", async () => {
    await fresh(async (world) => {
      const dir = path.join(world.memory, "notes", "c29");
      const hit = world.put(path.join(dir, "sim.md"), "---\ntags: [cliente, x]\n---\n# Sim\n");
      world.put(path.join(dir, "nao.md"), "---\ntags: [fornecedor]\n---\n# Não\n");
      await world.index();
      const got = await evaluate(world, [list("n", { kind: "notes", tags: ["cliente"] })]);
      expect(got.n!.data.items.map((i: Json) => i.path)).toEqual([hit]);
    });
  });

  it("C29 folder: the notes under <memory>/notes/a and not those of <memory>/notes/a-b", async () => {
    await fresh(async (world) => {
      const a = world.note(path.join(world.memory, "notes", "a", "um.md"), {});
      const deep = world.note(path.join(world.memory, "notes", "a", "sub", "dois.md"), {});
      world.note(path.join(world.memory, "notes", "a-b", "tres.md"), {});
      await world.index();
      const got = await evaluate(world, [
        list("n", { kind: "notes", folder: path.join(world.memory, "notes", "a") }),
      ]);
      expect(got.n!.data.items.map((i: Json) => i.path).sort()).toEqual([a, deep].sort());
    });
  });

  it("C29 the dashboard's context: its ok path and its notes folder, not a look-alike", async () => {
    await fresh(async (world) => {
      const root = world.indexedRoot("c29ctx");
      const inPath = world.note(path.join(root, "proj", "a.md"), {});
      world.note(path.join(root, "proj-old", "b.md"), {});
      const inNotes = world.note(path.join(world.memory, "notes", "projeto-x", "c.md"), {});
      world.note(path.join(world.memory, "notes", "outro", "d.md"), {});
      world.context("projeto-x", "Projeto X", [path.join(root, "proj")]);
      await world.index();
      const got = await evaluate(world, [list("n", { kind: "notes" })], "projeto-x");
      expect(got.n!.data.items.map((i: Json) => i.path).sort()).toEqual([inPath, inNotes].sort());
    });
  });

  it("C29 changed week: an mtime this week, or an updated day this week, and not a note of last week", async () => {
    await fresh(async (world) => {
      const dir = path.join(world.memory, "notes", "c29w");
      const wednesday = new Date(2026, 9, 28, 10).getTime();
      const lastSunday = new Date(2026, 9, 25, 10).getTime();
      const byMtime = world.note(path.join(dir, "mtime.md"), {}, "# M\n", wednesday);
      const byUpdated = world.note(
        path.join(dir, "updated.md"),
        { updated: "2026-10-27" },
        "# U\n",
        lastSunday,
      );
      world.note(path.join(dir, "velha.md"), { updated: "2026-10-25" }, "# V\n", lastSunday);
      await world.index();
      const got = await evaluate(world, [list("n", { kind: "notes", changed: "week" })]);
      expect(got.n!.data.items.map((i: Json) => i.path).sort()).toEqual([byMtime, byUpdated].sort());
    });
  });

  it("C29 limit 8 by default with total 9, limit 50, ordered by updated, then mtime, then path; one match is a one-item list", async () => {
    await fresh(async (world) => {
      const dir = path.join(world.memory, "notes", "c29o");
      const files: string[] = [];
      // updated days 2026-10-01 to 2026-10-05 on five, none on four whose mtimes order them; two share an mtime
      for (let i = 1; i <= 5; i++)
        files.push(
          world.note(
            path.join(dir, `u${i}.md`),
            { type: "x", updated: `2026-10-0${i}` },
            "# U\n",
            NOW - i * HOUR,
          ),
        );
      files.push(world.note(path.join(dir, "m1.md"), { type: "x" }, "# M\n", NOW - 1 * MIN));
      files.push(world.note(path.join(dir, "m2.md"), { type: "x" }, "# M\n", NOW - 2 * MIN));
      files.push(world.note(path.join(dir, "m3a.md"), { type: "x" }, "# M\n", NOW - 3 * MIN));
      files.push(world.note(path.join(dir, "m3b.md"), { type: "x" }, "# M\n", NOW - 3 * MIN));
      world.note(path.join(dir, "so.md"), { type: "unica" });
      await world.index();
      const got = await evaluate(world, [
        { id: "d", kind: "list", title: "d", source: { kind: "notes", type: ["x"] } },
        list("cinquenta", { kind: "notes", type: ["x"] }, { limit: 50 }),
        list("um", { kind: "notes", type: ["unica"] }),
      ]);
      // updated descending (2026-10-05 first), then the notes with none by mtime descending, then by path
      const order = ["u5", "u4", "u3", "u2", "u1", "m1", "m2", "m3a", "m3b"].map((n) =>
        path.join(dir, `${n}.md`),
      );
      expect(got.cinquenta!.data.items.map((i: Json) => i.path)).toEqual(order);
      expect(got.d!.data.items).toHaveLength(8);
      expect(got.d!.data.total).toBe(9);
      expect(got.d!.data.items.map((i: Json) => i.path)).toEqual(order.slice(0, 8));
      expect(got.um!.data.items).toHaveLength(1);
      expect(got.um!.data.total).toBe(1);
      expect(files).toHaveLength(9);
    });
  });

  it("C29 groupBy status: active, draft, paused, done, archived, then other values alphabetically, then none, each with its count", async () => {
    await fresh(async (world) => {
      const dir = path.join(world.memory, "notes", "c29g");
      const statuses = [
        "zeta",
        "done",
        "active",
        "alfa",
        "archived",
        "paused",
        "draft",
        "active",
        null,
        null,
      ];
      statuses.forEach((status, i) => world.note(path.join(dir, `n${i}.md`), status ? { status } : {}));
      await world.index();
      const got = await evaluate(world, [
        { id: "b", kind: "bars", title: "b", source: { kind: "notes", folder: dir, groupBy: "status" } },
      ]);
      expect(got.b!.data.categories).toEqual([
        { label: "active", count: 2 },
        { label: "draft", count: 1 },
        { label: "paused", count: 1 },
        { label: "done", count: 1 },
        { label: "archived", count: 1 },
        { label: "alfa", count: 1 },
        { label: "zeta", count: 1 },
        { label: null, count: 2 },
      ]);
    });
  });
});

// ---- C30: runs and approvals -------------------------------------------------------------------------------------

describe("C30 runs and approvals", () => {
  it("C30 the running and queued runs first, then those finished in 24 h newest first, with skill, state and durationMs; the pending approvals oldest first with their age", async () => {
    await fresh(async (world) => {
      runRow(world, { id: "fila", status: "queued", skill: "recall", createdAt: NOW - 1 * MIN });
      runRow(world, {
        id: "rodando",
        status: "running",
        skill: "organize-brain",
        createdAt: NOW - 10 * MIN,
        startedAt: NOW - 9 * MIN,
      });
      runRow(world, {
        id: "fim-1h",
        status: "done",
        skill: "a",
        createdAt: NOW - 2 * HOUR,
        startedAt: NOW - 2 * HOUR,
        finishedAt: NOW - HOUR,
        durationMs: HOUR,
      });
      runRow(world, {
        id: "fim-5h",
        status: "failed",
        skill: "b",
        createdAt: NOW - 6 * HOUR,
        startedAt: NOW - 6 * HOUR,
        finishedAt: NOW - 5 * HOUR,
        durationMs: HOUR,
      });
      runRow(world, {
        id: "velha",
        status: "done",
        skill: "c",
        createdAt: NOW - 2 * DAY,
        startedAt: NOW - 2 * DAY,
        finishedAt: NOW - DAY - MIN,
        durationMs: 5,
      });
      const approval = (id: string, at: number, status = "pending") =>
        world.ctx.db
          .prepare(
            "INSERT INTO approvals (id, created_at, kind, description, status) VALUES (?, ?, 'run_write', ?, ?)",
          )
          .run(id, at, `aprovação ${id}`, status);
      approval("nova", NOW - 5 * MIN);
      approval("antiga", NOW - 2 * HOUR);
      approval("resolvida", NOW - 3 * HOUR, "approved");
      vi.useFakeTimers({ toFake: ["Date"], now: NOW });
      try {
        const got = await evaluate(world, [list("r", { kind: "runs" }), list("a", { kind: "approvals" })]);
        const runs = got.r!.data.items as Json[];
        expect(runs.map((r) => r.id)).toEqual(["fila", "rodando", "fim-1h", "fim-5h"]);
        expect(runs.map((r) => [r.skill, r.state])).toEqual([
          ["recall", "queued"],
          ["organize-brain", "running"],
          ["a", "done"],
          ["b", "failed"],
        ]);
        expect(runs[1]!.durationMs).toBe(9 * MIN);
        expect(runs[2]!.durationMs).toBe(HOUR);
        const approvals = got.a!.data.items as Json[];
        expect(approvals.map((a) => [a.id, a.ageMs])).toEqual([
          ["antiga", 2 * HOUR],
          ["nova", 5 * MIN],
        ]);
      } finally {
        vi.useRealTimers();
      }
    });
  });
});

// ---- C31: metrics ------------------------------------------------------------------------------------------------

describe("C31 the metrics source", () => {
  const SERIES = [
    "runs24h",
    "failed24h",
    "costTodayUsd",
    "tokensToday",
    "inboxUnread",
    "approvalsPending",
  ] as const;
  const sample = (world: PaineisWorld, at: number, v: Partial<Record<(typeof SERIES)[number], number>>) =>
    world.ctx.metricsHistory.sample(
      {
        runs: {
          total: 1,
          last24h: v.runs24h ?? 0,
          failed24h: v.failed24h ?? 0,
          costTodayUsd: v.costTodayUsd ?? 0,
          tokensToday: v.tokensToday ?? 0,
          spendWeekUsd: 0,
        },
        inboxUnread: v.inboxUnread ?? 0,
        approvalsPending: v.approvalsPending ?? 0,
        approvalWaitAvgMs: null,
      },
      at,
    );

  it("C31 table-driven: the newest sample's field is the value and the 14 days of dailyPoints the points; with no sample the widget is empty", async () => {
    await fresh(async (world) => {
      const empty = await evaluate(world, [
        {
          id: "m",
          kind: "kpi",
          title: "m",
          source: { kind: "metrics", series: "runs24h" },
          options: { measure: "latest" },
        },
      ]);
      expect(empty.m!.status).toBe("empty");

      const twoDaysAgo = (h: number) => new Date(2026, 9, 28, h).getTime();
      sample(world, twoDaysAgo(9), {
        runs24h: 7,
        failed24h: 1,
        costTodayUsd: 0.4,
        tokensToday: 900,
        inboxUnread: 3,
        approvalsPending: 2,
      });
      sample(world, twoDaysAgo(15), {
        runs24h: 5,
        failed24h: 2,
        costTodayUsd: 0.25,
        tokensToday: 400,
        inboxUnread: 4,
        approvalsPending: 1,
      });
      sample(world, NOW - HOUR, {
        runs24h: 12,
        failed24h: 3,
        costTodayUsd: 1.5,
        tokensToday: 2000,
        inboxUnread: 6,
        approvalsPending: 5,
      });
      sample(world, NOW - 20 * DAY, { runs24h: 99 });
      const got = await evaluate(
        world,
        SERIES.map((series) => ({
          id: series.toLowerCase(),
          kind: "kpi",
          title: series,
          source: { kind: "metrics", series },
          options: { measure: "latest" },
        })),
      );
      const want: Record<string, { value: number; day: number; today: number }> = {
        runs24h: { value: 12, day: 5, today: 12 },
        failed24h: { value: 3, day: 2, today: 3 },
        costTodayUsd: { value: 1.5, day: 0.4, today: 1.5 },
        tokensToday: { value: 2000, day: 900, today: 2000 },
        inboxUnread: { value: 6, day: 4, today: 6 },
        approvalsPending: { value: 5, day: 1, today: 5 },
      };
      // the widget data of a kpi is its value; the points are the source's, read through a list of it
      for (const series of SERIES)
        expect(kpiOf(got[series.toLowerCase()]!.data), series).toEqual({ value: want[series]!.value });
      const points = await evaluate(
        world,
        SERIES.map((series) => list(series.toLowerCase(), { kind: "metrics", series })),
      );
      for (const series of SERIES) {
        expect(points[series.toLowerCase()]!.data, series).toEqual({
          value: want[series]!.value,
          points: [
            { day: "2026-10-28", value: want[series]!.day },
            { day: dayOf(NOW - HOUR), value: want[series]!.today },
          ],
        });
      }
    });
  });
});

// ---- C32 and C33: connectors -------------------------------------------------------------------------------------

describe("C32 the connector source", () => {
  it("C32 list through fetchConnectorData with the settings' timeout, commands and zone, cut at the limit; flagged; a summary key; no mapping and no connector are not_configured", async () => {
    await fresh(async (world) => {
      world.update((s) => {
        s.connectors.dataTimeoutMs = 4321;
        s.connectors.allowedCommands = ["npx"];
        s.timezone = "America/Recife";
      });
      const items = Array.from({ length: 12 }, (_, i) => ({
        id: `e${i}`,
        title: `Evento ${i}`,
        subtitle: `Sala ${i}`,
        ts: NOW + i * HOUR,
        flagged: i % 4 === 0,
        href: `https://cal/e${i}`,
        tag: "x",
      }));
      const fake = fakeConnectorFetch({ status: "ok", syncedAt: NOW, items, summary: { unread: 7 } });
      const bare = {
        ...JSON.parse(fs.readFileSync(path.join(repo, "connectors", "calendar-google.json"), "utf8")),
        id: "sem-mapa",
        name: "Sem mapa",
      };
      delete bare.dataMapping;
      fs.writeFileSync(path.join(world.ctx.paths.connectors, "sem-mapa.json"), JSON.stringify(bare));
      const got = await evaluate(world, [
        {
          id: "lista",
          kind: "agenda",
          title: "l",
          source: { kind: "connector", id: "calendar-google", read: "list" },
          options: { limit: 8 },
        },
        list("marcados", { kind: "connector", id: "calendar-google", read: "flagged" }),
        {
          id: "resumo",
          kind: "kpi",
          title: "r",
          source: { kind: "connector", id: "calendar-google", read: "summary", key: "unread" },
          options: { measure: "count" },
        },
        list("sem-mapa", { kind: "connector", id: "sem-mapa", read: "list" }),
        list("nenhum", { kind: "connector", id: "nenhum", read: "list" }),
      ]);
      expect(fake).toHaveBeenCalled();
      for (const [connector, options] of fake.mock.calls) {
        expect(connector.id).toBe("calendar-google");
        expect(options).toMatchObject({ timeoutMs: 4321, allowedCommands: ["npx"], tz: "America/Recife" });
      }
      expect(got.lista!.data.items).toEqual(items.slice(0, 8).map(({ tag: _tag, ...item }) => item));
      expect(got.marcados!.data.items.map((i: Json) => i.id)).toEqual(["e0", "e4", "e8"]);
      expect(kpiOf(got.resumo!.data)).toEqual({ value: 7 });
      const snap = (await world.get("visao-geral")).body.snapshot;
      expect(snap.sources.find((s: Json) => s.id === "connector:sem-mapa")).toMatchObject({
        status: "not_configured",
      });
      expect(got["sem-mapa"]!.data).toEqual({
        connector: { id: "sem-mapa", name: "Sem mapa" },
        setup: setupChecklist(ConnectorSchema.parse(bare), { allowedCommands: ["npx"] }),
      });
      expect(snap.sources.find((s: Json) => s.id === "connector:nenhum")).toMatchObject({
        status: "not_configured",
      });
      expect(got.nenhum!.data.connector).toEqual({ id: "nenhum", name: "nenhum" });
    });
  });
});

async function freePort(): Promise<number> {
  return new Promise((resolve) => {
    const server = net.createServer().listen(0, "127.0.0.1", () => {
      const port = (server.address() as { port: number }).port;
      server.close(() => resolve(port));
    });
  });
}

describe("C33 one connector cache per service", () => {
  it("C33 the route's read serves the tick within the TTL, the button passes over it, an error is not cached, and the route and the evaluator read one cache", async () => {
    const temp = makeTempHome("mordomo-paineis-cache-");
    const s0 = new AppContext(temp.paths.home);
    const settings = s0.settings();
    settings.setupCompleted = true;
    settings.connectors.dataCacheTtlMs = HOUR;
    s0.settingsStore.save(settings);
    s0.close();
    fs.copyFileSync(
      path.join(repo, "connectors", "calendar-google.json"),
      path.join(temp.paths.connectors, "calendar-google.json"),
    );
    const ctx = new AppContext(temp.paths.home);
    const app = await buildServer(ctx);
    const owner = { "x-mordomo-token": ctx.token() };
    const call = async (method: "GET" | "POST", url: string, payload?: Json) => {
      const res = await app.inject({
        method,
        url,
        headers: payload ? { ...owner, "content-type": "application/json" } : owner,
        ...(payload ? { payload } : {}),
      });
      return { status: res.statusCode, body: res.json() as Json };
    };
    const instances = new Set<unknown>();
    const realRead = ConnectorDataCache.prototype.read;
    const spy = vi.spyOn(ConnectorDataCache.prototype, "read").mockImplementation(function (
      this: ConnectorDataCache,
      ...args
    ) {
      instances.add(this);
      return realRead.apply(this, args);
    });
    try {
      // an error is not cached: two ticks, two reads
      let fake = fakeConnectorFetch({ status: "error", syncedAt: null, items: [], message: "fora do ar" });
      expect((await call("POST", "/api/dashboards", { template: "overview" })).status).toBe(201);
      await ctx.dashboards.tick();
      expect(fake).toHaveBeenCalledTimes(1);
      clock.set(NOW + 16 * MIN);
      await ctx.dashboards.tick();
      expect(fake).toHaveBeenCalledTimes(2);

      // the route's read is the tick's within the TTL; the button passes over it
      fake = fakeConnectorFetch(calendarItems(NOW));
      clock.set(NOW + 20 * MIN);
      expect((await call("GET", "/api/connectors/calendar-google/data")).status).toBe(200);
      expect(fake).toHaveBeenCalledTimes(1);
      clock.set(NOW + 40 * MIN);
      expect(await ctx.dashboards.tick()).toEqual(["visao-geral"]);
      expect(fake).toHaveBeenCalledTimes(1);
      expect((await call("POST", "/api/dashboards/visao-geral/refresh")).status).toBe(200);
      expect(fake).toHaveBeenCalledTimes(2);
      expect([...instances]).toEqual([ctx.connectorCache]);
    } finally {
      spy.mockRestore();
      await app.close();
      ctx.close();
    }

    // the service's start: the same one cache for the route and the evaluator
    const s = new AppContext(temp.paths.home);
    const st = s.settings();
    st.port = await freePort();
    s.settingsStore.save(st);
    s.close();
    instances.clear();
    const again = vi.spyOn(ConnectorDataCache.prototype, "read").mockImplementation(function (
      this: ConnectorDataCache,
      ...args
    ) {
      instances.add(this);
      return realRead.apply(this, args);
    });
    const handle = await startServer(temp.paths.home);
    try {
      fakeConnectorFetch(calendarItems(NOW));
      const res = await fetch(`${handle.url}/api/connectors/calendar-google/data`, {
        headers: { "x-mordomo-token": handle.ctx.token() },
      });
      expect(res.status).toBe(200);
      clock.set(NOW + 2 * HOUR);
      await handle.ctx.dashboards.tick();
      expect(instances.size).toBe(1);
      expect([...instances][0]).toBe(handle.ctx.connectorCache);
    } finally {
      again.mockRestore();
      await handle.close();
      temp.cleanup();
    }
  });
});

// ---- C34 and C35: reviews and facts ------------------------------------------------------------------------------

describe("C34 the reviews source is C6's queue", () => {
  it("C34 with reviewsDue stubbed the widget's items and the KPI follow it, and a context dashboard hands it the context", async () => {
    await fresh(async (world) => {
      const root = world.indexedRoot("c34");
      world.context("projeto-x", "Projeto X", [root]);
      const stub = vi.mocked(reviews.reviewsDue);
      stub.mockReset();
      stub.mockReturnValue({ items: [{ path: "/x/stub.md" } as never], total: 7, nextDue: null });
      const got = await evaluate(
        world,
        [
          list("fila", { kind: "reviews" }),
          {
            id: "k",
            kind: "kpi",
            title: "Revisões vencidas",
            source: { kind: "reviews" },
            options: { measure: "count" },
          },
        ],
        "projeto-x",
      );
      expect(got.fila!.data.items).toEqual([{ path: "/x/stub.md" }]);
      expect(kpiOf(got.k!.data)).toEqual({ value: 7 });
      expect(stub).toHaveBeenCalled();
      for (const [, , query] of stub.mock.calls) expect(query?.context?.id).toBe("projeto-x");
    });
  });

  it("C34 the real queue: at a 90-day cadence a note reviewed 91 days ago is an item, one snoozed until tomorrow is not", async () => {
    await fresh(async (world) => {
      world.update((s) => {
        s.memory.reviews.cadence.opiniao = "90d";
      });
      const dir = path.join(world.memory, "notes", "c34");
      const due = world.note(path.join(dir, "vencida.md"), {
        natureza: "opiniao",
        last_reviewed: dayOf(NOW, -91),
      });
      const snoozed = world.note(path.join(dir, "adiada.md"), {
        natureza: "opiniao",
        last_reviewed: dayOf(NOW, -91),
      });
      await world.index();
      const snooze = await world.call("POST", "/api/memory/reviews", {
        path: snoozed,
        action: "snooze",
        days: 1,
      });
      expect(snooze.status, JSON.stringify(snooze.body)).toBe(200);
      const got = await evaluate(world, [list("fila", { kind: "reviews" })]);
      const paths = got.fila!.data.items.map((i: Json) => i.path);
      expect(paths).toContain(due);
      expect(paths).not.toContain(snoozed);
    });
  });
});

describe("C35 the facts source", () => {
  it("C35 the open facts newest first with their five fields, not a retracted one, and in a context only those whose source is inside", async () => {
    await fresh(async (world) => {
      const root = world.indexedRoot("c35");
      const inside = world.note(path.join(root, "proj", "fonte.md"), {});
      const outside = world.note(path.join(root, "proj-old", "fonte.md"), {});
      await world.index();
      const a = assertFact(world.ctx.db, {
        subject: "A",
        predicate: "é",
        object: "1",
        validFrom: NOW - 3 * DAY,
        sourcePath: inside,
      }).fact;
      const b = assertFact(world.ctx.db, {
        subject: "B",
        predicate: "é",
        object: "2",
        validFrom: NOW - DAY,
        sourcePath: outside,
      }).fact;
      const gone = assertFact(world.ctx.db, {
        subject: "C",
        predicate: "é",
        object: "3",
        validFrom: NOW - 2 * DAY,
        sourcePath: inside,
      }).fact;
      retractFact(world.ctx.db, gone.id, NOW - HOUR);
      const all = await evaluate(world, [list("f", { kind: "facts" })]);
      expect(all.f!.data.items).toEqual([
        { id: b.id, subject: "B", predicate: "é", object: "2", validFrom: NOW - DAY, sourcePath: outside },
        { id: a.id, subject: "A", predicate: "é", object: "1", validFrom: NOW - 3 * DAY, sourcePath: inside },
      ]);
      world.context("projeto-x", "Projeto X", [path.join(root, "proj")]);
      const scoped = await evaluate(world, [list("f", { kind: "facts" })], "projeto-x");
      expect(scoped.f!.data.items.map((i: Json) => i.subject)).toEqual(["A"]);
    });
  });
});

// ---- C36: the nature of every item from a note -------------------------------------------------------------------

describe("C36 every item from a note carries its nature", () => {
  it("C36 notes, tasks, decisions, projects and reviews: hipotese, an unknown value as null, none as null", async () => {
    await fresh(async (world) => {
      const dir = path.join(world.memory, "notes", "c36");
      const natures: Array<[string, string | null, string | null]> = [
        ["hipotese", "hipotese", "hipotese"],
        ["talvez", "talvez", null],
        ["nenhuma", null, null],
      ];
      const old = dayOf(NOW, -10);
      for (const [name, natureza] of natures) {
        const fields: Record<string, string> = { review_every: "1d", last_reviewed: old };
        if (natureza) fields.natureza = natureza;
        world.note(
          path.join(dir, `projeto-${name}.md`),
          { ...fields, type: "project", status: "active" },
          `# P ${name}\n\n- [ ] T ${name} 📅 ${dayOf(NOW)}\n`,
        );
        world.note(path.join(dir, `decisao-${name}.md`), { ...fields, type: "decision" }, `# D ${name}\n`);
      }
      await world.index();
      const got = await evaluate(world, [
        list("notes", { kind: "notes", folder: dir }),
        list("tasks", { kind: "tasks", window: "today" }),
        list("decisions", { kind: "decisions", window: "week" }),
        list("projects", { kind: "projects" }),
        list("reviews", { kind: "reviews" }),
      ]);
      for (const kind of ["notes", "tasks", "decisions", "projects", "reviews"]) {
        const items = got[kind]!.data.items as Json[];
        for (const [name, , want] of natures) {
          const mine = items.filter((i) => String(i.path).includes(`-${name}.md`));
          expect(mine.length, `${kind} ${name}`).toBeGreaterThan(0);
          for (const item of mine) expect(item.natureza, `${kind} ${name}`).toBe(want);
        }
      }
    });
  });
});
