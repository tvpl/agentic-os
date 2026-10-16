#!/usr/bin/env node
/**
 * The licenses of the Rust crates the desktop app is built from (.specs/features/distribuicao, AC 43-44).
 *
 *   node scripts/licenses-rust.mjs --check [--require-cargo]   exit 1 on a crate outside the policy or a stale notice
 *   node scripts/licenses-rust.mjs --write                      write legal/THIRD_PARTY_NOTICES.desktop.md
 *   (both: --root <dir>)
 *
 * The set is what `cargo metadata --locked` says the app links: every crate reachable from the workspace members
 * through normal (not build, not dev) dependencies, for every target at once (a superset of what one installer
 * carries, like the npm notice). Each license is checked against the `rust` section of `legal/license-policy.json`
 * (the runtime list plus what the Tauri tree needs, and named exceptions); the texts of the licenses are read from
 * the crates' sources in the cargo registry and written once each, with the crates that use them.
 *
 * Without `cargo` the check says so and passes (a machine without a Rust toolchain still runs `npm run licenses:check`);
 * the release workflow and the `desktop` CI job pass `--require-cargo`, where a missing cargo is an error.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { isAllowed, normalizeText, parseSpdx } from "./licenses.mjs";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const NOTICE_FILE = path.join("legal", "THIRD_PARTY_NOTICES.desktop.md");
export const POLICY_FILE = path.join("legal", "license-policy.json");
const MANIFEST = path.join("apps", "desktop", "Cargo.toml");
const LICENSE_FILE = /^(licen[sc]e|licen[sc]ing|copying|unlicen[sc]e)([-._].*)?$/i;
const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

/** Old Cargo manifests write `MIT/Apache-2.0` and `Apache-2.0 / MIT` for `OR`. */
export function normalizeExpression(text) {
  return typeof text === "string" ? text.replace(/\s*\/\s*/g, " OR ") : text;
}

/** The runtime crates of a `cargo metadata` document: reachable from the workspace members by normal edges. */
export function runtimeCrates(metadata) {
  const byId = new Map(metadata.packages.map((p) => [p.id, p]));
  const nodes = new Map(metadata.resolve.nodes.map((n) => [n.id, n]));
  const members = new Set(metadata.workspace_members);
  const seen = new Set();
  const stack = [...members];
  while (stack.length > 0) {
    const id = stack.pop();
    if (seen.has(id)) continue;
    seen.add(id);
    for (const dep of nodes.get(id)?.deps ?? [])
      if (dep.dep_kinds.some((k) => k.kind === null)) stack.push(dep.pkg);
  }
  return [...seen]
    .filter((id) => !members.has(id))
    .map((id) => byId.get(id))
    .sort((a, b) => cmp(a.name, b.name) || cmp(a.version, b.version));
}

/** What the policy says about `crates`: `{ problems, usedExceptions }`. */
export function judge(crates, policy) {
  const rust = policy.rust;
  const problems = [];
  if (!rust || !Array.isArray(rust.allowed) || !Array.isArray(rust.exceptions))
    return {
      problems: [`${POLICY_FILE}: the "rust" section (allowed, exceptions) is missing`],
      usedExceptions: new Set(),
    };
  const used = new Set();
  for (const crate of crates) {
    const expression = normalizeExpression(crate.license);
    if (!expression || parseSpdx(expression) === null) {
      problems.push(
        `${crate.name} ${crate.version}: license ${JSON.stringify(crate.license)} is not an SPDX expression`,
      );
      continue;
    }
    if (isAllowed(expression, rust.allowed)) continue;
    const exception = rust.exceptions.find((e) => e.crate === crate.name && e.license === crate.license);
    if (exception && typeof exception.reason === "string" && exception.reason.trim())
      used.add(exception.crate);
    else problems.push(`${crate.name} ${crate.version}: ${crate.license} is not in the "rust" policy`);
  }
  for (const e of rust.exceptions)
    if (!used.has(e.crate)) problems.push(`stale exception: ${e.crate} (${e.license}) is no longer needed`);
  return { problems, usedExceptions: used };
}

