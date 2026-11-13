import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { MONDAY, code, rituaisWorld, sha, type Json, type RituaisWorld } from "./helpers/rituaisWorld.js";

/**
 * Who may call the routes of .specs/features/cerebro-rituais, through the routes (`app.inject` against `buildServer`
 * over a real home): the audience differential of `GET /api/memory/mentions` for a paired device (C64, L-064, L-066),
 * and the refusals of a device and of a run's credential on the seven routes (C73). The audience `agents` at its own
 * layer is in `rituais.layer.test.ts`.
 */

const repoRoot = path.resolve(import.meta.dirname, "..");
/** The commit before this feature (the plan of cerebro-rituais is its child). */
const FEATURE_BASE = "dfe891e";
const atBase = (file: string) =>
  execFileSync("git", ["show", `${FEATURE_BASE}:${file}`], {
    cwd: repoRoot,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });

let w: RituaisWorld;

beforeAll(async () => {
  w = await rituaisWorld("mordomo-rituais-access-");
});
afterAll(async () => {
  await w.close();
});
beforeEach(async () => {
  w.at(MONDAY);
  w.update((s) => {
    s.folderAccess = [];
    s.excludes = s.excludes.filter((e) => e !== "fin");
    s.contexts = [];
    s.indexedFolders = [];
  });
  await w.reset();
});

const notes = (...parts: string[]) => path.join(w.memory, "notes", ...parts);
const idOf = (file: string): number =>
  (w.ctx.db.prepare("SELECT id FROM files WHERE path = ?").get(file) as { id: number }).id;
const setAccess = async (folderAccess: Json[]) => {
  const res = await w.call("PUT", "/api/settings", { folderAccess });
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  await w.index();
};

// ---- C64 ----------------------------------------------------------------------------------------------------------

