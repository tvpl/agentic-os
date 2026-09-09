import { describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { createBackup, listBackups, restoreBackup, openDb, events } from "@mordomo/core";
import { makeTempHome } from "./helpers.js";

describe("backup", () => {
  it.each(["copy", "publish"])("preserves live files when restore fails during %s", async (phase) => {
    const { paths, cleanup } = makeTempHome();
    const db = openDb(paths).db;
    const file = path.join(paths.memory, "kept.md");
    try {
      fs.writeFileSync(file, "backup contents");
      const snapshot = await createBackup(paths, db);
      fs.writeFileSync(file, "current contents");
      db.close();
      const copy = fs.cpSync.bind(fs);
      const rename = fs.renameSync.bind(fs);
      let failed = false;
      if (phase === "copy")
        vi.spyOn(fs, "cpSync").mockImplementation((source, dest, options) => {
          if (!failed && String(dest).includes(".restore-") && String(dest).endsWith("new-1")) {
            failed = true;
            throw new Error("Injected disk full");
          }
          copy(source, dest, options);
        });
      else
        vi.spyOn(fs, "renameSync").mockImplementation((source, dest) => {
          if (!failed && String(source).includes(".restore-") && String(source).endsWith("new-1")) {
            failed = true;
            throw new Error("Injected publish failure");
          }
          rename(source, dest);
        });
      expect(() => restoreBackup(paths, snapshot.name)).toThrow(/Injected/);
      expect(failed).toBe(true);
      expect(fs.readFileSync(file, "utf8")).toBe("current contents");
      const reopened = openDb(paths).db;
      expect(reopened.pragma("quick_check", { simple: true })).toBe("ok");
      reopened.close();
    } finally {
      vi.restoreAllMocks();
      if (db.open) db.close();
      cleanup();
    }
  });

  it.each(["missing", "corrupt"])(
    "rejects a %s database before restoring any live files",
    async (failure) => {
      const { paths, cleanup } = makeTempHome();
      const db = openDb(paths).db;
      const file = path.join(paths.memory, "kept.md");
      try {
        fs.writeFileSync(file, "snapshot");
        const snapshot = await createBackup(paths, db);
        fs.writeFileSync(file, "current");
        db.close();
        const database = path.join(snapshot.path, "config", "db", "mordomo.db");
        if (failure === "missing") fs.unlinkSync(database);
        else fs.writeFileSync(database, "not a database");
        expect(() => restoreBackup(paths, snapshot.name)).toThrow(/invalid backup database/i);
        expect(fs.readFileSync(file, "utf8")).toBe("current");
        const reopened = openDb(paths).db;
        expect(reopened.pragma("quick_check", { simple: true })).toBe("ok");
        reopened.close();
        expect(listBackups(paths)).toHaveLength(1);
      } finally {
        if (db.open) db.close();
        cleanup();
      }
    },
  );

  it("rejects traversal and symlink backup sources before touching live data", () => {
    const { paths, cleanup } = makeTempHome();
    try {
      const outside = path.join(paths.home, "outside");
      fs.mkdirSync(outside);
      fs.symlinkSync(outside, path.join(paths.backups, "full-link"));
      expect(() => restoreBackup(paths, "../outside")).toThrow("Backup not found");
      expect(() => restoreBackup(paths, "full-link")).toThrow("Backup not found");
      expect(fs.readdirSync(paths.backups)).toEqual(["full-link"]);
    } finally {
      cleanup();
    }
  });

  it("does not collide when two snapshots start in the same millisecond", async () => {
    const { paths, cleanup } = makeTempHome();
    const db = openDb(paths).db;
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-09-06T12:00:00.000Z"));
    try {
      const first = await createBackup(paths, db);
      const second = await createBackup(paths, db);
      expect(second.name).not.toBe(first.name);
      expect(listBackups(paths)).toHaveLength(2);
    } finally {
      vi.useRealTimers();
      db.close();
      cleanup();
    }
  });

  it("does not publish an incomplete backup when the database copy fails", async () => {
    const { paths, cleanup } = makeTempHome();
    const db = openDb(paths).db;
    try {
      vi.spyOn(db, "backup").mockRejectedValueOnce(new Error("fixture disk failure"));
      await expect(createBackup(paths, db)).rejects.toThrow("fixture disk failure");
      expect(listBackups(paths)).toHaveLength(0);
    } finally {
      db.close();
      cleanup();
    }
  });

  it("restores included artifacts and captures their previous state in the safety backup", async () => {
    const { paths, cleanup } = makeTempHome();
    const db = openDb(paths).db;
    try {
      const file = path.join(paths.artifacts, "drawing.md");
      fs.writeFileSync(file, "original");
      const snapshot = await createBackup(paths, db, { includeArtifacts: true });
      fs.writeFileSync(file, "later");
      db.close();
      const result = restoreBackup(paths, snapshot.name);
      expect(fs.readFileSync(file, "utf8")).toBe("original");
      expect(fs.readFileSync(path.join(result.safetyBackup.path, "artifacts", "drawing.md"), "utf8")).toBe(
        "later",
      );
    } finally {
      if (db.open) db.close();
      cleanup();
    }
  });

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
        expect(copy.pragma("user_version", { simple: true })).toBe(
          db.pragma("user_version", { simple: true }),
        );
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
