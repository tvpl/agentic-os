import fs from "node:fs";
import Module from "node:module";
import path from "node:path";
import ts from "typescript";
import { afterEach, describe, expect, it, vi } from "vitest";
import { embeddedText } from "../core/src/memory/sections.js";
import { hashProvider } from "../core/src/memory/embeddings.js";
import { LocalModelHost } from "../core/src/models/localHost.js";
import { embeddingsServer, type EmbeddingsServer } from "./helpers/buscaWorld.js";
import {
  GEMMA,
  QWEN,
  localWorld,
  stubChild,
  type LocalWorld,
  type LocalWorldOptions,
} from "./helpers/buscaStubs.js";

/**
 * .specs/features/cerebro-busca-significado, S4, door 2: the `local` provider's child process, with the stub child
 * (checks "Level honesty" b): the lazy start, the batches of 8, the idle exit, the restarts in a pass, the prefixes, no
 * network while embedding, and the static walker that keeps the runtime out of the service. No real model runs here.
 */

const repoRoot = path.resolve(import.meta.dirname, "..");
const opened: LocalWorld[] = [];
const servers: EmbeddingsServer[] = [];
afterEach(async () => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  for (const w of opened.splice(0)) await w.close();
  for (const s of servers.splice(0)) await s.close();
});

async function world(opts: LocalWorldOptions = {}): Promise<LocalWorld> {
  const w = await localWorld("mordomo-busca-local-", opts);
  opened.push(w);
  return w;
}

/** A note with `n` titled sections, each with a body of its own. */
const sections = (title: string, n: number) =>
  Array.from({ length: n }, (_, i) => `# ${title} ${i + 1}\n\nCorpo ${i + 1} de ${title}.\n`).join("\n");
const batchesOf = (w: LocalWorld, from = 0) =>
  w.child
    .embeds()
    .slice(from)
    .map((e) => e.texts.length);
const alive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

// ---------------------------------------------------------------------------------------------- C52

describe("C52 the child process with the stub", () => {
  it("C52 no child after the status and a text search; the first auto search starts one that is not this process; the service never resolves the runtime", async () => {
    const resolved: string[] = [];
    const original = (Module as unknown as { _resolveFilename: (...a: unknown[]) => string })
      ._resolveFilename;
    vi.spyOn(
      Module as unknown as { _resolveFilename: (...a: unknown[]) => string },
      "_resolveFilename",
    ).mockImplementation(function (this: unknown, ...args: unknown[]) {
      resolved.push(String(args[0]));
      return original.apply(this, args);
    });
    const w = await world();
    await w.install(QWEN);
    w.note("prazos", "# Prazos\n\nO prazo de devolução é de 30 dias.\n");
    w.note("outra", "# Outra\n\nNada a ver.\n");
    // rows exist (from hash), so an auto search with the local provider embeds its question
    w.hashOn();
    await w.index();
    w.localOn(QWEN);
    expect((await w.call("GET", "/api/memory/status")).status).toBe(200);
    expect((await w.search("prazo", "text")).status).toBe(200);
    expect(w.child.pids()).toEqual([]);
    expect((await w.search("prazo", "auto")).status).toBe(200);
    const pids = w.child.pids();
    expect(pids).toHaveLength(1);
    expect(pids[0]).not.toBe(process.pid);
    expect(w.child.embeds().map((e) => e.texts.length)).toEqual([1]);
    expect(resolved.filter((r) => /@huggingface\/transformers|onnxruntime/.test(r))).toEqual([]);
  });

  it("C52 a pass over 17 sections sends batches of exactly 8, 8 and 1", async () => {
    const w = await world();
    await w.install(QWEN);
    w.note("a", sections("A", 9));
    w.note("b", sections("B", 8));
    w.localOn(QWEN);
    await w.index();
    expect(batchesOf(w)).toEqual([8, 8, 1]);
    expect(w.allRows()).toHaveLength(17);
  });

  it("C52 a pass over exactly 8 sections sends one batch of 8", async () => {
    const w = await world();
    await w.install(QWEN);
    w.note("a", sections("A", 8));
    w.localOn(QWEN);
    await w.index();
    expect(batchesOf(w)).toEqual([8]);
  });
});

