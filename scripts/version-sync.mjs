#!/usr/bin/env node
/**
 * One version for everything the installer carries (.specs/features/distribuicao, AC 34-36).
 *
 *   node scripts/version-sync.mjs --check [--tag v1.2.3]   exit 1 naming each file whose version differs
 *   node scripts/version-sync.mjs --write <semver>          set them all (and the workspaces' exact pins on each other)
 *   (both: --root <dir> to read another tree)
 *
 * The version of the root `package.json` is the one the others are compared with. They are: the nine `package.json`
 * of the workspaces, the workspace entries of `package-lock.json`, `apps/desktop/src-tauri/tauri.conf.json`, the
 * `[workspace.package]` of `apps/desktop/Cargo.toml` and the two crates of the desktop workspace in `Cargo.lock`.
 * `--tag` also requires the tag to be `v` followed by that version, which is what the release workflow asks.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SEMVER =
  /^\d+\.\d+\.\d+(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;
const CARGO_TOML = "apps/desktop/Cargo.toml";
const CARGO_LOCK = "apps/desktop/Cargo.lock";
const TAURI_CONF = "apps/desktop/src-tauri/tauri.conf.json";
const DESKTOP_CRATES = ["mordomo-desktop", "mordomo-shell-core"];

const read = (root, file) => fs.readFileSync(path.join(root, file), "utf8");
const readJson = (root, file) => JSON.parse(read(root, file));

/** The root `package.json`, then each workspace it lists, as relative paths with forward slashes. */
export function packageFiles(root) {
  const workspaces = readJson(root, "package.json").workspaces ?? [];
  return ["package.json", ...workspaces.map((w) => `${w}/package.json`)];
}

/** Every place a version is written: `{ file, what, version }`, in a fixed order. */
export function readVersions(root = ROOT) {
  const found = [];
  const lock = readJson(root, "package-lock.json");
  for (const file of packageFiles(root)) {
    const pkg = readJson(root, file);
    found.push({ file, what: "version", version: pkg.version });
    for (const section of ["dependencies", "devDependencies", "optionalDependencies", "peerDependencies"])
      for (const [name, range] of Object.entries(pkg[section] ?? {}))
        if (name.startsWith("@mordomo/") && /^\d/.test(range))
          found.push({ file, what: `${section}.${name}`, version: range });
  }
  const workspaceKeys = new Set([
    "",
    ...packageFiles(root)
      .map((f) => path.posix.dirname(f))
      .filter((d) => d !== "."),
  ]);
  for (const key of [...workspaceKeys].sort()) {
    const entry = lock.packages?.[key];
    if (!entry) {
      found.push({ file: "package-lock.json", what: `packages["${key}"]`, version: undefined });
      continue;
    }
    found.push({ file: "package-lock.json", what: `packages["${key}"].version`, version: entry.version });
    for (const [name, range] of Object.entries(entry.dependencies ?? {}))
      if (name.startsWith("@mordomo/") && /^\d/.test(range))
        found.push({
          file: "package-lock.json",
          what: `packages["${key}"].dependencies.${name}`,
          version: range,
        });
  }
  found.push({ file: TAURI_CONF, what: "version", version: readJson(root, TAURI_CONF).version });
  const toml = read(root, CARGO_TOML);
  const section = /\[workspace\.package\]([^[]*)/.exec(toml)?.[1] ?? "";
  found.push({
    file: CARGO_TOML,
    what: "[workspace.package] version",
    version: /^version\s*=\s*"([^"]*)"/m.exec(section)?.[1],
  });
  const cargoLock = read(root, CARGO_LOCK);
  for (const crate of DESKTOP_CRATES)
    found.push({
      file: CARGO_LOCK,
      what: `crate ${crate}`,
      version: new RegExp(`\\[\\[package\\]\\]\\s*name = "${crate}"\\s*version = "([^"]*)"`).exec(
        cargoLock,
      )?.[1],
    });
  return found;
}

