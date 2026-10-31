import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import * as client from "../core/src/connectors/client.js";
import { DashboardEvaluator } from "../core/src/dashboards/evaluator.js";
import { ACCEPTED, REFUSALS, valid } from "./helpers/paineisDefinitions.js";
import {
  calendarItems,
  dayOf,
  fakeConnectorFetch,
  paineisWorld,
  type Json,
  type PaineisWorld,
} from "./helpers/paineisWorld.js";

/**
 * .specs/features/cerebro-paineis, batch A, S1: the definition routes (`POST`, `GET`, `PUT` of `/api/dashboards`)
 * through `app.inject` against `buildServer` over a real home. The validator's own layer is `paineis.layer.test.ts`.
 */

vi.mock("../core/src/connectors/client.js", async (importOriginal) => {
  const actual = await importOriginal<typeof client>();
  return { ...actual, fetchConnectorData: vi.fn(actual.fetchConnectorData) };
});

const NOW = new Date(2026, 9, 30, 12, 0, 0).getTime();
const MIN = 60_000;
const sha = (bytes: Buffer | string) => `sha256:${crypto.createHash("sha256").update(bytes).digest("hex")}`;

let w: PaineisWorld;
let seq = 0;

beforeAll(async () => {
  w = await paineisWorld("mordomo-paineis-routes-");
  fakeConnectorFetch(calendarItems(NOW));
});
afterAll(async () => {
  await w.close();
});
afterEach(() => {
  vi.useRealTimers();
});

const dir = (world: PaineisWorld) => path.join(world.memory, "dashboards");
const listing = (world: PaineisWorld) => (fs.existsSync(dir(world)) ? fs.readdirSync(dir(world)).sort() : []);
const fileOf = (world: PaineisWorld, id: string) => path.join(dir(world), `${id}.json`);

/** A fresh home, for a claim about what a home with no dashboard (or with exactly these) answers. */
async function fresh<T>(fn: (world: PaineisWorld) => Promise<T>): Promise<T> {
  const world = await paineisWorld(`mordomo-paineis-routes-${++seq}-`);
  try {
    return await fn(world);
  } finally {
    await world.close();
  }
}

const shape = (widgets: Json[]) =>
  widgets.map((x) => ({ kind: x.kind, title: x.title, source: x.source, options: x.options }));

describe("C1 the overview template", () => {
  it("C1 POST with template overview writes memory/dashboards/visao-geral.json, its bytes hash to the version, and it holds the ten widgets", async () => {
    await fresh(async (world) => {
      const res = await world.create({ template: "overview" });
      expect(res.status, JSON.stringify(res.body)).toBe(201);
      expect(res.body.id).toBe("visao-geral");
      expect(res.body.version).toMatch(/^sha256:[0-9a-f]{64}$/);
      const bytes = fs.readFileSync(fileOf(world, "visao-geral"));
      expect(sha(bytes)).toBe(res.body.version);
      const stored = JSON.parse(bytes.toString("utf8"));
      expect(stored).toEqual(res.body.definition);
      expect(stored).toMatchObject({ v: 1, kind: "overview", refresh: "15m", title: "Visão geral" });
      expect("contextId" in stored).toBe(false);
      expect(shape(stored.widgets)).toEqual([
        {
          kind: "kpi",
          title: "Prioridades de hoje",
          source: { kind: "tasks", window: "today" },
          options: { measure: "done_of_due", chip: "remaining" },
        },
        {
          kind: "kpi",
          title: "Decisões da semana",
          source: { kind: "decisions", window: "week" },
          options: { measure: "count", chip: "open" },
        },
        {
          kind: "kpi",
          title: "Projetos no prazo",
          source: { kind: "projects" },
          options: { measure: "on_track_of_active", chip: "behind" },
        },
        {
          kind: "kpi",
          title: "Revisões vencidas",
          source: { kind: "reviews" },
          options: { measure: "count", upIsGood: false },
        },
        {
          kind: "kpi",
          title: "Execuções em 24 h",
          source: { kind: "metrics", series: "runs24h" },
          options: { measure: "latest" },
        },
        {
          kind: "checklist",
          title: "Prioridades de hoje",
          source: { kind: "tasks", window: "today" },
          options: { size: "m" },
        },
        {
          kind: "list",
          title: "Decisões da semana",
          source: { kind: "decisions", window: "week" },
          options: { size: "m" },
        },
        {
          kind: "list",
          title: "Em andamento",
          source: { kind: "projects", health: ["behind", "due_today", "in_review", "on_track"] },
          options: { size: "m" },
        },
        { kind: "list", title: "Agentes agora", source: { kind: "runs" }, options: { size: "m" } },
        {
          kind: "agenda",
          title: "Agenda de hoje",
          source: { kind: "connector", id: "calendar-google", read: "list" },
          options: { size: "l" },
        },
      ]);
    });
  });
});

