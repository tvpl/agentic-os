/**
 * The skill frontmatter lives in `@mordomo/contracts` (the API describes it in its route table and the interface
 * edits it); the core re-exports it so every existing importer keeps working. What stays here is the loaded skill.
 */
export {
  SkillFrontmatterSchema,
  SkillI18nSchema,
  SkillInputSchema,
  normalizeLangTag,
  type SkillFrontmatter,
  type SkillI18n,
  type SkillInput,
} from "@mordomo/contracts";
import type { SkillFrontmatter } from "@mordomo/contracts";


export type SkillResourceKind = "markdown" | "html" | "image" | "pdf" | "other";

/** One file inside the skill folder other than SKILL.md (brand HTML, images, PDFs, reference markdown…). */
export interface SkillResource {
  /** Basename, e.g. "brand.html". */
  name: string;
  /** Path relative to the skill folder, POSIX separators, e.g. "resources/brand.html". */
  rel: string;
  kind: SkillResourceKind;
  /** Size in bytes. */
  size: number;
}

export interface Skill extends SkillFrontmatter {
  /**
   * The skill works on the second brain: a run of it is given `memory/` and a credential of its own for the memory
   * routes of the local API. NOT read from the SKILL.md (an agent, a paired device or an imported folder can write
   * that file): it is true when the owner's settings (`memorySkills`) name the folder's slug.
   */
  memoryAccess: boolean;
  /** Markdown body of SKILL.md (the router / procedure). */
  body: string;
  dir: string;
  skillFile: string;
  /** Relative paths of every resource file (legacy flat list; same order as `resourceFiles`). */
  resources: string[];
  /** Rich resource entries (kind + size), capped at MAX_SKILL_RESOURCES, symlinks excluded. */
  resourceFiles: SkillResource[];
  bodyLineCount: number;
  thick: boolean;
}
