/**
 * Every reading the HUD shows, derived once (redesign G5). The ambient strip
 * and the pods draw from the same object, so the strip can never say 3 while
 * a pod says 2 — levels come from `signal.ts`, the one definition of severity.
 */
import { useMemo } from "react";
import { useT } from "../i18n";
import { qk, useApiQuery, useOsMetrics, useOsSettings, useOsSkills } from "../queries";
import { budgetState } from "./budget";
import { useDesktopRoutines, useDesktopRuns } from "./data";
import { useAppRows } from "./appRows";
import {
  attentionItems,
  attentionSignal,
  costSignal,
  pulseSignal,
  routinesSignal,
  runsSignal,
  type SignalValue,
} from "./signal";

interface Approval {
  id: string;
}

export interface DesktopSignals {
  pulse: SignalValue;
  attention: SignalValue & { count: number };
  runs: SignalValue;
  routines: SignalValue;
  cost: SignalValue & { todayUsd: number };
  approvals: number;
  /** Skills enabled, for the Skills pod. */
  skills: number;
  /** Connectors not configured yet, for the Connectors pod. */
  pendingConnectors: number;
  /** Runs in flight, for the live pods. */
  activeRuns: number;
}

export function useDesktopSignals(activeRuns: number): DesktopSignals {
  const t = useT();
  const { pending } = useAppRows(3);
  const metrics = useOsMetrics({ refetchInterval: 300_000 });
  const skills = useOsSkills();
  const routines = useDesktopRoutines();
  const runs = useDesktopRuns();
  const settings = useOsSettings();
  const approvals = useApiQuery<Approval[]>(qk.approvals, "/api/approvals", { refetchInterval: 300_000 });
  return useMemo<DesktopSignals>(() => {
    const runList = runs.data ?? [];
    // "done" is the canonical success status (core/src/runs/runManager.ts).
    const finished = runList.filter(
      (r) => r.status === "done" || r.status === "failed" || r.status === "timed_out",
    );
    const succeeded = finished.filter((r) => r.status === "done").length;
    const routineList = routines.data ?? [];
    const due = routineList.filter((r) => r.enabled).length;
    const fired = routineList.filter((r) => r.enabled && r.healthy).length;
    const budgetUsd = settings.data?.limits?.dailyBudgetUsd;
    const todayUsd = metrics.data?.cost?.todayUsd ?? 0;
    const budget = budgetState(budgetUsd, todayUsd);
    const approvalCount = approvals.data?.length ?? 0;
    const attentionCount = attentionItems({
      failures: runList.filter((r) => r.status === "failed" || r.status === "timed_out").length,
      unhealthyRoutines: routineList.filter((r) => !r.healthy).length,
      approvals: approvalCount,
      budgetHot: budget.tone === "warn" || budget.tone === "over",
    });
    return {
      pulse: pulseSignal(succeeded, finished.length),
      attention: { ...attentionSignal(attentionCount), count: attentionCount },
      runs: runsSignal(activeRuns),
      routines: routinesSignal(fired, due),
      cost: { ...costSignal(budgetUsd, todayUsd), todayUsd },
      approvals: approvalCount,
      skills: (skills.data ?? []).filter((s) => s.enabled).length,
      pendingConnectors: pending.length,
      activeRuns,
    };
    // `t` is not read here, but the labels are user-facing and change with it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    runs.data,
    routines.data,
    settings.data,
    metrics.data,
    approvals.data,
    skills.data,
    pending,
    activeRuns,
    t,
  ]);
}
