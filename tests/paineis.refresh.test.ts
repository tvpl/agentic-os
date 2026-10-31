import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { AppContext } from "../apps/api/src/context.js";
import { buildServer, startServer } from "../apps/api/src/server.js";
import type * as client from "../core/src/connectors/client.js";
import type { OsEvent } from "../core/src/events.js";
import { assertFact } from "../core/src/memory/facts.js";
import * as reviews from "../core/src/memory/reviews.js";
import * as safeFs from "../core/src/security/safeFs.js";
import { auditFiles, recordFileReads } from "./fsReadAudit.js";
import { makeTempHome } from "./helpers.js";
import { movingClock } from "./helpers/movingClock.js";
import {
  calendarItems,
  dayOf,
  fakeConnectorFetch,
  paineisWorld,
  runRow,
  type Json,
  type PaineisWorld,
} from "./helpers/paineisWorld.js";

/**
 * .specs/features/cerebro-paineis, batch A, S1: `POST /api/dashboards/:id/refresh`, the stale `GET`, the lock, the
 * service's clock, the context of an area and today's policy, through `app.inject` against `buildServer` over a real
 * home (and `startServer` for the clock). "Now" is `NOW`, frozen (`Date` only) where a claim names the instant.
 */

vi.mock("../core/src/connectors/client.js", async (importOriginal) => {
  const actual = await importOriginal<typeof client>();
  return { ...actual, fetchConnectorData: vi.fn(actual.fetchConnectorData) };
});
vi.mock("../core/src/memory/reviews.js", async (importOriginal) => {
  const actual = await importOriginal<typeof reviews>();
  return { ...actual, reviewsDue: vi.fn(actual.reviewsDue) };
});
vi.mock("../core/src/security/safeFs.js", async (importOriginal) => {
  const actual = await importOriginal<typeof safeFs>();
  return {
    ...actual,
    readWorkspaceText: vi.fn(actual.readWorkspaceText),
    readWorkspaceFile: vi.fn(actual.readWorkspaceFile),
  };
});

const NOW = new Date(2026, 9, 30, 12, 0, 0).getTime();
const MIN = 60_000;
const TODAY = dayOf(NOW);
/** What a KPI counts (batch B's trend, chip and items ride beside it in `data`). */
const kpiOf = (data: Json) => ({ value: data.value, of: data.of });
const repoRoot = path.resolve(import.meta.dirname, "..");

let seq = 0;
afterEach(() => {
  vi.useRealTimers();
});

async function fresh<T>(fn: (world: PaineisWorld) => Promise<T>): Promise<T> {
  const world = await paineisWorld(`mordomo-paineis-refresh-${++seq}-`);
  try {
    return await fn(world);
  } finally {
    await world.close();
  }
}

/**
 * A home where every widget of the overview has something to show: two notes with a task due today (a project on
 * track and a decision), a run, an hourly sample and two events of the calendar.
 */
async function overviewHome(world: PaineisWorld): Promise<{ project: string; decision: string }> {
  const notes = path.join(world.memory, "notes");
  const project = world.note(
    path.join(notes, "projeto.md"),
    { type: "project", status: "active" },
    `# Projeto\n\n- [ ] Mandar a proposta 📅 ${TODAY}\n`,
  );
  const decision = world.note(
    path.join(notes, "decisao.md"),
    { type: "decision" },
    `# Decisão\n\n- [ ] Avisar o time 📅 ${TODAY}\n`,
  );
  await world.index();
  runRow(world, {
    id: "run-1",
    status: "running",
    skill: "recall",
    createdAt: NOW - 5 * MIN,
    startedAt: NOW - 5 * MIN,
  });
  world.ctx.sampleMetrics(NOW);
  fakeConnectorFetch(calendarItems(NOW));
  expect((await world.create({ template: "overview" })).status).toBe(201);
  return { project, decision };
}

