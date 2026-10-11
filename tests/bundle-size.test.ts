import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import zlib from "node:zlib";
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

/** A dist whose script weighs this many bytes gzipped (incompressible bytes, then trimmed to the measured size). */
function distOfGzip(target: number): string {
  let size = target;
  for (let i = 0; i < 4; i++) {
    const dir = dist(size);
    const gz =
      zlib.gzipSync(fs.readFileSync(path.join(dir, "app.js"))).length +
      zlib.gzipSync("a{color:red}").length * 0;
    if (Math.abs(gz - target) < 40) return dir;
    size -= gz - target;
  }
  return dist(size);
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

  it("C31 the limit is the NEWEST recorded build's: a build between the oldest and the newest limit passes", async () => {
    const mod = (await import(pathToFileURL(script).href)) as {
      AFTER: { jsGzip: number };
      measure: (dir: string) => { jsGzip: number };
    };
    expect(mod.AFTER.jsGzip).toBe(baseline.after.at(-1)!.jsGzip);
    const newest = Math.round(baseline.after.at(-1)!.jsGzip * 1.05);
    const oldest = Math.round(baseline.after.at(0)!.jsGzip * 1.05);
    // Only a baseline with two entries can tell the two apart; the test makes its own when there is one.
    const between =
      baseline.after.length > 1 && newest > oldest ? Math.round((newest + oldest) / 2) : newest - 300;
    const dir = distOfGzip(between);
    expect(mod.measure(dir).jsGzip).toBeLessThanOrEqual(newest);
    const result = check(dir);
    expect(result.status, result.stderr).toBe(0);
  });

  it("C31 a build within 5% of the latest recorded one passes, one above it exits 1", () => {
    const limit = Math.round(baseline.after.at(-1)!.jsGzip * 1.05);
    const under = check(dist(limit - 20_000));
    expect(under.status, under.stderr).toBe(0);
    expect(under.stdout).toContain("within");
    // Just above, not far above: the limit is 5%, and a tolerance moved by a little would show here.
    const over = check(distOfGzip(limit + 1_500));
    expect(over.status).toBe(1);
    expect(over.stderr).toContain("is above");
  });

  it("C31 the check runs from a folder whose path has a space and a letter outside ASCII", () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "bundle é dir "));
    dirs.push(home);
    fs.mkdirSync(path.join(home, "scripts"));
    for (const file of ["bundle-size.mjs", "bundle-baseline.json"])
      fs.copyFileSync(path.join(root, "scripts", file), path.join(home, "scripts", file));
    const limit = Math.round(baseline.after.at(-1)!.jsGzip * 1.05);
    const run = (dir: string) =>
      spawnSync(process.execPath, [path.join(home, "scripts", "bundle-size.mjs"), "--check", "--dist", dir], {
        encoding: "utf8",
      });
    const over = run(dist(limit + 150_000));
    expect(over.status, "an oversized bundle fails from a path with a space").toBe(1);
    expect(over.stdout.length, "and it prints the table").toBeGreaterThan(0);
    const under = run(dist(limit - 20_000));
    expect(under.status, under.stderr).toBe(0);
    expect(under.stdout).toContain("within");
  });

  it("C31 a folder with nothing to measure fails the check instead of passing it", () => {
    const empty = fs.mkdtempSync(path.join(os.tmpdir(), "bundle-"));
    dirs.push(empty);
    expect(check(empty).status).toBe(1);
  });

  it("C31 package.json has the script, and CI runs it after the build as a step of its own: no condition, no escape", () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8")) as {
      scripts: Record<string, string>;
    };
    expect(pkg.scripts["bundle:check"]).toBe("node scripts/bundle-size.mjs --check");
    const lines = fs.readFileSync(path.join(root, ".github", "workflows", "ci.yml"), "utf8").split(/\r?\n/);
    const at = lines.findIndex((line) => /run:\s*npm run bundle:check/.test(line));
    expect(at, "the step exists").toBeGreaterThan(0);
    // The step: from its `- ` line to the line before the next one at the same indent.
    let start = at;
    while (start > 0 && !/^\s*- /.test(lines[start]!)) start--;
    const indent = /^(\s*)- /.exec(lines[start]!)![1]!.length;
    let end = start + 1;
    while (
      end < lines.length &&
      !(new RegExp(`^ {${indent}}- `).test(lines[end]!) || /^\S/.test(lines[end]!))
    )
      end++;
    const step = lines.slice(start, end).join("\n");
    expect(step, "run is exactly the script").toMatch(/run:\s*npm run bundle:check\s*$/m);
    expect(step).not.toMatch(/\bif:/);
    expect(step).not.toMatch(/continue-on-error/);
    expect(step).not.toMatch(/\|\||&&|;/);
    // In the `check` job (before the e2e job), after the build.
    const build = lines.findIndex((line) => /run:\s*npm run build\s*$/.test(line));
    const e2e = lines.findIndex((line) => /^ {2}e2e:/.test(line));
    expect(build).toBeGreaterThan(0);
    expect(start).toBeGreaterThan(build);
    expect(start).toBeLessThan(e2e);
  });
});
