/**
 * Today (design Tela 2): what asks for attention today, as six cards in a
 * fixed reading order. Each card is an instrument the Núcleo projects as a
 * lâmina; here they sit side by side.
 */
import { useEffect, useState } from "react";
import { useLocale, useT, type TKey } from "../i18n";
import { WIDGET_REGISTRY } from "../desktop/registry";
import type { WidgetId } from "../desktop/defaultLayout";

const TODAY_CARDS: ReadonlyArray<{ widget: WidgetId; titleKey: TKey }> = [
  { widget: "approvals", titleKey: "moldura.today.approvals" },
  { widget: "now", titleKey: "moldura.today.now" },
  { widget: "routines", titleKey: "moldura.today.routines" },
  { widget: "inbox", titleKey: "moldura.today.inbox" },
  { widget: "journal", titleKey: "moldura.today.journal" },
  { widget: "cost", titleKey: "moldura.today.cost" },
];

/** The current time, renewed at each local midnight: a tab left open overnight shows the new day. */
function useToday(): Date {
  const [today, setToday] = useState(() => new Date());
  useEffect(() => {
    const midnight = new Date(today);
    midnight.setHours(24, 0, 0, 0);
    const timer = window.setTimeout(() => setToday(new Date()), midnight.getTime() - today.getTime());
    return () => window.clearTimeout(timer);
  }, [today]);
  return today;
}

export default function Today() {
  const t = useT();
  const locale = useLocale();
  const today = useToday();
  const date = new Intl.DateTimeFormat(locale, { weekday: "long", day: "numeric", month: "long" }).format(
    today,
  );
  return (
    <div className="page mold-today">
      <h2 className="mold-today-h">
        <span>{t("moldura.nav.today")}</span>
        <span className="mold-today-sep" aria-hidden>
          ·
        </span>
        <span className="mold-today-date">{date}</span>
      </h2>
      <div className="mold-cards">
        {TODAY_CARDS.map(({ widget, titleKey }) => {
          const { Component, icon } = WIDGET_REGISTRY[widget];
          return (
            <section
              key={widget}
              className="mold-card"
              data-widget={widget}
              aria-labelledby={`mold-card-${widget}`}
            >
              <h3 className="mold-card-t" id={`mold-card-${widget}`}>
                <span className="mold-card-i" aria-hidden>
                  {icon}
                </span>
                {t(titleKey)}
              </h3>
              <div className="mold-card-b">
                <Component instanceId={widget} />
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}
