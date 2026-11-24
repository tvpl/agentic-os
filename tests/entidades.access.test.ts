import path from "node:path";
import { describe, expect, it } from "vitest";
import { notesViewWorld, type Json } from "./helpers/notesViewWorld.js";
import { memoriaWorld, type MemoriaWorld } from "./helpers/memoriaWorld.js";

/**
 * .specs/features/cerebro-entidades-resumos, batch A, S1 by audience at the boundary: the term threshold counts the files
 * the caller's audience sees (AC 16). The rest of S3's audience rules are batch B's.
 */

describe("C16 the term threshold over the audience's files", () => {
  it("C16 a term in 2 files is an entity for the owner; for a device that sees 1 of the 2 files it is not", async () => {
    const w = await notesViewWorld("mordomo-entidades-access-");
    try {
      const root = w.indexedRoot("acervo");
      const hidden = path.join(root, "sigilo");
      w.put(path.join(root, "aberta.md"), "Reunião com Banco Central hoje.\n");
      w.put(path.join(hidden, "fechada.md"), "Visita ao Banco Central ontem.\n");
      w.update((s) => {
        s.folderAccess = [{ path: hidden, agents: "read", devices: "hide" }];
      });
      await w.index();
      const keysOf = (body: Json) => body.items.map((e: Json) => [e.key, e.files]);

      const owner = await w.call("GET", "/api/memory/entities");
      expect(owner.status).toBe(200);
      expect(keysOf(owner.body)).toEqual([["termo:banco central", 2]]);

      const device = w.device(["content"]);
      const seen = await w.call("GET", "/api/memory/entities", undefined, device);
      expect(seen.status, JSON.stringify(seen.body)).toBe(200);
      expect(keysOf(seen.body)).toEqual([]);
      expect(seen.body.total).toBe(0);

      // the same device with the folder shown again sees the two files
      w.update((s) => {
        s.folderAccess = [];
      });
      const again = await w.call("GET", "/api/memory/entities", undefined, device);
      expect(keysOf(again.body)).toEqual([["termo:banco central", 2]]);
    } finally {
      await w.close();
    }
  });
});

// ---- batch B, S3: each audience reads only the files it reads (AC 33 to AC 35, door 4) -----------------------------

const enc = encodeURIComponent;
const code = (res: { status: number; body: Json }) => [res.status, res.body?.error?.code];

async function fresh(run: (w: MemoriaWorld, root: string) => Promise<void>): Promise<void> {
  const w = await memoriaWorld("mordomo-entidades-access-b-");
  try {
    await run(w, w.indexedRoot("acervo"));
  } finally {
    await w.close();
  }
}

/** The headers of the principal `mcp` (the owner's token read as agents). */
const mcpOf = (w: MemoriaWorld) => ({
  ...w.owner(),
  "x-mordomo-as": "mcp",
  "x-mordomo-client": "claude-code",
});

describe("C35 a key the audience does not see", () => {
  it("C35 an unknown key and the key of an entity only of hidden files answer a device the same 404 not_found body", async () => {
    await fresh(async (w, root) => {
      const hidden = path.join(root, "sigilo");
      w.put(path.join(hidden, "a.md"), "Reunião com Banco Central.\n");
      w.put(path.join(hidden, "b.md"), "Visita ao Banco Central.\n");
      w.put(path.join(root, "aberta.md"), "notas #aberta\n");
      w.update((s) => {
        s.folderAccess = [{ path: hidden, agents: "read", devices: "hide" }];
      });
      await w.index();
      const url = (key: string) => `/api/memory/entities/${enc(key)}`;
      // the owner sees the term: the device's 404 is the audience's, not the key's
      expect((await w.call("GET", url("termo:banco central"))).status).toBe(200);
      const device = w.device(["content"]);
      const hiddenOne = await w.call("GET", url("termo:banco central"), undefined, device);
      const unknown = await w.call("GET", url("termo:nada disso"), undefined, device);
      expect(code(hiddenOne)).toEqual([404, "not_found"]);
      expect(code(unknown)).toEqual([404, "not_found"]);
      expect(hiddenOne.body).toEqual(unknown.body);
      // the device reads a visible entity
      expect((await w.call("GET", url("tag:aberta"), undefined, device)).status).toBe(200);
    });
  });
});

