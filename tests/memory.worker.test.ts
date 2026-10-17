import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { monitorEventLoopDelay } from "node:perf_hooks";
import Database from "better-sqlite3";
import ts from "typescript";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { EVENT_SCHEMAS, EVENT_VERSIONS } from "@mordomo/contracts";
import { RestoreInProgressError, RestoreLock } from "../core/src/restoreLock.js";
import { IndexWorkerHost, IndexWorkerError, resolveWorkerEntry } from "../core/src/memory/indexHost.js";
import { IndexCancelledError } from "../core/src/memory/indexer.js";
import { StartMessage, WorkerMessage } from "../core/src/memory/indexProtocol.js";
import { AppContext } from "../apps/api/src/context.js";
import { buildServer } from "../apps/api/src/server.js";
import { makeTempHome } from "./helpers.js";
import { repoRoot } from "./helpers/childBundle.js";
import { bundleIndexWorker } from "./helpers/indexWorkerBundle.js";

/**
 * .specs/features/cerebro-v2, S3: the index pass in a worker thread. Everything here runs the REAL worker (a bundle of
 * the current sources) against a real home; the workers that crash, run out of memory or lie are small scripts written
 * for the test.
 */

let workerEntry: string;
beforeAll(async () => {
  workerEntry = await bundleIndexWorker();
}, 120_000);

const cleanups: Array<() => void | Promise<void>> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

interface Rig {
  ctx: AppContext;
  home: string;
  corpus: string;
  events: Array<{ type: string; v: number; payload: any }>;
}

const WORDS = Array.from({ length: 700 }, (_, i) => `termo${(i * 7919 + 13).toString(36)}`);
/**
 * A deterministic note of ~`words` words drawn from a vocabulary, linking to two others. `wide` draws from sixty
 * thousand words instead of seven hundred: the notes then share few words, so the related-by-content phase (quadratic
 * in the words notes share) takes seconds for 3 000 notes instead of a minute, and the pass is about what C32 measures.
 */
function note(i: number, count: number, words = 220, wide = false): string {
  let x = (i + 1) * 2654435761;
  const next = () => {
    x = (x * 1103515245 + 12345) % 2147483648;
    return x;
  };
  const body = Array.from({ length: words }, () =>
    wide ? `palavra${(next() % 60_000).toString(36)}` : WORDS[next() % WORDS.length],
  ).join(" ");
  return `# Nota ${i}\n\n${body}\n\nveja [[nota-${(i + 1) % count}]] e [outra](./nota-${(i + 7) % count}.md)\n`;
}
function writeCorpus(dir: string, count: number, from = 0, wide = false): void {
  fs.mkdirSync(dir, { recursive: true });
  for (let i = from; i < from + count; i++) {
    const sub = path.join(dir, `p${i % 12}`);
    if (!fs.existsSync(sub)) fs.mkdirSync(sub);
    fs.writeFileSync(path.join(sub, `nota-${i}.md`), note(i, from + count, 220, wide));
  }
}

function rig(options: { files?: number; entry?: string | null; wide?: boolean } = {}): Rig {
  const temp = makeTempHome("mordomo-worker-");
  const ctx = new AppContext(temp.paths.home);
  const corpus = path.join(temp.paths.home, "corpus");
  writeCorpus(corpus, options.files ?? 40, 0, options.wide);
  const settings = ctx.settings();
  settings.indexedFolders = [{ path: corpus, area: null, enabled: true }];
  ctx.settingsStore.save(settings);
  ctx.indexHost.setWorkerEntry(options.entry === undefined ? workerEntry : options.entry);
  const events: Rig["events"] = [];
  ctx.events.subscribe((e) => {
    if (e.type.startsWith("index.")) events.push({ type: e.type, v: e.v, payload: e.payload });
  });
  cleanups.push(() => {
    ctx.close();
    temp.cleanup();
  });
  return { ctx, home: temp.paths.home, corpus, events };
}

const snapshot = (ctx: AppContext) => ({
  files: ctx.db
    .prepare("SELECT path, rel, size, mtime, title, tags, area FROM files ORDER BY path")
    .all()
    .map((r: any) => ({ ...r })),
  fts: ctx.db
    .prepare(
      "SELECT f.path AS path, t.content AS content FROM files_fts t JOIN files f ON f.id = t.rowid ORDER BY f.path",
    )
    .all(),
  links: ctx.db
    .prepare(
      "SELECT f.path AS path, l.kind, l.target, l.line FROM note_links l JOIN files f ON f.id = l.src_id ORDER BY f.path, l.line, l.rowid",
    )
    .all(),
  // the edges themselves (which file, which file, how strongly, through which words), not how many there are
  related: ctx.db
    .prepare(
      `SELECT s.path AS src, d.path AS dst, r.score AS score, r.terms AS terms
         FROM file_related r JOIN files s ON s.id = r.src_id JOIN files d ON d.id = r.dst_id
        ORDER BY s.path, d.path`,
    )
    .all()
    .map((r: any) => ({ ...r })),
});

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(check: () => boolean, ms = 20_000): Promise<void> {
  const deadline = Date.now() + ms;
  while (!check()) {
    if (Date.now() > deadline) throw new Error("timed out waiting");
    await sleep(5);
  }
}

/** A worker script of the test's own, written where the bundle cannot be mistaken for it. */
function script(body: string): string {
  const dir = fs.mkdtempSync(path.join(repoRoot, "node_modules", ".cache", "mordomo-tests-"));
  const file = path.join(dir, "worker.mjs");
  fs.writeFileSync(file, `import { parentPort } from "node:worker_threads";\n${body}\n`);
  cleanups.push(() => fs.rmSync(dir, { recursive: true, force: true }));
  return file;
}

