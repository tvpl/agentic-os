import fs from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
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
 * S1 and S3 of .specs/features/cerebro-rituais through the routes (`app.inject` against `buildServer` over a real home):
 * `GET /api/memory/weekly-review`'s `loops` and `someday.loops`, `POST /api/memory/weekly-review/loops`, and the
 * dashboards' `openLoops` widget. Now is Monday 2026-11-09 10:00 local unless a case moves it.
 */

const DAY = 86_400_000;
const ANA = keyOf("ligar para a ana");
let w: RituaisWorld;

beforeAll(async () => {
  w = await rituaisWorld("mordomo-rituais-loops-");
});
afterAll(async () => {
  await w.close();
});
beforeEach(async () => {
  w.at(MONDAY);
  await w.reset();
});

const loopsOf = async (query = "") => (await w.review(query)).loops as { items: Json[]; total: number };
const somedayOf = async () => (await w.review()).someday.loops as Json[];
const notesFiles = (): string[] => {
  const dir = path.join(w.memory, "notes");
  return fs.existsSync(dir)
    ? (fs.readdirSync(dir, { recursive: true }) as string[]).filter((f) => f.endsWith(".md"))
    : [];
};
const versionsOf = (file: string) =>
  w.ctx.db
    .prepare("SELECT author, origin FROM memory_versions WHERE path = ? ORDER BY id")
    .all(path.relative(w.memory, file).split(path.sep).join("/")) as Json[];
async function project(name: string, body = "# App\n\n"): Promise<{ file: string; version: string }> {
  const file = w.note(
    path.join(w.memory, "notes", `${name}.md`),
    { type: "project", status: "active" },
    body,
  );
  await w.index();
  return { file, version: sha(fs.readFileSync(file)) };
}
/** A dashboard with one `openLoops` list, refreshed: its data. */
async function openLoopsWidget(): Promise<{ items: Json[]; total: number }> {
  let res = await w.call("POST", "/api/dashboards", { template: "overview" });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  const id = res.body.id as string;
  const put = await w.call("PUT", `/api/dashboards/${id}`, {
    definition: {
      v: 1,
      title: `Laços ${id}`,
      kind: "overview",
      refresh: "manual",
      widgets: [
        {
          id: "lacos",
          kind: "list",
          title: "Laços",
          source: { kind: "openLoops", window: "week" },
          options: { limit: 50 },
        },
      ],
    },
    baseVersion: res.body.version,
  });
  expect(put.status, JSON.stringify(put.body)).toBe(200);
  res = await w.call("POST", `/api/dashboards/${id}/refresh`, {});
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return res.body.snapshot.widgets.find((x: Json) => x.id === "lacos").data;
}

// ---- C1 ----------------------------------------------------------------------------------------------------------

describe("C1 the open loops of the journal window and MEMORY.md", () => {
  it("C1 one journal loop on line 12 is one item, with its key, day, age and place; one loop gives items 1 and total 1", async () => {
    // lines 1-11: the title, a blank, ## Today, a bullet, ## Decisions with its bullet, ## Open loops and a blank
    const file = w.journal(
      "2026-11-04",
      ["09:15 Ligar para a Ana"],
      "## Today\n\n- 08:00 café\n\n## Decisions\n\n- 09:00 Decidi algo\n",
    );
    expect(fs.readFileSync(file, "utf8").split("\n")[11]).toBe("- 09:15 Ligar para a Ana");
    await w.index();
    const loops = await loopsOf();
    expect(loops.items).toEqual([
      {
        key: ANA,
        text: "Ligar para a Ana",
        day: "2026-11-04",
        ageDays: 5,
        sources: [{ path: file, line: 12 }],
      },
    ]);
    expect(loops.total).toBe(1);
  });

  it("C1 a ### Open loops bullet, a ## Decisions bullet and a note's ## Open loops are not listed; items come oldest day first", async () => {
    w.journal("2026-11-06", ["10:00 Segundo laço"], "## Decisions\n\n- 09:00 Uma decisão\n\n");
    w.journal("2026-11-02", ["10:00 Primeiro laço"]);
    w.put(
      path.join(w.memory, "journal", "2026-11-05.md"),
      "# 2026-11-05\n\n## Today\n\n### Open loops\n\n- 10:00 Sub laço\n",
    );
    w.put(path.join(w.memory, "notes", "x.md"), "# X\n\n## Open loops\n\n- Laço de nota\n");
    await w.index();
    const loops = await loopsOf();
    expect(loops.items.map((i) => i.text)).toEqual(["Primeiro laço", "Segundo laço"]);
    expect(loops.items.map((i) => i.day)).toEqual(["2026-11-02", "2026-11-06"]);
    expect(loops.total).toBe(2);
  });
});

