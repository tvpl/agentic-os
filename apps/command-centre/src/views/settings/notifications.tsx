/** Settings › notifications (split out of Settings.tsx, refino item 17). */
import { useEffect, useState } from "react";
import { Bell, BellOff } from "lucide-react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiCall } from "../../apiCall";

import { useLocale, useT } from "../../i18n";
import { readQuietHours, storeQuietHours, type QuietHours } from "../../hooks/rhythm";
import { qk, useApiQuery } from "../../queries";
import { useToast } from "../../components/ui";
import { Button, Field } from "../../components/primitives";
import { getNotifySound, setNotifySound } from "../../hooks/useNotifications";
import {
  getDesktopNotify,
  getVoiceNotify,
  notifyPermission,
  requestNotifyPermission,
  setDesktopNotify,
  setVoiceNotify,
  speak,
  disablePush,
  enablePush,
  pushSubscribed,
  pushSupported,
} from "../../hooks/systemNotify";
import { DraftField, parseNonNegative, type Put } from "../SettingsFields";
import type { SettingsShape } from "./shared";

export function NotificationsTab() {
  const t = useT();
  const [sound, setSound] = useState(() => getNotifySound());
  const toggle = () => {
    const next = !sound;
    setNotifySound(next);
    setSound(next);
  };
  return (
    <div className="card stack">
      <div className="apps-sound">
        <div className="min0">
          <strong>{t("apps.settings.sound")}</strong>
          <p className="hint">{t("apps.settings.soundHint")}</p>
        </div>
        <Button
          variant={sound ? "outline" : "secondary"}
          aria-pressed={sound}
          icon={sound ? <Bell aria-hidden /> : <BellOff aria-hidden />}
          onClick={toggle}
        >
          {sound ? t("apps.settings.soundOn") : t("apps.settings.soundOff")}
        </Button>
      </div>
      <OutsideTabToggles />
      <p className="hint">{t("apps.settings.notificationsHint")}</p>
    </div>
  );
}

