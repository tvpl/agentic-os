/**
 * Type scale guard (refino item 13): every `font-size` in the app's CSS is a
 * token from theme.css. A literal pixel size is how the desktop drifted to
 * ten sizes between 9 and 13.5 px; this keeps it at the scale.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

function cssFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...cssFiles(p));
    else if (name.endsWith(".css")) out.push(p);
  }
  return out;
}

describe("type scale", () => {
  it("has no pixel font-size literal outside the tokens", () => {
    const offenders: string[] = [];
    for (const file of cssFiles(__dirname)) {
      const lines = readFileSync(file, "utf8").split("\n");
      lines.forEach((line, i) => {
        // The token definitions themselves (`--fs-1: 11px`) are the scale.
        if (/^\s*--fs-/.test(line)) return;
        if (/font-size:\s*[0-9.]+px/.test(line))
          offenders.push(`${file.replace(__dirname, "src")}:${i + 1} ${line.trim()}`);
      });
    }
    expect(offenders, offenders.join("\n")).toEqual([]);
  });

  it("the scale itself is the one the plan names", () => {
    const theme = readFileSync(join(__dirname, "theme.css"), "utf8");
    for (const token of [
      "--fs-0",
      "--fs-1",
      "--fs-2",
      "--fs-3",
      "--fs-4",
      "--fs-5",
      "--fs-6",
      "--fs-7",
      "--fs-8",
    ]) {
      expect(theme, token).toMatch(new RegExp(`${token}: [0-9]+px;`));
    }
  });
});
