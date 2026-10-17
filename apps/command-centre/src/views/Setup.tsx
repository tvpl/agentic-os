import { useContext, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { CalendarDays, Check, Copy, ExternalLink, Mail, Plug, RefreshCw } from "lucide-react";
import { useMutation } from "@tanstack/react-query";
import { providerOptions } from "../providers/options";
import { api, type Connector, type ProviderId, type ProviderSnapshot } from "../api";
import { apiCall } from "../apiCall";
import { I18nContext, useT, type Lang } from "../i18n";
import { qk, useApiQuery } from "../queries";
import { ErrorBox, Skeleton, useToast } from "../components/ui";
import { Badge, Button, Field } from "../components/primitives";
import { PRESETS, applyPreset, type PresetId } from "../theme";
import { copyText, errorMessage, isAbsolutePath, isOffline } from "./shared";
import "./apps.css";
import { Tooltip } from "../ui";

/** Connectors offered in the "connect data" step (the widgets that read them). */
const DATA_KINDS = /calendar|mail|email/i;
const LAST_STEP = 4;

/**
 * In-UI setup for when the guided terminal setup was skipped: five steps
 * (providers → identity → folders → connect data → appearance).
 * Everything is editable later in Settings.
 */
export default function Setup({ onDone }: { onDone: () => void }) {
  const t = useT();
  const toast = useToast();
  const { lang, setLang } = useContext(I18nContext);
  const providers = useApiQuery<ProviderSnapshot[]>(["providers", "force"], "/api/providers?force=1", {
    staleTime: 60_000,
  });
  const [step, setStep] = useState(0);
  // "Detect again": re-probe one CLI (a fresh install or login) and refresh the list.
  const redetect = useMutation({
    mutationFn: (id: ProviderId) => apiCall("POST /api/providers/:id/detect", { params: { id } }),
    onSettled: () => void providers.refetch(),
    onError: (err: Error) => toast(errorMessage(err, t), "danger"),
  });
  const copyCommand = async (command: string) => {
    const ok = await copyText(command);
    toast(ok ? t("common.copied") : t("skills.copyFailed"), ok ? "ok" : "danger");
  };
  const [enabled, setEnabled] = useState<{ [id: ProviderId]: boolean } | null>(null);
  const installedRef = useRef<{ [id: ProviderId]: boolean | undefined }>({});
  const [defaultProvider, setDefaultProvider] = useState<ProviderId>("");
  const [name, setName] = useState("MordomoOS");
  const [theme, setTheme] = useState<"dark" | "light">("dark");
  const [folder, setFolder] = useState("");
  const [folderError, setFolderError] = useState<string | null>(null);
  const [phase, setPhase] = useState<"idle" | "saving" | "indexing">("idle");
  const [preset, setPreset] = useState<PresetId>("hud-orange");

  useEffect(() => {
    if (!providers.data) return;
    if (enabled) {
      // A CLI detected after "Detect again" joins the enabled set and a vanished
      // one leaves it; a choice the user made about an unchanged CLI is kept.
      const next = { ...enabled };
      let changed = false;
      for (const s of providers.data) {
        const was = installedRef.current[s.id];
        if (was !== undefined && was !== s.health.installed) {
          next[s.id] = s.health.installed;
          changed = true;
        }
        installedRef.current[s.id] = s.health.installed;
      }
      if (changed) setEnabled(next);
      return;
    }
    for (const s of providers.data) installedRef.current[s.id] = s.health.installed;
    const next: { [id: ProviderId]: boolean } = {};
    for (const s of providers.data) next[s.id] = s.health.installed;
    setEnabled(next);
    // The server's default, unless it is missing here and another CLI is installed.
    const current = providers.data.find((s) => s.isDefault) ?? providers.data[0];
    const firstInstalled = providers.data.find((s) => s.health.installed)?.id;
    setDefaultProvider(firstInstalled && !current?.health.installed ? firstInstalled : (current?.id ?? ""));
  }, [providers.data, enabled]);

  const finish = useMutation({
    mutationFn: async () => {
      if (!enabled) return;
      setPhase("saving");
      // Pin the detected binaries (what the terminal setup does) so a login
      // service with a bare PATH keeps finding them; then read the settings
      // the detection just updated.
      await Promise.all(
        (Object.entries(enabled) as Array<[ProviderId, boolean]>)
          .filter(([, on]) => on)
          .map(([id]) =>
            apiCall("POST /api/providers/:id/detect", { params: { id } }).catch(() => undefined),
          ),
      );
      const current = await apiCall("GET /api/settings");
      const provSettings = current.providers;
      for (const id of providerOptions(providers.data))
        provSettings[id] = { ...provSettings[id]!, enabled: enabled[id] ?? false };
      const chosenDefault = enabled[defaultProvider]
        ? defaultProvider
        : (Object.entries(enabled).find(([, v]) => v)?.[0] ?? defaultProvider);
      const folders = current.indexedFolders;
      const chosenPreset = PRESETS.find((p) => p.id === preset) ?? PRESETS[0]!;
      // The preset is a UI preference (config/ui-preferences.json). It is saved first,
      // so `setupCompleted` only flips once both writes have landed.
      await api.putUiPreferences({ themePreset: chosenPreset.id });
      await api.putSettings({
        systemName: name.trim() || "MordomoOS",
        language: lang,
        theme,
        defaultProvider: chosenDefault,
        providers: provSettings,
        indexedFolders: folder.trim()
          ? [...folders, { path: folder.trim(), area: null, enabled: true }]
          : folders,
        accentColor: chosenPreset.accent,
        setupCompleted: true,
      });
      if (folder.trim()) {
        setPhase("indexing");
        await apiCall("POST /api/memory/index");
        await apiCall("POST /api/memory/routers");
      }
    },
    onSuccess: () => onDone(),
    onError: (err: Error) => {
      setPhase("idle");
      const msg = errorMessage(err, t);
      if (/folder/i.test(msg) || /pasta/i.test(msg)) setFolderError(msg);
      toast(msg, "danger");
    },
  });

  const steps = [
    t("setup.stepProviders"),
    t("setup.stepIdentity"),
    t("setup.stepFolders"),
    t("apps.setup.stepConnect"),
    t("apps.setup.stepAppearance"),
  ];
  const anyEnabled = enabled ? Object.values(enabled).some(Boolean) : false;
  const folderOk = !folder.trim() || isAbsolutePath(folder);

  return (
    <div className="main setup" style={{ height: "100%" }}>
      <div className="page" style={{ maxWidth: 680 }}>
        <div className="page-head" style={{ marginTop: 32 }}>
          <div>
            <h1>{t("setup.welcome")} 👋</h1>
            <p className="sub">{t("setup.intro")}</p>
            <details className="setup-terminal">
              <summary>{t("setup.terminalOption")}</summary>
              <p className="sub">{t("setup.notDone")}</p>
              <div className="setup-cmd">
                <pre className="preview-pre tight">npx mordomo setup</pre>
                <Tooltip label={t("brain.copyPath")}>
                  <Button
                    size="sm"
                    variant="ghost"
                    icon={<Copy aria-hidden />}
                    aria-label={t("brain.copyPath")}
                    onClick={() =>
                      void copyText("npx mordomo setup").then((ok) =>
                        toast(ok ? t("brain.copied") : t("skills.copyFailed"), ok ? "ok" : "danger"),
                      )
                    }
                  />
                </Tooltip>
              </div>
            </details>
          </div>
        </div>

        <ol className="stepper" aria-label={t("setup.progress")}>
          {steps.map((label, i) => (
            <li
              key={label}
              className={i === step ? "current" : i < step ? "done" : ""}
              aria-current={i === step ? "step" : undefined}
            >
              <span className="step-n">{i < step ? <Check aria-hidden /> : i + 1}</span>
              <span>{label}</span>
            </li>
          ))}
        </ol>

        {providers.isPending && !providers.data ? (
          <div className="card">
            <Skeleton lines={5} />
          </div>
        ) : providers.error && !providers.data ? (
          <div className="card">
            <ErrorBox
              message={errorMessage(providers.error)}
              offline={isOffline(providers.error)}
              onRetry={() => void providers.refetch()}
            />
          </div>
        ) : !enabled ? null : (
          <div className="card">
            {step === 0 && (
              <>
                <fieldset className="field">
                  <legend className="label">{t("settings.providers")}</legend>
                  <p className="hint">{t("setup.providersHint")}</p>
                  {(providers.data ?? []).map((prov) => {
                    const installed = prov.health.installed;
                    const loggedIn = prov.health.authenticated === true;
                    const command = installed ? prov.loginCommand : prov.installHint;
                    const busy = redetect.isPending && redetect.variables === prov.id;
                    return (
                      <div key={prov.id} className="setup-provider" data-testid={`setup-provider-${prov.id}`}>
                        <label className="check">
                          <input
                            type="checkbox"
                            checked={enabled[prov.id]}
                            disabled={!installed}
                            onChange={(e) => setEnabled({ ...enabled, [prov.id]: e.target.checked })}
                          />
                          <strong>{prov.displayName ?? prov.id}</strong>
                          <span className={`dot ${installed ? (loggedIn ? "ok" : "warn") : "danger"}`} />
                          <span className="meta">
                            {installed
                              ? `${prov.health.version ?? t("setup.installed")} · ${
                                  loggedIn
                                    ? t("settings.authOk")
                                    : prov.health.authenticated === false
                                      ? t("settings.authRequired")
                                      : t("settings.authUnknown")
                                }`
                              : t("setup.notInstalled")}
                          </span>
                        </label>
                        {(!installed || !loggedIn) && (
                          <div className="setup-provider-help">
                            <p className="hint">{t(installed ? "setup.loginHint" : "setup.installHint")}</p>
                            {command && (
                              <div className="setup-cmd">
                                <pre className="preview-pre tight">{command}</pre>
                                <Tooltip label={t("common.copy")}>
                                  <Button
                                    size="sm"
                                    variant="ghost"
                                    icon={<Copy aria-hidden />}
                                    aria-label={t("common.copy")}
                                    onClick={() => void copyCommand(command)}
                                  />
                                </Tooltip>
                              </div>
                            )}
                            <Button
                              size="sm"
                              variant="secondary"
                              icon={<RefreshCw aria-hidden />}
                              loading={busy}
                              disabled={redetect.isPending}
                              onClick={() => redetect.mutate(prov.id)}
                            >
                              {t("setup.detectAgain")}
                            </Button>
                          </div>
                        )}
                      </div>
                    );
                  })}
                  {!anyEnabled && <p className="hint warn">{t("setup.noProvider")}</p>}
                  {anyEnabled &&
                    !(providers.data ?? []).some((p) => enabled[p.id] && p.health.authenticated === true) && (
                      <p className="hint warn" data-testid="setup-not-ready">
                        {t("setup.notReadyHint")}
                      </p>
                    )}
                </fieldset>
                <Field label={t("dash.default")} htmlFor="su-default">
                  <select
                    id="su-default"
                    className="input"
                    value={defaultProvider}
                    onChange={(e) => setDefaultProvider(e.target.value as ProviderId)}
                  >
                    {(providers.data ?? [])
                      .filter((p) => enabled[p.id])
                      .map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.id}
                        </option>
                      ))}
                  </select>
                </Field>
              </>
            )}
            {step === 1 && (
              <div className="grid grid-2">
                <Field label={t("settings.name")} htmlFor="su-name">
                  <input
                    id="su-name"
                    className="input"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                  />
                </Field>
                <Field label={t("settings.language")} htmlFor="su-lang">
                  <select
                    id="su-lang"
                    className="input"
                    value={lang}
                    onChange={(e) => setLang(e.target.value as Lang)}
                  >
                    <option value="en">English</option>
                    <option value="pt-BR">Português (Brasil)</option>
                  </select>
                </Field>
                <Field label={t("settings.theme")} htmlFor="su-theme">
                  <select
                    id="su-theme"
                    className="input"
                    value={theme}
                    onChange={(e) => setTheme(e.target.value as "dark" | "light")}
                  >
                    <option value="dark">{t("settings.dark")}</option>
                    <option value="light">{t("settings.light")}</option>
                  </select>
                </Field>
              </div>
            )}
            {step === 2 && (
              <Field
                label={t("settings.folders")}
                htmlFor="su-folder"
                hint={t("setup.folderHint")}
                error={folderError ?? (folderOk ? undefined : t("settings.folderAbsolute"))}
              >
                <input
                  id="su-folder"
                  className="input mono"
                  placeholder={t("settings.folderPh")}
                  value={folder}
                  aria-invalid={!folderOk || Boolean(folderError)}
                  onChange={(e) => {
                    setFolder(e.target.value);
                    setFolderError(null);
                  }}
                />
              </Field>
            )}
            {step === 3 && <ConnectStep />}
            {step === 4 && (
              <AppearanceStep
                preset={preset}
                onPreset={(id) => {
                  setPreset(id);
                  applyPreset(id);
                }}
              />
            )}
            <div className="modal-actions">
              {step > 0 && (
                <Button variant="secondary" onClick={() => setStep((s) => s - 1)} disabled={finish.isPending}>
                  {t("common.back")}
                </Button>
              )}
              {step < LAST_STEP ? (
                <Button
                  variant="primary"
                  onClick={() => setStep((s) => s + 1)}
                  disabled={step === 0 && !anyEnabled}
                >
                  {t("common.next")}
                </Button>
              ) : (
                <Button
                  variant="primary"
                  onClick={() => finish.mutate()}
                  disabled={!anyEnabled || !folderOk}
                  loading={finish.isPending}
                >
                  {phase === "indexing" ? t("setup.indexing") : t("setup.finish")}
                </Button>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/* ---------------------------------------------------- connect data step ---- */

function ConnectStep() {
  const t = useT();
  const connectors = useApiQuery<Connector[]>(qk.connectors, "/api/connectors");
  const relevant = (connectors.data ?? []).filter((c) => DATA_KINDS.test(c.kind) || DATA_KINDS.test(c.id));
  return (
    <div className="stack">
      <p className="hint">{t("apps.setup.connectHint")}</p>
      {connectors.isPending && !connectors.data ? (
        <Skeleton lines={3} />
      ) : relevant.length === 0 ? (
        <p className="widget-muted">{t("apps.setup.noConnectors")}</p>
      ) : (
        <ul className="apps-conn-list">
          {relevant.map((c) => (
            <ConnectorRow key={c.id} connector={c} />
          ))}
        </ul>
      )}
      <Link className="btn sm" to="/connectors">
        <Plug aria-hidden /> {t("apps.setup.openConnectors")} <ExternalLink aria-hidden />
      </Link>
    </div>
  );
}

function ConnectorRow({ connector }: { connector: Connector }) {
  const t = useT();
  const setup = useApiQuery<{ id: string; steps: string[] }>(
    ["connector-setup", connector.id],
    `/api/connectors/${encodeURIComponent(connector.id)}/setup`,
    { staleTime: 60_000 },
  );
  const configured = connector.status === "configured";
  return (
    <li>
      <div className="apps-conn-row">
        {/mail|email/i.test(connector.kind) || /mail|email/i.test(connector.id) ? (
          <Mail aria-hidden />
        ) : (
          <CalendarDays aria-hidden />
        )}
        <span className="name truncate">{connector.name}</span>
        <Badge kind="state" tone={configured ? "ok" : "dim"}>
          {t(configured ? "apps.setup.status.configured" : "apps.setup.status.not_configured")}
        </Badge>
      </div>
      {(setup.data?.steps ?? []).length > 0 && (
        <ol className="plain-list meta">
          {(setup.data?.steps ?? []).map((line, i) => (
            <li key={i} className="mono">
              {line}
            </li>
          ))}
        </ol>
      )}
    </li>
  );
}

/* ------------------------------------------------------- appearance ------ */

function AppearanceStep({ preset, onPreset }: { preset: PresetId; onPreset: (id: PresetId) => void }) {
  const t = useT();
  return (
    <div className="stack">
      <p className="hint">{t("apps.setup.appearanceHint")}</p>
      <div className="apps-presets">
        {PRESETS.map((p) => (
          <button
            key={p.id}
            type="button"
            className="apps-preset"
            aria-pressed={p.id === preset}
            onClick={() => onPreset(p.id)}
          >
            <span className="swatch" aria-hidden>
              {p.swatch.map((c, i) => (
                <span key={i} style={{ background: c }} />
              ))}
            </span>
            <span className="name">
              {p.label}
              {p.id === preset && <Check aria-hidden />}
            </span>
            <span className="accent mono">{p.accent}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
