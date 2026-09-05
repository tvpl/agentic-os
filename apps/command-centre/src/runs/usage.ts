/** Pure helpers for cost/token display and the context meter. */
import type { RunUsage } from "../api";
import type { RunEventView } from "./useRunStream";

export function totalTokens(u: RunUsage | null | undefined): number {
  if (!u) return 0;
  return u.inputTokens + u.outputTokens + (u.cacheReadTokens ?? 0) + (u.cacheWriteTokens ?? 0);
}

/** "$0.0421" style: two decimals from $1 up, otherwise up to four significant decimals. "—" when unknown. */
export function formatUsd(v: number | null | undefined, locale = "en-GB"): string {
  if (v == null || !Number.isFinite(v)) return "—";
  if (v === 0) return "$0";
  const digits = v >= 1 ? 2 : v >= 0.01 ? 3 : 4;
  const s = new Intl.NumberFormat(locale, { minimumFractionDigits: 0, maximumFractionDigits: digits }).format(
    v,
  );
  return `$${s}`;
}

/** 950 → "950", 12_345 → "12.3k", 4_200_000 → "4.2M". */
export function formatTokens(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  const abs = Math.abs(n);
  if (abs < 1000) return String(Math.round(n));
  if (abs < 1_000_000) return `${trim((n / 1000).toFixed(1))}k`;
  return `${trim((n / 1_000_000).toFixed(1))}M`;
}

function trim(s: string): string {
  return s.endsWith(".0") ? s.slice(0, -2) : s;
}

export interface TurnUsage {
  inputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  outputTokens: number;
  model: string | null;
}

/** The most recent per-turn usage frame (Claude's assistant `usage`); null when the provider reports none. */
export function latestTurnUsage(events: readonly RunEventView[]): TurnUsage | null {
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i]!;
    if (e.type !== "usage" || e.scope === "total") continue;
    return {
      inputTokens: num(e.inputTokens),
      cacheReadTokens: num(e.cacheReadTokens),
      cacheWriteTokens: num(e.cacheWriteTokens),
      outputTokens: num(e.outputTokens),
      model: typeof e.model === "string" ? e.model : null,
    };
  }
  return null;
}

/**
 * Tokens occupying the context window at the last turn: everything the
 * model read (fresh input + cache reads + cache writes). Output is not part
 * of the prompt so it is left out.
 */
export function contextUsed(events: readonly RunEventView[]): number | null {
  const turn = latestTurnUsage(events);
  if (!turn) return null;
  return turn.inputTokens + turn.cacheReadTokens + turn.cacheWriteTokens;
}

function num(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}

/** Fold a stream of usage frames the way the RunManager does (live badges before the row is updated). */
export function foldUsage(events: readonly RunEventView[]): RunUsage | null {
  let turns: RunUsage | null = null;
  let total: RunUsage | null = null;
  for (const e of events) {
    if (e.type !== "usage") continue;
    const piece: RunUsage = {
      inputTokens: num(e.inputTokens),
      outputTokens: num(e.outputTokens),
      cacheReadTokens: num(e.cacheReadTokens),
      cacheWriteTokens: num(e.cacheWriteTokens),
      costUsd: typeof e.costUsd === "number" ? e.costUsd : null,
      ...(typeof e.model === "string" ? { model: e.model } : {}),
    };
    if (e.scope === "total") {
      total = piece;
      continue;
    }
    turns = turns
      ? {
          inputTokens: turns.inputTokens + piece.inputTokens,
          outputTokens: turns.outputTokens + piece.outputTokens,
          cacheReadTokens: (turns.cacheReadTokens ?? 0) + (piece.cacheReadTokens ?? 0),
          cacheWriteTokens: (turns.cacheWriteTokens ?? 0) + (piece.cacheWriteTokens ?? 0),
          costUsd:
            turns.costUsd == null && piece.costUsd == null
              ? null
              : (turns.costUsd ?? 0) + (piece.costUsd ?? 0),
          ...((piece.model ?? turns.model) ? { model: piece.model ?? turns.model } : {}),
        }
      : piece;
  }
  if (!total) return turns;
  return total.model || !turns?.model ? total : { ...total, model: turns.model };
}
