import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AppContext } from "../apps/api/src/context.js";
import { buildServer } from "../apps/api/src/server.js";
import { LOCAL_EMBEDDER_IDS } from "../contracts/src/settings.js";
import { MODEL_CATALOG, checkCatalog, hostAllowed } from "../core/src/models/catalog.js";
import { hopAllowed } from "../core/src/models/downloads.js";
import { TEST_PHRASE } from "../core/src/memory/embeddings.js";
import { embeddingsServer, type EmbeddingsServer } from "./helpers/buscaWorld.js";
import {
  GEMMA,
  QWEN,
  RERANKER,
  STUB_DIMS,
  localWorld,
  type LocalWorld,
  type LocalWorldOptions,
} from "./helpers/buscaStubs.js";
import { code, type Json } from "./helpers/memoriaWorld.js";

/**
 * .specs/features/cerebro-busca-significado, S4 (doors 3, 7 and 8): the two embedder routes and the download, against
 * the stub model host on 127.0.0.1 and the stub child (checks "Level honesty"): the plumbing is proven, no real model.
 */

const repoRoot = path.resolve(import.meta.dirname, "..");
const opened: LocalWorld[] = [];
const servers: EmbeddingsServer[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const w of opened.splice(0)) await w.close();
  for (const s of servers.splice(0)) await s.close();
});

async function world(opts: LocalWorldOptions = {}): Promise<LocalWorld> {
  const w = await localWorld("mordomo-busca-embedder-", opts);
  opened.push(w);
  return w;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const modelOf = (body: Json, id: string) => (body.models as Json[]).find((m) => m.id === id)!;
const exists = (file: string) => fs.existsSync(file);
const settingsBytes = (w: LocalWorld) => fs.readFileSync(path.join(w.home, "config", "settings.json"));

// ---------------------------------------------------------------------------------------------- C41, C42

describe("C41 the catalog through GET /api/memory/embedder", () => {
  it("C41 one entry per catalog entry in its order, each with exactly its keys and absent; active null with hash and the local model's id with local", async () => {
    const w = await world();
    const res = await w.embedder();
    expect(res.status).toBe(200);
    expect(Object.keys(res.body).sort()).toEqual(["active", "models", "platform"]);
    expect(res.body.platform).toEqual({ ok: true });
    expect(res.body.active).toBeNull();
    expect((res.body.models as Json[]).map((m) => m.id)).toEqual([GEMMA, QWEN, RERANKER]);
    for (const [i, entry] of w.catalog.entries()) {
      const model = (res.body.models as Json[])[i]!;
      const bytes = entry.files.reduce((sum, f) => sum + f.bytes, 0);
      expect(model).toEqual({
        id: entry.id,
        kind: entry.kind,
        name: entry.name,
        bytes,
        ...(entry.kind === "embedder" ? { dimensions: entry.dimensions } : {}),
        license: { name: entry.license.name, acceptRequired: entry.license.acceptRequired },
        state: "absent",
      });
      expect("progress" in model).toBe(false);
      expect("reason" in model).toBe(false);
      expect("dimensions" in model).toBe(entry.kind === "embedder");
    }
    // `active` is the id of local.model while the provider is local, on or off (G23)
    w.update((s) => {
      s.memory.embeddings = {
        ...s.memory.embeddings,
        enabled: false,
        provider: "local",
        local: { model: QWEN },
      };
    });
    expect((await w.embedder()).body.active).toBe(QWEN);
    w.localOn(GEMMA);
    expect((await w.embedder()).body.active).toBe(GEMMA);
    w.hashOn();
    expect((await w.embedder()).body.active).toBeNull();
  });
});

describe("C42 the catalog's literal shape", () => {
  const expected = [
    {
      id: "embeddinggemma-300m-q4",
      kind: "embedder",
      repo: "onnx-community/embeddinggemma-300m-ONNX",
      dimensions: 768,
      license: "Gemma",
      acceptRequired: true,
    },
    {
      id: "qwen3-embedding-0.6b-q4f16",
      kind: "embedder",
      repo: "onnx-community/Qwen3-Embedding-0.6B-ONNX",
      dimensions: 1024,
      license: "Apache-2.0",
      acceptRequired: false,
    },
    {
      id: "qwen3-reranker-0.6b-q4",
      kind: "reranker",
      repo: "onnx-community/Qwen3-Reranker-0.6B-ONNX",
      dimensions: undefined,
      license: "Apache-2.0",
      acceptRequired: false,
    },
  ];
  const policy = JSON.parse(fs.readFileSync(path.join(repoRoot, "legal", "network-policy.json"), "utf8")) as {
    hosts: Array<{ id: string; match: string[] }>;
  };
  const repository = policy.hosts.find((h) => h.id === "model-repository");

  it("C42 exactly three entries in this order, and the embedders are the ids the settings accept", () => {
    expect(MODEL_CATALOG.map((e) => e.id)).toEqual(expected.map((e) => e.id));
    expect(MODEL_CATALOG.filter((e) => e.kind === "embedder").map((e) => e.id)).toEqual([
      ...LOCAL_EMBEDDER_IDS,
    ]);
    expect(() => checkCatalog(MODEL_CATALOG)).not.toThrow();
  });

  it.each(expected.map((e, i) => [e.id, i] as const))(
    "C42 %s: kind, repo, dimensions, license, files, hosts, numbers and prefixes",
    (_id, i) => {
      const entry = MODEL_CATALOG[i]!;
      const want = expected[i]!;
      // kind and repo
      expect(entry.kind).toBe(want.kind);
      expect(entry.repo).toBe(want.repo);
      // dimensions (embedders only)
      expect(entry.dimensions).toBe(want.dimensions);
      // license
      expect(entry.license.name).toBe(want.license);
      expect(entry.license.acceptRequired).toBe(want.acceptRequired);
      // files: a path, bytes > 0 and a sha256 of 64 hex digits
      expect(entry.files.length).toBeGreaterThan(0);
      for (const file of entry.files) {
        expect(typeof file.path).toBe("string");
        expect(file.path.length).toBeGreaterThan(0);
        expect(file.bytes).toBeGreaterThan(0);
        expect(file.sha256).toMatch(/^[0-9a-f]{64}$/);
      }
      // hosts: each in the network policy's model-repository entry
      expect(repository, "legal/network-policy.json has a model-repository entry").toBeDefined();
      expect(entry.hosts.length).toBeGreaterThan(0);
      for (const host of entry.hosts) expect(repository!.match).toContain(host);
      // numbers of an embedder
      if (entry.kind === "embedder") {
        expect(entry.maxChars).toBeGreaterThan(0);
        expect(entry.minSimilarity).toBeGreaterThan(0);
        expect(entry.minSimilarity).toBeLessThan(1);
      }
      // prefixes: strings or absent
      for (const prefix of [entry.queryPrefix, entry.documentPrefix])
        expect(prefix === undefined || typeof prefix === "string").toBe(true);
    },
  );
});

// ---------------------------------------------------------------------------------------------- C43-C50

describe("C43 install against the stub host", () => {
  it("C43 200 downloading before the first byte, progress that never goes back, ready, byte-equal files; the GETs read absent, downloading, ready", async () => {
    const w = await world();
    const states: string[] = [modelOf((await w.embedder()).body, QWEN).state as string];
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    w.host.hold = () => gate;
    w.host.throttle = { chunk: 4096, delayMs: 5 };
    const res = await w.act({ action: "install", id: QWEN });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ state: "downloading" });
    // nothing was served yet: the answer came before the first byte
    expect(w.modelFiles().filter((f) => f.startsWith(`${QWEN}/`) && !f.endsWith("/"))).toEqual([]);
    const entry = w.catalog.find((e) => e.id === QWEN)!;
    const total = entry.files.reduce((sum, f) => sum + f.bytes, 0);
    let last = -1;
    const reads: Json[] = [];
    const first = modelOf((await w.embedder()).body, QWEN);
    reads.push(first);
    release();
    for (;;) {
      const model = modelOf((await w.embedder()).body, QWEN);
      reads.push(model);
      if (model.state !== "downloading") break;
      await sleep(3);
    }
    for (const model of reads) {
      if (model.state !== "downloading") continue;
      expect(model.progress.total).toBe(total);
      expect(model.progress.done).toBeGreaterThanOrEqual(last);
      last = model.progress.done;
    }
    expect(
      reads.some((m) => m.state === "downloading" && m.progress.done > 0 && m.progress.done < total),
    ).toBe(true);
    expect(reads.at(-1)!.state).toBe("ready");
    for (const m of reads) states.push(m.state as string);
    expect([...new Set(states)]).toEqual(["absent", "downloading", "ready"]);
    for (const file of entry.files) {
      const disk = fs.readFileSync(path.join(w.home, "models", QWEN, ...file.path.split("/")));
      expect(disk.equals(w.host.files.get(`/${QWEN}/${file.path}`)!)).toBe(true);
    }
  });
});

