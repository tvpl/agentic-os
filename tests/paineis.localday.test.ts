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
  it("C10 C15 C25 C26 C27 C28 the zone is pinned: 23:30 of 2026-10-30 local is 2026-10-31 in UTC", () => {
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
