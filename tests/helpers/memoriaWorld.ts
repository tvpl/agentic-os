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