describe("C44 the license is accepted before anything is fetched", () => {
  it("C44 without acceptTerms and with false: 400 terms_not_accepted, 0 requests, no folder; an entry that asks nothing installs without it", async () => {
    const w = await world();
    for (const body of [
      { action: "install", id: GEMMA },
      { action: "install", id: GEMMA, acceptTerms: false },
    ]) {
      const res = await w.act(body);
      expect(code(res)).toEqual([400, "terms_not_accepted"]);
    }
    expect(w.host.requests).toEqual([]);
    expect(exists(path.join(w.home, "models", GEMMA))).toBe(false);
    const res = await w.act({ action: "install", id: QWEN });
    expect(res.status).toBe(200);
    expect((await w.settle(QWEN)).state).toBe("ready");
  });
});

describe("C45 a checksum mismatch", () => {
  it("C45 the file is deleted, failed with reason checksum, and the local provider reads model_missing", async () => {
    const w = await world();
    w.host.corrupt.add(`/${QWEN}/onnx/model.onnx`);
    expect((await w.act({ action: "install", id: QWEN })).status).toBe(200);
    const model = await w.settle(QWEN);
    expect(model.state).toBe("failed");
    expect(model.reason).toBe("checksum");
    expect(w.modelFiles().filter((f) => f.startsWith(`${QWEN}/`))).toEqual([]);
    w.localOn(QWEN);
    const status = await w.call("GET", "/api/memory/status");
    expect(status.body.semantic.blocked).toBe("model_missing");
    expect(status.body.semantic.provider).toBeNull();
  });
});

