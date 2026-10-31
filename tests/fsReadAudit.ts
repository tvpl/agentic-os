import fs from "node:fs";
import path from "node:path";
import ts from "typescript";

/**
 * Finds raw `fs` read and write calls whose path is not a literal, the shape every
 * leak of `config/token` took (journal, sync plan, recall, ...) and every
 * corruption of it (a router, a skill note, a sync target written through a
 * link): a reader or writer that opened a path it was handed without the
 * workspace filter. It must use `core/src/security/safeFs.ts`; the few that may
 * not are listed, one by one and with a reason, in `tests/security-reads.test.ts`.
 *
 * It works on the type checker, not on names. A call is an fs read or write when
 * its RESOLVED signature is declared in `@types/node`'s `fs.d.ts` /
 * `fs/promises.d.ts` under one of `RAW_APIS`, so `fs.readFileSync(p)`, `import * as ns` +
 * `ns.readFileSync(p)`, `import { readFileSync as r }` + `r(p)`, `fsp.readFile(p)`
 * (`node:fs/promises`), `fs.promises.readFile(p)` and `const { readFileSync } = fs`
 * are all seen. An fs read function used as a VALUE (`const read = fs.readFileSync`,
 * `promisify(fs.readFile)`, handed to a callback) is reported too: what happens
 * to it afterwards cannot be judged. A call the checker cannot resolve (an `any`
 * module from `createRequire`) is judged by its name alone.
 */

/** The base names (no `Sync`) of every `fs` function that takes a path, by what it does with the file behind it. */
const READ_BASE = [
  "readFile",
  "createReadStream",
  "open",
  "opendir",
  "readdir",
  "stat",
  "lstat",
  "realpath",
  "readlink",
  "copyFile",
  "cp",
  "glob",
  "openAsBlob",
] as const;
/** They change the file a link points to: a write, a truncation, a mode or an owner. */
const WRITE_BASE = [
  "writeFile",
  "appendFile",
  "createWriteStream",
  "truncate",
  "chmod",
  "lchmod",
  "chown",
  "lchown",
  "utimes",
  "lutimes",
] as const;
/**
 * They act on a directory entry and not on the file behind it (`rename`, `unlink`, `rm` and `link` replace or
 * remove the NAME, never follow a final link; `mkdir`, `mkdtemp`, `symlink` make one), or only answer a question
 * (`exists`, `access`, `statfs`, `watch*`).
 */
const NEUTRAL_BASE = [
  "exists",
  "access",
  "mkdir",
  "mkdtemp",
  "rm",
  "rmdir",
  "unlink",
  "rename",
  "link",
  "symlink",
  "statfs",
  "watch",
  "watchFile",
  "unwatchFile",
] as const;

const withSync = (bases: readonly string[]) => bases.flatMap((b) => [b, `${b}Sync`]);

/** fs functions that open, list, stat or resolve a path. (`existsSync`/`access*` only answer "is it there".) */
export const READ_APIS: ReadonlySet<string> = new Set(withSync(READ_BASE));
/** fs functions that write, truncate or change the mode of what a path names. */
export const WRITE_APIS: ReadonlySet<string> = new Set(withSync(WRITE_BASE));
/** What the audit looks for. */
export const RAW_APIS: ReadonlySet<string> = new Set([...READ_APIS, ...WRITE_APIS]);
export const NEUTRAL_APIS: ReadonlySet<string> = new Set(withSync(NEUTRAL_BASE));

export interface RawRead {
  file: string;
  line: number;
  api: string;
  /** How it was recognised. */
  how: "call" | "value" | "destructured" | "unresolved";
  text: string;
}

const NODE_FS_DECL = /[\\/]@types[\\/]node[\\/]fs(?:[\\/]promises)?\.d\.ts$/;

function isFsDeclaration(decl: ts.Declaration | undefined): string | null {
  if (!decl || !NODE_FS_DECL.test(decl.getSourceFile().fileName)) return null;
  const name = ts.getNameOfDeclaration(decl)?.getText();
  if (!name || !RAW_APIS.has(name)) return null;
  // `FileHandle#readFile()` and friends read a descriptor the caller already holds.
  const owner = decl.parent;
  if (
    owner &&
    (ts.isInterfaceDeclaration(owner) || ts.isClassDeclaration(owner)) &&
    owner.name?.text === "FileHandle"
  ) {
    return null;
  }
  return name;
}

