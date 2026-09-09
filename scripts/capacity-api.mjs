/** Cold corpus capacity probe. No provider calls; disposable isolated home. Build first. */
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import { startServer } from "../apps/api/dist/server.js";

const root = path.resolve(import.meta.dirname, "..");
const sizes = process.argv.slice(2).map(Number);
if (!sizes.length) sizes.push(100, 1000, 10000);
if (sizes.some((n) => !Number.isInteger(n) || n < 1 || n > 10000))
  throw new Error("Corpus size must be 1..10000");
const output = path.join(root, "artifacts", `capacity-${Date.now()}`);
fs.mkdirSync(output, { recursive: true });
const results = [];
for (const count of sizes) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "mordomo-capacity-"));
  const corpus = path.join(home, "corpus");
  fs.mkdirSync(corpus);
  fs.mkdirSync(path.join(home, "config"));
  for (let i = 0; i < count; i++)
    fs.writeFileSync(
      path.join(corpus, `note-${String(i).padStart(5, "0")}.md`),
      `# Projeto ${i}\n\nreferenciaunica${i} planejamento mobile categoria${i % 32}.\nDecisão: preservar contexto e validar recuperação.\n`,
    );
  fs.writeFileSync(
    path.join(home, "config/settings.json"),
    JSON.stringify({
      version: 1,
      setupCompleted: true,
      port: 4792,
      bindAddress: "127.0.0.1",
      providers: Object.fromEntries(["claude", "cursor", "codex"].map((id) => [id, { enabled: false }])),
      indexedFolders: [{ path: corpus, area: "Synthetic", enabled: true }],
    }),
  );
  const server = await startServer(home);
  const headers = { "x-mordomo-token": server.ctx.token() };
  const request = async (route, method = "GET") => {
    const response = await fetch(`http://127.0.0.1:4792${route}`, {
      method,
      headers,
      signal: AbortSignal.timeout(180000),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}: ${route}`);
    return response.json();
  };
  try {
    const began = performance.now();
    const indexed = await request("/api/memory/index", "POST");
    const indexMs = performance.now() - began;
    const query = `referenciaunica${count - 1}`;
    await request(`/api/memory/search?q=${query}`);
    const samples = [];
    for (let i = 0; i < 100; i++) {
      const started = performance.now();
      const found = await request(`/api/memory/search?q=${query}`);
      samples.push(performance.now() - started);
      if (
        !found.some(
          (file) => file.path === path.join(corpus, `note-${String(count - 1).padStart(5, "0")}.md`),
        )
      )
        throw new Error("Expected source not retrieved");
    }
    const graphAt = performance.now();
    const graph = await request("/api/memory/graph?maxNodes=4000");
    const graphMs = performance.now() - graphAt;
    const sorted = [...samples].sort((a, b) => a - b);
    const result = {
      count,
      indexMs,
      indexed,
      searchSamplesMs: samples,
      searchMedianMs: sorted[49],
      searchP95Ms: sorted[94],
      graphMs,
      graphNodes: graph.nodes.length,
      totalFiles: graph.totalFiles,
      memory: process.memoryUsage(),
    };
    results.push(result);
    fs.writeFileSync(path.join(output, "results.json"), JSON.stringify(results, null, 2));
    console.log(
      JSON.stringify({
        count,
        indexMs,
        searchP95Ms: result.searchP95Ms,
        graphMs,
        graphNodes: result.graphNodes,
      }),
    );
  } finally {
    await server.close();
    fs.rmSync(home, { recursive: true, force: true });
  }
}
fs.writeFileSync(
  path.join(output, "manifest.json"),
  JSON.stringify(
    {
      at: new Date().toISOString(),
      node: process.version,
      platform: os.platform(),
      memoryBytes: os.totalmem(),
      cpus: os.cpus().length,
      lockSha256: crypto
        .createHash("sha256")
        .update(fs.readFileSync(path.join(root, "package-lock.json")))
        .digest("hex"),
      scope:
        "Real isolated API/SQLite, synthetic corpus; cold index, warm exact-source search (100 calls), graph limited to 4000. Process memory includes driver and caches from previous corpora, not a leak or desktop frame measurement.",
    },
    null,
    2,
  ),
);
console.log(output);
