import fs from "node:fs";
import path from "node:path";
import { Cron } from "croner";
import type { MordomoPaths } from "../paths.js";
import { RoutineSchema, type Routine } from "./types.js";
import { atomicWrite } from "../config/store.js";

/** Routines are JSON files in routines/ — files are the source of truth. */
export class RoutineStore {
  constructor(private readonly paths: MordomoPaths) {}

  list(): Routine[] {
    if (!fs.existsSync(this.paths.routines)) return [];
    const out: Routine[] = [];
    for (const file of fs.readdirSync(this.paths.routines)) {
      if (!file.endsWith(".json")) continue;
      try {
        const raw = JSON.parse(fs.readFileSync(path.join(this.paths.routines, file), "utf8"));
        out.push(RoutineSchema.parse(raw));
      } catch (err) {
        throw new Error(`Invalid routine file ${file}: ${(err as Error).message}`);
      }
    }
    return out.sort((a, b) => a.name.localeCompare(b.name));
  }

  get(id: string): Routine | null {
    const file = path.join(this.paths.routines, `${id}.json`);
    if (!fs.existsSync(file)) return null;
    return RoutineSchema.parse(JSON.parse(fs.readFileSync(file, "utf8")));
  }

  save(routine: Routine): Routine {
    const parsed = RoutineSchema.parse(routine);
    validateCron(parsed.schedule, parsed.timezone);
    if (!parsed.skillSlug && !parsed.prompt) {
      throw new Error("A routine needs a skill or a prompt.");
    }
    atomicWrite(
      path.join(this.paths.routines, `${parsed.id}.json`),
      JSON.stringify(parsed, null, 2) + "\n",
    );
    return parsed;
  }

  remove(id: string): boolean {
    const file = path.join(this.paths.routines, `${id}.json`);
    if (!fs.existsSync(file)) return false;
    fs.unlinkSync(file);
    return true;
  }

  duplicate(id: string): Routine {
    const source = this.get(id);
    if (!source) throw new Error(`unknown routine: ${id}`);
    let candidate = `${id}-copy`;
    let n = 2;
    while (this.get(candidate)) candidate = `${id}-copy-${n++}`;
    return this.save({
      ...source,
      id: candidate,
      name: `${source.name} (copy)`,
      enabled: false,
      createdAt: Date.now(),
    });
  }
}

export function validateCron(expression: string, timezone: string): void {
  try {
    const job = new Cron(expression, { timezone, paused: true });
    job.stop();
  } catch (err) {
    throw new Error(`Invalid schedule "${expression}" (${(err as Error).message})`);
  }
}

export function nextRunAt(routine: Routine): number | null {
  if (!routine.enabled) return null;
  try {
    const job = new Cron(routine.schedule, { timezone: routine.timezone, paused: true });
    const next = job.nextRun();
    job.stop();
    return next ? next.getTime() : null;
  } catch {
    return null;
  }
}
