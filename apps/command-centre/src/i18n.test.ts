import { describe, expect, it } from "vitest";
import { dictionaries, tf } from "./i18n";

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
});