// ---- C3 ----------------------------------------------------------------------------------------------------------

describe("C3 the cut of loops", () => {
  const days = (n: number) =>
    Array.from({ length: n }, (_, i) => {
      const d = new Date(2026, 7, 20 + i);
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    });
  const write = (n: number) =>
    days(n).forEach((day, i) => w.journal(day, [`10:00 Laço ${String(i).padStart(2, "0")}`]));

  it("C3 exactly 50 loops: items 50 and total 50", async () => {
    write(50);
    await w.index();
    const loops = await loopsOf();
    expect([loops.items.length, loops.total]).toEqual([50, 50]);
  });

  it("C3 51 loops: the 50 oldest (the newest absent) and total 51; with maxItems 3, the 3 oldest and total 51", async () => {
    write(51);
    await w.index();
    let loops = await loopsOf();
    expect([loops.items.length, loops.total]).toEqual([50, 51]);
    expect(loops.items.map((i) => i.text)).toEqual(
      Array.from({ length: 50 }, (_, i) => `Laço ${String(i).padStart(2, "0")}`),
    );
    expect(loops.items.some((i) => i.text === "Laço 50")).toBe(false);
    const put = await w.call("PUT", "/api/settings", { memory: { weeklyReview: { maxItems: 3 } } });
    expect(put.status, JSON.stringify(put.body)).toBe(200);
    try {
      loops = await loopsOf();
      expect(loops.items.map((i) => i.text)).toEqual(["Laço 00", "Laço 01", "Laço 02"]);
      expect(loops.total).toBe(51);
    } finally {
      await w.call("PUT", "/api/settings", { memory: { weeklyReview: { maxItems: 50 } } });
    }
  });

  it("C3 no loop: items [] and total 0", async () => {
    await w.index();
    expect(await loopsOf()).toEqual({ items: [], total: 0 });
  });
});

// ---- C4, C5 ------------------------------------------------------------------------------------------------------

describe("C4 one loop per normalized text", () => {
  it("C4 three spellings on three journal days are one item whose text is the oldest occurrence as written", async () => {
    w.journal("2026-11-02", ["10:00 Ligar  para\ta Ana"]);
    w.journal("2026-11-04", ["10:00 LIGAR PARA A ANA"]);
    w.journal("2026-11-06", ["10:00   Ligar para a Ana  "]);
    await w.index();
    const loops = await loopsOf();
    expect(loops.total).toBe(1);
    expect(loops.items[0]).toMatchObject({ key: ANA, text: "Ligar  para\ta Ana", day: "2026-11-02" });
    expect(loops.items[0]!.sources).toHaveLength(3);
  });
});

describe("C5 the journal and MEMORY.md", () => {
  it("C5 the same loop on three days and in MEMORY.md (journal 2026-10-30) is one item of day 2026-10-30 with four places, oldest first; a MEMORY.md line older than the window is listed", async () => {
    const j2 = w.journal("2026-11-02", ["10:00 Ligar para a Ana"]);
    const j4 = w.journal("2026-11-04", ["10:00 Ligar para a Ana"]);
    const j6 = w.journal("2026-11-06", ["10:00 Ligar para a Ana"]);
    const mem = w.memoryMd([
      "Ligar para a Ana (journal 2026-10-30)",
      "Renovar o passaporte (journal 2026-01-05)",
    ]);
    await w.index();
    const loops = await loopsOf();
    expect(loops.items).toEqual([
      {
        key: keyOf("renovar o passaporte"),
        text: "Renovar o passaporte",
        day: "2026-01-05",
        ageDays: 308,
        sources: [{ path: mem, line: 10 }],
      },
      {
        key: ANA,
        text: "Ligar para a Ana",
        day: "2026-10-30",
        ageDays: 10,
        sources: [
          { path: mem, line: 9 },
          { path: j2, line: 5 },
          { path: j4, line: 5 },
          { path: j6, line: 5 },
        ],
      },
    ]);
  });
});

