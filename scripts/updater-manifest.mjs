#!/usr/bin/env node
/**
 * `latest.json`, the manifest the app's updater reads (.specs/features/distribuicao, AC 40; door 4). Built from the
 * files `scripts/release-collect.mjs` left in one folder, and only when it can be complete: every platform has its
 * updater file and its `.sig`, and the macOS and Windows files carry the operating-system signature (an update must
 * not replace a trusted app with one the system will refuse to open).
 *
 *   node scripts/updater-manifest.mjs --dir release --version 0.9.0 --tag v0.9.0 --notes notes.md --out latest.json
 *        [--date <ISO 8601>] [--repo tvpl/agentic-os] [--root <repository>]
 *
 * With a real public key in `tauri.updater.conf.json`, every signature is first verified against it (as the app will).
 *
 * Exit 3 (nothing written) when it cannot be complete: the workflow then leaves `latest.json` out and says why.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PLATFORMS } from "./release-collect.mjs";
import { verifyMinisign } from "./minisign.mjs";
import { CONFIG_FILE, ROOT, inspect } from "./updater-config.mjs";

const UPDATER_FILE = { macos: ".app.tar.gz", windows: "-setup.exe", linux: ".AppImage" };
/**
 * A Debian install updates through its own entry. `tauri-plugin-updater` (2.13.3, `updater.rs` `get_urls` and
 * `install_inner`) asks for `<os>-<arch>-<installer>` first and falls back to `<os>-<arch>`; for a .deb the installer
 * is `deb`, and what it downloads must be a .deb (`install_deb` returns `InvalidUpdaterFormat` for an AppImage). The
 * AppImage is the plain `linux-x86_64` entry (the fallback); an AppImage install never asks for `-deb`.
 */
const INSTALLER_ENTRY = { linux: { suffix: "-deb", file: ".deb" } };

/** `{ manifest }`, or `{ missing: [reasons] }`. */
export function buildManifest({ dir, version, tag, notes, date, repo, publicKey }) {
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
    const entry = (name, sigPath) => {
      const signature = fs.readFileSync(sigPath, "utf8").trim();
      // What every installed app does before it installs: the signature must verify against the public key it holds.
      if (publicKey !== undefined)
        verifyMinisign({
          pubkey: publicKey,
          signature,
          version,
          data: fs.readFileSync(path.join(dir, name)),
        });
      return { signature, url: `https://github.com/${repo}/releases/download/${tag}/${name}` };
    };
    const extra = INSTALLER_ENTRY[spec.os];
    try {
      if (extra) {
        const deb = `MordomoOS_${version}_${platform}${extra.file}`;
        const debSig = path.join(dir, `${deb}.sig`);
        if (!fs.existsSync(path.join(dir, deb)) || !fs.existsSync(debSig)) {
          missing.push(`${platform}: ${deb} or its .sig is not in ${dir} (a .deb install could not update)`);
          continue;
        }
        platforms[`${spec.updater}${extra.suffix}`] = entry(deb, debSig);
      }
      platforms[spec.updater] = entry(file, sig);
    } catch (err) {
      missing.push(`${platform}: ${err.message} (the public key is the one in ${CONFIG_FILE})`);
    }
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
  // With a real public key committed, every signature is checked against it before a manifest is written.
  const root = o.root ? path.resolve(o.root) : ROOT;
  const publicKey =
    inspect(root).state === "valid"
      ? JSON.parse(fs.readFileSync(path.join(root, CONFIG_FILE), "utf8")).plugins.updater.pubkey
      : undefined;
  const result = buildManifest({
    publicKey,
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
