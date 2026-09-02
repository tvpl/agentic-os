import { useContext, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { CheckCircle2, Download, RefreshCw, Stethoscope } from "lucide-react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api, type DoctorReport, type ProviderId, type ProviderSnapshot } from "../api";
import { I18nContext, useLocale, useT, type Lang } from "../i18n";
import { qk, useApiQuery, useOsProviders } from "../queries";
import { ErrorBox, Skeleton, formatBytes, timeAgo, useToast } from "../components/ui";
import { Badge, Button, EmptyState, Field, Tabs } from "../components/primitives";
import { useConfirm } from "../hooks/useConfirm";
import { errorMessage, isAbsolutePath, isOffline } from "./shared";

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

type TabId = "identity" | "providers" | "memory" | "security" | "backups" | "diagnostics";
const TAB_IDS: TabId[] = ["identity", "providers", "memory", "security", "backups", "diagnostics"];
const PROFILES = ["read_only", "review_before_write", "controlled_write", "approved_automation"] as const;

export default function Settings({ onMetaChanged }: { onMetaChanged: () => void }) {
  const t = useT();
  const toast = useToast();
  const { setLang } = useContext(I18nContext);
  const qc = useQueryClient();
  const [params, setParams] = useSearchParams();
  const requested = params.get("tab") as TabId | null;
  const [tab, setTabState] = useState<TabId>(requested && TAB_IDS.includes(requested) ? requested : "identity");
  const setTab = (id: TabId) => {
    setTabState(id);
    setParams(id === "identity" ? {} : { tab: id }, { replace: true });
  };
  const settings = useApiQuery<SettingsShape>(qk.settings, "/api/settings");

  const save = useMutation({
    mutationFn: ({ patch }: { patch: Partial<SettingsShape>; silent?: boolean }) => api.put<{ settings: SettingsShape; pendingApproval: Approval | null }>("/api/settings", patch),
    onSuccess: (res, vars) => {
      if (res.pendingApproval) toast(res.pendingApproval.description, "info");
      else if (!vars.silent) toast(t("common.saved"), "ok");
      qc.setQueryData(qk.settings, res.settings);
      qc.invalidateQueries({ queryKey: qk.settings }).catch(() => undefined);
      qc.invalidateQueries({ queryKey: qk.approvals }).catch(() => undefined);
      qc.invalidateQueries({ queryKey: qk.providers }).catch(() => undefined);
      onMetaChanged();
    },
    onError: (err: Error) => {
      toast(err.message, "danger");
      // Inputs are keyed by the saved value, so a refetch reverts what failed.
      qc.invalidateQueries({ queryKey: qk.settings }).catch(() => undefined);
    },
  });
  const put = (patch: Partial<SettingsShape>, silent = false) => save.mutateAsync({ patch, silent }).catch(() => undefined);

  if (settings.isPending && !settings.data) return <div className="page"><Skeleton lines={8} /></div>;
  if (settings.error && !settings.data) return <div className="page"><ErrorBox message={errorMessage(settings.error)} offline={isOffline(settings.error)} onRetry={() => void settings.refetch()} /></div>;
  const s = settings.data;
  if (!s) return null;

  const tabs: Array<{ id: TabId; label: string }> = [
    { id: "identity", label: t("settings.identity") },
    { id: "providers", label: t("settings.providers") },
    { id: "memory", label: t("settings.memory") },
    { id: "security", label: t("settings.security") },
    { id: "backups", label: t("settings.backups") },
    { id: "diagnostics", label: t("settings.doctor") },
  ];

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>{t("settings.title")}</h1>
        </div>
      </div>
      <Tabs tabs={tabs} active={tab} onChange={(id) => setTab(id as TabId)} ariaLabel={t("settings.title")} />
      <div className="tab-panel" role="tabpanel">
        {tab === "identity" && <IdentityTab s={s} put={put} setLang={setLang} />}
        {tab === "providers" && <ProvidersTab s={s} put={put} />}
        {tab === "memory" && <MemoryTab s={s} put={put} />}
        {tab === "security" && <SecurityTab s={s} put={put} />}
        {tab === "backups" && <BackupsTab />}
        {tab === "diagnostics" && <DiagnosticsTab />}
      </div>
    </div>
  );
}

