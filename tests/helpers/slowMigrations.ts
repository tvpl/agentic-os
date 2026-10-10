import type { Migration } from "@mordomo/core";

/** Block this thread for `ms` (a migration that takes a while, so processes opening together overlap). */
export function sleepSync(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/**
 * Three migrations for the migration-race proofs. Each records itself in `ran`; the second uses a plain
 * `CREATE TABLE`, which fails when a second process runs it again, and the second and third take 250 ms.
 */
export function slowMigrations(options: { failAt3?: boolean } = {}): Migration[] {
  return [
    {
      version: 1,
      name: "base",
      sql: "CREATE TABLE ran (v INTEGER NOT NULL); INSERT INTO ran VALUES (1);",
    },
    {
      version: 2,
      name: "second",
      sql: "CREATE TABLE second (x INTEGER);",
      up(db) {
        sleepSync(250);
        db.exec("INSERT INTO ran VALUES (2)");
      },
    },
    {
      version: 3,
      name: "third",
      up(db) {
        sleepSync(250);
        db.exec("CREATE TABLE third (x INTEGER)");
        if (options.failAt3) throw new Error("boom-migration");
        db.exec("INSERT INTO ran VALUES (3)");
      },
    },
  ];
}
