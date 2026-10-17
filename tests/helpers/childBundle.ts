import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

export const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

/** Absolute path of a source file of this repository, for the `import` lines of a child entry. */
export const src = (relative: string): string => JSON.stringify(path.join(repoRoot, relative));

/**
 * Bundle `source` (TypeScript that imports the CURRENT sources by absolute path, see `src`) into a script a
 * child process can run, so a concurrency proof uses real processes without depending on a stale `dist/`.
 *
 * The bundle lives under `node_modules/.cache` so that `better-sqlite3`, which stays external (a native
 * addon), resolves from the repository's `node_modules`.
 */
export async function bundleChild(name: string, source: string): Promise<string> {
  const dir = path.join(repoRoot, "node_modules", ".cache", "mordomo-tests");
  fs.mkdirSync(dir, { recursive: true });
  const id = `${name}-${crypto.createHash("sha256").update(source).digest("hex").slice(0, 12)}`;
  const entry = path.join(dir, `${id}.entry.ts`);
  const script = path.join(dir, `${id}.mjs`);
  fs.writeFileSync(entry, source);
  const { rolldown } = await import("rolldown");
  const bundle = await rolldown({
    input: entry,
    platform: "node",
    external: [/^node:/, "better-sqlite3"],
    resolve: { alias: { "@mordomo/contracts": path.join(repoRoot, "contracts/src/index.ts") } },
  });
  await bundle.write({ file: script, format: "esm" });
  await bundle.close();
  return script;
}

export interface ChildResult {
  code: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
}

/** Run a bundled script to completion. */
export function runChild(script: string, env: Record<string, string>): Promise<ChildResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [script], {
      env: { ...process.env, ...env },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d: Buffer) => (stdout += d.toString()));
    child.stderr.on("data", (d: Buffer) => (stderr += d.toString()));
    child.on("error", reject);
    child.on("close", (code, signal) => resolve({ code, signal, stdout, stderr }));
  });
}