// ---- C7, C8 ------------------------------------------------------------------------------------------------------

describe("C7 close", () => {
  it("C7 close answers closed with previous null, stores the row, writes no file, leaves both lists and the openLoops widget", async () => {
    w.journal("2026-11-09", ["09:00 Ligar para a Ana", "09:30 Pagar a conta"]);
    await w.index();
    expect((await openLoopsWidget()).total).toBe(2);
    const before = w.homeHash();
    vi.useFakeTimers({ toFake: ["Date"], now: MONDAY + 5_000 });
    let res: { status: number; body: Json };
    try {
      res = await w.decide({ key: ANA, action: "close" });
    } finally {
      vi.useRealTimers();
    }
    expect([res.status, res.body]).toEqual([200, { key: ANA, state: "closed", previous: null }]);
    expect(w.rows()).toEqual([
      {
        key: ANA,
        text: "Ligar para a Ana",
        action: "closed",
        week: "2026-11-09",
        target: null,
        decided_at: MONDAY + 5_000,
      },
    ]);
    expect(w.homeHash()).toBe(before);
    const review = await w.review();
    expect(review.loops.items.map((i: Json) => i.key)).toEqual([keyOf("pagar a conta")]);
    expect(review.someday.loops).toEqual([]);
    const widget = await openLoopsWidget();
    expect(widget.total).toBe(1);
    expect(widget.items.map((i) => i.text)).toEqual(["Pagar a conta"]);
  });
});

describe("C8 the openLoops widget by stored state", () => {
  it("C8 closed, project, task and someday are neither listed nor counted; keep this week and undecided are; the rest of the widget as before", async () => {
    const app = await project("app");
    w.journal("2026-11-02", ["09:00 Laço da semana passada"]);
    w.journal("2026-11-09", [
      "09:00 Fechado",
      "09:01 Projeto",
      "09:02 Tarefa",
      "09:03 Algum dia",
      "09:04 Mantido",
      "09:05 Sem decisão",
    ]);
    w.journal("2026-11-10", ["09:00 Do dia dez"]);
    w.memoryMd([
      "Da memória (journal 2026-11-11)",
      "Sem decisão (journal 2026-11-09)",
      "Sem data na memória",
    ]);
    await w.index();
    for (const [text, body] of [
      ["fechado", { action: "close" }],
      ["projeto", { action: "project" }],
      ["tarefa", { action: "task", project: app.file, baseVersion: app.version }],
      ["algum dia", { action: "someday" }],
      ["mantido", { action: "keep" }],
    ] as const) {
      const res = await w.decide({ key: keyOf(text), ...body });
      expect(res.status, `${text} ${JSON.stringify(res.body)}`).toBe(200);
    }
    const widget = await openLoopsWidget();
    expect(widget.items.map((i) => [i.text, i.day, i.from, i.natureza])).toEqual([
      ["Da memória", "2026-11-11", "memory", "plano"],
      ["Do dia dez", "2026-11-10", "journal", "plano"],
      ["Mantido", "2026-11-09", "journal", "plano"],
      ["Sem decisão", "2026-11-09", "journal", "plano"],
    ]);
    expect(widget.total).toBe(4);
  });
});

// ---- C10 ---------------------------------------------------------------------------------------------------------

describe("C10 someday", () => {
  it("C10 someday leaves loops for someday.loops with C1's fields, still there a week later, and with its stored text, sources [] and the week as day once its journal day left the window", async () => {
    const recent = w.journal("2026-11-04", ["09:15 Ligar para a Ana"]);
    w.journal("2026-08-12", ["09:15 Aprender piano"]);
    await w.index();
    expect((await w.decide({ key: ANA, action: "someday" })).status).toBe(200);
    expect((await w.decide({ key: keyOf("aprender piano"), action: "someday" })).status).toBe(200);
    let review = await w.review();
    expect(review.loops.items).toEqual([]);
    expect(review.someday.loops).toEqual([
      {
        key: keyOf("aprender piano"),
        text: "Aprender piano",
        day: "2026-08-12",
        ageDays: 89,
        sources: [{ path: path.join(w.memory, "journal", "2026-08-12.md"), line: 5 }],
      },
      {
        key: ANA,
        text: "Ligar para a Ana",
        day: "2026-11-04",
        ageDays: 5,
        sources: [{ path: recent, line: 5 }],
      },
    ]);
    w.at(MONDAY + 7 * DAY);
    review = await w.review();
    expect(review.loops.items).toEqual([]);
    expect(review.someday.loops).toEqual([
      {
        key: ANA,
        text: "Ligar para a Ana",
        day: "2026-11-04",
        ageDays: 12,
        sources: [{ path: recent, line: 5 }],
      },
      { key: keyOf("aprender piano"), text: "Aprender piano", day: "2026-11-09", ageDays: 7, sources: [] },
    ]);
  });
});

