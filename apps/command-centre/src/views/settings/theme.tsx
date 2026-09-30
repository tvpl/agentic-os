/** Settings › theme (split out of Settings.tsx, refino item 17). */
import { useWorkspace, type RenderProfile } from "../../components/Workspace";
import { useState } from "react";
import { Check } from "lucide-react";

import { useT } from "../../i18n";
import { useToast } from "../../components/ui";
import { Field } from "../../components/primitives";
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

export function ThemeTab({ s, put }: { s: SettingsShape; put: Put }) {
  const { renderProfile, setRenderProfile } = useWorkspace();
  const t = useT();
  const toast = useToast();
  const current = s.themePreset;
  const pick = (id: PresetId) => {
    const preset = applyPreset(id);
    toast(t("apps.settings.presetApplied", { name: preset.label }), "ok");
    void put({ themePreset: id, accentColor: preset.accent }, true);
  };
  const [hud, setHud] = useState(() => readStoredHudIntensity() ?? currentHudIntensity());
  const onHud = (v: number) => {
    setHud(v);
    applyHudIntensity(v);
  };
  return (
    <div className="card stack">
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
