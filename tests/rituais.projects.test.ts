import fs from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  MONDAY,
  code,
  keyOf,
  rituaisWorld,
  sha,
  type Json,
  type RituaisWorld,
} from "./helpers/rituaisWorld.js";

/**
 * S2 and S3 of .specs/features/cerebro-rituais through `GET /api/memory/weekly-review`: who is in `projects`,
 * `someday.projects` and `archive`, each project's health, next action and review day, the order, the cuts, the context,
 * and what the existing routes (`POST /api/memory/reviews`, `PUT /api/memory/notes/properties`) do to the list.
 */

const NIGHT = new Date(2026, 10, 9, 23, 30).getTime();
const KEYS = [
  "path",
  "title",
  "status",
  "due",
  "health",
  "nextAction",
  "lastReviewed",
  "reviewBy",
  "reviewDue",
  "editable",
  "version",
];
let w: RituaisWorld;

beforeAll(async () => {
  w = await rituaisWorld("mordomo-rituais-projects-");
});
afterAll(async () => {
  await w.close();
});
beforeEach(async () => {
  w.at(MONDAY);
  w.update((s) => {
    s.indexedFolders = [];
    s.contexts = [];
  });
  await w.reset();
});

const notes = (...parts: string[]) => path.join(w.memory, "notes", ...parts);
const proj = (file: string, fields: Record<string, string>, body = "# P\n") =>
  w.note(file, { type: "project", ...fields }, body);
const byPath = (items: Json[], file: string) => items.find((i) => i.path === file);
const paths = (items: Json[]) => items.map((i) => i.path as string);

// ---- C20, C21 ----------------------------------------------------------------------------------------------------

describe("C20 who is in projects", () => {
  it("C20 one asserted case per membership row, the keys of an item, and an outside project not editable", async () => {
    const root = w.indexedRoot("fora");
    const active = proj(notes("active.md"), { status: "active" });
    const draft = proj(notes("draft.md"), { status: "draft" });
    const none = proj(notes("none.md"), {});
    const capital = w.note(notes("capital.md"), { type: "Project", status: "active" });
    const paused = proj(notes("paused.md"), { status: "paused" });
    const done = proj(notes("done.md"), { status: "done" });
    const archived = proj(notes("archived.md"), { status: "archived" });
    const inArchive = proj(path.join(w.memory, "archive", "2026-10-01-ab12cd34", "notes", "old.md"), {
      status: "active",
    });
    const status = w.note(notes("status.md"), { type: "status", status: "active" });
    const projects = w.note(notes("projects.md"), { type: "projects", status: "active" });
    const outside = proj(path.join(root, "fora.md"), { status: "active" });
    await w.index();
    const review = await w.review();
    const listed = paths(review.projects.items);
    expect(listed.sort()).toEqual([active, draft, none, capital, outside].sort());
    expect(paths(review.someday.projects)).toEqual([paused]);
    expect(review.archive.items.map((i: Json) => i.path)).toEqual([done]);
    for (const file of [archived, inArchive, status, projects]) {
      expect(listed, file).not.toContain(file);
      expect(paths(review.someday.projects), file).not.toContain(file);
      expect(paths(review.archive.items), file).not.toContain(file);
    }
    for (const item of review.projects.items)
      expect(Object.keys(item).sort(), item.path).toEqual([...KEYS].sort());
    expect(byPath(review.projects.items, outside)).toMatchObject({ editable: false, version: null });
    expect(byPath(review.projects.items, active)).toMatchObject({
      editable: true,
      version: sha(fs.readFileSync(active)),
    });
    expect(review.projects.total).toBe(5);
  });

  it("C20 with exactly one project, items has 1", async () => {
    proj(notes("so.md"), { status: "active" });
    await w.index();
    const review = await w.review();
    expect(review.projects.items).toHaveLength(1);
    expect(review.projects.total).toBe(1);
  });
});

describe("C21 health is the dashboards' projectHealth", () => {
  it("C21 behind, due_today, in_review, on_track in projects, paused in someday, and done routed to archive with no health", async () => {
    const behind = proj(notes("behind.md"), { status: "active", due: "2026-11-08" });
    const today = proj(notes("today.md"), { status: "active", due: "2026-11-09" });
    const review_ = proj(notes("review.md"), { status: "draft" });
    const onTrack = proj(notes("ontrack.md"), { status: "active" });
    const paused = proj(notes("paused.md"), { status: "paused" });
    const done = proj(notes("done.md"), { status: "done" });
    await w.index();
    const review = await w.review();
    expect(byPath(review.projects.items, behind).health).toBe("behind");
    expect(byPath(review.projects.items, today).health).toBe("due_today");
    expect(byPath(review.projects.items, review_).health).toBe("in_review");
    expect(byPath(review.projects.items, onTrack).health).toBe("on_track");
    expect(byPath(review.someday.projects, paused).health).toBe("paused");
    expect(byPath(review.projects.items, done)).toBeUndefined();
    expect(Object.keys(byPath(review.archive.items, done)).sort()).toEqual([
      "doneSince",
      "editable",
      "path",
      "title",
    ]);
  });
});

