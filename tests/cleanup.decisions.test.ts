import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { notesViewWorld, type Json, type NotesViewWorld } from "./helpers/notesViewWorld.js";

/**
 * .specs/features/cerebro-faxina-guiada, batch B, S3: `PUT /api/memory/cleanup/decisions`, through `app.inject`
 * against `buildServer` over a real home, and door 7 (the key of a link and of a folder) through the routes. The
 * decision rules, one case per row, are in `cleanup.layer.test.ts`.
 */

const DAY = 86_400_000;
let w: NotesViewWorld;
let seq = 0;
const code = (r: { body: Json }) => r.body?.error?.code;
const hex = (bytes: string | Buffer) => crypto.createHash("sha256").update(bytes).digest("hex");
const decide = (body: Json) => w.call("PUT", "/api/memory/cleanup/decisions", body);
const aged = (file: string, text: string, days = 1): string => {
  w.put(file, text);
  const at = (Date.now() - days * DAY - 6 * 3_600_000) / 1000;
  fs.utimesSync(file, at, at);
  return file;
};
async function ended(scanId: string): Promise<Json> {
  for (let i = 0; i < 2000; i++) {
    const res = await w.call("GET", `/api/memory/cleanup/scans/${scanId}`);
    if (res.body.status !== "running") return res.body;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`scan ${scanId} did not end`);
}
async function scanned(dir: string): Promise<Json> {
  const res = await w.call("POST", "/api/memory/cleanup/scans", { dir });
  expect(res.status, JSON.stringify(res.body)).toBe(202);
  return ended(res.body.scanId);
}
const kinds = (scan: Json, kind: string) => (scan.findings as Json[]).filter((f) => f.kind === kind);
const rows = (scope: string) =>
  w.ctx.db
    .prepare(
      "SELECT scope, key, decision, keep_file_id, until, decided_at FROM cleanup_decisions WHERE scope = ? ORDER BY key",
    )
    .all(scope) as Json[];
const dirOf = (name: string) => w.indexedRoot(`${name}-${++seq}`);

beforeAll(async () => {
  w = await notesViewWorld("mordomo-cleanup-decisions-");
});
afterAll(async () => {
  await w.close();
});

