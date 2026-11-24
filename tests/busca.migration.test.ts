import fs from "node:fs";
import path from "node:path";
import type Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { AppContext } from "../apps/api/src/context.js";
import { buildServer } from "../apps/api/src/server.js";
import { MIGRATIONS, openDb } from "@mordomo/core/internal";
import { makeTempHome } from "./helpers.js";

/**
 * .specs/features/cerebro-busca-significado, S3, door 1: migration 34 `section-vectors` over a populated database at 33.
 */

describe("C30 migration 34 over a database at 33", () => {
  it("C30 file_vectors goes, section_vectors comes empty, the other rows stay byte for byte, the status reads 0 and 0, the next pass fills it, and nothing is applied again", async () => {
    // cerebro-entidades-resumos added migration 35 after this one: a home at 33 migrates to it in the same pass
    expect(MIGRATIONS.find((m) => m.version === 34)).toMatchObject({ version: 34, name: "section-vectors" });
    const temp = makeTempHome("mordomo-busca-c30-");
    try {
      // a database at 33, with an index, its per-file vectors and the rows of other features
      const old = openDb(
        temp.paths,
        MIGRATIONS.filter((m) => m.version <= 33),
      ).db;
      expect(old.pragma("user_version", { simple: true })).toBe(33);
      const id = Number(
        old
          .prepare(
            "INSERT INTO files (root, path, rel, name, ext, dir, area, size, mtime, indexed_at, title, tags, fields) VALUES ('/r', '/r/a.md', 'a.md', 'a.md', '.md', '/r', NULL, 3, 5, 7, 'A', '[]', '{}')",
          )
          .run().lastInsertRowid,
      );
      old
        .prepare(
          "INSERT INTO note_links (src_id, kind, target, label, line) VALUES (?, 'wikilink', 'b', NULL, 2)",
        )
        .run(id);
      old
        .prepare(
          "INSERT INTO loop_decisions (key, text, action, week, target, decided_at) VALUES ('k', 't', 'keep', '2026-11-09', NULL, 1)",
        )
        .run();
      old
        .prepare(
          "INSERT INTO weekly_reviews (week, archived, finished_at, counts) VALUES ('2026-11-09', 1, 2, '{}')",
        )
        .run();
      old
        .prepare(
          "INSERT INTO file_vectors (file_id, provider, dim, vec, mtime, size) VALUES (?, 'hash-v1:256', 256, ?, 5, 3)",
        )
        .run(id, Buffer.alloc(1024, 1));
      expect(old.prepare("SELECT COUNT(*) AS n FROM file_vectors").get()).toEqual({ n: 1 });
      const snapshot = (db: Database.Database) =>
        ["files", "note_links", "loop_decisions", "weekly_reviews"].map((t) =>
          db.prepare(`SELECT * FROM ${t} ORDER BY rowid`).all(),
        );
      const before = snapshot(old);
      old.close();

      const { db, migration } = openDb(temp.paths);
      try {
        expect(migration).toMatchObject({ fromVersion: 33, toVersion: 35 });
        expect(
          db.prepare("SELECT name FROM sqlite_master WHERE name = 'file_vectors'").get(),
        ).toBeUndefined();
        expect(db.prepare("SELECT type FROM sqlite_master WHERE name = 'section_vectors'").get()).toEqual({
          type: "table",
        });
        expect(db.prepare("SELECT COUNT(*) AS n FROM section_vectors").get()).toEqual({ n: 0 });
        expect(snapshot(db)).toEqual(before);
      } finally {
        db.close();
      }

      // the status reads 0 and 0, and the next pass fills the table
      const ctx = new AppContext(temp.paths.home);
      const app = await buildServer(ctx);
      try {
        const settings = ctx.settings();
        settings.setupCompleted = true;
        settings.memory.embeddings = { ...settings.memory.embeddings, enabled: true, provider: "hash" };
        ctx.settingsStore.save(settings);
        fs.mkdirSync(ctx.paths.memory, { recursive: true });
        fs.writeFileSync(
          path.join(ctx.paths.memory, "nota.md"),
          "# Nota\n\n## Um\nprimeiro\n## Dois\nsegundo\n",
        );
        const headers = { "x-mordomo-token": ctx.token() };
        const read = async () => (await app.inject({ url: "/api/memory/status", headers })).json().semantic;
        expect(await read()).toMatchObject({ vectors: 0, sections: 0 });
        await ctx.indexer.indexAllAsync();
        expect(
          ctx.db.prepare("SELECT ord, heading FROM section_vectors ORDER BY file_id, ord").all(),
        ).toEqual([
          { ord: 0, heading: "Nota > Um" },
          { ord: 1, heading: "Nota > Dois" },
        ]);
        expect(await read()).toMatchObject({ vectors: 1, sections: 2 });
      } finally {
        await app.close();
        ctx.close();
      }

      // opening the database again applies nothing
      const again = openDb(temp.paths);
      try {
        expect(again.migration).toEqual({ fromVersion: 35, toVersion: 35, backupPath: null });
      } finally {
        again.db.close();
      }
    } finally {
      temp.cleanup();
    }
  });
});
