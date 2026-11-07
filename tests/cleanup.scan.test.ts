import fs from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { OsEvent } from "@mordomo/core";
import { RestoreInProgressError, RestoreLock } from "../core/src/restoreLock.js";
import { notesViewWorld, type Json, type NotesViewWorld } from "./helpers/notesViewWorld.js";

/**
 * .specs/features/cerebro-faxina-guiada, batch A, S2: `POST /api/memory/cleanup/scans`, `GET
 * /api/memory/cleanup/scans/:id`, the `cleanup.*` events and `settings.memory.cleanup`, through `app.inject` against
 * `buildServer` over a real home. A file's age is set from the clock of the test (`Date.now()` at the write) with six
 * hours to spare, so its age in whole days at the scan is the one asked for. The finding rules, one case per row, are in
 * `cleanup.layer.test.ts`.
 */

const DAY = 86_400_000;
let w: NotesViewWorld;
let seq = 0;
const events: OsEvent[] = [];
const code = (r: { body: Json }) => r.body?.error?.code;
const start = (body: Json) => w.call("POST", "/api/memory/cleanup/scans", body);
const scanOf = (id: string) => w.call("GET", `/api/memory/cleanup/scans/${id}`);

/** Files aged `days` whole days from now. */
const aged = (file: string, text: string | Buffer, days = 1): string => {
  w.put(file, text);
  const at = (Date.now() - days * DAY - 6 * 3_600_000) / 1000;
  fs.utimesSync(file, at, at);
  return file;
};

/** Wait for the scan to end, and answer what GET says of it then. */
async function ended(scanId: string): Promise<Json> {
  for (let i = 0; i < 2000; i++) {
    const res = await scanOf(scanId);
    if (res.body.status !== "running") return res.body;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`scan ${scanId} did not end`);
}
async function scanned(body: Json): Promise<Json> {
  const res = await start(body);
  expect(res.status, JSON.stringify(res.body)).toBe(202);
  return ended(res.body.scanId);
}
const dirOf = (name: string) => w.indexedRoot(`${name}-${++seq}`);
const kinds = (scan: Json, kind: string) => (scan.findings as Json[]).filter((f) => f.kind === kind);
const ofScan = (scanId: string, type?: string) =>
  events.filter((e) => (e.payload as Json).scanId === scanId && (type === undefined || e.type === type));

beforeAll(async () => {
  w = await notesViewWorld("mordomo-cleanup-scan-");
  w.ctx.events.subscribe((e) => {
    if (e.type.startsWith("cleanup.")) events.push(e);
  });
});
afterAll(async () => {
  await w.close();
});

