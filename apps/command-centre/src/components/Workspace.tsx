/**
 * The workspace's render profile (refino item 55): immersive, economy, or
 * automatic (economy on a discharging battery or with reduced motion). The
 * immersive shell's canvases read `economy` to slow down or hold still.
 *
 * The dock and the spaces that used to live here went with the windowed
 * desktop: the shell has scenes instead (src/nucleo).
 */
import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useState } from "react";

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
  // Refino item 55: "auto" turns economical on a discharging battery.
  const [onBattery, setOnBattery] = useState(false);
  useEffect(() => {
    const nav = navigator as Navigator & {
      getBattery?: () => Promise<{
        charging: boolean;
        level: number;
        addEventListener: (t: string, f: () => void) => void;
      }>;
    };
    if (typeof nav.getBattery !== "function") return;
    let cancelled = false;
    void nav.getBattery().then((b) => {
      if (cancelled) return;
      const read = () => setOnBattery(!b.charging && b.level < 0.5);
      read();
      b.addEventListener("chargingchange", read);
      b.addEventListener("levelchange", read);
    });
    return () => {
      cancelled = true;
    };
  }, []);
  const economy = reduced || renderProfile === "economy" || (renderProfile === "auto" && onBattery);
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
