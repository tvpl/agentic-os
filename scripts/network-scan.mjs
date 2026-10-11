#!/usr/bin/env node
/**
 * The sweep of every place the code can reach the network (.specs/features/licenca-comercial, door 5).
 *
 *   node scripts/network-scan.mjs            table of the points and the hosts found
 *   node scripts/network-scan.mjs --json     the same, for a machine
 *   node scripts/network-scan.mjs --check    exit 1 when the code and legal/network-policy.json disagree
 *   (all: --root <dir> to scan another tree)
 *
 * It reads the syntax tree of every TypeScript / JavaScript file of the product (comments, types and strings
 * that merely mention a word do not count) and the text of the CSS, HTML, JSON and shell files that ship, and
 * reports:
 *
 *   - network points: a call or reference to `fetch`; an import of node:http / https / http2 / net / tls / dns /
 *     dgram, undici, ws, node-fetch…; `EventSource`, `WebSocket`, `XMLHttpRequest`, `sendBeacon`; the npm CLI
 *     (`npm-cli.js`); `curl` / `wget`;
 *   - hosts: the host of a URL literal, a bare host constant (`"api.telegram.org"`) and the hosts in a regular
 *     expression (`/^fcm\.googleapis\.com$/`), loopback excluded.
 *
 * `legal/network-policy.json` has to know every one of them, and `legal/PRIVACY.md` has to name every host the
 * policy knows (tests/legal.network.test.ts). A new `fetch` in an approved file moves its count and fails
 * the check: whoever adds it has to say where it goes.
 *
 * DRAFT for the owner's legal review: engineering, not legal advice.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const POLICY_FILE = path.join("legal", "network-policy.json");

/** Where the product's own code and shipped text live. Tests, build output and dependencies are not the product. */
export const SCAN_DIRS = [
  "core/src",
  "contracts/src",
  "adapters",
  "apps/api/src",
  "apps/command-centre/src",
  "apps/command-centre/public",
  "apps/command-centre/index.html",
  "scripts",
  "connectors",
  "routines",
  "skills",
];
const CODE = /\.(ts|tsx|mjs|js|cjs)$/;
const TEXT = /\.(css|html|json|webmanifest|sh|ps1|swift|plist|md)$/;
const SKIPPED =
  /(^|\/)(node_modules|dist|build|release|coverage)(\/|$)|\.test\.[a-z]+$|\.d\.ts$|\.spec\.[a-z]+$|^scripts\/network-scan\.mjs$/;

const NETWORK_MODULES = new Set([
  "http",
  "https",
  "http2",
  "net",
  "tls",
  "dns",
  "dns/promises",
  "dgram",
  "undici",
  "ws",
  "node-fetch",
  "cross-fetch",
  "axios",
  "got",
  "superagent",
  "socket.io-client",
]);
const NETWORK_GLOBALS = new Map([
  ["EventSource", "eventsource"],
  ["WebSocket", "websocket"],
  ["XMLHttpRequest", "xhr"],
  ["WebTransport", "webtransport"],
]);
/** Strings that mean the code reaches the network through a program. */
const NETWORK_PROGRAMS = new Map([
  ["npm-cli.js", "npm-cli"],
  ["npx-cli.js", "npm-cli"],
  ["curl", "curl"],
  ["wget", "wget"],
]);

