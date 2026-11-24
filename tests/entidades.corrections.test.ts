import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { coMentionEdges } from "../core/src/memory/entities.js";
import { notesViewWorld, type Json, type NotesViewWorld } from "./helpers/notesViewWorld.js";

/**
 * .specs/features/cerebro-entidades-resumos, batch A, S2 (door 3): the owner's corrections through
 * `POST /api/memory/entities/corrections`, read back through the entity routes after real index passes.
 */

/**
 * The fixed clock of the checks: 2026-11-24 10:00 local. Only `Date` is faked, and only while a correction is asked (an
 * index pass waits for the next millisecond, which a frozen clock never reaches); `tick` moves it a second on.
 */
const NOW = new Date(2026, 10, 24, 10, 0, 0).getTime();
let clock = NOW;
beforeEach(() => {
  clock = NOW;
});
afterEach(() => {
  vi.useRealTimers();
});
const tick = () => {
  clock += 1000;
};
const now = () => clock;

/**
 * A profile (Ana Souza); a term in two files (Ana Sousa); two tags of 5 letters (bravo, brava); two tags MinHash joins
 * (projeto-atlantico, projeto-atlanticos); a term only two files share (Banco Central); a term in one file (Mercado Livre).
 */
async function fresh(run: (w: NotesViewWorld) => Promise<void>): Promise<void> {
  const w = await notesViewWorld("mordomo-entidades-corr-");
  try {
    const root = w.indexedRoot("acervo");
    w.put(path.join(root, "pessoas", "ana.md"), "---\ntype: profile\ntitle: Ana Souza\n---\ncontato.\n");
    w.put(path.join(root, "notas", "n1.md"), "Encontro com Ana Sousa hoje.\nmarcar #bravo\n");
    w.put(path.join(root, "notas", "n2.md"), "Ligar para Ana Sousa amanhã.\nmarcar #brava\n");
    w.put(path.join(root, "notas", "n3.md"), "plano #projeto-atlantico\n");
    w.put(path.join(root, "notas", "n4.md"), "plano #projeto-atlanticos\n");
    w.put(path.join(root, "notas", "n5.md"), "Reunião no Banco Central.\n");
    w.put(path.join(root, "notas", "n6.md"), "Visita ao Banco Central.\n");
    w.put(path.join(root, "notas", "n7.md"), "compras no Mercado Livre.\n");
    await w.index();
    await run(w);
  } finally {
    await w.close();
  }
}

const enc = encodeURIComponent;
const correct = async (w: NotesViewWorld, body: Json, headers?: Record<string, string>) => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(clock);
  try {
    return await w.call("POST", "/api/memory/entities/corrections", body, headers);
  } finally {
    vi.useRealTimers();
  }
};
const list = async (w: NotesViewWorld): Promise<Json[]> => {
  const res = await w.call("GET", "/api/memory/entities?limit=200");
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return res.body.items;
};
const keys = async (w: NotesViewWorld) => (await list(w)).map((e) => e.key).sort();
const detail = async (w: NotesViewWorld, key: string) => w.call("GET", `/api/memory/entities/${enc(key)}`);
const statusAndCode = (res: { status: number; body: Json }) => [res.status, res.body?.error?.code];
const overrides = (w: NotesViewWorld) =>
  (w.ctx.db.prepare("SELECT COUNT(*) AS n FROM entity_overrides").get() as { n: number }).n;

describe("C21 merge", () => {
  it("C21 merge of perfil:ana souza and termo:ana sousa reads one entity, and still after a full pass", async () => {
    await fresh(async (w) => {
      expect(await keys(w)).toEqual(expect.arrayContaining(["perfil:ana souza", "termo:ana sousa"]));
      const res = await correct(w, { action: "merge", key: "perfil:ana souza", other: "termo:ana sousa" });
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      expect(res.body.correction).toEqual({
        id: expect.any(Number),
        action: "merge",
        names: ["ana souza", "ana sousa"],
        createdAt: NOW,
      });
      const after = async () => {
        const items = await list(w);
        expect(items.map((e) => e.key)).not.toContain("termo:ana sousa");
        return items.find((e) => e.key === "perfil:ana souza");
      };
      expect(await after()).toMatchObject({ name: "Ana Souza", aliases: ["Ana Sousa"], files: 3 });
      const index = await w.call("POST", "/api/memory/index");
      expect(index.status).toBe(200);
      expect(await after()).toMatchObject({ name: "Ana Souza", aliases: ["Ana Sousa"], files: 3 });
    });
  });

  it("C21 merge of two 5-letter norms the gate keeps out of MinHash reads one entity, and still after a full pass", async () => {
    await fresh(async (w) => {
      expect(await keys(w)).toEqual(expect.arrayContaining(["tag:brava", "tag:bravo"]));
      const res = await correct(w, { action: "merge", key: "tag:bravo", other: "tag:brava" });
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      const merged = async () =>
        (await list(w)).filter((e) => e.key === "tag:brava" || e.key === "tag:bravo");
      expect(await merged()).toEqual([
        expect.objectContaining({ key: "tag:brava", files: 2, aliases: ["bravo"] }),
      ]);
      expect((await w.call("POST", "/api/memory/index")).status).toBe(200);
      expect(await merged()).toEqual([
        expect.objectContaining({ key: "tag:brava", files: 2, aliases: ["bravo"] }),
      ]);
    });
  });
});

