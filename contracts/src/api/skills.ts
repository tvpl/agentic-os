/** The skill catalog: what a skill is, how it is edited, run and published, and the marketplace. */
import { z } from "zod";
import { EffortLevel, ProviderId } from "../settings.js";
import { SkillFrontmatterSchema, SkillSchema } from "../skills.js";
import { IdParam, QueryFlag, RunTimeout, SlugParams, DeletedSchema, err, notFound } from "./common.js";
import { RunLaunchSchema } from "./runs.js";
import { binary, route } from "./route.js";

const SkillWithFavoriteSchema = SkillSchema.extend({ favorite: z.boolean() });

const NotesSchema = z.object({ notes: z.string(), path: z.string(), archived: z.number() });

const SaveBody = z.object({ frontmatter: SkillFrontmatterSchema, body: z.string().min(1) });

const RegistrySkillSchema = z.object({
  slug: z.string(),
  name: z.string(),
  description: z.string(),
  version: z.string(),
  /** The relative paths of the files the skill is made of (the digests stay in the registry). */
  files: z.array(z.string()),
  author: z.string().optional(),
  homepage: z.string().optional(),
  registry: z.string(),
  registryName: z.string(),
  /** Ed25519 signature outcome: true (valid), false (present but invalid), null (unsigned). */
  verified: z.boolean().nullable(),
  installed: z.boolean(),
});

const RunSkillBody = z.object({
  provider: ProviderId.optional(),
  model: z.string().nullable().optional(),
  effort: EffortLevel.optional(),
  inputs: z.record(z.string()).default({}),
  cwd: z.string().optional(),
  timeoutMs: RunTimeout.optional(),
});

const skillNotFound = notFound("The skill");

