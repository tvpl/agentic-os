/** Bounded API soak with synthetic data and no providers. Build first.
 * node scripts/soak-api.mjs [minutes=480] [intervalSeconds=60] [port=4791]
 * Output is incremental; interrupting writes an incomplete result and closes the server.
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import os from "node:os";
import { startServer } from "../apps/api/dist/server.js";
const minutes = Number(process.argv[2] ?? 480);
const interval = Number(process.argv[3] ?? 60) * 1000;
const port = Number(process.argv[4] ?? 4791);
if (!(
  minutes > 0 &&
  minutes <= 480 &&
  interval >= 1000 &&
  Number.isInteger(port) &&
  port >= 1024 &&
  port <= 65535
))
  throw new Error("Invalid soak bounds");
const repo = path.resolve(import.meta.dirname, "..");
const temporary = path.join(repo, "tests/.tmp");
fs.mkdirSync(temporary, { recursive: true });
const home = fs.mkdtempSync(path.join(temporary, "soak-"));
const output = path.join(repo, "artifacts", path.basename(home));
fs.mkdirSync(output, { recursive: true });
const corpus = path.join(home, "corpus");
fs.mkdirSync(corpus);
fs.mkdirSync(path.join(home, "config"));
for (let i = 0; i < 100; i++)
  fs.writeFileSync(
    path.join(corpus, `source-${i}.md`),
    `# Synthetic source ${i}\n\nsoakreference item ${i}\n`,
  );
const providers = Object.fromEntries(["claude", "cursor", "codex"].map((id) => [id, { enabled: false }]));
fs.writeFileSync(
  path.join(home, "config/settings.json"),
  JSON.stringify({
    version: 1,
    setupCompleted: true,
    port,
    bindAddress: "127.0.0.1",
    providers,
    indexedFolders: [{ path: corpus, area: "Soak", enabled: true }],
  }),
);
const server = await startServer(home);
const token = server.ctx.token();
let interrupted = false;
let wake;
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, () => {
    interrupted = true;
    wake?.();
  });
const started = Date.now();
let previous = started;
let failures = 0;
let gaps = 0;
let samples = 0;
const bundleHash = crypto.createHash("sha256");
let bundleFiles = 0;
function fingerprintDirectory(directory) {
  for (const entry of fs
    .readdirSync(directory, { withFileTypes: true })
    .sort((a, b) => a.name.localeCompare(b.name))) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) fingerprintDirectory(file);
    else if (entry.isFile()) {
      bundleHash.update(path.relative(repo, file));
      bundleHash.update(fs.readFileSync(file));
      bundleFiles++;
    }
  }
}
for (const directory of [
  "core/dist",
  "adapters/claude/dist",
  "adapters/cursor/dist",
  "adapters/codex/dist",
  "apps/api/dist",
])
  fingerprintDirectory(path.join(repo, directory));
const fingerprint = bundleHash.digest("hex");
fs.writeFileSync(
  path.join(output, "manifest.json"),
  JSON.stringify(
    {
      startedAt: new Date(started).toISOString(),
      minutes,
      intervalMs: interval,
      port,
      pid: process.pid,
      home,
      platform: os.platform(),
      node: process.version,
      corpusFiles: 100,
      bundleSha256: fingerprint,
      bundleFiles,
      lockSha256: crypto
        .createHash("sha256")
        .update(fs.readFileSync(path.join(repo, "package-lock.json")))
        .digest("hex"),
      scope:
        "Real isolated API/SQLite/index/search; synthetic corpus; no browser, providers or external connectors. Hash covers built API, core and adapters; dependencies identified by package-lock.",
    },
    null,
    2,
  ),
);
let lastCpu = process.cpuUsage();
let lastCpuAt = performance.now();
console.log(JSON.stringify({ output, pid: process.pid, port, minutes }));
async function request(route, method = "GET") {
  const response = await fetch(`http://127.0.0.1:${port}${route}`, {
    method,
    headers: { "x-mordomo-token": token },
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status} ${route}`);
  return response.json();
}
try {
  await request("/api/memory/index", "POST");
  do {
    const now = Date.now();
    if (now - previous > interval * 3) gaps++;
    previous = now;
    const sample = { at: new Date(now).toISOString(), elapsedMs: now - started };
    try {
      if (samples % 5 === 0) {
        fs.writeFileSync(
          path.join(corpus, "source-0.md"),
          `# Synthetic source 0\nsoakreference revision ${samples}\n`,
        );
        await request("/api/memory/index", "POST");
      }
      const began = performance.now();
      const health = await request("/api/health");
      const search = await request("/api/memory/search?q=soakreference");
      if (
        !health.ok ||
        !health.db.open ||
        health.activeRuns !== 0 ||
        !Array.isArray(search) ||
        search.length === 0
      )
        throw new Error("Health/search invariant failed");
      const cpu = process.cpuUsage();
      const cpuAt = performance.now();
      const cpuPercent =
        ((cpu.user - lastCpu.user + (cpu.system - lastCpu.system)) / ((cpuAt - lastCpuAt) * 1000)) * 100;
      lastCpu = cpu;
      lastCpuAt = cpuAt;
      const sizes = Object.fromEntries(
        ["", "-wal", "-shm"].map((suffix) => [
          suffix || "main",
          fs.existsSync(server.ctx.paths.dbFile + suffix)
            ? fs.statSync(server.ctx.paths.dbFile + suffix).size
            : 0,
        ]),
      );
      Object.assign(sample, {
        ok: true,
        requestMs: performance.now() - began,
        memory: process.memoryUsage(),
        cpuPercent,
        databaseBytes: Object.values(sizes).reduce((a, b) => a + b, 0),
        databaseFiles: sizes,
      });
    } catch (error) {
      failures++;
      Object.assign(sample, { ok: false, error: error.message });
    }
    samples++;
    fs.appendFileSync(path.join(output, "samples.jsonl"), JSON.stringify(sample) + "\n");
    if (Date.now() - started >= minutes * 60_000 || interrupted) break;
    await new Promise((resolve) => {
      const timer = setTimeout(resolve, Math.min(interval, minutes * 60_000 - (Date.now() - started)));
      wake = () => {
        clearTimeout(timer);
        resolve();
      };
    });
  } while (!interrupted);
} finally {
  await server.close();
  const elapsedMs = Date.now() - started;
  const result = {
    elapsedMs,
    samples,
    failures,
    gaps,
    interrupted,
    completed: !interrupted && elapsedMs >= minutes * 60_000,
    passed: !interrupted && elapsedMs >= minutes * 60_000 && failures === 0 && gaps === 0,
    scope: "API only; not the complete E12 desktop/integration soak",
  };
  fs.writeFileSync(path.join(output, "result.json"), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result));
  if (!result.passed) process.exitCode = 1;
}
