#!/usr/bin/env node
/**
 * Build a self-contained MordomoOS distributable.
 *
 *   node scripts/package.mjs [--out release] [--skip-build] [--node <version>|none]
 *                            [--platform darwin|linux|win32] [--arch arm64|x64] [--no-archive]
 *
 * Output (per platform) — nothing in it is source code:
 *   lib/mordomo.mjs            the whole API + CLI as one minified bundle
 *   lib/node_modules/          the SQLite native addon (the only non-bundled dependency)
 *   ui/                        the built Command Centre
 *   seed/                      default skills, routines and connectors (copied to the user home on first run)
 *   runtime/                   an official Node.js binary (unless --node none)
 *   MordomoOS.app | MordomoOS | MordomoOS.cmd   double-click launcher → starts the service and opens the browser
 *   bin/mordomo (.cmd)         the terminal CLI, for people who prefer it
 *
 * User data never lives here: the CLI resolves the per-user data folder
 * (~/Library/Application Support/MordomoOS, ~/.local/share/mordomo-os, %LOCALAPPDATA%\MordomoOS).
 */
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { build } from "rolldown";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));

const args = parseArgs(process.argv.slice(2));
const platform = args.platform ?? process.platform;
const arch = args.arch ?? process.arch;
const nodeVersion =
  args.node === undefined ? process.versions.node : args.node === "none" ? null : args.node.replace(/^v/, "");
const outDir = path.resolve(ROOT, args.out ?? "release");
const stageRoot = path.join(ROOT, "build", "package");
const label = `${platform === "darwin" ? "MordomoOS" : platform === "win32" ? "MordomoOS" : "mordomo-os"}-${pkg.version}-${
  { darwin: "macos", win32: "windows", linux: "linux" }[platform] ?? platform
}-${arch}`;
const stage = path.join(stageRoot, label);
// On macOS everything lives inside the .app so it can be dropped in /Applications as one item.
const payload = platform === "darwin" ? path.join(stage, "MordomoOS.app", "Contents", "Resources") : stage;

if (!["darwin", "linux", "win32"].includes(platform)) fail(`Unsupported platform: ${platform}`);
log(
  `Packaging MordomoOS ${pkg.version} for ${platform}/${arch}${nodeVersion ? ` with Node ${nodeVersion}` : " (system Node)"}`,
);

if (!args.skipBuild) {
  log("Building workspaces…");
  run("npm", ["run", "build"], ROOT);
}
for (const required of ["apps/api/dist/cli.js", "apps/command-centre/dist/index.html"]) {
  if (!fs.existsSync(path.join(ROOT, required))) fail(`${required} is missing — run npm run build`);
}

fs.rmSync(stage, { recursive: true, force: true });
fs.mkdirSync(payload, { recursive: true });

// ---- 1. one minified bundle for the API + CLI --------------------------------
log("Bundling the API and CLI…");
await build({
  input: path.join(ROOT, "apps", "api", "dist", "cli.js"),
  platform: "node",
  external: ["better-sqlite3"],
  logLevel: "silent",
  output: {
    file: path.join(payload, "lib", "mordomo.mjs"),
    format: "esm",
    minify: true,
    sourcemap: false,
    banner: `/* MordomoOS ${pkg.version} — ${new Date().toISOString()} */`,
  },
});

// ---- 2. the native SQLite addon (kept outside the bundle) --------------------
log("Copying the SQLite addon…");
const nm = path.join(payload, "lib", "node_modules");
copyPackage("better-sqlite3", nm, ["package.json", "lib", "build/Release/better_sqlite3.node"]);
copyPackage("bindings", nm, ["package.json", "bindings.js"]);
copyPackage("file-uri-to-path", nm, ["package.json", "index.js"]);
// The addon is tied to the Node ABI: any other platform, architecture or Node
// major than the one running this script needs the matching prebuild.
const targetNode = nodeVersion ?? process.versions.node;
if (
  platform !== process.platform ||
  arch !== process.arch ||
  targetNode.split(".")[0] !== process.versions.node.split(".")[0]
) {
  await fetchSqlitePrebuild(path.join(nm, "better-sqlite3"), platform, arch, targetNode);
}