type Put = (patch: Partial<SettingsShape>, silent?: boolean) => Promise<unknown>;

function IdentityTab({ s, put, setLang }: { s: SettingsShape; put: Put; setLang: (l: Lang) => void }) {
  const t = useT();
  return (
    <div className="card stack">
      <Field label={t("settings.name")} htmlFor="st-name">
        <input key={s.systemName} id="st-name" className="input" defaultValue={s.systemName} onBlur={(e) => e.target.value.trim() && e.target.value !== s.systemName && void put({ systemName: e.target.value.trim() })} />
      </Field>
      <div className="grid grid-2">
        <Field label={t("settings.theme")} htmlFor="st-theme">
          <select id="st-theme" className="input" value={s.theme} onChange={(e) => void put({ theme: e.target.value as SettingsShape["theme"] }, true)}>
            <option value="dark">{t("settings.dark")}</option>
            <option value="light">{t("settings.light")}</option>
            <option value="system">{t("settings.system")}</option>
          </select>
        </Field>
        <Field label={t("settings.language")} htmlFor="st-lang">
          <select
            id="st-lang"
            className="input"
            value={s.language}
            onChange={(e) => {
              setLang(e.target.value as Lang);
              void put({ language: e.target.value as Lang }, true);
            }}
          >
            <option value="en">English</option>
            <option value="pt-BR">Português (Brasil)</option>
          </select>
        </Field>
        <Field label={t("settings.accent")} htmlFor="st-accent">
          <input id="st-accent" type="color" className="input" style={{ height: 36, padding: 3 }} value={s.accentColor} onChange={(e) => void put({ accentColor: e.target.value }, true)} />
        </Field>
        <Field label={t("settings.port")} htmlFor="st-port" hint={t("settings.portHint")}>
          <input key={s.port} id="st-port" type="number" min={1024} max={65535} className="input" defaultValue={s.port} onBlur={(e) => Number(e.target.value) !== s.port && void put({ port: Number(e.target.value) })} />
        </Field>
      </div>
      <Field label={t("settings.timezone")} htmlFor="st-tz" hint={t("settings.timezoneHint")}>
        <input key={s.timezone} id="st-tz" className="input" defaultValue={s.timezone} onBlur={(e) => e.target.value !== s.timezone && void put({ timezone: e.target.value })} />
      </Field>
      <Field label={t("settings.dataDir")} htmlFor="st-home" hint={t("settings.dataDirHint")}>
        <input id="st-home" className="input mono" readOnly value="MORDOMO_HOME" />
      </Field>
    </div>
  );
}

