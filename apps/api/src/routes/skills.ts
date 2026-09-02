import fs from "node:fs";
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
import { grantedRoots, httpError } from "./common.js";
import { IdParam, SlugParams } from "./params.js";

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
    const { slug } = SlugParams.parse(req.params);
    const skill = ctx.skills.load(slug);
    if (!skill) throw httpError(404, "Skill not found");
    return { ...skill, favorite: ctx.settings().favoriteSkills.includes(slug) };
  });

  const SaveBody = z.object({ frontmatter: SkillFrontmatterSchema, body: z.string().min(1) });
  app.post("/api/skills", async (req) => {
    const { frontmatter, body } = SaveBody.parse(req.body);
    if (ctx.skills.load(frontmatter.slug)) throw httpError(409, `Skill "${frontmatter.slug}" already exists`);
    return ctx.skills.save(frontmatter, body);
  });

  app.put("/api/skills/:slug", async (req) => {
    const { slug } = SlugParams.parse(req.params);
    const { frontmatter, body } = SaveBody.parse(req.body);
    if (frontmatter.slug !== slug) throw httpError(400, "Slug in body must match URL");
    if (!ctx.skills.load(slug)) throw httpError(404, "Skill not found");
    return ctx.skills.save(frontmatter, body);
  });

  app.post("/api/skills/:slug/toggle", async (req) => {
    const { slug } = SlugParams.parse(req.params);
    const skill = ctx.skills.load(slug);
    if (!skill) throw httpError(404, "Skill not found");
    return ctx.skills.setEnabled(slug, !skill.enabled);
  });

  app.post("/api/skills/:slug/favorite", async (req) => {
    const { slug } = SlugParams.parse(req.params);
    const s = ctx.settings();
    const favorites = s.favoriteSkills.includes(slug)
      ? s.favoriteSkills.filter((f) => f !== slug)
      : [...s.favoriteSkills, slug];
    ctx.settingsStore.update({ favoriteSkills: favorites });
    return { slug, favorite: favorites.includes(slug) };
  });

  app.delete("/api/skills/:slug", async (req) => {
    const { slug } = SlugParams.parse(req.params);
    if (!ctx.skills.load(slug)) throw httpError(404, "Skill not found");
    ctx.skills.remove(slug);
    return { deleted: slug };
  });

  /** Import a skill directory — only from inside the home or an enabled indexed folder. */
  app.post("/api/skills/import", async (req) => {
    const { sourceDir, slug } = z.object({ sourceDir: z.string().min(1), slug: IdParam.optional() }).parse(req.body);
    const resolved = resolveInsideRoots(grantedRoots(ctx), sourceDir); // PathAccessError → 403
    let stat: fs.Stats;
    try {
      stat = fs.statSync(resolved);
    } catch {
      throw httpError(400, "Source directory does not exist");
    }
    if (!stat.isDirectory()) throw httpError(400, "Source must be a directory");
    if (!fs.existsSync(path.join(resolved, "SKILL.md"))) throw httpError(400, "No SKILL.md found in the source directory");
    const finalSlug = (slug ?? path.basename(resolved)).toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "");
    if (!finalSlug) throw httpError(400, "Cannot derive a slug from the source directory name");
    if (ctx.skills.load(finalSlug)) throw httpError(409, `Skill "${finalSlug}" already exists in the catalog`);
    return ctx.skills.importFrom(resolved, finalSlug);
  });

  /**
   * Run a skill headlessly (the "button"). Returns immediately with the run id;
   * progress streams via /api/runs/:id/stream.
   */
  app.post("/api/skills/:slug/run", async (req) => {
    const { slug } = SlugParams.parse(req.params);
    const body = RunSkillBody.parse(req.body ?? {});
    const skill = ctx.skills.load(slug);
    if (!skill) throw httpError(404, "Skill not found");
    if (!skill.enabled) throw httpError(400, "Skill is disabled");

    const settings = ctx.settings();
    const provider = body.provider ?? settings.defaultProvider;
    if (!settings.providers[provider].enabled) throw httpError(400, `Provider ${provider} is not enabled`);
    if (!skill.providers.includes(provider)) throw httpError(400, `Skill ${slug} does not support provider ${provider}`);
    for (const input of skill.inputs) {
      if (input.required && !body.inputs[input.name]?.trim()) {
        throw httpError(400, `Missing required input: ${input.label}`);
      }
    }

    const cwd = body.cwd ? resolveInsideRoots(grantedRoots(ctx), body.cwd) : ctx.paths.home;
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
    ctx.runs.execute(run.id, prompt, mode).catch((err: unknown) => {
      req.log.error({ err, runId: run.id, msg: "skill run failed to execute" });
    });
    return { runId: run.id, status: "queued" };
  });
}
