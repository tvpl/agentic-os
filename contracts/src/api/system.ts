/** The service itself: information, health, settings, providers, approvals, backups, sync and the artifact gallery. */
import { z } from "zod";
import { UI_PREFERENCE_KEYS, UiPreferencesSchema } from "../preferences.js";
import { EffortLevel, ProviderId, ProviderSettingsSchema, SettingsSchema } from "../settings.js";
import { BackupNameParams, UuidParams, err, notFound, settingsWriteErrors } from "./common.js";
import { ContextQuery, contextNotFound, contextUnavailable } from "./contexts.js";
import { CONTEXT_ID } from "../workContext.js";
import { binary, route } from "./route.js";
import {
  ApprovalSchema,
  BackupInfoSchema,
  MetricsSampleSchema,
  ProviderCapabilitiesSchema,
  RunMetricsSchema,
  RunRecordSchema,
  TestedVersionsSchema,
  VersionStatusSchema,
} from "./wire.js";
import { RoutineStatusSchema } from "../routines.js";

// ---- schemas ---------------------------------------------------------------------------------------------------

export const SettingsPatchSchema = SettingsSchema.partial().extend({
  providers: z.record(ProviderId, ProviderSettingsSchema.partial()).optional(),
  limits: SettingsSchema.shape.limits.removeDefault().partial().optional(),
});

export type SettingsPatch = z.infer<typeof SettingsPatchSchema>;

export const UiPreferencesPatchSchema = UiPreferencesSchema.partial().extend({
  /** Strict on write: an unknown shell is refused, not read back as the default. */
  shell: UiPreferencesSchema.shape.shell.removeCatch().optional(),
  /** The layout this writer started from; a different stored layout means another window saved first. */
  dashboardLayoutBase: UiPreferencesSchema.shape.dashboardLayout.removeDefault().optional(),
  /**
   * Strict on write (.specs/features/cerebro-contextos, door 5): the shape of a context id or `null`; a stored value
   * this version cannot read is still read back as `null`.
   */
  activeContext: z.string().regex(CONTEXT_ID, "the id of a work context").nullable().optional(),
});

const BuildStatusSchema = z.object({ installedAt: z.number(), startedAt: z.number(), stale: z.boolean() });

const SystemInfoSchema = z.object({
  version: z.string(),
  home: z.string(),
  packaged: z.boolean(),
  entry: z.string(),
  node: z.string(),
  execPath: z.string(),
  platform: z.string(),
  arch: z.string(),
  pid: z.number(),
  startedAt: z.number(),
  serviceInstalled: z.boolean(),
  releases: z.string(),
  build: BuildStatusSchema,
  siblings: z.array(z.object({ pid: z.number(), command: z.string() })),
});

const UpdateStatusSchema = z.object({
  current: z.string(),
  latest: z.string().nullable(),
  url: z.string(),
  upToDate: z.boolean().nullable(),
  checkedAt: z.number(),
  error: z.string().nullable(),
});

const MetaSchema = z.object({
  name: SettingsSchema.shape.systemName,
  theme: SettingsSchema.shape.theme,
  accentColor: SettingsSchema.shape.accentColor,
  language: SettingsSchema.shape.language,
  setupCompleted: z.boolean(),
  version: z.string(),
  apiVersion: z.number(),
  tls: z.object({ port: z.number(), fingerprint: z.string(), hosts: z.array(z.string()) }).nullable(),
  build: BuildStatusSchema,
  entry: z.string(),
});

export const RestorePendingSchema = z.object({
  name: z.string(),
  stagedAt: z.number(),
  stagedPath: z.string(),
});

const HealthSchema = z.object({
  ok: z.literal(true),
  uptimeMs: z.number(),
  version: z.string(),
  db: z.object({ open: z.literal(true), path: z.string() }),
  scheduler: z.object({ running: z.boolean() }),
  activeRuns: z.number(),
  queuedRuns: z.number(),
  pendingApprovals: z.number(),
  lastEventId: z.number(),
  restorePending: RestorePendingSchema.nullable(),
});

const HealthStatusSchema = z.object({
  ok: z.boolean(),
  installed: z.boolean(),
  authenticated: z.union([z.boolean(), z.literal("unknown")]),
  version: z.string().nullable(),
  detail: z.string(),
  checkedAt: z.number(),
});

const ProviderSnapshotSchema = z.object({
  id: ProviderId,
  displayName: z.string(),
  capabilities: ProviderCapabilitiesSchema,
  installHint: z.string(),
  loginCommand: z.string(),
  enabled: z.boolean(),
  isDefault: z.boolean(),
  health: HealthStatusSchema,
  installedVersion: z.string().nullable(),
  versionStatus: VersionStatusSchema,
  testedVersions: TestedVersionsSchema.nullable(),
  defaultModel: z.string().nullable(),
  defaultEffort: EffortLevel,
});

