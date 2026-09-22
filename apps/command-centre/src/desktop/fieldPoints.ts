/**
 * What the living field is made of (redesign F7).
 *
 * The field started as one point per indexed file, and on a real workspace
 * that turned out to be three faint dots: a constellation needs a sky. The
 * fix is not to invent points — it is to draw everything the OS actually
 * knows. Files, skills, routines and recent runs are all memory; showing them
 * together is both denser and truer than showing files alone.
 *
 * Pure: placement is derived from the index, so the field looks the same
 * across reloads and reads as a place rather than a screensaver.
 */
import type { GraphNodeLite } from "./data";

export type FieldKind = "file" | "skill" | "routine" | "run";

export interface FieldSeed {
  /** Stable across reloads; also the React key and the hit-test identity. */
  id: string;
  kind: FieldKind;
  label: string;
  /** Second line of the hover readout: the area, the schedule, the outcome. */
  detail: string;
  /** Where a click goes: a file path opens a document window, a route navigates. */
  open: { file: string } | { route: string };
  /** Something is wrong with this one: it burns instead of glowing. */
  hot?: boolean;
  /** A child run orbits its parent (refino item 46). */
  parentId?: string;
}

export interface FieldPoint extends FieldSeed {
  /** Orbit angle and radius, in normalised stage units. */
  a: number;
  r: number;
  /** Angular speed, signed so the field never rotates as one body. */
  s: number;
  /** Radius in CSS pixels before hover. */
  size: number;
  /** Phase of the slow brightness pulse. */
  phase: number;
  /** Screen position from the last frame, for hit testing. */
  x: number;
  y: number;
}

/** Cheap deterministic hash: the same id always lands in the same place. */
function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) / 4294967295;
}

export interface FieldSources {
  files: readonly GraphNodeLite[];
  skills: ReadonlyArray<{ slug: string; name: string; enabled: boolean }>;
  routines: ReadonlyArray<{ id: string; name: string; enabled: boolean; healthy: boolean }>;
  runs: ReadonlyArray<{
    id: string;
    status: string;
    promptSummary?: string | null;
    parentRunId?: string | null;
  }>;
  /** Localised labels for the three non-file kinds. */
  labels: { skill: string; routine: string; run: string; failed: string };
}

/** The most a field may hold: past this it is noise, and the weave gets costly. */
export const MAX_POINTS = 240;
/** Runs age out of the sky quickly; only the last few say anything. */
const MAX_RUNS = 12;

export function fieldSeeds(src: FieldSources): FieldSeed[] {
  const out: FieldSeed[] = [];
  for (const file of src.files) {
    out.push({
      id: `file:${file.path}`,
      kind: "file",
      label: file.title || file.name,
      detail: file.area ?? "",
      open: { file: file.path },
    });
  }
  for (const skill of src.skills) {
    if (!skill.enabled) continue;
    out.push({
      id: `skill:${skill.slug}`,
      kind: "skill",
      label: skill.name,
      detail: src.labels.skill,
      open: { route: `/skills/${skill.slug}` },
    });
  }
  for (const routine of src.routines) {
    if (!routine.enabled) continue;
    out.push({
      id: `routine:${routine.id}`,
      kind: "routine",
      label: routine.name,
      detail: src.labels.routine,
      open: { route: "/routines" },
      hot: !routine.healthy,
    });
  }
  for (const run of src.runs.slice(0, MAX_RUNS)) {
    const failed = run.status === "failed" || run.status === "timed_out";
    out.push({
      id: `run:${run.id}`,
      kind: "run",
      label: run.promptSummary || run.id,
      detail: failed ? src.labels.failed : src.labels.run,
      open: { route: `/runs/${run.id}` },
      hot: failed,
      ...(run.parentRunId ? { parentId: `run:${run.parentRunId}` } : {}),
    });
  }
  return out.slice(0, MAX_POINTS);
}

/**
 * Place the seeds on a drifting ellipse. Radius comes from the hash rather
 * than from the index, so adding one file does not shuffle the whole sky —
 * only the new point appears.
 */
export function placeField(seeds: readonly FieldSeed[]): FieldPoint[] {
  return seeds.map((seed, i) => {
    const ha = hash(seed.id);
    const hr = hash(`${seed.id}#r`);
    const hs = hash(`${seed.id}#s`);
    return {
      ...seed,
      a: ha * Math.PI * 2,
      // `pow(_, 0.62)` pushes points outward: an even radius would crowd the
      // centre, which is exactly where the console and the windows live.
      r: 0.14 + Math.pow(hr, 0.62) * 0.86,
      s: (0.02 + hs * 0.05) * (i % 2 ? 1 : -1),
      size: 1.4 + hs * 2.4,
      phase: ha * Math.PI * 2,
      x: 0,
      y: 0,
    };
  });
}