export const skillRoutes = {
  "skills.list": route({
    method: "GET",
    path: "/api/skills",
    summary: "Every skill of the catalog",
    tag: "skills",
    scope: "monitor",
    responses: { 200: z.array(SkillWithFavoriteSchema) },
  }),
  "skills.get": route({
    method: "GET",
    path: "/api/skills/:slug",
    summary: "One skill with its body and resources",
    tag: "skills",
    scope: "content",
    params: SlugParams,
    responses: { 200: SkillWithFavoriteSchema },
    errors: [skillNotFound],
  }),
  "skills.create": route({
    method: "POST",
    path: "/api/skills",
    summary: "Create a skill",
    tag: "skills",
    scope: "owner",
    body: SaveBody,
    responses: { 200: SkillSchema },
    errors: [err(409, "conflict", "A skill with this slug already exists")],
  }),
  "skills.update": route({
    method: "PUT",
    path: "/api/skills/:slug",
    summary: "Replace a skill's frontmatter and body (the slug in the body must be the one in the URL)",
    tag: "skills",
    scope: "owner",
    params: SlugParams,
    body: SaveBody,
    responses: { 200: SkillSchema },
    errors: [err(400, "bad_request", "The slug in the body is not the one in the URL"), skillNotFound],
  }),
  "skills.resource": route({
    method: "GET",
    path: "/api/skills/:slug/resource",
    summary: "One resource file of a skill folder, with a script-free content security policy",
    tag: "skills",
    scope: "content",
    queryToken: true,
    params: SlugParams,
    query: z.object({ rel: z.string().min(1).max(512), token: z.string().optional() }),
    responses: {
      200: binary(
        ["text/markdown", "text/html", "image/*", "application/pdf", "application/octet-stream"],
        "The file; a kind the panel cannot preview inline is offered as a download",
      ),
    },
    errors: [
      skillNotFound,
      err(404, "not_found", "The resource is not one the catalog listed"),
      err(413, "payload_too_large", "The resource is too large to preview"),
    ],
  }),
  "skills.notes.get": route({
    method: "GET",
    path: "/api/skills/:slug/notes",
    summary: "The agent notes of a skill (NOTES.md)",
    tag: "skills",
    scope: "content",
    params: SlugParams,
    responses: { 200: NotesSchema },
    errors: [skillNotFound],
  }),
  "skills.notes.append": route({
    method: "POST",
    path: "/api/skills/:slug/notes",
    summary: "Append a dated note",
    tag: "skills",
    scope: "owner",
    params: SlugParams,
    body: z.object({ text: z.string().trim().min(1).max(4000), runId: z.string().max(80).optional() }),
    responses: { 200: NotesSchema },
    errors: [skillNotFound],
  }),
  "skills.notes.promote": route({
    method: "POST",
    path: "/api/skills/:slug/notes/promote",
    summary:
      "Fold the notes into SKILL.md through a write run (parked for approval under review_before_write)",
    tag: "skills",
    scope: "owner",
    params: SlugParams,
    responses: { 200: RunLaunchSchema, 202: RunLaunchSchema },
    errors: [
      skillNotFound,
      err(400, "bad_request", "There are no notes to promote"),
      err(403, "profile_refused", "The security profile does not allow a write run"),
      err(409, "workspace_unavailable", "The skill folder cannot be used"),
      err(429, "too_many_requests", "The queue of runs is full"),
    ],
  }),
  "skills.toggle": route({
    method: "POST",
    path: "/api/skills/:slug/toggle",
    summary: "Enable or disable a skill",
    tag: "skills",
    scope: "owner",
    params: SlugParams,
    responses: { 200: SkillSchema },
    errors: [skillNotFound],
  }),
  "skills.favorite": route({
    method: "POST",
    path: "/api/skills/:slug/favorite",
    summary: "Mark or unmark a skill as a favorite",
    tag: "skills",
    scope: "owner",
    params: SlugParams,
    responses: { 200: z.object({ slug: z.string(), favorite: z.boolean() }) },
  }),
  "skills.delete": route({
    method: "DELETE",
    path: "/api/skills/:slug",
    summary: "Delete a skill folder",
    tag: "skills",
    scope: "owner",
    params: SlugParams,
    responses: { 200: DeletedSchema },
    errors: [skillNotFound],
  }),
  "skills.import": route({
    method: "POST",
    path: "/api/skills/import",
    summary: "Import a skill folder from inside the home or an indexed folder",
    tag: "skills",
    scope: "owner",
    body: z.object({ sourceDir: z.string().min(1), slug: IdParam.optional() }),
    responses: { 200: SkillSchema },
    errors: [
      err(
        400,
        "bad_request",
        "The source does not exist, is not a directory, has no SKILL.md or names no slug",
      ),
      err(
        400,
        "invalid_frontmatter",
        "The SKILL.md of the source is not a valid skill (frontmatter that is not valid, or that asks to run code)",
      ),
      err(413, "folder_too_large", "The source folder holds more files or bytes than a skill may"),
      err(409, "conflict", "A skill with this slug already exists"),
    ],
  }),
  "skills.registry": route({
    method: "GET",
    path: "/api/skills/registry",
    summary: "Every skill the configured registries offer",
    tag: "skills",
    scope: "owner",
    query: z.object({ refresh: QueryFlag }),
    responses: {
      200: z.object({
        registries: z.array(z.string()),
        errors: z.array(z.object({ registry: z.string(), error: z.string() })),
        skills: z.array(RegistrySkillSchema),
      }),
    },
  }),
  "skills.install": route({
    method: "POST",
    path: "/api/skills/install",
    summary: "Install a registry skill after every file's SHA-256 is verified",
    tag: "skills",
    scope: "owner",
    body: z.object({
      slug: IdParam,
      registry: z.string().url().optional(),
      force: z.boolean().default(false),
    }),
    responses: {
      200: z.object({
        installed: z.literal(true),
        skill: SkillSchema,
        version: z.string(),
        registry: z.string(),
      }),
    },
    errors: [
      err(400, "bad_request", "The registry is not configured"),
      err(400, "verification_failed", "A file of the skill failed its digest or could not be fetched"),
      err(404, "not_found", "The skill is not in the registries"),
      err(409, "conflict", "The skill is already installed: pass force to replace it"),
    ],
  }),
  "skills.run": route({
    method: "POST",
    path: "/api/skills/:slug/run",
    summary: "Run a skill headlessly (202 when a write waits for a human)",
    tag: "skills",
    scope: "run",
    params: SlugParams,
    body: RunSkillBody,
    bodyOptional: true,
    responses: { 200: RunLaunchSchema, 202: RunLaunchSchema },
    errors: [
      skillNotFound,
      err(400, "unknown_provider", "No adapter is registered for the provider"),
      err(
        400,
        "bad_request",
        "The skill is disabled, the provider is not enabled or not supported by the skill, or a required input is missing",
      ),
      err(403, "profile_refused", "The security profile does not allow a write run"),
      err(
        403,
        "device_provider_refused",
        "A paired device may start runs only on a provider that keeps reads in the working folder",
      ),
      err(409, "budget_exhausted", "The skill's daily budget is exhausted"),
      err(409, "workspace_unavailable", "The working folder cannot be used"),
      err(429, "too_many_requests", "The queue of runs is full"),
    ],
  }),
} as const;