// ---- C11, C12 ----------------------------------------------------------------------------------------------------

describe("C11 project", () => {
  const long = `Organizar ${"a".repeat(120)}`; // 130 characters
  it("C11 with no name: a note under memory/notes/ titled by the first 120 characters, its front matter read back, created = { path, version }, the row, one create version by the owner", async () => {
    expect([...long].length).toBe(130);
    w.journal("2026-11-04", [`09:15 ${long}`]);
    await w.index();
    const before = notesFiles();
    const res = await w.decide({ key: keyOf(long.toLowerCase()), action: "project" });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const file = res.body.created.path as string;
    expect(path.dirname(file)).toBe(path.join(w.memory, "notes"));
    const bytes = fs.readFileSync(file);
    expect(res.body.created).toEqual({ path: file, version: sha(bytes) });
    const text = bytes.toString("utf8");
    const head = text.split("---")[1]!.split("\n");
    expect(head).toContain(`title: ${JSON.stringify(long.slice(0, 120))}`);
    for (const line of ["type: project", "status: active", "natureza: plano", "last_reviewed: 2026-11-09"])
      expect(head).toContain(line);
    expect(text).toContain(`# ${long.slice(0, 120)}\n`);
    expect(notesFiles()).toHaveLength(before.length + 1);
    expect(w.rows()).toEqual([
      expect.objectContaining({ key: keyOf(long.toLowerCase()), action: "project", target: file }),
    ]);
    expect(versionsOf(file)).toEqual([{ author: "owner", origin: "create" }]);
  });

  it("C11 with name the title is that name; with context proj-x the note is under memory/notes/proj-x/", async () => {
    const dir = w.outside("ctx");
    w.update((s) => {
      s.contexts = [
        ...s.contexts.filter((c) => c.id !== "proj-x"),
        { id: "proj-x", name: "Projeto X", paths: [dir] },
      ];
    });
    w.journal("2026-11-04", ["09:15 Ligar para a Ana", "09:16 Pagar a conta"]);
    await w.index();
    const named = await w.decide({ key: ANA, action: "project", name: "Curso de Março" });
    expect(named.status).toBe(200);
    expect(fs.readFileSync(named.body.created.path, "utf8")).toContain('title: "Curso de Março"');
    const inContext = await w.decide({ key: keyOf("pagar a conta"), action: "project", context: "proj-x" });
    expect(inContext.status, JSON.stringify(inContext.body)).toBe(200);
    expect(path.dirname(inContext.body.created.path)).toBe(path.join(w.memory, "notes", "proj-x"));
  });
});

describe("C12 project again", () => {
  it("C12 project again answers the same path and makes no second note; another name renames nothing", async () => {
    w.journal("2026-11-04", ["09:15 Ligar para a Ana"]);
    await w.index();
    const before = notesFiles().length;
    const first = await w.decide({ key: ANA, action: "project" });
    const again = await w.decide({ key: ANA, action: "project" });
    const renamed = await w.decide({ key: ANA, action: "project", name: "Outro nome" });
    expect([first.status, again.status, renamed.status]).toEqual([200, 200, 200]);
    expect(again.body.created.path).toBe(first.body.created.path);
    expect(renamed.body.created.path).toBe(first.body.created.path);
    expect(notesFiles()).toHaveLength(before + 1);
    expect(fs.readFileSync(first.body.created.path, "utf8")).toContain('title: "Ligar para a Ana"');
  });

  it("C12 two identical posts sent together each answer 200 with one path: one note and one row", async () => {
    w.journal("2026-11-04", ["09:15 Ligar para a Ana"]);
    await w.index();
    const before = notesFiles().length;
    const [a, b] = await Promise.all([
      w.decide({ key: ANA, action: "project" }),
      w.decide({ key: ANA, action: "project" }),
    ]);
    expect([a.status, b.status]).toEqual([200, 200]);
    expect(a.body.created.path).toBe(b.body.created.path);
    expect(notesFiles()).toHaveLength(before + 1);
    expect(w.rows()).toHaveLength(1);
  });
});

