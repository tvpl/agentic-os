import { resolveFolderAccess, type FolderAccess, type FolderAccessEnv } from "../memory/folderAccess.js";

/**
 * What the access of folders (.specs/features/cerebro-memoria-confiavel, door 12 and 13) decides about a run: checked
 * when the run is asked for (`RunManager.create`, and before a conversation is made) and again when it launches
 * (`RunManager.run`), so a level changed in between decides (AC 101). Each refusal names its own rule:
 *
 * - asked by a paired device, a working folder `hide` for devices: `404 not_found` (the folder is not said to exist);
 *   `read` for devices and the run would write: `403 folder_read_only` (AC 94);
 * - a working folder, or a folder the run is handed to read, `hide` for agents: `403 folder_hidden` (AC 96);
 * - a write run whose working folder is `read` for agents: `403 folder_read_only` (AC 99);
 * - a working folder or a handed folder that holds a folder `hide` for agents, on a provider whose reads are not kept in
 *   the working folder (`readConfinement` other than `workdir`, a manifest that says nothing included):
 *   `409 folder_hide_unsupported` (AC 98); on one that keeps them there, the held folders are denied to its tools (AC
 *   97, `AgentRun.hiddenDirs`);
 * - a write run whose working folder or handed folders hold a folder `read` for agents: those folders are kept
 *   read-only (`AgentRun.protectedDirs`, AC 100); a provider that cannot protect a folder fails at launch with
 *   `409 folder_protection_unsupported` (`assertProtectsDirs`).
 */

/** `403 folder_hidden`: the run's folder, or one it would be handed, is hidden from agents. */
export class FolderHiddenError extends Error {
  readonly statusCode = 403;
  readonly code = "folder_hidden";
  constructor(message: string) {
    super(message);
    this.name = "FolderHiddenError";
  }
}

/** `403 folder_read_only`: the run would write in a folder agents (or the asking device) may only read. */
export class FolderReadOnlyError extends Error {
  readonly statusCode = 403;
  readonly code = "folder_read_only";
  constructor(message: string) {
    super(message);
    this.name = "FolderReadOnlyError";
  }
}

/** `409 folder_hide_unsupported`: the run's folder holds a folder hidden from agents, and the provider reads the whole disk. */
export class FolderHideUnsupportedError extends Error {
  readonly statusCode = 409;
  readonly code = "folder_hide_unsupported";
  constructor(message: string) {
    super(message);
    this.name = "FolderHideUnsupportedError";
  }
}

/** `404 not_found`: a device asked for a run in a folder hidden from devices; the answer does not say it is there. */
export class FolderHiddenFromDeviceError extends Error {
  readonly statusCode = 404;
  readonly code = "not_found";
  constructor(folder: string) {
    super(`No folder a run may start in is ${folder}.`);
    this.name = "FolderHiddenFromDeviceError";
  }
}

/** The code a run that failed at launch on one of these refusals records (`RunFailure.code`, G16), or null. */
export function folderLevelFailureCode(
  err: unknown,
): "folder_hidden" | "folder_read_only" | "folder_hide_unsupported" | null {
  if (err instanceof FolderHiddenError || err instanceof FolderHiddenFromDeviceError) return "folder_hidden";
  if (err instanceof FolderReadOnlyError) return "folder_read_only";
  if (err instanceof FolderHideUnsupportedError) return "folder_hide_unsupported";
  return null;
}

export interface RunFolderPlan {
  /** The working folder (a real path). */
  cwd: string;
  /** The folders the run is handed besides it (real paths): `memory/` of a memory skill, a handed folder, a context's. */
  readDirs: readonly string[];
  mode: "read_only" | "write";
  /** A paired device asked for the run. */
  device: boolean;
  /** The provider's `readConfinement` and name, asked only when a held folder is hidden; undefined confinement counts as `none`. */
  provider: () => { readConfinement: "workdir" | "none" | undefined; name: string };
}

export interface RunFolderVerdict {
  /** The folders hidden from agents inside the working folder or a handed folder: denied to the tools (door 13). */
  hiddenDirs: string[];
  /** The folders `read` for agents inside them, for a write run: kept read-only. */
  readOnlyDirs: string[];
}

/** Check a run's folders against the access of folders (see the table above); throws the refusal, else what to deny. */
export function checkRunFolders(
  env: FolderAccessEnv,
  plan: RunFolderPlan,
  access: FolderAccess = resolveFolderAccess(env),
): RunFolderVerdict {
  // No level other than `write` anywhere: nothing to refuse or deny, exactly as before the access of folders existed.
  if (!access.restricts("agents") && !access.restricts("devices"))
    return { hiddenDirs: [], readOnlyDirs: [] };
  if (plan.device) {
    const level = access.level(plan.cwd, "devices");
    if (level === "hide") throw new FolderHiddenFromDeviceError(plan.cwd);
    if (level === "read" && plan.mode === "write") {
      throw new FolderReadOnlyError(
        `A paired device may only read in ${plan.cwd}, so it cannot ask for a run that writes there. Ask for a read-only run, or change the folder's access in Settings › Memory.`,
      );
    }
  }
  if (access.level(plan.cwd, "agents") === "hide") {
    throw new FolderHiddenError(`The folder ${plan.cwd} is hidden from agents, so a run cannot start in it.`);
  }
  for (const dir of plan.readDirs) {
    if (access.level(dir, "agents") === "hide") {
      throw new FolderHiddenError(`The folder ${dir} is hidden from agents, so a run cannot be handed it.`);
    }
  }
  if (plan.mode === "write" && access.level(plan.cwd, "agents") === "read") {
    throw new FolderReadOnlyError(
      `Agents may only read in ${plan.cwd}, so a run that writes cannot start there. Start a read-only run, or change the folder's access in Settings › Memory.`,
    );
  }
  const dirs = [plan.cwd, ...plan.readDirs];
  const hiddenDirs = [...new Set(dirs.flatMap((dir) => access.inside(dir, "agents", "hide")))];
  const provider = hiddenDirs.length > 0 ? plan.provider() : null;
  if (provider && provider.readConfinement !== "workdir") {
    throw new FolderHideUnsupportedError(
      `${provider.name} reads everything the user can read, and the run's folder holds a folder hidden from agents (${hiddenDirs[0]}): hiding it would be false. Choose a provider that keeps reads in the working folder (Claude Code), or start the run elsewhere.`,
    );
  }
  const readOnlyDirs =
    plan.mode === "write" ? [...new Set(dirs.flatMap((dir) => access.inside(dir, "agents", "read")))] : [];
  return { hiddenDirs, readOnlyDirs };
}
