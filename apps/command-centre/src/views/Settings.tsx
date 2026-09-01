import { useContext, useState } from "react";
import { CheckCircle2, Download, RefreshCw, Stethoscope } from "lucide-react";
import { api, type DoctorReport, type ProviderId, type ProviderSnapshot } from "../api";
import { I18nContext, useT, type Lang } from "../i18n";
import { ErrorBox, Loading, formatBytes, timeAgo, useApi, useToast } from "../components/ui";

interface SettingsShape {
  systemName: string;
  language: Lang;
  theme: "dark" | "light" | "system";
  accentColor: string;
  port: number;
  timezone: string;
  defaultProvider: ProviderId;
  securityProfile: string;
  providers: Record<ProviderId, { enabled: boolean; defaultModel: string | null; defaultEffort: string; binaryPath: string | null }>;
  indexedFolders: Array<{ path: string; area: string | null; enabled: boolean }>;
  excludes: string[];
  areas: string[];
  setupCompleted: boolean;
}

interface Approval {
  id: string;
  kind: string;
  description: string;
  createdAt: number;
}

interface BackupInfo {
  name: string;
  path: string;
  createdAt: number;
  sizeBytes: number;
}

export default function Settings({ onMetaChanged }: { onMetaChanged: () => void }) {
  const t = useT();
  const { lang, setLang } = useContext(I18nContext);
  const toast = useToast();
  const [doctor, setDoctor] = useState<DoctorReport | null>(null);
  const [doctorBusy, setDoctorBusy] = useState(false);

  const settingsApi = useApi<SettingsShape>(() => api.get("/api/settings"));
  const providersApi = useApi<ProviderSnapshot[]>(() => api.get("/api/providers"));
  const approvalsApi = useApi<Approval[]>(() => api.get("/api/approvals"));
  const backupsApi = useApi<BackupInfo[]>(() => api.get("/api/backups"));

  if (settingsApi.loading && !settingsApi.data) return <div className="page"><Loading /></div>;
  if (settingsApi.error && !settingsApi.data)
    return <div className="page"><ErrorBox message={settingsApi.error} offline={settingsApi.offline} onRetry={settingsApi.reload} /></div>;
  const s = settingsApi.data;
  if (!s) return null;

  const save = async (patch: Partial<SettingsShape>, silent = false) => {
    try {
      const res = await api.put<{ settings: SettingsShape; pendingApproval: Approval | null }>("/api/settings", patch);
      if (res.pendingApproval) toast(res.pendingApproval.description, "info");
      else if (!silent) toast(t("common.save") + " ✓", "ok");
      settingsApi.reload();
      approvalsApi.reload();
      onMetaChanged();
    } catch (err) {
      toast((err as Error).message, "danger");
    }
  };

  const runDoctor = async () => {
    setDoctorBusy(true);
    try {
      setDoctor(await api.get<DoctorReport>("/api/doctor"));
    } catch (err) {
      toast((err as Error).message, "danger");
    } finally {
      setDoctorBusy(false);
    }
  };

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>{t("settings.title")}</h1>
        </div>
      </div>

      <div className="grid grid-2" style={{ alignItems: "start" }}>
        <div>
          {/* Identity */}
          <div className="card">
            <h2>{t("settings.identity")}</h2>
            <div className="field">
              <label htmlFor="st-name">{t("settings.name")}</label>
              <input id="st-name" className="input" defaultValue={s.systemName} onBlur={(e) => e.target.value !== s.systemName && save({ systemName: e.target.value })} />
            </div>
            <div className="grid grid-2">
              <div className="field">
                <label htmlFor="st-theme">{t("settings.theme")}</label>
                <select id="st-theme" className="input" value={s.theme} onChange={(e) => save({ theme: e.target.value as SettingsShape["theme"] }, true)}>
                  <option value="dark">{t("settings.dark")}</option>
                  <option value="light">{t("settings.light")}</option>
                  <option value="system">{t("settings.system")}</option>
                </select>
              </div>
              <div className="field">
                <label htmlFor="st-lang">{t("settings.language")}</label>
                <select
                  id="st-lang"
                  className="input"
                  value={s.language}
                  onChange={(e) => {
                    setLang(e.target.value as Lang);
                    void save({ language: e.target.value as Lang }, true);
                  }}
                >
                  <option value="en">English</option>
                  <option value="pt-BR">Português (Brasil)</option>
                </select>
              </div>
              <div className="field">
                <label htmlFor="st-accent">{t("settings.accent")}</label>
                <input id="st-accent" type="color" className="input" style={{ height: 36, padding: 3 }} value={s.accentColor} onChange={(e) => save({ accentColor: e.target.value }, true)} />
              </div>
              <div className="field">
                <label htmlFor="st-port">{t("settings.port")}</label>
                <input id="st-port" type="number" className="input" defaultValue={s.port} onBlur={(e) => Number(e.target.value) !== s.port && save({ port: Number(e.target.value) })} />
                <span className="hint">127.0.0.1 only — restart to apply</span>
              </div>
            </div>
            <div className="field">
              <label htmlFor="st-tz">{t("settings.timezone")}</label>
              <input id="st-tz" className="input" defaultValue={s.timezone} onBlur={(e) => e.target.value !== s.timezone && save({ timezone: e.target.value })} />
            </div>
            <p className="hint" style={{ color: "var(--text-faint)" }}>
              {t("settings.dataDir")}: <span className="mono">MORDOMO_HOME</span> — {t("settings.dataDirHint")}
            </p>
          </div>

          {/* Providers */}
          <div className="card">
            <h2>{t("settings.providers")}</h2>
            {(providersApi.data ?? []).map((prov) => (
              <div key={prov.id} style={{ borderBottom: "1px solid var(--border)", padding: "10px 0" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                  <div>
                    <strong>{prov.id}</strong>{" "}
                    <span className={`dot ${prov.health.ok ? "ok" : prov.health.installed ? "warn" : "danger"}`} />
                    <div className="meta">
                      {prov.health.installed ? `${prov.health.version ?? "installed"} · auth: ${String(prov.health.authenticated)}` : prov.health.detail}
                    </div>
                  </div>
                  <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                    {prov.isDefault && <span className="badge info">{t("dash.default")}</span>}
                    <label style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 13 }}>
                      <input
                        type="checkbox"
                        checked={s.providers[prov.id].enabled}
                        onChange={(e) =>
                          save({ providers: { ...s.providers, [prov.id]: { ...s.providers[prov.id], enabled: e.target.checked } } })
                        }
                      />
                      {t("common.enabled")}
                    </label>
                    <button
                      className="btn sm"
                      onClick={async () => {
                        const res = await api.post<{ run: { status: string; durationMs: number | null }; passed: boolean }>(`/api/providers/${prov.id}/smoke`);
                        toast(`${prov.id}: ${res.passed ? "OK" : res.run.status}`, res.passed ? "ok" : "danger");
                        providersApi.reload();
                      }}
                      disabled={!s.providers[prov.id].enabled || !prov.health.installed}
                    >
                      smoke test
                    </button>
                  </div>
                </div>
                <div className="grid grid-2" style={{ marginTop: 8 }}>
                  <input
                    className="input mono"
                    placeholder={t("skills.model")}
                    aria-label={`${prov.id} model`}
                    defaultValue={s.providers[prov.id].defaultModel ?? ""}
                    onBlur={(e) =>
                      save({ providers: { ...s.providers, [prov.id]: { ...s.providers[prov.id], defaultModel: e.target.value || null } } }, true)
                    }
                  />
                  <select
                    className="input"
                    aria-label={`${prov.id} effort`}
                    value={s.providers[prov.id].defaultEffort}
                    onChange={(e) =>
                      save({ providers: { ...s.providers, [prov.id]: { ...s.providers[prov.id], defaultEffort: e.target.value } } }, true)
                    }
                  >
                    {["default", "low", "medium", "high"].map((e2) => <option key={e2} value={e2}>{t("skills.effort")}: {e2}</option>)}
                  </select>
                </div>
              </div>
            ))}
          </div>

          {/* Security */}
          <div className="card">
            <h2>{t("settings.security")}</h2>
            <div className="field">
              <label htmlFor="st-profile">{t("settings.profile")}</label>
              <select id="st-profile" className="input" value={s.securityProfile} onChange={(e) => save({ securityProfile: e.target.value })}>
                {["read_only", "review_before_write", "controlled_write", "approved_automation"].map((prof) => (
                  <option key={prof} value={prof}>{t(`profile.${prof}` as Parameters<typeof t>[0])}</option>
                ))}
              </select>
            </div>
            <h2 style={{ marginTop: 14 }}>{t("settings.approvals")}</h2>
            {(approvalsApi.data ?? []).length === 0 ? (
              <p style={{ color: "var(--text-faint)", margin: 0 }}>{t("settings.noApprovals")}</p>
            ) : (
              (approvalsApi.data ?? []).map((a) => (
                <div className="list-row" key={a.id}>
                  <div>
                    <span className="badge warn">{a.kind}</span>
                    <div style={{ fontSize: 13, marginTop: 4 }}>{a.description}</div>
                  </div>
                  <div style={{ display: "flex", gap: 6 }}>
                    <button
                      className="btn sm primary"
                      onClick={async () => {
                        await api.post(`/api/approvals/${a.id}/resolve`, { decision: "approved" });
                        approvalsApi.reload();
                        settingsApi.reload();
                      }}
                    >
                      {t("settings.approve")}
                    </button>
                    <button
                      className="btn sm danger"
                      onClick={async () => {
                        await api.post(`/api/approvals/${a.id}/resolve`, { decision: "denied" });
                        approvalsApi.reload();
                      }}
                    >
                      {t("settings.deny")}
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        <div>
          {/* Memory */}
          <div className="card">
            <h2>{t("settings.memory")}</h2>
            <FolderEditor s={s} onSave={save} />
            <div className="field" style={{ marginTop: 10 }}>
              <label htmlFor="st-areas">{t("settings.areas")}</label>
              <input
                id="st-areas"
                className="input"
                defaultValue={s.areas.join(", ")}
                onBlur={(e) => {
                  const areas = e.target.value.split(",").map((a) => a.trim()).filter(Boolean);
                  if (areas.join() !== s.areas.join()) void save({ areas });
                }}
              />
            </div>
            <div className="field">
              <label htmlFor="st-excludes">{t("settings.excludes")}</label>
              <textarea
                id="st-excludes"
                className="input mono"
                style={{ minHeight: 90, fontSize: 12 }}
                defaultValue={s.excludes.join("\n")}
                onBlur={(e) => {
                  const excludes = e.target.value.split("\n").map((x) => x.trim()).filter(Boolean);
                  if (excludes.join() !== s.excludes.join()) void save({ excludes });
                }}
              />
            </div>
          </div>

          {/* Backups */}
          <div className="card">
            <h2>{t("settings.backups")}</h2>
            <button
              className="btn"
              onClick={async () => {
                const b = await api.post<BackupInfo>("/api/backups", {});
                toast(`${b.name} (${formatBytes(b.sizeBytes)})`, "ok");
                backupsApi.reload();
              }}
            >
              <Download aria-hidden /> {t("settings.newBackup")}
            </button>
            <div style={{ marginTop: 10 }}>
              {(backupsApi.data ?? []).slice(0, 6).map((b) => (
                <div className="list-row" key={b.name}>
                  <div className="truncate">
                    <span className="mono" style={{ fontSize: 12 }}>{b.name}</span>
                    <div className="meta">{timeAgo(b.createdAt, lang)} · {formatBytes(b.sizeBytes)}</div>
                  </div>
                  <button
                    className="btn sm"
                    onClick={async () => {
                      if (!window.confirm(`${t("settings.restore")} ${b.name}?`)) return;
                      const res = await api.post<{ note: string }>(`/api/backups/${b.name}/restore`);
                      toast(res.note, "info");
                    }}
                  >
                    {t("settings.restore")}
                  </button>
                </div>
              ))}
            </div>
          </div>

          {/* Doctor */}
          <div className="card">
            <h2>{t("settings.doctor")}</h2>
            <button className="btn" onClick={runDoctor} disabled={doctorBusy}>
              {doctorBusy ? <span className="spinner" aria-hidden /> : <Stethoscope aria-hidden />} {t("settings.runDoctor")}
            </button>
            {doctor && (
              <div style={{ marginTop: 10 }}>
                {doctor.checks.map((c) => (
                  <div className="list-row" key={c.id}>
                    <div className="truncate">
                      <span className={`dot ${c.status === "ok" ? "ok" : c.status === "warn" ? "warn" : c.status === "fail" ? "danger" : "dim"}`} style={{ marginRight: 8 }} />
                      {c.label}
                      <div className="meta truncate" title={c.detail}>{c.detail}</div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function FolderEditor({ s, onSave }: { s: { indexedFolders: Array<{ path: string; area: string | null; enabled: boolean }>; areas: string[] }; onSave: (patch: Record<string, unknown>) => Promise<void> }) {
  const t = useT();
  const [newPath, setNewPath] = useState("");
  const [newArea, setNewArea] = useState("");
  return (
    <>
      <div className="field">
        <label>{t("settings.folders")}</label>
        {s.indexedFolders.length === 0 && <span className="hint">—</span>}
        {s.indexedFolders.map((f, i) => (
          <div key={f.path} style={{ display: "flex", gap: 6, alignItems: "center" }}>
            <span className="mono truncate" style={{ flex: 1, fontSize: 12 }}>{f.path}</span>
            <select
              className="input"
              style={{ width: 130 }}
              value={f.area ?? ""}
              aria-label={`${t("brain.filterArea")} ${f.path}`}
              onChange={(e) => {
                const folders = [...s.indexedFolders];
                folders[i] = { ...f, area: e.target.value || null };
                void onSave({ indexedFolders: folders });
              }}
            >
              <option value="">—</option>
              {s.areas.map((a) => <option key={a} value={a}>{a}</option>)}
            </select>
            <button
              className="btn ghost sm"
              aria-label={`${t("common.delete")} ${f.path}`}
              onClick={() => void onSave({ indexedFolders: s.indexedFolders.filter((x) => x.path !== f.path) })}
            >
              ✕
            </button>
          </div>
        ))}
      </div>
      <div style={{ display: "flex", gap: 6 }}>
        <input className="input mono" placeholder={t("settings.folderPh")} value={newPath} onChange={(e) => setNewPath(e.target.value)} aria-label={t("settings.addFolder")} />
        <select className="input" style={{ width: 130 }} value={newArea} onChange={(e) => setNewArea(e.target.value)} aria-label={t("brain.filterArea")}>
          <option value="">—</option>
          {s.areas.map((a) => <option key={a} value={a}>{a}</option>)}
        </select>
        <button
          className="btn sm"
          disabled={!newPath.trim()}
          onClick={async () => {
            await onSave({
              indexedFolders: [...s.indexedFolders, { path: newPath.trim(), area: newArea || null, enabled: true }],
            });
            setNewPath("");
            setNewArea("");
          }}
        >
          <CheckCircle2 aria-hidden /> {t("settings.addFolder")}
        </button>
      </div>
      <p className="hint" style={{ marginTop: 6 }}>
        <RefreshCw size={11} style={{ verticalAlign: -1 }} aria-hidden /> {t("brain.refresh")}: {t("nav.brain")} → {t("brain.refresh")}
      </p>
    </>
  );
}
