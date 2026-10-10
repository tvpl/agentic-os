#!/usr/bin/env node
/**
 * The weight of the Command Centre's build (.specs/features/primitivas, C31):
 * every .js and .css file of `apps/command-centre/dist`, raw and gzipped.
 *
 *   node scripts/bundle-size.mjs           print the table and the change since the primitives
 *   node scripts/bundle-size.mjs --check   exit 1 when the JS gzip is more than 5% above what
 *                                          the build weighed when the primitives landed
 *
 * `BEFORE` is the build at the start of the feature (9c82fc1) and `AFTER` the build the feature
 * ended on; both were measured with this script on `npm run build`. A later feature that makes the
 * bundle heavier on purpose moves `AFTER`, in the commit that does it, with its reason.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { gzipSync } from "node:zlib";

const DIST = join(import.meta.dirname, "..", "apps", "command-centre", "dist");

export const BEFORE = { jsRaw: 1445758, jsGzip: 470410, cssRaw: 337189, cssGzip: 70728 };
export const AFTER = { jsRaw: 1552075, jsGzip: 503649, cssRaw: 340497, cssGzip: 71459 };
const TOLERANCE = 1.05;

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

const kb = (n) => `${(n / 1024).toFixed(1)} KB`;
const delta = (now, then) =>
  then
    ? `${now >= then ? "+" : "-"}${kb(Math.abs(now - then))} (${(((now - then) / then) * 100).toFixed(1)}%)`
    : "";

if (import.meta.url === `file://${process.argv[1]}`) {
  const now = measure();
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
    if (!AFTER.jsGzip) {
      console.error("bundle-size: no AFTER recorded");
      process.exit(1);
    }
    const limit = Math.round(AFTER.jsGzip * TOLERANCE);
    if (now.jsGzip > limit) {
      console.error(
        `bundle-size: JS gzip ${now.jsGzip} is above ${limit} (${TOLERANCE}x what the primitives landed with, ${AFTER.jsGzip})`,
      );
      process.exit(1);
    }
    console.log(`bundle-size: JS gzip ${now.jsGzip} is within ${limit}`);
  }
}
