import { afterEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { createEngine, EngineLockedError, type Engine, type OsEventType } from "@mordomo/core";
import {
  RestoreLock,
  RoutineSchema,
  createBackup,
  relatedEdges,
  openDb,
  resolvePaths,
  type EventBus,
  type Db,
} from "@mordomo/core/internal";
import { ClaudeAdapter } from "@mordomo/adapter-claude";
import { FAKE_BIN, FAKE_CLIS_RUNNABLE } from "./helpers.js";
import { moduleState } from "./support/moduleState.js";
import { buildEngine, closeAll, echoProvider, internals, registryOf, tempHome } from "./support/sdk.js";

/**
 * Two engines in one process share nothing (.specs/features/sdk-core, S4): not the event bus, not the allowlist of
 * executables, not the memo of related files, not the owner lock of a home. What the operating system makes
 * process-wide is listed, each with its reason (C30).
 */

afterEach(closeAll);

const root = path.resolve(import.meta.dirname, "..");

function sourcesUnder(dir: string): string[] {
  const out: string[] = [];
  const walk = (current: string) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        if (entry.name !== "node_modules" && entry.name !== "dist") walk(full);
      } else if (/\.tsx?$/.test(entry.name) && !/\.test\./.test(entry.name)) out.push(full);
    }
  };
  walk(path.join(root, dir));
  return out;
}

/** The module-level state that stays, with the reason it is not an engine's. */
const PROCESS_SCOPED: Record<string, string> = {
  "core/src/restoreLock.ts heldHere":
    "POSIX file locks belong to the process and the inode: a second lock on a file closes the first one's, so the process must know which lock files it holds, whichever engine asks",
  "core/src/restoreLock.ts live":
    "keeps every held RestoreLock reachable, because the garbage collector closing the connection of a dropped lock would release the lock",
  "core/src/spawn/safeSpawn.ts ownedKillers":
    "keyed by the process id of a child, a name in the operating system's table; only the safeSpawn that made the child stores or reads its entry",
  "core/src/spawn/which.ts pathCache":
    "memo of the PATH of the process (30 s) and the folders on disk; it holds nothing an engine decided",
  "core/src/ownerLock.ts globalThis":
    "the owner locks this process holds, on globalThis under a Symbol.for key so that two copies of the package in one process share one registry: whether a lock file naming this pid belongs to a live engine is a question only the process can answer (door 7)",
  "core/src/notifications/recorder.ts installed":
    "WeakMap keyed by the EventBus: one entry per bus, gone with it",
  "core/src/memory/journal.ts installed": "WeakMap keyed by the EventBus: one entry per bus, gone with it",
  "core/src/memory/related.ts caches": "WeakMap keyed by the Db: one memo per database, gone with it",
  "core/src/channels/pushEndpoint.ts PRIVATE":
    "the address ranges a push endpoint may not point into, filled once when the module loads and only read afterwards",
};

