import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/** CI gate (.specs/features/ci-gate): every pull request and every push to main is checked. */

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** The triggers under the top-level `on:` key: trigger name → its indented lines (comments and blanks dropped). */
function triggers(workflow: string): Map<string, string[]> {
  const lines = workflow.replace(/\r\n?/g, "\n").split("\n");
  const start = lines.findIndex((line) => /^on:\s*$/.test(line));
  expect(start, "workflow has an `on:` block").toBeGreaterThanOrEqual(0);
  const out = new Map<string, string[]>();
  let current: string | null = null;
  for (const line of lines.slice(start + 1)) {
    if (/^\S/.test(line)) break;
    if (!line.trim() || line.trim().startsWith("#")) continue;
    const key = /^ {2}([a-z_]+):\s*$/.exec(line);
    if (key) {
      current = key[1]!;
      out.set(current, []);
    } else if (current) {
      out.get(current)!.push(line.trim());
    }
  }
  return out;
}

describe("ci workflow triggers", () => {
  it("C1 ci runs on pull requests and pushes to main", () => {
    const on = triggers(fs.readFileSync(path.join(repoRoot, ".github", "workflows", "ci.yml"), "utf8"));
    expect([...on.keys()].sort()).toEqual(["pull_request", "push", "workflow_dispatch"]);
    // Every pull request: no branch, path or type filter narrows it.
    expect(on.get("pull_request")).toEqual([]);
    // Every push to main, and only that filter.
    expect(on.get("push")).toEqual(["branches: [main]"]);
    expect(on.get("workflow_dispatch")).toEqual([]);
  });

  it("C1 the trigger reader rejects narrowed or look-alike filters", () => {
    const read = (body: string) => triggers(`name: x\non:\n${body}\njobs: {}\n`);
    expect(read("  push:\n    branches: [main-legacy]").get("push")).not.toEqual(["branches: [main]"]);
    expect(read("  push:\n    branches: [main]\n    paths: [docs/**]").get("push")).not.toEqual([
      "branches: [main]",
    ]);
    expect(read("  pull_request:\n    branches: [release]").get("pull_request")).not.toEqual([]);
    expect(read("  push:\r\n    branches: [main]\r\n").get("push")).toEqual(["branches: [main]"]);
  });
});
