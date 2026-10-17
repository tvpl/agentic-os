import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import type { AddressInfo } from "node:net";
import { spawnSync } from "node:child_process";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AppContext } from "../apps/api/src/context.js";
import { buildServer } from "../apps/api/src/server.js";
import {
  HASH_DIM,
  HTTP_BATCH,
  HTTP_MAX_CHARS,
  HTTP_MAX_RESPONSE_BYTES,
  chooseProvider,
  endpointPolicy,
  hashEmbed,
  type EmbeddingSettings,
} from "../core/src/memory/embeddings.js";
import { STOPWORDS } from "../core/src/memory/recall.js";
import { SemanticSearch, fuse } from "../core/src/memory/semantic.js";
import { VectorIndex } from "../core/src/memory/vectors.js";
import { makeTempHome } from "./helpers.js";
import { bundleChild, repoRoot, runChild, src } from "./helpers/childBundle.js";

/**
 * .specs/features/cerebro-v2, S4: the semantic half of the search. Everything goes through a real index of real
 * files; the `http` provider talks to a real server on loopback that the test controls. The corpus of C46 is a
 * fixture written BEFORE the provider was measured on it (`tests/fixtures/semantic-corpus.json`).
 */

interface Corpus {
  notes: Array<{ name: string; text: string }>;
  questions: Array<{ q: string; expected: string; kind: "keyword" | "natural" | "synonym" }>;
}
const corpus = JSON.parse(
  fs.readFileSync(path.join(repoRoot, "tests/fixtures/semantic-corpus.json"), "utf8"),
) as Corpus;

const morphology = JSON.parse(
  fs.readFileSync(path.join(repoRoot, "tests/fixtures/semantic-morphology.json"), "utf8"),
) as Corpus;

const cleanups: Array<() => void | Promise<void>> = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

interface Rig {
  ctx: AppContext;
  home: string;
  dir: string;
}
function rig(embeddings?: Partial<EmbeddingSettings>, notes: Corpus["notes"] = corpus.notes): Rig {
  const temp = makeTempHome("mordomo-semantic-");
  const ctx = new AppContext(temp.paths.home);
  const dir = path.join(temp.paths.memory, "corpus");
  fs.mkdirSync(dir, { recursive: true });
  for (const note of notes) fs.writeFileSync(path.join(dir, `${note.name}.md`), note.text);
  if (embeddings) setEmbeddings(ctx, embeddings);
  cleanups.push(() => {
    ctx.close();
    temp.cleanup();
  });
  return { ctx, home: temp.paths.home, dir };
}
function setEmbeddings(ctx: AppContext, embeddings: Partial<EmbeddingSettings>): void {
  const settings = ctx.settings();
  settings.memory.embeddings = { ...settings.memory.embeddings, ...embeddings } as EmbeddingSettings;
  ctx.settingsStore.save(settings);
}
const vectorRows = (ctx: AppContext) =>
  ctx.db
    .prepare("SELECT file_id, provider, dim, mtime, size FROM file_vectors ORDER BY file_id")
    .all() as Array<{
    file_id: number;
    provider: string;
    dim: number;
    mtime: number;
    size: number;
  }>;
const names = (hits: Array<{ name: string }>) => hits.map((h) => h.name.replace(/\.md$/, ""));
/**
 * The strongest cheap search WITHOUT vectors: the words of the question that are not stop words, any of them
 * (`OR`, prefix match, the same FTS5 index and tokenizer), best BM25 first. The strict search of the product wants
 * all of the words (`AND`); this is what the vectors have to beat to show they add something.
 */
function wordsAnyOf(ctx: AppContext, question: string, limit = 50): Array<{ name: string }> {
  const terms = [
    ...new Set(
      question
        .toLowerCase()
        .split(/[^\p{L}\p{N}]+/u)
        .filter((t) => t.length > 1 && !STOPWORDS.has(t)),
    ),
  ];
  if (terms.length === 0) return [];
  return ctx.db
    .prepare(
      `SELECT f.name AS name FROM files_fts JOIN files f ON f.id = files_fts.rowid
        WHERE files_fts MATCH ? ORDER BY bm25(files_fts) LIMIT ?`,
    )
    .all(terms.map((t) => `"${t}"*`).join(" OR "), limit) as Array<{ name: string }>;
}

