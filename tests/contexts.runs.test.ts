import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { FastifyInstance } from "fastify";
import type { AgentRun } from "@mordomo/core";
import { ClaudeAdapter } from "@mordomo/adapter-claude";
import { AppContext } from "../apps/api/src/context.js";
import { buildServer } from "../apps/api/src/server.js";
import { openDb } from "../core/src/db/db.js";
import { MIGRATIONS } from "../core/src/db/migrations.js";
import { FAKE_BIN, makeTempHome, withFakeBinPath } from "./helpers.js";

/**
 * .specs/features/cerebro-contextos, batch B, S3: runs in a work context. Every claim about a route crosses the HTTP
 * boundary of a real server over a real home; what the agent is handed (its working directory, its added folders and
 * its prompt) is read where the engine hands it over, at the adapter of the provider, which then runs the fake CLI.
 */

let temp: ReturnType<typeof makeTempHome>;
let ctx: AppContext;
let app: FastifyInstance;
let token: string;
let restorePath: () => void;
/** The indexed folder every test makes its folders in (outside the home). */
let work: string;
const cleanups: Array<() => void> = [];
/** What the adapter was handed, by run id. */
const handed = new Map<string, AgentRun>();

const SKILL = "contexto-teste";
type Json = Record<string, any>;
const owner = () => ({ "x-mordomo-token": token, "content-type": "application/json" });
const as = (credential: string) => ({ "x-mordomo-token": credential, "content-type": "application/json" });

let seq = 0;
const dir = (name: string, base = work): string => {
  const full = path.join(base, `${name}-${++seq}`);
  fs.mkdirSync(full, { recursive: true });
  return full;
};
const put = (file: string, text: string): string => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
  return file;
};
const real = (p: string) => fs.realpathSync(p);
const under = (folder: string, file: string) => file === folder || file.startsWith(folder + path.sep);

async function call(
  method: string,
  url: string,
  payload?: unknown,
  headers: Record<string, string> = owner(),
) {
  const { "content-type": type, ...bare } = headers;
  const res = await app.inject({
    method: method as "GET",
    url,
    headers: payload !== undefined ? { ...bare, "content-type": type! } : bare,
    ...(payload !== undefined ? { payload: payload as Json } : {}),
  });
  return { status: res.statusCode, body: (res.body ? res.json() : null) as Json };
}
const errorCode = (r: { body: Json }) => r.body?.error?.code;
const runCount = () => (ctx.db.prepare("SELECT COUNT(*) c FROM runs").get() as { c: number }).c;
const sessionCount = () => (ctx.db.prepare("SELECT COUNT(*) c FROM sessions").get() as { c: number }).c;

/** A context made through the route, over folders that exist when it is made. */
async function context(name: string, paths: string[]): Promise<string> {
  const res = await call("POST", "/api/contexts", { name, paths });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body.id as string;
}

/** Start a run by a route, wait for it to finish, and give back its record and what its agent was handed. */
async function started(res: { status: number; body: Json }): Promise<{ run: Json; agent: AgentRun }> {
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  const runId = res.body.runId as string;
  await ctx.execution.wait(runId);
  const record = await call("GET", `/api/runs/${runId}`);
  expect(record.status).toBe(200);
  const agent = handed.get(runId);
  expect(agent, `the adapter was handed run ${runId}`).toBeDefined();
  return { run: record.body.run as Json, agent: agent! };
}
const promptRun = (body: Json) => started2("POST", "/api/runs", { prompt: "o que há aqui?", ...body });
const skillRun = (body: Json) => started2("POST", `/api/skills/${SKILL}/run`, body);
async function started2(method: string, url: string, body: Json) {
  return started(await call(method, url, body));
}

beforeAll(async () => {
  restorePath = withFakeBinPath();
  temp = makeTempHome("mordomo-contexts-runs-");
  work = real(fs.mkdtempSync(path.join(os.tmpdir(), "mordomo-contexts-runs-work-")));
  cleanups.push(() => fs.rmSync(work, { recursive: true, force: true }));
  ctx = new AppContext(temp.paths.home);
  const settings = ctx.settings();
  settings.setupCompleted = true;
  settings.indexedFolders = [{ path: work, area: "Projetos", enabled: true }];
  settings.providers.claude.enabled = true;
  settings.providers.claude.binaryPath = path.join(FAKE_BIN, "claude");
  ctx.settingsStore.save(settings);
  ctx.reloadAdapters();
  put(
    path.join(temp.paths.skills, SKILL, "SKILL.md"),
    "---\nname: Contexto teste\ndescription: Read the folder and say what is there.\nmode: read_only\nproviders: [claude]\n---\n\n# Contexto teste\n\nSay what is in the working folder.\n",
  );
  token = ctx.token();
  app = await buildServer(ctx);
  const execute = ClaudeAdapter.prototype.execute;
  vi.spyOn(ClaudeAdapter.prototype, "execute").mockImplementation(function (
    this: ClaudeAdapter,
    run: AgentRun,
  ) {
    handed.set(run.runId, run);
    return execute.call(this, run);
  });
});