/** Hosts that never leave the machine. */
const LOOPBACK = /^(localhost|127(\.\d{1,3}){3}|0\.0\.0\.0|\[?::1\]?|\[?::\]?)$/i;
/** Top-level domains a bare host constant or a host regular expression can end in (`in`, `local`, `co`… are also i18n key tails). */
const TLDS = "com|org|net|io|dev|app|software|ai|tv|cloud|edu|gov";
const BARE_HOST = new RegExp(`^(?:[a-z0-9-]+\\.)+(?:${TLDS})$`);
const HOST_IN_TEXT = new RegExp(`(?:[a-z0-9-]+\\.)+(?:${TLDS})(?![a-z0-9-])`, "g");
const URL_HOST = /\b(?:https?|wss?):\/\/(?:[^\s/@'"`<>]*@)?(\[[0-9A-Fa-f:.]+\]|[A-Za-z0-9.-]+)(?::\d+)?/gi;

const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

const hostOf = (raw) => raw.replace(/\.+$/, "").toLowerCase();

// ---- reading one file ---------------------------------------------------------------------------------------

const isTypePosition = (node) => {
  for (let p = node.parent; p; p = p.parent) {
    if (ts.isTypeNode(p) || ts.isTypeAliasDeclaration(p) || ts.isInterfaceDeclaration(p)) return true;
    if (ts.isStatement(p) || ts.isBlock(p) || ts.isExpression(p)) return false;
  }
  return false;
};

/** An identifier that only names something (a parameter, a property, an import binding) is not a use of it. */
function isDeclarationName(node) {
  const p = node.parent;
  return (
    (ts.isParameter(p) && p.name === node) ||
    (ts.isVariableDeclaration(p) && p.name === node) ||
    (ts.isBindingElement(p) && p.name === node && !p.propertyName) ||
    (ts.isPropertyAssignment(p) && p.name === node) ||
    (ts.isPropertyDeclaration(p) && p.name === node) ||
    (ts.isPropertySignature(p) && p.name === node) ||
    (ts.isMethodDeclaration(p) && p.name === node) ||
    (ts.isFunctionDeclaration(p) && p.name === node) ||
    (ts.isClassDeclaration(p) && p.name === node) ||
    ts.isImportSpecifier(p) ||
    ts.isImportClause(p) ||
    ts.isNamespaceImport(p) ||
    ts.isExportSpecifier(p) ||
    (ts.isPropertyAccessExpression(p) && p.name === node && !isGlobalObject(p.expression))
  );
}
const isGlobalObject = (e) =>
  ts.isIdentifier(e) && (e.text === "globalThis" || e.text === "window" || e.text === "self");

/** The points and hosts of one source file: `{ points: Map<kind, count>, hosts: Set<host> }`. */
export function scanSource(source, fileName = "source.ts") {
  const kind = /\.tsx$/.test(fileName)
    ? ts.ScriptKind.TSX
    : /\.(ts)$/.test(fileName)
      ? ts.ScriptKind.TS
      : ts.ScriptKind.JS;
  const file = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, kind);
  const points = new Map();
  const hosts = new Set();
  const point = (name) => points.set(name, (points.get(name) ?? 0) + 1);

  const hostsInString = (text) => {
    for (const m of text.matchAll(URL_HOST)) hosts.add(hostOf(m[1]));
    if (BARE_HOST.test(text)) hosts.add(text.toLowerCase());
  };
  const moduleSpecifier = (spec) => {
    const name = spec.replace(/^node:/, "");
    if (NETWORK_MODULES.has(name)) point(`module:${name}`);
  };

  const visit = (node) => {
    if (ts.isIdentifier(node)) {
      if (node.text === "fetch" && !isTypePosition(node) && !isDeclarationName(node)) point("fetch");
      else if (NETWORK_GLOBALS.has(node.text) && !isTypePosition(node) && !isDeclarationName(node))
        point(NETWORK_GLOBALS.get(node.text));
    } else if (ts.isPropertyAccessExpression(node) && node.name.text === "sendBeacon") point("beacon");
    else if (
      ts.isElementAccessExpression(node) &&
      ts.isStringLiteralLike(node.argumentExpression) &&
      node.argumentExpression.text === "sendBeacon"
    )
      point("beacon");

    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier))
      moduleSpecifier(node.moduleSpecifier.text);
    else if (ts.isExportDeclaration(node) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier))
      moduleSpecifier(node.moduleSpecifier.text);
    else if (
      ts.isCallExpression(node) &&
      node.arguments.length > 0 &&
      ts.isStringLiteralLike(node.arguments[0]) &&
      ((ts.isIdentifier(node.expression) && node.expression.text === "require") ||
        node.expression.kind === ts.SyntaxKind.ImportKeyword)
    )
      moduleSpecifier(node.arguments[0].text);

    if (
      ts.isStringLiteralLike(node) ||
      ts.isTemplateHead(node) ||
      ts.isTemplateMiddle(node) ||
      ts.isTemplateTail(node)
    ) {
      const parent = node.parent;
      const isImportSpec = ts.isImportDeclaration(parent) || ts.isExportDeclaration(parent);
      if (!isImportSpec) {
        hostsInString(node.text);
        if (NETWORK_PROGRAMS.has(node.text)) point(`program:${NETWORK_PROGRAMS.get(node.text)}`);
      }
    } else if (ts.isRegularExpressionLiteral(node)) {
      const plain = node.text.replace(/\\\./g, ".");
      for (const m of plain.matchAll(HOST_IN_TEXT)) hosts.add(m[0].toLowerCase());
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return { points, hosts };
}

/** The hosts of a text file (CSS, HTML, JSON, shell): a URL, anywhere. */
export function scanText(text) {
  const hosts = new Set();
  for (const m of text.matchAll(URL_HOST)) hosts.add(hostOf(m[1]));
  return { points: new Map(), hosts };
}

// ---- the tree -----------------------------------------------------------------------------------------------

function walk(root, rel, out) {
  const abs = path.join(root, rel);
  let stat;
  try {
    stat = fs.statSync(abs);
  } catch {
    return;
  }
  const norm = rel.split(path.sep).join("/");
  if (SKIPPED.test(norm)) return;
  if (stat.isDirectory()) {
    for (const name of fs.readdirSync(abs).sort(cmp)) walk(root, path.join(rel, name), out);
  } else if (CODE.test(norm) || TEXT.test(norm)) out.push(norm);
}

