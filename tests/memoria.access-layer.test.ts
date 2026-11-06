import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { accessView, deviceRedactor, zeroCounts } from "../apps/api/src/access.js";
import { openDb, type Db } from "../core/src/db/db.js";
import { SettingsSchema } from "../core/src/config/schema.js";
import { AudienceMirror, audienceSpec } from "../core/src/memory/audienceIndex.js";
import { visibleHistoryPaths } from "../core/src/memory/historyStore.js";
import { ensureDirs, resolvePaths } from "../core/src/paths.js";
import { memoriaWorld, type MemoriaWorld } from "./helpers/memoriaWorld.js";

/**
 * .specs/features/cerebro-memoria-confiavel, round 3 part 2, Test policy row 1: the deciders of round 2 part B at their
 * own layer, one case per row, with no HTTP (C185). Their boundary proofs are C172 to C177 and C179 to C184.
 */

let home: string;
let db: Db;
beforeAll(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), "mordomo-access-layer-"));
  const paths = resolvePaths(home);
  ensureDirs(paths);
  db = openDb(paths).db;
});
afterAll(() => {
  db.close();
  fs.rmSync(home, { recursive: true, force: true });
});

// ---- visibleHistoryPaths ----------------------------------------------------------------------------------------------

describe("C185 visibleHistoryPaths", () => {
  const add = (p: string, sha: string | null): number =>
    Number(
      db
        .prepare(
          "INSERT INTO memory_versions (path, sha256, at, author, origin) VALUES (?, ?, 1, 'owner', 'edit')",
        )
        .run(p, sha).lastInsertRowid,
    );

  it("C185 without strict only the path's own level decides; with it a version up to the last removal is hidden, from it on is read; a gone path with no removal on record is hidden; one removal or two", () => {
    db.exec("DELETE FROM memory_versions");
    const stays = [add("notes/stays.md", "s1"), add("notes/stays.md", "s2")];
    const once = [add("notes/once.md", "o1"), add("notes/once.md", "o2"), add("notes/once.md", null)];
    const afterOnce = add("notes/once.md", "o3");
    const twice = [
      add("notes/twice.md", "t1"),
      add("notes/twice.md", null),
      add("notes/twice.md", "t2"),
      add("notes/twice.md", null),
    ];
    const afterTwice = add("notes/twice.md", "t3");
    const pending = [add("notes/pending.md", "p1"), add("notes/pending.md", "p2")];
    const hiddenPath = add("notes/fin/x.md", "h1");
    const present = new Set(["notes/stays.md", "notes/once.md", "notes/twice.md", "notes/fin/x.md"]);
    const hidden = (rel: string) => rel.startsWith("notes/fin/");

    const plain = visibleHistoryPaths(db, hidden);
    for (const id of [...stays, ...once, afterOnce, ...twice, afterTwice, ...pending]) {
      const row = db.prepare("SELECT path FROM memory_versions WHERE id = ?").get(id) as { path: string };
      expect(plain(row.path, id), `plain ${row.path} ${id}`).toBe(true);
    }
    expect(plain("notes/fin/x.md", hiddenPath)).toBe(false);

    const strict = visibleHistoryPaths(db, hidden, { exists: (rel) => present.has(rel) });
    for (const id of stays) expect(strict("notes/stays.md", id), "a note that stayed").toBe(true);
    for (const id of once)
      expect(strict("notes/once.md", id), "up to the removal, the removal included").toBe(false);
    expect(strict("notes/once.md", afterOnce), "the new note at the name").toBe(true);
    for (const id of twice)
      expect(strict("notes/twice.md", id), "up to the last of two removals").toBe(false);
    expect(strict("notes/twice.md", afterTwice)).toBe(true);
    for (const id of pending)
      expect(strict("notes/pending.md", id), "gone, the pass has not recorded it").toBe(false);
    expect(strict("notes/fin/x.md", hiddenPath), "a hidden path stays hidden").toBe(false);
    // a path that is gone and whose newest version is the removal: nothing pending, the rule is the removal's
    present.delete("notes/once.md");
    expect(
      visibleHistoryPaths(db, hidden, { exists: (rel) => present.has(rel) })("notes/once.md", afterOnce),
    ).toBe(false);
  });
});