// ---- 3. UI, seeds, manifest, docs ------------------------------------------------
log("Copying the Command Centre and seed data…");
fs.cpSync(path.join(ROOT, "apps", "command-centre", "dist"), path.join(payload, "ui"), { recursive: true });
for (const dir of ["skills", "routines", "connectors"]) {
  fs.cpSync(path.join(ROOT, dir), path.join(payload, "seed", dir), {
    recursive: true,
    filter: (src) => !/[\\/](NOTES\.archive\.md|\.DS_Store)$/.test(src),
  });
}
fs.writeFileSync(
  path.join(payload, "package.json"),
  JSON.stringify(
    {
      name: "mordomo-os",
      version: pkg.version,
      private: true,
      type: "module",
      packagedAt: new Date().toISOString(),
      platform,
      arch,
    },
    null,
    2,
  ),
);
fs.copyFileSync(path.join(ROOT, "LICENSE"), path.join(payload, "LICENSE"));

// ---- 4. Node runtime ---------------------------------------------------------------
if (nodeVersion) {
  log(`Fetching Node ${nodeVersion} for ${platform}/${arch}…`);
  await fetchNode(nodeVersion, platform, arch, path.join(payload, "runtime"));
}

// ---- 5. launchers --------------------------------------------------------------------
log("Writing launchers…");
writeLaunchers();
fs.writeFileSync(path.join(stage, "README.txt"), readme());

// ---- 6. archive ------------------------------------------------------------------------
if (args.archive !== false) {
  fs.mkdirSync(outDir, { recursive: true });
  const archive = path.join(outDir, `${label}.${platform === "linux" ? "tar.gz" : "zip"}`);
  fs.rmSync(archive, { force: true });
  log(`Archiving → ${path.relative(ROOT, archive)}`);
  if (platform === "linux") run("tar", ["-czf", archive, "-C", stageRoot, label], ROOT);
  else if (process.platform === "darwin") run("ditto", ["-c", "-k", "--keepParent", stage, archive], ROOT);
  else if (process.platform === "win32")
    run(
      "powershell",
      ["-NoProfile", "-Command", `Compress-Archive -Path '${stage}' -DestinationPath '${archive}'`],
      ROOT,
    );
  else run("zip", ["-qr", "-y", archive, label], stageRoot);
  log(`Done: ${archive} (${(fs.statSync(archive).size / 1024 / 1024).toFixed(1)} MB)`);
} else {
  log(`Done: ${stage}`);
}

