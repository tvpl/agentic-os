import { describe, expect, it, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  ConnectorSchema,
  EventBus,
  MemoryIndexer,
  RoutineSchema,
  SettingsStore,
  appendJournal,
  assertFact,
  buildGraph,
  ensureJournal,
  extractKeywords,
  factStats,
  generateRouters,
  installJournalHooks,
  isJournalDate,
  journalSections,
  journalTemplate,
  listJournalDates,
  localDateString,
  memoryHygiene,
  openDb,
  parseInlineFields,
  parseWhere,
  queryFacts,
  queryFilesByField,
  readJournal,
  recall,
  recallStats,
  recordRecall,
  recentJournals,
  renderJournalBlock,
  retractFact,
  scoreSection,
  shiftDate,
  splitSections,
  stemLite,
  type Db,
  type MordomoPaths,
  type Settings,
} from "@mordomo/core";
import { makeTempHome } from "./helpers.js";

let ctx: { paths: MordomoPaths; cleanup: () => void };
let db: Db;
let store: SettingsStore;
let workspace: string;
let budgetPath: string;
let acmePath: string;
let notesPath: string;

const settings = (): Settings => store.load();

beforeEach(() => {
  ctx = makeTempHome();
  db = openDb(ctx.paths).db;
  store = new SettingsStore(ctx.paths);
  workspace = path.join(ctx.paths.home, "workspace");
  fs.mkdirSync(path.join(workspace, "finance"), { recursive: true });
  fs.mkdirSync(path.join(workspace, "vendors"), { recursive: true });

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
      "The Q3 budget was approved at 42000 BRL for the São Paulo office.",
      "Signed off in [the Acme contract](../vendors/acme.md).",
      "",
      "## Q4",
      "",
      "Nothing decided yet.",
      "",
    ].join("\n"),
  );
  acmePath = path.join(workspace, "vendors", "acme.md");
  fs.writeFileSync(
    acmePath,
    [
      "# Acme",
      "",
      "## Q3 budget approval",
      "",
      "The Acme contract carries the approved Q3 budget: 42000 BRL, signed by Ana.",
      "The budget line is fixed until the approved renewal date.",
      "",
    ].join("\n"),
  );
  notesPath = path.join(workspace, "notes.md");
  fs.writeFileSync(notesPath, "# Notes\n\nGeneral remarks about nothing in particular.\n");

  store.update({
    indexedFolders: [{ path: workspace, area: "Finanças", enabled: true }],
    areas: ["Finanças", "Projetos"],
  });
});

afterEach(() => {
  db.close();
  ctx.cleanup();
});

function index(): void {
  new MemoryIndexer(db, () => settings()).indexAll();
}

// --------------------------------------------------------------- keywords ----

describe("recall — keyword extraction", () => {
  it("drops en/pt stopwords, folds accents and stems lightly", () => {
    const en = extractKeywords("What did we decide about the Q3 budget?");
    expect(en).toContain("q3");
    expect(en).toContain("budget");
    expect(en).not.toContain("the");
    expect(en).not.toContain("about");

    const pt = extractKeywords("O que sabemos sobre o orçamento do trimestre?");
    expect(pt).toContain("orcamento");
    expect(pt).not.toContain("que");
    expect(pt).not.toContain("sobre");
    expect(pt).not.toContain("do");
  });

  it("keeps path-like tokens whole and caps the list at 8", () => {
    const kws = extractKeywords("Where is core/src/memory/recall.ts and budget-2026.md?");
    expect(kws).toContain("core/src/memory/recall.ts");
    expect(kws).toContain("budget-2026.md");
    expect(extractKeywords("alpha beta gamma delta epsilon zeta eta theta iota kappa")).toHaveLength(8);
  });

  it("is deterministic and de-duplicated", () => {
    const q = "budget budget Q3 Q3 planning";
    expect(extractKeywords(q)).toEqual(extractKeywords(q));
    expect(extractKeywords(q)).toEqual(["budget", "q3", "plann"]); // "planning" → -ing stripped
  });

  it("stems only tokens long enough to survive it", () => {
    expect(stemLite("cats")).toBe("cats"); // <= 4 chars, untouched
    expect(stemLite("approved")).toBe("approv");
    expect(stemLite("decisoes")).toBe("decisao");
  });
});

