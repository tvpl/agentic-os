/**
 * @vitest-environment jsdom
 * The registry is imported for its metadata only (no rendering), but the
 * widgets it pulls in reach `document` at module scope, hence jsdom.
 */
import { describe, expect, it } from "vitest";
import { dictionaries } from "../i18n";
import { addableWidgets } from "./AddWidgetGallery";
import { WIDGET_ORDER } from "./defaultLayout";
import { defaultWindows } from "./defaultWindows";
import { MIN_H, MIN_W } from "./windowModel";
import { WIDGET_REGISTRY, defaultConfig, hasSurface, widgetDefinition } from "./registry";

describe("widget registry", () => {
  it("has exactly one entry per registered widget id", () => {
    expect(Object.keys(WIDGET_REGISTRY).sort()).toEqual([...WIDGET_ORDER].sort());
    for (const id of WIDGET_ORDER) expect(WIDGET_REGISTRY[id].id).toBe(id);
  });

  it("every title key exists in both dictionaries", () => {
    for (const id of WIDGET_ORDER) {
      const key = WIDGET_REGISTRY[id].titleKey;
      expect(dictionaries.en[key], `en:${key}`).toBeTruthy();
      expect(dictionaries["pt-BR"][key], `pt-BR:${key}`).toBeTruthy();
    }
  });

  it("the first composition gives every widget a usable window", () => {
    const layout = defaultWindows({ w: 1440, h: 704 });
    for (const id of WIDGET_ORDER) {
      expect(layout[id]!.w, `${id}.w`).toBeGreaterThanOrEqual(MIN_W);
      expect(layout[id]!.h, `${id}.h`).toBeGreaterThanOrEqual(MIN_H);
    }
  });

  it("config schemas have unique keys, translated labels and typed defaults", () => {
    for (const id of WIDGET_ORDER) {
      const schema = WIDGET_REGISTRY[id].configSchema ?? [];
      expect(new Set(schema.map((f) => f.key)).size).toBe(schema.length);
      for (const field of schema) {
        expect(
          dictionaries.en[field.labelKey as keyof typeof dictionaries.en],
          `${id}.${field.key}`,
        ).toBeTruthy();
        if (field.kind === "number") expect(field.default).toBeGreaterThanOrEqual(field.min);
        if (field.kind === "number") expect(field.default).toBeLessThanOrEqual(field.max);
        if (field.kind === "select") expect(field.options.map((o) => o.value)).toContain(field.default);
        if (field.kind === "toggle") expect(typeof field.default).toBe("boolean");
      }
    }
  });

  it("defaultConfig collects every declared default", () => {
    expect(defaultConfig(WIDGET_REGISTRY.today)).toMatchObject({
      analog: true,
      seconds: true,
      zone1: "America/Los_Angeles",
    });
    expect(defaultConfig(WIDGET_REGISTRY.cost)).toEqual({});
    expect(defaultConfig(undefined)).toEqual({});
  });

  it("declares a surface for every widget whose expansion adds something", () => {
    // The clock is the exception the contract exists for: the time is the
    // whole datum, so it must not offer an expand control.
    expect(hasSurface(WIDGET_REGISTRY.today)).toBe(false);
    for (const id of WIDGET_ORDER) {
      if (id === "today") continue;
      expect(hasSurface(WIDGET_REGISTRY[id]), `${id} should be expandable`).toBe(true);
    }
    // An unknown id must not accidentally read as "no surface".
    expect(hasSurface(undefined)).toBe(true);
  });

  it("surface minimums are large enough to be honest and fit the grid box", () => {
    for (const id of WIDGET_ORDER) {
      const def = WIDGET_REGISTRY[id];
      if (!def.surfaceMin) continue;
      expect(hasSurface(def), `${id} declares a surfaceMin but no surface`).toBe(true);
      // Smaller than this and the "expanded" view is just the compact one.
      expect(def.surfaceMin.w, `${id}.surfaceMin.w`).toBeGreaterThanOrEqual(320);
      expect(def.surfaceMin.h, `${id}.surfaceMin.h`).toBeGreaterThanOrEqual(200);
    }
  });

  it("resolves duplicate instance ids back to their base definition", () => {
    expect(widgetDefinition("today:2")).toBe(WIDGET_REGISTRY.today);
    expect(widgetDefinition("today")).toBe(WIDGET_REGISTRY.today);
    expect(widgetDefinition("nope")).toBeUndefined();
  });

  it("the add gallery offers hidden widgets and duplicates of visible duplicable ones", () => {
    const layout = defaultWindows({ w: 1440, h: 704 });
    const options = addableWidgets(layout);
    const ids = options.map((o) => o.id);
    // `inbox` ships hidden, `today` ships visible and is duplicable.
    expect(ids).toContain("inbox");
    expect(ids).toContain("today:2");
    // `deck` is visible and not duplicable: it must not be offered.
    expect(ids).not.toContain("deck");
    expect(options.find((o) => o.id === "today:2")?.duplicate).toBe(true);
  });
});
