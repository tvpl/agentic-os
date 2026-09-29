import { describe, expect, it } from "vitest";
import { localizeSkill, skillSearchText } from "./localize";

const base = { name: "Code Review", description: "Review a diff for bugs." };

describe("localizeSkill", () => {
  it("returns the canonical fields when there is no translation", () => {
    expect(localizeSkill(base, "pt-BR")).toEqual(base);
    expect(localizeSkill({ ...base, i18n: {} }, "pt-BR")).toEqual(base);
    expect(localizeSkill({ ...base, i18n: { en: { name: "X" } } }, "pt-BR")).toEqual(base);
  });

  it("picks the requested language and falls back per field", () => {
    const skill = { ...base, i18n: { "pt-BR": { name: "Revisão de Código" } } };
    expect(localizeSkill(skill, "pt-BR")).toEqual({
      name: "Revisão de Código",
      description: base.description,
    });
    expect(localizeSkill(skill, "en")).toEqual(base);
    const full = {
      ...base,
      i18n: { "pt-BR": { name: "Revisão de Código", description: "Revisa um diff." } },
    };
    expect(localizeSkill(full, "pt-BR")).toEqual({
      name: "Revisão de Código",
      description: "Revisa um diff.",
    });
  });

  it("ignores blank translations", () => {
    expect(localizeSkill({ ...base, i18n: { "pt-BR": { name: "  ", description: "" } } }, "pt-BR")).toEqual(
      base,
    );
  });

  it("search text covers both canonical and localized strings", () => {
    const skill = {
      ...base,
      i18n: { "pt-BR": { name: "Revisão de Código", description: "Revisa um diff." } },
    };
    const text = skillSearchText(skill, "pt-BR");
    expect(text).toContain("code review");
    expect(text).toContain("revisão de código");
    expect(text).toContain("revisa um diff.");
    expect(skillSearchText(skill, "en")).not.toContain("revisão");
  });
});
