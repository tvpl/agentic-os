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
  "apps/command-centre/gallery.html",
  "scripts",
  "apps/desktop",
  "connectors",
  "routines",
  "skills",
];
const CODE = /\.(ts|tsx|mjs|js|cjs)$/;
const TEXT = /\.(css|html|json|webmanifest|sh|ps1|swift|plist|md|rs|toml)$/;
const SKIPPED =
  /(^|\/)(node_modules|dist|build|release|coverage)(\/|$)|\.test\.[a-z]+$|\.d\.ts$|\.spec\.[a-z]+$|^scripts\/network-scan\.mjs$|^apps\/desktop\/(target|payload|src-tauri\/gen)(\/|$)|^apps\/desktop\/[^/]+\/tests\//;

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
/** Strings that mean the code reaches the network through a program (a spawn of any of them is a network point). */
const NETWORK_PROGRAMS = new Map([
  ["npm-cli.js", "npm-cli"],
  ["npx-cli.js", "npm-cli"],
  ...["npm", "npx", "git", "ssh", "scp", "sftp", "ftp", "rsync", "nc", "ncat", "telnet", "curl", "wget"].map(
    (n) => [n, n],
  ),
]);

/** Crates that open connections or ask a server for something (`Cargo.toml` of `apps/desktop`). */
const NETWORK_CRATES =
  "tauri-plugin-(?:updater|http|websocket|upload)|reqwest|hyper|ureq|isahc|surf|attohttpc";

/** The index of the `}` that closes the `{` at `open`, skipping strings, characters and comments; -1 if none does. */
function endOfBlock(text, open) {
  let depth = 0;
  for (let j = open; j < text.length; j++) {
    const c = text[j];
    if (c === "/" && text[j + 1] === "/") {
      const nl = text.indexOf("\n", j);
      if (nl < 0) return -1;
      j = nl;
    } else if (c === "/" && text[j + 1] === "*") {
      const close = text.indexOf("*/", j + 2);
      if (close < 0) return -1;
      j = close + 1;
    } else if (c === "r" && /^r#*"/.test(text.slice(j, j + 40)) && !/[\w]/.test(text[j - 1] ?? " ")) {
      const hashes = /^r(#*)"/.exec(text.slice(j, j + 40))[1];
      const close = text.indexOf(`"${hashes}`, j + 2 + hashes.length);
      if (close < 0) return -1;
      j = close + hashes.length;
    } else if (c === '"') {
      for (j++; j < text.length && text[j] !== '"'; j++) if (text[j] === "\\") j++;
    } else if (c === "'") {
      const ch = /^'(?:\\.[^']*|[^\\'])'/.exec(text.slice(j, j + 12));
      if (ch) j += ch[0].length - 1; // a character; otherwise a lifetime
    } else if (c === "{") depth++;
    else if (c === "}" && --depth === 0) return j;
  }
  return -1;
}

/**
 * A Rust file without its test code: `#[cfg(test)]` and the item it marks (a `mod` or `fn` with a body, or a `use` up to
 * its `;`) are cut out, wherever they are, so production code after a test module is still read. The attribute counts
 * only where it is code, as the first thing on its line: `#[cfg(test)]` named in a doc comment or a `//` comment
 * (`/// … #[cfg(test)] …`) marks nothing and must not hide the function after it. A body whose braces do not balance is
 * not cut (the scan then reads more, never less).
 */
export function withoutRustTests(text) {
  const marker = /^[ \t]*#\[cfg\(test\)\]/gm;
  let out = "";
  let from = 0;
  for (let m = marker.exec(text); m !== null; m = marker.exec(text)) {
    if (m.index < from) continue; // inside a part already cut
    let i = m.index + m[0].length;
    // further attributes, then the item's head up to its body or its end
    while (i < text.length && text[i] !== "{" && text[i] !== ";") i++;
    let end = i + 1;
    if (text[i] === "{") {
      const j = endOfBlock(text, i);
      if (j < 0) continue; // unbalanced: keep it
      end = j + 1;
    }
    out += text.slice(from, m.index);
    from = end;
  }
  return out + text.slice(from);
}

/** Hosts that never leave the machine. */
const LOOPBACK = /^(localhost|127(\.\d{1,3}){3}|0\.0\.0\.0|\[?::1\]?|\[?::\]?)$/i;
/**
 * Top-level domains a bare host constant or a host regular expression can end in. Left out on purpose: `in`, `local`,
 * `info`, `co`, `md`, `sh`, `ts`, `js`… are also the tails of i18n keys and file names; a host in a constant whose
 * name says it is one (`HOST`, `origin`, `baseUrl`…) is read whatever it ends in.
 */
const TLDS =
  "com|org|net|io|dev|app|software|ai|tv|cloud|edu|gov|xyz|tech|us|uk|de|fr|br|jp|cn|ru|nl|es|it|ca|au|ch|se|fi|dk|pl|kr|tw|hk|sg|mx|ar|cl|pt|be|cz|nz|za|tr|ua|il|eu";
const BARE_HOST = new RegExp(`^(?:[a-z0-9-]+\\.)+(?:${TLDS})$`);
const DOTTED = /^(?:[a-z0-9-]+\.)+[a-z0-9-]+$/i;
const HOST_NAME = /host|domain|origin|server|endpoint|base_?url|\burl\b/i;
const BARE_IP = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})(?::\d+)?$/;
const HOST_IN_TEXT = new RegExp(`(?:[a-z0-9-]+\\.)+(?:${TLDS})(?![a-z0-9-])`, "g");
/**
 * A command line that starts with `curl` / `wget`, given whole to a function that runs a command (`exec("curl -s https://…")`,
 * `spawn("sh", ["-c", "curl …"])`). Only there: the same words in a string shown to the person (an install hint) run nothing.
 */