// --------------------------------------------------------------- sections ----

describe("recall — section splitting and scoring", () => {
  it("splits markdown by heading and ignores headings inside code fences", () => {
    const sections = splitSections(
      ["# Title", "", "intro", "", "```", "# not a heading", "```", "", "## Real", "", "body", ""].join("\n"),
      true,
    );
    expect(sections.map((s) => s.heading)).toEqual(["Title", "Real"]);
    expect(sections[0]!.body).toContain("# not a heading");
  });

  it("keeps a preamble as (top) and chunks non-markdown by lines", () => {
    const md = splitSections("preamble text\n\n## After\n\nbody\n", true);
    expect(md[0]).toMatchObject({ heading: "(top)", level: 0 });
    const txt = splitSections(Array.from({ length: 90 }, (_, i) => `line ${i}`).join("\n"), false);
    expect(txt).toHaveLength(3);
    expect(txt[0]!.heading).toBe("lines 1-40");
  });

  it("scores a heading match above a body match and rewards coverage", () => {
    const heading = scoreSection({ heading: "Q3 budget", body: "nothing here", level: 2 }, ["q3", "budget"]);
    const body = scoreSection({ heading: "Notes", body: "the q3 budget line", level: 2 }, ["q3", "budget"]);
    const single = scoreSection({ heading: "Notes", body: "budget budget budget", level: 2 }, [
      "q3",
      "budget",
    ]);
    expect(heading.score).toBeGreaterThan(body.score);
    expect(body.score).toBeGreaterThan(single.score);
    expect(heading.matched).toEqual(["q3", "budget"]);
  });
});

// ----------------------------------------------------------------- recall ----

describe("recall — layered retrieval", () => {
  it("returns the matching section of the best file with a token estimate", () => {
    index();
    const result = recall(db, ctx.paths, settings(), "What was the Q3 budget approved?");
    expect(result.candidatesConsidered).toBeGreaterThanOrEqual(2);
    expect(result.answerContext.length).toBeGreaterThan(0);
    const budget = result.answerContext.find((c) => c.path === budgetPath);
    expect(budget).toBeDefined();
    expect(budget!.section).toBe("Q3");
    expect(budget!.excerpt).toContain("42000 BRL");
    expect(budget!.why).toContain("keywords in the index");
    // Nothing that does not match is opened or returned.
    expect(result.answerContext.some((c) => c.path === notesPath)).toBe(false);
    expect(result.tokensEstimate).toBe(
      result.answerContext.reduce((n, c) => n + Math.ceil(c.excerpt.length / 4), 0),
    );
  });

  it("opens at most K files and never opens one twice", () => {
    for (let i = 0; i < 5; i++) {
      fs.writeFileSync(
        path.join(workspace, `budget-note-${i}.md`),
        `# Budget note ${i}\n\nThe budget was approved.\n`,
      );
    }
    index();
    const result = recall(db, ctx.paths, settings(), "budget approved", { k: 2, pointerLimit: 0 });
    expect(result.opened).toBe(2);
    expect(result.candidatesConsidered).toBeGreaterThan(2);
    expect(new Set(result.answerContext.map((c) => c.path)).size).toBe(result.answerContext.length);
  });

  it("follows one level of pointers when the pointed section scores higher", () => {
    index();
    const result = recall(db, ctx.paths, settings(), "What was the Q3 budget approved?", { k: 1 });
    const pointed = result.answerContext.find((c) => c.via === budgetPath);
    expect(pointed).toBeDefined();
    expect(pointed!.path).toBe(acmePath);
    expect(pointed!.section).toBe("Q3 budget approval");
    expect(pointed!.why).toContain("pointer from budget-2026.md");
    // One level only: the pointed file's own links are not followed.
    expect(result.answerContext.every((c) => c.via === undefined || c.via === budgetPath)).toBe(true);
  });

  it("is deterministic and ignores the generated routers", () => {
    index();
    generateRouters(db, ctx.paths, settings());
    index();
    const a = recall(db, ctx.paths, settings(), "Q3 budget");
    const b = recall(db, ctx.paths, settings(), "Q3 budget");
    expect({ ...a, durationMs: 0 }).toEqual({ ...b, durationMs: 0 });
    const areas = path.join(ctx.paths.memory, "areas");
    for (const c of a.answerContext) {
      expect(c.path.startsWith(areas)).toBe(false);
      expect(c.path).not.toBe(path.join(ctx.paths.memory, "ROUTER.md"));
    }
  });

  it("returns nothing for a question made only of stopwords", () => {
    index();
    const result = recall(db, ctx.paths, settings(), "o que é isso?");
    expect(result.keywords).toEqual([]);
    expect(result.answerContext).toEqual([]);
    expect(result.tokensEstimate).toBe(0);
  });

  it("records recall frequency per path", () => {
    index();
    const result = recall(db, ctx.paths, settings(), "Q3 budget");
    recordRecall(db, result, 1_000);
    recordRecall(db, result, 2_000);
    const stats = recallStats(db);
    expect(stats.totalRecalls).toBe(2);
    expect(stats.totalTokens).toBe(result.tokensEstimate * 2);
    expect(stats.lastAt).toBe(2_000);
    expect(stats.paths[0]!.count).toBe(2);
  });
});

