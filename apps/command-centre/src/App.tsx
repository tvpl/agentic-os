import { Suspense, lazy, useCallback, useEffect, useMemo, useState, type ComponentType, type ReactNode } from "react";
import { HashRouter, Route, Routes, useLocation } from "react-router-dom";
import { QueryClient, QueryClientProvider, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Menu } from "lucide-react";
import { api, type Meta } from "./api";
import { I18nContext, useT, type Lang, type TKey } from "./i18n";
import { qk, useOsSettings } from "./queries";
import { applyAccentTokens, applyPreset, isPresetId, readStoredPreset } from "./theme";
import { Skeleton, ToastProvider } from "./components/ui";
import { useDialogDepth, usePresence } from "./components/dialog";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { EmptyState } from "./components/primitives";
import { CommandPalette, TOGGLE_EDIT_EVENT, type PaletteOpenDetail } from "./components/CommandPalette";
import { ShortcutsHelp } from "./components/ShortcutsHelp";
import { ConfirmProvider } from "./hooks/useConfirm";
import { useEventStream } from "./hooks/useEventStream";
import { NotificationsProvider } from "./hooks/useNotifications";
import { useOsNavigate } from "./hooks/useViewTransition";

// Desktop is the landing surface and stays in the main chunk.
import Desktop from "./desktop";
const Runs = lazy(() => import("./runs"));
// TODO(orchestrator): switch to `lazy(() => import("./brain"))` once F3 lands src/brain/index.tsx.
const SecondBrain = lazy(() => import("./views/SecondBrain"));
const Skills = lazy(() => import("./views/Skills"));
const Routines = lazy(() => import("./views/Routines"));
const Connectors = lazy(() => import("./views/Connectors"));
const Settings = lazy(() => import("./views/Settings"));
const Setup = lazy(() => import("./views/Setup"));
const PixelStudio = lazy(() => import("./views/PixelStudio"));

/**
 * Routes whose module may not exist yet in this build (other frontiers land
 * them): resolve to a placeholder instead of breaking the bundle. Vite needs
 * static path strings, hence the glob with an explicit list.
 */
const optionalViews = import.meta.glob<{ default: ComponentType }>(["./views/Artifacts.tsx", "./views/Generations.tsx"]);
function lazyOptional(path: string, name: TKey): ComponentType {
  const loader = optionalViews[path];
  const placeholder = { default: () => <MissingApp name={name} /> };
  return lazy(async () => {
    if (!loader) return placeholder;
    try {
      return await loader();
    } catch {
      return placeholder;
    }
  });
}
const Artifacts = lazyOptional("./views/Artifacts.tsx", "shell.route.artifacts");
const Generations = lazyOptional("./views/Generations.tsx", "shell.route.generations");

function MissingApp({ name }: { name: TKey }) {
  const t = useT();
  return (
    <div className="page">
      <EmptyState title={t(name)} body={t("shell.route.missing")} />
    </div>
  );
}

/** Fire this event from anywhere to open the command palette (CustomEvent `detail`: PaletteOpenDetail). */
export const LAUNCHER_EVENT = "mordomo:launcher";
/** Fire this event to open the keyboard-shortcuts sheet. */
export const SHORTCUTS_EVENT = "mordomo:shortcuts";
export { TOGGLE_EDIT_EVENT };

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
  // Theme preset: `settings.themePreset` once the backend has it, else the browser mirror.
  const settings = useOsSettings({ enabled: !!meta?.setupCompleted, staleTime: 30_000 });
  const serverPreset = settings.data?.themePreset;
  const presetId = isPresetId(serverPreset) ? serverPreset : readStoredPreset();

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
      applyPreset(presetId, { accent: false, persist: isPresetId(serverPreset) });
      applyAccentTokens(meta.accentColor, theme);
    };
    apply();
    document.title = meta.name;
    if (meta.theme !== "system") return;
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, [meta, presetId, serverPreset]);

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
          <NotificationsProvider>
            <HashRouter>
              {meta.setupCompleted ? (
                <OsShell meta={meta} onMetaChanged={loadMeta} />
              ) : (
                <Suspense fallback={<Skeleton page lines={6} />}>
                  <Setup onDone={loadMeta} />
                </Suspense>
              )}
            </HashRouter>
          </NotificationsProvider>
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
  artifacts: "shell.route.artifacts",
  generations: "shell.route.generations",
};

function PageFallback() {
  return <Skeleton page lines={8} />;
}

/**
 * Route wrapper: error boundary (reset on navigation), lazy suspense and a
 * 160 ms fade keyed on the app segment (intra-app navigation does not refade).
 */
function RouteSurface({ name, children }: { name: string; children: ReactNode }) {
  const t = useT();
  const { pathname } = useLocation();
  const key = ROUTE_TITLE[name];
  const segment = pathname.split("/")[1] ?? "";
  return (
    <ErrorBoundary name={key ? t(key) : t("nav.dashboard")} resetKey={pathname}>
      <Suspense fallback={<PageFallback />}>
        <div className="route-surface" key={segment}>
          {children}
        </div>
      </Suspense>
    </ErrorBoundary>
  );
}

