#!/usr/bin/env node
/**
 * CycloneDX SBOM of the Rust crates the desktop app is built from (.specs/features/distribuicao): the companion of
 * `scripts/sbom.mjs`, which lists what npm brings and what the installer bundles.
 *
 *   node scripts/sbom-rust.mjs [--out <file>] [--root <dir>]     default: build/sbom/mordomo-desktop.cdx.json
 *
 * It reads no toolchain: the crates and their declared licenses are the table of `legal/THIRD_PARTY_NOTICES.desktop.md`
 * (which `node scripts/licenses-rust.mjs --check` keeps equal to `Cargo.lock`), and each crate's SHA-256 is its
 * `checksum` in `apps/desktop/Cargo.lock`. No timestamp and no random value: the same lock yields the same bytes.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { licensesOf, schemaIds } from "./sbom.mjs";
import { normalizeExpression } from "./licenses-rust.mjs";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const SBOM_FILE = path.join("build", "sbom", "mordomo-desktop.cdx.json");
const NOTICE = path.join("legal", "THIRD_PARTY_NOTICES.desktop.md");
const LOCK = path.join("apps", "desktop", "Cargo.lock");

const purlOf = (name, version) => `pkg:cargo/${name}@${version}`;

/** `{ name, version, license }` rows of the table of section 1 of the notice. */
export function noticeCrates(text) {
  const start = text.indexOf("## 1.");
  const end = text.indexOf("## 2.", start) >= 0 ? text.indexOf("## 2.", start) : text.indexOf("## 3.", start);
  if (start < 0 || end < 0) throw new Error(`${NOTICE}: the crate table (section 1) was not found`);
  return text
    .slice(start, end)
    .split("\n")
    .map((line) => /^\| ([^|]+) \| (\d[^|]*) \| (.+) \|$/.exec(line))
    .filter(Boolean)
    .map((m) => ({ name: m[1].trim(), version: m[2].trim(), license: m[3].replace(/\\\|/g, "|").trim() }));
}

/** name@version -> sha256 hex, from the `checksum` of each registry package of Cargo.lock. */
export function lockChecksums(text) {
  const out = new Map();
  for (const block of text.split("[[package]]").slice(1)) {
    const name = /^name = "([^"]+)"/m.exec(block)?.[1];
    const version = /^version = "([^"]+)"/m.exec(block)?.[1];
    const checksum = /^checksum = "([0-9a-f]{64})"/m.exec(block)?.[1];
    if (name && version && checksum) out.set(`${name}@${version}`, checksum);
  }
  return out;
}

export function buildRustSbom(root = ROOT) {
  const crates = noticeCrates(fs.readFileSync(path.join(root, NOTICE), "utf8"));
  const checksums = lockChecksums(fs.readFileSync(path.join(root, LOCK), "utf8"));
  const conf = JSON.parse(
    fs.readFileSync(path.join(root, "apps", "desktop", "src-tauri", "tauri.conf.json"), "utf8"),
  );
  const ids = schemaIds(root);
  const appRef = purlOf("mordomo-desktop", conf.version);
  const components = crates.map((c) => {
    const sha = checksums.get(`${c.name}@${c.version}`);
    return {
      type: "library",
      "bom-ref": purlOf(c.name, c.version),
      name: c.name,
      version: c.version,
      scope: "required",
      purl: purlOf(c.name, c.version),
      licenses: licensesOf(normalizeExpression(c.license), ids),
      hashes: sha ? [{ alg: "SHA-256", content: sha }] : [],
    };
  });
  components.sort((a, b) => (a["bom-ref"] < b["bom-ref"] ? -1 : a["bom-ref"] > b["bom-ref"] ? 1 : 0));
  const digest = crypto
    .createHash("sha1")
    .update(components.map((c) => c["bom-ref"]).join("\n"))
    .digest();
  digest[6] = (digest[6] & 0x0f) | 0x50;
  digest[8] = (digest[8] & 0x3f) | 0x80;
  const hex = digest.subarray(0, 16).toString("hex");
  return {
    $schema: "http://cyclonedx.org/schema/bom-1.5.schema.json",
    bomFormat: "CycloneDX",
    specVersion: "1.5",
    serialNumber: `urn:uuid:${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`,
    version: 1,
    metadata: {
      tools: { components: [{ type: "application", name: "mordomo-os scripts/sbom-rust.mjs" }] },
      component: {
        type: "application",
        "bom-ref": appRef,
        name: "mordomo-desktop",
        version: conf.version,
        licenses: licensesOf("FSL-1.1-ALv2", ids),
      },
    },
    components,
    dependencies: [{ ref: appRef, dependsOn: components.map((c) => c["bom-ref"]) }],
  };
}

export function main(
  argv,
  io = { out: (s) => process.stdout.write(s), err: (s) => process.stderr.write(s) },
) {
  let root = ROOT;
  let out = null;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--root") root = path.resolve(argv[++i] ?? "");
    else if (argv[i] === "--out") out = path.resolve(argv[++i] ?? "");
    else {
      io.err(
        `sbom-rust: unknown argument ${argv[i]}\nusage: node scripts/sbom-rust.mjs [--out <file>] [--root <dir>]\n`,
      );
      return 2;
    }
  }
  const target = out ?? path.join(root, SBOM_FILE);
  let bom;
  try {
    bom = buildRustSbom(root);
  } catch (err) {
    io.err(`sbom-rust: ${err.message}\n`);
    return 1;
  }
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, JSON.stringify(bom, null, 2) + "\n");
  io.out(`${path.relative(root, target) || target}: ${bom.components.length} components\n`);
  return 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main(process.argv.slice(2));
}
