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
 * S6 of .specs/features/cerebro-rituais through `POST /api/memory/weekly-review/finish` and the header of
 * `GET /api/memory/weekly-review`: the week's counts, the stored row, the journal line, the once rule, the refusals of
 * the week, and `counts`, `reviewsDue` and `nextReminder` of the list. The local zone of the claims is in
 * `rituais.localday.test.ts`; here the instants are local in whatever zone runs the suite.
 */

const WEEK = "2026-11-09";
const NIGHT = new Date(2026, 10, 9, 23, 30).getTime();
const DAY = 86_400_000;
let w: RituaisWorld;

beforeAll(async () => {
  w = await rituaisWorld("mordomo-rituais-finish-");
});
afterAll(async () => {
  await w.close();
});
beforeEach(async () => {
  w.at(MONDAY);
  w.update((s) => {
    s.indexedFolders = [];
    s.contexts = [];
    s.sentinels.weeklyReview = { enabled: true, weekday: 5, hour: 16 };
  });
  await w.reset();
});

const notes = (...parts: string[]) => path.join(w.memory, "notes", ...parts);
const inbox = (...parts: string[]) => path.join(w.memory, "inbox", ...parts);
const journalOf = (day: string) => path.join(w.memory, "journal", `${day}.md`);
const proj = (file: string, fields: Record<string, string>) => w.note(file, { type: "project", ...fields });
const LINE = (hhmm: string, loops: number, projects: number, archived: number) =>
  `- ${hhmm} Revisão semanal de ${WEEK}: ${loops} laços decididos, ${projects} projetos revisados, ${archived} arquivados.`;