afterAll(async () => {
  vi.restoreAllMocks();
  await ctx.runs.shutdown(2000);
  await app.close();
  ctx.close();
  temp.cleanup();
  restorePath();
  for (const cleanup of cleanups.splice(0)) cleanup();
});

describe("S3 runs in a work context", () => {
  it("C17 POST /api/runs and POST /api/skills/:slug/run with contextId and no cwd start in the first ok path and record the id", async () => {
    const gone = dir("sumiu");
    const first = dir("principal");
    const second = dir("segunda");
    const id = await context("Execução C17", [gone, first, second]);
    fs.rmSync(gone, { recursive: true, force: true });

    for (const launch of [promptRun, skillRun]) {
      const { run, agent } = await launch({ contextId: id });
      expect(run.cwd).toBe(real(first));
      expect(run.contextId).toBe(id);
      expect(agent.cwd).toBe(real(first));
    }
    // A run without a context records none, as before.
    const { run } = await promptRun({});
    expect(run.contextId).toBeNull();
  });

  it("C18 the run's readDirs hold the other ok paths, then the notes folder when it exists, besides what it already receives", async () => {
    const first = dir("principal");
    const second = dir("segunda");
    const third = dir("terceira");
    const id = await context("Execução C18", [first, second, third]);

    // No notes folder yet: only the other ok paths, in their order.
    const before = await promptRun({ contextId: id });
    expect(before.agent.readDirs).toEqual([real(second), real(third)]);

    const notes = path.join(temp.paths.memory, "notes", id);
    fs.mkdirSync(notes, { recursive: true });
    const prompt = await promptRun({ contextId: id });
    expect(prompt.agent.readDirs).toEqual([real(second), real(third), real(notes)]);

    // A skill run keeps its own folder and adds the context's after it, in the same order.
    const skill = await skillRun({ contextId: id });
    const dirs = skill.agent.readDirs ?? [];
    expect(dirs).toContain(real(path.join(temp.paths.skills, SKILL)));
    const at = (p: string) => dirs.indexOf(real(p));
    expect(at(second)).toBeGreaterThan(-1);
    expect(at(third)).toBeGreaterThan(at(second));
    expect(at(notes)).toBeGreaterThan(at(third));
    expect(dirs).not.toContain(real(first));

    // A run without a context gets none of them.
    const plain = await promptRun({});
    expect(plain.agent.readDirs ?? []).not.toContain(real(second));
  });

  it("C19 a cwd inside a context path is kept; one outside every context path is 400 validation and no run is recorded", async () => {
    const first = dir("principal");
    const inside = path.join(first, "sub", "pasta");
    fs.mkdirSync(inside, { recursive: true });
    const elsewhere = dir("fora-do-contexto");
    const id = await context("Execução C19", [first]);

    const kept = await promptRun({ contextId: id, cwd: inside });
    expect(kept.run.cwd).toBe(real(inside));
    expect(kept.agent.cwd).toBe(real(inside));
    const keptSkill = await skillRun({ contextId: id, cwd: inside });
    expect(keptSkill.run.cwd).toBe(real(inside));

    for (const [url, body] of [
      ["/api/runs", { prompt: "x", contextId: id, cwd: elsewhere }],
      [`/api/skills/${SKILL}/run`, { contextId: id, cwd: elsewhere }],
    ] as const) {
      const runs = runCount();
      const sessions = sessionCount();
      const res = await call("POST", url, body);
      expect(res.status, url).toBe(400);
      expect(errorCode(res), url).toBe("validation");
      expect(runCount(), url).toBe(runs);
      expect(sessionCount(), url).toBe(sessions);
    }
  });

  it("C20 an unknown contextId is 404 context_not_found and a context with no ok path 409 context_unavailable on the three routes, recording no run", async () => {
    const lonely = dir("unica");
    const dead = await context("Execução C20 sem caminho", [lonely]);
    const alive = dir("viva");
    const live = await context("Execução C20 com caminho", [alive]);
    // A conversation to continue, in the context that will lose its only path.
    const first = await promptRun({ contextId: dead });
    const sessionId = first.run.sessionId as string;
    expect(sessionId).toBeTruthy();
    // and one without a context
    const plainSession = (await promptRun({})).run.sessionId as string;
    fs.rmSync(lonely, { recursive: true, force: true });

    const cases: Array<[string, string, Json, number, string]> = [
      ["POST", "/api/runs", { prompt: "x", contextId: "nenhum-contexto" }, 404, "context_not_found"],
      ["POST", `/api/skills/${SKILL}/run`, { contextId: "nenhum-contexto" }, 404, "context_not_found"],
      [
        "POST",
        `/api/sessions/${plainSession}/continue`,
        { prompt: "x", contextId: "nenhum-contexto" },
        404,
        "context_not_found",
      ],
      ["POST", "/api/runs", { prompt: "x", contextId: dead }, 409, "context_unavailable"],
      ["POST", `/api/skills/${SKILL}/run`, { contextId: dead }, 409, "context_unavailable"],
      ["POST", `/api/sessions/${sessionId}/continue`, { prompt: "x" }, 409, "context_unavailable"],
      [
        "POST",
        `/api/sessions/${sessionId}/continue`,
        { prompt: "x", contextId: dead },
        409,
        "context_unavailable",
      ],
    ];
    for (const [method, url, body, status, code] of cases) {
      const runs = runCount();
      const sessions = sessionCount();
      const res = await call(method, url, body);
      expect(res.status, `${url} ${JSON.stringify(body)}`).toBe(status);
      expect(errorCode(res), url).toBe(code);
      expect(runCount(), url).toBe(runs);
      expect(sessionCount(), url).toBe(sessions);
    }
    // The context that still has a path keeps working.
    expect((await promptRun({ contextId: live })).run.contextId).toBe(live);
  });

  it("C21 the prompt of a run with a context starts with its block: name, paths, map, the first 2 000 characters of the brief, and the global router", async () => {
    const first = dir("principal");
    const second = dir("segunda");
    const name = "Bloco do C21";
    const id = await context(name, [first, second]);
    // A brief of 2 500 characters whose 2 001st is a mark no other text has.
    const head = `---\ntype: brief\n---\n# ${name}\n\n`;
    const brief = head + "r".repeat(2000 - head.length - 1) + "Ω" + "§" + "s".repeat(499);
    expect(brief.length).toBe(2500);
    expect(brief[1999]).toBe("Ω");
    expect(brief[2000]).toBe("§");
    put(path.join(temp.paths.memory, "notes", id, "_resumo.md"), brief);

    const map = path.join(temp.paths.memory, "contexts", `${id}.md`);
    const router = path.join(temp.paths.memory, "ROUTER.md");
    for (const launch of [promptRun, skillRun]) {
      const { agent } = await launch({ contextId: id });
      const prompt = agent.prompt;
      expect(prompt.startsWith(`Work context: ${name}\n`), prompt.slice(0, 200)).toBe(true);
      expect(prompt).toContain(first);
      expect(prompt).toContain(second);
      expect(prompt).toContain(map);
      expect(prompt).toContain(brief.slice(0, 2000));
      expect(prompt).not.toContain(brief.slice(0, 2001));
      expect(prompt).not.toContain("§");
      const routerLine = prompt.split("\n").find((line) => line.includes(router));
      expect(routerLine, "a line names the global router").toBeDefined();
      expect(routerLine).toContain("memory/ROUTER.md");
      expect(routerLine).toMatch(/outside this context/);
      // The block comes before the rest: the request itself (a prompt run) or the skill (a skill run).
      const rest = launch === promptRun ? "o que há aqui?" : "You are executing";
      expect(prompt.indexOf(rest)).toBeGreaterThan(prompt.indexOf(router));
    }
    // Without a brief the block is still there, with no brief in it.
    const bare = await context("Bloco sem resumo", [dir("sem-resumo")]);
    const { agent } = await promptRun({ contextId: bare });
    expect(agent.prompt.startsWith("Work context: Bloco sem resumo\n")).toBe(true);
    expect(agent.prompt).not.toContain("_resumo.md");
    // A run without a context does not start with one.
    expect((await promptRun({})).agent.prompt.startsWith("Work context:")).toBe(false);
  });

  it("C22 a run credential of a run with a context recalls and searches only the context without context, and with all everything the credential may read (memory/ and the run's folders); without a context, the same", async () => {
    const inside = dir("contexto-c22");
    const outside = dir("fora-c22");
    const contextNote = put(
      path.join(inside, "pitanga-projeto.md"),
      "# Pitanga\n\n## Pitanga\n\npitanga madura no projeto\n",
    );
    const memoryNote = put(
      path.join(temp.paths.memory, "pitanga-geral.md"),
      "# Pitanga geral\n\n## Pitanga\n\npitanga madura na nota geral\n",
    );
    const outsideNote = put(
      path.join(outside, "pitanga-fora.md"),
      "# Pitanga fora\n\n## Pitanga\n\npitanga madura fora\n",
    );
    await ctx.indexer.indexAllAsync();
    const id = await context("Credencial C22", [inside]);

    const runOf = (contextId: string | null) =>
      ctx.runs.create({
        origin: "skill",
        provider: "claude",
        prompt: "held open",
        cwd: inside,
        model: null,
        effort: "default",
        mode: "read_only",
        timeoutMs: 60_000,
        profile: "read_only",
        startedBy: null,
        ...(contextId ? { contextId } : {}),
      });
    const scoped = ctx.runApiAccessFor(runOf(id), "read_only")!.token;
    const plain = ctx.runApiAccessFor(runOf(null), "read_only")!.token;

    const searchPaths = async (credential: string, extra = "") => {
      const res = await call(
        "GET",
        `/api/memory/search?q=pitanga&limit=200${extra}`,
        undefined,
        as(credential),
      );
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      return (res.body as unknown as Json[]).map((h) => h.path as string);
    };
    const recallPaths = async (credential: string, extra = "") => {
      const res = await call(
        "GET",
        `/api/memory/recall?q=pitanga%20madura&k=10&record=0${extra}`,
        undefined,
        as(credential),
      );
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      return {
        candidates: (res.body.candidates as Json[]).map((c) => c.path as string),
        sections: (res.body.answerContext as Json[]).map((c) => c.path as string),
      };
    };

    // The context's run, no context named: only the context's files.
    const hits = await searchPaths(scoped);
    expect(hits).toContain(contextNote);
    for (const hit of hits) expect(under(inside, hit), hit).toBe(true);
    const recalled = await recallPaths(scoped);
    expect(recalled.candidates).toContain(contextNote);
    for (const p of [...recalled.candidates, ...recalled.sections]) expect(under(inside, p), p).toBe(true);

    // context=all: the whole index the credential reads, the general notes of memory/ included.
    const all = await searchPaths(scoped, "&context=all");
    expect(all).toEqual(expect.arrayContaining([contextNote, memoryNote]));
    const allRecalled = await recallPaths(scoped, "&context=all");
    expect(allRecalled.candidates).toEqual(expect.arrayContaining([contextNote, memoryNote]));

    // A run without a context: everything its credential may read (memory/ and its folders), as before (AD-040(d)).
    const whole = await searchPaths(plain);
    expect(whole).toContain(memoryNote);
    expect((await recallPaths(plain)).candidates).toContain(memoryNote);

    // Neither credential reads a granted folder outside its run (door 8); the owner does.
    for (const list of [hits, all, whole, recalled.candidates, allRecalled.candidates]) {
      expect(list).not.toContain(outsideNote);
    }
    expect(await searchPaths(token)).toContain(outsideNote);
  });

  it("C23 continuing a conversation whose first run had a context records the same contextId; a different one is 409 context_unavailable", async () => {
    const first = dir("conversa");
    const id = await context("Conversa C23", [first]);
    const other = await context("Outra conversa C23", [dir("outra")]);
    const opened = await promptRun({ contextId: id });
    const sessionId = opened.run.sessionId as string;

    const next = await started(
      await call("POST", `/api/sessions/${sessionId}/continue`, { prompt: "e agora?" }),
    );
    expect(next.run.sessionId).toBe(sessionId);
    expect(next.run.contextId).toBe(id);
    expect(next.run.cwd).toBe(real(first));
    expect(next.agent.prompt.startsWith("Work context: Conversa C23\n")).toBe(true);
    const same = await started(
      await call("POST", `/api/sessions/${sessionId}/continue`, { prompt: "e depois?", contextId: id }),
    );
    expect(same.run.contextId).toBe(id);

    const runs = runCount();
    const refused = await call("POST", `/api/sessions/${sessionId}/continue`, {
      prompt: "x",
      contextId: other,
    });
    expect(refused.status).toBe(409);
    expect(errorCode(refused)).toBe("context_unavailable");
    expect(runCount()).toBe(runs);
    // The same through POST /api/runs with the conversation's id.
    const viaRuns = await call("POST", "/api/runs", { prompt: "x", sessionId, contextId: other });
    expect(viaRuns.status).toBe(409);
    expect(errorCode(viaRuns)).toBe("context_unavailable");
    // A conversation without a context does not take one on.
    const plain = (await promptRun({})).run.sessionId as string;
    const runsBefore = runCount();
    const into = await call("POST", `/api/sessions/${plain}/continue`, { prompt: "x", contextId: id });
    expect(into.status).toBe(409);
    expect(errorCode(into)).toBe("context_unavailable");
    expect(runCount()).toBe(runsBefore);
  });

  it("C24 after the context of a recorded run is deleted, GET /api/runs/:id still answers its contextId", async () => {
    const id = await context("Apagado C24", [dir("apagado")]);
    const { run } = await promptRun({ contextId: id });
    const deleted = await call("DELETE", `/api/contexts/${id}`);
    expect(deleted.status).toBe(200);
    expect(ctx.settings().contexts.some((c) => c.id === id)).toBe(false);
    const after = await call("GET", `/api/runs/${run.id as string}`);
    expect(after.status).toBe(200);
    expect(after.body.run.contextId).toBe(id);
    const listed = await call("GET", "/api/runs?limit=200");
    expect((listed.body as unknown as Json[]).find((r) => r.id === run.id)?.contextId).toBe(id);
  });
});

