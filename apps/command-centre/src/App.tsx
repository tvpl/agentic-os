import { useEffect, useMemo, useState } from "react";
import { HashRouter, NavLink, Route, Routes } from "react-router-dom";
import {
  LayoutDashboard,
  Sparkles,
  BrainCircuit,
  CalendarClock,
  ListTree,
  Plug,
  Settings as SettingsIcon,
} from "lucide-react";
import { api, type Meta } from "./api";
import { I18nContext, useT, type Lang } from "./i18n";
import { ToastProvider } from "./components/ui";
import Dashboard from "./views/Dashboard";
import Skills from "./views/Skills";
import SecondBrain from "./views/SecondBrain";
import Routines from "./views/Routines";
import Runs from "./views/Runs";
import Connectors from "./views/Connectors";
import Settings from "./views/Settings";
import Setup from "./views/Setup";

export default function App() {
  const [meta, setMeta] = useState<Meta | null>(null);
  const [offline, setOffline] = useState(false);
  const [lang, setLang] = useState<Lang>("en");

  const loadMeta = () =>
    api
      .get<Meta>("/api/meta")
      .then((m) => {
        setMeta(m);
        setLang(m.language);
        setOffline(false);
      })
      .catch(() => setOffline(true));

  useEffect(() => {
    void loadMeta();
  }, []);

  useEffect(() => {
    if (!meta) return;
    const theme =
      meta.theme === "system"
        ? window.matchMedia("(prefers-color-scheme: light)").matches
          ? "light"
          : "dark"
        : meta.theme;
    document.documentElement.dataset.theme = theme;
    document.documentElement.style.setProperty("--accent", meta.accentColor);
    document.title = meta.name;
  }, [meta]);

  const i18nValue = useMemo(() => ({ lang, setLang }), [lang]);

  if (offline) {
    return (
      <I18nContext.Provider value={i18nValue}>
        <div style={{ display: "grid", placeItems: "center", height: "100%" }}>
          <OfflineCard onRetry={loadMeta} />
        </div>
      </I18nContext.Provider>
    );
  }
  if (!meta) return null;

  return (
    <I18nContext.Provider value={i18nValue}>
      <ToastProvider>
        <HashRouter>
          {meta.setupCompleted ? (
            <Shell meta={meta} onMetaChanged={loadMeta} />
          ) : (
            <Setup onDone={loadMeta} />
          )}
        </HashRouter>
      </ToastProvider>
    </I18nContext.Provider>
  );
}

function OfflineCard({ onRetry }: { onRetry: () => void }) {
  const t = useT();
  return (
    <div className="card" style={{ maxWidth: 420, textAlign: "center" }}>
      <h3>MordomoOS</h3>
      <p style={{ color: "var(--text-dim)" }}>{t("common.offline")}</p>
      <button className="btn primary" onClick={onRetry}>
        {t("common.retry")}
      </button>
    </div>
  );
}

function Shell({ meta, onMetaChanged }: { meta: Meta; onMetaChanged: () => void }) {
  const t = useT();
  const nav = [
    { to: "/", icon: <LayoutDashboard aria-hidden />, label: t("nav.dashboard"), end: true },
    { to: "/skills", icon: <Sparkles aria-hidden />, label: t("nav.skills") },
    { to: "/brain", icon: <BrainCircuit aria-hidden />, label: t("nav.brain") },
    { to: "/routines", icon: <CalendarClock aria-hidden />, label: t("nav.routines") },
    { to: "/runs", icon: <ListTree aria-hidden />, label: t("nav.runs") },
    { to: "/connectors", icon: <Plug aria-hidden />, label: t("nav.connectors") },
    { to: "/settings", icon: <SettingsIcon aria-hidden />, label: t("nav.settings") },
  ];
  return (
    <div className="shell">
      <nav className="sidebar" aria-label="Main">
        <div className="brand">
          <span className="brand-mark" aria-hidden>
            {meta.name.charAt(0).toUpperCase()}
          </span>
          <span>{meta.name}</span>
        </div>
        {nav.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.end}
            className={({ isActive }) => `navlink${isActive ? " active" : ""}`}
          >
            {item.icon}
            <span className="label">{item.label}</span>
          </NavLink>
        ))}
        <div className="sidebar-foot">v{meta.version} · 127.0.0.1</div>
      </nav>
      <main className="main">
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/skills" element={<Skills />} />
          <Route path="/skills/:slug" element={<Skills />} />
          <Route path="/brain" element={<SecondBrain />} />
          <Route path="/routines" element={<Routines />} />
          <Route path="/runs" element={<Runs />} />
          <Route path="/runs/:id" element={<Runs />} />
          <Route path="/connectors" element={<Connectors />} />
          <Route path="/settings" element={<Settings onMetaChanged={onMetaChanged} />} />
        </Routes>
      </main>
    </div>
  );
}
