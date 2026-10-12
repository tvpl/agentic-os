#!/usr/bin/env node
/**
 * Build a self-contained MordomoOS distributable.
 *
 *   node scripts/package.mjs [--out release] [--skip-build] [--node <version>|none]
 *                            [--platform darwin|linux|win32] [--arch arm64|x64] [--no-archive]
 *                            [--sign "<Developer ID Application: …>"] [--notarize <notarytool-profile>]
 *                            [--payload <dir>]
 *
 * --payload <dir> writes only what the desktop app (apps/desktop, Tauri) carries as its resources: lib/, ui/, seed/,
 * runtime/, legal/, package.json, in exactly that folder, with no launcher, no README and no archive; on macOS the
 * native code in it (the Node binary, the SQLite addon) is signed here, with --sign or ad hoc, because the Tauri
 * bundler signs the app and not the resources inside it.
 *
 * macOS signing: without --sign the app gets an ad-hoc signature (Gatekeeper
 * asks once). With a Developer ID identity (`security find-identity -v -p
 * codesigning`, the name or its SHA-1) the bundle is signed with the hardened
 * runtime; add --notarize <profile> (a keychain profile created with `xcrun
 * notarytool store-credentials`) to submit the zip, wait, and staple the ticket.
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
import { stageLegal } from "./legal-stage.mjs";
import { stageDesktopLegal } from "./legal-stage.mjs";

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
const payloadOnly = args.payload !== undefined;
const stage = payloadOnly ? path.resolve(ROOT, args.payload) : path.join(stageRoot, label);
// On macOS everything lives inside the .app so it can be dropped in /Applications as one item.
const payload =
  platform === "darwin" && !payloadOnly ? path.join(stage, "MordomoOS.app", "Contents", "Resources") : stage;

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
// LICENSE, the legal texts, the third-party notices and the SBOM travel with the app (.specs/features/licenca-comercial, door 6).
stageLegal(ROOT, payload);
if (payloadOnly) stageDesktopLegal(ROOT, payload);

// ---- 4. Node runtime ---------------------------------------------------------------
if (nodeVersion) {
  log(`Fetching Node ${nodeVersion} for ${platform}/${arch}…`);
  await fetchNode(nodeVersion, platform, arch, path.join(payload, "runtime"));
}

if (payloadOnly) {
  // ---- 5. the desktop app's payload: sign the native code in it and stop -----------------
  if (platform === "darwin" && process.platform === "darwin" && commandExists("codesign")) {
    signNative(machObjects(payload), args.sign ?? "-", path.join(payload, "runtime", "bin", "node"));
    if (args.sign) log(`Signed the native code with ${args.sign}`);
  } else if (args.sign) fail("--sign needs macOS with codesign");
  log(`Payload: ${stage}`);
  process.exit(0);
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
  if (args.notarize) {
    if (platform !== "darwin" || process.platform !== "darwin")
      fail("--notarize needs a macOS build on macOS");
    if (!args.sign) fail("--notarize needs --sign with a Developer ID identity");
    log(`Notarizing with keychain profile ${args.notarize} (this waits for Apple)…`);
    const submit = spawnSync(
      "xcrun",
      [
        "notarytool",
        "submit",
        archive,
        "--keychain-profile",
        args.notarize,
        "--wait",
        "--output-format",
        "json",
      ],
      { cwd: ROOT, encoding: "utf8" },
    );
    let result = { id: null, status: null };
    try {
      result = JSON.parse(submit.stdout.trim().split("\n").pop() ?? "{}");
    } catch {
      /* fall through: reported below */
    }
    log(`Notary service: ${result.status ?? "no answer"}${result.id ? ` (submission ${result.id})` : ""}`);
    if (result.status !== "Accepted") {
      if (result.id) {
        const details = spawnSync(
          "xcrun",
          ["notarytool", "log", result.id, "--keychain-profile", args.notarize],
          {
            cwd: ROOT,
            encoding: "utf8",
          },
        );
        console.error(details.stdout || details.stderr);
      } else console.error(submit.stderr || submit.stdout);
      fail("Notarization was not accepted — the archive was left unsigned by Apple (see the log above)");
    }
    run("xcrun", ["stapler", "staple", path.join(stage, "MordomoOS.app")], ROOT);
    fs.rmSync(archive, { force: true });
    run("ditto", ["-c", "-k", "--keepParent", stage, archive], ROOT);
    log("Notarization ticket stapled; archive rebuilt.");
  }
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
"$NODE" "$DIR/lib/mordomo.mjs" "$@"
status=$?
# macOS stops a downloaded binary started from a terminal (SIGTRAP, 133)
# until the app has been opened once and Gatekeeper has verified it.
if [ "$status" -eq 133 ] && [ "$(uname)" = "Darwin" ]; then
  echo "macOS stopped the bundled runtime (signal 133)." >&2
  echo "If this copy was just downloaded, open MordomoOS.app once (double-click, then Open) so macOS can verify it, or run:" >&2
  echo "  xattr -dr com.apple.quarantine '$DIR/../..'" >&2
  echo "If it still fails, the build was signed without the JIT entitlements: rebuild with scripts/package.mjs." >&2
