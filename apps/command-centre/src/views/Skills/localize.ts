import type { Skill } from "../../api";

/** The subset of a skill a display site needs: canonical text plus optional translations. */
export type LocalizableSkill = Pick<Skill, "name" | "description"> & { i18n?: Skill["i18n"] };

/**
 * Display name/description for `lang`, falling back per field to the canonical
 * frontmatter (which is what providers receive). Blank translations are ignored.
 */
export function localizeSkill(skill: LocalizableSkill, lang: string): { name: string; description: string } {
  const tr = skill.i18n?.[lang];
  return {
    name: tr?.name?.trim() ? tr.name : skill.name,
    description: tr?.description?.trim() ? tr.description : skill.description,
  };
}

/** Lower-cased canonical + localized text, so search matches either language. */
export function skillSearchText(skill: LocalizableSkill, lang: string): string {
  const loc = localizeSkill(skill, lang);
  return [skill.name, skill.description, loc.name, loc.description].join("\n").toLowerCase();
}
