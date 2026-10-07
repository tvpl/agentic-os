import { z } from "zod";
import { BUILTIN_PROVIDER_IDS, ProviderId, EffortLevel } from "../config/schema.js";

export const SkillInputSchema = z.object({
  name: z.string().regex(/^[a-z][a-z0-9_]*$/),
  label: z.string(),
  type: z.enum(["text", "textarea", "path", "select"]).default("text"),
  required: z.boolean().default(false),
  placeholder: z.string().optional(),
  options: z.array(z.string()).optional(),
});
export type SkillInput = z.infer<typeof SkillInputSchema>;

const SkillI18nEntry = z.object({ name: z.string().optional(), description: z.string().optional() });

/**
 * Canonical UI language tag for a frontmatter key: `pt`, `pt_BR`, `PT-br`
 * → `pt-BR`; `en`, `en-US`, `en_gb` → `en`. Unknown tags are lower-cased with
 * their region upper-cased ("es-mx" → "es-MX").
 */
export function normalizeLangTag(raw: string): string {
  const [lang = "", region] = raw.trim().replace(/_/g, "-").split("-");
  const l = lang.toLowerCase();
  if (l === "pt") return "pt-BR";
  if (l === "en") return "en";
  return region ? `${l}-${region.toUpperCase()}` : l;
}

/**
 * Localized display name/description per UI language (e.g. "pt-BR"); the
 * canonical fields stay what providers receive. Tolerant on purpose: a typo in
 * a translation must never hide the whole skill from the catalog, so invalid
 * entries are dropped (and language tags normalized) instead of rejected.
 */
export const SkillI18nSchema = z.preprocess((raw) => {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return {};
  const out: Record<string, { name?: string; description?: string }> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!key.trim() || typeof value !== "object" || value === null || Array.isArray(value)) continue;
    // Field-level tolerance: keep the strings, drop anything else.
    const entry: { name?: string; description?: string } = {};
    const v = value as Record<string, unknown>;
    if (typeof v.name === "string" && v.name.trim()) entry.name = v.name;
    if (typeof v.description === "string" && v.description.trim()) entry.description = v.description;
    if (!entry.name && !entry.description) continue;
    const tag = normalizeLangTag(key);
    out[tag] = { ...out[tag], ...entry };
  }
  return out;
}, z.record(z.string(), SkillI18nEntry));
export type SkillI18n = z.infer<typeof SkillI18nSchema>;

export const SkillFrontmatterSchema = z.object({
  name: z.string(),
  slug: z.string().regex(/^[a-z0-9][a-z0-9-]*$/),
  description: z.string(),
  triggers: z.array(z.string()).default([]),
  inputs: z.array(SkillInputSchema).default([]),
  providers: z.array(ProviderId).default([...BUILTIN_PROVIDER_IDS]),
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
  i18n: SkillI18nSchema.optional(),
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
