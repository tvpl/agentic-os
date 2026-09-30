/**
 * The river of runs (Runs scene): time runs left to right and ends at "now"
 * on the right edge, one lane per origin, each run a capsule placed by its
 * start and stretched by its duration. Pure maths only — time to pixels,
 * lanes, stacking, clustering, which labels fit, axis ticks and keyboard
 * neighbours — so the scene stays a thin view and all of this is tested.
 */
import { isRunActive, isRunFailed } from "../../runs/status";

export type RangeId = "24h" | "7d" | "30d";
export const RANGE_IDS: readonly RangeId[] = ["24h", "7d", "30d"];
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
export const RANGE_MS: Record<RangeId, number> = { "24h": DAY, "7d": 7 * DAY, "30d": 30 * DAY };

export function isRangeId(v: string | null | undefined): v is RangeId {
  return v === "24h" || v === "7d" || v === "30d";
}

/** The run fields the river reads (a `RunRecord` fits). */
export interface RiverRun {
  id: string;
  createdAt: number;
  startedAt?: number | null;
  finishedAt: number | null;
  durationMs: number | null;
  status: string;
  origin: string;
  parentRunId?: string | null;
  skillSlug: string | null;
  promptSummary: string;
}

/* ---- lanes ------------------------------------------------------------------ */
/** Who started it: a routine, you (console, deck, API call), the agent (a delegated sub-run), a sentinel. */
export type LaneId = "routine" | "you" | "agent" | "sentinel" | "api";
export const LANE_ORDER: readonly LaneId[] = ["routine", "you", "agent", "sentinel", "api"];

export function laneOf(run: Pick<RiverRun, "origin" | "parentRunId">): LaneId {
  if (run.parentRunId) return "agent";
  switch (run.origin) {
    case "routine":
      return "routine";
    case "sentinel":
      return "sentinel";
    case "api":
      return "api";
    default:
      return "you"; // manual, skill and anything new a person started
  }
}

export function isLaneId(v: string | null | undefined): v is LaneId {
  return (LANE_ORDER as readonly string[]).includes(v ?? "");
}

/* ---- status ------------------------------------------------------------------ */
export type Tone = "ok" | "fail" | "cancel" | "live" | "wait";

export function toneOf(status: string): Tone {
  if (status === "done") return "ok";
  if (status === "waiting_approval") return "wait";
  if (isRunActive(status)) return "live";
  if (isRunFailed(status)) return "fail";
  return "cancel";
}

/** Which tone wins when several runs share one mark: trouble first, then motion. */
const TONE_RANK: Record<Tone, number> = { fail: 4, live: 3, wait: 2, ok: 1, cancel: 0 };
export function worstTone(tones: readonly Tone[]): Tone {
  let best: Tone = "cancel";
  for (const t of tones) if (TONE_RANK[t] > TONE_RANK[best]) best = t;
  return best;
}

export type StatusFilter = "all" | "done" | "failed" | "cancelled" | "live";
export const STATUS_FILTERS: readonly StatusFilter[] = ["all", "done", "failed", "cancelled", "live"];
export function isStatusFilter(v: string | null | undefined): v is StatusFilter {
  return (STATUS_FILTERS as readonly string[]).includes(v ?? "");
}

export function matchesStatus(status: string, filter: StatusFilter): boolean {
  switch (filter) {
    case "all":
      return true;
    case "done":
      return status === "done";
    case "failed":
      return isRunFailed(status);
    case "cancelled":
      return status === "cancelled";
    case "live":
      return isRunActive(status);
  }
}

export interface RunCounts {
  total: number;
  done: number;
  failed: number;
  cancelled: number;
  live: number;
}

export function countRuns(runs: readonly Pick<RiverRun, "status">[]): RunCounts {
  const out: RunCounts = { total: 0, done: 0, failed: 0, cancelled: 0, live: 0 };
  for (const r of runs) {
    out.total += 1;
    if (r.status === "done") out.done += 1;
    else if (isRunFailed(r.status)) out.failed += 1;
    else if (isRunActive(r.status)) out.live += 1;
    else if (r.status === "cancelled") out.cancelled += 1;
  }
  return out;
}

/* ---- time --------------------------------------------------------------------- */
export const runStart = (r: Pick<RiverRun, "startedAt" | "createdAt">): number => r.startedAt ?? r.createdAt;