describe("C7 a refresh", () => {
  it("C7 answers the snapshot of door 4 with every widget ok in the definition's order and one ok source each, GET answers it back, and the bus carried one dashboard.refreshed v1", async () => {
    await fresh(async (world) => {
      await overviewHome(world);
      const events: OsEvent[] = [];
      world.ctx.events.subscribe((e) => {
        if (e.type === "dashboard.refreshed") events.push(e);
      });
      vi.useFakeTimers({ toFake: ["Date"], now: NOW });
      const res = await world.refresh("visao-geral");
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      const snap = res.body.snapshot;
      expect(Object.keys(snap).sort()).toEqual(["dashboardId", "generatedAt", "sources", "v", "widgets"]);
      expect(snap).toMatchObject({ v: 1, dashboardId: "visao-geral", generatedAt: NOW });
      const definition = (await world.get("visao-geral")).body.definition;
      expect(snap.widgets.map((x: Json) => x.id)).toEqual(definition.widgets.map((x: Json) => x.id));
      for (const widget of snap.widgets) {
        expect(widget.status, widget.id).toBe("ok");
        expect(widget.data, widget.id).toBeDefined();
      }
      const distinct = [
        ...new Set(
          definition.widgets.map((x: Json) =>
            x.source.kind === "connector" ? `connector:${x.source.id}` : x.source.kind,
          ),
        ),
      ];
      expect(snap.sources.map((s: Json) => s.id)).toEqual(distinct);
      expect(snap.sources.every((s: Json) => s.status === "ok")).toBe(true);
      const got = await world.get("visao-geral");
      expect(got.body.snapshot).toEqual(snap);
      const stored = world.ctx.db
        .prepare("SELECT json FROM dashboard_snapshots WHERE dashboard_id = 'visao-geral'")
        .get() as {
        json: string;
      };
      expect(JSON.parse(stored.json)).toEqual(snap);
      expect(events).toHaveLength(1);
      expect(events[0]!.v).toBe(1);
      expect(events[0]!.payload).toEqual({ id: "visao-geral", generatedAt: NOW, status: "ok" });
    });
  });
});

describe("C8 a failing source", () => {
  it("C8 (a) the calendar read rejects after dataTimeoutMs: only the agenda is in error with the message, its source too, every other widget keeps its data, the event says partial, and the snapshot is stored", async () => {
    await fresh(async (world) => {
      await overviewHome(world);
      world.update((s) => {
        s.connectors.dataTimeoutMs = 1_000;
      });
      vi.useFakeTimers({ toFake: ["Date"], now: NOW });
      const before = (await world.refresh("visao-geral")).body.snapshot;
      const timeoutMs = world.ctx.settings().connectors.dataTimeoutMs;
      const message = `The connector did not answer in ${timeoutMs} ms.`;
      // the read rejects once dataTimeoutMs has passed, as fetchConnectorData's own ceiling does
      fakeConnectorFetch(
        () =>
          new Promise<client.ConnectorData>((_, reject) =>
            setTimeout(() => reject(new Error(message)), timeoutMs),
          ),
      );
      const next = world.nextRefresh("visao-geral");
      const res = await world.refresh("visao-geral");
      expect(res.status).toBe(200);
      const snap = res.body.snapshot;
      expect(snap.widgets.find((x: Json) => x.id === "agenda")).toEqual({
        id: "agenda",
        kind: "agenda",
        status: "error",
        error: message,
      });
      expect(snap.sources.find((s: Json) => s.id === "connector:calendar-google")).toEqual({
        id: "connector:calendar-google",
        kind: "connector",
        status: "error",
        syncedAt: null,
        message,
      });
      for (const widget of snap.widgets.filter((x: Json) => x.id !== "agenda")) {
        expect(widget).toEqual(before.widgets.find((x: Json) => x.id === widget.id));
      }
      expect((await next).status).toBe("partial");
      expect((await world.get("visao-geral")).body.snapshot).toEqual(snap);
    });
  });
});

