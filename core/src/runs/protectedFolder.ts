import path from "node:path";
import type { MordomoPaths } from "../paths.js";
import type { Settings } from "../config/schema.js";
import { PathAccessError, isInside, realpathLenient } from "../security/paths.js";
import {
  assertHoldsNoPrivateFolder,
  findPrivateLink,
  inspectPath,
  readScope,
  statWorkspacePath,
} from "../security/safeFs.js";

/**
 * A folder of the user handed to a run of a memory skill, only to read (.specs/features/cerebro-organizar, doors 5 and
 * 9). A skill the owner's `memorySkills` names and that declares the input `folder` is given that folder's real path
 * in `readDirs` and in `protectedDirs`, and starts in `<home>/workspace`: the folder is never its working directory.
 * The rule is read when the run is asked for (`Execution.startSkill`) and again when it launches (`RunManager`), so a
 * folder that stopped being one since fails the run instead of reaching the agent.
 */

/** The input that names the folder. */
export const FOLDER_INPUT = "folder";

export interface FolderEnv {
  paths: MordomoPaths;
  settings: Settings;
  /** Platform whose file-name rules apply (tests only); defaults to this process's. */
  platform?: NodeJS.Platform;
}

/** `400 folder_not_indexed`: the folder is not one a run may be handed today. */
export class FolderNotIndexedError extends Error {
  readonly statusCode = 400;
  readonly code = "folder_not_indexed";
  constructor(message: string) {
    super(message);
    this.name = "FolderNotIndexedError";
  }
}

/** `409 folder_protection_unsupported`: the run's provider cannot keep the folder read-only. */
export class FolderProtectionUnsupportedError extends Error {
  readonly statusCode = 409;
  readonly code = "folder_protection_unsupported";
  constructor(message: string) {
    super(message);
    this.name = "FolderProtectionUnsupportedError";
  }
}

/** The code a run that failed on one of these refusals records (`RunFailure.code`, door 11), or null. */
export function folderFailureCode(
  err: unknown,
): "folder_not_indexed" | "folder_protection_unsupported" | null {
  if (err instanceof FolderNotIndexedError || err instanceof FolderProtectionUnsupportedError)
    return err.code;
  return null;
}

/** Whether a skill is given a folder through its input: the owner made it a memory skill and it declares `folder`. */
export function takesFolder(skill: {
  memoryAccess: boolean;
  inputs: ReadonlyArray<{ name: string }>;
}): boolean {
  return skill.memoryAccess && skill.inputs.some((input) => input.name === FOLDER_INPUT);
}

/** The folder a run of such a skill asks for, or null when it asks for none. */
export function askedFolder(inputs: Readonly<Record<string, string>> | undefined): string | null {
  const value = inputs?.[FOLDER_INPUT]?.trim();
  return value ? value : null;
}

/**
 * Door 5: the real path of `folder` when a run may be handed it to read, else `FolderNotIndexedError` naming it. It must
 * be an absolute path to a folder inside an enabled indexed folder or the home's `memory/`, that today's policy does
 * not hide (the home's `config/` and `logs/`, a user exclude, a secret name), that holds neither of those folders, and
 * that holds no link (or second name for a file) leading into them. Never reads a file.
 */
export function folderVerdict(env: FolderEnv, folder: string): string {
  const refused = (why: string) =>
    new FolderNotIndexedError(`The folder ${folder} cannot be handed to this run: ${why}`);
  if (!path.isAbsolute(folder)) throw refused("it is not an absolute path.");
  const scope = readScope({
    homeDir: env.paths.home,
    roots: [...env.settings.indexedFolders.filter((f) => f.enabled).map((f) => f.path), env.paths.memory],
    excludes: env.settings.excludes,
    ...(env.platform ? { platform: env.platform } : {}),
  });
  try {
    const verdict = inspectPath(scope, folder);
    if (verdict.blockedReason) throw refused(verdict.blockedReason);
    if (!statWorkspacePath(scope, folder).stat.isDirectory()) throw refused("it is not a folder.");
    assertHoldsNoPrivateFolder(scope, verdict.real);
    const link = findPrivateLink(scope, verdict.real);
    if (link) throw refused(`it holds a link into the MordomoOS config/ or logs/ (${link}).`);
    return verdict.real;
  } catch (err) {
    if (err instanceof FolderNotIndexedError) throw err;
    if (err instanceof PathAccessError) {
      throw refused(
        "it is not inside an enabled indexed folder or memory/, or it is the home's config/ or logs/.",
      );
    }
    if ((err as NodeJS.ErrnoException).code === "ENOENT") throw refused("it does not exist.");
    throw err;
  }
}

/** A folder under the home's `memory/` is already handed to a memory skill whole, and is the skill's to write. */
export function insideMemory(paths: MordomoPaths, real: string): boolean {
  return isInside(realpathLenient(paths.memory), real);
}

/** Door 5: refuse a folder on a provider whose manifest does not declare `capabilities.protectsDirs: true`. */
export function assertProtectsDirs(
  manifest: { displayName: string; capabilities: { protectsDirs?: boolean } } | undefined,
  provider: string,
): void {
  if (manifest?.capabilities.protectsDirs === true) return;
  throw new FolderProtectionUnsupportedError(
    `${manifest?.displayName ?? provider} cannot keep a folder read-only, so a memory skill cannot be handed a folder on it. Choose a provider that protects folders (Claude Code).`,
  );
}
