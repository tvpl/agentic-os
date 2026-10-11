import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

/**
 * The weight guard (.specs/features/primitivas, C31): it runs in CI, reads a versioned baseline, holds the
 * tolerance at 5%, and fails a build that weighs more. Without these, the limit could move in silence.
 */

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const script = path.join(root, "scripts", "bundle-size.mjs");
const baseline = JSON.parse(fs.readFileSync(path.join(root, "scripts", "bundle-baseline.json"), "utf8")) as {
  tolerance: number;
  before: { commit: string; jsGzip: number };
  after: Array<{ feature: string; reason: string; jsGzip: number }>;
};

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});
/** A dist with one script of incompressible bytes: its gzip is about its size. */
function dist(jsBytes: number): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bundle-"));
  dirs.push(dir);
  fs.writeFileSync(path.join(dir, "app.js"), randomBytes(jsBytes));
  fs.writeFileSync(path.join(dir, "app.css"), "a{color:red}");
  return dir;
}
const check = (dir: string) =>
  spawnSync(process.execPath, [script, "--check", "--dist", dir], { encoding: "utf8" });

describe("C31 the weight guard", () => {
  it("C31 the tolerance is 5%, and the baseline says where each number came from", () => {
    expect(baseline.tolerance).toBe(1.05);
    expect(baseline.before.commit).toMatch(/^[0-9a-f]{7,}$/);
    expect(baseline.after.length).toBeGreaterThan(0);
    for (const entry of baseline.after) {
      expect(entry.feature.length, "feature").toBeGreaterThan(2);
      expect(entry.reason.length, `${entry.feature} says why the bundle is this heavy`).toBeGreaterThan(20);
    }
    // The bundle only gets recorded heavier, with a reason: the newest entry is never below the build before.
    expect(baseline.after.at(-1)!.jsGzip).toBeGreaterThanOrEqual(baseline.before.jsGzip);
    // The script takes its numbers from the baseline and holds no tolerance of its own.
    const source = fs.readFileSync(script, "utf8");
    expect(source).toContain("bundle-baseline.json");
    expect(source).not.toMatch(/TOLERANCE\s*=\s*[\d.]+/);
  });

  it("C31 a build within 5% of the latest recorded one passes, one above it exits 1", () => {
    const latest = baseline.after.at(-1)!.jsGzip;
    const limit = Math.round(latest * 1.05);
    const under = check(dist(limit - 20_000));
    expect(under.status, under.stderr).toBe(0);
    expect(under.stdout).toContain("within");
    const over = check(dist(limit + 20_000));
    expect(over.status).toBe(1);
    expect(over.stderr).toContain("is above");
  });

  it("C31 a folder with nothing to measure fails the check instead of passing it", () => {
    const empty = fs.mkdtempSync(path.join(os.tmpdir(), "bundle-"));
    dirs.push(empty);
    expect(check(empty).status).toBe(1);
  });

  it("C31 package.json has the script and CI runs it after the build", () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8")) as {
      scripts: Record<string, string>;
    };
    expect(pkg.scripts["bundle:check"]).toBe("node scripts/bundle-size.mjs --check");
    const ci = fs.readFileSync(path.join(root, ".github", "workflows", "ci.yml"), "utf8");
    const build = ci.indexOf("run: npm run build");
    const guard = ci.indexOf("run: npm run bundle:check");
    expect(build).toBeGreaterThan(0);
    expect(guard).toBeGreaterThan(build);
  });
});
