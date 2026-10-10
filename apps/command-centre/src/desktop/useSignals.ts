/**
 * Every reading the HUD shows, derived once (redesign G5). The ambient strip
 * and the pods draw from the same object, so the strip can never say 3 while
 * a pod says 2 — levels come from `signal.ts`, the one definition of severity.
 */
import { useMemo } from "react";
import { useLocale, useT } from "../i18n";
import { qk, useApiQuery, useOsMetrics, useOsSettings, useOsSkills } from "../queries";
import { isPairedDevice, type DoctorReport, type UpdateCheck } from "../api";
import { budgetState } from "./budget";
import { useDesktopRoutines, useDesktopRuns } from "./data";
import { useAppRows } from "./appRows";
import {
  attentionSignal,
  costSignal,
  isFreshFailure,
  pulseSignal,
  routinesSignal,
  healthSignal,
  runsSignal,
  withLabel,
  type LabelledSignal,
} from "./signal";

interface Approval {
  id: string;
}

export interface DesktopSignals {
  pulse: LabelledSignal;
  attention: LabelledSignal & { count: number; stale: number };
  runs: LabelledSignal;
  routines: LabelledSignal;
  cost: LabelledSignal & { todayUsd: number };
  approvals: number;
  /** Skills enabled, for the Skills pod. */
  skills: number;
  /** Connectors not configured yet, for the Connectors pod. */
  pendingConnectors: number;
  /** Runs in flight, for the live pods. */
  activeRuns: number;
  /** The service's own health (refino item 58). */
  health: LabelledSignal;
  /** Telegram: off, on, or polling for replies (refino item 56). */
  telegram: "off" | "on" | "polling";
  /** Paired devices (refino item 57). */
  devices: number;
}

export function useDesktopSignals(activeRuns: number): DesktopSignals {
  const t = useT();
  const locale = useLocale();
  const { pending } = useAppRows(3);
  const metrics = useOsMetrics({ refetchInterval: 300_000 });
  const skills = useOsSkills();
  const routines = useDesktopRoutines();
  const runs = useDesktopRuns();
  const settings = useOsSettings();
  const approvals = useApiQuery<Approval[]>(qk.approvals, "/api/approvals", { refetchInterval: 300_000 });
  const doctor = useApiQuery<DoctorReport>(qk.doctor, "/api/doctor?audit=0", { refetchInterval: 600_000 });
  const updates = useApiQuery<UpdateCheck>(["updates"], "/api/updates", { refetchInterval: 1_800_000 });
  const telegram = useApiQuery<{ inbound: boolean; polling: boolean }>(
    ["channels", "telegram"],
    "/api/channels/telegram/status",
    {
      refetchInterval: 300_000,
      retry: false,
    },
  );
  // The device list is the owner's (escopos-dispositivo): a paired phone does not ask for it.
  const devices = useApiQuery<{ devices: unknown[] }>(["devices"], "/api/devices", {
    refetchInterval: 300_000,
    retry: false,
    enabled: !isPairedDevice(),
  });
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
    // A failure has a half-life (refino item 21): younger than a day it asks
    // for a look; older it is listed but never lit, so last week's failures
    // cannot paint today's HUD red.
    const now = Date.now();
    const failed = runList.filter((r) => r.status === "failed" || r.status === "timed_out");
    const fresh = failed.filter((r) => isFreshFailure(r.finishedAt ?? r.createdAt, now)).length;
    const attention = attentionSignal({
      failures: fresh,
      staleFailures: failed.length - fresh,
      unhealthyRoutines: routineList.filter((r) => !r.healthy).length,
      approvals: approvalCount,
      budgetHot: budget.tone === "warn",
      budgetOver: budget.tone === "over",
    });
    return {
      pulse: withLabel(pulseSignal(succeeded, finished.length), t),
      attention: { ...withLabel(attention, t), stale: failed.length - fresh },
      runs: withLabel(runsSignal(activeRuns), t),
      routines: withLabel(routinesSignal(fired, due), t),
      cost: {
        ...withLabel(
          costSignal(budgetUsd, todayUsd, (n) =>
            n.toLocaleString(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
          ),
          t,
        ),
        todayUsd,
      },
      approvals: approvalCount,
      skills: (skills.data ?? []).filter((s) => s.enabled).length,
      pendingConnectors: pending.length,
      activeRuns,
      health: withLabel(healthSignal(doctor.data, updates.data), t),
      telegram: !settings.data?.channels?.telegram?.enabled
        ? "off"
        : telegram.data?.polling
          ? "polling"
          : "on",
      devices: devices.data?.devices.length ?? 0,
    };
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
    locale,
    doctor.data,
    updates.data,
    telegram.data,
    devices.data,
  ]);
}
