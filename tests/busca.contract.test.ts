import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { SETTINGS_FAIL_CLOSED } from "../core/src/config/failClosed.js";
import { SettingsStore } from "../core/src/config/store.js";
import { EventBus } from "../core/src/events.js";
import { MODEL_CATALOG } from "../core/src/models/catalog.js";
import { ensureDirs, resolvePaths } from "../core/src/paths.js";
import { execFileSync } from "node:child_process";
import { API, EVENT_SCHEMAS, OS_EVENT_TYPES } from "@mordomo/contracts";
import { makeTempHome } from "./helpers.js";
import { buscaWorld, code, type BuscaWorld } from "./helpers/buscaWorld.js";
import { EXPECTED_ROUTE_SCOPES } from "./helpers/routeScopes.js";

/**
 * .specs/features/cerebro-busca-significado: the contract pins of S4 (batch C): the network site of the local mode, the
 * new settings closing when unreadable, the legal texts that move with the download, and the exact optional dependency.
 */

const repoRoot = path.resolve(import.meta.dirname, "..");
const read = (file: string) => fs.readFileSync(path.join(repoRoot, file), "utf8");

type Scan = {
  scanSource: (source: string, file: string) => { points: Map<string, number>; hosts: Set<string> };
  scanTree: (root?: string) => {
    sites: Array<{ file: string; kind: string; count: number }>;
    hosts: Array<{ host: string }>;
  };
};
const scan = (await import("../scripts/network-scan.mjs")) as unknown as Scan;
const policy = JSON.parse(read("legal/network-policy.json")) as {
  hosts: Array<{
    id: string;
    match: string[];
    gate?: { setting?: string };
    defaultState?: string;
    data: string;
  }>;
  sites: Array<{ file: string; kind: string; count: number; hosts: string[] }>;
};

// ---------------------------------------------------------------------------------------------- C56

describe("C56 the network of the local mode", () => {
  it("C56 the scan finds no site in the child's entry, and the only site of the local mode is the downloader's fetch", () => {
    const child = scan.scanSource(read("core/src/models/localChild.ts"), "core/src/models/localChild.ts");
    expect([...child.points.keys()]).toEqual([]);
    expect([...child.hosts]).toEqual([]);
    const found = scan.scanTree(repoRoot);
    const local = found.sites.filter((s) => s.file.startsWith("core/src/models/"));
    expect(local.map((s) => [s.file, s.kind, s.count])).toEqual([
      ["core/src/models/downloads.ts", "fetch", 1],
    ]);
    expect(policy.sites.filter((s) => s.file.startsWith("core/src/models/"))).toEqual([
      expect.objectContaining({
        file: "core/src/models/downloads.ts",
        kind: "fetch",
        count: 1,
        hosts: ["model-repository"],
      }),
    ]);
  });
});

// ---------------------------------------------------------------------------------------------- C62

const homes: Array<() => void> = [];
afterEach(() => {
  for (const cleanup of homes.splice(0)) cleanup();
});

function loadFrom(memory: unknown) {
  const temp = makeTempHome("mordomo-busca-c62-");
  homes.push(temp.cleanup);
  const paths = resolvePaths(temp.paths.home);
  ensureDirs(paths);
  fs.writeFileSync(path.join(paths.config, "settings.json"), JSON.stringify({ version: 2, memory }));
  return new SettingsStore(paths, new EventBus()).load();
}

describe("C62 the new settings close when unreadable", () => {
  it("C62 local = 7 reads absent; rerank.enabled 'yes' reads false; hops 'x' reads 2; abstain 'x' reads true", () => {
    const local = loadFrom({ embeddings: { enabled: true, provider: "local", local: 7 } });
    expect(local.memory.embeddings.local).toBeUndefined();
    // as the settings are read and answered (GET /api/settings): no `local` key at all
    expect("local" in JSON.parse(JSON.stringify(local.memory.embeddings))).toBe(false);
    expect(local.memory.embeddings).toMatchObject({ enabled: true, provider: "local" });
    expect(loadFrom({ recall: { rerank: { enabled: "yes" } } }).memory.recall.rerank.enabled).toBe(false);
    expect(loadFrom({ recall: { hops: "x" } }).memory.recall.hops).toBe(2);
    expect(loadFrom({ recall: { abstain: "x" } }).memory.recall.abstain).toBe(true);
  });

  it("C62 SETTINGS_FAIL_CLOSED holds local.model (absent) and rerank.enabled (false), and the three rules of memory.embeddings", () => {
    const rule = (p: string) => SETTINGS_FAIL_CLOSED.find((r) => r.path === p);
    expect(rule("memory.embeddings.local.model")).toEqual({
      path: "memory.embeddings.local.model",
      closed: undefined,
    });
    expect(rule("memory.recall.rerank.enabled")).toEqual({
      path: "memory.recall.rerank.enabled",
      closed: false,
    });
    expect(rule("memory.embeddings.enabled")).toEqual({ path: "memory.embeddings.enabled", closed: false });
    expect(rule("memory.embeddings.sendRemote")).toEqual({
      path: "memory.embeddings.sendRemote",
      closed: false,
    });
    expect(rule("memory.embeddings.provider")).toEqual({
      path: "memory.embeddings.provider",
      closed: "hash",
      also: [{ sibling: "enabled", value: false }],
    });
  });
});

