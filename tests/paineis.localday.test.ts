// The local day, the local week and the local time of the dashboards (AD-043 b, L-053): a zone away from UTC, at an hour
// where the local day and the UTC day differ, tells one from the other. Set before any date is built.
process.env.TZ = "America/Sao_Paulo";

import fs from "node:fs";
import path from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type * as client from "../core/src/connectors/client.js";
import { refreshDue } from "../core/src/dashboards/schedule.js";
import * as safeFs from "../core/src/security/safeFs.js";
import { movingClock } from "./helpers/movingClock.js";
import {
  calendarItems,
  fakeConnectorFetch,
  paineisWorld,
  questionWorld,
  type Json,
  type PaineisWorld,
} from "./helpers/paineisWorld.js";

/**
 * .specs/features/cerebro-paineis, batch A, the claims that name a local day, week or time, in São Paulo: 23:30 of
 * Friday 2026-10-30 there is 02:30 of 2026-10-31 in UTC. The `daily@` rule at its layer; the archive's name, the tasks
 * of today and of the week, the decisions and open loops of the week and a project's health through the routes
 * (`app.inject` against `buildServer`).
 */

vi.mock("../core/src/connectors/client.js", async (importOriginal) => {
  const actual = await importOriginal<typeof client>();
  return { ...actual, fetchConnectorData: vi.fn(actual.fetchConnectorData) };
});
vi.mock("../core/src/security/safeFs.js", async (importOriginal) => {
  const actual = await importOriginal<typeof safeFs>();
  return {
    ...actual,
    readWorkspaceText: vi.fn(actual.readWorkspaceText),
    readWorkspaceFile: vi.fn(actual.readWorkspaceFile),
  };
});

const NOW = new Date(2026, 9, 30, 23, 30).getTime();

let clock: ReturnType<typeof movingClock>;
let seq = 0;

beforeAll(() => {
  clock = movingClock(NOW);
  fakeConnectorFetch(calendarItems(NOW));
});
afterAll(() => {
  clock.restore();
});
afterEach(() => {
  vi.useRealTimers();
  clock.set(NOW);
});

describe("the local day and the UTC day differ here", () => {
  it("C10 C15 C25 C26 C27 C28 C44 C57 the zone is pinned: 23:30 of 2026-10-30 local is 2026-10-31 in UTC", () => {
    expect(process.env.TZ).toBe("America/Sao_Paulo");
    expect(new Date(NOW).getDate()).toBe(30);
    expect(new Date(NOW).toISOString().slice(0, 10)).toBe("2026-10-31");
  });
});

async function fresh<T>(fn: (world: PaineisWorld) => Promise<T>): Promise<T> {
  const world = await paineisWorld(`mordomo-paineis-localday-${++seq}-`);
  try {
    return await fn(world);
  } finally {
    await world.close();
  }
}

/** A dashboard whose widgets are `widgets`, refreshed now; the answer's widgets by id. */
async function evaluate(world: PaineisWorld, widgets: Json[]): Promise<Record<string, Json>> {
  const id = `teste-${++seq}`;
  let res = await world.create({ template: "overview" });
  const put = await world.call("PUT", `/api/dashboards/${res.body.id}`, {
    definition: { v: 1, title: id, kind: "overview", refresh: "manual", widgets },
    baseVersion: res.body.version,
  });
  expect(put.status, JSON.stringify(put.body)).toBe(200);
  res = await world.refresh(res.body.id);
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return Object.fromEntries(res.body.snapshot.widgets.map((x: Json) => [x.id, x]));
}

// ---- C10: daily@HH:MM --------------------------------------------------------------------------------------------