interface PaletteState {
  open: boolean;
  /** Skip the exit animation (set when the palette navigates with a shared-element morph). */
  instant: boolean;
  initial?: PaletteOpenDetail;
}

function isEditableTarget(): boolean {
  const el = document.activeElement;
  if (!el) return false;
  if (["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName)) return true;
  return (el as HTMLElement).isContentEditable;
}

function OsShell({ meta, onMetaChanged }: { meta: Meta; onMetaChanged: () => void }) {
  const t = useT();
  const [palette, setPalette] = useState<PaletteState>({ open: false, instant: false });
  const { mounted: paletteMounted, closing: paletteClosing } = usePresence(palette.open, 160);
  const paletteVisible = paletteMounted && !palette.instant;
  const [help, setHelp] = useState(false);
  const navigate = useOsNavigate();
  const location = useLocation();
  const { connected } = useEventStream();
  const depth = useDialogDepth();

  const openPalette = useCallback((initial?: PaletteOpenDetail) => setPalette({ open: true, instant: false, initial }), []);
  const closePalette = useCallback((opts?: { instant?: boolean }) => setPalette((p) => (p.open ? { ...p, open: false, instant: !!opts?.instant } : p)), []);

  useEffect(() => {
    const onLauncher = (e: Event) => openPalette((e as CustomEvent<PaletteOpenDetail | undefined>).detail ?? undefined);
    const onShortcuts = () => setHelp(true);
    window.addEventListener(LAUNCHER_EVENT, onLauncher);
    window.addEventListener(SHORTCUTS_EVENT, onShortcuts);
    return () => {
      window.removeEventListener(LAUNCHER_EVENT, onLauncher);
      window.removeEventListener(SHORTCUTS_EVENT, onShortcuts);
    };
  }, [openPalette]);

  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => {
      // Dialogs handle their own Escape (and stop propagation); never navigate from inside one.
      if (ev.defaultPrevented) return;
      const target = ev.target instanceof Element ? ev.target : null;
      if (target?.closest('[role="dialog"]')) return;
      const inField = isEditableTarget();
      const mod = ev.metaKey || ev.ctrlKey;
      const key = ev.key.toLowerCase();
      if (ev.key === "Escape") {
        if (palette.open) closePalette();
        else if (location.pathname !== "/" && !inField) navigate("/");
        return;
      }
      if (mod && !ev.altKey && !ev.shiftKey && (key === "k" || key === "m")) {
        ev.preventDefault();
        if (palette.open) closePalette();
        else openPalette();
        return;
      }
      if (ev.key === "?" && !mod && !ev.altKey && !inField && depth === 0) {
        ev.preventDefault();
        setHelp(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [palette.open, location.pathname, navigate, openPalette, closePalette, depth]);

  // Close the palette on navigation.
  useEffect(() => closePalette(), [location.pathname, closePalette]);

  const framed = (name: string, node: ReactNode) => (
    <RouteSurface name={name}>
      <AppFrame>{node}</AppFrame>
    </RouteSurface>
  );

  return (
    <div className="os-root" data-depth={depth > 0 ? "pushed" : undefined} data-palette={paletteVisible ? "open" : undefined}>
      <div className="depth-layer">
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
          <Route path="/artifacts" element={framed("artifacts", <Artifacts />)} />
          <Route path="/generations" element={framed("generations", <Generations />)} />
          <Route path="/settings" element={framed("settings", <Settings onMetaChanged={onMetaChanged} />)} />
        </Routes>
      </div>
      {paletteVisible && (
        <CommandPalette
          meta={meta}
          closing={paletteClosing}
          onClose={closePalette}
          onMetaChanged={onMetaChanged}
          onShortcuts={() => setHelp(true)}
          initial={palette.initial}
        />
      )}
      {help && <ShortcutsHelp onClose={() => setHelp(false)} />}
      <div className={`sse-dot${connected ? "" : " off"}`} title={t("common.reconnecting")} aria-hidden>
        <span className="dot warn" />
      </div>
    </div>
  );
}

/** Fullscreen app surface. The chrome is a sticky header in normal flow (audit item 12). */
export function AppFrame({ children, title }: { children: ReactNode; title?: string }) {
  const t = useT();
  const navigate = useOsNavigate();
  const { pathname } = useLocation();
  const segment = pathname.split("/")[1] ?? "";
  const key = ROUTE_TITLE[segment];
  const name = title ?? (key ? t(key) : "");
  return (
    <div className="app-frame">
      <header className="app-frame-chrome">
        <div className="left">
          <button type="button" className="os-chip back" onClick={() => navigate("/")}>
            <ArrowLeft aria-hidden /> {t("os.backToOs")}
          </button>
          {name && <span className="app-frame-title">{name}</span>}
        </div>
        <div className="right">
          <button type="button" className="os-chip" onClick={() => window.dispatchEvent(new CustomEvent(LAUNCHER_EVENT))}>
            <Menu aria-hidden /> {t("os.menu")}
          </button>
        </div>
      </header>
      <div className="app-frame-body">{children}</div>
    </div>
  );
}