describe("C8 a failing source, at the route", () => {
  it("C8 (b) the reviews source throws: only the Revisões vencidas widget is in error, its source too, and the snapshot is stored and read back", async () => {
    await fresh(async (world) => {
      await overviewHome(world);
      vi.mocked(reviews.reviewsDue).mockImplementationOnce(() => {
        throw new Error("a fila de revisões caiu");
      });
      const next = world.nextRefresh("visao-geral");
      const res = await world.refresh("visao-geral");
      expect(res.status).toBe(200);
      const snap = res.body.snapshot;
      expect(snap.widgets.filter((x: Json) => x.status === "error")).toEqual([
        { id: "revisoes-kpi", kind: "kpi", status: "error", error: "a fila de revisões caiu" },
      ]);
      expect(snap.sources.find((s: Json) => s.id === "reviews")).toMatchObject({
        status: "error",
        message: "a fila de revisões caiu",
      });
      expect((await next).status).toBe("partial");
      expect((await world.get("visao-geral")).body.snapshot).toEqual(snap);
    });
  });

  it("C8 (c) every source of the dashboard throws: every widget is in error, the event says error, and the snapshot is stored and read back", async () => {
    await fresh(async (world) => {
      await overviewHome(world);
      const created = await world.get("visao-geral");
      const definition = {
        ...created.body.definition,
        widgets: created.body.definition.widgets.filter((x: Json) =>
          ["revisoes-kpi", "agenda"].includes(x.id),
        ),
      };
      const put = await world.call("PUT", "/api/dashboards/visao-geral", {
        definition,
        baseVersion: created.body.version,
      });
      expect(put.status, JSON.stringify(put.body)).toBe(200);
      vi.mocked(reviews.reviewsDue).mockImplementationOnce(() => {
        throw new Error("a fila caiu");
      });
      fakeConnectorFetch(async () => {
        throw new Error("o calendário caiu");
      });
      const next = world.nextRefresh("visao-geral");
      const res = await world.refresh("visao-geral");
      expect(res.status).toBe(200);
      const snap = res.body.snapshot;
      expect(snap.widgets.map((x: Json) => [x.id, x.status, x.error])).toEqual([
        ["revisoes-kpi", "error", "a fila caiu"],
        ["agenda", "error", "o calendário caiu"],
      ]);
      expect(snap.sources.map((s: Json) => s.status)).toEqual(["error", "error"]);
      expect((await next).status).toBe("error");
      expect((await world.get("visao-geral")).body.snapshot).toEqual(snap);
    });
  });
});

describe("C9 one refresh at a time", () => {
  it("C9 a second refresh while one waits on the connector is 409 and stores nothing, another dashboard refreshes, the third after it is 200, a failed refresh releases the lock, and a missing dashboard is 404", async () => {
    await fresh(async (world) => {
      await overviewHome(world);
      const root = world.indexedRoot("c9");
      world.context("projeto-x", "Projeto X", [root]);
      expect((await world.create({ template: "area", contextId: "projeto-x" })).status).toBe(201);
      let release!: (data: client.ConnectorData) => void;
      fakeConnectorFetch(() => new Promise<client.ConnectorData>((resolve) => (release = resolve)));
      const first = world.refresh("visao-geral");
      await vi.waitFor(() => expect(release).toBeDefined());
      const second = await world.refresh("visao-geral");
      expect(second.status).toBe(409);
      expect(second.body.error.code).toBe("refresh_in_progress");
      expect(
        world.ctx.db
          .prepare("SELECT COUNT(*) c FROM dashboard_snapshots WHERE dashboard_id = 'visao-geral'")
          .get(),
      ).toEqual({ c: 0 });
      const other = await world.refresh("contexto-projeto-x");
      expect(other.status, JSON.stringify(other.body)).toBe(200);
      release(calendarItems(NOW));
      expect((await first).status).toBe(200);
      fakeConnectorFetch(calendarItems(NOW));
      expect((await world.refresh("visao-geral")).status).toBe(200);

      const save = vi.spyOn(world.ctx.dashboards.store, "saveSnapshot").mockImplementationOnce(() => {
        throw new Error("disco cheio");
      });
      try {
        expect((await world.refresh("visao-geral")).status).toBe(500);
      } finally {
        save.mockRestore();
      }
      expect((await world.refresh("visao-geral")).status).toBe(200);

      const none = await world.refresh("nao-existe");
      expect(none.status).toBe(404);
      expect(none.body.error.code).toBe("dashboard_not_found");
    });
  });
});

// ---- the service's clock -----------------------------------------------------------------------------------------

async function freePort(): Promise<number> {
  return new Promise((resolve) => {
    const server = net.createServer().listen(0, "127.0.0.1", () => {
      const port = (server.address() as { port: number }).port;
      server.close(() => resolve(port));
    });
  });
}

const generatedAt = (ctx: AppContext, id: string) =>
  (
    ctx.db.prepare("SELECT generated_at FROM dashboard_snapshots WHERE dashboard_id = ?").get(id) as
      { generated_at: number } | undefined
  )?.generated_at ?? null;