// ---- C22 ---------------------------------------------------------------------------------------------------------

describe("C22 nextAction through the route", () => {
  it("C22 the first unchecked task by line, a fenced and a front matter task ignored, the due marker off the text, null for only checked and for none, and the index's value", async () => {
    // lines: 1 ---, 2 type, 3 ---, 4 # A, 5 - [x] feito, 6 blank, 7 - [ ] Ligar, 8 blank, 9 - [ ] Depois
    const first = w.put(
      notes("a.md"),
      "---\ntype: project\n---\n# A\n- [x] feito\n\n- [ ] Ligar\n\n- [ ] Depois\n",
    );
    const fenced = w.put(notes("b.md"), "# B\n```\n- [ ] Dentro\n```\ntype:: project\n- [ ] Fora\n");
    const front = w.put(
      notes("c.md"),
      "---\ntype: project\nnota: x\n- [ ] Na frente\n---\n# C\n- [ ] Real\n",
    );
    const due = proj(notes("d.md"), {}, "# D\n- [ ] Enviar 📅 2026-11-20\n");
    const checked = proj(notes("e.md"), {}, "# E\n- [x] Feito\n");
    const empty = proj(notes("f.md"), {}, "# F\n");
    await w.index();
    let items = (await w.review()).projects.items as Json[];
    expect(byPath(items, first).nextAction).toEqual({ line: 7, text: "Ligar" });
    expect(byPath(items, fenced).nextAction).toEqual({ line: 6, text: "Fora" });
    expect(byPath(items, front).nextAction).toEqual({ line: 7, text: "Real" });
    expect(byPath(items, due).nextAction).toEqual({ line: 5, text: "Enviar" });
    expect(byPath(items, checked).nextAction).toBeNull();
    expect(byPath(items, empty).nextAction).toBeNull();
    // changed on disk after the pass: the stored task is answered
    fs.writeFileSync(first, "---\ntype: project\n---\n# A\n- [ ] Outra coisa\n");
    items = (await w.review()).projects.items as Json[];
    expect(byPath(items, first).nextAction).toEqual({ line: 7, text: "Ligar" });
  });
});

// ---- C23 ---------------------------------------------------------------------------------------------------------

describe("C23 reviewBy and reviewDue through the route", () => {
  it("C23 one case per row at 23:30 of 2026-11-09 local, and projectEvery 14d reaches the answer", async () => {
    w.at(NIGHT);
    const seven = proj(notes("seven.md"), { last_reviewed: "2026-11-02" });
    const six = proj(notes("six.md"), { last_reviewed: "2026-11-03" });
    const stored = proj(notes("stored.md"), { last_reviewed: "2026-10-01" });
    const byMtime = proj(notes("mtime.md"), {});
    w.touch(byMtime, new Date(2026, 10, 2, 23, 30).getTime());
    const three = proj(notes("three.md"), { review_every: "3d", last_reviewed: "2026-11-06" });
    const threeNot = proj(notes("three-not.md"), { review_every: "3d", last_reviewed: "2026-11-07" });
    const never = proj(notes("never.md"), { review_every: "never", last_reviewed: "2026-01-01" });
    await w.index();
    w.ctx.db
      .prepare(
        "INSERT INTO review_state (path, last_reviewed, snooze_until, never, updated_at) VALUES (?, ?, NULL, 0, ?)",
      )
      .run(stored, new Date(2026, 10, 5, 12, 0).getTime(), 1);
    let items = (await w.review()).projects.items as Json[];
    const at = (file: string) => [byPath(items, file).reviewBy, byPath(items, file).reviewDue];
    expect(at(seven)).toEqual(["2026-11-09", true]);
    expect(at(six)).toEqual(["2026-11-10", false]);
    expect(at(stored)).toEqual(["2026-11-12", false]);
    expect(byPath(items, stored).lastReviewed).toBe("2026-11-05");
    expect(at(byMtime)).toEqual(["2026-11-09", true]);
    expect(at(three)).toEqual(["2026-11-09", true]);
    expect(at(threeNot)).toEqual(["2026-11-10", false]);
    expect(at(never)).toEqual([null, false]);
    const put = await w.call("PUT", "/api/settings", { memory: { weeklyReview: { projectEvery: "14d" } } });
    expect(put.status, JSON.stringify(put.body)).toBe(200);
    try {
      items = (await w.review()).projects.items as Json[];
      expect(at(seven)).toEqual(["2026-11-16", false]);
    } finally {
      await w.call("PUT", "/api/settings", { memory: { weeklyReview: { projectEvery: "7d" } } });
    }
  });
});