// ---- zeroCounts -------------------------------------------------------------------------------------------------------

describe("C185 zeroCounts", () => {
  it("C185 every number is zero at any depth, in objects and lists; strings, booleans and null are kept; the input is not changed", () => {
    const input = {
      scanned: 26,
      added: 3,
      nested: { took: 1.5, list: [1, { n: 2 }, "x", null, true] },
      name: "pass",
      ok: true,
      none: null,
    };
    const out = zeroCounts(input);
    expect(out).toEqual({
      scanned: 0,
      added: 0,
      nested: { took: 0, list: [0, { n: 0 }, "x", null, true] },
      name: "pass",
      ok: true,
      none: null,
    });
    expect(input.scanned).toBe(26);
    expect(zeroCounts(7)).toBe(0);
    expect(zeroCounts("7")).toBe("7");
  });
});

// ---- audienceSpec -----------------------------------------------------------------------------------------------------

describe("C185 audienceSpec", () => {
  it("C185 shared when nothing is hidden from the audience and no root holds what it is never served; its own view otherwise, by audience", () => {
    const env = (folderAccess: unknown[], roots: string[], extra: Record<string, unknown> = {}) => ({
      homeDir: home,
      roots,
      settings: SettingsSchema.parse({ folderAccess, ...extra }),
    });
    const memory = path.join(home, "memory");
    const fin = path.join(memory, "notes", "fin");
    const hide = [{ path: fin, agents: "write", devices: "hide" }];
    fs.mkdirSync(fin, { recursive: true });
    // nothing hidden, a root that holds neither the exports nor the guard
    expect(audienceSpec(env([], [memory]), "devices")).toBe("shared");
    expect(audienceSpec(env([], [memory]), "agents")).toBe("shared");
    // a folder hidden from devices only: the devices' view, the agents' still the owner's
    const hiddenFromDevices = audienceSpec(env(hide, [memory]), "devices");
    expect(hiddenFromDevices).not.toBe("shared");
    expect(JSON.parse(hiddenFromDevices)).toMatchObject({ home });
    expect(audienceSpec(env(hide, [memory]), "agents")).toBe("shared");
    // a root that holds the exports (the home itself indexed) makes the devices' own view with no level set at all
    expect(audienceSpec(env([], [home]), "devices")).not.toBe("shared");
    expect(audienceSpec(env([], [path.join(home, "artifacts")]), "devices")).not.toBe("shared");
    // a root inside the exports, too
    expect(audienceSpec(env([], [path.join(home, "artifacts", "exports", "copia")]), "devices")).not.toBe(
      "shared",
    );
    // the guard's folder is no agent's either: the home as a root makes the agents' view
    expect(audienceSpec(env([], [home]), "agents")).not.toBe("shared");
    // the same input gives the same spec
    expect(audienceSpec(env(hide, [memory]), "devices")).toBe(hiddenFromDevices);
  });
});

// ---- the deciders that need the stack: aboutHidden, the pass step, the mirror ------------------------------------------

const opened: MemoriaWorld[] = [];
afterEach(async () => {
  while (opened.length) await opened.pop()!.close();
});

async function hiddenWorld(prefix: string) {
  const w = await memoriaWorld(prefix);
  opened.push(w);
  const fin = path.join(w.memory, "notes", "fin");
  const outra = path.join(w.memory, "notes", "outra");
  const cofre = w.indexedRoot("cofre");
  w.update((s) => {
    s.folderAccess = [
      { path: fin, agents: "write", devices: "hide" },
      { path: cofre, agents: "write", devices: "hide" },
    ];
  });
  return { w, fin, outra, cofre };
}