describe("C46 redirects stay inside the entry's hosts", () => {
  it("C46 a 302 to localhost (not in hosts) stops, deletes, reads host_not_allowed and the other server gets 0 requests; a 302 to 127.0.0.1 is followed", async () => {
    const w = await world();
    let other = 0;
    const elsewhere = http.createServer((_req, res) => (other++, res.end("x")));
    await new Promise<void>((resolve) => elsewhere.listen(0, "127.0.0.1", resolve));
    const port = (elsewhere.address() as { port: number }).port;
    try {
      w.host.redirect.set(`/${QWEN}/onnx/model.onnx`, `http://localhost:${port}/x`);
      await w.act({ action: "install", id: QWEN });
      const model = await w.settle(QWEN);
      expect(model.state).toBe("failed");
      expect(model.reason).toBe("host_not_allowed");
      expect(other).toBe(0);
      expect(w.modelFiles().filter((f) => f.startsWith(`${QWEN}/`))).toEqual([]);
      // the same host, another path: followed
      const bytes = w.host.files.get(`/${QWEN}/onnx/model.onnx`)!;
      w.host.files.set("/moved/model.onnx", bytes);
      w.host.redirect.set(`/${QWEN}/onnx/model.onnx`, `${w.host.origin}/moved/model.onnx`);
      await w.act({ action: "install", id: QWEN });
      expect((await w.settle(QWEN)).state).toBe("ready");
      expect(w.host.requests).toContain("/moved/model.onnx");
    } finally {
      await new Promise<void>((resolve) => elsewhere.close(() => resolve()));
    }
  });
});

describe("C46 a host pattern of the catalog at its own layer", () => {
  it("C46 *.cdn.hf.co admits a host under the domain and nothing else; an exact entry admits only itself", () => {
    const hosts = ["huggingface.co", "*.cdn.hf.co"];
    for (const ok of ["huggingface.co", "us.aws.cdn.hf.co", "us.gcp.cdn.hf.co", "HUGGINGFACE.CO"])
      expect(hostAllowed(hosts, ok), ok).toBe(true);
    for (const no of [
      "cdn.hf.co",
      "evilcdn.hf.co",
      "cdn.hf.co.evil.com",
      "huggingface.co.evil.com",
      "hf.co",
      "localhost",
    ])
      expect(hostAllowed(hosts, no), no).toBe(false);
  });
});

// ---------------------------------------------------------------------------------------------- C139, C142

/**
 * The stub Qwen entry with four files, the `.onnx` graph neither first nor last (door 3: "a soma SHA-256 de cada
 * arquivo"): `config.json`, `tokenizer.json`, `onnx/model.onnx` and its data file `onnx/model.onnx_data`.
 */
const FOUR = ["config.json", "tokenizer.json", "onnx/model.onnx", "onnx/model.onnx_data"] as const;
function fourFiles(w: LocalWorld): void {
  const entry = w.catalog.find((e) => e.id === QWEN)!;
  w.host.files.set(
    `/${QWEN}/tokenizer.json`,
    Buffer.from(JSON.stringify({ stub: "tokenizer", v: [1, 2, 3] })),
  );
  w.host.files.set(`/${QWEN}/onnx/model.onnx_data`, Buffer.from("stub weights ".repeat(2048)));
  entry.files = FOUR.map((p) => {
    const bytes = w.host.files.get(`/${QWEN}/${p}`)!;
    return { path: p, bytes: bytes.length, sha256: crypto.createHash("sha256").update(bytes).digest("hex") };
  });
}

/** The install ended `failed` with `checksum`, nothing of the entry is left on disk and the model is not used. */
async function failedChecksum(w: LocalWorld): Promise<void> {
  expect((await w.act({ action: "install", id: QWEN })).status).toBe(200);
  const model = await w.settle(QWEN);
  expect(model.state).toBe("failed");
  expect(model.reason).toBe("checksum");
  expect(w.modelFiles().filter((f) => f.startsWith(`${QWEN}/`))).toEqual([]);
  expect(exists(path.join(w.home, "models", QWEN))).toBe(false);
  w.localOn(QWEN);
  const status = await w.call("GET", "/api/memory/status");
  expect(status.body.semantic.blocked).toBe("model_missing");
  expect(status.body.semantic.provider).toBeNull();
}

