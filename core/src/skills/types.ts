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
  enabled: z.boolean().default(true),
  version: z.string().default("1.0.0"),
  changelog: z.array(z.string()).default([]),
  guardrails: z.array(z.string()).default([]),
  successCriteria: z.array(z.string()).default([]),
  examples: z.array(z.string()).default([]),
});
export type SkillFrontmatter = z.infer<typeof SkillFrontmatterSchema>;

export interface Skill extends SkillFrontmatter {
  /** Markdown body of SKILL.md (the router / procedure). */
  body: string;
  dir: string;
  skillFile: string;
  resources: string[];
  bodyLineCount: number;
  thick: boolean;
}