describe("C10 daily@08:30 in the pinned zone", () => {
  const at = (day: number, h: number, m: number) => new Date(2026, 9, day, h, m).getTime();
  const def = { kind: "overview" as const, refresh: "daily@08:30" };
  const cases: Array<[string, number, number, boolean]> = [
    ["at 08:29 local with yesterday's snapshot", at(29, 8, 31), at(30, 8, 29), false],
    ["at 08:30 local with yesterday's snapshot", at(29, 8, 31), at(30, 8, 30), true],
    ["at 09:10 with a snapshot of 08:31 the same local day", at(30, 8, 31), at(30, 9, 10), false],
    ["at 08:30 of the next local day", at(30, 8, 31), at(31, 8, 30), true],
  ];
  for (const [name, snapshot, now, due] of cases) {
    it(`C10 ${name} → ${due ? "due" : "not due"}`, () => {
      expect(refreshDue(def, snapshot, now)).toBe(due);
    });
  }
});

// ---- C15: the archive ----------------------------------------------------------------------------------------------

describe("C15 archiving a dashboard", () => {
  it("C15 at 23:30 local of 2026-10-30 DELETE moves the file to memory/archive/dashboards/visao-geral-2026-10-30.json and its rows go; again the same day is -2; a missing one is 404", async () => {
    await fresh(async (world) => {
      const created = await world.create({ template: "overview" });
      const definition = {
        ...created.body.definition,
        widgets: [
          {
            id: "agentes",
            kind: "kpi",
            title: "Agentes",
            source: { kind: "runs" },
            options: { measure: "count" },
          },
        ],
      };
      const put = await world.call("PUT", "/api/dashboards/visao-geral", {
        definition,
        baseVersion: created.body.version,
      });
      expect(put.status).toBe(200);
      for (const hour of [21, 22, 23]) {
        vi.useFakeTimers({ toFake: ["Date"], now: new Date(2026, 9, 30, hour, 30).getTime() });
        expect((await world.refresh("visao-geral")).status).toBe(200);
        vi.useRealTimers();
      }
      const count = (table: string) =>
        (
          world.ctx.db
            .prepare(`SELECT COUNT(*) c FROM ${table} WHERE dashboard_id = 'visao-geral'`)
            .get() as { c: number }
        ).c;
      expect([count("dashboard_snapshots"), count("dashboard_series")]).toEqual([1, 3]);
      const file = path.join(world.memory, "dashboards", "visao-geral.json");
      const bytes = fs.readFileSync(file);

      clock.set(NOW);
      const res = await world.call("DELETE", "/api/dashboards/visao-geral");
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      expect(
        res.body.archived.endsWith(
          path.join("memory", "archive", "dashboards", "visao-geral-2026-10-30.json"),
        ),
      ).toBe(true);
      expect(fs.readFileSync(res.body.archived)).toEqual(bytes);
      expect(fs.existsSync(file)).toBe(false);
      const got = await world.get("visao-geral");
      expect(got.status).toBe(404);
      expect(got.body.error.code).toBe("dashboard_not_found");
      expect([count("dashboard_snapshots"), count("dashboard_series")]).toEqual([0, 0]);

      expect((await world.create({ template: "overview" })).body.id).toBe("visao-geral");
      const again = await world.call("DELETE", "/api/dashboards/visao-geral");
      expect(again.status).toBe(200);
      expect(
        again.body.archived.endsWith(
          path.join("memory", "archive", "dashboards", "visao-geral-2026-10-30-2.json"),
        ),
      ).toBe(true);

      const none = await world.call("DELETE", "/api/dashboards/nao-existe");
      expect(none.status).toBe(404);
      expect(none.body.error.code).toBe("dashboard_not_found");
    });
  });
});

// ---- C25: the tasks of today and of the week ----------------------------------------------------------------------

