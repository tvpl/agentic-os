// Every claim of .specs/features/cerebro-rituais about a local day, a local hour or a week boundary, in a zone away from
// UTC (L-053), at instants where the local day and the UTC day differ. Set before any date is built. São Paulo has had no
// daylight saving since 2019, so a week boundary there is a plain UTC-3 boundary.
process.env.TZ = "America/Sao_Paulo";

import fs from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { collectLoops, hidesLoop } from "../core/src/memory/loops.js";
import { weeklyReview } from "../core/src/memory/weeklyReview.js";
import { MONDAY, keyOf, rituaisWorld, type Json, type RituaisWorld } from "./helpers/rituaisWorld.js";

const NIGHT = new Date(2026, 10, 9, 23, 30).getTime();
let w: RituaisWorld;

beforeAll(async () => {
  w = await rituaisWorld("mordomo-rituais-localday-", NIGHT);
});
afterAll(async () => {
  await w.close();
});
beforeEach(async () => {
  w.at(NIGHT);
  await w.reset();
});

const env = () => ({ db: w.ctx.db, paths: w.ctx.paths, settings: w.ctx.settings() });
const loopsAt = {
  route: async () => (await w.review()).loops.items as Json[],
  layer: async () => collectLoops(env(), Date.now()) as unknown as Json[],
};

/** Change `memory.weeklyReview`: through `PUT /api/settings` for the route, in the store for the layer (no HTTP). */
async function option(side: "route" | "layer", change: Record<string, unknown>): Promise<void> {
  if (side === "layer") {
    w.update((s) => Object.assign(s.memory.weeklyReview, change));
    return;
  }
  const put = await w.call("PUT", "/api/settings", { memory: { weeklyReview: change } });
  expect(put.status, JSON.stringify(put.body)).toBe(200);
}

describe("the zone holds", () => {
  it("C2 23:30 of 2026-11-09 local is 02:30 of 2026-11-10 in UTC", () => {
    expect(new Date(NIGHT).getTimezoneOffset()).toBe(180);
    expect(new Date(NIGHT).toISOString().slice(0, 16)).toBe("2026-11-10T02:30");
    expect(new Date(NIGHT).getDate()).toBe(9);
  });
});

// ---- C2 ----------------------------------------------------------------------------------------------------------

describe("C2 the window's edge on the local day", () => {
  for (const side of ["route", "layer"] as const)
    it(`C2 89 days back is listed with ageDays 89, 90 days back and after today are not, and loopsWindowDays 7 reaches the answer, at the ${side}`, async () => {
      w.journal("2026-08-12", ["09:00 Oitenta e nove"]);
      w.journal("2026-08-11", ["09:00 Noventa"]);
      w.journal("2026-11-10", ["09:00 Amanhã"]);
      w.journal("2026-11-03", ["09:00 Seis"]);
      w.journal("2026-11-02", ["09:00 Sete"]);
      await w.index();
      let items = await loopsAt[side]();
      expect(items.map((i) => [i.text, i.day, i.ageDays])).toEqual([
        ["Oitenta e nove", "2026-08-12", 89],
        ["Sete", "2026-11-02", 7],
        ["Seis", "2026-11-03", 6],
      ]);
      await option(side, { loopsWindowDays: 7 });
      try {
        items = await loopsAt[side]();
        expect(items.map((i) => i.text)).toEqual(["Seis"]);
      } finally {
        await option(side, { loopsWindowDays: 90 });
      }
    });
});

// ---- C6 ----------------------------------------------------------------------------------------------------------

describe("C6 MEMORY.md's other lines", () => {
  for (const side of ["route", "layer"] as const)
    it(`C6 a line with no origin takes the mtime's local day, closed lines are not listed, and the provenance marks are not text nor key, at the ${side}`, async () => {
      const mem = w.memoryMd([
        "Sem origem",
        "Fechado → closed 2026-11-05",
        "Fechado com origem (journal 2026-11-02) → closed 2026-11-05",
        "Ligar para a Ana (fonte:: memory/journal/2026-11-04.md:12) (autor:: agente) (em:: 2026-11-04)",
      ]);
      w.touch(mem, new Date(2026, 10, 3, 23, 30).getTime());
      await w.index();
      const items = await loopsAt[side]();
      expect(items.map((i) => [i.text, i.day, i.key])).toEqual([
        ["Ligar para a Ana", "2026-11-03", keyOf("ligar para a ana")],
        ["Sem origem", "2026-11-03", keyOf("sem origem")],
      ]);
    });

  it("C6 the marked line's key equals the same text's key from the journal: one item", async () => {
    w.memoryMd([
      "Ligar para a Ana (fonte:: memory/journal/2026-11-04.md:12) (autor:: agente) (em:: 2026-11-04)",
    ]);
    const j = w.journal("2026-11-04", ["09:15 Ligar para a Ana"]);
    await w.index();
    const items = await loopsAt.route();
    expect(items).toHaveLength(1);
    expect(items[0]!.sources).toContainEqual({ path: j, line: 5 });
  });
});

