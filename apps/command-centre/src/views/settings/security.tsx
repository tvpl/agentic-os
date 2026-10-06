/** Settings › security (split out of Settings.tsx, refino item 17). */
import { useState } from "react";
import { TerminalSquare, Trash2, Webhook } from "lucide-react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api, type DeviceRecord, type SettingsDoc } from "../../api";

import { useLocale, useT } from "../../i18n";
import { qk, useApiQuery, useOsMeta } from "../../queries";
import { Skeleton, timeAgo, useToast } from "../../components/ui";
import { Badge, Button, Field } from "../../components/primitives";
import { useConfirm } from "../../hooks/useConfirm";
import {
  DraftField,
  joinComma,
  parseCommaList,
  parseNonNegative,
  parseTokenList,
  sameList,
  type Put,
} from "../SettingsFields";
import { PROFILES } from "./shared";
import type { Approval } from "./shared";
import type { SettingsShape } from "./shared";

export function SecurityTab({ s, put }: { s: SettingsShape; put: Put }) {
  const t = useT();
  const toast = useToast();
  const qc = useQueryClient();
  const approvals = useApiQuery<Approval[]>(qk.approvals, "/api/approvals");
  const resolve = useMutation({
    mutationFn: ({ id, decision }: { id: string; decision: "approved" | "denied" }) =>
      api.post(`/api/approvals/${encodeURIComponent(id)}/resolve`, { decision }),
    onSuccess: (_r, vars) => {
      toast(vars.decision === "approved" ? t("settings.approved") : t("settings.denied"), "ok");
      qc.invalidateQueries({ queryKey: qk.approvals }).catch(() => undefined);
      qc.invalidateQueries({ queryKey: qk.settings }).catch(() => undefined);
      qc.invalidateQueries({ queryKey: qk.connectors }).catch(() => undefined);
    },
    onError: (err: Error) => toast(err.message, "danger"),
  });
  return (
    <div className="stack">
      <div className="card stack">
        <Field label={t("settings.profile")} htmlFor="st-profile" hint={t("settings.profileHint")}>
          <select
            id="st-profile"
            className="input"
            value={s.securityProfile}
            onChange={(e) => void put({ securityProfile: e.target.value as SettingsDoc["securityProfile"] })}
          >
            {PROFILES.map((prof) => (
              <option key={prof} value={prof}>
                {t(`profile.${prof}`)}
              </option>
            ))}
          </select>
        </Field>
        <DraftField
          id="st-budget"
          label={t("apps.settings.budget")}
          hint={t("apps.settings.budgetHint")}
          type="number"
          min={0}
          step={0.5}
          serverValue={s.limits?.dailyBudgetUsd ?? 0}
          parse={parseNonNegative(t)}
          save={(dailyBudgetUsd) => put({ limits: { ...(s.limits ?? {}), dailyBudgetUsd } })}
        />
        <ul className="plain-list profile-list">
          {PROFILES.map((prof) => (
            <li key={prof} className={prof === s.securityProfile ? "active" : ""}>
              <strong>{t(`profile.${prof}`)}</strong>
              <span className="meta">{t(`profile.${prof}.desc` as "profile.read_only.desc")}</span>
            </li>
          ))}
        </ul>
      </div>
      <RemoteAccess s={s} put={put} />
      <div className="card stack">
        <h2>{t("apps.settings.automation")}</h2>
        <div className="apps-sound">
          <div className="min0">
            <strong>
              <Webhook aria-hidden style={{ verticalAlign: -2, marginRight: 6 }} />{" "}
              {t("apps.settings.webhooks")}
            </strong>
            <p className="hint">{t("apps.settings.webhooksHint")}</p>
          </div>
          <Button
            variant={s.routines.allowWebhooks ? "outline" : "secondary"}
            aria-pressed={s.routines.allowWebhooks}
            onClick={() =>
              void put({ routines: { ...s.routines, allowWebhooks: !s.routines.allowWebhooks } })
            }
          >
            {s.routines.allowWebhooks ? t("apps.settings.soundOn") : t("apps.settings.soundOff")}
          </Button>
        </div>
        <DraftField
          id="st-allowed-cmds"
          label={t("apps.settings.allowedCommands")}
          hint={t("apps.settings.allowedCommandsHint")}
          className="mono"
          placeholder="npx, /usr/local/bin/mcp-server"
          serverValue={s.connectors.allowedCommands}
          format={joinComma}
          equals={sameList}
          parse={parseCommaList(t)}
          save={(allowedCommands) => put({ connectors: { ...s.connectors, allowedCommands } })}
        />
        <p className="hint">
          <TerminalSquare size={11} style={{ verticalAlign: -1 }} aria-hidden />{" "}
          {t("apps.settings.allowedCommandsExample")}
        </p>
      </div>
      <div className="card">
        <h2>{t("settings.approvals")}</h2>
        {approvals.isPending ? (
          <Skeleton lines={2} />
        ) : (approvals.data ?? []).length === 0 ? (
          <p className="widget-muted">{t("settings.noApprovals")}</p>
        ) : (
          (approvals.data ?? []).map((a) => (
            <div className="list-row" key={a.id}>
              <div>
                <Badge kind="state" tone="warn">
                  {a.kind}
                </Badge>
                <div className="approval-desc">{a.description}</div>
              </div>
              <div className="row-actions">
                <Button
                  size="sm"
                  variant="primary"
                  onClick={() => resolve.mutate({ id: a.id, decision: "approved" })}
                  loading={resolve.isPending && resolve.variables?.id === a.id}
                >
                  {t("settings.approve")}
                </Button>
                <Button
                  size="sm"
                  variant="danger"
                  onClick={() => resolve.mutate({ id: a.id, decision: "denied" })}
                >
                  {t("settings.deny")}
                </Button>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

function RemoteAccess({ s, put }: { s: SettingsShape; put: Put }) {
  const t = useT();
  const locale = useLocale();
  const toast = useToast();
  const confirm = useConfirm();
  const qc = useQueryClient();
  const remote = s.remote ?? { enabled: false, allowedHosts: [], deviceTtlDays: 90 };
  const tls = remote.tls ?? { enabled: false, port: null };
  const meta = useOsMeta();
  const devices = useApiQuery<{ devices: DeviceRecord[] }>(qk.devices, "/api/devices");
  const [pairing, setPairing] = useState<{ code: string; expiresAt: number } | null>(null);
  const start = useMutation({
    mutationFn: () => api.post<{ code: string; expiresAt: number }>("/api/pair/start", {}),
    onSuccess: (res) => setPairing(res),
    onError: (err: Error) => toast(err.message, "danger"),
  });
  const revoke = useMutation({
    mutationFn: (id: string) => api.del(`/api/devices/${encodeURIComponent(id)}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.devices }).catch(() => undefined),
    onError: (err: Error) => toast(err.message, "danger"),
  });
  const save = (patch: Partial<typeof remote>) => put({ remote: { ...remote, ...patch } }, true);
  const active = (devices.data?.devices ?? []).filter((d) => d.revokedAt === null);
  return (
    <div className="card stack">
      <div className="apps-sound">
        <div className="min0">
          <h2>{t("apps.settings.remote")}</h2>
          <p className="hint">{t("apps.settings.remoteHint")}</p>
        </div>
        <Button
          variant={remote.enabled ? "outline" : "secondary"}
          aria-pressed={remote.enabled}
          onClick={() => void save({ enabled: !remote.enabled })}
        >
          {remote.enabled ? t("apps.settings.soundOn") : t("apps.settings.soundOff")}
        </Button>
      </div>
      <DraftField
        id="st-remote-hosts"
        label={t("apps.settings.remoteHosts")}
        hint={t("apps.settings.remoteHostsHint")}
        placeholder="mordomo.tail1234.ts.net, 192.168.0.12"
        serverValue={remote.allowedHosts}
        format={joinComma}
        equals={sameList}
        parse={parseTokenList}
        save={(allowedHosts) => save({ allowedHosts })}
      />
      <DraftField
        id="st-remote-ttl"
        label={t("apps.settings.remoteTtl")}
        hint={t("apps.settings.remoteTtlHint")}
        type="number"
        min={0}
        serverValue={remote.deviceTtlDays}
        parse={parseNonNegative(t, { integer: true })}
        save={(deviceTtlDays) => save({ deviceTtlDays })}
      />
      <div className="apps-sound">
        <div className="min0">
          <strong>{t("apps.settings.remoteTls")}</strong>
          <p className="hint">{t("apps.settings.remoteTlsHint", { port: tls.port ?? s.port + 1 })}</p>
          {meta.data?.tls ? (
            <p className="hint mono">
              {t("apps.settings.remoteTlsFingerprint")}: {meta.data.tls.fingerprint}
            </p>
          ) : (
            <p className="hint">
              {tls.enabled && remote.enabled
                ? t("apps.settings.remoteTlsOff")
                : t("apps.settings.remoteTlsAlt")}
            </p>
          )}
        </div>
        <Button
          variant={tls.enabled ? "outline" : "secondary"}
          aria-pressed={tls.enabled}
          disabled={!remote.enabled}
          onClick={() => void save({ tls: { ...tls, enabled: !tls.enabled } })}
        >
          {tls.enabled ? t("apps.settings.soundOn") : t("apps.settings.soundOff")}
        </Button>
      </div>
      <div className="apps-sound">
        <div className="min0">
          <strong>{t("apps.settings.pairDevice")}</strong>
          <p className="hint">{t("apps.settings.pairDeviceHint")}</p>
        </div>
        <Button
          variant="primary"
          loading={start.isPending}
          disabled={!remote.enabled}
          onClick={() => start.mutate()}
        >
          {t("apps.settings.pairStart")}
        </Button>
      </div>
      {pairing && (
        <div className="pairing-code-box" role="status">
          <span className="pairing-code-big mono">{pairing.code}</span>
          <span className="hint">
            {t("apps.settings.pairExpires", {
              time: new Date(pairing.expiresAt).toLocaleTimeString(locale, {
                hour: "2-digit",
                minute: "2-digit",
              }),
            })}
          </span>
        </div>
      )}
      {active.length > 0 && (
        <ul className="plain-list device-list">
          {active.map((d) => (
            <li key={d.id}>
              <strong>{d.name}</strong>
              <span className="meta mono">
                {d.lastSeenAt ? timeAgo(d.lastSeenAt, locale) : t("apps.settings.deviceNeverSeen")}
                {d.expiresAt
                  ? ` · ${t("apps.settings.deviceExpires", { date: new Date(d.expiresAt).toLocaleDateString(locale) })}`
                  : ""}
              </span>
              <Button
                size="sm"
                variant="danger"
                icon={<Trash2 aria-hidden />}
                loading={revoke.isPending && revoke.variables === d.id}
                onClick={async () => {
                  if (await confirm({ title: t("apps.settings.deviceRevoke"), body: d.name, danger: true }))
                    revoke.mutate(d.id);
                }}
              >
                {t("apps.settings.deviceRevoke")}
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
