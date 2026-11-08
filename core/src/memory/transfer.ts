import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { MordomoPaths } from "../paths.js";
import { isInside, realpathLenient } from "../security/paths.js";
import {
  assertHoldsNoPrivateFolder,
  grantedReadScope,
  homeReadScope,
  statWorkspacePath,
  type ReadScope,
} from "../security/safeFs.js";
import { DEFAULT_COPY_LIMITS, copyTreeWithoutLinks, writeWorkspaceFile } from "../security/safeWrite.js";
import { exportsDir } from "./folderAccess.js";
import { recordFileVersion, type HistoryEnv } from "./history.js";
import { folderSegments } from "./notes.js";

/**
 * Export and import a folder (.specs/features/cerebro-memoria-confiavel, doors 14 and 15). Both copy through
 * `copyTreeWithoutLinks` with `DEFAULT_COPY_LIMITS`, so a link, a secret file and whatever the filter refuses stay
 * behind, and both make their target folder exclusively and remove it whole when the copy fails: a refused copy leaves
 * nothing. An export lands under `artifacts/exports/`, which no paired device is ever served (G11); an import lands in
 * a new folder of `memory/notes/` and records an `import` version of each note it copied.
 */

export interface TransferEnv extends HistoryEnv {
  paths: Pick<MordomoPaths, "home" | "memory" | "artifacts">;
}

/** The manifest an export writes beside the files it copied. */
export const EXPORT_MANIFEST = "mordomo-export.json";
/** An export of the same folder in the same minute takes `-2` to `-99`; past that, `409 exists` (G20). */
const MAX_SUFFIX = 99;

/** A folder the owner reads (the home, the enabled indexed folders): its real path; refusals as the routes answer them. */
function sourceFolder(scope: ReadScope, candidate: string): string {
  let found: { path: string; stat: fs.Stats };
  try {
    found = statWorkspacePath(scope, candidate);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT")
      throw Object.assign(new Error(`The folder does not exist: ${candidate}`), {
        statusCode: 404,
        code: "not_found",
      });
    throw err;
  }
  if (!found.stat.isDirectory())
    throw Object.assign(new Error(`Not a folder: ${candidate}`), {
      statusCode: 400,
      code: "validation",
    });
  // Before anything is made: the home itself, or a folder above it, is refused (403 forbidden_path).
  assertHoldsNoPrivateFolder(scope, found.path);
  return found.path;
}

