import fs from "node:fs";
import path from "node:path";
import { Cron } from "croner";
import type { MordomoPaths } from "../paths.js";
import { RoutineSchema, validateRoutine, type Routine, type RoutineValidationOptions } from "./types.js";
import { nextRunFor } from "./schedule.js";
import { atomicWrite } from "../config/store.js";
import { resolveInsideDir } from "../security/ids.js";

/** A file the store could not load; reported, never thrown, by `list()`. */
export interface StoreProblem {
  file: string;
  error: string;
}

/** Routines are JSON files in routines/ — files are the source of truth. */
export class RoutineStore {
  private problems: StoreProblem[] = [];

  constructor(private readonly paths: MordomoPaths) {}

  /** Files skipped by the most recent `list()` call, with the reason. */
  lastProblems(): StoreProblem[] {
    return [...this.problems];
  }

  /** Path for an id, validated (regex + containment). Throws InvalidIdError (400). */
  private fileFor(id: string): string {
    return resolveInsideDir(this.paths.routines, id, ".json", "routine id");
  }

  list(): Routine[] {
    this.problems = [];
    if (!fs.existsSync(this.paths.routines)) return [];
    const out: Routine[] = [];
    for (const file of fs.readdirSync(this.paths.routines)) {
      if (!file.endsWith(".json")) continue;
      const full = path.join(this.paths.routines, file);
      try {
        const raw = JSON.parse(fs.readFileSync(full, "utf8"));
        out.push(RoutineSchema.parse(raw));
      } catch (err) {
        // One bad file must not take the scheduler, the API or the CLI down.
        this.problems.push({ file: full, error: (err as Error).message });
      }
    }
    return out.sort((a, b) => a.name.localeCompare(b.name));
  }

  get(id: string): Routine | null {
    const file = this.fileFor(id);
    if (!fs.existsSync(file)) return null;
    return RoutineSchema.parse(JSON.parse(fs.readFileSync(file, "utf8")));
  }

  /**
   * Validate (shape + semantics for the schedule kind) and write the file.
   * `opts.allowWebhooks` mirrors `settings.routines.allowWebhooks`; callers
   * without settings (CLI helpers, tests) keep webhook delivery refused.
   */
  save(routine: Routine, opts: RoutineValidationOptions = {}): Routine {
    const parsed = RoutineSchema.parse(routine);
    validateRoutine(parsed, validateCron, opts);
    atomicWrite(this.fileFor(parsed.id), JSON.stringify(parsed, null, 2) + "\n");
    return parsed;
  }

  remove(id: string): boolean {
    const file = this.fileFor(id);
    if (!fs.existsSync(file)) return false;
    fs.unlinkSync(file);
    return true;
  }

  duplicate(id: string, opts: RoutineValidationOptions = {}): Routine {
    const source = this.get(id);
    if (!source) throw new Error(`unknown routine: ${id}`);
    let candidate = `${id}-copy`;
    let n = 2;
    while (this.get(candidate)) candidate = `${id}-copy-${n++}`;
    return this.save(
      {
        ...source,
        id: candidate,
        name: `${source.name} (copy)`,
        enabled: false,
        endedReason: null,
        createdAt: Date.now(),
      },
      opts,
    );
  }
}

export function validateCron(expression: string, timezone: string): void {
  try {
    const job = new Cron(expression, { timezone: timezone || undefined, paused: true });
    job.stop();
  } catch (err) {
    throw new Error(`Invalid schedule "${expression}" (${(err as Error).message})`);
  }
}

/** croner-backed "next cron slot after `from`" (null on invalid expressions). */
export function cronNextAfter(schedule: string, timezone: string, from: number): number | null {
  try {
    const job = new Cron(schedule, { timezone: timezone || undefined, paused: true });
    const next = job.nextRun(new Date(from));
    job.stop();
    return next ? next.getTime() : null;
  } catch {
    return null;
  }
}

/** Next firing for any schedule kind (no settings: the routine's own timezone, else UTC). */
export function nextRunAt(routine: Routine, now = Date.now(), fallbackTz = "UTC"): number | null {
  return nextRunFor(routine, now, fallbackTz, cronNextAfter);
}