describe("S2 a scan of a scope", () => {
  it("C10 POST answers 202 with scanId; progress goes through the four phases in order with done <= total, then one cleanup.finished, each payload exactly, all v1", async () => {
    const root = dirOf("c10");
    for (let i = 0; i < 5; i++) aged(path.join(root, `n${i}.md`), `nota sem titulo ${i}\n`);
    await w.index();
    const ctxRes = await w.call("POST", "/api/contexts", { name: "Varredura C10", paths: [root] });
    const res = await start({ context: ctxRes.body.id });
    expect(res.status).toBe(202);
    expect(Object.keys(res.body)).toEqual(["scanId"]);
    const scanId = res.body.scanId as string;
    const scan = await ended(scanId);
    expect(scan.status).toBe("finished");

    const progress = ofScan(scanId, "cleanup.progress");
    const order = ["inventory", "signatures", "links", "findings"];
    const phases = progress.map((e) => (e.payload as Json).phase as string);
    expect([...new Set(phases)]).toEqual(order);
    for (let i = 1; i < phases.length; i++)
      expect(order.indexOf(phases[i]!)).toBeGreaterThanOrEqual(order.indexOf(phases[i - 1]!));
    for (const e of progress) {
      const p = e.payload as Json;
      expect(p).toEqual({ scanId, phase: p.phase, done: expect.any(Number), total: expect.any(Number) });
      expect(Object.keys(p).sort()).toEqual(["done", "phase", "scanId", "total"]);
      expect(p.done).toBeLessThanOrEqual(p.total);
      expect(e.v).toBe(1);
    }
    const finished = ofScan(scanId, "cleanup.finished");
    expect(finished).toHaveLength(1);
    expect(finished[0]!.payload).toEqual({ scanId, findings: (scan.findings as Json[]).length });
    expect(finished[0]!.v).toBe(1);
    expect((scan.findings as Json[]).length).toBeGreaterThan(0);
    expect(events.indexOf(finished[0]!)).toBeGreaterThan(events.indexOf(progress.at(-1)!));
  });

  it("C11 GET answers running with its phase while it runs, then finished with findings of the five keys and decided; an unknown id is 404 not_found", async () => {
    const root = dirOf("c11");
    for (let i = 0; i < 3; i++) aged(path.join(root, `n${i}.md`), `nota ${i}\n`);
    await w.index();
    const res = await start({ dir: root });
    const scanId = res.body.scanId as string;
    const running = await scanOf(scanId);
    expect(running.status).toBe(200);
    expect(running.body.status).toBe("running");
    expect(["inventory", "signatures", "links", "findings"]).toContain(running.body.phase);
    const scan = await ended(scanId);
    expect(scan.status).toBe("finished");
    expect(scan.decided).toBe(0);
    expect((scan.findings as Json[]).length).toBeGreaterThan(0);
    for (const f of scan.findings as Json[])
      expect(Object.keys(f).sort()).toEqual(["detail", "files", "key", "kind", "suggested"]);
    const missing = await scanOf("nao-existe");
    expect([missing.status, code(missing)]).toEqual([404, "not_found"]);
  });

  it("C12 through the route: the same bytes are one duplicate listing both or all three; the same size with other bytes is none", async () => {
    const two = dirOf("c12-dois");
    aged(path.join(two, "a.md"), "# Igual\nmesmo\n");
    aged(path.join(two, "copia", "a.md"), "# Igual\nmesmo\n");
    const three = dirOf("c12-tres");
    for (const n of ["a.md", "b.md", "c.md"]) aged(path.join(three, n), "# Tres\nigual\n");
    const differ = dirOf("c12-nao");
    aged(path.join(differ, "a.md"), "# Um\nabc\n");
    aged(path.join(differ, "b.md"), "# Um\ncba\n");
    await w.index();
    const paths = (scan: Json) => kinds(scan, "duplicate").map((f) => (f.files as Json[]).map((m) => m.path));
    expect(paths(await scanned({ dir: two }))).toEqual([
      [path.join(two, "a.md"), path.join(two, "copia", "a.md")],
    ]);
    expect(paths(await scanned({ dir: three }))).toEqual([
      ["a.md", "b.md", "c.md"].map((n) => path.join(three, n)),
    ]);
    expect(paths(await scanned({ dir: differ }))).toEqual([]);
  });

  it("C18 through the route: 181 days is stale and 180 is not by default; with staleDays 90 in settings.json, 91 is and 90 is not", async () => {
    const root = dirOf("c18");
    for (const days of [181, 180, 91, 90])
      aged(path.join(root, `idade-${days}.md`), `# Idade ${days}\n`, days);
    await w.index();
    const stale = async () =>
      kinds(await scanned({ dir: root }), "stale")
        .map((f) => path.basename(f.files[0].path))
        .sort();
    expect(await stale()).toEqual(["idade-181.md"]);
    w.update((s) => {
      s.memory.cleanup = { staleDays: 90, largeBytes: 5_242_880 };
    });
    try {
      expect(await stale()).toEqual(["idade-180.md", "idade-181.md", "idade-91.md"]);
    } finally {
      w.update((s) => {
        s.memory.cleanup = { staleDays: 180, largeBytes: 5_242_880 };
      });
    }
  });

  it("C21 a note's [[nao-existe]] (line 4) and [x](./sumiu.md) (line 9) are two broken-link findings with target and line, the links route answers them unresolved, and a link that resolves gives none", async () => {
    const root = dirOf("c21");
    aged(path.join(root, "real.md"), "# Real\n");
    const note = aged(
      path.join(root, "quebrada.md"),
      [
        "# Quebrada",
        "",
        "texto",
        "veja [[nao-existe]]",
        "",
        "e [[real]]",
        "",
        "",
        "e [x](./sumiu.md)",
        "",
      ].join("\n"),
    );
    await w.index();
    const scan = await scanned({ dir: root });
    const broken = kinds(scan, "broken-link");
    expect(broken.map((f) => [f.detail.line, f.files[0].path])).toEqual([
      [4, note],
      [9, note],
    ]);
    const id = (w.ctx.db.prepare("SELECT id FROM files WHERE path = ?").get(note) as { id: number }).id;
    const links = await w.call("GET", `/api/memory/links?id=${id}`);
    const unresolved = (links.body.outgoing as Json[]).filter((l) => l.resolved === null);
    expect(unresolved.map((l) => [l.target, l.line])).toEqual([
      ["nao-existe", 4],
      [path.join(root, "sumiu.md"), 9],
    ]);
    expect(broken.map((f) => [f.detail.target, f.detail.line])).toEqual(
      unresolved.map((l) => [l.target, l.line]),
    );
    expect((links.body.outgoing as Json[]).filter((l) => l.resolved !== null).map((l) => l.target)).toEqual([
      "real",
    ]);
  });

  it("C26 through the route: a keep stored for a finding's key hides it from the next scan, and a member that changed its bytes is asked again with a new key", async () => {
    const root = dirOf("c26");
    const file = aged(path.join(root, "sem.md"), "sem titulo\n");
    await w.index();
    const first = kinds(await scanned({ dir: root }), "untitled");
    expect(first).toHaveLength(1);
    w.ctx.db
      .prepare(
        "INSERT INTO cleanup_decisions (scope, key, decision, keep_file_id, until, decided_at) VALUES (?, ?, 'keep', NULL, NULL, ?)",
      )
      .run(`dir:${root}`, first[0].key, Date.now());
    const hidden = await scanned({ dir: root });
    expect(kinds(hidden, "untitled")).toEqual([]);
    expect(hidden.decided).toBeGreaterThanOrEqual(1);
    fs.appendFileSync(file, "mudou\n");
    await w.index();
    const again = kinds(await scanned({ dir: root }), "untitled");
    expect(again).toHaveLength(1);
    expect(again[0].key).not.toBe(first[0].key);
  });
});

