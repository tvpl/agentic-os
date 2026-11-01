import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ClaudeAdapter } from "@mordomo/adapter-claude";
import { RunFailureSchema } from "../contracts/src/api/wire.js";
import type { AgentRun } from "@mordomo/core";
import { FAKE_BIN } from "./helpers.js";
import { code, runWorld, type Json, type RunWorld } from "./helpers/memoriaWorld.js";
import { FIXTURES, order, seedFixture } from "./helpers/searchFixtures.js";

/**
 * .specs/features/cerebro-memoria-confiavel, batch B1, S4r: the access of folders on every way a run is created and when
 * it launches (C119 to C121, C125 to C131). Over a real home with the fake CLIs (`runWorld`): Claude is the default
 * provider; Codex and Cursor are switched on where a check names them.
 */

const opened: RunWorld[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  while (opened.length) await opened.pop()!.close();
});

interface Seeded {
  w: RunWorld;
  fin: string;
  outra: string;
  secret: string;
}

async function seeded(prefix = "mordomo-access-runs-"): Promise<Seeded> {
  const w = await runWorld(prefix);
  opened.push(w);
  const fin = path.join(w.memory, "notes", "fin");
  const outra = path.join(w.memory, "notes", "outra");
  const secret = w.put(path.join(fin, "segredo.md"), "# Segredo\n\nOrçamento sigiloso do trimestre.\n");
  w.put(path.join(outra, "visivel.md"), "# Visível\n\nOrçamento público do trimestre.\n");
  await w.index();
  return { w, fin, outra, secret };
}

const setAccess = async (w: RunWorld, folderAccess: Json[]) => {
  const res = await w.call("PUT", "/api/settings", { folderAccess });
  expect(res.status, JSON.stringify(res.body)).toBe(200);
};

const runCount = (w: RunWorld): number =>
  (w.ctx.db.prepare("SELECT COUNT(*) c FROM runs").get() as { c: number }).c;

const pathsIn = (body: unknown): string[] =>
  [...JSON.stringify(body).matchAll(/"(\/[^"]+)"/g)].map((m) => m[1]!);

/** The `--disallowedTools` rules of every invocation the Claude adapter builds from now on, and the runs it was given. */
function captureInvocations(): { runs: AgentRun[]; denied: string[][] } {
  const seen = { runs: [] as AgentRun[], denied: [] as string[][] };
  const build = ClaudeAdapter.prototype.buildInvocation;
  vi.spyOn(ClaudeAdapter.prototype, "buildInvocation").mockImplementation(async function (
    this: ClaudeAdapter,
    run: AgentRun,
    id?: string,
  ) {
    const inv = await build.call(this, run, id);
    seen.runs.push(run);
    seen.denied.push(
      inv.args.flatMap((arg, i) => (inv.args[i - 1] === "--disallowedTools" ? arg.split(",") : [])),
    );
    return inv;
  });
  return seen;
}

const enableProvider = (w: RunWorld, id: "codex" | "cursor") =>
  w.update((s) => {
    s.providers[id] = {
      ...s.providers[id]!,
      enabled: true,
      binaryPath: path.join(FAKE_BIN, id === "codex" ? "codex" : "cursor-agent"),
    };
  });

// ---- C119: a run a device asks for -----------------------------------------------------------------------------------

