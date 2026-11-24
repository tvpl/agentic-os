import path from "node:path";
import { describe, expect, it } from "vitest";
import { notesViewWorld, type Json } from "./helpers/notesViewWorld.js";

/**
 * .specs/features/cerebro-entidades-resumos, batch A, S1 by audience at the boundary: the term threshold counts the files
 * the caller's audience sees (AC 16). The rest of S3's audience rules are batch B's.
 */

describe("C16 the term threshold over the audience's files", () => {
  it("C16 a term in 2 files is an entity for the owner; for a device that sees 1 of the 2 files it is not", async () => {
    const w = await notesViewWorld("mordomo-entidades-access-");
    try {
      const root = w.indexedRoot("acervo");
      const hidden = path.join(root, "sigilo");
      w.put(path.join(root, "aberta.md"), "Reunião com Banco Central hoje.\n");
      w.put(path.join(hidden, "fechada.md"), "Visita ao Banco Central ontem.\n");
      w.update((s) => {
        s.folderAccess = [{ path: hidden, agents: "read", devices: "hide" }];
      });
      await w.index();
      const keysOf = (body: Json) => body.items.map((e: Json) => [e.key, e.files]);

      const owner = await w.call("GET", "/api/memory/entities");
      expect(owner.status).toBe(200);
      expect(keysOf(owner.body)).toEqual([["termo:banco central", 2]]);

      const device = w.device(["content"]);
      const seen = await w.call("GET", "/api/memory/entities", undefined, device);
      expect(seen.status, JSON.stringify(seen.body)).toBe(200);
      expect(keysOf(seen.body)).toEqual([]);
      expect(seen.body.total).toBe(0);

      // the same device with the folder shown again sees the two files
      w.update((s) => {
        s.folderAccess = [];
      });
      const again = await w.call("GET", "/api/memory/entities", undefined, device);
      expect(keysOf(again.body)).toEqual([["termo:banco central", 2]]);
    } finally {
      await w.close();
    }
  });
});