describe("C2 the area template", () => {
  it("C2 no contextId is 400 at contextId; an existing context makes contexto-projeto-x with its eight widgets; one that does not exist is 404 and writes nothing; contextId on an overview is 400", async () => {
    await fresh(async (world) => {
      const root = world.indexedRoot("c2");
      world.context("projeto-x", "Projeto X", [root]);
      const missing = await world.create({ template: "area" });
      expect(missing.status).toBe(400);
      expect(missing.body.error.code).toBe("validation");
      expect(missing.body.error.issues.map((i: Json) => i.path)).toEqual([["contextId"]]);

      const res = await world.create({ template: "area", contextId: "projeto-x" });
      expect(res.status, JSON.stringify(res.body)).toBe(201);
      expect(res.body.id).toBe("contexto-projeto-x");
      expect(res.body.definition).toMatchObject({
        kind: "area",
        contextId: "projeto-x",
        title: "Projeto X",
        refresh: "15m",
      });
      expect(shape(res.body.definition.widgets)).toEqual([
        {
          kind: "kpi",
          title: "Tarefas abertas",
          source: { kind: "tasks", window: "week" },
          options: { measure: "open" },
        },
        {
          kind: "kpi",
          title: "Decisões da semana",
          source: { kind: "decisions", window: "week" },
          options: { measure: "count", chip: "open" },
        },
        {
          kind: "kpi",
          title: "Notas atualizadas na semana",
          source: { kind: "notes", changed: "week" },
          options: { measure: "count" },
        },
        {
          kind: "kpi",
          title: "Revisões vencidas",
          source: { kind: "reviews" },
          options: { measure: "count", upIsGood: false },
        },
        {
          kind: "checklist",
          title: "Próximas tarefas",
          source: { kind: "tasks", window: "week" },
          options: { size: "m" },
        },
        {
          kind: "bars",
          title: "Notas por status",
          source: { kind: "notes", groupBy: "status" },
          options: { size: "m" },
        },
        {
          kind: "list",
          title: "Mudou nesta semana",
          source: { kind: "notes", changed: "week" },
          options: { size: "m" },
        },
        {
          kind: "list",
          title: "Decisões abertas",
          source: { kind: "decisions", window: "week", state: "open" },
          options: { size: "m" },
        },
      ]);
      expect(res.body.definition.widgets.some((x: Json) => x.source.kind === "connector")).toBe(false);

      const before = listing(world);
      const gone = await world.create({ template: "area", contextId: "nao-existe" });
      expect(gone.status).toBe(404);
      expect(gone.body.error.code).toBe("context_not_found");
      expect(listing(world)).toEqual(before);

      const wrong = await world.create({ template: "overview", contextId: "projeto-x" });
      expect(wrong.status).toBe(400);
      expect(wrong.body.error.code).toBe("validation");
      expect(wrong.body.error.issues.map((i: Json) => i.path)).toEqual([["contextId"]]);
      expect(listing(world)).toEqual(before);
    });
  });
});

