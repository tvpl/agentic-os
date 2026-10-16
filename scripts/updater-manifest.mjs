#!/usr/bin/env node
/**
 * `latest.json`, the manifest the app's updater reads (.specs/features/distribuicao, AC 40; door 4). Built from the
 * files `scripts/release-collect.mjs` left in one folder, and only when it can be complete: every platform has its
 * updater file and its `.sig`, and the macOS and Windows files carry the operating-system signature (an update must
 * not replace a trusted app with one the system will refuse to open).
 *
 *   node scripts/updater-manifest.mjs --dir release --version 0.9.0 --tag v0.9.0 --notes notes.md --out latest.json
 *        [--date <ISO 8601>] [--repo tvpl/agentic-os]
 *
 * Exit 3 (nothing written) when it cannot be complete: the workflow then leaves `latest.json` out and says why.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PLATFORMS } from "./release-collect.mjs";

const UPDATER_FILE = { macos: ".app.tar.gz", windows: "-setup.exe", linux: ".AppImage" };

/** `{ manifest }`, or `{ missing: [reasons] }`. */
export function buildManifest({ dir, version, tag, notes, date, repo }) {
  const missing = [];
  const platforms = {};
  for (const [platform, spec] of Object.entries(PLATFORMS)) {
    const statusFile = path.join(dir, `status-${platform}.json`);
    if (!fs.existsSync(statusFile)) {
      missing.push(`${platform}: no status-${platform}.json (the job did not finish)`);
      continue;
    }
    const status = JSON.parse(fs.readFileSync(statusFile, "utf8"));
    if (spec.os !== "linux" && status.codeSigned !== true) {
      missing.push(`${platform}: not signed by the operating system`);
      continue;
    }
    if (status.updaterSigned !== true) {
      missing.push(`${platform}: no updater signature`);
      continue;
    }
    const file = `MordomoOS_${version}_${platform}${UPDATER_FILE[spec.os]}`;
    const sig = path.join(dir, `${file}.sig`);
    if (!fs.existsSync(path.join(dir, file)) || !fs.existsSync(sig)) {
      missing.push(`${platform}: ${file} or its .sig is not in ${dir}`);
      continue;
    }
    platforms[spec.updater] = {
      signature: fs.readFileSync(sig, "utf8").trim(),
      url: `https://github.com/${repo}/releases/download/${tag}/${file}`,
    };
  }
  if (missing.length > 0) return { missing };
  return { manifest: { version, notes, pub_date: date, platforms } };
}

export function main(
  argv,
  io = { out: (s) => process.stdout.write(s), err: (s) => process.stderr.write(s) },
) {
  const o = { repo: "tvpl/agentic-os" };
  for (let i = 0; i < argv.length; i++) {
    if (!argv[i].startsWith("--")) {
      io.err(`updater-manifest: unknown argument ${argv[i]}\n`);
      return 2;
    }
    o[argv[i].slice(2)] = argv[++i];
  }
  for (const need of ["dir", "version", "tag", "out"])
    if (!o[need]) {
      io.err(`updater-manifest: --${need} is required\n`);
      return 2;
    }
  if (o.tag !== `v${o.version}`) {
    io.err(`updater-manifest: the tag ${o.tag} is not v${o.version}\n`);
    return 2;
  }
  const notes = o.notes ? fs.readFileSync(o.notes, "utf8").trim() : "";
  const result = buildManifest({
    dir: path.resolve(o.dir),
    version: o.version,
    tag: o.tag,
    notes,
    date: o.date ?? new Date().toISOString(),
    repo: o.repo,
  });
  if (result.missing) {
    io.err(
      `updater-manifest: latest.json cannot be complete, so it is not written:\n${result.missing.map((m) => `  - ${m}`).join("\n")}\n`,
    );
    return 3;
  }
  fs.writeFileSync(path.resolve(o.out), JSON.stringify(result.manifest, null, 2) + "\n");
  io.out(`updater-manifest: ${Object.keys(result.manifest.platforms).join(", ")}\n`);
  return 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main(process.argv.slice(2));
}