// =============================================================================
function writeLaunchers() {
  const runtimeNode = platform === "win32" ? "runtime\\node.exe" : "runtime/bin/node";
  if (platform === "win32") {
    const cmd = (relDir) => `@echo off\r
setlocal\r
set "DIR=%~dp0${relDir}"\r
if exist "%DIR%${runtimeNode}" (set "NODE=%DIR%${runtimeNode}") else (\r
  where node >nul 2>nul || (echo Node.js 22 or newer is required: https://nodejs.org & exit /b 1)\r
  set "NODE=node"\r
)\r
`;
    fs.mkdirSync(path.join(payload, "bin"), { recursive: true });
    fs.writeFileSync(
      path.join(payload, "bin", "mordomo.cmd"),
      `${cmd("..\\")}"%NODE%" "%DIR%lib\\mordomo.mjs" %*\r\n`,
    );
    fs.writeFileSync(
      path.join(stage, "MordomoOS.cmd"),
      `${cmd("")}"%NODE%" "%DIR%lib\\mordomo.mjs" launch\r\nif errorlevel 1 (echo MordomoOS could not start. See the logs folder in %LOCALAPPDATA%\\MordomoOS & pause)\r\n`,
    );
    return;
  }
  const sh = `#!/bin/sh
# MordomoOS command line. Uses the bundled Node runtime when present.
DIR="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
if [ -x "$DIR/${runtimeNode}" ]; then
  NODE="$DIR/${runtimeNode}"
elif command -v node >/dev/null 2>&1; then
  NODE=node
else
  echo "Node.js 22 or newer is required: https://nodejs.org" >&2
  exit 1
fi
exec "$NODE" "$DIR/lib/mordomo.mjs" "$@"
`;
  fs.mkdirSync(path.join(payload, "bin"), { recursive: true });
  writeExecutable(path.join(payload, "bin", "mordomo"), sh);

  if (platform === "darwin") {
    const contents = path.join(stage, "MordomoOS.app", "Contents");
    fs.mkdirSync(path.join(contents, "MacOS"), { recursive: true });
    writeExecutable(
      path.join(contents, "MacOS", "MordomoOS"),
      `#!/bin/sh
# Double-click entry point: start the local service and open the Command Centre.
RES="$(CDPATH= cd -- "$(dirname -- "$0")/../Resources" && pwd)"
if ! "$RES/bin/mordomo" launch >/tmp/mordomo-launch.log 2>&1; then
  osascript -e 'display alert "MordomoOS could not start" message "Details: /tmp/mordomo-launch.log and ~/Library/Application Support/MordomoOS/logs" as critical' >/dev/null 2>&1
  exit 1
fi
`,
    );
    const icns = makeIcns(path.join(contents, "Resources"));
    fs.writeFileSync(
      path.join(contents, "Info.plist"),
      `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleName</key><string>MordomoOS</string>
  <key>CFBundleDisplayName</key><string>MordomoOS</string>
  <key>CFBundleIdentifier</key><string>com.mordomo.app</string>
  <key>CFBundleVersion</key><string>${pkg.version}</string>
  <key>CFBundleShortVersionString</key><string>${pkg.version}</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleExecutable</key><string>MordomoOS</string>
  ${icns ? "<key>CFBundleIconFile</key><string>MordomoOS</string>" : ""}
  <key>LSMinimumSystemVersion</key><string>12.0</string>
  <key>LSUIElement</key><true/>
  <key>NSHighResolutionCapable</key><true/>
</dict>
</plist>
`,
    );
    // The bundled node is signed by the Node.js project; an ad-hoc signature on the
    // app makes the bundle self-consistent. Gatekeeper still asks on first open.
    if (process.platform === "darwin" && commandExists("codesign")) {
      const res = spawnSync(
        "codesign",
        ["--force", "--deep", "--sign", "-", path.join(stage, "MordomoOS.app")],
        { stdio: "ignore" },
      );
      if (res.status !== 0) log("(codesign skipped)");
    }
    writeExecutable(
      path.join(stage, "mordomo"),
      `#!/bin/sh
# Terminal entry point: same CLI the app uses.
exec "$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)/MordomoOS.app/Contents/Resources/bin/mordomo" "$@"
`,
    );
    return;
  }
  // linux
  writeExecutable(
    path.join(stage, "MordomoOS"),
    `#!/bin/sh
# Double-click (or run) to start the local service and open the Command Centre.
DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
exec "$DIR/bin/mordomo" launch
`,
  );
  fs.writeFileSync(
    path.join(stage, "mordomo-os.desktop"),
    `[Desktop Entry]
Type=Application
Name=MordomoOS
Comment=Local agentic OS over Claude Code, Cursor Agent and Codex
Exec=INSTALL_DIR/MordomoOS
Icon=INSTALL_DIR/ui/icons/icon-512.png
Terminal=false
Categories=Development;Utility;
`,
  );
}

function makeIcns(resources) {
  if (process.platform !== "darwin" || !commandExists("iconutil") || !commandExists("sips")) return false;
  const source = path.join(ROOT, "apps", "command-centre", "public", "icons", "icon-512.png");
  if (!fs.existsSync(source)) return false;
  const iconset = path.join(os.tmpdir(), `mordomo-${process.pid}.iconset`);
  fs.rmSync(iconset, { recursive: true, force: true });
  fs.mkdirSync(iconset);
  for (const [name, size] of [
    ["icon_16x16", 16],
    ["icon_16x16@2x", 32],
    ["icon_32x32", 32],
    ["icon_32x32@2x", 64],
    ["icon_128x128", 128],
    ["icon_128x128@2x", 256],
    ["icon_256x256", 256],
    ["icon_256x256@2x", 512],
    ["icon_512x512", 512],
  ]) {
    spawnSync(
      "sips",
      ["-z", String(size), String(size), source, "--out", path.join(iconset, `${name}.png`)],
      { stdio: "ignore" },
    );
  }
  const res = spawnSync("iconutil", ["-c", "icns", iconset, "-o", path.join(resources, "MordomoOS.icns")], {
    stdio: "ignore",
  });
  fs.rmSync(iconset, { recursive: true, force: true });
  return res.status === 0;
}

