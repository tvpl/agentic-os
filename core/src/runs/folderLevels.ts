import path from "node:path";
import { realpathLenient } from "../security/paths.js";
import {
  deniedDirs,
  resolveFolderAccess,
  type FolderAccess,
  type FolderAccessEnv,
} from "../memory/folderAccess.js";

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
 * - the same for a run a paired device asks for, with the folders hidden from devices that lie inside its working folder
 *   or a handed folder, and the folders no device is ever served (`artifacts/exports/`, the guard's folder): a device
 *   reads through the agent whatever the agent reads under its folder, so the folder that holds a hidden one is no
 *   more open to it than the hidden one (plan amendment 12, round 3 finding 1). A folder handed to a device's run that
 *   is itself hidden from devices is refused `404 not_found`, as a working folder is;
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
  constructor(folder: string | null) {
    super(
      folder === null
        ? "No folder this run may be handed is there."
        : `No folder a run may start in is ${folder}.`,
    );
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
  /**
   * The folders hidden from agents inside the working folder or a handed folder, and, for a run a device asked for, the
   * ones hidden from devices (and the ones no device is served) inside them: denied to the tools (door 13).
   */
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
  const dirs = [plan.cwd, ...plan.readDirs];
  const denied = plan.device ? deniedDirs(env.paths, "devices") : [];
  // No level other than `write` anywhere, and no folder a device is never served inside a device's run: nothing to
  // refuse or deny, exactly as before the access of folders existed.
  if (
    !access.restricts("agents") &&
    !access.restricts("devices") &&
    !denied.some((d) => dirs.some((dir) => touches(d, dir)))
  )
    return { hiddenDirs: [], readOnlyDirs: [] };
  if (plan.device) {
    const level = access.level(plan.cwd, "devices");
    if (level === "hide" || denied.some((d) => isUnder(d, plan.cwd)))
      throw new FolderHiddenFromDeviceError(plan.cwd);
    for (const dir of plan.readDirs) {
      if (access.level(dir, "devices") === "hide" || denied.some((d) => isUnder(d, dir)))
        throw new FolderHiddenFromDeviceError(null);
    }
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
  const hiddenDirs = [
    ...new Set([
      ...dirs.flatMap((dir) => access.inside(dir, "agents", "hide")),
      ...(plan.device
        ? dirs.flatMap((dir) => [
            ...access.inside(dir, "devices", "hide"),
            ...denied.filter((d) => isUnder(dir, d) && !isUnder(d, dir)).map((d) => realpathLenient(d)),
          ])
        : []),
    ]),
  ];
  const provider = hiddenDirs.length > 0 ? plan.provider() : null;
  if (provider && provider.readConfinement !== "workdir") {
    throw new FolderHideUnsupportedError(
      `${provider.name} reads everything the user can read, and the run's folder holds a folder hidden from ${plan.device ? "the device that asked" : "agents"} (${hiddenDirs[0]}): hiding it would be false. Choose a provider that keeps reads in the working folder (Claude Code), or start the run elsewhere.`,
    );
  }
  const readOnlyDirs =
    plan.mode === "write" ? [...new Set(dirs.flatMap((dir) => access.inside(dir, "agents", "read")))] : [];
  return { hiddenDirs, readOnlyDirs };
}

/** `inner` is `outer` or lies inside it (lexically or by real path). */
function isUnder(outer: string, inner: string): boolean {
  const within = (o: string, i: string) => {
    const rel = path.relative(o, i);
    return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
  };
  return (
    within(path.resolve(outer), path.resolve(inner)) || within(realpathLenient(outer), realpathLenient(inner))
  );
}

/** One of the two holds the other (a denied folder inside a run's folder, or a run's folder inside a denied one). */
function touches(denied: string, dir: string): boolean {
  return isUnder(denied, dir) || isUnder(dir, denied);
}
