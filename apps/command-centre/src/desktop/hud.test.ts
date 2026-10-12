import { describe, expect, it } from "vitest";
import { dictionaries } from "../i18n";
import { APP_KINDS } from "./apps";
import { HUD_CATALOGUE, hudTitleKey } from "./hud";

describe("the catalogue of instruments the palette offers", () => {
  it("lists every app, then the thirteen readings, each once", () => {
    expect(HUD_CATALOGUE).toHaveLength(APP_KINDS.length + 13);
    expect(new Set(HUD_CATALOGUE).size).toBe(HUD_CATALOGUE.length);
    expect(HUD_CATALOGUE.slice(0, APP_KINDS.length)).toEqual(APP_KINDS.map((k) => `app:${k}`));
  });

  it("names every instrument with a title that both languages have", () => {
    for (const id of HUD_CATALOGUE) {
      const key = hudTitleKey(id);
      expect(dictionaries.en[key], `en ${id}`).toBeTruthy();
      expect(dictionaries["pt-BR"][key], `pt-BR ${id}`).toBeTruthy();
    }
  });
});