describe("C36 a term only a hidden folder holds twice", () => {
  it("C36 devices: the owner lists termo:projeto sigilo with 2 files; a device lists nothing of it and no related names it", async () => {
    await fresh(async (w, root) => {
      const hidden = path.join(root, "sigilo");
      w.put(path.join(root, "ata.md"), "notas #reuniao\nPauta do Projeto Sigilo.\n");
      w.put(path.join(root, "outra.md"), "notas #reuniao\n");
      w.put(path.join(hidden, "fechada.md"), "notas #reuniao\nO Projeto Sigilo atrasou.\n");
      w.update((s) => {
        s.folderAccess = [{ path: hidden, agents: "read", devices: "hide" }];
      });
      await w.index();
      await sigiloSeen(w, w.device(["content"]));
    });
  });

  it("C36 agents: the same for a run's rc_ and the principal mcp with a folder hidden from agents", async () => {
    await fresh(async (w, root) => {
      const hidden = path.join(root, "sigilo");
      w.put(path.join(root, "ata.md"), "notas #reuniao\nPauta do Projeto Sigilo.\n");
      w.put(path.join(root, "outra.md"), "notas #reuniao\n");
      w.put(path.join(hidden, "fechada.md"), "notas #reuniao\nO Projeto Sigilo atrasou.\n");
      w.update((s) => {
        s.folderAccess = [{ path: hidden, agents: "hide", devices: "read" }];
      });
      await w.index();
      await sigiloSeen(w, w.run("read_only").headers);
      await sigiloSeen(w, mcpOf(w));
    });
  });
});

/** The owner sees `Projeto Sigilo` in 2 files and related to `#reuniao`; `who` sees neither (one visible file). */
async function sigiloSeen(w: MemoriaWorld, who: Record<string, string>): Promise<void> {
  const owner = await w.call("GET", "/api/memory/entities");
  expect(owner.status).toBe(200);
  expect(owner.body.items.find((e: Json) => e.key === "termo:projeto sigilo")).toMatchObject({ files: 2 });
  const ownerTag = await w.call("GET", `/api/memory/entities/${enc("tag:reuniao")}`);
  // the visible tag points at the term for the owner (L-072): the filter below has something to hide
  expect(ownerTag.body.related.map((r: Json) => r.key)).toContain("termo:projeto sigilo");

  const list = await w.call("GET", "/api/memory/entities?limit=200", undefined, who);
  expect(list.status, JSON.stringify(list.body)).toBe(200);
  expect(list.body.items.map((e: Json) => e.key)).toEqual(["tag:reuniao"]);
  expect(JSON.stringify(list.body)).not.toMatch(/sigilo/i);
  for (const item of list.body.items) {
    const one = await w.call("GET", `/api/memory/entities/${enc(item.key)}`, undefined, who);
    expect(one.status).toBe(200);
    expect(one.body.related.map((r: Json) => r.key)).not.toContain("termo:projeto sigilo");
    expect(JSON.stringify(one.body.related)).not.toMatch(/sigilo/i);
  }
  expect(
    code(await w.call("GET", `/api/memory/entities/${enc("termo:projeto sigilo")}`, undefined, who)),
  ).toEqual([404, "not_found"]);
}

describe("C37 a home note hidden from the caller", () => {
  it("C37 the device's entity has no home, only the visible mentions and files; the owner's has its home", async () => {
    await fresh(async (w, root) => {
      const hidden = path.join(root, "sigilo");
      const homeNote = w.put(
        path.join(hidden, "Ana Souza Lima.md"),
        "---\ntype: profile\ntitle: Ana Souza Lima\n---\nficha.\n",
      );
      const a = w.put(path.join(root, "a.md"), "Falei com Ana Souza Lima.\n");
      const b = w.put(path.join(root, "b.md"), "Ligar para Ana Souza Lima.\n");
      w.update((s) => {
        s.folderAccess = [{ path: hidden, agents: "read", devices: "hide" }];
      });
      await w.index();
      const owner = await w.call("GET", `/api/memory/entities/${enc("perfil:ana souza lima")}`);
      expect(owner.status).toBe(200);
      expect(owner.body.home).toEqual({ fileId: expect.any(Number), path: homeNote });
      expect(owner.body.mentions.map((m: Json) => m.path)).toContain(homeNote);

      const device = w.device(["content"]);
      const list = await w.call("GET", "/api/memory/entities", undefined, device);
      const item = list.body.items.find((e: Json) => e.name === "Ana Souza Lima");
      expect(item).toMatchObject({ files: 2, mentions: 2 });
      const seen = await w.call("GET", `/api/memory/entities/${enc(item.key)}`, undefined, device);
      expect(seen.status).toBe(200);
      expect("home" in seen.body).toBe(false);
      expect(seen.body.mentions.map((m: Json) => m.path).sort()).toEqual([a, b].sort());
      expect(JSON.stringify(seen.body)).not.toContain(hidden);
    });
  });
});

