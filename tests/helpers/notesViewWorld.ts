import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { FastifyInstance } from "fastify";
import { AppContext } from "../../apps/api/src/context.js";
import { buildServer } from "../../apps/api/src/server.js";
import type { Settings } from "../../core/src/config/schema.js";
import { makeTempHome } from "../helpers.js";

/**
 * The world of `.specs/features/cerebro-vista-notas` batch A: a real home, a server over it, and folders outside the
 * home that a test indexes as it needs. The test's own eyes on the disk are `fs`; the engine's are the routes.
 */

export type Json = Record<string, any>;

export interface NotesViewWorld {
  ctx: AppContext;
  app: FastifyInstance;
  home: string;
  memory: string;
  owner: () => Record<string, string>;
  call: (
    method: string,
    url: string,
    payload?: unknown,
    headers?: Record<string, string>,
  ) => Promise<{ status: number; body: Json }>;
  /** A new folder outside the home (a real path), removed at the end. */
  outside: (name: string) => string;
  /** A new enabled indexed folder outside the home. */
  indexedRoot: (name: string) => string;
  put: (file: string, text: string | Buffer) => string;
  update: (change: (s: Settings) => void) => void;
  index: () => Promise<unknown>;
  /** A row of `files` as an index pass would have written it (a stale row, or one a pass would not write). */
  row: (
    root: string,
    rel: string,
    extra?: { title?: string | null; mtime?: number; fields?: Record<string, string> },
  ) => number;
  /** A paired device's headers, holding these scopes. */
  device: (scopes: Array<"content" | "monitor" | "run" | "approve">) => Record<string, string>;
  close: () => Promise<void>;
}

export const sha = (bytes: string | Buffer): string =>
  `sha256:${crypto.createHash("sha256").update(bytes).digest("hex")}`;

export async function notesViewWorld(prefix: string): Promise<NotesViewWorld> {
  const temp = makeTempHome(prefix);
  const ctx = new AppContext(temp.paths.home);
  const settings = ctx.settings();
  settings.setupCompleted = true;
  settings.remote.enabled = true;
  settings.indexedFolders = [];
  ctx.settingsStore.save(settings);
  const app = await buildServer(ctx);
  const token = ctx.token();
  const owner = () => ({ "x-mordomo-token": token, "content-type": "application/json" });
  const made: string[] = [];
  let pairings = 0;
  const world: NotesViewWorld = {
    ctx,
    app,
    home: temp.paths.home,
    memory: temp.paths.memory,
    owner,
    async call(method, url, payload, headers = owner()) {
      const { "content-type": type, ...bare } = headers;
      const res = await app.inject({
        method: method as "GET",
        url,
        headers: payload !== undefined ? { ...bare, "content-type": type ?? "application/json" } : bare,
        ...(payload !== undefined ? { payload: payload as Json } : {}),
      });
      return { status: res.statusCode, body: (res.body ? res.json() : null) as Json };
    },
    outside(name) {
      const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), `${prefix}${name}-`)));
      made.push(dir);
      return dir;
    },
    indexedRoot(name) {
      const dir = world.outside(name);
      world.update((s) => {
        s.indexedFolders = [...s.indexedFolders, { path: dir, area: null, enabled: true }];
      });
      return dir;
    },
    put(file, text) {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, text);
      return file;
    },
    update(change) {
      const s = ctx.settings();
      change(s);
      ctx.settingsStore.save(s);
    },
    index: () => ctx.indexer.indexAllAsync(),
    row(root, rel, extra = {}) {
      const full = path.join(root, rel);
      const info = ctx.db
        .prepare(
          "INSERT INTO files (root, path, rel, name, ext, dir, area, size, mtime, indexed_at, title, tags, fields) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .run(
          root,
          full,
          rel,
          path.basename(full),
          path.extname(full),
          path.dirname(full),
          null,
          1,
          extra.mtime ?? 1,
          1,
          extra.title ?? null,
          "[]",
          JSON.stringify(extra.fields ?? {}),
        );
      return Number(info.lastInsertRowid);
    },
    device(scopes) {
      const name = `notes-view-${++pairings}`;
      const { code } = ctx.devices.startPairing(name, scopes);
      return { "x-mordomo-token": ctx.devices.claim(code, name)!.token, "content-type": "application/json" };
    },
    async close() {
      await app.close();
      ctx.close();
      temp.cleanup();
      for (const dir of made) fs.rmSync(dir, { recursive: true, force: true });
    },
  };
  return world;
}
