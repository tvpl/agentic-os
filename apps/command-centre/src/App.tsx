import {
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import ServiceHealthBanner from "./components/ServiceHealthBanner";
import { HashRouter, Route, Routes, useLocation } from "react-router-dom";
import { QueryClient, QueryClientProvider, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, needsPairing, setDeviceToken, type Meta } from "./api";
import { I18nContext, useT, type Lang, type TKey } from "./i18n";
import { qk, useOsUiPreferences } from "./queries";
import {
  applyAccentTokens,
  applyHudIntensity,
  applyPreset,
  isPresetId,
  readStoredHudIntensity,
  readStoredPreset,
} from "./theme";
import { Skeleton, ToastProvider } from "./components/ui";
import { useDialogDepth, usePresence } from "./components/dialog";
import { ErrorBoundary } from "./components/ErrorBoundary";
import {
  CommandPalette,
  OPEN_DECK_EVENT,
  OPEN_PANEL_EVENT,
  RESET_LAYOUT_EVENT,
  type PaletteOpenDetail,
} from "./components/CommandPalette";
import { WorkspaceProvider } from "./components/Workspace";
import { ShortcutsHelp } from "./components/ShortcutsHelp";
import { ConfirmProvider } from "./hooks/useConfirm";
import { useEventStream } from "./hooks/useEventStream";
import { NotificationsProvider } from "./hooks/useNotifications";
import { useOsNavigate } from "./hooks/useViewTransition";

// The immersive shell is the landing surface and stays in the main chunk:
// every route is one of its scenes.
import Nucleo from "./nucleo";
import { lazyRoute } from "./lazyRoute";
import { Onboarding } from "./onboarding/Onboarding";
import { ProviderGate } from "./components/ProviderGate";
const Setup = lazyRoute(() => import("./views/Setup"));

/** Fire this event from anywhere to open the command palette (CustomEvent `detail`: PaletteOpenDetail). */
export const LAUNCHER_EVENT = "mordomo:launcher";
/** Fire this event to open the keyboard-shortcuts sheet. */
export const SHORTCUTS_EVENT = "mordomo:shortcuts";
export { RESET_LAYOUT_EVENT, OPEN_DECK_EVENT, OPEN_PANEL_EVENT };

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
  // Theme preset: the saved UI preference once the backend answers, else the browser mirror.
  const uiPreferences = useOsUiPreferences({ enabled: !!meta?.setupCompleted, staleTime: 30_000 });
  const serverPreset = uiPreferences.data?.themePreset;
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
      const hud = readStoredHudIntensity();
      if (hud !== null) applyHudIntensity(hud, { persist: false });
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
  if (!meta) return <BootScreen phase="connecting" />;

  return (
    <I18nContext.Provider value={i18nValue}>
      <ToastProvider>
        <ConfirmProvider>
          <NotificationsProvider>
            {/* Route changes are urgent; animation is handled by useOsNavigate. */}
            <HashRouter useTransitions={false}>
              {needsPairing() ? (
                <PairingScreen meta={meta} />
              ) : meta.setupCompleted ? (
                <>
                  <WorkspaceProvider>
                    <OsShell meta={meta} onMetaChanged={loadMeta} />
                  </WorkspaceProvider>
                  <BootSequence meta={meta} />
                </>
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

const BOOT_SESSION_KEY = "mordomo.booted";
const BOOT_MS = 1100;

/**
 * Boot sequence (plan §6.4): the first paint of the session is never a blank
 * frame. While the meta request is in flight the screen shows the core
 * lighting up; once the shell is mounted three telemetry lines type in and
 * the overlay fades out. Plays once per browser session; skipped entirely
 * under `prefers-reduced-motion` and when the HUD intensity is 0.
 */
function BootScreen({ phase, meta }: { phase: "connecting" | "ready"; meta?: Meta }) {
  const t = useT();
  const lines = [
    t("shell.boot.memory"),
    t("shell.boot.skills"),
    meta ? `${t("shell.boot.provider")} · ${meta.name}` : t("shell.boot.provider"),
  ];
  return (
    <div
      className={`boot-screen ${phase}`}
      role="status"
      aria-live="polite"
      aria-label={t("shell.boot.label")}
    >
      <div className="boot-core" aria-hidden>
        <span className="ring r1" />
        <span className="ring r2" />
        <span className="ring r3" />
        <span className="dot" />
      </div>
      <div className="boot-lines" aria-hidden={phase === "connecting"}>
        {lines.map((line, i) => (
          <div className="boot-line" style={{ "--i": i } as CSSProperties} key={line}>
            {line}
          </div>
        ))}
        <div className="boot-line final" style={{ "--i": lines.length } as CSSProperties}>
          {meta ? `— ${meta.name.toUpperCase()} ONLINE —` : t("shell.boot.connecting")}
        </div>
      </div>
    </div>
  );
}

function BootSequence({ meta }: { meta: Meta }) {
  const [show, setShow] = useState(() => {
    try {
      if (sessionStorage.getItem(BOOT_SESSION_KEY)) return false;
    } catch {
      /* private mode: boot every time, which is fine */
    }
    if (
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
    )
      return false;
    const hud =
      parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--hud-intensity")) || 0;
    return hud > 0;
  });
  useEffect(() => {
    if (!show) return;
    try {
      sessionStorage.setItem(BOOT_SESSION_KEY, "1");
    } catch {
      /* ignore */
    }
    const id = window.setTimeout(() => setShow(false), BOOT_MS);
    return () => window.clearTimeout(id);
  }, [show]);
  if (!show) return null;
  return <BootScreen phase="ready" meta={meta} />;
}

/**
 * A remote browser without a credential (plan Onda 3 §1): exchange the
 * six-digit code shown on the desktop for this device's own token.
 */
function PairingScreen({ meta }: { meta: Meta }) {
  const t = useT();
  const [code, setCode] = useState("");
  const [name, setName] = useState(() =>
    typeof navigator !== "undefined" ? navigator.platform || "device" : "device",
  );
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    if (!/^\d{6}$/.test(code) || busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await api.post<{ token: string }>("/api/pair/claim", { code, name });
      setDeviceToken(res.token);
      location.reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  };
  return (
    <div className="pairing-screen">
      <div className="card pairing-card">
        <div className="hud-label accent">{meta.name}</div>
        <h2>{t("shell.pair.title")}</h2>
        <p className="hint">{t("shell.pair.body")}</p>
        {meta.tls?.fingerprint && location.protocol === "https:" && (
          <p className="hint mono pairing-fingerprint" title={t("shell.pair.fingerprintTitle")}>
            {t("shell.pair.fingerprint")} {meta.tls.fingerprint}
          </p>
        )}
        <label className="pairing-field">
          <span className="hud-label">{t("shell.pair.code")}</span>
          <input
            className="input pairing-code"
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={6}
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
            onKeyDown={(e) => e.key === "Enter" && void submit()}
            aria-label={t("shell.pair.code")}
          />
        </label>
        <label className="pairing-field">
          <span className="hud-label">{t("shell.pair.name")}</span>
          <input
            className="input"
            value={name}
            maxLength={80}
            onChange={(e) => setName(e.target.value)}
            aria-label={t("shell.pair.name")}
          />
        </label>
        {error && <p className="hint warn">{t("shell.pair.failed")}</p>}
        <button
          type="button"
          className="btn primary"
          disabled={code.length !== 6 || busy}
          onClick={() => void submit()}
        >
          {t("shell.pair.submit")}
        </button>
      </div>
    </div>
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
function RouteSurface({
  name,
  children,
  stable = false,
}: {
  name: string;
  children: ReactNode;
  /**
   * The desktop is rendered for every app route (G2: apps open as panels and
   * the URL is a deep link), so it must not be re-keyed — and re-mounted — on
   * the way from `/brain` back to `/`.
   */
  stable?: boolean;
}) {
  const t = useT();
  const { pathname } = useLocation();
  const key = ROUTE_TITLE[name];
  const segment = pathname.split("/")[1] ?? "";
  return (
    <ErrorBoundary name={key ? t(key) : t("nav.dashboard")} resetKey={stable ? undefined : pathname}>
      <Suspense fallback={<PageFallback />}>
        <div className="route-surface" key={stable ? "desktop" : segment} data-onboarding={name}>
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

  const openPalette = useCallback(
    (initial?: PaletteOpenDetail) => setPalette({ open: true, instant: false, initial }),
    [],
  );
  const closePalette = useCallback(
    (opts?: { instant?: boolean }) =>
      setPalette((p) => (p.open ? { ...p, open: false, instant: !!opts?.instant } : p)),
    [],
  );

  useEffect(() => {
    const onLauncher = (e: Event) =>
      openPalette((e as CustomEvent<PaletteOpenDetail | undefined>).detail ?? undefined);
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
      if (ev.defaultPrevented || document.documentElement.dataset.onboarding) return;
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

  // Close the palette on navigation — to a page. A deep link bouncing back
  // to `/` (G2: an app opened as a panel) is not a place the user went; a
  // palette opened in the same instant must survive it.
  useEffect(() => {
    if (location.pathname !== "/") closePalette();
  }, [location.pathname, closePalette]);

  const shell = (
    <RouteSurface name="desktop" stable>
      <Nucleo meta={meta} onMetaChanged={onMetaChanged} />
    </RouteSurface>
  );

  return (
    <div
      className="os-root"
      data-depth={depth > 0 ? "pushed" : undefined}
      data-palette={paletteVisible ? "open" : undefined}
    >
      <div className="depth-layer">
        <Routes>
          {/* Every route is a scene of the shell; the shell reads the path. */}
          <Route path="/*" element={shell} />
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
      <ServiceHealthBanner name={meta.name} />
      <div className={`sse-dot${connected ? "" : " off"}`} title={t("common.reconnecting")} aria-hidden>
        <span className="dot warn" />
      </div>
      {/* HUD instrumentation layer: scanlines, vignette and corner brackets (CSS only, --hud-intensity). */}
      <div className="hud-overlay" aria-hidden>
        <span className="hud-bracket tl" />
        <span className="hud-bracket tr" />
        <span className="hud-bracket bl" />
        <span className="hud-bracket br" />
      </div>
      <ProviderGate />
      <Onboarding />
    </div>
  );
}