describe("C25 the tasks of today", () => {
  const TASKS = [
    { key: "dueTwentyNine", file: "a.md", line: "- [ ] Vencida ontem 📅 2026-10-29" },
    { key: "dueTwentyEightHigh", file: "a.md", line: "- [ ] Vencida antes ⏫ 📅 2026-10-28" },
    { key: "todayLow", file: "b.md", line: "- [ ] Hoje baixa 📅 2026-10-30" },
    { key: "todayHigh", file: "b.md", line: "- [ ] Hoje alta 📅 2026-10-30 ⏫" },
    { key: "todayLowSecond", file: "b.md", line: "- [ ] Hoje baixa segunda 📅 2026-10-30" },
    { key: "todayOtherFile", file: "c.md", line: "- [ ] Hoje noutra nota 📅 2026-10-30" },
    { key: "doneToday", file: "c.md", line: "- [x] Feita hoje 📅 2026-10-30" },
    { key: "noDue", file: "c.md", line: "- [ ] Sem prazo" },
    { key: "tomorrow", file: "c.md", line: "- [ ] Amanhã 📅 2026-10-31" },
    { key: "fifth", file: "c.md", line: "- [ ] Dia cinco 📅 2026-11-05" },
    { key: "sixth", file: "c.md", line: "- [ ] Dia seis 📅 2026-11-06" },
  ];

  it("C25 today: open tasks due today and overdue, overdue first, then priority, due, path and line, each with its note; week adds up to 2026-11-05; at 23:30 local a task of 2026-10-30 is not overdue", async () => {
    await fresh(async (world) => {
      const dir = path.join(world.memory, "notes", "c25");
      const files: Record<string, string> = {};
      for (const name of ["a.md", "b.md", "c.md"]) {
        const lines = TASKS.filter((t) => t.file === name).map((t) => t.line);
        files[name] = world.note(
          path.join(dir, name),
          name === "a.md" ? { natureza: "plano" } : {},
          `# Nota ${name}\n\n${lines.join("\n")}\n`,
        );
      }
      await world.index();
      const lineOf = (key: string) => {
        const t = TASKS.find((x) => x.key === key)!;
        return fs.readFileSync(files[t.file]!, "utf8").split("\n").indexOf(t.line) + 1;
      };
      const fileId = (file: string) =>
        (world.ctx.db.prepare("SELECT id FROM files WHERE path = ?").get(file) as { id: number }).id;
      const got = await evaluate(world, [
        {
          id: "hoje",
          kind: "checklist",
          title: "Hoje",
          source: { kind: "tasks", window: "today" },
          options: { limit: 50 },
        },
        {
          id: "semana",
          kind: "checklist",
          title: "Semana",
          source: { kind: "tasks", window: "week" },
          options: { limit: 50 },
        },
      ]);
      const today = got.hoje!.data.items as Json[];
      const order = [
        "dueTwentyEightHigh",
        "dueTwentyNine",
        "todayHigh",
        "todayLow",
        "todayLowSecond",
        "todayOtherFile",
      ];
      expect(today.map((i) => [i.path, i.line])).toEqual(
        order.map((key) => [files[TASKS.find((t) => t.key === key)!.file]!, lineOf(key)]),
      );
      const first = today[0]!;
      expect(first).toMatchObject({
        path: files["a.md"],
        line: lineOf("dueTwentyEightHigh"),
        fileId: fileId(files["a.md"]!),
        due: "2026-10-28",
        overdue: true,
        title: "Nota a.md",
        natureza: "plano",
      });
      expect(today.filter((i) => i.overdue).map((i) => i.due)).toEqual(["2026-10-28", "2026-10-29"]);
      // at 23:30 local, 02:30 of the 31st in UTC, a task of the 30th is due today, not overdue
      expect(today.find((i) => i.line === lineOf("todayLow") && i.path === files["b.md"])).toMatchObject({
        due: "2026-10-30",
        overdue: false,
        natureza: null,
      });
      const week = (got.semana!.data.items as Json[]).map((i) => i.due);
      expect(week).toEqual([
        "2026-10-28",
        "2026-10-29",
        "2026-10-30",
        "2026-10-30",
        "2026-10-30",
        "2026-10-30",
        "2026-10-31",
        "2026-11-05",
      ]);
    });
  });

  it("C25 with one matching task the list has one item", async () => {
    await fresh(async (world) => {
      world.note(
        path.join(world.memory, "notes", "so.md"),
        {},
        "# Só\n\n- [ ] Única 📅 2026-10-30\n- [ ] Depois 📅 2026-11-02\n",
      );
      await world.index();
      const got = await evaluate(world, [
        { id: "hoje", kind: "checklist", title: "Hoje", source: { kind: "tasks", window: "today" } },
      ]);
      expect(got.hoje!.data.items).toHaveLength(1);
      expect(got.hoje!.data.items[0]).toMatchObject({ due: "2026-10-30", overdue: false, title: "Só" });
      expect(got.hoje!.data.total).toBe(1);
    });
  });
});