// ---- C24, C25 ----------------------------------------------------------------------------------------------------

describe("C24 the order of projects", () => {
  it("C24 reviewDue first, then due ascending with none last, then title, then path", async () => {
    const lr = { last_reviewed: "2026-11-09" };
    const dueFirst = proj(notes("zeta.md"), {
      title: "Zeta",
      last_reviewed: "2026-11-02",
      due: "2026-12-01",
    });
    const d10 = proj(notes("d10.md"), { title: "Ômega", ...lr, due: "2026-11-10" });
    const d12 = proj(notes("d12.md"), { title: "Y", ...lr, due: "2026-11-12" });
    const d20 = proj(notes("d20.md"), { title: "X", ...lr, due: "2026-11-20" });
    const beta = proj(notes("beta.md"), { title: "Beta", ...lr, due: "2026-11-25" });
    const alfa = proj(notes("alfa.md"), { title: "Alfa", ...lr, due: "2026-11-25" });
    const noDue = proj(notes("sem.md"), { title: "Alfa", ...lr });
    const gamaB = proj(notes("b", "gama.md"), { title: "Gama", ...lr });
    const gamaA = proj(notes("a", "gama.md"), { title: "Gama", ...lr });
    await w.index();
    const items = (await w.review()).projects.items as Json[];
    expect(paths(items)).toEqual([dueFirst, d10, d12, d20, alfa, beta, noDue, gamaA, gamaB]);
  });
});

describe("C25 the cut of the other lists", () => {
  const many = (n: number, dir: string, fields: Record<string, string>) =>
    Array.from({ length: n }, (_, i) =>
      proj(notes(dir, `p${String(i).padStart(2, "0")}.md`), {
        title: `P ${String(i).padStart(2, "0")}`,
        ...fields,
      }),
    );

  it("C25 51 projects: the first 50 in C24's order and total 51; exactly 50: 50 and 50; maxItems 3: 3", async () => {
    const made = many(51, "x", { status: "active", last_reviewed: "2026-11-09" });
    await w.index();
    let review = await w.review();
    expect(paths(review.projects.items)).toEqual(made.slice(0, 50));
    expect(review.projects.total).toBe(51);
    fs.rmSync(made[50]!);
    await w.index();
    review = await w.review();
    expect([review.projects.items.length, review.projects.total]).toEqual([50, 50]);
    expect((await w.call("PUT", "/api/settings", { memory: { weeklyReview: { maxItems: 3 } } })).status).toBe(
      200,
    );
    try {
      review = await w.review();
      expect(paths(review.projects.items)).toEqual(made.slice(0, 3));
      expect(review.projects.total).toBe(50);
    } finally {
      await w.call("PUT", "/api/settings", { memory: { weeklyReview: { maxItems: 50 } } });
    }
  });

  it("C25 archive and inbox are cut at 50 with their total, exactly 50 is 50 and 50", async () => {
    many(51, "done", { status: "done" });
    for (let i = 0; i < 51; i++)
      w.put(path.join(w.memory, "inbox", `i${String(i).padStart(2, "0")}.md`), `# I ${i}\n`);
    await w.index();
    let review = await w.review();
    expect([review.archive.items.length, review.archive.total]).toEqual([50, 51]);
    expect([review.inbox.items.length, review.inbox.total]).toEqual([50, 51]);
    fs.rmSync(notes("done", "p50.md"));
    fs.rmSync(path.join(w.memory, "inbox", "i50.md"));
    await w.index();
    review = await w.review();
    expect([review.archive.items.length, review.archive.total]).toEqual([50, 50]);
    expect([review.inbox.items.length, review.inbox.total]).toEqual([50, 50]);
  });

  it("C25 someday.loops and someday.projects with 51 entries each list all 51", async () => {
    many(51, "paused", { status: "paused" });
    const texts = Array.from({ length: 51 }, (_, i) => `Laço ${String(i).padStart(2, "0")}`);
    w.journal(
      "2026-11-04",
      texts.map((t) => `09:00 ${t}`),
    );
    await w.index();
    for (const t of texts)
      expect(
        (await w.decide({ key: keyOf(t.toLowerCase().replace("ç", "c")), action: "someday" })).status,
        t,
      ).toBe(200);
    const review = await w.review();
    expect(review.someday.projects).toHaveLength(51);
    expect(review.someday.loops).toHaveLength(51);
  });
});

// ---- C26, C30, C32 -----------------------------------------------------------------------------------------------