// ---------------------------------------------------------------------------------------------- C53

/**
 * The walker of C53 (L-048): from an entry, every module it reaches by a static `import`, `export … from`, `import()`
 * with a literal, `require` and `createRequire(…)(…)` with a literal, the require functions followed through their
 * bindings (`createRequire` imported by name, aliased, or through a namespace or a default import of `module`; a
 * function it returns; a variable that holds one; `require` itself held by a variable). Type-only imports load nothing
 * and are skipped. Workspace packages resolve to their sources; any other package is a leaf named by its specifier.
 *
 * It does not cover: a module name computed at run time (`import(variable)`), `process.dlopen`, a `require` reached
 * through `module.constructor`, `Function` or `eval`, and a loader hook (`module.register`).
 */
type Read = (file: string) => string | null;

const WORKSPACE: Record<string, string> = {
  "@mordomo/core": "core/src/index.ts",
  "@mordomo/core/internal": "core/src/internal.ts",
  "@mordomo/contracts": "contracts/src/index.ts",
  "@mordomo/contracts/policy": "contracts/src/policy.ts",
  "@mordomo/contracts/events": "contracts/src/events.ts",
  "@mordomo/adapter-claude": "adapters/claude/src/index.ts",
  "@mordomo/adapter-codex": "adapters/codex/src/index.ts",
  "@mordomo/adapter-cursor": "adapters/cursor/src/index.ts",
};

function specifiersOf(source: string, file: string): string[] {
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
  const out: string[] = [];
  const createRequires = new Set<string>(); // names bound to createRequire
  const moduleObjects = new Set<string>(); // names bound to the `module` builtin (namespace or default)
  const requires = new Set<string>(["require"]); // names bound to a require function
  const literal = (node: ts.Node | undefined) => (node && ts.isStringLiteralLike(node) ? node.text : null);
  const isCreateRequire = (node: ts.Expression): boolean =>
    (ts.isIdentifier(node) && createRequires.has(node.text)) ||
    (ts.isPropertyAccessExpression(node) &&
      node.name.text === "createRequire" &&
      ts.isIdentifier(node.expression) &&
      moduleObjects.has(node.expression.text));
  const isRequire = (node: ts.Expression): boolean =>
    (ts.isIdentifier(node) && requires.has(node.text)) ||
    (ts.isCallExpression(node) && isCreateRequire(node.expression));
  // Bindings first (a declaration may come after its use in the text).
  const bind = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node) && !node.importClause?.isTypeOnly) {
      const from = literal(node.moduleSpecifier);
      if (from === "module" || from === "node:module") {
        const clause = node.importClause;
        if (clause?.name) moduleObjects.add(clause.name.text);
        const named = clause?.namedBindings;
        if (named && ts.isNamespaceImport(named)) moduleObjects.add(named.name.text);
        if (named && ts.isNamedImports(named))
          for (const el of named.elements)
            if ((el.propertyName ?? el.name).text === "createRequire") createRequires.add(el.name.text);
      }
    }
    ts.forEachChild(node, bind);
  };
  bind(sf);
  // Variables that hold a require function, to a fixed point (an alias of an alias).
  for (let changed = true; changed;) {
    changed = false;
    const hold = (node: ts.Node): void => {
      if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
        const init = node.initializer;
        const name = node.name.text;
        if (!requires.has(name) && isRequire(init)) {
          requires.add(name);
          changed = true;
        }
        if (!createRequires.has(name) && isCreateRequire(init)) {
          createRequires.add(name);
          changed = true;
        }
      }
      ts.forEachChild(node, hold);
    };
    hold(sf);
  }
  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node) && !node.importClause?.isTypeOnly) {
      const from = literal(node.moduleSpecifier);
      if (from) out.push(from);
    } else if (ts.isExportDeclaration(node) && node.moduleSpecifier && !node.isTypeOnly) {
      const from = literal(node.moduleSpecifier);
      if (from) out.push(from);
    } else if (ts.isCallExpression(node)) {
      const first = literal(node.arguments[0]);
      if (
        first !== null &&
        (node.expression.kind === ts.SyntaxKind.ImportKeyword || isRequire(node.expression))
      )
        out.push(first);
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return out;
}

