#!/usr/bin/env node
/**
 * One platform's installers, renamed for the release and described by a `status-<platform>.json`
 * (.specs/features/distribuicao, AC 39). The names carry the platform, so four jobs can upload to one release;
 * an installer the operating system will not trust says so in its name (`_UNSIGNED`).
 *
 *   node scripts/release-collect.mjs --platform macos-arm64 --bundle <tauri bundle dir> --out release --version 0.9.0
 *        --code-signed true|false [--notarized true|false] --updater-signed true|false [--root <repository>]
 *
 * Out: `MordomoOS_<version>_<platform>[_UNSIGNED]<suffix>` for each installer of the platform and, with an updater
 * key, the updater archive of macOS (`.app.tar.gz`, which Tauri writes only then) and the `.sig` that Tauri wrote beside
 * the updater file (and beside the .deb). Linux has no operating-system signature (`codeSigned` is `null`
 * there and its names never say UNSIGNED); check `SHA256SUMS.txt` instead.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { verifyMinisign } from "./minisign.mjs";
import { CONFIG_FILE, ROOT, inspect } from "./updater-config.mjs";

export const PLATFORMS = {
  "macos-arm64": { os: "macos", updater: "darwin-aarch64" },
  "macos-x64": { os: "macos", updater: "darwin-x86_64" },
  "windows-x64": { os: "windows", updater: "windows-x86_64" },
  "linux-x64": { os: "linux", updater: "linux-x86_64" },
};

/**
 * Where Tauri puts each installer (relative to the bundle dir), the suffix of its release name, whether the updater
 * signs it (the .deb too: an installed .deb updates itself through the `linux-x86_64-deb` entry of `latest.json`, which the
 * plugin looks up before `linux-x86_64`, and it refuses an AppImage there), and `updaterOnly`: the file exists only when `createUpdaterArtifacts` is on (the macOS `.app.tar.gz`; the
 * bundler writes it under `if let Some(updater)`, so a build without the updater key has the `.dmg` and the `.app`
 * folder and no archive). An `updaterOnly` file is required when `--updater-signed true` and skipped otherwise.
 */
const ARTIFACTS = {
  macos: [
    { dir: "dmg", match: /\.dmg$/, suffix: ".dmg", updater: false },
    { dir: "macos", match: /\.app\.tar\.gz$/, suffix: ".app.tar.gz", updater: true, updaterOnly: true },
  ],
  windows: [{ dir: "nsis", match: /-setup\.exe$/, suffix: "-setup.exe", updater: true }],
  linux: [
    { dir: "deb", match: /\.deb$/, suffix: ".deb", updater: true },
    { dir: "appimage", match: /\.AppImage$/, suffix: ".AppImage", updater: true },
  ],
};

const bool = (v, name) => {
  if (v === "true") return true;
  if (v === "false") return false;
  throw new Error(`${name} must be true or false`);
};

/** Throws unless `sigFile` is a signature of `file` by `publicKey` (the key of the updater configuration). */
function verifySig(file, sigFile, publicKey) {
  try {
    verifyMinisign({
      pubkey: publicKey,
      signature: fs.readFileSync(sigFile, "utf8"),
      data: fs.readFileSync(file),
    });
  } catch (err) {
    throw new Error(`${sigFile}: ${err.message} (the public key is the one in ${CONFIG_FILE})`);
  }
}

/**
 * `publicKey`: the minisign public key of the updater configuration. With it, every `.sig` that is collected must
 * verify against the file beside it; without it (a test, or a build with no updater) nothing is verified.
 */
export function collect({ platform, bundle, out, version, codeSigned, notarized, updaterSigned, publicKey }) {
  const spec = PLATFORMS[platform];
  if (!spec) throw new Error(`unknown platform ${platform} (${Object.keys(PLATFORMS).join(", ")})`);
  fs.mkdirSync(out, { recursive: true });
  // Only macOS and Windows have an operating-system signature to be missing.
  const label = spec.os !== "linux" && !codeSigned ? "_UNSIGNED" : "";
  const written = [];
  for (const artifact of ARTIFACTS[spec.os]) {
    const dir = path.join(bundle, artifact.dir);
    const names = fs.existsSync(dir) ? fs.readdirSync(dir).filter((n) => artifact.match.test(n)) : [];
    if (artifact.updaterOnly && !updaterSigned) {
      // No updater key: the bundler writes no archive. One that is there anyway is not ours to ship.
      if (names.length > 0)
        throw new Error(`${dir}: ${names[0]} exists though no updater key was configured`);
      continue;
    }
    if (names.length !== 1)
      throw new Error(`${dir}: expected one file matching ${artifact.match}, found ${names.length}`);
    const target = `MordomoOS_${version}_${platform}${label}${artifact.suffix}`;
    fs.copyFileSync(path.join(dir, names[0]), path.join(out, target));
    written.push(target);
    // Tauri signs the updater files and the .deb with the minisign key: a .sig beside a file is uploaded with it.
    const sig = path.join(dir, `${names[0]}.sig`);
    if (updaterSigned) {
      if (artifact.updater && !fs.existsSync(sig))
        throw new Error(`${sig} is missing though the updater key was configured`);
      if (fs.existsSync(sig)) {
        if (publicKey !== undefined) verifySig(path.join(dir, names[0]), sig, publicKey);
        fs.copyFileSync(sig, path.join(out, `${target}.sig`));
        written.push(`${target}.sig`);
      }
    } else if (fs.existsSync(sig)) {
      throw new Error(`${sig} exists though no updater key was configured`);
    }
  }
  const status = {
    platform,
    codeSigned: spec.os === "linux" ? null : codeSigned,
    notarized: spec.os === "macos" ? notarized : null,
    updaterSigned,
  };
  fs.writeFileSync(path.join(out, `status-${platform}.json`), JSON.stringify(status, null, 2) + "\n");
  return { written, status };
}

export function main(
  argv,
  io = { out: (s) => process.stdout.write(s), err: (s) => process.stderr.write(s) },
) {
  const o = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) {
      io.err(`release-collect: unknown argument ${a}\n`);
      return 2;
    }
    o[a.slice(2)] = argv[++i];
  }
  try {
    for (const need of ["platform", "bundle", "out", "version", "code-signed", "updater-signed"])
      if (o[need] === undefined) throw new Error(`--${need} is required`);
    // With the updater on, the signatures are checked against the public key that is committed: the one every app holds.
    let publicKey;
    const updaterSigned = bool(o["updater-signed"], "--updater-signed");
    if (updaterSigned) {
      const root = o.root ? path.resolve(o.root) : ROOT;
      const { state } = inspect(root);
      if (state !== "valid")
        throw new Error(
          `--updater-signed is true but the public key in ${CONFIG_FILE} is ${state}, not a minisign key`,
        );
      publicKey = JSON.parse(fs.readFileSync(path.join(root, CONFIG_FILE), "utf8")).plugins.updater.pubkey;
    }
    const { written } = collect({
      platform: o.platform,
      bundle: path.resolve(o.bundle),
      out: path.resolve(o.out),
      version: o.version,
      codeSigned: bool(o["code-signed"], "--code-signed"),
      notarized: bool(o.notarized ?? "false", "--notarized"),
      updaterSigned,
      publicKey,
    });
    io.out(`release-collect: ${written.join(", ")}\n`);
    return 0;
  } catch (err) {
    io.err(`release-collect: ${err.message}\n`);
    return 1;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main(process.argv.slice(2));
}
