import fs from "node:fs";
import path from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type { OsEvent } from "../core/src/events.js";
import { connectorMetaKey } from "../core/src/sentinels/connectorDelta.js";
import { writeMetaJson } from "../core/src/sentinels/meta.js";
import { SentinelRunner } from "../core/src/sentinels/runner.js";
import { movingClock } from "./helpers/movingClock.js";
import { notesViewWorld, type Json, type NotesViewWorld } from "./helpers/notesViewWorld.js";

/**
 * .specs/features/cerebro-natureza, batch B, S3: `settings.memory.reviews` and `settings.sentinels.reviewDue` through
 * `GET`/`PUT /api/settings` (`app.inject` against `buildServer`), and the `reviewDue` sentinel of the hourly pass
 * (`SentinelRunner.hourly()`) over a real home, its database, its bus and its inbox. "Today" is the local day of
 * `movingClock(NOW)`. The emit rule at its own layer is in `natureza.layer.test.ts`.
 */

const NOW = new Date(2026, 9, 30, 12, 0, 0).getTime();
const DAY = 86_400_000;
const pad = (n: number) => String(n).padStart(2, "0");
const day = (offset: number) => {
  const d = new Date(2026, 9, 30 + offset);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};
const DEFAULT_REVIEWS = {
  cadence: { opiniao: "90d", plano: "30d", hipotese: "60d", relato: "never", fato: "never" },
  byType: { status: "30d", conceito: "180d" },
  maxPerDay: 20,
};

let clock: ReturnType<typeof movingClock>;
let seq = 0;
beforeAll(() => {
  clock = movingClock(NOW);
});
afterEach(() => clock.set(NOW));
afterAll(() => clock.restore());

async function fresh<T>(fn: (world: NotesViewWorld) => Promise<T>): Promise<T> {
  const world = await notesViewWorld(`mordomo-natureza-sentinel-${++seq}-`);
  try {
    return await fn(world);
  } finally {
    await world.close();
  }
}
/** `count` notes of memory/notes/ due today, indexed. */
async function dueNotes(world: NotesViewWorld, count: number, name = "n"): Promise<string[]> {
  const files: string[] = [];
  for (let i = 0; i < count; i++)
    files.push(
      world.put(
        path.join(world.memory, "notes", `${name}${i}.md`),
        `---\nnatureza: opiniao\nlast_reviewed: ${day(-120)}\n---\n# N${i}\n`,
      ),
    );
  await world.index();
  return files;
}
/** The `sentinel.fired` events of `reviewDue` that `run` emits on the world's bus. */
async function reviewDueEvents(world: NotesViewWorld, run: () => Promise<unknown>): Promise<Json[]> {
  const seen: Json[] = [];
  const off = world.ctx.events.subscribe((e: OsEvent) => {
    const payload = e.payload as Json;
    if (e.type === "sentinel.fired" && payload.sentinel === "reviewDue") seen.push(payload);
  });
  try {
    await run();
  } finally {
    off();
  }
  return seen;
}
const reviewRows = (world: NotesViewWorld) =>
  world.ctx.notifications.list({ limit: 300 }).filter((n) => n.messageKey === "sentinel.reviewDue");