/** The bullets of the level-2 `## Today` of a journal file. */
const today = (file: string): string[] => {
  const lines = fs.readFileSync(file, "utf8").split("\n");
  const start = lines.indexOf("## Today");
  if (start === -1) return [];
  const out: string[] = [];
  for (const line of lines.slice(start + 1)) {
    if (/^##\s/.test(line)) break;
    if (line.startsWith("- ")) out.push(line);
  }
  return out;
};
const occurrences = (file: string, text: string) => fs.readFileSync(file, "utf8").split(text).length - 1;

/**
 * C45's week at 23:30 of 2026-11-09: three decisions stored this week (close, keep, someday), one stored with week
 * 2026-11-02, one stored (a project made from a loop) and restored to none, two projects whose last review day falls
 * this week (a keep through POST /api/memory/reviews, the project made from the loop), one reviewed 2026-11-08, and two
 * files archived. The note made from the loop keeps `last_reviewed` today (AC 11: a restore deletes no note).
 */
async function weekOfC45(): Promise<void> {
  w.journal("2026-11-02", [
    "09:00 Fechar",
    "09:00 Manter",
    "09:00 Algum dia",
    "09:00 Velho",
    "09:00 Projeto",
  ]);
  const kept = proj(notes("revisado.md"), { status: "active", last_reviewed: "2026-10-01" });
  const before = proj(notes("domingo.md"), { status: "active", last_reviewed: "2026-11-08" });
  const old = MONDAY - 30 * DAY;
  w.touch(kept, old);
  w.touch(before, old);
  const [a, b] = ["a", "b"].map((n) => w.put(inbox(`${n}.md`), `# ${n}\n`));
  await w.index();

  w.at(new Date(2026, 10, 3, 10, 0).getTime());
  expect((await w.decide({ key: keyOf("velho"), action: "close" })).status).toBe(200);
  w.at(NIGHT);
  for (const [text, action] of [
    ["fechar", "close"],
    ["manter", "keep"],
    ["algum dia", "someday"],
  ])
    expect((await w.decide({ key: keyOf(text!), action })).status, text).toBe(200);
  const made = await w.decide({ key: keyOf("projeto"), action: "project" });
  expect(made.status, JSON.stringify(made.body)).toBe(200);
  expect((await w.decide({ key: keyOf("projeto"), action: "restore", previous: null })).status).toBe(200);
  const keep = await w.call("POST", "/api/memory/reviews", {
    path: kept,
    action: "keep",
    baseVersion: sha(fs.readFileSync(kept)),
  });
  expect(keep.status, JSON.stringify(keep.body)).toBe(200);
  const archived = await w.archive({ week: WEEK, paths: [a, b] });
  expect(archived.body.moved).toHaveLength(2);
  await w.index();
  expect(
    w
      .rows()
      .map((r) => r.week)
      .sort(),
  ).toEqual(["2026-11-02", WEEK, WEEK, WEEK]);
}

// ---- C45 ---------------------------------------------------------------------------------------------------------

describe("C45 finish", () => {
  it("C45 at 23:30 answers the week, now, counts { loops: 3, projects: 2, archived: 2 } and the journal bullet; the row reads back and today's journal holds the line under ## Today", async () => {
    await weekOfC45();
    expect(fs.existsSync(journalOf(WEEK))).toBe(false);
    const before = Date.now();
    const res = await w.finish({ week: WEEK });
    const after = Date.now();
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const line = LINE("23:30", 3, 2, 2);
    expect(res.body).toEqual({
      week: WEEK,
      finishedAt: res.body.finishedAt,
      counts: { loops: 3, projects: 2, archived: 2 },
      journal: { path: journalOf(WEEK), line },
    });
    expect(res.body.finishedAt).toBeGreaterThanOrEqual(before);
    expect(res.body.finishedAt).toBeLessThanOrEqual(after);
    const [row] = w.weeks();
    expect(w.weeks()).toHaveLength(1);
    expect(row).toMatchObject({ week: WEEK, finished_at: res.body.finishedAt, archived: 2 });
    expect(JSON.parse(row!.counts)).toEqual({ loops: 3, projects: 2, archived: 2 });
    expect(today(journalOf(WEEK))).toEqual([line]);
  });
});

// ---- C46 ---------------------------------------------------------------------------------------------------------

describe("C46 finish once", () => {
  it("C46 again answers the first finishedAt and the stored counts (not recomputed), adds no row and no line", async () => {
    w.at(NIGHT);
    const a = w.put(inbox("a.md"), "# a\n");
    const b = w.put(inbox("b.md"), "# b\n");
    await w.index();
    expect((await w.archive({ week: WEEK, paths: [a] })).body.moved).toHaveLength(1);
    const first = await w.finish({ week: WEEK });
    expect(first.status, JSON.stringify(first.body)).toBe(200);
    expect(first.body.counts).toEqual({ loops: 0, projects: 0, archived: 1 });
    // the week moves on after it was finished: the stored counts are what a repeat answers (G29)
    expect((await w.archive({ week: WEEK, paths: [b] })).body.moved).toHaveLength(1);
    w.at(NIGHT + 10 * 60_000);
    const again = await w.finish({ week: WEEK });
    expect(again.status, JSON.stringify(again.body)).toBe(200);
    expect(again.body).toEqual(first.body);
    expect(w.weeks()).toHaveLength(1);
    expect(occurrences(journalOf(WEEK), "Revisão semanal de")).toBe(1);
  });

  it("C46 two finish posts at once give one row, one line and the same finishedAt", async () => {
    w.at(NIGHT);
    const [x, y] = await Promise.all([w.finish({ week: WEEK }), w.finish({ week: WEEK })]);
    expect([x.status, y.status]).toEqual([200, 200]);
    expect(x.body.finishedAt).toBe(y.body.finishedAt);
    expect(x.body).toEqual(y.body);
    expect(w.weeks()).toHaveLength(1);
    expect(occurrences(journalOf(WEEK), "Revisão semanal de")).toBe(1);
  });

  it("C46 after the owner deletes the journal line by hand, a third finish writes no line (the row is the record)", async () => {
    w.at(NIGHT);
    const first = await w.finish({ week: WEEK });
    expect(first.status).toBe(200);
    const file = journalOf(WEEK);
    fs.writeFileSync(
      file,
      fs
        .readFileSync(file, "utf8")
        .split("\n")
        .filter((l) => !l.includes("Revisão semanal de"))
        .join("\n"),
    );
    const bytes = fs.readFileSync(file);
    const third = await w.finish({ week: WEEK });
    expect(third.status).toBe(200);
    expect(third.body.finishedAt).toBe(first.body.finishedAt);
    expect(fs.readFileSync(file).equals(bytes)).toBe(true);
    expect(occurrences(file, "Revisão semanal de")).toBe(0);
  });
});

// ---- C47 ---------------------------------------------------------------------------------------------------------

describe("C47 the week of finish", () => {
  it("C47 a past Monday, the next Monday and a Tuesday answer 409 week_mismatch; no week and W46 answer 400 validation; no row, the journal's bytes as they were", async () => {
    w.at(NIGHT);
    const journal = w.put(journalOf(WEEK), "# 2026-11-09\n\n## Today\n\n- 09:00 Algo\n");
    const bytes = fs.readFileSync(journal);
    for (const week of ["2026-11-02", "2026-11-16", "2026-11-10"])
      expect(code(await w.finish({ week })), week).toEqual([409, "week_mismatch"]);
    expect(code(await w.finish({}))).toEqual([400, "validation"]);
    expect(code(await w.finish({ week: "W46" }))).toEqual([400, "validation"]);
    expect(w.weeks()).toEqual([]);
    expect(fs.readFileSync(journal).equals(bytes)).toBe(true);
  });
});

// ---- C48 ---------------------------------------------------------------------------------------------------------

describe("C48 the header of the list", () => {
  it("C48 week; finishedAt null, then the finish time; counts so far by C45's rules, then the stored ones", async () => {
    await weekOfC45();
    let review = await w.review();
    expect(review.week).toBe(WEEK);
    expect(review.finishedAt).toBeNull();
    expect(review.counts).toEqual({ loops: 3, projects: 2, archived: 2 });
    const finished = await w.finish({ week: WEEK });
    expect(finished.status).toBe(200);
    // after the finish: one more decision and one more archived file do not reach the stored counts
    w.put(inbox("c.md"), "# c\n");
    w.journal("2026-11-05", ["09:00 Outro"]);
    await w.index();
    expect((await w.decide({ key: keyOf("outro"), action: "close" })).status).toBe(200);
    review = await w.review();
    expect(review.finishedAt).toBe(finished.body.finishedAt);
    expect(review.counts).toEqual({ loops: 3, projects: 2, archived: 2 });
  });

  it("C48 reviewsDue is the total of GET /api/memory/reviews?kind=due with the same context: 3 with three due notes", async () => {
    for (const n of ["a", "b", "c"])
      w.note(notes(`${n}.md`), { natureza: "opiniao", last_reviewed: "2025-01-01" }, `# ${n}\n`);
    await w.index();
    const due = await w.call("GET", "/api/memory/reviews?kind=due");
    expect(due.body.total).toBe(3);
    expect((await w.review()).reviewsDue).toBe(3);
  });

  it("C48 reviewsDue with a context: only the due notes under the context's paths and memory/notes/<id>/ count, never the look-alike folder, equal to GET /api/memory/reviews?kind=due with that context; none counts all four (round 1)", async () => {
    const root = w.indexedRoot("r");
    const app = path.join(root, "projetos", "app");
    fs.mkdirSync(app, { recursive: true });
    w.update((s) => {
      s.contexts = [{ id: "app", name: "App", paths: [app] }];
    });
    const due = (file: string) => w.note(file, { natureza: "opiniao", last_reviewed: "2025-01-01" }, "# n\n");
    due(path.join(app, "a.md"));
    due(notes("app", "b.md"));
    due(path.join(root, "projetos", "app-antigo", "c.md"));
    due(notes("d.md"));
    await w.index();
    const reviews = async (q: string) => (await w.call("GET", `/api/memory/reviews?kind=due${q}`)).body.total;
    expect(await reviews("&context=app")).toBe(2);
    expect(await reviews("")).toBe(4);
    expect((await w.review("context=app")).reviewsDue).toBe(2);
    expect((await w.review()).reviewsDue).toBe(4);
  });

  it("C48 nextReminder: Friday 16:00 on Monday, the next Friday after the finish and on Saturday unfinished, Sunday 23:00 with weekday 0 hour 23, null when off", async () => {
    const friday = new Date(2026, 10, 13, 16, 0).getTime();
    const nextFriday = new Date(2026, 10, 20, 16, 0).getTime();
    expect((await w.review()).nextReminder).toBe(friday);
    w.at(new Date(2026, 10, 14, 10, 0).getTime());
    expect((await w.review()).nextReminder).toBe(nextFriday);
    w.at(MONDAY);
    const sentinels = (await w.call("GET", "/api/settings")).body.sentinels;
    const put = async (weeklyReview: Json) => {
      const res = await w.call("PUT", "/api/settings", { sentinels: { ...sentinels, weeklyReview } });
      expect(res.status, JSON.stringify(res.body)).toBe(200);
    };
    await put({ enabled: true, weekday: 0, hour: 23 });
    expect((await w.review()).nextReminder).toBe(new Date(2026, 10, 15, 23, 0).getTime());
    await put({ enabled: false, weekday: 5, hour: 16 });
    expect((await w.review()).nextReminder).toBeNull();
    await put({ enabled: true, weekday: 5, hour: 16 });
    expect((await w.finish({ week: WEEK })).status).toBe(200);
    expect((await w.review()).nextReminder).toBe(nextFriday);
  });
});

// ---- C108 (round 1 of the verification, plan amendment 5) --------------------------------------------------------

describe("C108 finish over a hostile journal", () => {
  /** Every name under the journal folder with its bytes (a folder as "dir", a link as its target). */
  const journals = (): Record<string, string> => {
    const dir = path.join(w.memory, "journal");
    const out: Record<string, string> = {};
    const walk = (at: string) => {
      for (const e of fs.readdirSync(at, { withFileTypes: true })) {
        const full = path.join(at, e.name);
        if (e.isSymbolicLink()) out[full] = `link:${fs.readlinkSync(full)}`;
        else if (e.isDirectory()) {
          out[full] = "dir";
          walk(full);
        } else out[full] = sha(fs.readFileSync(full));
      }
    };
    if (fs.existsSync(dir)) walk(dir);
    return out;
  };
  const cases: Array<[string, number, string, () => string | null]> = [
    [
      "a link to a file outside memory/",
      403,
      "forbidden_path",
      () => {
        const outside = path.join(w.home, "fora-do-diario.md");
        fs.writeFileSync(outside, "# fora\n");
        fs.mkdirSync(path.dirname(journalOf(WEEK)), { recursive: true });
        fs.symlinkSync(outside, journalOf(WEEK));
        return outside;
      },
    ],
    [
      "a folder in its place",
      404,
      "not_a_file",
      () => {
        fs.mkdirSync(journalOf(WEEK), { recursive: true });
        return null;
      },
    ],
    [
      "a file larger than what is read of it (2 MiB + 1)",
      413,
      "file_too_large",
      () => {
        w.put(journalOf(WEEK), "x".repeat(2 * 1024 * 1024 + 1));
        return null;
      },
    ],
  ];
  for (const [name, status, error, make] of cases)
    it(`C108 today's journal as ${name}: finish answers ${status} ${error} and writes nothing (no weekly_reviews row, the journal folder and the link's target as they were)`, async () => {
      w.journal("2026-11-04", ["09:00 Um laço"]);
      await w.index();
      expect((await w.decide({ key: keyOf("um laco"), action: "close" })).status).toBe(200);
      const target = make();
      const targetBytes = target ? fs.readFileSync(target) : null;
      const before = journals();
      const res = await w.finish({ week: WEEK });
      expect(code(res)).toEqual([status, error]);
      expect(w.weeks()).toEqual([]);
      expect(journals()).toEqual(before);
      if (target) expect(fs.readFileSync(target).equals(targetBytes!)).toBe(true);
      // the next GET still reads the week as open
      expect((await w.review()).finishedAt).toBeNull();
    });
});
