import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import ts from "typescript";
import { SECRET_FILE_PATTERNS, isSecretFile } from "@mordomo/core/internal";

/**
 * The package (.specs/features/sdk-core, S5): what `package.json` promises, what `npm pack` would ship, and that the
 * tarballs, installed in an empty project, run the example of the README. Needs the build (`npm run build:server`),
 * like the tests of the CLI.
 */

const root = path.resolve(import.meta.dirname, "..");
const read = (file: string) => fs.readFileSync(path.join(root, file), "utf8");
const manifest = (dir: string) => JSON.parse(read(`${dir}/package.json`)) as Record<string, unknown>;

const FILES = ["dist", "!dist/**/*.map", "!dist/**/*.tsbuildinfo", "README.md", "LICENSE"];

describe("S5 package metadata", () => {
  it("C41 both packages carry the literal fields of the Landing, and the license text is the FSL", () => {
    for (const dir of ["core", "contracts"]) {
      const m = manifest(dir);
      expect(m.license, dir).toBe("FSL-1.1-ALv2");
      expect(m.engines, dir).toEqual({ node: ">=22" });
      expect(m.sideEffects, dir).toBe(false);
      expect(m.files, dir).toEqual(FILES);
      expect(m.publishConfig, dir).toEqual({ access: "public" });
      expect(Object.keys(m), dir).not.toContain("private");
      expect(m.type, dir).toBe("module");
      // Where the code lives, for the registry page; the directory says which package of the repository it is.
      expect(m.repository, dir).toEqual({
        type: "git",
        url: "git+https://github.com/tvpl/agentic-os.git",
        directory: dir,
      });
      // The readme is the front page of the package: nothing in it points outside the tarball by a relative path.
      const readme = read(`${dir}/README.md`);
      expect(readme.match(/\]\((?!https?:|#)[^)]*\.\.\/[^)]*\)/g) ?? [], dir).toEqual([]);
      // One licence text for the repository: each package ships a copy of the root LICENSE (the licensor is
      // still the owner's to fill in, see STATE "revisão jurídica do dono").
      const license = read(`${dir}/LICENSE`);
      expect(license, dir).toBe(read("LICENSE"));
      // Whatever the root has (today a notice for the owner's review above the text; the owner removes it).
      expect(license, dir).toContain("# Functional Source License, Version 1.1, ALv2 Future License");
      expect(license, dir).not.toContain("${");
      expect(fs.existsSync(path.join(root, dir, "README.md")), dir).toBe(true);
    }
    // The declarations of the core use the types of Node (`node:child_process`): a consumer is told to have them.
    // Optional: a program in JavaScript needs none, and the lockfile must not count the types as shipped software.
    expect(manifest("core").peerDependencies).toEqual({ "@types/node": ">=22" });
    expect(manifest("core").peerDependenciesMeta).toEqual({ "@types/node": { optional: true } });
    expect(manifest("contracts").peerDependencies).toBeUndefined();
    expect(manifest("core").exports).toEqual({
      ".": { types: "./dist/index.d.ts", default: "./dist/index.js" },
      "./internal": { types: "./dist/internal.d.ts", default: "./dist/internal.js" },
    });
    expect(manifest("contracts").exports).toEqual({
      ".": { types: "./dist/index.d.ts", default: "./dist/index.js" },
      "./policy": { types: "./dist/policy.d.ts", default: "./dist/policy.js" },
    });
  });
});

interface Packed {
  files: Array<{ path: string }>;
  filename: string;
}

function pack(dir: string, into?: string): Packed {
  const args = ["pack", "--json", ...(into ? ["--pack-destination", into] : ["--dry-run"])];
  const out = execFileSync("npm", args, {
    cwd: path.join(root, dir),
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  return (JSON.parse(out) as Packed[])[0]!;
}

/** The files a manifest's `exports` point at. */
function exportTargets(dir: string): string[] {
  const out: string[] = [];
  const visit = (value: unknown): void => {
    if (typeof value === "string") out.push(value.replace(/^\.\//, ""));
    else if (value && typeof value === "object") Object.values(value).forEach(visit);
  };
  visit(manifest(dir).exports);
  return out;
}

describe("S5 what npm pack would ship", () => {
  it("C42 the file list has the manifest, the readme, the license and what exports point at, and nothing else of note", () => {
    for (const dir of ["core", "contracts"]) {
      const paths = pack(dir).files.map((f) => f.path);
      for (const needed of ["package.json", "README.md", "LICENSE", ...exportTargets(dir)]) {
        expect(paths, `${dir}: ${needed}`).toContain(needed);
      }
      const unwanted = paths.filter(
        (p) =>
          /\.map$/.test(p) ||
          /\.test\./.test(p) ||
          /\.tsbuildinfo$/.test(p) ||
          /(^|\/)(src|tests|fixtures)\//.test(p) ||
          /(^|\/)\.env/.test(p) ||
          isSecretFile(path.basename(p)),
      );
      expect(unwanted, dir).toEqual([]);
      expect(
        paths.every((p) => ["package.json", "README.md", "LICENSE"].includes(p) || p.startsWith("dist/")),
        dir,
      ).toBe(true);
    }
    expect(SECRET_FILE_PATTERNS.length).toBeGreaterThan(0);
  });
});

describe("S5 the tarballs, installed in an empty project", () => {
  let work = "";
  let project = "";

  beforeAll(() => {
    work = fs.mkdtempSync(path.join(os.tmpdir(), "mordomo-sdk-pack-"));
    project = path.join(work, "project");
    const modules = path.join(project, "node_modules");
    fs.mkdirSync(path.join(modules, "@mordomo"), { recursive: true });
    for (const dir of ["contracts", "core"]) {
      const packed = pack(dir, work);
      const target = path.join(modules, "@mordomo", dir);
      fs.mkdirSync(target);
      execFileSync("tar", ["-xzf", path.join(work, packed.filename), "-C", target, "--strip-components=1"]);
    }
    // What the packages depend on is installed from the repository: the test is about the package, not the registry.
    // Only what the manifests declare (dependencies and peer dependencies), and the compiler: a type the
    // declarations need and no manifest names would be missing here, as it is for a consumer.
    const needed = new Set<string>(["typescript"]);
    for (const dir of ["core", "contracts"]) {
      const declared = {
        ...(manifest(dir).dependencies as object),
        ...(manifest(dir).peerDependencies as object),
      };
      for (const name of Object.keys(declared)) if (!name.startsWith("@mordomo/")) needed.add(name);
    }
    for (const name of needed) {
      const target = path.join(modules, name);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.symlinkSync(path.join(root, "node_modules", name), target);
    }
  }, 180_000);

  afterAll(() => fs.rmSync(work, { recursive: true, force: true }));

  const node = (args: string[], options: { cwd?: string; env?: NodeJS.ProcessEnv; timeout?: number } = {}) =>
    spawnSync(process.execPath, args, {
      cwd: options.cwd ?? project,
      encoding: "utf8",
      timeout: options.timeout ?? 60_000,
      env: { ...process.env, ...options.env },
    });

  it("C43 the README example runs, the types compile, and the files behind the entry points are not reachable", () => {
    const example = extractExample();
    const js = ts.transpileModule(example, {
      compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
    }).outputText;
    fs.writeFileSync(path.join(project, "example.mjs"), js);
    const ran = node(["example.mjs"]);
    expect(ran.stderr).toBe("");
    expect(ran.status).toBe(0);
    expect(ran.stdout.trim().split("\n")).toEqual(["you asked: say hi", "done"]);

    fs.writeFileSync(
      path.join(project, "consumer.ts"),
      [
        'import { createEngine, ProviderRegistry, type Engine, type RunRecord, type StartedRun } from "@mordomo/core";',
        "declare const providers: ProviderRegistry;",
        "const engine: Engine = createEngine({ providers });",
        'const started: StartedRun = engine.execution.startPrompt({ prompt: "x", startedBy: null });',
        "const run: Promise<RunRecord> = engine.execution.wait(started.runId);",
        "export { run };",
      ].join("\n"),
    );
    // The example of the README is compiled as written, as an ES module (it awaits at the top level).
    fs.writeFileSync(path.join(project, "package.json"), JSON.stringify({ type: "module" }));
    fs.writeFileSync(path.join(project, "readme.ts"), example);
    fs.writeFileSync(
      path.join(project, "tsconfig.json"),
      JSON.stringify({
        compilerOptions: {
          module: "nodenext",
          moduleResolution: "nodenext",
          target: "es2022",
          strict: true,
          noEmit: true,
          skipLibCheck: false,
          types: ["node"],
        },
        include: ["consumer.ts", "readme.ts"],
      }),
    );
    const compiled = node([
      path.join(root, "node_modules", "typescript", "bin", "tsc"),
      "-p",
      "tsconfig.json",
    ]);
    expect(compiled.stdout).toBe("");
    expect(compiled.status).toBe(0);

    const deep = node([
      "--input-type=module",
      "-e",
      'try { await import("@mordomo/core/dist/engine.js"); console.log("reachable"); } catch (e) { console.log(e.code); }',
    ]);
    expect(deep.stdout.trim()).toBe("ERR_PACKAGE_PATH_NOT_EXPORTED");
  }, 180_000);

  it("C45 importing the package creates no file, adds no listener to process and lets the process end", () => {
    const tmp = fs.mkdtempSync(path.join(work, "tmp-"));
    const probe = [
      'import fs from "node:fs";',
      "const listeners = () => JSON.stringify(process.eventNames().map((n) => [String(n), process.listenerCount(n)]));",
      "const before = { listeners: listeners(), cwd: fs.readdirSync(process.cwd()), tmp: fs.readdirSync(process.env.TMPDIR) };",
      'await import("@mordomo/core");',
      "const after = { listeners: listeners(), cwd: fs.readdirSync(process.cwd()), tmp: fs.readdirSync(process.env.TMPDIR) };",
      "console.log(JSON.stringify({ before, after }));",
    ].join("\n");
    fs.writeFileSync(path.join(project, "probe.mjs"), probe);
    const started = Date.now();
    const out = node(["probe.mjs"], { env: { TMPDIR: tmp, TEMP: tmp, TMP: tmp }, timeout: 5000 });
    expect(out.error).toBeUndefined();
    expect(out.status).toBe(0);
    expect(Date.now() - started).toBeLessThan(5000);
    const seen = JSON.parse(out.stdout) as { before: unknown; after: unknown };
    expect(seen.after).toEqual(seen.before);
  });
});

function extractExample(): string {
  const readme = read("core/README.md");
  const match = /<!-- example:quickstart -->\s*```ts\n([\s\S]*?)\n```/.exec(readme);
  if (!match) throw new Error("core/README.md has no <!-- example:quickstart --> block");
  return match[1]!;
}

describe("S5 the example of the README", () => {
  it("C44 runs against the sources, exits clean and prints the answer and the status", async () => {
    const js = ts.transpileModule(extractExample(), {
      compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
    }).outputText;
    const dir = path.join(root, "tests", ".tmp");
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, `readme-example-${process.pid}.mjs`);
    fs.writeFileSync(file, js);
    const lines: string[] = [];
    const log = vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => {
      lines.push(args.join(" "));
    });
    try {
      await import(/* @vite-ignore */ pathToFileURL(file).href);
    } finally {
      log.mockRestore();
      fs.rmSync(file, { force: true });
    }
    expect(lines).toEqual(["you asked: say hi", "done"]);
  }, 60_000);

  it("C44 the block is found by its marker and is the only one", () => {
    const readme = read("core/README.md");
    expect(readme.match(/<!-- example:quickstart -->/g)).toHaveLength(1);
    expect(extractExample()).toContain('from "@mordomo/core"');
  });
});