describe("S3 the settings of the reviews", () => {
  it("C38 the defaults of a fresh home, a PUT of maxPerDay that replaces memory.reviews whole and keeps memory's other fields, and each refused value alone storing nothing", async () => {
    await fresh(async (world) => {
      const first = await world.call("GET", "/api/settings");
      expect(first.body.memory.reviews).toEqual(DEFAULT_REVIEWS);
      expect(first.body.sentinels.reviewDue).toEqual({ enabled: true });

      // memory's other fields, moved off their defaults first
      const others = {
        notes: { fixedStructure: true },
        cleanup: { staleDays: 90, largeBytes: 1_000_000 },
        journalBudgetTokens: 3000,
        agentStance: "contest-conflicts",
        embeddings: { ...first.body.memory.embeddings, model: "modelo-c38" },
      };
      expect((await world.call("PUT", "/api/settings", { memory: others })).status).toBe(200);
      const custom = {
        cadence: { ...DEFAULT_REVIEWS.cadence, plano: "7d" },
        byType: { status: "5d" },
        maxPerDay: 50,
      };
      expect((await world.call("PUT", "/api/settings", { memory: { reviews: custom } })).status).toBe(200);
      expect((await world.call("GET", "/api/settings")).body.memory.reviews).toEqual(custom);

      const put = await world.call("PUT", "/api/settings", { memory: { reviews: { maxPerDay: 10 } } });
      expect(put.status, JSON.stringify(put.body)).toBe(200);
      const after = (await world.call("GET", "/api/settings")).body.memory;
      expect(after.reviews).toEqual({ ...DEFAULT_REVIEWS, maxPerDay: 10 });
      for (const [key, value] of Object.entries(others)) expect(after[key], key).toEqual(value);

      const file = world.ctx.paths.settingsFile;
      for (const reviews of [
        { cadence: { opiniao: "0d" } },
        { cadence: { plano: "3651d" } },
        { byType: { status: "semana" } },
        { maxPerDay: 0 },
        { maxPerDay: 201 },
      ]) {
        const bytes = fs.readFileSync(file);
        const res = await world.call("PUT", "/api/settings", { memory: { reviews } });
        expect([res.status, res.body.error?.code], JSON.stringify(reviews)).toEqual([400, "validation"]);
        expect(fs.readFileSync(file).equals(bytes), JSON.stringify(reviews)).toBe(true);
        expect((await world.call("GET", "/api/settings")).body.memory.reviews).toEqual({
          ...DEFAULT_REVIEWS,
          maxPerDay: 10,
        });
      }
    });
  });

  it("C39 after a PUT of cadence.opiniao 30d, the next GET /api/memory/reviews lists an opiniao note aged 31 days it did not list before", async () => {
    await fresh(async (world) => {
      const file = world.put(
        path.join(world.memory, "notes", "o.md"),
        `---\nnatureza: opiniao\nlast_reviewed: ${day(-31)}\n---\n# O\n`,
      );
      await world.index();
      const paths = async () =>
        ((await world.call("GET", "/api/memory/reviews")).body.items as Json[]).map((i) => i.path);
      expect(await paths()).toEqual([]);
      const put = await world.call("PUT", "/api/settings", {
        memory: { reviews: { cadence: { opiniao: "30d" } } },
      });
      expect(put.status, JSON.stringify(put.body)).toBe(200);
      expect(await paths()).toEqual([file]);
    });
  });
});