describe("C139 the size and the SHA-256 of every file of an entry", () => {
  it("C139 the four-file entry untouched installs ready, every file on disk byte-exact", async () => {
    const w = await world();
    fourFiles(w);
    expect((await w.install(QWEN)).state).toBe("ready");
    for (const p of FOUR) {
      const disk = fs.readFileSync(path.join(w.home, "models", QWEN, ...p.split("/")));
      expect(disk.equals(w.host.files.get(`/${QWEN}/${p}`)!), p).toBe(true);
    }
  });

  it.each(FOUR)(
    "C139 %s served with one byte changed: failed, checksum, every file deleted, model_missing",
    async (p) => {
      const w = await world();
      fourFiles(w);
      w.host.corrupt.add(`/${QWEN}/${p}`);
      await failedChecksum(w);
      expect(w.host.requests).toContain(`/${QWEN}/${p}`);
    },
  );

  it.each(FOUR)(
    "C139 %s one byte shorter than the catalog's size, its SHA-256 the served bytes': failed, checksum, every file deleted, model_missing",
    async (p) => {
      const w = await world();
      fourFiles(w);
      const file = w.catalog.find((e) => e.id === QWEN)!.files.find((f) => f.path === p)!;
      const served = w.host.files.get(`/${QWEN}/${p}`)!.subarray(0, file.bytes - 1);
      w.host.files.set(`/${QWEN}/${p}`, served);
      file.sha256 = crypto.createHash("sha256").update(served).digest("hex");
      await failedChecksum(w);
      expect(w.host.requests).toContain(`/${QWEN}/${p}`);
    },
  );

  it("C139 a file one byte longer than the catalog's size, its SHA-256 the served bytes': failed, checksum", async () => {
    const w = await world();
    fourFiles(w);
    const file = w.catalog.find((e) => e.id === QWEN)!.files.find((f) => f.path === "tokenizer.json")!;
    const served = Buffer.concat([w.host.files.get(`/${QWEN}/tokenizer.json`)!, Buffer.from(" ")]);
    w.host.files.set(`/${QWEN}/tokenizer.json`, served);
    file.sha256 = crypto.createHash("sha256").update(served).digest("hex");
    await failedChecksum(w);
  });
});

describe("C142 a catalog host is reached over https only", () => {
  it("C142 a 302 to http:// on a host of the entry that is not this machine stops before any request: host_not_allowed; another scheme too; https on a host of the entry passes the guard", async () => {
    const w = await world();
    const entry = w.catalog.find((e) => e.id === QWEN)!;
    // 192.0.2.1 is TEST-NET-1: never routed, so a request to it would hang rather than answer
    entry.hosts = ["127.0.0.1", "192.0.2.1"];
    for (const target of ["http://192.0.2.1/x", "ftp://127.0.0.1/x"]) {
      w.host.redirect.set(`/${QWEN}/onnx/model.onnx`, target);
      await w.act({ action: "install", id: QWEN });
      const model = await w.settle(QWEN);
      expect(model.state, target).toBe("failed");
      expect(model.reason, target).toBe("host_not_allowed");
      expect(
        w.modelFiles().filter((f) => f.startsWith(`${QWEN}/`)),
        target,
      ).toEqual([]);
    }
    // the same rule lets https through to a host of the entry: the stub speaks plain http, so the TLS request fails
    // as a network failure, not as host_not_allowed
    w.host.redirect.set(`/${QWEN}/onnx/model.onnx`, `https://127.0.0.1:${w.host.port}/x`);
    await w.act({ action: "install", id: QWEN });
    const model = await w.settle(QWEN);
    expect(model.state).toBe("failed");
    expect(model.reason).toMatch(/^network: /);
  });
});

describe("C144 a catalog host is reached on the default https port only", () => {
  it("C144 at the guard's own layer: https on a host of the entry with no port or 443 passes; any other port, plain http and another scheme do not; a host on this machine keeps any port", () => {
    const hosts = ["huggingface.co", "*.cdn.hf.co", "127.0.0.1"];
    const ok = [
      "https://huggingface.co/x",
      "https://huggingface.co:443/x",
      "https://us.aws.cdn.hf.co/x",
      "https://us.gcp.cdn.hf.co:443/x",
    ];
    for (const url of ok) expect(hopAllowed(hosts, new URL(url)), url).toBe(true);
    const no = [
      "https://huggingface.co:8443/x",
      "https://huggingface.co:444/x",
      "https://huggingface.co:80/x",
      "https://us.aws.cdn.hf.co:8080/x",
      "http://huggingface.co/x",
      "http://huggingface.co:443/x",
      "ftp://huggingface.co/x",
      "https://evilcdn.hf.co/x",
    ];
    for (const url of no) expect(hopAllowed(hosts, new URL(url)), url).toBe(false);
    // this machine: the stub of the tests and a local server keep any port, over http or https
    for (const url of ["http://127.0.0.1:41234/x", "https://127.0.0.1:41234/x", "http://127.0.0.1/x"])
      expect(hopAllowed(hosts, new URL(url)), url).toBe(true);
    expect(hopAllowed(hosts, new URL("ftp://127.0.0.1/x"))).toBe(false);
  });

  it("C144 through the route: a 302 to https on a host of the entry at port 8443 stops before any request, host_not_allowed, no file left", async () => {
    const w = await world();
    const entry = w.catalog.find((e) => e.id === QWEN)!;
    // 192.0.2.1 is TEST-NET-1: never routed, so a request to it would hang; the guard must stop first
    entry.hosts = ["127.0.0.1", "192.0.2.1"];
    w.host.redirect.set(`/${QWEN}/onnx/model.onnx`, "https://192.0.2.1:8443/x");
    await w.act({ action: "install", id: QWEN });
    const model = await w.settle(QWEN);
    expect(model.state).toBe("failed");
    expect(model.reason).toBe("host_not_allowed");
    expect(w.modelFiles().filter((f) => f.startsWith(`${QWEN}/`))).toEqual([]);
  });
});

