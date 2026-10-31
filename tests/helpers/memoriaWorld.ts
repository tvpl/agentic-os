import fs from "node:fs";
import path from "node:path";
import { vi } from "vitest";
import { ClaudeAdapter } from "@mordomo/adapter-claude";
import type { AgentRun } from "@mordomo/core";
import { seedHome } from "@mordomo/core/internal";
import type { RunRecord } from "@mordomo/contracts";
import { FAKE_BIN, withFakeBinPath } from "../helpers.js";
import { notesViewWorld, type Json, type NotesViewWorld } from "./notesViewWorld.js";

export { sha, type Json } from "./notesViewWorld.js";

/**
 * The world of `.specs/features/cerebro-memoria-confiavel`: the notes-view world (a real home, a server over it, owner
 * and device headers, `put`, `update`, `index`) plus the credential of a run and the status and code of an answer.
 */
export interface MemoriaWorld extends NotesViewWorld {
  /** The headers of a run's own credential: a memory skill's run (`organize-brain`) in this mode. */
  run: (mode?: "write" | "read_only") => { headers: Record<string, string>; runId: string };
}

export const code = (r: { status: number; body: Json }): [number, unknown] => [r.status, r.body?.error?.code];

export async function memoriaWorld(prefix: string): Promise<MemoriaWorld> {
  const base = await notesViewWorld(prefix);
  return Object.assign(base, {
    run(mode: "write" | "read_only" = "write") {
      const record = base.ctx.runs.create({
        origin: "skill",
        provider: "claude",
        prompt: "held open",
        model: null,
        effort: "default",
        mode,
        timeoutMs: 60_000,
        profile: mode === "write" ? "controlled_write" : "read_only",
        skillSlug: "organize-brain",
        startedBy: null,
      } as never);
      const access = base.ctx.runApiAccessFor(record, mode);
      if (!access) throw new Error("no run credential");
      return {
        runId: record.id,
        headers: { "x-mordomo-token": access.token, "content-type": "application/json" },
      };
    },
  });
}

/**
 * The memoria world with runs of the fake Claude CLI (`tests/fixtures/fake-bin`), as `questionWorld` of
 * `paineisWorld.ts` does: the bundled skills seeded, Claude the provider, and a spy on `ClaudeAdapter.prototype.execute`
 * that writes what a run leaves (`artifacts/<runId>/proposal.json`) and, once the run has started (after `run.started`
 * went out), what it does to the disk.
 */
export interface RunWorld extends MemoriaWorld {
  /** What the next runs leave as `proposal.json` (a value is written as JSON, a string or a Buffer as it is; null: nothing). */
  leave(content: unknown): void;
  /** What a run does once it has started, awaited before its other events are read; null: nothing. */
  during(fn: ((run: AgentRun) => Promise<void> | void) | null): void;
  /** Make the fake CLI fail. */
  failing(on: boolean): void;
  /** Start a skill as the owner and wait for its end. */
  skill(slug: string, inputs?: Record<string, string>): Promise<RunRecord>;
  /** Start a prompt run in this mode, straight through the run manager, and wait for its end. */
  prompt(mode: "write" | "read_only"): Promise<RunRecord>;
}

const repo = path.resolve(import.meta.dirname, "..", "..");

export async function runWorld(prefix: string): Promise<RunWorld> {
  const restorePath = withFakeBinPath();
  const w = await memoriaWorld(prefix);
  seedHome(w.ctx.paths, repo);
  w.update((s) => {
    s.providers.claude.enabled = true;
    s.providers.claude.binaryPath = path.join(FAKE_BIN, "claude");
    s.defaultProvider = "claude";
  });
  w.ctx.reloadAdapters();
  let content: unknown = null;
  let during: ((run: AgentRun) => Promise<void> | void) | null = null;
  const execute = ClaudeAdapter.prototype.execute;
  const spy = vi.spyOn(ClaudeAdapter.prototype, "execute").mockImplementation(function (
    this: ClaudeAdapter,
    run: AgentRun,
  ) {
    if (content !== null) {
      const dir = path.join(w.ctx.paths.artifacts, run.runId);
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(
        path.join(dir, "proposal.json"),
        typeof content === "string" || Buffer.isBuffer(content) ? content : JSON.stringify(content),
      );
    }
    const inner = execute.call(this, run);
    const hook = during;
    if (!hook) return inner;
    return (async function* () {
      for await (const event of inner) {
        yield event;
        if (event.type === "started") await hook(run);
      }
    })();
  });
  const close = w.close;
  return Object.assign(w, {
    leave(next: unknown) {
      content = next;
    },
    during(fn: ((run: AgentRun) => Promise<void> | void) | null) {
      during = fn;
    },
    failing(on: boolean) {
      if (on) process.env.FAKE_CLAUDE_FAIL = "1";
      else delete process.env.FAKE_CLAUDE_FAIL;
    },
    async skill(slug: string, inputs: Record<string, string> = {}) {
      const started = w.ctx.execution.startSkill({ slug, inputs, startedBy: "owner" } as never);
      if (!started.runId)
        throw new Error(`the skill ${slug} did not start a run: ${JSON.stringify(started)}`);
      return w.ctx.execution.wait(started.runId);
    },
    async prompt(mode: "write" | "read_only") {
      const record = w.ctx.runs.create({
        origin: "manual",
        provider: "claude",
        prompt: `a ${mode} run`,
        request: { version: 1, kind: "prompt", prompt: `a ${mode} run`, mode },
        cwd: w.home,
        model: null,
        effort: "default",
        mode,
        timeoutMs: 60_000,
        profile: mode === "write" ? "controlled_write" : "read_only",
        startedBy: "owner",
      });
      return w.ctx.runs.execute(record.id, `a ${mode} run`, mode);
    },
    async close() {
      spy.mockRestore();
      delete process.env.FAKE_CLAUDE_FAIL;
      await w.ctx.runs.shutdown(2000);
      await close();
      restorePath();
    },
  });
}