function resolveSpecifier(spec: string, from: string, read: Read): string | null {
  if (spec in WORKSPACE) return WORKSPACE[spec]!;
  if (!spec.startsWith(".")) return null;
  const base = path.posix.join(path.posix.dirname(from), spec);
  for (const candidate of [
    base,
    base.replace(/\.(m?js)$/, ".ts"),
    base.replace(/\.js$/, ".tsx"),
    `${base}.ts`,
    `${base}/index.ts`,
  ])
    if (read(candidate) !== null) return candidate;
  return null;
}

function walk(entries: string[], read: Read): { files: Set<string>; external: Map<string, string[]> } {
  const files = new Set<string>();
  const external = new Map<string, string[]>();
  const queue = [...entries];
  while (queue.length > 0) {
    const file = queue.pop()!;
    if (files.has(file)) continue;
    const source = read(file);
    if (source === null) continue;
    files.add(file);
    for (const spec of specifiersOf(source, file)) {
      const target = resolveSpecifier(spec, file, read);
      if (target) queue.push(target);
      else if (!spec.startsWith(".")) external.set(spec, [...(external.get(spec) ?? []), file]);
    }
  }
  return { files, external };
}

const RUNTIME = ["@huggingface/transformers", "onnxruntime-node", "onnxruntime-common"];
const readRepo: Read = (file) => {
  const full = path.join(repoRoot, file);
  return fs.existsSync(full) && fs.statSync(full).isFile() ? fs.readFileSync(full, "utf8") : null;
};
const CHILD = "core/src/models/localChild.ts";