describe("C22 separate", () => {
  it("C22 separate of two names MinHash merged reads two entities, and neither lists the other in duplicates", async () => {
    await fresh(async (w) => {
      const joined = (await list(w)).filter((e) => e.key.startsWith("tag:projeto atlantic"));
      expect(joined).toEqual([
        expect.objectContaining({ key: "tag:projeto atlantico", aliases: ["projeto-atlanticos"], files: 2 }),
      ]);
      const res = await correct(w, {
        action: "separate",
        key: "tag:projeto atlantico",
        other: "tag:projeto atlanticos",
      });
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      expect((await keys(w)).filter((k) => k.startsWith("tag:projeto atlantic"))).toEqual([
        "tag:projeto atlantico",
        "tag:projeto atlanticos",
      ]);
      for (const [key, other] of [
        ["tag:projeto atlantico", "tag:projeto atlanticos"],
        ["tag:projeto atlanticos", "tag:projeto atlantico"],
      ] as const) {
        const one = await detail(w, key);
        expect(one.status).toBe(200);
        expect(one.body.duplicates.map((d: Json) => d.key)).not.toContain(other);
      }
    });
  });
});

describe("C23 separate of one norm", () => {
  it("C23 separate of two names with the same norm is 400 validation, and no row is stored", async () => {
    await fresh(async (w) => {
      const before = overrides(w);
      const res = await correct(w, { action: "separate", key: "perfil:ana souza", other: "termo:ana souza" });
      expect(statusAndCode(res)).toEqual([400, "validation"]);
      expect(overrides(w)).toBe(before);
    });
  });
});

describe("C24 ignore", () => {
  it("C24 ignore removes the entity from the list and from the graph's edges, and its rows stay", async () => {
    await fresh(async (w) => {
      const id = (name: string) =>
        (w.ctx.db.prepare("SELECT id FROM files WHERE name = ?").get(name) as { id: number }).id;
      const [n5, n6] = [id("n5.md"), id("n6.md")];
      const edges = () =>
        coMentionEdges(w.ctx.entities.read("owner", () => true).entities).filter(
          (e) => e.a === n5 && e.b === n6,
        );
      const rows = () =>
        (
          w.ctx.db
            .prepare("SELECT COUNT(*) AS n FROM entity_mentions WHERE norm = 'banco central'")
            .get() as {
            n: number;
          }
        ).n;
      expect(edges()).toEqual([{ a: n5, b: n6, weight: 0.5 }]);
      const before = rows();
      expect(before).toBe(2);
      const res = await correct(w, { action: "ignore", key: "termo:banco central" });
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      expect(res.body.entity).toBeUndefined();
      expect(await keys(w)).not.toContain("termo:banco central");
      expect(edges()).toEqual([]);
      expect(rows()).toBe(before);
    });
  });
});

describe("C25 rename", () => {
  it("C25 rename with name Ana S. Souza shows that name, and the key stays perfil:ana souza", async () => {
    await fresh(async (w) => {
      const res = await correct(w, { action: "rename", key: "perfil:ana souza", name: "Ana S. Souza" });
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      expect(res.body.entity).toMatchObject({ key: "perfil:ana souza", name: "Ana S. Souza" });
      expect((await list(w)).find((e) => e.key === "perfil:ana souza")).toMatchObject({
        name: "Ana S. Souza",
      });
      expect((await detail(w, "perfil:ana souza")).body).toMatchObject({
        key: "perfil:ana souza",
        name: "Ana S. Souza",
      });
    });
  });
});