/** The problems of a tree: what differs from the root version, and a tag that is not `v<version>`. */
export function problems(root = ROOT, tag = undefined) {
  const found = readVersions(root);
  const expected = found[0].version;
  const out = [];
  if (typeof expected !== "string" || !SEMVER.test(expected))
    return [`package.json: version ${JSON.stringify(expected)} is not a semantic version`];
  for (const item of found.slice(1))
    if (item.version !== expected)
      out.push(`${item.file}: ${item.what} is ${JSON.stringify(item.version)}, expected ${expected}`);
  if (tag !== undefined && tag !== `v${expected}`) out.push(`tag ${JSON.stringify(tag)} is not v${expected}`);
  return out;
}

/** Set every version to `version`. Throws when it is not a semantic version. */
export function write(root, version) {
  if (!SEMVER.test(version))
    throw new Error(`${JSON.stringify(version)} is not a semantic version (1.2.3, 1.2.3-rc.1)`);
  const put = (file, text) => fs.writeFileSync(path.join(root, file), text);
  const json = (value) => JSON.stringify(value, null, 2) + "\n";
  const pin = (deps) => {
    for (const name of Object.keys(deps ?? {}))
      if (name.startsWith("@mordomo/") && /^\d/.test(deps[name])) deps[name] = version;
  };
  const sections = ["dependencies", "devDependencies", "optionalDependencies", "peerDependencies"];
  const workspaceKeys = new Set([""]);
  for (const file of packageFiles(root)) {
    const pkg = readJson(root, file);
    pkg.version = version;
    for (const section of sections) pin(pkg[section]);
    put(file, json(pkg));
    const dir = path.posix.dirname(file);
    if (dir !== ".") workspaceKeys.add(dir);
  }
  const lock = readJson(root, "package-lock.json");
  for (const key of workspaceKeys) {
    const entry = lock.packages?.[key];
    if (!entry) continue;
    entry.version = version;
    for (const section of sections) pin(entry[section]);
  }
  put("package-lock.json", json(lock));
  const conf = readJson(root, TAURI_CONF);
  conf.version = version;
  put(TAURI_CONF, json(conf));
  put(
    CARGO_TOML,
    read(root, CARGO_TOML).replace(
      /(\[workspace\.package\][^[]*?\nversion\s*=\s*")[^"]*(")/,
      `$1${version}$2`,
    ),
  );
  let cargoLock = read(root, CARGO_LOCK);
  for (const crate of DESKTOP_CRATES)
    cargoLock = cargoLock.replace(
      new RegExp(`(\\[\\[package\\]\\]\\s*name = "${crate}"\\s*version = ")[^"]*(")`),
      `$1${version}$2`,
    );
  put(CARGO_LOCK, cargoLock);
}

export function main(
  argv,
  io = { out: (s) => process.stdout.write(s), err: (s) => process.stderr.write(s) },
) {
  let root = ROOT;
  let mode = null;
  let tag;
  let target;
  const usage =
    "usage: node scripts/version-sync.mjs --check [--tag vX.Y.Z] | --write <semver>  [--root <dir>]\n";
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--root") root = path.resolve(argv[++i] ?? "");
    else if (a === "--check") mode = "check";
    else if (a === "--write") {
      mode = "write";
      target = argv[++i];
    } else if (a === "--tag") tag = argv[++i];
    else {
      io.err(`version-sync: unknown argument ${a}\n${usage}`);
      return 2;
    }
  }
  if (
    mode === null ||
    (mode === "write" && !target) ||
    (tag !== undefined && mode !== "check") ||
    tag === ""
  ) {
    io.err(usage);
    return 2;
  }
  try {
    if (mode === "write") {
      write(root, target);
      io.out(`version-sync: every version is now ${target}\n`);
      return 0;
    }
    const found = problems(root, tag);
    if (found.length > 0) {
      io.err(`version-sync: the versions differ\n${found.map((p) => `  - ${p}`).join("\n")}\n`);
      return 1;
    }
    io.out(
      `version-sync: ok (${readVersions(root).length} places, all ${readVersions(root)[0].version}${tag ? `, tag ${tag}` : ""})\n`,
    );
    return 0;
  } catch (err) {
    io.err(`version-sync: ${err.message}\n`);
    return 2;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main(process.argv.slice(2));
}
