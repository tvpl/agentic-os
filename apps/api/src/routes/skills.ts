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
import { gateWrite, grantedRoots, httpError, launchSkillRun, type SkillRunInput } from "./common.js";
import { IdParam, SlugParams } from "./params.js";

/** Previews stream at most this much (brand PDFs are a few MB; nothing in a skill should be bigger). */
const MAX_RESOURCE_BYTES = 25 * 1024 * 1024;

/** Inline styles/fonts/images from the same skill only; no scripts, no frames, no network. */
const RESOURCE_CSP =
  "default-src 'none'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; font-src 'self' data:; media-src 'self'; form-action 'none'; base-uri 'none'; sandbox";

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

  /**
   * Serve one resource file from inside a skill folder (brand HTML, images,
   * PDFs, reference markdown). Only files the catalog scan listed are
   * served — never SKILL.md, symlinks, hidden files or anything outside the
   * folder — with an explicit content type and `nosniff`.
   *
   * The route-level `onSend` runs after the server-wide security headers, so
   * it is where the resource CSP wins: a script-free, network-free, sandboxed
   * policy, plus `X-Frame-Options: SAMEORIGIN` so the panel can show an HTML
   * resource in its own sandboxed iframe (the global `DENY` would block it).
   */
  app.get(
    "/api/skills/:slug/resource",
    {
      onSend: async (_req, reply, payload) => {
        reply.header("content-security-policy", RESOURCE_CSP);
        reply.header("x-frame-options", "SAMEORIGIN");
        reply.header("x-content-type-options", "nosniff");
        return payload;
      },
    },
    async (req, reply) => {
      const { slug } = SlugParams.parse(req.params);
      const { rel } = z.object({ rel: z.string().min(1).max(512) }).parse(req.query ?? {});
      if (!ctx.skills.load(slug)) throw httpError(404, "Skill not found");
      const hit = ctx.skills.resolveResource(slug, rel);
      if (!hit) throw httpError(404, "Resource not found");
      let stat: fs.Stats;
      try {
        stat = fs.statSync(hit.absPath);
      } catch {
        throw httpError(404, "Resource not found");
      }
      if (!stat.isFile()) throw httpError(404, "Resource not found");
      if (stat.size > MAX_RESOURCE_BYTES) throw httpError(413, "Resource too large to preview");
      reply.header("content-type", hit.contentType);
      reply.header("cache-control", "private, no-store");
      // Anything the panel cannot preview inline is offered as a download.
      if (hit.resource.kind === "other" || hit.resource.kind === "pdf") {
        reply.header(
          "content-disposition",
          `${hit.resource.kind === "pdf" ? "inline" : "attachment"}; filename="${hit.resource.name.replace(/["\\\r\n]/g, "_")}"`,
        );
      }
      return reply.send(fs.createReadStream(hit.absPath));
    },
  );

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
    const { sourceDir, slug } = z
      .object({ sourceDir: z.string().min(1), slug: IdParam.optional() })
      .parse(req.body);
    const resolved = resolveInsideRoots(grantedRoots(ctx), sourceDir); // PathAccessError → 403
    let stat: fs.Stats;
    try {
      stat = fs.statSync(resolved);
    } catch {
      throw httpError(400, "Source directory does not exist");
    }
    if (!stat.isDirectory()) throw httpError(400, "Source must be a directory");
    if (!fs.existsSync(path.join(resolved, "SKILL.md")))
      throw httpError(400, "No SKILL.md found in the source directory");
    const finalSlug = (slug ?? path.basename(resolved))
      .toLowerCase()
      .replace(/[^a-z0-9-]+/g, "-")
      .replace(/^-+|-+$/g, "");
    if (!finalSlug) throw httpError(400, "Cannot derive a slug from the source directory name");
    if (ctx.skills.load(finalSlug))
      throw httpError(409, `Skill "${finalSlug}" already exists in the catalog`);
    return ctx.skills.importFrom(resolved, finalSlug);
  });

  /** Marketplace (plan Onda 3 §6): every skill the configured registries offer. */
  app.get("/api/skills/registry", async () => {
    const registries = ctx.settings().marketplace.registries;
    const { entries, errors } = await ctx.skillRegistry.catalog(registries);
    const installed = new Set(ctx.skills.list().map((s) => s.slug));
    return {
      registries,
      errors,
      skills: entries.map((e) => ({ ...e, files: Object.keys(e.files), installed: installed.has(e.slug) })),
    };
  });

  /**
   * Install a registry skill: every file is downloaded and its SHA-256
   * verified before the catalog is touched; an existing skill is only
   * replaced with `force`, and then its folder is kept as a `.bak` first.
   */
  app.post("/api/skills/install", async (req) => {
    const body = z
      .object({ slug: IdParam, registry: z.string().url().optional(), force: z.boolean().default(false) })
      .parse(req.body);
    const registries = ctx.settings().marketplace.registries;
    const wanted = body.registry ? registries.filter((r) => r === body.registry) : registries;
    if (wanted.length === 0) throw httpError(400, "Registry is not configured");
    const { entries } = await ctx.skillRegistry.catalog(wanted);
    const entry = entries.find((e) => e.slug === body.slug);
    if (!entry) throw httpError(404, "Skill not found in the registries");
    const existing = ctx.skills.load(body.slug);
    if (existing && !body.force)
      throw httpError(409, `Skill "${body.slug}" already exists — pass force to replace it`);
    const staged = await ctx.skillRegistry.stage(entry);
    try {
      if (existing) {
        const dir = path.join(ctx.paths.skills, body.slug);
        if (fs.existsSync(dir)) fs.renameSync(dir, `${dir}.bak-${Date.now()}`);
      }
      const skill = ctx.skills.importFrom(staged, body.slug);
      return { installed: true, skill, version: entry.version, registry: entry.registry };
    } finally {
      fs.rmSync(staged, { recursive: true, force: true });
    }
  });

  /**
   * Run a skill headlessly (the "button"). Returns immediately with the run id;
   * progress streams via /api/runs/:id/stream.
   */
  app.post("/api/skills/:slug/run", async (req, reply) => {
    const { slug } = SlugParams.parse(req.params);
    const body = RunSkillBody.parse(req.body ?? {});
    const skill = ctx.skills.load(slug);
    if (!skill) throw httpError(404, "Skill not found");
    if (!skill.enabled) throw httpError(400, "Skill is disabled");

    const settings = ctx.settings();
    const provider = body.provider ?? settings.defaultProvider;
    if (!settings.providers[provider].enabled) throw httpError(400, `Provider ${provider} is not enabled`);
    if (!skill.providers.includes(provider))
      throw httpError(400, `Skill ${slug} does not support provider ${provider}`);
    for (const input of skill.inputs) {
      if (input.required && !body.inputs[input.name]?.trim()) {
        throw httpError(400, `Missing required input: ${input.label}`);
      }
    }

    const cwd = body.cwd ? resolveInsideRoots(grantedRoots(ctx), body.cwd) : ctx.paths.home;
    const mode: RunMode = skill.mode === "write" ? "write" : "read_only";
    const input: SkillRunInput = {
      slug,
      inputs: body.inputs,
      provider,
      model:
        body.model !== undefined
          ? body.model
          : (skill.recommendedModel ?? settings.providers[provider].defaultModel),
      effort:
        body.effort ??
        (skill.recommendedEffort !== "default"
          ? skill.recommendedEffort
          : settings.providers[provider].defaultEffort),
      cwd,
      timeoutMs: body.timeoutMs ?? settings.limits.defaultTimeoutMs,
    };
    const gate = gateWrite(ctx, mode, "skill", `Write-mode skill run: /${slug} with ${provider}`, {
      kind: "skill",
      input,
    });
    if (gate.pendingApproval) {
      // 202 + the parked run row: the write is visible in Runs as `waiting_approval`.
      reply.code(202);
      return { runId: gate.runId, status: "waiting_approval", pendingApproval: gate.pendingApproval };
    }
    const { runId } = launchSkillRun(ctx, input, (err, id) =>
      req.log.error({ err, runId: id, msg: "skill run failed to execute" }),
    );
    return { runId, status: "queued" };
  });
}
