import fs from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { MIGRATIONS } from "../core/src/db/migrations.js";
import type { OsEvent } from "../core/src/events.js";
import { readMetaJson } from "../core/src/sentinels/meta.js";
import { SentinelRunner } from "../core/src/sentinels/runner.js";
import { code, keyOf, rituaisWorld, type Json, type RituaisWorld } from "./helpers/rituaisWorld.js";

/**
 * S7 of .specs/features/cerebro-rituais (door 4): the settings of the weekly review and of its reminder through
 * `GET`/`PUT /api/settings`, and the sentinel `weeklyReview` of the hourly pass over a real home, its database, its bus
 * and its inbox: once a week, the record in `meta`, the switch, a finished week, the counts, a failing count and the
 * engine's own runner. The instants are local in whatever zone runs the suite; the zone of the claims is in
 * `rituais.localday.test.ts`.
 */

const HOUR = 3_600_000;
const FRIDAY = new Date(2026, 10, 13, 16, 0).getTime();
const META = "sentinel.weeklyReview.week";
let w: RituaisWorld;

beforeAll(async () => {
  w = await rituaisWorld("mordomo-rituais-sentinel-", FRIDAY);
});
afterAll(async () => {
  await w.close();
});
beforeEach(async () => {
  w.at(FRIDAY);
  w.update((s) => {
    s.indexedFolders = [];
    s.contexts = [];
    s.memory.weeklyReview = { projectEvery: "7d", loopsWindowDays: 90, maxItems: 50 };
    s.sentinels.weeklyReview = { enabled: true, weekday: 5, hour: 16 };
  });
  w.ctx.db.prepare("DELETE FROM notifications WHERE message_key = 'sentinel.weeklyReview'").run();
  await w.reset();
});

const notes = (...parts: string[]) => path.join(w.memory, "notes", ...parts);
/** The `sentinel.fired` payloads of `weeklyReview` a pass emits on the bus. */
const pass = async (run: () => Promise<unknown> = () => w.ctx.sentinels.hourly()): Promise<Json[]> => {
  const seen: Json[] = [];
  const off = w.ctx.events.subscribe((e: OsEvent) => {
    const payload = e.payload as Json;
    if (e.type === "sentinel.fired" && payload.sentinel === "weeklyReview") seen.push(payload);
  });
  try {
    await run();
  } finally {
    off();
  }
  return seen;
};
const rows = () =>
  w.ctx.notifications.list({ limit: 500 }).filter((n) => n.messageKey === "sentinel.weeklyReview");
const settle = () => new Promise((resolve) => setTimeout(resolve, 20));

// ---- C49 ---------------------------------------------------------------------------------------------------------

describe("C49 the settings of the weekly review and its reminder", () => {
  it("C49 a fresh home answers memory.weeklyReview and sentinels.weeklyReview by default, with no project in memory.reviews.byType, and 30 top-level keys", async () => {
    const file = w.ctx.paths.settingsFile;
    const raw = JSON.parse(fs.readFileSync(file, "utf8")) as Json;
    delete raw.memory.weeklyReview;
    delete raw.sentinels.weeklyReview;
    fs.writeFileSync(file, JSON.stringify(raw, null, 2));
    const settings = (await w.call("GET", "/api/settings")).body;
    expect(settings.memory.weeklyReview).toEqual({ projectEvery: "7d", loopsWindowDays: 90, maxItems: 50 });
    expect(settings.sentinels.weeklyReview).toEqual({ enabled: true, weekday: 5, hour: 16 });
    expect(Object.keys(settings.memory.reviews.byType)).not.toContain("project");
    expect(Object.keys(settings)).toHaveLength(30);
  });

  /** One PUT of `memory.weeklyReview` or `sentinels.weeklyReview`; refused ones store nothing. */
  async function edge(kind: "memory" | "sentinels", value: Json, accepted: boolean): Promise<void> {
    const file = w.ctx.paths.settingsFile;
    const before = (await w.call("GET", "/api/settings")).body;
    const bytes = fs.readFileSync(file);
    const body =
      kind === "memory"
        ? { memory: { weeklyReview: value } }
        : { sentinels: { ...before.sentinels, weeklyReview: value } };
    const res = await w.call("PUT", "/api/settings", body);
    const label = `${kind} ${JSON.stringify(value)}`;
    if (accepted) {
      expect(res.status, `${label}: ${JSON.stringify(res.body)}`).toBe(200);
      const after = (await w.call("GET", "/api/settings")).body;
      expect(after[kind].weeklyReview, label).toMatchObject(value);
    } else {
      expect(code(res), label).toEqual([400, "validation"]);
      expect(fs.readFileSync(file).equals(bytes), label).toBe(true);
    }
  }

  it("C49 each edge of memory.weeklyReview, accepted and read back or refused with 400 validation and nothing stored", async () => {
    for (const projectEvery of ["1d", "3650d", "never"]) await edge("memory", { projectEvery }, true);
    for (const projectEvery of ["0d", "3651d", "semana"]) await edge("memory", { projectEvery }, false);
    for (const loopsWindowDays of [7, 3650]) await edge("memory", { loopsWindowDays }, true);
    for (const loopsWindowDays of [6, 3651]) await edge("memory", { loopsWindowDays }, false);
    for (const maxItems of [1, 200]) await edge("memory", { maxItems }, true);
    for (const maxItems of [0, 201]) await edge("memory", { maxItems }, false);
  });

  it("C49 each edge of sentinels.weeklyReview, accepted and read back or refused with 400 validation and nothing stored", async () => {
    for (const weekday of [0, 6]) await edge("sentinels", { enabled: true, weekday, hour: 16 }, true);
    for (const weekday of [-1, 7]) await edge("sentinels", { enabled: true, weekday, hour: 16 }, false);
    for (const hour of [0, 23]) await edge("sentinels", { enabled: true, weekday: 5, hour }, true);
    for (const hour of [-1, 24]) await edge("sentinels", { enabled: true, weekday: 5, hour }, false);
  });

  it("C49 PUT {memory:{weeklyReview:{maxItems:10}}} stores the whole object with its defaults and keeps memory.reviews, memory.notes and memory.cleanup", async () => {
    w.update((s) => {
      s.memory.weeklyReview = { projectEvery: "3d", loopsWindowDays: 30, maxItems: 20 };
      s.memory.reviews.maxPerDay = 7;
    });
    const before = (await w.call("GET", "/api/settings")).body.memory;
    const res = await w.call("PUT", "/api/settings", { memory: { weeklyReview: { maxItems: 10 } } });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const after = (await w.call("GET", "/api/settings")).body.memory;
    expect(after.weeklyReview).toEqual({ projectEvery: "7d", loopsWindowDays: 90, maxItems: 10 });
    expect(after.reviews).toEqual(before.reviews);
    expect(after.reviews.maxPerDay).toBe(7);
    expect(after.notes).toEqual(before.notes);
    expect(after.cleanup).toEqual(before.cleanup);
  });
});

