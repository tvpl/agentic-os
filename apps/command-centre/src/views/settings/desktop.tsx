/** Settings › desktop (split out of Settings.tsx, refino item 17). */
import { useState } from "react";
import { Eye, EyeOff, Plus, Trash2 } from "lucide-react";
import { type MicroApp } from "../../api";

import { useT } from "../../i18n";
import { Button, Field } from "../../components/primitives";
import { WIDGET_ORDER, isWidgetId } from "../../desktop/defaultLayout";
import type { WindowBox } from "../../desktop/windowModel";
import { WIDGET_REGISTRY } from "../../desktop/registry";
import { slugify } from "../shared";
import { type Put } from "../SettingsFields";
import { isValidMicroAppHref } from "./shared";
import type { SettingsShape } from "./shared";

export function DesktopTab({ s, put }: { s: SettingsShape; put: Put }) {
  const t = useT();
  const layout = s.dashboardLayout ?? {};
  const ids = [...new Set([...WIDGET_ORDER, ...Object.keys(layout)])].filter((id) => isWidgetId(id));

  const toggleWidget = (id: string) => {
    // Geometry belongs to the desktop: a widget turned on here opens at a
    // placeholder box and the window layer clamps and places it properly.
    const box: WindowBox = layout[id] ?? { x: 24, y: 24, w: 420, h: 300, z: 1, visible: false };
    void put({ dashboardLayout: { ...layout, [id]: { ...box, visible: !(box.visible ?? true) } } }, true);
  };

  return (
    <div className="stack">
      <div className="card stack">
        <div>
          <h2>{t("apps.settings.widgets")}</h2>
          <p className="hint">{t("apps.settings.widgetsHint")}</p>
        </div>
        <div className="apps-widgets">
          {ids.map((id) => {
            const def = isWidgetId(id) ? WIDGET_REGISTRY[id] : undefined;
            const visible = layout[id]?.visible ?? true;
            return (
              <button
                key={id}
                type="button"
                className="apps-widget-toggle"
                aria-pressed={visible}
                onClick={() => toggleWidget(id)}
              >
                {visible ? <Eye aria-hidden /> : <EyeOff aria-hidden />}
                <span className="truncate">{def ? t(def.titleKey) : id}</span>
                <span className="id">{id}</span>
              </button>
            );
          })}
        </div>
      </div>
      <MicroAppsCard s={s} put={put} />
    </div>
  );
}

function MicroAppsCard({ s, put }: { s: SettingsShape; put: Put }) {
  const t = useT();
  const [rows, setRows] = useState<MicroApp[]>(() => s.microApps ?? []);

  const commit = (next: MicroApp[]) => {
    setRows(next);
    const clean = next.filter((r) => r.name.trim() !== "" && isValidMicroAppHref(r.href));
    void put({ microApps: clean }, true);
  };
  const patchRow = (i: number, patch: Partial<MicroApp>) => {
    const next = rows.map((r, j) => (j === i ? { ...r, ...patch } : r));
    setRows(next);
  };
  const addRow = () => {
    const id = `app-${rows.length + 1}`;
    setRows([...rows, { id, name: "", description: "", href: "" }]);
  };

  return (
    <div className="card stack">
      <div>
        <h2>{t("apps.settings.microApps")}</h2>
        <p className="hint">{t("apps.settings.microAppsHint")}</p>
      </div>
      {rows.length === 0 && <p className="widget-muted">{t("apps.settings.noMicroApps")}</p>}
      {rows.map((row, i) => {
        const hrefOk = row.href.trim() === "" || isValidMicroAppHref(row.href);
        return (
          <div className="apps-ma-row" key={i}>
            <Field label={t("apps.settings.maName")} htmlFor={`ma-name-${i}`}>
              <input
                id={`ma-name-${i}`}
                className="input"
                value={row.name}
                onChange={(e) => patchRow(i, { name: e.target.value, id: slugify(e.target.value) || row.id })}
                onBlur={() => commit(rows)}
              />
            </Field>
            <Field label={t("apps.settings.maDesc")} htmlFor={`ma-desc-${i}`}>
              <input
                id={`ma-desc-${i}`}
                className="input"
                value={row.description}
                onChange={(e) => patchRow(i, { description: e.target.value })}
                onBlur={() => commit(rows)}
              />
            </Field>
            <Field
              label={t("apps.settings.maHref")}
              htmlFor={`ma-href-${i}`}
              error={hrefOk ? undefined : t("apps.settings.maHrefInvalid")}
            >
              <input
                id={`ma-href-${i}`}
                className="input mono"
                value={row.href}
                aria-invalid={!hrefOk}
                placeholder="/pixel"
                onChange={(e) => patchRow(i, { href: e.target.value })}
                onBlur={() => commit(rows)}
              />
            </Field>
            <Button
              size="sm"
              variant="ghost"
              icon={<Trash2 aria-hidden />}
              aria-label={`${t("common.delete")} ${row.name || row.id}`}
              title={t("common.delete")}
              onClick={() => commit(rows.filter((_, j) => j !== i))}
            />
          </div>
        );
      })}
      <div>
        <Button size="sm" icon={<Plus aria-hidden />} onClick={addRow}>
          {t("apps.settings.addMicroApp")}
        </Button>
      </div>
    </div>
  );
}
