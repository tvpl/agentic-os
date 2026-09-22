import { describe, expect, it } from "vitest";
import { dictionaries, plural, tf } from "./i18n";

describe("i18n dictionaries", () => {
  it("pt-BR and en carry exactly the same keys", () => {
    const en = Object.keys(dictionaries.en).sort();
    const pt = Object.keys(dictionaries["pt-BR"]).sort();
    expect(pt).toEqual(en);
  });

  it("no value is empty", () => {
    for (const lang of ["en", "pt-BR"] as const) {
      for (const [k, v] of Object.entries(dictionaries[lang])) expect(v, `${lang}:${k}`).not.toBe("");
    }
  });

  it("interpolates placeholders", () => {
    expect(tf("en", "runs.count", { n: 3 })).toBe("3 run(s)");
    expect(tf("pt-BR", "widget.more", { n: 2 })).toBe("mais 2");
  });

  it("picks the plural form from n", () => {
    expect(tf("en", "desktop.console.turns", { n: 1 })).toBe("1 turn");
    expect(tf("en", "desktop.console.turns", { n: 2 })).toBe("2 turns");
    expect(tf("pt-BR", "desktop.console.turns", { n: 1 })).toBe("1 turno");
    expect(tf("pt-BR", "desktop.console.turns", { n: 0 })).toBe("0 turnos");
    expect(tf("pt-BR", "desktop.pods.skills", { n: 1 })).toBe("1 skill pronta para executar");
    expect(tf("pt-BR", "desktop.pods.skills", { n: 14 })).toBe("14 skills prontas para executar");
  });

  it("leaves brackets alone when there is no count", () => {
    expect(plural("plain text", undefined)).toBe("plain text");
    expect(plural("{n} item[|s]", undefined)).toBe("{n} items");
  });

  it("no plural key still uses the (s) shortcut in the desktop locale", () => {
    for (const lang of ["en", "pt-BR"] as const) {
      for (const [key, value] of Object.entries(dictionaries[lang])) {
        if (!key.startsWith("desktop.")) continue;
        expect(value, `${lang} ${key}`).not.toMatch(/\(s\)|\(es\)/);
      }
    }
  });
});