function OutsideTabToggles() {
  const t = useT();
  const locale = useLocale();
  const toast = useToast();
  const [desktop, setDesktop] = useState(() => getDesktopNotify());
  const [voice, setVoice] = useState(() => getVoiceNotify());
  const [perm, setPerm] = useState(() => notifyPermission());
  const [push, setPush] = useState(false);
  const [pushBusy, setPushBusy] = useState(false);
  useEffect(() => {
    void pushSubscribed().then(setPush);
  }, []);
  const togglePush = async () => {
    setPushBusy(true);
    try {
      if (push) {
        await disablePush();
        setPush(false);
        return;
      }
      const r = await enablePush();
      if (!r.ok) {
        toast(
          r.reason === "unsupported"
            ? t("apps.settings.pushUnsupported")
            : r.reason === "denied"
              ? t("apps.settings.desktopDenied")
              : t("apps.settings.pushFailed"),
          "info",
        );
        return;
      }
      setPush(true);
    } finally {
      setPushBusy(false);
    }
  };
  const toggleDesktop = async () => {
    if (desktop) {
      setDesktopNotify(false);
      setDesktop(false);
      return;
    }
    const granted = await requestNotifyPermission();
    setPerm(granted);
    if (granted !== "granted") {
      toast(
        granted === "unsupported" ? t("apps.settings.desktopUnsupported") : t("apps.settings.desktopDenied"),
        "info",
      );
      return;
    }
    setDesktopNotify(true);
    setDesktop(true);
  };
  const [quiet, setQuiet] = useState(() => readQuietHours());
  const updateQuiet = (patch: Partial<QuietHours>) => {
    const next = { ...quiet, ...patch };
    setQuiet(next);
    storeQuietHours(next);
  };
  const hours = Array.from({ length: 24 }, (_, i) => i);
  const toggleVoice = () => {
    const next = !voice;
    setVoiceNotify(next);
    setVoice(next);
    if (next) speak(t("apps.settings.voiceSample"), locale, { force: true, byUser: true });
  };
  return (
    <>
      <div className="apps-sound">
        <div className="min0">
          <strong>{t("apps.settings.quietHours")}</strong>
          <p className="hint">{t("apps.settings.quietHoursHint")}</p>
        </div>
        <div className="row quiet-hours">
          <Button
            variant={quiet.enabled ? "outline" : "secondary"}
            aria-pressed={quiet.enabled}
            onClick={() => updateQuiet({ enabled: !quiet.enabled })}
          >
            {quiet.enabled ? t("apps.settings.soundOn") : t("apps.settings.soundOff")}
          </Button>
          <select
            className="input sm"
            aria-label={t("apps.settings.quietFrom")}
            value={quiet.start}
            onChange={(e) => updateQuiet({ start: Number(e.target.value) })}
          >
            {hours.map((h) => (
              <option key={h} value={h}>
                {String(h).padStart(2, "0")}:00
              </option>
            ))}
          </select>
          <span className="hint">→</span>
          <select
            className="input sm"
            aria-label={t("apps.settings.quietTo")}
            value={quiet.end}
            onChange={(e) => updateQuiet({ end: Number(e.target.value) })}
          >
            {hours.map((h) => (
              <option key={h} value={h}>
                {String(h).padStart(2, "0")}:00
              </option>
            ))}
          </select>
        </div>
      </div>
      <div className="apps-sound">
        <div className="min0">
          <strong>{t("apps.settings.desktopNotify")}</strong>
          <p className="hint">
            {t("apps.settings.desktopNotifyHint")}
            {perm === "denied" && ` ${t("apps.settings.desktopDenied")}`}
          </p>
        </div>
        <Button
          variant={desktop ? "outline" : "secondary"}
          aria-pressed={desktop}
          icon={desktop ? <Bell aria-hidden /> : <BellOff aria-hidden />}
          onClick={() => void toggleDesktop()}
        >
          {desktop ? t("apps.settings.soundOn") : t("apps.settings.soundOff")}
        </Button>
      </div>
      <div className="apps-sound">
        <div className="min0">
          <strong>{t("apps.settings.voiceNotify")}</strong>
          <p className="hint">{t("apps.settings.voiceNotifyHint")}</p>
        </div>
        <Button
          variant={voice ? "outline" : "secondary"}
          aria-pressed={voice}
          icon={voice ? <Bell aria-hidden /> : <BellOff aria-hidden />}
          onClick={toggleVoice}
        >
          {voice ? t("apps.settings.soundOn") : t("apps.settings.soundOff")}
        </Button>
      </div>
      <div className="apps-sound">
        <div className="min0">
          <strong>{t("apps.settings.pushNotify")}</strong>
          <p className="hint">{t("apps.settings.pushNotifyHint")}</p>
        </div>
        <Button
          variant={push ? "outline" : "secondary"}
          aria-pressed={push}
          disabled={!pushSupported()}
          loading={pushBusy}
          icon={push ? <Bell aria-hidden /> : <BellOff aria-hidden />}
          onClick={() => void togglePush()}
        >
          {push ? t("apps.settings.soundOn") : t("apps.settings.soundOff")}
        </Button>
      </div>
    </>
  );
}

type SentinelKey =
  "fsWatch" | "repeatedFailure" | "silentRoutine" | "connectorDelta" | "repeatDetector" | "triage";
const SENTINEL_KEYS: SentinelKey[] = [
  "repeatedFailure",
  "silentRoutine",
  "connectorDelta",
  "repeatDetector",
  "fsWatch",
  "triage",
];

