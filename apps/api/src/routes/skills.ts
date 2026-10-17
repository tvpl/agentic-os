import fs from "node:fs";
import path from "node:path";
import type { FastifyInstance } from "fastify";
import { statWorkspacePath } from "@mordomo/core/internal";
import type { AppContext } from "../context.js";
import { bind } from "../contract.js";
import { httpError, startedByOf } from "./common.js";

/** Previews stream at most this much (brand PDFs are a few MB; nothing in a skill should be bigger). */
const MAX_RESOURCE_BYTES = 25 * 1024 * 1024;

/** Inline styles/fonts/images from the same skill only; no scripts, no frames, no network. */
const RESOURCE_CSP =
  "default-src 'none'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; font-src 'self' data:; media-src 'self'; form-action 'none'; base-uri 'none'; sandbox";

export function registerSkillRoutes(app: FastifyInstance, ctx: AppContext): void {
  bind(app, "skills.list", async () => {
    const favorites = new Set(ctx.settings().favoriteSkills);
    return ctx.skills.list().map((s) => ({ ...s, favorite: favorites.has(s.slug) }));
  });

  bind(app, "skills.get", async ({ params: { slug } }) => {
    const skill = ctx.skills.load(slug);
    if (!skill) throw httpError(404, "Skill not found");
    return { ...skill, favorite: ctx.settings().favoriteSkills.includes(slug) };
  });

  bind(app, "skills.create", async ({ body: { frontmatter, body } }) => {
    if (ctx.skills.load(frontmatter.slug)) throw httpError(409, `Skill "${frontmatter.slug}" already exists`);
    return ctx.skills.save(frontmatter, body);
  });

  bind(app, "skills.update", async ({ params: { slug }, body: { frontmatter, body } }) => {
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
  bind(
    app,
    "skills.resource",
    async ({ params: { slug }, query: { rel } }, _req, reply) => {
      if (!ctx.skills.load(slug)) throw httpError(404, "Skill not found");
      // Opened through the safe-read primitive: the descriptor, not the path, is what gets streamed.
      const hit = ctx.skills.openResource(slug, rel);
      if (!hit) throw httpError(404, "Resource not found");
      if (hit.file.stat.size > MAX_RESOURCE_BYTES) {
        hit.file.close();
        throw httpError(413, "Resource too large to preview");
      }
      reply.header("content-type", hit.contentType);
      reply.header("cache-control", "private, no-store");
      // Anything the panel cannot preview inline is offered as a download.
      if (hit.resource.kind === "other" || hit.resource.kind === "pdf") {
        reply.header(
          "content-disposition",
          `${hit.resource.kind === "pdf" ? "inline" : "attachment"}; filename="${hit.resource.name.replace(/["\\\r\n]/g, "_")}"`,
        );
      }
      return reply.send(hit.file.createReadStream());
    },
    {
      // The route-level onSend runs after the server-wide security headers, so the resource policy wins.
      onSend: async (_req, reply, payload) => {
        reply.header("content-security-policy", RESOURCE_CSP);
        reply.header("x-frame-options", "SAMEORIGIN");
        reply.header("x-content-type-options", "nosniff");
        return payload;
      },
    },
  );

  /** Agent notes (Onda 4): a NOTES.md beside SKILL.md, read on every run, appended from run pages. */
  bind(app, "skills.notes.get", async ({ params: { slug } }) => {
    const out = ctx.skills.readNotes(slug);
    if (!out) throw httpError(404, "Skill not found");
    return out;
  });

  bind(app, "skills.notes.append", async ({ params: { slug }, body }) => {
    if (!ctx.skills.load(slug)) throw httpError(404, "Skill not found");
    return ctx.skills.appendNote(slug, body.text, {
      runId: body.runId,
      source: "command centre",
      max: ctx.settings().limits.skillNotesMax,
    });
  });

  /**
   * Promote notes into the skill: a write-mode run (parked for approval under
   * review_before_write) that folds recurring lessons into SKILL.md and moves
   * the applied entries to NOTES.archive.md.
   */
  bind(app, "skills.notes.promote", async ({ params: { slug } }, req, reply) => {
    const skill = ctx.skills.load(slug);
    if (!skill) throw httpError(404, "Skill not found");
    const notes = ctx.skills.readNotes(slug)!;
    if (!notes.notes.trim() || !/^- /m.test(notes.notes)) throw httpError(400, "No notes to promote");
    const prompt = [
      `Maintain the MordomoOS skill "${skill.name}" in ${skill.dir}.`,
      `Read ${notes.path} (lessons saved from runs) and ${skill.skillFile}.`,
      "Fold the lessons that recur or clearly last into SKILL.md — the procedure, guardrails or success criteria — with minimal edits, keeping SKILL.md under 60 lines and its frontmatter intact.",
      `Move every note you applied to ${ctx.skills.archiveFile(skill)} (append, keep the date, mark each one (promoted)); leave one-off notes in NOTES.md.`,
      "Do not touch any other file. Finish with a short summary of what changed.",
    ].join("\n");
    const started = ctx.execution.startPrompt(
      { prompt, mode: "write", cwd: skill.dir, startedBy: startedByOf(req) },
      {
        onError: (err, runId) => req.log.error({ err, runId, msg: "notes promotion run failed to execute" }),
      },
    );
    if (started.status === "waiting_approval") reply.code(202);
    return started;
  });

  bind(app, "skills.toggle", async ({ params: { slug } }) => {
    const skill = ctx.skills.load(slug);
    if (!skill) throw httpError(404, "Skill not found");
    return ctx.skills.setEnabled(slug, !skill.enabled);
  });

  bind(app, "skills.favorite", async ({ params: { slug } }) => {
    const s = ctx.settings();
    const favorites = s.favoriteSkills.includes(slug)
      ? s.favoriteSkills.filter((f) => f !== slug)
      : [...s.favoriteSkills, slug];
    ctx.settingsStore.update({ favoriteSkills: favorites });
    return { slug, favorite: favorites.includes(slug) };
  });

  bind(app, "skills.delete", async ({ params: { slug } }) => {
    if (!ctx.skills.load(slug)) throw httpError(404, "Skill not found");
    ctx.skills.remove(slug);
    return { deleted: slug };
  });

  /** Import a skill directory — only from inside the home or an enabled indexed folder. */
  bind(app, "skills.import", async ({ body: { sourceDir, slug } }) => {
    // The granted folders and the workspace filter, on the real path (PathAccessError → 403).
    let resolved: string;
    let stat: fs.Stats;
    try {
      ({ path: resolved, stat } = statWorkspacePath(ctx.readScope(), sourceDir));
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT")
        throw httpError(400, "Source directory does not exist");
      throw err;
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
    return ctx.skills.importFrom(resolved, finalSlug, ctx.scopeOf([resolved]));
  });

  /** Marketplace (plan Onda 3 §6): every skill the configured registries offer. */
  bind(app, "skills.registry", async ({ query: q }) => {
    // `?refresh=1` bypasses the 10-minute index cache (the modal's Refresh button).
    const registries = ctx.settings().marketplace.registries;
    const { entries, errors } = await ctx.skillRegistry.catalog(registries, { force: q.refresh === true });
    const installed = new Set(ctx.skills.list().map((s) => s.slug));
    return {
      registries,
      errors,
      skills: entries.map((e) => ({
        ...e,
        files: Object.keys(e.files),
        installed: installed.has(e.slug),
        verified: e.verified,
      })),
    };
  });

  /**
   * Install a registry skill: every file is downloaded and its SHA-256
   * verified before the catalog is touched; an existing skill is only
   * replaced with `force`, and then its folder is kept as a `.bak` first.
   */
  bind(app, "skills.install", async ({ body }) => {
    const registries = ctx.settings().marketplace.registries;
    const wanted = body.registry ? registries.filter((r) => r === body.registry) : registries;
    if (wanted.length === 0) throw httpError(400, "Registry is not configured");
    const { entries } = await ctx.skillRegistry.catalog(wanted);
    const entry = entries.find((e) => e.slug === body.slug);
    if (!entry) throw httpError(404, "Skill not found in the registries");
    const existing = ctx.skills.load(body.slug);
    if (existing && !body.force)
      throw httpError(409, `Skill "${body.slug}" already exists — pass force to replace it`);
    // A digest mismatch or unreachable file surfaces as a 502 with the reason
    // (the modal shows it); nothing has touched the catalog at that point.
    let staged: string;
    try {
      staged = await ctx.skillRegistry.stage(entry);
    } catch (err) {
      throw httpError(400, `Verification failed — ${(err as Error).message}`, "verification_failed");
    }
    try {
      if (existing) {
        const dir = path.join(ctx.paths.skills, body.slug);
        if (fs.existsSync(dir)) fs.renameSync(dir, `${dir}.bak-${Date.now()}`);
      }
      const skill = ctx.skills.importFrom(staged, body.slug);
      return { installed: true as const, skill, version: entry.version, registry: entry.registry };
    } finally {
      fs.rmSync(staged, { recursive: true, force: true });
    }
  });

  /**
   * Run a skill headlessly (the "button"). Returns immediately with the run id;
   * progress streams via /api/runs/:id/stream.
   */
  bind(app, "skills.run", async ({ params: { slug }, body }, req, reply) => {
    const started = ctx.execution.startSkill(
      { ...body, slug, startedBy: startedByOf(req) },
      { onError: (err, id) => req.log.error({ err, runId: id, msg: "skill run failed to execute" }) },
    );
    // 202 + the parked run row: the write is visible in Runs as `waiting_approval`.
    if (started.status === "waiting_approval") reply.code(202);
    return started;
  });
}
