/**
 * What the weight check measures and compares (.specs/features/primitivas, C31, C38): every .js and .css file
 * of `apps/command-centre/dist`, raw and gzipped, against the numbers in `scripts/bundle-baseline.json`. The
 * command is `scripts/bundle-size.mjs`, which only calls this: it has no "am I the entry point" test to
 * fail open (a path with a space, a symlink, a drive letter each made one disagree).
 *
 * The numbers live in `scripts/bundle-baseline.json`: the build before the primitives (`before`) and, newest
 * last, the builds a feature ended on (`after`, each with its reason). A feature that makes the bundle heavier
 * on purpose appends an entry in the commit that does it; `tests/bundle-size.test.ts` holds the tolerance at
 * 1.05 and asks every entry for a reason, so the limit does not move without a visible, reviewed line.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { gzipSync } from "node:zlib";

export const DIST = join(import.meta.dirname, "..", "apps", "command-centre", "dist");
export const BASELINE = JSON.parse(readFileSync(join(import.meta.dirname, "bundle-baseline.json"), "utf8"));
export const BEFORE = BASELINE.before;
export const AFTER = BASELINE.after.at(-1);
export const TOLERANCE = BASELINE.tolerance;

function files(dir) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? files(path) : [path];
  });
}

export function measure(dir = DIST) {
  const total = { jsRaw: 0, jsGzip: 0, cssRaw: 0, cssGzip: 0, files: 0 };
  for (const path of files(dir)) {
    const kind = path.endsWith(".js") ? "js" : path.endsWith(".css") ? "css" : null;
    if (!kind) continue;
    const bytes = readFileSync(path);
    total[`${kind}Raw`] += bytes.length;
    total[`${kind}Gzip`] += gzipSync(bytes).length;
    total.files++;
  }
  return total;
}

/** The most JS gzip a build may weigh, and whether `now` is within it. */
export function verdict(now, after = AFTER, tolerance = TOLERANCE) {
  const limit = Math.round(after.jsGzip * tolerance);
  return { limit, ok: now.jsGzip <= limit };
}
