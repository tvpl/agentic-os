import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { createBackup, listBackups, openDb, events } from "@mordomo/core";
import { makeTempHome } from "./helpers.js";

describe("backup", () => {
  it("captures rows that only live in the WAL (online backup, no checkpoint)", async () => {
    const { paths, cleanup } = makeTempHome();
    const db = openDb(paths).db;
    try {
      db.pragma("wal_autocheckpoint = 0"); // keep everything in the WAL, as a busy service would
      const insert = db.prepare("INSERT INTO meta (key, value) VALUES (?, ?)");
      db.transaction(() => {
        for (let i = 0; i < 50; i++) insert.run(`k${i}`, "x".repeat(2000));
      })();
      const wal = fs.statSync(paths.dbFile + "-wal");
      expect(wal.size).toBeGreaterThan(0);

      const created: unknown[] = [];
      const off = events.subscribe((e) => e.type === "backup.created" && created.push(e.payload));
      const info = await createBackup(paths, db);
      off();
      expect(created).toHaveLength(1);
      expect(listBackups(paths)[0]?.name).toBe(info.name);

      const copy = new Database(path.join(info.path, "config", "db", "mordomo.db"), { readonly: true });
      try {
        const count = (copy.prepare("SELECT COUNT(*) c FROM meta").get() as { c: number }).c;
        expect(count).toBe(50);
        expect(copy.pragma("user_version", { simple: true })).toBe(db.pragma("user_version", { simple: true }));
      } finally {
        copy.close();
      }
      // The live database is untouched and still serving.
      expect((db.prepare("SELECT COUNT(*) c FROM meta").get() as { c: number }).c).toBe(50);
    } finally {
      db.close();
      cleanup();
    }
  });

  it("includes artifacts only when asked", async () => {
    const { paths, cleanup } = makeTempHome();
    const db = openDb(paths).db;
    try {
      fs.mkdirSync(path.join(paths.artifacts, "r1"), { recursive: true });
      fs.writeFileSync(path.join(paths.artifacts, "r1", "out.md"), "hi");
      const plain = await createBackup(paths, db);
      expect(fs.existsSync(path.join(plain.path, "artifacts"))).toBe(false);
      const full = await createBackup(paths, db, { includeArtifacts: true });
      expect(fs.existsSync(path.join(full.path, "artifacts", "r1", "out.md"))).toBe(true);
    } finally {
      db.close();
      cleanup();
    }
  });
});
