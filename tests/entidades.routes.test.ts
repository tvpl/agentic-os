import path from "node:path";
import { describe, expect, it } from "vitest";
import { notesViewWorld, type Json, type NotesViewWorld } from "./helpers/notesViewWorld.js";

/**
 * .specs/features/cerebro-entidades-resumos, batch A, S1 at the boundary: the switch `memory.entities.enabled` (AC 17)
 * and the plan's independent test of S1, through real index passes and the routes.
 */

async function fresh(run: (w: NotesViewWorld, root: string) => Promise<void>): Promise<void> {
  const w = await notesViewWorld("mordomo-entidades-routes-");
  try {
    await run(w, w.indexedRoot("acervo"));
  } finally {
    await w.close();
  }
}

/**
 * The plan's six notes (S1, independent test): a profile with two aliases, a project, two notes that link to them (one
 * with `#Cliente-X`, the other with the tag `cliente x`, both citing `Banco Central do Brasil`), and two notes tagged
 * `#financeiro`, one of them citing `Mercado Livre`, a term in one file only.
 */
function sixNotes(w: NotesViewWorld, root: string): void {
  w.put(
    path.join(root, "pessoas", "ana.md"),
    "---\ntype: profile\ntitle: Ana Souza\naliases: [Ana, A. Souza]\n---\ncontato no banco.\n",
  );
  w.put(
    path.join(root, "projetos", "atlas.md"),
    "---\ntype: project\ntitle: Atlas\n---\nmigração do sistema.\n",
  );
  w.put(
    path.join(root, "notas", "reuniao.md"),
    "Reunião com Banco Central do Brasil.\nfalei com [ana](../pessoas/ana.md) sobre o [[atlas]].\nlembrar #Cliente-X\n",
  );
  w.put(
    path.join(root, "notas", "visita.md"),
    "---\ntags: [cliente x]\n---\nVisita ao Banco Central do Brasil.\nveja a [ficha](../pessoas/ana.md)\n",
  );
  w.put(path.join(root, "notas", "contas.md"), "contas do mes #financeiro\n");
  w.put(path.join(root, "notas", "compras.md"), "compras no Mercado Livre #financeiro\n");
}

const enc = encodeURIComponent;
const statusAndCode = (res: { status: number; body: Json }) => [res.status, res.body?.error?.code];

describe("C17 memory.entities.enabled", () => {
  it("C17 off: a pass writes no row and the three routes answer 409 entities_disabled; on, the next pass fills them", async () => {
    await fresh(async (w, root) => {
      sixNotes(w, root);
      const rows = () =>
        (w.ctx.db.prepare("SELECT COUNT(*) AS n FROM entity_mentions").get() as { n: number }).n;
      w.update((s) => {
        s.memory.entities.enabled = false;
      });
      await w.index();
      expect(rows()).toBe(0);
      for (const [method, url, body] of [
        ["GET", "/api/memory/entities", undefined],
        ["GET", `/api/memory/entities/${enc("perfil:ana souza")}`, undefined],
        ["POST", "/api/memory/entities/corrections", { action: "ignore", key: "perfil:ana souza" }],
      ] as const) {
        const res = await w.call(method, url, body);
        expect(statusAndCode(res), `${method} ${url}`).toEqual([409, "entities_disabled"]);
      }
      expect(w.ctx.db.prepare("SELECT COUNT(*) AS n FROM entity_overrides").get()).toEqual({ n: 0 });

      w.update((s) => {
        s.memory.entities.enabled = true;
      });
      await w.index();
      expect(rows()).toBeGreaterThan(0);
      const list = await w.call("GET", "/api/memory/entities");
      expect(list.status).toBe(200);
      expect(list.body.items.map((e: Json) => e.key)).toContain("perfil:ana souza");
      expect((await w.call("GET", `/api/memory/entities/${enc("perfil:ana souza")}`)).status).toBe(200);

      // off again: the pass keeps no row
      w.update((s) => {
        s.memory.entities.enabled = false;
      });
      await w.index();
      expect(rows()).toBe(0);
    });
  });
});

describe("C18 the S1 corpus", () => {
  it("C18 six notes: exactly five entities with these keys and file counts", async () => {
    await fresh(async (w, root) => {
      sixNotes(w, root);
      await w.index();
      const res = await w.call("GET", "/api/memory/entities");
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      const table = res.body.items.map((e: Json) => [e.key, e.files]);
      expect(table.sort()).toEqual(
        [
          ["perfil:ana souza", 3],
          ["projeto:atlas", 2],
          ["tag:cliente x", 2],
          ["termo:banco central", 2],
          // the fifth: the tag of the two notes on money
          ["tag:financeiro", 2],
        ].sort(),
      );
      expect(res.body.total).toBe(5);
      const ana = res.body.items.find((e: Json) => e.key === "perfil:ana souza");
      expect(ana).toMatchObject({ kind: "perfil", name: "Ana Souza", aliases: ["A. Souza", "Ana"] });
      // `cliente x` joins the two spellings of the tag
      expect(res.body.items.find((e: Json) => e.key === "tag:cliente x")).toMatchObject({
        files: 2,
        mentions: 2,
      });
    });
  });
});

