/**
 * Telemetry strips in the bottom corners of the desktop (plan §6.3): runs,
 * tokens per hour and today's spend on the left; indexed files, skills and
 * routines on the right. Mono, tabular, uppercase — instrumentation, not a
 * widget. Numbers tween so a change reads as an odometer tick. Hidden below
 * the stack breakpoint and faded by `--hud-intensity`.
 */
import { useLocale, useT } from "../i18n";
import { qk, useApiQuery, useOsMetrics, useOsSkills } from "../queries";
import { useDesktopRoutines } from "./data";
import { useTweenNumber } from "./useTweenNumber";

interface MemoryStatus {
  facets: { total: number };
}

function compact(n: number, locale: string): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toLocaleString(locale, { maximumFractionDigits: 1 })}M`;
  if (n >= 1_000) return `${(n / 1_000).toLocaleString(locale, { maximumFractionDigits: 1 })}k`;
  return Math.round(n).toLocaleString(locale);
}

export default function HudTelemetry({ activeRuns }: { activeRuns: number }) {
  const t = useT();
  const locale = useLocale();
  const metrics = useOsMetrics({ refetchInterval: 60_000 });
  const memory = useApiQuery<MemoryStatus>(qk.memoryStatus, "/api/memory/status", {
    refetchInterval: 120_000,
  });
  const skills = useOsSkills();
  const routines = useDesktopRoutines();

  const cost = metrics.data?.cost;
  const tokensPerHour = useTweenNumber(cost?.burnRatePerHour ?? 0, 600);
  const todayUsd = useTweenNumber(cost?.todayUsd ?? 0, 600);
  const files = useTweenNumber(memory.data?.facets.total ?? 0, 600);
  const skillCount = (skills.data ?? []).filter((s) => s.enabled).length;
  const routineOn = (routines.data ?? []).filter((r) => r.enabled).length;
  const routineAll = routines.data?.length ?? 0;

  return (
    <>
      <div className="hud-telemetry bl">
        <span>
          {t("desktop.hud.runs")} <b>{activeRuns}</b> · {t("desktop.hud.tokensPerHour")}{" "}
          <b>{compact(tokensPerHour, locale)}</b>
        </span>
        <span>
          {t("desktop.hud.today")}{" "}
          <i>
            {todayUsd.toLocaleString(locale, {
              style: "currency",
              currency: "USD",
              maximumFractionDigits: 2,
            })}
          </i>
        </span>
      </div>
      <div className="hud-telemetry br">
        <span>
          {t("desktop.hud.memory")} <b>{compact(files, locale)}</b> · {t("desktop.hud.skills")}{" "}
          <b>{skillCount}</b>
        </span>
        <span>
          {t("desktop.hud.routines")}{" "}
          <b>
            {routineOn}/{routineAll}
          </b>
        </span>
      </div>
    </>
  );
}