describe("C3 the question template", () => {
  it("C3 no question, a blank one and 501 characters are 400 at question and write nothing; a trimmed question makes pergunta, manual; 500 characters are accepted; no template is 400", async () => {
    await fresh(async (world) => {
      for (const body of [
        { template: "question" },
        { template: "question", question: "   " },
        { template: "question", question: ` ${"q".repeat(501)} ` },
      ]) {
        const res = await world.create(body);
        expect(res.status).toBe(400);
        expect(res.body.error.code).toBe("validation");
        expect(res.body.error.issues.map((i: Json) => i.path)).toEqual([["question"]]);
        expect(listing(world)).toEqual([]);
      }
      const res = await world.create({ template: "question", question: "  Por que o onboarding demora?  " });
      expect(res.status, JSON.stringify(res.body)).toBe(201);
      expect(res.body.id).toBe("pergunta");
      expect(res.body.definition).toMatchObject({
        kind: "question",
        refresh: "manual",
        question: "Por que o onboarding demora?",
        title: "Por que o onboarding demora?",
      });
      const long = await world.create({ template: "question", question: "q".repeat(500) });
      expect(long.status, JSON.stringify(long.body)).toBe(201);
      expect(long.body.definition.question).toHaveLength(500);
      const none = await world.create({ question: "Por quê?" });
      expect(none.status).toBe(400);
      expect(none.body.error.code).toBe("validation");
    });
  });
});

describe("C4 the derived id", () => {
  it("C4 with visao-geral.json present a second overview is visao-geral-2; with -2 to -99 present too it is 409 and nothing changes; an archived visao-geral-2026-10-30.json does not count", async () => {
    await fresh(async (world) => {
      const archived = path.join(world.memory, "archive", "dashboards", "visao-geral-2026-10-30.json");
      world.put(archived, "{}");
      expect((await world.create({ template: "overview" })).body.id).toBe("visao-geral");
      const second = await world.create({ template: "overview" });
      expect(second.status).toBe(201);
      expect(second.body.id).toBe("visao-geral-2");
      for (let n = 3; n <= 99; n++)
        fs.copyFileSync(fileOf(world, "visao-geral"), fileOf(world, `visao-geral-${n}`));
      const before = listing(world);
      expect(before).toHaveLength(99);
      const full = await world.create({ template: "overview" });
      expect(full.status).toBe(409);
      expect(full.body.error.code).toBe("dashboard_exists");
      expect(listing(world)).toEqual(before);
    });
  });
});

describe("C5 door 1 at the route", () => {
  let version = "";
  let file = "";
  beforeAll(async () => {
    const res = await w.create({ template: "overview" });
    file = fileOf(w, res.body.id);
    const put = await w.call("PUT", `/api/dashboards/${res.body.id}`, {
      definition: valid(),
      baseVersion: res.body.version,
    });
    expect(put.status, JSON.stringify(put.body)).toBe(200);
    version = put.body.version;
  });

  for (const [name, change, at] of REFUSALS) {
    it(`C5 PUT refuses ${name} with 400 validation at that field, and leaves the file's bytes and mtime`, async () => {
      const def = valid();
      change(def);
      const before = { bytes: fs.readFileSync(file), mtime: fs.statSync(file).mtimeMs };
      const res = await w.call("PUT", `/api/dashboards/${path.basename(file, ".json")}`, {
        definition: def,
        baseVersion: version,
      });
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe("validation");
      expect(res.body.error.issues.map((i: Json) => i.path)).toEqual([["definition", ...at]]);
      expect(fs.readFileSync(file)).toEqual(before.bytes);
      expect(fs.statSync(file).mtimeMs).toBe(before.mtime);
    });
  }

  for (const [name, change] of ACCEPTED) {
    it(`C5 PUT accepts ${name}`, async () => {
      const def = valid();
      change(def);
      const res = await w.call("PUT", `/api/dashboards/${path.basename(file, ".json")}`, {
        definition: def,
        baseVersion: version,
      });
      expect(res.status, JSON.stringify(res.body).slice(0, 400)).toBe(200);
      version = res.body.version;
      expect(sha(fs.readFileSync(file))).toBe(version);
      if (name.includes("65 536")) expect(fs.statSync(file).size).toBe(65_536);
    });
  }
});

