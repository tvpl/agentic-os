#!/usr/bin/env node
/**
 * The weight of the Command Centre's build (.specs/features/primitivas, C31, C38).
 *
 *   node scripts/bundle-size.mjs            print the table and the change since the primitives
 *   node scripts/bundle-size.mjs --check    exit 1 when the JS gzip is more than 5% above what the
 *                                           latest recorded build weighed (`npm run bundle:check`, run by CI)
 *   node scripts/bundle-size.mjs --dist <dir>   measure another folder (the test of the guard uses it)
 *
 * It always runs: there is no condition on how it was reached. What it measures and compares is in
 * `bundle-bounds.mjs`.
 */
import { AFTER, BEFORE, DIST, TOLERANCE, measure, verdict } from "./bundle-bounds.mjs";

const kb = (n) => `${(n / 1024).toFixed(1)} KB`;
const delta = (now, then) =>
  then
    ? `${now >= then ? "+" : "-"}${kb(Math.abs(now - then))} (${(((now - then) / then) * 100).toFixed(1)}%)`
    : "";

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