describe("C53 the static walker", () => {
  it("C53 from the CLI, the server and the index worker the runtime is never reached, and the child's entry is not imported", () => {
    const { files, external } = walk(
      ["apps/api/src/cli.ts", "apps/api/src/server.ts", "core/src/memory/indexWorker.ts"],
      readRepo,
    );
    expect(files.size).toBeGreaterThan(100);
    expect(files.has("core/src/models/localHost.ts")).toBe(true);
    expect(files.has(CHILD)).toBe(false);
    for (const spec of RUNTIME) expect(external.get(spec), spec).toBeUndefined();
    // the child's entry does reach it (the walker sees the runtime where it is)
    expect(walk([CHILD], readRepo).external.has("@huggingface/transformers")).toBe(true);
    // and the service reaches the child only as the path given to fork
    const host = readRepo("core/src/models/localHost.ts")!;
    expect(host).toContain('for (const name of ["./localChild.js", "./localChild.mjs"])');
    expect(host).toContain("childProcess.fork(this.opts.entry!");
  });

  const SPELLINGS: Record<string, string> = {
    static: 'import { pipeline } from "@huggingface/transformers";\nvoid pipeline;',
    dynamic: 'export async function f() { return import("@huggingface/transformers"); }',
    require: 'const ort = require("onnxruntime-node");\nvoid ort;',
    createRequire:
      'import { createRequire } from "node:module";\nconst r = createRequire(import.meta.url);\nr("onnxruntime-common");',
    createRequireDirect:
      'import { createRequire } from "module";\ncreateRequire(import.meta.url)("onnxruntime-node");',
    createRequireNamespace:
      'import * as m from "node:module";\nm.createRequire(import.meta.url)("onnxruntime-node");',
    reexport: 'export * from "@huggingface/transformers";',
    reexportNamed: 'export { pipeline } from "@huggingface/transformers";',
    aliased:
      'import { createRequire as cr } from "node:module";\nconst load = cr(import.meta.url);\nconst again = load;\nagain("onnxruntime-node");',
    aliasedRequire: 'const req = require;\nreq("onnxruntime-node");',
  };
  for (const [name, source] of Object.entries(SPELLINGS))
    it(`C53 self-test: the ${name} spelling, two modules deep, is found`, () => {
      const files: Record<string, string> = {
        "v/entry.ts": 'import "./mid.js";',
        "v/mid.ts": 'export * from "./leaf.js";',
        "v/leaf.ts": source,
      };
      const found = walk(["v/entry.ts"], (file) => files[file] ?? null);
      expect(
        [...found.external.keys()].filter((spec) => RUNTIME.includes(spec)),
        name,
      ).toHaveLength(1);
    });

  it("C53 a type-only import loads nothing and is not counted", () => {
    const found = walk(["v/a.ts"], (f) =>
      f === "v/a.ts"
        ? 'import type * as T from "@huggingface/transformers";\nexport type X = typeof T;'
        : null,
    );
    expect(found.external.size).toBe(0);
  });

  it("C53 the spellings it does not cover are not seen (the claim names them)", () => {
    const UNCOVERED: Record<string, string> = {
      computed: 'const name = "@huggingface/transformers";\nexport const m = import(name);',
      dlopen: 'process.dlopen({ exports: {} } as never, "/x/onnxruntime_binding.node");',
      moduleConstructor: '(module.constructor as any)._load("onnxruntime-node");',
      function: "new Function(\"return require('onnxruntime-node')\")();",
      eval: "eval(\"require('onnxruntime-node')\");",
      loaderHook: 'import { register } from "node:module";\nregister("./hook.mjs", import.meta.url);',
    };
    for (const [name, source] of Object.entries(UNCOVERED)) {
      const found = walk(["v/a.ts"], (f) => (f === "v/a.ts" ? source : null));
      expect(
        [...found.external.keys()].filter((s) => RUNTIME.includes(s)),
        name,
      ).toEqual([]);
    }
  });
});

// ---------------------------------------------------------------------------------------------- C54

describe("C54 the idle exit", () => {
  it("C54 alive at 119 999 ms after the last request, told exit and ended at 120 000 ms; the next request starts a new child", async () => {
    const child = stubChild();
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const host = new LocalModelHost({ entry: child.entry, modelsDir: child.dir });
    const tick = () => new Promise((resolve) => setImmediate(resolve));
    const until = async (done: () => boolean) => {
      for (let i = 0; i < 20_000 && !done(); i++) await tick();
      return done();
    };
    try {
      const model = { id: QWEN, kind: "embedder" as const, dtype: "q4f16", dimensions: 6 };
      expect(await host.embed(model, ["um"])).toHaveLength(1);
      const [first] = child.pids();
      expect(first).toBeDefined();
      vi.advanceTimersByTime(119_999);
      for (let i = 0; i < 50; i++) await tick();
      expect(alive(first!)).toBe(true);
      expect(child.log().filter((m) => m.t === "exit")).toEqual([]);
      vi.advanceTimersByTime(1);
      expect(await until(() => child.log().some((m) => m.t === "exit" && m.pid === first))).toBe(true);
      expect(await until(() => !alive(first!))).toBe(true);
      expect(await host.embed(model, ["dois"])).toHaveLength(1);
      const pids = child.pids();
      expect(pids).toHaveLength(2);
      expect(pids[1]).not.toBe(first);
    } finally {
      host.dispose();
      vi.useRealTimers();
      child.cleanup();
    }
  });
});

// ---------------------------------------------------------------------------------------------- C55

