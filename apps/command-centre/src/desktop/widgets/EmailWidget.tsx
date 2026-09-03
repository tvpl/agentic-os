/**
 * Email (read-only) on the connector data contract (`email-gmail`): count in
 * the past 24 h, "flagged · needs you" rows with age, and the segmented
 * "today's mix" bar from `summary`. Setup step when not configured.
 */
import { Link } from "react-router-dom";
import { Mail } from "lucide-react";
import { useT } from "../../i18n";
import { EmptyState } from "../../components/primitives";
import { AREA_COLORS, shortAge, useConnectorData, useTicker } from "../data";
import { useTweenNumber } from "../useTweenNumber";
import { cfgNumber, cfgString, type WidgetProps } from "../widgetTypes";
import { SyncedAt } from "./CalendarWidget";
import { WidgetGate } from "./WidgetGate";

export default function EmailWidget({ config }: WidgetProps) {
  const t = useT();
  const id = cfgString(config, "connector", "email-gmail");
  const limit = cfgNumber(config, "limit", 3);
  const data = useConnectorData(id);
  const now = useTicker(30_000);
  const dayAgo = now - 86_400_000;
  const items = data.data?.items ?? [];
  const recent = items.filter((i) => !i.ts || i.ts >= dayAgo).length;
  const count = useTweenNumber(recent);
  const flagged = items.filter((i) => i.flagged).sort((a, b) => (b.ts ?? 0) - (a.ts ?? 0)).slice(0, limit);
  const mix = Object.entries(data.data?.summary ?? {}).filter(([, n]) => n > 0);
  const total = mix.reduce((s, [, n]) => s + n, 0);
  return (
    <WidgetGate queries={[data]} lines={3}>
      {data.data && data.data.status === "not_configured" && (
        <EmptyState
          className="compact"
          icon={<Mail aria-hidden />}
          title={t("desktop.email.setupTitle")}
          body={t("desktop.email.setupBody")}
          action={
            <Link to={`/connectors#${encodeURIComponent(id)}`} className="btn sm primary">
              {t("desktop.connector.configure")}
            </Link>
          }
        />
      )}
      {data.data && data.data.status === "error" && (
        <div className="widget-error" role="alert">
          <strong>{t("widget.error")}</strong>
          {data.data.message && <span className="widget-error-msg">{data.data.message}</span>}
        </div>
      )}
      {data.data && data.data.status === "ok" && (
        <>
          <div className="stat ws-total">
            <span className="value accented tnum">{Math.round(count)}</span>
            <span className="label">{t("desktop.email.past24h")}</span>
          </div>
          <div className="hud-label email-flagged-label">{t("desktop.email.flagged")}</div>
          {flagged.length === 0 ? (
            <p className="widget-muted">{t("desktop.email.nothingFlagged")}</p>
          ) : (
            flagged.map((m) => (
              <a key={m.id} className="email-row" href={m.href} target={m.href ? "_blank" : undefined} rel="noreferrer" title={m.subtitle}>
                <span className="email-dot" aria-hidden />
                <span className="truncate">{m.title}</span>
                {m.tag && <span className="badge dim">{m.tag}</span>}
                <span className="email-age mono">{m.ts ? shortAge(m.ts, now) : ""}</span>
              </a>
            ))
          )}
          {total > 0 && (
            <div className="email-mix">
              <div className="hud-label">{t("desktop.email.mix")}</div>
              <div className="email-bar" role="img" aria-label={mix.map(([k, n]) => `${n} ${k}`).join(" · ")}>
                {mix.map(([k, n], i) => (
                  <span key={k} className="email-seg" style={{ flexGrow: n, background: AREA_COLORS[i % AREA_COLORS.length] }} title={`${n} ${k}`} />
                ))}
              </div>
              <div className="email-legend">
                {mix.map(([k, n], i) => (
                  <span key={k} className="email-key">
                    <span className="email-swatch" style={{ background: AREA_COLORS[i % AREA_COLORS.length] }} aria-hidden />
                    <span className="tnum">{n}</span> {k}
                  </span>
                ))}
              </div>
            </div>
          )}
          <SyncedAt data={data.data} />
        </>
      )}
    </WidgetGate>
  );
}