// ---------------------------------------------------------------- journal ----

describe("daily journal", () => {
  it("creates the day's file from the template on first access only", () => {
    const first = ensureJournal(ctx.paths, "2026-09-03");
    expect(first.created).toBe(true);
    expect(first.content).toBe(journalTemplate("2026-09-03"));
    expect(first.content).toContain("# 2026-09-03 — Thursday");
    for (const section of ["Today", "Decisions", "Open loops", "Runs"]) {
      expect(first.content).toContain(`## ${section}`);
    }
    const second = ensureJournal(ctx.paths, "2026-09-03");
    expect(second.created).toBe(false);
  });

  it("validates dates and shifts them across month boundaries", () => {
    expect(isJournalDate("2026-02-30")).toBe(false);
    expect(isJournalDate("2026-2-3")).toBe(false);
    expect(isJournalDate("2026-03-01")).toBe(true);
    expect(shiftDate("2026-03-01", -1)).toBe("2026-02-28");
    expect(localDateString(new Date(2026, 8, 3))).toBe("2026-09-03");
  });

  it("appends bullets under the right section without rewriting history", () => {
    appendJournal(ctx.paths, {
      date: "2026-09-03",
      section: "Decisions",
      text: "Q3 budget approved",
      timestamp: false,
    });
    const day = appendJournal(ctx.paths, {
      date: "2026-09-03",
      section: "Today",
      text: "wrote the memory guide",
      timestamp: false,
    });
    const sections = journalSections(day.content);
    expect(sections.find((s) => s.name === "Decisions")!.lines).toEqual(["- Q3 budget approved"]);
    expect(sections.find((s) => s.name === "Today")!.lines).toEqual(["- wrote the memory guide"]);
    expect(day.content).toContain("## Open loops");
    // A second decision lands under the same heading, after the first.
    const again = appendJournal(ctx.paths, {
      date: "2026-09-03",
      section: "Decisions",
      text: "hired Acme",
      timestamp: false,
    });
    expect(journalSections(again.content).find((s) => s.name === "Decisions")!.lines).toEqual([
      "- Q3 budget approved",
      "- hired Acme",
    ]);
    expect(again.content).toContain("Q3 budget approved");
  });

  it("appends a missing section at the end instead of failing", () => {
    const file = ensureJournal(ctx.paths, "2026-09-03").path;
    fs.writeFileSync(file, "# 2026-09-03\n\n## Today\n\n");
    const day = appendJournal(ctx.paths, {
      date: "2026-09-03",
      section: "Runs",
      text: "run r1 → done",
      timestamp: false,
    });
    expect(day.content.trimEnd().endsWith("- run r1 → done")).toBe(true);
    expect(journalSections(day.content).map((s) => s.name)).toEqual(["Today", "Runs"]);
  });

  it("lists dates newest first and reads a window of recent days", () => {
    ensureJournal(ctx.paths, "2026-09-01");
    ensureJournal(ctx.paths, "2026-09-03");
    expect(listJournalDates(ctx.paths)).toEqual(["2026-09-03", "2026-09-01"]);
    expect(recentJournals(ctx.paths, 3, "2026-09-03").map((d) => d.date)).toEqual([
      "2026-09-03",
      "2026-09-01",
    ]);
    expect(readJournal(ctx.paths, "2026-09-02")).toBeNull();
  });

  it("renders today + yesterday into the router under a token budget", () => {
    appendJournal(ctx.paths, {
      date: "2026-09-03",
      section: "Today",
      text: "x".repeat(1500),
      timestamp: false,
    });
    appendJournal(ctx.paths, {
      date: "2026-09-02",
      section: "Today",
      text: "y".repeat(1500),
      timestamp: false,
    });
    const days = [readJournal(ctx.paths, "2026-09-03")!, readJournal(ctx.paths, "2026-09-02")!];
    const block = renderJournalBlock(days, 200).join("\n");
    expect(block.length).toBeLessThanOrEqual(200 * 4 + 64);
    expect(block).toContain("…(trimmed)");
    expect(block).toContain("<!-- journal:start -->");
    expect(block).toContain("<!-- journal:end -->");
    const generous = renderJournalBlock(days, 4000).join("\n");
    expect(generous).toContain("### 2026-09-02");
    expect(generous).not.toContain("…(trimmed)");
  });

  it("injects the journal into the master router and indexes memory/", () => {
    appendJournal(ctx.paths, { section: "Decisions", text: "keep the routers generated", timestamp: false });
    generateRouters(db, ctx.paths, settings());
    const router = fs.readFileSync(path.join(ctx.paths.memory, "ROUTER.md"), "utf8");
    expect(router).toContain("keep the routers generated");
    expect(router).toContain("mordomo recall");

    const indexer = new MemoryIndexer(db, () => settings());
    installJournalHooks(new EventBus(), ctx.paths, { indexer });
    indexer.indexAll();
    const journalFile = path.join(ctx.paths.memory, "journal", `${localDateString()}.md`);
    const row = db.prepare("SELECT path FROM files WHERE path = ?").get(journalFile) as
      { path: string } | undefined;
    expect(row?.path).toBe(journalFile);
  });

  it("writes one line per finished run, once, and stops on dispose", () => {
    const bus = new EventBus();
    const dispose = installJournalHooks(bus, ctx.paths);
    const again = installJournalHooks(bus, ctx.paths); // idempotent: same bus + same memory dir
    expect(again).toBe(dispose);

    bus.emit("run.finished", { runId: "run-1", status: "done", durationMs: 4200 });
    bus.emit("run.started", { runId: "run-2" });
    let runs = journalSections(readJournal(ctx.paths, localDateString())!.content).find(
      (s) => s.name === "Runs",
    )!;
    expect(runs.lines).toHaveLength(1);
    expect(runs.lines[0]).toContain("run run-1 → done in 4s");

    dispose();
    bus.emit("run.finished", { runId: "run-3", status: "failed" });
    runs = journalSections(readJournal(ctx.paths, localDateString())!.content).find(
      (s) => s.name === "Runs",
    )!;
    expect(runs.lines).toHaveLength(1);
  });
});