// ---- C9 ----------------------------------------------------------------------------------------------------------

describe("C9 keep lasts the local week", () => {
  it("C9 kept at 10:00 of Monday 2026-11-09: absent at 23:59 of Sunday 2026-11-15 local, listed again at 00:00 of Monday 2026-11-16, the row as stored", async () => {
    w.at(MONDAY);
    w.journal("2026-11-04", ["09:15 Ligar para a Ana"]);
    await w.index();
    const key = keyOf("ligar para a ana");
    expect((await w.decide({ key, action: "keep" })).status).toBe(200);
    const sunday = new Date(2026, 10, 15, 23, 59).getTime();
    expect(new Date(sunday).toISOString().slice(0, 10)).toBe("2026-11-16");
    w.at(sunday);
    expect((await loopsAt.route()).map((i) => i.key)).toEqual([]);
    w.at(new Date(2026, 10, 16, 0, 0).getTime());
    expect((await loopsAt.route()).map((i) => i.key)).toEqual([key]);
    expect(w.rows()).toEqual([expect.objectContaining({ key, action: "keep", week: "2026-11-09" })]);
  });

  it("C9 at the layer, keep of week W hides in W and not in W + 7 days", () => {
    expect(hidesLoop({ action: "keep", week: "2026-11-09" }, "2026-11-09")).toBe(true);
    expect(hidesLoop({ action: "keep", week: "2026-11-09" }, "2026-11-16")).toBe(false);
  });
});

// ---- C23 ---------------------------------------------------------------------------------------------------------

describe("C23 reviewBy and reviewDue on the local day", () => {
  const notes = (name: string) => path.join(w.memory, "notes", name);
  const proj = (name: string, fields: Record<string, string>) =>
    w.note(notes(name), { type: "project", ...fields });
  const projectsAt = {
    route: async () => (await w.review()).projects.items as Json[],
    layer: async () => weeklyReview(env(), { now: Date.now() }).projects.items as unknown as Json[],
  };
  for (const side of ["route", "layer"] as const)
    it(`C23 one case per row at 23:30 of 2026-11-09 local, and projectEvery 14d, at the ${side}`, async () => {
      const seven = proj("seven.md", { last_reviewed: "2026-11-02" });
      const six = proj("six.md", { last_reviewed: "2026-11-03" });
      const stored = proj("stored.md", { last_reviewed: "2026-10-01" });
      const byMtime = proj("mtime.md", {});
      w.touch(byMtime, new Date(2026, 10, 2, 23, 30).getTime());
      const three = proj("three.md", { review_every: "3d", last_reviewed: "2026-11-06" });
      const threeNot = proj("three-not.md", { review_every: "3d", last_reviewed: "2026-11-07" });
      const never = proj("never.md", { review_every: "never", last_reviewed: "2026-01-01" });
      await w.index();
      w.ctx.db
        .prepare(
          "INSERT INTO review_state (path, last_reviewed, snooze_until, never, updated_at) VALUES (?, ?, NULL, 0, 1)",
        )
        .run(stored, new Date(2026, 10, 5, 23, 30).getTime());
      let items = await projectsAt[side]();
      const at = (file: string) => {
        const item = items.find((i) => i.path === file)!;
        return [item.reviewBy, item.reviewDue];
      };
      expect(at(seven)).toEqual(["2026-11-09", true]);
      expect(at(six)).toEqual(["2026-11-10", false]);
      // the stored review at 23:30 of 2026-11-05 local (2026-11-06 in UTC) is later than the header's and wins
      expect(at(stored)).toEqual(["2026-11-12", false]);
      expect(at(byMtime)).toEqual(["2026-11-09", true]);
      expect(at(three)).toEqual(["2026-11-09", true]);
      expect(at(threeNot)).toEqual(["2026-11-10", false]);
      expect(at(never)).toEqual([null, false]);
      await option(side, { projectEvery: "14d" });
      try {
        items = await projectsAt[side]();
        expect(at(seven)).toEqual(["2026-11-16", false]);
      } finally {
        await option(side, { projectEvery: "7d" });
      }
    });
});

// ---- batch B: the archive, the finish and the reminder -------------------------------------------------------------