// ---- C13 ---------------------------------------------------------------------------------------------------------

describe("C13 task", () => {
  it("C13 task appends the loop as a task of the project by door 3, stores the row, answers the new version, and the loop leaves loops", async () => {
    const app = await project("app");
    const old = fs.readFileSync(app.file);
    w.journal("2026-11-04", ["09:15 Ligar para a Ana"]);
    await w.index();
    const res = await w.decide({ key: ANA, action: "task", project: app.file, baseVersion: app.version });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const bytes = fs.readFileSync(app.file);
    expect(bytes.toString("utf8")).toBe(`${old.toString("utf8")}- [ ] Ligar para a Ana\n`);
    expect(res.body).toMatchObject({
      key: ANA,
      state: "task",
      created: { path: app.file, version: sha(bytes) },
    });
    expect(w.rows()).toEqual([expect.objectContaining({ key: ANA, action: "task", target: app.file })]);
    expect((await loopsOf()).items).toEqual([]);
  });

  it("C13 a loop of 340 characters appends its first 300", async () => {
    const app = await project("app");
    const old = fs.readFileSync(app.file, "utf8");
    const long = `Revisar ${"b".repeat(332)}`;
    expect([...long].length).toBe(340);
    w.journal("2026-11-04", [`09:15 ${long}`]);
    await w.index();
    const res = await w.decide({
      key: keyOf(long.toLowerCase()),
      action: "task",
      project: app.file,
      baseVersion: app.version,
    });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(fs.readFileSync(app.file, "utf8")).toBe(`${old}- [ ] ${long.slice(0, 300)}\n`);
  });
});

// ---- C14 ---------------------------------------------------------------------------------------------------------

describe("C14 restore", () => {
  it("C14 after close on an undecided key, restore with previous null deletes the row and lists the loop again, writing no file", async () => {
    w.journal("2026-11-04", ["09:15 Ligar para a Ana"]);
    await w.index();
    const closed = await w.decide({ key: ANA, action: "close" });
    expect(closed.body.previous).toBeNull();
    const before = w.homeHash();
    const res = await w.decide({ key: ANA, action: "restore", previous: closed.body.previous });
    expect([res.status, res.body.state]).toEqual([200, null]);
    expect(w.rows()).toEqual([]);
    expect((await loopsOf()).items.map((i) => i.key)).toEqual([ANA]);
    expect(w.homeHash()).toBe(before);
  });

  it("C14 after close on a someday key, restore with the previous close answered puts the row back exactly and the loop in someday.loops", async () => {
    w.journal("2026-11-04", ["09:15 Ligar para a Ana"]);
    await w.index();
    await w.decide({ key: ANA, action: "someday" });
    const stored = w.rows()[0]!;
    w.at(MONDAY + 60_000);
    const closed = await w.decide({ key: ANA, action: "close" });
    expect(closed.body.previous).toEqual({
      action: "someday",
      week: "2026-11-09",
      target: null,
      decidedAt: stored.decided_at,
    });
    const before = w.homeHash();
    const res = await w.decide({ key: ANA, action: "restore", previous: closed.body.previous });
    expect([res.status, res.body.state]).toEqual([200, "someday"]);
    expect(w.rows()).toEqual([stored]);
    expect((await somedayOf()).map((i) => i.key)).toEqual([ANA]);
    expect(w.homeHash()).toBe(before);
  });

  it("C14 after project, restore deletes the row and lists the loop, and the note stays byte for byte", async () => {
    w.journal("2026-11-04", ["09:15 Ligar para a Ana"]);
    await w.index();
    const made = await w.decide({ key: ANA, action: "project" });
    const bytes = fs.readFileSync(made.body.created.path);
    const res = await w.decide({ key: ANA, action: "restore", previous: made.body.previous });
    expect(res.status).toBe(200);
    expect(w.rows()).toEqual([]);
    expect((await loopsOf()).items.map((i) => i.key)).toEqual([ANA]);
    expect(fs.readFileSync(made.body.created.path).equals(bytes)).toBe(true);
  });

  it("C14 after task, restore keeps the appended line", async () => {
    const app = await project("app");
    w.journal("2026-11-04", ["09:15 Ligar para a Ana"]);
    await w.index();
    const task = await w.decide({ key: ANA, action: "task", project: app.file, baseVersion: app.version });
    const bytes = fs.readFileSync(app.file);
    const res = await w.decide({ key: ANA, action: "restore", previous: task.body.previous });
    expect(res.status).toBe(200);
    expect(w.rows()).toEqual([]);
    expect(fs.readFileSync(app.file).equals(bytes)).toBe(true);
    expect(bytes.toString("utf8")).toContain("- [ ] Ligar para a Ana\n");
  });
});

