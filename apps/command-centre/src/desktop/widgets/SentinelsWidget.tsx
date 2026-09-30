/**
 * What the OS is watching (refino item 32): one row per sentinel — on or
 * off, what it looks for, when it last spoke, and for the folder watcher
 * which folders. The next hourly sweep is the top of the next hour.
 */
import { Eye, EyeOff } from "lucide-react";
import { Link } from "react-router-dom";
import { useLocale, useT, type TKey } from "../../i18n";
import { useApiQuery } from "../../queries";
import { timeAgo } from "../../components/ui";
import { WidgetGate } from "./WidgetGate";
import type { WidgetProps } from "../widgetTypes";

interface SentinelRow {
  id: string;
  enabled: boolean;
  config: Record<string, unknown>;
  lastFiredAt: number | null;
  lastTitle: string | null;
  watched: string[];
}
interface SentinelStatus {
  running: boolean;
  sentinels: SentinelRow[];
}

export default function SentinelsWidget(_props: WidgetProps) {
  const t = useT();
  const locale = useLocale();
  const status = useApiQuery<SentinelStatus>(["sentinels"], "/api/sentinels", { refetchInterval: 60_000 });
  const nextSweep = new Date();
  nextSweep.setMinutes(0, 0, 0);
  nextSweep.setHours(nextSweep.getHours() + 1);
  return (
    <WidgetGate queries={[status]} lines={4}>
      {status.data && (
        <div className="sentinels">
          <p className="dm-note">
            {status.data.running ? t("desktop.sentinels.running") : t("desktop.sentinels.stopped")} ·{" "}
            {t("desktop.sentinels.nextSweep", {
              time: nextSweep.toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" }),
            })}
          </p>
          {status.data.sentinels.map((s) => (
            <div key={s.id} className={`rw sentinel-row${s.enabled ? "" : " off"}`}>
              <span className="sentinel-eye" aria-hidden>
                {s.enabled ? <Eye /> : <EyeOff />}
              </span>
              <span className="sentinel-main">
                <span className="sentinel-name">{t(`apps.settings.sentinel.${s.id}` as TKey)}</span>
                <span className="sentinel-hint">{t(`apps.settings.sentinel.${s.id}Hint` as TKey)}</span>
                {s.watched.length > 0 && (
                  <span className="sentinel-hint mono">
                    {s.watched.map((w) => w.split("/").pop()).join(" · ")}
                  </span>
                )}
              </span>
              <span className="sp" />
              <span className="dm">
                {s.lastFiredAt ? timeAgo(s.lastFiredAt, locale) : t("desktop.sentinels.never")}
              </span>
            </div>
          ))}
          <Link to="/settings?tab=notifications" className="go">
            {t("desktop.sentinels.configure")}
          </Link>
        </div>
      )}
    </WidgetGate>
  );
}