const ModelOptionSchema = z.object({
  id: z.string(),
  label: z.string(),
  recommendedFor: z.string().optional(),
  aliases: z.array(z.string()).optional(),
});

const DetectionResultSchema = z.object({
  installed: z.boolean(),
  binaryPath: z.string().nullable(),
  version: z.string().nullable(),
  supportedFlags: z.array(z.string()),
  notes: z.array(z.string()),
});

const AuthStatusSchema = z.object({
  authenticated: z.union([z.boolean(), z.literal("unknown")]),
  method: z.string().nullable(),
  detail: z.string(),
});

const DoctorCheckSchema = z.object({
  id: z.string(),
  label: z.string(),
  status: z.enum(["ok", "warn", "fail", "skip"]),
  detail: z.string(),
});

export const DoctorReportSchema = z.object({
  checks: z.array(DoctorCheckSchema),
  ok: z.number(),
  warn: z.number(),
  fail: z.number(),
  generatedAt: z.number(),
});

const DailyPointSchema = z.object({
  day: z.string(),
  spendUsd: z.number(),
  tokens: z.number(),
  runs: z.number(),
  failed: z.number(),
  inboxUnread: z.number(),
  approvalsPending: z.number(),
  approvalWaitAvgMs: z.number().nullable(),
  samples: z.number(),
});

const SyncActionSchema = z.object({
  filePath: z.string(),
  kind: z.enum(["create", "update", "unchanged", "conflict"]),
  provider: z.string(),
  reason: z.string(),
  diff: z.string().nullable(),
  newContent: z.string(),
});

const SyncPlanSchema = z.object({
  targetDir: z.string(),
  actions: z.array(SyncActionSchema),
  conflicts: z.number(),
});

const SyncApplyResultSchema = z.object({
  written: z.array(z.string()),
  skippedConflicts: z.array(z.string()),
  backupDir: z.string().nullable(),
});

export const ArtifactListItemSchema = z.object({
  id: z.string(),
  file: z.string(),
  path: z.string(),
  runId: z.string().nullable(),
  skillSlug: z.string().nullable(),
  createdAt: z.number(),
  kind: z.enum(["image", "video", "html", "markdown", "code", "other"]),
  title: z.string(),
  folder: z.string(),
  sizeBytes: z.number(),
  thumbnail: z.boolean(),
});

const StartupServicePlanSchema = z.object({
  platform: z.enum(["linux", "darwin", "win32", "unsupported"]),
  files: z.array(z.object({ path: z.string(), content: z.string() })),
  installCommands: z.array(z.string()),
  uninstallCommands: z.array(z.string()),
  installArgv: z.array(z.array(z.string())),
  uninstallArgv: z.array(z.array(z.string())),
  notes: z.array(z.string()),
});

const DiagnosticsBundleSchema = z.object({
  generatedAt: z.string(),
  version: z.string(),
  platform: z.object({ os: z.string(), arch: z.string(), node: z.string() }),
  /** The settings with every secret replaced by the redactor; the shape is `Settings`, so only the outline is stated. */
  settings: z.record(z.unknown()),
  doctor: DoctorReportSchema,
  metrics: RunMetricsSchema,
  recentRuns: z.array(RunRecordSchema),
  routines: z.array(RoutineStatusSchema),
  contains: z.string(),
});

/** The question an agent asked and the user answered, question text to answer. */
const ResolveBodySchema = z.object({
  decision: z.enum(["approved", "denied"]),
  answers: z.record(z.string().max(4000)).optional(),
});

const ToolApprovalBodySchema = z.object({
  runId: z.string().uuid(),
  toolName: z.string().min(1).max(200),
  input: z.record(z.unknown()).default({}),
  toolUseId: z.string().max(200).optional(),
});

const ProviderIdParams = z.object({ id: ProviderId });

// ---- routes ----------------------------------------------------------------------------------------------------