describe("C64 the audience differential of GET /api/memory/mentions", () => {
  async function seeded() {
    const fin = notes("fin");
    const target = w.put(notes("outra", "Rede.md"), "---\ntitle: Rede\naliases: [Cofre Geral]\n---\nx\n");
    const hiddenTarget = w.put(path.join(fin, "Cofre.md"), "---\ntitle: Cofre\n---\nx\n");
    const secret = w.put(path.join(fin, "segredo.md"), "a rede do segredo sigiloso\no cofre geral\n");
    const v1 = w.put(notes("outra", "v1.md"), "a rede visível\n");
    const v2 = w.put(notes("outra", "v2.md"), "x\nde novo a Rede e o Cofre Geral\n");
    w.put(notes("extra1", "nada.md"), "nada a ver\n");
    w.put(notes("extra2", "ligada.md"), "[[Rede]] e a rede\n");
    await w.index();
    return { fin, target, hiddenTarget, secret, v1, v2 };
  }

  it("C64 a content device's answer equals the owner's with fin excluded (terms, items, total); a hidden source is no item and in no excerpt; a hidden target is 404; two more hidden folders change nothing", async () => {
    const { fin, target, hiddenTarget, secret, v1, v2 } = await seeded();
    const device = w.device(["content"]);
    const url = `/api/memory/mentions?id=${idOf(target)}`;
    // the owner, before anything is hidden, does see the source under fin (the case is not empty)
    const owned = await w.call("GET", url);
    expect((owned.body.items as Json[]).map((i) => i.file.path)).toContain(secret);
    expect(owned.body.total).toBe(4);

    await setAccess([{ path: fin, agents: "write", devices: "hide" }]);
    const seen = await w.call("GET", url, undefined, device);
    expect(seen.status, JSON.stringify(seen.body)).toBe(200);
    expect((seen.body.items as Json[]).map((i) => i.file.path).sort()).toEqual([v1, v2].sort());
    expect(seen.body.total).toBe(2);
    expect(JSON.stringify(seen.body)).not.toContain("segredo");
    expect(JSON.stringify(seen.body)).not.toContain("sigiloso");
    expect(
      code(await w.call("GET", `/api/memory/mentions?id=${idOf(hiddenTarget)}`, undefined, device)),
    ).toEqual([404, "not_found"]);

    // two more folders hidden from the devices, holding no visible item: every answer about the visible target is equal
    await setAccess([
      { path: fin, agents: "write", devices: "hide" },
      { path: notes("extra1"), agents: "write", devices: "hide" },
      { path: notes("extra2"), agents: "write", devices: "hide" },
    ]);
    const more = await w.call("GET", url, undefined, device);
    expect(more.status).toBe(200);
    expect(more.body).toEqual(seen.body);
    for (const limit of [1, 50]) {
      const a = await w.call("GET", `${url}&limit=${limit}`, undefined, device);
      await setAccess([{ path: fin, agents: "write", devices: "hide" }]);
      const b = await w.call("GET", `${url}&limit=${limit}`, undefined, device);
      expect(a.body, `limit=${limit}`).toEqual(b.body);
      await setAccess([
        { path: fin, agents: "write", devices: "hide" },
        { path: notes("extra1"), agents: "write", devices: "hide" },
        { path: notes("extra2"), agents: "write", devices: "hide" },
      ]);
    }

    // the twin: no access of folders, fin excluded, the index passed again; the owner's answer
    w.update((s) => {
      s.folderAccess = [];
      s.excludes = [...s.excludes, "fin"];
    });
    await w.index();
    const left = w.ctx.db
      .prepare("SELECT COUNT(*) c FROM files WHERE path LIKE ?")
      .get(`%${path.sep}fin${path.sep}%`) as { c: number };
    expect(left.c, "the twin's index holds no row of the excluded folder").toBe(0);
    const twin = await w.call("GET", url);
    expect(twin.status).toBe(200);
    expect(seen.body.terms).toEqual(twin.body.terms);
    expect(seen.body.items).toEqual(twin.body.items);
    expect(seen.body.total).toBe(twin.body.total);
    expect(seen.body).toEqual(twin.body);
  });

  it("C64 the owner's answer leaves out a source excluded by settings.excludes", async () => {
    const { target, secret, v1, v2 } = await seeded();
    w.update((s) => {
      s.excludes = [...s.excludes, "fin"];
    });
    await w.index();
    const owned = await w.call("GET", `/api/memory/mentions?id=${idOf(target)}`);
    expect(owned.status).toBe(200);
    expect((owned.body.items as Json[]).map((i) => i.file.path).sort()).toEqual([v1, v2].sort());
    expect(JSON.stringify(owned.body)).not.toContain(secret);
  });

  it("C64 a full-text hit with no row in files is no item (the lookup fails closed, L-061)", async () => {
    const { target, v1, v2 } = await seeded();
    w.ctx.db
      .prepare("INSERT INTO files_fts (rowid, name, rel, content) VALUES (?, ?, ?, ?)")
      .run(9_999_999, "orfa.md", "notes/orfa.md", "a rede sem dono\n");
    try {
      const owned = await w.call("GET", `/api/memory/mentions?id=${idOf(target)}`);
      expect(owned.status).toBe(200);
      expect(JSON.stringify(owned.body)).not.toContain("sem dono");
      expect((owned.body.items as Json[]).map((i) => i.file.path)).toEqual(expect.arrayContaining([v1, v2]));
    } finally {
      w.ctx.db.prepare("DELETE FROM files_fts WHERE rowid = ?").run(9_999_999);
    }
  });

  it("C64 a device holding only monitor gets 403 scope_required; a run's credential gets 403 forbidden", async () => {
    const { target } = await seeded();
    const url = `/api/memory/mentions?id=${idOf(target)}`;
    expect(code(await w.call("GET", url, undefined, w.device(["monitor"])))).toEqual([403, "scope_required"]);
    expect(code(await w.call("GET", url, undefined, w.run("write").headers))).toEqual([403, "forbidden"]);
  });
});

// ---- C73 ----------------------------------------------------------------------------------------------------------

