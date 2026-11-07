import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, vi } from "vitest";
import type { FastifyInstance } from "fastify";
import type { AgentRun } from "@mordomo/core";
import { seedHome } from "@mordomo/core/internal";
import { ClaudeAdapter } from "@mordomo/adapter-claude";
import { AppContext } from "../../apps/api/src/context.js";
import { buildServer } from "../../apps/api/src/server.js";
import type { Settings } from "../../core/src/config/schema.js";
import { FAKE_BIN, makeTempHome, withFakeBinPath } from "../helpers.js";

/**
 * The world of `.specs/features/cerebro-organizar` batch A: a real home seeded with the shipped skills (so
 * `organize-brain` is the file in `skills/organize-brain/`), an indexed folder outside the home, the three providers
 * pointed at the fake CLIs, and a server over it. What the agent is handed is read where the engine hands it over, at
 * the Claude adapter, which then runs the fake CLI.
 */

export const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
export type Json = Record<string, any>;

export interface OrganizeWorld {
  ctx: AppContext;
  app: FastifyInstance;
  home: string;
  /** The indexed folder (a real path outside the home). */
  work: string;
  /** A folder outside every indexed folder and outside the home. */
  outside: string;
  /** What the Claude adapter was handed, by run id. */
  handed: Map<string, AgentRun>;
  owner: () => Record<string, string>;
  call: (
    method: string,
    url: string,
    payload?: unknown,
    headers?: Record<string, string>,
  ) => Promise<{ status: number; body: Json }>;
  /** A fresh folder under `base` (the indexed folder by default). */
  dir: (name: string, base?: string) => string;
  put: (file: string, text: string) => string;
  update: (change: (s: Settings) => void) => void;
  runCount: () => number;
  /** Wait for a started run, then give back its record and what its agent was handed (undefined: never handed). */
  finished: (runId: string) => Promise<{ run: Json; agent: AgentRun | undefined }>;
  close: () => Promise<void>;
}

export async function organizeWorld(prefix: string): Promise<OrganizeWorld> {
  const restorePath = withFakeBinPath();
  const temp = makeTempHome(prefix);
  const work = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), `${prefix}work-`)));
  const outside = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), `${prefix}outside-`)));
  seedHome(temp.paths, repoRoot);
  const ctx = new AppContext(temp.paths.home);
  const settings = ctx.settings();
  settings.setupCompleted = true;
  settings.securityProfile = "controlled_write";
  settings.indexedFolders = [{ path: work, area: "Projetos", enabled: true }];
  settings.providers.claude.enabled = true;
  settings.providers.claude.binaryPath = path.join(FAKE_BIN, "claude");
  settings.providers.codex.enabled = true;
  settings.providers.codex.binaryPath = path.join(FAKE_BIN, "codex");
  settings.providers.cursor.enabled = true;
  settings.providers.cursor.binaryPath = path.join(FAKE_BIN, "cursor-agent");
  ctx.settingsStore.save(settings);
  ctx.reloadAdapters();
  const app = await buildServer(ctx);
  const token = ctx.token();
  const handed = new Map<string, AgentRun>();
  const execute = ClaudeAdapter.prototype.execute;
  vi.spyOn(ClaudeAdapter.prototype, "execute").mockImplementation(function (
    this: ClaudeAdapter,
    run: AgentRun,
  ) {
    handed.set(run.runId, run);
    return execute.call(this, run);
  });
  const owner = () => ({ "x-mordomo-token": token, "content-type": "application/json" });
  let seq = 0;
  const world: OrganizeWorld = {
    ctx,
    app,
    home: temp.paths.home,
    work,
    outside,
    handed,
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
    dir(name, base = work) {
      const full = path.join(base, `${name}-${++seq}`);
      fs.mkdirSync(full, { recursive: true });
      return full;
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
      ctx.reloadAdapters();
    },
    runCount: () => (ctx.db.prepare("SELECT COUNT(*) c FROM runs").get() as { c: number }).c,
    async finished(runId) {
      await ctx.execution.wait(runId);
      const record = await world.call("GET", `/api/runs/${runId}`);
      expect(record.status, JSON.stringify(record.body)).toBe(200);
      return { run: record.body.run as Json, agent: handed.get(runId) };
    },
    async close() {
      vi.restoreAllMocks();
      await ctx.runs.shutdown(2000);
      await app.close();
      ctx.close();
      temp.cleanup();
      restorePath();
      fs.rmSync(work, { recursive: true, force: true });
      fs.rmSync(outside, { recursive: true, force: true });
    },
  };
  return world;
}
