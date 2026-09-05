/**
 * First paint without a flash: restore the theme preset chosen on this browser
 * before React mounts. Imported at the top of `main.tsx` (never inline in the
 * HTML — the server's CSP is `script-src 'self'`, so an inline script is
 * refused). `theme.ts` keeps the same storage key in sync.
 */
const KEY = "mordomo.themePreset";
const HUD_KEY = "mordomo.hudIntensity";

try {
  const preset = localStorage.getItem(KEY);
  if (preset && /^[a-z-]+$/.test(preset)) document.documentElement.dataset.preset = preset;
  const hud = localStorage.getItem(HUD_KEY);
  if (hud !== null && /^(0|1|0?\.\d+)$/.test(hud))
    document.documentElement.style.setProperty("--hud-intensity", hud);
} catch {
  /* private mode or blocked storage: the default preset stands */
}
