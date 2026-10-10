import { OnboardingButton } from "../onboarding/Onboarding";
import { useCurrentShell } from "../moldura/shell";
import { Fragment, useContext, useEffect, useState } from "react";
import { usePanelSearchParams } from "../desktop/appRoute";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api, type SettingsPatch } from "../api";

import { I18nContext, useT } from "../i18n";
import { qk, useApiQuery } from "../queries";
import { TrendsTab } from "./Trends";
import { ErrorBox, Skeleton, useToast } from "../components/ui";
import { errorMessage, isOffline } from "./shared";
import { type Put, type SaveResult } from "./SettingsFields";
import "./apps.css";
import { IdentityTab } from "./settings/identity";
import { ThemeTab } from "./settings/theme";
import { ProvidersTab } from "./settings/providers";
import { MemoryTab } from "./settings/memory";
import { DesktopTab } from "./settings/desktop";
import { SecurityTab } from "./settings/security";
import { NotificationsTab, SentinelsCard } from "./settings/notifications";
import { BackupsTab } from "./settings/backups";
import { DiagnosticsTab } from "./settings/diagnostics";
import { Tabs } from "../ui";
import { TAB_IDS, isValidMicroAppHref, type Approval, type TabId } from "./settings/shared";

import type { SettingsShape } from "./settings/shared";

export { isValidMicroAppHref };

export default function Settings({ onMetaChanged }: { onMetaChanged: () => void }) {
  const t = useT();
  const shell = useCurrentShell();
  const toast = useToast();
  const { setLang } = useContext(I18nContext);
  const qc = useQueryClient();
  const [params, setParams] = usePanelSearchParams();
  const requested = params.get("tab") as TabId | null;
  const [tab, setTabState] = useState<TabId>(
    requested && TAB_IDS.includes(requested) ? requested : "identity",
  );
  useEffect(() => {
    setTabState(requested && TAB_IDS.includes(requested) ? requested : "identity");
  }, [requested]);
  const setTab = (id: TabId) => {
    setTabState(id);
    setParams(id === "identity" ? {} : { tab: id }, { replace: true });
  };
  const [query, setQuery] = useState("");
  const settings = useApiQuery<SettingsShape>(qk.settings, "/api/settings");

  const save = useMutation({
    mutationFn: ({ patch }: { patch: SettingsPatch; silent?: boolean }) =>
      api.putSettings<{ settings: SettingsShape; pendingApproval: Approval | null }>(patch),
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
      // Selects are controlled by the query, so a refetch reverts what failed;
      // text fields keep the rejected draft and show the error inline.
      qc.invalidateQueries({ queryKey: qk.settings }).catch(() => undefined);
    },
  });
  // Never rejects: fields show the message inline (and the toast above already fired).
  const put: Put = (patch, silent = false) =>
    save.mutateAsync({ patch, silent }).then(
      (): SaveResult => ({ ok: true }),
      (err: unknown): SaveResult => ({ ok: false, error: errorMessage(err) }),
    );

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

  // Settings by question (refino item 17): five groups, each answering one
  // thing a person wants to know, and a search that finds a section by its
  // label or by the words people actually use for it.
  const groups: Array<{
    id: string;
    label: string;
    items: Array<{ id: TabId; label: string; keys: string }>;
  }> = [
    {
      id: "who",
      label: t("settings.group.who"),
      items: [
        { id: "identity", label: t("settings.identity"), keys: t("settings.keys.identity") },
        { id: "theme", label: t("apps.settings.tabTheme"), keys: t("settings.keys.theme") },
        { id: "desktop", label: t("apps.settings.tabDesktop"), keys: t("settings.keys.desktop") },
      ],
    },
    {
      id: "think",
      label: t("settings.group.think"),
      items: [
        { id: "providers", label: t("settings.providers"), keys: t("settings.keys.providers") },
        { id: "memory", label: t("settings.memory"), keys: t("settings.keys.memory") },
      ],
    },
    {
      id: "allow",
      label: t("settings.group.allow"),
      items: [{ id: "security", label: t("settings.security"), keys: t("settings.keys.security") }],
    },
    {
      id: "notify",
      label: t("settings.group.notify"),
      items: [
        {
          id: "notifications",
          label: t("apps.settings.tabNotifications"),
          keys: t("settings.keys.notifications"),
        },
      ],
    },
    {
      id: "health",
      label: t("settings.group.health"),
      items: [
        { id: "trends", label: t("apps.settings.tabTrends"), keys: t("settings.keys.trends") },
        { id: "backups", label: t("settings.backups"), keys: t("settings.keys.backups") },
        { id: "diagnostics", label: t("settings.doctor"), keys: t("settings.keys.diagnostics") },
      ],
    },
  ];
  const q = query.trim().toLowerCase();
  const matches = (item: { label: string; keys: string }) =>
    !q || item.label.toLowerCase().includes(q) || item.keys.toLowerCase().includes(q);
  const visible = groups
    .map((g) => ({ ...g, items: g.items.filter(matches) }))
    .filter((g) => g.items.length > 0);
  const title = groups.flatMap((g) => g.items).find((i) => i.id === tab)?.label ?? t("settings.title");

  return (
    <div className="page settings-page">
      <div className="page-head">
        <div>
          <h1>{t("settings.title")}</h1>
        </div>
        {/* The tour points at the Núcleo's places; the frame has none of them (plan Assumptions). */}
        {shell === "nucleo" && <OnboardingButton />}
      </div>
      <Tabs.Root
        value={tab}
        onChange={(id) => setTab(id as TabId)}
        orientation="vertical"
        id="settings-tabs"
        className="settings-shell"
      >
        <nav className="settings-nav" aria-label={t("settings.title")}>
          <input
            type="search"
            className="input sm settings-search"
            placeholder={t("settings.searchPh")}
            aria-label={t("settings.searchPh")}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && visible[0]?.items[0]) setTab(visible[0].items[0].id);
              if (e.key === "Escape") setQuery("");
            }}
          />
          {visible.length === 0 && <p className="hint">{t("settings.searchNone")}</p>}
          <Tabs.List variant="list">
            {visible.map((g) => (
              <Fragment key={g.id}>
                <Tabs.Group>{g.label}</Tabs.Group>
                {g.items.map((item) => (
                  <Tabs.Tab key={item.id} value={item.id}>
                    {item.label}
                  </Tabs.Tab>
                ))}
              </Fragment>
            ))}
          </Tabs.List>
          <p className="hint settings-autosave" data-testid="settings-autosave-note">
            {t("settings.autosaveNote")}
          </p>
        </nav>
        <div className="settings-body">
          <h2 className="settings-section-title">{title}</h2>
          <Tabs.Panel className="tab-panel">
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
          </Tabs.Panel>
        </div>
      </Tabs.Root>
    </div>
  );
}
