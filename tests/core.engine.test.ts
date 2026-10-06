import { afterEach, describe, expect, it, vi } from "vitest";
import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  EngineLockedError,
  ObjectiveStore,
  PathAccessError,
  ProviderRegistry,
  RunManager,
  SettingsStore,
  createEngine,
  ensureDirs,
  openDb,
  resolvePaths,
  type MordomoEngine,
  type Settings,
} from "@mordomo/core";
import { claudeManifest, createClaudeAdapter } from "@mordomo/adapter-claude";
import { FAKE_BIN, FAKE_CLIS_RUNNABLE, withFakeBinPath } from "./helpers.js";

/**
 * Engine composition (.specs/features/motor-composicao): building the engine
 * changes nothing; only the owner that calls start() recovers state, and an
 * embedder gets the engine and its write policy from @mordomo/core alone.
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const homes: string[] = [];
const engines: MordomoEngine[] = [];
const children: ChildProcess[] = [];

afterEach(async () => {
  for (const engine of engines.splice(0)) await engine.stop(500).catch(() => undefined);
  for (const child of children.splice(0)) child.kill("SIGKILL");
  for (const home of homes.splice(0)) fs.rmSync(home, { recursive: true, force: true });
});

function tempHome(): string {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "mordomo-engine-"));
  homes.push(home);
  ensureDirs(resolvePaths(home));
  return home;
}

function registry(): ProviderRegistry {
  return new ProviderRegistry().register(claudeManifest, createClaudeAdapter);
}

function engineFor(home: string): MordomoEngine {
  const engine = createEngine({ home, providers: registry(), seedDir: null });
  engines.push(engine);
  return engine;
}

function settingsOf(home: string, patch: (s: Settings) => void): void {
  const store = new SettingsStore(resolvePaths(home));
  const settings = store.load();
  patch(settings);
  store.save(settings);
}

/**
 * Seed with the plain core stores (no engine involved): one objective step
 * dispatched to a run in the given status. Returns the ids to read back.
 */
function seed(home: string, runStatus: "queued" | "running"): { stepId: string; runId: string } {
  const paths = resolvePaths(home);
  const { db } = openDb(paths);
  const store = new SettingsStore(paths);
  const runs = new RunManager(
    db,
    paths,
    () => store.load(),
    () => {
      throw new Error("no adapter while seeding");
    },
    { pruneOnBoot: false },
  );
  const objectives = new ObjectiveStore(db, paths);
  const objective = objectives.create({
    title: "Seeded",
    steps: [{ title: "Step", request: { version: 1, kind: "prompt", prompt: "do it", mode: "read_only" } }],
  });
  const run = runs.create({
    origin: "manual",
    provider: "claude",
    prompt: "do it",
    cwd: home,
    model: null,
    effort: "default",
    mode: "read_only",
    timeoutMs: 10_000,
    profile: "read_only",
  });
  const stepId = objective.steps[0]!.id;
  objectives.markDispatched(stepId, run.id);
  if (runStatus === "running") {
    db.prepare("UPDATE runs SET status = 'running', started_at = ? WHERE id = ?").run(Date.now(), run.id);
  }
  db.close();
  return { stepId, runId: run.id };
}

function stepOf(engine: MordomoEngine, stepId: string): { status: string; runId: string | null } {
  const row = engine.db.prepare("SELECT status, run_id FROM objective_steps WHERE id = ?").get(stepId) as {
    status: string;
    run_id: string | null;
  };
  return { status: row.status, runId: row.run_id };
}

const lockFile = (home: string) => path.join(resolvePaths(home).run, "engine.lock");

