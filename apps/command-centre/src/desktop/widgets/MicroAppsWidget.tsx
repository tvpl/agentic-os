/**
 * Micro apps: the OS's own apps, then the connectors that exist but are not
 * configured as ghosts (`.ma-icon.ghost` / `.ma-name.dim`), then "+ Add app".
 *
 * The box picks the shape: the "lg" height tier (9+ rows, maximized, stacked)
 * gets descriptive rows (icon, name, one-line description, arrow; ~52 px
 * each); every shorter tier gets icon tiles with the name only, which never
 * clip. The description stays available to assistive tech in both shapes.
 */
import { Link } from "react-router-dom";
import { Plus } from "lucide-react";
import { useId } from "react";
import { useT } from "../../i18n";
import type { WidgetProps } from "../widgetTypes";
import { heightTier, useWidgetSize } from "../widgetSize";
import { useAppRows } from "../appRows";

export { isConfigured } from "../appRows";

export default function MicroAppsWidget(_props: WidgetProps) {
  const t = useT();
  const size = useWidgetSize();
  const tier = heightTier(size);
  const tiles = tier !== "lg";
  const descId = useId();
  const { apps, pending } = useAppRows(tier === "xs" ? 1 : 2);

  if (tiles) {
    return (
      <div className="microapp-tiles" data-tier={tier}>
        {[...apps, ...pending].map((row, i) => {
          const id = `${descId}-${i}`;
          return (
            <Link
              className={`microapp-tile${row.ghost ? " ghost" : ""}`}
              to={row.to}
              key={row.to}
              title={row.desc}
              aria-describedby={id}
            >
              <span className={`ma-icon${row.ghost ? " ghost" : ""}`}>{row.icon}</span>
              <span className={`ma-name${row.ghost ? " dim" : ""}`}>{row.name}</span>
              <span className="sr-only" id={id}>
                {row.desc}
              </span>
            </Link>
          );
        })}
        <Link className="microapp-tile add" to="/connectors" title={t("desktop.apps.add")}>
          <span className="ma-icon ghost">
            <Plus aria-hidden />
          </span>
          <span className="ma-name dim">{t("desktop.apps.add")}</span>
        </Link>
      </div>
    );
  }

  return (
    <div className="microapp-list" data-tier={tier}>
      {[...apps, ...pending].map((row) => (
        <Link className="microapp-row" to={row.to} key={row.to}>
          <span className={`ma-icon${row.ghost ? " ghost" : ""}`}>{row.icon}</span>
          <span className="ma-text">
            <span className={`ma-name${row.ghost ? " dim" : ""}`}>{row.name}</span>
            <span className="ma-desc">{row.desc}</span>
          </span>
          <span className="ma-arrow" aria-hidden>
            →
          </span>
        </Link>
      ))}
      <Link className="microapp-row add" to="/connectors">
        <span className="ma-icon ghost">
          <Plus aria-hidden />
        </span>
        <span className="ma-text">
          <span className="ma-name dim">{t("desktop.apps.add")}</span>
        </span>
      </Link>
    </div>
  );
}
