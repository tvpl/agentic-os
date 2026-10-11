import { afterEach, describe, expect, it } from "vitest";
import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { EngineLockedError, type Settings } from "@mordomo/core";
import {
  ObjectiveStore,
  RunManager,
  SettingsStore,
  ensureDirs,
  openDb,
  resolvePaths,
} from "@mordomo/core/internal";
import { AppContext } from "../apps/api/src/context.js";
import { startServer } from "../apps/api/src/server.js";
import { processAlive } from "./helpers.js";

/**
 * Engine composition, API side (.specs/features/motor-composicao): building an
 * AppContext — what every CLI command does — changes nothing, and the service
 * owns the engine, stopping only a leftover MordomoOS service that held it.
 */

const homes: string[] = [];
const children: ChildProcess[] = [];

afterEach(() => {
  for (const child of children.splice(0)) child.kill("SIGKILL");
  for (const home of homes.splice(0)) fs.rmSync(home, { recursive: true, force: true });
});

function tempHome(): string {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "mordomo-api-engine-"));
  homes.push(home);
  ensureDirs(resolvePaths(home));
  return home;
}

function settingsOf(home: string, patch: (s: Settings) => void): void {
  const store = new SettingsStore(resolvePaths(home));
  const settings = store.load();
  patch(settings);
  store.save(settings);
}

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
  objectives.markDispatched(objective.steps[0]!.id, run.id);
  if (runStatus === "running") {
    db.prepare("UPDATE runs SET status = 'running', started_at = ? WHERE id = ?").run(Date.now(), run.id);
  }
  db.close();
  return { stepId: objective.steps[0]!.id, runId: run.id };
}

const lockFile = (home: string) => path.join(resolvePaths(home).run, "engine.lock");

async function freePort(): Promise<number> {
  return new Promise((resolve) => {
    const server = net.createServer().listen(0, "127.0.0.1", () => {
      const port = (server.address() as { port: number }).port;
      server.close(() => resolve(port));
    });
  });
}

async function serviceHome(): Promise<string> {
  const home = tempHome();
  const port = await freePort();
  settingsOf(home, (s) => {
    s.port = port;
    s.setupCompleted = true;
  });
  return home;
}

async function holdLockWith(home: string, args: string[]): Promise<ChildProcess> {
  const child = spawn(process.execPath, args, { stdio: "ignore" });
  children.push(child);
  await new Promise((resolve) => child.once("spawn", resolve));
  fs.writeFileSync(lockFile(home), JSON.stringify({ pid: child.pid, startedAt: Date.now() }));
  return child;
}

describe("an AppContext changes nothing", () => {
  it("C2 constructing an AppContext leaves a queued step dispatched", () => {
    const home = tempHome();
    const { stepId, runId } = seed(home, "queued");
    const ctx = new AppContext(home);
    try {
      const row = ctx.db.prepare("SELECT status, run_id FROM objective_steps WHERE id = ?").get(stepId);
      expect(row).toEqual({ status: "dispatched", run_id: runId });
      expect(fs.existsSync(lockFile(home))).toBe(false);
    } finally {
      ctx.close();
    }
  });
});

describe("the service owns the engine", () => {
  it("C12 the API service owns the engine", async () => {
    const home = await serviceHome();
    const { runId } = seed(home, "running");
    const handle = await startServer(home);
    try {
      const lock = JSON.parse(fs.readFileSync(lockFile(home), "utf8")) as { pid: number };
      expect(lock.pid).toBe(process.pid);
      expect(handle.ctx.runs.get(runId)!.status).toBe("interrupted");
      expect(handle.ctx.scheduler.isRunning()).toBe(true);
    } finally {
      await handle.close();
    }
    expect(fs.existsSync(lockFile(home))).toBe(false);
  });

  it.skipIf(process.platform === "win32")(
    "C25 a leftover MordomoOS service holding the lock is stopped and the service starts",
    async () => {
      const home = await serviceHome();
      // A process whose command line reads like a MordomoOS service (`…/cli.js start`).
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mordomo-leftover-"));
      homes.push(dir);
      fs.writeFileSync(path.join(dir, "cli.js"), "setInterval(() => {}, 1000);\n");
      const leftover = await holdLockWith(home, [path.join(dir, "cli.js"), "start"]);
      const handle = await startServer(home);
      try {
        await expect.poll(() => processAlive(leftover.pid!), { timeout: 6000 }).toBe(false);
        const lock = JSON.parse(fs.readFileSync(lockFile(home), "utf8")) as { pid: number };
        expect(lock.pid).toBe(process.pid);
      } finally {
        await handle.close();
      }
    },
    20_000,
  );

  it("C26 another process holding the lock is never killed and the service does not start", async () => {
    const home = await serviceHome();
    const { stepId } = seed(home, "queued");
    const other = await holdLockWith(home, ["-e", "setInterval(() => {}, 1000)"]);
    await expect(startServer(home)).rejects.toBeInstanceOf(EngineLockedError);
    expect(processAlive(other.pid!)).toBe(true);
    expect((JSON.parse(fs.readFileSync(lockFile(home), "utf8")) as { pid: number }).pid).toBe(other.pid);
    // The refused start left nothing open: a fresh context reads the untouched step.
    const ctx = new AppContext(home);
    try {
      expect(ctx.db.prepare("SELECT status FROM objective_steps WHERE id = ?").get(stepId)).toEqual({
        status: "dispatched",
      });
    } finally {
      ctx.close();
    }
  });
});
