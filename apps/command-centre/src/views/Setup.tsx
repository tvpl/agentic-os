import { useContext, useEffect, useState } from "react";
import { Check, Copy } from "lucide-react";
import { useMutation } from "@tanstack/react-query";
import { api, type ProviderId, type ProviderSnapshot } from "../api";
import { I18nContext, useT, type Lang } from "../i18n";
import { useApiQuery } from "../queries";
import { ErrorBox, Skeleton, useToast } from "../components/ui";
import { Button, Field } from "../components/primitives";
import { copyText, errorMessage, isAbsolutePath, isOffline } from "./shared";

/**
 * In-UI setup for when the guided terminal setup was skipped: three steps
 * (providers → identity → folders). Everything is editable later in Settings.
 */
export default function Setup({ onDone }: { onDone: () => void }) {
  const t = useT();
  const toast = useToast();
  const { lang, setLang } = useContext(I18nContext);
  const providers = useApiQuery<ProviderSnapshot[]>(["providers", "force"], "/api/providers?force=1", { staleTime: 60_000 });
  const [step, setStep] = useState(0);
  const [enabled, setEnabled] = useState<Record<ProviderId, boolean> | null>(null);
  const [defaultProvider, setDefaultProvider] = useState<ProviderId>("claude");
  const [name, setName] = useState("MordomoOS");
  const [theme, setTheme] = useState<"dark" | "light">("dark");
  const [folder, setFolder] = useState("");
  const [folderError, setFolderError] = useState<string | null>(null);
  const [phase, setPhase] = useState<"idle" | "saving" | "indexing">("idle");

  useEffect(() => {
    if (!providers.data || enabled) return;
    const next: Record<ProviderId, boolean> = { claude: false, cursor: false, codex: false };
    for (const s of providers.data) next[s.id] = s.health.installed;
    setEnabled(next);
    const firstInstalled = providers.data.find((s) => s.health.installed)?.id;
    if (firstInstalled && !providers.data.find((s) => s.id === "claude")?.health.installed) setDefaultProvider(firstInstalled);
  }, [providers.data, enabled]);

  const finish = useMutation({
    mutationFn: async () => {
      if (!enabled) return;
      setPhase("saving");
      const current = await api.get<Record<string, unknown>>("/api/settings");
      const provSettings = current.providers as Record<ProviderId, Record<string, unknown>>;
      for (const id of ["claude", "cursor", "codex"] as ProviderId[]) provSettings[id] = { ...provSettings[id], enabled: enabled[id] };
      const chosenDefault = enabled[defaultProvider] ? defaultProvider : ((Object.entries(enabled).find(([, v]) => v)?.[0] as ProviderId | undefined) ?? "claude");
      const folders = current.indexedFolders as Array<Record<string, unknown>>;
      await api.put("/api/settings", {
        systemName: name.trim() || "MordomoOS",
        language: lang,
        theme,
        defaultProvider: chosenDefault,
        providers: provSettings,
        indexedFolders: folder.trim() ? [...folders, { path: folder.trim(), area: null, enabled: true }] : folders,
        setupCompleted: true,
      });
      if (folder.trim()) {
        setPhase("indexing");
        await api.post("/api/memory/index");
        await api.post("/api/memory/routers");
      }
    },
    onSuccess: () => onDone(),
    onError: (err: Error) => {
      setPhase("idle");
      const msg = err.message;
      if (/folder/i.test(msg) || /pasta/i.test(msg)) setFolderError(msg);
      toast(msg, "danger");
    },
  });

  const steps = [t("setup.stepProviders"), t("setup.stepIdentity"), t("setup.stepFolders")];
  const anyEnabled = enabled ? Object.values(enabled).some(Boolean) : false;
  const folderOk = !folder.trim() || isAbsolutePath(folder);

  return (
    <div className="main setup" style={{ height: "100%" }}>
      <div className="page" style={{ maxWidth: 680 }}>
        <div className="page-head" style={{ marginTop: 32 }}>
          <div>
            <h1>{t("setup.welcome")} 👋</h1>
            <p className="sub">{t("setup.notDone")}</p>
            <div className="setup-cmd">
              <pre className="preview-pre tight">npx mordomo setup</pre>
              <Button size="sm" variant="ghost" icon={<Copy aria-hidden />} aria-label={t("brain.copyPath")} title={t("brain.copyPath")} onClick={() => void copyText("npx mordomo setup").then((ok) => toast(ok ? t("brain.copied") : t("skills.copyFailed"), ok ? "ok" : "danger"))} />
            </div>
            <p className="sub">{t("setup.orUi")}</p>
          </div>
        </div>

        <ol className="stepper" aria-label={t("setup.progress")}>
          {steps.map((label, i) => (
            <li key={label} className={i === step ? "current" : i < step ? "done" : ""} aria-current={i === step ? "step" : undefined}>
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
            <ErrorBox message={errorMessage(providers.error)} offline={isOffline(providers.error)} onRetry={() => void providers.refetch()} />
          </div>
        ) : !enabled ? null : (
          <div className="card">
            {step === 0 && (
              <>
                <fieldset className="field">
                  <legend className="label">{t("settings.providers")}</legend>
                  {(providers.data ?? []).map((prov) => (
                    <label key={prov.id} className="check">
                      <input type="checkbox" checked={enabled[prov.id]} disabled={!prov.health.installed} onChange={(e) => setEnabled({ ...enabled, [prov.id]: e.target.checked })} />
                      <strong>{prov.id}</strong>
                      <span className={`dot ${prov.health.installed ? (prov.health.ok ? "ok" : "warn") : "danger"}`} />
                      <span className="meta">{prov.health.installed ? (prov.health.version ?? t("setup.installed")) : prov.health.detail}</span>
                    </label>
                  ))}
                  {!anyEnabled && <p className="hint warn">{t("setup.noProvider")}</p>}
                </fieldset>
                <Field label={t("dash.default")} htmlFor="su-default">
                  <select id="su-default" className="input" value={defaultProvider} onChange={(e) => setDefaultProvider(e.target.value as ProviderId)}>
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
                  <input id="su-name" className="input" value={name} onChange={(e) => setName(e.target.value)} />
                </Field>
                <Field label={t("settings.language")} htmlFor="su-lang">
                  <select id="su-lang" className="input" value={lang} onChange={(e) => setLang(e.target.value as Lang)}>
                    <option value="en">English</option>
                    <option value="pt-BR">Português (Brasil)</option>
                  </select>
                </Field>
                <Field label={t("settings.theme")} htmlFor="su-theme">
                  <select id="su-theme" className="input" value={theme} onChange={(e) => setTheme(e.target.value as "dark" | "light")}>
                    <option value="dark">{t("settings.dark")}</option>
                    <option value="light">{t("settings.light")}</option>
                  </select>
                </Field>
              </div>
            )}
            {step === 2 && (
              <Field label={t("settings.folders")} htmlFor="su-folder" hint={t("setup.folderHint")} error={folderError ?? (folderOk ? undefined : t("settings.folderAbsolute"))}>
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
            <div className="modal-actions">
              {step > 0 && (
                <Button variant="secondary" onClick={() => setStep((s) => s - 1)} disabled={finish.isPending}>
                  {t("common.back")}
                </Button>
              )}
              {step < 2 ? (
                <Button variant="primary" onClick={() => setStep((s) => s + 1)} disabled={step === 0 && !anyEnabled}>
                  {t("common.next")}
                </Button>
              ) : (
                <Button variant="primary" onClick={() => finish.mutate()} disabled={!anyEnabled || !folderOk} loading={finish.isPending}>
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