describe("C119 a run device and the folders hidden from devices", () => {
  it("C119 hide for devices: 404 not_found and no run; read for devices: a write run 403 folder_read_only, a read-only run accepted; the owner's accepted", async () => {
    const { w, fin, outra } = await seeded();
    await setAccess(w, [
      { path: fin, agents: "write", devices: "hide" },
      { path: outra, agents: "write", devices: "read" },
    ]);
    const device = w.device(["run"]);
    const before = runCount(w);
    const hidden = await w.call("POST", "/api/runs", { prompt: "olhe", mode: "read_only", cwd: fin }, device);
    expect(code(hidden)).toEqual([404, "not_found"]);
    expect(runCount(w)).toBe(before);
    expect(
      code(await w.call("POST", "/api/runs", { prompt: "escreva", mode: "write", cwd: outra }, device)),
    ).toEqual([403, "folder_read_only"]);
    expect(runCount(w)).toBe(before);
    const ro = await w.call("POST", "/api/runs", { prompt: "leia", mode: "read_only", cwd: outra }, device);
    expect(ro.status, JSON.stringify(ro.body)).toBe(200);
    expect(runCount(w)).toBe(before + 1);
    // the owner's same requests
    for (const [cwd, mode] of [
      [fin, "read_only"],
      [outra, "write"],
      [outra, "read_only"],
    ] as const) {
      const res = await w.call("POST", "/api/runs", { prompt: "dono", mode, cwd });
      expect([200, 202], `${cwd} ${mode} ${JSON.stringify(res.body)}`).toContain(res.status);
    }
  });
});

// ---- C120 and C121: what a run's credential reads, and what its prompt names --------------------------------------

describe("C120 a write run's credential and the folders hidden from agents", () => {
  it("C120 search, recall, maps and journal equal the twin's; facts and recall/stats hold nothing under it", async () => {
    const { w, fin, secret } = await seeded();
    const journal = path.join(w.memory, "journal");
    const yesterday = new Date(Date.now() - 86_400_000);
    const two = (n: number) => String(n).padStart(2, "0");
    const day = `${yesterday.getFullYear()}-${two(yesterday.getMonth() + 1)}-${two(yesterday.getDate())}`;
    w.put(path.join(journal, `${day}.md`), `# ${day}\n\n## Notes\n\n- orçamento revisto\n`);
    await w.index();
    const fact = await w.call("POST", "/api/memory/facts", {
      subject: "Segredo",
      predicate: "p",
      object: "o",
      sourcePath: secret,
    });
    expect(fact.status).toBe(201);
    expect((await w.call("GET", "/api/memory/recall?q=segredo%20sigiloso")).status).toBe(200);
    const run = w.run("write");
    const ownerStats = await w.call("GET", "/api/memory/recall/stats");
    expect(pathsIn(ownerStats.body)).toContain(secret);
    expect(pathsIn((await w.call("GET", "/api/memory/facts", undefined, run.headers)).body)).toContain(
      secret,
    );

    await setAccess(w, [
      { path: fin, agents: "hide", devices: "write" },
      { path: journal, agents: "hide", devices: "write" },
    ]);
    const urls = [
      "/api/memory/search?q=orcamento",
      "/api/memory/recall?q=orcamento%20trimestre&record=false",
      "/api/memory/maps",
      "/api/memory/journal?days=7",
    ];
    const strip = (body: unknown) =>
      JSON.parse(JSON.stringify(body), (k, v) => (["durationMs", "generatedAt"].includes(k) ? undefined : v));
    const seen: Record<string, unknown> = {};
    for (const url of urls) {
      const res = await w.call("GET", url, undefined, run.headers);
      expect(res.status, `${url} ${JSON.stringify(res.body)}`).toBe(200);
      expect(
        pathsIn(res.body).some((p) => p.startsWith(fin + path.sep) || p.startsWith(journal + path.sep)),
        url,
      ).toBe(false);
      seen[url] = strip(res.body);
    }
    expect((seen["/api/memory/journal?days=7"] as Json).days).toEqual([]);
    const facts = await w.call("GET", "/api/memory/facts", undefined, run.headers);
    expect(facts.status).toBe(200);
    expect(facts.body.facts).toEqual([]);
    const stats = await w.call("GET", "/api/memory/recall/stats", undefined, run.headers);
    expect(stats.status).toBe(200);
    expect(pathsIn(stats.body)).not.toContain(secret);

    // the twin: the same credential, nothing hidden, `fin` and `journal` excluded and the index passed again
    w.update((s) => {
      s.folderAccess = [];
      s.excludes = [...s.excludes, "fin", "journal"];
    });
    await w.index();
    for (const url of urls) {
      const res = await w.call("GET", url, undefined, run.headers);
      expect(res.status, url).toBe(200);
      expect(seen[url], url).toEqual(strip(res.body));
    }
  });
});

