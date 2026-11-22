/**
 * The weekly review's entries (.specs/features/cerebro-rituais, design.md "Entradas"): the list both the
 * page and the brain's toolbar read (`GET /api/memory/weekly-review` for the active context), the short day the screens
 * write ("12/11", G18) and the toolbar's "Revisão semanal". The page itself is a chunk of its own (`weekly/`).
 */
import { CalendarCheck, Check } from "lucide-react";
import { useT } from "../i18n";
import { useOsUiPreferences, useRouteQuery } from "../queries";
import { useWorkContext } from "../contexts/useWorkContext";
import { useBrainMode } from "./BrainViewSwitch";

/** The week's list for the active context (the same cache for the page and the toolbar). */
export function useWeeklyReview() {
  const work = useWorkContext();
  // The active context is read from the preferences: before they are, a read would be the whole brain's.
  const prefs = useOsUiPreferences();
  const query = work.query ? { context: work.query } : {};
  return useRouteQuery(
    ["memory", "weekly", query],
    "GET /api/memory/weekly-review",
    { query },
    { enabled: prefs.isSuccess && work.ready, staleTime: 30_000 },
  );
}

/** A local day as `d/MM` ("3/11", "12/11"), G18. */
export const shortDay = (at: Date) => `${at.getDate()}/${String(at.getMonth() + 1).padStart(2, "0")}`;

/** The toolbar's button (G17): after "Revisões (N)", or after "Faxina" with none; `Check` once the week is finished. */
export function WeeklyButton() {
  const t = useT();
  const { go } = useBrainMode();
  const at = useWeeklyReview().data?.finishedAt ?? null;
  return (
    <button
      className="btn sm"
      onClick={() => go("weekly")}
      title={at === null ? undefined : t("weekly.finishedButton", { day: shortDay(new Date(at)) })}
    >
      {at === null ? <CalendarCheck aria-hidden /> : <Check aria-hidden />} {t("weekly.title")}
    </button>
  );
}
