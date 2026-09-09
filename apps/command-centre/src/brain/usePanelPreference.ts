import { useEffect, useState } from "react";

/** Panels are a per-tab preference, independent of shared graph links. */
export function usePanelPreference(name: "legend" | "files" | "controls", initial: boolean) {
  const key = `mordomo.brainPanel.${name}`;
  const state = useState(() => {
    try {
      const saved = sessionStorage.getItem(key);
      return saved === "true" ? true : saved === "false" ? false : initial;
    } catch {
      return initial;
    }
  });
  const [value] = state;
  useEffect(() => {
    try {
      sessionStorage.setItem(key, String(value));
    } catch {
      // Unavailable storage must not prevent opening or closing a panel.
    }
  }, [key, value]);
  return state;
}
