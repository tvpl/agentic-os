import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import { repoRoot } from "./helpers/childBundle.js";

/**
 * .specs/features/cerebro-busca-significado, C66 (door 2, Impact "instalador"): what the installer carries for the local
 * models. The script is run for real (`--skip-build`, system Node, `--payload` into a folder of its own) over the
 * compiled tree; skipped without a build (the proof line builds first, L-056) and off Linux x64, the target CI stages.
 */

const PACKAGE = path.join(repoRoot, "scripts", "package.mjs");
const built =
  fs.existsSync(path.join(repoRoot, "core", "dist", "models", "localChild.js")) &&
  fs.existsSync(path.join(repoRoot, "apps", "api", "dist", "cli.js")) &&
  fs.existsSync(path.join(repoRoot, "apps", "command-centre", "dist", "index.html"));
const linuxX64 = process.platform === "linux" && process.arch === "x64";
if (!built) console.warn("[busca.packaging] skipping: run npm run build first");
if (!linuxX64) console.warn("[busca.packaging] skipping: C66 stages the Linux x64 installer");

/** Every path under `dir`, relative, folders and files. */
function everything(dir: string): Array<{ rel: string; dir: boolean; size: number }> {
  return (fs.readdirSync(dir, { recursive: true }) as string[]).map((rel) => {
    const stat = fs.lstatSync(path.join(dir, rel));
    return {
      rel: rel.split(path.sep).join("/"),
      dir: stat.isDirectory(),
      size: stat.isFile() ? stat.size : 0,
    };
  });
}

describe.skipIf(!built || !linuxX64)("C66 the installer carries the runtime and no weights", () => {
  it("C66 a Linux x64 payload has transformers 4.3.2 and onnxruntime-node with only linux/x64 CPU files, no web runtime, no weights, the child next to the bundle, and at most 120 MB of runtime", () => {
    const stage = fs.mkdtempSync(path.join(os.tmpdir(), "mordomo-busca-pkg-"));
    const payload = path.join(stage, "payload");
    try {
      const out = spawnSync(
        process.execPath,
        [PACKAGE, "--skip-build", "--node", "none", "--payload", payload],
        {
          cwd: repoRoot,
          encoding: "utf8",
          timeout: 240_000,
        },
      );
      expect(out.status, out.stderr + out.stdout).toBe(0);
      const lib = path.join(payload, "lib");
      const nm = path.join(lib, "node_modules");
      // the runtime is there, at the exact version (the proof fails, not skips, when the optional dependency is not)
      const transformers = path.join(nm, "@huggingface", "transformers", "package.json");
      expect(fs.existsSync(transformers), "lib/node_modules/@huggingface/transformers").toBe(true);
      expect((JSON.parse(fs.readFileSync(transformers, "utf8")) as { version: string }).version).toBe(
        "4.3.2",
      );
      const ort = path.join(nm, "onnxruntime-node");
      expect(fs.existsSync(path.join(ort, "package.json")), "lib/node_modules/onnxruntime-node").toBe(true);
      // onnxruntime-node with linux/x64 binaries only
      const bin = path.join(ort, "bin", "napi-v6");
      expect(fs.readdirSync(bin)).toEqual(["linux"]);
      expect(fs.readdirSync(path.join(bin, "linux"))).toEqual(["x64"]);
      expect(fs.readdirSync(path.join(bin, "linux", "x64")).sort()).toContain("onnxruntime_binding.node");
      const all = everything(payload);
      const names = (p: { rel: string }) => p.rel.split("/").at(-1)!;
      // no folder of another platform or architecture anywhere
      expect(
        all.filter((p) => p.dir && ["darwin", "win32", "arm64"].includes(names(p))).map((p) => p.rel),
      ).toEqual([]);
      // no CUDA or TensorRT library
      expect(
        all
          .filter((p) => /^libonnxruntime_providers_cuda/.test(names(p)) || /tensorrt/i.test(names(p)))
          .map((p) => p.rel),
      ).toEqual([]);
      // no web runtime folder, and no model weight
      expect(all.filter((p) => p.dir && names(p) === "onnxruntime-web").map((p) => p.rel)).toEqual([]);
      expect(all.filter((p) => !p.dir && names(p).endsWith(".onnx")).map((p) => p.rel)).toEqual([]);
      // the child's entry next to the bundle, and the bundle names it
      expect(fs.existsSync(path.join(lib, "localChild.mjs"))).toBe(true);
      expect(fs.existsSync(path.join(lib, "mordomo.mjs"))).toBe(true);
      expect(fs.readFileSync(path.join(lib, "mordomo.mjs"), "utf8")).toContain("localChild.mjs");
      // the runtime folders add at most 120 MB
      const RUNTIME = [
        "@huggingface/",
        "onnxruntime-node/",
        "onnxruntime-common/",
        "sharp/",
        "@img/",
        "detect-libc/",
      ];
      const bytes = everything(nm)
        .filter((p) => RUNTIME.some((prefix) => p.rel.startsWith(prefix)))
        .reduce((sum, p) => sum + p.size, 0);
      console.info(
        `[busca.packaging] the local models' runtime adds ${(bytes / 1e6).toFixed(1)} MB on linux/x64`,
      );
      expect(bytes).toBeGreaterThan(0);
      expect(bytes).toBeLessThanOrEqual(120 * 1024 * 1024);
      // and it loads from where it lands (the CPU binding of this platform), with no model and no network
      const probe = spawnSync(
        process.execPath,
        [
          "--input-type=module",
          "-e",
          `const t = await import(${JSON.stringify(pathToFileURL(path.join(nm, "@huggingface", "transformers", "dist", "transformers.node.mjs")).href)});
           console.log(typeof t.pipeline, typeof t.env);`,
        ],
        { cwd: stage, encoding: "utf8", timeout: 60_000 },
      );
      expect(probe.stdout.trim(), probe.stderr).toBe("function object");
    } finally {
      fs.rmSync(stage, { recursive: true, force: true });
    }
  }, 300_000);
});