describe("C26 undo", () => {
  /** The corrections the entity `key` lists, by id. */
  const listed = async (w: NotesViewWorld, key: string): Promise<Map<number, Json>> => {
    const res = await detail(w, key);
    expect(res.status, `${key} ${JSON.stringify(res.body)}`).toBe(200);
    return new Map(res.body.corrections.map((c: Json) => [c.id, c]));
  };
  const undo = async (w: NotesViewWorld, id: number) => {
    tick();
    const res = await correct(w, { action: "undo", id });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    return now();
  };
  const nameOf = async (w: NotesViewWorld, key: string) => (await list(w)).find((e) => e.key === key)?.name;

  it("C26 undo of merge, separate, ignore and rename: the correction stops applying and is listed with undoneAt", async () => {
    await fresh(async (w) => {
      // merge
      const merge = (await correct(w, { action: "merge", key: "perfil:ana souza", other: "termo:ana sousa" }))
        .body;
      expect(await keys(w)).not.toContain("termo:ana sousa");
      let at = await undo(w, merge.correction.id);
      expect(await keys(w)).toEqual(expect.arrayContaining(["perfil:ana souza", "termo:ana sousa"]));
      expect((await listed(w, "termo:ana sousa")).get(merge.correction.id)).toMatchObject({
        action: "merge",
        undoneAt: at,
      });

      // separate
      tick();
      const separate = (
        await correct(w, {
          action: "separate",
          key: "tag:projeto atlantico",
          other: "tag:projeto atlanticos",
        })
      ).body;
      expect(await keys(w)).toContain("tag:projeto atlanticos");
      at = await undo(w, separate.correction.id);
      expect(await keys(w)).not.toContain("tag:projeto atlanticos");
      expect((await listed(w, "tag:projeto atlantico")).get(separate.correction.id)).toMatchObject({
        action: "separate",
        undoneAt: at,
      });

      // ignore
      tick();
      const ignore = (await correct(w, { action: "ignore", key: "termo:banco central" })).body;
      expect(await keys(w)).not.toContain("termo:banco central");
      at = await undo(w, ignore.correction.id);
      expect(await keys(w)).toContain("termo:banco central");
      expect((await listed(w, "termo:banco central")).get(ignore.correction.id)).toMatchObject({
        action: "ignore",
        undoneAt: at,
      });

      // rename
      tick();
      const rename = (await correct(w, { action: "rename", key: "perfil:ana souza", name: "Ana S. Souza" }))
        .body;
      expect(await nameOf(w, "perfil:ana souza")).toBe("Ana S. Souza");
      at = await undo(w, rename.correction.id);
      expect(await nameOf(w, "perfil:ana souza")).toBe("Ana Souza");
      expect((await listed(w, "perfil:ana souza")).get(rename.correction.id)).toMatchObject({
        action: "rename",
        name: "Ana S. Souza",
        undoneAt: at,
      });
    });
  });

  it("C26 undo of add and reject: the correction stops applying and is listed with undoneAt", async () => {
    await fresh(async (w) => {
      // `add` and `reject` are written by accepting and refusing a suggestion (door 10, batch D); here they are stored
      // as door 3 and Landing 3a give them, and undone through the route.
      const store = (action: string, a: string, b: string | null, name: string | null) =>
        Number(
          w.ctx.db
            .prepare("INSERT INTO entity_overrides (action, a, b, name, created_at) VALUES (?, ?, ?, ?, ?)")
            .run(action, a, b, name, now()).lastInsertRowid,
        );
      const add = store(
        "add",
        "mercado livre",
        JSON.stringify({ kind: "perfil", aliases: [] }),
        "Mercado Livre",
      );
      const reject = store("reject", "banco central", null, null);
      w.ctx.entities.invalidate();
      const before = await list(w);
      expect(before.map((e) => e.key)).toContain("perfil:mercado livre");

      let at = await undo(w, add);
      expect(await keys(w)).not.toContain("perfil:mercado livre");
      // the term is in one file: with the add undone it is no entity, so the correction is listed by the norm it holds
      expect(
        (await w.ctx.entities.read("owner", () => true)).corrections.find((c) => c.id === add),
      ).toMatchObject({ action: "add", undoneAt: at });

      const entitiesBefore = (await list(w)).map((e) => [e.key, e.name, e.files]);
      at = await undo(w, reject);
      expect((await listed(w, "termo:banco central")).get(reject)).toMatchObject({
        action: "reject",
        names: ["banco central"],
        undoneAt: at,
      });
      // a refusal applies to suggestions only (door 10): the entities read the same before and after its undo
      expect((await list(w)).map((e) => [e.key, e.name, e.files])).toEqual(entitiesBefore);
    });
  });

  it("C26 undo of an unknown id is 404 not_found; of one undone already 409 correction_conflict", async () => {
    await fresh(async (w) => {
      expect(statusAndCode(await correct(w, { action: "undo", id: 999_999 }))).toEqual([404, "not_found"]);
      const rename = (await correct(w, { action: "rename", key: "perfil:ana souza", name: "Ana S." })).body;
      expect((await correct(w, { action: "undo", id: rename.correction.id })).status).toBe(200);
      expect(statusAndCode(await correct(w, { action: "undo", id: rename.correction.id }))).toEqual([
        409,
        "correction_conflict",
      ]);
    });
  });
});

