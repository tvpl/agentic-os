import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { API, type RouteDefinition } from "@mordomo/contracts";
import { buildWorld, SCENARIOS } from "./helpers/contractWorld.js";
import { notesViewWorld, sha, type Json, type NotesViewWorld } from "./helpers/notesViewWorld.js";
import { EXPECTED_ROUTE_SCOPES } from "./helpers/routeScopes.js";
import { ENTRIES, edgesOf, loadTree, reachable } from "../apps/command-centre/src/testing/sourceGraph.js";

/**
 * .specs/features/cerebro-vista-notas, the cross-cutting checks of batch A: the two new routes in the contract, the
 * document, the scope list, docs/security.md and the refusal probe (C75), and who may call them (C76); and of batch C,
 * the weight of the notes view (C79).
 */

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const entryOf = (id: string) => API[id as keyof typeof API] as RouteDefinition | undefined;
const codes = (e: RouteDefinition) => (e.errors ?? []).map((x) => `${x.status} ${x.code}`);
const shape = (schema: unknown): Record<string, unknown> =>
  (schema as { shape?: Record<string, unknown> } | undefined)?.shape ?? {};

describe("cross-cutting: the routes in the contract", () => {
  it("C75 GET /api/memory/tree (content) and PUT /api/memory/notes/properties (owner) are in the API table with schemas and errors, the document, EXPECTED_ROUTE_SCOPES, their row of docs/security.md and the refusal probe; memory.note declares the three fields and memory.notes.create declares folder and 409 structure_fixed", async () => {
    const tree = entryOf("memory.tree");
    expect(tree).toBeDefined();
    expect(`${tree!.method} ${tree!.path}`).toBe("GET /api/memory/tree");
    expect(tree!.scope).toBe("content");
    expect(Object.keys(shape(tree!.query)).sort()).toEqual(["context", "dir", "root", "sort"]);
    expect(Object.keys(tree!.responses).map(Number)).toEqual([200]);
    expect(Object.keys(shape(tree!.responses[200])).sort()).toEqual(
      ["dir", "files", "folders", "indexNote", "omitted", "root", "roots", "truncated"].sort(),
    );
    expect(codes(tree!).sort()).toEqual(["400 unknown_root", "404 context_not_found", "404 not_found"]);

    const props = entryOf("memory.notes.properties");
    expect(props).toBeDefined();
    expect(`${props!.method} ${props!.path}`).toBe("PUT /api/memory/notes/properties");
    expect(props!.scope).toBe("owner");
    expect(Object.keys(shape(props!.body)).sort()).toEqual(["baseVersion", "path", "remove", "set"]);
    expect(Object.keys(props!.responses).map(Number)).toEqual([200]);
    expect(Object.keys(shape(props!.responses[200])).sort()).toEqual(
      ["mtime", "name", "path", "properties", "size", "version"].sort(),
    );
    expect(codes(props!)).toEqual(
      expect.arrayContaining([
        "403 note_not_editable",
        "403 forbidden_path",
        "404 note_missing",
        "409 edit_conflict",
        "409 front_matter_unreadable",
        "413 note_too_large",
      ]),
    );

    const note = entryOf("memory.note")!;
    expect(Object.keys(shape(note.responses[200]))).toEqual(
      expect.arrayContaining(["properties", "otherProperties", "bodyStart"]),
    );
    const create = entryOf("memory.notes.create")!;
    expect(Object.keys(shape(create.body))).toContain("folder");
    expect(codes(create)).toContain("409 structure_fixed");

    expect(EXPECTED_ROUTE_SCOPES["GET /api/memory/tree"]).toBe("content");
    expect(EXPECTED_ROUTE_SCOPES["PUT /api/memory/notes/properties"]).toBe("owner");

    const security = fs.readFileSync(path.join(repoRoot, "docs", "security.md"), "utf8");
    const scopeRow = (scope: string) =>
      security.split("\n").find((l) => l.startsWith(`| \`${scope}\` (`)) ?? "";
    for (const [route, scope] of [
      ["GET /api/memory/tree", "content"],
      ["PUT /api/memory/notes/properties", "owner"],
    ] as const) {
      expect(scopeRow(scope), route).toContain(`\`${route}\``);
      for (const other of ["monitor", "content", "run", "approve", "owner"].filter((s) => s !== scope))
        expect(scopeRow(other).includes(`\`${route}\``), `${route} in ${other}`).toBe(false);
    }

    const world = await buildWorld();
    try {
      for (const [route, status] of [
        ["GET /api/memory/tree", 200],
        ["PUT /api/memory/notes/properties", 200],
      ] as const) {
        const scenario = SCENARIOS[route];
        expect(scenario, route).toBeDefined();
        const answer = await scenario!.run(world);
        expect(answer.status, `${route} ${JSON.stringify(answer.body)}`).toBe(status);
      }
      const doc = (await world.call("GET", "/api/openapi.json")).body as {
        paths: Record<string, Record<string, any>>;
      };
      const treeOp = doc.paths["/api/v1/memory/tree"]?.get;
      expect(treeOp?.operationId).toBe("memory.tree");
      expect(treeOp["x-mordomo-scope"]).toBe("content");
      expect(JSON.stringify(treeOp.responses["400"])).toContain("unknown_root");
      expect(JSON.stringify(treeOp.responses["404"])).toContain("context_not_found");
      for (const name of ["context", "root", "dir", "sort"])
        expect(JSON.stringify(treeOp.parameters)).toContain(`"${name}"`);
      const propsOp = doc.paths["/api/v1/memory/notes/properties"]?.put;
      expect(propsOp?.operationId).toBe("memory.notes.properties");
      expect(propsOp["x-mordomo-scope"]).toBe("owner");
      expect(JSON.stringify(propsOp.responses["409"])).toContain("front_matter_unreadable");
      expect(JSON.stringify(propsOp.responses["409"])).toContain("edit_conflict");
      const createOp = doc.paths["/api/v1/memory/notes"]?.post;
      expect(JSON.stringify(createOp.responses["409"])).toContain("structure_fixed");
      expect(JSON.stringify(createOp.requestBody)).toContain('"folder"');
      const noteOp = doc.paths["/api/v1/memory/note"]?.get;
      for (const field of ["properties", "otherProperties", "bodyStart"])
        expect(JSON.stringify(noteOp.responses["200"])).toContain(`"${field}"`);
    } finally {
      await world.close();
    }
  }, 120_000);
});