const pad = (n: number) => String(n).padStart(2, "0");
/** `YYYY-MM-DD-HHMM` of the local minute. */
function stamp(at: number): string {
  const d = new Date(at);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`;
}

/** Make `dir` (its parent may be made), or report that it is there. */
function makeExclusive(dir: string): boolean {
  fs.mkdirSync(path.dirname(dir), { recursive: true });
  try {
    fs.mkdirSync(dir);
    return true;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "EEXIST") return false;
    throw err;
  }
}

/** Run `copy` into `dir`, which this call made; on any failure `dir` goes, so nothing half-copied stays. */
function intoNew<T>(dir: string, copy: () => T): T {
  try {
    return copy();
  } catch (err) {
    fs.rmSync(dir, { recursive: true, force: true });
    throw err;
  }
}

const sha256 = (bytes: Uint8Array) => crypto.createHash("sha256").update(bytes).digest("hex");

/**
 * `POST /api/memory/export` (door 14): copy `folder` to `artifacts/exports/<name>-YYYY-MM-DD-HHMM/` and write
 * `mordomo-export.json` = `{ v: 1, exportedAt, source, files: [{ path, sha256, size }] }`, each path relative to the
 * folder with `/`, each sha256 the hex digest of the bytes copied.
 */
export function exportFolder(
  env: TransferEnv,
  folder: string,
  now: number = Date.now(),
): { path: string; files: number; bytes: number } {
  const scope = grantedReadScope(env.settings, env.paths.home);
  const source = sourceFolder(scope, folder);
  const name = `${path.basename(source)}-${stamp(now)}`;
  const base = exportsDir(env.paths);
  let target: string | null = null;
  for (let n = 1; n <= MAX_SUFFIX && target === null; n++) {
    const candidate = path.join(base, n === 1 ? name : `${name}-${n}`);
    if (makeExclusive(candidate)) target = candidate;
  }
  if (target === null)
    throw Object.assign(new Error(`The export folders ${name} to ${name}-${MAX_SUFFIX} are all taken.`), {
      statusCode: 409,
      code: "exists",
    });
  const dest = target;
  const targetScope = homeReadScope(env.paths.home, [base], env.settings.excludes);
  return intoNew(dest, () => {
    const files: Array<{ path: string; sha256: string; size: number }> = [];
    const copied = copyTreeWithoutLinks(scope, source, targetScope, dest, DEFAULT_COPY_LIMITS, {
      copied: (rel, bytes) => files.push({ path: rel, sha256: sha256(bytes), size: bytes.byteLength }),
    });
    // A manifest the folder held (an export exported again) gives way to this one, and is not one of its files.
    const own = files.findIndex((f) => f.path === EXPORT_MANIFEST);
    const old = own >= 0 ? files.splice(own, 1)[0]! : null;
    const manifest = { v: 1, exportedAt: now, source, files };
    writeWorkspaceFile(targetScope, path.join(dest, EXPORT_MANIFEST), `${JSON.stringify(manifest, null, 2)}\n`, {
      mode: old ? "replace" : "create",
    });
    return { path: dest, files: copied.files - (old ? 1 : 0), bytes: copied.bytes - (old?.size ?? 0) };
  });
}

/**
 * `POST /api/memory/import` (door 15): copy `sourceDir` (one the owner reads, outside `memory/`) into a new
 * `memory/notes/<folder>/`, the folder's name by the rule of a note's folder (`folderSegments`); an `import` version of
 * each note copied, by the owner (G2), in one transaction with nothing else.
 */
export function importFolder(
  env: TransferEnv,
  input: { sourceDir: string; folder?: string | undefined },
): { folder: string; files: number; bytes: number; skipped: string[]; written: string[] } {
  const scope = grantedReadScope(env.settings, env.paths.home);
  const memory = path.resolve(env.paths.memory);
  const inMemory = (p: string) => isInside(memory, p) || isInside(realpathLenient(memory), p);
  // Asked before the folder is looked at, and again of its real path (a link into memory/).
  const source = inMemory(path.resolve(input.sourceDir)) ? null : sourceFolder(scope, input.sourceDir);
  if (source === null || inMemory(source))
    throw Object.assign(new Error("sourceDir: a folder outside memory/"), {
      statusCode: 400,
      code: "validation",
    });
  const asked = input.folder ?? path.basename(source);
  if (/[\\/]/.test(asked))
    throw Object.assign(new Error("folder: one name, with no / or \\"), {
      statusCode: 400,
      code: "validation",
    });
  const target = path.join(memory, "notes", folderSegments(asked)[0]!);
  if (!makeExclusive(target))
    throw Object.assign(new Error(`memory/notes/${path.basename(target)}/ already exists.`), {
      statusCode: 409,
      code: "exists",
    });
  const targetScope = homeReadScope(env.paths.home, [memory], env.settings.excludes);
  return intoNew(target, () => {
    const skipped: string[] = [];
    const notes: Array<[string, Uint8Array]> = [];
    const copied = copyTreeWithoutLinks(scope, source, targetScope, target, DEFAULT_COPY_LIMITS, {
      copied: (rel, bytes) => notes.push([path.join(target, ...rel.split("/")), bytes]),
      skipped,
    });
    env.db.transaction(() => {
      for (const [file, bytes] of notes) recordFileVersion(env, file, bytes, "owner", "import");
    })();
    return { folder: target, ...copied, skipped, written: notes.map(([file]) => file) };
  });
}