describe("S3 the daily reminder", () => {
  it("C40 three due notes and no notification today give one sentinel.fired with the payload; a second pass the same day none; the next day one with its own key", async () => {
    await fresh(async (world) => {
      await dueNotes(world, 3);
      const first = await reviewDueEvents(world, () => world.ctx.sentinels.hourly());
      expect(first).toEqual([
        {
          sentinel: "reviewDue",
          title: "3 items to review",
          body: expect.stringMatching(/\S/),
          severity: "info",
          href: "/brain/reviews",
          dedupeKey: `sentinel:reviewDue:${day(0)}:all`,
          messageParams: { count: 3, display: "3" },
        },
      ]);
      expect(await reviewDueEvents(world, () => world.ctx.sentinels.hourly())).toEqual([]);
      clock.set(NOW + DAY);
      const next = await reviewDueEvents(world, () => world.ctx.sentinels.hourly());
      expect(next.map((p) => p.dedupeKey)).toEqual([`sentinel:reviewDue:${day(1)}:all`]);
    });
  });

  it("C40 exactly one due note gives one event with count 1, and none due gives none", async () => {
    await fresh(async (world) => {
      expect(await reviewDueEvents(world, () => world.ctx.sentinels.hourly())).toEqual([]);
      await dueNotes(world, 1);
      const one = await reviewDueEvents(world, () => world.ctx.sentinels.hourly());
      expect(one.map((p) => p.messageParams)).toEqual([{ count: 1, display: "1" }]);
    });
  });

  /** A runner over the world's database, settings, bus and inbox, with one silent routine and one connector that has news. */
  function runnerOf(world: NotesViewWorld, onError: (err: unknown, where: string) => void) {
    writeMetaJson(world.ctx.db, connectorMetaKey("c-news"), { hash: "old", ids: [], at: NOW - DAY });
    return new SentinelRunner({
      db: world.ctx.db,
      paths: world.ctx.paths,
      getSettings: () => world.ctx.settings(),
      runs: {} as never,
      notifications: world.ctx.notifications,
      scheduler: {
        status: () =>
          [
            {
              id: "quieta",
              name: "Rotina quieta",
              enabled: true,
              kind: "every",
              every: { value: 1, unit: "hours" },
              lastFiredAt: null,
              createdAt: NOW - 10 * DAY,
            },
          ] as never,
        silent: () => [],
      },
      connectors: { list: () => [{ id: "c-news", name: "Notícias", dataMapping: {} }] as never },
      skills: { list: () => [] },
      bus: world.ctx.events,
      selfSchedule: false,
      fetchData: async () => ({ status: "ok", items: [{ id: "novo" }] }) as never,
      onError,
    });
  }
  const firedBy = async (world: NotesViewWorld, run: () => Promise<unknown>) => {
    const seen: string[] = [];
    const off = world.ctx.events.subscribe((e: OsEvent) => {
      if (e.type === "sentinel.fired") seen.push((e.payload as Json).sentinel as string);
    });
    try {
      await run();
    } finally {
      off();
    }
    return seen.sort();
  };

  it("C41 with reviewDue.enabled false and three due notes, no reviewDue event and no inbox row while silentRoutine runs; a settings.json without the key emits one", async () => {
    await fresh(async (world) => {
      await dueNotes(world, 3);
      world.update((s) => {
        s.sentinels.reviewDue.enabled = false;
      });
      const errors: string[] = [];
      const runner = runnerOf(world, (_err, where) => errors.push(where));
      expect(await firedBy(world, () => runner.hourly())).toEqual(["connectorDelta", "silentRoutine"]);
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(reviewRows(world)).toEqual([]);
      expect(errors).toEqual([]);

      // A home whose settings.json never had the key reads it on.
      const file = world.ctx.paths.settingsFile;
      const raw = JSON.parse(fs.readFileSync(file, "utf8")) as Json;
      delete raw.sentinels.reviewDue;
      fs.writeFileSync(file, JSON.stringify(raw, null, 2));
      expect(world.ctx.settings().sentinels.reviewDue).toEqual({ enabled: true });
      expect((await reviewDueEvents(world, () => world.ctx.sentinels.hourly())).length).toBe(1);
    });
  });

  it("C42 the inbox row the recorder makes: href, messageKey and messageParams, with 3, exactly 20 and 21 due notes", async () => {
    for (const [count, display, title] of [
      [3, "3", "3 items to review"],
      [20, "20", "20 items to review"],
      [21, "20+", "20+ items to review"],
    ] as const) {
      await fresh(async (world) => {
        await dueNotes(world, count);
        await world.ctx.sentinels.hourly();
        await new Promise((resolve) => setTimeout(resolve, 20));
        const rows = reviewRows(world);
        expect(rows, String(count)).toHaveLength(1);
        expect(rows[0], String(count)).toMatchObject({
          href: "/brain/reviews",
          messageKey: "sentinel.reviewDue",
          messageParams: { count, display },
          title,
        });
      });
    }
  });

  it("C43 when the reviewDue query throws, hourly() resolves, onError names reviewDue once, and silentRoutine and connectorDelta still emit", async () => {
    await fresh(async (world) => {
      await dueNotes(world, 3);
      world.ctx.db.exec("ALTER TABLE review_state RENAME TO review_state_away");
      const errors: string[] = [];
      try {
        const runner = runnerOf(world, (_err, where) => errors.push(where));
        let report: unknown;
        expect(await firedBy(world, async () => (report = await runner.hourly()))).toEqual([
          "connectorDelta",
          "silentRoutine",
        ]);
        expect(report).toMatchObject({ reviewDue: [] });
      } finally {
        world.ctx.db.exec("ALTER TABLE review_state_away RENAME TO review_state");
      }
      expect(errors).toEqual(["reviewDue"]);
    });
  });
});
