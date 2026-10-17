/** Settings › theme (split out of Settings.tsx, refino item 17). */
import { useWorkspace, type RenderProfile } from "../../components/Workspace";
import { useState } from "react";
import { Check } from "lucide-react";

import { useT } from "../../i18n";
import { useToast } from "../../components/ui";
import { Field, Segmented } from "../../components/primitives";
import type { UiShell } from "../../api";
import { useCurrentShell } from "../../moldura/shell";
import {
  PRESETS,
  applyHudIntensity,
  applyPreset,
  currentHudIntensity,
  readStoredHudIntensity,
  type PresetId,
} from "../../theme";
import { type Put } from "../SettingsFields";
import type { SettingsShape } from "./shared";
import { useOsUiPreferences, useSaveUiPreferences } from "../../queries";

export function ThemeTab({ put }: { s: SettingsShape; put: Put }) {
  const { renderProfile, setRenderProfile } = useWorkspace();
  const t = useT();
  const toast = useToast();
  const preferences = useOsUiPreferences();
  const savePreferences = useSaveUiPreferences();
  const current = preferences.data?.themePreset;
  // Until the preferences arrive, the shell this page is part of is the one in use.
  const inUse = useCurrentShell();
  const shell: UiShell = preferences.data?.shell ?? inUse;
  // Saved at once; the shell reads the answer from the cache and swaps in place.
  const pickShell = (next: UiShell) => {
    if (next === shell) return;
    savePreferences({ shell: next }).then(
      // This page is rebuilt inside the other shell: the control that was pressed is a new
      // element, so focus is put back on it instead of dropping to the page.
      () =>
        requestAnimationFrame(() =>
          document.querySelector<HTMLElement>('[data-setting="shell"] [aria-checked="true"]')?.focus(),
        ),
      (err: Error) => toast(err.message, "danger"),
    );
  };
  const pick = (id: PresetId) => {
    const preset = applyPreset(id);
    toast(t("apps.settings.presetApplied", { name: preset.label }), "ok");
    // The preset is a UI preference; the accent colour stays an engine setting (it brands /api/meta).
    void savePreferences({ themePreset: id }).catch((err: Error) => toast(err.message, "danger"));
    void put({ accentColor: preset.accent }, true);
  };
  const [hud, setHud] = useState(() => readStoredHudIntensity() ?? currentHudIntensity());
  const onHud = (v: number) => {
    setHud(v);
    applyHudIntensity(v);
  };
  return (
    <div className="card stack">
      <div className="field" data-setting="shell">
        <label id="ui-shell-label">{t("moldura.settings.interface")}</label>
        <Segmented<UiShell>
          labelledBy="ui-shell-label"
          value={shell}
          onChange={pickShell}
          options={[
            { value: "moldura", label: t("moldura.settings.frame") },
            { value: "nucleo", label: t("moldura.settings.nucleo") },
          ]}
        />
      </div>
      <div>
        <h2>{t("apps.settings.presets")}</h2>
        <p className="hint">{t("apps.settings.presetsHint")}</p>
      </div>
      <Field label={t("settings.renderProfile")} htmlFor="render-profile">
        <select
          id="render-profile"
          className="input"
          value={renderProfile}
          onChange={(e) => setRenderProfile(e.target.value as RenderProfile)}
        >
          <option value="auto">{t("settings.renderAuto")}</option>
          <option value="immersive">{t("settings.renderImmersive")}</option>
          <option value="economy">{t("settings.renderEconomy")}</option>
        </select>
        <p className="hint">{t("settings.renderHint")}</p>
      </Field>
      <div className="field">
        <label htmlFor="hud-intensity">
          {t("shell.hud.intensity")} · <span className="mono">{Math.round(hud * 100)}%</span>
        </label>
        <div className="hud-slider">
          <span className="hint">{t("shell.hud.off")}</span>
          <input
            id="hud-intensity"
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={hud}
            onChange={(e) => onHud(parseFloat(e.target.value))}
          />
          <span className="hint">{t("shell.hud.full")}</span>
        </div>
        <p className="hint">{t("shell.hud.intensityHint")}</p>
      </div>
      <div className="apps-presets">
        {PRESETS.map((preset) => (
          <button
            key={preset.id}
            type="button"
            className="apps-preset"
            aria-pressed={preset.id === current}
            onClick={() => pick(preset.id)}
          >
            <span className="swatch" aria-hidden>
              {preset.swatch.map((c, i) => (
                <span key={i} style={{ background: c }} />
              ))}
            </span>
            <span className="name">
              {preset.label}
              {preset.id === current && <Check aria-hidden />}
            </span>
            <span className="accent mono">{preset.accent}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
