// The errors of opening and migrating the database. They live apart from `db.ts` so that code which only names them
// (the public entry point of the package) does not pull in the types of the SQLite driver.

/** The database was written by a newer MordomoOS than this one: nothing was changed. */
export class DbNewerVersionError extends Error {
  readonly code = "db_newer";
  constructor(
    readonly found: number,
    readonly supported: number,
  ) {
    super(
      `This database is at schema version ${found}, newer than the ${supported} this MordomoOS understands. ` +
        "Use that version or restore a compatible backup.",
    );
    this.name = "DbNewerVersionError";
  }
}

/** A migration threw: the whole run was rolled back and the database is at `fromVersion`. */
export class MigrationError extends Error {
  readonly code = "db_migration_failed";
  constructor(
    readonly version: number,
    readonly migration: string,
    readonly fromVersion: number,
    readonly backupPath: string | null,
    cause: unknown,
  ) {
    super(
      `Migration ${version} "${migration}" failed: ${cause instanceof Error ? cause.message : String(cause)}. ` +
        `Everything this run changed was rolled back; the database is still at version ${fromVersion}.` +
        (backupPath ? ` A copy of it from before this attempt is at ${backupPath}.` : ""),
      { cause },
    );
    this.name = "MigrationError";
  }
}