// ---- C52 ---------------------------------------------------------------------------------------------------------

describe("C52 once a week", () => {
  it("C52 after the 16:00 pass of 2026-11-13 a pass at 17:00 emits none; after the owner deletes the inbox row, 18:00 none (the meta row); 16:00 of 2026-11-20 emits one", async () => {
    expect(await pass()).toHaveLength(1);
    expect(readMetaJson(w.ctx.db, META)).toBe("2026-11-09");
    w.at(FRIDAY + HOUR);
    expect(await pass()).toEqual([]);
    await settle();
    const [row] = rows();
    expect(row).toBeDefined();
    const deleted = await w.call("DELETE", `/api/notifications/${row!.id}`);
    expect(deleted.status).toBe(200);
    expect(rows()).toEqual([]);
    w.at(FRIDAY + 2 * HOUR);
    expect(await pass()).toEqual([]);
    await settle();
    expect(rows()).toEqual([]);
    expect(readMetaJson(w.ctx.db, META)).toBe("2026-11-09");
    w.at(new Date(2026, 10, 20, 16, 0).getTime());
    const next = await pass();
    expect(next.map((p) => p.dedupeKey)).toEqual(["sentinel:weeklyReview:2026-11-16:all"]);
    expect(readMetaJson(w.ctx.db, META)).toBe("2026-11-16");
  });
});

// ---- C53 ---------------------------------------------------------------------------------------------------------

/** A runner over the world's database, settings, bus and inbox, with one silent routine, as the natureza model. */
function runnerOf(onError: (err: unknown, where: string) => void): SentinelRunner {
  return new SentinelRunner({
    db: w.ctx.db,
    paths: w.ctx.paths,
    getSettings: () => w.ctx.settings(),
    runs: {} as never,
    notifications: w.ctx.notifications,
    scheduler: {
      status: () =>
        [
          {
            id: `quieta-${Date.now()}`,
            name: "Rotina quieta",
            enabled: true,
            kind: "every",
            every: { value: 1, unit: "hours" },
            lastFiredAt: null,
            createdAt: Date.now() - 10 * 24 * HOUR,
          },
        ] as never,
      silent: () => [],
    },
    connectors: { list: () => [] },
    skills: { list: () => [] },
    bus: w.ctx.events,
    selfSchedule: false,
    onError,
  });
}
const firedBy = async (run: () => Promise<unknown>): Promise<string[]> => {
  const seen: string[] = [];
  const off = w.ctx.events.subscribe((e: OsEvent) => {
    if (e.type === "sentinel.fired") seen.push((e.payload as Json).sentinel as string);
  });
  try {
    await run();
  } finally {
    off();
  }
  return seen.sort();
};

