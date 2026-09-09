/** Bounded final gate: two hours, assess, then eight hours on a fresh home.
 * Run from the repository root. Does not rebuild, schedule jobs or call a real
 * provider. Never run another E2E runner against its isolated home/port.
 */
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";

const root = path.resolve(`artifacts/workspace-endurance-${Date.now()}`);
fs.mkdirSync(root, { recursive: true });
const statusFile = path.join(root, "status.json");
const update = (state) => {
  fs.writeFileSync(`${statusFile}.tmp`, JSON.stringify({ at: new Date().toISOString(), ...state }, null, 2));
  fs.renameSync(`${statusFile}.tmp`, statusFile);
};
const median = (values) => {
  const sorted = values.toSorted((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
};
let child;
let interrupted = false;
for (const signal of ["SIGTERM", "SIGINT"]) {
  process.on(signal, () => {
    interrupted = true;
    update({ state: "interrupted", signal, passed: false });
    child?.kill(signal);
  });
}
console.log(`Artifacts: ${root}`);
try {
  for (const minutes of [120, 480]) {
    if (interrupted) throw new Error("Operator interrupted the gate");
    const output = path.join(root, `${minutes}min`);
    const log = fs.openSync(path.join(root, `${minutes}min.log`), "w");
    update({ state: "running", minutes, output, pid: process.pid });
    const code = await new Promise((resolve, reject) => {
      child = spawn(
        process.execPath,
        [
          "node_modules/@playwright/test/cli.js",
          "test",
          "--config",
          "tests/e2e/playwright.config.ts",
          "workspace-soak.spec.ts",
        ],
        {
          env: {
            ...process.env,
            MORDOMO_SOAK_MINUTES: String(minutes),
            MORDOMO_SOAK_OUTPUT: output,
            MORDOMO_SOAK_PROFILE: minutes === 480 ? "intermittent" : "cycles",
          },
          stdio: ["ignore", log, log],
        },
      );
      child.once("error", reject);
      child.once("exit", resolve);
    }).finally(() => fs.closeSync(log));
    child = undefined;
    if (interrupted || code !== 0) throw new Error(`${minutes} minute runner did not pass (exit ${code})`);
    const result = JSON.parse(fs.readFileSync(path.join(output, "result.json"), "utf8"));
    const rows = fs
      .readFileSync(path.join(output, "samples.jsonl"), "utf8")
      .trim()
      .split("\n")
      .map(JSON.parse);
    const active = rows.filter((row) => row.elapsedMs >= 300_000 && !row.idle);
    const growth = {};
    for (const metric of ["heapBytes", "listeners", "documents"]) {
      const values = active.map((row) => row[metric]);
      if (values.length < 60 || values.some((value) => !Number.isFinite(value)))
        throw new Error(`Insufficient ${metric} observations`);
      const first = median(values.slice(0, 30));
      const last = median(values.slice(-30));
      growth[metric] = {
        firstMedian: first,
        lastMedian: last,
        changePercent: first === 0 ? (last === 0 ? 0 : null) : (last / first - 1) * 100,
      };
    }
    const alerts = Object.entries(growth)
      .filter(([, value]) => value.changePercent === null || value.changePercent > 10)
      .map(([metric]) => metric);
    const passed =
      result.completed === true &&
      result.passed === true &&
      result.elapsedMs >= minutes * 60_000 &&
      result.gaps === 0 &&
      alerts.length === 0;
    fs.writeFileSync(
      path.join(output, "assessment.json"),
      JSON.stringify(
        {
          passed,
          growth,
          alerts,
          interpretation:
            "First/last 30 active samples after five-minute warmup; >10% growth is an investigation alert, not proof of a leak. Synthetic provider only. No real macOS suspension observed.",
        },
        null,
        2,
      ),
    );
    if (!passed)
      throw new Error(
        `${minutes} minute assessment requires investigation: ${alerts.join(", ") || "duration/result"}`,
      );
    console.log(`${minutes} minute gate passed; evidence: ${output}`);
  }
  update({
    state: "completed",
    passed: true,
    scope:
      "Synthetic endurance only; real provider, mobile, connector and suspend acceptance remain separate.",
  });
} catch (error) {
  update({
    state: interrupted ? "interrupted" : "needs_investigation",
    passed: false,
    message: error.message,
  });
  console.error(error.message);
  process.exitCode = 1;
}