// ---- C26 and C27: the week's decisions and open loops ------------------------------------------------------------

const journal = (day: string, sections: Record<string, string[]>, extra = "") =>
  [
    `# ${day}`,
    "",
    ...Object.entries(sections).flatMap(([name, lines]) => [`## ${name}`, "", ...lines, ""]),
    extra,
  ].join("\n");

async function weekHome(world: PaineisWorld) {
  const j = (day: string) => path.join(world.memory, "journal", `${day}.md`);
  world.put(
    j("2026-10-26"),
    journal("2026-10-26", {
      Today: ["- 09:00 Abri o dia", "", "### Decisions", "", "- 09:30 Sub-seção não conta"],
      Decisions: ["- 10:00 Adotar o plano A"],
      "Open loops": ["- 10:10 Falar com o banco"],
    }),
  );
  world.put(
    j("2026-10-30"),
    journal("2026-10-30", {
      Decisions: ["- 11:00 Contratar a Ana", "", "> [!plano]", "> - 12:00 Lançar em dezembro"],
      "Open loops": ["- 11:30 Mandar o orçamento"],
    }),
  );
  world.put(
    j("2026-10-25"),
    journal("2026-10-25", {
      Decisions: ["- 09:00 Decisão da semana passada"],
      "Open loops": ["- 09:00 Pendência passada"],
    }),
  );
  world.put(
    path.join(world.memory, "MEMORY.md"),
    [
      "# Memory",
      "",
      "## Decisions",
      "",
      "- Usar SQLite (journal 2026-10-28)",
      "- Decisão velha (journal 2026-10-20)",
      "- Contratar a Ana (journal 2026-10-30)",
      "",
      "## Open loops",
      "",
      "- Revisar o contrato (journal 2026-10-27)",
      "- Pendência velha (journal 2026-10-19)",
      "",
    ].join("\n"),
  );
  const notes = path.join(world.memory, "notes", "decisoes");
  world.note(
    path.join(notes, "reuniao.md"),
    {},
    "# Reunião\n\n## Decisions\n\n- Bullet de nota não conta\n\n## Open loops\n\n- Laço de nota não conta\n",
  );
  const natures: Array<[string, string | null]> = [
    ["fato", "fato"],
    ["relato", "relato"],
    ["nenhuma", null],
    ["plano", "plano"],
    ["hipotese", "hipotese"],
    ["opiniao", "opiniao"],
  ];
  for (const [name, natureza] of natures) {
    world.note(
      path.join(notes, `${name}.md`),
      natureza ? { type: "decision", natureza } : { type: "decision" },
      `# Decisão ${name}\n`,
    );
  }
  await world.index();
  return { j };
}

