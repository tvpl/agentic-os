import {
  Suspense,
  lazy,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { HashRouter, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { QueryClient, QueryClientProvider, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  BrainCircuit,
  CalendarClock,
  Grid3x3,
  LayoutGrid,
  ListTree,
  Menu,
  Plug,
  Search,
  Settings as SettingsIcon,
  Sparkles,
} from "lucide-react";
import { api, type Meta, type Skill } from "./api";
import { I18nContext, useT, type Lang, type TKey } from "./i18n";
import { accentContrast, ensureContrast, parseColor } from "./color";
import { qk, useApiQuery } from "./queries";
import { Skeleton, ToastProvider } from "./components/ui";
import { DialogPortal, useDialog, usePresence } from "./components/dialog";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { ConfirmProvider } from "./hooks/useConfirm";
import { useEventStream } from "./hooks/useEventStream";

// Desktop is the landing surface and stays in the main chunk.
// TODO(orchestrator): switch to `import Desktop from "./desktop"` once F2 lands src/desktop/index.tsx.
import Desktop from "./views/Desktop";
// TODO(orchestrator): switch to `lazy(() => import("./runs"))` once F2 lands src/runs/index.tsx.
const Runs = lazy(() => import("./views/Runs"));
// TODO(orchestrator): switch to `lazy(() => import("./brain"))` once F3 lands src/brain/index.tsx.
const SecondBrain = lazy(() => import("./views/SecondBrain"));
const Skills = lazy(() => import("./views/Skills"));
const Routines = lazy(() => import("./views/Routines"));
const Connectors = lazy(() => import("./views/Connectors"));
const Settings = lazy(() => import("./views/Settings"));
const Setup = lazy(() => import("./views/Setup"));
const PixelStudio = lazy(() => import("./views/PixelStudio"));

/** Fire this event from anywhere to open the OS launcher. */
export const LAUNCHER_EVENT = "mordomo:launcher";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5_000,
      refetchOnWindowFocus: true,
      refetchIntervalInBackground: false,
      retry: 1,
    },
  },
});

const THEME_BG = { dark: "#0b0a08", light: "#f5f3ee" } as const;

/** Derive the accent-dependent tokens (audit item 17) for the active theme. */
function applyAccent(accent: string, theme: "dark" | "light") {
  const root = document.documentElement.style;
  const valid = parseColor(accent) ? accent : "#f97316";
  root.setProperty("--accent", valid);
  root.setProperty("--accent-contrast", accentContrast(valid));
  root.setProperty("--accent-text", ensureContrast(valid, THEME_BG[theme], 4.5));
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AppInner />
    </QueryClientProvider>
  );
}