describe("C27 correction_conflict", () => {
  it("C27 merge of a pair with an active separate is 409; after undoing the separate the same merge is 200", async () => {
    await fresh(async (w) => {
      const pair = { key: "perfil:ana souza", other: "termo:ana sousa" };
      const separate = await correct(w, { action: "separate", ...pair });
      expect(separate.status, JSON.stringify(separate.body)).toBe(200);
      const before = overrides(w);
      expect(statusAndCode(await correct(w, { action: "merge", ...pair }))).toEqual([
        409,
        "correction_conflict",
      ]);
      expect(overrides(w)).toBe(before);
      expect((await correct(w, { action: "undo", id: separate.body.correction.id })).status).toBe(200);
      expect((await correct(w, { action: "merge", ...pair })).status).toBe(200);
    });
  });

  it("C27 separate of a pair with an active merge is 409; after undoing the merge the same separate is 200", async () => {
    await fresh(async (w) => {
      const pair = { key: "perfil:ana souza", other: "termo:ana sousa" };
      const merge = await correct(w, { action: "merge", ...pair });
      expect(merge.status, JSON.stringify(merge.body)).toBe(200);
      const before = overrides(w);
      expect(statusAndCode(await correct(w, { action: "separate", ...pair }))).toEqual([
        409,
        "correction_conflict",
      ]);
      expect(overrides(w)).toBe(before);
      expect((await correct(w, { action: "undo", id: merge.body.correction.id })).status).toBe(200);
      expect((await correct(w, { action: "separate", ...pair })).status).toBe(200);
    });
  });
});

describe("C28 the cap", () => {
  it("C28 with 1 999 active corrections the next is 200; with 2 000 it is 409 too_many_corrections; undone ones do not count", async () => {
    await fresh(async (w) => {
      const insert = w.ctx.db.prepare(
        "INSERT INTO entity_overrides (action, a, b, name, created_at, undone_at) VALUES ('rename', 'ana souza', NULL, ?, ?, ?)",
      );
      w.ctx.db.transaction(() => {
        for (let i = 0; i < 1999; i++) insert.run(`Ana ${i}`, NOW - 10_000 + i, null);
        // undone ones, which do not count
        for (let i = 0; i < 5; i++) insert.run(`Antiga ${i}`, NOW - 20_000 + i, NOW - 15_000);
      })();
      w.ctx.entities.invalidate();
      const active = () =>
        (
          w.ctx.db.prepare("SELECT COUNT(*) AS n FROM entity_overrides WHERE undone_at IS NULL").get() as {
            n: number;
          }
        ).n;
      expect(active()).toBe(1999);
      const rename = { action: "rename", key: "perfil:ana souza", name: "Ana Souza" };
      const ok = await correct(w, rename);
      expect(ok.status, JSON.stringify(ok.body)).toBe(200);
      expect(active()).toBe(2000);
      expect(statusAndCode(await correct(w, rename))).toEqual([409, "too_many_corrections"]);
      expect(statusAndCode(await correct(w, { action: "ignore", key: "termo:banco central" }))).toEqual([
        409,
        "too_many_corrections",
      ]);
      expect(active()).toBe(2000);
      expect((await correct(w, { action: "undo", id: ok.body.correction.id })).status).toBe(200);
      expect(active()).toBe(1999);
      expect((await correct(w, rename)).status).toBe(200);
    });
  });
});