describe("C26 the decisions of the week", () => {
  it("C26 the week's journal bullets and MEMORY.md lines of the week from the stored text, once, the decision notes, and a state per nature", async () => {
    await fresh(async (world) => {
      const { j } = await weekHome(world);
      const opened: string[] = [];
      const realOpen = fs.openSync;
      const journalDir = path.join(world.memory, "journal");
      const openSpy = vi.spyOn(fs, "openSync").mockImplementation(((
        file: fs.PathLike,
        ...rest: unknown[]
      ) => {
        if (String(file).startsWith(journalDir) || String(file).endsWith("MEMORY.md"))
          opened.push(String(file));
        return (realOpen as (...a: unknown[]) => number)(file, ...rest);
      }) as typeof fs.openSync);
      const reads = [vi.mocked(safeFs.readWorkspaceText), vi.mocked(safeFs.readWorkspaceFile)];
      reads.forEach((r) => r.mockClear());
      let got: Record<string, Json>;
      try {
        got = await evaluate(world, [
          {
            id: "todas",
            kind: "list",
            title: "Todas",
            source: { kind: "decisions", window: "week" },
            options: { limit: 50 },
          },
          {
            id: "abertas",
            kind: "list",
            title: "Abertas",
            source: { kind: "decisions", window: "week", state: "open" },
            options: { limit: 50 },
          },
        ]);
      } finally {
        openSpy.mockRestore();
      }
      expect(opened).toEqual([]);
      const safeReads = reads.flatMap((r) => r.mock.calls.map(([, file]) => String(file)));
      expect(safeReads.filter((f) => f.startsWith(journalDir) || f.endsWith("MEMORY.md"))).toEqual([]);

      const items = got.todas!.data.items as Json[];
      const texts = items.map((i) => i.text).sort();
      expect(texts).toEqual(
        [
          "Adotar o plano A",
          "Contratar a Ana",
          "Lançar em dezembro",
          "Usar SQLite",
          "Decisão fato",
          "Decisão relato",
          "Decisão nenhuma",
          "Decisão plano",
          "Decisão hipotese",
          "Decisão opiniao",
        ].sort(),
      );
      const byText = (t: string) => items.find((i) => i.text === t)!;
      expect(byText("Contratar a Ana").path).toBe(j("2026-10-30"));
      expect(byText("Usar SQLite")).toMatchObject({
        path: path.join(world.memory, "MEMORY.md"),
        day: "2026-10-28",
        state: "decided",
      });
      expect(byText("Adotar o plano A")).toMatchObject({
        day: "2026-10-26",
        state: "decided",
        natureza: "fato",
      });
      expect(byText("Lançar em dezembro")).toMatchObject({ state: "open", natureza: "plano" });
      const states: Array<[string, string]> = [
        ["Decisão fato", "decided"],
        ["Decisão relato", "decided"],
        ["Decisão nenhuma", "decided"],
        ["Decisão plano", "open"],
        ["Decisão hipotese", "open"],
        ["Decisão opiniao", "open"],
      ];
      for (const [text, state] of states) expect(byText(text).state, text).toBe(state);
      expect((got.abertas!.data.items as Json[]).map((i) => i.text).sort()).toEqual(
        ["Lançar em dezembro", "Decisão plano", "Decisão hipotese", "Decisão opiniao"].sort(),
      );
    });
  });
});

describe("C27 the open loops of the week", () => {
  it("C27 the week's journal bullets and MEMORY.md lines of the week, each plano, and not the week before nor a note's section", async () => {
    await fresh(async (world) => {
      await weekHome(world);
      const got = await evaluate(world, [
        {
          id: "lacos",
          kind: "list",
          title: "Laços",
          source: { kind: "openLoops", window: "week" },
          options: { limit: 50 },
        },
      ]);
      const items = got.lacos!.data.items as Json[];
      expect(items.map((i) => i.text).sort()).toEqual(
        ["Falar com o banco", "Mandar o orçamento", "Revisar o contrato"].sort(),
      );
      expect(items.every((i) => i.natureza === "plano")).toBe(true);
    });
  });
});

// ---- C28: a project's health -------------------------------------------------------------------------------------