function licenseTexts(crate) {
  const dir = path.dirname(crate.manifest_path);
  const files = [];
  const named = crate.license_file ? [path.basename(crate.license_file)] : [];
  for (const entry of fs.existsSync(dir) ? fs.readdirSync(dir, { withFileTypes: true }) : [])
    if (entry.isFile() && (LICENSE_FILE.test(entry.name) || named.includes(entry.name)))
      files.push(entry.name);
  return files
    .sort(cmp)
    .map((name) => normalizeText(fs.readFileSync(path.join(dir, name), "utf8")))
    .filter((text) => text !== "");
}

/** The Markdown notice for `crates` (deterministic: sorted, no clock). */
export function renderNotice(crates, policy) {
  const groups = new Map();
  const without = [];
  for (const crate of crates) {
    const texts = licenseTexts(crate);
    if (texts.length === 0) without.push(crate);
    for (const text of texts) {
      const key = crypto.createHash("sha256").update(text).digest("hex");
      if (!groups.has(key)) groups.set(key, { text, crates: [] });
      groups.get(key).crates.push(crate);
    }
  }
  const fence = (text) => {
    let ticks = "~~~~";
    while (text.includes(ticks)) ticks += "~";
    return `${ticks}text\n${text}\n${ticks}`;
  };
  const list = (cs) => cs.map((c) => `${c.name} ${c.version}`).join(", ");
  const out = [
    "# Avisos das crates Rust do app desktop — MordomoOS",
    "",
    "> **MINUTA para revisão do dono.** Este arquivo foi gerado por script e não é aconselhamento jurídico: ninguém com formação em direito o revisou.",
    "",
    "O app desktop (`apps/desktop`, Tauri 2) é compilado de crates Rust de terceiros, cada uma sob a licença do seu autor, reproduzida abaixo como essas licenças pedem. Este arquivo completa `THIRD_PARTY_NOTICES.md` (os pacotes npm); o instalador leva os dois.",
    "",
    "Gerado por `node scripts/licenses-rust.mjs --write` a partir de `apps/desktop/Cargo.lock` (via `cargo metadata --locked`), dos arquivos de licença das crates e de `legal/license-policy.json` (seção `rust`). **Não edite à mão**: `node scripts/licenses-rust.mjs --write` reescreve e `--check` reprova um arquivo defasado.",
    "",
    `Crates de runtime: ${crates.length}. É um **superconjunto** do que um instalador leva: reúne as crates de todos os sistemas (macOS, Windows e Linux) de uma vez, para o aviso valer para os três.`,
    "",
    "## 1. Crates e licenças declaradas",
    "",
    "| Crate | Versão | Licença declarada |",
    "| --- | --- | --- |",
    ...crates.map((c) => `| ${c.name} | ${c.version} | ${(c.license ?? "").replace(/\|/g, "\\|")} |`),
    "",
  ];
  const exceptions = policy.rust?.exceptions ?? [];
  if (exceptions.length > 0) {
    out.push(
      "## 2. Crates sob `MPL-2.0`, exceção nomeada na política",
      "",
      "`MPL-2.0` é uma licença de copyleft por arquivo. As crates abaixo entram sem modificação; o código-fonte de cada versão é o publicado no registro `crates.io` (endereço de download e soma de verificação em `apps/desktop/Cargo.lock`), e quem receber o instalador pode obtê-lo de lá. A política (`legal/license-policy.json`, `rust.exceptions`) diz o motivo e fica sob revisão do dono.",
      "",
      ...exceptions.map((e) => `- **${e.crate}** (${e.license}): ${e.reason}`),
      "",
    );
  }
  out.push("## 3. Textos das licenças", "");
  [...groups.values()]
    .sort((a, b) => cmp(list(a.crates), list(b.crates)))
    .forEach((group, i) => {
      out.push(`### 3.${i + 1}. Usado por: ${list(group.crates)}`, "", fence(group.text), "");
    });
  if (without.length > 0)
    out.push(
      "## 4. Crates sem arquivo de licença no pacote publicado",
      "",
      `A licença declarada está na tabela da seção 1; o pacote publicado de cada uma destas não traz o arquivo: ${list(without)}.`,
      "",
    );
  out.push(
    "## 5. Bibliotecas do sistema no AppImage (não são crates)",
    "",
    "O pacote `.AppImage` do Linux leva, além do app, as bibliotecas compartilhadas de que a janela depende: WebKitGTK, GTK, GLib, Cairo, Pango e as que elas puxam, cerca de 200 arquivos (contados pela verificação da rodada 1 de `distribuicao` numa compilação em Linux; o conjunto exato depende da máquina que gera o pacote). Muitas são `LGPL-2.1-or-later` ou `LGPL-3.0-or-later`; as demais têm licenças próprias. Nem este arquivo nem `sbom.desktop.cdx.json` (só crates Rust) as cobrem, e o texto dessas licenças e a oferta do código-fonte que a LGPL pede não foram reproduzidos aqui. O `.deb` não as embute: depende das do sistema (`libwebkit2gtk-4.1-0`, `libgtk-3-0`; o conteúdo do `.deb` não foi relistado nesta rodada).",
    "",
    "**Pergunta ao advogado (`.specs/STATE.md`, Perguntas ao dono, distribuicao):** o AppImage cumpre a LGPL com o que o instalador leva hoje? Se não, o padrão adotado é parar de publicar o AppImage e ficar com o `.deb` até haver um inventário dessas bibliotecas e uma oferta de código-fonte.",
    "",
  );
  return out.join("\n").replace(/\n+$/, "\n");
}