function readme() {
  const app = platform === "darwin" ? "MordomoOS.app" : platform === "win32" ? "MordomoOS.cmd" : "MordomoOS";
  const cli = platform === "win32" ? "bin\\mordomo.cmd" : platform === "darwin" ? "./mordomo" : "bin/mordomo";
  return `MordomoOS ${pkg.version} — ${platform}/${arch}
==========================================

EN
--
1. Open ${app}. The local service starts and your browser opens http://127.0.0.1:4777.
2. The setup screen detects Claude Code, Cursor Agent and Codex on this computer,
   shows how to install or sign in to each one, and lets you pick folders and a look.
3. Your data (settings, memory, artifacts, logs) is kept in your user profile, not here:
   macOS  ~/Library/Application Support/MordomoOS
   Linux  ~/.local/share/mordomo-os
   Windows %LOCALAPPDATA%\\MordomoOS
${
  platform === "darwin"
    ? `
macOS: the app is not notarized. On the first open, right-click MordomoOS.app → Open → Open
(or run: xattr -dr com.apple.quarantine MordomoOS.app). Move the app to /Applications first
if you plan to enable "start at login" from Settings.
`
    : ""
}
Terminal (optional): ${cli} setup | start | stop | status | doctor | restart | launch
Uninstall: ${cli} uninstall (keeps your data; add --purge to remove it), then delete this folder.

PT-BR
-----
1. Abra ${app}. O serviço local inicia e o navegador abre http://127.0.0.1:4777.
2. A tela de configuração detecta Claude Code, Cursor Agent e Codex neste computador,
   mostra como instalar ou fazer login em cada um e permite escolher pastas e o visual.
3. Seus dados (configurações, memória, artefatos, logs) ficam no seu perfil de usuário, não aqui.
${
  platform === "darwin"
    ? `
macOS: o app não é notarizado. Na primeira abertura, clique com o botão direito em MordomoOS.app → Abrir → Abrir
(ou execute: xattr -dr com.apple.quarantine MordomoOS.app). Mova o app para /Applications antes de
ativar "iniciar no login" nas Configurações.
`
    : ""
}
Terminal (opcional): ${cli} setup | start | stop | status | doctor | restart | launch
Desinstalar: ${cli} uninstall (mantém seus dados; use --purge para removê-los) e apague esta pasta.

Runtime: ${nodeVersion ? `Node.js ${nodeVersion} (bundled in runtime/)` : "uses the Node.js 22+ installed on this computer"}.
`;
}

// ---- helpers ----------------------------------------------------------------------
function copyPackage(name, destRoot, entries) {
  const from = path.join(ROOT, "node_modules", name);
  if (!fs.existsSync(from)) fail(`node_modules/${name} is missing — run npm install`);
  for (const entry of entries) {
    const src = path.join(from, entry);
    if (!fs.existsSync(src)) fail(`${name}/${entry} is missing`);
    fs.cpSync(src, path.join(destRoot, name, entry), { recursive: true });
  }
}

/** Cross-target packaging: replace the host's addon with the prebuilt one for the target. */
async function fetchSqlitePrebuild(dir, targetPlatform, targetArch, target) {
  log(`Fetching the better-sqlite3 prebuild for ${targetPlatform}/${targetArch} (Node ${target})…`);
  const res = spawnSync(
    process.execPath,
    [
      path.join(ROOT, "node_modules", "prebuild-install", "bin.js"),
      `--platform=${targetPlatform}`,
      `--arch=${targetArch}`,
      `--target=${target}`,
      "--runtime=node",
      "--verbose",
    ],
    { cwd: dir, encoding: "utf8" },
  );
  if (res.status !== 0) fail(`prebuild-install failed:\n${res.stderr || res.stdout}`);
}