describe("C26 Revisado through POST /api/memory/reviews", () => {
  it("C26 keep on a due project of memory/ and on one outside memory/ make it reviewDue false, lastReviewed today and reviewBy a week on", async () => {
    const root = w.indexedRoot("fora");
    const inside = proj(notes("due.md"), { status: "active", last_reviewed: "2026-10-01" });
    const outside = proj(path.join(root, "fora.md"), { status: "active", last_reviewed: "2026-10-01" });
    await w.index();
    let items = (await w.review()).projects.items as Json[];
    expect([byPath(items, inside).reviewDue, byPath(items, outside).reviewDue]).toEqual([true, true]);
    const a = await w.call("POST", "/api/memory/reviews", {
      path: inside,
      action: "keep",
      baseVersion: byPath(items, inside).version,
    });
    const b = await w.call("POST", "/api/memory/reviews", { path: outside, action: "keep" });
    expect([a.status, b.status], JSON.stringify([a.body, b.body])).toEqual([200, 200]);
    items = (await w.review()).projects.items as Json[];
    for (const file of [inside, outside])
      expect(byPath(items, file), file).toMatchObject({
        reviewDue: false,
        lastReviewed: "2026-11-09",
        reviewBy: "2026-11-16",
      });
  });
});

describe("C30 Concluído and Pausar through PUT /api/memory/notes/properties", () => {
  for (const [status, list] of [
    ["done", "archive"],
    ["paused", "someday"],
  ] as const)
    it(`C30 status ${status} takes the project out of projects into ${list}`, async () => {
      const file = proj(notes("p.md"), { status: "active" });
      await w.index();
      const res = await w.call("PUT", "/api/memory/notes/properties", {
        path: file,
        baseVersion: sha(fs.readFileSync(file)),
        set: { status },
      });
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      await w.index();
      const review = await w.review();
      expect(paths(review.projects.items)).not.toContain(file);
      expect(paths(list === "archive" ? review.archive.items : review.someday.projects)).toEqual([file]);
    });
});

describe("C32 someday.projects", () => {
  it("C32 a paused project is listed with C20's keys, one under memory/archive/ is not, and Reativar brings it back to projects", async () => {
    const paused = proj(notes("p.md"), { status: "paused" });
    proj(path.join(w.memory, "archive", "2026-10-01-ab12cd34", "notes", "old.md"), { status: "paused" });
    await w.index();
    let review = await w.review();
    expect(paths(review.someday.projects)).toEqual([paused]);
    expect(Object.keys(review.someday.projects[0]).sort()).toEqual([...KEYS].sort());
    const res = await w.call("PUT", "/api/memory/notes/properties", {
      path: paused,
      baseVersion: review.someday.projects[0].version,
      set: { status: "active" },
    });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    await w.index();
    review = await w.review();
    expect(paths(review.projects.items)).toEqual([paused]);
    expect(review.someday.projects).toEqual([]);
  });
});

// ---- C31 ---------------------------------------------------------------------------------------------------------

describe("C31 the context", () => {
  it("C31 context=<id> keeps only the context's projects, someday and archive (never the look-alike folder); loops and inbox as with none; all as none; an unknown id is 400 validation", async () => {
    const root = w.indexedRoot("r");
    const app = path.join(root, "projetos", "app");
    fs.mkdirSync(app, { recursive: true });
    w.update((s) => {
      s.contexts = [{ id: "app", name: "App", paths: [app] }];
    });
    const inApp = proj(path.join(app, "a.md"), { status: "active" });
    const pausedApp = proj(path.join(app, "b.md"), { status: "paused" });
    const doneNotes = proj(notes("app", "c.md"), { status: "done" });
    const inNotes = proj(notes("app", "d.md"), { status: "active" });
    proj(path.join(root, "projetos", "app-antigo", "e.md"), { status: "active" });
    proj(path.join(root, "projetos", "app-antigo", "f.md"), { status: "done" });
    proj(notes("outro.md"), { status: "paused" });
    w.journal("2026-11-04", ["09:00 Um laço"]);
    w.put(path.join(w.memory, "inbox", "x.md"), "# X\n");
    await w.index();
    const all = await w.review();
    const ctx = await w.review("context=app");
    expect(paths(ctx.projects.items).sort()).toEqual([inApp, inNotes].sort());
    expect(paths(ctx.someday.projects)).toEqual([pausedApp]);
    expect(paths(ctx.archive.items)).toEqual([doneNotes]);
    expect(ctx.loops).toEqual(all.loops);
    expect(ctx.inbox).toEqual(all.inbox);
    expect(ctx.someday.loops).toEqual(all.someday.loops);
    expect(all.projects.total).toBe(3);
    expect(await w.review("context=all")).toEqual(all);
    expect(code(await w.call("GET", "/api/memory/weekly-review?context=nao-existe"))).toEqual([
      400,
      "validation",
    ]);
  });
});