describe("S2 one scan per scope, the restore lock and the event loop", () => {
  let big: string;
  beforeAll(async () => {
    big = dirOf("tres-mil");
    for (let i = 0; i < 3000; i++)
      w.put(
        path.join(big, `p${Math.floor(i / 100)}`, `n${i}.md`),
        `nota numero ${i} sem titulo e sem link\n`,
      );
    await w.index();
  }, 300_000);

  it("C28 a second POST for a running scope is 409 scan_running naming the running scanId; another scope starts with another id", async () => {
    const first = await start({ dir: big });
    expect(first.status).toBe(202);
    const again = await start({ dir: big });
    expect([again.status, code(again)]).toEqual([409, "scan_running"]);
    expect(again.body.error.message).toContain(first.body.scanId);
    const other = dirOf("c28-outro");
    aged(path.join(other, "a.md"), "# A\n");
    const elsewhere = await start({ dir: other });
    expect(elsewhere.status).toBe(202);
    expect(elsewhere.body.scanId).not.toBe(first.body.scanId);
    expect((await ended(first.body.scanId)).status).toBe("finished");
    await ended(elsewhere.body.scanId);
  }, 120_000);

  it("C29 an exclusive restore lock refuses the scan with 409 restore_in_progress; a running scan holds the shared lock; after a finish and after a failure the exclusive lock is free", async () => {
    const before = events.length;
    const held = RestoreLock.acquire(w.ctx.paths, 0, "exclusive");
    try {
      const refused = await start({ dir: big });
      expect([refused.status, code(refused)]).toEqual([409, "restore_in_progress"]);
    } finally {
      held.release();
    }
    expect(events.slice(before)).toEqual([]);

    const res = await start({ dir: big });
    expect(res.status).toBe(202);
    expect(() => RestoreLock.acquire(w.ctx.paths, 0, "exclusive")).toThrow(RestoreInProgressError);
    expect((await ended(res.body.scanId)).status).toBe("finished");
    RestoreLock.acquire(w.ctx.paths, 0, "exclusive").release();

    // A scan that fails (note_links goes away when the links phase starts) lets the lock go too.
    const root = dirOf("c29-falha");
    aged(path.join(root, "a.md"), "# A\n[[b]]\n");
    await w.index();
    const off = w.ctx.events.subscribe((e) => {
      if (
        e.type === "cleanup.progress" &&
        (e.payload as Json).phase === "links" &&
        (e.payload as Json).done === 0
      )
        w.ctx.db.exec("ALTER TABLE note_links RENAME TO note_links_c29");
    });
    try {
      const failing = await start({ dir: root });
      expect((await ended(failing.body.scanId)).status).toBe("failed");
    } finally {
      off();
      w.ctx.db.exec("ALTER TABLE note_links_c29 RENAME TO note_links");
    }
    RestoreLock.acquire(w.ctx.paths, 0, "exclusive").release();
  }, 120_000);

  it("C30 a scan over 3 000 files lets a setImmediate scheduled after POST run before cleanup.finished, and its signatures advance at most 200 at a time", async () => {
    const marks: string[] = [];
    let scanId = "";
    const off = w.ctx.events.subscribe((e) => {
      if (e.type === "cleanup.finished" && (e.payload as Json).scanId === scanId) marks.push("finished");
    });
    try {
      const res = await start({ dir: big });
      scanId = res.body.scanId;
      setImmediate(() => marks.push("immediate"));
      expect((await ended(scanId)).status).toBe("finished");
    } finally {
      off();
    }
    expect(marks).toEqual(["immediate", "finished"]);
    const signatures = ofScan(scanId, "cleanup.progress")
      .map((e) => e.payload as Json)
      .filter((p) => p.phase === "signatures");
    expect(signatures[0]!.total).toBe(3000);
    expect(signatures.at(-1)!.done).toBe(3000);
    for (let i = 1; i < signatures.length; i++) {
      const step = signatures[i]!.done - signatures[i - 1]!.done;
      expect(step).toBeGreaterThanOrEqual(0);
      expect(step).toBeLessThanOrEqual(200);
    }
  }, 120_000);

  it("C31 a scan that fails during links announces cleanup.failed with a code, GET answers failed with the same code, and the signatures written before stay", async () => {
    const root = dirOf("c31");
    const files = [0, 1, 2].map((i) =>
      aged(path.join(root, `n${i}.md`), `# Nota ${i}\ntexto da nota ${i} com palavras\n`),
    );
    await w.index();
    let scanId = "";
    let armed = true;
    const off = w.ctx.events.subscribe((e) => {
      const p = e.payload as Json;
      if (armed && e.type === "cleanup.progress" && p.phase === "links" && p.done === 0) {
        armed = false;
        w.ctx.db.exec("ALTER TABLE note_links RENAME TO note_links_c31");
      }
    });
    let scan: Json;
    try {
      const res = await start({ dir: root });
      scanId = res.body.scanId;
      scan = await ended(scanId);
    } finally {
      off();
      w.ctx.db.exec("ALTER TABLE note_links_c31 RENAME TO note_links");
    }
    const failed = ofScan(scanId, "cleanup.failed");
    expect(failed).toHaveLength(1);
    const payload = failed[0]!.payload as Json;
    expect(payload).toEqual({ scanId, code: expect.any(String) });
    expect(payload.code.length).toBeGreaterThan(0);
    expect(scan!.status).toBe("failed");
    expect(scan!.code).toBe(payload.code);
    expect(ofScan(scanId, "cleanup.finished")).toEqual([]);
    const ids = files.map(
      (f) => (w.ctx.db.prepare("SELECT id FROM files WHERE path = ?").get(f) as { id: number }).id,
    );
    const signed = w.ctx.db
      .prepare(`SELECT COUNT(*) AS n FROM file_minhash WHERE file_id IN (${ids.map(() => "?").join(",")})`)
      .get(...ids) as { n: number };
    expect(signed.n).toBe(3);
  });
});