function ProvidersTab({ s, put }: { s: SettingsShape; put: Put }) {
  const t = useT();
  const toast = useToast();
  const qc = useQueryClient();
  const providers = useOsProviders();
  const smoke = useMutation({
    mutationFn: (id: ProviderId) => api.post<{ run: { status: string; durationMs: number | null }; passed: boolean }>(`/api/providers/${id}/smoke`),
    onSuccess: (res, id) => {
      toast(`${id}: ${res.passed ? t("settings.smokeOk") : res.run.status}`, res.passed ? "ok" : "danger");
      qc.invalidateQueries({ queryKey: qk.providers }).catch(() => undefined);
    },
    onError: (err: Error) => toast(err.message, "danger"),
  });
  const patchProvider = (id: ProviderId, patch: Partial<SettingsShape["providers"][ProviderId]>, silent = false) => put({ providers: { ...s.providers, [id]: { ...s.providers[id], ...patch } } }, silent);

  if (providers.isPending && !providers.data) return <div className="card"><Skeleton lines={6} /></div>;
  return (
    <div className="card stack">
      {(providers.data ?? []).map((prov: ProviderSnapshot) => (
        <div key={prov.id} className="provider-row">
          <div className="provider-head">
            <div>
              <strong>{prov.id}</strong> <span className={`dot ${prov.health.ok ? "ok" : prov.health.installed ? "warn" : "danger"}`} />
              <div className="meta">{prov.health.installed ? `${prov.health.version ?? t("setup.installed")} · ${t("settings.auth")}: ${prov.health.authenticated ? t("settings.authOk") : t("settings.authUnknown")}` : prov.health.detail}</div>
            </div>
            <div className="row-actions">
              {prov.isDefault && <Badge kind="state" tone="info">{t("dash.default")}</Badge>}
              <label className="check">
                <input type="checkbox" checked={s.providers[prov.id].enabled} onChange={(e) => void patchProvider(prov.id, { enabled: e.target.checked })} />
                {t("common.enabled")}
              </label>
              <Button size="sm" variant="secondary" onClick={() => smoke.mutate(prov.id)} disabled={!s.providers[prov.id].enabled || !prov.health.installed} loading={smoke.isPending && smoke.variables === prov.id}>
                {t("settings.smokeTest")}
              </Button>
            </div>
          </div>
          <div className="grid grid-2">
            <Field label={t("skills.model")} htmlFor={`st-model-${prov.id}`} hint={t("settings.modelHint")}>
              <input key={s.providers[prov.id].defaultModel ?? ""} id={`st-model-${prov.id}`} className="input mono" defaultValue={s.providers[prov.id].defaultModel ?? ""} onBlur={(e) => (e.target.value || null) !== s.providers[prov.id].defaultModel && void patchProvider(prov.id, { defaultModel: e.target.value || null }, true)} />
            </Field>
            <Field label={t("skills.effort")} htmlFor={`st-effort-${prov.id}`}>
              <select id={`st-effort-${prov.id}`} className="input" value={s.providers[prov.id].defaultEffort} onChange={(e) => void patchProvider(prov.id, { defaultEffort: e.target.value }, true)}>
                {["default", "low", "medium", "high"].map((e2) => (
                  <option key={e2} value={e2}>
                    {t(`effort.${e2}` as "effort.low")}
                  </option>
                ))}
              </select>
            </Field>
          </div>
        </div>
      ))}
    </div>
  );
}