describe("S1 building the engine changes nothing", () => {
  it("C1 constructing an engine leaves a queued step dispatched", () => {
    const home = tempHome();
    const { stepId, runId } = seed(home, "queued");
    const engine = engineFor(home);
    expect(stepOf(engine, stepId)).toEqual({ status: "dispatched", runId });
  });

  it("C3 constructing an engine leaves a running step dispatched", () => {
    const home = tempHome();
    const { stepId } = seed(home, "running");
    const engine = engineFor(home);
    expect(stepOf(engine, stepId).status).toBe("dispatched");
  });

  it("C4 constructing an engine leaves a running run running", () => {
    const home = tempHome();
    const { runId } = seed(home, "running");
    const engine = engineFor(home);
    expect(engine.runs.get(runId)!.status).toBe("running");
  });

  it("C5 constructing an engine takes no lock", () => {
    const home = tempHome();
    engineFor(home);
    expect(fs.existsSync(lockFile(home))).toBe(false);
  });
});

describe("S2 only the owner recovers", () => {
  it("C6 start requeues a step whose run never started", () => {
    const home = tempHome();
    const { stepId } = seed(home, "queued");
    const engine = engineFor(home);
    engine.start();
    expect(stepOf(engine, stepId)).toEqual({ status: "pending", runId: null });
  });

  it("C7 start interrupts a run left running", () => {
    const home = tempHome();
    const { runId } = seed(home, "running");
    const engine = engineFor(home);
    engine.start();
    expect(engine.runs.get(runId)!.status).toBe("interrupted");
  });

  it("C8 start writes the owner lock", () => {
    const home = tempHome();
    const engine = engineFor(home);
    engine.start();
    const lock = JSON.parse(fs.readFileSync(lockFile(home), "utf8")) as { pid: number };
    expect(lock.pid).toBe(process.pid);
  });

  it("C9 a live foreign lock refuses start and recovers nothing", async () => {
    const home = tempHome();
    const { stepId } = seed(home, "queued");
    const other = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore" });
    children.push(other);
    await new Promise((resolve) => other.once("spawn", resolve));
    fs.writeFileSync(lockFile(home), JSON.stringify({ pid: other.pid, startedAt: Date.now() }));
    const engine = engineFor(home);
    let thrown: unknown;
    try {
      engine.start();
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(EngineLockedError);
    expect((thrown as { code?: string }).code).toBe("engine_locked");
    expect(stepOf(engine, stepId).status).toBe("dispatched");
  });

  it("C10 a dead lock is taken over", () => {
    const home = tempHome();
    const { stepId } = seed(home, "queued");
    fs.writeFileSync(lockFile(home), JSON.stringify({ pid: 2 ** 30, startedAt: 1 }));
    const engine = engineFor(home);
    engine.start();
    const lock = JSON.parse(fs.readFileSync(lockFile(home), "utf8")) as { pid: number };
    expect(lock.pid).toBe(process.pid);
    expect(stepOf(engine, stepId).status).toBe("pending");
  });

  it("C11 stop releases the lock", async () => {
    const home = tempHome();
    const engine = engineFor(home);
    engine.start();
    expect(fs.existsSync(lockFile(home))).toBe(true);
    await engine.stop(500);
    expect(fs.existsSync(lockFile(home))).toBe(false);
  });

  it("C20 start starts the scheduler and the sentinels, building does not", () => {
    const engine = engineFor(tempHome());
    expect(engine.scheduler.isRunning()).toBe(false);
    expect(engine.sentinels.isRunning()).toBe(false);
    engine.start();
    expect(engine.scheduler.isRunning()).toBe(true);
    expect(engine.sentinels.isRunning()).toBe(true);
  });

  it("C21 start prunes old run events, building does not", () => {
    const home = tempHome();
    settingsOf(home, (s) => {
      s.limits.logRetentionDays = 1;
    });
    const { runId } = seed(home, "queued");
    const { db } = openDb(resolvePaths(home));
    db.prepare("UPDATE runs SET status = 'done', finished_at = ? WHERE id = ?").run(Date.now(), runId);
    db.prepare("INSERT INTO run_events (run_id, ts, type, data) VALUES (?, ?, 'text', '{}')").run(
      runId,
      Date.now() - 3 * 86_400_000,
    );
    db.close();
    const engine = engineFor(home);
    const count = () =>
      (engine.db.prepare("SELECT COUNT(*) c FROM run_events WHERE run_id = ?").get(runId) as { c: number }).c;
    expect(count()).toBe(1);
    engine.start();
    expect(count()).toBe(0);
  });

  it("C22 a lock of this very process is taken over", () => {
    const home = tempHome();
    fs.writeFileSync(lockFile(home), JSON.stringify({ pid: process.pid, startedAt: 1 }));
    const engine = engineFor(home);
    expect(() => engine.start()).not.toThrow();
    expect((JSON.parse(fs.readFileSync(lockFile(home), "utf8")) as { pid: number }).pid).toBe(process.pid);
  });

  it("C23 an unreadable lock is taken over", () => {
    for (const content of ["", "{", '{"pid":"x"}']) {
      const home = tempHome();
      fs.writeFileSync(lockFile(home), content);
      const engine = engineFor(home);
      expect(() => engine.start(), JSON.stringify(content)).not.toThrow();
      expect((JSON.parse(fs.readFileSync(lockFile(home), "utf8")) as { pid: number }).pid).toBe(process.pid);
    }
  });

  it("C24 the lock appears already holding its pid", () => {
    const home = tempHome();
    const seen: Array<{ targetExisted: boolean; sourcePid: unknown }> = [];
    const real = fs.linkSync.bind(fs);
    const spy = vi.spyOn(fs, "linkSync").mockImplementation((source, target) => {
      seen.push({
        targetExisted: fs.existsSync(target),
        sourcePid: (JSON.parse(fs.readFileSync(source, "utf8")) as { pid: unknown }).pid,
      });
      return real(source, target);
    });
    try {
      engineFor(home).start();
    } finally {
      spy.mockRestore();
    }
    expect(seen).toEqual([{ targetExisted: false, sourcePid: process.pid }]);
    expect(fs.readdirSync(resolvePaths(home).run).filter((n) => n.endsWith(".tmp"))).toEqual([]);
  });
});

describe("S3 the database waits", () => {
  it("C13 the database waits on a busy lock", () => {
    const home = tempHome();
    const { db } = openDb(resolvePaths(home));
    try {
      expect(db.pragma("busy_timeout", { simple: true })).toBe(5000);
    } finally {
      db.close();
    }
  });
});

describe("S4 an embedder gets the engine and its policy", () => {
  it.skipIf(!FAKE_CLIS_RUNNABLE)(
    "C14 an embedder runs a read-only run with core and one adapter",
    async () => {
      // This file imports the engine only from @mordomo/core and one adapter package.
      const source = fs.readFileSync(path.join(here, "core.engine.test.ts"), "utf8");
      expect(source).not.toMatch(/["'][./]*apps\//);

      const restorePath = withFakeBinPath();
      try {
        const home = tempHome();
        settingsOf(home, (s) => {
          s.providers.claude.enabled = true;
          s.providers.claude.binaryPath = path.join(FAKE_BIN, "claude");
        });
        const engine = engineFor(home);
        engine.start();
        const record = engine.runs.create({
          origin: "api",
          provider: "claude",
          prompt: "Say OK",
          cwd: home,
          model: null,
          effort: "default",
          mode: "read_only",
          timeoutMs: 20_000,
          profile: "read_only",
        });
        void engine.runs.execute(record.id, "Say OK", "read_only");
        await expect.poll(() => engine.runs.get(record.id)!.status, { timeout: 15_000 }).toBe("done");
      } finally {
        restorePath();
      }
    },
  );

  const gatedPayload = {
    kind: "prompt" as const,
    input: {
      prompt: "change it",
      provider: "claude" as const,
      model: null,
      effort: "default" as const,
      mode: "write" as const,
      cwd: "",
      timeoutMs: 60_000,
    },
  };

  it("C15 the engine parks a reviewed write", () => {
    const home = tempHome();
    settingsOf(home, (s) => {
      s.securityProfile = "review_before_write";
    });
    const engine = engineFor(home);
    const gate = engine.gateWrite("write", "manual", "change it", {
      ...gatedPayload,
      input: { ...gatedPayload.input, cwd: home },
    });
    expect(gate.pendingApproval?.kind).toBe("write_run");
    expect(gate.runId).not.toBeNull();
    expect(engine.runs.get(gate.runId!)!.status).toBe("waiting_approval");
  });

  it("C16 the engine refuses writes under read_only", () => {
    const home = tempHome();
    settingsOf(home, (s) => {
      s.securityProfile = "read_only";
    });
    const engine = engineFor(home);
    let thrown: unknown;
    try {
      engine.assertWriteAllowed("write", "manual");
    } catch (err) {
      thrown = err;
    }
    expect((thrown as { statusCode?: number }).statusCode).toBe(403);
    expect((thrown as { code?: string }).code).toBe("profile_refused");
    expect(() => engine.assertWriteAllowed("read_only", "manual")).not.toThrow();
  });

  it("C17 the engine contains cwd to the granted roots", () => {
    const home = tempHome();
    const folder = fs.mkdtempSync(path.join(os.tmpdir(), "mordomo-folder-"));
    homes.push(folder);
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), "mordomo-outside-"));
    homes.push(outside);
    settingsOf(home, (s) => {
      s.indexedFolders = [{ path: folder, enabled: true, area: null } as never];
    });
    const engine = engineFor(home);
    expect(() => engine.resolveCwd(outside)).toThrow(PathAccessError);
    expect(engine.resolveCwd(folder)).toBe(fs.realpathSync(folder));
  });

  it("C18 the engine lets a controlled write through", () => {
    const home = tempHome();
    settingsOf(home, (s) => {
      s.securityProfile = "controlled_write";
    });
    const engine = engineFor(home);
    const gate = engine.gateWrite("write", "manual", "change it", {
      ...gatedPayload,
      input: { ...gatedPayload.input, cwd: home },
    });
    expect(gate).toEqual({ pendingApproval: null, runId: null });
  });

  it("C27 approved_automation lets a manual write through", () => {
    const home = tempHome();
    settingsOf(home, (s) => {
      s.securityProfile = "approved_automation";
    });
    const engine = engineFor(home);
    expect(
      engine.gateWrite("write", "manual", "change it", {
        ...gatedPayload,
        input: { ...gatedPayload.input, cwd: home },
      }),
    ).toEqual({ pendingApproval: null, runId: null });
  });

  it("C28 the engine parks a reviewed write skill", () => {
    const home = tempHome();
    const skillDir = path.join(resolvePaths(home).skills, "tidy-notes");
    fs.mkdirSync(skillDir, { recursive: true });
    fs.writeFileSync(
      path.join(skillDir, "SKILL.md"),
      "---\nname: Tidy notes\ndescription: Rename notes to the house style.\nmode: write\nproviders: [claude]\n---\n\n# Tidy notes\n\nRename the notes.\n",
    );
    settingsOf(home, (s) => {
      s.securityProfile = "review_before_write";
    });
    const engine = engineFor(home);
    const gate = engine.gateWrite("write", "manual", "tidy", {
      kind: "skill",
      input: {
        slug: "tidy-notes",
        inputs: {},
        provider: "claude",
        model: null,
        effort: "default",
        cwd: home,
        timeoutMs: 60_000,
      },
    });
    expect(gate.pendingApproval?.kind).toBe("write_run");
    const run = engine.runs.get(gate.runId!)!;
    expect(run.status).toBe("waiting_approval");
    expect(run.skillSlug).toBe("tidy-notes");
    expect(gate.pendingApproval!.payload).toMatchObject({ kind: "skill", runId: gate.runId });
  });
});
