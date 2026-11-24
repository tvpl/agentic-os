import fs from "node:fs";
import path from "node:path";
import { vi } from "vitest";
import { ClaudeAdapter } from "@mordomo/adapter-claude";
import type { AgentRun } from "@mordomo/core";
import { seedHome } from "@mordomo/core/internal";
import { FAKE_BIN, withFakeBinPath } from "../helpers.js";
import { memoriaWorld, type Json, type MemoriaWorld } from "./memoriaWorld.js";

/**
 * The world of `.specs/features/cerebro-entidades-resumos` batch D (S8, doors 9 and 10): a real home and a server over it
 * (`memoriaWorld`, with owner, device and run credentials), seeded from the bundle (the skill `brain-entities` is one of
 * the seeds), whose Claude provider is the fake CLI; an indexed folder of notes. The test writes what a batch's run
 * leaves in `artifacts/<run>/entities.json`, as the summaries' world does (the C6b and C10 precedent).
 */

export type { Json };

const repo = path.resolve(import.meta.dirname, "..", "..");

/** The fixed clock of the checks: 2026-11-24 10:00 local. */
export const NOW = new Date(2026, 10, 24, 10, 0, 0).getTime();
export const HOUR = 3_600_000;
export const MINUTE = 60_000;

export interface SugestoesWorld extends MemoriaWorld {
  /** The indexed folder of notes. */
  notas: string;
  /** Write a note, its `mtime` at `mtime` (ms) when given. */
  note: (file: string, text: string, mtime?: number) => string;
  /** What the next runs write to `artifacts/<run>/entities.json` (null: nothing); a string or bytes as they are. */
  entities: (content: unknown) => void;
  start: (headers?: Record<string, string>) => Promise<{ status: number; body: Json }>;
  list: (headers?: Record<string, string>) => Promise<{ status: number; body: Json }>;
  correct: (body: Json, headers?: Record<string, string>) => Promise<{ status: number; body: Json }>;
  /** Start a batch that writes `content`, and wait for its run; answers the run's id. */
  batch: (content: unknown) => Promise<string>;
  /** Wait for a run to end. */
  settle: (runId: string) => Promise<void>;
  /** The runs of `brain-entities`, newest first. */
  batchRuns: () => Array<{ id: string; inputs: Record<string, string>; startedBy: string | null }>;
  runCount: () => number;
  /** Switch `memory.entities.llm.enabled`. */
  llm: (on: boolean) => void;
  /** The skill's SKILL.md in the home. */
  skillFile: () => string;
}

export async function sugestoesWorld(prefix: string): Promise<SugestoesWorld> {
  const restorePath = withFakeBinPath();
  const w = await memoriaWorld(prefix);
  seedHome(w.ctx.paths, repo);
  w.update((s) => {
    s.providers.claude.enabled = true;
    s.providers.claude.binaryPath = path.join(FAKE_BIN, "claude");
    s.defaultProvider = "claude";
  });
  w.ctx.reloadAdapters();
  const notas = w.indexedRoot("notas");
  let content: unknown = null;
  const write = (runId: string, value: unknown) => {
    const dir = path.join(w.ctx.paths.artifacts, runId);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, "entities.json"),
      typeof value === "string" || Buffer.isBuffer(value) ? value : JSON.stringify(value),
    );
  };
  const execute = ClaudeAdapter.prototype.execute;
  const spy = vi.spyOn(ClaudeAdapter.prototype, "execute").mockImplementation(function (
    this: ClaudeAdapter,
    run: AgentRun,
  ) {
    if (content !== null) write(run.runId, content);
    return execute.call(this, run);
  });
  const close = w.close;
  const start = (headers?: Record<string, string>) =>
    w.call("POST", "/api/memory/entities/suggestions", undefined, headers);
  const settle = async (runId: string) => {
    await w.ctx.execution.wait(runId);
  };
  return Object.assign(w, {
    notas,
    note(file: string, text: string, mtime?: number) {
      w.put(file, text);
      if (mtime !== undefined) fs.utimesSync(file, mtime / 1000, mtime / 1000);
      return file;
    },
    entities(next: unknown) {
      content = next;
    },
    start,
    list: (headers?: Record<string, string>) =>
      w.call("GET", "/api/memory/entities/suggestions", undefined, headers),
    correct: (body: Json, headers?: Record<string, string>) =>
      w.call("POST", "/api/memory/entities/corrections", body, headers),
    async batch(next: unknown) {
      content = next;
      const res = await start();
      if (res.status !== 202) throw new Error(`batch not started: ${res.status} ${JSON.stringify(res.body)}`);
      await settle(res.body.id);
      return res.body.id as string;
    },
    settle,
    batchRuns: () =>
      w.ctx.runs
        .list({ limit: 200 })
        .filter((r) => r.skillSlug === "brain-entities")
        .map((r) => ({
          id: r.id,
          inputs: r.request?.kind === "skill" ? r.request.inputs : {},
          startedBy: r.startedBy,
        })),
    runCount: () => (w.ctx.db.prepare("SELECT COUNT(*) c FROM runs").get() as { c: number }).c,
    llm(on: boolean) {
      w.update((s) => {
        s.memory.entities.llm.enabled = on;
      });
    },
    skillFile: () => path.join(w.ctx.paths.skills, "brain-entities", "SKILL.md"),
    async close() {
      spy.mockRestore();
      await w.ctx.runs.shutdown(2000);
      await close();
      restorePath();
    },
  });
}

/** One suggestion as `entities.json` holds it. */
export const suggestion = (
  kind: string,
  name: string,
  evidence: Array<[string, number]>,
  extra: Json = {},
): Json => ({
  kind,
  name,
  ...extra,
  evidence: evidence.map(([p, line]) => ({ path: p, line })),
});