describe("C120 the order a hidden folder does not change", () => {
  it("C120 a write run's search order equals the twin's when the hidden notes would change the weight of a word (bm25 over the whole index would not)", async () => {
    const fixture = FIXTURES[0]!;
    const w = await runWorld("mordomo-access-c120-order-");
    opened.push(w);
    const { fin, outra } = await seedFixture(w, fixture);
    const url = `/api/memory/search?q=${encodeURIComponent(fixture.query)}&limit=200`;
    const run = w.run("write");
    expect(
      order((await w.call("GET", url, undefined, run.headers)).body, outra),
      "over the whole index the order is the other one",
    ).toEqual(["b.md", "a.md"]);
    await setAccess(w, [{ path: fin, agents: "hide", devices: "write" }]);
    const seen = await w.call("GET", url, undefined, run.headers);
    w.update((s) => {
      s.folderAccess = [];
      s.excludes = [...s.excludes, "fin"];
    });
    await w.index();
    expect(order((await w.call("GET", url, undefined, run.headers)).body, outra)).toEqual(fixture.twin);
    expect(order(seen.body, outra)).toEqual(fixture.twin);
  });
});

describe("C121 the prompt of a run in a context with a path hidden from agents", () => {
  it("C121 neither the context block, nor its map, nor the routers it names hold the hidden path or the folder's name", async () => {
    const w = await runWorld("mordomo-access-c121-");
    opened.push(w);
    const cofre = path.join(w.memory, "notes", "cofre-secreto");
    const aberta = path.join(w.memory, "notes", "aberta");
    w.put(path.join(cofre, "conta.md"), "# Conta\n\nNúmero da conta.\n");
    w.put(path.join(aberta, "plano.md"), "# Plano\n\nO plano do projeto.\n");
    await w.index();
    w.update((s) => {
      s.contexts = [{ id: "projeto", name: "Projeto", paths: [aberta, cofre] }];
    });
    expect((await w.call("POST", "/api/memory/routers")).status).toBe(200);
    const map = path.join(w.memory, "contexts", "projeto.md");
    expect(
      fs.readFileSync(map, "utf8"),
      "before: the map names the folder (the case is not empty)",
    ).toContain("cofre-secreto");
    await setAccess(w, [{ path: cofre, agents: "hide", devices: "write" }]);
    // A run asked for in this context is refused (C125); the prompt is read off a run checked when it launches, which
    // is built as every run of the context is.
    const prompts: string[] = [];
    const execute = w.ctx.runs.execute.bind(w.ctx.runs);
    vi.spyOn(w.ctx.runs, "execute").mockImplementation((runId, prompt, mode) => {
      prompts.push(prompt);
      return execute(runId, prompt, mode);
    });
    const started = w.ctx.execution.startPrompt(
      { prompt: "resuma o projeto", mode: "read_only", contextId: "projeto", startedBy: "owner" },
      { folderCheck: "launch" },
    );
    await w.ctx.execution.wait(started.runId);
    expect(prompts).toHaveLength(1);
    const prompt = prompts[0]!;
    expect(prompt).toContain("Work context: Projeto");
    expect(prompt).toContain(aberta);
    expect(prompt).not.toContain(cofre);
    expect(prompt).not.toContain("cofre-secreto");
    // the routers the prompt names: the context's map and the global router
    const router = path.join(w.memory, "ROUTER.md");
    expect(prompt).toContain(map);
    expect(prompt).toContain(router);
    for (const file of [map, router]) {
      const text = fs.readFileSync(file, "utf8");
      expect(text, file).not.toContain(cofre);
      expect(text, file).not.toContain("cofre-secreto");
    }
    expect(fs.readFileSync(map, "utf8")).toContain(aberta);
  });
});

