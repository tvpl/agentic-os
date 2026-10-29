import fs from "node:fs";
import path from "node:path";
import type { Db } from "../db/db.js";
import type { MordomoPaths } from "../paths.js";
import { CONTEXT_ID, CONTEXT_LIMITS, type Settings, type WorkContext } from "../config/schema.js";
import { PathAccessError, realpathLenient } from "../security/paths.js";
import { findPrivateLink, homeReadScope, inspectPath, readScope, statWorkspacePath, type ReadScope } from "../security/safeFs.js";
import { comparableSegments } from "./excludes.js";
import { slugify } from "./notes.js";

/**
 * Work contexts (.specs/features/cerebro-contextos): a named scope the owner defines over the indexed folders and
 * `memory/`. They live in `settings.contexts` (door 1); this module decides which paths may be one, what state each is
 * in today, and which indexed files belong to one (door 6). It writes nothing but the removal of a context's map: the
 * settings are saved by the caller through the `SettingsStore`.
 */

export type ContextPathState = "ok" | "missing" | "not_indexed";

/** What the routes answer for a context. */
export interface ContextView {
  id: string;
  name: string;
  paths: Array<{ path: string; state: ContextPathState }>;
  notesDir: string;
  brief: string | null;
  map: string;
  files: number;
}

export interface ContextEnv {
  paths: MordomoPaths;
  settings: Settings;
  /** Platform whose file-name rules apply (tests only); defaults to this process's. */
  platform?: NodeJS.Platform;
}

/** Refusals of the rules of a context: each is one status and its stable code (what the API answers). */
export class ContextValidationError extends Error {
  readonly statusCode = 400;
  constructor(
    readonly code: "validation" | "context_path_not_indexed",
    message: string,
  ) {
    super(message);
    this.name = "ContextValidationError";
  }
}
export class ContextExistsError extends Error {
  readonly statusCode = 409;
  readonly code = "context_exists";
  constructor(message: string) {
    super(message);
    this.name = "ContextExistsError";
  }
}
export class ContextNotFoundError extends Error {
  readonly statusCode = 404;
  readonly code = "context_not_found";
  constructor(message: string) {
    super(message);
    this.name = "ContextNotFoundError";
  }
}

/** The folder of a context's own notes, `memory/notes/<id>/`. */
export const contextNotesDir = (paths: MordomoPaths, id: string): string => path.join(paths.memory, "notes", id);
/** The brief of a context, `memory/notes/<id>/_resumo.md`. */
export const contextBriefFile = (paths: MordomoPaths, id: string): string =>
  path.join(contextNotesDir(paths, id), "_resumo.md");
/** The generated map of a context, `memory/contexts/<id>.md` (door 2). */
export const contextMapFile = (paths: MordomoPaths, id: string): string =>
  path.join(paths.memory, "contexts", `${id}.md`);

/** The context `value` names: `null` for `all` or nothing (the whole index); `undefined` when it names none. */
export function findContext(settings: Settings, value: string | undefined): WorkContext | null | undefined {
  if (value === undefined || value === "all") return null;
  return settings.contexts.find((c) => c.id === value);
}

/** Where a context path may lie: the enabled indexed folders and `memory/`, judged by today's policy. */
function contextScope(env: ContextEnv): ReadScope {
  return readScope({
    homeDir: env.paths.home,
    roots: [...env.settings.indexedFolders.filter((f) => f.enabled).map((f) => f.path), env.paths.memory],
    excludes: env.settings.excludes,
    ...(env.platform ? { platform: env.platform } : {}),
  });
}

/**
 * Why `candidate` cannot be a path of a context today, or null when it can. `deep` also looks inside the folder for a
 * link (or a second name for a file) that leads into the home's `config/` or `logs/`: what a run of the context would
 * be handed. Never reads a file.
 */
