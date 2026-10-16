#!/usr/bin/env node
/**
 * The assets a draft release still holds that this run no longer produces (.specs/features/distribuicao, F13 of the
 * first verification round). `gh release upload --clobber` replaces a file of the same name and never deletes one: a
 * re-run of a tag that now builds `_UNSIGNED` installers would leave the signed ones of the earlier run beside them, and
 * a `latest.json` the run did not write would stay and point at files that are gone.
 *
 *   node scripts/release-stale-assets.mjs --existing <file, one asset name a line> --dir artifacts
 *
 * Prints the names to delete, one a line (nothing when there are none).
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/** Names in `existing` that are not files of `dir`. */
export function staleAssets(existing, dir) {
  const wanted = new Set(fs.existsSync(dir) ? fs.readdirSync(dir) : []);
  return existing.map((n) => n.trim()).filter((n) => n !== "" && !wanted.has(n));
}

export function main(
  argv,
  io = { out: (s) => process.stdout.write(s), err: (s) => process.stderr.write(s) },
) {
  const o = {};
  for (let i = 0; i < argv.length; i++) {
    if (!argv[i].startsWith("--")) {
      io.err(`release-stale-assets: unknown argument ${argv[i]}\n`);
      return 2;
    }
    o[argv[i].slice(2)] = argv[++i];
  }
  for (const need of ["existing", "dir"])
    if (!o[need]) {
      io.err(`release-stale-assets: --${need} is required\n`);
      return 2;
    }
  const dir = path.resolve(o.dir);
  if (!fs.existsSync(dir) || fs.readdirSync(dir).length === 0) {
    // Nothing to upload would make every existing asset "stale": that is a broken run, not a clean-up.
    io.err(`release-stale-assets: ${dir} is empty or missing, so nothing is deleted\n`);
    return 1;
  }
  const existing = fs.readFileSync(path.resolve(o.existing), "utf8").split("\n");
  for (const name of staleAssets(existing, dir)) io.out(`${name}\n`);
  return 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main(process.argv.slice(2));
}