function MemoryTab({ s, put }: { s: SettingsShape; put: Put }) {
  const t = useT();
  const confirm = useConfirm();
  const [newPath, setNewPath] = useState("");
  const [newArea, setNewArea] = useState("");
  const [pathError, setPathError] = useState<string | null>(null);
  const addFolder = useMutation({
    mutationFn: () => api.put("/api/settings", { indexedFolders: [...s.indexedFolders, { path: newPath.trim(), area: newArea || null, enabled: true }] }),
    onSuccess: () => {
      setNewPath("");
      setNewArea("");
      void put({}, true);
    },
    onError: (err: Error) => setPathError(err.message),
  });
  const removeFolder = async (path: string) => {
    if (await confirm({ title: t("settings.removeFolder"), body: path, danger: true, confirmLabel: t("common.delete") })) void put({ indexedFolders: s.indexedFolders.filter((x) => x.path !== path) });
  };
  const pathOk = !newPath.trim() || isAbsolutePath(newPath);

  return (
    <div className="card stack">
      <div className="field">
        <span className="label">{t("settings.folders")}</span>
        {s.indexedFolders.length === 0 && <p className="widget-muted">{t("settings.noFolders")}</p>}
        {s.indexedFolders.map((f, i) => (
          <div key={f.path} className="folder-row">
            <span className="mono truncate" title={f.path}>
              {f.path}
            </span>
            <select
              className="input sm"
              value={f.area ?? ""}
              aria-label={`${t("brain.filterArea")} ${f.path}`}
              onChange={(e) => {
                const folders = [...s.indexedFolders];
                folders[i] = { ...f, area: e.target.value || null };
                void put({ indexedFolders: folders }, true);
              }}
            >
              <option value="">—</option>
              {s.areas.map((a) => (
                <option key={a} value={a}>
                  {a}
                </option>
              ))}
            </select>
            <Button size="sm" variant="ghost" aria-label={`${t("common.delete")} ${f.path}`} title={t("common.delete")} onClick={() => void removeFolder(f.path)}>
              ✕
            </Button>
          </div>
        ))}
      </div>
      <Field label={t("settings.addFolder")} htmlFor="st-newfolder" hint={t("settings.folderHint")} error={pathError ?? (pathOk ? undefined : t("settings.folderAbsolute"))}>
        <div className="folder-add">
          <input
            id="st-newfolder"
            className="input mono"
            placeholder={t("settings.folderPh")}
            value={newPath}
            aria-invalid={!pathOk || Boolean(pathError)}
            onChange={(e) => {
              setNewPath(e.target.value);
              setPathError(null);
            }}
          />
          <select className="input" value={newArea} onChange={(e) => setNewArea(e.target.value)} aria-label={t("brain.filterArea")}>
            <option value="">—</option>
            {s.areas.map((a) => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
          </select>
          <Button size="sm" variant="primary" icon={<CheckCircle2 aria-hidden />} disabled={!newPath.trim() || !pathOk} loading={addFolder.isPending} onClick={() => addFolder.mutate()}>
            {t("settings.addFolder")}
          </Button>
        </div>
      </Field>
      <p className="hint">
        <RefreshCw size={11} style={{ verticalAlign: -1 }} aria-hidden /> {t("brain.refresh")}: {t("nav.brain")} → {t("brain.refresh")}
      </p>
      <Field label={t("settings.areas")} htmlFor="st-areas" hint={t("settings.areasHint")}>
        <input
          key={s.areas.join()}
          id="st-areas"
          className="input"
          defaultValue={s.areas.join(", ")}
          onBlur={(e) => {
            const areas = e.target.value.split(",").map((a) => a.trim()).filter(Boolean);
            if (areas.length && areas.join() !== s.areas.join()) void put({ areas });
          }}
        />
      </Field>
      <Field label={t("settings.excludes")} htmlFor="st-excludes" hint={t("settings.excludesHint")}>
        <textarea
          key={s.excludes.join()}
          id="st-excludes"
          className="input mono"
          rows={8}
          defaultValue={s.excludes.join("\n")}
          onBlur={(e) => {
            const excludes = e.target.value.split("\n").map((x) => x.trim()).filter(Boolean);
            if (excludes.join() !== s.excludes.join()) void put({ excludes });
          }}
        />
      </Field>
    </div>
  );
}

function SecurityTab({ s, put }: { s: SettingsShape; put: Put }) {
  const t = useT();
  const toast = useToast();
  const qc = useQueryClient();
  const approvals = useApiQuery<Approval[]>(qk.approvals, "/api/approvals");
  const resolve = useMutation({
    mutationFn: ({ id, decision }: { id: string; decision: "approved" | "denied" }) => api.post(`/api/approvals/${encodeURIComponent(id)}/resolve`, { decision }),
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
          <select id="st-profile" className="input" value={s.securityProfile} onChange={(e) => void put({ securityProfile: e.target.value })}>
            {PROFILES.map((prof) => (
              <option key={prof} value={prof}>
                {t(`profile.${prof}`)}
              </option>
            ))}
          </select>
        </Field>
        <ul className="plain-list profile-list">
          {PROFILES.map((prof) => (
            <li key={prof} className={prof === s.securityProfile ? "active" : ""}>
              <strong>{t(`profile.${prof}`)}</strong>
              <span className="meta">{t(`profile.${prof}.desc` as "profile.read_only.desc")}</span>
            </li>
          ))}
        </ul>
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
                <Badge kind="state" tone="warn">{a.kind}</Badge>
                <div className="approval-desc">{a.description}</div>
              </div>
              <div className="row-actions">
                <Button size="sm" variant="primary" onClick={() => resolve.mutate({ id: a.id, decision: "approved" })} loading={resolve.isPending && resolve.variables?.id === a.id}>
                  {t("settings.approve")}
                </Button>
                <Button size="sm" variant="danger" onClick={() => resolve.mutate({ id: a.id, decision: "denied" })}>
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

function BackupsTab() {
  const t = useT();
  const locale = useLocale();
  const toast = useToast();
  const confirm = useConfirm();
  const qc = useQueryClient();
  const backups = useApiQuery<BackupInfo[]>(qk.backups, "/api/backups");
  const create = useMutation({
    mutationFn: () => api.post<BackupInfo>("/api/backups", {}),
    onSuccess: (b) => {
      toast(`${b.name} (${formatBytes(b.sizeBytes)})`, "ok");
      qc.invalidateQueries({ queryKey: qk.backups }).catch(() => undefined);
    },
    onError: (err: Error) => toast(err.message, "danger"),
  });
  const restore = useMutation({
    mutationFn: (name: string) => api.post<{ note?: string; message?: string; staged?: boolean }>(`/api/backups/${encodeURIComponent(name)}/restore`),
    onSuccess: (res) => toast(res.note ?? res.message ?? t("settings.restored"), "info"),
    onError: (err: Error) => toast(err.message, "danger"),
  });
  const onRestore = async (b: BackupInfo) => {
    if (await confirm({ title: `${t("settings.restore")} ${b.name}?`, body: t("settings.restoreBody"), danger: true, confirmLabel: t("settings.restore") })) restore.mutate(b.name);
  };
  return (
    <div className="card stack">
      <div>
        <Button variant="primary" icon={<Download aria-hidden />} onClick={() => create.mutate()} loading={create.isPending}>
          {t("settings.newBackup")}
        </Button>
      </div>
      {backups.isPending ? (
        <Skeleton lines={3} />
      ) : (backups.data ?? []).length === 0 ? (
        <EmptyState title={t("settings.noBackups")} body={t("settings.noBackupsBody")} />
      ) : (
        (backups.data ?? []).slice(0, 8).map((b) => (
          <div className="list-row" key={b.name}>
            <div className="truncate">
              <span className="mono small">{b.name}</span>
              <div className="meta">
                {timeAgo(b.createdAt, locale)} · {formatBytes(b.sizeBytes)}
              </div>
            </div>
            <Button size="sm" variant="secondary" onClick={() => void onRestore(b)} loading={restore.isPending && restore.variables === b.name}>
              {t("settings.restore")}
            </Button>
          </div>
        ))
      )}
    </div>
  );
}

function DiagnosticsTab() {
  const t = useT();
  const toast = useToast();
  const doctor = useMutation({
    mutationFn: () => api.get<DoctorReport>("/api/doctor"),
    onError: (err: Error) => toast(err.message, "danger"),
  });
  return (
    <div className="card stack">
      <div>
        <Button variant="primary" icon={<Stethoscope aria-hidden />} onClick={() => doctor.mutate()} loading={doctor.isPending}>
          {t("settings.runDoctor")}
        </Button>
      </div>
      {doctor.data && (
        <div>
          {doctor.data.checks.map((c) => (
            <div className="list-row" key={c.id}>
              <div className="truncate">
                <span className={`dot ${c.status === "ok" ? "ok" : c.status === "warn" ? "warn" : c.status === "fail" ? "danger" : "dim"}`} style={{ marginRight: 8 }} />
                {c.label}
                <div className="meta truncate" title={c.detail}>
                  {c.detail}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