describe("C6 the guarded write", () => {
  it("C6 PUT with the version POST answered writes, the answer's version is the new bytes' hash and GET answers that definition; a PUT with the old version is 409 and leaves the first PUT's bytes; a missing dashboard is 404 and creates nothing", async () => {
    await fresh(async (world) => {
      const created = await world.create({ template: "overview" });
      const def = created.body.definition;
      def.widgets[1].title = "Decididas";
      const put = await world.call("PUT", "/api/dashboards/visao-geral", {
        definition: def,
        baseVersion: created.body.version,
      });
      expect(put.status, JSON.stringify(put.body)).toBe(200);
      const file = fileOf(world, "visao-geral");
      const after = { bytes: fs.readFileSync(file), mtime: fs.statSync(file).mtimeMs };
      expect(put.body.version).toBe(sha(after.bytes));
      const got = await world.get("visao-geral");
      expect(got.status).toBe(200);
      expect(put.body.definition).toEqual(got.body.definition);
      expect(got.body.definition.widgets[1].title).toBe("Decididas");

      def.widgets[1].title = "De novo";
      const stale = await world.call("PUT", "/api/dashboards/visao-geral", {
        definition: def,
        baseVersion: created.body.version,
      });
      expect(stale.status).toBe(409);
      expect(stale.body.error.code).toBe("edit_conflict");
      expect(fs.readFileSync(file)).toEqual(after.bytes);
      expect(fs.statSync(file).mtimeMs).toBe(after.mtime);

      const none = await world.call("PUT", "/api/dashboards/nao-existe", {
        definition: def,
        baseVersion: created.body.version,
      });
      expect(none.status).toBe(404);
      expect(none.body.error.code).toBe("dashboard_not_found");
      expect(fs.existsSync(fileOf(world, "nao-existe"))).toBe(false);
    });
  });
});

/** The definition of a dashboard with one runs list, refreshed `refresh`. */
const simple = (refresh: string) => ({
  v: 1,
  title: "Simples",
  kind: "overview",
  refresh,
  widgets: [{ id: "agentes", kind: "list", title: "Agentes", source: { kind: "runs" } }],
});

describe("C12 GET reads no source", () => {
  it("C12 GET evaluates no source and answers definition, version, snapshot and highlights; a missing dashboard is 404", async () => {
    await fresh(async (world) => {
      // A task due today and the calendar's flagged event: the stored snapshot gives two highlights (batch B, door 5),
      // which the GET computes from it without reading any source.
      const note = world.note(
        path.join(world.memory, "notes", "ligar.md"),
        {},
        `# Ligar\n\n- [ ] Ligar 📅 ${dayOf(NOW)}\n`,
      );
      await world.index();
      const fileId = (world.ctx.db.prepare("SELECT id FROM files WHERE path = ?").get(note) as { id: number })
        .id;
      const created = await world.create({ template: "overview" });
      vi.useFakeTimers({ toFake: ["Date"], now: NOW });
      const refreshed = await world.refresh("visao-geral");
      expect(refreshed.status).toBe(200);
      const evaluate = vi.spyOn(DashboardEvaluator.prototype, "evaluate");
      const fetch = vi.mocked(client.fetchConnectorData);
      fetch.mockClear();
      try {
        vi.setSystemTime(NOW + 5 * MIN);
        const res = await world.get("visao-geral");
        expect(res.status).toBe(200);
        expect(Object.keys(res.body).sort()).toEqual([
          "definition",
          "highlights",
          "snapshot",
          "stale",
          "version",
        ]);
        expect(res.body.version).toBe(created.body.version);
        expect(res.body.snapshot).toEqual(refreshed.body.snapshot);
        expect(res.body.stale).toBe(false);
        expect(res.body.highlights).toEqual([
          { rule: "due_today", title: "Ligar", tone: "warn", target: `/brain?sel=${fileId}` },
          {
            rule: "connector_flagged",
            title: "Almoço com cliente",
            tone: "info",
            target: "/connectors#calendar-google",
          },
        ]);
        await new Promise((r) => setImmediate(r));
        expect(evaluate).toHaveBeenCalledTimes(0);
        expect(fetch).toHaveBeenCalledTimes(0);
      } finally {
        evaluate.mockRestore();
      }
      const none = await world.get("nao-existe");
      expect(none.status).toBe(404);
      expect(none.body.error.code).toBe("dashboard_not_found");
    });
  });

  const cases: Array<[string, string, number | null, boolean]> = [
    ["15m at exactly 15 min", "15m", 15 * MIN, false],
    ["15m at 15 min + 1 ms", "15m", 15 * MIN + 1, true],
    ["1h at 60 min + 1 ms", "1h", 60 * MIN + 1, true],
    ["6h at 6 h", "6h", 360 * MIN, false],
    ["daily@08:30 at 48 h", "daily@08:30", 2880 * MIN, false],
    ["daily@08:30 at 48 h + 1 ms", "daily@08:30", 2880 * MIN + 1, true],
    ["manual at 30 days", "manual", 30 * 1440 * MIN, false],
    ["no snapshot", "15m", null, false],
  ];
  for (const [name, refresh, age, stale] of cases) {
    it(`C12 stale: ${name} → ${stale}`, async () => {
      await fresh(async (world) => {
        const created = await world.create({ template: "overview" });
        const put = await world.call("PUT", "/api/dashboards/visao-geral", {
          definition: simple(refresh),
          baseVersion: created.body.version,
        });
        expect(put.status, JSON.stringify(put.body)).toBe(200);
        vi.useFakeTimers({ toFake: ["Date"], now: NOW });
        if (age !== null) expect((await world.refresh("visao-geral")).status).toBe(200);
        vi.setSystemTime(NOW + (age ?? 0));
        const next = stale ? world.nextRefresh("visao-geral") : null;
        const res = await world.get("visao-geral");
        expect(res.status).toBe(200);
        expect(res.body.stale).toBe(stale);
        if (age === null) expect(res.body.snapshot).toBeNull();
        else expect(res.body.snapshot.generatedAt).toBe(NOW);
        if (next) await next;
      });
    });
  }
});

