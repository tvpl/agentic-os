import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { movingClock } from "./movingClock.js";
import { memoriaWorld, type Json, type MemoriaWorld } from "./memoriaWorld.js";

export { code, sha, type Json } from "./memoriaWorld.js";

/**
 * The world of `.specs/features/cerebro-rituais`: the memoria world (a real home, a server over it, owner, device and
 * run headers, `put`, `index`) with a clock set to a fixed instant (Monday 2026-11-09 10:00 local unless a test moves
 * it), and the files the weekly review reads: journal days, `MEMORY.md` and project notes.
 */
export interface RituaisWorld extends MemoriaWorld {
  /** Move the clock to this instant (it goes on ticking from there). */
  at: (instant: number) => void;
  /** `memory/journal/<day>.md` with these bullets under `## Open loops` (and anything before them). */
  journal: (day: string, loops: string[], before?: string) => string;
  /** `memory/MEMORY.md` with these bullets under `## Open loops`. */
  memoryMd: (loops: string[]) => string;
  /** A note with this front matter and body. */
  note: (file: string, fields: Record<string, string>, body?: string) => string;
  /** Set a file's `mtime` to this instant. */
  touch: (file: string, instant: number) => void;
  /** `GET /api/memory/weekly-review` as the owner, asserting 200. */
  review: (query?: string) => Promise<Json>;
  /** `POST /api/memory/weekly-review/loops` as the owner. */
  decide: (body: Json) => Promise<{ status: number; body: Json }>;
  /** `POST /api/memory/weekly-review/archive` as the owner. */
  archive: (body: Json) => Promise<{ status: number; body: Json }>;
  /** `POST /api/memory/weekly-review/finish` as the owner. */
  finish: (body: Json) => Promise<{ status: number; body: Json }>;
  /** The stored rows of `loop_decisions`, by key. */
  rows: () => Json[];
  /** The stored rows of `weekly_reviews`, by week. */
  weeks: () => Json[];
  /** A hash of every file under the home (path and bytes), but the database and its journal. */
  homeHash: () => string;
  /**
   * Remove the files the weekly review reads, every stored decision and week, the weekly reminder's record and the
   * proposal lists, for a test that starts clean.
   */
  reset: () => Promise<void>;
}

/** The key of a loop: the SHA-256 hex of its normalized text (the test writes the normalized text itself). */
export const keyOf = (normalized: string): string =>
  crypto.createHash("sha256").update(normalized).digest("hex");

/** Monday 2026-11-09 10:00, local. */
export const MONDAY = new Date(2026, 10, 9, 10, 0).getTime();

export async function rituaisWorld(
  prefix: string,
  now: number = MONDAY,
): Promise<RituaisWorld & { restore: () => void }> {
  const clock = movingClock(now);
  const w = await memoriaWorld(prefix);
  const close = w.close;
  const walk = (dir: string, out: string[]) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full, out);
      else if (entry.isFile()) out.push(full);
    }
    return out;
  };
  const world = Object.assign(w, {
    restore: () => clock.restore(),
    at: (instant: number) => clock.set(instant),
    journal(day: string, loops: string[], before = "") {
      const file = path.join(w.memory, "journal", `${day}.md`);
      return w.put(file, `# ${day}\n\n${before}## Open loops\n\n${loops.map((l) => `- ${l}`).join("\n")}\n`);
    },
    memoryMd(loops: string[]) {
      return w.put(
        path.join(w.memory, "MEMORY.md"),
        `# Memória\n\n## Facts\n\n- nada\n\n## Open loops\n\n${loops.map((l) => `- ${l}`).join("\n")}\n`,
      );
    },
    note(file: string, fields: Record<string, string>, body = "# Nota\n") {
      const head = Object.entries(fields)
        .map(([k, v]) => `${k}: ${v}`)
        .join("\n");
      return w.put(file, `---\n${head}\n---\n${body}`);
    },
    touch(file: string, instant: number) {
      fs.utimesSync(file, instant / 1000, instant / 1000);
    },
    async review(query = "") {
      const res = await w.call("GET", `/api/memory/weekly-review${query ? `?${query}` : ""}`);
      if (res.status !== 200)
        throw new Error(`GET weekly-review answered ${res.status}: ${JSON.stringify(res.body)}`);
      return res.body;
    },
    decide: (body: Json) => w.call("POST", "/api/memory/weekly-review/loops", body),
    archive: (body: Json) => w.call("POST", "/api/memory/weekly-review/archive", body),
    finish: (body: Json) => w.call("POST", "/api/memory/weekly-review/finish", body),
    rows: () => w.ctx.db.prepare("SELECT * FROM loop_decisions ORDER BY key").all() as Json[],
    weeks: () => w.ctx.db.prepare("SELECT * FROM weekly_reviews ORDER BY week").all() as Json[],
    homeHash() {
      const hash = crypto.createHash("sha256");
      for (const file of walk(w.home, []).sort()) {
        if (/\.db(-wal|-shm|-journal)?$/.test(file) || file.includes(`${path.sep}logs${path.sep}`)) continue;
        hash.update(file).update(fs.readFileSync(file));
      }
      return hash.digest("hex");
    },
    async reset() {
      for (const dir of ["journal", "notes", "inbox", "archive"])
        fs.rmSync(path.join(w.memory, dir), { recursive: true, force: true });
      fs.rmSync(path.join(w.memory, "MEMORY.md"), { force: true });
      w.ctx.db.prepare("DELETE FROM loop_decisions").run();
      w.ctx.db.prepare("DELETE FROM review_state").run();
      w.ctx.db.prepare("DELETE FROM weekly_reviews").run();
      w.ctx.db.prepare("DELETE FROM meta WHERE key = 'sentinel.weeklyReview.week'").run();
      fs.rmSync(path.join(w.ctx.paths.artifacts, "cleanup"), { recursive: true, force: true });
      await w.index();
    },
    async close() {
      clock.restore();
      await close();
    },
  });
  return world;
}
