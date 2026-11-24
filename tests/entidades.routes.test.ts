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