// ---------------------------------------------------------------- hygiene ----

describe("hygiene", () => {
  const routine = (over: Record<string, unknown>) =>
    RoutineSchema.parse({ id: "r", name: "R", schedule: "0 3 * * *", createdAt: 0, ...over });
  const connector = (over: Record<string, unknown>) =>
    ConnectorSchema.parse({ id: "c", name: "C", kind: "mcp", origin: "test", maintainer: "test", ...over });

  it("reports orphans, stale files, skills never run, silent routines and unused connectors", () => {
    const now = Date.UTC(2026, 8, 3);
    const old = now - 200 * 86_400_000;
    fs.utimesSync(notesPath, new Date(old), new Date(old));
    index();

    db.prepare(
      "INSERT INTO runs (id, created_at, origin, provider, status, skill_slug) VALUES ('run-1', ?, 'skill', 'claude', 'done', 'recall')",
    ).run(now);
    db.prepare("INSERT INTO routine_history (routine_id, fired_at, status) VALUES ('fresh', ?, 'fired')").run(
      now - 86_400_000,
    );

    const report = memoryHygiene(
      db,
      ctx.paths,
      settings(),
      {
        skills: [
          { slug: "recall", name: "Recall" },
          { slug: "consolidate-memory", name: "Consolidate Memory" },
        ],
        routines: [
          routine({ id: "fresh", name: "Fresh", enabled: true }),
          routine({ id: "silent", name: "Silent", enabled: true }),
          routine({ id: "young", name: "Young", createdAt: now - 86_400_000 }),
        ],
        connectors: [
          connector({ id: "gmail", name: "Gmail", lastUsedAt: now - 86_400_000 }),
          connector({ id: "notion", name: "Notion", lastUsedAt: null }),
        ],
      },
      { now },
    );

    expect(report.thresholds).toEqual({ staleDays: 90, silentRoutineDays: 30, unusedConnectorDays: 30 });
    expect(report.counts.stale).toBe(1);
    expect(report.items.find((i) => i.kind === "stale")!.id).toBe(notesPath);
    expect(report.counts.orphan).toBeGreaterThanOrEqual(1);
    expect(report.items.some((i) => i.kind === "orphan" && i.id === notesPath)).toBe(true);
    expect(report.counts["skill-never-run"]).toBe(1);
    expect(report.items.find((i) => i.kind === "skill-never-run")!.id).toBe("consolidate-memory");
    // "fresh" fired yesterday and "young" was created yesterday: only "silent" is listed.
    expect(report.items.filter((i) => i.kind === "silent-routine").map((i) => i.id)).toEqual(["silent"]);
    expect(report.items.filter((i) => i.kind === "unused-connector").map((i) => i.id)).toEqual(["notion"]);
    expect(report.items.every((i) => i.name && i.detail && i.action)).toBe(true);
  });

  it("prefers the scheduler's silent list over the local history query", () => {
    index();
    const report = memoryHygiene(
      db,
      ctx.paths,
      settings(),
      {
        skills: [],
        connectors: [],
        routines: [routine({ id: "ignored", name: "Ignored", createdAt: 0 })],
        silent: [
          {
            id: "digest",
            name: "Daily digest",
            enabled: true,
            kind: "cron",
            lastFiredAt: null,
            lastStatus: null,
            failuresInWindow: 2,
            reason: "failures",
          },
        ],
      },
      { now: Date.now(), silentRoutineDays: 14 },
    );
    const silent = report.items.filter((i) => i.kind === "silent-routine");
    expect(report.counts["silent-routine"]).toBe(1);
    expect(silent.map((i) => i.id)).toEqual(["digest"]);
    expect(silent[0]!.detail).toBe("2 failed run(s) in the last 14 d (enabled).");
  });

  it("counts dangling router pointers and caps the item list per kind", () => {
    index();
    generateRouters(db, ctx.paths, settings());
    fs.rmSync(acmePath);
    const empty = { skills: [], routines: [], connectors: [] };
    const report = memoryHygiene(db, ctx.paths, settings(), empty, { now: Date.now() });
    const dangling = report.items.filter((i) => i.kind === "dangling-link");
    expect(report.counts["dangling-link"]).toBeGreaterThanOrEqual(1);
    expect(dangling.some((i) => i.detail.includes("acme.md"))).toBe(true);

    const capped = memoryHygiene(db, ctx.paths, settings(), empty, {
      perKind: 1,
      staleDays: 1,
      now: Date.now() + 10 * 86_400_000,
    });
    expect(capped.items.filter((i) => i.kind === "stale")).toHaveLength(1);
    expect(capped.counts.stale).toBeGreaterThan(1);
  });
});

