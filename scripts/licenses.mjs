#!/usr/bin/env node
/**
 * Third-party notices and the license gate (.specs/features/licenca-comercial, doors 3 and 4).
 *
 *   node scripts/licenses.mjs --write     write legal/THIRD_PARTY_NOTICES.md
 *   node scripts/licenses.mjs --check     exit 0 when the committed file is current and every license passes
 *   node scripts/licenses.mjs --stdout    print the notice, write nothing
 *   (all: --root <dir> to run on another tree; the default is the repository this script lives in)
 *
 * Exit codes: 0 ok · 1 a license is not allowed, or the committed notice is stale · 2 the tree cannot be
 * trusted (a lockfile entry that is not what it says, an installed package that is not the locked one, a
 * policy file that cannot be read) or a usage error.
 *
 * The distributed set is what `package-lock.json` marks as not `dev`: the runtime dependency set, a superset of
 * what the installer's bundles contain (the count is asserted by tests/legal.licenses.test.ts, not written here).
 * The build tools are the rest. The output depends on nothing but the lockfile, the license files
 * of the installed packages and `legal/license-policy.json`: no date, no path of the machine, no locale.
 *
 * DRAFT for the owner's legal review: this is engineering, not legal advice.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const NOTICE_FILE = path.join("legal", "THIRD_PARTY_NOTICES.md");
export const POLICY_FILE = path.join("legal", "license-policy.json");

// ---- text -------------------------------------------------------------------------------------------------

/** LF line ends, no BOM, no trailing blanks on a line, no blank lines around the text. */
export function normalizeText(text) {
  return text
    .replace(/^\uFEFF/, "")
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.replace(/[ \t]+$/, ""))
    .join("\n")
    .replace(/^\n+/, "")
    .replace(/\n+$/, "");
}

/** Code-point order: independent of the locale of the machine that runs it. */
const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

// ---- SPDX expressions ---------------------------------------------------------------------------------------

/**
 * `A`, `A OR B`, `A AND B`, `(A OR B) AND C`, `A WITH exception`. Returns a tree, or null when the text is not
 * an expression (`SEE LICENSE IN x`, an empty string, a dangling operator).
 */
export function parseSpdx(text) {
  if (typeof text !== "string") return null;
  const tokens = text.match(/\(|\)|[A-Za-z0-9.+-]+|\S/g) ?? [];
  let pos = 0;
  const peek = () => tokens[pos];
  const take = () => tokens[pos++];
  const isOp = (t, op) => typeof t === "string" && t.toUpperCase() === op;

  function primary() {
    const t = take();
    if (t === undefined) return null;
    if (t === "(") {
      const inner = orExpr();
      if (inner === null || take() !== ")") return null;
      return inner;
    }
    if (!/^[A-Za-z0-9][A-Za-z0-9.+-]*$/.test(t) || isOp(t, "AND") || isOp(t, "OR") || isOp(t, "WITH"))
      return null;
    if (isOp(peek(), "WITH")) {
      take();
      const exception = take();
      if (exception === undefined || !/^[A-Za-z0-9][A-Za-z0-9.+-]*$/.test(exception)) return null;
      return { id: t, exception };
    }
    return { id: t };
  }
  function andExpr() {
    let left = primary();
    while (left !== null && isOp(peek(), "AND")) {
      take();
      const right = primary();
      if (right === null) return null;
      left = { op: "AND", left, right };
    }
    return left;
  }
  function orExpr() {
    let left = andExpr();
    while (left !== null && isOp(peek(), "OR")) {
      take();
      const right = andExpr();
      if (right === null) return null;
      left = { op: "OR", left, right };
    }
    return left;
  }
  const tree = orExpr();
  return tree !== null && pos === tokens.length ? tree : null;
}

/** True when the licensee may use the package under an allowed license: `OR` needs one, `AND` needs both. */
export function isAllowed(expression, allowed) {
  const tree = parseSpdx(expression);
  if (tree === null) return false;
  const set = new Set([...allowed].map((id) => id.toLowerCase()));
  const walk = (node) => {
    if (node.op === "OR") return walk(node.left) || walk(node.right);
    if (node.op === "AND") return walk(node.left) && walk(node.right);
    return set.has(node.id.toLowerCase());
  };
  return walk(tree);
}