describe("C47 a network failure", () => {
  it("C47 a cut mid-body deletes the partial files and reads network: <message>; a later install starts again and ends ready", async () => {
    const w = await world();
    w.host.cut.add(`/${QWEN}/onnx/model.onnx`);
    await w.act({ action: "install", id: QWEN });
    const model = await w.settle(QWEN);
    expect(model.state).toBe("failed");
    expect(model.reason).toMatch(/^network: \S.*/);
    expect(w.modelFiles().filter((f) => f.startsWith(`${QWEN}/`))).toEqual([]);
    w.host.cut.clear();
    const before = w.host.requests.length;
    await w.act({ action: "install", id: QWEN });
    expect((await w.settle(QWEN)).state).toBe("ready");
    // from nothing: every file asked for again
    expect(w.host.requests.slice(before)).toEqual([`/${QWEN}/config.json`, `/${QWEN}/onnx/model.onnx`]);
  });
});

describe("C48 one download at a time and the refused bodies", () => {
  it("C48 another id and the same id while one downloads answer 409 download_in_progress", async () => {
    const w = await world();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    w.host.hold = () => gate;
    expect((await w.act({ action: "install", id: QWEN })).status).toBe(200);
    // the download's first request has reached the host and waits there
    for (let i = 0; i < 200 && w.host.requests.length === 0; i++) await sleep(5);
    const requests = w.host.requests.length;
    expect(requests).toBe(1);
    expect(code(await w.act({ action: "install", id: RERANKER }))).toEqual([409, "download_in_progress"]);
    expect(code(await w.act({ action: "install", id: QWEN }))).toEqual([409, "download_in_progress"]);
    expect(w.host.requests.length).toBe(requests);
    expect(exists(path.join(w.home, "models", RERANKER))).toBe(false);
    release();
    expect((await w.settle(QWEN)).state).toBe("ready");
  });

  it("C48 two installs sent together: one 200 and one 409 download_in_progress", async () => {
    const w = await world();
    const [a, b] = await Promise.all([
      w.act({ action: "install", id: QWEN }),
      w.act({ action: "install", id: RERANKER }),
    ]);
    expect([code(a), code(b)].map(([status, c]) => `${status} ${c ?? ""}`).sort()).toEqual([
      "200 ",
      "409 download_in_progress",
    ]);
    await w.settle(QWEN);
    await w.settle(RERANKER);
  });

  it("C48 unknown ids, no id, an unknown action and a bad acceptTerms are refused with no request and no folder", async () => {
    const w = await world();
    const cases: Array<[Json, [number, string]]> = [
      [{ action: "install", id: "nao-existe" }, [404, "model_not_found"]],
      [{ action: "install", id: "../x" }, [404, "model_not_found"]],
      [{ action: "install", id: "..", acceptTerms: true }, [404, "model_not_found"]],
      [{ action: "install", id: "/tmp/x", acceptTerms: true }, [404, "model_not_found"]],
      [{ action: "install", id: "..\\x", acceptTerms: true }, [404, "model_not_found"]],
      [{ action: "install", id: `${QWEN}/../../x` }, [404, "model_not_found"]],
      [{ action: "install" }, [400, "validation"]],
      [{ action: "delete", id: QWEN }, [400, "validation"]],
      [{ action: "install", id: GEMMA, acceptTerms: "yes" }, [400, "validation"]],
    ];
    for (const [body, want] of cases) expect(code(await w.act(body)), JSON.stringify(body)).toEqual(want);
    expect(w.host.requests).toEqual([]);
    expect(exists(path.join(w.home, "models"))).toBe(false);
    expect(fs.existsSync(path.join(path.dirname(w.home), "x"))).toBe(false);
  });
});

describe("C49 cancel", () => {
  it("C49 during a download: 200, the server sees the abort, no file, absent; with nothing running: 200 and the state as it is; then install again ends ready", async () => {
    const w = await world();
    w.host.throttle = { chunk: 1024, delayMs: 20 };
    await w.act({ action: "install", id: QWEN });
    for (;;) {
      const m = modelOf((await w.embedder()).body, QWEN);
      if (m.progress?.done > 0) break;
      await sleep(5);
    }
    const res = await w.act({ action: "cancel" });
    expect(res.status).toBe(200);
    expect(res.body.state).toBe("absent");
    for (let i = 0; i < 100 && w.host.aborted === 0; i++) await sleep(10);
    expect(w.host.aborted).toBeGreaterThan(0);
    expect(w.modelFiles().filter((f) => f.startsWith(`${QWEN}/`))).toEqual([]);
    expect(modelOf((await w.embedder()).body, QWEN).state).toBe("absent");
    // nothing running: the state as it is (G22)
    w.host.throttle = null;
    await w.install(RERANKER);
    const idle = await w.act({ action: "cancel", id: RERANKER });
    expect(idle.status).toBe(200);
    expect(idle.body.state).toBe("ready");
    expect(modelOf((await w.embedder()).body, RERANKER).state).toBe("ready");
    const nothing = await w.act({ action: "cancel" });
    expect(nothing.status).toBe(200);
    expect(nothing.body.state).toBe("absent");
    // and again
    expect((await w.install(QWEN)).state).toBe("ready");
  });
});

