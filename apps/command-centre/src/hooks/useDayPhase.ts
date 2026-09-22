import { useEffect, useState } from "react";
import { dayPhase, type DayPhase } from "./rhythm";

/** The phase of the day, re-read every minute (refino item 53). */
export function useDayPhase(): DayPhase {
  const [phase, setPhase] = useState<DayPhase>(() => dayPhase());
  useEffect(() => {
    const id = window.setInterval(() => setPhase(dayPhase()), 60_000);
    return () => window.clearInterval(id);
  }, []);
  return phase;
}
