import { useEffect, useState } from "react";
import { api, type ProviderId, type ProviderSnapshot } from "../api";
import { useT, type Lang } from "../i18n";
import { Loading, useToast } from "../components/ui";

/**
 * Minimal in-UI setup for when the guided terminal setup was skipped.
 * Covers the essentials; everything is editable later in Settings.
 */
export default function Setup({ onDone }: { onDone: () => void }) {
  const t = useT();
  const toast = useToast();
  const [providers, setProviders] = useState<ProviderSnapshot[] | null>(null);
  const [enabled, setEnabled] = useState<Record<ProviderId, boolean>>({ claude: false, cursor: false, codex: false });
  const [defaultProvider, setDefaultProvider] = useState<ProviderId>("claude");
  const [name, setName] = useState("MordomoOS");
  const [language, setLanguage] = useState<Lang>("en");
  const [theme, setTheme] = useState<"dark" | "light">("dark");
  const [folder, setFolder] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void api.get<ProviderSnapshot[]>("/api/providers?force=1").then((snapshot) => {
      setProviders(snapshot);
      const next = { claude: false, cursor: false, codex: false };
      for (const s of snapshot) next[s.id] = s.health.installed;
      setEnabled(next);
      const firstInstalled = snapshot.find((s) => s.health.installed)?.id;
      if (firstInstalled && !snapshot.find((s) => s.id === "claude")?.health.installed) {
        setDefaultProvider(firstInstalled);
      }
    });
  }, []);

  const finish = async () => {
    setBusy(true);
    try {
      const current = await api.get<Record<string, unknown>>("/api/settings");
      const provSettings = current.providers as Record<ProviderId, Record<string, unknown>>;
      for (const id of ["claude", "cursor", "codex"] as ProviderId[]) {
        provSettings[id] = { ...provSettings[id], enabled: enabled[id] };
      }
      await api.put("/api/settings", {
        systemName: name,
        language,
        theme,
        defaultProvider: enabled[defaultProvider] ? defaultProvider : (Object.entries(enabled).find(([, v]) => v)?.[0] as ProviderId ?? "claude"),
        providers: provSettings,
        indexedFolders: folder.trim()
          ? [...(current.indexedFolders as Array<Record<string, unknown>>), { path: folder.trim(), area: null, enabled: true }]
          : (current.indexedFolders as Array<Record<string, unknown>>),
        setupCompleted: true,
      });
      if (folder.trim()) {
        await api.post("/api/memory/index").catch(() => undefined);
        await api.post("/api/memory/routers").catch(() => undefined);
      }
      onDone();
    } catch (err) {
      toast((err as Error).message, "danger");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="main" style={{ height: "100%" }}>
      <div className="page" style={{ maxWidth: 640 }}>
        <div className="page-head" style={{ marginTop: 32 }}>
          <div>
            <h1>{t("setup.welcome")} 👋</h1>
            <p className="sub">{t("setup.notDone")}</p>
            <pre className="preview-pre" style={{ marginTop: 8 }}>npx mordomo setup</pre>
            <p className="sub">{t("setup.orUi")}</p>
          </div>
        </div>

        {!providers ? (
          <Loading />
        ) : (
          <div className="card">
            <div className="field">
              <label>{t("settings.providers")}</label>
              {providers.map((prov) => (
                <label key={prov.id} style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  <input
                    type="checkbox"
                    checked={enabled[prov.id]}
                    onChange={(e) => setEnabled({ ...enabled, [prov.id]: e.target.checked })}
                  />
                  <strong>{prov.id}</strong>
                  <span className={`dot ${prov.health.installed ? (prov.health.ok ? "ok" : "warn") : "danger"}`} />
                  <span className="meta">{prov.health.installed ? (prov.health.version ?? "installed") : prov.health.detail}</span>
                </label>
              ))}
            </div>
            <div className="grid grid-2">
              <div className="field">
                <label htmlFor="su-default">{t("dash.default")}</label>
                <select id="su-default" className="input" value={defaultProvider} onChange={(e) => setDefaultProvider(e.target.value as ProviderId)}>
                  {providers.filter((p) => enabled[p.id]).map((p) => <option key={p.id} value={p.id}>{p.id}</option>)}
                </select>
              </div>
              <div className="field">
                <label htmlFor="su-name">{t("settings.name")}</label>
                <input id="su-name" className="input" value={name} onChange={(e) => setName(e.target.value)} />
              </div>
              <div className="field">
                <label htmlFor="su-lang">{t("settings.language")}</label>
                <select id="su-lang" className="input" value={language} onChange={(e) => setLanguage(e.target.value as Lang)}>
                  <option value="en">English</option>
                  <option value="pt-BR">Português (Brasil)</option>
                </select>
              </div>
              <div className="field">
                <label htmlFor="su-theme">{t("settings.theme")}</label>
                <select id="su-theme" className="input" value={theme} onChange={(e) => setTheme(e.target.value as "dark" | "light")}>
                  <option value="dark">{t("settings.dark")}</option>
                  <option value="light">{t("settings.light")}</option>
                </select>
              </div>
            </div>
            <div className="field">
              <label htmlFor="su-folder">{t("settings.folders")} ({t("settings.addFolder").toLowerCase()})</label>
              <input id="su-folder" className="input mono" placeholder={t("settings.folderPh")} value={folder} onChange={(e) => setFolder(e.target.value)} />
            </div>
            <button className="btn primary" onClick={finish} disabled={busy || !Object.values(enabled).some(Boolean)}>
              {busy ? <span className="spinner" aria-hidden /> : null} {t("setup.finish")}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