// ---- C125 to C129: the refusals and what a launch is given --------------------------------------------------------

describe("C125 a folder hidden from agents refuses the run", () => {
  it("C125 403 folder_hidden and no run: a cwd inside it, a memory skill's folder input naming it, a context path of it", async () => {
    const { w, fin, outra } = await seeded();
    w.update((s) => {
      s.contexts = [{ id: "projeto", name: "Projeto", paths: [outra, fin] }];
    });
    // write for devices, and Claude keeps reads in the working folder: the refusal is the agents' level alone
    await setAccess(w, [{ path: fin, agents: "hide", devices: "write" }]);
    const before = runCount(w);
    const cases: Array<[string, string, Json]> = [
      ["a cwd inside it", "/api/runs", { prompt: "olhe", mode: "read_only", cwd: path.join(fin) }],
      [
        "a memory skill's folder input naming it",
        "/api/skills/organize-brain/run",
        { inputs: { folder: fin, etapa: "indexar" } },
      ],
      [
        "a run in a context one of whose paths is it",
        "/api/runs",
        { prompt: "olhe", mode: "read_only", contextId: "projeto" },
      ],
    ];
    for (const [why, url, body] of cases) {
      const res = await w.call("POST", url, body);
      expect(code(res), `${why} ${JSON.stringify(res.body)}`).toEqual([403, "folder_hidden"]);
      expect(runCount(w), why).toBe(before);
    }
    expect(w.ctx.runs.sessions.list().length).toBe(0);
    // the same requests with nothing hidden are not refused for it
    await setAccess(w, []);
    for (const [why, url, body] of cases) {
      const res = await w.call("POST", url, body);
      expect([200, 202], `${why} ${JSON.stringify(res.body)}`).toContain(res.status);
    }
  });
});

describe("C126 a Claude run whose folder holds a hidden folder", () => {
  it("C126 launches with the five deny rules for its real path in each mode; a run with no hidden folder has none", async () => {
    const { w, fin, outra } = await seeded();
    await setAccess(w, [{ path: fin, agents: "hide", devices: "write" }]);
    const seen = captureInvocations();
    const real = fs.realpathSync(fin);
    const rules = ["Read", "Grep", "Glob", "Edit", "Write"].map((tool) => `${tool}(/${real}/**)`);
    const launch = async (cwd: string, mode: "read_only" | "write") => {
      const record = w.ctx.runs.create({
        origin: "manual",
        provider: "claude",
        prompt: "x",
        request: { version: 1, kind: "prompt", prompt: "x", mode },
        cwd,
        model: null,
        effort: "default",
        mode,
        timeoutMs: 60_000,
        profile: mode === "write" ? "controlled_write" : "read_only",
        startedBy: "owner",
      });
      return w.ctx.runs.execute(record.id, "x", mode);
    };
    await launch(w.memory, "read_only");
    await launch(w.memory, "write");
    expect(seen.runs.map((r) => [r.mode, Boolean(r.permissionBroker)])).toEqual([
      ["read_only", false],
      ["write", true],
    ]);
    for (const denied of seen.denied) expect(denied).toEqual(expect.arrayContaining(rules));
    expect(seen.runs.map((r) => r.hiddenDirs)).toEqual([[real], [real]]);
    // the third mode the adapter builds: write with acceptEdits (no broker), from the run the launch was given
    const { permissionBroker: _b, ...unbrokered } = seen.runs[1]!;
    const accept = await new ClaudeAdapter({ binaryPath: path.join(FAKE_BIN, "claude") }).buildInvocation(
      unbrokered,
    );
    expect(accept.args).toContain("acceptEdits");
    expect(
      accept.args.flatMap((a, i) => (accept.args[i - 1] === "--disallowedTools" ? a.split(",") : [])),
    ).toEqual(expect.arrayContaining(rules));
    // no hidden folder inside the run's folder: none of them
    seen.runs.length = 0;
    seen.denied.length = 0;
    await launch(outra, "read_only");
    await launch(outra, "write");
    for (const denied of seen.denied) expect(denied.filter((r) => r.includes(real))).toEqual([]);
    expect(seen.runs.map((r) => r.hiddenDirs)).toEqual([undefined, undefined]);
  });
});

