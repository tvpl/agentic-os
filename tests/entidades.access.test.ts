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

describe("C134 an entity's detail names only what the caller reads", () => {
  /**
   * `Ana Souza` is a profile in the open; the owner merged it with the term `Projeto Sigilo`, which two notes of a
   * hidden folder hold and no open file does, and `Ana Souzas`, a profile whose only note is in the hidden folder, is a
   * near-duplicate of its name (`Ana Souzas` and `Ana Souza` are at 0.84, the real MinHash).
   */
  async function sigiloWorld(w: MemoriaWorld, root: string, hide: "devices" | "agents"): Promise<void> {
    const hidden = path.join(root, "sigilo");
    w.put(path.join(root, "pessoas", "ana.md"), "---\ntype: profile\ntitle: Ana Souza\n---\nficha aberta.\n");
    w.put(path.join(hidden, "ata.md"), "Pauta do Projeto Sigilo.\n");
    w.put(path.join(hidden, "plano.md"), "O Projeto Sigilo atrasou.\n");
    w.put(path.join(hidden, "souzas.md"), "---\ntype: profile\ntitle: Ana Souzas\n---\nficha fechada.\n");
    w.update((s) => {
      s.folderAccess = [
        {
          path: hidden,
          agents: hide === "agents" ? "hide" : "read",
          devices: hide === "devices" ? "hide" : "read",
        },
      ];
    });
    await w.index();
    const merged = await w.call("POST", "/api/memory/entities/corrections", {
      action: "merge",
      key: "perfil:ana souza",
      other: "termo:projeto sigilo",
    });
    expect(merged.status, JSON.stringify(merged.body)).toBe(200);
  }

  const detail = (w: MemoriaWorld, headers: Record<string, string>) =>
    w.call("GET", `/api/memory/entities/${enc("perfil:ana souza")}`, undefined, headers);

  /** The owner lists both names of the merge and the hidden-only near-duplicate (L-072: the filter has something to hide). */
  async function ownerSees(w: MemoriaWorld): Promise<void> {
    const owner = await detail(w, w.owner());
    expect(owner.status, JSON.stringify(owner.body)).toBe(200);
    expect(owner.body.corrections).toHaveLength(1);
    expect(owner.body.corrections[0]).toMatchObject({
      action: "merge",
      names: ["ana souza", "projeto sigilo"],
    });
    expect(owner.body.duplicates.map((d: Json) => d.key)).toEqual(["perfil:ana souzas"]);
  }

  async function audienceSees(w: MemoriaWorld, who: string, headers: Record<string, string>): Promise<void> {
    const res = await detail(w, headers);
    expect(res.status, `${who} ${JSON.stringify(res.body)}`).toBe(200);
    // the correction touches a visible entity, so it is listed, with the visible name only
    expect(res.body.corrections, who).toHaveLength(1);
    expect(res.body.corrections[0], who).toMatchObject({ action: "merge", names: ["ana souza"] });
    expect(res.body.duplicates, who).toEqual([]);
    expect(JSON.stringify(res.body), who).not.toMatch(/sigilo|souzas/i);
  }

  it("C134 a device: the merge lists ana souza only and no hidden-only near-duplicate", async () => {
    await fresh(async (w, root) => {
      await sigiloWorld(w, root, "devices");
      await ownerSees(w);
      await audienceSees(w, "device", w.device(["content"]));
    });
  });

  it("C134 a run's rc_ and the principal mcp, with the folder hidden from agents: the same", async () => {
    await fresh(async (w, root) => {
      await sigiloWorld(w, root, "agents");
      await ownerSees(w);
      await audienceSees(w, "run", w.run("read_only").headers);
      await audienceSees(w, "mcp", mcpOf(w));
      // a device reads the folder here, so its detail is the owner's
      const device = await detail(w, w.device(["content"]));
      expect(device.body.corrections[0].names).toEqual(["ana souza", "projeto sigilo"]);
      expect(device.body.duplicates.map((d: Json) => d.key)).toEqual(["perfil:ana souzas"]);
    });
  });

  /** `GET /api/memory/entities?q=` as `who` sends it. */
  const search = (w: MemoriaWorld, q: string, headers: Record<string, string>) =>
    w.call("GET", `/api/memory/entities?q=${enc(q)}`, undefined, headers);

  async function searchSees(w: MemoriaWorld, who: string, headers: Record<string, string>): Promise<void> {
    const hit = await search(w, "projeto sigilo", headers);
    expect(hit.status, `${who} ${JSON.stringify(hit.body)}`).toBe(200);
    expect(hit.body.items, who).toEqual([]);
    expect(hit.body.total, who).toBe(0);
    // a part of the hidden name finds nothing either
    expect((await search(w, "sigilo", headers)).body.total, who).toBe(0);
    // the visible name still finds the entity
    const own = await search(w, "ana", headers);
    expect(
      own.body.items.map((e: Json) => e.key),
      who,
    ).toEqual(["perfil:ana souza"]);
  }

  it("C146 a device searching the hidden name lists nothing and total 0; ana lists the entity; the owner finds it by the merged name", async () => {
    await fresh(async (w, root) => {
      await sigiloWorld(w, root, "devices");
      const owner = await search(w, "projeto sigilo", w.owner());
      expect(owner.body.items.map((e: Json) => e.key)).toEqual(["perfil:ana souza"]);
      await searchSees(w, "device", w.device(["content"]));
    });
  });

  it("C146 a run's rc_ and the principal mcp, with the folder hidden from agents: the same", async () => {
    await fresh(async (w, root) => {
      await sigiloWorld(w, root, "agents");
      const owner = await search(w, "projeto sigilo", w.owner());
      expect(owner.body.items.map((e: Json) => e.key)).toEqual(["perfil:ana souza"]);
      await searchSees(w, "run", w.run("read_only").headers);
      await searchSees(w, "mcp", mcpOf(w));
      // a device reads the folder here: it finds what the owner finds
      const device = await search(w, "projeto sigilo", w.device(["content"]));
      expect(device.body.items.map((e: Json) => e.key)).toEqual(["perfil:ana souza"]);
    });
  });
});

