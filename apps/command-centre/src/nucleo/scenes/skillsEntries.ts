/**
 * A skill as the Skills scene sees it: localized, categorised, searchable.
 */
import type { Skill } from "../../api";
import { localizeSkill } from "../../views/Skills/localize";
import { categoryOf, type SectorItem } from "./skillsRing";
import type { MatchText } from "./skillsMatch";

export interface SkillEntry extends SectorItem {
  skill: Skill;
  description: string;
  text: MatchText;
}

export function toEntry(skill: Skill, lang: string): SkillEntry {
  const local = localizeSkill(skill, lang);
  const text: MatchText = {
    slug: skill.slug,
    names: [skill.name, local.name],
    triggers: skill.triggers ?? [],
    descriptions: [skill.description, local.description],
  };
  return {
    skill,
    slug: skill.slug,
    name: local.name || skill.slug,
    description: local.description,
    favorite: Boolean(skill.favorite),
    category: categoryOf(text),
    text,
  };
}