describe("C73 who may call the seven routes", () => {
  it("C73 a device with every scope gets 403 owner_only from the six owner routes, a run gets 403 forbidden from all seven, through /api and /api/v1, and nothing changes", async () => {
    const target = w.put(notes("Rede.md"), "---\ntitle: Rede\n---\nx\n");
    const source = w.put(notes("fonte.md"), "a rede caiu\n");
    const project = w.put(notes("app.md"), "---\ntype: project\nstatus: active\n---\n# App\n");
    const inbox = w.put(path.join(w.memory, "inbox", "x.md"), "# X\n");
    w.journal("2026-11-04", ["09:00 Um laço"]);
    await w.index();
    const owners: Array<[string, string, Json | undefined]> = [
      ["GET", "/api/memory/weekly-review", undefined],
      ["POST", "/api/memory/weekly-review/loops", { key: "a".repeat(64), action: "close" }],
      ["POST", "/api/memory/weekly-review/archive", { week: "2026-11-09", paths: [inbox] }],
      ["POST", "/api/memory/weekly-review/finish", { week: "2026-11-09" }],
      [
        "POST",
        "/api/memory/tasks",
        { path: project, text: "Ligar", baseVersion: sha(fs.readFileSync(project)) },
      ],
      [
        "POST",
        "/api/memory/mentions/link",
        {
          source,
          line: 1,
          term: "Rede",
          target: idOf(target),
          baseVersion: sha(fs.readFileSync(source)),
        },
      ],
    ];
    const all: Array<[string, string, Json | undefined]> = [
      ...owners,
      ["GET", `/api/memory/mentions?id=${idOf(target)}`, undefined],
    ];
    const state = () => ({
      home: w.homeHash(),
      loops: w.ctx.db.prepare("SELECT * FROM loop_decisions ORDER BY key").all(),
      weeks: w.ctx.db.prepare("SELECT * FROM weekly_reviews ORDER BY week").all(),
      meta: w.ctx.db.prepare("SELECT * FROM meta ORDER BY key").all(),
    });
    const device = w.device(["content", "monitor", "run", "approve"]);
    const runs = [w.run("write").headers, w.run("read_only").headers];
    const v1 = (url: string) => url.replace(/^\/api\//, "/api/v1/");
    for (const [method, url, body] of owners)
      for (const at of [url, v1(url)]) {
        const before = state();
        expect(code(await w.call(method, at, body, device)), `${method} ${at}`).toEqual([403, "owner_only"]);
        expect(state(), `${method} ${at}`).toEqual(before);
      }
    for (const [method, url, body] of all)
      for (const at of [url, v1(url)])
        for (const run of runs) {
          const before = state();
          expect(code(await w.call(method, at, body, run)), `${method} ${at}`).toEqual([403, "forbidden"]);
          expect(state(), `${method} ${at}`).toEqual(before);
        }
    // the refusals were the caller's: the owner reads the list and the mentions
    expect((await w.call("GET", owners[0]![1])).status).toBe(200);
    expect((await w.call("GET", all[6]![1])).status).toBe(200);
  });

  it("C73 RUN_API_READ_ROUTES and RUN_API_WRITE_ROUTES equal their lists before this feature", () => {
    const lists = (source: string) =>
      ["RUN_API_READ_ROUTES", "RUN_API_WRITE_ROUTES"].map((name) => {
        const set = new RegExp(`const ${name} = new Set\\(\\[([\\s\\S]*?)\\]\\);`).exec(source)?.[1] ?? "";
        return [...set.matchAll(/"([A-Z]+ [^"]+)"/g)].map((m) => m[1]!).sort();
      });
    const now = lists(fs.readFileSync(path.join(repoRoot, "apps", "api", "src", "server.ts"), "utf8"));
    expect(now[0]!.length).toBeGreaterThan(3);
    expect(now[1]!.length).toBeGreaterThan(0);
    expect(now).toEqual(lists(atBase("apps/api/src/server.ts")));
  });

  it("C73 no MCP tool and no CLI command reaches the routes: the MCP tool list and the mordomo command list are unchanged by name", () => {
    const tools = (source: string) =>
      [...source.matchAll(/^\s+name: "([a-z_]+)",$/gm)].map((m) => m[1]!).sort();
    const mcp = fs.readFileSync(path.join(repoRoot, "apps", "api", "src", "mcp", "mordomo.ts"), "utf8");
    expect(tools(mcp).length).toBeGreaterThan(5);
    expect(tools(mcp)).toEqual(tools(atBase("apps/api/src/mcp/mordomo.ts")));
    const commands = (source: string) =>
      [...(/const COMMANDS = \[([\s\S]*?)\] as const;/.exec(source)?.[1] ?? "").matchAll(/"([a-z-]+)"/g)].map(
        (m) => m[1]!,
      );
    const cli = fs.readFileSync(path.join(repoRoot, "apps", "api", "src", "cli.ts"), "utf8");
    expect(commands(cli).length).toBeGreaterThan(10);
    expect(commands(cli)).toEqual(commands(atBase("apps/api/src/cli.ts")));
    for (const text of [mcp, cli]) expect(text).not.toMatch(/weekly-review|memory\/mentions|memory\/tasks/);
  });
});