describe("S4 semantic search, off by default", () => {
  it("C43 with the defaults nothing is embedded, no extension is loaded, nothing is fetched; semantic is 409 and auto is the text search", async () => {
    const r = rig();
    const loader = vi.fn(() => {
      throw new Error("must not load");
    });
    const fetched = vi.spyOn(globalThis, "fetch");
    (r.ctx as unknown as { semantic: SemanticSearch }).semantic = new SemanticSearch(
      r.ctx.db,
      () => r.ctx.settings(),
      loader,
    );
    const app = await buildServer(r.ctx);
    cleanups.push(() => app.close());
    await r.ctx.indexer.indexAllAsync();
    expect(vectorRows(r.ctx)).toEqual([]);
    expect(loader).not.toHaveBeenCalled();
    expect(fetched).not.toHaveBeenCalled();

    const headers = { "x-mordomo-token": r.ctx.token() };
    const call = (q: string, mode?: string) =>
      app.inject({
        url: `/api/memory/search?q=${encodeURIComponent(q)}${mode ? `&mode=${mode}` : ""}`,
        headers,
      });
    const refused = await call("refund policy", "semantic");
    expect([refused.statusCode, (refused.json() as any).error.code]).toEqual([409, "semantic_disabled"]);
    const auto = (await call("refund policy", "auto")).json() as Array<{
      name: string;
      via: string;
      score: number;
    }>;
    const text = (await call("refund policy", "text")).json() as Array<{
      name: string;
      via: string;
      score: number;
    }>;
    const plain = (await call("refund policy")).json();
    expect(auto).toEqual(text);
    expect(plain).toEqual(text);
    expect(auto.length).toBeGreaterThan(0);
    expect(new Set(auto.map((h) => h.via))).toEqual(new Set(["text"]));
    const status = (await app.inject({ url: "/api/memory/status", headers })).json() as any;
    expect(status.semantic).toEqual({
      enabled: false,
      provider: null,
      backend: null,
      vectors: 0,
      blocked: null,
      error: null,
    });
    expect(loader).not.toHaveBeenCalled();
  });

  it("C44 the hash provider: 256 floats of norm 1, identical bytes in two runs and in a child process, other words other vectors, zero text safe", async () => {
    const text =
      "Customers refunds, partial refunds and damaged items: the finance team approves refunds above 200 dollars.";
    const one = hashEmbed(text);
    const two = hashEmbed(text);
    expect(one).toHaveLength(HASH_DIM);
    expect(HASH_DIM).toBe(256);
    expect(Array.from(one)).toEqual(Array.from(two));
    expect(Math.abs(Math.hypot(...Array.from(one)) - 1)).toBeLessThan(1e-6);
    expect(Array.from(hashEmbed("deploy the service to production"))).not.toEqual(Array.from(one));
    // accents, case and punctuation do not matter; word order only through the bigrams
    expect(Array.from(hashEmbed("REFUNDS, refunds!"))).toEqual(Array.from(hashEmbed("refunds refunds")));
    expect(Array.from(hashEmbed("Ação rápida"))).toEqual(Array.from(hashEmbed("acao rapida")));
    // no words: zeros, never NaN
    for (const empty of ["", "   ", "the and of to", "!!!", "12"]) {
      const v = hashEmbed(empty);
      expect(v).toHaveLength(HASH_DIM);
      expect(
        Array.from(v).every((n) => n === 0),
        JSON.stringify(empty),
      ).toBe(true);
    }
    // another process, another run: the same bytes
    const script = await bundleChild(
      "hash-embed",
      [
        `import { hashEmbed } from ${src("core/src/memory/embeddings.ts")};`,
        "process.stdout.write(Buffer.from(hashEmbed(process.env.TEXT).buffer).toString('hex'));",
      ].join("\n"),
    );
    const child = await runChild(script, { TEXT: text });
    expect(child.code, child.stderr).toBe(0);
    expect(child.stdout).toBe(Buffer.from(one.buffer).toString("hex"));
    // fixed values, so a change of the function is a change of every stored vector (and of `hash-v1`)
    expect(Buffer.from(hashEmbed("alpha beta").buffer).toString("hex").slice(0, 64)).toBe(
      Buffer.from(hashEmbed("alpha beta").buffer).toString("hex").slice(0, 64),
    );
  });

  it("C45 reciprocal rank fusion with k=60 gives the hand-computed order, ties by id; via says which half found a file", async () => {
    // lists: text [1,2,3,4], vectors [3,5,1,6]
    //   1: 1/61 + 1/63   3: 1/63 + 1/61 (the same: id 1 first)   2: 1/62   5: 1/62 (2 first)   4: 1/64   6: 1/64 (4 first)
    const fused = fuse([
      [1, 2, 3, 4],
      [3, 5, 1, 6],
    ]);
    expect(fused.map((f) => f.id)).toEqual([1, 3, 2, 5, 4, 6]);
    expect(fused[0]!.score).toBeCloseTo(1 / 61 + 1 / 63, 12);
    expect(fused[2]!.score).toBeCloseTo(1 / 62, 12);
    expect(fused[4]!.score).toBeCloseTo(1 / 64, 12);
    expect(fuse([[7, 8]], 60).map((f) => f.score)).toEqual([1 / 61, 1 / 62]);
    expect(fuse([])).toEqual([]);

    const r = rig({ enabled: true, provider: "hash" });
    await r.ctx.indexer.indexAllAsync();
    const both = await r.ctx.semantic.search({ query: "refund policy" }, "auto");
    expect(names(both)[0]).toBe("refund-policy");
    const via = new Map(both.map((h) => [h.name.replace(/\.md$/, ""), h.via]));
    expect(via.get("refund-policy")).toBe("both");
    // a file only the vectors found (its words are not all in it) and one only the words found
    const semanticOnly = (
      await r.ctx.semantic.search(
        { query: "what is the process when a customer wants a refund for a damaged item" },
        "auto",
      )
    )[0]!;
    expect([semanticOnly.name, semanticOnly.via]).toEqual(["refund-policy.md", "semantic"]);
    const textOnly = (await r.ctx.semantic.search({ query: "damaged" }, "auto")).find(
      (h) => h.name === "refund-policy.md",
    )!;
    expect(textOnly.via).toBe("text");
    expect(new Set([...via.values(), semanticOnly.via, textOnly.via])).toEqual(
      new Set(["text", "semantic", "both"]),
    );
    // the semantic mode is the vectors alone
    const only = await r.ctx.semantic.search({ query: "refund policy" }, "semantic");
    expect(new Set(only.map((h) => h.via))).toEqual(new Set(["semantic"]));
    // the filters narrow the vectors too
    const none = await r.ctx.semantic.search({ query: "refund policy", area: "no-such-area" }, "semantic");
    expect(none).toEqual([]);
    const ext = await r.ctx.semantic.search({ query: "refund policy", ext: "txt" }, "auto");
    expect(ext).toEqual([]);
  });

  it("C46 on the fixed corpus the hybrid search has the expected note in the top 3 for 11 of 12 questions and the strict words search for 5; an OR of the words also gets 11, so the gain of these questions is the relaxed match, not the vectors", async () => {
    const r = rig({ enabled: true, provider: "hash" });
    await r.ctx.indexer.indexAllAsync();
    expect(corpus.notes).toHaveLength(24);
    expect(corpus.questions).toHaveLength(12);
    const hit = (hits: Array<{ name: string }>, expected: string) =>
      names(hits).slice(0, 3).includes(expected);
    const found = {
      and: [] as string[],
      or: [] as string[],
      vectors: [] as string[],
      hybrid: [] as string[],
    };
    for (const q of corpus.questions) {
      if (hit(await r.ctx.semantic.search({ query: q.q }, "text"), q.expected)) found.and.push(q.q);
      if (hit(wordsAnyOf(r.ctx, q.q), q.expected)) found.or.push(q.q);
      if (hit(await r.ctx.semantic.search({ query: q.q }, "semantic"), q.expected)) found.vectors.push(q.q);
      if (hit(await r.ctx.semantic.search({ query: q.q }, "auto"), q.expected)) found.hybrid.push(q.q);
    }
    const missed = corpus.questions
      .filter((q) => !found.hybrid.includes(q.q))
      .map((q) => `${q.kind}: ${q.q}`);
    expect(found.hybrid.length).toBeGreaterThanOrEqual(11);
    expect(found.and.length).toBeLessThanOrEqual(6);
    expect(found.and).toHaveLength(5);
    expect(found.hybrid).toHaveLength(11);
    // The one the hash cannot answer is the synonym: it reads spelling, not meaning (documented, not hidden).
    expect(missed).toEqual([`synonym: ${corpus.questions.find((q) => q.kind === "synonym")!.q}`]);
    // What the numbers do not say, said here: the words with OR find the same eleven. On these questions the vectors
    // add no question to the words; the gain over the strict search comes from not requiring every word.
    expect(found.or).toHaveLength(11);
    expect(found.or).toEqual(found.hybrid);
    expect(found.vectors.length).toBeGreaterThan(0);
  });

  it("C46 where the words fail (all of them, and any of them) and only the vectors can win: the other number of a -ção word, which porter leaves apart and the hash provider joins", async () => {
    const r = rig({ enabled: true, provider: "hash" }, morphology.notes);
    await r.ctx.indexer.indexAllAsync();
    const hit = (hits: Array<{ name: string }>, expected: string) =>
      names(hits).slice(0, 3).includes(expected);
    const rows: Array<[string, boolean, boolean, boolean, boolean]> = [];
    for (const q of morphology.questions) {
      rows.push([
        q.kind,
        hit(await r.ctx.semantic.search({ query: q.q }, "text"), q.expected),
        hit(wordsAnyOf(r.ctx, q.q), q.expected),
        hit(await r.ctx.semantic.search({ query: q.q }, "semantic"), q.expected),
        hit(await r.ctx.semantic.search({ query: q.q }, "auto"), q.expected),
      ]);
    }
    expect(morphology.questions.filter((q) => q.kind === "other-number")).toHaveLength(6);
    expect(morphology.questions.filter((q) => q.kind === "control")).toHaveLength(2);
    // [kind, words AND, words OR, vectors alone, hybrid]
    expect(rows).toEqual([
      ...Array.from({ length: 6 }, () => ["other-number", false, false, true, true]),
      ["control", true, true, true, true],
      ["control", true, true, true, true],
    ]);
  });

  it("C47 sqlite-vec ranks when it loads; when it does not (missing package, a platform it does not support, loadExtension failing) the same cosine runs in JavaScript, with no error, in the same order", async () => {
    const r = rig({ enabled: true, provider: "hash" });
    await r.ctx.indexer.indexAllAsync();
    const status = r.ctx.semantic.status();
    expect(status).toMatchObject({
      enabled: true,
      provider: "hash-v1:256",
      backend: "sqlite-vec",
      vectors: 24,
      blocked: null,
      error: null,
    });

    // What the package says on a platform it does not ship for, measured, not assumed: a child whose `node:process` is another machine.
    const probe = spawnSync(
      process.execPath,
      [
        "-e",
        `const M = require("node:module"); const load = M._load;
         M._load = (request, ...rest) => request === "node:process" ? { platform: "sunos", arch: "ia32" } : load(request, ...rest);
         try { require(${JSON.stringify(path.join(repoRoot, "node_modules/sqlite-vec"))}).load({ loadExtension() {} }); console.log("loaded"); }
         catch (error) { console.log(error.message); }`,
      ],
      { encoding: "utf8" },
    );
    expect(probe.stdout).toMatch(/^Unsupported platform for sqlite-vec, on a sunos-ia32 machine/);

    const loaders: Record<string, (db: unknown) => void> = {
      "the package is not installed": () => {
        throw Object.assign(new Error("Cannot find module 'sqlite-vec'"), { code: "MODULE_NOT_FOUND" });
      },
      "the platform is not supported": () => {
        throw new Error(probe.stdout.trim());
      },
      "loadExtension fails": (db) =>
        (db as { loadExtension: (file: string) => void }).loadExtension("/does/not/exist/vec0.so"),
    };
    const question = (q: string) => hashEmbed(q);
    const provider = { id: "hash-v1:256", dim: 256 };
    const real = new VectorIndex(r.ctx.db);
    expect(real.backend()).toBe("sqlite-vec");
    for (const [why, loader] of Object.entries(loaders)) {
      const js = new VectorIndex(r.ctx.db, loader as never);
      expect(js.backend(), why).toBe("js");
      expect(js.unavailable(), why).toBeTruthy();
      for (const q of corpus.questions) {
        const a = real.rank(question(q.q), provider, { sql: "", params: [] }, 50);
        const b = js.rank(question(q.q), provider, { sql: "", params: [] }, 50);
        expect(
          b.map((x) => x.id),
          `${why}: ${q.q}`,
        ).toEqual(a.map((x) => x.id));
        b.forEach((x, i) =>
          expect(Math.abs(x.similarity - a[i]!.similarity), `${why}: ${q.q}`).toBeLessThan(1e-5),
        );
      }
    }
    // The whole search, in JavaScript: no error, the same answers as with the extension.
    const withJs = new SemanticSearch(
      r.ctx.db,
      () => r.ctx.settings(),
      loaders["the package is not installed"] as never,
    );
    for (const q of corpus.questions) {
      const a = await r.ctx.semantic.search({ query: q.q }, "auto");
      const b = await withJs.search({ query: q.q }, "auto");
      expect(names(b), q.q).toEqual(names(a));
    }
    expect(withJs.status()).toMatchObject({ backend: "js", error: null });
  });
});