export class NoCargo extends Error {}

export function readMetadata(root) {
  const res = spawnSync(
    "cargo",
    [
      "metadata",
      "--format-version",
      "1",
      "--locked",
      "--all-features",
      "--manifest-path",
      path.join(root, MANIFEST),
    ],
    { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 },
  );
  if (res.error?.code === "ENOENT") throw new NoCargo("cargo was not found on PATH");
  if (res.status !== 0) throw new Error(`cargo metadata failed:\n${res.stderr}`);
  return JSON.parse(res.stdout);
}

export function main(
  argv,
  io = { out: (s) => process.stdout.write(s), err: (s) => process.stderr.write(s) },
  metadataOf = readMetadata,
) {
  let root = ROOT;
  let mode = null;
  let requireCargo = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--root") root = path.resolve(argv[++i] ?? "");
    else if (a === "--check" || a === "--write") mode = a.slice(2);
    else if (a === "--require-cargo") requireCargo = true;
    else {
      io.err(`licenses-rust: unknown argument ${a}\n`);
      return 2;
    }
  }
  if (mode === null) {
    io.err("usage: node scripts/licenses-rust.mjs --check [--require-cargo] | --write [--root <dir>]\n");
    return 2;
  }
  let metadata;
  try {
    metadata = metadataOf(root);
  } catch (err) {
    if (err instanceof NoCargo && !requireCargo) {
      io.out(
        `licenses-rust: skipped (${err.message}). The Rust crates were NOT checked on this machine; the desktop CI job and the release workflow check them (--require-cargo).\n`,
      );
      return 0;
    }
    io.err(`licenses-rust: ${err.message}\n`);
    return 2;
  }
  const policy = JSON.parse(fs.readFileSync(path.join(root, POLICY_FILE), "utf8"));
  const crates = runtimeCrates(metadata);
  const { problems } = judge(crates, policy);
  const target = path.join(root, NOTICE_FILE);
  if (mode === "write") {
    if (problems.length > 0) {
      io.err(
        `licenses-rust: not written, the policy is not met:\n${problems.map((p) => `  - ${p}`).join("\n")}\n`,
      );
      return 1;
    }
    fs.writeFileSync(target, renderNotice(crates, policy));
    io.out(`${NOTICE_FILE}: ${crates.length} crates\n`);
    return 0;
  }
  const failures = [...problems];
  let committed = null;
  try {
    committed = normalizeText(fs.readFileSync(target, "utf8"));
  } catch {
    /* missing */
  }
  if (committed === null)
    failures.push(`${NOTICE_FILE} does not exist (run node scripts/licenses-rust.mjs --write)`);
  else if (committed !== normalizeText(renderNotice(crates, policy)))
    failures.push(
      `${NOTICE_FILE} is stale: it differs from what Cargo.lock produces (run node scripts/licenses-rust.mjs --write)`,
    );
  if (failures.length > 0) {
    io.err(`licenses-rust: check failed\n${failures.map((p) => `  - ${p}`).join("\n")}\n`);
    return 1;
  }
  io.out(`licenses-rust: ok (${crates.length} crates)\n`);
  return 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main(process.argv.slice(2));
}