function fsApiOfSymbol(checker: ts.TypeChecker, symbol: ts.Symbol | undefined): string | null {
  if (!symbol) return null;
  const resolved = symbol.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(symbol) : symbol;
  for (const decl of resolved.declarations ?? []) {
    const api = isFsDeclaration(decl);
    if (api) return api;
  }
  return null;
}

/** `typeof fs.readFileSync` and other type positions name the function without using it. */
function inTypePosition(node: ts.Node): boolean {
  for (let p: ts.Node | undefined = node.parent; p && !ts.isStatement(p); p = p.parent) {
    if (ts.isTypeNode(p)) return true;
  }
  return false;
}

function isLiteralPath(arg: ts.Expression): boolean {
  return ts.isStringLiteral(arg) || ts.isNoSubstitutionTemplateLiteral(arg);
}

function calleeName(callee: ts.Expression): string | null {
  if (ts.isIdentifier(callee)) return callee.text;
  if (ts.isPropertyAccessExpression(callee)) return callee.name.text;
  if (ts.isElementAccessExpression(callee) && ts.isStringLiteral(callee.argumentExpression)) {
    return callee.argumentExpression.text;
  }
  return null;
}

/** Every raw fs read with a non-literal path in `sourceFiles`. */
export function findRawFsReads(
  program: ts.Program,
  sourceFiles: readonly ts.SourceFile[],
  rootDir: string,
): RawRead[] {
  const checker = program.getTypeChecker();
  const found: RawRead[] = [];

  const report = (file: ts.SourceFile, node: ts.Node, api: string, how: RawRead["how"]) => {
    const { line } = file.getLineAndCharacterOfPosition(node.getStart(file));
    found.push({
      file: path.relative(rootDir, file.fileName).split(path.sep).join("/"),
      line: line + 1,
      api,
      how,
      text: node.getText(file).slice(0, 80),
    });
  };

  for (const file of sourceFiles) {
    const visit = (node: ts.Node): void => {
      if (ts.isCallExpression(node)) {
        const declaration = checker.getResolvedSignature(node)?.declaration;
        // `statSync`/`lstatSync` are constants typed by an interface with call signatures (no name of their own):
        // for those the callee's own symbol (`const statSync: StatSyncFn`) says which function it is.
        const callee = ts.isPropertyAccessExpression(node.expression)
          ? node.expression.name
          : node.expression;
        const api =
          isFsDeclaration(declaration) ?? fsApiOfSymbol(checker, checker.getSymbolAtLocation(callee));
        const first = node.arguments[0];
        if (api) {
          // A literal path, or a descriptor (`fstatSync(fd)`, `readFileSync(fd)`), names nothing a caller chose.
          const isDescriptor =
            first !== undefined && (checker.getTypeAtLocation(first).flags & ts.TypeFlags.NumberLike) !== 0;
          if (!(first && (isLiteralPath(first) || isDescriptor))) report(file, node, api, "call");
        } else if (!declaration) {
          const name = calleeName(node.expression);
          if (name && RAW_APIS.has(name) && !(first && isLiteralPath(first)))
            report(file, node, name, "unresolved");
        }
      }

      // The function used as a value: not the callee of a call (those are judged above).
      if (
        ts.isPropertyAccessExpression(node) ||
        (ts.isIdentifier(node) && !ts.isPropertyAccessExpression(node.parent))
      ) {
        const parent = node.parent;
        const isCallee = ts.isCallExpression(parent) && parent.expression === node;
        const isDeclarationName =
          ts.isImportSpecifier(parent) ||
          ts.isImportClause(parent) ||
          ts.isNamespaceImport(parent) ||
          ts.isExportSpecifier(parent) ||
          (ts.isBindingElement(parent) && parent.name === node) ||
          (ts.isVariableDeclaration(parent) && parent.name === node) ||
          (ts.isPropertyAccessExpression(parent) && parent.name === node);
        if (!isCallee && !isDeclarationName && !inTypePosition(node)) {
          const api = fsApiOfSymbol(
            checker,
            checker.getSymbolAtLocation(ts.isPropertyAccessExpression(node) ? node.name : node),
          );
          if (api) report(file, node, api, "value");
        }
      }

      // `const { readFileSync } = fs`: the binding is a local name for an fs read function.
      if (ts.isBindingElement(node) && ts.isObjectBindingPattern(node.parent)) {
        const key = (node.propertyName ?? node.name).getText(file);
        const property = checker.getTypeAtLocation(node.parent).getProperty(key);
        const api = fsApiOfSymbol(checker, property);
        if (api) report(file, node, api, "destructured");
      }
      ts.forEachChild(node, visit);
    };
    visit(file);
  }
  return found;
}