describe("S3 the index pass in a worker", () => {
  /**
   * What the service's event loop has to wait for while a pass runs in the worker is the write lock: the service writes
   * to its own connection all the time (run events, the scheduler, the journal), and `better-sqlite3` waits for a taken
   * lock inside the call, loop stopped, for as long as the other connection holds it. So the probe is a writer on the
   * service connection, every 10 ms, timing each write; the loop's own delay is read beside it.
   */
  async function duringPass(r: Rig) {
    const insert = r.ctx.db.prepare(
      "INSERT INTO meta (key, value) VALUES ('c32.probe', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
    );
    const waits: number[] = [];
    const histogram = monitorEventLoopDelay({ resolution: 5 });
    histogram.enable();
    let running = true;
    const writer = (async () => {
      while (running) {
        const began = performance.now();
        insert.run(String(began));
        waits.push(performance.now() - began);
        await sleep(10);
      }
    })();
    let stats;
    try {
      stats = await r.ctx.indexer.indexAllAsync();
    } catch (error) {
      stats = error as Error;
    } finally {
      running = false;
      await writer;
      histogram.disable();
    }
    return {
      stats,
      writes: waits.length,
      longestWriteMs: Math.max(...waits),
      slowWrites: waits.filter((ms) => ms >= 100).length,
      loopP99Ms: histogram.percentile(99) / 1e6,
    };
  }

  it("C32 a write on the service connection during a worker pass over 3 000 files does not wait for the worker (100 ms at most for all but 3, none 250 ms), and the loop keeps its pace", async () => {
    const r = rig({ files: 3000, wide: true });
    const during = await duringPass(r);
    expect(during.stats, "the pass").toMatchObject({ added: 3000 });
    // the writer really ran through the pass (a pass takes seconds; the writer wakes every 10 ms)
    expect(during.writes).toBeGreaterThan(300);
    // Measured on 3 000 files with 100 writes a second: the longest wait is 34 ms on a quiet machine, 79 ms with six busy
    // loops on four cores, and 109 ms once in a full run of the whole suite (a wave of the worker holds the lock about
    // 5 ms; the driver polls for it at 1, 3, 8, 18, 33 ... ms; a starved thread adds its own time slice). The pass as
    // it was (waves of 200 files, no rest) had 13 to 15 writes of 100 ms or more and longest waits of 180 to 340 ms.
    // So: the design target of the acceptance criterion (100 ms) is held by all but the odd write a loaded scheduler
    // delays (at most 3 of a thousand and more), and no write waits 250 ms, which is a worker that holds the lock.
    expect(during.slowWrites, "writes of 100 ms or more").toBeLessThanOrEqual(3);
    expect(during.longestWriteMs, "longest write").toBeLessThan(250);
    // the delay of the loop between its own turns: its 99th percentile, because a single scheduler stall of a shared
    // machine says nothing about the pass (the longest wait for the worker is the line above)
    expect(during.loopP99Ms, "loop p99").toBeLessThan(100);
  }, 300_000);

  it("C32 the same probe sees a worker that holds the write lock for 300 ms (so the bound on the longest write can fail)", async () => {
    const holder = script(
      'import Database from "better-sqlite3";\n' +
        "const stats = { scanned: 0, added: 0, updated: 0, removed: 0, skippedExcluded: 0, skippedBinary: 0, related: 0, durationMs: 0 };\n" +
        "const nap = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);\n" +
        'parentPort.once("message", (start) => {\n' +
        "  const db = new Database(start.dbFile);\n" +
        "  for (let i = 0; i < 6; i++) {\n" +
        '    db.exec("BEGIN IMMEDIATE");\n' +
        "    db.prepare(\"INSERT INTO meta (key, value) VALUES ('c32.holder', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value\").run(String(i));\n" +
        "    nap(300);\n" +
        '    db.exec("COMMIT");\n' +
        "    nap(30);\n" +
        "  }\n" +
        "  db.close();\n" +
        '  parentPort.postMessage({ t: "done", stats });\n' +
        "});",
    );
    const r = rig({ files: 5, entry: holder });
    const during = await duringPass(r);
    expect(during.stats).toMatchObject({ added: 0 });
    // each hold of the lock stops the write that lands in it for most of the 300 ms, so the longest bound above fails on
    // it (how many writes land in a hold depends on how fast the thread starts: only "at least one" is asked)
    expect(during.slowWrites).toBeGreaterThanOrEqual(1);
    expect(during.longestWriteMs).toBeGreaterThan(250);
  }, 120_000);

  it("C32 a commit by another connection in the middle of a wave does not fail the pass: the wave holds the write lock from its first statement", async () => {
    const r = rig({ files: 60 });
    r.ctx.indexHost.setWorkerEntry(null); // the pass in this thread: its statements can be watched
    const other = new Database(r.ctx.paths.dbFile);
    cleanups.push(() => other.close());
    other.pragma("busy_timeout = 0");
    const refused: string[] = [];
    const intruded = other.prepare(
      "INSERT INTO meta (key, value) VALUES ('c32.other', 'x') ON CONFLICT(key) DO UPDATE SET value = excluded.value",
    );
    const db = r.ctx.db as unknown as { prepare: (sql: string) => any };
    const prepare = db.prepare.bind(db);
    db.prepare = (sql: string) => {
      const statement = prepare(sql);
      // the first statement of a wave's transaction READS the row of the file; a writer that commits right after it
      // invalidates the snapshot of a transaction that has not taken the lock yet
      if (sql.trim() !== "SELECT id FROM files WHERE path = ?") return statement;
      const get = statement.get.bind(statement);
      statement.get = (...args: unknown[]) => {
        const row = get(...args);
        try {
          intruded.run();
        } catch (error) {
          refused.push((error as { code?: string }).code ?? String(error));
        }
        return row;
      };
      return statement;
    };
    const stats = await r.ctx.indexer.indexAllAsync();
    expect(stats.added).toBe(60);
    // every attempt of the other connection met the lock the wave already held
    expect(refused.length).toBeGreaterThan(0);
    expect([...new Set(refused)]).toEqual(["SQLITE_BUSY"]);
  }, 120_000);

  it("C33 a pass announces started, progress of each phase in order, and finished, each a v1 envelope its schema accepts", async () => {
    const r = rig();
    const stats = await r.ctx.indexer.indexAllAsync();
    const types = r.events.map((e) => e.type);
    expect(types[0]).toBe("index.started");
    expect(types.at(-1)).toBe("index.finished");
    expect(types.filter((t) => t === "index.started")).toHaveLength(1);
    const started = r.events[0]!.payload as { runId: string; mode: string };
    expect(started.mode).toBe("worker");
    const progress = r.events.filter((e) => e.type === "index.progress");
    const phases = [...new Set(progress.map((e) => e.payload.phase))];
    expect(phases).toEqual(["scan", "index", "prune", "related"]);
    for (const event of progress) expect(event.payload.runId).toBe(started.runId);
    // never backwards
    const order = ["scan", "index", "prune", "related", "vectors"];
    const seen = progress.map((e) => order.indexOf(e.payload.phase));
    expect(seen).toEqual([...seen].sort((a, b) => a - b));
    expect(r.events.at(-1)!.payload).toEqual({ stats, runId: started.runId });
    for (const event of r.events) {
      expect(event.v).toBe(1);
      expect(EVENT_VERSIONS[event.type as keyof typeof EVENT_VERSIONS]).toEqual([1]);
      const schema = EVENT_SCHEMAS[event.type as keyof typeof EVENT_SCHEMAS][event.v]!;
      expect(() => schema.parse(event.payload), event.type).not.toThrow();
    }
    // the failure and the cancel are announced by other tests (C34, C36); the worker itself announced nothing
    expect(types.every((t) => ["index.started", "index.progress", "index.finished"].includes(t))).toBe(true);
  });

  it("C34 cancel stops the pass within 2 s at a block, keeps what was committed, removes nothing not yet seen, and the call answers 409", async () => {
    const r = rig({ files: 60 });
    const app = await buildServer(r.ctx);
    cleanups.push(() => app.close());
    const headers = { "x-mordomo-token": r.ctx.token() };
    // the idle cancel
    const idle = await app.inject({ method: "POST", url: "/api/memory/index/cancel", headers, payload: {} });
    expect([idle.statusCode, idle.json()]).toEqual([200, { cancelled: false, runId: null }]);

    await r.ctx.indexer.indexAllAsync(); // a previous index of 60 files
    const before = r.ctx.db
      .prepare("SELECT COUNT(*) AS c FROM files WHERE path LIKE ?")
      .get(`${r.corpus}%`) as { c: number };
    expect(before.c).toBe(60);
    // twelve of them vanish and 1 200 new ones appear: the pass has to walk past the vanished ones to prune them
    for (let i = 0; i < 12; i++) fs.rmSync(path.join(r.corpus, `p${i % 12}`, `nota-${i}.md`));
    writeCorpus(path.join(r.corpus, "novos"), 1200, 1000);
    r.events.length = 0;

    let cancelledAt = 0;
    const answer = app.inject({ method: "POST", url: "/api/memory/index", headers, payload: {} });
    await until(() =>
      r.events.some((e) => e.type === "index.progress" && e.payload.phase === "index" && e.payload.added > 0),
    );
    cancelledAt = Date.now();
    const cancel = await app.inject({
      method: "POST",
      url: "/api/memory/index/cancel",
      headers,
      payload: {},
    });
    const runId = (r.events[0]!.payload as { runId: string }).runId;
    expect([cancel.statusCode, cancel.json()]).toEqual([200, { cancelled: true, runId }]);
    const result = await answer;
    expect(Date.now() - cancelledAt).toBeLessThan(2000);
    expect([result.statusCode, (result.json() as any).error.code]).toEqual([409, "index_cancelled"]);
    expect(r.events.map((e) => e.type)).toContain("index.cancelled");
    expect(r.events.at(-1)).toMatchObject({ type: "index.cancelled", payload: { runId } });
    expect(r.events.some((e) => e.type === "index.finished")).toBe(false);

    const rows = r.ctx.db.prepare("SELECT path FROM files WHERE path LIKE ?").all(`${r.corpus}%`) as Array<{
      path: string;
    }>;
    // what the committed blocks wrote stays (the new files of at least one block)...
    expect(rows.filter((x) => x.path.includes("/novos/")).length).toBeGreaterThanOrEqual(1);
    expect(rows.filter((x) => x.path.includes("/novos/")).length).toBeLessThan(1200);
    // ...and the twelve that vanished are still rows: the prune phase was never reached
    expect(rows.filter((x) => !x.path.includes("/novos/")).length).toBe(60);
    expect(r.ctx.indexHost.status().state).toBe("idle");
    // the next pass finishes the work
    const next = await r.ctx.indexer.indexAllAsync();
    expect(next.removed).toBe(12);
    expect(
      (
        r.ctx.db.prepare("SELECT COUNT(*) AS c FROM files WHERE path LIKE ?").get(`${r.corpus}%`) as {
          c: number;
        }
      ).c,
    ).toBe(48 + 1200);
  }, 300_000);

  it("C34 a worker that does not reach its next block is stopped after the grace period", async () => {
    const r = rig();
    const stuck = script(
      'parentPort.once("message", () => { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 60000); });',
    );
    const host = new IndexWorkerHost({
      paths: r.ctx.paths,
      db: r.ctx.db,
      bus: r.ctx.events,
      getSettings: () => r.ctx.settings(),
      indexer: r.ctx.indexer,
      workerEntry: stuck,
      cancelGraceMs: 300,
    });
    const pass = host.run();
    await until(() => host.status().state === "running");
    await sleep(100);
    const started = Date.now();
    expect(host.cancel().cancelled).toBe(true);
    await expect(pass).rejects.toBeInstanceOf(IndexCancelledError);
    expect(Date.now() - started).toBeLessThan(2000);
    expect(host.status().state).toBe("idle");
  });

  it("C35 a second pass over unchanged files reads none of them; a worker killed mid-pass and a new pass leave what a clean pass leaves", async () => {
    const r = rig({ files: 300 });
    await r.ctx.indexer.indexAllAsync();
    const first = r.ctx.db.prepare("SELECT path, indexed_at FROM files ORDER BY path").all();
    await sleep(25);
    const again = await r.ctx.indexer.indexAllAsync();
    expect([again.added, again.updated, again.removed]).toEqual([0, 0, 0]);
    // a row is re-stamped only when its file is read again
    expect(r.ctx.db.prepare("SELECT path, indexed_at FROM files ORDER BY path").all()).toEqual(first);
    // the same claim, seen from the file system: the pass in this thread opens none of them
    r.ctx.indexHost.setWorkerEntry(null);
    const opened: string[] = [];
    const realOpen = fs.openSync;
    (fs as any).openSync = (file: fs.PathLike, ...rest: unknown[]) => {
      if (String(file).startsWith(r.corpus)) opened.push(String(file));
      return (realOpen as (...a: unknown[]) => number)(file, ...rest);
    };
    try {
      await r.ctx.indexer.indexAllAsync();
    } finally {
      (fs as any).openSync = realOpen;
    }
    expect(opened).toEqual([]);
    r.ctx.indexHost.setWorkerEntry(workerEntry);

    // a pass killed after its second block
    const killed = rig({ files: 40 });
    writeCorpus(path.join(killed.corpus, "mais"), 900, 5000);
    const pass = killed.ctx.indexer.indexAllAsync();
    pass.catch(() => undefined);
    await until(
      () =>
        killed.events.filter(
          (e) => e.type === "index.progress" && e.payload.phase === "index" && e.payload.added >= 400,
        ).length > 0,
    );
    (killed.ctx.indexHost as any).current.worker.terminate();
    await expect(pass).rejects.toMatchObject({ code: "index_worker_crashed" });
    expect(killed.ctx.indexHost.status().state).toBe("idle");
    await killed.ctx.indexer.indexAllAsync();
    // the same corpus, indexed clean in another home
    const clean = rig({ files: 40 });
    writeCorpus(path.join(clean.corpus, "mais"), 900, 5000);
    await clean.ctx.indexer.indexAllAsync();
    const strip = (s: ReturnType<typeof snapshot>) => ({
      ...s,
      files: s.files.map(({ path: p, ...rest }) => ({ ...rest, path: p.replace(/^.*\/corpus/, "") })),
      fts: s.fts.map((x: any) => ({ ...x, path: x.path.replace(/^.*\/corpus/, "") })),
      links: s.links.map((x: any) => ({
        ...x,
        path: x.path.replace(/^.*\/corpus/, ""),
        target: x.target.replace(/^.*\/corpus/, ""),
      })),
      related: s.related.map((x: any) => ({
        ...x,
        src: x.src.replace(/^.*\/corpus/, ""),
        dst: x.dst.replace(/^.*\/corpus/, ""),
      })),
    });
    const a = strip(snapshot(killed.ctx));
    const b = strip(snapshot(clean.ctx));
    expect(a.files.map((f) => f.path)).toEqual(b.files.map((f) => f.path));
    expect(a.files.map(({ mtime: _mtime, ...f }) => f)).toEqual(b.files.map(({ mtime: _mtime, ...f }) => f));
    expect(a.fts).toEqual(b.fts);
    expect(a.links).toEqual(b.links);
    // a corpus this size has related edges (a pass that never related would leave two empty sets that agree)
    expect(b.related.length).toBeGreaterThan(100);
    expect(a.related).toEqual(b.related);
  }, 300_000);

  it("C36 a worker that exits, throws or runs past its memory limit ends the pass with its code, frees the lock, keeps the index, and the next pass starts a new worker", async () => {
    const r = rig({ files: 20 });
    await r.ctx.indexer.indexAllAsync();
    const rows = () => (r.ctx.db.prepare("SELECT COUNT(*) AS c FROM files").get() as { c: number }).c;
    const before = rows();
    const cases: Array<[string, string, string, Record<string, unknown>?]> = [
      ["exit", 'parentPort.once("message", () => process.exit(1));', "index_worker_crashed"],
      ["throw", 'parentPort.once("message", () => { throw new Error("boom"); });', "index_worker_crashed"],
      [
        "memory",
        'parentPort.once("message", () => { const held = []; for (;;) held.push(new Array(200000).fill(Math.random())); });',
        "index_worker_out_of_memory",
        { maxOldGenerationSizeMb: 16, maxYoungGenerationSizeMb: 4 },
      ],
    ];
    const app = await buildServer(r.ctx);
    cleanups.push(() => app.close());
    for (const [name, body, code, limits] of cases) {
      r.events.length = 0;
      const host = new IndexWorkerHost({
        paths: r.ctx.paths,
        db: r.ctx.db,
        bus: r.ctx.events,
        getSettings: () => r.ctx.settings(),
        indexer: r.ctx.indexer,
        workerEntry: script(body),
        ...(limits ? { resourceLimits: limits } : {}),
      });
      await expect(host.run(), name).rejects.toMatchObject({ code, statusCode: 503 });
      await expect(host.run(), name).rejects.toBeInstanceOf(IndexWorkerError);
      expect(r.events.find((e) => e.type === "index.failed")?.payload, name).toMatchObject({
        code,
        previousIndexPreserved: true,
      });
      expect(host.status().state, name).toBe("idle");
      // the restore lock is free: an exclusive taker gets it
      RestoreLock.acquire(r.ctx.paths, 0, "exclusive").release();
      expect(rows(), name).toBe(before);
    }
    // and through the route: 503 with the code
    (r.ctx.indexer as any).runner = new IndexWorkerHost({
      paths: r.ctx.paths,
      db: r.ctx.db,
      bus: r.ctx.events,
      getSettings: () => r.ctx.settings(),
      indexer: r.ctx.indexer,
      workerEntry: script('parentPort.once("message", () => process.exit(1));'),
    });
    const crashed = await app.inject({
      method: "POST",
      url: "/api/memory/index",
      headers: { "x-mordomo-token": r.ctx.token() },
      payload: {},
    });
    expect([crashed.statusCode, (crashed.json() as any).error.code]).toEqual([503, "index_worker_crashed"]);
    // a new worker, the real one, finishes
    r.ctx.indexHost.setWorkerEntry(workerEntry);
    r.ctx.indexer.attachRunner(r.ctx.indexHost);
    expect((await r.ctx.indexer.indexAllAsync()).scanned).toBeGreaterThan(0);
  }, 300_000);

  it("C36 a folder the worker cannot read ends the pass as 409 index_scan_incomplete, announced as such, with every row kept", async () => {
    const r = rig({ files: 30 });
    const app = await buildServer(r.ctx);
    cleanups.push(() => app.close());
    const headers = { "x-mordomo-token": r.ctx.token() };
    await r.ctx.indexer.indexAllAsync();
    const rows = () => (r.ctx.db.prepare("SELECT COUNT(*) AS c FROM files").get() as { c: number }).c;
    const before = { rows: rows(), last: r.ctx.indexer.lastIndex() };
    expect(before.rows).toBe(30);
    // the folder goes away between two passes (a disk that is not mounted): the scan cannot prove what vanished
    const away = `${r.corpus}-away`;
    fs.renameSync(r.corpus, away);
    r.events.length = 0;
    const refused = await app.inject({ method: "POST", url: "/api/memory/index", headers, payload: {} });
    // the pass really ran in the worker thread
    expect((r.events[0]!.payload as { mode: string }).mode).toBe("worker");
    expect([refused.statusCode, (refused.json() as any).error.code]).toEqual([409, "index_scan_incomplete"]);
    expect((refused.json() as any).message).toContain("previous index was preserved");
    expect(r.events.find((e) => e.type === "index.failed")?.payload).toMatchObject({
      code: "index_scan_incomplete",
      previousIndexPreserved: true,
    });
    expect(r.ctx.indexHost.status().state).toBe("idle");
    expect(rows()).toBe(30);
    expect(r.ctx.indexer.lastIndex()).toEqual(before.last);
    RestoreLock.acquire(r.ctx.paths, 0, "exclusive").release();
    // the folder is back and the next pass is a pass
    fs.renameSync(away, r.corpus);
    const retry = await app.inject({ method: "POST", url: "/api/memory/index", headers, payload: {} });
    expect(retry.statusCode).toBe(200);
    expect(rows()).toBe(30);
  }, 120_000);

  it("C37 while a restore holds the home the pass is refused and no worker starts; during a pass a restore is refused; after it the lock is free", async () => {
    const r = rig();
    const marker = path.join(r.home, "worker-started");
    const probe = script(
      `import fs from "node:fs"; fs.writeFileSync(${JSON.stringify(marker)}, "x"); parentPort.once("message", () => process.exit(0));`,
    );
    const app = await buildServer(r.ctx);
    cleanups.push(() => app.close());
    const headers = { "x-mordomo-token": r.ctx.token() };
    const host = new IndexWorkerHost({
      paths: r.ctx.paths,
      db: r.ctx.db,
      bus: r.ctx.events,
      getSettings: () => r.ctx.settings(),
      indexer: r.ctx.indexer,
      workerEntry: probe,
    });
    // a restore (the exclusive lock) is in progress
    const restore = RestoreLock.acquire(r.ctx.paths, 0, "exclusive");
    const refused = await app.inject({ method: "POST", url: "/api/memory/index", headers, payload: {} });
    expect([refused.statusCode, (refused.json() as any).error.code]).toEqual([409, "restore_in_progress"]);
    await sleep(300);
    expect(fs.existsSync(marker)).toBe(false);
    expect(r.events.find((e) => e.type === "index.failed")?.payload).toMatchObject({
      code: "restore_in_progress",
    });
    expect(r.events.some((e) => e.type === "index.started")).toBe(false);
    restore.release();
    void host;

    // during a pass an exclusive taker is refused; after each way a pass can end, it is free
    r.ctx.indexHost.setWorkerEntry(workerEntry);
    r.ctx.indexer.attachRunner(r.ctx.indexHost);
    let during: unknown = null;
    const stop = r.ctx.events.subscribe((e) => {
      if (e.type === "index.started" && during === null) {
        try {
          RestoreLock.acquire(r.ctx.paths, 0, "exclusive").release();
          during = "acquired";
        } catch (error) {
          during = error;
        }
      }
    });
    await r.ctx.indexer.indexAllAsync();
    expect(during).toBeInstanceOf(RestoreInProgressError);
    RestoreLock.acquire(r.ctx.paths, 0, "exclusive").release(); // finished
    // cancelled
    writeCorpus(path.join(r.corpus, "extra"), 800, 9000);
    during = "reset";
    const pass = r.ctx.indexer.indexAllAsync();
    pass.catch(() => undefined);
    await until(() => r.ctx.indexHost.status().state === "running");
    r.ctx.indexHost.cancel();
    await expect(pass).rejects.toBeInstanceOf(IndexCancelledError);
    RestoreLock.acquire(r.ctx.paths, 0, "exclusive").release();
    // failed
    const failing = new IndexWorkerHost({
      paths: r.ctx.paths,
      db: r.ctx.db,
      bus: r.ctx.events,
      getSettings: () => r.ctx.settings(),
      indexer: r.ctx.indexer,
      workerEntry: script('parentPort.once("message", () => process.exit(2));'),
    });
    await expect(failing.run()).rejects.toBeInstanceOf(IndexWorkerError);
    RestoreLock.acquire(r.ctx.paths, 0, "exclusive").release();
    stop();
  }, 300_000);

  it("C38 the worker indexes with the filter of the inline pass: no config, logs, secret names, user excludes or linked folders", async () => {
    const build = (entry: string | null) => {
      const r = rig({ files: 0, entry });
      const home = r.home;
      const put = (rel: string, text: string) => {
        fs.mkdirSync(path.dirname(path.join(home, rel)), { recursive: true });
        fs.writeFileSync(path.join(home, rel), text);
      };
      put("memory/ok.md", "# ok\n\nvisível palavracomum\n");
      put("memory/privado/x.md", "# privado\n\npalavracomum\n");
      put("memory/.env", "SECRET=1 palavracomum\n");
      put("memory/chave.pem", "palavracomum\n");
      put("config/extra.md", "palavracomum no config\n");
      put("logs/api.jsonl", '{"palavracomum":1}\n');
      fs.symlinkSync(path.join(home, "config"), path.join(home, "memory", "para-config"));
      fs.symlinkSync(path.join(home, "memory", "ok.md"), path.join(home, "memory", "atalho.md"));
      const settings = r.ctx.settings();
      settings.indexedFolders = [{ path: home, area: null, enabled: true }];
      settings.excludes = [...settings.excludes, "privado"];
      r.ctx.settingsStore.save(settings);
      return r;
    };
    const viaWorker = build(workerEntry);
    const inline = build(null);
    await viaWorker.ctx.indexer.indexAllAsync();
    await inline.ctx.indexer.indexAllAsync();
    const rels = (r: Rig) =>
      r.ctx.db
        .prepare("SELECT rel FROM files ORDER BY rel")
        .all()
        .map((x: any) => x.rel);
    const indexed = rels(viaWorker);
    expect(indexed).toEqual(rels(inline));
    for (const private_ of [
      "config",
      "logs",
      ".env",
      "chave.pem",
      "privado",
      "para-config",
      "atalho.md",
      "token",
    ])
      expect(
        indexed.filter((rel: string) => rel.includes(private_)),
        private_,
      ).toEqual([]);
    expect(indexed).toContain("ok.md");
    const hits = viaWorker.ctx.db
      .prepare("SELECT COUNT(*) AS c FROM files_fts WHERE files_fts MATCH ?")
      .get('"palavracomum"') as { c: number };
    expect(hits.c).toBe(1);
  }, 120_000);

  it("C38 the worker's value-import graph reaches no engine, owner lock, restore lock or code that opens the database with migrations", () => {
    const entry = path.join(repoRoot, "core/src/memory/indexWorker.ts");
    const reached = reachableByValue(entry);
    const rel = [...reached].map((f) => path.relative(repoRoot, f));
    for (const forbidden of [
      "core/src/engine.ts",
      "core/src/ownerLock.ts",
      "core/src/restoreLock.ts",
      "core/src/db/db.ts",
      "core/src/db/migrations.ts",
    ])
      expect(rel, forbidden).not.toContain(forbidden);
    // it does reach the indexer and the safe reader: the walk is not vacuous
    expect(rel).toContain("core/src/memory/indexer.ts");
    expect(rel).toContain("core/src/security/safeFs.ts");
    expect(rel.filter((f) => !f.startsWith("core/src/") && !f.startsWith("contracts/src/"))).toEqual([]);
  });

  it("C38 the walker follows imports, re-exports, side-effect and dynamic imports in either quote style and skips type-only ones", () => {
    const sources: Record<string, string> = {
      "/a.ts":
        'import x from "./b.js"; import type { T } from "./type-only.js"; import { type U } from \'./also-type.js\'; export * from "./c.js"; import "./side.js"; const d = await import(\'./dyn.js\');',
      "/b.ts": "export const b = 1;",
      "/c.ts": 'export { z } from "./d.js";',
      "/d.ts": "export const z = 1;",
      "/side.ts": "",
      "/dyn.ts": "",
      "/type-only.ts": "",
      "/also-type.ts": "",
    };
    const files = reachableByValue("/a.ts", (file) => sources[file]);
    expect([...files].sort()).toEqual(["/a.ts", "/b.ts", "/c.ts", "/d.ts", "/dyn.ts", "/side.ts"]);
  });

  it("C39 closing the engine during a pass cancels it, stops the worker and frees the lock; closing twice is harmless; two engines keep their own passes", async () => {
    const a = rig({ files: 300 });
    writeCorpus(path.join(a.corpus, "mais"), 900, 4000);
    const pass = a.ctx.indexer.indexAllAsync();
    pass.catch(() => undefined);
    await until(() => a.events.some((e) => e.type === "index.progress" && e.payload.phase === "index"));
    a.ctx.close();
    // the lock is free at once: a restore may start now
    RestoreLock.acquire(a.ctx.paths, 0, "exclusive").release();
    await expect(pass).rejects.toBeInstanceOf(IndexCancelledError);
    expect(a.ctx.indexHost.isRunning()).toBe(false);
    expect(a.ctx.indexer.isIndexing()).toBe(false);
    a.ctx.close();
    await expect(a.ctx.indexHost.run()).rejects.toBeInstanceOf(IndexCancelledError);
    await a.ctx.indexHost.disposeAsync();

    // two engines of one process, two homes
    const one = rig({ files: 120 });
    const two = rig({ files: 90 });
    const [s1, s2] = await Promise.all([one.ctx.indexer.indexAllAsync(), two.ctx.indexer.indexAllAsync()]);
    expect([s1.added, s2.added]).toEqual([120, 90]);
    const run1 = (one.events[0]!.payload as { runId: string }).runId;
    const run2 = (two.events[0]!.payload as { runId: string }).runId;
    expect(run1).not.toBe(run2);
    expect(one.events.every((e) => e.payload.runId === undefined || e.payload.runId === run1)).toBe(true);
    expect(two.events.every((e) => e.payload.runId === undefined || e.payload.runId === run2)).toBe(true);
    expect(one.ctx.indexHost).not.toBe(two.ctx.indexHost);
  }, 300_000);

  it("C39 stop() resolves with the worker gone", async () => {
    const r = rig({ files: 300 });
    writeCorpus(path.join(r.corpus, "mais"), 900, 4000);
    const pass = r.ctx.indexer.indexAllAsync();
    pass.catch(() => undefined);
    await until(() => r.events.some((e) => e.type === "index.progress" && e.payload.phase === "index"));
    await r.ctx.stop(2000);
    await expect(pass).rejects.toBeInstanceOf(IndexCancelledError);
    expect(r.ctx.indexHost.isRunning()).toBe(false);
  }, 300_000);

  it("C40 without the worker script the pass runs in the service's thread (mode inline); with it, in a worker; the results are the same", async () => {
    const inline = rig({ entry: null });
    const worker = rig({});
    expect(inline.ctx.indexHost.mode()).toBe("inline");
    expect(worker.ctx.indexHost.mode()).toBe("worker");
    const app = await buildServer(inline.ctx);
    cleanups.push(() => app.close());
    const s1 = await inline.ctx.indexer.indexAllAsync();
    const s2 = await worker.ctx.indexer.indexAllAsync();
    expect(inline.events[0]!.payload).toMatchObject({ mode: "inline" });
    expect(worker.events[0]!.payload).toMatchObject({ mode: "worker" });
    expect([s1.scanned, s1.added, s1.related]).toEqual([s2.scanned, s2.added, s2.related]);
    const status = await app.inject({
      url: "/api/memory/status",
      headers: { "x-mordomo-token": inline.ctx.token() },
    });
    expect((status.json() as any).indexing).toMatchObject({
      state: "idle",
      mode: "inline",
      runId: null,
      interrupted: false,
    });
    // the default of an engine in the source tree has no script (inline); the compiled tree and the installer have one
    const fresh = new AppContext(makeTempHome("mordomo-default-").paths.home);
    cleanups.push(() => fresh.close());
    expect(fresh.indexHost.mode()).toBe("inline");
    expect(
      resolveWorkerEntry(pathToFileURL(path.join(repoRoot, "core/src/memory/indexHost.ts")).href),
    ).toBeNull();
    const built = path.join(repoRoot, "core/dist/memory/indexHost.js");
    if (fs.existsSync(built))
      expect(resolveWorkerEntry(pathToFileURL(built).href)).toBe(
        path.join(repoRoot, "core/dist/memory/indexWorker.js"),
      );
    const installed = fs.mkdtempSync(path.join(os.tmpdir(), "mordomo-installed-"));
    cleanups.push(() => fs.rmSync(installed, { recursive: true, force: true }));
    fs.writeFileSync(path.join(installed, "indexWorker.mjs"), "");
    expect(resolveWorkerEntry(pathToFileURL(path.join(installed, "mordomo.mjs")).href)).toBe(
      path.join(installed, "indexWorker.mjs"),
    );
  }, 120_000);

  it("C41 two concurrent index calls share one pass; paths asked for during a pass become one follow-up pass over their union", async () => {
    const r = rig({ files: 300 });
    writeCorpus(path.join(r.corpus, "mais"), 900, 4000);
    const app = await buildServer(r.ctx);
    cleanups.push(() => app.close());
    const headers = { "x-mordomo-token": r.ctx.token() };
    const calls: Array<{ only?: readonly string[] }> = [];
    const host = r.ctx.indexHost;
    const run = host.run.bind(host);
    host.run = (request = {}) => {
      calls.push({ ...(request.only ? { only: request.only } : {}) });
      return run(request);
    };
    const [one, two] = await Promise.all([
      app.inject({ method: "POST", url: "/api/memory/index", headers, payload: {} }),
      app.inject({ method: "POST", url: "/api/memory/index", headers, payload: {} }),
    ]);
    expect([one.statusCode, two.statusCode]).toEqual([200, 200]);
    expect(one.json()).toEqual(two.json());
    expect(r.events.filter((e) => e.type === "index.started")).toHaveLength(1);
    expect(calls.filter((c) => !c.only)).toHaveLength(1);

    // three requests during a running pass
    r.events.length = 0;
    calls.length = 0;
    const a = path.join(r.corpus, "novo-a.md");
    const b = path.join(r.corpus, "novo-b.md");
    const c = path.join(r.corpus, "novo-c.md");
    for (const f of [a, b, c]) fs.writeFileSync(f, `# ${path.basename(f)}\n`);
    writeCorpus(path.join(r.corpus, "mais2"), 900, 7000);
    const full = r.ctx.indexer.indexAllAsync();
    await until(() => r.ctx.indexHost.status().state === "running");
    const waits = [
      r.ctx.indexer.requestIndexPaths([a]),
      r.ctx.indexer.requestIndexPaths([b]),
      r.ctx.indexer.requestIndexPaths([c, a]),
    ];
    await Promise.all([full, ...waits]);
    const follow = calls.filter((x) => x.only);
    expect(follow).toHaveLength(1);
    expect([...follow[0]!.only!].sort()).toEqual([a, b, c]);
    expect(r.events.filter((e) => e.type === "index.started")).toHaveLength(2);
    const rows = r.ctx.db
      .prepare("SELECT path FROM files WHERE path IN (?, ?, ?) ORDER BY path")
      .all(a, b, c);
    expect(rows).toHaveLength(3);
  }, 300_000);

  it("C58 the messages of both directions parse against one schema; an unknown kind is ignored and a malformed progress fails the pass", async () => {
    const start = {
      t: "start",
      runId: "r1",
      dbFile: "/x.db",
      homeDir: "/home",
      settings: {},
      implicitRoots: [{ path: "/home/memory", area: null, enabled: true }],
      cancel: new SharedArrayBuffer(4),
      paceMs: 2,
    };
    expect(StartMessage.safeParse(start).success).toBe(true);
    for (const missing of ["runId", "dbFile", "homeDir", "settings", "implicitRoots", "cancel", "paceMs"])
      expect(StartMessage.safeParse({ ...start, [missing]: undefined }).success, missing).toBe(false);
    expect(StartMessage.safeParse({ ...start, cancel: new ArrayBuffer(4) }).success).toBe(false);
    const stats = {
      scanned: 1,
      added: 1,
      updated: 0,
      removed: 0,
      skippedExcluded: 0,
      skippedBinary: 0,
      related: 0,
      durationMs: 1,
    };
    const good = [
      {
        t: "progress",
        progress: { scanned: 1, added: 0, updated: 0, removed: 0, phase: "scan", runId: "r1" },
      },
      { t: "done", stats },
      { t: "failed", code: "index_cancelled", message: "cancelled", previousIndexPreserved: true },
    ];
    for (const message of good) expect(WorkerMessage.safeParse(message).success, message.t).toBe(true);
    expect(WorkerMessage.safeParse({ t: "progress", progress: { scanned: "x" } }).success).toBe(false);
    expect(WorkerMessage.safeParse({ t: "hello" }).success).toBe(false);
    expect(WorkerMessage.safeParse({ t: "failed", code: 1 }).success).toBe(false);
    expect(WorkerMessage.safeParse({ t: "done", stats: { scanned: 1 } }).success).toBe(false);

    const r = rig({ files: 10 });
    const host = (entry: string) =>
      new IndexWorkerHost({
        paths: r.ctx.paths,
        db: r.ctx.db,
        bus: r.ctx.events,
        getSettings: () => r.ctx.settings(),
        indexer: r.ctx.indexer,
        workerEntry: entry,
      });
    // an unknown kind is not for this host: the pass goes on and ends with the message after it
    const polite = script(
      'parentPort.once("message", () => { parentPort.postMessage({ t: "hello", from: "a newer worker" }); parentPort.postMessage({ t: "done", stats: ' +
        JSON.stringify(stats) +
        " }); });",
    );
    await expect(host(polite).run()).resolves.toMatchObject({ added: 1 });
    // a known kind that does not fit is a worker that is not ours
    const liar = script(
      'parentPort.once("message", () => { parentPort.postMessage({ t: "progress", progress: { scanned: "many" } }); });',
    );
    await expect(host(liar).run()).rejects.toMatchObject({ code: "index_worker_crashed" });
    expect(r.events.filter((e) => e.type === "index.failed").at(-1)?.payload).toMatchObject({
      code: "index_worker_crashed",
    });
  });
});