describe("C16 the list", () => {
  it("C16 one dashboard is a one-element list with exactly the seven keys", async () => {
    await fresh(async (world) => {
      await world.create({ template: "overview" });
      const res = await world.call("GET", "/api/dashboards");
      expect(res.status).toBe(200);
      expect(res.body.dashboards).toEqual([
        {
          id: "visao-geral",
          title: "Visão geral",
          kind: "overview",
          contextId: null,
          refresh: "15m",
          generatedAt: null,
          stale: false,
        },
      ]);
      expect(res.body.problems).toEqual([]);
    });
  });

  it("C16 by kind, then title, then id; a hand-edited file with an unknown key is a problem, a 404 and never refreshed by the tick", async () => {
    await fresh(async (world) => {
      const root = world.indexedRoot("c16");
      world.context("b", "B", [root]);
      world.context("a", "A", [root]);
      for (const body of [
        { template: "question", question: "Por quê?" },
        { template: "area", contextId: "b" },
        { template: "area", contextId: "a" },
        { template: "overview" },
      ]) {
        expect((await world.create(body)).status).toBe(201);
      }
      const broken = { ...simple("15m"), owner: "eu" };
      world.put(fileOf(world, "quebrado"), JSON.stringify(broken));
      const res = await world.call("GET", "/api/dashboards");
      expect(res.status).toBe(200);
      expect(res.body.dashboards.map((d: Json) => d.id)).toEqual([
        "visao-geral",
        "contexto-a",
        "contexto-b",
        "pergunta",
      ]);
      for (const d of res.body.dashboards) {
        expect(Object.keys(d).sort()).toEqual([
          "contextId",
          "generatedAt",
          "id",
          "kind",
          "refresh",
          "stale",
          "title",
        ]);
      }
      expect(res.body.problems).toHaveLength(1);
      expect(res.body.problems[0].id).toBe("quebrado");
      expect(res.body.problems[0].message.length).toBeGreaterThan(0);
      const got = await world.get("quebrado");
      expect(got.status).toBe(404);
      expect(got.body.error.code).toBe("dashboard_not_found");
      const ran = await world.ctx.dashboards.tick();
      expect(ran).not.toContain("quebrado");
      expect(world.refreshed.map((e) => e.id)).not.toContain("quebrado");
      expect(
        world.ctx.db
          .prepare("SELECT COUNT(*) c FROM dashboard_snapshots WHERE dashboard_id = 'quebrado'")
          .get(),
      ).toEqual({ c: 0 });
    });
  });
});