// ---- lockfile -----------------------------------------------------------------------------------------------

const readJson = (file) => JSON.parse(fs.readFileSync(file, "utf8"));

export const readLock = (root = ROOT) => readJson(path.join(root, "package-lock.json"));

/** The npm packages of the lockfile (workspace folders and links are the product itself, not a dependency). */
export function lockPackages(root = ROOT) {
  const lock = readLock(root);
  const out = [];
  for (const [key, entry] of Object.entries(lock.packages ?? {})) {
    const at = key.lastIndexOf("node_modules/");
    if (at < 0 || entry.link) continue;
    out.push({
      key,
      name: key.slice(at + "node_modules/".length),
      version: entry.version,
      resolved: entry.resolved ?? null,
      integrity: entry.integrity ?? null,
      license: entry.license,
      author: entry.author,
      dependencies: { ...(entry.dependencies ?? {}), ...(entry.optionalDependencies ?? {}) },
      optional: entry.optional === true,
      os: Array.isArray(entry.os) ? entry.os : null,
      cpu: Array.isArray(entry.cpu) ? entry.cpu : null,
      tier: entry.dev === true || entry.devOptional === true ? "tooling" : "distributed",
    });
  }
  return out.sort((a, b) => cmp(a.name, b.name) || cmp(a.version, b.version) || cmp(a.key, b.key));
}

/** `registry.npmjs.org/@scope/name/-/name-1.2.3.tgz` → `1.2.3`; null when the URL does not follow the pattern. */
export function versionOfTarball(resolved, name) {
  const base = String(resolved).split("/").pop() ?? "";
  const unscoped = name.split("/").pop();
  const prefix = `${unscoped}-`;
  return base.startsWith(prefix) && base.endsWith(".tgz") ? base.slice(prefix.length, -".tgz".length) : null;
}

/** The license expression of an entry: the lockfile field, the legacy object forms, or the policy override. */
export function licenseOf(pkg, overrides) {
  const raw = pkg.license;
  if (typeof raw === "string" && raw.trim()) return { expression: raw.trim(), overridden: false };
  if (raw && typeof raw === "object" && !Array.isArray(raw) && typeof raw.type === "string")
    return { expression: raw.type, overridden: false };
  if (Array.isArray(raw) && raw.length > 0 && raw.every((l) => l && typeof l.type === "string"))
    return { expression: raw.map((l) => l.type).join(" OR "), overridden: false };
  const override = overrides[`${pkg.name}@${pkg.version}`];
  if (
    override &&
    typeof override.license === "string" &&
    typeof override.reason === "string" &&
    override.reason.trim()
  )
    return { expression: override.license, overridden: true };
  return { expression: null, overridden: false };
}

// ---- policy -------------------------------------------------------------------------------------------------

export function loadPolicy(root = ROOT) {
  const file = path.join(root, POLICY_FILE);
  let policy;
  try {
    policy = readJson(file);
  } catch (err) {
    throw new EnvironmentError(`${POLICY_FILE} cannot be read: ${err.message}`);
  }
  const lists = ["allowedDistributed", "allowedToolingExtra"];
  for (const name of lists)
    if (!Array.isArray(policy[name]) || policy[name].some((id) => typeof id !== "string"))
      throw new EnvironmentError(`${POLICY_FILE}: "${name}" must be a list of SPDX identifiers`);
  policy.overrides ??= {};
  policy.bundled ??= [];
  policy.licenseTexts ??= {};
  for (const [id, entry] of Object.entries(policy.licenseTexts))
    if (
      !Array.isArray(entry.files) ||
      entry.files.length === 0 ||
      entry.files.some((f) => typeof f !== "string") ||
      typeof entry.source !== "string" ||
      typeof entry.reason !== "string" ||
      !entry.reason.trim()
    )
      throw new EnvironmentError(
        `${POLICY_FILE}: licenseTexts["${id}"] needs "files" (a list of paths), "source" and "reason"`,
      );
  return policy;
}

export class EnvironmentError extends Error {}

/**
 * An optional package that npm installs only on the platform it is built for (`sqlite-vec-darwin-arm64`): it is
 * locked, listed, noticed and in the SBOM on every machine, but it can only be installed on its own. `os` and `cpu`
 * are npm's own lists, with `!name` for a platform it refuses.
 */