function AppInner() {
  const qc = useQueryClient();
  const metaQuery = useQuery({
    queryKey: qk.meta,
    queryFn: ({ signal }) => api.get<Meta>("/api/meta", { signal }),
    retry: 1,
  });
  const meta = metaQuery.data ?? null;
  const offline = !meta && metaQuery.isError;
  const [lang, setLang] = useState<Lang>("en");

  // Follow the language saved on the server; Settings can still switch live via setLang.
  useEffect(() => {
    if (meta?.language) setLang(meta.language);
  }, [meta?.language]);

  useEffect(() => {
    document.documentElement.lang = lang;
  }, [lang]);

  const loadMeta = useCallback(() => {
    qc.invalidateQueries({ queryKey: qk.meta }).catch(() => {
      /* never rejects */
    });
  }, [qc]);

  // Theme: reactive to the OS preference while "system" is selected.
  useEffect(() => {
    if (!meta) return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const apply = () => {
      const theme = meta.theme === "system" ? (mq.matches ? "dark" : "light") : meta.theme;
      document.documentElement.dataset.theme = theme;
      applyAccent(meta.accentColor, theme);
    };
    apply();
    document.title = meta.name;
    if (meta.theme !== "system") return;
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, [meta]);

  const i18nValue = useMemo(() => ({ lang, setLang }), [lang]);

  if (offline) {
    return (
      <I18nContext.Provider value={i18nValue}>
        <div style={{ display: "grid", placeItems: "center", height: "100%" }}>
          <OfflineCard onRetry={() => void metaQuery.refetch()} />
        </div>
      </I18nContext.Provider>
    );
  }
  if (!meta) return null;

  return (
    <I18nContext.Provider value={i18nValue}>
      <ToastProvider>
        <ConfirmProvider>
          <HashRouter>
            {meta.setupCompleted ? (
              <OsShell meta={meta} onMetaChanged={loadMeta} />
            ) : (
              <Suspense fallback={<Skeleton page lines={6} />}>
                <Setup onDone={loadMeta} />
              </Suspense>
            )}
          </HashRouter>
        </ConfirmProvider>
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
      <button type="button" className="btn primary" onClick={onRetry}>
        {t("common.retry")}
      </button>
    </div>
  );
}

const ROUTE_TITLE: Record<string, TKey> = {
  brain: "nav.brain",
  skills: "nav.skills",
  routines: "nav.routines",
  runs: "nav.runs",
  connectors: "nav.connectors",
  pixel: "nav.pixel",
  settings: "nav.settings",
};

function PageFallback() {
  return <Skeleton page lines={8} />;
}

/** Route wrapper: error boundary (reset on navigation) + lazy suspense. */
function RouteSurface({ name, children }: { name: string; children: ReactNode }) {
  const t = useT();
  const { pathname } = useLocation();
  const key = ROUTE_TITLE[name];
  return (
    <ErrorBoundary name={key ? t(key) : t("nav.dashboard")} resetKey={pathname}>
      <Suspense fallback={<PageFallback />}>{children}</Suspense>
    </ErrorBoundary>
  );
}

function OsShell({ meta, onMetaChanged }: { meta: Meta; onMetaChanged: () => void }) {
  const t = useT();
  const [launcherOpen, setLauncherOpen] = useState(false);
  const { mounted: launcherMounted, closing: launcherClosing } = usePresence(launcherOpen, 160);
  const navigate = useNavigate();
  const location = useLocation();
  const { connected } = useEventStream();

  useEffect(() => {
    const openLauncher = () => setLauncherOpen(true);
    window.addEventListener(LAUNCHER_EVENT, openLauncher);
    return () => window.removeEventListener(LAUNCHER_EVENT, openLauncher);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent | globalThis.KeyboardEvent) => {
      const ev = e as globalThis.KeyboardEvent;
      // Dialogs handle their own Escape (and stop propagation); never navigate from inside one.
      if (ev.defaultPrevented) return;
      const target = ev.target instanceof Element ? ev.target : null;
      if (target?.closest('[role="dialog"]')) return;
      const inField = ["INPUT", "TEXTAREA", "SELECT"].includes(document.activeElement?.tagName ?? "");
      if (ev.key === "Escape") {
        if (launcherOpen) setLauncherOpen(false);
        else if (location.pathname !== "/" && !inField) navigate("/");
      }
      if (ev.key.toLowerCase() === "m" && (ev.metaKey || ev.ctrlKey)) {
        ev.preventDefault();
        setLauncherOpen((v) => !v);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [launcherOpen, location.pathname, navigate]);

  // Close the launcher on navigation.
  useEffect(() => setLauncherOpen(false), [location.pathname]);

  const framed = (name: string, node: ReactNode) => (
    <RouteSurface name={name}>
      <AppFrame>{node}</AppFrame>
    </RouteSurface>
  );

  return (
    <div className="os-root">
      <Routes>
        <Route
          path="/"
          element={
            <RouteSurface name="desktop">
              <Desktop meta={meta} onMetaChanged={onMetaChanged} />
            </RouteSurface>
          }
        />
        <Route
          path="/brain"
          element={
            <RouteSurface name="brain">
              <SecondBrain />
            </RouteSurface>
          }
        />
        <Route path="/skills" element={framed("skills", <Skills />)} />
        <Route path="/skills/:slug" element={framed("skills", <Skills />)} />
        <Route path="/routines" element={framed("routines", <Routines />)} />
        <Route path="/runs" element={framed("runs", <Runs />)} />
        <Route path="/runs/:id" element={framed("runs", <Runs />)} />
        <Route path="/connectors" element={framed("connectors", <Connectors />)} />
        <Route path="/pixel" element={framed("pixel", <PixelStudio />)} />
        <Route path="/settings" element={framed("settings", <Settings onMetaChanged={onMetaChanged} />)} />
      </Routes>
      {launcherMounted && <Launcher onClose={() => setLauncherOpen(false)} meta={meta} closing={launcherClosing} />}
      <div className={`sse-dot${connected ? "" : " off"}`} title={t("common.reconnecting")} aria-hidden>
        <span className="dot warn" />
      </div>
    </div>
  );
}

/** Fullscreen app surface. The chrome is a sticky header in normal flow (audit item 12). */
export function AppFrame({ children, title }: { children: ReactNode; title?: string }) {
  const t = useT();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const segment = pathname.split("/")[1] ?? "";
  const key = ROUTE_TITLE[segment];
  const name = title ?? (key ? t(key) : "");
  return (
    <div className="app-frame">
      <header className="app-frame-chrome">
        <div className="left">
          <button type="button" className="os-chip" onClick={() => navigate("/")}>
            <ArrowLeft aria-hidden /> {t("os.backToOs")}
          </button>
          {name && <span className="app-frame-title">{name}</span>}
        </div>
        <div className="right">
          <button type="button" className="os-chip" onClick={() => window.dispatchEvent(new Event(LAUNCHER_EVENT))}>
            <Menu aria-hidden /> {t("os.menu")}
          </button>
        </div>
      </header>
      <div className="app-frame-body">{children}</div>
    </div>
  );
}

interface LauncherEntry {
  id: string;
  to: string;
  name: string;
  sub?: string;
  icon: ReactNode;
  kind: "app" | "skill";
}

export function Launcher({ onClose, meta, closing = false }: { onClose: () => void; meta: Meta; closing?: boolean }) {
  const t = useT();
  const navigate = useNavigate();
  const ref = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(0);
  const skills = useApiQuery<Skill[]>(qk.skills, "/api/skills", { staleTime: 60_000 });

  useDialog(ref, onClose, { initialFocus: () => inputRef.current });

  const apps = useMemo<LauncherEntry[]>(
    () => [
      { id: "brain", to: "/brain", icon: <BrainCircuit aria-hidden />, name: t("nav.brain"), kind: "app" },
      { id: "skills", to: "/skills", icon: <Sparkles aria-hidden />, name: t("nav.skills"), kind: "app" },
      { id: "routines", to: "/routines", icon: <CalendarClock aria-hidden />, name: t("nav.routines"), kind: "app" },
      { id: "runs", to: "/runs", icon: <ListTree aria-hidden />, name: t("nav.runs"), kind: "app" },
      { id: "connectors", to: "/connectors", icon: <Plug aria-hidden />, name: t("nav.connectors"), kind: "app" },
      { id: "pixel", to: "/pixel", icon: <Grid3x3 aria-hidden />, name: t("nav.pixel"), kind: "app" },
      { id: "settings", to: "/settings", icon: <SettingsIcon aria-hidden />, name: t("nav.settings"), kind: "app" },
      { id: "home", to: "/", icon: <LayoutGrid aria-hidden />, name: t("nav.dashboard"), kind: "app" },
    ],
    [t],
  );

  const needle = query.trim().toLowerCase();
  const results = useMemo<LauncherEntry[]>(() => {
    if (!needle) return [];
    const appHits = apps.filter((a) => a.name.toLowerCase().includes(needle));
    const skillHits = (skills.data ?? [])
      .filter((s) => s.name.toLowerCase().includes(needle) || s.slug.toLowerCase().includes(needle) || s.description.toLowerCase().includes(needle))
      .slice(0, 8)
      .map<LauncherEntry>((s) => ({
        id: `skill:${s.slug}`,
        to: `/skills/${encodeURIComponent(s.slug)}`,
        name: s.name,
        sub: `/${s.slug}`,
        icon: <Sparkles aria-hidden />,
        kind: "skill",
      }));
    return [...appHits, ...skillHits];
  }, [needle, apps, skills.data]);

  useEffect(() => setSelected(0), [needle]);

  const open = (entry: LauncherEntry) => {
    navigate(entry.to);
    onClose();
  };

  const onSearchKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      if (results.length === 0) return;
      e.preventDefault();
      setSelected((i) => (e.key === "ArrowDown" ? (i + 1) % results.length : (i - 1 + results.length) % results.length));
    } else if (e.key === "Enter") {
      const hit = results[selected] ?? results[0];
      if (hit) {
        e.preventDefault();
        open(hit);
      }
    }
  };

  const listId = "launcher-results";
  return (
    <DialogPortal>
      <div className={`launcher${closing ? " closing" : ""}`} role="presentation" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
        <div className="launcher-panel" role="dialog" aria-modal="true" aria-label={t("os.menu")} ref={ref} tabIndex={-1}>
          <div style={{ textAlign: "center", marginBottom: 22 }}>
            <span className="os-brand">
              <span className="line1">
                <span className="brand-mark" aria-hidden>
                  {meta.name.charAt(0).toUpperCase()}
                </span>
                <span className="name">
                  <span className="accent">{meta.name.replace(/\s*os$/i, "")}</span> OS
                </span>
              </span>
            </span>
          </div>
          <div className="launcher-search">
            <Search aria-hidden />
            <input
              ref={inputRef}
              className="input"
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={onSearchKey}
              placeholder={t("launcher.searchPh")}
              aria-label={t("common.search")}
              role="combobox"
              aria-expanded={results.length > 0}
              aria-controls={listId}
              aria-activedescendant={results[selected] ? `${listId}-${results[selected].id}` : undefined}
              aria-autocomplete="list"
              autoComplete="off"
              spellCheck={false}
            />
          </div>
          {needle ? (
            <div className="launcher-results" id={listId} role="listbox" aria-label={t("common.search")}>
              {results.length === 0 && <p className="launcher-hint" style={{ marginTop: 0 }}>{t("launcher.noResults", { query: query.trim() })}</p>}
              {results.map((r, i) => (
                <button
                  key={r.id}
                  id={`${listId}-${r.id}`}
                  type="button"
                  role="option"
                  aria-selected={i === selected}
                  className={`launcher-result${i === selected ? " selected" : ""}`}
                  onMouseEnter={() => setSelected(i)}
                  onClick={() => open(r)}
                >
                  <span className="lr-icon">{r.icon}</span>
                  <span style={{ minWidth: 0 }}>
                    <div className="lr-name">{r.name}</div>
                    {r.sub && <div className="lr-sub">{r.sub}</div>}
                  </span>
                  <span className="lr-kind">{r.kind === "app" ? t("launcher.apps") : t("launcher.skills")}</span>
                </button>
              ))}
            </div>
          ) : (
            <div className="launcher-grid">
              {apps.map((app, i) => (
                <button key={app.id} type="button" className="launcher-tile" style={{ "--i": i } as CSSProperties} onClick={() => open(app)}>
                  <span className="lt-icon">{app.icon}</span>
                  <span className="lt-name">{app.name}</span>
                </button>
              ))}
            </div>
          )}
          <p className="launcher-hint">
            <span className="kbd">Esc</span> {t("common.close")} · <span className="kbd">Ctrl/⌘ M</span> {t("os.menu")} · <span className="kbd">↵</span> {t("launcher.open")}
          </p>
        </div>
      </div>
    </DialogPortal>
  );
}