/** A home with visao-geral and a manual dashboard refreshed at `at`, and a question dashboard, built by its routes. */
async function clockHome(at: number): Promise<{ home: string; cleanup: () => void }> {
  const temp = makeTempHome("mordomo-paineis-clock-");
  const ctx = new AppContext(temp.paths.home);
  const s = ctx.settings();
  s.setupCompleted = true;
  s.port = await freePort();
  s.indexedFolders = [];
  ctx.settingsStore.save(s);
  const app = await buildServer(ctx);
  const owner = { "x-mordomo-token": ctx.token(), "content-type": "application/json" };
  const call = async (method: "POST" | "PUT", url: string, payload: Json) => {
    const res = await app.inject({ method, url, headers: owner, payload });
    return { status: res.statusCode, body: res.json() as Json };
  };
  const clock = movingClock(at);
  try {
    expect((await call("POST", "/api/dashboards", { template: "overview" })).status).toBe(201);
    const manual = await call("POST", "/api/dashboards", { template: "overview" });
    const def = { ...manual.body.definition, title: "Manual", refresh: "manual" };
    expect(
      (
        await call("PUT", "/api/dashboards/visao-geral-2", {
          definition: def,
          baseVersion: manual.body.version,
        })
      ).status,
    ).toBe(200);
    expect(
      (await call("POST", "/api/dashboards", { template: "question", question: "Por quê?" })).status,
    ).toBe(201);
    expect((await call("POST", "/api/dashboards/visao-geral/refresh", {})).status).toBe(200);
    expect((await call("POST", "/api/dashboards/visao-geral-2/refresh", {})).status).toBe(200);
  } finally {
    clock.restore();
    await app.close();
    ctx.close();
  }
  return { home: temp.paths.home, cleanup: temp.cleanup };
}

describe("C10 the service's clock", () => {
  it("C10 the started service's tick refreshes visao-geral 16 min old and leaves a manual and a question dashboard as they were", async () => {
    const { home, cleanup } = await clockHome(NOW);
    const clock = movingClock(NOW + 16 * MIN);
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    const handle = await startServer(home);
    try {
      const refreshed = new Promise<Json>((resolve) =>
        handle.ctx.events.subscribe((e) => {
          if (e.type === "dashboard.refreshed") resolve(e.payload as Json);
        }),
      );
      expect(generatedAt(handle.ctx, "visao-geral")).toBeLessThan(NOW + 1_000);
      const manualBefore = generatedAt(handle.ctx, "visao-geral-2");
      vi.advanceTimersByTime(60_000);
      const event = await refreshed;
      expect(event.id).toBe("visao-geral");
      await vi.waitFor(() => expect(handle.ctx.dashboards.isRefreshing("visao-geral")).toBe(false));
      expect(generatedAt(handle.ctx, "visao-geral")).toBeGreaterThanOrEqual(NOW + 16 * MIN);
      expect(generatedAt(handle.ctx, "visao-geral-2")).toBe(manualBefore);
      expect(generatedAt(handle.ctx, "pergunta")).toBeNull();
    } finally {
      await handle.close();
      vi.useRealTimers();
      clock.restore();
      cleanup();
    }
  });

  it("C10 an engine that is built and never started runs no tick", async () => {
    const { home, cleanup } = await clockHome(NOW);
    const clock = movingClock(NOW + 16 * MIN);
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    const ctx = new AppContext(home);
    const app = await buildServer(ctx);
    try {
      const events: string[] = [];
      ctx.events.subscribe((e) => {
        if (e.type === "dashboard.refreshed") events.push((e.payload as Json).id);
      });
      vi.advanceTimersByTime(5 * 60_000);
      await new Promise((r) => setTimeout(r, 50));
      expect(events).toEqual([]);
      expect(generatedAt(ctx, "visao-geral")).toBeLessThan(NOW + 1_000);
    } finally {
      await app.close();
      ctx.close();
      vi.useRealTimers();
      clock.restore();
      cleanup();
    }
  });
});

// ---- the stale GET -----------------------------------------------------------------------------------------------