describe("C29 who may correct", () => {
  it("C29 through /api and /api/v1: the owner 200; a device with every scope 403 owner_only; a run's rc_ 403 forbidden; the principal mcp 403 forbidden", async () => {
    await fresh(async (w) => {
      const device = w.device(["content", "monitor", "run", "approve"]);
      const record = w.ctx.runs.create({
        origin: "skill",
        provider: "claude",
        prompt: "held open",
        model: null,
        effort: "default",
        mode: "write",
        timeoutMs: 60_000,
        profile: "controlled_write",
        skillSlug: "organize-brain",
        startedBy: null,
      } as never);
      const token = w.ctx.runApiAccessFor(record, "write")!.token;
      expect(token).toMatch(/^rc_/);
      const run = { "x-mordomo-token": token, "content-type": "application/json" };
      const mcp = {
        "x-mordomo-token": w.ctx.token(),
        "x-mordomo-as": "mcp",
        "x-mordomo-client": "claude-code",
        "content-type": "application/json",
      };
      const body = { action: "rename", key: "perfil:ana souza", name: "Ana Souza" };
      for (const prefix of ["/api", "/api/v1"]) {
        const url = `${prefix}/memory/entities/corrections`;
        const before = overrides(w);
        expect(statusAndCode(await w.call("POST", url, body, device)), url).toEqual([403, "owner_only"]);
        expect(statusAndCode(await w.call("POST", url, body, run)), url).toEqual([403, "forbidden"]);
        expect(statusAndCode(await w.call("POST", url, body, mcp)), url).toEqual([403, "forbidden"]);
        expect(overrides(w)).toBe(before);
        const owner = await w.call("POST", url, body);
        expect(owner.status, `${url} ${JSON.stringify(owner.body)}`).toBe(200);
        expect(overrides(w)).toBe(before + 1);
      }
    });
  });

  it("C29 key or other unknown to the owner is 404 not_found; an action outside the seven is 400 validation", async () => {
    await fresh(async (w) => {
      const before = overrides(w);
      for (const body of [
        { action: "ignore", key: "perfil:ninguem" },
        { action: "rename", key: "termo:nada aqui", name: "X" },
        { action: "merge", key: "perfil:ninguem", other: "termo:ana sousa" },
        { action: "merge", key: "perfil:ana souza", other: "termo:ninguem" },
        { action: "separate", key: "perfil:ana souza", other: "tag:ninguem" },
        // a term in one file is no entity the owner sees
        { action: "merge", key: "perfil:ana souza", other: "termo:mercado livre" },
      ]) {
        expect(statusAndCode(await correct(w, body)), JSON.stringify(body)).toEqual([404, "not_found"]);
      }
      for (const action of ["join", "delete", "add", "MERGE", ""]) {
        expect(statusAndCode(await correct(w, { action, key: "perfil:ana souza" })), action).toEqual([
          400,
          "validation",
        ]);
      }
      expect(overrides(w)).toBe(before);
    });
  });
});

describe("C30 order and listing", () => {
  it("C30 a merge then a rename of the merged entity apply in created_at order; the entity lists the two that touch it and none that does not", async () => {
    await fresh(async (w) => {
      const merge = await correct(w, { action: "merge", key: "perfil:ana souza", other: "termo:ana sousa" });
      expect(merge.status).toBe(200);
      tick();
      const rename = await correct(w, { action: "rename", key: "perfil:ana souza", name: "Ana S. Souza" });
      expect(rename.status).toBe(200);
      tick();
      const other = await correct(w, { action: "rename", key: "termo:banco central", name: "BC" });
      expect(other.status).toBe(200);
      expect([merge, rename].map((r) => r.body.correction.createdAt)).toEqual([NOW, NOW + 1000]);

      const one = await detail(w, "perfil:ana souza");
      expect(one.status).toBe(200);
      expect(one.body).toMatchObject({
        key: "perfil:ana souza",
        name: "Ana S. Souza",
        aliases: ["Ana Sousa"],
      });
      expect(one.body.corrections).toEqual([
        {
          id: merge.body.correction.id,
          action: "merge",
          names: ["ana souza", "ana sousa"],
          createdAt: NOW,
          undoneAt: null,
        },
        {
          id: rename.body.correction.id,
          action: "rename",
          names: ["ana souza"],
          name: "Ana S. Souza",
          createdAt: NOW + 1000,
          undoneAt: null,
        },
      ]);
      expect(one.body.corrections.map((c: Json) => c.id)).not.toContain(other.body.correction.id);
    });
  });
});
