import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * distribuicao, S3-S4: what the desktop app is allowed to be (.specs/features/distribuicao, AC 28, 30, 32), read from
 * its configuration and its manifests. Whether the Rust does what these allow is `cargo test` and apps/desktop/smoke/gui.sh.
 */

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DESKTOP = path.join(ROOT, "apps", "desktop");
const TAURI = path.join(DESKTOP, "src-tauri");
const read = (...parts: string[]) => fs.readFileSync(path.join(...parts), "utf8");
const conf = JSON.parse(read(TAURI, "tauri.conf.json")) as Record<string, any>;
const cargoToml = read(TAURI, "Cargo.toml");

describe("C27 the webview loads only its own files and the service's loopback origin", () => {
  const csp = new Map(
    (conf.app.security.csp as string)
      .split(";")
      .map((d) => d.trim().split(/\s+/))
      .map(([name, ...values]) => [name!, values] as const),
  );

  it("C27 the content-security-policy of the shell's own pages: nothing by default, self for script, style and image, ipc for connect", () => {
    expect(Object.fromEntries(csp)).toEqual({
      "default-src": ["'none'"],
      "script-src": ["'self'"],
      "style-src": ["'self'"],
      "img-src": ["'self'"],
      "connect-src": ["ipc:", "http://ipc.localhost"],
      "base-uri": ["'none'"],
      "form-action": ["'none'"],
      "frame-ancestors": ["'none'"],
    });
    expect(conf.app.security.csp).not.toMatch(
      /unsafe-inline|unsafe-eval|data:|blob:|\*|https?:\/\/(?!ipc\.localhost)/,
    );
    expect(conf.app.security.freezePrototype).toBe(true);
  });

  it("C27 the window capability grants exactly the three app commands to the window `main`, with no remote scope", () => {
    const files = fs.readdirSync(path.join(TAURI, "capabilities")).sort();
    expect(files).toEqual(["main.json"]);
    const capability = JSON.parse(read(TAURI, "capabilities", "main.json")) as Record<string, any>;
    expect(capability.windows).toEqual(["main"]);
    expect(capability.permissions).toEqual(["allow-shell-status", "allow-shell-retry", "allow-shell-quit"]);
    for (const key of ["remote", "webviews", "platforms", "local"])
      expect(capability, key).not.toHaveProperty(key);
    expect(JSON.stringify(capability)).not.toMatch(
      /shell:|fs:|http:|core:|opener:|dialog:|updater:|process:|execute|\*/,
    );
  });

  it("C27 the commands the capability allows are the ones the build script declares and the handler registers", () => {
    const build = read(TAURI, "build.rs");
    const declared = [...(/commands\(&\[([^\]]*)\]/.exec(build)?.[1] ?? "").matchAll(/"([a-z_]+)"/g)].map(
      (m) => m[1],
    );
    const handler = /generate_handler!\[([^\]]*)\]/s.exec(read(TAURI, "src", "lib.rs"))?.[1] ?? "";
    const registered = [...handler.matchAll(/shell::([a-z_]+)/g)].map((m) => m[1]);
    expect(declared).toEqual(["shell_status", "shell_retry", "shell_quit"]);
    expect(registered).toEqual(declared);
    const capability = JSON.parse(read(TAURI, "capabilities", "main.json")) as { permissions: string[] };
    expect(capability.permissions).toEqual(declared.map((c) => `allow-${c!.replace(/_/g, "-")}`));
  });

  it("C27 no plugin that executes programs, reads files, makes HTTP calls or talks to the shell is a dependency", () => {
    const dependencies = /\[dependencies\]([\s\S]*?)(?:\n\[|$)/.exec(cargoToml)![1]!;
    const names = [...dependencies.matchAll(/^([a-z0-9_-]+)\s*=/gm)].map((m) => m[1]!).sort();
    expect(names).toEqual([
      "mordomo-shell-core",
      "serde",
      "serde_json",
      "tauri",
      "tauri-plugin-dialog",
      "tauri-plugin-opener",
      "tauri-plugin-single-instance",
      "tauri-plugin-updater",
    ]);
    for (const banned of [
      "tauri-plugin-shell",
      "tauri-plugin-fs",
      "tauri-plugin-http",
      "tauri-plugin-process",
      "tauri-plugin-os",
      "tauri-plugin-websocket",
      "tauri-plugin-sql",
      "tauri-plugin-store",
    ])
      expect(cargoToml, banned).not.toContain(banned);
    expect(JSON.stringify(conf)).not.toMatch(
      /shell:allow|"scope"|"open"\s*:\s*true|dangerousRemoteDomainIpcAccess|dangerousDisableAssetCspModification/,
    );
  });

  it("C27 the shell's own pages have no inline script, no event-handler attribute, no remote address, and the script no eval, no network and no HTML sink", () => {
    const html = read(DESKTOP, "ui", "index.html");
    const script = read(DESKTOP, "ui", "shell.js");
    expect(html.match(/<script\b[^>]*>/g)).toEqual(['<script src="shell.js">']);
    expect(html).not.toMatch(/<script[^>]*>[^<]+<\/script>/);
    expect(html).not.toMatch(/\son[a-z]+\s*=/i);
    expect(html).not.toMatch(/https?:\/\//);
    expect(html).not.toMatch(/<(iframe|object|embed|form|link\b(?![^>]*rel="stylesheet"))/);
    expect(script).not.toMatch(
      /\b(eval|Function)\s*\(|new Function|innerHTML|outerHTML|insertAdjacentHTML|document\.write|\bfetch\s*\(|XMLHttpRequest|WebSocket|EventSource|sendBeacon|localStorage|postMessage|location\s*=|location\.href|window\.open/,
    );
    expect(script).not.toMatch(/https?:\/\//);
    expect(read(DESKTOP, "ui", "shell.css")).not.toMatch(/url\(|@import/);
    expect(fs.readdirSync(path.join(DESKTOP, "ui")).sort()).toEqual([
      "icon.png",
      "index.html",
      "shell.css",
      "shell.js",
    ]);
  });

  it("C27 the window is created in code, so the address policy is in force from its first load: no window in the configuration", () => {
    expect(conf.app.windows).toEqual([]);
    const shell = read(TAURI, "src", "shell.rs");
    expect(shell).toContain(".on_navigation(");
    expect(shell).toContain(".on_new_window(");
    expect(shell).toContain("NewWindowResponse::Deny");
    expect(shell).not.toMatch(/NewWindowResponse::(Allow|Create)/);
  });

  it("C27 the installer carries the payload as a resource and nothing else of the repository; the identifier, product name and macOS hardening are the doors", () => {
    expect(conf.identifier).toBe("com.mordomo.desktop");
    expect(conf.productName).toBe("MordomoOS");
    expect(conf.bundle.resources).toEqual({ "../payload": "payload" });
    expect(conf.bundle.targets).toEqual(["app", "dmg", "nsis", "deb", "appimage"]);
    expect(conf.bundle.macOS).toEqual({ minimumSystemVersion: "12.0", hardenedRuntime: true });
    expect(conf.bundle.windows.nsis.installMode).toBe("currentUser");
    expect(conf.bundle.licenseFile).toBe("../../../LICENSE");
    expect(fs.existsSync(path.join(TAURI, conf.bundle.licenseFile))).toBe(true);
    expect(conf.build.frontendDist).toBe("../ui");
    expect(conf.build).not.toHaveProperty("devUrl");
    expect(conf.build).not.toHaveProperty("beforeBuildCommand");
  });
});

describe("C31 a build without the updater's key has no updater at all", () => {
  it("C31 the updater crate is optional behind a feature that is not a default, and the base configuration has no updater", () => {
    expect(cargoToml).toMatch(/^tauri-plugin-updater = \{[^}]*optional = true/m);
    expect(cargoToml).toMatch(/^\[features\]\n(?:#[^\n]*\n)*updater = \["dep:tauri-plugin-updater"\]\n/m);
    expect(cargoToml).not.toMatch(/^default\s*=/m);
    expect(conf).not.toHaveProperty("plugins");
    expect(conf.bundle).not.toHaveProperty("createUpdaterArtifacts");
  });

  it("C31 the plugin, the menu item and the checks are compiled only with the feature, and the build says so in About", () => {
    const lib = read(TAURI, "src", "lib.rs");
    expect(lib).toMatch(
      /#\[cfg\(feature = "updater"\)\]\s*\{\s*builder = builder\.plugin\(tauri_plugin_updater::Builder::new\(\)\.build\(\)\);/,
    );
    const menu = read(TAURI, "src", "menu.rs");
    expect(menu).toMatch(
      /#\[cfg\(feature = "updater"\)\]\s*\{\s*let check = MenuItemBuilder::with_id\(CHECK_FOR_UPDATES/,
    );
    expect(menu).toContain("This build has no updater.");
    const updater = read(TAURI, "src", "updater.rs");
    // every function that reaches the network is behind the feature; the stub for a build without one does nothing
    expect(updater).toMatch(
      /#\[cfg\(not\(feature = "updater"\)\)\]\s*pub fn check_in_background\(_app: &AppHandle\) \{\}/,
    );
    expect((updater.match(/#\[cfg\(feature = "updater"\)\]/g) ?? []).length).toBe(3);
  });

  it("C29 the updater asks at start only through the policy function (build has an updater AND the owner's setting), and the menu path is the other way in", () => {
    const shell = read(TAURI, "src", "shell.rs");
    expect(shell).toContain('check_for_update_at_start(cfg!(feature = "updater"), &ready)');
    expect(shell.match(/check_in_background/g)).toHaveLength(1);
    const updater = read(TAURI, "src", "updater.rs");
    expect(updater.match(/\.updater\(\)/g)).toHaveLength(1);
    expect(updater.match(/\.check\(\)\.await/g)).toHaveLength(1);
  });

  it("C30 an update is downloaded (the plugin verifies the minisign signature there), the service is stopped before the installer replaces its files, and a download outside github.com is refused", () => {
    const updater = read(TAURI, "src", "updater.rs");
    const order = ["download_url.scheme()", "update.download(", "stop_sidecar()", "update.install("].map(
      (part) => updater.indexOf(part),
    );
    expect(order.every((i) => i > 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(updater).toContain('host_str() != Some("github.com")');
    expect(updater).not.toMatch(/download_and_install/);
    expect(updater).not.toMatch(/dangerous/i);
  });
});
