import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import type { ModelEntry } from "../../core/src/models/catalog.js";
import type { LocalModelsOptions } from "../../core/src/models/localModels.js";
import { buscaWorld, type BuscaWorld, type Json } from "./buscaWorld.js";

/**
 * The stubs of S4 (.specs/features/cerebro-busca-significado, checks "Level honesty"): a model host on 127.0.0.1 the test
 * controls, a catalog whose entries live there, and a child process that speaks the real child's messages with a table
 * of vectors. None of them proves anything about a real model.
 */

// ------------------------------------------------------------------------------------------------ the host

export interface StubHost {
  port: number;
  /** `http://127.0.0.1:<port>` */
  origin: string;
  /** Every path requested, in order. */
  requests: string[];
  /** Responses whose connection closed before their last byte was sent. */
  aborted: number;
  /** What each path serves. */
  files: Map<string, Buffer>;
  /** Paths served with their first byte changed. */
  corrupt: Set<string>;
  /** A path answered `302` to this location. */
  redirect: Map<string, string>;
  /** Paths whose connection is cut after half the body. */
  cut: Set<string>;
  /** Bytes per write and the pause between writes (null: all at once). */
  throttle: { chunk: number; delayMs: number } | null;
  /** Awaited before a response starts (undefined: at once). */
  hold: (path: string) => Promise<void> | undefined;
  close: () => Promise<void>;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export async function stubHost(): Promise<StubHost> {
  const host: StubHost = {
    port: 0,
    origin: "",
    requests: [],
    aborted: 0,
    files: new Map(),
    corrupt: new Set(),
    redirect: new Map(),
    cut: new Set(),
    throttle: null,
    hold: () => undefined,
    close: async () => undefined,
  };
  const server = http.createServer(async (req, res) => {
    const at = new URL(req.url ?? "/", "http://127.0.0.1").pathname;
    host.requests.push(at);
    await host.hold(at);
    const location = host.redirect.get(at);
    if (location) {
      res.writeHead(302, { location }).end();
      return;
    }
    const body = host.files.get(at);
    if (!body) {
      res.writeHead(404).end();
      return;
    }
    let sent = Buffer.from(body);
    if (host.corrupt.has(at)) sent[0] = sent[0]! ^ 0xff;
    let finished = false;
    res.on("close", () => {
      if (!finished) host.aborted++;
    });
    res.writeHead(200, { "content-type": "application/octet-stream", "content-length": String(sent.length) });
    if (host.cut.has(at)) {
      res.write(sent.subarray(0, Math.floor(sent.length / 2)), () => res.socket?.destroy());
      return;
    }
    const step = host.throttle?.chunk ?? sent.length;
    for (let from = 0; from < sent.length; from += step) {
      if (res.destroyed) return;
      res.write(sent.subarray(from, from + step));
      if (host.throttle) await sleep(host.throttle.delayMs);
    }
    finished = true;
    res.end();
    sent = Buffer.alloc(0);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  host.port = (server.address() as { port: number }).port;
  host.origin = `http://127.0.0.1:${host.port}`;
  host.close = () =>
    new Promise<void>((resolve) => (server.closeAllConnections(), server.close(() => resolve())));
  return host;
}

// ------------------------------------------------------------------------------------------------ the catalog

/** Bytes that are the same on every run (a seed, a length). */
export function stubBytes(seed: string, length: number): Buffer {
  const out = Buffer.alloc(length);
  let block = crypto.createHash("sha256").update(seed).digest();
  for (let i = 0; i < length; i++) {
    if (i % 32 === 0 && i > 0) block = crypto.createHash("sha256").update(block).digest();
    out[i] = block[i % 32]!;
  }
  return out;
}

const sha = (bytes: Buffer) => crypto.createHash("sha256").update(bytes).digest("hex");

/** The stub embedders' lengths: small, so a test can write a vector by hand. */
export const STUB_DIMS = { gemma: 8, qwen: 6 } as const;
export const GEMMA = "embeddinggemma-300m-q4";
export const QWEN = "qwen3-embedding-0.6b-q4f16";
export const RERANKER = "qwen3-reranker-0.6b-q4";

/**
 * Three entries with the real catalog's ids (the settings accept only those) whose files live on `host`: the Gemma one
 * asks for its license and has the prefixes `Q: ` and `D: `; the Qwen embedder asks for nothing and has no prefix; the
 * reranker. Each has a small `config.json` and a 48 KiB `onnx/model.onnx`.
 */
export function stubCatalog(host: StubHost, sizes: { model?: number } = {}): ModelEntry[] {
  const files = (id: string) => {
    const made = [
      { path: "config.json", bytes: Buffer.from(JSON.stringify({ stub: id })) },
      { path: "onnx/model.onnx", bytes: stubBytes(id, sizes.model ?? 48 * 1024) },
    ];
    for (const file of made) host.files.set(`/${id}/${file.path}`, file.bytes);
    return made.map((file) => ({ path: file.path, bytes: file.bytes.length, sha256: sha(file.bytes) }));
  };
  const source = (id: string) => `${host.origin}/${id}/`;
  return [
    {
      id: GEMMA,
      kind: "embedder",
      name: "Stub Gemma",
      repo: "stub/gemma",
      dtype: "q4",
      source: source(GEMMA),
      files: files(GEMMA),
      hosts: ["127.0.0.1"],
      dimensions: STUB_DIMS.gemma,
      maxChars: 2000,
      minSimilarity: 0.2,
      pooling: "mean",
      license: { name: "Gemma", url: "https://example.invalid/gemma", acceptRequired: true },
      queryPrefix: "Q: ",
      documentPrefix: "D: ",
    },
    {
      id: QWEN,
      kind: "embedder",
      name: "Stub Qwen",
      repo: "stub/qwen",
      dtype: "q4f16",
      source: source(QWEN),
      files: files(QWEN),
      hosts: ["127.0.0.1"],
      dimensions: STUB_DIMS.qwen,
      maxChars: 2000,
      minSimilarity: 0.2,
      pooling: "last_token",
      license: { name: "Apache-2.0", url: "https://example.invalid/apache", acceptRequired: false },
    },
    {
      id: RERANKER,
      kind: "reranker",
      name: "Stub Reranker",
      repo: "stub/reranker",
      dtype: "q4",
      source: source(RERANKER),
      files: files(RERANKER),
      hosts: ["127.0.0.1"],
      license: { name: "Apache-2.0", url: "https://example.invalid/apache", acceptRequired: false },
    },
  ];
}

// ------------------------------------------------------------------------------------------------ the child

export interface StubChild {
  /** The path given to the assembly, as the real child's is. */
  entry: string;
  dir: string;
  /** Replace the control table (`stubChild.mjs`). */
  control: (control: Record<string, unknown>) => void;
  /** Every message the children received, with the pid that received it. */
  log: () => Array<Json & { pid: number; t: string }>;
  /** The pids of the children started, in order. */
  pids: () => number[];
  /** The `embed` messages, in order. */
  embeds: () => Array<{ pid: number; texts: string[]; model: Json }>;
  cleanup: () => void;
}

const STUB_MAIN = path.join(import.meta.dirname, "stubChild.mjs");

export function stubChild(): StubChild {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "mordomo-stub-child-")));
  const entry = path.join(dir, "child.mjs");
  fs.writeFileSync(
    entry,
    `import { run } from ${JSON.stringify(pathToFileURL(STUB_MAIN).href)};\nrun(${JSON.stringify(dir)});\n`,
  );
  const lines = (file: string) => {
    try {
      return fs.readFileSync(path.join(dir, file), "utf8").split("\n").filter(Boolean);
    } catch {
      return [];
    }
  };
  const child: StubChild = {
    entry,
    dir,
    control: (control) => fs.writeFileSync(path.join(dir, "control.json"), JSON.stringify(control)),
    log: () => lines("log.jsonl").map((line) => JSON.parse(line) as Json & { pid: number; t: string }),
    pids: () => lines("pids").map(Number),
    embeds: () =>
      child
        .log()
        .filter((m) => m.t === "embed")
        .map((m) => ({ pid: m.pid, texts: m.texts as string[], model: m.model as Json })),
    cleanup: () => fs.rmSync(dir, { recursive: true, force: true }),
  };
  return child;
}

