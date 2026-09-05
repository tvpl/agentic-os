/**
 * Onboarding (plan Onda 2 §7): the first step of the 7-day plan that is still
 * open, so the Now panel can point at it. Pure and tested; the panel reads
 * the state and remembers dismissals.
 */
export type StepId = "folder" | "run" | "routine" | "budget" | "connector";

export interface OnboardingState {
  folders: number;
  runs: number;
  routinesEnabled: number;
  budgetUsd: number;
  connectorsConfigured: number;
}

/** Pure: the first step that is still open, in the order of the 7-day plan. */
export function nextStep(state: OnboardingState, dismissed: ReadonlySet<StepId>): StepId | null {
  const order: Array<[StepId, boolean]> = [
    ["folder", state.folders === 0],
    ["run", state.runs === 0],
    ["routine", state.routinesEnabled === 0],
    ["budget", state.budgetUsd <= 0],
    ["connector", state.connectorsConfigured === 0],
  ];
  for (const [id, open] of order) if (open && !dismissed.has(id)) return id;
  return null;
}