/** When it ended — a live run ends now, and grows with it. */
export function runEnd(r: RiverRun, now: number): number {
  if (isRunActive(r.status)) return Math.max(now, runStart(r));
  if (r.finishedAt) return r.finishedAt;
  return runStart(r) + (r.durationMs ?? 0);
}

/** A run's title as a person knows it: the skill, or the start of what was asked. */
export function runLabel(r: Pick<RiverRun, "skillSlug" | "promptSummary" | "id">, max = 48): string {
  if (r.skillSlug) return `/${r.skillSlug}`;
  const s = r.promptSummary.replace(/\s+/g, " ").trim();
  if (!s) return r.id.slice(0, 8);
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

/** `t` on an axis `width` px wide from `since` (x = 0) to `until` (x = width), clamped. */
export function timeToX(t: number, since: number, until: number, width: number): number {
  if (until <= since || width <= 0) return 0;
  const f = (t - since) / (until - since);
  return Math.min(width, Math.max(0, f * width));
}

/** The smallest range with enough in it to read, so the scene never opens on an empty river. */
export function pickRange(runs: readonly Pick<RiverRun, "createdAt">[], now: number, enough = 3): RangeId {
  for (const id of RANGE_IDS) {
    const since = now - RANGE_MS[id];
    if (runs.filter((r) => r.createdAt >= since).length >= enough) return id;
  }
  return "30d";
}

/* ---- filtering ------------------------------------------------------------------ */
export interface RiverFilter {
  status: StatusFilter;
  lane: LaneId | null;
  query: string;
}

export function filterRuns<
  T extends RiverRun & { provider?: string; model?: string | null; routineId?: string | null },
>(runs: readonly T[], f: RiverFilter): T[] {
  const q = f.query.trim().toLowerCase();
  return runs.filter((r) => {
    if (!matchesStatus(r.status, f.status)) return false;
    if (f.lane && laneOf(r) !== f.lane) return false;
    if (!q) return true;
    return [r.skillSlug, r.promptSummary, r.id, r.routineId, r.provider, r.model, r.origin].some(
      (v) => typeof v === "string" && v.toLowerCase().includes(q),
    );
  });
}

/** Runs whose span touches the window. */
export function inWindow<T extends RiverRun>(runs: readonly T[], since: number, until: number): T[] {
  return runs.filter((r) => runEnd(r, until) >= since && runStart(r) <= until);
}

/* ---- layout ---------------------------------------------------------------------- */
export interface RiverItem {
  id: string;
  lane: LaneId;
  start: number;
  end: number;
  tone: Tone;
  label: string;
}

export interface RunMark {
  kind: "run";
  id: string;
  x: number;
  w: number;
  row: number;
  tone: Tone;
  label: string;
  /** Its label fits beside it without covering a neighbour. */
  tagFits: boolean;
  /** The label goes on the left (no room on the right, e.g. at "now"). */
  tagLeft: boolean;
}

export interface ClusterMark {
  kind: "cluster";
  id: string;
  ids: string[];
  x: number;
  w: number;
  row: number;
  tone: Tone;
  start: number;
  end: number;
  /** How many of each tone, for the label ("12 · 2 failed"). */
  tones: Record<Tone, number>;
}

export type Mark = RunMark | ClusterMark;

export interface LaneLayout {
  lane: LaneId;
  rows: number;
  marks: Mark[];
}

export interface LayoutOptions {
  since: number;
  until: number;
  width: number;
  /** A run shorter than this is still this wide, so it can be seen and clicked. */
  minW?: number;
  /** Air between two capsules on one row. */
  gap?: number;
  /** Rows a lane may stack before a dense stretch becomes one cluster. */
  maxRows?: number;
  /** Rough width of one label character (mono, 11px). */
  charW?: number;
}

interface Placed {
  item: RiverItem;
  x: number;
  w: number;
}

export function layoutRiver(items: readonly RiverItem[], opts: LayoutOptions): LaneLayout[] {
  const { since, until, width } = opts;
  const minW = opts.minW ?? 10;
  const gap = opts.gap ?? 4;
  const maxRows = Math.max(1, opts.maxRows ?? 3);
  const charW = opts.charW ?? 6.8;
  const byLane = new Map<LaneId, Placed[]>();
  const startOf = new Map<string, number>();
  for (const item of items) {
    startOf.set(item.id, item.start);
    if (item.end < since || item.start > until) continue;
    const x1 = timeToX(item.start, since, until, width);
    const x2 = timeToX(item.end, since, until, width);
    const w = Math.min(width, Math.max(minW, x2 - x1));
    const x = Math.max(0, Math.min(x1, width - w));
    const list = byLane.get(item.lane) ?? [];
    list.push({ item, x, w });
    byLane.set(item.lane, list);
  }

  const out: LaneLayout[] = [];
  for (const lane of LANE_ORDER) {
    const placed = byLane.get(lane);
    if (!placed) continue;
    placed.sort((a, b) => a.x - b.x || a.item.start - b.item.start);
    // Groups of capsules that touch (transitively): each is stacked or clustered as a whole.
    const groups: Placed[][] = [];
    let groupEnd = -Infinity;
    for (const p of placed) {
      const last = groups[groups.length - 1];
      if (last && p.x < groupEnd + gap) {
        last.push(p);
        groupEnd = Math.max(groupEnd, p.x + p.w);
      } else {
        groups.push([p]);
        groupEnd = p.x + p.w;
      }
    }
    const marks: Mark[] = [];
    let rows = 1;
    for (const group of groups) {
      const rowEnds: number[] = [];
      const assigned: number[] = [];
      for (const p of group) {
        let row = rowEnds.findIndex((end) => p.x >= end + gap);
        if (row < 0) {
          row = rowEnds.length;
          rowEnds.push(0);
        }
        rowEnds[row] = p.x + p.w;
        assigned.push(row);
      }
      if (rowEnds.length <= maxRows) {
        group.forEach((p, i) =>
          marks.push({
            kind: "run",
            id: p.item.id,
            x: p.x,
            w: p.w,
            row: assigned[i]!,
            tone: p.item.tone,
            label: p.item.label,
            tagFits: false,
            tagLeft: false,
          }),
        );
        rows = Math.max(rows, rowEnds.length);
      } else {
        const x = Math.min(...group.map((p) => p.x));
        const x2 = Math.max(...group.map((p) => p.x + p.w));
        const tones: Record<Tone, number> = { ok: 0, fail: 0, cancel: 0, live: 0, wait: 0 };
        for (const p of group) tones[p.item.tone] += 1;
        marks.push({
          kind: "cluster",
          id: `cluster:${group[0]!.item.id}`,
          ids: group.map((p) => p.item.id),
          x,
          w: Math.max(x2 - x, minW * 2),
          row: 0,
          tone: worstTone(group.map((p) => p.item.tone)),
          start: Math.min(...group.map((p) => p.item.start)),
          end: Math.max(...group.map((p) => p.item.end)),
          tones,
        });
      }
    }
    // Labels: beside the capsule when the row has room there, on the left when only that side does.
    // The newest runs are labelled first; a label that would cover one already placed is dropped,
    // so of two colliding labels the older run's is the one that goes.
    for (let row = 0; row < rows; row++) {
      const inRow = marks.filter((m) => m.row === row).sort((a, b) => a.x - b.x);
      const taken: Array<[number, number]> = [];
      const free = (a: number, b: number) => taken.every(([c, d]) => b <= c || a >= d);
      const order = inRow
        .map((m, i) => ({ m, i }))
        .filter((e): e is { m: RunMark; i: number } => e.m.kind === "run")
        .sort((a, b) => (startOf.get(b.m.id) ?? 0) - (startOf.get(a.m.id) ?? 0));
      for (const { m, i } of order) {
        const need = m.label.length * charW + 12;
        const next = inRow[i + 1];
        const prev = inRow[i - 1];
        const rightEnd = m.x + m.w;
        const rightRoom = (next ? next.x : width) - rightEnd;
        const leftRoom = m.x - (prev ? prev.x + prev.w : 0);
        if (rightRoom >= need && free(rightEnd, rightEnd + need)) {
          m.tagFits = true;
          taken.push([rightEnd, rightEnd + need]);
        } else if (leftRoom >= need && free(m.x - need, m.x)) {
          m.tagFits = true;
          m.tagLeft = true;
          taken.push([m.x - need, m.x]);
        } else m.tagLeft = m.x + m.w + need > width;
      }
    }
    out.push({ lane, rows, marks });
  }
  return out;
}

/* ---- axis ------------------------------------------------------------------------- */
export interface Tick {
  t: number;
  x: number;
}

const MIN = 60_000;
/** Candidate tick steps, finest first: minutes and hours align to the clock, days to midnight. */
const STEPS: ReadonlyArray<{ ms: number; unit: "m" | "h" | "d"; n: number }> = [
  { ms: 5 * MIN, unit: "m", n: 5 },
  { ms: 10 * MIN, unit: "m", n: 10 },
  { ms: 15 * MIN, unit: "m", n: 15 },
  { ms: 30 * MIN, unit: "m", n: 30 },
  { ms: HOUR, unit: "h", n: 1 },
  { ms: 2 * HOUR, unit: "h", n: 2 },
  { ms: 4 * HOUR, unit: "h", n: 4 },
  { ms: 8 * HOUR, unit: "h", n: 8 },
  { ms: 12 * HOUR, unit: "h", n: 12 },
  { ms: DAY, unit: "d", n: 1 },
  { ms: 2 * DAY, unit: "d", n: 2 },
  { ms: 5 * DAY, unit: "d", n: 5 },
  { ms: 10 * DAY, unit: "d", n: 10 },
];

/** How a tick reads: a clock time inside a day and a half, a weekday within ten days, a date beyond. */
export type TickFormat = "time" | "weekday" | "date";
export function tickFormat(since: number, until: number): TickFormat {
  const span = until - since;
  return span <= 36 * HOUR ? "time" : span <= 10 * DAY ? "weekday" : "date";
}

/**
 * Round local times across the window, about one every `spacing` px, clear
 * of the "now" label at the right edge. Works for any window, so a zoomed
 * stretch of forty minutes gets ticks too.
 */
export function axisTicks(since: number, until: number, width: number, spacing = 110): Tick[] {
  const span = until - since;
  if (span <= 0 || width <= 0) return [];
  const most = Math.max(2, Math.floor(width / spacing));
  const step = STEPS.find((s) => span / s.ms <= most) ?? STEPS[STEPS.length - 1]!;
  const d = new Date(since);
  if (step.unit === "d") d.setHours(0, 0, 0, 0);
  else if (step.unit === "h") d.setMinutes(0, 0, 0);
  else d.setSeconds(0, 0);
  const aligned = () =>
    step.unit === "h"
      ? d.getHours() % step.n === 0
      : step.unit === "m"
        ? d.getMinutes() % step.n === 0
        : true;
  const bump = (k: number) => {
    if (step.unit === "d") d.setDate(d.getDate() + k);
    else if (step.unit === "h") d.setHours(d.getHours() + k);
    else d.setMinutes(d.getMinutes() + k);
  };
  let guard = 0;
  while ((d.getTime() <= since || !aligned()) && guard++ < 2000) bump(1);
  const ticks: Tick[] = [];
  const clear = Math.min(64, width * 0.2);
  // Step in calendar units so a DST change does not drift the ticks off the hour.
  for (; d.getTime() < until && ticks.length < 200; bump(step.n)) {
    const x = timeToX(d.getTime(), since, until, width);
    if (width - x >= clear) ticks.push({ t: d.getTime(), x });
  }
  return ticks;
}

/* ---- keyboard ------------------------------------------------------------------------ */
export type Direction = "left" | "right" | "up" | "down" | "home" | "end";

/**
 * The mark an arrow key moves to: left/right along the lane in time,
 * up/down to the nearest mark in time on the next lane that has one.
 */
export function neighbour(
  lanes: readonly LaneLayout[],
  fromId: string | null,
  dir: Direction,
): string | null {
  const flat = lanes.map((l) => [...l.marks].sort((a, b) => a.x - b.x || a.row - b.row));
  const all = flat.flat();
  if (all.length === 0) return null;
  if (dir === "home") return all[0]!.id;
  if (dir === "end") return all[all.length - 1]!.id;
  let li = -1;
  let mi = -1;
  flat.forEach((marks, i) => {
    const j = marks.findIndex((m) => m.id === fromId);
    if (j >= 0) {
      li = i;
      mi = j;
    }
  });
  if (li < 0) return all[0]!.id;
  const lane = flat[li]!;
  const cur = lane[mi]!;
  if (dir === "left") return lane[Math.max(0, mi - 1)]!.id;
  if (dir === "right") return lane[Math.min(lane.length - 1, mi + 1)]!.id;
  const step = dir === "down" ? 1 : -1;
  for (let k = li + step; k >= 0 && k < flat.length; k += step) {
    const other = flat[k]!;
    if (other.length === 0) continue;
    const mid = cur.x + cur.w / 2;
    let best = other[0]!;
    for (const m of other) if (Math.abs(m.x + m.w / 2 - mid) < Math.abs(best.x + best.w / 2 - mid)) best = m;
    return best.id;
  }
  return cur.id;
}