describe("C127 a provider that reads the whole disk and a hidden folder in the run's folder", () => {
  it("C127 409 folder_hide_unsupported and no run on Codex, Cursor and a manifest with no readConfinement; with nothing hidden inside, each starts", async () => {
    const { w, fin, outra } = await seeded();
    enableProvider(w, "codex");
    enableProvider(w, "cursor");
    w.ctx.reloadAdapters();
    await setAccess(w, [{ path: fin, agents: "hide", devices: "write" }]);
    const claude = w.ctx.adapters.claude!;
    const manifest = claude.manifest;
    const undeclared = {
      ...manifest,
      capabilities: { ...manifest.capabilities, readConfinement: undefined },
    };
    const cases: Array<[string, string, () => void]> = [
      ["Codex", "codex", () => undefined],
      ["Cursor", "cursor", () => undefined],
      [
        "no declaration",
        "claude",
        () => Object.defineProperty(claude, "manifest", { value: undeclared, configurable: true }),
      ],
    ];
    for (const [why, provider, arrange] of cases) {
      arrange();
      const before = runCount(w);
      const res = await w.call("POST", "/api/runs", {
        prompt: "olhe",
        mode: "read_only",
        cwd: w.memory,
        provider,
      });
      expect(code(res), `${why} ${JSON.stringify(res.body)}`).toEqual([409, "folder_hide_unsupported"]);
      expect(runCount(w), why).toBe(before);
      const fine = await w.call("POST", "/api/runs", {
        prompt: "olhe",
        mode: "read_only",
        cwd: outra,
        provider,
      });
      expect(fine.status, `${why} ${JSON.stringify(fine.body)}`).toBe(200);
      expect(runCount(w), why).toBe(before + 1);
      await w.ctx.execution.wait(fine.body.runId);
    }
    Object.defineProperty(claude, "manifest", { value: manifest, configurable: true });
  });
});

describe("C128 a folder agents may only read", () => {
  it("C128 a write run inside it is 403 folder_read_only and records no run; a read-only run there and a write run in a sibling are accepted", async () => {
    const { w, fin, outra } = await seeded();
    await setAccess(w, [{ path: fin, agents: "read", devices: "write" }]);
    const before = runCount(w);
    expect(code(await w.call("POST", "/api/runs", { prompt: "escreva", mode: "write", cwd: fin }))).toEqual([
      403,
      "folder_read_only",
    ]);
    expect(runCount(w)).toBe(before);
    const ro = await w.call("POST", "/api/runs", { prompt: "leia", mode: "read_only", cwd: fin });
    expect(ro.status, JSON.stringify(ro.body)).toBe(200);
    const sibling = await w.call("POST", "/api/runs", { prompt: "escreva", mode: "write", cwd: outra });
    expect([200, 202], JSON.stringify(sibling.body)).toContain(sibling.status);
    expect(runCount(w)).toBe(before + 2);
  });
});