describe("S3 migration 23", () => {
  type Column = { name: string; type: string; notnull: number; dflt_value: unknown; pk: number };
  const columns = (db: ReturnType<typeof openDb>["db"], table: string) =>
    (db.pragma(`table_info(${table})`) as Column[]).map(({ name, type, notnull, dflt_value, pk }) => ({
      name,
      type,
      notnull,
      dflt_value,
      pk,
    }));

  it("C25 on a database at 22 with runs and sessions it adds a nullable TEXT context_id to both, NULL in every old row, nothing else changed, and again leaves the same schema", () => {
    const home = makeTempHome("mordomo-m23-");
    try {
      const old = openDb(
        home.paths,
        MIGRATIONS.filter((m) => m.version <= 22),
      ).db;
      expect(old.pragma("user_version", { simple: true })).toBe(22);
      old
        .prepare(
          "INSERT INTO runs (id, created_at, origin, provider, status, cwd, prompt_summary, session_id) VALUES ('r1', 1, 'manual', 'claude', 'done', '/w', 'um', 's1'), ('r2', 2, 'skill', 'codex', 'failed', NULL, 'dois', NULL)",
        )
        .run();
      old
        .prepare(
          "INSERT INTO sessions (id, provider, cwd, title, created_at, updated_at) VALUES ('s1', 'claude', '/w', 'Conversa', 1, 2)",
        )
        .run();
      const before = {
        runs: columns(old, "runs"),
        sessions: columns(old, "sessions"),
        runRows: old.prepare("SELECT * FROM runs ORDER BY id").all() as Json[],
        sessionRows: old.prepare("SELECT * FROM sessions ORDER BY id").all() as Json[],
      };
      expect(before.runs.some((c) => c.name === "context_id")).toBe(false);
      expect(before.sessions.some((c) => c.name === "context_id")).toBe(false);
      old.close();

      const { db, migration } = openDb(home.paths);
      try {
        expect(migration.toVersion).toBe(23);
        expect(db.pragma("user_version", { simple: true })).toBe(23);
        const added = { name: "context_id", type: "TEXT", notnull: 0, dflt_value: null, pk: 0 };
        expect(columns(db, "runs")).toEqual([...before.runs, added]);
        expect(columns(db, "sessions")).toEqual([...before.sessions, added]);
        expect(db.prepare("SELECT * FROM runs ORDER BY id").all()).toEqual(
          before.runRows.map((row) => ({ ...row, context_id: null })),
        );
        expect(db.prepare("SELECT * FROM sessions ORDER BY id").all()).toEqual(
          before.sessionRows.map((row) => ({ ...row, context_id: null })),
        );

        // Its change again leaves the same schema.
        const m23 = MIGRATIONS.find((m) => m.version === 23)!;
        expect(m23.name).toBe("run-context");
        const schema = () => ({ runs: columns(db, "runs"), sessions: columns(db, "sessions") });
        const once = schema();
        if (m23.up) m23.up(db);
        if (m23.sql) db.exec(m23.sql);
        expect(schema()).toEqual(once);
        expect(MIGRATIONS.at(-1)!.version).toBe(23);
      } finally {
        db.close();
      }
    } finally {
      home.cleanup();
    }
  });
});
