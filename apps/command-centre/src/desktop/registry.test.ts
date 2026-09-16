/**
 * @vitest-environment jsdom
 * The registry is imported for its metadata only (no rendering), but the
 * panels it pulls in reach `document` at module scope, hence jsdom.
 */
import { describe, expect, it } from "vitest";
import { dictionaries } from "../i18n";
import { WIDGET_ORDER } from "./defaultLayout";
import { defaultWindows } from "./defaultWindows";
import { MIN_H, MIN_W } from "./windowModel";
import { WIDGET_REGISTRY, hasSurface, widgetDefinition } from "./registry";

describe("panel registry", () => {
  it("has exactly one entry per registered id", () => {
    expect(Object.keys(WIDGET_REGISTRY).sort()).toEqual([...WIDGET_ORDER].sort());
    for (const id of WIDGET_ORDER) expect(WIDGET_REGISTRY[id].id).toBe(id);
  });

  it("every title and ref key exists in both dictionaries", () => {
    for (const id of WIDGET_ORDER) {
      for (const key of [WIDGET_REGISTRY[id].titleKey, WIDGET_REGISTRY[id].refKey]) {
        expect(dictionaries.en[key], `en:${key}`).toBeTruthy();
        expect(dictionaries["pt-BR"][key], `pt-BR:${key}`).toBeTruthy();
      }
    }
  });

  it("a ref is one word the console can parse after an @", () => {
    for (const id of WIDGET_ORDER) {
      const key = WIDGET_REGISTRY[id].refKey;
      for (const lang of ["en", "pt-BR"] as const) {
        expect(dictionaries[lang][key], `${lang}:${key}`).toMatch(/^[a-z0-9-]+$/);
      }
    }
  });

  it("the first composition gives every panel a usable window", () => {
    const layout = defaultWindows({ w: 1440, h: 704 });
    for (const id of WIDGET_ORDER) {
      expect(layout[id]!.w, `${id}.w`).toBeGreaterThanOrEqual(MIN_W);
      expect(layout[id]!.h, `${id}.h`).toBeGreaterThanOrEqual(MIN_H);
    }
  });

  it("every instrument can be expanded", () => {
    for (const id of WIDGET_ORDER) {
      expect(hasSurface(WIDGET_REGISTRY[id]), `${id} should be expandable`).toBe(true);
    }
    // An unknown id must not accidentally read as "no surface".
    expect(hasSurface(undefined)).toBe(true);
  });

  it("surface minimums are large enough to be honest", () => {
    for (const id of WIDGET_ORDER) {
      const def = WIDGET_REGISTRY[id];
      if (!def.surfaceMin) continue;
      expect(def.surfaceMin.w, `${id}.surfaceMin.w`).toBeGreaterThanOrEqual(320);
      expect(def.surfaceMin.h, `${id}.surfaceMin.h`).toBeGreaterThanOrEqual(200);
    }
  });

  it("resolves an id to its definition and nothing else", () => {
    expect(widgetDefinition("pulse")).toBe(WIDGET_REGISTRY.pulse);
    expect(widgetDefinition("today")).toBeUndefined();
    expect(widgetDefinition("nope")).toBeUndefined();
  });
});