/** Compiler options of the engine's own sources (strict NodeNext, Node types). */
export function auditCompilerOptions(rootDir: string): ts.CompilerOptions {
  return {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.NodeNext,
    moduleResolution: ts.ModuleResolutionKind.NodeNext,
    lib: ["lib.es2022.d.ts"],
    types: ["node"],
    typeRoots: [path.join(rootDir, "node_modules", "@types")],
    esModuleInterop: true,
    skipLibCheck: true,
    noEmit: true,
    strict: true,
  };
}

/** Walk `.ts` sources (no declarations, no tests) under `dirs`. */
export function sourceFilesUnder(dirs: readonly string[]): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name !== "node_modules" && entry.name !== "dist") walk(full);
      } else if (
        /\.ts$/.test(entry.name) &&
        !entry.name.endsWith(".d.ts") &&
        !/\.test\.ts$/.test(entry.name)
      ) {
        out.push(full);
      }
    }
  };
  dirs.forEach(walk);
  return out;
}

/** The program the audit (and any other whole-source check) reads. */
export function createAuditProgram(rootDir: string, files: readonly string[]): ts.Program {
  return ts.createProgram([...files], auditCompilerOptions(rootDir));
}

/** Audit the given files of a program. */
export function auditProgram(program: ts.Program, rootDir: string, files: readonly string[]): RawRead[] {
  const wanted = new Set(files.map((f) => path.resolve(f)));
  const sources = program.getSourceFiles().filter((s) => wanted.has(path.resolve(s.fileName)));
  return findRawFsReads(program, sources, rootDir);
}

/** Audit real files on disk. */
export function auditFiles(rootDir: string, files: readonly string[]): RawRead[] {
  return auditProgram(createAuditProgram(rootDir, files), rootDir, files);
}

let previous: ts.Program | undefined;

function virtualProgram(
  rootDir: string,
  virtual: Record<string, string>,
): { program: ts.Program; known: Map<string, string> } {
  const options = auditCompilerOptions(rootDir);
  const host = ts.createCompilerHost(options);
  const known = new Map(Object.entries(virtual).map(([name, text]) => [path.resolve(rootDir, name), text]));
  const original = {
    getSourceFile: host.getSourceFile.bind(host),
    fileExists: host.fileExists.bind(host),
    readFile: host.readFile.bind(host),
  };
  host.fileExists = (name) => known.has(path.resolve(name)) || original.fileExists(name);
  host.readFile = (name) => known.get(path.resolve(name)) ?? original.readFile(name);
  host.getSourceFile = (name, languageVersion, onError, shouldCreate) => {
    const text = known.get(path.resolve(name));
    return text !== undefined
      ? ts.createSourceFile(name, text, languageVersion, true)
      : original.getSourceFile(name, languageVersion, onError, shouldCreate);
  };
  const program = ts.createProgram([...known.keys()], options, host, previous);
  previous = program;
  return { program, known };
}

/**
 * Audit in-memory sources (the self-test): `virtual` maps a path under `rootDir`
 * (so `node_modules/@types/node` resolves) to its text. Each call reuses the
 * parsed libraries of the one before.
 */
export function auditVirtual(rootDir: string, virtual: Record<string, string>): RawRead[] {
  const { program, known } = virtualProgram(rootDir, virtual);
  const sources = program.getSourceFiles().filter((s) => known.has(path.resolve(s.fileName)));
  return findRawFsReads(program, sources, rootDir);
}

/**
 * Every function `node:fs` and `node:fs/promises` export whose first parameter is a path (a path or a
 * descriptor, or a glob), read from the installed `@types/node` and not from a list written by hand.
 */
