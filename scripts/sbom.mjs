#!/usr/bin/env node
/**
 * CycloneDX SBOM of what the installer carries (.specs/features/licenca-comercial, door 7).
 *
 *   node scripts/sbom.mjs [--out <file>] [--root <dir>]     default: build/sbom/mordomo-os.cdx.json
 *
 * Written from package-lock.json, the same source and the same distributed set as the third-party
 * notice (`scripts/licenses.mjs`), so the two cannot disagree. No timestamp and no random value: the same
 * lockfile yields the same bytes. `npm sbom` was tried first and left out: in this monorepo it omits 23 of the
 * 184 distributed packages (react, react-dom, zod, ajv, picocolors…) whatever the flags.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { lockPackages, parseSpdx, readLock, licenseOf, loadPolicy, ROOT } from "./licenses.mjs";

export const SBOM_FILE = path.join("build", "sbom", "mordomo-os.cdx.json");

const purlOf = (name, version) => `pkg:npm/${name.replace(/^@/, "%40")}@${version}`;

const ALGORITHMS = { sha1: "SHA-1", sha256: "SHA-256", sha384: "SHA-384", sha512: "SHA-512" };
function hashOf(integrity) {
  const m = /^(sha1|sha256|sha384|sha512)-(.+)$/.exec(integrity ?? "");
  return m ? [{ alg: ALGORITHMS[m[1]], content: Buffer.from(m[2], "base64").toString("hex") }] : [];
}

/** The licence ids the CycloneDX 1.5 schema accepts in `license.id` (its own copy of the SPDX list, vendored). */
let spdxIds = null;
export function schemaIds(root) {
  if (spdxIds === null) {
    const file = path.join(root, "legal", "vendor", "cyclonedx", "spdx.schema.json");
    spdxIds = new Set(fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")).enum : []);
  }
  return spdxIds;
}

/** One id the schema knows → `license.id`; an expression (OR, AND, WITH) → `expression`, whole; anything else → `name`. */
export function licensesOf(expression, ids) {
  if (expression === null) return [];
  const tree = parseSpdx(expression);
  if (tree === null) return [{ license: { name: expression } }];
  if (tree.id && !tree.exception)
    return ids.has(tree.id) ? [{ license: { id: tree.id } }] : [{ license: { name: tree.id } }];
  return [{ expression }];
}

/** The package a name resolves to from `fromKey`, the way Node looks it up: nearest node_modules upward. */
function resolveKey(keys, fromKey, name) {
  let dir = fromKey;
  for (;;) {
    const candidate = dir ? `${dir}/node_modules/${name}` : `node_modules/${name}`;
    if (keys.has(candidate)) return candidate;
    if (!dir) return null;
    const at = dir.lastIndexOf("/node_modules/");
    dir = at >= 0 ? dir.slice(0, at) : dir.startsWith("node_modules/") ? "" : "";
  }
}

export function buildSbom(root = ROOT) {
  const policy = loadPolicy(root);
  const lock = readLock(root);
  const rootManifest = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
  const distributed = lockPackages(root).filter((p) => p.tier === "distributed");
  const byKey = new Map(distributed.map((p) => [p.key, p]));
  const keys = new Set(Object.keys(lock.packages));

  const ids = schemaIds(root);
  const ref = (p) => purlOf(p.name, p.version);
  // Two copies of one name@version (a nested semver next to another) are one component: bom-ref is unique.
  const unique = [...new Map(distributed.map((p) => [ref(p), p])).values()];
  const components = unique.map((p) => {
    const { expression } = licenseOf(p, policy.overrides);
    return {
      type: "library",
      "bom-ref": ref(p),
      name: p.name,
      version: p.version,
      scope: "required",
      purl: ref(p),
      licenses: licensesOf(expression, ids),
      hashes: hashOf(p.integrity),
      externalReferences: p.resolved ? [{ type: "distribution", url: p.resolved }] : [],
    };
  });

  const dependsOn = (fromKey, deps) =>
    [
      ...new Set(
        Object.keys(deps)
          .map((name) => resolveKey(keys, fromKey, name))
          .filter((key) => key !== null && byKey.has(key))
          .map((key) => ref(byKey.get(key))),
      ),
    ].sort();

  const appRef = `${rootManifest.name}@${rootManifest.version}`;
  const workspaceDeps = {};
  for (const [key, entry] of Object.entries(lock.packages))
    if (key && !key.includes("node_modules/"))
      Object.assign(workspaceDeps, entry.dependencies ?? {}, entry.optionalDependencies ?? {});
  const dependencies = [
    {
      ref: appRef,
      dependsOn: dependsOn("", workspaceDeps).filter((r) => !r.startsWith("pkg:npm/%40mordomo/")),
    },
    ...unique.map((p) => ({
      ref: ref(p),
      dependsOn: [
        ...new Set(
          distributed.filter((q) => ref(q) === ref(p)).flatMap((q) => dependsOn(q.key, q.dependencies)),
        ),
      ].sort(),
    })),
  ].sort((a, b) => (a.ref < b.ref ? -1 : a.ref > b.ref ? 1 : 0));
  // What the installer carries and npm does not name: Node.js, SQLite, the fonts (legal/license-policy.json `bundled`).
  const bundled = policy.bundled.map((b) => ({
    type: b.sbom.type,
    "bom-ref": b.sbom.ref,
    name: b.name.replace(/ \(fonte\)$/, ""),
    scope: "required",
    ...(b.sbom.purl ? { purl: b.sbom.purl } : {}),
    licenses: [
      {
        license:
          b.sbom.license.id && ids.has(b.sbom.license.id)
            ? { id: b.sbom.license.id }
            : { name: b.sbom.license.id ?? b.sbom.license.name },
      },
    ],
    ...(b.url ? { externalReferences: [{ type: "website", url: b.url }] } : {}),
  }));
  components.push(...bundled);
  dependencies[dependencies.findIndex((d) => d.ref === appRef)].dependsOn.push(
    ...bundled.map((b) => b["bom-ref"]),
  );
  dependencies[dependencies.findIndex((d) => d.ref === appRef)].dependsOn.sort();
  dependencies.push(...bundled.map((b) => ({ ref: b["bom-ref"], dependsOn: [] })));
  dependencies.sort((a, b) => (a.ref < b.ref ? -1 : a.ref > b.ref ? 1 : 0));
  components.sort((a, b) => (a["bom-ref"] < b["bom-ref"] ? -1 : a["bom-ref"] > b["bom-ref"] ? 1 : 0));

  // A serial number that follows the content: RFC 4122 layout (version 5 style) over a SHA-1 of the purls.
  const digest = crypto
    .createHash("sha1")
    .update(components.map((c) => c["bom-ref"]).join("\n"))
    .digest();
  digest[6] = (digest[6] & 0x0f) | 0x50;
  digest[8] = (digest[8] & 0x3f) | 0x80;
  const hex = digest.subarray(0, 16).toString("hex");
  const serial = `urn:uuid:${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;

  return {
    $schema: "http://cyclonedx.org/schema/bom-1.5.schema.json",
    bomFormat: "CycloneDX",
    specVersion: "1.5",
    serialNumber: serial,
    version: 1,
    metadata: {
      tools: { components: [{ type: "application", name: "mordomo-os scripts/sbom.mjs" }] },
      component: {
        type: "application",
        "bom-ref": appRef,
        name: rootManifest.name,
        version: rootManifest.version,
        licenses: licensesOf(rootManifest.license, ids),
      },
    },
    components,
    dependencies,
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
        `sbom: unknown argument ${argv[i]}\nusage: node scripts/sbom.mjs [--out <file>] [--root <dir>]\n`,
      );
      return 2;
    }
  }
  const target = out ?? path.join(root, SBOM_FILE);
  let bom;
  try {
    bom = buildSbom(root);
  } catch (err) {
    io.err(`sbom: ${err.message}\n`);
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
