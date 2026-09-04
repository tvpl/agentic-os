import { describe, expect, it, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import type { FastifyInstance } from "fastify";
import { AppContext } from "../apps/api/src/context.js";
import { buildServer } from "../apps/api/src/server.js";
import { makeTempHome } from "./helpers.js";
import { events, localDateString } from "@mordomo/core";

let ctx: AppContext;
let app: FastifyInstance;
let token: string;
let cleanup: () => void;
let budgetPath: string;
const auth = () => ({ "x-mordomo-token": token });
const today = localDateString();

beforeAll(async () => {
  const tmp = makeTempHome();
  cleanup = tmp.cleanup;
  const workspace = path.join(tmp.paths.home, "workspace");
  fs.mkdirSync(path.join(workspace, "finance"), { recursive: true });
  budgetPath = path.join(workspace, "finance", "budget-2026.md");
  fs.writeFileSync(
    budgetPath,
    [
      "# Budget 2026",
      "",
      "owner:: Ana",
      "status:: approved",
      "",
      "## Q3",
      "",
      "The Q3 budget was approved at 42000 BRL.",
      "",
    ].join("\n"),
  );
  fs.writeFileSync(path.join(workspace, "notes.md"), "# Notes\n\nUnrelated remarks.\n");

  ctx = new AppContext(tmp.paths.home);
  const settings = ctx.settings();
  settings.indexedFolders = [{ path: workspace, area: "Finanças", enabled: true }];
  settings.areas = ["Finanças"];
  settings.setupCompleted = true;
  settings.timezone = "UTC";
  ctx.settingsStore.save(settings);
  token = ctx.token();
  app = await buildServer(ctx);
  await app.inject({ method: "POST", url: "/api/memory/index", headers: auth() });
});

afterAll(async () => {
  await app.close();
  ctx.close();
  cleanup();
});

describe("memory v2 API — recall", () => {
  it("answers a question with sections, and requires a token", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/memory/recall?q=" + encodeURIComponent("What was the Q3 budget approved?") + "&k=2",
      headers: auth(),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      keywords: string[];
      answerContext: Array<{ path: string; section: string; excerpt: string; score: number; why: string }>;
      tokensEstimate: number;
      candidatesConsidered: number;
      opened: number;
    };
    expect(body.keywords).toContain("budget");
    expect(body.opened).toBeLessThanOrEqual(2);
    const hit = body.answerContext.find((c) => c.path === budgetPath)!;
    expect(hit.section).toBe("Q3");
    expect(hit.excerpt).toContain("42000 BRL");
    expect(hit.why.length).toBeGreaterThan(0);
    expect(body.tokensEstimate).toBeGreaterThan(0);
    expect(body.candidatesConsidered).toBeGreaterThan(0);

    const noToken = await app.inject({ method: "GET", url: "/api/memory/recall?q=budget" });
    expect(noToken.statusCode).toBe(401);
    const noQuestion = await app.inject({ method: "GET", url: "/api/memory/recall", headers: auth() });
    expect(noQuestion.statusCode).toBe(400);
  });

  it("counts recalls in the stats used by consolidation", async () => {
    const res = await app.inject({ method: "GET", url: "/api/memory/recall/stats", headers: auth() });
    const stats = res.json() as { totalRecalls: number; paths: Array<{ path: string; count: number }> };
    expect(stats.totalRecalls).toBeGreaterThanOrEqual(1);
    expect(stats.paths.some((p) => p.path === budgetPath)).toBe(true);
  });
});

describe("memory v2 API — journal", () => {
  it("creates today's journal on first read and appends under a section", async () => {
    const first = await app.inject({ method: "GET", url: "/api/memory/journal", headers: auth() });
    expect(first.statusCode).toBe(200);
    const day = first.json() as {
      date: string;
      path: string;
      created: boolean;
      sections: Array<{ name: string }>;
    };
    expect(day.date).toBe(today);
    expect(day.created).toBe(true);
    expect(day.sections.map((s) => s.name)).toEqual(["Today", "Decisions", "Open loops", "Runs"]);
    expect(fs.existsSync(day.path)).toBe(true);

    const appended = await app.inject({
      method: "POST",
      url: "/api/memory/journal/append",
      headers: auth(),
      payload: { text: "Q3 budget approved", section: "Decisions", timestamp: false },
    });
    expect(appended.statusCode).toBe(200);
    const body = appended.json() as { content: string; sections: Array<{ name: string; lines: string[] }> };
    expect(body.sections.find((s) => s.name === "Decisions")!.lines).toEqual(["- Q3 budget approved"]);
    expect(body.content).toContain("## Runs");
  });

  it("reads a window of days and rejects an invalid date", async () => {
    const window = await app.inject({ method: "GET", url: "/api/memory/journal?days=3", headers: auth() });
    const body = window.json() as { today: string; days: Array<{ date: string }> };
    expect(body.today).toBe(today);
    expect(body.days[0]!.date).toBe(today);
    const bad = await app.inject({
      method: "GET",
      url: "/api/memory/journal?date=2026-02-30",
      headers: auth(),
    });
    expect(bad.statusCode).toBe(400);
  });

  it("logs finished runs into today's journal through the event bus", async () => {
    events.emit("run.finished", { runId: "run-api-1", status: "done", durationMs: 1200 });
    const res = await app.inject({ method: "GET", url: "/api/memory/journal", headers: auth() });
    const day = res.json() as { sections: Array<{ name: string; lines: string[] }> };
    expect(day.sections.find((s) => s.name === "Runs")!.lines.join("\n")).toContain("run-api-1 → done");
  });

  it("indexes the journal folder so recall can reach it", async () => {
    await app.inject({
      method: "POST",
      url: "/api/memory/journal/append",
      headers: auth(),
      payload: { text: "Zanzibar shipment tracking decided", section: "Decisions", timestamp: false },
    });
    await app.inject({ method: "POST", url: "/api/memory/index", headers: auth() });
    const res = await app.inject({
      method: "GET",
      url: "/api/memory/recall?q=zanzibar%20shipment",
      headers: auth(),
    });
    const body = res.json() as { answerContext: Array<{ path: string }> };
    expect(body.answerContext.some((c) => c.path.includes(path.join("memory", "journal")))).toBe(true);
  });
});