// ---- C15, C16, C17 -----------------------------------------------------------------------------------------------

describe("C15 loop_not_found", () => {
  it("C15 64 hex digits of no loop and the key of a note's ## Open loops bullet answer 404 loop_not_found and store nothing", async () => {
    w.put(path.join(w.memory, "notes", "x.md"), "# X\n\n## Open loops\n\n- Laço de nota\n");
    w.journal("2026-11-04", ["09:15 Ligar para a Ana"]);
    await w.index();
    for (const key of ["0".repeat(64), keyOf("laço de nota".normalize("NFD").replace(/\p{M}/gu, ""))]) {
      expect(code(await w.decide({ key, action: "close" })), key).toEqual([404, "loop_not_found"]);
    }
    expect(w.rows()).toEqual([]);
  });

  it("C15 a key whose row exists (closed, listed nowhere) is accepted by a repeated close and by restore", async () => {
    w.journal("2026-11-04", ["09:15 Ligar para a Ana"]);
    await w.index();
    await w.decide({ key: ANA, action: "close" });
    expect((await w.decide({ key: ANA, action: "close" })).status).toBe(200);
    expect((await w.decide({ key: ANA, action: "restore", previous: null })).status).toBe(200);
  });
});

describe("C16 refused bodies", () => {
  const cases: Array<[string, Json]> = [
    ["action delete", { key: ANA, action: "delete" }],
    ["no key", { action: "close" }],
    ["name of 121 characters", { key: ANA, action: "project", name: "n".repeat(121) }],
    ["name empty", { key: ANA, action: "project", name: "" }],
    ["task without project", { key: ANA, action: "task", baseVersion: `sha256:${"0".repeat(64)}` }],
    ["task without baseVersion", { key: ANA, action: "task", project: "notes/app.md" }],
    ["restore without previous", { key: ANA, action: "restore" }],
    [
      "restore with previous.action deleted",
      {
        key: ANA,
        action: "restore",
        previous: { action: "deleted", week: "2026-11-09", target: null, decidedAt: 1 },
      },
    ],
  ];
  for (const [name, body] of cases)
    it(`C16 ${name} answers 400 validation and stores nothing`, async () => {
      w.journal("2026-11-04", ["09:15 Ligar para a Ana"]);
      await w.index();
      const before = notesFiles().length;
      expect(code(await w.decide(body))).toEqual([400, "validation"]);
      expect(w.rows()).toEqual([]);
      expect(notesFiles()).toHaveLength(before);
    });

  it("C16 a name of exactly 120 characters is accepted", async () => {
    w.journal("2026-11-04", ["09:15 Ligar para a Ana"]);
    await w.index();
    const res = await w.decide({ key: ANA, action: "project", name: "n".repeat(120) });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
  });
});