describe("C50 remove", () => {
  it("C50 a ready model that is not active goes; the active one is 409 model_in_use and untouched; an absent one answers absent", async () => {
    const w = await world();
    await w.install(QWEN);
    await w.install(GEMMA);
    const res = await w.act({ action: "remove", id: QWEN });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ state: "absent" });
    expect(exists(path.join(w.home, "models", QWEN))).toBe(false);
    expect(modelOf((await w.embedder()).body, QWEN).state).toBe("absent");
    // the active embedder: provider local and local.model its id, even with the search off (G23)
    w.update((s) => {
      s.memory.embeddings = {
        ...s.memory.embeddings,
        enabled: false,
        provider: "local",
        local: { model: GEMMA },
      };
    });
    const dir = path.join(w.home, "models", GEMMA);
    const snapshot = () =>
      w
        .modelFiles()
        .filter((f) => f.startsWith(`${GEMMA}/`))
        .map((f) => [
          f,
          crypto
            .createHash("sha256")
            .update(fs.readFileSync(path.join(w.home, "models", f)))
            .digest("hex"),
        ]);
    const before = snapshot();
    expect(code(await w.act({ action: "remove", id: GEMMA }))).toEqual([409, "model_in_use"]);
    expect(exists(dir)).toBe(true);
    expect(snapshot()).toEqual(before);
    const absent = await w.act({ action: "remove", id: QWEN });
    expect(absent.status).toBe(200);
    expect(absent.body).toEqual({ state: "absent" });
  });
});

// ---------------------------------------------------------------------------------------------- C51

describe("C51 a platform without the runtime", () => {
  it.each([
    ["darwin/x64", { platform: "darwin" as NodeJS.Platform, arch: "x64" }],
    [
      "linux/x64 without the runtime package",
      { platform: "linux" as NodeJS.Platform, arch: "x64", runtime: false },
    ],
  ])(
    "C51 %s reads platform_unsupported and install answers 409 local_unavailable with nothing fetched",
    async (_name, opts) => {
      const w = await world(opts);
      expect((await w.embedder()).body.platform).toEqual({ ok: false, reason: "platform_unsupported" });
      expect(code(await w.act({ action: "install", id: QWEN }))).toEqual([409, "local_unavailable"]);
      expect(code(await w.act({ action: "install", id: GEMMA, acceptTerms: true }))).toEqual([
        409,
        "local_unavailable",
      ]);
      expect(w.host.requests).toEqual([]);
      expect(exists(path.join(w.home, "models"))).toBe(false);
    },
  );

  it("C51 linux/x64 with the runtime reads platform ok", async () => {
    const w = await world({ platform: "linux", arch: "x64", runtime: true });
    expect((await w.embedder()).body.platform).toEqual({ ok: true });
  });
});

// ---------------------------------------------------------------------------------------------- C57

