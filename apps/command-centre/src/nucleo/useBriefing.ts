/**
 * The day's briefing (refino item 4), moved out of the voice line: the agent
 * says it in the Núcleo, under its own body, instead of a card in the chat.
 * Spoken aloud (hands-free or voice notices) and sent to Telegram once per
 * part of the day, as before; dismissing it marks the notices read.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "../api";
import { useLocale, useT } from "../i18n";
import { useOsMetrics, useOsSettings } from "../queries";
import { getVoiceNotify, speak } from "../hooks/systemNotify";
import { useNotifications } from "../hooks/useNotifications";
import { useDayPhase } from "../hooks/useDayPhase";
import { useApprovals } from "../runs/ApprovalCards";
import { useDesktopRoutines, useDesktopRuns } from "../desktop/data";
import { BRIEFING_KEY, briefingDue, briefingKey, composeBriefing } from "../desktop/briefing";
import { readHandsFree } from "../desktop/console/voice";

export interface Briefing {
  lines: string[];
  dismiss: () => void;
}

export function useBriefing(): Briefing | null {
  const t = useT();
  const locale = useLocale();
  const settings = useOsSettings();
  const runsQ = useDesktopRuns();
  const routinesQ = useDesktopRoutines();
  const approvalsQ = useApprovals({ refetchInterval: 60_000 });
  const metricsQ = useOsMetrics({ refetchInterval: 300_000 });
  const notifications = useNotifications();
  const phase = useDayPhase();
  const [shown, setShown] = useState<string | null>(() => {
    try {
      return localStorage.getItem(BRIEFING_KEY);
    } catch {
      return null;
    }
  });
  const ready = runsQ.data !== undefined && routinesQ.data !== undefined;
  const briefing = useMemo(() => {
    if (!ready || !briefingDue(shown, Date.now(), phase)) return null;
    return composeBriefing(
      {
        runs: runsQ.data ?? [],
        routines: routinesQ.data ?? [],
        pendingApprovals: (approvalsQ.data ?? []).filter((a) => a.status === "pending").length,
        todayUsd: metricsQ.data?.cost?.todayUsd ?? 0,
        now: Date.now(),
        phase,
      },
      t,
    );
  }, [ready, shown, phase, runsQ.data, routinesQ.data, approvalsQ.data, metricsQ.data, t]);

  const spoken = useRef(false);
  const telegram = settings.data?.channels?.telegram?.enabled;
  useEffect(() => {
    if (!briefing || spoken.current) return;
    spoken.current = true;
    if (readHandsFree() || getVoiceNotify()) speak(briefing.spoken, locale, { force: true });
    // Refino item 56: the same briefing reaches the phone, once per key.
    if (telegram) {
      const key = briefingKey(Date.now(), phase);
      try {
        if (localStorage.getItem("mordomo.briefing.sent") === key) return;
        localStorage.setItem("mordomo.briefing.sent", key);
      } catch {
        /* ignore */
      }
      void api
        .post("/api/channels/telegram/send", { text: briefing.lines.join("\n") })
        .catch(() => undefined);
    }
  }, [briefing, locale, telegram, phase]);

  const markAllRead = notifications.markAllRead;
  return useMemo(() => {
    if (!briefing) return null;
    return {
      lines: briefing.lines,
      dismiss: () => {
        const day = briefingKey(Date.now(), phase);
        setShown(day);
        try {
          localStorage.setItem(BRIEFING_KEY, day);
        } catch {
          /* ignore */
        }
        markAllRead();
      },
    };
  }, [briefing, phase, markAllRead]);
}
