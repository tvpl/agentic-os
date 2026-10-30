// The queue's day is the local day (amendment 6): a zone away from UTC, at an hour where the local day and the UTC day
// differ, tells one from the other (round 3, L1). Set before any date is built.
process.env.TZ = "America/Sao_Paulo";

import fs from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { decideReview } from "../core/src/memory/reviewDecisions.js";
import { reviewsDue } from "../core/src/memory/reviews.js";
import { movingClock } from "./helpers/movingClock.js";
import { notesViewWorld, sha, type Json, type NotesViewWorld } from "./helpers/notesViewWorld.js";

/**
 * C27, C28 and C45 of .specs/features/cerebro-natureza at 23:30 of 2026-10-30 in São Paulo, which is 02:30 of 2026-10-31
 * in UTC: "today" is 2026-10-30, at the route (`GET`/`POST /api/memory/reviews` through `app.inject`) and at the layer
 * (`reviewsDue`, `decideReview`), never 2026-10-31.
 */

const NOW = new Date(2026, 9, 30, 23, 30).getTime();
let w: NotesViewWorld;
let clock: ReturnType<typeof movingClock>;
let seq = 0;

beforeAll(async () => {
  clock = movingClock(NOW);
  w = await notesViewWorld("mordomo-natureza-localday-");
});
afterAll(async () => {
  await w.close();
  clock.restore();
});

const header = (fields: Record<string, string>) =>
  `---\n${Object.entries(fields)
    .map(([k, v]) => `${k}: ${v}`)
    .join("\n")}\n---\n# Nota\n`;
const dir = (name: string) => path.join(w.memory, "notes", `${name}-${++seq}`);
async function route(query: string) {
  const res = await w.call("GET", `/api/memory/reviews?${query}`);
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return (res.body as { items: Json[] }).items;
}
const layer = () =>
  reviewsDue(
    w.ctx.db,
    { paths: w.ctx.paths, settings: w.ctx.settings() },
    { kind: "due", limit: 200, now: Date.now() },
  ).items;

describe("the local day and the UTC day differ here", () => {
  it("C27 the zone holds: 23:30 of 2026-10-30 local is 2026-10-31 in UTC", () => {
    expect(new Date(NOW).getTimezoneOffset()).toBe(180);
    expect(new Date(NOW).toISOString().slice(0, 10)).toBe("2026-10-31");
    expect(new Date(NOW).getDate()).toBe(30);
  });
});

const at = { route: () => route("kind=due&limit=200"), layer: async () => layer() };

describe("C27 the due edge on the local day", () => {
  for (const side of ["route", "layer"] as const)
    it(`C27 an opiniao last reviewed 2026-08-01 is due since 2026-10-30, and one last reviewed 2026-08-02 is not due yet, at the ${side}`, async () => {
      const d = dir("c27");
      const due = path.join(d, "noventa.md");
      const notYet = path.join(d, "oitenta-e-nove.md");
      w.put(due, header({ natureza: "opiniao", last_reviewed: "2026-08-01" }));
      w.put(notYet, header({ natureza: "opiniao", last_reviewed: "2026-08-02" }));
      await w.index();
      const items = await at[side]();
      expect(items.find((i) => i.path === due)?.dueSince).toBe("2026-10-30");
      expect(items.find((i) => i.path === notYet)).toBeUndefined();
    });
});

describe("C28 the mtime's local day as the base", () => {
  for (const side of ["route", "layer"] as const)
    it(`C28 no last_reviewed and an mtime at 23:30 of 2026-08-01 local (2026-08-02 in UTC) is due since 2026-10-30, at the ${side}`, async () => {
      const file = path.join(dir("c28"), "sem-revisao.md");
      w.put(file, header({ natureza: "opiniao" }));
      const t = new Date(2026, 7, 1, 23, 30).getTime() / 1000;
      fs.utimesSync(file, t, t);
      await w.index();
      expect((await at[side]()).find((i) => i.path === file)).toMatchObject({
        dueSince: "2026-10-30",
        lastReviewed: null,
      });
    });
});

describe("C45 keep writes the local day", () => {
  it("C45 keep at 23:30 of 2026-10-30 local writes last_reviewed: 2026-10-30 through the route", async () => {
    const file = path.join(dir("c45"), "a.md");
    w.put(file, header({ natureza: "opiniao", last_reviewed: "2026-06-01" }));
    await w.index();
    const res = await w.call("POST", "/api/memory/reviews", {
      path: file,
      action: "keep",
      baseVersion: sha(fs.readFileSync(file)),
    });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(fs.readFileSync(file, "utf8")).toContain("last_reviewed: 2026-10-30\n");
  });

  it("C45 keep at 23:30 of 2026-10-30 local writes last_reviewed: 2026-10-30 at the layer", async () => {
    const file = path.join(dir("c45"), "b.md");
    w.put(file, header({ natureza: "opiniao", last_reviewed: "2026-06-01" }));
    await w.index();
    decideReview(
      { db: w.ctx.db, paths: w.ctx.paths, settings: w.ctx.settings() },
      { path: file, action: "keep", baseVersion: sha(fs.readFileSync(file)) },
      Date.now(),
    );
    expect(fs.readFileSync(file, "utf8")).toContain("last_reviewed: 2026-10-30\n");
  });
});