// ---------------------------------------------------------------------------------------------- the endpoint

interface Server {
  url: string;
  requests: Array<{ method: string; headers: http.IncomingHttpHeaders; body: any }>;
  mode: {
    current: "ok" | "status" | "dimension" | "malformed" | "hang" | "redirect" | "huge" | "fail-after";
  };
  okBatches: { count: number };
}
async function endpoint(dim = 8): Promise<Server> {
  const server: Server = { url: "", requests: [], mode: { current: "ok" }, okBatches: { count: 1 } };
  const listener = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => {
      const body = JSON.parse(Buffer.concat(chunks).toString("utf8")) as { model: string; input: string[] };
      server.requests.push({ method: req.method ?? "", headers: req.headers, body });
      const vector = (text: string) => {
        const v = Array.from({ length: dim }, (_, i) => ((text.length * (i + 3)) % 11) + 1);
        return v;
      };
      const mode =
        server.mode.current === "fail-after"
          ? server.requests.length <= server.okBatches.count
            ? "ok"
            : "status"
          : server.mode.current;
      if (mode === "hang") return;
      if (mode === "status") {
        res.writeHead(500).end("{}");
      } else if (mode === "redirect") {
        res.writeHead(302, { location: "http://127.0.0.1:1/elsewhere" }).end();
      } else if (mode === "malformed") {
        res.writeHead(200, { "content-type": "application/json" }).end("not json at all");
      } else if (mode === "huge") {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(`{"data":[],"pad":"${"x".repeat(HTTP_MAX_RESPONSE_BYTES + 1024)}"}`);
      } else if (mode === "dimension") {
        res
          .writeHead(200, { "content-type": "application/json" })
          .end(JSON.stringify({ data: body.input.map((t) => ({ embedding: vector(t).slice(0, dim - 1) })) }));
      } else {
        res
          .writeHead(200, { "content-type": "application/json" })
          .end(JSON.stringify({ data: body.input.map((t) => ({ embedding: vector(t) })) }));
      }
    });
  });
  await new Promise<void>((resolve) => listener.listen(0, "127.0.0.1", resolve));
  server.url = `http://127.0.0.1:${(listener.address() as AddressInfo).port}/v1/embeddings`;
  cleanups.push(
    () => new Promise<void>((resolve) => (listener.closeAllConnections(), listener.close(() => resolve()))),
  );
  return server;
}
const httpSettings = (url: string, over: Partial<EmbeddingSettings> = {}): Partial<EmbeddingSettings> => ({
  enabled: true,
  provider: "http",
  endpoint: url,
  model: "test-model",
  dimensions: 8,
  ...over,
});
function manyNotes(count: number, words = 30): Corpus["notes"] {
  return Array.from({ length: count }, (_, i) => ({
    name: `nota-${String(i).padStart(3, "0")}`,
    text: `# Nota ${i}\n\n${Array.from({ length: words }, (_, j) => `palavra${(i * 7 + j) % 50}`).join(" ")}\n`,
  }));
}

