import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { repoRoot } from "./childBundle.js";

/**
 * The index worker (`core/src/memory/indexWorker.ts`) as a script a `worker_thread` can run, built from the CURRENT
 * sources (a test must not depend on a stale `dist/`). The bundle lives under `node_modules/.cache` so that
 * `better-sqlite3`, a native addon that stays external, resolves from the repository's `node_modules`.
 */
export async function bundleIndexWorker(
  entry = "core/src/memory/indexWorker.ts",
  name = "index-worker",
): Promise<string> {
  const dir = path.join(repoRoot, "node_modules", ".cache", "mordomo-tests");
  fs.mkdirSync(dir, { recursive: true });
  const input = path.join(repoRoot, entry);
  const sources = [input, path.join(repoRoot, "core/src/memory"), path.join(repoRoot, "core/src/security")]
    .filter((p) => fs.existsSync(p))
    .flatMap((p) => (fs.statSync(p).isDirectory() ? fs.readdirSync(p).map((f) => path.join(p, f)) : [p]))
    .filter((p) => fs.statSync(p).isFile())
    .map((p) => `${p}:${fs.statSync(p).mtimeMs}`)
    .join("\n");
  const id = `${name}-${crypto.createHash("sha256").update(sources).digest("hex").slice(0, 12)}`;
  const script = path.join(dir, `${id}.mjs`);
  if (fs.existsSync(script)) return script;
  const { rolldown } = await import("rolldown");
  const bundle = await rolldown({
    input,
    platform: "node",
    external: [/^node:/, "better-sqlite3"],
    resolve: { alias: { "@mordomo/contracts": path.join(repoRoot, "contracts/src/index.ts") } },
  });
  await bundle.write({ file: script, format: "esm" });
  await bundle.close();
  return script;
}