describe("C17 task refusals", () => {
  async function refused(target: string, baseVersion: string, want: [number, string]) {
    w.journal("2026-11-04", ["09:15 Ligar para a Ana"]);
    await w.index();
    const bytes = fs.readFileSync(target);
    expect(code(await w.decide({ key: ANA, action: "task", project: target, baseVersion })), target).toEqual(
      want,
    );
    expect(w.rows()).toEqual([]);
    expect(fs.readFileSync(target).equals(bytes)).toBe(true);
  }
  it("C17 a type: project note of an indexed folder outside memory/ answers 403 note_not_editable", async () => {
    const root = w.indexedRoot("fora");
    const file = w.note(path.join(root, "proj.md"), { type: "project", status: "active" });
    await refused(file, sha(fs.readFileSync(file)), [403, "note_not_editable"]);
  });
  it("C17 memory/journal/2026-11-09.md answers 403 note_not_editable", async () => {
    const file = w.journal("2026-11-09", ["09:00 Outro"]);
    await refused(file, sha(fs.readFileSync(file)), [403, "note_not_editable"]);
  });
  it("C17 a type: status note answers 403 note_not_editable", async () => {
    const file = w.note(path.join(w.memory, "notes", "status.md"), { type: "status" });
    await refused(file, sha(fs.readFileSync(file)), [403, "note_not_editable"]);
  });
  it("C17 a type: projects note (the look-alike value) answers 403 note_not_editable", async () => {
    const file = w.note(path.join(w.memory, "notes", "projects.md"), { type: "projects" });
    await refused(file, sha(fs.readFileSync(file)), [403, "note_not_editable"]);
  });
  it("C17 a stale baseVersion answers 409 edit_conflict", async () => {
    const app = await project("app");
    await refused(app.file, sha("antes"), [409, "edit_conflict"]);
  });
});

// ---- C18 ---------------------------------------------------------------------------------------------------------

describe("C18 the same decision twice", () => {
  for (const [action, state] of [
    ["close", "closed"],
    ["keep", "keep"],
    ["someday", "someday"],
  ] as const)
    it(`C18 ${action} twice: one row, the same state, the second previous is the first row, and decided_at is the first's`, async () => {
      w.journal("2026-11-04", ["09:15 Ligar para a Ana"]);
      await w.index();
      const first = await w.decide({ key: ANA, action });
      const stored = w.rows()[0]!;
      w.at(MONDAY + 3_600_000);
      const second = await w.decide({ key: ANA, action });
      expect([first.body.state, second.body.state]).toEqual([state, state]);
      expect(second.body.previous).toEqual({
        action: state,
        week: stored.week,
        target: null,
        decidedAt: stored.decided_at,
      });
      expect(w.rows()).toEqual([stored]);
    });

  it("C18 two close posts sent together give one row", async () => {
    w.journal("2026-11-04", ["09:15 Ligar para a Ana"]);
    await w.index();
    const answers = await Promise.all([
      w.decide({ key: ANA, action: "close" }),
      w.decide({ key: ANA, action: "close" }),
    ]);
    expect(answers.map((a) => a.status)).toEqual([200, 200]);
    expect(w.rows()).toHaveLength(1);
  });

  it("C18 keep stored last week and keep again this week updates week to 2026-11-09", async () => {
    w.journal("2026-11-04", ["09:15 Ligar para a Ana"]);
    await w.index();
    w.at(MONDAY - 7 * DAY);
    w.journal("2026-11-02", ["09:15 Ligar para a Ana"]);
    await w.index();
    expect((await w.decide({ key: ANA, action: "keep" })).status).toBe(200);
    expect(w.rows()[0]).toMatchObject({ action: "keep", week: "2026-11-02" });
    w.at(MONDAY);
    expect((await w.decide({ key: ANA, action: "keep" })).status).toBe(200);
    expect(w.rows()).toEqual([expect.objectContaining({ action: "keep", week: "2026-11-09" })]);
  });
});

// ---- C33 ---------------------------------------------------------------------------------------------------------

describe("C33 a someday loop takes close, project and task", () => {
  for (const action of ["close", "project", "task"] as const)
    it(`C33 ${action} on a loop of someday.loops takes it out of someday.loops`, async () => {
      const app = await project("app");
      w.journal("2026-11-04", ["09:15 Ligar para a Ana"]);
      await w.index();
      await w.decide({ key: ANA, action: "someday" });
      const review = await w.review();
      expect(review.someday.loops.map((i: Json) => i.key)).toEqual([ANA]);
      expect(review.loops.items).toEqual([]);
      const body: Json = action === "task" ? { project: app.file, baseVersion: app.version } : {};
      const res = await w.decide({ key: ANA, action, ...body });
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      expect(await somedayOf()).toEqual([]);
    });
});
