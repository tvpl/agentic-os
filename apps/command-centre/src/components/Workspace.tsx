import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { useLocation } from "react-router-dom";
import {
  BrainCircuit,
  CalendarClock,
  ChevronDown,
  ChevronUp,
  Grid3x3,
  Layers,
  LayoutDashboard,
  ListTree,
  Settings,
  Sparkles,
} from "lucide-react";
import { useT, type TKey } from "../i18n";
import { useOsSettings } from "../queries";
import { useOsNavigate } from "../hooks/useViewTransition";
import { PANEL_GLYPH, getPanels, requestPanelAction, subscribePanels } from "../desktop/panelKinds";
import "./workspace.css";

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
  renderProfile: RenderProfile;
  setRenderProfile: (profile: RenderProfile) => void;
  economy: boolean;
}>({
  renderProfile: "auto",
  setRenderProfile: () => undefined,
  economy: false,
});
export function WorkspaceProvider({ children }: { children: ReactNode }) {
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
  const value = useMemo(
    () => ({ renderProfile, setRenderProfile, economy }),
    [renderProfile, setRenderProfile, economy],
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

/**
 * The three desktop spaces (redesign F6). Each remembers its own windows, so
 * switching is putting a context of work down and picking another up — which
 * is what the old `overview` / `focus` / `explore` modes only pretended to
 * be: they changed opacity and lost whatever you had arranged.
 *
 * The dock does not own the layout, so it asks: the desktop hears the event
 * and performs the switch with the arrangement it has live, including a drag
 * that has not been persisted yet.
 */
export const SWITCH_SPACE_EVENT = "mordomo:switch-space";

/**
 * A switch requested from another app: the dock navigates home first, so the
 * desktop is not mounted yet and would never hear the event. The request is
 * parked here and drained when the desktop comes up.
 */
let pendingSpace: string | null = null;
export function requestSpace(id: string) {
  pendingSpace = id;
  window.dispatchEvent(new CustomEvent(SWITCH_SPACE_EVENT, { detail: id }));
}
export function takePendingSpace(): string | null {
  const next = pendingSpace;
  pendingSpace = null;
  return next;
}
export const SPACE_IDS = ["work", "research", "ops"] as const;
export type SpaceId = (typeof SPACE_IDS)[number];

function SpaceSwitcher() {
  const t = useT();
  const navigate = useOsNavigate();
  const { pathname } = useLocation();
  const settings = useOsSettings();
  const active = settings.data?.activeSpace ?? "work";
  return (
    <div className="dock-spaces" data-onboarding="modes" role="group" aria-label={t("desktop.space.title")}>
      {SPACE_IDS.map((id) => (
        <button
          key={id}
          type="button"
          aria-pressed={active === id && pathname === "/"}
          onClick={() => {
            if (pathname !== "/") navigate("/");
            requestSpace(id);
          }}
        >
          <Layers aria-hidden />
          <span>{t(`desktop.space.${id}`)}</span>
        </button>
      ))}
    </div>
  );
}

/**
 * The panels on the stage, as the prototype's dock shows them (G1): one
 * button per open panel, a parked one dashed, a live trace with a pulse.
 * Clicking the focused one parks it; a parked one comes back; any other
 * comes to the front. The desktop owns the layout; this only asks.
 */
function DockTasks() {
  const t = useT();
  const { pathname } = useLocation();
  const panels = useSyncExternalStore(subscribePanels, getPanels, () => []);
  if (pathname !== "/" || panels.length === 0) return null;
  const topId = panels.find((p) => !p.minimized)?.id ?? null;
  return (
    <div className="dock-tasks" role="group" aria-label={t("desktop.dock.panels")}>
      {panels.map((p) => (
        <button
          key={p.id}
          type="button"
          className={`dock-task${p.minimized ? " parked" : ""}${p.id === topId ? " on" : ""}`}
          data-task={p.id}
          aria-pressed={p.id === topId}
          title={p.title}
          onClick={() =>
            requestPanelAction(p.id, p.minimized ? "restore" : p.id === topId ? "minimize" : "focus")
          }
        >
          {p.live && <span className="dock-live" aria-hidden />}
          <span className="dock-glyph" aria-hidden>
            {PANEL_GLYPH[p.kind]}
          </span>
          <span className="dock-task-name">{p.title}</span>
        </button>
      ))}
    </div>
  );
}

/** Persistent navigation: app changes never depend on reopening the launcher. */
export function WorkspaceDock() {
  const t = useT();
  const navigate = useOsNavigate();
  const { pathname } = useLocation();
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
          <DockTasks />
          <SpaceSwitcher />
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