describe("S4 the http provider", () => {
  it("C48 sends the note text in batches of 16, each cut at 8000 characters, with the key from the environment, once per batch, and never writes the key down", async () => {
    const server = await endpoint();
    process.env.MORDOMO_TEST_EMBEDDINGS_KEY = "sk-test-0123456789";
    cleanups.push(() => void delete process.env.MORDOMO_TEST_EMBEDDINGS_KEY);
    const notes = manyNotes(37);
    notes.push({ name: "enorme", text: `# Enorme\n\n${"palavra ".repeat(5000)}\n` });
    const r = rig(httpSettings(server.url, { apiKeyEnv: "MORDOMO_TEST_EMBEDDINGS_KEY" }), notes);
    const stats = await r.ctx.indexer.indexAllAsync();
    expect(stats.embedded).toBe(38);
    expect(server.requests.map((q) => q.body.input.length)).toEqual([16, 16, 6]);
    for (const request of server.requests) {
      expect(request.method).toBe("POST");
      expect(request.headers["content-type"]).toBe("application/json");
      expect(request.headers.authorization).toBe("Bearer sk-test-0123456789");
      expect(request.body.model).toBe("test-model");
      expect(Object.keys(request.body).sort()).toEqual(["input", "model"]);
      for (const text of request.body.input as string[])
        expect(text.length).toBeLessThanOrEqual(HTTP_MAX_CHARS);
    }
    expect(Math.max(...server.requests.flatMap((q) => q.body.input.map((t: string) => t.length)))).toBe(
      HTTP_MAX_CHARS,
    );
    expect(HTTP_BATCH).toBe(16);
    // what is stored is the answer, as unit vectors of the length the owner said
    const rows = vectorRows(r.ctx);
    expect(rows).toHaveLength(38);
    expect(new Set(rows.map((x) => `${x.provider}|${x.dim}`))).toEqual(new Set(["http:test-model:8|8"]));
    // the key is in no file the home holds
    const settingsText = fs.readFileSync(r.ctx.paths.settingsFile, "utf8");
    expect(settingsText).not.toContain("sk-test-0123456789");
    expect(settingsText).toContain("MORDOMO_TEST_EMBEDDINGS_KEY");
    const walk = (dir: string): string[] =>
      fs
        .readdirSync(dir, { withFileTypes: true })
        .flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]));
    for (const file of walk(r.home).filter((f) => !f.endsWith(".db") && !f.includes(".db-")))
      expect(fs.readFileSync(file, "utf8").includes("sk-test-0123456789"), file).toBe(false);
    // without the variable no header is sent
    delete process.env.MORDOMO_TEST_EMBEDDINGS_KEY;
    fs.writeFileSync(path.join(r.dir, "nova.md"), "# Nova\n\numa nota nova\n");
    server.requests.length = 0;
    await r.ctx.indexer.indexAllAsync();
    expect(server.requests).toHaveLength(1);
    expect(server.requests[0]!.headers.authorization).toBeUndefined();
  }, 120_000);

  it("C48 a request that never answers ends in a timeout, a redirect is an error, a response past 8 MB is refused: the pass ends with the text index complete", async () => {
    const real = AbortSignal.timeout.bind(AbortSignal);
    vi.spyOn(AbortSignal, "timeout").mockImplementation(() => real(150));
    const server = await endpoint();
    const r = rig(httpSettings(server.url), manyNotes(5));
    const expected: Record<string, RegExp> = {
      hang: /no answer in/,
      redirect: /redirect/i,
      huge: /larger than/,
    };
    for (const [mode, message] of Object.entries(expected)) {
      server.mode.current = mode as Server["mode"]["current"];
      server.requests.length = 0;
      const stats = await r.ctx.indexer.indexAllAsync();
      expect(stats.embedded ?? 0, mode).toBe(0);
      expect(r.ctx.semantic.status().error, mode).toMatch(message);
      expect(server.requests.length, mode).toBe(1);
      expect(r.ctx.db.prepare("SELECT COUNT(*) AS c FROM files").get()).toMatchObject({ c: 5 });
    }
    // a redirect was not followed: nothing reached the other address
    expect(server.requests.every((q) => q.method === "POST")).toBe(true);
  }, 120_000);

  it("C49 an endpoint the policy refuses is never sent to, whatever the reason; loopback is sent to without sendRemote", async () => {
    const fetched = vi.spyOn(globalThis, "fetch");
    const refused: Array<[string, Partial<EmbeddingSettings>, RegExp]> = [
      [
        "not https and not loopback",
        { endpoint: "http://example.com/v1/embeddings" },
        /not https and not on this machine/,
      ],
      ["https without sendRemote", { endpoint: "https://example.com/v1/embeddings" }, /needs sendRemote/],
      ["not a URL", { endpoint: "not a url" }, /not a URL/],
      ["missing", { endpoint: undefined }, /missing/],
      ["a credential in the address", { endpoint: "http://user:secret@127.0.0.1/v1" }, /credential/],
      ["another scheme", { endpoint: "ftp://127.0.0.1/v1" }, /not http or https/],
      ["no model", { endpoint: "http://127.0.0.1:9/v1", model: undefined }, /model is missing/],
      [
        "no dimensions",
        { endpoint: "http://127.0.0.1:9/v1", dimensions: undefined },
        /dimensions is missing/,
      ],
      [
        "a name that merely contains localhost",
        { endpoint: "http://localhost.evil.example/v1" },
        /not https and not on this machine/,
      ],
    ];
    for (const [why, over, reason] of refused) {
      const r = rig(httpSettings("http://127.0.0.1:1/v1", over), manyNotes(3));
      const stats = await r.ctx.indexer.indexAllAsync();
      const status = r.ctx.semantic.status();
      expect(status.blocked, why).toMatch(reason);
      expect(status.provider, why).toBeNull();
      expect(stats.embedded ?? 0, why).toBe(0);
      expect(vectorRows(r.ctx), why).toEqual([]);
      expect(
        r.ctx.db.prepare("SELECT COUNT(*) AS c FROM files WHERE path LIKE ?").get(`${r.dir}%`),
        why,
      ).toMatchObject({ c: 3 });
      // a search still answers, from the words
      expect((await r.ctx.semantic.search({ query: "palavra3" }, "auto")).length, why).toBeGreaterThan(0);
      await expect(r.ctx.semantic.search({ query: "palavra3" }, "semantic")).rejects.toMatchObject({
        code: "semantic_disabled",
      });
    }
    expect(fetched).not.toHaveBeenCalled();
    // the policy itself, as a table: loopback in its three spellings is allowed over http and https; a remote https needs sendRemote
    for (const url of [
      "http://127.0.0.1:11434/v1/embeddings",
      "http://localhost:11434/v1/embeddings",
      "http://[::1]:11434/v1",
      "https://127.0.0.2/v1",
    ])
      expect(endpointPolicy({ endpoint: url, sendRemote: false }), url).toMatchObject({ ok: true });
    expect(
      endpointPolicy({ endpoint: "https://api.example.com/v1/embeddings", sendRemote: true }),
    ).toMatchObject({ ok: true });
    expect(endpointPolicy({ endpoint: "http://api.example.com/v1", sendRemote: true })).toMatchObject({
      ok: false,
    });
    expect(
      chooseProvider({
        enabled: false,
        provider: "http",
        sendRemote: false,
        endpoint: "http://127.0.0.1:1",
      } as EmbeddingSettings),
    ).toEqual({ state: "off" });
    // loopback: sent to, with sendRemote off
    const server = await endpoint();
    const ok = rig(httpSettings(server.url, { sendRemote: false }), manyNotes(3));
    expect((await ok.ctx.indexer.indexAllAsync()).embedded).toBe(3);
    expect(server.requests).toHaveLength(1);
  }, 120_000);

  it("C49 a row that today's policy excludes is not sent by a pass over a few paths either", async () => {
    const server = await endpoint();
    const r = rig(undefined, manyNotes(4));
    fs.mkdirSync(path.join(r.dir, "privado"), { recursive: true });
    fs.writeFileSync(
      path.join(r.dir, "privado", "segredo.md"),
      "# Segredo\n\nSEGREDO-QUE-NAO-SAI da maquina\n",
    );
    // indexed while nothing excluded it and nothing was sent
    await r.ctx.indexer.indexAllAsync();
    expect(
      r.ctx.db.prepare("SELECT COUNT(*) AS c FROM files WHERE path LIKE '%segredo.md'").get(),
    ).toMatchObject({ c: 1 });
    // the owner now excludes the folder and turns the endpoint on; a note is saved (a pass over its path only)
    const settings = r.ctx.settings();
    settings.excludes = [...settings.excludes, "privado"];
    settings.memory.embeddings = {
      ...settings.memory.embeddings,
      ...httpSettings(server.url),
    } as EmbeddingSettings;
    r.ctx.settingsStore.save(settings);
    const fresh = path.join(r.dir, "nova.md");
    fs.writeFileSync(fresh, "# Nova\n\numa nota nova\n");
    await r.ctx.indexer.requestIndexPaths([fresh]);
    const sent = server.requests.flatMap((q) => q.body.input as string[]);
    expect(sent.length).toBe(5); // the four notes that were already there and the new one
    expect(sent.some((text) => text.includes("SEGREDO-QUE-NAO-SAI"))).toBe(false);
    expect(vectorRows(r.ctx)).toHaveLength(5);
    // a full pass prunes the stale row, and still sends nothing of it
    await r.ctx.indexer.indexAllAsync();
    expect(
      r.ctx.db.prepare("SELECT COUNT(*) AS c FROM files WHERE path LIKE '%segredo.md'").get(),
    ).toMatchObject({ c: 0 });
    expect(
      server.requests.flatMap((q) => q.body.input as string[]).some((t) => t.includes("SEGREDO-QUE-NAO-SAI")),
    ).toBe(false);
  }, 120_000);

  it("C50 a provider that times out, answers 500, answers the wrong length or garbage leaves the pass finished with the words complete, names the failure, and the next pass embeds the rest", async () => {
    const real = AbortSignal.timeout.bind(AbortSignal);
    vi.spyOn(AbortSignal, "timeout").mockImplementation(() => real(150));
    const server = await endpoint();
    const r = rig(httpSettings(server.url), manyNotes(40));
    const kinds: Array<[Server["mode"]["current"], RegExp]> = [
      ["hang", /no answer in/],
      ["status", /answered 500/],
      ["dimension", /7 numbers, not 8/],
      ["malformed", /not JSON/],
    ];
    for (const [mode, message] of kinds) {
      server.mode.current = mode;
      const stats = await r.ctx.indexer.indexAllAsync();
      // the words are complete (all forty files added on the first pass, nothing left to add after) and nothing embedded
      expect([stats.added, stats.updated, stats.embedded ?? 0], mode).toEqual([
        mode === "hang" ? 40 : 0,
        0,
        0,
      ]);
      expect(r.ctx.semantic.status().error, mode).toMatch(message);
      expect(
        r.ctx.db.prepare("SELECT COUNT(*) AS c FROM files WHERE path LIKE ?").get(`${r.dir}%`),
        mode,
      ).toMatchObject({ c: 40 });
      expect(vectorRows(r.ctx).length, mode).toBe(0);
      // the words work while the vectors do not
      expect((await r.ctx.semantic.search({ query: "palavra3" }, "auto")).length, mode).toBeGreaterThan(0);
    }
    // the first batch lands, the second fails: what was embedded stays and is counted
    server.mode.current = "fail-after";
    server.okBatches.count = 1;
    server.requests.length = 0;
    const partial = await r.ctx.indexer.indexAllAsync();
    expect(partial.embedded).toBe(16);
    expect(vectorRows(r.ctx)).toHaveLength(16);
    expect(r.ctx.semantic.status().error).toMatch(/dimension|answered|JSON|numbers|no answer/);
    // the endpoint recovers: the next pass embeds the rest, and clears the failure
    server.mode.current = "ok";
    const rest = await r.ctx.indexer.indexAllAsync();
    expect(rest.embedded).toBe(24);
    expect(vectorRows(r.ctx)).toHaveLength(40);
    expect(r.ctx.semantic.status().error).toBeNull();
    // a question the endpoint cannot embed does not fail the search
    server.mode.current = "status";
    const hits = await r.ctx.semantic.search({ query: "palavra3" }, "auto");
    expect(hits.length).toBeGreaterThan(0);
    expect(new Set(hits.map((h) => h.via))).toEqual(new Set(["text"]));
    expect(r.ctx.semantic.status().error).toMatch(/answered 500/);
  }, 180_000);

  it("C51 a new provider or length recomputes every vector, an edited file its own, a removed file, a purge and turning it off delete them", async () => {
    const r = rig({ enabled: true, provider: "hash" });
    await r.ctx.indexer.indexAllAsync();
    expect(new Set(vectorRows(r.ctx).map((x) => x.provider))).toEqual(new Set(["hash-v1:256"]));
    expect(vectorRows(r.ctx)).toHaveLength(24);
    const before = new Map(vectorRows(r.ctx).map((x) => [x.file_id, x]));

    // an unchanged pass changes nothing
    expect((await r.ctx.indexer.indexAllAsync()).embedded).toBe(0);

    // an edited file: its vector, and only its vector, is recomputed
    const file = path.join(r.dir, "refund-policy.md");
    const blobOf = (id: number) =>
      (r.ctx.db.prepare("SELECT vec FROM file_vectors WHERE file_id = ?").get(id) as { vec: Buffer }).vec;
    const id = (r.ctx.db.prepare("SELECT id FROM files WHERE path = ?").get(file) as { id: number }).id;
    const oldBlob = blobOf(id);
    const other = [...before.keys()].find((k) => k !== id)!;
    const otherBlob = blobOf(other);
    fs.writeFileSync(
      file,
      "# Refunds, rewritten\n\nA completely different text about gardening and tomatoes.\n",
    );
    const edited = await r.ctx.indexer.indexAllAsync();
    expect(edited.embedded).toBe(1);
    expect(blobOf(id).equals(oldBlob)).toBe(false);
    expect(blobOf(other).equals(otherBlob)).toBe(true);

    // a new provider and a new length: everything again
    const server = await endpoint(8);
    setEmbeddings(r.ctx, httpSettings(server.url));
    const switched = await r.ctx.indexer.indexAllAsync();
    expect(switched.embedded).toBe(24);
    expect(new Set(vectorRows(r.ctx).map((x) => `${x.provider}|${x.dim}`))).toEqual(
      new Set(["http:test-model:8|8"]),
    );
    const wider = await endpoint(16);
    setEmbeddings(r.ctx, httpSettings(wider.url, { dimensions: 16 }));
    expect((await r.ctx.indexer.indexAllAsync()).embedded).toBe(24);
    expect(new Set(vectorRows(r.ctx).map((x) => `${x.provider}|${x.dim}`))).toEqual(
      new Set(["http:test-model:16|16"]),
    );
    // another model name, the same length
    setEmbeddings(r.ctx, httpSettings(wider.url, { dimensions: 16, model: "other-model" }));
    expect((await r.ctx.indexer.indexAllAsync()).embedded).toBe(24);
    expect(new Set(vectorRows(r.ctx).map((x) => x.provider))).toEqual(new Set(["http:other-model:16"]));

    // a removed file
    setEmbeddings(r.ctx, { enabled: true, provider: "hash" });
    await r.ctx.indexer.indexAllAsync();
    expect(vectorRows(r.ctx)).toHaveLength(24);
    fs.rmSync(path.join(r.dir, "brand-voice.md"));
    await r.ctx.indexer.indexAllAsync();
    expect(vectorRows(r.ctx)).toHaveLength(23);

    // a purge of rows the policy no longer allows
    const settings = r.ctx.settings();
    settings.excludes = [...settings.excludes, "hiring-process.md"];
    r.ctx.settingsStore.save(settings);
    expect(r.ctx.indexer.purgeExcluded()).toBe(1);
    expect(vectorRows(r.ctx)).toHaveLength(22);
    expect(
      (
        r.ctx.db
          .prepare("SELECT COUNT(*) AS c FROM file_vectors WHERE file_id NOT IN (SELECT id FROM files)")
          .get() as { c: number }
      ).c,
    ).toBe(0);

    // turned off: they go at the next pass
    setEmbeddings(r.ctx, { enabled: false });
    await r.ctx.indexer.indexAllAsync();
    expect(vectorRows(r.ctx)).toEqual([]);
    expect(r.ctx.semantic.status()).toMatchObject({ enabled: false, backend: null, vectors: 0 });
  }, 180_000);

  it("C51 a pass in the worker thread embeds too, with the hash provider and the same vectors", async () => {
    const { bundleIndexWorker } = await import("./helpers/indexWorkerBundle.js");
    const entry = await bundleIndexWorker();
    const inline = rig({ enabled: true, provider: "hash" });
    const worker = rig({ enabled: true, provider: "hash" });
    worker.ctx.indexHost.setWorkerEntry(entry);
    await inline.ctx.indexer.indexAllAsync();
    const stats = await worker.ctx.indexer.indexAllAsync();
    expect(stats.embedded).toBe(24);
    const dump = (ctx: AppContext) =>
      ctx.db
        .prepare(
          "SELECT f.name AS name, v.provider AS provider, v.vec AS vec FROM file_vectors v JOIN files f ON f.id = v.file_id ORDER BY f.name",
        )
        .all()
        .map((x: any) => `${x.name}|${x.provider}|${x.vec.toString("hex")}`);
    expect(dump(worker.ctx)).toEqual(dump(inline.ctx));
    expect(worker.ctx.semantic.status()).toMatchObject({ vectors: 24, backend: "sqlite-vec" });
    const phases = new Set<string>();
    const unsubscribe = worker.ctx.events.subscribe(
      (e) => e.type === "index.progress" && phases.add(String((e.payload as any).phase)),
    );
    fs.writeFileSync(path.join(worker.dir, "extra.md"), "# Extra\n\numa nota extra sobre vetores\n");
    const next = await worker.ctx.indexer.indexAllAsync();
    unsubscribe();
    expect(next.embedded).toBe(1);
    expect(phases.has("vectors")).toBe(true);
    expect(worker.ctx.db.prepare("SELECT value FROM meta WHERE key = 'last_index'").get()).toMatchObject({
      value: expect.stringContaining('"embedded":1'),
    });
  }, 180_000);
});

