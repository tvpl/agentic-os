import fs from "node:fs";
import path from "node:path";
import { vi } from "vitest";
import { ClaudeAdapter } from "@mordomo/adapter-claude";
import type { AgentRun } from "@mordomo/core";
import { seedHome } from "@mordomo/core/internal";
import { FAKE_BIN, withFakeBinPath } from "../helpers.js";
import { paineisWorld, type Json, type PaineisWorld } from "./paineisWorld.js";

/**
 * The world of `.specs/features/cerebro-perguntar` batch A: a real home and a server over it (`paineisWorld`), seeded
 * from the bundle (the skill `brain-ask` is one of the seeds), whose Claude provider is the fake CLI; the test writes
 * what the run leaves in `artifacts/<run>/answer.json`, as the question dashboard's world does (C6b).
 */

export type { Json };

const repo = path.resolve(import.meta.dirname, "..", "..");

export interface AskWorld extends PaineisWorld {
  /** What the next runs write to `artifacts/<run>/answer.json` (null: nothing); a string or bytes as they are. */
  answer: (content: unknown) => void;
  /** Make the next runs fail (the fake CLI exits 1). */
  failing: (on: boolean) => void;
  ask: (body: unknown, headers?: Record<string, string>) => Promise<{ status: number; body: Json }>;
  read: (id: string) => Promise<{ status: number; body: Json }>;
  list: (query?: string) => Promise<{ status: number; body: Json }>;
  /** Wait for a run to end. */
  settle: (runId: string) => Promise<void>;
  /** The rows of `runs`. */
  runCount: () => number;
  /** A row of `runs` of the skill `brain-ask` (or `skill`), with the inputs of its request, as the run manager leaves it. */
  askRow: (row: {
    id: string;
    status: string;
    createdAt: number;
    finishedAt?: number | null;
    skill?: string;
    inputs?: Record<string, string>;
  }) => void;
  /** Write `content` as the answer of a run that already exists. */
  writeAnswer: (runId: string, content: unknown) => void;
  /** The skill's SKILL.md in the home. */
  skillFile: () => string;
}

export async function askWorld(prefix: string): Promise<AskWorld> {
  const restorePath = withFakeBinPath();
  const w = await paineisWorld(prefix);
  seedHome(w.ctx.paths, repo);
  w.update((s) => {
    s.providers.claude.enabled = true;
    s.providers.claude.binaryPath = path.join(FAKE_BIN, "claude");
    s.defaultProvider = "claude";
  });
  w.ctx.reloadAdapters();
  let content: unknown = null;
  const write = (runId: string, value: unknown) => {
    const dir = path.join(w.ctx.paths.artifacts, runId);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, "answer.json"),
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
  return Object.assign(w, {
    answer(next: unknown) {
      content = next;
    },
    failing(on: boolean) {
      if (on) process.env.FAKE_CLAUDE_FAIL = "1";
      else delete process.env.FAKE_CLAUDE_FAIL;
    },
    ask: (body: unknown, headers?: Record<string, string>) =>
      w.call("POST", "/api/memory/ask", body, headers),
    read: (id: string) => w.call("GET", `/api/memory/ask/${id}`),
    list: (query = "") => w.call("GET", `/api/memory/ask${query ? `?${query}` : ""}`),
    async settle(runId: string) {
      await w.ctx.execution.wait(runId);
    },
    runCount: () => (w.ctx.db.prepare("SELECT COUNT(*) c FROM runs").get() as { c: number }).c,
    askRow(row: {
      id: string;
      status: string;
      createdAt: number;
      finishedAt?: number | null;
      skill?: string;
      inputs?: Record<string, string>;
    }) {
      const skill = row.skill ?? "brain-ask";
      const inputs = row.inputs ?? {
        question: "Pergunta?",
        mode: "direct",
        take: "",
        scope: "all",
        sources: "",
      };
      w.ctx.db
        .prepare(
          "INSERT INTO runs (id, created_at, started_at, finished_at, origin, provider, status, duration_ms, skill_slug, request_json, started_by) VALUES (?, ?, ?, ?, 'skill', 'claude', ?, ?, ?, ?, 'owner')",
        )
        .run(
          row.id,
          row.createdAt,
          row.createdAt,
          row.finishedAt ?? null,
          row.status,
          row.finishedAt != null ? row.finishedAt - row.createdAt : null,
          skill,
          JSON.stringify({ version: 1, kind: "skill", skillSlug: skill, inputs, mode: "read_only" }),
        );
    },
    writeAnswer: write,
    skillFile: () => path.join(w.ctx.paths.skills, "brain-ask", "SKILL.md"),
    async close() {
      spy.mockRestore();
      delete process.env.FAKE_CLAUDE_FAIL;
      await w.ctx.runs.shutdown(2000);
      await close();
      restorePath();
    },
  });
}

/** The three notes of the home of C1, indexed: `onboarding.md` (`Decisão`), `plano.md` (a plano) and `clientes.md`. */
export async function threeNotes(
  w: AskWorld,
): Promise<{ onboarding: string; plano: string; clientes: string }> {
  const onboarding = w.note(
    path.join(w.memory, "notes", "onboarding.md"),
    {},
    "# Onboarding\n\n## Decisão\n\nDecidi que o onboarding de clientes dura duas semanas.\n\n### Prazo\n\nO prazo do onboarding é março.\n",
  );
  const plano = w.note(
    path.join(w.memory, "notes", "plano.md"),
    { natureza: "plano" },
    "# Plano\n\n## Próximos passos\n\nRevisar o onboarding em abril.\n",
  );
  const clientes = w.note(
    path.join(w.memory, "notes", "clientes.md"),
    {},
    "# Clientes\n\n## Lista\n\nAcme e Globex.\n",
  );
  await w.index();
  return { onboarding, plano, clientes };
}

/** One paragraph citing `file § section`. */
export const paragraph = (file: string, section: string, text = "O onboarding dura duas semanas."): Json => ({
  text,
  citations: [{ path: file, section }],
});