fi
exit $status
`;
  fs.mkdirSync(path.join(payload, "bin"), { recursive: true });
  writeExecutable(path.join(payload, "bin", "mordomo"), sh);

  if (platform === "darwin") {
    const contents = path.join(stage, "MordomoOS.app", "Contents");
    fs.mkdirSync(path.join(contents, "MacOS"), { recursive: true });
    // Native shell: a WKWebView window compiled from scripts/macos-app/main.swift.
    // Without swiftc (or on another host) the launcher falls back to a script
    // that starts the service and opens the default browser.
    const nativeShell = buildNativeShell(path.join(contents, "MacOS", "MordomoOS"));
    if (!nativeShell)
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
  ${nativeShell ? "" : "<key>LSUIElement</key><true/>"}
  <key>NSHighResolutionCapable</key><true/>
  <key>NSAppTransportSecurity</key><dict><key>NSAllowsLocalNetworking</key><true/></dict>
  <key>NSMicrophoneUsageDescription</key><string>The console can take voice input for the agent.</string>
  <key>NSSupportsAutomaticGraphicsSwitching</key><true/>
</dict>
</plist>
`,
    );
    // Without an identity: an ad-hoc signature keeps the bundle self-consistent
    // (Gatekeeper still asks on first open). With one: Developer ID + hardened
    // runtime + secure timestamp, so the app can be notarized. Nested code
    // (the Node binary) is signed first, then the bundle.
    if (process.platform === "darwin" && commandExists("codesign")) {
      const app = path.join(stage, "MordomoOS.app");
      const identity = args.sign ?? "-";
      // Every Mach-O in the payload must carry the Developer ID signature and a
      // timestamp or the notary service rejects the archive: the Node binary,
      // the SQLite addon, anything else that looks like native code, then the app.
      signNative([...machObjects(payload), app], identity, path.join(payload, "runtime", "bin", "node"));
      if (args.sign) log(`Signed with ${args.sign}`);
    } else if (args.sign) fail("--sign needs macOS with codesign");
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

/** Native binaries under `dir` (the Node runtime, `.node` addons, dylibs), deepest first. */
function machObjects(dir) {
  const out = [];
  const walk = (d) => {
    for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
      const full = path.join(d, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.(node|dylib)$/.test(entry.name) || full.endsWith(path.join("runtime", "bin", "node")))
        out.push(full);
    }
  };
  walk(dir);
  return out;
}

/**
 * Sign `targets` in order. With a Developer ID identity: hardened runtime and a secure timestamp, and the JIT
 * entitlements on the Node binary (V8 needs them or Node dies with SIGTRAP at startup); with "-": an ad-hoc signature.
 * A signed Node binary that no longer starts fails here, before a notarization round trip is spent on it.
 */
function signNative(targets, identity, nodeBinary) {
  const signed = identity !== "-";
  const flags = signed ? ["--options", "runtime", "--timestamp"] : [];
  const entitlements = path.join(os.tmpdir(), `mordomo-${process.pid}-entitlements.plist`);
  fs.writeFileSync(
    entitlements,
    `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>com.apple.security.cs.allow-jit</key><true/>
  <key>com.apple.security.cs.allow-unsigned-executable-memory</key><true/>
</dict>
</plist>
`,
  );
  for (const target of targets) {
    const withEntitlements = signed && target === nodeBinary;
    const res = spawnSync(
      "codesign",
      [
        "--force",
        ...flags,
        ...(withEntitlements ? ["--entitlements", entitlements] : []),
        "--sign",
        identity,
        target,
      ],
      { stdio: "inherit" },
    );
    if (res.status !== 0) fail(`codesign failed for ${path.relative(stage, target)}`);
  }
  fs.rmSync(entitlements, { force: true });
  if (signed && fs.existsSync(nodeBinary)) {
    const probe = spawnSync(nodeBinary, ["-e", "process.exit(42)"], { stdio: "ignore" });
    if (probe.status !== 42)
      fail(
        `the signed Node runtime does not start (status ${probe.status}, signal ${probe.signal}) — check the entitlements`,
      );
  }
}