describe("C28 the projects", () => {
  it("C28 one asserted case per row and per precedence, the case of type and status, an unreadable due, archived left out, and a health filter", async () => {
    await fresh(async (world) => {
      const dir = path.join(world.memory, "notes", "projetos");
      const cases: Array<[string, Record<string, string>, string | null]> = [
        ["feito", { status: "done" }, "done"],
        ["pausado", { status: "paused" }, "paused"],
        ["atrasado", { status: "active", due: "2026-10-29" }, "behind"],
        ["hoje", { status: "active", due: "2026-10-30" }, "due_today"],
        ["rascunho", { status: "draft" }, "in_review"],
        ["amanha", { status: "active", due: "2026-10-31" }, "on_track"],
        ["sem-prazo", { status: "active" }, "on_track"],
        ["rascunho-atrasado", { status: "draft", due: "2026-10-29" }, "behind"],
        ["feito-atrasado", { status: "done", due: "2026-10-29" }, "done"],
        ["data-ruim", { status: "active", due: "2026-13-01" }, "on_track"],
        ["arquivado", { status: "archived" }, null],
      ];
      for (const [name, fields] of cases)
        world.note(path.join(dir, `${name}.md`), { type: "project", ...fields }, `# ${name}\n`);
      world.note(path.join(dir, "maiusculas.md"), { type: "Project", status: "DONE" }, "# maiusculas\n");
      world.note(path.join(dir, "nota.md"), { type: "note", status: "active" }, "# nota\n");
      await world.index();
      const got = await evaluate(world, [
        { id: "todos", kind: "list", title: "Todos", source: { kind: "projects" }, options: { limit: 50 } },
        {
          id: "atrasados",
          kind: "list",
          title: "Atrasados",
          source: { kind: "projects", health: ["behind"] },
          options: { limit: 50 },
        },
      ]);
      const items = got.todos!.data.items as Json[];
      const health = Object.fromEntries(items.map((i) => [i.title, i.health]));
      for (const [name, , want] of cases) {
        if (want === null) expect(health[name], name).toBeUndefined();
        else expect(health[name], name).toBe(want);
      }
      expect(health.maiusculas).toBe("done");
      expect(health.nota).toBeUndefined();
      expect(items.find((i) => i.title === "data-ruim")!.due).toBeNull();
      expect((got.atrasados!.data.items as Json[]).map((i) => i.title).sort()).toEqual([
        "atrasado",
        "rascunho-atrasado",
      ]);
    });
  });
});

// ---- batch B: the reminders of the local day (C44) ---------------------------------------------------------------

