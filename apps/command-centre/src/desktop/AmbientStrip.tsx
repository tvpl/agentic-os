/**
 * The ambient strip (redesign F3): the desktop's permanent line of state.
 *
 * It replaces `HudTelemetry`, which printed every number at the same muted
 * weight — 23 % success and a clock looked identical, so nothing read as
 * urgent. Here each reading is a `SignalValue`: `idle` stays muted, `warn` and
 * `critical` are the only ones that take colour. A glance answers "does
 * anything need me?" without opening a widget.
 *
 * Readings that own a widget are buttons: pressing one opens that widget's
 * surface, so the strip is an entry point and not just a label.
 */
import { useLocale, useT, type TKey } from "../i18n";
import { qk, useApiQuery, useOsMetrics, useOsSettings, useOsSkills } from "../queries";
import { budgetState } from "./budget";
import { useDesktopRoutines, useDesktopRuns } from "./data";
import {
  attentionItems,
  attentionSignal,
  costSignal,
  isLit,
  pulseSignal,
  routinesSignal,
  runsSignal,
  type SignalValue,
} from "./signal";
import { useTweenNumber } from "./useTweenNumber";

interface MemoryStatus {
  facets: { total: number };
}
interface Approval {
  id: string;
}

function compact(n: number, locale: string): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toLocaleString(locale, { maximumFractionDigits: 1 })}M`;
  if (n >= 1_000) return `${(n / 1_000).toLocaleString(locale, { maximumFractionDigits: 1 })}k`;
  return Math.round(n).toLocaleString(locale);
}

function Reading({
  labelKey,
  signal,
  onOpen,
  title,
}: {
  labelKey: TKey;
  signal: SignalValue;
  onOpen?: () => void;
  title?: string;
}) {
  const t = useT();
  const label = t(labelKey);
  const body = (
    <>
      <span className="sig-k">{label}</span>
      <span className="sig-v">{signal.value}</span>
    </>
  );
  const className = `sig${isLit(signal.level) ? " lit" : ""}`;
  if (!onOpen)
    return (
      <span className={className} data-level={signal.level} title={title ?? signal.label}>
        {body}
      </span>
    );
  return (
    <button
      type="button"
      className={className}
      data-level={signal.level}
      onClick={onOpen}
      // The value alone is meaningless to a screen reader ("Attention, 3"),
      // so the accessible name carries the sentence the tooltip shows.
      aria-label={`${label}: ${signal.label}`}
      title={title ?? signal.label}
    >
      {body}
    </button>
  );
}

export interface AmbientStripProps {
  activeRuns: number;
  /** Opens a widget's surface; absent for widgets the layout does not hold. */
  onExpand?: (widgetId: string) => void;
}

export default function AmbientStrip({ activeRuns, onExpand }: AmbientStripProps) {
  const t = useT();
  const locale = useLocale();
  const metrics = useOsMetrics({ refetchInterval: 300_000 });
  const memory = useApiQuery<MemoryStatus>(qk.memoryStatus, "/api/memory/status", {
    refetchInterval: 300_000,
  });
  const skills = useOsSkills();
  const routines = useDesktopRoutines();
  const runs = useDesktopRuns();
  const settings = useOsSettings();
  // Approvals are optional: a failure here only drops them from the count.
  const approvals = useApiQuery<Approval[]>(qk.approvals, "/api/approvals", { refetchInterval: 300_000 });

  const cost = metrics.data?.cost;
  const tokensPerHour = useTweenNumber(cost?.burnRatePerHour ?? 0, 600);
  const files = useTweenNumber(memory.data?.facets.total ?? 0, 600);
  const skillCount = (skills.data ?? []).filter((s) => s.enabled).length;

  const runList = runs.data ?? [];
  // "done" is the canonical success status (core/src/runs/runManager.ts).
  // Guessing "succeeded" made the strip read 0 % while the Pulse widget read
  // 29 % on the same runs — the disagreement the shared module exists to stop.
  const finished = runList.filter(
    (r) => r.status === "done" || r.status === "failed" || r.status === "timed_out",
  );
  const succeeded = finished.filter((r) => r.status === "done").length;

  const routineList = routines.data ?? [];
  const dueToday = routineList.filter((r) => r.enabled).length;
  const firedToday = routineList.filter((r) => r.enabled && r.healthy).length;

  const budget = budgetState(settings.data?.limits?.dailyBudgetUsd, cost?.todayUsd);
  const attention = attentionItems({
    failures: runList.filter((r) => r.status === "failed" || r.status === "timed_out").length,
    unhealthyRoutines: routineList.filter((r) => !r.healthy).length,
    approvals: approvals.data?.length ?? 0,
    budgetHot: budget.tone === "warn" || budget.tone === "over",
  });

  return (
    <>
      <div className="ambient-strip bl">
        <Reading
          labelKey="desktop.hud.runs"
          signal={runsSignal(activeRuns)}
          onOpen={onExpand ? () => onExpand("now") : undefined}
        />
        <span className="sig" data-level="idle" title={t("desktop.hud.tokensPerHour")}>
          <span className="sig-k">{t("desktop.hud.tokensPerHour")}</span>
          <span className="sig-v">{compact(tokensPerHour, locale)}</span>
        </span>
        <Reading
          labelKey="desktop.hud.today"
          signal={costSignal(settings.data?.limits?.dailyBudgetUsd, cost?.todayUsd)}
          onOpen={onExpand ? () => onExpand("cost") : undefined}
        />
      </div>
      <div className="ambient-strip br">
        <span className="sig" data-level="idle" title={t("desktop.hud.memory")}>
          <span className="sig-k">{t("desktop.hud.memory")}</span>
          <span className="sig-v">{compact(files, locale)}</span>
        </span>
        <span className="sig" data-level="idle" title={t("desktop.hud.skills")}>
          <span className="sig-k">{t("desktop.hud.skills")}</span>
          <span className="sig-v">{skillCount}</span>
        </span>
        <Reading
          labelKey="desktop.widget.pulse"
          signal={pulseSignal(succeeded, finished.length)}
          onOpen={onExpand ? () => onExpand("pulse") : undefined}
        />
        <Reading
          labelKey="desktop.hud.routines"
          signal={routinesSignal(firedToday, dueToday)}
          onOpen={onExpand ? () => onExpand("routines") : undefined}
        />
        <Reading
          labelKey="desktop.widget.attention"
          signal={attentionSignal(attention)}
          onOpen={onExpand ? () => onExpand("attention") : undefined}
        />
      </div>
    </>
  );
}