describe("C185 aboutHidden, through the redactor of a device", () => {
  it("C185 a notification or event whose messageParams.folder is a folder hidden from devices is hidden; a visible folder, a relative or missing one, and another kind are not; the owner's view hides nothing", async () => {
    const { w, fin, outra, cofre } = await hiddenWorld("mordomo-layer-about-");
    const redactor = deviceRedactor(w.ctx, accessView(w.ctx, { kind: "device", deviceId: "d1" }));
    const about = (folder: unknown) => ({ kind: "system", messageParams: { folder } });
    expect(redactor.hiddenNotification(about(cofre)), "a hidden indexed folder").toBe(true);
    expect(redactor.hiddenNotification(about(path.join(fin, "sub"))), "inside a hidden folder").toBe(true);
    expect(redactor.hiddenNotification(about(outra)), "a visible folder").toBe(false);
    expect(redactor.hiddenNotification(about("cofre")), "a name is no path").toBe(false);
    expect(redactor.hiddenNotification(about(42)), "not a string").toBe(false);
    expect(redactor.hiddenNotification({ kind: "system", messageParams: null })).toBe(false);
    expect(redactor.hiddenNotification({ kind: "system" })).toBe(false);
    expect(redactor.hiddenNotification({ kind: "index" }), "the row that counts a pass").toBe(true);
    expect(
      redactor.hiddenEvent({ type: "sentinel.fired", payload: { messageParams: { folder: cofre } } }),
    ).toBe(true);
    expect(
      redactor.hiddenEvent({ type: "sentinel.fired", payload: { messageParams: { folder: outra } } }),
    ).toBe(false);
    expect(
      redactor.hiddenEvent({ type: "settings.changed", payload: { messageParams: { folder: cofre } } }),
      "only the sentinel's event",
    ).toBe(false);
    const owner = deviceRedactor(w.ctx, accessView(w.ctx, { kind: "owner" }));
    expect(owner.hiddenNotification(about(cofre))).toBe(false);
  });
});

type Steps = { refreshDevicesRelatedSteps(changed: ReadonlySet<number>): Generator<void, void> };

describe("C185 refreshDevicesRelatedSteps", () => {
  const drain = (gen: Generator<void, void>) => {
    let n = 0;
    while (!gen.next().done) n++;
    return n;
  };
  it("C185 nothing without a spec; the table emptied when the devices read the owner's index; whole when named for no view; only the changed files when named for this one", async () => {
    const { w, fin, outra } = await hiddenWorld("mordomo-layer-steps-");
    for (let i = 0; i < 6; i++)
      w.put(path.join(outra, `cheio-${i}.md`), `# Cheio ${i}\n\n${"palavra ".repeat(20)} unico${i}x\n`);
    w.put(path.join(outra, "a.md"), "# A\n\nestrela galaxia nebulosa cometa orbita lunar\n");
    w.put(path.join(outra, "b.md"), "# B\n\nestrela galaxia nebulosa cometa orbita solar\n");
    w.put(path.join(fin, "h.md"), "# H\n\nestrela galaxia nebulosa cometa orbita secreto\n");
    const steps = (w.ctx.indexer as unknown as Steps).refreshDevicesRelatedSteps.bind(w.ctx.indexer);
    const meta = (key: string) =>
      (w.ctx.db.prepare("SELECT value FROM meta WHERE key = ?").get(key) as { value: string } | undefined)
        ?.value ?? null;
    const rows = () =>
      w.ctx.db.prepare("SELECT src_id, dst_id FROM file_related_devices").all() as Array<{
        src_id: number;
        dst_id: number;
      }>;
    const idOf = (file: string) =>
      (w.ctx.db.prepare("SELECT id FROM files WHERE path = ?").get(file) as { id: number }).id;

    // no spec: the index of the devices was never asked for, nothing to build
    expect(meta("fts.devices")).toBeNull();
    await w.ctx.indexer.indexAllAsync();
    w.ctx.db.prepare("DELETE FROM meta WHERE key IN ('fts.devices', 'rel.devices')").run();
    w.ctx.db.exec("DELETE FROM file_related_devices");
    expect(drain(steps(new Set())), "no spec, no step").toBe(0);
    expect(rows()).toEqual([]);

    // a spec for a view, no edges named for it: built whole, named last, none of the hidden folder's
    w.ctx.indexer.relatedTable("devices");
    const spec = meta("fts.devices");
    expect(spec).not.toBeNull();
    expect(meta("rel.devices")).toBeNull();
    drain(steps(new Set()));
    expect(meta("rel.devices")).toBe(spec);
    const built = rows();
    expect(built.length).toBeGreaterThan(0);
    const hiddenId = idOf(path.join(fin, "h.md"));
    expect(built.some((r) => r.src_id === hiddenId || r.dst_id === hiddenId)).toBe(false);

    // named for this view: a pass over nothing that changed in it does nothing; over a changed file it works that file again
    expect(drain(steps(new Set())), "nothing changed").toBe(0);
    expect(drain(steps(new Set([hiddenId]))), "a file of the hidden folder").toBe(0);
    w.ctx.db.exec("DELETE FROM file_related_devices");
    drain(steps(new Set([idOf(path.join(outra, "a.md"))])));
    const touched = rows();
    expect(touched.length).toBeGreaterThan(0);
    expect(
      touched.every(
        (r) => r.src_id === idOf(path.join(outra, "a.md")) || r.dst_id === idOf(path.join(outra, "a.md")),
      ),
    ).toBe(true);

    // the devices read the owner's index again: the table is emptied and un-named
    w.update((s) => {
      s.folderAccess = [];
    });
    w.ctx.indexer.relatedTable("devices");
    expect(drain(steps(new Set()))).toBe(0);
    expect(rows()).toEqual([]);
    expect(meta("rel.devices")).toBeNull();
  });
});

