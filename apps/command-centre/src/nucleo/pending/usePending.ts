/**
 * The live pendências: approvals, runs, routines, the default provider, the
 * day's budget and unread notices, folded into one ordered list (model.ts).
 * Approvals refetch on their own events so a decision appears the moment the
 * agent pauses.
 */
import { useCallback, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { qk, useOsMetrics, useOsProviders, useOsSettings } from "../../queries";
import { useApprovals } from "../../runs/ApprovalCards";
import { useOsEvent } from "../../hooks/useEventStream";
import { useNotifications } from "../../hooks/useNotifications";
import { providerProblem } from "../../components/providerReadiness";
import { useDesktopRoutines, useDesktopRuns } from "../../desktop/data";
import { budgetState } from "../../desktop/budget";
import { mute, readMuted } from "../../desktop/attentionMute";
import { buildPending, loudest, pendingCount, type PendingItem, type PendingLevel } from "./model";

export interface Pending {
  items: PendingItem[];
  count: number;
  level: PendingLevel | null;
  silence: (runId: string) => void;
}

export function usePending(): Pending {
  const qc = useQueryClient();
  const approvals = useApprovals({ refetchInterval: 15_000 });
  useOsEvent(["approval.requested", "approval.resolved"], () => {
    qc.invalidateQueries({ queryKey: qk.approvals }).catch(() => undefined);
  });
  const runs = useDesktopRuns();
  const routines = useDesktopRoutines();
  const providers = useOsProviders();
  const settings = useOsSettings();
  const metrics = useOsMetrics({ refetchInterval: 300_000 });
  const notifications = useNotifications();
  const [muted, setMuted] = useState(() => readMuted());
  const silence = useCallback((id: string) => setMuted((cur) => mute(cur, id)), []);

  const items = useMemo(() => {
    const enabled = (providers.data ?? []).filter((p) => p.enabled);
    const def = enabled.find((p) => p.isDefault) ?? enabled[0];
    const budget = budgetState(settings.data?.limits?.dailyBudgetUsd, metrics.data?.cost?.todayUsd);
    return buildPending({
      approvals: approvals.data,
      runs: runs.data,
      routines: routines.data,
      provider: def ? { snapshot: def, problem: providerProblem(def) } : null,
      budget: { tone: budget.tone, ratio: budget.ratio },
      notifications: notifications.items,
      muted,
      now: Date.now(),
    });
  }, [
    approvals.data,
    runs.data,
    routines.data,
    providers.data,
    settings.data,
    metrics.data,
    notifications.items,
    muted,
  ]);
  return useMemo(
    () => ({ items, count: pendingCount(items), level: loudest(items), silence }),
    [items, silence],
  );
}