function refusal(scope: ReadScope, candidate: string, deep: boolean): { missing: boolean; reason: string } | null {
  if (!fs.existsSync(candidate)) return { missing: true, reason: `The folder does not exist: ${candidate}` };
  try {
    const verdict = inspectPath(scope, candidate);
    if (verdict.blockedReason) return { missing: false, reason: `${verdict.blockedReason} ${candidate}` };
    if (!statWorkspacePath(scope, candidate).stat.isDirectory()) {
      return { missing: false, reason: `Not a folder: ${candidate}` };
    }
    if (deep) {
      const link = findPrivateLink(scope, verdict.real);
      if (link) return { missing: false, reason: `The folder holds a link into the MordomoOS config/ or logs/ (${link}): ${candidate}` };
    }
  } catch (err) {
    if (err instanceof PathAccessError) {
      return {
        missing: false,
        reason: `Not inside an enabled indexed folder or memory/, or inside the home's config/ or logs/: ${candidate}`,
      };
    }
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return { missing: true, reason: `The folder does not exist: ${candidate}` };
    throw err;
  }
  return null;
}

/** The state of each path of a context today (door 6 counts only the `ok` ones). */
export function contextPathStates(env: ContextEnv, context: WorkContext): Array<{ path: string; state: ContextPathState }> {
  const scope = contextScope(env);
  return context.paths.map((p) => {
    const refused = refusal(scope, p, false);
    return { path: p, state: refused === null ? "ok" : refused.missing ? "missing" : "not_indexed" };
  });
}

/**
 * Where the sync of a context writes and the map it carries in the master router's place (AC 30): its first `ok` path
 * and `memory/contexts/<id>.md`; `null` when none of its paths is `ok`.
 */
export function contextSyncTarget(env: ContextEnv, context: WorkContext): { target: string; map: string } | null {
  const main = contextPathStates(env, context).find((p) => p.state === "ok");
  return main ? { target: main.path, map: contextMapFile(env.paths, context.id) } : null;
}

/** A real path as the platform compares names: case-folded on macOS and Windows (the rule of `grantedReadScope`). */
const comparable = (env: ContextEnv, real: string): string[] => comparableSegments(real, env.platform ?? process.platform);

/**
 * Door 6: a file belongs to a context when its real path is a real path of one of the context's `ok` paths, or begins
 * with one followed by the separator, names compared as the platform compares them. Each folder of a row is resolved
 * once per test. A path that is missing or no longer indexed contributes nothing (AC 16): the rows it left in the index
 * until the next pass are not the context's.
 */
export function contextMembership(env: ContextEnv, context: WorkContext): (row: { root: string; rel: string }) => boolean {
  const roots = contextPathStates(env, context)
    .filter((p) => p.state === "ok")
    .map((p) => comparable(env, realpathLenient(p.path)));
  const dirs = new Map<string, string[]>();
  return (row) => {
    if (roots.length === 0) return false;
    const full = path.join(row.root, row.rel);
    const dir = path.dirname(full);
    let segments = dirs.get(dir);
    if (segments === undefined) {
      segments = comparable(env, realpathLenient(dir));
      dirs.set(dir, segments);
    }
    const file = [...segments, ...comparable(env, path.basename(full))];
    return roots.some((root) => root.length <= file.length && root.every((segment, i) => file[i] === segment));
  };
}

/** What the routes answer for every context, in the order of `settings.contexts`: one pass over the index for all. */
export function describeContexts(db: Db, env: ContextEnv, only?: WorkContext): ContextView[] {
  const list = only ? [only] : env.settings.contexts;
  if (list.length === 0) return [];
  const members = list.map((context) => contextMembership(env, context));
  const counts = list.map(() => 0);
  for (const row of db.prepare("SELECT root, rel FROM files").iterate() as IterableIterator<{ root: string; rel: string }>) {
    members.forEach((member, i) => {
      if (member(row)) counts[i]!++;
    });
  }
  const memory = homeReadScope(env.paths.home, [env.paths.memory]);
  return list.map((context, i) => {
    const brief = contextBriefFile(env.paths, context.id);
    let briefExists = false;
    try {
      briefExists = statWorkspacePath(memory, brief).stat.isFile();
    } catch {
      briefExists = false;
    }
    return {
      id: context.id,
      name: context.name,
      paths: contextPathStates(env, context),
      notesDir: contextNotesDir(env.paths, context.id),
      brief: briefExists ? brief : null,
      map: contextMapFile(env.paths, context.id),
      files: counts[i]!,
    };
  });
}