describe("C129 a memory skill handed memory/ with a folder agents may only read", () => {
  it("C129 launches with that folder's real path in protectedDirs beside the skill's; a provider without protectsDirs fails folder_protection_unsupported", async () => {
    const { w, fin } = await seeded();
    w.update((s) => {
      s.securityProfile = "controlled_write";
    });
    await setAccess(w, [{ path: fin, agents: "read", devices: "write" }]);
    const seen = captureInvocations();
    const done = await w.skill("organize-brain");
    expect(done.status, JSON.stringify(done.failure)).toBe("done");
    const run = seen.runs[0]!;
    expect(run.mode).toBe("write");
    expect(run.readDirs).toContain(fs.realpathSync(w.memory));
    expect(run.protectedDirs).toEqual(
      expect.arrayContaining([
        fs.realpathSync(path.join(w.ctx.paths.skills, "organize-brain")),
        fs.realpathSync(fin),
      ]),
    );
    const claude = w.ctx.adapters.claude!;
    const manifest = claude.manifest;
    Object.defineProperty(claude, "manifest", {
      value: { ...manifest, capabilities: { ...manifest.capabilities, protectsDirs: false } },
      configurable: true,
    });
    seen.runs.length = 0;
    const failed = await w.skill("organize-brain");
    expect(failed.status).toBe("failed");
    expect(failed.failure?.code).toBe("folder_protection_unsupported");
    expect(seen.runs).toEqual([]);
    Object.defineProperty(claude, "manifest", { value: manifest, configurable: true });
  });
});

// ---- C130 and C131: a level changed before the launch, and every way a run is created ------------------------------

describe("C130 a level changed while a write run waits for approval", () => {
  for (const [level, expected] of [
    ["hide", "folder_hidden"],
    ["read", "folder_read_only"],
  ] as const) {
    it(`C130 set to ${level}: the approved run fails at launch with ${expected} and the adapter is never called`, async () => {
      const { w, outra } = await seeded(`mordomo-access-c130-${level}-`);
      w.update((s) => {
        s.securityProfile = "review_before_write";
      });
      const parked = await w.call("POST", "/api/runs", { prompt: "escreva", mode: "write", cwd: outra });
      expect(parked.status, JSON.stringify(parked.body)).toBe(202);
      expect(parked.body.status).toBe("waiting_approval");
      await setAccess(w, [{ path: outra, agents: level, devices: "write" }]);
      const execute = vi.mocked(ClaudeAdapter.prototype.execute);
      const calls = execute.mock.calls.length;
      const resolved = await w.call("POST", `/api/approvals/${parked.body.pendingApproval.id}/resolve`, {
        decision: "approved",
      });
      expect(resolved.status, JSON.stringify(resolved.body)).toBe(200);
      const done = await w.ctx.execution.wait(parked.body.runId);
      expect(done.status).toBe("failed");
      expect(done.failure?.code).toBe(expected);
      expect(execute.mock.calls.length).toBe(calls);
    });
  }
});