/** Compile the Swift shell for the target architecture; false when swiftc is unavailable. */
function buildNativeShell(output) {
  if (process.platform !== "darwin" || !commandExists("swiftc")) return false;
  const source = path.join(ROOT, "scripts", "macos-app", "main.swift");
  const target = `${arch === "x64" ? "x86_64" : arch}-apple-macos12.0`;
  log(`Compiling the native macOS shell (${target})…`);
  const res = spawnSync(
    "swiftc",
    ["-O", "-target", target, "-framework", "Cocoa", "-framework", "WebKit", "-o", output, source],
    { stdio: "inherit" },
  );
  if (res.status !== 0)
    fail(
      "swiftc failed — fix scripts/macos-app/main.swift or package on a host without swiftc for the script launcher",
    );
  fs.chmodSync(output, 0o755);
  return true;
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
1. Open ${app}. ${platform === "darwin" ? "The local service starts and the Command Centre opens in its own window (View → Open in Browser if you prefer the browser)." : "The local service starts and your browser opens http://127.0.0.1:4777."}
2. The setup screen detects Claude Code, Cursor Agent and Codex on this computer,
   shows how to install or sign in to each one, and lets you pick folders and a look.
3. Your data (settings, memory, artifacts, logs) is kept in your user profile, not here:
   macOS  ~/Library/Application Support/MordomoOS
   Linux  ~/.local/share/mordomo-os
   Windows %LOCALAPPDATA%\\MordomoOS
${
  platform === "darwin"
    ? `
macOS: open MordomoOS.app once from the Finder before using ./mordomo in a terminal —
macOS verifies a downloaded app on its first open (a notarized build opens directly;
an unsigned one needs right-click → Open). Move the app to /Applications first if you
plan to enable "start at login" from Settings.
`
    : ""
}
Terminal (optional): ${cli} setup | start | stop | status | doctor | restart | launch
Uninstall: ${cli} uninstall (keeps your data; add --purge to remove it), then delete this folder.
License: LICENSE (Functional Source License 1.1, Apache-2.0 future license). legal/ holds the third-party
notices, the SBOM and the draft terms and privacy policy. MordomoOS orchestrates Claude Code, Cursor Agent
and Codex; it does not bundle them, and each follows its supplier's terms.

PT-BR
-----
1. Abra ${app}. ${platform === "darwin" ? "O serviço local inicia e o Command Centre abre na própria janela do app (View → Open in Browser se preferir o navegador)." : "O serviço local inicia e o navegador abre http://127.0.0.1:4777."}
2. A tela de configuração detecta Claude Code, Cursor Agent e Codex neste computador,
   mostra como instalar ou fazer login em cada um e permite escolher pastas e o visual.
3. Seus dados (configurações, memória, artefatos, logs) ficam no seu perfil de usuário, não aqui.
${
  platform === "darwin"
    ? `
macOS: abra o MordomoOS.app uma vez pelo Finder antes de usar ./mordomo no terminal —
o macOS verifica um app baixado na primeira abertura (um build notarizado abre direto;
um não assinado exige botão direito → Abrir). Mova o app para /Applications antes de
ativar "iniciar no login" nas Configurações.
`
    : ""
}
Terminal (opcional): ${cli} setup | start | stop | status | doctor | restart | launch
Desinstalar: ${cli} uninstall (mantém seus dados; use --purge para removê-los) e apague esta pasta.
Licença: LICENSE (Functional Source License 1.1, licença futura Apache-2.0). A pasta legal/ tem os avisos de
terceiros, o SBOM e as minutas dos termos e da privacidade. O MordomoOS orquestra o Claude Code, o Cursor Agent e
o Codex; não os inclui, e cada um segue os termos do seu fornecedor.

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
    else if (a === "--sign") out.sign = next();
    else if (a === "--notarize") out.notarize = next();
    else if (a === "--payload") out.payload = next();
    else if (a === "--skip-build") out.skipBuild = true;
    else if (a === "--no-archive") out.archive = false;
    else if (a === "--help" || a === "-h") {
      console.log(fs.readFileSync(fileURLToPath(import.meta.url), "utf8").split("*/")[0]);
      process.exit(0);
    } else fail(`Unknown option ${a}`);
  }
  return out;
}
