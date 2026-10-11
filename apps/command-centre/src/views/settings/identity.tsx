/** Settings › identity (split out of Settings.tsx, refino item 17). */
import { useMutation } from "@tanstack/react-query";
import { type SystemInfo, type UpdateCheck } from "../../api";
import { apiCall } from "../../apiCall";

import { useT, type Lang } from "../../i18n";
import { useApiQuery } from "../../queries";
import { Button } from "../../components/primitives";
import { errorMessage } from "../shared";
import { IdentityFields, ReadOnlyPathField, type Put } from "../SettingsFields";
import type { SettingsShape } from "./shared";

export function IdentityTab({ s, put, setLang }: { s: SettingsShape; put: Put; setLang: (l: Lang) => void }) {
  return (
    <div className="card stack">
      <IdentityFields s={s} put={put} setLang={setLang} />
      <SystemInfoFields s={s} put={put} />
    </div>
  );
}

function SystemInfoFields({ s, put }: { s: SettingsShape; put: Put }) {
  const t = useT();
  const info = useApiQuery<SystemInfo>(["system", "info"], "/api/system/info", { staleTime: 60_000 });
  const updates = useApiQuery<UpdateCheck>(["updates"], "/api/updates", { staleTime: 60_000 });
  const check = useMutation({
    mutationFn: () => apiCall("GET /api/updates", { query: { force: "1" } }),
  });
  const result = check.data ?? updates.data;
  const status = result?.status ?? null;
  return (
    <>
      <ReadOnlyPathField
        id="st-home"
        label={t("settings.dataDir")}
        hint={t("settings.dataDirHint")}
        value={info.data?.home ?? ""}
        placeholder="MORDOMO_HOME"
        testId="settings-home"
      />
      {info.data && (
        <p className="meta" data-testid="settings-build">
          {t("settings.buildLine", {
            version: info.data.version,
            kind: t(info.data.packaged ? "settings.buildPackaged" : "settings.buildSource"),
            service: t(info.data.serviceInstalled ? "settings.serviceOn" : "settings.serviceOff"),
            pid: info.data.pid,
          })}
        </p>
      )}
      <div className="row-actions" style={{ alignItems: "center", flexWrap: "wrap" }}>
        <label className="check">
          <input
            type="checkbox"
            checked={s.updates?.check ?? false}
            onChange={(e) => void put({ updates: { check: e.target.checked } }, true)}
          />
          {t("settings.updatesAuto")}
        </label>
        <Button size="sm" variant="secondary" onClick={() => check.mutate()} loading={check.isPending}>
          {t("settings.updatesCheck")}
        </Button>
        {check.error && <span className="hint warn">{errorMessage(check.error as Error, t)}</span>}
        {status && (
          <span className="meta" data-testid="settings-updates" role="status">
            {status.error
              ? t("settings.updatesError", { error: status.error })
              : status.upToDate
                ? t("settings.updatesCurrent", { version: status.current })
                : t("settings.updatesAvailable", { version: status.latest ?? "?" })}{" "}
            {status.upToDate === false && (
              <a href={status.url} target="_blank" rel="noreferrer">
                {t("settings.updatesOpen")}
              </a>
            )}
          </span>
        )}
      </div>
    </>
  );
}