describe("C11 a stale GET", () => {
  it("C11 a 15m snapshot 20 min old is answered as it is and stale, then refreshed; a GET during that refresh starts none; manual and question dashboards are not refreshed", async () => {
    await fresh(async (world) => {
      await overviewHome(world);
      const clock = movingClock(NOW);
      try {
        const old = (await world.refresh("visao-geral")).body.snapshot;
        clock.set(NOW + 20 * MIN);
        let release!: (data: client.ConnectorData) => void;
        fakeConnectorFetch(() => new Promise<client.ConnectorData>((resolve) => (release = resolve)));
        const next = world.nextRefresh("visao-geral");
        const before = world.refreshed.length;
        const res = await world.get("visao-geral");
        expect(res.status).toBe(200);
        expect(res.body.stale).toBe(true);
        expect(res.body.snapshot.generatedAt).toBe(old.generatedAt);
        await vi.waitFor(() => expect(release).toBeDefined());
        const during = await world.get("visao-geral");
        expect(during.body.snapshot.generatedAt).toBe(old.generatedAt);
        release(calendarItems(NOW + 20 * MIN));
        const event = await next;
        expect(event.generatedAt).toBeGreaterThanOrEqual(NOW + 20 * MIN);
        await new Promise((r) => setTimeout(r, 20));
        expect(world.refreshed.length - before).toBe(1);
        expect((await world.get("visao-geral")).body.snapshot.generatedAt).toBe(event.generatedAt);

        // a manual dashboard and a question one: a GET long after stores nothing new
        const created = await world.create({ template: "overview" });
        const def = { ...created.body.definition, refresh: "manual" };
        await world.call("PUT", `/api/dashboards/${created.body.id}`, {
          definition: def,
          baseVersion: created.body.version,
        });
        fakeConnectorFetch(calendarItems(NOW));
        const manualAt = (await world.refresh(created.body.id)).body.snapshot.generatedAt;
        expect((await world.create({ template: "question", question: "Por quê?" })).status).toBe(201);
        clock.set(NOW + 40 * 1440 * MIN);
        const count = world.refreshed.length;
        expect((await world.get(created.body.id)).body.snapshot.generatedAt).toBe(manualAt);
        expect((await world.get("pergunta")).body.snapshot).toBeNull();
        await new Promise((r) => setTimeout(r, 50));
        expect(world.refreshed.length).toBe(count);
        expect(generatedAt(world.ctx, created.body.id)).toBe(manualAt);
        expect(generatedAt(world.ctx, "pergunta")).toBeNull();
      } finally {
        clock.restore();
      }
    });
  });
});

// ---- the context and the policy ----------------------------------------------------------------------------------

describe("C13 the context of an area", () => {
  it("C13 only rows of the context's ok path and its notes folder reach every memory source and their KPIs, never a look-alike folder; a deleted context puts every memory widget in error and a metrics widget stays ok", async () => {
    await fresh(async (world) => {
      const root = world.indexedRoot("c13");
      const proj = path.join(root, "proj");
      const old = path.join(root, "proj-old");
      const notes = path.join(world.memory, "notes", "projeto-x");
      const long = dayOf(NOW, -200);
      const places = { proj, notes, old };
      for (const [name, dir] of Object.entries(places)) {
        world.note(
          path.join(dir, `projeto-${name}.md`),
          { type: "project", status: "active" },
          `# Projeto ${name}\n\n- [ ] Tarefa ${name} 📅 ${TODAY}\n`,
        );
        world.note(
          path.join(dir, `decisao-${name}.md`),
          { type: "decision", natureza: "opiniao", last_reviewed: long },
          `# Decisão ${name}\n`,
        );
        assertFact(world.ctx.db, {
          subject: name,
          predicate: "é",
          object: "fato",
          sourcePath: path.join(dir, `decisao-${name}.md`),
        });
      }
      fs.mkdirSync(proj, { recursive: true });
      world.context("projeto-x", "Projeto X", [proj]);
      await world.index();
      world.ctx.sampleMetrics(NOW);
      const created = await world.create({ template: "area", contextId: "projeto-x" });
      const kinds = ["notes", "tasks", "decisions", "projects", "reviews", "facts"] as const;
      const source = (kind: (typeof kinds)[number]): Json =>
        kind === "tasks"
          ? { kind, window: "today" }
          : kind === "decisions"
            ? { kind, window: "week" }
            : { kind };
      const definition = {
        ...created.body.definition,
        widgets: [
          ...kinds.map((kind) => ({
            id: kind,
            kind: "list",
            title: kind,
            source: source(kind),
            options: { limit: 50 },
          })),
          // twelve widgets at most: the notes' count is its list's total
          ...kinds
            .filter((kind) => kind !== "notes")
            .map((kind) => ({
              id: `${kind}-kpi`,
              kind: "kpi",
              title: kind,
              source: source(kind),
              options: { measure: "count" },
            })),
          {
            id: "execucoes",
            kind: "kpi",
            title: "Execuções",
            source: { kind: "metrics", series: "runs24h" },
            options: { measure: "latest" },
          },
        ],
      };
      const put = await world.call("PUT", "/api/dashboards/contexto-projeto-x", {
        definition,
        baseVersion: created.body.version,
      });
      expect(put.status, JSON.stringify(put.body)).toBe(200);
      const snap = (await world.refresh("contexto-projeto-x")).body.snapshot;
      const pathsOf = (id: string): string[] =>
        snap.widgets.find((x: Json) => x.id === id).data.items.map((i: Json) => i.path ?? i.sourcePath);
      const inside = (p: string) => p.startsWith(proj + path.sep) || p.startsWith(notes + path.sep);
      for (const kind of kinds) {
        const seen = pathsOf(kind);
        expect(seen.length, kind).toBeGreaterThan(0);
        expect(seen.every(inside), `${kind}: ${seen.join(", ")}`).toBe(true);
        expect(
          seen.some((p) => p.startsWith(proj + path.sep)),
          kind,
        ).toBe(true);
        expect(
          seen.some((p) => p.startsWith(notes + path.sep)),
          kind,
        ).toBe(true);
        expect(
          seen.some((p) => p.startsWith(old + path.sep)),
          kind,
        ).toBe(false);
      }
      // one project, one decision, one task and one fact per place, two places
      expect(kpiOf(snap.widgets.find((x: Json) => x.id === "projects-kpi").data)).toEqual({ value: 2 });
      expect(kpiOf(snap.widgets.find((x: Json) => x.id === "decisions-kpi").data)).toEqual({ value: 2 });
      expect(kpiOf(snap.widgets.find((x: Json) => x.id === "tasks-kpi").data)).toEqual({ value: 2 });
      expect(kpiOf(snap.widgets.find((x: Json) => x.id === "facts-kpi").data)).toEqual({ value: 2 });
      expect(kpiOf(snap.widgets.find((x: Json) => x.id === "reviews-kpi").data)).toEqual({ value: 2 });
      expect(snap.widgets.find((x: Json) => x.id === "notes").data.total).toBe(4);

      world.update((s) => {
        s.contexts = s.contexts.filter((c) => c.id !== "projeto-x");
      });
      const gone = await world.refresh("contexto-projeto-x");
      expect(gone.status).toBe(200);
      for (const widget of gone.body.snapshot.widgets) {
        if (widget.id === "execucoes") expect(widget.status).toBe("ok");
        else
          expect(widget, widget.id).toMatchObject({
            status: "error",
            error: "O contexto deste painel não existe mais.",
          });
      }
    });
  });
});

