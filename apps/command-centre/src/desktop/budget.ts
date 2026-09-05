/**
 * Daily budget (plan Onda 2 §5): `settings.limits.dailyBudgetUsd` against
 * `metrics.cost.todayUsd`. Pure so widgets and tests share one rule:
 * under 80 % is fine, 80–100 % warns, at or above 100 % is over.
 */
export type BudgetTone = "off" | "ok" | "warn" | "over";

export interface BudgetState {
  budgetUsd: number;
  spentUsd: number;
  /** 0–1, capped at 1.5 for the bar. */
  ratio: number;
  tone: BudgetTone;
}

export function budgetState(budgetUsd: number | undefined, spentUsd: number | undefined): BudgetState {
  const budget = typeof budgetUsd === "number" && Number.isFinite(budgetUsd) && budgetUsd > 0 ? budgetUsd : 0;
  const spent = typeof spentUsd === "number" && Number.isFinite(spentUsd) ? Math.max(0, spentUsd) : 0;
  if (budget === 0) return { budgetUsd: 0, spentUsd: spent, ratio: 0, tone: "off" };
  const ratio = Math.min(1.5, spent / budget);
  const tone: BudgetTone = ratio >= 1 ? "over" : ratio >= 0.8 ? "warn" : "ok";
  return { budgetUsd: budget, spentUsd: spent, ratio, tone };
}
