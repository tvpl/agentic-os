#!/usr/bin/env node
/**
 * The notes of a draft release (.specs/features/distribuicao, AC 39-41): the CHANGELOG section of the version, and a table
 * that says, platform by platform, what was and was not signed. An unsigned platform is named in a banner at the top.
 *
 *   node scripts/release-notes.mjs --version 0.9.0 [--changelog CHANGELOG.md] [--status <dir>] [--out notes.md]
 *   node scripts/release-notes.mjs --version 0.9.0 --check         exit 1 when the CHANGELOG has no such section
 *   (all: --root <dir>)
 *
 * `--status <dir>` reads every `status-<platform>.json` that `scripts/release-collect.mjs` wrote:
 * `{ platform, codeSigned, notarized, updaterSigned }` (`codeSigned`/`notarized`: null where the platform has none).
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** The body of `## <version>` (also `## [<version>]`, with or without a date after a dash) up to the next `## `. */
export function changelogSection(text, version) {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  const heading = new RegExp(`^##\\s+\\[?${escapeRe(version)}\\]?(?:\\s+[—–-].*)?\\s*$`);
  const start = lines.findIndex((l) => heading.test(l));
  if (start < 0) return null;
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((l) => /^##\s/.test(l));
  const body = (end < 0 ? rest : rest.slice(0, end)).join("\n").trim();
  return body === "" ? null : body;
}

const word = (value, yes = "yes", no = "NO", none = "not applicable") =>
  value === null ? none : value ? yes : no;

/** The Markdown of the notes. `statuses` is the list of `status-*.json` contents (may be empty). */
export function renderNotes(version, section, statuses) {
  const sorted = [...statuses].sort((a, b) =>
    a.platform < b.platform ? -1 : a.platform > b.platform ? 1 : 0,
  );
  const unsigned = sorted.filter((s) => s.codeSigned === false);
  const out = [];
  if (unsigned.length > 0)
    out.push(
      `> **UNSIGNED / NÃO ASSINADO: ${unsigned.map((s) => s.platform).join(", ")}.** The installers of ${unsigned.length === 1 ? "this platform were" : "these platforms were"} built without a signing certificate (the repository secrets were not registered when this release ran) and carry \`UNSIGNED\` in their file name. The operating system will warn before it opens them. Do not publish this release as it is.`,
      "",
    );
  out.push(section, "");
  if (sorted.length > 0) {
    out.push(
      "## Signatures",
      "",
      "| Platform | Operating-system signature | Notarized | Updater signature (minisign) |",
      "| --- | --- | --- | --- |",
      ...sorted.map(
        (s) =>
          `| ${s.platform} | ${word(s.codeSigned)} | ${word(s.notarized)} | ${word(s.updaterSigned, "yes", "no (no updater key)")} |`,
      ),
      "",
      "Linux packages carry no operating-system signature; check `SHA256SUMS.txt`. How to verify each signature: `docs/release.md`.",
      "",
    );
  }
  out.push(
    "## What is attached",
    "",
    "- the installers, `SHA256SUMS.txt`",
    "- `sbom.cdx.json` and `sbom.desktop.cdx.json` (CycloneDX 1.5: the npm side and the Rust crates), `THIRD_PARTY_NOTICES.md` and `THIRD_PARTY_NOTICES.desktop.md`",
    "- `latest.json` (the updater manifest), only when every platform signed",
    "",
  );
  return out.join("\n");
}

export function readStatuses(dir) {
  if (!dir || !fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir, { recursive: true })
    .map(String)
    .filter((f) => /(^|[\\/])status-[a-z0-9-]+\.json$/.test(f))
    .map((f) => JSON.parse(fs.readFileSync(path.join(dir, f), "utf8")));
}

export function main(
  argv,
  io = { out: (s) => process.stdout.write(s), err: (s) => process.stderr.write(s) },
) {
  let root = ROOT;
  let version;
  let changelog = "CHANGELOG.md";
  let statusDir;
  let out;
  let check = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--root") root = path.resolve(argv[++i] ?? "");
    else if (a === "--version") version = argv[++i];
    else if (a === "--changelog") changelog = argv[++i];
    else if (a === "--status") statusDir = argv[++i];
    else if (a === "--out") out = argv[++i];
    else if (a === "--check") check = true;
    else {
      io.err(`release-notes: unknown argument ${a}\n`);
      return 2;
    }
  }
  if (!version) {
    io.err(
      "usage: node scripts/release-notes.mjs --version <x.y.z> [--check] [--changelog <file>] [--status <dir>] [--out <file>]\n",
    );
    return 2;
  }
  const file = path.resolve(root, changelog);
  const section = changelogSection(fs.readFileSync(file, "utf8"), version);
  if (section === null) {
    io.err(
      `release-notes: ${changelog} has no section "## ${version}" with a body. Rename "## Unreleased" to "## ${version} — <date>" before tagging.\n`,
    );
    return 1;
  }
  if (check) {
    io.out(`release-notes: ok (${changelog} has a section for ${version})\n`);
    return 0;
  }
  const notes = renderNotes(
    version,
    section,
    readStatuses(statusDir ? path.resolve(root, statusDir) : undefined),
  );
  if (out) fs.writeFileSync(path.resolve(root, out), notes);
  else io.out(notes);
  return 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main(process.argv.slice(2));
}