describe("C147 an add entity by audience", () => {
  /** The `add` an owner accepted: the row `writeCorrection` stores for it (`accept` writes this shape). */
  function accepted(w: MemoriaWorld, name: string, aliases: string[]) {
    w.ctx.db
      .prepare("INSERT INTO entity_overrides (action, a, b, name, created_at) VALUES ('add', ?, ?, ?, ?)")
      .run(name.toLowerCase(), JSON.stringify({ kind: "projeto", aliases }), name, Date.now());
    w.ctx.entities.invalidate();
  }
  const ADD = { key: "projeto:projeto sigilo", name: "Projeto Sigilo", alias: "Sigilo X" };

  async function setup(w: MemoriaWorld, root: string, hide: "devices" | "agents") {
    const hidden = path.join(root, "sigilo");
    w.put(path.join(root, "aberta.md"), "notas #aberta\n");
    w.put(path.join(hidden, "ata.md"), "O Projeto Sigilo atrasou.\n");
    w.update((s) => {
      s.folderAccess = [
        {
          path: hidden,
          agents: hide === "agents" ? "hide" : "read",
          devices: hide === "devices" ? "hide" : "read",
        },
      ];
    });
    accepted(w, ADD.name, [ADD.alias]);
    await w.index();
    // the owner lists it through the hidden note, and merges it into the visible tag
    const owner = await w.call("GET", "/api/memory/entities");
    expect(owner.body.items.find((e: Json) => e.key === ADD.key)).toMatchObject({
      files: 1,
      aliases: [ADD.alias],
    });
    expect((await w.call("GET", `/api/memory/entities/${enc(ADD.key)}`)).status).toBe(200);
  }

  async function sees(w: MemoriaWorld, who: string, headers: Record<string, string>) {
    const list = await w.call("GET", "/api/memory/entities?limit=200", undefined, headers);
    expect(list.status, who).toBe(200);
    expect(
      list.body.items.map((e: Json) => e.key),
      who,
    ).toEqual(["tag:aberta"]);
    expect((await w.call("GET", `/api/memory/entities?q=sigilo`, undefined, headers)).body.total, who).toBe(
      0,
    );
    expect(
      code(await w.call("GET", `/api/memory/entities/${enc(ADD.key)}`, undefined, headers)),
      who,
    ).toEqual([404, "not_found"]);
    const tag = await w.call("GET", `/api/memory/entities/${enc("tag:aberta")}`, undefined, headers);
    expect(JSON.stringify([list.body, tag.body]), who).not.toMatch(/sigilo/i);
  }

  it("C147 a device: the hidden note's add lists nothing, a correction merging it into a visible tag names neither it nor its alias; the owner lists it with files 1", async () => {
    await fresh(async (w, root) => {
      await setup(w, root, "devices");
      // an owner's merge of the add into the visible tag: its row is the visible name only
      const merged = await w.call("POST", "/api/memory/entities/corrections", {
        action: "merge",
        key: "tag:aberta",
        other: ADD.key,
      });
      expect(merged.status, JSON.stringify(merged.body)).toBe(200);
      const device = w.device(["content"]);
      await sees(w, "device", device);
      const row = (await w.call("GET", `/api/memory/entities/${enc("tag:aberta")}`, undefined, device)).body
        .corrections;
      expect(row.map((c: Json) => c.names)).toEqual([["aberta"]]);
    });
  });

  it("C147 a run's rc_ and the principal mcp, with the folder hidden from agents: the same; a device that reads the folder lists it", async () => {
    await fresh(async (w, root) => {
      await setup(w, root, "agents");
      await w.call("POST", "/api/memory/entities/corrections", {
        action: "merge",
        key: "tag:aberta",
        other: ADD.key,
      });
      await sees(w, "run", w.run("read_only").headers);
      await sees(w, "mcp", mcpOf(w));
      const device = await w.call("GET", "/api/memory/entities?limit=200", undefined, w.device(["content"]));
      expect(device.body.items.map((e: Json) => e.name)).toEqual(["Projeto Sigilo"]);
    });
  });

  it("C147 an add no file mentions is listed to the owner with files 0 and to nobody else", async () => {
    await fresh(async (w, root) => {
      w.put(path.join(root, "aberta.md"), "notas #aberta\n");
      accepted(w, "Zeca Pagodinho", ["Zeca"]);
      await w.index();
      const key = "projeto:zeca pagodinho";
      const owner = await w.call("GET", "/api/memory/entities");
      expect(owner.body.items.find((e: Json) => e.key === key)).toMatchObject({
        files: 0,
        aliases: ["Zeca"],
      });
      for (const [who, headers] of [
        ["device", w.device(["content"])],
        ["run", w.run("read_only").headers],
        ["mcp", mcpOf(w)],
      ] as const) {
        const list = await w.call("GET", "/api/memory/entities?limit=200", undefined, headers);
        expect(
          list.body.items.map((e: Json) => e.key),
          who,
        ).toEqual(["tag:aberta"]);
        expect(JSON.stringify(list.body), who).not.toMatch(/zeca/i);
        expect(
          code(await w.call("GET", `/api/memory/entities/${enc(key)}`, undefined, headers)),
          who,
        ).toEqual([404, "not_found"]);
      }
    });
  });
});