const proj = (file: string, fields: Record<string, string>) => w.note(file, { type: "project", ...fields });
const notesOf = (...parts: string[]) => path.join(w.memory, "notes", ...parts);
const reminderOn = (weekly: { enabled: boolean; weekday: number; hour: number }) =>
  w.update((s) => {
    s.sentinels.weeklyReview = weekly;
  });
/** The `weeklyReview` payloads the engine's hourly pass emits. */
async function weeklyPass(): Promise<Json[]> {
  const seen: Json[] = [];
  const off = w.ctx.events.subscribe((e) => {
    const payload = e.payload as Json;
    if (e.type === "sentinel.fired" && payload.sentinel === "weeklyReview") seen.push(payload);
  });
  try {
    await w.ctx.sentinels.hourly();
  } finally {
    off();
  }
  return seen;
}

describe("C34 doneSince is the local day of the mtime", () => {
  it("C34 an mtime at 23:30 of 2026-11-03 local (2026-11-04 in UTC) gives doneSince 2026-11-03", async () => {
    const file = proj(notesOf("feito.md"), { status: "done" });
    const at = new Date(2026, 10, 3, 23, 30).getTime();
    expect(new Date(at).toISOString().slice(0, 10)).toBe("2026-11-04");
    w.touch(file, at);
    await w.index();
    expect((await w.review()).archive.items).toEqual([
      { path: file, title: "Nota", editable: true, doneSince: "2026-11-03" },
    ]);
  });
});

describe("C39 the archive's week on the local day", () => {
  it("C39 at 23:30 of Sunday 2026-11-15 local (Monday in UTC), 2026-11-16 answers 409 week_mismatch and 2026-11-09 is accepted", async () => {
    const sunday = new Date(2026, 10, 15, 23, 30).getTime();
    expect(new Date(sunday).toISOString().slice(0, 10)).toBe("2026-11-16");
    w.at(sunday);
    const file = w.put(path.join(w.memory, "inbox", "a.md"), "# A\n");
    await w.index();
    const refused = await w.archive({ week: "2026-11-16", paths: [file] });
    expect([refused.status, refused.body.error?.code]).toEqual([409, "week_mismatch"]);
    const accepted = await w.archive({ week: "2026-11-09", paths: [file] });
    expect(accepted.status, JSON.stringify(accepted.body)).toBe(200);
    expect(accepted.body.moved.map((m: Json) => m.from)).toEqual([file]);
  });
});

describe("C45 the finish on the local day", () => {
  it("C45 at 23:30 of 2026-11-09 local (2026-11-10 in UTC): the week, the journal of 2026-11-09 with the 23:30 bullet, and the projects whose local review day falls in the week", async () => {
    w.at(NIGHT);
    w.journal("2026-11-04", ["09:15 Ligar para a Ana"]);
    const before = proj(notesOf("antes.md"), { status: "active" });
    const inside = proj(notesOf("dentro.md"), { status: "active" });
    // 22:30 of 2026-11-08 local is 01:30 of 2026-11-09 in UTC: last week's, locally
    w.touch(before, new Date(2026, 10, 8, 22, 30).getTime());
    w.touch(inside, new Date(2026, 10, 9, 0, 30).getTime());
    await w.index();
    expect((await w.decide({ key: keyOf("ligar para a ana"), action: "close" })).status).toBe(200);
    const res = await w.finish({ week: "2026-11-09" });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const line =
      "- 23:30 Revisão semanal de 2026-11-09: 1 laços decididos, 1 projetos revisados, 0 arquivados.";
    const journal = path.join(w.memory, "journal", "2026-11-09.md");
    expect(res.body).toMatchObject({
      week: "2026-11-09",
      counts: { loops: 1, projects: 1, archived: 0 },
      journal: { path: journal, line },
    });
    expect(fs.readFileSync(journal, "utf8").split("\n")).toContain(line);
    expect(fs.existsSync(path.join(w.memory, "journal", "2026-11-10.md"))).toBe(false);
    expect(w.weeks().map((r) => r.week)).toEqual(["2026-11-09"]);
  });
});