export function SentinelsCard({ s, put }: { s: SettingsShape; put: Put }) {
  const t = useT();
  const toast = useToast();
  const sentinels = s.sentinels;
  const channels = s.channels;
  const test = useMutation({
    // A failure is an error envelope (409 channel_not_configured, 502 channel_failed): its message is the reason.
    mutationFn: () => apiCall("POST /api/channels/telegram/test", { body: {} }),
    onSuccess: () => toast(t("apps.settings.telegramOk"), "ok"),
    onError: (err: Error) => toast(`${t("apps.settings.telegramFailed")}: ${err.message}`, "danger"),
  });
  if (!sentinels || !channels) return null;
  const toggle = (key: SentinelKey) =>
    void put(
      { sentinels: { ...sentinels, [key]: { ...sentinels[key], enabled: !sentinels[key].enabled } } },
      true,
    );
  const tg = channels.telegram;
  const saveTg = (patch: Partial<typeof tg>) =>
    put({ channels: { ...channels, telegram: { ...tg, ...patch } } }, true);
  return (
    <>
      <div className="card stack">
        <div>
          <h2>{t("apps.settings.sentinels")}</h2>
          <p className="hint">{t("apps.settings.sentinelsHint")}</p>
        </div>
        {SENTINEL_KEYS.map((key) => (
          <div className="apps-sound" key={key}>
            <div className="min0">
              <strong>{t(`apps.settings.sentinel.${key}`)}</strong>
              <p className="hint">{t(`apps.settings.sentinel.${key}Hint`)}</p>
            </div>
            <Button
              variant={sentinels[key].enabled ? "outline" : "secondary"}
              aria-pressed={sentinels[key].enabled}
              onClick={() => toggle(key)}
            >
              {sentinels[key].enabled ? t("apps.settings.soundOn") : t("apps.settings.soundOff")}
            </Button>
          </div>
        ))}
        <div className="grid-2">
          <DraftField
            id="st-triage-model"
            label={t("apps.settings.triageModel")}
            placeholder="haiku"
            serverValue={sentinels.triage.model}
            parse={(text) => ({ value: text.trim() || "haiku" })}
            save={(model) =>
              put({ sentinels: { ...sentinels, triage: { ...sentinels.triage, model } } }, true)
            }
          />
          <DraftField
            id="st-triage-budget"
            label={t("apps.settings.triageBudget")}
            type="number"
            min={0}
            step={0.05}
            serverValue={sentinels.triage.dailyBudgetUsd}
            parse={parseNonNegative(t)}
            save={(dailyBudgetUsd) =>
              put({ sentinels: { ...sentinels, triage: { ...sentinels.triage, dailyBudgetUsd } } }, true)
            }
          />
        </div>
      </div>
      <div className="card stack">
        <div className="apps-sound">
          <div className="min0">
            <h2>{t("apps.settings.telegram")}</h2>
            <p className="hint">{t("apps.settings.telegramHint", { env: tg.botTokenEnv })}</p>
          </div>
          <Button
            variant={tg.enabled ? "outline" : "secondary"}
            aria-pressed={tg.enabled}
            onClick={() => void saveTg({ enabled: !tg.enabled })}
          >
            {tg.enabled ? t("apps.settings.soundOn") : t("apps.settings.soundOff")}
          </Button>
        </div>
        <div className="grid-2">
          <DraftField
            id="st-tg-chat"
            label={t("apps.settings.telegramChat")}
            placeholder={t("settings.telegramChatPlaceholder")}
            serverValue={tg.chatId}
            parse={(text) => ({ value: text.trim() })}
            save={(chatId) => saveTg({ chatId })}
          />
          <Field label={t("apps.settings.telegramMinTone")} htmlFor="st-tg-tone">
            <select
              id="st-tg-tone"
              className="input"
              value={tg.minTone}
              onChange={(e) => void saveTg({ minTone: e.target.value as typeof tg.minTone })}
            >
              {(["info", "warn", "danger"] as const).map((tone) => (
                <option key={tone} value={tone}>
                  {tone}
                </option>
              ))}
            </select>
          </Field>
        </div>
        <div className="apps-sound">
          <div className="min0">
            <strong>{t("apps.settings.telegramInbound")}</strong>
            <p className="hint">
              {t("apps.settings.telegramInboundHint")}
              {tg.inbound && (
                <>
                  {" "}
                  <TelegramStatus />
                </>
              )}
            </p>
          </div>
          <Button
            variant={tg.inbound ? "outline" : "secondary"}
            aria-pressed={tg.inbound}
            disabled={!tg.enabled}
            onClick={() => void saveTg({ inbound: !tg.inbound })}
          >
            {tg.inbound ? t("apps.settings.soundOn") : t("apps.settings.soundOff")}
          </Button>
        </div>
        <div>
          <Button
            variant="outline"
            loading={test.isPending}
            disabled={!tg.enabled || !tg.chatId}
            onClick={() => test.mutate()}
          >
            {t("apps.settings.telegramTest")}
          </Button>
        </div>
      </div>
      <PushServerCard s={s} put={put} />
    </>
  );
}