const DOWNLOAD_COMMAND = /^\s*(?:curl|wget)(?:\s+(?:-|https?:)|\s+$)/;
const RUNNERS = /^(exec|execSync|execFile|execFileSync|spawn|spawnSync|execa|execaSync|system|popen)$/;
/** A host written without a scheme, as a whole string (`"//cdn.example.com/x.js"`) or after a quote, `(` or `=` in text. */
const SCHEMELESS_STRING = new RegExp(`^//((?:[a-z0-9-]+\\.)+(?:${TLDS}))(?=[/:?#]|$)`, "i");
const SCHEMELESS_IN_TEXT = new RegExp(`(?<=["'(=])//((?:[a-z0-9-]+\\.)+(?:${TLDS}))(?=[/:?#"')\\s]|$)`, "gi");
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

  const hostsInString = (text, named = false) => {
    for (const m of text.matchAll(URL_HOST)) hosts.add(hostOf(m[1]));
    const schemeless = SCHEMELESS_STRING.exec(text);
    if (schemeless) hosts.add(hostOf(schemeless[1]));
    if (BARE_HOST.test(text) || (named && DOTTED.test(text))) hosts.add(text.toLowerCase());
    const ip = BARE_IP.exec(text);
    if (ip && ip.slice(1).every((o) => Number(o) <= 255)) hosts.add(text.replace(/:\d+$/, ""));
  };
  const moduleSpecifier = (spec) => {
    if (/^https?:\/\//i.test(spec)) {
      point("module:url");
      hostsInString(spec);
      return;
    }
    const name = spec.replace(/^node:/, "");
    if (NETWORK_MODULES.has(name)) point(`module:${name}`);
  };
  /** The name a string is bound to (`const HOST = "…"`, `{ origin: "…" }`), or "". */
  const boundName = (node) => {
    const p = node.parent;
    if (
      (ts.isVariableDeclaration(p) || ts.isPropertyAssignment(p) || ts.isPropertyDeclaration(p)) &&
      p.initializer === node
    )
      return ts.isIdentifier(p.name) || ts.isStringLiteralLike(p.name) ? p.name.text : "";
    return "";
  };

  const visit = (node) => {
    if (ts.isIdentifier(node)) {
      if (node.text === "fetch" && !isTypePosition(node) && !isDeclarationName(node)) point("fetch");
      else if (NETWORK_GLOBALS.has(node.text) && !isTypePosition(node) && !isDeclarationName(node))
        point(NETWORK_GLOBALS.get(node.text));
    } else if (ts.isPropertyAccessExpression(node)) {
      if (node.name.text === "sendBeacon") point("beacon");
      else if (
        node.name.text === "binding" &&
        ts.isIdentifier(node.expression) &&
        node.expression.text === "process"
      )
        point("process-binding");
    } else if (ts.isElementAccessExpression(node)) {
      const arg = node.argumentExpression;
      if (ts.isStringLiteralLike(arg)) {
        if (arg.text === "sendBeacon") point("beacon");
        else if (isGlobalObject(node.expression) && arg.text === "fetch") point("fetch");
        else if (isGlobalObject(node.expression) && NETWORK_GLOBALS.has(arg.text))
          point(NETWORK_GLOBALS.get(arg.text));
        else if (
          node.expression.kind === ts.SyntaxKind.Identifier &&
          node.expression.text === "process" &&
          arg.text === "binding"
        )
          point("process-binding");
      } else if (isGlobalObject(node.expression)) point("dynamic-global");
    }
    if (ts.isCallExpression(node)) {
      const callee = ts.isIdentifier(node.expression)
        ? node.expression.text
        : ts.isPropertyAccessExpression(node.expression)
          ? node.expression.name.text
          : "";
      if (RUNNERS.test(callee)) {
        const candidates = node.arguments.flatMap((a) =>
          ts.isArrayLiteralExpression(a) ? [...a.elements] : [a],
        );
        for (const a of candidates) {
          const text = ts.isStringLiteralLike(a) ? a.text : ts.isTemplateExpression(a) ? a.head.text : null;
          const command = text === null ? null : DOWNLOAD_COMMAND.exec(text);
          if (command) point(`program:${command[0].trim().split(/\s/)[0]}`);
        }
      }
    }
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      ts.isIdentifier(node.expression.expression) &&
      node.expression.expression.text === "Reflect" &&
      node.expression.name.text === "get" &&
      node.arguments.length >= 2 &&
      isGlobalObject(node.arguments[0])
    ) {
      const key = node.arguments[1];
      if (!ts.isStringLiteralLike(key)) point("dynamic-global");
      else if (key.text === "fetch") point("fetch");
      else if (NETWORK_GLOBALS.has(key.text)) point(NETWORK_GLOBALS.get(key.text));
    }
    if (ts.isIdentifier(node) && node.text === "createRequire" && !isDeclarationName(node))
      point("module:dynamic");

    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier))
      moduleSpecifier(node.moduleSpecifier.text);
    else if (ts.isExportDeclaration(node) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier))
      moduleSpecifier(node.moduleSpecifier.text);
    else if (
      ts.isCallExpression(node) &&
      node.arguments.length > 0 &&
      ((ts.isIdentifier(node.expression) && node.expression.text === "require") ||
        node.expression.kind === ts.SyntaxKind.ImportKeyword)
    ) {
      // A module named by a variable can be any of them: it is a point of its own.
      if (ts.isStringLiteralLike(node.arguments[0])) moduleSpecifier(node.arguments[0].text);
      else point("module:dynamic");
    }

    if (
      ts.isStringLiteralLike(node) ||
      ts.isTemplateHead(node) ||
      ts.isTemplateMiddle(node) ||
      ts.isTemplateTail(node)
    ) {
      const parent = node.parent;
      const isImportSpec = ts.isImportDeclaration(parent) || ts.isExportDeclaration(parent);
      if (!isImportSpec) {
        hostsInString(node.text, HOST_NAME.test(boundName(node)));
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

/**
 * The hosts and programs of a text file: a URL anywhere; `curl` and `wget` as a command in prose or in a shell script;
 * the `"command"` of a connector (`npx`, `git`…). A text file cannot connect by itself, but it tells an agent, a
 * shell or the connector runner to.
 */
export function scanText(text, fileName = "") {
  const hosts = new Set();
  const points = new Map();
  const point = (name) => points.set(name, (points.get(name) ?? 0) + 1);
  if (fileName.endsWith(".rs")) text = withoutRustTests(text);
  for (const m of text.matchAll(URL_HOST)) hosts.add(hostOf(m[1]));
  for (const m of text.matchAll(SCHEMELESS_IN_TEXT)) hosts.add(hostOf(m[1]));
  if (fileName.endsWith(".rs")) {
    // The desktop shell (apps/desktop): a socket it opens or accepts, the updater it asks, and a bare host in a string.
    for (const _call of text.matchAll(
      /\b(?:TcpStream|TcpListener|UdpSocket)::(?:connect(?:_timeout)?|bind)\b/g,
    ))
      point("rust:net");
    for (const _call of text.matchAll(/\.updater\(\)/g)) point("rust:updater");
    // A program run by name: only the ones that reach the network are points (a name chosen at run time is a limit, in PRIVACY).
    for (const m of text.matchAll(/\bCommand::new\(\s*"([^"]+)"/g)) {
      const name = path.basename(m[1].replace(/\.exe$/i, ""));
      if (NETWORK_PROGRAMS.has(name)) point(`program:${NETWORK_PROGRAMS.get(name)}`);
    }
    // A shell given the command as an argument (`Command::new("sh").arg("-c").arg("curl …")`): the strings of that
    // statement are read for a command that starts with curl / wget (a chain or a name built at run time is a limit).
    for (const m of text.matchAll(
      /\bCommand::new\(\s*"(?:[^"]*[\\/])?(?:sh|bash|dash|zsh|ash|cmd|powershell|pwsh)(?:\.exe)?"/gi,
    )) {
      const end = text.indexOf(";", m.index);
      const statement = text.slice(m.index, end < 0 ? text.length : end);
      for (const arg of statement.matchAll(/"((?:[^"\\]|\\.)*)"/g)) {
        const command = DOWNLOAD_COMMAND.exec(arg[1].replace(/^[\s]+/, ""));
        if (command) point(`program:${command[0].trim().split(/\s/)[0]}`);
      }
    }
    for (const m of text.matchAll(/"([a-z0-9-]+(?:\.[a-z0-9-]+)*\.(?:com|org|net|io|dev|app))"/g))
      hosts.add(m[1]);
  }
  if (fileName.endsWith("Cargo.toml")) {
    // `name = ...`, the table `[dependencies.name]` (also `[target.'cfg(unix)'.dependencies.name]`) and a renamed
    // dependency (`other = { package = "name" }`) all bring the crate in.
    for (const m of text.matchAll(
      new RegExp(
        `^(?:(${NETWORK_CRATES})\\s*=|\\[[^\\]]*dependencies\\.(${NETWORK_CRATES})\\s*\\]|[^#\\n]*\\bpackage\\s*=\\s*"(${NETWORK_CRATES})")`,
        "gm",
      ),
    ))
      point(`rust:crate:${m[1] ?? m[2] ?? m[3]}`);
    // The dotted form (`reqwest.workspace = true`, `reqwest.version = "1"`, `ureq.features = [...]`) is one dependency,
    // however many keys spell it, once per section.
    for (const section of text.split(/^(?=\[)/m)) {
      const dotted = new Set();
      for (const m of section.matchAll(new RegExp(`^(${NETWORK_CRATES})\\.[A-Za-z_-]+\\s*=`, "gm")))
        dotted.add(m[1]);
      for (const name of dotted) point(`rust:crate:${name}`);
    }
  }
  if (/tauri(?:\.[a-z]+)?\.conf\.json$/.test(fileName) && /"updater"\s*:/.test(text)) point("tauri:updater");
  if (/\.(md|sh|ps1)$/.test(fileName))
    for (const m of text.matchAll(/(?:^|[\s`$(;|&"'])(curl|wget)(?=\s)/gm)) point(`program:${m[1]}`);
  if (/\.json$/.test(fileName))
    for (const m of text.matchAll(/"command"\s*:\s*"([^"]+)"/g)) {
      const name = path.basename(m[1]);
      if (NETWORK_PROGRAMS.has(name)) point(`program:${NETWORK_PROGRAMS.get(name)}`);
    }
  return { points, hosts };
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
    const result = CODE.test(file) ? scanSource(source, file) : scanText(source, file);
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
  /** An ignored host is ignored in the files its entry names (all files when it names none). */
  const isIgnored = (host, files) =>
    policy.ignored.some(
      (i) => covers(i.match, host) && (!i.files || files.every((f) => i.files.includes(f))),
    );
  const covered = new Set();
  for (const { host, files } of found.hosts) {
    const hit = patterns.filter((p) => covers(p.m, host));
    for (const p of hit) covered.add(`${p.id}\u0000${p.m}`);
    if (hit.length === 0 && !isIgnored(host, files))
      problems.push(`new host: ${host} (${files.join(", ")}) has no entry in ${POLICY_FILE}`);
  }
  for (const i of policy.ignored)
    if (!found.hosts.some((h) => covers(i.match, h.host)))
      problems.push(`stale ignored host: ${i.match} is not in the code any more`);
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
