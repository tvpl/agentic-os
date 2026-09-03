/**
 * Prepares an isolated MORDOMO_HOME for the e2e suite (shared by the server
 * launcher and Playwright's globalSetup). Deterministic path so both sides
 * agree without passing state around: tests/.tmp/e2e-home (git-ignored).
 */
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

export const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
export const E2E_HOME = path.join(REPO_ROOT, "tests", ".tmp", "e2e-home");
export const E2E_PORT = 4777;
export const FAKE_BIN = path.join(REPO_ROOT, "tests", "fixtures", "fake-bin");
export const CLI = path.join(REPO_ROOT, "apps", "api", "dist", "cli.js");

/** Create the home from scratch: seeds, settings.json (setupCompleted) and an index of docs/. */
export function prepareE2eHome({ fresh = true } = {}) {
  if (fresh) fs.rmSync(E2E_HOME, { recursive: true, force: true });
  fs.mkdirSync(path.join(E2E_HOME, "config"), { recursive: true });
  for (const dir of ["skills", "routines", "connectors"]) {
    const src = path.join(REPO_ROOT, dir);
    if (fs.existsSync(src)) fs.cpSync(src, path.join(E2E_HOME, dir), { recursive: true });
  }
  if (process.platform !== "win32") {
    for (const bin of ["claude", "cursor-agent", "codex"]) {
      try {
        fs.chmodSync(path.join(FAKE_BIN, bin), 0o755);
      } catch {
        /* fixture missing */
      }
    }
  }
  const settingsFile = path.join(E2E_HOME, "config", "settings.json");
  if (fresh || !fs.existsSync(settingsFile)) {
    const settings = {
      version: 1,
      systemName: "MordomoOS e2e",
      language: "en",
      theme: "dark",
      port: E2E_PORT,
      bindAddress: "127.0.0.1",
      setupCompleted: true,
      defaultProvider: "claude",
      providers: {
        claude: {
          enabled: true,
          defaultModel: null,
          defaultEffort: "default",
          binaryPath: path.join(FAKE_BIN, "claude"),
        },
        cursor: { enabled: false, defaultModel: null, defaultEffort: "default", binaryPath: null },
        codex: { enabled: false, defaultModel: null, defaultEffort: "default", binaryPath: null },
      },
      indexedFolders: [{ path: path.join(REPO_ROOT, "docs"), area: "Docs", enabled: true }],
    };
    fs.writeFileSync(settingsFile, JSON.stringify(settings, null, 2));
    const res = spawnSync(process.execPath, [CLI, "index"], {
      env: {
        ...process.env,
        MORDOMO_HOME: E2E_HOME,
        PATH: `${FAKE_BIN}${path.delimiter}${process.env.PATH ?? ""}`,
      },
      encoding: "utf8",
    });
    if (res.status !== 0) {
      throw new Error(`mordomo index failed (${String(res.status)}): ${res.stderr || res.stdout}`);
    }
  }
  return E2E_HOME;
}

export function readE2eToken() {
  try {
    return fs.readFileSync(path.join(E2E_HOME, "config", "token"), "utf8").trim();
  } catch {
    return null;
  }
}