// ---- batch B, S3: the list and one entity at the boundary (AC 29 to AC 32, door 4) -------------------------------

const ITEM_KEYS = ["aliases", "files", "key", "kind", "mentions", "name"];

describe("C31 GET /api/memory/entities orders and shapes", () => {
  it("C31 by files descending then name ascending, each item exactly its six keys, total counted before paging", async () => {
    await fresh(async (w, root) => {
      // alfa in 3 files, beta and gama in 2 (a tie broken by name), delta in 1; Banco Central (a term) in 2
      w.put(path.join(root, "n1.md"), "notas #alfa #gama\nReunião com Banco Central.\n");
      w.put(path.join(root, "n2.md"), "notas #alfa #beta #delta\nVisita ao Banco Central.\n");
      w.put(path.join(root, "n3.md"), "notas #alfa #beta #gama\n");
      await w.index();
      const all = await w.call("GET", "/api/memory/entities");
      expect(all.status, JSON.stringify(all.body)).toBe(200);
      expect(all.body.items.map((e: Json) => [e.key, e.files])).toEqual([
        ["tag:alfa", 3],
        ["termo:banco central", 2],
        ["tag:beta", 2],
        ["tag:gama", 2],
        ["tag:delta", 1],
      ]);
      for (const item of all.body.items) expect(Object.keys(item).sort()).toEqual(ITEM_KEYS);
      expect(all.body.total).toBe(5);
      const paged = await w.call("GET", "/api/memory/entities?limit=2&offset=1");
      expect(paged.status).toBe(200);
      expect(paged.body.items.map((e: Json) => e.key)).toEqual(["termo:banco central", "tag:beta"]);
      expect(paged.body.total).toBe(5);
      expect(all.body.items[0]).toEqual({
        key: "tag:alfa",
        kind: "tag",
        name: "alfa",
        aliases: [],
        files: 3,
        mentions: 3,
      });
    });
  });
});

describe("C32 the query bounds", () => {
  it("C32 kind, q by word prefix, limit, offset: each accepted edge 200 and each refused one 400 validation", async () => {
    await fresh(async (w, root) => {
      w.put(path.join(root, "pessoas", "ana.md"), "---\ntype: profile\ntitle: Ana Souza\n---\nficha.\n");
      w.put(path.join(root, "projetos", "atlas.md"), "---\ntype: project\ntitle: Atlas\n---\nplano.\n");
      w.put(path.join(root, "a.md"), "Reunião com Banco Central.\n");
      w.put(path.join(root, "b.md"), "Visita ao Banco Central.\n");
      // 60 tags in three files (a file keeps 20): more entities than the default page
      for (let f = 0; f < 3; f++) {
        w.put(
          path.join(root, `tags${f}.md`),
          `${Array.from({ length: 20 }, (_, i) => `#t${String(f * 20 + i).padStart(2, "0")}`).join(" ")}\n`,
        );
      }
      await w.index();
      const get = (query: string) => w.call("GET", `/api/memory/entities${query}`);
      const want: Record<string, string> = {
        perfil: "perfil:ana souza",
        projeto: "projeto:atlas",
        termo: "termo:banco central",
      };
      for (const kind of ["perfil", "projeto", "tag", "termo"]) {
        const res = await get(`?kind=${kind}&limit=200`);
        expect(res.status, kind).toBe(200);
        expect(res.body.items.length, kind).toBeGreaterThan(0);
        expect(new Set(res.body.items.map((e: Json) => e.kind)), kind).toEqual(new Set([kind]));
        if (want[kind])
          expect(
            res.body.items.map((e: Json) => e.key),
            kind,
          ).toEqual([want[kind]]);
      }
      expect((await get("?kind=tag&limit=200")).body.total).toBe(60);
      expect(statusAndCode(await get("?kind=pessoa"))).toEqual([400, "validation"]);

      const keysOf = async (q: string) => (await get(`?q=${q}`)).body.items.map((e: Json) => e.key);
      expect(await keysOf("ban")).toEqual(["termo:banco central"]);
      expect(await keysOf("cen")).toEqual(["termo:banco central"]);
      expect(await keysOf("anco")).toEqual([]);

      expect((await get("?limit=1")).status).toBe(200);
      expect((await get("?limit=1")).body.items).toHaveLength(1);
      expect((await get("?limit=200")).body.items).toHaveLength(63);
      expect(statusAndCode(await get("?limit=0"))).toEqual([400, "validation"]);
      expect(statusAndCode(await get("?limit=201"))).toEqual([400, "validation"]);
      const page = await get("");
      expect(page.body.items).toHaveLength(50);
      expect(page.body.total).toBe(63);

      expect((await get("?offset=0")).status).toBe(200);
      const far = await get("?offset=100000");
      expect(far.status).toBe(200);
      expect(far.body).toEqual({ items: [], total: 63 });
      expect(statusAndCode(await get("?offset=100001"))).toEqual([400, "validation"]);
    });
  });
});