describe("C48 the header's week and next reminder on the local day", () => {
  it("C48 nextReminder is 16:00 local (19:00 UTC) of Friday 2026-11-13 on Monday, of 2026-11-20 after the finish and on Saturday unfinished, 23:00 of Sunday 2026-11-15 with weekday 0 hour 23, null when off", async () => {
    reminderOn({ enabled: true, weekday: 5, hour: 16 });
    w.at(MONDAY);
    let review = await w.review();
    expect(review.week).toBe("2026-11-09");
    expect(review.nextReminder).toBe(Date.UTC(2026, 10, 13, 19, 0));
    w.at(new Date(2026, 10, 14, 10, 0).getTime());
    expect((await w.review()).nextReminder).toBe(Date.UTC(2026, 10, 20, 19, 0));
    w.at(MONDAY);
    reminderOn({ enabled: true, weekday: 0, hour: 23 });
    expect((await w.review()).nextReminder).toBe(Date.UTC(2026, 10, 16, 2, 0));
    reminderOn({ enabled: false, weekday: 5, hour: 16 });
    expect((await w.review()).nextReminder).toBeNull();
    reminderOn({ enabled: true, weekday: 5, hour: 16 });
    w.at(NIGHT);
    expect((await w.finish({ week: "2026-11-09" })).status).toBe(200);
    review = await w.review();
    expect(review.week).toBe("2026-11-09");
    expect(review.nextReminder).toBe(Date.UTC(2026, 10, 20, 19, 0));
  });
});

describe("C50 Friday 16:00 local", () => {
  it("C50 with two open loops and one project due, 15:59 of Friday 2026-11-13 local emits none and 16:00 (19:00 UTC) exactly one with the payload", async () => {
    reminderOn({ enabled: true, weekday: 5, hour: 16 });
    w.at(new Date(2026, 10, 13, 15, 59).getTime());
    w.journal("2026-11-10", ["09:00 Primeiro", "09:00 Segundo"]);
    proj(notesOf("vencido.md"), { status: "active", last_reviewed: "2026-11-01" });
    proj(notesOf("em-dia.md"), { status: "active", last_reviewed: "2026-11-12" });
    await w.index();
    expect(await weeklyPass()).toEqual([]);
    const four = new Date(2026, 10, 13, 16, 0).getTime();
    expect(new Date(four).toISOString().slice(0, 16)).toBe("2026-11-13T19:00");
    w.at(four);
    expect(await weeklyPass()).toEqual([
      {
        sentinel: "weeklyReview",
        title: expect.stringMatching(/\S/),
        body: expect.stringMatching(/\S/),
        severity: "info",
        href: "/brain/weekly",
        dedupeKey: "sentinel:weeklyReview:2026-11-09:all",
        messageParams: { loops: 2, projects: 1 },
      },
    ]);
  });
});

describe("C51 the window of a week", () => {
  for (const [label, at, emits] of [
    ["the first pass at 10:00 of Saturday 2026-11-14 emits one", new Date(2026, 10, 14, 10, 0), 1],
    ["the first pass at 23:00 of Sunday 2026-11-15 emits one", new Date(2026, 10, 15, 23, 0), 1],
    [
      "the first pass at 00:30 of Monday 2026-11-16 (the Friday before never ran) emits none",
      new Date(2026, 10, 16, 0, 30),
      0,
    ],
    ["a pass at 16:00 of Thursday 2026-11-12 emits none", new Date(2026, 10, 12, 16, 0), 0],
  ] as const)
    it(`C51 ${label}`, async () => {
      reminderOn({ enabled: true, weekday: 5, hour: 16 });
      w.at(at.getTime());
      const fired = await weeklyPass();
      expect(fired).toHaveLength(emits);
      if (emits) expect(fired[0]!.dedupeKey).toBe("sentinel:weeklyReview:2026-11-09:all");
    });
});

describe("C53 the settings reach the rule on the local day", () => {
  it("C53 weekday 0 hour 23: none at 23:00 of Saturday 2026-11-14 local, one at 23:00 of Sunday 2026-11-15 (02:00 UTC Monday); weekday 1 hour 0: one at 00:00 of Monday 2026-11-09", async () => {
    reminderOn({ enabled: true, weekday: 0, hour: 23 });
    w.at(new Date(2026, 10, 14, 23, 0).getTime());
    expect(await weeklyPass()).toEqual([]);
    const sunday = new Date(2026, 10, 15, 23, 0).getTime();
    expect(new Date(sunday).toISOString().slice(0, 13)).toBe("2026-11-16T02");
    w.at(sunday);
    expect((await weeklyPass()).map((p) => p.dedupeKey)).toEqual(["sentinel:weeklyReview:2026-11-09:all"]);
    await w.reset();
    reminderOn({ enabled: true, weekday: 1, hour: 0 });
    w.at(new Date(2026, 10, 9, 0, 0).getTime());
    expect((await weeklyPass()).map((p) => p.dedupeKey)).toEqual(["sentinel:weeklyReview:2026-11-09:all"]);
    reminderOn({ enabled: true, weekday: 5, hour: 16 });
  });
});
