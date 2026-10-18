import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";

describe("tracked files", () => {
  it("no two paths differ only by case (macOS and Windows would merge them)", () => {
    const files = execFileSync("git", ["ls-files"], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 })
      .split("\n")
      .filter(Boolean);
    const byLower = new Map<string, string[]>();
    for (const file of files) {
      const key = file.toLowerCase();
      byLower.set(key, [...(byLower.get(key) ?? []), file]);
    }
    const collisions = [...byLower.values()].filter((paths) => paths.length > 1);
    expect(collisions).toEqual([]);
  });
});