describe("C44 the reminders of a refresh", () => {
  const local = (d: number, h: number, m: number) => new Date(2026, 9, d, h, m).getTime();
  /** Refresh `visao-geral` at `when` (the Date frozen there); the reminders the inbox lists, oldest first. */
  async function refreshAt(world: PaineisWorld, when: number): Promise<Json[]> {
    clock.set(when);
    vi.useFakeTimers({ toFake: ["Date"], now: when });
    try {
      expect((await world.refresh("visao-geral")).status).toBe(200);
    } finally {
      vi.useRealTimers();
    }
    const listed = (await world.call("GET", "/api/notifications")).body.items as Json[];
    // GET /api/notifications lists the newest first; the order they were made in is the other way round.
    return listed.filter((n) => n.kind === "reminder").reverse();
  }

  it("C44 maxPerDay 2 at 08:30: at 08:31 two reminders, the overdue then the first due today; none again at 10:00; none at 08:29 of the next day and two at 08:30", async () => {
    await fresh(async (world) => {
      world.update((s) => {
        s.dashboards = { reminders: { maxPerDay: 2, at: "08:30" } };
      });
      const dir = path.join(world.memory, "notes");
      const tasks = world.note(
        path.join(dir, "tarefas.md"),
        {},
        "# Tarefas\n\n- [ ] Mandar a proposta 📅 2026-10-29\n- [ ] Ligar ⏫ 📅 2026-10-30\n- [ ] Revisar 📅 2026-10-30\n",
      );
      world.note(
        path.join(dir, "site.md"),
        { type: "project", status: "active", due: "2026-10-28" },
        "# Site novo\n",
      );
      await world.index();
      const fileId = (
        world.ctx.db.prepare("SELECT id FROM files WHERE path = ?").get(tasks) as { id: number }
      ).id;
      expect((await world.create({ template: "overview" })).status).toBe(201);

      const first = await refreshAt(world, local(30, 8, 31));
      expect(first).toHaveLength(2);
      expect(first[0]).toMatchObject({
        kind: "reminder",
        dedupeKey: `reminder:overdue:task:${tasks}:3:2026-10-30`,
        tone: "warn",
        messageKey: "reminder.overdue",
        messageParams: { text: "Mandar a proposta" },
        href: `/brain?sel=${fileId}`,
        title: "Overdue: Mandar a proposta",
      });
      expect(first[1]).toMatchObject({
        kind: "reminder",
        dedupeKey: `reminder:due_today:task:${tasks}:4:2026-10-30`,
        tone: "info",
        messageKey: "reminder.due_today",
        messageParams: { text: "Ligar" },
      });

      expect(await refreshAt(world, local(30, 10, 0))).toEqual(first);
      expect(await refreshAt(world, local(31, 8, 29))).toEqual(first);
      const next = await refreshAt(world, local(31, 8, 30));
      expect(next).toHaveLength(4);
      // on the 31st the three tasks are overdue: the first two by the tasks' order (priority first)
      expect(next.slice(2).map((n) => n.dedupeKey)).toEqual([
        `reminder:overdue:task:${tasks}:4:2026-10-31`,
        `reminder:overdue:task:${tasks}:3:2026-10-31`,
      ]);
    });
  });

  it("C44 with only one candidate, one reminder", async () => {
    await fresh(async (world) => {
      world.note(
        path.join(world.memory, "notes", "site.md"),
        { type: "project", status: "active", due: "2026-10-28" },
        "# Site novo\n",
      );
      await world.index();
      expect((await world.create({ template: "overview" })).status).toBe(201);
      const got = await refreshAt(world, local(30, 9, 0));
      expect(got.map((n) => [n.title, n.dedupeKey, n.tone])).toEqual([
        [
          "Project behind: Site novo",
          `reminder:project_behind:project:${path.join(world.memory, "notes", "site.md")}:2026-10-30`,
          "warn",
        ],
      ]);
    });
  });
});

// ---- batch B: the export's name and footer (C57) -----------------------------------------------------------------