describe("memory v2 API — hygiene", () => {
  it("reports counts, items and thresholds", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/memory/hygiene?staleDays=1&perKind=5",
      headers: auth(),
    });
    expect(res.statusCode).toBe(200);
    const report = res.json() as {
      generatedAt: number;
      counts: Record<string, number>;
      items: Array<{ kind: string; id: string; name: string; detail: string; action: string }>;
      thresholds: { staleDays: number; silentRoutineDays: number; unusedConnectorDays: number };
    };
    expect(report.thresholds.staleDays).toBe(1);
    expect(Object.keys(report.counts).sort()).toEqual([
      "dangling-link",
      "orphan",
      "silent-routine",
      "skill-never-run",
      "stale",
      "unused-connector",
    ]);
    expect(report.counts.orphan).toBeGreaterThanOrEqual(1);
    expect(report.items.every((i) => i.kind && i.id && i.name && i.detail && i.action)).toBe(true);
    for (const kind of Object.keys(report.counts)) {
      expect(report.items.filter((i) => i.kind === kind).length).toBeLessThanOrEqual(5);
    }
  });
});

describe("memory v2 API — facts", () => {
  it("asserts, supersedes, queries as-of and retracts", async () => {
    const created = await app.inject({
      method: "POST",
      url: "/api/memory/facts",
      headers: auth(),
      payload: { subject: "acme", predicate: "status", object: "prospect", validFrom: 1000 },
    });
    expect(created.statusCode).toBe(201);

    const same = await app.inject({
      method: "POST",
      url: "/api/memory/facts",
      headers: auth(),
      payload: { subject: "acme", predicate: "status", object: "prospect" },
    });
    expect(same.statusCode).toBe(200);
    expect((same.json() as { unchanged: boolean }).unchanged).toBe(true);

    const replaced = await app.inject({
      method: "POST",
      url: "/api/memory/facts",
      headers: auth(),
      payload: {
        subject: "acme",
        predicate: "status",
        object: "client",
        validFrom: 2000,
        sourcePath: budgetPath,
      },
    });
    expect(replaced.statusCode).toBe(201);
    expect((replaced.json() as { invalidated: unknown[] }).invalidated).toHaveLength(1);

    const current = await app.inject({
      method: "GET",
      url: "/api/memory/facts?subject=acme",
      headers: auth(),
    });
    const body = current.json() as {
      facts: Array<{ id: number; object: string }>;
      stats: { open: number; expired: number };
    };
    expect(body.facts.map((f) => f.object)).toEqual(["client"]);
    expect(body.stats).toMatchObject({ open: 1, expired: 1 });

    const asOf = await app.inject({
      method: "GET",
      url: "/api/memory/facts?subject=acme&asOf=1500",
      headers: auth(),
    });
    expect((asOf.json() as { facts: Array<{ object: string }> }).facts.map((f) => f.object)).toEqual([
      "prospect",
    ]);

    const history = await app.inject({
      method: "GET",
      url: "/api/memory/facts?subject=acme&includeExpired=true",
      headers: auth(),
    });
    expect((history.json() as { facts: unknown[] }).facts).toHaveLength(2);

    const id = body.facts[0]!.id;
    const retracted = await app.inject({
      method: "POST",
      url: `/api/memory/facts/${id}/retract`,
      headers: auth(),
    });
    expect(retracted.statusCode).toBe(200);
    expect((retracted.json() as { validTo: number | null }).validTo).not.toBeNull();
    const missing = await app.inject({
      method: "POST",
      url: "/api/memory/facts/99999/retract",
      headers: auth(),
    });
    expect(missing.statusCode).toBe(404);
  });
});

describe("memory v2 API — inline field query", () => {
  it("queries notes by `key:value` and by substring", async () => {
    const exact = await app.inject({
      method: "GET",
      url: "/api/memory/query?where=status:approved",
      headers: auth(),
    });
    expect(exact.statusCode).toBe(200);
    const body = exact.json() as {
      where: string;
      files: Array<{ path: string; fields: Record<string, string> }>;
    };
    expect(body.where).toBe("status:approved");
    expect(body.files.map((f) => f.path)).toContain(budgetPath);
    expect(body.files.find((f) => f.path === budgetPath)!.fields).toEqual({
      owner: "Ana",
      status: "approved",
    });

    const partial = await app.inject({
      method: "GET",
      url: "/api/memory/query?where=owner:~an",
      headers: auth(),
    });
    expect((partial.json() as { files: unknown[] }).files).toHaveLength(1);
    const none = await app.inject({
      method: "GET",
      url: "/api/memory/query?where=status:rejected",
      headers: auth(),
    });
    expect((none.json() as { files: unknown[] }).files).toEqual([]);
    const invalid = await app.inject({ method: "GET", url: "/api/memory/query", headers: auth() });
    expect(invalid.statusCode).toBe(400);
  });
});
