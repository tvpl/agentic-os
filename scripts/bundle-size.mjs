#!/usr/bin/env node
/**
 * The weight of the Command Centre's build (.specs/features/primitivas, C31):
 * every .js and .css file of `apps/command-centre/dist`, raw and gzipped.
 *
 *   node scripts/bundle-size.mjs            print the table and the change since the primitives
 *   node scripts/bundle-size.mjs --check    exit 1 when the JS gzip is more than 5% above what the
 *                                           latest recorded build weighed (`npm run bundle:check`, run by CI)
 *   node scripts/bundle-size.mjs --dist <dir>   measure another folder (the test of the guard uses it)
 *
 * The numbers live in `scripts/bundle-baseline.json`: the build before the primitives (`before`) and, newest
 * last, the builds a feature ended on (`after`, each with its reason). A feature that makes the bundle heavier
 * on purpose appends an entry in the commit that does it; `tests/bundle-size.test.ts` holds the tolerance at
 * 1.05 and asks every entry for a reason, so the limit does not move without a visible, reviewed line.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { gzipSync } from "node:zlib";

const DIST = join(import.meta.dirname, "..", "apps", "command-centre", "dist");
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

const kb = (n) => `${(n / 1024).toFixed(1)} KB`;
const delta = (now, then) =>
  then
    ? `${now >= then ? "+" : "-"}${kb(Math.abs(now - then))} (${(((now - then) / then) * 100).toFixed(1)}%)`
    : "";

// Compared as URLs: a path with a space or a letter outside ASCII is percent-encoded in `import.meta.url`.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const at = process.argv.indexOf("--dist");
  const now = measure(at >= 0 ? process.argv[at + 1] : DIST);
  const rows = [
    ["JS raw", now.jsRaw, BEFORE.jsRaw, AFTER.jsRaw],
    ["JS gzip", now.jsGzip, BEFORE.jsGzip, AFTER.jsGzip],
    ["CSS raw", now.cssRaw, BEFORE.cssRaw, AFTER.cssRaw],
    ["CSS gzip", now.cssGzip, BEFORE.cssGzip, AFTER.cssGzip],
  ];
  console.log(`${now.files} files in dist; now / before the primitives / recorded after`);
  for (const [name, value, before, after] of rows)
    console.log(
      `${name.padEnd(9)} ${kb(value).padStart(10)}  ${kb(before).padStart(10)}  ${after ? kb(after).padStart(10) : "          "}  ${delta(value, before)}`,
    );
  if (process.argv.includes("--check")) {
    if (!now.files) {
      console.error("bundle-size: nothing to measure (build first)");
      process.exit(1);
    }
    const { limit, ok } = verdict(now);
    if (!ok) {
      console.error(
        `bundle-size: JS gzip ${now.jsGzip} is above ${limit} (${TOLERANCE}x the ${AFTER.feature} build, ${AFTER.jsGzip})`,
      );
      process.exit(1);
    }
    console.log(`bundle-size: JS gzip ${now.jsGzip} is within ${limit}`);
  }
}
