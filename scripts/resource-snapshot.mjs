/** Read-only process samples. Never captures argv, environment or credentials.
 * node scripts/resource-snapshot.mjs [samples=3] [intervalMs=2000] > snapshot.json
 */
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
const execute = promisify(execFile);
const count = Number(process.argv[2] ?? 3);
const intervalMs = Number(process.argv[3] ?? 2000);
if (
  !Number.isInteger(count) ||
  count < 1 ||
  count > 14400 ||
  !Number.isFinite(intervalMs) ||
  intervalMs < 1000
) {
  throw new Error("Expected 1..14400 samples and an interval >= 1000 ms");
}
const samples = [];
for (let i = 0; i < count; i++) {
  try {
    const { stdout } = await execute("ps", ["-axo", "pid=,ppid=,rss=,%cpu=,comm="], {
      timeout: 5000,
      maxBuffer: 4 * 1024 * 1024,
    });
    const processes = stdout.split("\n").flatMap((line) => {
      const match = /^\s*(\d+)\s+(\d+)\s+(\d+)\s+([\d.]+)\s+(.+)$/.exec(line);
      if (!match) return [];
      const name = path.basename(match[5]);
      if (!/node|claude|codex|cursor|chrome|watchman|java|gradle|dart|simulator|xcode/i.test(name)) return [];
      return [
        {
          pid: Number(match[1]),
          ppid: Number(match[2]),
          rssKiB: Number(match[3]),
          cpuPercent: Number(match[4]),
          name,
        },
      ];
    });
    samples.push({ timestamp: new Date().toISOString(), processes });
  } catch (err) {
    samples.push({ timestamp: new Date().toISOString(), unavailable: err.code ?? "probe_failed" });
  }
  if (i + 1 < count) await new Promise((resolve) => setTimeout(resolve, intervalMs));
}
process.stdout.write(
  JSON.stringify(
    {
      schemaVersion: 1,
      environment: {
        platform: os.platform(),
        release: os.release(),
        arch: os.arch(),
        totalMemoryBytes: os.totalmem(),
        logicalCpus: os.cpus().length,
        node: process.version,
      },
      interpretation:
        "ps %cpu is per-process lifetime-averaged CPU, not instantaneous load. RSS is KiB. Matching names do not establish project ownership. No argv captured.",
      samples,
    },
    null,
    2,
  ) + "\n",
);