export function isForeignOptional(pkg, host = { os: process.platform, cpu: process.arch }) {
  if (!pkg.optional || (pkg.os === null && pkg.cpu === null)) return false;
  const fits = (list, value) => {
    if (list === null || list.length === 0) return true;
    const refused = list.filter((x) => x.startsWith("!")).map((x) => x.slice(1));
    if (refused.includes(value)) return false;
    const wanted = list.filter((x) => !x.startsWith("!"));
    return wanted.length === 0 || wanted.includes(value);
  };
  return !(fits(pkg.os, host.os) && fits(pkg.cpu, host.cpu));
}

// ---- reading the installed packages -----------------------------------------------------------------------------

const LICENSE_FILE = /^(licen[sc]e|licen[sc]ing|copying|unlicen[sc]e|notice)([-._].*)?$/i;

/** The text of every license-like file of an installed package, or null when it ships none. */
export function licenseTextOf(root, pkg) {
  const dir = path.join(root, pkg.key);
  let names;
  try {
    names = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return null;
  }
  const files = names
    .filter((d) => d.isFile() && LICENSE_FILE.test(d.name) && !/\.(js|mjs|cjs|ts|json|map)$/i.test(d.name))
    .map((d) => d.name)
    .sort(cmp);
  if (files.length === 0) return null;
  const texts = files.map((name) => normalizeText(fs.readFileSync(path.join(dir, name), "utf8")));
  if (files.length === 1) return texts[0];
  return files.map((name, i) => `[${name}]\n${texts[i]}`).join("\n\n");
}

/**
 * The text of a package that ships none of its own, from the files the policy names for it (`licenseTexts`, kept under
 * `legal/vendor/`). The installed package always wins: this is read only when `licenseTextOf` found nothing. The
 * text is the same for every package an entry names, so they share one block in the notice; nothing in it depends on
 * the machine that generates it.
 */
export function vendoredTextOf(root, policy, pkg) {
  const entry = policy.licenseTexts[`${pkg.name}@${pkg.version}`];
  if (!entry) return null;
  const head =
    `(O pacote não inclui arquivo de licença. Licença declarada: ${pkg.expression}. ` +
    `Os textos abaixo são os do repositório do autor, copiados sem alteração de ${entry.source}; ` +
    `quem recebe o software pode escolher qualquer um dos dois.)`;
  const files = entry.files.map(
    (file) => `[${path.basename(file)}]\n${normalizeText(fs.readFileSync(path.join(root, file), "utf8"))}`,
  );
  return [head, ...files].join("\n\n");
}

function authorOf(pkg, root) {
  try {
    const manifest = readJson(path.join(root, pkg.key, "package.json"));
    const author = manifest.author;
    if (typeof author === "string")
      return author
        .replace(/\s*<[^>]*>/g, "")
        .replace(/\s*\([^)]*\)/g, "")
        .trim();
    if (author && typeof author.name === "string") return author.name;
  } catch {
    /* no manifest to read */
  }
  return null;
}

// ---- the report -------------------------------------------------------------------------------------------------

/**
 * Everything the gate knows: the packages by tier, the license problems (exit 1), the environment problems
 * (exit 2) and the notice text. Reads the lockfile, the installed license files and the policy; writes nothing.
 */