// ------------------------------------------------------------------ facts ----

describe("bi-temporal facts", () => {
  it("invalidates the previous value instead of deleting it", () => {
    const first = assertFact(db, {
      subject: "acme",
      predicate: "status",
      object: "prospect",
      validFrom: 1_000,
      sourcePath: "/tmp/a.md",
    });
    expect(first.unchanged).toBe(false);
    expect(first.fact.validTo).toBeNull();

    const same = assertFact(db, {
      subject: "acme",
      predicate: "status",
      object: "prospect",
      validFrom: 1_500,
    });
    expect(same.unchanged).toBe(true);
    expect(same.invalidated).toEqual([]);

    const second = assertFact(db, {
      subject: "acme",
      predicate: "status",
      object: "client",
      validFrom: 2_000,
      sourceRunId: "run-1",
    });
    expect(second.invalidated).toHaveLength(1);
    expect(second.invalidated[0]!.object).toBe("prospect");
    expect(second.invalidated[0]!.validTo).toBe(2_000);

    expect(queryFacts(db, { subject: "acme" }).map((f) => f.object)).toEqual(["client"]);
    expect(queryFacts(db, { subject: "acme", asOf: 1_200 }).map((f) => f.object)).toEqual(["prospect"]);
    expect(queryFacts(db, { subject: "acme", asOf: 2_500 }).map((f) => f.object)).toEqual(["client"]);
    expect(queryFacts(db, { subject: "acme", includeExpired: true })).toHaveLength(2);
    expect(queryFacts(db, { subject: "acme" })[0]!.sourceRunId).toBe("run-1");
    expect(factStats(db)).toEqual({ open: 1, expired: 1, subjects: 1 });
  });

  it("keeps facts of other subjects and predicates untouched, and retracts explicitly", () => {
    assertFact(db, { subject: "acme", predicate: "owner", object: "Ana", validFrom: 1_000 });
    assertFact(db, { subject: "globex", predicate: "owner", object: "Bruno", validFrom: 1_000 });
    assertFact(db, { subject: "acme", predicate: "owner", object: "Carla", validFrom: 3_000 });
    expect(
      queryFacts(db)
        .map((f) => `${f.subject}=${f.object}`)
        .sort(),
    ).toEqual(["acme=Carla", "globex=Bruno"]);

    const open = queryFacts(db, { subject: "globex" })[0]!;
    const retracted = retractFact(db, open.id, 5_000)!;
    expect(retracted.validTo).toBe(5_000);
    expect(queryFacts(db, { subject: "globex" })).toEqual([]);
    expect(retractFact(db, 9_999)).toBeNull();
    expect(retractFact(db, open.id, 6_000)!.validTo).toBe(5_000); // already closed: unchanged
  });

  it("rejects empty parts", () => {
    expect(() => assertFact(db, { subject: " ", predicate: "p", object: "o" })).toThrow(/subject/);
  });
});

