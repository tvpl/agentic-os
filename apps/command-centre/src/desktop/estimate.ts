/**
 * What this will probably cost (refino item 39), from what it cost before:
 * the finished runs of the same skill, or prompt runs whose head matches.
 * Median rather than mean, so one runaway does not scare every estimate.
 * Pure and tested.
 */
export interface EstimateSource {
  status: string;
  skillSlug: string | null;
  promptSummary: string;
  durationMs: number | null;
  usage?: { costUsd?: number | null } | null;
}

export interface Estimate {
  usd: number | null;
  ms: number | null;
  /** How many runs the estimate rests on. */
  samples: number;
}

const MIN_SAMPLES = 3;

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");
/** The same request, allowing for a trailing courtesy: the first 40 characters agree. */
function sameHead(a: string, b: string): boolean {
  const x = norm(a);
  const y = norm(b);
  const n = Math.min(40, x.length, y.length);
  return n >= 8 && x.slice(0, n) === y.slice(0, n);
}

export function estimateRun(
  runs: readonly EstimateSource[],
  target: { skillSlug?: string | null; prompt?: string | null },
): Estimate | null {
  const done = runs.filter((r) => r.status === "done");
  const like = target.skillSlug
    ? done.filter((r) => r.skillSlug === target.skillSlug)
    : target.prompt && target.prompt.trim().length >= 8
      ? done.filter((r) => !r.skillSlug && sameHead(r.promptSummary, target.prompt!))
      : [];
  if (like.length < MIN_SAMPLES) return null;
  const usd = median(like.map((r) => r.usage?.costUsd).filter((v): v is number => typeof v === "number"));
  const ms = median(like.map((r) => r.durationMs).filter((v): v is number => typeof v === "number"));
  return { usd, ms, samples: like.length };
}
