import { z } from "zod";
import { ProviderId, EffortLevel } from "../config/schema.js";

export const SkillInputSchema = z.object({
  name: z.string().regex(/^[a-z][a-z0-9_]*$/),
  label: z.string(),
  type: z.enum(["text", "textarea", "path", "select"]).default("text"),
  required: z.boolean().default(false),
  placeholder: z.string().optional(),
  options: z.array(z.string()).optional(),
});
export type SkillInput = z.infer<typeof SkillInputSchema>;

export const SkillFrontmatterSchema = z.object({
  name: z.string(),
  slug: z.string().regex(/^[a-z0-9][a-z0-9-]*$/),
  description: z.string(),
  triggers: z.array(z.string()).default([]),
  inputs: z.array(SkillInputSchema).default([]),
  providers: z.array(ProviderId).default(["claude", "cursor", "codex"]),
  recommendedModel: z.string().nullable().default(null),
  recommendedEffort: EffortLevel.default("default"),
  mode: z.enum(["read_only", "write"]).default("read_only"),
  /** Daily spend cap for runs of this skill in USD (0 = none). */
  budgetUsd: z.number().min(0).default(0),
  enabled: z.boolean().default(true),
  version: z.string().default("1.0.0"),
  changelog: z.array(z.string()).default([]),
  guardrails: z.array(z.string()).default([]),
  successCriteria: z.array(z.string()).default([]),
  examples: z.array(z.string()).default([]),
});
export type SkillFrontmatter = z.infer<typeof SkillFrontmatterSchema>;

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
