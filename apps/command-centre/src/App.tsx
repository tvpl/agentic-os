import { useEffect, useMemo, useState, type ReactNode } from "react";
import { HashRouter, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import {
  ArrowLeft,
  BrainCircuit,
  CalendarClock,
  Grid3x3,
  LayoutGrid,
  ListTree,
  Plug,
  Settings as SettingsIcon,
  Sparkles,
} from "lucide-react";
import { api, type Meta } from "./api";
import { I18nContext, useT, type Lang } from "./i18n";
import { ToastProvider } from "./components/ui";
import Desktop from "./views/Desktop";
import Skills from "./views/Skills";
import SecondBrain from "./views/SecondBrain";
import Routines from "./views/Routines";
import Runs from "./views/Runs";
import Connectors from "./views/Connectors";
import Settings from "./views/Settings";
import Setup from "./views/Setup";
import PixelStudio from "./views/PixelStudio";

/** Fire this event from anywhere to open the OS launcher. */
export const LAUNCHER_EVENT = "mordomo:launcher";

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
          {meta.setupCompleted ? <OsShell meta={meta} onMetaChanged={loadMeta} /> : <Setup onDone={loadMeta} />}
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

function OsShell({ meta, onMetaChanged }: { meta: Meta; onMetaChanged: () => void }) {
  const [launcherOpen, setLauncherOpen] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    const openLauncher = () => setLauncherOpen(true);
    window.addEventListener(LAUNCHER_EVENT, openLauncher);
    return () => window.removeEventListener(LAUNCHER_EVENT, openLauncher);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const inField = ["INPUT", "TEXTAREA", "SELECT"].includes(document.activeElement?.tagName ?? "");
      if (e.key === "Escape") {
        if (launcherOpen) setLauncherOpen(false);
        else if (location.pathname !== "/" && !inField) navigate("/");
      }
      if (e.key.toLowerCase() === "m" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setLauncherOpen((v) => !v);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [launcherOpen, location.pathname, navigate]);

  // Close the launcher on navigation.
  useEffect(() => setLauncherOpen(false), [location.pathname]);

  return (
    <div className="os-root">
      <Routes>
        <Route path="/" element={<Desktop meta={meta} />} />
        <Route path="/brain" element={<SecondBrain />} />
        <Route path="/skills" element={<AppFrame><Skills /></AppFrame>} />
        <Route path="/skills/:slug" element={<AppFrame><Skills /></AppFrame>} />
        <Route path="/routines" element={<AppFrame><Routines /></AppFrame>} />
        <Route path="/runs" element={<AppFrame><Runs /></AppFrame>} />
        <Route path="/runs/:id" element={<AppFrame><Runs /></AppFrame>} />
        <Route path="/connectors" element={<AppFrame><Connectors /></AppFrame>} />
        <Route path="/pixel" element={<AppFrame><PixelStudio /></AppFrame>} />
        <Route path="/settings" element={<AppFrame><Settings onMetaChanged={onMetaChanged} /></AppFrame>} />
      </Routes>
      {launcherOpen && <Launcher onClose={() => setLauncherOpen(false)} meta={meta} />}
    </div>
  );
}

/** Fullscreen app surface with the "back to the OS" chrome. */
export function AppFrame({ children }: { children: ReactNode }) {
  const t = useT();
  const navigate = useNavigate();
  return (
    <div className="app-frame">
      <div className="app-frame-chrome">
        <button className="os-chip" onClick={() => navigate("/")}>
          <ArrowLeft aria-hidden /> {t("os.backToOs")}
        </button>
        <button className="os-chip" onClick={() => window.dispatchEvent(new Event(LAUNCHER_EVENT))}>
          ☰ {t("os.menu")}
        </button>
      </div>
      {children}
    </div>
  );
}

export function Launcher({ onClose, meta }: { onClose: () => void; meta: Meta }) {
  const t = useT();
  const navigate = useNavigate();
  const apps = [
    { to: "/brain", icon: <BrainCircuit aria-hidden />, name: t("nav.brain") },
    { to: "/skills", icon: <Sparkles aria-hidden />, name: t("nav.skills") },
    { to: "/routines", icon: <CalendarClock aria-hidden />, name: t("nav.routines") },
    { to: "/runs", icon: <ListTree aria-hidden />, name: t("nav.runs") },
    { to: "/connectors", icon: <Plug aria-hidden />, name: t("nav.connectors") },
    { to: "/pixel", icon: <Grid3x3 aria-hidden />, name: t("nav.pixel") },
    { to: "/settings", icon: <SettingsIcon aria-hidden />, name: t("nav.settings") },
    { to: "/", icon: <LayoutGrid aria-hidden />, name: t("nav.dashboard") },
  ];
  return (
    <div className="launcher" onMouseDown={(e) => e.target === e.currentTarget && onClose()} role="dialog" aria-modal="true" aria-label={t("os.menu")}>
      <div>
        <div style={{ textAlign: "center", marginBottom: 26 }}>
          <span className="os-brand">
            <span className="line1">
              <span className="brand-mark" aria-hidden>{meta.name.charAt(0).toUpperCase()}</span>
              <span className="name"><span className="accent">{meta.name.replace(/\s*os$/i, "")}</span> OS</span>
            </span>
          </span>
        </div>
        <div className="launcher-grid">
          {apps.map((app) => (
            <button key={app.to} className="launcher-tile" onClick={() => { navigate(app.to); onClose(); }}>
              <span className="lt-icon">{app.icon}</span>
              <span className="lt-name">{app.name}</span>
            </button>
          ))}
        </div>
        <p className="launcher-hint">
          <span className="kbd">Esc</span> {t("os.backToOs")} · <span className="kbd">Ctrl/⌘ M</span> {t("os.menu")}
        </p>
      </div>
    </div>
  );
}