describe("C38 the counts over the audience's files", () => {
  /** Who cites what: a tag at most once per file; `Banco Central` on two lines of a file counts two mentions. */
  const CORPUS: Array<{ rel: string; tags: string[]; banco: number }> = [
    { rel: "aberta/a1.md", tags: ["alfa", "beta"], banco: 2 },
    { rel: "aberta/a2.md", tags: ["alfa"], banco: 1 },
    { rel: "aberta/a3.md", tags: ["beta", "gama"], banco: 0 },
    { rel: "devhide/d1.md", tags: ["alfa", "beta", "gama"], banco: 1 },
    { rel: "devhide/d2.md", tags: ["gama"], banco: 1 },
    { rel: "aghide/g1.md", tags: ["alfa", "gama"], banco: 2 },
    { rel: "aghide/g2.md", tags: ["beta"], banco: 0 },
  ];
  const ENTITIES: Record<string, (f: (typeof CORPUS)[number]) => number> = {
    "tag:alfa": (f) => Number(f.tags.includes("alfa")),
    "tag:beta": (f) => Number(f.tags.includes("beta")),
    "tag:gama": (f) => Number(f.tags.includes("gama")),
    "termo:banco central": (f) => f.banco,
  };

  it("C38 owner, device, run and mcp: files, mentions, related.shared and the tab counts are those of the files each reads", async () => {
    await fresh(async (w, root) => {
      for (const f of CORPUS) {
        const lines = [`notas ${f.tags.map((t) => `#${t}`).join(" ")}`];
        for (let i = 0; i < f.banco; i++) lines.push(`Linha ${i} sobre o Banco Central.`);
        w.put(path.join(root, f.rel), `${lines.join("\n")}\n`);
      }
      w.update((s) => {
        s.folderAccess = [
          { path: path.join(root, "devhide"), agents: "read", devices: "hide" },
          { path: path.join(root, "aghide"), agents: "hide", devices: "read" },
        ];
      });
      await w.index();
      const audiences: Array<[string, Record<string, string>, string]> = [
        ["owner", w.owner(), ""],
        ["device", w.device(["content"]), "devhide/"],
        ["run", w.run("read_only").headers, "aghide/"],
        ["mcp", mcpOf(w), "aghide/"],
      ];
      for (const [who, headers, hiddenPrefix] of audiences) {
        const files = CORPUS.filter((f) => hiddenPrefix === "" || !f.rel.startsWith(hiddenPrefix));
        const expected = Object.entries(ENTITIES)
          .map(([key, count]) => {
            const cited = files.filter((f) => count(f) > 0);
            return { key, files: cited.length, mentions: cited.reduce((n, f) => n + count(f), 0), cited };
          })
          // a term needs 2 files the audience sees; a tag 1
          .filter((e) => e.files >= (e.key.startsWith("termo:") ? 2 : 1));
        const list = await w.call("GET", "/api/memory/entities?limit=200", undefined, headers);
        expect(list.status, who).toBe(200);
        expect(list.body.items.map((e: Json) => [e.key, e.files, e.mentions]).sort(), who).toEqual(
          expected.map((e) => [e.key, e.files, e.mentions]).sort(),
        );
        // the tab counts: the total of each kind
        for (const kind of ["perfil", "projeto", "tag", "termo"]) {
          const tab = await w.call("GET", `/api/memory/entities?kind=${kind}`, undefined, headers);
          expect(tab.body.total, `${who} ${kind}`).toBe(
            expected.filter((e) => e.key.startsWith(`${kind}:`)).length,
          );
        }
        expect(list.body.total, who).toBe(expected.length);
        // related.shared: the files both cite, among those the audience reads
        for (const e of expected) {
          const one = await w.call("GET", `/api/memory/entities/${enc(e.key)}`, undefined, headers);
          expect(one.status, `${who} ${e.key}`).toBe(200);
          const want = expected
            .filter((o) => o.key !== e.key)
            .map((o) => [o.key, e.cited.filter((f) => o.cited.includes(f)).length] as [string, number])
            .filter(([, n]) => n > 0)
            .sort();
          expect(one.body.related.map((r: Json) => [r.key, r.shared]).sort(), `${who} ${e.key}`).toEqual(
            want,
          );
          expect(one.body.mentions, `${who} ${e.key}`).toHaveLength(e.mentions);
        }
      }
    });
  });
});

describe("C42 who may read the two entity routes", () => {
  it("C42 through /api and /api/v1: owner, a device with content, a run's rc_ and mcp pass; a device without content 403 scope_required; no token 401", async () => {
    await fresh(async (w, root) => {
      w.put(path.join(root, "a.md"), "notas #alfa\n");
      await w.index();
      const passing: Array<[string, Record<string, string>]> = [
        ["owner", w.owner()],
        ["device content", w.device(["content"])],
        ["run", w.run("read_only").headers],
        ["mcp", mcpOf(w)],
      ];
      const monitor = w.device(["monitor"]);
      for (const prefix of ["/api", "/api/v1"]) {
        for (const rest of ["/memory/entities", `/memory/entities/${enc("tag:alfa")}`]) {
          const url = `${prefix}${rest}`;
          for (const [who, headers] of passing) {
            const res = await w.call("GET", url, undefined, headers);
            expect(res.status, `${who} ${url} ${JSON.stringify(res.body)}`).toBe(200);
          }
          expect(code(await w.call("GET", url, undefined, monitor)), url).toEqual([403, "scope_required"]);
          const bare = await w.app.inject({ method: "GET", url });
          expect(bare.statusCode, url).toBe(401);
        }
      }
    });
  });
});
