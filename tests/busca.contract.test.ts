import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { SETTINGS_FAIL_CLOSED } from "../core/src/config/failClosed.js";
import { SettingsStore } from "../core/src/config/store.js";
import { EventBus } from "../core/src/events.js";
import { MODEL_CATALOG } from "../core/src/models/catalog.js";
import { ensureDirs, resolvePaths } from "../core/src/paths.js";
import { makeTempHome } from "./helpers.js";

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