describe("C185 AudienceMirror.upsert and remove", () => {
  it("C185 a file written to the index is mirrored when the audience may see it; one that is not takes its edges out of the devices' table; remove takes the edges too", async () => {
    const { w, fin, outra } = await hiddenWorld("mordomo-layer-mirror-");
    w.put(path.join(outra, "a.md"), "# A\n\nestrela galaxia\n");
    w.put(path.join(outra, "b.md"), "# B\n\nestrela galaxia\n");
    await w.ctx.indexer.indexAllAsync();
    w.ctx.indexer.relatedTable("devices");
    const idOf = (file: string) =>
      (w.ctx.db.prepare("SELECT id FROM files WHERE path = ?").get(file) as { id: number }).id;
    const a = idOf(path.join(outra, "a.md"));
    const b = idOf(path.join(outra, "b.md"));
    const edge = (src: number, dst: number) =>
      w.ctx.db
        .prepare(
          "INSERT OR REPLACE INTO file_related_devices (src_id, dst_id, score, terms, updated_at) VALUES (?, ?, 0.9, '[]', 1)",
        )
        .run(src, dst);
    const edges = () =>
      (w.ctx.db.prepare("SELECT COUNT(*) c FROM file_related_devices").get() as { c: number }).c;
    const inTable = (id: number) =>
      (w.ctx.db.prepare("SELECT COUNT(*) c FROM files_fts_devices WHERE rowid = ?").get(id) as { c: number })
        .c;
    const home = w.ctx.paths.memory;

    edge(a, b);
    edge(b, a);
    // the same file, still where the devices see it: mirrored, edges kept
    new AudienceMirror(w.ctx.db).upsert(a, { root: home, rel: "notes/outra/a.md" }, "a.md", "texto");
    expect(inTable(a)).toBe(1);
    expect(edges()).toBe(2);
    // the row now lies where they do not: out of the table, and its edges with it
    new AudienceMirror(w.ctx.db).upsert(
      a,
      { root: home, rel: path.join("notes", "fin", "a.md") },
      "a.md",
      "texto",
    );
    expect(inTable(a)).toBe(0);
    expect(edges()).toBe(0);
    // remove: the same
    edge(a, b);
    edge(b, a);
    new AudienceMirror(w.ctx.db).remove(b);
    expect(edges()).toBe(0);
    expect(inTable(b)).toBe(0);
    expect(fin).toBeTruthy();
  });
});
