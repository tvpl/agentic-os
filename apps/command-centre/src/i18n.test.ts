import { describe, expect, it } from "vitest";
import { dictionaries, ownKeys, plural, tf } from "./i18n";

describe("i18n dictionaries", () => {
  it("pt-BR and en carry exactly the same keys", () => {
    // The OWN keys of pt-BR: `dictionaries["pt-BR"]` starts from the English base, so it cannot miss a base key.
    expect([...ownKeys["pt-BR"]].sort()).toEqual([...ownKeys.en].sort());
  });

  it("the pt-BR dictionary the app reads still answers every key of en (the runtime fallback is unchanged)", () => {
    expect(Object.keys(dictionaries["pt-BR"]).sort()).toEqual(Object.keys(dictionaries.en).sort());
  });

  it("no value is empty", () => {
    for (const lang of ["en", "pt-BR"] as const) {
      for (const [k, v] of Object.entries(dictionaries[lang])) expect(v, `${lang}:${k}`).not.toBe("");
    }
  });

  it("interpolates placeholders", () => {
    expect(tf("en", "runs.count", { n: 3 })).toBe("3 run(s)");
    expect(tf("pt-BR", "desktop.board.more", { n: 2 })).toBe("+2 rotinas");
  });

  it("picks the plural form from n", () => {
    expect(tf("en", "desktop.console.turns", { n: 1 })).toBe("1 turn");
    expect(tf("en", "desktop.console.turns", { n: 2 })).toBe("2 turns");
    expect(tf("pt-BR", "desktop.console.turns", { n: 1 })).toBe("1 turno");
    expect(tf("pt-BR", "desktop.console.turns", { n: 0 })).toBe("0 turnos");
    // A bracket whose halves are words, not a letter: the form the pt-BR "{n} skill[ pronta|s prontas]" strings take.
    expect(plural("{n} skill[ pronta|s prontas] para executar", { n: 1 })).toBe(
      "{n} skill pronta para executar",
    );
    expect(plural("{n} skill[ pronta|s prontas] para executar", { n: 14 })).toBe(
      "{n} skills prontas para executar",
    );
  });

  it("leaves brackets alone when there is no count", () => {
    expect(plural("plain text", undefined)).toBe("plain text");
    expect(plural("{n} item[|s]", undefined)).toBe("{n} items");
    expect(plural("{done} run[done?|s], {failed} fail[failed?s|]", { done: 1, failed: 2 })).toBe(
      "{done} run, {failed} fail",
    );
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