// ---------------------------------------------------------------------------------------------- C67

describe("C67 the network policy, the privacy text and the notices move together", () => {
  it("C67 19 host entries, the model repository's matching every catalog host, gated on local.model, off by default", () => {
    expect(policy.hosts).toHaveLength(19);
    const repository = policy.hosts.find((h) => h.id === "model-repository")!;
    expect(repository).toBeDefined();
    for (const host of new Set(MODEL_CATALOG.flatMap((e) => e.hosts)))
      expect(repository.match, host).toContain(host);
    expect(repository.gate).toEqual({ setting: "memory.embeddings.local.model" });
    expect(repository.defaultState).toBe("off");
  });

  it("C67 44 sites, the new one the downloader's fetch with count 1", () => {
    expect(scan.scanTree(repoRoot).sites).toHaveLength(44);
    expect(policy.sites).toHaveLength(44);
    expect(policy.sites.filter((s) => s.hosts.includes("model-repository"))).toEqual([
      expect.objectContaining({ file: "core/src/models/downloads.ts", kind: "fetch", count: 1 }),
    ]);
  });

  it("C67 PRIVACY.md names the download (a GET of the catalog's files, no note text, the hosts) and the recall's question", () => {
    const privacy = read("legal/PRIVACY.md");
    const repository = policy.hosts.find((h) => h.id === "model-repository")!;
    expect(privacy).toContain(repository.data);
    for (const part of [
      "um GET de cada arquivo do modelo escolhido",
      "Nenhum texto de nota",
      "nenhuma pergunta",
    ])
      expect(repository.data, part).toContain(part);
    for (const host of repository.match) expect(privacy, host).toContain(`\`${host}\``);
    const embeddings = policy.hosts.find((h) => h.id === "embeddings")!;
    expect(privacy).toContain(embeddings.data);
    expect(embeddings.data).toContain("a cada recall");
    expect(embeddings.data).toContain(
      "a pergunta do recall vai ao mesmo endereço, do mesmo modo que a pergunta de uma busca",
    );
    // per section now, not "8000 characters of each file"
    expect(privacy).not.toContain("até 8000 caracteres de cada um");
    expect(embeddings.data).toContain(
      "cada seção enviada com o caminho de títulos da nota e até 8000 caracteres",
    );
  });

  it("C67 THIRD_PARTY_NOTICES.md names @huggingface/transformers 4.3.2 (Apache-2.0) and onnxruntime-node (MIT)", () => {
    const notices = read("THIRD_PARTY_NOTICES.md");
    expect(notices).toMatch(/`@huggingface\/transformers`\s*\|\s*4\.3\.2\s*\|\s*Apache-2\.0\s*\|/);
    expect(notices).toMatch(/`onnxruntime-node`\s*\|\s*[\d.]+\s*\|\s*MIT\s*\|/);
  });

  it("C67 provider.embed([question] occurs once in semantic.ts and provider.embed( nowhere in recall.ts", () => {
    expect(read("core/src/memory/semantic.ts").match(/provider\.embed\(\[question\]/g)).toHaveLength(1);
    expect(read("core/src/memory/recall.ts")).not.toContain("provider.embed(");
  });
});

// ---------------------------------------------------------------------------------------------- C68

describe("C68 the runtime is an exact, optional dependency of the core", () => {
  it("C68 core/package.json has @huggingface/transformers 4.3.2 under optionalDependencies beside sqlite-vec 0.1.9, not under dependencies; the lock resolves 4.3.2", () => {
    const core = JSON.parse(read("core/package.json")) as Record<string, Record<string, string> | undefined>;
    expect(core.optionalDependencies).toEqual({
      "@huggingface/transformers": "4.3.2",
      "sqlite-vec": "0.1.9",
    });
    expect(core.dependencies?.["@huggingface/transformers"]).toBeUndefined();
    const lock = JSON.parse(read("package-lock.json")) as {
      packages: Record<string, { version?: string; optional?: boolean }>;
    };
    expect(lock.packages["core"]?.["optionalDependencies" as never]).toEqual(core.optionalDependencies);
    expect(lock.packages["node_modules/@huggingface/transformers"]?.version).toBe("4.3.2");
  });
});

// ---------------------------------------------------------------------------------------------- batch D

const worlds: BuscaWorld[] = [];
afterEach(async () => {
  for (const w of worlds.splice(0)) await w.close();
});

describe("C86 memory.recall defaults and bounds", () => {
  it("C86 with no memory.recall in settings.json it reads door 4's defaults", () => {
    const temp = makeTempHome("mordomo-busca-c86-");
    try {
      const paths = resolvePaths(temp.paths.home);
      ensureDirs(paths);
      fs.writeFileSync(paths.settingsFile, JSON.stringify({ setupCompleted: true, memory: {} }));
      const settings = new SettingsStore(paths, new EventBus()).load();
      expect(settings.memory.recall).toEqual({
        abstain: true,
        hops: 2,
        tokenBudget: 3000,
        rerank: { enabled: false, candidates: 20, timeoutMs: 15000 },
        // cerebro-entidades-resumos, door 5: the graph switch, off by default
        graph: { enabled: false },
      });
    } finally {
      temp.cleanup();
    }
  });
  it("C86 through PUT each accepted edge is read back and each refused edge is 400 validation with settings.json unchanged", async () => {
    const w = await buscaWorld("mordomo-busca-c86-put-");
    worlds.push(w);
    const file = path.join(w.home, "config", "settings.json");
    const rerank = { enabled: false, candidates: 20, timeoutMs: 15000 };
    const accepted: Array<[string, Record<string, unknown>]> = [
      ["hops 1", { hops: 1 }],
      ["hops 3", { hops: 3 }],
      ["tokenBudget 500", { tokenBudget: 500 }],
      ["tokenBudget 20000", { tokenBudget: 20000 }],
      ["rerank.candidates 1", { rerank: { ...rerank, candidates: 1 } }],
      ["rerank.candidates 50", { rerank: { ...rerank, candidates: 50 } }],
      ["rerank.timeoutMs 1000", { rerank: { ...rerank, timeoutMs: 1000 } }],
      ["rerank.timeoutMs 120000", { rerank: { ...rerank, timeoutMs: 120000 } }],
    ];
    for (const [name, recall] of accepted) {
      const res = await w.call("PUT", "/api/settings", { memory: { recall } });
      expect(res.status, `${name} ${JSON.stringify(res.body)}`).toBe(200);
      const read = (await w.call("GET", "/api/settings")).body.memory.recall;
      expect(read, name).toMatchObject(recall);
    }
    const refused: Array<[string, Record<string, unknown>]> = [
      ["hops 0", { hops: 0 }],
      ["hops 4", { hops: 4 }],
      ["tokenBudget 499", { tokenBudget: 499 }],
      ["tokenBudget 20001", { tokenBudget: 20001 }],
      ["rerank.candidates 0", { rerank: { ...rerank, candidates: 0 } }],
      ["rerank.candidates 51", { rerank: { ...rerank, candidates: 51 } }],
      ["rerank.timeoutMs 999", { rerank: { ...rerank, timeoutMs: 999 } }],
      ["rerank.timeoutMs 120001", { rerank: { ...rerank, timeoutMs: 120001 } }],
      ["abstain yes", { abstain: "yes" }],
    ];
    for (const [name, recall] of refused) {
      const before = fs.readFileSync(file);
      expect(code(await w.call("PUT", "/api/settings", { memory: { recall } })), name).toEqual([
        400,
        "validation",
      ]);
      expect(fs.readFileSync(file).equals(before), name).toBe(true);
    }
  });
  it("C86 a PUT of memory.recall without rerank reads rerank at its default (replaced whole, G43)", async () => {
    const w = await buscaWorld("mordomo-busca-c86-whole-");
    worlds.push(w);
    const on = { enabled: true, candidates: 5, timeoutMs: 2000 };
    expect((await w.call("PUT", "/api/settings", { memory: { recall: { rerank: on } } })).status).toBe(200);
    expect((await w.call("GET", "/api/settings")).body.memory.recall.rerank).toEqual(on);
    expect((await w.call("PUT", "/api/settings", { memory: { recall: { hops: 3 } } })).status).toBe(200);
    expect((await w.call("GET", "/api/settings")).body.memory.recall).toEqual({
      abstain: true,
      hops: 3,
      tokenBudget: 3000,
      rerank: { enabled: false, candidates: 20, timeoutMs: 15000 },
      // cerebro-entidades-resumos, door 5: the graph switch, off by default
      graph: { enabled: false },
    });
  });
});

describe("C97 the routes of door 8 and the changed entries", () => {
  const pairs = (entry: { errors?: ReadonlyArray<{ status: number; code: string }> }) =>
    (entry.errors ?? []).map((e) => [e.status, e.code]);
  it("C97 GET and POST /api/memory/embedder, both owner, with exactly the declared errors of Coverage", () => {
    const get = API["memory.embedder"];
    const post = API["memory.embedder.action"];
    expect([get.method, get.path, get.scope]).toEqual(["GET", "/api/memory/embedder", "owner"]);
    expect([post.method, post.path, post.scope]).toEqual(["POST", "/api/memory/embedder", "owner"]);
    // 403 owner_only and 403 forbidden are the owner scope's, 400 validation the body's: declared by every entry alike
    expect(pairs(get)).toEqual([]);
    expect(pairs(post).sort()).toEqual(
      [
        [400, "terms_not_accepted"],
        [404, "model_not_found"],
        [409, "local_unavailable"],
        [409, "model_in_use"],
        [409, "download_in_progress"],
      ].sort(),
    );
    for (const key of ["GET /api/memory/embedder", "POST /api/memory/embedder"])
      expect(EXPECTED_ROUTE_SCOPES[key], key).toBe("owner");
    const security = read("docs/security.md");
    for (const route of ["`GET /api/memory/embedder`", "`POST /api/memory/embedder`"])
      expect(security, route).toContain(route);
  });
  it("C97 recall, search and status keep method, path, scope and errors, and their responses gain exactly the Surface's keys", () => {
    const keep: Array<[keyof typeof API, string, string, string, Array<[number, string]>]> = [
      ["memory.recall", "GET", "/api/memory/recall", "content", [[404, "context_not_found"]]],
      [
        "memory.search",
        "GET",
        "/api/memory/search",
        "content",
        [
          [404, "context_not_found"],
          [409, "semantic_disabled"],
        ],
      ],
      ["memory.status", "GET", "/api/memory/status", "monitor", [[404, "context_not_found"]]],
    ];
    for (const [key, method, p, scope, errors] of keep) {
      const entry = API[key] as {
        method: string;
        path: string;
        scope?: string;
        errors?: Array<{ status: number; code: string }>;
      };
      expect([entry.method, entry.path, entry.scope], key).toEqual([method, p, scope]);
      expect(pairs(entry), key).toEqual(errors);
    }
    const shape = (schema: unknown) =>
      Object.keys((schema as { shape: Record<string, unknown> }).shape).sort();
    expect(shape(API["memory.recall"].responses[200])).toEqual(
      [
        "question",
        "keywords",
        "answerContext",
        "tokensEstimate",
        "candidatesConsidered",
        "opened",
        "candidates",
        "durationMs",
        "abstained",
        "abstainReason",
        "rerank",
      ].sort(),
    );
    const status = (API["memory.status"].responses[200] as unknown as { shape: { semantic: unknown } }).shape
      .semantic;
    expect(shape(status)).toEqual(
      ["enabled", "provider", "backend", "vectors", "sections", "model", "blocked", "error", "local"].sort(),
    );
    const hit = (API["memory.search"].responses[200] as unknown as { element: unknown }).element;
    expect(shape(hit)).toEqual(expect.arrayContaining(["section", "line"]));
    // the recall's query gains `rerank`, a flag
    const query = API["memory.recall"].query as unknown as { shape: Record<string, unknown> };
    expect(Object.keys(query.shape)).toContain("rerank");
  });
});

describe("C102 no event is added", () => {
  const BASE = "c2b510b";
  it("C102 OS_EVENT_TYPES, the v1 schemas and docs/events.md are as on the feature's base", () => {
    const git = (args: string[]) => execFileSync("git", args, { cwd: repoRoot, encoding: "utf8" });
    expect(read("docs/events.md")).toBe(git(["show", `${BASE}:docs/events.md`]));
    const names = (source: string) =>
      [
        ...source
          .slice(source.indexOf("OS_EVENT_TYPES = ["))
          .split("]")[0]!
          .matchAll(/"([a-z.]+)"/g),
      ].map((m) => m[1]);
    expect([...OS_EVENT_TYPES]).toEqual(names(git(["show", `${BASE}:contracts/src/eventRegistry.ts`])));
    expect(read("contracts/src/eventSchemas.ts")).toBe(
      git(["show", `${BASE}:contracts/src/eventSchemas.ts`]),
    );
    expect(Object.keys(EVENT_SCHEMAS).sort()).toEqual([...OS_EVENT_TYPES].sort());
  });
});

describe("C108 the guide and the security table", () => {
  it("C108 docs/memory-guide.md has Busca por significado with the three providers, Ollama, the download and its license, and mordomo eval with door 6's format", () => {
    const guide = read("docs/memory-guide.md");
    const at = guide.indexOf("### Busca por significado");
    expect(at).toBeGreaterThan(0);
    const section = guide.slice(at, guide.indexOf("\n## ", at));
    for (const provider of ["`hash`", "`http`", "`local`"]) expect(section, provider).toContain(provider);
    expect(section).toMatch(/Install Ollama/);
    expect(section).toContain('"endpoint": "http://127.0.0.1:11434/v1/embeddings"');
    expect(section).toMatch(/downloaded to `<home>\/models\/<id>\/`/);
    expect(section).toMatch(/accept the Gemma terms before the\s+download \(`acceptTerms: true`\)/);
    expect(section).toContain("`mordomo eval <file> [--json]`");
    expect(section).toContain(
      '{ "v": 1, "queries": [{ "q": "<question>", "kind": "single" | "multi" | "latest" | "window" | "abstain", "expect": [',
    );
    expect(section).toMatch(/exits 2 with\s+`eval: <position>: <reason>`/);
    // the rows of C97
    const security = read("docs/security.md");
    for (const route of ["`GET /api/memory/embedder`", "`POST /api/memory/embedder`"])
      expect(security).toContain(route);
  });
});

// ---- C135: the weight of the screen ------------------------------------------------------------------------------

describe("C135 the bundle ceiling", () => {
  it("C135 the baseline's cerebro-busca-significado entry follows cerebro-rituais with a reason of more than 40 characters and the four numbers, at most 12 288 B of JS gzip and 2 048 B of CSS gzip above it (604 839 B and 83 496 B)", () => {
    type Entry = {
      feature: string;
      reason: string;
      jsRaw: number;
      jsGzip: number;
      cssRaw: number;
      cssGzip: number;
    };
    const baseline = JSON.parse(
      fs.readFileSync(path.resolve(__dirname, "..", "scripts", "bundle-baseline.json"), "utf8"),
    ) as { after: Entry[] };
    const i = baseline.after.findIndex((e) => e.feature === "cerebro-busca-significado");
    expect(i, "the entry exists").toBeGreaterThan(0);
    const entry = baseline.after[i]!;
    const before = baseline.after[i - 1]!;
    expect(before.feature).toBe("cerebro-rituais");
    expect([before.jsGzip, before.cssGzip]).toEqual([604_839, 83_496]);
    expect(entry.reason.length).toBeGreaterThan(40);
    for (const k of ["jsRaw", "jsGzip", "cssRaw", "cssGzip"] as const)
      expect(Number.isInteger(entry[k]) && entry[k] > 0, k).toBe(true);
    // the ceiling of the plan's Assumptions ("Teto de peso", AD-047 h): at most 617 127 B and 85 544 B
    expect(entry.jsGzip - before.jsGzip).toBeLessThanOrEqual(12_288);
    expect(entry.cssGzip - before.cssGzip).toBeLessThanOrEqual(2_048);
    expect(entry.jsGzip).toBeLessThanOrEqual(617_127);
    expect(entry.cssGzip).toBeLessThanOrEqual(85_544);
  });
});