describe("S3 the decisions route", () => {
  it("C90 Revisar depois: PUT /decisions stores a snooze with its until (and an unsure with none); the next scan hides the snoozed finding until then and reports it again after (AC 21, AC 13; round 3)", async () => {
    const root = dirOf("c90");
    aged(path.join(root, "depois.md"), "sem titulo depois\n");
    aged(path.join(root, "nao-sei.md"), "sem titulo nao sei\n");
    await w.index();
    const scan = await scanned(root);
    const keyOf = (name: string) =>
      kinds(scan, "untitled").find((f) => (f.files as Json[])[0]!.path.endsWith(name))!.key as string;
    const [later, unsure] = [keyOf("depois.md"), keyOf("nao-sei.md")];
    const until = Date.now() + 30 * DAY;
    const res = await decide({
      scanId: scan.scanId,
      decisions: [
        { key: later, decision: "snooze", until },
        { key: unsure, decision: "unsure", until },
      ],
    });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const stored = new Map(rows(`dir:${root}`).map((r) => [r.key, r]));
    expect([stored.get(later)!.decision, stored.get(later)!.until, stored.get(later)!.keep_file_id]).toEqual([
      "snooze",
      until,
      null,
    ]);
    expect([stored.get(unsure)!.decision, stored.get(unsure)!.until]).toEqual(["unsure", null]);
    const keys = (s: Json) => (s.findings as Json[]).map((f) => f.key as string);
    // before until: the snooze hides its finding, the unsure does not
    const hidden = await scanned(root);
    expect(keys(hidden)).not.toContain(later);
    expect(keys(hidden)).toContain(unsure);
    expect(hidden.decided).toBe(1);
    // after until: it is asked again
    vi.useFakeTimers({ toFake: ["Date"], now: until + 60_000 });
    let back: Json;
    try {
      back = await scanned(root);
    } finally {
      vi.useRealTimers();
    }
    expect(keys(back)).toContain(later);
    expect(back.decided).toBe(0);
  }, 60_000);

  it("C33 a keep answers 200 { saved: 1 } and stores one row with scope, key, keep, null keep_file_id and until, decided_at now; an archive for the same key replaces it", async () => {
    const root = dirOf("c33");
    aged(path.join(root, "sem.md"), "sem titulo\n");
    await w.index();
    const scan = await scanned(root);
    const key = kinds(scan, "untitled")[0]!.key as string;
    const now = Date.now();
    vi.useFakeTimers({ toFake: ["Date"], now });
    let res;
    try {
      res = await decide({ scanId: scan.scanId, decisions: [{ key, decision: "keep" }] });
    } finally {
      vi.useRealTimers();
    }
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body).toEqual({ saved: 1 });
    expect(rows(`dir:${root}`)).toEqual([
      { scope: `dir:${root}`, key, decision: "keep", keep_file_id: null, until: null, decided_at: now },
    ]);
    const again = await decide({ scanId: scan.scanId, decisions: [{ key, decision: "archive" }] });
    expect(again.body).toEqual({ saved: 1 });
    const after = rows(`dir:${root}`);
    expect(after).toHaveLength(1);
    expect(after[0]!.decision).toBe("archive");
  });

  it("C34 a merge keeping the newest member of a duplicate stores merge with keep_file_id = that id", async () => {
    const root = dirOf("c34");
    aged(path.join(root, "velha.md"), "# Igual\nmesmo texto\n", 20);
    aged(path.join(root, "nova.md"), "# Igual\nmesmo texto\n", 2);
    await w.index();
    const scan = await scanned(root);
    const dup = kinds(scan, "duplicate")[0]!;
    const newest = [...(dup.files as Json[])].sort((a, b) => b.mtime - a.mtime)[0]!;
    expect(path.basename(newest.path)).toBe("nova.md");
    const res = await decide({
      scanId: scan.scanId,
      decisions: [{ key: dup.key, decision: "merge", keepFileId: newest.id }],
    });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const stored = rows(`dir:${root}`);
    expect(stored.map((r) => [r.key, r.decision, r.keep_file_id])).toEqual([[dup.key, "merge", newest.id]]);
  });

  it("C35 each refused entry answers 400 validation for its own reason, beside valid entries, and the request stores nothing", async () => {
    const root = dirOf("c35");
    aged(path.join(root, "a.md"), "sem titulo igual\n");
    aged(path.join(root, "b.md"), "sem titulo igual\n");
    await w.index();
    const scan = await scanned(root);
    const dup = kinds(scan, "duplicate")[0]!;
    const orphan = kinds(scan, "orphan")[0]!;
    const untitled = kinds(scan, "untitled")[0]!;
    const member = (dup.files as Json[])[0]!.id as number;
    const valid = { key: untitled.key, decision: "keep" };
    const merge = { key: dup.key, decision: "merge", keepFileId: member };
    const snooze = { key: orphan.key, decision: "snooze", until: Date.now() + DAY };
    const cases: Array<[string, Json, string]> = [
      ["a key the scan did not report", { ...valid, key: `untitled:${"0".repeat(64)}` }, "no finding"],
      ["decision delete", { ...valid, decision: "delete" }, "decision"],
      ["merge without keepFileId", { key: dup.key, decision: "merge" }, "keepFileId"],
      ["merge with an id outside the finding", { ...merge, keepFileId: 987654 }, "not a member"],
      [
        "merge on an orphan",
        { key: orphan.key, decision: "merge", keepFileId: (orphan.files as Json[])[0]!.id },
        "duplicate",
      ],
      ["snooze without until", { key: orphan.key, decision: "snooze" }, "until"],
      ["snooze until a second ago", { ...snooze, until: Date.now() - 1000 }, "later than now"],
    ];
    // the valid side of each case is stored alone (so the refusal below is the bad entry's own)
    for (const good of [valid, merge, snooze]) {
      const probe = await decide({ scanId: scan.scanId, decisions: [good] });
      expect(probe.status, JSON.stringify(probe.body)).toBe(200);
    }
    w.ctx.db.prepare("DELETE FROM cleanup_decisions WHERE scope = ?").run(`dir:${root}`);
    for (const [name, bad, why] of cases) {
      const res = await decide({ scanId: scan.scanId, decisions: [valid, merge, snooze, bad] });
      expect([res.status, code(res)], name).toEqual([400, "validation"]);
      expect(JSON.stringify(res.body.error), name).toContain(why);
      expect(rows(`dir:${root}`), name).toEqual([]);
    }
  });

  it("C36 an unknown scanId is 404 not_found; after a second scan of the scope started, a PUT naming the first is 409 scan_stale and stores nothing", async () => {
    const root = dirOf("c36");
    aged(path.join(root, "sem.md"), "sem titulo\n");
    await w.index();
    const missing = await decide({
      scanId: "nao-existe",
      decisions: [{ key: `untitled:${"0".repeat(64)}`, decision: "keep" }],
    });
    expect([missing.status, code(missing)]).toEqual([404, "not_found"]);
    const first = await scanned(root);
    const key = kinds(first, "untitled")[0]!.key;
    const second = await w.call("POST", "/api/memory/cleanup/scans", { dir: root });
    expect(second.status).toBe(202);
    const stale = await decide({ scanId: first.scanId, decisions: [{ key, decision: "keep" }] });
    expect([stale.status, code(stale)]).toEqual([409, "scan_stale"]);
    expect(rows(`dir:${root}`)).toEqual([]);
    await ended(second.body.scanId);
  });

  it("C37 one PUT with archive for each of 14 stale findings answers { saved: 14 } and stores 14 rows", async () => {
    const root = dirOf("c37");
    for (let i = 0; i < 14; i++) aged(path.join(root, `velha-${i}.md`), `# Velha ${i}\nparada ${i}\n`, 400);
    await w.index();
    const scan = await scanned(root);
    const stale = kinds(scan, "stale");
    expect(stale).toHaveLength(14);
    const res = await decide({
      scanId: scan.scanId,
      decisions: stale.map((f) => ({ key: f.key, decision: "archive" })),
    });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body).toEqual({ saved: 14 });
    const stored = rows(`dir:${root}`);
    expect(stored).toHaveLength(14);
    expect(new Set(stored.map((r) => r.decision))).toEqual(new Set(["archive"]));
    expect(stored.map((r) => r.key).sort()).toEqual(stale.map((f) => f.key).sort());
  });
});