export function buildReport(root = ROOT) {
  const policy = loadPolicy(root);
  const environment = [];
  const problems = [];
  const packages = lockPackages(root);

  for (const pkg of packages) {
    if (pkg.resolved) {
      const fromUrl = versionOfTarball(pkg.resolved, pkg.name);
      if (fromUrl !== null && fromUrl !== pkg.version)
        environment.push(
          `${pkg.name}: package-lock.json says ${pkg.version} but its tarball is ${fromUrl} (${pkg.resolved})`,
        );
    }
  }

  const rows = [];
  for (const pkg of packages) {
    const { expression, overridden } = licenseOf(pkg, policy.overrides);
    const allowed =
      pkg.tier === "distributed"
        ? policy.allowedDistributed
        : [...policy.allowedDistributed, ...policy.allowedToolingExtra];
    const ok = expression !== null && isAllowed(expression, allowed);
    if (!ok) {
      problems.push(
        `${pkg.name}@${pkg.version} (${pkg.tier === "distributed" ? "distribuído" : "ferramenta de build"}): ` +
          (expression === null
            ? "no license declared"
            : `license ${JSON.stringify(expression)} is not allowed`),
      );
    }
    rows.push({ ...pkg, expression: expression ?? "(none)", overridden });
  }

  const distributed = rows.filter((r) => r.tier === "distributed");
  const tooling = rows.filter((r) => r.tier === "tooling");

  for (const pkg of distributed) {
    // Foreign to this machine: it cannot be installed here, so its absence is not a broken tree.
    if (isForeignOptional(pkg)) continue;
    let installed = null;
    try {
      installed = readJson(path.join(root, pkg.key, "package.json")).version;
    } catch {
      /* reported below */
    }
    if (installed !== pkg.version)
      environment.push(
        installed === null
          ? `${pkg.name}@${pkg.version}: ${pkg.key} is not installed (run npm ci)`
          : `${pkg.name}: ${pkg.key} holds ${installed} but package-lock.json says ${pkg.version} (run npm ci)`,
      );
  }

  let notice = null;
  if (environment.length === 0) notice = renderNotice(root, policy, distributed, tooling);
  return { policy, distributed, tooling, problems, environment, notice };
}

/** A fence that the text inside cannot close. */
function fence(text) {
  let ticks = "~~~~";
  while (text.includes(ticks)) ticks += "~";
  return ticks;
}
const cell = (text) => String(text).replace(/\|/g, "\\|").replace(/\n/g, " ");
const draft =
  "> **MINUTA para revisão do dono.** Este arquivo foi gerado por script e não é aconselhamento jurídico: " +
  'ninguém com formação em direito o revisou. A revisão é do dono (ver `.specs/STATE.md`, "revisão jurídica do dono").';

export function renderNotice(root, policy, distributed, tooling) {
  const out = [];
  const push = (...lines) => out.push(...lines);

  push("# Avisos de software de terceiros — MordomoOS", "", draft, "");
  push(
    "O MordomoOS é distribuído sob a Functional Source License 1.1 com licença futura Apache-2.0 (FSL-1.1-ALv2; " +
      "texto em `LICENSE`). Ele reúne componentes de terceiros, cada um sob a licença do seu autor, reproduzida " +
      "abaixo como essas licenças pedem. Nada aqui muda a licença de nenhum deles.",
    "",
    "Gerado por `node scripts/licenses.mjs --write` a partir de `package-lock.json`, dos arquivos de licença dos " +
      "pacotes instalados e de `legal/license-policy.json`. **Não edite à mão**: `npm run licenses:write` reescreve " +
      "e `npm run licenses:check` reprova um arquivo que não bate.",
    "",
    `Pacotes npm de runtime: ${distributed.length} · ferramentas de build (não distribuídas): ${tooling.length}`,
    "",
    '"Runtime" é o que o `package-lock.json` marca como não-`dev`: as dependências que o produto precisa para rodar. É um ' +
      "**superconjunto** do que o instalador leva (o código vai em dois bundles que usam só parte desses pacotes, e o " +
      "módulo nativo do SQLite vai à parte): listar todos é o lado seguro para os avisos, e o aviso não afirma que cada " +
      "um está dentro do instalador.",
    "",
  );

  push("## 1. Componentes que não vêm do npm", "");
  for (const item of policy.bundled) {
    push(`### ${item.name} — ${item.license}`, "");
    push(`- Onde: ${item.where}`, `- Origem: ${item.url}`);
    if (item.note) push(`- Nota: ${item.note}`);
    if (item.textFile) {
      const text = normalizeText(fs.readFileSync(path.join(root, item.textFile), "utf8"));
      const f = fence(text);
      push("", f + "text", text, f);
    }
    push("");
  }

  push("## 2. Pacotes npm de runtime", "");
  push("| Pacote | Versão | Licença (SPDX) | Origem |", "| --- | --- | --- | --- |");
  for (const r of distributed)
    push(
      `| ${cell(r.name)} | ${cell(r.version)} | ${cell(r.expression)}${r.overridden ? " (override)" : ""} | ${cell(r.resolved ?? "-")} |`,
    );
  push("");

  const groups = new Map();
  for (const r of distributed) {
    let text = licenseTextOf(root, r) ?? vendoredTextOf(root, policy, r);
    if (text === null) {
      const author = r.author ?? authorOf(r, root);
      text =
        `(O pacote não inclui arquivo de licença. Licença declarada: ${r.expression}.` +
        `${author ? ` Autor declarado: ${author}.` : ""})`;
    }
    if (!groups.has(text)) groups.set(text, []);
    groups.get(text).push(r);
  }
  const ordered = [...groups.entries()].sort(
    (a, b) => cmp(a[1][0].name, b[1][0].name) || cmp(a[1][0].version, b[1][0].version),
  );
  push(`### Textos de licença (${ordered.length} textos distintos)`, "");
  ordered.forEach(([text, members], i) => {
    push(`#### Texto ${i + 1} — ${members.length} ${members.length === 1 ? "pacote" : "pacotes"}`, "");
    push(members.map((m) => `${m.name}@${m.version}`).join(", "), "");
    const f = fence(text);
    push(f + "text", text, f, "");
  });

  push("## 3. Ferramentas de build (não distribuídas)", "");
  push(
    "Usadas para compilar, testar e empacotar. Nenhuma entra no instalador; por isso aparecem só com nome, versão e " +
      "licença. Uma ferramenta sob `MPL-2.0` ou `CC-BY-4.0` é aceita aqui e reprovada se virar dependência de runtime.",
    "",
  );
  push("| Pacote | Versão | Licença (SPDX) |", "| --- | --- | --- |");
  for (const r of tooling)
    push(
      `| ${cell(r.name)} | ${cell(r.version)} | ${cell(r.expression)}${r.overridden ? " (override)" : ""} |`,
    );
  push("");

  return out.join("\n");
}