export function fsPathApis(rootDir: string): { fs: string[]; promises: string[] } {
  const { program, known } = virtualProgram(rootDir, {
    "core/src/__fs_probe__.ts":
      'import * as fs from "node:fs"; import * as fsp from "node:fs/promises"; export const a = [fs, fsp];',
  });
  const checker = program.getTypeChecker();
  const source = program.getSourceFiles().find((s) => known.has(path.resolve(s.fileName)))!;
  const found: Record<string, string[]> = {};
  for (const statement of source.statements) {
    if (!ts.isImportDeclaration(statement)) continue;
    const specifier = (statement.moduleSpecifier as ts.StringLiteral).text;
    const module = checker.getSymbolAtLocation(statement.moduleSpecifier);
    if (!module) continue;
    found[specifier] = checker
      .getExportsOfModule(module)
      .filter((symbol) =>
        checker
          .getTypeOfSymbol(symbol)
          .getCallSignatures()
          .some((signature) => {
            const first = signature.getParameters()[0];
            return (
              first !== undefined &&
              /PathLike|PathOrFileDescriptor|\bstring\b/.test(
                checker.typeToString(checker.getTypeOfSymbol(first)),
              )
            );
          }),
      )
      .map((symbol) => symbol.name)
      .sort();
  }
  return { fs: found["node:fs"] ?? [], promises: found["node:fs/promises"] ?? [] };
}

/**
 * What `fsPathApis` finds minus what `READ_APIS`, `WRITE_APIS` and `NEUTRAL_APIS` classify. A function Node adds
 * (`glob` was one) shows up here until somebody decides what it does to the file behind the path, so the
 * detector cannot go stale in silence. `Sync` is folded into the base name.
 */
export function unclassifiedFsPathApis(rootDir: string): string[] {
  const { fs: sync, promises } = fsPathApis(rootDir);
  const classified = new Set([...RAW_APIS, ...NEUTRAL_APIS].map((n) => n.replace(/Sync$/, "")));
  return [...new Set([...sync, ...promises].map((n) => n.replace(/Sync$/, "")))]
    .filter((n) => !classified.has(n))
    .sort();
}

/**
 * The runtime half (.specs/features/cerebro-paineis, round 1, F6): record every path a file is opened or read by,
 * through each entry of `node:fs` that reads one - `openSync`, `open`, `readFileSync`, `readFile`, `createReadStream`,
 * `fs.promises.open` and `fs.promises.readFile`. Node 22 reads a utf8 `readFileSync` on a fast path that never calls
 * `openSync`, so wrapping `openSync` alone misses it. The module's own functions are wrapped and the ESM named exports
 * synced (`syncBuiltinESMExports`), so `import fs`, `import { readFileSync }` and `node:fs/promises` all go through the
 * wrappers. The spellings it does not see: a read through a file descriptor opened before it started, and a native
 * addon's own reads.
 */
export async function recordFileReads(keep: (file: string) => boolean): Promise<{
  paths: string[];
  restore: () => void;
}> {
  const { syncBuiltinESMExports } = await import("node:module");
  const paths: string[] = [];
  const restores: Array<() => void> = [];
  const note = (file: unknown) => {
    if (typeof file === "string" || Buffer.isBuffer(file) || file instanceof URL) {
      const p = file instanceof URL ? file.pathname : String(file);
      if (keep(p)) paths.push(p);
    }
  };
  const wrap = (target: Record<string, unknown>, name: string) => {
    const real = target[name] as (...args: unknown[]) => unknown;
    target[name] = function (this: unknown, ...args: unknown[]) {
      note(args[0]);
      return real.apply(this, args);
    };
    restores.push(() => {
      target[name] = real;
    });
  };
  const fsAny = fs as unknown as Record<string, unknown>;
  for (const name of ["openSync", "open", "readFileSync", "readFile", "createReadStream"]) wrap(fsAny, name);
  for (const name of ["open", "readFile"]) wrap(fs.promises as unknown as Record<string, unknown>, name);
  syncBuiltinESMExports();
  return {
    paths,
    restore() {
      for (const undo of restores.reverse()) undo();
      syncBuiltinESMExports();
    },
  };
}
