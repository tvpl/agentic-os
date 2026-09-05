import { useContext, useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import {
  ArrowRight,
  Bell,
  BellOff,
  Check,
  CheckCircle2,
  Download,
  Eye,
  EyeOff,
  Plus,
  RefreshCw,
  Stethoscope,
  TerminalSquare,
  Trash2,
  Webhook,
  X,
} from "lucide-react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  api,
  type DeviceRecord,
  type DoctorReport,
  type MicroApp,
  type ProviderId,
  type ProviderSnapshot,
  type SettingsDoc,
} from "../api";

type SettingsShape = SettingsDoc;
import { I18nContext, useLocale, useT, type Lang } from "../i18n";
import { qk, useApiQuery, useOsMeta, useOsProviders } from "../queries";
import { TrendsTab } from "./Trends";
import { ErrorBox, Skeleton, formatBytes, timeAgo, useToast } from "../components/ui";
import { Badge, Button, EmptyState, Field, Tabs } from "../components/primitives";
import { useConfirm } from "../hooks/useConfirm";
import { getNotifySound, setNotifySound } from "../hooks/useNotifications";
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
} from "../hooks/systemNotify";
import {
  PRESETS,
  applyHudIntensity,
  applyPreset,
  currentHudIntensity,
  readStoredHudIntensity,
  type PresetId,
} from "../theme";
import { DEFAULT_LAYOUT, WIDGET_ORDER, baseId, isWidgetId, type WidgetBox } from "../desktop/defaultLayout";
import { WIDGET_REGISTRY } from "../desktop/registry";
import { errorMessage, isAbsolutePath, isOffline, slugify } from "./shared";
import "./apps.css";