describe("C33 the list within a work context", () => {
  it("C33 an entity cited once inside the context and twice outside reads files 1; an unknown context is 404 context_not_found", async () => {
    await fresh(async (w, root) => {
      const inside = path.join(root, "clientes", "x");
      w.put(path.join(inside, "ata.md"), "Reunião com Banco Central.\n");
      w.put(path.join(root, "fora1.md"), "Visita ao Banco Central.\n");
      w.put(path.join(root, "fora2.md"), "Carta ao Banco Central.\n");
      w.update((s) => {
        s.contexts = [{ id: "cliente-x", name: "Cliente X", paths: [inside] } as never];
      });
      await w.index();
      const whole = await w.call("GET", "/api/memory/entities");
      expect(whole.body.items.map((e: Json) => [e.key, e.files])).toEqual([["termo:banco central", 3]]);
      const within = await w.call("GET", "/api/memory/entities?context=cliente-x");
      expect(within.status, JSON.stringify(within.body)).toBe(200);
      expect(within.body.items.map((e: Json) => [e.key, e.files, e.mentions])).toEqual([
        ["termo:banco central", 1, 1],
      ]);
      expect(within.body.total).toBe(1);
      expect(statusAndCode(await w.call("GET", "/api/memory/entities?context=nope"))).toEqual([
        404,
        "context_not_found",
      ]);
    });
  });
});

describe("C34 one entity", () => {
  it("C34 home, mentions with an excerpt of at most 160 characters holding the name, related at most 10 by shared, duplicates; a 400-character line is cut around the name", async () => {
    await fresh(async (w, root) => {
      const home = w.put(
        path.join(root, "pessoas", "Ana Souza.md"),
        "---\ntype: profile\ntitle: Ana Souza\n---\nficha da Ana Souza.\n",
      );
      // twelve notes cite her and one tag each; r01 is in three of them, r02 in two
      for (let i = 1; i <= 12; i++) {
        const own = `#r${String(i).padStart(2, "0")}`;
        const extra = i === 2 ? " #r01" : i === 3 ? " #r01 #r02" : "";
        w.put(path.join(root, "notas", `n${i}.md`), `notas ${own}${extra}\nFalei com Ana Souza hoje.\n`);
      }
      const pad = "x".repeat(200);
      const long = `${pad} conversa longa com Ana Souza sobre o plano ${"y".repeat(400 - 200 - 44)}`;
      expect(long).toHaveLength(400);
      const longFile = w.put(path.join(root, "notas", "longa.md"), `primeira linha\n${long}\n`);
      await w.index();

      const res = await w.call("GET", `/api/memory/entities/${enc("perfil:ana souza")}`);
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      const e = res.body;
      expect(e).toMatchObject({ key: "perfil:ana souza", kind: "perfil", name: "Ana Souza" });
      expect(e.home).toEqual({ fileId: expect.any(Number), path: home });
      // the home note (its title, and its body's text), the twelve notes and the long line
      expect(e.mentions.length).toBe(15);
      for (const m of e.mentions) {
        expect(Object.keys(m).sort()).toEqual(["excerpt", "fileId", "line", "name", "path", "proof"]);
        expect(m.excerpt.length, m.path).toBeLessThanOrEqual(160);
        expect(m.excerpt, m.path).toContain("Ana Souza");
      }
      const cut = e.mentions.find((m: Json) => m.path === longFile);
      expect(cut).toMatchObject({ line: 2, proof: "termo", name: "Ana Souza" });
      expect(cut.excerpt.length).toBeLessThan(long.length);
      expect(cut.excerpt).toContain("conversa longa com Ana Souza");

      expect(e.related).toHaveLength(10);
      expect(e.related.slice(0, 2)).toEqual([
        { key: "tag:r01", name: "r01", kind: "tag", shared: 3 },
        { key: "tag:r02", name: "r02", kind: "tag", shared: 2 },
      ]);
      const shared = e.related.map((r: Json) => r.shared);
      expect(shared).toEqual([...shared].sort((a: number, b: number) => b - a));
      expect(e.related.slice(2).map((r: Json) => r.name)).toEqual([
        "r03",
        "r04",
        "r05",
        "r06",
        "r07",
        "r08",
        "r09",
        "r10",
      ]);
      expect(e.duplicates).toEqual([]);
    });
  });
});
