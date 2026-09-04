// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import {
  DEFAULT_PRESET,
  PRESETS,
  PRESET_STORAGE_KEY,
  applyPreset,
  getPreset,
  isPresetId,
  nextPreset,
  readStoredPreset,
} from "./theme";

describe("theme presets", () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.removeAttribute("data-preset");
    document.documentElement.removeAttribute("style");
    document.documentElement.dataset.theme = "dark";
  });

  it("applies data-preset, the accent tokens and persists the choice", () => {
    const preset = applyPreset("forest");
    expect(preset.id).toBe("forest");
    expect(document.documentElement.dataset.preset).toBe("forest");
    expect(document.documentElement.style.getPropertyValue("--accent")).toBe("#4ade80");
    expect(document.documentElement.style.getPropertyValue("--accent-contrast")).not.toBe("");
    expect(document.documentElement.style.getPropertyValue("--accent-text")).not.toBe("");
    expect(document.documentElement.style.getPropertyValue("--display-weight")).toBe("900");
    expect(localStorage.getItem(PRESET_STORAGE_KEY)).toBe("forest");
    expect(readStoredPreset()).toBe("forest");
  });

  it("falls back to the default preset for unknown ids", () => {
    const preset = applyPreset("neon-pink");
    expect(preset.id).toBe(DEFAULT_PRESET);
    expect(document.documentElement.dataset.preset).toBe(DEFAULT_PRESET);
    expect(isPresetId("neon-pink")).toBe(false);
    expect(getPreset(undefined).id).toBe(DEFAULT_PRESET);
  });

  it("can skip the accent and persistence", () => {
    applyPreset("ocean", { accent: false, persist: false });
    expect(document.documentElement.dataset.preset).toBe("ocean");
    expect(document.documentElement.style.getPropertyValue("--accent")).toBe("");
    expect(localStorage.getItem(PRESET_STORAGE_KEY)).toBeNull();
  });

  it("mono lowers the display weight and cycling wraps around", () => {
    expect(applyPreset("mono").displayWeight).toBe(700);
    expect(document.documentElement.style.getPropertyValue("--display-weight")).toBe("700");
    expect(nextPreset(PRESETS[PRESETS.length - 1]!.id).id).toBe(PRESETS[0]!.id);
    expect(nextPreset("hud-orange").id).toBe("jarvis");
  });

  it("ignores garbage in localStorage", () => {
    localStorage.setItem(PRESET_STORAGE_KEY, "garbage");
    expect(readStoredPreset()).toBe(DEFAULT_PRESET);
  });
});