describe("C14 today's policy and no file read", () => {
  it("C14 a project with a task due today in a folder now excluded (its row still indexed) is in no widget, no KPI; the refresh opens no note or indexed file", async () => {
    await fresh(async (world) => {
      await overviewHome(world);
      const root = world.indexedRoot("c14");
      const hidden = world.note(
        path.join(root, "privado", "segredo.md"),
        { type: "project", status: "active", due: dayOf(NOW, -1) },
        `# Segredo\n\n- [ ] Tarefa secreta 📅 ${TODAY}\n`,
      );
      await world.index();
      // Room for every reminder the home asks for, so that the hidden note's would be among them (batch B: the
      // highlights and the reminders exist, and the "before" below proves they would name it).
      world.update((s) => {
        s.dashboards = { reminders: { maxPerDay: 20, at: "08:30" } };
      });
      vi.useFakeTimers({ toFake: ["Date"], now: NOW });
      const before = (await world.refresh("visao-geral")).body.snapshot;
      expect(JSON.stringify(before)).toContain(hidden);
      const kpi = (snap: Json, id: string) => kpiOf(snap.widgets.find((x: Json) => x.id === id).data);
      expect(kpi(before, "prioridades-kpi")).toEqual({ value: 0, of: 3 });
      expect(kpi(before, "projetos-kpi")).toEqual({ value: 1, of: 2 });
      const hiddenId = (
        world.ctx.db.prepare("SELECT id FROM files WHERE path = ?").get(hidden) as { id: number }
      ).id;
      // While the folder is not excluded, the note reaches the highlights by both paths (its task due today, its
      // project behind) and the reminders by both rules.
      const shown = (await world.get("visao-geral")).body.highlights as Json[];
      expect(shown).toContainEqual({
        rule: "due_today",
        title: "Tarefa secreta",
        tone: "warn",
        target: `/brain?sel=${hiddenId}`,
      });
      const remindedBefore = world.ctx.db
        .prepare("SELECT * FROM notifications WHERE kind = 'reminder'")
        .all() as Json[];
      expect(remindedBefore.map((r) => r.title)).toEqual(
        expect.arrayContaining(["Due today: Tarefa secreta", "Project behind: Segredo"]),
      );
      // The inbox starts the day again, so what the next refresh writes is what it found.
      world.ctx.db.prepare("DELETE FROM notifications").run();
      // ... and the record of what the day already gave (amendment 30), so the "after" refresh may give them again.
      world.ctx.db.prepare("DELETE FROM meta WHERE key LIKE 'dashboards.reminders.%'").run();

      world.update((s) => {
        s.excludes = [...s.excludes, "privado"];
      });
      expect(world.ctx.db.prepare("SELECT COUNT(*) c FROM files WHERE path = ?").get(hidden)).toEqual({
        c: 1,
      });

      const home = fs.realpathSync(world.home);
      // Every read entry of node:fs, not only openSync (round 1, F6: a utf8 readFileSync never calls it).
      const recorder = await recordFileReads((p) => p.startsWith(home) || p.startsWith(root));
      const opened = recorder.paths;
      const reads = [vi.mocked(safeFs.readWorkspaceText), vi.mocked(safeFs.readWorkspaceFile)];
      reads.forEach((r) => r.mockClear());
      let after: Json;
      try {
        after = (await world.refresh("visao-geral")).body.snapshot;
      } finally {
        recorder.restore();
      }
      const text = JSON.stringify(after);
      expect(text).not.toContain(hidden);
      expect(text).not.toContain("Tarefa secreta");
      expect(text).not.toContain("Segredo");
      expect(kpi(after, "prioridades-kpi")).toEqual({ value: 0, of: 2 });
      expect(kpi(after, "projetos-kpi")).toEqual({ value: 1, of: 1 });
      const got = await world.get("visao-geral");
      const highlights = got.body.highlights as Json[];
      // the highlights are there (the two tasks due today of the home) and none is the hidden note's
      expect(highlights.map((h) => h.title)).toEqual(
        expect.arrayContaining(["Mandar a proposta", "Avisar o time"]),
      );
      expect(highlights.filter((h) => h.target === `/brain?sel=${hiddenId}`)).toEqual([]);
      expect(JSON.stringify(highlights)).not.toContain("Tarefa secreta");
      expect(JSON.stringify(highlights)).not.toContain("Segredo");
      const reminders = world.ctx.db
        .prepare("SELECT * FROM notifications WHERE kind = 'reminder'")
        .all() as Json[];
      // the reminders are written (the same two tasks) and none names the hidden note
      expect(reminders.map((r) => r.title).sort()).toEqual([
        "Due today: Avisar o time",
        "Due today: Mandar a proposta",
      ]);
      expect(JSON.stringify(reminders)).not.toContain(hidden);
      expect(JSON.stringify(reminders)).not.toContain("Tarefa secreta");
      expect(JSON.stringify(reminders)).not.toContain("Segredo");
      expect(reminders.filter((r) => r.href === `/brain?sel=${hiddenId}`)).toEqual([]);

      // The files a refresh opens are the data of the routes - the dashboard's own definition and the connector's
      // configuration - and never a note or an indexed file (door 2: the index and the routes' data only).
      const routesData = [
        fs.realpathSync(path.join(world.memory, "dashboards", "visao-geral.json")),
        fs.realpathSync(path.join(world.ctx.paths.connectors, "calendar-google.json")),
      ];
      const safeReads = reads.flatMap((r) => r.mock.calls.map(([, file]) => fs.realpathSync(String(file))));
      const seen = [...opened, ...safeReads].map((p) => fs.realpathSync(p));
      // the recorder sees what is opened: the definition is read, by the route, through the safe reader
      expect(seen).toContain(routesData[0]);
      expect(seen.filter((p) => !routesData.includes(p))).toEqual([]);
      // and the code that evaluates reads no file by itself (the raw-read audit of tests/fsReadAudit.ts)
      const dashboards = path.join(repoRoot, "core", "src", "dashboards");
      expect(
        auditFiles(
          repoRoot,
          fs.readdirSync(dashboards).map((f) => path.join(dashboards, f)),
        ),
      ).toEqual([]);
    });
  });
});

afterAll(() => {
  vi.restoreAllMocks();
});
beforeAll(() => {
  fakeConnectorFetch(calendarItems(NOW));
});
