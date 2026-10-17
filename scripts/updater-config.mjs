#!/usr/bin/env node
/**
 * Reads `apps/desktop/src-tauri/tauri.updater.conf.json`, the file a build adds (`--config`) to get the updater
 * (.specs/features/distribuicao, AC 30-33).
 *
 *   node scripts/updater-config.mjs --check     exit 1 unless the file is well formed (a placeholder key is well formed)
 *   node scripts/updater-config.mjs --state     prints `valid` (a real minisign public key), `placeholder` or `invalid`
 *   (both: --root <dir>)
 *
 * The public key is the owner's (`npx tauri signer generate`); until it is in the file the build has no updater.
 * A minisign public key as Tauri wants it is the base64 of the two-line `.pub` file: an `untrusted comment:` line and
 * the key line, whose base64 is 42 bytes: `Ed`, an 8-byte key id and the 32-byte Ed25519 key.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const CONFIG_FILE = "apps/desktop/src-tauri/tauri.updater.conf.json";
/** The one endpoint: the `latest.json` of the newest published release (door 4). */
export const ENDPOINT = "https://github.com/tvpl/agentic-os/releases/latest/download/latest.json";
const PLACEHOLDER = "[A PREENCHER PELO DONO";

/** `valid`, `placeholder` or `invalid` for the `pubkey` string. */
export function keyState(pubkey) {
  if (typeof pubkey !== "string" || pubkey.trim() === "") return "invalid";
  if (pubkey.startsWith(PLACEHOLDER)) return "placeholder";
  const decoded = Buffer.from(pubkey.trim(), "base64").toString("utf8");
  const lines = decoded.split("\n").filter((l) => l !== "");
  if (lines.length < 2 || !/^untrusted comment: minisign public key/.test(lines[0])) return "invalid";
  const key = Buffer.from(lines[1].trim(), "base64");
  return key.length === 42 && key.subarray(0, 2).toString("latin1") === "Ed" ? "valid" : "invalid";
}

export function inspect(root = ROOT) {
  const problems = [];
  let conf;
  try {
    conf = JSON.parse(fs.readFileSync(path.join(root, CONFIG_FILE), "utf8"));
  } catch (err) {
    return { state: "invalid", problems: [`${CONFIG_FILE} cannot be read: ${err.message}`] };
  }
  const updater = conf.plugins?.updater;
  const state = keyState(updater?.pubkey);
  if (state === "invalid")
    problems.push(
      `${CONFIG_FILE}: plugins.updater.pubkey is not a minisign public key (nor the placeholder)`,
    );
  if (JSON.stringify(updater?.endpoints) !== JSON.stringify([ENDPOINT]))
    problems.push(`${CONFIG_FILE}: plugins.updater.endpoints must be exactly [${ENDPOINT}]`);
  if (conf.bundle?.createUpdaterArtifacts !== true)
    problems.push(`${CONFIG_FILE}: bundle.createUpdaterArtifacts must be true`);
  if (updater?.dangerousInsecureTransportProtocol !== undefined)
    problems.push(`${CONFIG_FILE}: dangerousInsecureTransportProtocol must not be set`);
  return { state, problems };
}

export function main(
  argv,
  io = { out: (s) => process.stdout.write(s), err: (s) => process.stderr.write(s) },
) {
  let root = ROOT;
  let mode = null;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--root") root = path.resolve(argv[++i] ?? "");
    else if (a === "--check" || a === "--state") mode = a.slice(2);
    else {
      io.err(`updater-config: unknown argument ${a}\n`);
      return 2;
    }
  }
  if (mode === null) {
    io.err("usage: node scripts/updater-config.mjs --check | --state [--root <dir>]\n");
    return 2;
  }
  const { state, problems } = inspect(root);
  if (mode === "state") {
    io.out(`${problems.length > 0 ? "invalid" : state}\n`);
    return 0;
  }
  if (problems.length > 0) {
    io.err(`updater-config: ${problems.join("\n  - ")}\n`);
    return 1;
  }
  io.out(`updater-config: ok (public key: ${state})\n`);
  return 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main(process.argv.slice(2));
}