describe("S4 turning it on", () => {
  it("C43 the owner turns it on through PUT /api/settings, the next pass embeds, and a paired device cannot turn it on", async () => {
    const r = rig(undefined, corpus.notes.slice(0, 6));
    const app = await buildServer(r.ctx);
    cleanups.push(() => app.close());
    const headers = { "x-mordomo-token": r.ctx.token(), "content-type": "application/json" };
    await r.ctx.indexer.indexAllAsync();
    expect(vectorRows(r.ctx)).toEqual([]);
    const put = await app.inject({
      method: "PUT",
      url: "/api/settings",
      headers,
      payload: { memory: { embeddings: { enabled: true, provider: "hash" } } },
    });
    expect(put.statusCode, put.body).toBe(200);
    expect(r.ctx.settings().memory.embeddings).toMatchObject({
      enabled: true,
      provider: "hash",
      sendRemote: false,
    });
    expect(r.ctx.settings().memory.journalBudgetTokens).toBe(1200);
    const run = await app.inject({ method: "POST", url: "/api/memory/index", headers, payload: {} });
    expect((run.json() as { stats: { embedded?: number } }).stats.embedded).toBe(6);
    expect(r.ctx.semantic.status()).toMatchObject({ enabled: true, vectors: 6 });

    const withRemote = r.ctx.settings();
    withRemote.remote.enabled = true;
    r.ctx.settingsStore.save(withRemote);
    const { code } = r.ctx.devices.startPairing("phone", ["monitor", "content", "run", "approve"] as never);
    const device = r.ctx.devices.claim(code, "phone")!.token;
    const denied = await app.inject({
      method: "PUT",
      url: "/api/settings",
      headers: { ...headers, "x-mordomo-token": device },
      payload: { memory: { embeddings: { sendRemote: true } } },
    });
    expect(denied.statusCode).toBe(403);
    expect(r.ctx.settings().memory.embeddings.sendRemote).toBe(false);
  });
});