describe("cross-cutting: who may call the routes", () => {
  let w: NotesViewWorld;
  beforeAll(async () => {
    w = await notesViewWorld("mordomo-notes-contract-");
  });
  afterAll(async () => {
    await w?.close();
  });

  it("C76 a device with content gets 200 from the tree and one with monitor only gets 403; a device with every scope gets 403 owner_only from the properties route and the file is unchanged", async () => {
    const content = await w.call("GET", "/api/memory/tree", undefined, w.device(["content"]));
    expect(content.status, JSON.stringify(content.body)).toBe(200);
    const monitor = await w.call("GET", "/api/memory/tree", undefined, w.device(["monitor"]));
    expect(monitor.status).toBe(403);

    const text = "---\nstatus: active\n---\n# Nota\n";
    const file = w.put(path.join(w.memory, "notes", "c76.md"), text);
    const every = w.device(["content", "monitor", "run", "approve"]);
    const res = await w.call(
      "PUT",
      "/api/memory/notes/properties",
      { path: file, baseVersion: sha(text), set: { status: "done" } },
      every,
    );
    expect(res.status).toBe(403);
    expect((res.body as Json).error.code).toBe("owner_only");
    expect(fs.readFileSync(file, "utf8")).toBe(text);
    // the owner may
    const owner = await w.call("PUT", "/api/memory/notes/properties", {
      path: file,
      baseVersion: sha(text),
      set: { status: "done" },
    });
    expect(owner.status, JSON.stringify(owner.body)).toBe(200);
  });
});

describe("cross-cutting: the weight of the notes view", () => {
  type Entry = {
    feature: string;
    reason: string;
    jsRaw: number;
    jsGzip: number;
    cssRaw: number;
    cssGzip: number;
  };

  it("C79 the notes view is reached from the entries only by a dynamic import(); the baseline's cerebro-vista-notas entry follows cerebro-contextos with a reason of more than 40 characters and the four numbers, at most 24 KB JS gzip and 4.5 KB CSS gzip above it", () => {
    const tree = loadTree(path.join(repoRoot, "apps", "command-centre", "src"));
    // What each page loads without anyone asking: its entry and what that imports statically.
    for (const entry of ENTRIES) {
      const seen = new Set<string>([entry]);
      const queue = [entry];
      while (queue.length > 0)
        for (const edge of edgesOf(tree, queue.pop()!)) {
          if (edge.how === "dynamic" || edge.how === "url" || seen.has(edge.to)) continue;
          seen.add(edge.to);
          queue.push(edge.to);
        }
      expect(
        [...seen].filter((f) => f.startsWith("brain/notes/")),
        entry,
      ).toEqual([]);
    }
    expect(reachable(tree).has("brain/notes/NotesView.tsx")).toBe(true);
    // The two ways in are dynamic: the brain's view switch, and the gallery's notes story (C78), itself an import().
    const importers = [...tree.keys()].filter(
      (f) => !/\.test\./.test(f) && edgesOf(tree, f).some((e) => e.to === "brain/notes/NotesView.tsx"),
    );
    expect(importers.sort()).toEqual(["brain/BrainViewSwitch.tsx", "gallery/notesStory.tsx"]);
    const how = (from: string, to: string) => edgesOf(tree, from).find((e) => e.to === to)?.how;
    expect(how("brain/BrainViewSwitch.tsx", "brain/notes/NotesView.tsx")).toBe("dynamic");
    expect(
      [...tree.keys()].filter(
        (f) => !/\.test\./.test(f) && edgesOf(tree, f).some((e) => e.to === "gallery/notesStory.tsx"),
      ),
    ).toEqual(["gallery/main.tsx"]);
    expect(how("gallery/main.tsx", "gallery/notesStory.tsx")).toBe("dynamic");

    const baseline = JSON.parse(
      fs.readFileSync(path.join(repoRoot, "scripts", "bundle-baseline.json"), "utf8"),
    ) as {
      after: Entry[];
    };
    const i = baseline.after.findIndex((e) => e.feature === "cerebro-vista-notas");
    expect(i, "the entry exists").toBeGreaterThan(0);
    const entry = baseline.after[i]!;
    const before = baseline.after[i - 1]!;
    expect(before.feature).toBe("cerebro-contextos");
    expect(entry.reason.length).toBeGreaterThan(40);
    for (const k of ["jsRaw", "jsGzip", "cssRaw", "cssGzip"] as const)
      expect(Number.isInteger(entry[k]) && entry[k] > 0, k).toBe(true);
    expect(entry.jsGzip - before.jsGzip).toBeLessThanOrEqual(24 * 1024);
    expect(entry.cssGzip - before.cssGzip).toBeLessThanOrEqual(4.5 * 1024);
  });
});