/** Internal route ("/pixel") or an http(s) URL — same rule the desktop widget applies. */
export function isValidMicroAppHref(href: string): boolean {
  const h = href.trim();
  if (h.startsWith("/")) return !h.startsWith("//");
  return /^https?:\/\/\S+$/i.test(h);
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

type TabId =
  | "identity"
  | "theme"
  | "providers"
  | "memory"
  | "desktop"
  | "security"
  | "notifications"
  | "backups"
  | "diagnostics"
  | "trends";
const TAB_IDS: TabId[] = [
  "identity",
  "theme",
  "providers",
  "memory",
  "desktop",
  "security",
  "notifications",
  "backups",
  "diagnostics",
  "trends",
];
const PROFILES = ["read_only", "review_before_write", "controlled_write", "approved_automation"] as const;

export default function Settings({ onMetaChanged }: { onMetaChanged: () => void }) {
  const t = useT();
  const toast = useToast();
  const { setLang } = useContext(I18nContext);
  const qc = useQueryClient();
  const [params, setParams] = useSearchParams();
  const requested = params.get("tab") as TabId | null;
  const [tab, setTabState] = useState<TabId>(
    requested && TAB_IDS.includes(requested) ? requested : "identity",
  );
  const setTab = (id: TabId) => {
    setTabState(id);
    setParams(id === "identity" ? {} : { tab: id }, { replace: true });
  };
  const settings = useApiQuery<SettingsShape>(qk.settings, "/api/settings");

  const save = useMutation({
    mutationFn: ({ patch }: { patch: Partial<SettingsShape>; silent?: boolean }) =>
      api.put<{ settings: SettingsShape; pendingApproval: Approval | null }>("/api/settings", patch),
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
  const put = (patch: Partial<SettingsShape>, silent = false) =>
    save.mutateAsync({ patch, silent }).catch(() => undefined);

  if (settings.isPending && !settings.data)
    return (
      <div className="page">
        <Skeleton lines={8} />
      </div>
    );
  if (settings.error && !settings.data)
    return (
      <div className="page">
        <ErrorBox
          message={errorMessage(settings.error)}
          offline={isOffline(settings.error)}
          onRetry={() => void settings.refetch()}
        />
      </div>
    );
  const s = settings.data;
  if (!s) return null;

  const tabs: Array<{ id: TabId; label: string }> = [
    { id: "identity", label: t("settings.identity") },
    { id: "theme", label: t("apps.settings.tabTheme") },
    { id: "providers", label: t("settings.providers") },
    { id: "memory", label: t("settings.memory") },
    { id: "desktop", label: t("apps.settings.tabDesktop") },
    { id: "security", label: t("settings.security") },
    { id: "notifications", label: t("apps.settings.tabNotifications") },
    { id: "trends", label: t("apps.settings.tabTrends") },
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
      <Tabs
        id="settings-tabs"
        tabs={tabs}
        active={tab}
        onChange={(id) => setTab(id as TabId)}
        ariaLabel={t("settings.title")}
      />
      <div
        className="tab-panel"
        role="tabpanel"
        id={`settings-tabs-panel-${tab}`}
        aria-labelledby={`settings-tabs-tab-${tab}`}
      >
        {tab === "identity" && <IdentityTab s={s} put={put} setLang={setLang} />}
        {tab === "theme" && <ThemeTab s={s} put={put} />}
        {tab === "providers" && <ProvidersTab s={s} put={put} />}
        {tab === "memory" && <MemoryTab s={s} put={put} />}
        {tab === "desktop" && <DesktopTab s={s} put={put} />}
        {tab === "security" && <SecurityTab s={s} put={put} />}
        {tab === "notifications" && (
          <>
            <NotificationsTab />
            <SentinelsCard s={s} put={put} />
          </>
        )}
        {tab === "trends" && <TrendsTab />}
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
        <input
          key={s.systemName}
          id="st-name"
          className="input"
          defaultValue={s.systemName}
          onBlur={(e) =>
            e.target.value.trim() &&
            e.target.value !== s.systemName &&
            void put({ systemName: e.target.value.trim() })
          }
        />
      </Field>
      <div className="grid grid-2">
        <Field label={t("settings.theme")} htmlFor="st-theme">
          <select
            id="st-theme"
            className="input"
            value={s.theme}
            onChange={(e) => void put({ theme: e.target.value as SettingsShape["theme"] }, true)}
          >
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
          <input
            id="st-accent"
            type="color"
            className="input"
            style={{ height: 36, padding: 3 }}
            value={s.accentColor}
            onChange={(e) => void put({ accentColor: e.target.value }, true)}
          />
        </Field>
        <Field label={t("settings.port")} htmlFor="st-port" hint={t("settings.portHint")}>
          <input
            key={s.port}
            id="st-port"
            type="number"
            min={1024}
            max={65535}
            className="input"
            defaultValue={s.port}
            onBlur={(e) => Number(e.target.value) !== s.port && void put({ port: Number(e.target.value) })}
          />
        </Field>
      </div>
      <Field label={t("settings.timezone")} htmlFor="st-tz" hint={t("settings.timezoneHint")}>
        <input
          key={s.timezone}
          id="st-tz"
          className="input"
          defaultValue={s.timezone}
          onBlur={(e) => e.target.value !== s.timezone && void put({ timezone: e.target.value })}
        />
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
  const patchProvider = (
    id: ProviderId,
    patch: Partial<SettingsShape["providers"][ProviderId]>,
    silent = false,
  ) => put({ providers: { ...s.providers, [id]: { ...s.providers[id], ...patch } } }, silent);

  if (providers.isPending && !providers.data)
    return (
      <div className="card">
        <Skeleton lines={6} />
      </div>
    );
  return (
    <div className="card stack">
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
                  ? `${prov.health.version ?? t("setup.installed")} · ${t("settings.auth")}: ${prov.health.authenticated ? t("settings.authOk") : t("settings.authUnknown")}`
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
                  checked={s.providers[prov.id].enabled}
                  onChange={(e) => void patchProvider(prov.id, { enabled: e.target.checked })}
                />
                {t("common.enabled")}
              </label>
              <Button
                size="sm"
                variant="secondary"
                onClick={() => smoke.mutate(prov.id)}
                disabled={!s.providers[prov.id].enabled || !prov.health.installed}
                loading={smoke.isPending && smoke.variables === prov.id}
              >
                {t("settings.smokeTest")}
              </Button>
            </div>
          </div>
          <div className="grid grid-2">
            <Field label={t("skills.model")} htmlFor={`st-model-${prov.id}`} hint={t("settings.modelHint")}>
              <input
                key={s.providers[prov.id].defaultModel ?? ""}
                id={`st-model-${prov.id}`}
                className="input mono"
                defaultValue={s.providers[prov.id].defaultModel ?? ""}
                onBlur={(e) =>
                  (e.target.value || null) !== s.providers[prov.id].defaultModel &&
                  void patchProvider(prov.id, { defaultModel: e.target.value || null }, true)
                }
              />
            </Field>
            <Field label={t("skills.effort")} htmlFor={`st-effort-${prov.id}`}>
              <select
                id={`st-effort-${prov.id}`}
                className="input"
                value={s.providers[prov.id].defaultEffort}
                onChange={(e) => void patchProvider(prov.id, { defaultEffort: e.target.value }, true)}
              >
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
    mutationFn: () =>
      api.put("/api/settings", {
        indexedFolders: [...s.indexedFolders, { path: newPath.trim(), area: newArea || null, enabled: true }],
      }),
    onSuccess: () => {
      setNewPath("");
      setNewArea("");
      void put({}, true);
    },
    onError: (err: Error) => setPathError(err.message),
  });
  const removeFolder = async (path: string) => {
    if (
      await confirm({
        title: t("settings.removeFolder"),
        body: path,
        danger: true,
        confirmLabel: t("common.delete"),
      })
    )
      void put({ indexedFolders: s.indexedFolders.filter((x) => x.path !== path) });
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
            <Button
              size="sm"
              variant="ghost"
              icon={<X aria-hidden />}
              aria-label={`${t("common.delete")} ${f.path}`}
              title={t("common.delete")}
              onClick={() => void removeFolder(f.path)}
            />
          </div>
        ))}
      </div>
      <Field
        label={t("settings.addFolder")}
        htmlFor="st-newfolder"
        hint={t("settings.folderHint")}
        error={pathError ?? (pathOk ? undefined : t("settings.folderAbsolute"))}
      >
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
          <select
            className="input"
            value={newArea}
            onChange={(e) => setNewArea(e.target.value)}
            aria-label={t("brain.filterArea")}
          >
            <option value="">—</option>
            {s.areas.map((a) => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
          </select>
          <Button
            size="sm"
            variant="primary"
            icon={<CheckCircle2 aria-hidden />}
            disabled={!newPath.trim() || !pathOk}
            loading={addFolder.isPending}
            onClick={() => addFolder.mutate()}
          >
            {t("settings.addFolder")}
          </Button>
        </div>
      </Field>
      <p className="hint">
        <RefreshCw size={11} style={{ verticalAlign: -1 }} aria-hidden /> {t("brain.refresh")}:{" "}
        {t("nav.brain")} <ArrowRight size={11} style={{ verticalAlign: -1 }} aria-hidden />{" "}
        {t("brain.refresh")}
      </p>
      <Field label={t("settings.areas")} htmlFor="st-areas" hint={t("settings.areasHint")}>
        <input
          key={s.areas.join()}
          id="st-areas"
          className="input"
          defaultValue={s.areas.join(", ")}
          onBlur={(e) => {
            const areas = e.target.value
              .split(",")
              .map((a) => a.trim())
              .filter(Boolean);
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
            const excludes = e.target.value
              .split("\n")
              .map((x) => x.trim())
              .filter(Boolean);
            if (excludes.join() !== s.excludes.join()) void put({ excludes });
          }}
        />
      </Field>
      <Field
        label={t("apps.settings.registries")}
        htmlFor="st-registries"
        hint={t("apps.settings.registriesHint")}
      >
        <input
          key={(s.marketplace?.registries ?? []).join()}
          id="st-registries"
          className="input mono"
          placeholder="https://example.com/mordomo-skills/index.json"
          defaultValue={(s.marketplace?.registries ?? []).join(", ")}
          onBlur={(e) => {
            const registries = e.target.value
              .split(/[,\s]+/)
              .map((x) => x.trim())
              .filter((x) => x.startsWith("https://"));
            if (registries.join() !== (s.marketplace?.registries ?? []).join())
              void put({ marketplace: { registries } }, true);
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
            onChange={(e) => void put({ securityProfile: e.target.value })}
          >
            {PROFILES.map((prof) => (
              <option key={prof} value={prof}>
                {t(`profile.${prof}`)}
              </option>
            ))}
          </select>
        </Field>
        <Field label={t("apps.settings.budget")} htmlFor="st-budget" hint={t("apps.settings.budgetHint")}>
          <input
            id="st-budget"
            className="input"
            type="number"
            min={0}
            step={0.5}
            defaultValue={s.limits?.dailyBudgetUsd ?? 0}
            onBlur={(e) => {
              const v = Math.max(0, Number(e.target.value) || 0);
              if (v !== (s.limits?.dailyBudgetUsd ?? 0))
                void put({ limits: { ...(s.limits ?? {}), dailyBudgetUsd: v } });
            }}
          />
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
        <Field
          label={t("apps.settings.allowedCommands")}
          htmlFor="st-allowed-cmds"
          hint={t("apps.settings.allowedCommandsHint")}
        >
          <input
            key={s.connectors.allowedCommands.join()}
            id="st-allowed-cmds"
            className="input mono"
            placeholder="npx, /usr/local/bin/mcp-server"
            defaultValue={s.connectors.allowedCommands.join(", ")}
            onBlur={(e) => {
              const list = e.target.value
                .split(",")
                .map((x) => x.trim())
                .filter(Boolean);
              if (list.join() !== s.connectors.allowedCommands.join())
                void put({ connectors: { ...s.connectors, allowedCommands: list } });
            }}
          />
        </Field>
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
    mutationFn: (name: string) =>
      api.post<{ note?: string; message?: string; staged?: boolean }>(
        `/api/backups/${encodeURIComponent(name)}/restore`,
      ),
    onSuccess: (res) => toast(res.note ?? res.message ?? t("settings.restored"), "info"),
    onError: (err: Error) => toast(err.message, "danger"),
  });
  const onRestore = async (b: BackupInfo) => {
    if (
      await confirm({
        title: `${t("settings.restore")} ${b.name}?`,
        body: t("settings.restoreBody"),
        danger: true,
        confirmLabel: t("settings.restore"),
      })
    )
      restore.mutate(b.name);
  };
  return (
    <div className="card stack">
      <div>
        <Button
          variant="primary"
          icon={<Download aria-hidden />}
          onClick={() => create.mutate()}
          loading={create.isPending}
        >
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
            <Button
              size="sm"
              variant="secondary"
              onClick={() => void onRestore(b)}
              loading={restore.isPending && restore.variables === b.name}
            >
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
        <Button
          variant="primary"
          icon={<Stethoscope aria-hidden />}
          onClick={() => doctor.mutate()}
          loading={doctor.isPending}
        >
          {t("settings.runDoctor")}
        </Button>
      </div>
      {doctor.data && (
        <div>
          {doctor.data.checks.map((c) => (
            <div className="list-row" key={c.id}>
              <div className="truncate">
                <span
                  className={`dot ${c.status === "ok" ? "ok" : c.status === "warn" ? "warn" : c.status === "fail" ? "danger" : "dim"}`}
                  style={{ marginRight: 8 }}
                />
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

/* ------------------------------------------------------- theme presets ---- */

function ThemeTab({ s, put }: { s: SettingsShape; put: Put }) {
  const t = useT();
  const toast = useToast();
  const current = s.themePreset;
  const pick = (id: PresetId) => {
    const preset = applyPreset(id);
    toast(t("apps.settings.presetApplied", { name: preset.label }), "ok");
    void put({ themePreset: id, accentColor: preset.accent }, true);
  };
  const [hud, setHud] = useState(() => readStoredHudIntensity() ?? currentHudIntensity());
  const onHud = (v: number) => {
    setHud(v);
    applyHudIntensity(v);
  };
  return (
    <div className="card stack">
      <div>
        <h2>{t("apps.settings.presets")}</h2>
        <p className="hint">{t("apps.settings.presetsHint")}</p>
      </div>
      <div className="field">
        <label htmlFor="hud-intensity">
          {t("shell.hud.intensity")} · <span className="mono">{Math.round(hud * 100)}%</span>
        </label>
        <div className="hud-slider">
          <span className="hint">{t("shell.hud.off")}</span>
          <input
            id="hud-intensity"
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={hud}
            onChange={(e) => onHud(parseFloat(e.target.value))}
          />
          <span className="hint">{t("shell.hud.full")}</span>
        </div>
        <p className="hint">{t("shell.hud.intensityHint")}</p>
      </div>
      <div className="apps-presets">
        {PRESETS.map((preset) => (
          <button
            key={preset.id}
            type="button"
            className="apps-preset"
            aria-pressed={preset.id === current}
            onClick={() => pick(preset.id)}
          >
            <span className="swatch" aria-hidden>
              {preset.swatch.map((c, i) => (
                <span key={i} style={{ background: c }} />
              ))}
            </span>
            <span className="name">
              {preset.label}
              {preset.id === current && <Check aria-hidden />}
            </span>
            <span className="accent mono">{preset.accent}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

/* ------------------------------------------- desktop: widgets + micro apps -- */

function DesktopTab({ s, put }: { s: SettingsShape; put: Put }) {
  const t = useT();
  const layout = s.dashboardLayout ?? {};
  const ids = [...new Set([...WIDGET_ORDER, ...Object.keys(layout)])].filter((id) => isWidgetId(baseId(id)));

  const toggleWidget = (id: string) => {
    const base = baseId(id);
    const fallback = (isWidgetId(base) ? DEFAULT_LAYOUT[base] : undefined) ?? {
      x: 0,
      y: 0,
      w: 6,
      h: 4,
      visible: true,
    };
    const box: WidgetBox = layout[id] ?? { ...fallback, visible: false };
    void put({ dashboardLayout: { ...layout, [id]: { ...box, visible: !(box.visible ?? true) } } }, true);
  };

  return (
    <div className="stack">
      <div className="card stack">
        <div>
          <h2>{t("apps.settings.widgets")}</h2>
          <p className="hint">{t("apps.settings.widgetsHint")}</p>
        </div>
        <div className="apps-widgets">
          {ids.map((id) => {
            const base = baseId(id);
            const def = isWidgetId(base) ? WIDGET_REGISTRY[base] : undefined;
            const visible = layout[id]?.visible ?? true;
            return (
              <button
                key={id}
                type="button"
                className="apps-widget-toggle"
                aria-pressed={visible}
                onClick={() => toggleWidget(id)}
              >
                {visible ? <Eye aria-hidden /> : <EyeOff aria-hidden />}
                <span className="truncate">{def ? t(def.titleKey) : id}</span>
                <span className="id">{id}</span>
              </button>
            );
          })}
        </div>
      </div>
      <MicroAppsCard s={s} put={put} />
    </div>
  );
}

function MicroAppsCard({ s, put }: { s: SettingsShape; put: Put }) {
  const t = useT();
  const [rows, setRows] = useState<MicroApp[]>(() => s.microApps ?? []);

  const commit = (next: MicroApp[]) => {
    setRows(next);
    const clean = next.filter((r) => r.name.trim() !== "" && isValidMicroAppHref(r.href));
    void put({ microApps: clean }, true);
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
            <Button
              size="sm"
              variant="ghost"
              icon={<Trash2 aria-hidden />}
              aria-label={`${t("common.delete")} ${row.name || row.id}`}
              title={t("common.delete")}
              onClick={() => commit(rows.filter((_, j) => j !== i))}
            />
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

/* ------------------------------------------------------- notifications ----- */

function NotificationsTab() {
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

/* ------------------------------------------------- remote access (Onda 3) ---- */

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
  const save = (patch: Partial<typeof remote>) => void put({ remote: { ...remote, ...patch } }, true);
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
          onClick={() => save({ enabled: !remote.enabled })}
        >
          {remote.enabled ? t("apps.settings.soundOn") : t("apps.settings.soundOff")}
        </Button>
      </div>
      <Field
        label={t("apps.settings.remoteHosts")}
        htmlFor="st-remote-hosts"
        hint={t("apps.settings.remoteHostsHint")}
      >
        <input
          id="st-remote-hosts"
          className="input"
          defaultValue={remote.allowedHosts.join(", ")}
          placeholder="mordomo.tail1234.ts.net, 192.168.0.12"
          onBlur={(e) => {
            const hosts = e.target.value
              .split(/[,\s]+/)
              .map((h) => h.trim())
              .filter(Boolean);
            if (hosts.join(",") !== remote.allowedHosts.join(",")) save({ allowedHosts: hosts });
          }}
        />
      </Field>
      <Field
        label={t("apps.settings.remoteTtl")}
        htmlFor="st-remote-ttl"
        hint={t("apps.settings.remoteTtlHint")}
      >
        <input
          id="st-remote-ttl"
          className="input"
          type="number"
          min={0}
          defaultValue={remote.deviceTtlDays}
          onBlur={(e) => {
            const v = Math.max(0, Math.round(Number(e.target.value) || 0));
            if (v !== remote.deviceTtlDays) save({ deviceTtlDays: v });
          }}
        />
      </Field>
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
          onClick={() => save({ tls: { ...tls, enabled: !tls.enabled } })}
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

/* --------------------------------------------- sentinels and channels (Onda 2) ---- */

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

function SentinelsCard({ s, put }: { s: SettingsShape; put: Put }) {
  const t = useT();
  const toast = useToast();
  const sentinels = s.sentinels;
  const channels = s.channels;
  const test = useMutation({
    mutationFn: () => api.post<{ ok: boolean; error?: string }>("/api/channels/telegram/test", {}),
    onSuccess: (res) =>
      toast(
        res.ok ? t("apps.settings.telegramOk") : `${t("apps.settings.telegramFailed")}: ${res.error ?? ""}`,
        res.ok ? "ok" : "danger",
      ),
    onError: (err: Error) => toast(err.message, "danger"),
  });
  if (!sentinels || !channels) return null;
  const toggle = (key: SentinelKey) =>
    void put(
      { sentinels: { ...sentinels, [key]: { ...sentinels[key], enabled: !sentinels[key].enabled } } },
      true,
    );
  const tg = channels.telegram;
  const saveTg = (patch: Partial<typeof tg>) =>
    void put({ channels: { ...channels, telegram: { ...tg, ...patch } } }, true);
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
          <Field label={t("apps.settings.triageModel")} htmlFor="st-triage-model">
            <input
              id="st-triage-model"
              className="input"
              defaultValue={sentinels.triage.model}
              onBlur={(e) =>
                e.target.value.trim() !== sentinels.triage.model &&
                void put(
                  {
                    sentinels: {
                      ...sentinels,
                      triage: { ...sentinels.triage, model: e.target.value.trim() || "haiku" },
                    },
                  },
                  true,
                )
              }
            />
          </Field>
          <Field label={t("apps.settings.triageBudget")} htmlFor="st-triage-budget">
            <input
              id="st-triage-budget"
              className="input"
              type="number"
              min={0}
              step={0.05}
              defaultValue={sentinels.triage.dailyBudgetUsd}
              onBlur={(e) => {
                const v = Math.max(0, Number(e.target.value) || 0);
                if (v !== sentinels.triage.dailyBudgetUsd)
                  void put(
                    { sentinels: { ...sentinels, triage: { ...sentinels.triage, dailyBudgetUsd: v } } },
                    true,
                  );
              }}
            />
          </Field>
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
            onClick={() => saveTg({ enabled: !tg.enabled })}
          >
            {tg.enabled ? t("apps.settings.soundOn") : t("apps.settings.soundOff")}
          </Button>
        </div>
        <div className="grid-2">
          <Field label={t("apps.settings.telegramChat")} htmlFor="st-tg-chat">
            <input
              id="st-tg-chat"
              className="input"
              defaultValue={tg.chatId}
              placeholder="123456789 or @channel"
              onBlur={(e) => e.target.value.trim() !== tg.chatId && saveTg({ chatId: e.target.value.trim() })}
            />
          </Field>
          <Field label={t("apps.settings.telegramMinTone")} htmlFor="st-tg-tone">
            <select
              id="st-tg-tone"
              className="input"
              value={tg.minTone}
              onChange={(e) => saveTg({ minTone: e.target.value as typeof tg.minTone })}
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
            onClick={() => saveTg({ inbound: !tg.inbound })}
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

/** The server side of Web Push: on/off, minimum tone, subscribed devices and a test. */
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
    mutationFn: () => api.post<{ ok: boolean; error?: string }>("/api/push/test", {}),
    onSuccess: (res) => {
      toast(
        res.ok
          ? t("apps.settings.telegramOk").replace("Telegram", "Push")
          : `${t("apps.settings.pushFailed")}: ${res.error ?? ""}`,
        res.ok ? "ok" : "danger",
      );
      qc.invalidateQueries({ queryKey: qk.pushSubscriptions }).catch(() => undefined);
    },
    onError: (err: Error) => toast(err.message, "danger"),
  });
  const remove = useMutation({
    mutationFn: (id: string) => api.del(`/api/push/subscriptions/${encodeURIComponent(id)}`),
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

/** System notifications (permission-gated) and spoken alerts. */
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
  const toggleVoice = () => {
    const next = !voice;
    setVoiceNotify(next);
    setVoice(next);
    if (next) speak(t("apps.settings.voiceSample"), locale, { force: true });
  };
  return (
    <>
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
