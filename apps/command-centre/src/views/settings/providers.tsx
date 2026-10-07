/** Settings › providers (split out of Settings.tsx, refino item 17). */
import { RefreshCw } from "lucide-react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api, type ProviderId, type ProviderSnapshot, type SettingsDoc } from "../../api";

import { useT } from "../../i18n";
import { qk, useOsProviders } from "../../queries";
import { Skeleton, useToast } from "../../components/ui";
import { Badge, Button, Field } from "../../components/primitives";
import { copyText, isAbsolutePath } from "../shared";
import { DraftField, parseOptionalText, type Put } from "../SettingsFields";
import type { SettingsShape } from "./shared";

/** What a registered provider with no entry in settings.json yet runs with (the server's defaults). */
const DEFAULT_PREFS: SettingsShape["providers"][ProviderId] = {
  enabled: false,
  defaultModel: null,
  defaultEffort: "default",
  binaryPath: null,
};

export function ProvidersTab({ s, put }: { s: SettingsShape; put: Put }) {
  const t = useT();
  const toast = useToast();
  const qc = useQueryClient();
  const providers = useOsProviders();
  const recheck = useMutation({
    mutationFn: () => api.get<ProviderSnapshot[]>("/api/providers?force=1"),
    onSuccess: (data) => qc.setQueryData(qk.providers, data),
    onError: (err: Error) => toast(err.message, "danger"),
  });
  const smoke = useMutation({
    mutationFn: (id: ProviderId) =>
      api.post<{ run: { status: string; durationMs: number | null }; passed: boolean }>(
        `/api/providers/${id}/smoke`,
      ),
    onSuccess: (res, id) => {
      toast(`${id}: ${res.passed ? t("settings.smokeOk") : res.run.status}`, res.passed ? "ok" : "danger");
      qc.invalidateQueries({ queryKey: qk.providers }).catch(() => undefined);
    },
    onError: (err: Error) => toast(err.message, "danger"),
  });
  const prefsOf = (id: ProviderId) => s.providers[id] ?? DEFAULT_PREFS;
  const patchProvider = (
    id: ProviderId,
    patch: Partial<SettingsShape["providers"][ProviderId]>,
    silent = false,
  ) => put({ providers: { ...s.providers, [id]: { ...prefsOf(id), ...patch } } }, silent);

  if (providers.isPending && !providers.data)
    return (
      <div className="card">
        <Skeleton lines={6} />
      </div>
    );
  return (
    <div className="card stack">
      <div className="row-actions">
        <Button variant="secondary" onClick={() => recheck.mutate()} loading={recheck.isPending}>
          <RefreshCw aria-hidden /> {t("settings.verifyProviders")}
        </Button>
      </div>
      {(providers.data ?? []).map((prov: ProviderSnapshot) => (
        <div key={prov.id} className="provider-row">
          <div className="provider-head">
            <div>
              <strong>{prov.displayName ?? prov.id}</strong> <span className="mono small">{prov.id}</span>{" "}
              <span className={`dot ${prov.health.ok ? "ok" : prov.health.installed ? "warn" : "danger"}`} />
              {prov.capabilities && !prov.capabilities.enforcesReadOnly && (
                <Badge kind="state" tone="warn" title={t("settings.promptLevelReadOnlyHint")}>
                  {t("settings.promptLevelReadOnly")}
                </Badge>
              )}
              <div className="meta">
                {prov.health.installed
                  ? `${prov.health.version ?? t("setup.installed")} · ${t("settings.auth")}: ${prov.health.authenticated === true ? t("settings.authOk") : prov.health.authenticated === false ? t("settings.authRequired") : t("settings.authUnknown")}`
                  : prov.health.detail}
              </div>
            </div>
            <div className="row-actions">
              {prov.isDefault && (
                <Badge kind="state" tone="info">
                  {t("dash.default")}
                </Badge>
              )}
              <label className="check">
                <input
                  type="checkbox"
                  checked={prefsOf(prov.id).enabled}
                  onChange={(e) => void patchProvider(prov.id, { enabled: e.target.checked })}
                />
                {t("common.enabled")}
              </label>
              <Button
                size="sm"
                variant="secondary"
                onClick={() => smoke.mutate(prov.id)}
                disabled={!prefsOf(prov.id).enabled || !prov.health.installed}
                loading={smoke.isPending && smoke.variables === prov.id}
              >
                {t("settings.smokeTest")}
              </Button>
            </div>
          </div>
          {prov.health.installed && prov.health.authenticated !== true && prov.loginCommand && (
            <div className="auth-recovery">
              <p>{t("settings.authRecoveryHint")}</p>
              <code>{prov.loginCommand}</code>{" "}
              <Button
                size="sm"
                variant="secondary"
                onClick={async () => {
                  const copied = await copyText(prov.loginCommand ?? "");
                  toast(t(copied ? "common.copied" : "skills.copyFailed"), copied ? "ok" : "danger");
                }}
              >
                {t("settings.copyLoginCommand")}
              </Button>
            </div>
          )}
          <div className="grid grid-2">
            <DraftField
              id={`st-model-${prov.id}`}
              label={t("skills.model")}
              hint={t("settings.modelHint")}
              className="mono"
              serverValue={prefsOf(prov.id).defaultModel}
              format={(v) => v ?? ""}
              parse={parseOptionalText}
              save={(defaultModel) => patchProvider(prov.id, { defaultModel }, true)}
            />
            <Field label={t("skills.effort")} htmlFor={`st-effort-${prov.id}`}>
              <select
                id={`st-effort-${prov.id}`}
                className="input"
                value={prefsOf(prov.id).defaultEffort}
                onChange={(e) =>
                  void patchProvider(
                    prov.id,
                    { defaultEffort: e.target.value as SettingsDoc["providers"]["claude"]["defaultEffort"] },
                    true,
                  )
                }
              >
                {["default", "low", "medium", "high"].map((e2) => (
                  <option key={e2} value={e2}>
                    {t(`effort.${e2}` as "effort.low")}
                  </option>
                ))}
              </select>
            </Field>
            <DraftField
              id={`st-bin-${prov.id}`}
              label={t("settings.binaryPath")}
              hint={t("settings.binaryPathHint")}
              className="mono"
              placeholder={t("settings.binaryPathAuto")}
              serverValue={prefsOf(prov.id).binaryPath}
              format={(v) => v ?? ""}
              parse={(text) => {
                const value = text.trim() || null;
                return value && !isAbsolutePath(value) ? { error: t("settings.folderAbsolute") } : { value };
              }}
              save={async (binaryPath) => {
                const res = await patchProvider(prov.id, { binaryPath });
                if (res.ok) recheck.mutate();
                return res;
              }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}
