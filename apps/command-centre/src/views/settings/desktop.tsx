/** Settings › desktop (split out of Settings.tsx, refino item 17). */
import { useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { type MicroApp } from "../../api";

import { useT } from "../../i18n";
import { Button, Field } from "../../components/primitives";
import { errorMessage, isOffline, slugify } from "../shared";
import { type Put } from "../SettingsFields";
import { isValidMicroAppHref } from "./shared";
import type { SettingsShape } from "./shared";
import { useOsUiPreferences, useSaveUiPreferences } from "../../queries";
import { ErrorBox, Skeleton, useToast } from "../../components/ui";
import { Tooltip } from "../../ui";

export function DesktopTab(_props: { s: SettingsShape; put: Put }) {
  // The instruments are projected on demand now (lâminas), so there is no
  // desktop composition to toggle; what stays here is the user's own apps.
  const preferences = useOsUiPreferences();
  if (preferences.error && !preferences.data)
    return (
      <div className="card">
        <ErrorBox
          message={errorMessage(preferences.error)}
          offline={isOffline(preferences.error)}
          onRetry={() => void preferences.refetch()}
        />
      </div>
    );
  if (!preferences.data)
    return (
      <div className="card">
        <Skeleton lines={3} />
      </div>
    );
  return (
    <div className="stack">
      <MicroAppsCard initial={preferences.data.microApps} />
    </div>
  );
}

function MicroAppsCard({ initial }: { initial: MicroApp[] }) {
  const t = useT();
  const toast = useToast();
  const savePreferences = useSaveUiPreferences();
  const [rows, setRows] = useState<MicroApp[]>(() => initial);

  const commit = (next: MicroApp[]) => {
    setRows(next);
    const clean = next.filter((r) => r.name.trim() !== "" && isValidMicroAppHref(r.href));
    void savePreferences({ microApps: clean }).catch((err: Error) => toast(err.message, "danger"));
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
            <Tooltip label={t("common.delete")}>
              <Button
                size="sm"
                variant="ghost"
                icon={<Trash2 aria-hidden />}
                aria-label={`${t("common.delete")} ${row.name || row.id}`}
                onClick={() => commit(rows.filter((_, j) => j !== i))}
              />
            </Tooltip>
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
