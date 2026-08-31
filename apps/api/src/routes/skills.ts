import path from "node:path";
import { z } from "zod";
import type { FastifyInstance } from "fastify";
import {
  ProviderId,
  EffortLevel,
  SkillFrontmatterSchema,
  resolveInsideRoots,
  type RunMode,
} from "@mordomo/core";
import type { AppContext } from "../context.js";

const RunSkillBody = z.object({
  provider: ProviderId.optional(),
  model: z.string().nullable().optional(),
  effort: EffortLevel.optional(),
  inputs: z.record(z.string()).default({}),
  cwd: z.string().optional(),
  timeoutMs: z.number().int().min(10_000).max(3_600_000).optional(),
});

export function registerSkillRoutes(app: FastifyInstance, ctx: AppContext): void {
  app.get("/api/skills", async () => {
    const favorites = new Set(ctx.settings().favoriteSkills);
    return ctx.skills.list().map((s) => ({ ...s, favorite: favorites.has(s.slug) }));
  });

  app.get("/api/skills/:slug", async (req) => {
    const { slug } = z.object({ slug: z.string() }).parse(req.params);
    const skill = ctx.skills.load(slug);
    if (!skill) throw Object.assign(new Error("Skill not found"), { statusCode: 404 });
    return { ...skill, favorite: ctx.settings().favoriteSkills.includes(slug) };
  });

  const SaveBody = z.object({ frontmatter: SkillFrontmatterSchema, body: z.string().min(1) });
  app.post("/api/skills", async (req) => {
    const { frontmatter, body } = SaveBody.parse(req.body);
    if (ctx.skills.load(frontmatter.slug)) {
      throw Object.assign(new Error(`Skill "${frontmatter.slug}" already exists`), { statusCode: 409 });
    }
    return ctx.skills.save(frontmatter, body);
  });

  app.put("/api/skills/:slug", async (req) => {
    const { slug } = z.object({ slug: z.string() }).parse(req.params);
    const { frontmatter, body } = SaveBody.parse(req.body);
    if (frontmatter.slug !== slug) {
      throw Object.assign(new Error("Slug in body must match URL"), { statusCode: 400 });
    }
    if (!ctx.skills.load(slug)) throw Object.assign(new Error("Skill not found"), { statusCode: 404 });
    return ctx.skills.save(frontmatter, body);
  });

  app.post("/api/skills/:slug/toggle", async (req) => {
    const { slug } = z.object({ slug: z.string() }).parse(req.params);
    const skill = ctx.skills.load(slug);
    if (!skill) throw Object.assign(new Error("Skill not found"), { statusCode: 404 });
    return ctx.skills.setEnabled(slug, !skill.enabled);
  });

  app.post("/api/skills/:slug/favorite", async (req) => {
    const { slug } = z.object({ slug: z.string() }).parse(req.params);
    const s = ctx.settings();
    const favorites = s.favoriteSkills.includes(slug)
      ? s.favoriteSkills.filter((f) => f !== slug)
      : [...s.favoriteSkills, slug];
    ctx.settingsStore.update({ favoriteSkills: favorites });
    return { slug, favorite: favorites.includes(slug) };
  });

  app.delete("/api/skills/:slug", async (req) => {
    const { slug } = z.object({ slug: z.string() }).parse(req.params);
    if (!ctx.skills.load(slug)) throw Object.assign(new Error("Skill not found"), { statusCode: 404 });
    ctx.skills.remove(slug);
    return { deleted: slug };
  });

  app.post("/api/skills/import", async (req) => {
    const { sourceDir, slug } = z.object({ sourceDir: z.string(), slug: z.string().optional() }).parse(req.body);
    return ctx.skills.importFrom(sourceDir, slug);
  });

  /**
   * Run a skill headlessly (the "button"). Returns immediately with the run id;
   * progress streams via /api/runs/:id/stream.
   */
  app.post("/api/skills/:slug/run", async (req) => {
    const { slug } = z.object({ slug: z.string() }).parse(req.params);
    const body = RunSkillBody.parse(req.body ?? {});
    const skill = ctx.skills.load(slug);
    if (!skill) throw Object.assign(new Error("Skill not found"), { statusCode: 404 });
    if (!skill.enabled) throw Object.assign(new Error("Skill is disabled"), { statusCode: 400 });

    const settings = ctx.settings();
    const provider = body.provider ?? settings.defaultProvider;
    if (!settings.providers[provider].enabled) {
      throw Object.assign(new Error(`Provider ${provider} is not enabled`), { statusCode: 400 });
    }
    if (!skill.providers.includes(provider)) {
      throw Object.assign(new Error(`Skill ${slug} does not support provider ${provider}`), { statusCode: 400 });
    }
    for (const input of skill.inputs) {
      if (input.required && !body.inputs[input.name]?.trim()) {
        throw Object.assign(new Error(`Missing required input: ${input.label}`), { statusCode: 400 });
      }
    }

    let cwd = ctx.paths.home;
    if (body.cwd) {
      const roots = [ctx.paths.home, ...settings.indexedFolders.filter((f) => f.enabled).map((f) => f.path)];
      cwd = resolveInsideRoots(roots, body.cwd);
    }
    const mode: RunMode = skill.mode === "write" ? "write" : "read_only";
    const run = ctx.runs.create({
      origin: "skill",
      provider,
      prompt: `(skill: ${slug})`,
      cwd,
      model: body.model !== undefined ? body.model : (skill.recommendedModel ?? settings.providers[provider].defaultModel),
      effort: body.effort ?? (skill.recommendedEffort !== "default" ? skill.recommendedEffort : settings.providers[provider].defaultEffort),
      mode,
      timeoutMs: body.timeoutMs ?? settings.limits.defaultTimeoutMs,
      profile: skill.mode === "write" ? settings.securityProfile : "read_only",
      skillSlug: slug,
    });
    const prompt = ctx.skills.buildRunPrompt(skill, body.inputs, path.join(ctx.paths.artifacts, run.id));
    void ctx.runs.execute(run.id, prompt, mode);
    return { runId: run.id, status: "queued" };
  });
}
