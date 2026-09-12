import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));

/**
 * The CLI entry file to spawn for child services (`start --foreground`,
 * `mcp permission`, the startup service). In a source checkout that is the
 * sibling `cli.js`; in a packaged install the whole API is one bundle, so the
 * running module itself is the entry.
 */
export function cliEntry(): string {
  const sibling = path.join(here, "cli.js");
  return fs.existsSync(sibling) ? sibling : fileURLToPath(import.meta.url);
}

/** Built Command Centre: next to the API in a checkout, `ui/` next to `lib/` in a package. */
export function uiDistCandidates(): string[] {
  return [path.resolve(here, "..", "..", "command-centre", "dist"), path.resolve(here, "..", "ui")];
}

/** Bundled seed data (skills, routines, connectors) of a packaged install, if any. */
export function seedDir(): string | null {
  const fromEnv = process.env.MORDOMO_SEED_DIR;
  if (fromEnv) return fromEnv;
  const bundled = path.resolve(here, "..", "seed");
  return fs.existsSync(bundled) ? bundled : null;
}