const metaError = (w: LocalWorld) => {
  const row = w.ctx.db.prepare("SELECT value FROM meta WHERE key = 'index.semantic_error'").get() as
    { value: string } | undefined;
  return row ? (JSON.parse(row.value) as { at: number; kind: string; message: string }) : null;
};

describe("C55 a child that ends unasked during a pass", () => {
  it("C55 crashing on every batch from the third: 4 starts, the error recorded, the pass finished, the first two batches kept", async () => {
    const w = await world();
    await w.install(QWEN);
    for (const name of ["a", "b", "c", "d", "e", "f"]) w.note(name, sections(name.toUpperCase(), 8));
    w.localOn(QWEN);
    w.child.control({ crash: [3, 4, 5, 6, 7, 8] });
    const finished: unknown[] = [];
    const off = w.ctx.events.subscribe((e) => e.type === "index.finished" && finished.push(e));
    await w.index();
    off();
    expect(w.child.pids()).toHaveLength(4);
    expect(metaError(w)?.kind).toBe("local_crashed");
    expect(finished).toHaveLength(1);
    // batches 1 and 2 (notes a and b) kept; nothing after
    expect(w.rowsOf(path.join(w.memory, "a.md"))).toHaveLength(8);
    expect(w.rowsOf(path.join(w.memory, "b.md"))).toHaveLength(8);
    expect(w.allRows()).toHaveLength(16);
    expect((await w.call("GET", "/api/memory/status")).body.semantic.error).toContain("ended");
  });

  it("C55 crashing once on batch 2: the restarted child takes batch 3 on, batch 2 is owed, the error stays; a sound third pass fills it and clears the error", async () => {
    const w = await world();
    await w.install(QWEN);
    for (const name of ["a", "b", "c"]) w.note(name, sections(name.toUpperCase(), 8));
    w.localOn(QWEN);
    w.child.control({ crash: [2] });
    await w.index();
    const pids = w.child.pids();
    expect(pids).toHaveLength(2);
    const embeds = w.child.embeds();
    expect(embeds.map((e) => e.pid)).toEqual([pids[0], pids[0], pids[1]]);
    expect(w.rowsOf(path.join(w.memory, "a.md"))).toHaveLength(8);
    expect(w.rowsOf(path.join(w.memory, "b.md"))).toHaveLength(0);
    expect(w.rowsOf(path.join(w.memory, "c.md"))).toHaveLength(8);
    expect(metaError(w)?.kind).toBe("local_crashed");
    // the next pass with a sound stub fills batch 2 and clears the error
    w.child.control({});
    await w.index();
    expect(w.rowsOf(path.join(w.memory, "b.md"))).toHaveLength(8);
    expect(w.allRows()).toHaveLength(24);
    expect(metaError(w)).toBeNull();
    expect((await w.call("GET", "/api/memory/status")).body.semantic.error).toBeNull();
    // and the rows of a and c were not sent again (only b was owed)
    expect(
      w.child
        .embeds()
        .slice(3)
        .flatMap((e) => e.texts),
    ).toHaveLength(8);
  });
});

// ---------------------------------------------------------------------------------------------- C56

describe("C56 no network while local", () => {
  it("C56 a pass and an auto search with the local provider call fetch 0 times and the model host gets nothing", async () => {
    const w = await world();
    await w.install(QWEN);
    w.host.requests.length = 0;
    w.note("prazos", "# Prazos\n\nO prazo de devolução é de 30 dias.\n");
    w.localOn(QWEN);
    const spy = vi.spyOn(globalThis, "fetch");
    await w.index();
    expect((await w.search("prazo de devolução", "auto")).status).toBe(200);
    expect(w.child.embeds().length).toBeGreaterThanOrEqual(2);
    expect(spy).not.toHaveBeenCalled();
    expect(w.host.requests).toEqual([]);
  });

  it("C56 the real child turns remote models off, local models on, and reads models from <home>/models/", async () => {
    const source = readRepo(CHILD)!;
    expect(source).toContain("env.allowRemoteModels = false");
    expect(source).toContain("env.allowLocalModels = true");
    expect(source).toContain("env.localModelPath = modelsDir");
    expect(source).toContain("env.cacheDir = modelsDir");
    // the folder the host gives the child is <home>/models
    const w = await world();
    expect(w.ctx.localModels.options.modelsDir).toBe(path.join(w.home, "models"));
    await w.install(QWEN);
    w.update((s) => {
      s.memory.embeddings = {
        ...s.memory.embeddings,
        enabled: false,
        provider: "local",
        local: { model: QWEN },
      };
    });
    await w.act({ action: "test" });
    expect(w.child.log().find((m) => m.t === "embed")!.modelsDir).toBe(path.join(w.home, "models"));
  });
});