describe("S2 the thresholds in the settings", () => {
  it("C32 a fresh home answers memory.cleanup's defaults; a patch of staleDays replaces memory.cleanup and keeps the other memory fields; 0 and -1 are 400 validation", async () => {
    const fresh = await notesViewWorld("mordomo-cleanup-settings-");
    try {
      const got = await fresh.call("GET", "/api/settings");
      expect(got.body.memory.cleanup).toEqual({ staleDays: 180, largeBytes: 5242880 });
      const set = await fresh.call("PUT", "/api/settings", {
        memory: {
          notes: { fixedStructure: true },
          journalBudgetTokens: 3000,
          agentStance: "contest-conflicts",
          embeddings: { enabled: false, provider: "hash", sendRemote: false },
        },
      });
      expect(set.status, JSON.stringify(set.body)).toBe(200);
      const earlier = (await fresh.call("GET", "/api/settings")).body.memory as Json;
      const put = await fresh.call("PUT", "/api/settings", { memory: { cleanup: { staleDays: 90 } } });
      expect(put.status, JSON.stringify(put.body)).toBe(200);
      const stored = JSON.parse(fs.readFileSync(path.join(fresh.home, "config", "settings.json"), "utf8"))
        .memory as Json;
      expect(stored.cleanup).toEqual({ staleDays: 90, largeBytes: 5242880 });
      expect(stored.notes).toEqual({ fixedStructure: true });
      expect(stored.journalBudgetTokens).toBe(3000);
      expect(stored.agentStance).toBe("contest-conflicts");
      expect(stored.embeddings).toEqual(earlier.embeddings);
      expect((await fresh.call("GET", "/api/settings")).body.memory.cleanup).toEqual({
        staleDays: 90,
        largeBytes: 5242880,
      });
      for (const cleanup of [{ staleDays: 0 }, { largeBytes: -1 }]) {
        const bad = await fresh.call("PUT", "/api/settings", { memory: { cleanup } });
        expect([bad.status, code(bad)], JSON.stringify(cleanup)).toEqual([400, "validation"]);
      }
    } finally {
      await fresh.close();
    }
  });
});