/** Refuse what cannot be the paths of a context: a refused folder (AC 3), then two that are one real folder (AC 4). */
function checkPaths(env: ContextEnv, paths: readonly string[]): void {
  const scope = contextScope(env);
  for (const p of paths) {
    const refused = refusal(scope, p, true);
    if (refused) throw new ContextValidationError("context_path_not_indexed", refused.reason);
  }
  const seen = new Set<string>();
  for (const p of paths) {
    const key = comparable(env, realpathLenient(p)).join("/");
    if (seen.has(key)) throw new ContextValidationError("validation", `Two paths are the same folder: ${p}`);
    seen.add(key);
  }
}

/** The id a name gives (the note-name rule of `cerebro-v2`), at most 40 characters, with `-2` to `-99` when taken. */
function deriveId(name: string, taken: ReadonlySet<string>): string {
  const cut = (slug: string, room: number) => slug.slice(0, room).replace(/-+$/g, "") || "contexto";
  const base = slugify(name);
  const first = cut(base, 40);
  if (!taken.has(first)) return first;
  for (let n = 2; n <= 99; n++) {
    const suffix = `-${n}`;
    const id = `${cut(base, 40 - suffix.length)}${suffix}`;
    if (!taken.has(id)) return id;
  }
  throw new ContextExistsError(`Ninety-nine contexts already have the name ${name}.`);
}

export interface CreateContextInput {
  name: string;
  paths: string[];
  id?: string | undefined;
}

/** A new context checked against the rules (AC 1-4); the caller stores it. */
export function newContext(env: ContextEnv, input: CreateContextInput): WorkContext {
  const list = env.settings.contexts;
  if (list.length >= CONTEXT_LIMITS.contexts) {
    throw new ContextValidationError("validation", `There are already ${CONTEXT_LIMITS.contexts} contexts.`);
  }
  checkPaths(env, input.paths);
  const taken = new Set(list.map((c) => c.id));
  let id: string;
  if (input.id !== undefined) {
    if (!CONTEXT_ID.test(input.id)) throw new ContextValidationError("validation", `Not a context id: ${input.id}`);
    if (taken.has(input.id)) throw new ContextExistsError(`The context ${input.id} exists.`);
    id = input.id;
  } else {
    id = deriveId(input.name, taken);
  }
  return { id, name: input.name.trim(), paths: [...input.paths] };
}

/** A context with a new name or new paths (AC 5): the id stays, new paths are checked as a new context's are. */
export function changedContext(
  env: ContextEnv,
  id: string,
  patch: { name?: string | undefined; paths?: string[] | undefined },
): WorkContext {
  const current = env.settings.contexts.find((c) => c.id === id);
  if (!current) throw new ContextNotFoundError(`No context ${id}.`);
  if (patch.paths !== undefined) checkPaths(env, patch.paths);
  return {
    id: current.id,
    name: patch.name !== undefined ? patch.name.trim() : current.name,
    paths: patch.paths !== undefined ? [...patch.paths] : current.paths,
  };
}

/**
 * Remove the map of a context (`memory/contexts/<id>.md`), only when it is that file under the home's `memory/` and
 * not a link (the name is removed, never what a link points at). The notes of the context are never touched.
 */
export function removeContextMap(paths: MordomoPaths, id: string): boolean {
  if (!CONTEXT_ID.test(id)) return false;
  const file = contextMapFile(paths, id);
  const expected = path.join(realpathLenient(paths.memory), "contexts", `${id}.md`);
  if (!fs.existsSync(file) || realpathLenient(file) !== expected) return false;
  fs.unlinkSync(expected);
  return true;
}
