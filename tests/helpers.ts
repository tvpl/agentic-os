import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ensureDirs, resolvePaths, type MordomoPaths } from "@mordomo/core";

const here = path.dirname(fileURLToPath(import.meta.url));
export const FAKE_BIN = path.join(here, "fixtures", "fake-bin");

// Ensure the fake CLIs are executable regardless of which test file runs first.
if (process.platform !== "win32") {
  for (const bin of ["claude", "cursor-agent", "codex"]) {
    try {
      fs.chmodSync(path.join(FAKE_BIN, bin), 0o755);
    } catch {
      /* fixture missing — the test using it will fail loudly */
    }
  }
}

/**
 * The fake CLIs under fixtures/fake-bin are bash scripts: tests that need a
 * run to actually succeed (or hang) cannot execute them on Windows.
 */
export const FAKE_CLIS_RUNNABLE = process.platform !== "win32";

/** Create an isolated MordomoOS home in a temp dir. */
export function makeTempHome(prefix = "mordomo-test-"): { paths: MordomoPaths; cleanup: () => void } {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  const paths = resolvePaths(home);
  ensureDirs(paths);
  return {
    paths,
    cleanup: () => fs.rmSync(home, { recursive: true, force: true }),
  };
}

/** Prepend the fake CLI dir to PATH for the current test process. */
export function withFakeBinPath(): () => void {
  const original = process.env.PATH;
  process.env.PATH = `${FAKE_BIN}${path.delimiter}${original ?? ""}`;
  return () => {
    process.env.PATH = original;
  };
}