describe("S4 nothing of an engine is shared with another", () => {
  it("C30 the module-level mutable state of the core and the adapters is the closed list", () => {
    const files = [
      ...sourcesUnder("core/src"),
      ...sourcesUnder("adapters/claude/src"),
      ...sourcesUnder("adapters/cursor/src"),
      ...sourcesUnder("adapters/codex/src"),
    ];
    const found = files.flatMap((file) => {
      const relative = path.relative(root, file).split(path.sep).join("/");
      return moduleState(fs.readFileSync(file, "utf8"), relative).map((f) => `${f.file} ${f.name}`);
    });
    expect(found.sort()).toEqual(Object.keys(PROCESS_SCOPED).sort());
    for (const [item, reason] of Object.entries(PROCESS_SCOPED))
      expect(reason.length, item).toBeGreaterThan(20);
  });

  it("C31 what one engine announces, another never hears", async () => {
    const echo = echoProvider();
    const a = buildEngine([echo]);
    const b = buildEngine([echoProvider({ id: "other" })], { enable: false });
    expect(b.events.lastId).toBe(0);
    const heardByB: string[] = [];
    b.events.subscribe((event) => heardByB.push(event.type));
    const heardByA: string[] = [];
    a.events.subscribe((event) => heardByA.push(event.type));
    const inner = internals(a);

    const failing = () => {
      echo.state.failWith = "boom";
      return a.execution.startPrompt({ prompt: "this fails the same way", startedBy: null }).runId;
    };
    const rows: Array<[string, OsEventType, () => unknown]> = [
      ["config/store", "settings.changed", () => a.updateSettings({ systemName: "A" })],
      ["ui-preferences", "settings.changed", () => inner.uiPreferences.update({ themePreset: "mono" })],
      [
        "objectiveStore",
        "objective.changed",
        () =>
          inner.objectives.create({
            title: "o",
            steps: [{ title: "s", request: { version: 1, kind: "prompt", prompt: "p", mode: "read_only" } }],
          }),
      ],
      [
        "notifications/store",
        "notification.created",
        () => inner.notifications.add({ kind: "system", tone: "info", title: "t", body: "b" }),
      ],
      [
        "backup",
        "backup.created",
        () => createBackup(inner.paths, inner.db, { bus: inner.events as EventBus }),
      ],
      [
        "sessionStore",
        "session.created",
        () => inner.runs.sessions.create({ provider: "echo", cwd: null, profile: null, title: "t" }),
      ],
      [
        "runManager",
        "run.finished",
        async () => a.execution.wait(a.execution.startPrompt({ prompt: "hi", startedBy: null }).runId),
      ],
      ["indexer", "index.finished", () => inner.indexer.indexAllAsync()],
      [
        "scheduler",
        "routine.fired",
        async () => {
          inner.routines.save(
            RoutineSchema.parse({ id: "r1", name: "r1", prompt: "hi", schedule: "0 0 1 1 *", enabled: true }),
          );
          await inner.scheduler.fire("r1");
        },
      ],
      [
        "engine approvals",
        "approval.requested",
        () => {
          a.updateSettings({ securityProfile: "review_before_write" });
          return a.execution.startPrompt({ prompt: "change", mode: "write", startedBy: null });
        },
      ],
      [
        "sentinels",
        "sentinel.fired",
        async () => {
          a.updateSettings({ securityProfile: "read_only" });
          a.start();
          for (let i = 0; i < 2; i++) await a.execution.wait(failing());
        },
      ],
    ];
    for (const [module, type, act] of rows) {
      const before = heardByA.length;
      await act();
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(heardByA.slice(before), module).toContain(type);
      expect(heardByB, module).toEqual([]);
    }
    expect(a.events.lastId).toBeGreaterThan(0);
    expect(b.events.lastId).toBe(0);
  });

  it("C32 each engine allows the executables of its own providers, whatever order they were built in", () => {
    const a = buildEngine([echoProvider({ id: "alpha", binary: "alpha" })]);
    const b = buildEngine([echoProvider({ id: "beta", binary: "beta" })]);
    const allowed = (engine: Engine, executable: string, allowPaths?: string[]) => {
      try {
        internals(engine).spawnPolicy.assertAllowed(executable, allowPaths);
        return true;
      } catch (error) {
        expect((error as Error).name).toBe("ExecutableNotAllowedError");
        return false;
      }
    };
    internals(a).reloadAdapters();
    for (const [engine, own, other] of [
      [a, "alpha", "beta"],
      [b, "beta", "alpha"],
    ] as const) {
      expect(allowed(engine, `/usr/bin/${own}`), `${own} allowed`).toBe(true);
      expect(allowed(engine, `/usr/bin/${other}`), `${other} refused`).toBe(false);
      expect(allowed(engine, process.execPath), "node allowed").toBe(true);
      expect(allowed(engine, "/opt/pinned/tool"), "a path nobody named").toBe(false);
      expect(allowed(engine, "/opt/pinned/tool", ["/opt/pinned/tool"]), "a pinned path").toBe(true);
    }
  });

  it("C33 each engine's probes drop the environment of its own settings", async () => {
    const a = buildEngine([echoProvider()]);
    const b = buildEngine([echoProvider({ id: "other" })]);
    a.updateSettings({ channels: { telegram: { botTokenEnv: "SDK_A_SECRET" } } });
    b.updateSettings({ channels: { telegram: { botTokenEnv: "SDK_B_SECRET" } } });
    internals(a).reloadAdapters();
    internals(b).reloadAdapters();
    process.env.SDK_A_SECRET = "a";
    process.env.SDK_B_SECRET = "b";
    process.env.MORDOMO_SDK_PROBE = "1";
    try {
      const envOf = async (engine: Engine) => {
        const result = await internals(engine).spawnPolicy.probe(
          process.execPath,
          ["-e", "console.log(JSON.stringify(Object.keys(process.env)))"],
          process.cwd(),
        );
        return JSON.parse(result.stdout) as string[];
      };
      const seenByA = await envOf(a);
      const seenByB = await envOf(b);
      expect([seenByA.includes("SDK_A_SECRET"), seenByA.includes("SDK_B_SECRET")]).toEqual([false, true]);
      expect([seenByB.includes("SDK_A_SECRET"), seenByB.includes("SDK_B_SECRET")]).toEqual([true, false]);
      expect(seenByA.includes("MORDOMO_SDK_PROBE") || seenByB.includes("MORDOMO_SDK_PROBE")).toBe(false);
    } finally {
      delete process.env.SDK_A_SECRET;
      delete process.env.SDK_B_SECRET;
      delete process.env.MORDOMO_SDK_PROBE;
    }
  });

  it("C34 related files are memoised per database", () => {
    const seed = (db: Db, shared: string, filler: string[]) => {
      const insert = db.prepare("INSERT INTO files_fts(rowid, name, rel, content) VALUES (?, ?, ?, ?)");
      const bodies = [shared, shared, ...filler];
      bodies.forEach((body, index) => insert.run(index + 1, `n${index + 1}.md`, `n${index + 1}.md`, body));
    };
    const filler = (words: string) =>
      [1, 2, 3].map((n) => `${words} ${n} unrelated filler text number ${n}${n} here`);
    const a = openDb(resolvePaths(tempHome())).db;
    const b = openDb(resolvePaths(tempHome())).db;
    try {
      seed(a, "tides lunar orbit gravity ocean moon basin swell current", filler("alpha beta gamma"));
      seed(
        b,
        "compiler parser grammar syntax token lexer scanner symbol table",
        filler("delta epsilon zeta"),
      );
      const files = [1, 2, 3, 4, 5].map((id) => ({ id, mtime: 100 }));
      const termsOf = (db: Db) => relatedEdges(db, files).flatMap((edge) => edge.terms);
      const expectA = ["tides", "lunar", "orbit", "gravity", "ocean", "moon", "basin", "swell", "current"];
      const expectB = [
        "compil",
        "parser",
        "grammar",
        "syntax",
        "token",
        "lexer",
        "scanner",
        "symbol",
        "tabl",
      ];
      for (const order of [
        ["a", "b", "a"],
        ["b", "a", "b"],
      ]) {
        for (const which of order) {
          const terms = termsOf(which === "a" ? a : b);
          const wanted = which === "a" ? expectA : expectB;
          expect(terms.length, `${order.join("")} ${which}`).toBeGreaterThan(0);
          for (const term of terms)
            expect(
              wanted.some((w) => w.startsWith(term.slice(0, 4))),
              `${term} in ${which}`,
            ).toBe(true);
        }
      }
    } finally {
      a.close();
      b.close();
    }
  });

  it("C35 a home has one owner in a process, and a lock nobody holds is taken over", async () => {
    const home = tempHome();
    const provider = echoProvider();
    const a = buildEngine([provider], { home });
    const b = buildEngine([echoProvider()], { home });
    const lockFile = path.join(home, "config", "run", "engine.lock");
    a.start();
    const held = fs.readFileSync(lockFile, "utf8");
    let refusal: unknown;
    try {
      b.start();
    } catch (error) {
      refusal = error;
    }
    expect(refusal).toBeInstanceOf(EngineLockedError);
    expect((refusal as EngineLockedError).holderPid).toBe(process.pid);
    expect((refusal as EngineLockedError).code).toBe("engine_locked");
    expect(fs.readFileSync(lockFile, "utf8")).toBe(held);
    await a.stop(500);
    expect(() => b.start()).not.toThrow();
    // Another home is another lock.
    const c = buildEngine([echoProvider()]);
    expect(() => c.start()).not.toThrow();
    // A lock naming this process that no engine of it holds is a dead engine's: taken over.
    await b.stop(500);
    fs.writeFileSync(
      lockFile,
      JSON.stringify({ v: 2, pid: process.pid, startedAt: 1, token: "left-behind", procStart: null }),
    );
    const d = buildEngine([echoProvider()], { home });
    expect(() => d.start()).not.toThrow();
    expect(JSON.parse(fs.readFileSync(lockFile, "utf8")).token).not.toBe("left-behind");
  });

  it("C66 the owner of a home is found under another spelling of its path, and from another copy of the package", async () => {
    const home = tempHome();
    const spelling = `${home}-link`;
    fs.symlinkSync(home, spelling);
    try {
      const a = buildEngine([echoProvider()], { home });
      a.start();
      // The same folder through a link: the same lock.
      const viaLink = buildEngine([echoProvider()], { home: spelling });
      expect(() => viaLink.start()).toThrow(EngineLockedError);

      // A second copy of the package in the process (two versions in node_modules) shares the registry of locks.
      vi.resetModules();
      const copy = await import("@mordomo/core");
      expect(copy.createEngine).not.toBe(createEngine);
      const provider = echoProvider();
      const other = copy.createEngine({
        home,
        seedDir: null,
        providers: new copy.ProviderRegistry().register(provider.manifest, provider.factory),
      });
      try {
        let refusal: unknown;
        try {
          other.start();
        } catch (error) {
          refusal = error;
        }
        expect((refusal as { code?: string } | undefined)?.code).toBe("engine_locked");
        expect((refusal as { holderPid?: number }).holderPid).toBe(process.pid);
      } finally {
        other.close();
      }
      await a.stop(500);
      expect(() => viaLink.start()).not.toThrow();
    } finally {
      fs.rmSync(spelling, { force: true });
    }
  });

  it("C71 the owner of a home is found by the lock file itself, so a home that is renamed while its engine runs is still owned", async () => {
    const home = tempHome();
    const moved = `${home}-moved`;
    try {
      const a = buildEngine([echoProvider()], { home });
      a.start();
      fs.renameSync(home, moved);
      // Same folder, new name: the registry knows the lock file, not the name it was reached by.
      const b = buildEngine([echoProvider()], { home: moved });
      expect(() => b.start()).toThrow(EngineLockedError);
      await a.stop(500);
      expect(() => b.start()).not.toThrow();
    } finally {
      fs.rmSync(moved, { recursive: true, force: true });
    }
  });

  describe("C73 the registry of locks, case by case", () => {
    const REGISTRY = Symbol.for("@mordomo/core/owner-lock/held");
    const registry = () => (globalThis as { [REGISTRY]?: Map<string, string> })[REGISTRY]!;
    const lockOf = (home: string) => path.join(home, "config", "run", "engine.lock");
    const mockStat = () => {
      const real = fs.statSync;
      return vi.spyOn(fs, "statSync").mockImplementation(((target: fs.PathLike, options?: unknown) => {
        if (String(target).endsWith("engine.lock")) throw Object.assign(new Error("EIO"), { code: "EIO" });
        return real(target, options as never);
      }) as typeof fs.statSync);
    };

    it("C73 every home has its own entry: a lock stays protected while engines of other homes start", () => {
      const [h1, h2] = [tempHome(), tempHome()];
      const [a, b] = [h1, h2].map((home) => buildEngine([echoProvider()], { home }));
      a!.start();
      b!.start();
      expect(registry().size).toBeGreaterThanOrEqual(2);
      // The first is still held after the second took its own, and the second is held too.
      expect(() => buildEngine([echoProvider()], { home: h1 }).start()).toThrow(EngineLockedError);
      expect(() => buildEngine([echoProvider()], { home: h2 }).start()).toThrow(EngineLockedError);
    });

    it("C73 a lock whose file identity cannot be read is still found by its real path", () => {
      const home = tempHome();
      const spy = mockStat();
      try {
        const a = buildEngine([echoProvider()], { home });
        a.start();
        // Still unreadable when the second engine asks.
        expect(() => buildEngine([echoProvider()], { home }).start()).toThrow(EngineLockedError);
      } finally {
        spy.mockRestore();
      }
    });

    it("C73 a lock registered by its path is found when the identity is readable again", () => {
      const home = tempHome();
      const spy = mockStat();
      const a = buildEngine([echoProvider()], { home });
      try {
        a.start();
      } finally {
        spy.mockRestore();
      }
      expect(() => buildEngine([echoProvider()], { home }).start()).toThrow(EngineLockedError);
    });

    it("C73 a lock file that names this process with a token the registry does not hold for it is taken over", () => {
      const home = tempHome();
      const a = buildEngine([echoProvider()], { home });
      a.start();
      // The same file (same identity), rewritten by hand with another token: the registry holds a different one.
      fs.writeFileSync(
        lockOf(home),
        JSON.stringify({ v: 2, pid: process.pid, startedAt: 1, token: "left-behind", procStart: null }),
      );
      const b = buildEngine([echoProvider()], { home });
      expect(() => b.start()).not.toThrow();
      expect(JSON.parse(fs.readFileSync(lockOf(home), "utf8")).token).not.toBe("left-behind");
    });

    it("C73 releasing a lock removes only its own entry", async () => {
      const home = tempHome();
      const a = buildEngine([echoProvider()], { home });
      a.start();
      const entry = [...registry().entries()].find(
        ([, token]) => token === JSON.parse(fs.readFileSync(lockOf(home), "utf8")).token,
      )!;
      // Somebody else's token under the same name (as a takeover of the same file would leave it).
      registry().set(entry[0], "someone-else");
      await a.stop(500);
      expect(registry().get(entry[0])).toBe("someone-else");
      registry().delete(entry[0]);
    });

    it("C73 stopping leaves no entry behind", async () => {
      const home = tempHome();
      const before = registry()?.size ?? 0;
      const a = buildEngine([echoProvider()], { home });
      a.start();
      expect(registry().size).toBe(before + 1);
      await a.stop(500);
      expect(registry().size).toBe(before);
    });
  });

  it("C36 a restore of one home does not hold up an engine of another, and two engines of one home are built", () => {
    const busy = resolvePaths(tempHome());
    fs.mkdirSync(busy.run, { recursive: true });
    const lock = RestoreLock.acquire(busy, 0, "exclusive");
    try {
      const started = Date.now();
      const other = createEngine({
        home: tempHome(),
        seedDir: null,
        providers: registryOf(echoProvider()),
        restoreWaitMs: 10_000,
      });
      expect(Date.now() - started).toBeLessThan(1000);
      other.close();
    } finally {
      lock.release();
    }
    const home = tempHome();
    const first = createEngine({ home, seedDir: null, providers: registryOf(echoProvider()) });
    const second = createEngine({ home, seedDir: null, providers: registryOf(echoProvider()) });
    first.close();
    second.close();
  });

  it("C47 the factory is given the engine's spawn policy, and an adapter built alone allows only its own binary", async () => {
    const provider = echoProvider();
    const engine = buildEngine([provider]);
    expect(provider.state.factoryOptions.length).toBeGreaterThan(0);
    for (const options of provider.state.factoryOptions)
      expect(options.spawn).toBe(internals(engine).spawnPolicy);
    internals(engine).reloadAdapters();
    expect(provider.state.factoryOptions.at(-1)?.spawn).toBe(internals(engine).spawnPolicy);

    if (!FAKE_CLIS_RUNNABLE) return;
    const own = await new ClaudeAdapter({ binaryPath: path.join(FAKE_BIN, "claude") }).detect();
    expect(own.version).not.toBeNull();
    expect(own.notes.filter((note) => /failed/.test(note))).toEqual([]);
    const foreign = await new ClaudeAdapter({ binaryPath: path.join(FAKE_BIN, "cursor-agent") }).detect();
    expect(foreign.version).toBeNull();
    expect(foreign.notes.join("\n")).toMatch(/--version failed: Executable is not on the allowlist/);
  });
});