// ---------------------------------------------------------- inline fields ----

describe("inline fields", () => {
  it("parses `key:: value`, normalises keys and ignores fences and URLs", () => {
    const fields = parseInlineFields(
      [
        "Due Date:: 2026-09-10",
        "- owner:: Ana",
        "status:: approved",
        "status:: rejected",
        "```",
        "ignored:: yes",
        "```",
        "see https://example.com/a:b for more",
      ].join("\n"),
    );
    expect(fields).toEqual({ due_date: "2026-09-10", owner: "Ana", status: "approved" });
  });

  it("parses `where` clauses", () => {
    expect(parseWhere("status:approved")).toEqual({ key: "status", value: "approved", contains: false });
    expect(parseWhere("Due Date:~2026")).toEqual({ key: "due_date", value: "2026", contains: true });
    expect(parseWhere("owner")).toEqual({ key: "owner", value: null, contains: false });
    expect(parseWhere("  ")).toBeNull();
  });

  it("stores fields on the indexed row, exposes them on graph nodes and queries them", () => {
    index();
    const hits = queryFilesByField(db, { where: "status:approved" });
    expect(hits.map((h) => h.path)).toEqual([budgetPath]);
    expect(hits[0]!.fields).toEqual({ owner: "Ana", status: "approved" });
    expect(queryFilesByField(db, { where: "owner:~an" }).map((h) => h.path)).toEqual([budgetPath]);
    expect(queryFilesByField(db, { where: "status:rejected" })).toEqual([]);
    expect(queryFilesByField(db, { where: "owner" }).map((h) => h.path)).toEqual([budgetPath]);
    expect(queryFilesByField(db, { where: "nope" })).toEqual([]);

    const graph = buildGraph(db);
    expect(graph.nodes.find((n) => n.path === budgetPath)!.fields).toEqual({
      owner: "Ana",
      status: "approved",
    });
    expect(graph.nodes.find((n) => n.path === notesPath)!.fields).toBeUndefined();
  });

  it("re-parses fields when the file changes", () => {
    index();
    fs.writeFileSync(budgetPath, "# Budget 2026\n\nstatus:: closed\n");
    index();
    expect(queryFilesByField(db, { where: "status:approved" })).toEqual([]);
    expect(queryFilesByField(db, { where: "status:closed" }).map((h) => h.path)).toEqual([budgetPath]);
  });
});