async function fetchNode(version, targetPlatform, targetArch, dest) {
  const plat = targetPlatform === "win32" ? "win" : targetPlatform;
  const ext = targetPlatform === "win32" ? "zip" : "tar.gz";
  const name = `node-v${version}-${plat}-${targetArch}`;
  const base = `https://nodejs.org/dist/v${version}`;
  const cache = path.join(ROOT, "build", "node-cache");
  fs.mkdirSync(cache, { recursive: true });
  const archive = path.join(cache, `${name}.${ext}`);
  const sums = await (await fetchOk(`${base}/SHASUMS256.txt`)).text();
  const expected = sums
    .split("\n")
    .find((l) => l.endsWith(`  ${name}.${ext}`))
    ?.split(/\s+/)[0];
  if (!expected) fail(`Node ${version} has no build for ${plat}/${targetArch}`);
  if (!fs.existsSync(archive) || sha256(archive) !== expected) {
    const body = Buffer.from(await (await fetchOk(`${base}/${name}.${ext}`)).arrayBuffer());
    fs.writeFileSync(archive, body);
    if (sha256(archive) !== expected) fail(`Checksum mismatch for ${name}.${ext}`);
  }
  const extract = fs.mkdtempSync(path.join(os.tmpdir(), "mordomo-node-"));
  if (ext === "zip") {
    if (process.platform === "win32")
      run(
        "powershell",
        ["-NoProfile", "-Command", `Expand-Archive -Path '${archive}' -DestinationPath '${extract}'`],
        ROOT,
      );
    else if (commandExists("unzip")) run("unzip", ["-q", archive, "-d", extract], ROOT);
    else run("tar", ["-xf", archive, "-C", extract], ROOT);
  } else run("tar", ["-xzf", archive, "-C", extract], ROOT);
  const unpacked = path.join(extract, name);
  fs.rmSync(dest, { recursive: true, force: true });
  if (targetPlatform === "win32") {
    fs.mkdirSync(dest, { recursive: true });
    fs.copyFileSync(path.join(unpacked, "node.exe"), path.join(dest, "node.exe"));
  } else {
    fs.mkdirSync(path.join(dest, "bin"), { recursive: true });
    fs.copyFileSync(path.join(unpacked, "bin", "node"), path.join(dest, "bin", "node"));
    fs.chmodSync(path.join(dest, "bin", "node"), 0o755);
  }
  fs.copyFileSync(path.join(unpacked, "LICENSE"), path.join(dest, "LICENSE"));
  fs.rmSync(extract, { recursive: true, force: true });
}

async function fetchOk(url) {
  const res = await fetch(url);
  if (!res.ok) fail(`${url}: HTTP ${res.status}`);
  return res;
}
function sha256(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}
function writeExecutable(file, content) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
  fs.chmodSync(file, 0o755);
}
function commandExists(name) {
  const res = spawnSync(process.platform === "win32" ? "where" : "which", [name], { stdio: "ignore" });
  return res.status === 0;
}
function run(cmd, cmdArgs, cwd) {
  const res = spawnSync(cmd, cmdArgs, { cwd, stdio: "inherit", shell: process.platform === "win32" });
  if (res.status !== 0) fail(`${cmd} ${cmdArgs.join(" ")} exited with ${res.status}`);
}
function log(msg) {
  console.log(`▸ ${msg}`);
}
function fail(msg) {
  console.error(`✘ ${msg}`);
  process.exit(1);
}
function parseArgs(argv) {
  const out = { archive: true, skipBuild: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => argv[++i] ?? fail(`${a} needs a value`);
    if (a === "--out") out.out = next();
    else if (a === "--node") out.node = next();
    else if (a === "--platform") out.platform = next();
    else if (a === "--arch") out.arch = next();
    else if (a === "--skip-build") out.skipBuild = true;
    else if (a === "--no-archive") out.archive = false;
    else if (a === "--help" || a === "-h") {
      console.log(fs.readFileSync(fileURLToPath(import.meta.url), "utf8").split("*/")[0]);
      process.exit(0);
    } else fail(`Unknown option ${a}`);
  }
  return out;
}
