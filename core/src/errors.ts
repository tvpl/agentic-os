/**
 * The codes the engine's own rules answer with, stable enough to branch on. An error that names no code carries only
 * its `statusCode` (404 "Skill not found", 400 "Skill is disabled"): the HTTP API maps those to its generic codes.
 */
export const ENGINE_ERROR_CODES = [
  "profile_refused",
  "unknown_provider",
  "device_provider_refused",
  "self_approval",
  "owner_only",
  "submission_conflict",
  "submission_uncertain",
  "budget_exhausted",
  "request_unavailable",
  "skill_unavailable",
  "workspace_unavailable",
  "engine_locked",
  "approval_expired",
  "approval_resolved",
] as const;

/** One of `ENGINE_ERROR_CODES`. */
export type EngineErrorCode = (typeof ENGINE_ERROR_CODES)[number];

/**
 * A rule of the engine said no. `statusCode` is the HTTP status the API answers with (the library caller may ignore
 * it); `code` is set when the rule has a stable name (`ENGINE_ERROR_CODES`).
 */
export class MordomoError extends Error {
  readonly statusCode: number;
  readonly code?: EngineErrorCode;

  constructor(statusCode: number, message: string, code?: EngineErrorCode) {
    super(message);
    this.name = "MordomoError";
    this.statusCode = statusCode;
    if (code !== undefined) this.code = code;
  }
}

/** `start()` found another live process owning this home. */
export class EngineLockedError extends Error {
  readonly code = "engine_locked";
  constructor(
    readonly holderPid: number | null,
    detail?: string,
  ) {
    super(
      detail ??
        (holderPid === null
          ? "Another MordomoOS engine owns this home."
          : `Another MordomoOS engine (pid ${holderPid}) owns this home.`),
    );
    this.name = "EngineLockedError";
  }
}

/**
 * Something holds the home in a way that must not overlap what was asked: a restore (or the undoing of one that
 * died), or - for a restore - a backup or a process that is starting.
 */
export class RestoreInProgressError extends Error {
  readonly code = "restore_in_progress";
  /** What an API answers. */
  readonly statusCode = 409;
  constructor() {
    super(
      "A restore is in progress, or the home is held by something that must not overlap one (a backup, a process " +
        "that is starting): config/run/restore.lock is taken. Try again when it has finished.",
    );
    this.name = "RestoreInProgressError";
  }
}

/**
 * A save was refused because the file is not the one the caller read: its bytes hash to something other than the
 * version the caller holds (`writeWorkspaceFile`'s `expectSha256`). Nothing was written.
 */
export class EditConflictError extends Error {
  readonly code = "edit_conflict";
  /** What an API answers. */
  readonly statusCode = 409;
  constructor() {
    super("The file changed after it was read. Nothing was written; read it again and merge.");
    this.name = "EditConflictError";
  }
}

/** A path is outside what the engine may touch: not in the home or an indexed folder, or in `config/` or `logs/`. */
export class PathAccessError extends Error {
  /** HTTP status the API should map this to. */
  readonly statusCode = 403;
  constructor(
    public readonly attempted: string,
    message?: string,
  ) {
    super(message ?? `Path is outside the granted folders: ${attempted}`);
    this.name = "PathAccessError";
  }
}