describe("C57 POST /api/dashboards/:id/export", () => {
  const at1407 = new Date(2026, 9, 30, 14, 7, 20).getTime();
  /** What every chart must be: an inline SVG followed by the table of its values. */
  const charts = (html: string) => [...html.matchAll(/<svg[\s\S]*?<\/svg>(<table>[\s\S]*?<\/table>)?/g)];
  const freeze = async <T>(when: number, fn: () => Promise<T>): Promise<T> => {
    clock.set(when);
    vi.useFakeTimers({ toFake: ["Date"], now: when });
    try {
      return await fn();
    } finally {
      vi.useRealTimers();
    }
  };

  it("C57 at 14:07 local the file is artifacts/dashboards/visao-geral-2026-10-30T1407.html: no script nor outside resource, each chart an SVG then its table, the title escaped, the footer's date; the same minute again is -2; no snapshot is 409 no_snapshot; nao-existe is 404", async () => {
    await fresh(async (world) => {
      const created = await world.create({ template: "overview" });
      const widgets = [
        {
          id: "k",
          kind: "kpi",
          title: "Execuções",
          source: { kind: "metrics", series: "runs24h" },
          options: { measure: "latest" },
        },
        { id: "b", kind: "bars", title: "<b>x</b>", source: { kind: "notes", groupBy: "status" } },
      ];
      const put = await world.call("PUT", "/api/dashboards/visao-geral", {
        definition: { ...created.body.definition, refresh: "manual", widgets },
        baseVersion: created.body.version,
      });
      expect(put.status, JSON.stringify(put.body)).toBe(200);
      const dir = path.join(world.ctx.paths.artifacts, "dashboards");
      const listing = () => (fs.existsSync(dir) ? fs.readdirSync(dir).sort() : []);

      // no snapshot yet: 409 no_snapshot and nothing written
      const none = await freeze(at1407, () => world.call("POST", "/api/dashboards/visao-geral/export"));
      expect([none.status, none.body.error.code]).toEqual([409, "no_snapshot"]);
      expect(listing()).toEqual([]);

      world.note(path.join(world.memory, "notes", "a.md"), { status: "active" });
      world.note(path.join(world.memory, "notes", "b.md"), { status: "draft" });
      await world.index();
      for (const [when, runs] of [
        [at1407 - 2 * 3_600_000, 4],
        [at1407, 7],
      ] as const) {
        world.ctx.metricsHistory.sample(
          {
            runs: {
              total: runs,
              last24h: runs,
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
        await freeze(when, async () => expect((await world.refresh("visao-geral")).status).toBe(200));
      }

      const first = await freeze(at1407, () => world.call("POST", "/api/dashboards/visao-geral/export"));
      expect(first.status, JSON.stringify(first.body)).toBe(200);
      expect(first.body.path).toBe(path.join(dir, "visao-geral-2026-10-30T1407.html"));
      const html = fs.readFileSync(first.body.path, "utf8");
      for (const banned of ["<script", "src=", "url(", "@import", "<link"])
        expect(html, banned).not.toContain(banned);
      const found = charts(html);
      expect(found).toHaveLength(2);
      for (const [, tableHtml] of found) expect(tableHtml, "a table right after each svg").toBeDefined();
      // the KPI's table holds its two points, the bars' table its two categories
      expect(found[0]![1]).toContain("<td>4</td>");
      expect(found[0]![1]).toContain("<td>7</td>");
      expect(found[1]![1]).toContain("<td>active</td><td>1</td>");
      expect(found[1]![1]).toContain("<td>draft</td><td>1</td>");
      expect(html).toContain("&lt;b&gt;x&lt;/b&gt;");
      expect(html).not.toContain("<b>x</b>");
      expect(html).toContain("Exportado do MordomoOS em 30/10/2026");

      const second = await freeze(at1407 + 20_000, () =>
        world.call("POST", "/api/dashboards/visao-geral/export"),
      );
      expect(second.body.path).toBe(path.join(dir, "visao-geral-2026-10-30T1407-2.html"));

      const missing = await world.call("POST", "/api/dashboards/nao-existe/export");
      expect([missing.status, missing.body.error.code]).toEqual([404, "dashboard_not_found"]);
    });
  });

  it("C57 a question dashboard's file holds its citations as nome § seção", async () => {
    const world = await questionWorld(`mordomo-paineis-localday-q-${++seq}-`);
    try {
      const file = world.note(path.join(world.memory, "notes", "plano.md"), {}, "# Plano\n\n## Metas\n\nx\n");
      await world.index();
      await world.create({ template: "question", question: "Quais são as metas?" });
      world.answer({
        v: 1,
        widgets: [
          {
            id: "metas",
            kind: "note",
            title: "Metas",
            data: { text: "Crescer." },
            citations: [{ path: file, section: "Metas" }],
          },
        ],
      });
      const res = await world.refresh("pergunta");
      expect(res.status).toBe(202);
      expect((await world.settle("pergunta", res.body.runId)).status).toBe("ok");
      const out = await freeze(at1407, () => world.call("POST", "/api/dashboards/pergunta/export"));
      expect(out.status, JSON.stringify(out.body)).toBe(200);
      expect(out.body.path).toMatch(/pergunta-2026-10-30T1407\.html$/);
      expect(fs.readFileSync(out.body.path, "utf8")).toContain("plano.md § Metas");
    } finally {
      await world.close();
    }
  });
});
