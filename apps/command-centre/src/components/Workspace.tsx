import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { useLocation } from "react-router-dom";
import {
  BrainCircuit,
  CalendarClock,
  ChevronDown,
  ChevronUp,
  Compass,
  Focus,
  Grid3x3,
  LayoutDashboard,
  ListTree,
  Settings,
  Sparkles,
} from "lucide-react";
import { useT, type TKey } from "../i18n";
import { useOsNavigate } from "../hooks/useViewTransition";
import "./workspace.css";

export type WorkspaceMode = "overview" | "focus" | "explore";
const MODES: WorkspaceMode[] = ["overview", "focus", "explore"];
const MODE_KEY = "mordomo.workspace.mode";
function initialMode(): WorkspaceMode {
  try {
    const mode = localStorage.getItem(MODE_KEY);
    return MODES.includes(mode as WorkspaceMode) ? (mode as WorkspaceMode) : "overview";
  } catch {
    return "overview";
  }
}
export type RenderProfile = "auto" | "immersive" | "economy";
function initialProfile(): RenderProfile {
  try {
    const value = localStorage.getItem("mordomo.renderProfile");
    return value === "immersive" || value === "economy" ? value : "auto";
  } catch {
    return "auto";
  }
}
const WorkspaceContext = createContext<{
  mode: WorkspaceMode;
  setMode: (mode: WorkspaceMode) => void;
  renderProfile: RenderProfile;
  setRenderProfile: (profile: RenderProfile) => void;
  economy: boolean;
}>({
  mode: "overview",
  setMode: () => undefined,
  renderProfile: "auto",
  setRenderProfile: () => undefined,
  economy: false,
});
export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const [mode, updateMode] = useState(initialMode);
  const [renderProfile, updateProfile] = useState(initialProfile);
  const [reduced, setReduced] = useState(() => window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const change = () => setReduced(query.matches);
    query.addEventListener("change", change);
    return () => query.removeEventListener("change", change);
  }, []);
  const economy = reduced || renderProfile === "economy";
  const setRenderProfile = useCallback((profile: RenderProfile) => {
    updateProfile(profile);
    try {
      localStorage.setItem("mordomo.renderProfile", profile);
    } catch {
      /* session only */
    }
  }, []);
  useEffect(() => {
    document.documentElement.dataset.renderProfile = economy ? "economy" : "immersive";
    return () => {
      delete document.documentElement.dataset.renderProfile;
    };
  }, [economy]);
  const setMode = useCallback((next: WorkspaceMode) => {
    updateMode(next);
    try {
      localStorage.setItem(MODE_KEY, next);
    } catch {
      /* session-only when storage is unavailable */
    }
  }, []);
  const value = useMemo(
    () => ({ mode, setMode, renderProfile, setRenderProfile, economy }),
    [mode, setMode, renderProfile, setRenderProfile, economy],
  );
  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>;
}
export const useWorkspace = () => useContext(WorkspaceContext);

const APPS: Array<{ route: string; label: TKey; Icon: typeof BrainCircuit }> = [
  { route: "/", label: "nav.dashboard", Icon: LayoutDashboard },
  { route: "/brain", label: "nav.brain", Icon: BrainCircuit },
  { route: "/skills", label: "nav.skills", Icon: Sparkles },
  { route: "/routines", label: "nav.routines", Icon: CalendarClock },
  { route: "/runs", label: "nav.runs", Icon: ListTree },
  { route: "/pixel", label: "nav.pixel", Icon: Grid3x3 },
  { route: "/settings", label: "nav.settings", Icon: Settings },
];
const MODE_ICONS = { overview: LayoutDashboard, focus: Focus, explore: Compass };

/** Persistent navigation: app changes never depend on reopening the launcher. */
export function WorkspaceDock() {
  const t = useT();
  const navigate = useOsNavigate();
  const { pathname } = useLocation();
  const { mode, setMode } = useWorkspace();
  const [collapsed, setCollapsed] = useState(false);
  return (
    <nav className={`workspace-dock${collapsed ? " collapsed" : ""}`} aria-label={t("desktop.dock.title")}>
      {!collapsed && (
        <>
          <div className="dock-apps">
            {APPS.map(({ route, label, Icon }) => (
              <button
                type="button"
                key={route}
                className={`dock-app${pathname === route || (route !== "/" && pathname.startsWith(route + "/")) ? " active" : ""}`}
                aria-label={t(label)}
                aria-current={pathname === route ? "page" : undefined}
                onClick={() => navigate(route)}
              >
                <Icon aria-hidden />
                <span className="dock-tooltip">{t(label)}</span>
              </button>
            ))}
          </div>
          <div
            className="dock-modes"
            data-onboarding="modes"
            role="group"
            aria-label={t("desktop.mode.title")}
          >
            {MODES.map((value) => {
              const Icon = MODE_ICONS[value];
              return (
                <button
                  key={value}
                  type="button"
                  aria-pressed={mode === value && pathname === "/"}
                  onClick={() => {
                    setMode(value);
                    if (pathname !== "/") navigate("/");
                  }}
                >
                  <Icon aria-hidden />
                  <span>{t(`desktop.mode.${value}`)}</span>
                </button>
              );
            })}
          </div>
        </>
      )}
      <button
        type="button"
        className="dock-collapse"
        onClick={() => setCollapsed(!collapsed)}
        aria-expanded={!collapsed}
        aria-label={t(collapsed ? "desktop.dock.expand" : "desktop.dock.collapse")}
      >
        {collapsed ? <ChevronUp aria-hidden /> : <ChevronDown aria-hidden />}
      </button>
    </nav>
  );
}
