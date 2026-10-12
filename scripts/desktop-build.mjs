#!/usr/bin/env node
/**
 * Build the desktop installers: `tauri build` with the arguments and the environment this machine's secrets allow
 * (.specs/features/distribuicao, AC 38-39). Nothing is invented: what is not registered is not passed, and a build
 * without signing material still produces installers, which `scripts/release-collect.mjs` then names UNSIGNED.
 *
 *   node scripts/desktop-build.mjs --platform macos-arm64|macos-x64|windows-x64|linux-x64 [--print]
 *
 * Reads, all optional (the workflow sets them from its `plan` job and from the repository secrets):
 *   UPDATER_ENABLED=true            add the updater: `--features updater` and `tauri.updater.conf.json` (needs
 *                                   TAURI_SIGNING_PRIVATE_KEY, and optionally TAURI_SIGNING_PRIVATE_KEY_PASSWORD)
 *   MAC_SIGNED=true                 keep APPLE_SIGNING_IDENTITY (the certificate is already in the keychain)
 *   MAC_NOTARIZE=true               keep APPLE_ID, APPLE_PASSWORD and APPLE_TEAM_ID (the notary service is asked)
 *   WINDOWS_CERT_THUMBPRINT=<hex>   sign with that certificate of the store (SHA-256, RFC 3161 timestamp)
 * `--print` writes the command and the names of the signing variables it keeps, and runs nothing.
 */
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PLATFORMS } from "./release-collect.mjs";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const BUNDLES = { macos: "app,dmg", windows: "nsis", linux: "deb,appimage" };
const APPLE_SIGN = ["APPLE_SIGNING_IDENTITY"];
const APPLE_NOTARY = ["APPLE_ID", "APPLE_PASSWORD", "APPLE_TEAM_ID"];
/** Variables Tauri reads that mean "sign" or "notarize": absent unless this machine has the material for them. */
const SIGNING_VARIABLES = [...APPLE_SIGN, ...APPLE_NOTARY, "APPLE_CERTIFICATE", "APPLE_CERTIFICATE_PASSWORD"];
const TIMESTAMP_URL = "http://timestamp.digicert.com";

/** The `tauri build` arguments and the environment for `platform`, from `env`. Pure. */
export function plan(platform, env) {
  const spec = PLATFORMS[platform];
  if (!spec) throw new Error(`unknown platform ${platform} (${Object.keys(PLATFORMS).join(", ")})`);
  const args = ["build", "--ci", "--bundles", BUNDLES[spec.os]];
  const childEnv = { ...env };
  // Tauri treats a variable that is set and empty as set: an unregistered secret must not reach it at all.
  for (const name of [...SIGNING_VARIABLES, "TAURI_SIGNING_PRIVATE_KEY"])
    if (!childEnv[name]) delete childEnv[name];
  if (spec.os === "macos") {
    // Without MAC_SIGNED nothing of Apple's reaches Tauri, which then signs ad hoc; without MAC_NOTARIZE it does not notarize.
    if (env.MAC_SIGNED !== "true") for (const n of [...APPLE_SIGN, ...APPLE_NOTARY]) delete childEnv[n];
    else if (env.MAC_NOTARIZE !== "true") for (const n of APPLE_NOTARY) delete childEnv[n];
  } else for (const n of [...APPLE_SIGN, ...APPLE_NOTARY]) delete childEnv[n];
  const configs = [];
  if (spec.os === "windows" && env.WINDOWS_CERT_THUMBPRINT) {
    configs.push(
      JSON.stringify({
        bundle: {
          windows: {
            certificateThumbprint: env.WINDOWS_CERT_THUMBPRINT,
            digestAlgorithm: "sha256",
            timestampUrl: TIMESTAMP_URL,
          },
        },
      }),
    );
  }
  if (env.UPDATER_ENABLED === "true") {
    if (!childEnv.TAURI_SIGNING_PRIVATE_KEY)
      throw new Error("UPDATER_ENABLED is true but TAURI_SIGNING_PRIVATE_KEY is not set");
    args.push("--features", "updater");
    configs.unshift("src-tauri/tauri.updater.conf.json");
  } else delete childEnv.TAURI_SIGNING_PRIVATE_KEY;
  for (const config of configs) args.push("--config", config);
  return { args, env: childEnv };
}

export function main(
  argv,
  io = { out: (s) => process.stdout.write(s), err: (s) => process.stderr.write(s) },
) {
  let platform;
  let print = false;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--platform") platform = argv[++i];
    else if (argv[i] === "--print") print = true;
    else {
      io.err(`desktop-build: unknown argument ${argv[i]}\n`);
      return 2;
    }
  }
  if (!platform) {
    io.err(
      "usage: node scripts/desktop-build.mjs --platform <macos-arm64|macos-x64|windows-x64|linux-x64> [--print]\n",
    );
    return 2;
  }
  let built;
  try {
    built = plan(platform, process.env);
  } catch (err) {
    io.err(`desktop-build: ${err.message}\n`);
    return 1;
  }
  if (print) {
    const kept = [...SIGNING_VARIABLES, "TAURI_SIGNING_PRIVATE_KEY"].filter((n) => built.env[n]);
    io.out(`tauri ${built.args.join(" ")}\nsigning variables kept: ${kept.join(", ") || "none"}\n`);
    return 0;
  }
  // The CLI the lockfile pins, run by the Node that runs this script: never `npx`, which would fetch whatever is newest.
  const cli = path.join(ROOT, "node_modules", "@tauri-apps", "cli", "tauri.js");
  const res = spawnSync(process.execPath, [cli, ...built.args], {
    cwd: path.join(ROOT, "apps", "desktop"),
    env: built.env,
    stdio: "inherit",
  });
  return res.status ?? 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main(process.argv.slice(2));
}