// ------------------------------------------------------------------------------------------------ the world

export interface LocalWorld extends BuscaWorld {
  host: StubHost;
  catalog: ModelEntry[];
  child: StubChild;
  /** The options the assembly was given (C104). */
  options: Partial<LocalModelsOptions>;
  /** `GET /api/memory/embedder` as the owner. */
  embedder: () => Promise<{ status: number; body: Json }>;
  /** `POST /api/memory/embedder` as the owner. */
  act: (body: Json, headers?: Record<string, string>) => Promise<{ status: number; body: Json }>;
  /** Install through the route and wait until the model reads `ready` (or `failed`). */
  install: (id: string) => Promise<Json>;
  /** Wait until the model reads anything but `downloading`; its entry of the `GET`. */
  settle: (id: string) => Promise<Json>;
  /** The settings: the search on with the `local` provider and this model. */
  localOn: (id: string) => void;
  /** Every file under `<home>/models/`, relative, sorted. */
  modelFiles: () => string[];
}

export interface LocalWorldOptions {
  platform?: NodeJS.Platform;
  arch?: string;
  runtime?: boolean;
  idleMs?: number;
}

export async function localWorld(prefix: string, opts: LocalWorldOptions = {}): Promise<LocalWorld> {
  const host = await stubHost();
  const catalog = stubCatalog(host);
  const child = stubChild();
  const options: Partial<LocalModelsOptions> = {
    catalog,
    childEntry: child.entry,
    platform: opts.platform ?? "linux",
    arch: opts.arch ?? "x64",
    runtimeAvailable: () => opts.runtime ?? true,
    ...(opts.idleMs !== undefined ? { idleMs: opts.idleMs } : {}),
  };
  const base = await buscaWorld(prefix, { localModels: options });
  const modelsDir = path.join(base.home, "models");
  const world: LocalWorld = Object.assign(base, {
    host,
    catalog,
    child,
    options,
    embedder: () => base.call("GET", "/api/memory/embedder"),
    act: (body: Json, headers?: Record<string, string>) =>
      base.call("POST", "/api/memory/embedder", body, headers),
    async settle(id: string) {
      for (;;) {
        const res = await base.call("GET", "/api/memory/embedder");
        const model = (res.body.models as Json[]).find((m) => m.id === id)!;
        if (model.state !== "downloading") return model;
        await sleep(5);
      }
    },
    async install(id: string) {
      const res = await base.call("POST", "/api/memory/embedder", {
        action: "install",
        id,
        acceptTerms: true,
      });
      if (res.status !== 200) throw new Error(`install ${id}: ${res.status} ${JSON.stringify(res.body)}`);
      return world.settle(id);
    },
    localOn(id: string) {
      base.update((s) => {
        s.memory.embeddings = {
          ...s.memory.embeddings,
          enabled: true,
          provider: "local",
          local: { model: id as never },
        };
      });
    },
    modelFiles() {
      if (!fs.existsSync(modelsDir)) return [];
      return (fs.readdirSync(modelsDir, { recursive: true }) as string[])
        .filter((rel) => fs.statSync(path.join(modelsDir, rel)).isFile())
        .map((rel) => rel.split(path.sep).join("/"))
        .sort();
    },
  });
  const close = base.close;
  world.close = async () => {
    await close();
    await host.close();
    child.cleanup();
  };
  return world;
}
