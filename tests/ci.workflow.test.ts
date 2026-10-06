import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/** CI gate (.specs/features/ci-gate): every pull request and every push to main is checked. */

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** The top-level `on:` block of a workflow, as its indented lines. */
function onBlock(workflow: string): string {
  const lines = workflow.split("\n");
  const start = lines.findIndex((line) => /^on:\s*$/.test(line));
  expect(start, "workflow has an `on:` block").toBeGreaterThanOrEqual(0);
  const body: string[] = [];
  for (const line of lines.slice(start + 1)) {
    if (/^\S/.test(line)) break;
    body.push(line);
  }
  return body.join("\n");
}

describe("ci workflow triggers", () => {
  it("C1 ci runs on pull requests and pushes to main", () => {
    const on = onBlock(fs.readFileSync(path.join(repoRoot, ".github", "workflows", "ci.yml"), "utf8"));
    expect(on).toMatch(/^ {2}pull_request:/m);
    expect(on).toMatch(/^ {2}workflow_dispatch:/m);
    const push = /^ {2}push:\n((?: {4,}.*\n?)*)/m.exec(on);
    expect(push, "push trigger").not.toBeNull();
    expect(push![1]).toMatch(/branches:\s*\[\s*main\s*\]|branches:\s*\n\s*-\s*main/);
  });
});