// ---- command line -------------------------------------------------------------------------------------------------

export function main(
  argv,
  io = { out: (s) => process.stdout.write(s), err: (s) => process.stderr.write(s) },
) {
  let root = ROOT;
  let mode = null;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--root") root = path.resolve(argv[++i] ?? "");
    else if (a === "--write" || a === "--check" || a === "--stdout") mode = a.slice(2);
    else {
      io.err(
        `licenses: unknown argument ${a}\nusage: node scripts/licenses.mjs --write | --check | --stdout [--root <dir>]\n`,
      );
      return 2;
    }
  }
  if (mode === null) {
    io.err("usage: node scripts/licenses.mjs --write | --check | --stdout [--root <dir>]\n");
    return 2;
  }

  let report;
  try {
    report = buildReport(root);
  } catch (err) {
    if (err instanceof EnvironmentError) {
      io.err(`licenses: ${err.message}\n`);
      return 2;
    }
    throw err;
  }
  if (report.environment.length > 0) {
    io.err(
      `licenses: the tree is not what package-lock.json describes:\n${report.environment.map((l) => `  - ${l}`).join("\n")}\n`,
    );
    return 2;
  }

  const target = path.join(root, NOTICE_FILE);
  if (mode === "stdout") {
    io.out(report.notice + "\n");
    return report.problems.length > 0 ? 1 : 0;
  }
  if (mode === "write") {
    if (report.problems.length > 0) {
      io.err(
        `licenses: not written, a license is not allowed:\n${report.problems.map((l) => `  - ${l}`).join("\n")}\n`,
      );
      return 1;
    }
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, report.notice + "\n");
    io.out(
      `${NOTICE_FILE}: ${report.distributed.length} distributed components, ${report.tooling.length} build tools\n`,
    );
    return 0;
  }

  const failures = report.problems.map((l) => `  - ${l}`);
  let committed = null;
  try {
    committed = normalizeText(fs.readFileSync(target, "utf8"));
  } catch {
    /* missing */
  }
  if (committed === null) failures.push(`  - ${NOTICE_FILE} does not exist (run npm run licenses:write)`);
  else if (committed !== normalizeText(report.notice))
    failures.push(
      `  - ${NOTICE_FILE} is stale: it differs from what package-lock.json produces (run npm run licenses:write)`,
    );
  if (failures.length > 0) {
    io.err(`licenses: check failed\n${failures.join("\n")}\n`);
    return 1;
  }
  io.out(`licenses: ok (${report.distributed.length} distributed, ${report.tooling.length} build tools)\n`);
  return 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main(process.argv.slice(2));
}