function TelegramStatus() {
  const t = useT();
  const status = useApiQuery<{
    inbound: boolean;
    polling: boolean;
    lastPollAt: number;
    lastError: string | null;
    handled: number;
  }>(qk.telegramStatus, "/api/channels/telegram/status", { refetchInterval: 60_000 });
  if (!status.data) return null;
  return (
    <span className={status.data.lastError ? "text-danger" : "text-muted"}>
      {status.data.polling && status.data.inbound
        ? t("apps.settings.telegramPolling", { n: status.data.handled })
        : t("apps.settings.telegramIdle")}
      {status.data.lastError ? ` · ${status.data.lastError}` : ""}
    </span>
  );
}

function PushServerCard({ s, put }: { s: SettingsShape; put: Put }) {
  const t = useT();
  const toast = useToast();
  const channels = s.channels;
  const qc = useQueryClient();
  const subs = useApiQuery<Array<{ id: string; label: string | null; createdAt: number; failures: number }>>(
    qk.pushSubscriptions,
    "/api/push/subscriptions",
  );
  const test = useMutation({
    mutationFn: () => apiCall("POST /api/push/test", { body: {} }),
    onSuccess: () => toast(t("apps.settings.telegramOk").replace("Telegram", "Push"), "ok"),
    onError: (err: Error) => toast(`${t("apps.settings.pushFailed")}: ${err.message}`, "danger"),
    // Failed deliveries count against a subscription either way.
    onSettled: () => qc.invalidateQueries({ queryKey: qk.pushSubscriptions }).catch(() => undefined),
  });
  const remove = useMutation({
    mutationFn: (id: string) => apiCall("DELETE /api/push/subscriptions/:id", { params: { id } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.pushSubscriptions }).catch(() => undefined),
  });
  if (!channels) return null;
  const push = channels.push;
  const save = (patch: Partial<typeof push>) =>
    void put({ channels: { ...channels, push: { ...push, ...patch } } }, true);
  return (
    <div className="card stack">
      <div className="apps-sound">
        <div className="min0">
          <h2>{t("apps.settings.pushServer")}</h2>
          <p className="hint">{t("apps.settings.pushServerHint")}</p>
        </div>
        <Button
          variant={push.enabled ? "outline" : "secondary"}
          aria-pressed={push.enabled}
          onClick={() => save({ enabled: !push.enabled })}
        >
          {push.enabled ? t("apps.settings.soundOn") : t("apps.settings.soundOff")}
        </Button>
      </div>
      <div className="grid-2">
        <Field label={t("apps.settings.telegramMinTone")} htmlFor="st-push-tone">
          <select
            id="st-push-tone"
            className="input"
            value={push.minTone}
            onChange={(e) => save({ minTone: e.target.value as typeof push.minTone })}
          >
            {(["info", "warn", "danger"] as const).map((tone) => (
              <option key={tone} value={tone}>
                {tone}
              </option>
            ))}
          </select>
        </Field>
        <div className="stack-sm">
          <span className="hint">{t("apps.settings.pushDevices", { n: subs.data?.length ?? 0 })}</span>
          <ul className="device-list">
            {(subs.data ?? []).map((d) => (
              <li key={d.id}>
                <span>{d.label ?? d.id}</span>
                <Button size="sm" variant="ghost" onClick={() => remove.mutate(d.id)}>
                  {t("apps.settings.pushRemove")}
                </Button>
              </li>
            ))}
          </ul>
        </div>
      </div>
      <div>
        <Button
          variant="outline"
          loading={test.isPending}
          disabled={!push.enabled}
          onClick={() => test.mutate()}
        >
          {t("apps.settings.pushTest")}
        </Button>
      </div>
    </div>
  );
}