describe("C53 no event", () => {
  it("C53 enabled false at 16:00 of Friday: no weeklyReview event and no inbox row, while silentRoutine still emits", async () => {
    w.update((s) => {
      s.sentinels.weeklyReview.enabled = false;
    });
    const errors: string[] = [];
    expect(await firedBy(() => runnerOf((_e, where) => errors.push(where)).hourly())).toEqual([
      "silentRoutine",
    ]);
    await settle();
    expect(rows()).toEqual([]);
    expect(errors).toEqual([]);
    expect(readMetaJson(w.ctx.db, META)).toBeNull();
  });

  it("C53 the week finished on Thursday 2026-11-12 (finish posted) gives no event at 16:00 of Friday", async () => {
    w.at(new Date(2026, 10, 12, 18, 0).getTime());
    expect((await w.finish({ week: "2026-11-09" })).status).toBe(200);
    w.at(FRIDAY);
    expect(await pass()).toEqual([]);
    await settle();
    expect(rows()).toEqual([]);
  });

  it("C53 the settings reach the rule: weekday 0 hour 23 emits none at 23:00 of Saturday and one at 23:00 of Sunday; weekday 1 hour 0 emits one at 00:00 of Monday 2026-11-09", async () => {
    w.update((s) => {
      s.sentinels.weeklyReview = { enabled: true, weekday: 0, hour: 23 };
    });
    w.at(new Date(2026, 10, 14, 23, 0).getTime());
    expect(await pass()).toEqual([]);
    w.at(new Date(2026, 10, 15, 23, 0).getTime());
    expect((await pass()).map((p) => p.dedupeKey)).toEqual(["sentinel:weeklyReview:2026-11-09:all"]);
    await w.reset();
    w.update((s) => {
      s.sentinels.weeklyReview = { enabled: true, weekday: 1, hour: 0 };
    });
    w.at(new Date(2026, 10, 9, 0, 0).getTime());
    expect((await pass()).map((p) => p.dedupeKey)).toEqual(["sentinel:weeklyReview:2026-11-09:all"]);
  });
});

// ---- C54 ---------------------------------------------------------------------------------------------------------

describe("C54 the counts are the totals", () => {
  it("C54 60 open loops past maxItems 50 (one decided and one kept this week not counted) and 2 projects due among 55 give { loops: 60, projects: 2 }; the inbox row carries them", async () => {
    w.journal(
      "2026-11-10",
      Array.from({ length: 62 }, (_, i) => `09:00 Laço ${String(i).padStart(2, "0")}`),
    );
    for (let i = 0; i < 55; i++) {
      w.note(notes(`p${String(i).padStart(2, "0")}.md`), {
        type: "project",
        status: "active",
        last_reviewed: i < 2 ? "2026-11-01" : "2026-11-12",
      });
    }
    await w.index();
    expect((await w.decide({ key: keyOf("laco 00"), action: "close" })).status).toBe(200);
    expect((await w.decide({ key: keyOf("laco 01"), action: "keep" })).status).toBe(200);
    const review = await w.review();
    expect([review.loops.items.length, review.loops.total]).toEqual([50, 60]);
    expect(review.projects.total).toBe(55);
    const [payload] = await pass();
    expect(payload!.messageParams).toEqual({ loops: 60, projects: 2 });
    await settle();
    const [row] = rows();
    expect(rows()).toHaveLength(1);
    expect(row).toMatchObject({
      kind: "system",
      href: "/brain/weekly",
      messageKey: "sentinel.weeklyReview",
      messageParams: { loops: 60, projects: 2 },
    });
  });
});

// ---- C55 ---------------------------------------------------------------------------------------------------------

describe("C55 a count that fails", () => {
  it("C55 with loop_decisions dropped, hourly() resolves, onError names weeklyReview once, no meta row is written, and reviewDue and silentRoutine still emit", async () => {
    for (const n of ["a", "b", "c"])
      w.note(notes(`${n}.md`), { natureza: "opiniao", last_reviewed: "2025-01-01" }, `# ${n}\n`);
    await w.index();
    w.ctx.db.prepare("DELETE FROM notifications WHERE message_key = 'sentinel.reviewDue'").run();
    const errors: string[] = [];
    w.ctx.db.exec("DROP TABLE loop_decisions");
    let report: Json = {};
    try {
      expect(
        await firedBy(async () => {
          report = (await runnerOf((_e, where) => errors.push(where)).hourly()) as unknown as Json;
        }),
      ).toEqual(["reviewDue", "silentRoutine"]);
    } finally {
      w.ctx.db.exec(MIGRATIONS.find((m) => m.version === 33)!.sql!);
    }
    expect(errors).toEqual(["weeklyReview"]);
    expect(report.weeklyReview).toEqual([]);
    expect(readMetaJson(w.ctx.db, META)).toBeNull();
    // the next pass, with the table back, can still emit
    expect(await pass()).toHaveLength(1);
  });
});

// ---- C56 ---------------------------------------------------------------------------------------------------------

describe("C56 the engine's own runner", () => {
  it("C56 ctx.sentinels.hourly() at 16:00 of Friday 2026-11-13 returns a report whose weeklyReview holds one payload, and the inbox has one sentinel.weeklyReview row", async () => {
    const report = await w.ctx.sentinels.hourly();
    expect(report.weeklyReview).toHaveLength(1);
    expect(report.weeklyReview[0]).toMatchObject({
      sentinel: "weeklyReview",
      href: "/brain/weekly",
      dedupeKey: "sentinel:weeklyReview:2026-11-09:all",
    });
    await settle();
    expect(rows()).toHaveLength(1);
  });
});