describe("C131 every other way a run is created", () => {
  it("C131 retry, children, a conversation continued and a routine run now are 403 folder_hidden with no run; the scheduler, an objective's step and a dashboard's question fail at launch; RunFailure.code has the three codes", async () => {
    const { w, outra } = await seeded();
    // a run, a conversation and a routine in notes/outra while it is visible
    const first = await w.call("POST", "/api/runs", {
      submissionId: crypto.randomUUID(),
      prompt: "leia",
      mode: "read_only",
      cwd: outra,
    });
    expect(first.status, JSON.stringify(first.body)).toBe(200);
    await w.ctx.execution.wait(first.body.runId);
    const routine = await w.call("POST", "/api/routines", {
      id: "rotina-outra",
      name: "Rotina",
      prompt: "leia",
      kind: "every",
      every: { value: 1, unit: "hours" },
      workingDir: outra,
      provider: "claude",
      enabled: false,
    });
    expect(routine.status, JSON.stringify(routine.body)).toBeLessThan(300);
    const objective = await w.call("POST", "/api/objectives", {
      title: "Objetivo",
      steps: [{ title: "Passo", request: { version: 1, kind: "prompt", prompt: "leia", mode: "read_only" } }],
    });
    expect(objective.status, JSON.stringify(objective.body)).toBeLessThan(300);
    const dashboard = await w.call("POST", "/api/dashboards", {
      template: "question",
      question: "O que há de novo?",
    });
    expect(dashboard.status, JSON.stringify(dashboard.body)).toBe(201);

    await setAccess(w, [
      { path: outra, agents: "hide", devices: "write" },
      { path: w.memory, agents: "write", devices: "write" },
    ]);
    const source = first.body.runId as string;
    const session = w.ctx.runs.get(source)!.sessionId!;
    const requested: Array<[string, string, Json]> = [
      ["retry", `/api/runs/${source}/retry`, { submissionId: crypto.randomUUID() }],
      ["children", `/api/runs/${source}/children`, { prompts: ["filho"] }],
      ["a conversation continued", `/api/sessions/${session}/continue`, { prompt: "continue" }],
      ["a routine run now", "/api/routines/rotina-outra/run", {}],
    ];
    for (const [why, url, body] of requested) {
      const before = runCount(w);
      const res = await w.call("POST", url, body);
      expect(code(res), `${why} ${JSON.stringify(res.body)}`).toEqual([403, "folder_hidden"]);
      expect(runCount(w), why).toBe(before);
    }

    // no request waits on these: the run is recorded and fails at launch with the code
    const fired = await w.ctx.scheduler.fire("rotina-outra", { reason: "fired" });
    const firedRun = await w.ctx.execution.wait(fired.runId!);
    expect([firedRun.status, firedRun.failure?.code], "the scheduler").toEqual(["failed", "folder_hidden"]);
    const dispatched = await w.call("POST", `/api/objectives/${objective.body.id}/dispatch`, { cwd: outra });
    expect(dispatched.status, JSON.stringify(dispatched.body)).toBe(200);
    const step = await w.ctx.execution.wait(dispatched.body.dispatched[0].runId);
    expect([step.status, step.failure?.code], "an objective's step").toEqual(["failed", "folder_hidden"]);
    await setAccess(w, [{ path: w.memory, agents: "hide", devices: "write" }]);
    const asked = await w.call("POST", `/api/dashboards/${dashboard.body.id}/refresh`);
    expect(asked.status, JSON.stringify(asked.body)).toBe(202);
    const answer = await w.ctx.execution.wait(asked.body.runId);
    expect([answer.status, answer.failure?.code], "a dashboard's question").toEqual([
      "failed",
      "folder_hidden",
    ]);

    // the wire's closed set of failure codes holds the three
    for (const failure of ["folder_hidden", "folder_read_only", "folder_hide_unsupported"]) {
      expect(
        RunFailureSchema.safeParse({
          code: failure,
          message: "m",
          recoverable: false,
          effectsUncertain: false,
        }).success,
        failure,
      ).toBe(true);
    }
  });
});

describe("a run's credential writes the journal only where agents may write (door 12, beside C120)", () => {
  it("journal hidden from agents: 403 folder_hidden; read for agents: 403 folder_read_only; write: the line is appended; the owner always", async () => {
    const { w } = await seeded("mordomo-access-journal-");
    const journal = path.join(w.memory, "journal");
    // the folder is there (a folder that is not there reads hide for both, G17)
    fs.mkdirSync(journal, { recursive: true });
    const run = w.run("write");
    const append = (headers?: Record<string, string>) =>
      w.call("POST", "/api/memory/journal/append", { text: "uma linha", section: "Today" }, headers);
    await setAccess(w, [{ path: journal, agents: "hide", devices: "write" }]);
    expect(code(await append(run.headers))).toEqual([403, "folder_hidden"]);
    await setAccess(w, [{ path: journal, agents: "read", devices: "write" }]);
    expect(code(await append(run.headers))).toEqual([403, "folder_read_only"]);
    expect((await append()).status, "the owner").toBe(200);
    await setAccess(w, []);
    expect((await append(run.headers)).status).toBe(200);
  });
});