// ------------------------------------------------------------------------------------------------ the walker

/** The files a module reaches through imports that run (type-only ones are erased and skipped). */
function reachableByValue(
  entry: string,
  read: (file: string) => string | undefined = (f) =>
    fs.existsSync(f) ? fs.readFileSync(f, "utf8") : undefined,
): Set<string> {
  const seen = new Set<string>();
  const resolve = (from: string, spec: string): string | null => {
    if (spec === "@mordomo/contracts") return path.join(repoRoot, "contracts/src/index.ts");
    if (!spec.startsWith(".")) return null; // a package (zod, better-sqlite3, node:*): outside the repository's own code
    const base = path.resolve(path.dirname(from), spec.replace(/\.js$/, ""));
    return (
      [`${base}.ts`, `${base}.tsx`, path.join(base, "index.ts")].find(
        (candidate) => read(candidate) !== undefined,
      ) ?? null
    );
  };
  const visit = (file: string): void => {
    if (seen.has(file)) return;
    seen.add(file);
    const text = read(file);
    if (text === undefined) return;
    const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
    const follow = (spec: ts.Expression | undefined) => {
      if (spec && ts.isStringLiteralLike(spec)) {
        const target = resolve(file, spec.text);
        if (target) visit(target);
      }
    };
    const walk = (node: ts.Node): void => {
      if (ts.isImportDeclaration(node)) {
        const clause = node.importClause;
        const typeOnly =
          clause !== undefined &&
          (clause.isTypeOnly ||
            (clause.name === undefined &&
              clause.namedBindings !== undefined &&
              ts.isNamedImports(clause.namedBindings) &&
              clause.namedBindings.elements.length > 0 &&
              clause.namedBindings.elements.every((element) => element.isTypeOnly)));
        if (!typeOnly) follow(node.moduleSpecifier);
      } else if (ts.isExportDeclaration(node)) {
        if (!node.isTypeOnly) follow(node.moduleSpecifier);
      } else if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
        follow(node.arguments[0]);
      }
      ts.forEachChild(node, walk);
    };
    walk(source);
  };
  visit(entry);
  return seen;
}
