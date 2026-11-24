import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { vi } from "vitest";
import { ClaudeAdapter } from "@mordomo/adapter-claude";
import type { AgentRun } from "@mordomo/core";
import { seedHome } from "@mordomo/core/internal";
import { FAKE_BIN, withFakeBinPath } from "../helpers.js";
import { memoriaWorld, type Json, type MemoriaWorld } from "./memoriaWorld.js";

/**
 * The world of `.specs/features/cerebro-entidades-resumos` batch C (S5, door 6): a real home and a server over it
 * (`memoriaWorld`, with owner, device and run credentials), seeded from the bundle (the skill `brain-summarize` is one of
 * the seeds), whose Claude provider is the fake CLI; an indexed folder whose area is `Projetos`. The test writes what a
 * run leaves in `artifacts/<run>/summary.json`, as the ask's world does (the C6b and C10 precedent).
 */

export type { Json };

const repo = path.resolve(import.meta.dirname, "..", "..");

export interface ResumosWorld extends MemoriaWorld {
  /** The indexed folder of the area `Projetos`. */
  projetos: string;
  /** A new enabled indexed folder of `area`. */
  areaRoot: (name: string, area: string) => string;
  /** Write a note, its `mtime` at `mtime` (ms) when given. */
  note: (file: string, text: string, mtime?: number) => string;
  /** What the next runs write to `artifacts/<run>/summary.json` (null: nothing); a string or bytes as they are. */
  summary: (content: unknown) => void;
  /** Make the next runs fail (the fake CLI exits 1). */
  failing: (on: boolean) => void;
  start: (scope: Json, headers?: Record<string, string>) => Promise<{ status: number; body: Json }>;
  read: (
    kind: string,
    id: string,
    headers?: Record<string, string>,
  ) => Promise<{ status: number; body: Json }>;
  list: (headers?: Record<string, string>) => Promise<{ status: number; body: Json }>;
  /** Wait for a run to end. */
  settle: (runId: string) => Promise<void>;
  /** Start a summary of `scope` that writes `content`, and wait for its run; answers the run's id. */
  summarize: (scope: Json, content: unknown) => Promise<string>;
  runCount: () => number;
  /** A row of `runs` of `brain-summarize` as the run manager leaves it. */
  runRow: (row: { id: string; status: string; createdAt: number; finishedAt?: number | null }) => void;
  /** A row of `summary_runs`. */
  summaryRow: (row: {
    runId: string;
    kind: string;
    id: string;
    sources: Array<{ path: string; size: number; mtime: number; sha256: string }>;
    startedAt: number;
  }) => void;
  /** Write `content` as the summary of a run that already exists. */
  writeSummary: (runId: string, content: unknown) => void;
  /** The skill's SKILL.md in the home. */
  skillFile: () => string;
}

export const sha256Hex = (bytes: string | Buffer): string =>
  crypto.createHash("sha256").update(bytes).digest("hex");

/** A source as `summary_runs` records it, read from the disk by the test. */
export function recordedSource(file: string): { path: string; size: number; mtime: number; sha256: string } {
  const stat = fs.statSync(file);
  return {
    path: file,
    size: stat.size,
    mtime: Math.floor(stat.mtimeMs),
    sha256: sha256Hex(fs.readFileSync(file)),
  };
}

export async function resumosWorld(prefix: string): Promise<ResumosWorld> {
  const restorePath = withFakeBinPath();
  const w = await memoriaWorld(prefix);
  seedHome(w.ctx.paths, repo);
  w.update((s) => {
    s.providers.claude.enabled = true;
    s.providers.claude.binaryPath = path.join(FAKE_BIN, "claude");
    s.defaultProvider = "claude";
  });
  w.ctx.reloadAdapters();
  const areaRoot = (name: string, area: string) => {
    const dir = w.outside(name);
    w.update((s) => {
      s.indexedFolders = [...s.indexedFolders, { path: dir, area, enabled: true }];
    });
    return dir;
  };
  const projetos = areaRoot("projetos", "Projetos");
  let content: unknown = null;
  const write = (runId: string, value: unknown) => {
    const dir = path.join(w.ctx.paths.artifacts, runId);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, "summary.json"),
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
  const start = (scope: Json, headers?: Record<string, string>) =>
    w.call("POST", "/api/memory/summaries", { scope }, headers);
  const settle = async (runId: string) => {
    await w.ctx.execution.wait(runId);
  };
  return Object.assign(w, {
    projetos,
    areaRoot,
    note(file: string, text: string, mtime?: number) {
      w.put(file, text);
      if (mtime !== undefined) fs.utimesSync(file, mtime / 1000, mtime / 1000);
      return file;
    },
    summary(next: unknown) {
      content = next;
    },
    failing(on: boolean) {
      if (on) process.env.FAKE_CLAUDE_FAIL = "1";
      else delete process.env.FAKE_CLAUDE_FAIL;
    },
    start,
    read: (kind: string, id: string, headers?: Record<string, string>) =>
      w.call("GET", `/api/memory/summaries/${kind}/${encodeURIComponent(id)}`, undefined, headers),
    list: (headers?: Record<string, string>) => w.call("GET", "/api/memory/summaries", undefined, headers),
    settle,
    async summarize(scope: Json, next: unknown) {
      content = next;
      const res = await start(scope);
      if (res.status !== 202)
        throw new Error(`summary not started: ${res.status} ${JSON.stringify(res.body)}`);
      await settle(res.body.id);
      return res.body.id as string;
    },
    runCount: () => (w.ctx.db.prepare("SELECT COUNT(*) c FROM runs").get() as { c: number }).c,
    runRow(row: { id: string; status: string; createdAt: number; finishedAt?: number | null }) {
      const inputs = { scope: "area:Projetos", sources: "" };
      w.ctx.db
        .prepare(
          "INSERT INTO runs (id, created_at, started_at, finished_at, origin, provider, status, duration_ms, skill_slug, request_json, started_by) VALUES (?, ?, ?, ?, 'skill', 'claude', ?, ?, 'brain-summarize', ?, 'owner')",
        )
        .run(
          row.id,
          row.createdAt,
          row.createdAt,
          row.finishedAt ?? null,
          row.status,
          row.finishedAt != null ? row.finishedAt - row.createdAt : null,
          JSON.stringify({
            version: 1,
            kind: "skill",
            skillSlug: "brain-summarize",
            inputs,
            mode: "read_only",
          }),
        );
    },
    summaryRow(row: {
      runId: string;
      kind: string;
      id: string;
      sources: Array<{ path: string; size: number; mtime: number; sha256: string }>;
      startedAt: number;
    }) {
      w.ctx.db
        .prepare(
          "INSERT INTO summary_runs (run_id, scope_kind, scope_id, sources, started_at) VALUES (?, ?, ?, ?, ?)",
        )
        .run(row.runId, row.kind, row.id, JSON.stringify(row.sources), row.startedAt);
    },
    writeSummary: write,
    skillFile: () => path.join(w.ctx.paths.skills, "brain-summarize", "SKILL.md"),
    async close() {
      spy.mockRestore();
      delete process.env.FAKE_CLAUDE_FAIL;
      await w.ctx.runs.shutdown(2000);
      await close();
      restorePath();
    },
  });
}

/** One paragraph citing `file § section`. */
export const paragraph = (file: string, section: string, text = "O projeto Atlas avança."): Json => ({
  text,
  citations: [{ path: file, section }],
});