describe("C57 action test", () => {
  const httpOn = (w: LocalWorld, url: string, dimensions = 8) =>
    w.update((s) => {
      s.memory.embeddings = {
        ...s.memory.embeddings,
        enabled: false,
        provider: "http",
        endpoint: url,
        model: "m",
        dimensions,
      };
    });

  it("C57 http against a loopback server of 8 dimensions: ok, 8, ms, and exactly one request of the fixed phrase", async () => {
    const w = await world();
    const server = await embeddingsServer(8);
    servers.push(server);
    httpOn(w, server.url);
    const res = await w.act({ action: "test" });
    expect(res.status).toBe(200);
    expect(res.body.test).toEqual({ ok: true, dimensions: 8, ms: expect.any(Number) });
    expect(res.body.test.ms).toBeGreaterThanOrEqual(0);
    expect(server.bodies).toEqual([{ model: "m", input: [TEST_PHRASE] }]);
  });

  it("C57 timeout, status, dimension, malformed and network each answer ok false with their kind", async () => {
    const w = await world();
    const answers: Record<string, (res: http.ServerResponse) => void> = {
      timeout: () => undefined,
      status: (res) => res.writeHead(500).end("{}"),
      dimension: (res) =>
        res
          .writeHead(200, { "content-type": "application/json" })
          .end(JSON.stringify({ data: [{ embedding: Array(9).fill(1) }] })),
      malformed: (res) => res.writeHead(200).end("not json"),
    };
    let answer: (res: http.ServerResponse) => void = () => undefined;
    const server = http.createServer((req, res) => req.resume().on("end", () => answer(res)));
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const url = `http://127.0.0.1:${(server.address() as { port: number }).port}/v1/embeddings`;
    try {
      const realTimeout = AbortSignal.timeout.bind(AbortSignal);
      vi.spyOn(AbortSignal, "timeout").mockImplementation(() => realTimeout(150));
      for (const [kind, fn] of Object.entries(answers)) {
        answer = fn;
        httpOn(w, url);
        const res = await w.act({ action: "test" });
        expect(res.status, kind).toBe(200);
        expect(res.body.test, kind).toEqual({ ok: false, kind });
      }
      // network: a closed port
      const closed = http.createServer();
      await new Promise<void>((resolve) => closed.listen(0, "127.0.0.1", resolve));
      const dead = `http://127.0.0.1:${(closed.address() as { port: number }).port}/v1/embeddings`;
      await new Promise<void>((resolve) => closed.close(() => resolve()));
      httpOn(w, dead);
      const res = await w.act({ action: "test" });
      expect(res.body.test).toEqual({ ok: false, kind: "network" });
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it("C57 the stub local model answers its dimensions, a crashing stub answers local_crashed", async () => {
    const w = await world();
    await w.install(QWEN);
    w.update((s) => {
      s.memory.embeddings = {
        ...s.memory.embeddings,
        enabled: false,
        provider: "local",
        local: { model: QWEN },
      };
    });
    const res = await w.act({ action: "test" });
    expect(res.status).toBe(200);
    expect(res.body.test).toEqual({ ok: true, dimensions: STUB_DIMS.qwen, ms: expect.any(Number) });
    expect(w.child.embeds().map((e) => e.texts)).toEqual([[TEST_PHRASE]]);
    w.child.control({ crash: "every" });
    const crashed = await w.act({ action: "test" });
    expect(crashed.status).toBe(200);
    expect(crashed.body.test).toEqual({ ok: false, kind: "local_crashed" });
  });

  it("C57 a provider the policy blocks answers 400 validation naming the reason and sends nothing; hash answers 256", async () => {
    const w = await world();
    const server = await embeddingsServer(8);
    servers.push(server);
    httpOn(w, "http://example.com/v1/embeddings");
    const res = await w.act({ action: "test" });
    expect(code(res)).toEqual([400, "validation"]);
    expect(res.body.error.message).toContain("the endpoint is not https and not on this machine");
    expect(server.bodies).toEqual([]);
    w.update((s) => {
      s.memory.embeddings = { ...s.memory.embeddings, enabled: false, provider: "hash" };
    });
    const hash = await w.act({ action: "test" });
    expect(hash.status).toBe(200);
    expect(hash.body.test).toEqual({ ok: true, dimensions: 256, ms: expect.any(Number) });
  });
});

// ---------------------------------------------------------------------------------------------- C58, C59

describe("C58 blocked reads and auto as text", () => {
  it.each([
    ["model_missing", {}],
    ["platform_unsupported", { platform: "darwin" as NodeJS.Platform, arch: "x64" }],
  ])(
    "C58 %s: the status reads it with provider null, auto answers what text answers and semantic 409",
    async (reason, opts) => {
      const w = await world(opts);
      w.note("devolucao", "# Devolução\n\nO prazo de devolução é de 30 dias.\n");
      w.note("outra", "# Outra\n\nNada a ver com prazos.\n");
      w.localOn(QWEN);
      await w.index();
      const status = await w.call("GET", "/api/memory/status");
      expect(status.body.semantic.blocked).toBe(reason);
      expect(status.body.semantic.provider).toBeNull();
      const auto = await w.call("GET", "/api/memory/search?q=devolu%C3%A7%C3%A3o&mode=auto");
      const text = await w.call("GET", "/api/memory/search?q=devolu%C3%A7%C3%A3o&mode=text");
      expect(auto.status).toBe(200);
      expect(auto.body).toEqual(text.body);
      expect((text.body as unknown as Json[]).length).toBeGreaterThan(0);
      expect(code(await w.call("GET", "/api/memory/search?q=devolu%C3%A7%C3%A3o&mode=semantic"))).toEqual([
        409,
        "semantic_disabled",
      ]);
      expect(w.child.pids()).toEqual([]);
    },
  );
});

describe("C59 the settings of the local model", () => {
  it("C59 a PUT with an id outside the catalog is 400 and keeps the file; a catalog id is read back", async () => {
    const w = await world();
    const before = settingsBytes(w);
    const embeddings = { enabled: true, provider: "local", local: { model: "nao-existe" } };
    const bad = await w.call("PUT", "/api/settings", { memory: { embeddings } });
    expect(code(bad)).toEqual([400, "validation"]);
    expect(settingsBytes(w).equals(before)).toBe(true);
    for (const id of ["../x", "/tmp/x", "..", "..\\x"]) {
      const res = await w.call("PUT", "/api/settings", {
        memory: { embeddings: { ...embeddings, local: { model: id } } },
      });
      expect(code(res), id).toEqual([400, "validation"]);
      expect(settingsBytes(w).equals(before)).toBe(true);
    }
    const ok = await w.call("PUT", "/api/settings", {
      memory: { embeddings: { ...embeddings, local: { model: GEMMA } } },
    });
    expect(ok.status).toBe(200);
    const read = await w.call("GET", "/api/settings");
    expect(read.body.memory.embeddings.local).toEqual({ model: GEMMA });
    expect(read.body.memory.embeddings.provider).toBe("local");
  });

  it("C59 a hand-edited file with an id outside the catalog reads local.model absent, keeps the rest, and local reads model_missing", async () => {
    const w = await world();
    const file = path.join(w.home, "config", "settings.json");
    const doc = JSON.parse(fs.readFileSync(file, "utf8")) as Json;
    doc.memory = {
      ...(doc.memory ?? {}),
      embeddings: { enabled: true, provider: "local", model: "kept", local: { model: "nao-existe" } },
    };
    fs.writeFileSync(file, JSON.stringify(doc));
    const read = await w.call("GET", "/api/settings");
    expect(read.body.memory.embeddings.local?.model).toBeUndefined();
    expect(read.body.memory.embeddings).toMatchObject({ enabled: true, provider: "local", model: "kept" });
    const status = await w.call("GET", "/api/memory/status");
    expect(status.body.semantic.blocked).toBe("model_missing");
  });

  it("C59 a fourth provider is 400 through PUT and reads hash, off from a hand-edited file", async () => {
    const w = await world();
    const before = settingsBytes(w);
    const res = await w.call("PUT", "/api/settings", {
      memory: { embeddings: { enabled: true, provider: "gemma" } },
    });
    expect(code(res)).toEqual([400, "validation"]);
    expect(settingsBytes(w).equals(before)).toBe(true);
    const file = path.join(w.home, "config", "settings.json");
    const doc = JSON.parse(fs.readFileSync(file, "utf8")) as Json;
    doc.memory = { ...(doc.memory ?? {}), embeddings: { enabled: true, provider: "gemma" } };
    fs.writeFileSync(file, JSON.stringify(doc));
    const read = await w.call("GET", "/api/settings");
    expect(read.body.memory.embeddings).toMatchObject({ provider: "hash", enabled: false });
  });
});

// ---------------------------------------------------------------------------------------------- C63

describe("C63 the status of the local model", () => {
  it("C63 ready and active: model is its id and local is ready with the platform; with hash, model null and no local key", async () => {
    const w = await world();
    await w.install(QWEN);
    w.localOn(QWEN);
    const local = (await w.call("GET", "/api/memory/status")).body.semantic;
    expect(local.model).toBe(QWEN);
    expect(local.local).toEqual({ state: "ready", platform: { ok: true } });
    w.hashOn();
    const hash = (await w.call("GET", "/api/memory/status")).body.semantic;
    expect(hash.model).toBeNull();
    expect("local" in hash).toBe(false);
  });
});

// ---------------------------------------------------------------------------------------------- C64, C65

describe("C64 installs and passes together", () => {
  it("C64 an install during a hash pass ends ready and the pass finishes with its rows", async () => {
    const w = await world();
    for (let i = 0; i < 30; i++) w.note(`n${i}`, `# Nota ${i}\n\nTexto da nota ${i} sobre prazos.\n`);
    w.hashOn();
    w.host.throttle = { chunk: 2048, delayMs: 2 };
    const finished: unknown[] = [];
    const off = w.ctx.events.subscribe((e) => e.type === "index.finished" && finished.push(e));
    const pass = w.ctx.indexer.indexAllAsync();
    expect((await w.act({ action: "install", id: QWEN })).status).toBe(200);
    await pass;
    expect((await w.settle(QWEN)).state).toBe("ready");
    off();
    expect(finished.length).toBeGreaterThanOrEqual(1);
    expect(w.allRows().length).toBe(30);
  });

  it("C64 remove of the active local model while a pass runs answers 409 model_in_use", async () => {
    const w = await world();
    await w.install(QWEN);
    for (let i = 0; i < 20; i++) w.note(`n${i}`, `# Nota ${i}\n\nTexto ${i}.\n`);
    w.localOn(QWEN);
    w.child.control({ delayMs: 50 });
    const pass = w.ctx.indexer.indexAllAsync();
    for (let i = 0; i < 200 && w.child.embeds().length === 0; i++) await sleep(5);
    expect(code(await w.act({ action: "remove", id: QWEN }))).toEqual([409, "model_in_use"]);
    await pass;
    expect(exists(path.join(w.home, "models", QWEN))).toBe(true);
  });

  it("C64 a cancel sent while the install's first response is in flight leaves absent and no file", async () => {
    const w = await world();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    w.host.hold = () => gate;
    await w.act({ action: "install", id: QWEN });
    const cancel = w.act({ action: "cancel" });
    await sleep(20);
    release();
    expect((await cancel).status).toBe(200);
    expect(modelOf((await w.embedder()).body, QWEN).state).toBe("absent");
    expect(w.modelFiles().filter((f) => f.startsWith(`${QWEN}/`))).toEqual([]);
  });
});

describe("C65 the model's state across a restart", () => {
  it("C65 a ready model reads ready in a new context, a failed one reads absent, a truncated file reads absent", async () => {
    const w = await world();
    await w.install(QWEN);
    w.host.corrupt.add(`/${RERANKER}/onnx/model.onnx`);
    await w.act({ action: "install", id: RERANKER });
    expect((await w.settle(RERANKER)).state).toBe("failed");
    // a new AppContext over the same home, given the same catalog and child
    const ctx = new AppContext(w.home, { localModels: w.options });
    const app = await buildServer(ctx);
    try {
      const read = async () => {
        const res = await app.inject({
          method: "GET",
          url: "/api/memory/embedder",
          headers: { "x-mordomo-token": ctx.token() },
        });
        return res.json() as Json;
      };
      const body = await read();
      expect(modelOf(body, QWEN).state).toBe("ready");
      expect(modelOf(body, RERANKER).state).toBe("absent");
      // every file with its catalog bytes, and the record of the install
      const entry = w.catalog.find((e) => e.id === QWEN)!;
      for (const file of entry.files)
        expect(fs.statSync(path.join(w.home, "models", QWEN, file.path)).size).toBe(file.bytes);
      expect(exists(path.join(w.home, "models", QWEN, ".verified.json"))).toBe(true);
      // a file truncated by hand
      const model = path.join(w.home, "models", QWEN, "onnx", "model.onnx");
      fs.truncateSync(model, 100);
      expect(modelOf(await read(), QWEN).state).toBe("absent");
    } finally {
      await app.close();
      ctx.close();
    }
  });
});