export const systemRoutes = {
  "system.info": route({
    method: "GET",
    path: "/api/system/info",
    summary:
      "Where this service runs from: version, home, entry point, build freshness and sibling processes",
    tag: "system",
    scope: "monitor",
    responses: { 200: SystemInfoSchema },
  }),
  "system.restart": route({
    method: "POST",
    path: "/api/system/restart",
    summary: "Restart the service with the build on disk",
    tag: "system",
    scope: "owner",
    responses: { 200: z.object({ ok: z.literal(true), pid: z.number() }) },
  }),
  "system.reap": route({
    method: "POST",
    path: "/api/system/reap",
    summary: "Stop lingering sibling service processes (never this one)",
    tag: "system",
    scope: "owner",
    responses: { 200: z.object({ stopped: z.array(z.number()) }) },
  }),
  "updates.check": route({
    method: "GET",
    path: "/api/updates",
    summary: "Release check: only when enabled in settings, or asked for with force=1",
    tag: "updates",
    scope: "monitor",
    query: z.object({ force: z.string().optional() }),
    responses: {
      200: z.object({
        enabled: z.boolean(),
        current: z.string(),
        url: z.string(),
        status: UpdateStatusSchema.nullable(),
      }),
    },
  }),
  "meta.get": route({
    method: "GET",
    path: "/api/meta",
    summary: "Non-sensitive branding and the API version, before the interface has a token",
    tag: "system",
    public: true,
    responses: { 200: MetaSchema },
  }),
  "health.get": route({
    method: "GET",
    path: "/api/health",
    summary: "Liveness and counters; 503 while the database is closed",
    tag: "system",
    scope: "monitor",
    responses: { 200: HealthSchema },
    errors: [err(503, "service_unavailable", "The database is closed: the service is not ready")],
  }),
  "settings.get": route({
    method: "GET",
    path: "/api/settings",
    summary: "The engine settings",
    tag: "settings",
    scope: "monitor",
    responses: { 200: SettingsSchema },
  }),
  "settings.update": route({
    method: "PUT",
    path: "/api/settings",
    summary: "Merge a partial settings patch (providers and limits merge field by field)",
    tag: "settings",
    scope: "owner",
    body: SettingsPatchSchema,
    responses: {
      200: z.object({ settings: SettingsSchema, pendingApproval: ApprovalSchema.nullable() }),
    },
    errors: [
      err(
        400,
        "binary_mismatch",
        "providers.<id>.binaryPath points to a program that is not the provider's executable",
      ),
      err(
        400,
        "moved_to_ui_preferences",
        `The body names keys that moved to /api/ui-preferences (${UI_PREFERENCE_KEYS.join(", ")})`,
      ),
      err(400, "unknown_provider", "providers names an id no adapter is registered for"),
      err(
        400,
        "bad_request",
        "A folder to index is not absolute, does not exist, is not a directory or is the config directory",
      ),
      ...settingsWriteErrors,
    ],
  }),
  "uiPreferences.get": route({
    method: "GET",
    path: "/api/ui-preferences",
    summary: "What only the Command Centre reads and writes (theme preset, layouts, HUD, micro apps)",
    tag: "settings",
    scope: "monitor",
    responses: { 200: UiPreferencesSchema },
  }),
  "uiPreferences.update": route({
    method: "PUT",
    path: "/api/ui-preferences",
    summary: "Merge a patch of the interface preferences; a layout replaces the stored one whole",
    tag: "settings",
    scope: "owner",
    body: UiPreferencesPatchSchema,
    bodyOptional: true,
    responses: { 200: UiPreferencesSchema },
    errors: [
      err(
        409,
        "layout_conflict",
        "The stored layout is not the one the writer started from: another window saved first",
      ),
    ],
  }),
  "providers.list": route({
    method: "GET",
    path: "/api/providers",
    summary: "Every registered provider with its health, version status and defaults",
    tag: "providers",
    scope: "monitor",
    query: z.object({ force: z.string().optional() }),
    responses: { 200: z.array(ProviderSnapshotSchema) },
  }),
  "providers.detect": route({
    method: "POST",
    path: "/api/providers/:id/detect",
    summary: "Look for the provider's CLI, check its sign-in and list its models; a found binary is pinned",
    tag: "providers",
    scope: "owner",
    params: ProviderIdParams,
    responses: {
      200: z.object({
        detection: DetectionResultSchema,
        auth: AuthStatusSchema,
        models: z.array(ModelOptionSchema),
      }),
    },
    errors: [err(400, "unknown_provider", "No adapter is registered for the id"), ...settingsWriteErrors],
  }),
  "providers.models": route({
    method: "GET",
    path: "/api/providers/:id/models",
    summary: "The models the provider offers",
    tag: "providers",
    scope: "owner",
    params: ProviderIdParams,
    responses: { 200: z.array(ModelOptionSchema) },
    errors: [err(400, "unknown_provider", "No adapter is registered for the id")],
  }),
  "providers.setDefault": route({
    method: "PUT",
    path: "/api/providers/default",
    summary: "Choose the default provider (it must be enabled)",
    tag: "providers",
    scope: "owner",
    body: z.object({ provider: ProviderId }),
    responses: { 200: SettingsSchema },
    errors: [
      err(400, "unknown_provider", "No adapter is registered for the id"),
      err(400, "bad_request", "The provider is not enabled"),
      ...settingsWriteErrors,
    ],
  }),
  "providers.smoke": route({
    method: "POST",
    path: "/api/providers/:id/smoke",
    summary: "A safe, file-change-free run that asks the provider to answer MORDOMO_OK",
    tag: "providers",
    scope: "owner",
    params: ProviderIdParams,
    responses: { 200: z.object({ run: RunRecordSchema, passed: z.boolean() }) },
    errors: [
      err(400, "unknown_provider", "No adapter is registered for the id"),
      err(403, "device_provider_refused", "A device started it on a provider that reads the whole disk"),
      err(409, "workspace_unavailable", "The default working folder cannot be used"),
      err(429, "too_many_requests", "The queue of runs is full"),
    ],
  }),
  "doctor.get": route({
    method: "GET",
    path: "/api/doctor",
    summary: "The health report; audit=0 skips npm audit (a device never triggers it)",
    tag: "system",
    scope: "monitor",
    query: z.object({ audit: z.enum(["0", "1"]).optional() }),
    responses: { 200: DoctorReportSchema },
  }),
  "metrics.history": route({
    method: "GET",
    path: "/api/metrics/history",
    summary: "Hourly samples of the last days plus their daily fold (Settings > Trends)",
    tag: "metrics",
    scope: "monitor",
    query: z.object({ days: z.coerce.number().int().min(1).max(90).default(14) }),
    responses: {
      200: z.object({
        days: z.number(),
        samples: z.array(MetricsSampleSchema),
        daily: z.array(DailyPointSchema),
      }),
    },
  }),
  "approvals.list": route({
    method: "GET",
    path: "/api/approvals",
    summary: "The approvals still pending",
    tag: "approvals",
    scope: "monitor",
    responses: { 200: z.array(ApprovalSchema) },
  }),
  "approvals.get": route({
    method: "GET",
    path: "/api/approvals/:id",
    summary: "One approval by id, any status (the permission tool polls this)",
    tag: "approvals",
    scope: "monitor",
    params: UuidParams,
    responses: { 200: ApprovalSchema },
    errors: [
      notFound("The approval"),
      err(403, "forbidden", "The approval belongs to another run than the broker's"),
    ],
  }),
  "approvals.requestTool": route({
    method: "POST",
    path: "/api/approvals/tool",
    summary: "A tool prompt raised inside a running agent: parks an approval the owner decides",
    tag: "approvals",
    scope: "owner",
    body: ToolApprovalBodySchema,
    responses: { 200: ApprovalSchema },
    errors: [
      notFound("The run"),
      err(403, "forbidden", "The permission broker asked for a run that is not its own"),
      err(409, "conflict", "The run is not active"),
    ],
  }),
  "approvals.resolve": route({
    method: "POST",
    path: "/api/approvals/:id/resolve",
    summary: "Approve or deny; an approved write run starts, and the answer says which run",
    tag: "approvals",
    scope: "approve",
    params: UuidParams,
    body: ResolveBodySchema,
    responses: { 200: ApprovalSchema.extend({ runId: z.string().nullable() }) },
    errors: [
      notFound("The approval"),
      err(403, "self_approval", "A device decided an approval that it asked for itself"),
      err(403, "owner_only", "A device decided an approval of a kind only the owner decides"),
      err(403, "forbidden", "The broker decided another run's approval, or tried to approve"),
      err(409, "approval_expired", "The approval has expired and can no longer be decided"),
      err(409, "approval_resolved", "The approval was already decided"),
      err(409, "budget_exhausted", "The skill's daily budget is exhausted"),
      err(400, "unknown_provider", "The approved write names a provider that is no longer registered"),
      err(403, "profile_refused", "The security profile no longer allows the write"),
      ...settingsWriteErrors,
    ],
  }),
  "backups.list": route({
    method: "GET",
    path: "/api/backups",
    summary: "The backups in the home, newest first",
    tag: "backups",
    scope: "owner",
    responses: { 200: z.array(BackupInfoSchema) },
  }),
  "backups.create": route({
    method: "POST",
    path: "/api/backups",
    summary: "Make a sealed backup (a manifest with the SHA-256 of each file) and apply the retention",
    tag: "backups",
    scope: "owner",
    body: z.object({ includeArtifacts: z.boolean().default(false) }),
    bodyOptional: true,
    responses: { 200: BackupInfoSchema },
    errors: [
      err(409, "restore_in_progress", "a restore, a backup or a starting process holds the home: try again"),
      err(409, "restore_leftover", "a restore left something to clear by hand"),
      err(409, "restore_recovery_failed", "a dead restore could not be undone"),
      err(409, "restore_lock_unusable", "config/run/restore.lock cannot be a lock"),
    ],
  }),
  "backups.restore": route({
    method: "POST",
    path: "/api/backups/:name/restore",
    summary: "Stage a restore: it is applied on the next service start, after a safety backup",
    tag: "backups",
    scope: "owner",
    params: BackupNameParams,
    responses: {
      202: z.object({
        staged: z.literal(true),
        restored: z.literal(false),
        name: z.string(),
        stagedAt: z.number(),
        apply: z.string(),
        message: z.string(),
      }),
    },
    errors: [
      notFound("The backup"),
      err(409, "conflict", "runs are active"),
      err(422, "backup_invalid", "the backup does not match its manifest"),
      err(422, "backup_unsealed", "the backup has no manifest (it was made before backups were sealed)"),
    ],
  }),
  "backups.pending": route({
    method: "GET",
    path: "/api/backups/restore-pending",
    summary: "The restore staged for the next start, if any",
    tag: "backups",
    scope: "owner",
    responses: { 200: z.object({ restorePending: RestorePendingSchema.nullable() }) },
  }),
  "backups.cancelPending": route({
    method: "DELETE",
    path: "/api/backups/restore-pending",
    summary: "Cancel the staged restore",
    tag: "backups",
    scope: "owner",
    responses: { 200: z.object({ cancelled: z.string().nullable() }) },
  }),
  "sync.plan": route({
    method: "GET",
    path: "/api/sync/plan",
    summary:
      "What the config compiler would write into each provider's native files; with context, into its first ok path, with its map in the place of the master router",
    tag: "sync",
    scope: "owner",
    query: z.object({ target: z.string().optional(), context: ContextQuery }),
    responses: { 200: SyncPlanSchema },
    errors: [contextNotFound, contextUnavailable],
  }),
  "sync.apply": route({
    method: "POST",
    path: "/api/sync/apply",
    summary:
      "Write the plan; a hand-edited file is written only when listed in approvedConflicts; context as in the plan",
    tag: "sync",
    scope: "owner",
    body: z.object({
      target: z.string().optional(),
      approvedConflicts: z.array(z.string()).default([]),
      context: ContextQuery,
    }),
    bodyOptional: true,
    responses: { 200: SyncApplyResultSchema },
    errors: [contextNotFound, contextUnavailable],
  }),
  "artifacts.list": route({
    method: "GET",
    path: "/api/artifacts/list",
    summary: "The artifact gallery: files under artifacts/ with their run, skill, kind and title",
    tag: "artifacts",
    scope: "content",
    query: z.object({
      q: z.string().max(200).optional(),
      skill: z.string().max(100).optional(),
      folder: z.string().max(200).optional(),
      kind: z.enum(["image", "video", "html", "markdown", "code", "other"]).optional(),
      since: z.coerce.number().int().min(0).optional(),
      limit: z.coerce.number().int().min(1).max(500).default(200),
    }),
    responses: {
      200: z.object({
        items: z.array(ArtifactListItemSchema),
        total: z.number(),
        skills: z.array(z.string()),
        folders: z.array(z.string()),
      }),
    },
  }),
  "artifacts.raw": route({
    method: "GET",
    path: "/api/artifacts/raw",
    summary: "An image or video artifact for thumbnails (allow-listed types, at most 25 MB)",
    tag: "artifacts",
    scope: "content",
    queryToken: true,
    query: z.object({ p: z.string() }),
    responses: {
      200: binary(
        ["image/png", "image/jpeg", "image/gif", "image/webp", "image/svg+xml", "video/mp4", "video/webm"],
        "The file",
      ),
    },
    errors: [
      notFound("The artifact"),
      err(413, "payload_too_large", "The artifact is larger than 25 MB"),
      err(415, "unsupported_media_type", "Not a previewable artifact type"),
    ],
  }),
  "startup.plan": route({
    method: "GET",
    path: "/api/startup-plan",
    summary: "The files and commands that would install (and remove) the login service on this system",
    tag: "system",
    scope: "owner",
    responses: { 200: StartupServicePlanSchema },
  }),
  "diagnostics.export": route({
    method: "GET",
    path: "/api/diagnostics/export",
    summary: "A bundle for a bug report: settings (redacted), doctor, metrics, last runs and routines",
    tag: "system",
    scope: "owner",
    responses: { 200: DiagnosticsBundleSchema },
  }),
} as const;