export function scanTree(root = ROOT) {
  const files = [];
  for (const dir of SCAN_DIRS) walk(root, dir, files);
  const sites = [];
  const hosts = new Map();
  for (const file of files.sort(cmp)) {
    const source = fs.readFileSync(path.join(root, file), "utf8");
    const result = CODE.test(file) ? scanSource(source, file) : scanText(source);
    for (const [kind, count] of [...result.points].sort((a, b) => cmp(a[0], b[0])))
      sites.push({ file, kind, count });
    for (const host of result.hosts) {
      if (LOOPBACK.test(host)) continue;
      if (!hosts.has(host)) hosts.set(host, new Set());
      hosts.get(host).add(file);
    }
  }
  return {
    sites,
    hosts: [...hosts.entries()]
      .sort((a, b) => cmp(a[0], b[0]))
      .map(([host, set]) => ({ host, files: [...set].sort(cmp) })),
  };
}

// ---- the policy ---------------------------------------------------------------------------------------------

export function loadPolicy(root = ROOT) {
  const policy = JSON.parse(fs.readFileSync(path.join(root, POLICY_FILE), "utf8"));
  for (const key of ["hosts", "sites", "ignored"])
    if (!Array.isArray(policy[key])) throw new Error(`${POLICY_FILE}: "${key}" must be a list`);
  return policy;
}

/** `*.push.apple.com` covers `push.apple.com` and `web.push.apple.com`; a plain entry covers itself only. */
export function covers(pattern, host) {
  const p = pattern.toLowerCase();
  return p.startsWith("*.") ? host === p.slice(2) || host.endsWith(p.slice(1)) : host === p;
}

/** What the code does that the policy does not say, and what the policy says that the code does not do. */
export function compare(found, policy) {
  const problems = [];
  const hostEntries = policy.hosts;
  const ids = new Set(hostEntries.map((h) => h.id));

  const siteKey = (s) => `${s.file}\u0000${s.kind}`;
  const known = new Map(policy.sites.map((s) => [siteKey(s), s]));
  const seen = new Set();
  for (const site of found.sites) {
    seen.add(siteKey(site));
    const entry = known.get(siteKey(site));
    if (!entry)
      problems.push(`new network point: ${site.file} · ${site.kind} ×${site.count} is not in ${POLICY_FILE}`);
    else if (entry.count !== site.count)
      problems.push(
        `${site.file} · ${site.kind}: the policy says ×${entry.count}, the code has ×${site.count} — say where the new one goes`,
      );
  }
  for (const entry of policy.sites) {
    if (!seen.has(siteKey(entry)))
      problems.push(`stale policy site: ${entry.file} · ${entry.kind} is not in the code any more`);
    for (const id of entry.hosts ?? [])
      if (!ids.has(id))
        problems.push(
          `policy site ${entry.file} · ${entry.kind} names the host entry "${id}", which does not exist`,
        );
  }

  const patterns = hostEntries.flatMap((h) => (h.match ?? []).map((m) => ({ id: h.id, m })));
  const ignored = policy.ignored.map((i) => i.match);
  const covered = new Set();
  for (const { host, files } of found.hosts) {
    const hit = patterns.filter((p) => covers(p.m, host));
    for (const p of hit) covered.add(`${p.id}\u0000${p.m}`);
    if (hit.length === 0 && !ignored.some((m) => covers(m, host)))
      problems.push(`new host: ${host} (${files.join(", ")}) has no entry in ${POLICY_FILE}`);
  }
  for (const h of hostEntries) {
    if (h.implicit === true) continue;
    for (const m of h.match ?? [])
      if (!covered.has(`${h.id}\u0000${m}`))
        problems.push(`stale policy host: ${h.id} · ${m} is not in the code any more`);
  }
  return problems;
}

// ---- command line -------------------------------------------------------------------------------------------

export function main(
  argv,
  io = { out: (s) => process.stdout.write(s), err: (s) => process.stderr.write(s) },
) {
  let root = ROOT;
  let mode = "table";
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--root") root = path.resolve(argv[++i] ?? "");
    else if (a === "--check") mode = "check";
    else if (a === "--json") mode = "json";
    else {
      io.err(
        `network-scan: unknown argument ${a}\nusage: node scripts/network-scan.mjs [--check | --json] [--root <dir>]\n`,
      );
      return 2;
    }
  }
  const found = scanTree(root);
  if (mode === "json") {
    io.out(JSON.stringify(found, null, 2) + "\n");
    return 0;
  }
  if (mode === "check") {
    let problems;
    try {
      problems = compare(found, loadPolicy(root));
    } catch (err) {
      io.err(`network-scan: ${err.message}\n`);
      return 2;
    }
    if (problems.length > 0) {
      io.err(
        `network-scan: the code and ${POLICY_FILE} disagree\n${problems.map((p) => `  - ${p}`).join("\n")}\n`,
      );
      return 1;
    }
    io.out(
      `network-scan: ok (${found.sites.length} network points, ${found.hosts.length} hosts, all in the policy)\n`,
    );
    return 0;
  }
  io.out("NETWORK POINTS\n");
  for (const s of found.sites) io.out(`  ${s.file}  ${s.kind}  x${s.count}\n`);
  io.out("\nHOSTS\n");
  for (const h of found.hosts) io.out(`  ${h.host}  (${h.files.join(", ")})\n`);
  return 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main(process.argv.slice(2));
}