// ---------------------------------------------------------------------------------------------- C61

describe("C61 the prefixes of the catalog", () => {
  const NOTE = "# Política\n\nAté 30 dias.\n\n## Exceções\n\nProdutos abertos.\n";

  /** The texts hash is given for the note's sections: the section texts with no prefix. */
  async function hashTexts(): Promise<string[]> {
    const w = await world();
    w.note("politica", NOTE);
    w.hashOn();
    const seen: string[] = [];
    const embed = hashProvider.embed.bind(hashProvider);
    vi.spyOn(hashProvider, "embed").mockImplementation(
      async (texts, signal) => (seen.push(...texts), embed(texts, signal)),
    );
    await w.index();
    vi.mocked(hashProvider.embed).mockRestore();
    return seen;
  }

  it("C61 D: before each section and Q: before the question with the entry that has them; the texts unchanged with one that has none; hash and http send each section text exactly", async () => {
    const texts = await hashTexts();
    expect(texts).toHaveLength(2);
    expect(texts[0]).toBe(
      embeddedText({ area: null, title: "Política", path: ["Política"] }, "Até 30 dias.", 20_000),
    );

    const gemma = await world();
    await gemma.install(GEMMA);
    gemma.note("politica", NOTE);
    gemma.localOn(GEMMA);
    await gemma.index();
    expect(gemma.child.embeds().flatMap((e) => e.texts)).toEqual(texts.map((t) => `D: ${t}`));
    await gemma.search("prazo de troca", "auto");
    expect(gemma.child.embeds().at(-1)!.texts).toEqual(["Q: prazo de troca"]);

    const qwen = await world();
    await qwen.install(QWEN);
    qwen.note("politica", NOTE);
    qwen.localOn(QWEN);
    await qwen.index();
    expect(qwen.child.embeds().flatMap((e) => e.texts)).toEqual(texts);
    await qwen.search("prazo de troca", "auto");
    expect(qwen.child.embeds().at(-1)!.texts).toEqual(["prazo de troca"]);

    const server = await embeddingsServer(8);
    servers.push(server);
    const viaHttp = await world();
    viaHttp.note("politica", NOTE);
    viaHttp.update((s) => {
      s.memory.embeddings = {
        ...s.memory.embeddings,
        enabled: true,
        provider: "http",
        endpoint: server.url,
        model: "m",
        dimensions: 8,
      };
    });
    await viaHttp.index();
    expect(server.bodies.flatMap((b) => b.input)).toEqual(texts);
  });

  it("C61 a documentPrefix counts toward maxChars", async () => {
    const w = await world();
    await w.install(GEMMA);
    const body = "x".repeat(2_100);
    w.note("longa", `# Longa\n\n${body}\n`);
    w.localOn(GEMMA);
    await w.index();
    const [sent] = w.child.embeds().flatMap((e) => e.texts);
    const text = embeddedText({ area: null, title: "Longa", path: ["Longa"] }, body, 2000);
    expect(text).toHaveLength(2000);
    expect(sent).toHaveLength(2000);
    expect(sent).toBe(`D: ${text}`.slice(0, 2000));
  });
});
