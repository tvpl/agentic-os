/**
 * Calendar (read-only) on the connector data contract (`calendar-google`):
 * today's events with times and an "open" link; a compact setup step when
 * the connector is not configured. Never a blank placeholder.
 */
import { Link } from "react-router-dom";
import { CalendarDays, ExternalLink } from "lucide-react";
import type { ConnectorData } from "../../api";
import { useLocale, useT } from "../../i18n";
import { EmptyState } from "../../components/primitives";
import { sameLocalDay, useConnectorData, useTicker } from "../data";
import { cfgString, type WidgetProps } from "../widgetTypes";
import { WidgetGate } from "./WidgetGate";

export function ConnectorSetup({ id, title, body }: { id: string; title: string; body: string }) {
  const t = useT();
  return (
    <EmptyState
      className="compact"
      icon={<CalendarDays aria-hidden />}
      title={title}
      body={body}
      action={
        <Link to={`/connectors#${encodeURIComponent(id)}`} className="btn sm primary">
          {t("desktop.connector.configure")}
        </Link>
      }
    />
  );
}

export function SyncedAt({ data }: { data: ConnectorData }) {
  const t = useT();
  const locale = useLocale();
  if (!data.syncedAt) return null;
  return (
    <div className="conn-synced hud-label">
      {t("desktop.connector.synced", {
        time: new Date(data.syncedAt).toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" }),
      })}
    </div>
  );
}

export default function CalendarWidget({ config }: WidgetProps) {
  const t = useT();
  const locale = useLocale();
  const id = cfgString(config, "connector", "calendar-google");
  const data = useConnectorData(id);
  const now = useTicker(30_000);
  return (
    <WidgetGate queries={[data]} lines={3}>
      {data.data && data.data.status === "not_configured" && (
        <ConnectorSetup
          id={id}
          title={t("desktop.calendar.setupTitle")}
          body={t("desktop.calendar.setupBody")}
        />
      )}
      {data.data && data.data.status === "error" && (
        <div className="widget-error" role="alert">
          <strong>{t("widget.error")}</strong>
          {data.data.message && <span className="widget-error-msg">{data.data.message}</span>}
          <Link to={`/connectors#${encodeURIComponent(id)}`} className="btn sm">
            {t("desktop.connector.configure")}
          </Link>
        </div>
      )}
      {data.data && data.data.status === "ok" && (
        <>
          {data.data.items.filter((e) => !e.ts || sameLocalDay(e.ts, now)).length === 0 ? (
            <p className="widget-muted">{t("desktop.calendar.free")}</p>
          ) : (
            data.data.items
              .filter((e) => !e.ts || sameLocalDay(e.ts, now))
              .sort((a, b) => (a.ts ?? 0) - (b.ts ?? 0))
              .slice(0, 6)
              .map((e) => {
                const past = !!e.ts && e.ts < now;
                return (
                  <div key={e.id} className={`cal-row${past ? " past" : ""}`}>
                    <span className="cal-time mono">
                      {e.ts
                        ? new Date(e.ts).toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" })
                        : "—"}
                    </span>
                    <span className="cal-title truncate" title={e.subtitle}>
                      {e.title}
                    </span>
                    {e.href && (
                      <a
                        className="cal-open"
                        href={e.href}
                        target="_blank"
                        rel="noreferrer"
                        aria-label={`${t("common.open")}: ${e.title}`}
                      >
                        <ExternalLink aria-hidden />
                      </a>
                    )}
                  </div>
                );
              })
          )}
          <SyncedAt data={data.data} />
        </>
      )}
    </WidgetGate>
  );
}