describe("door 7 through the routes", () => {
  it("C84 the keys of two broken links of one note and of two empty folders are door 7's literal keys, all four different; a keep on the first link's key hides that link from the next scan and leaves the other", async () => {
    const root = dirOf("c84");
    const note = aged(path.join(root, "nota.md"), "# Nota\n[[um-alvo]]\n[[outro-alvo]]\n");
    fs.mkdirSync(path.join(root, "vazia-a"));
    fs.mkdirSync(path.join(root, "vazia-b"));
    await w.index();
    const scan = await scanned(root);
    const sha = hex(fs.readFileSync(note));
    const linkKey = (target: string, line: number) =>
      `broken-link:${hex(`${note}\u0000${sha}\n\u0001wikilink\u0000${target}\u0000${line}`)}`;
    const folderKey = (name: string) =>
      `empty-folder:${hex(`\u0001folder\u0000${fs.realpathSync(path.join(root, name))}`)}`;
    const broken = kinds(scan, "broken-link");
    expect(broken.map((f) => [f.detail.target, f.detail.line, f.key])).toEqual([
      ["um-alvo", 2, linkKey("um-alvo", 2)],
      ["outro-alvo", 3, linkKey("outro-alvo", 3)],
    ]);
    const empty = kinds(scan, "empty-folder");
    expect(empty.map((f) => [f.files, f.key])).toEqual([
      [[], folderKey("vazia-a")],
      [[], folderKey("vazia-b")],
    ]);
    expect(new Set([...broken, ...empty].map((f) => f.key)).size).toBe(4);

    const kept = await decide({
      scanId: scan.scanId,
      decisions: [{ key: linkKey("um-alvo", 2), decision: "keep" }],
    });
    expect(kept.status, JSON.stringify(kept.body)).toBe(200);
    const next = await scanned(root);
    expect(kinds(next, "broken-link").map((f) => f.key)).toEqual([linkKey("outro-alvo", 3)]);
    expect(next.decided).toBe(1);
  });
});
