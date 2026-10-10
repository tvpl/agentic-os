export {
  resolvePaths,
  ensureDirs,
  tightenHomeFiles,
  tightenMode,
  PRIVATE_DIR_MODE,
  PRIVATE_FILE_MODE,
  defaultUserDataDir,
  seedHome,
  type MordomoPaths,
} from "./paths.js";
export {
  SettingsSchema,
  CURRENT_SETTINGS_VERSION,
  UI_PREFERENCE_KEYS,
  UiPreferencesSchema,
  defaultUiPreferences,
  type UiPreferences,
  type UiPreferenceKey,
  ProviderId,
  BUILTIN_PROVIDER_IDS,
  type BuiltinProviderId,
  SecurityProfile,
  EffortLevel,
  ProviderSettingsSchema,
  IndexedFolderSchema,
  DEFAULT_EXCLUDES,
  defaultSettings,
  detectTimezone,
  type Settings,
  type ProviderSettings,
  type IndexedFolder,
} from "./config/schema.js";
export { SettingsStore, atomicWrite } from "./config/store.js";
export {
  DbNewerVersionError,
  MigrationError,
  openDb,
  runMigrations,
  type Db,
  type MigrationResult,
} from "./db/db.js";
export { MIGRATIONS, hasColumn, type Migration } from "./db/migrations.js";
export { redactSecrets, redactObject } from "./security/redact.js";
export {
  isInside,
  resolveInsideRoots,
  realpathLenient,
  PathAccessError,
  makeExcludeMatcher,
  isSecretFile,
  SECRET_FILE_PATTERNS,
} from "./security/paths.js";
export {
  PROFILES,
  writeDecision,
  type ProfileCapabilities,
  type ApprovalKind,
  type WriteDecision,
  type WriteOrigin,
} from "./security/profiles.js";
export { ApprovalStore, type Approval } from "./security/approvals.js";
export {
  safeSpawn,
  probe,
  assertAllowed,
  executableName,
  setProviderBinaries,
  killProcessGroup,
  MAX_CAPTURED_BYTES,
  ExecutableNotAllowedError,
  type SpawnOptions,
  type SpawnResult,
  type SpawnHandle,
} from "./spawn/safeSpawn.js";
export type {
  PermissionBroker,
  AgentAdapter,
  AgentRun,
  RunEvent,
  RunUsage,
  RunUsageEvent,
  RunMode,
  SafeInvocation,
  DetectionResult,
  AuthStatus,
  ModelOption,
  ValidationResult,
  HealthStatus,
} from "./agents/types.js";
export { resumableSessionId } from "./agents/resumeId.js";
export { boundedPaths, MAX_EVENT_PATHS, MAX_EVENT_PATH_CHARS } from "./agents/eventPaths.js";
export { executeInvocation, MAX_LINE_CHARS, type LineParser } from "./agents/baseExec.js";
// The surface a provider adapter needs to read its stream: the tally and `readTypedLine`, and `plainText` for the
// message of a CLI failure (the Codex adapter prints one). Nothing else of `streamTally.ts` is exported on purpose:
// `exceedsShapeBudget` and its limits run inside `readTypedLine` for every adapter, so an adapter cannot skip them,
// and its own test imports the module directly.
export {
  createUnrecognizedTally,
  plainText,
  readTypedLine,
  type RejectedLine,
  type RejectionReason,
  type TypedLine,
  type UnrecognizedTally,
} from "./agents/streamTally.js";
export { ClaudeStreamMessage, CodexStreamEvent, KnownStreamTypes } from "@mordomo/contracts";
export {
  augmentedPath,
  findExecutable,
  findOnPath,
  parseHelpFlags,
  providerSearchDirs,
} from "./spawn/which.js";
export { JsonlLogger } from "./logs/jsonl.js";
export {
  RunManager,
  TERMINAL_STATUSES,
  type RunRecord,
  type RunStatus,
  type RunOrigin,
  type RunRequestSpec,
  type RunFailure,
  classifyRunFailure,
  type CreateRunInput,
  type PruneOptions,
  type PruneResult,
} from "./runs/runManager.js";
export {
  SessionStore,
  sessionTitle,
  type SessionRecord,
  type SessionSummary,
  type LastRunSummary,
  type CreateSessionInput,
  type RecordRunInput,
} from "./runs/sessionStore.js";
export {
  ObjectiveStore,
  type Objective,
  type ObjectiveStatus,
  type ObjectiveStep,
  type ObjectiveStepStatus,
  type ObjectiveContext,
  type StepEvidence,
  type CreateObjectiveInput,
} from "./objectives/objectiveStore.js";
export { MemoryIndexer, fileRowFromDb, type IndexStats, type FileRow } from "./memory/indexer.js";
export { searchFiles, listFacets, type SearchFilters, type SearchHit } from "./memory/search.js";
export { buildGraph, relatedFiles, type GraphData, type GraphNode, type GraphEdge } from "./memory/graph.js";
export {
  relatedEdges,
  relatedFromTexts,
  tokenize as tokenizeForRelated,
  type RelatedEdge,
} from "./memory/related.js";
export { previewFile, type PreviewResult } from "./memory/preview.js";
export { generateRouters, checkRouters, areaSlug, type RouterIssue } from "./memory/routers.js";
export { SkillCatalog, THICK_LINE_THRESHOLD } from "./skills/catalog.js";
export {
  SkillFrontmatterSchema,
  SkillI18nSchema,
  SkillInputSchema,
  type Skill,
  type SkillFrontmatter,
  type SkillI18n,
  type SkillInput,
} from "./skills/types.js";
export { RoutineSchema, type Routine, type RoutineStatus } from "./routines/types.js";
export { RoutineStore, validateCron, nextRunAt } from "./routines/store.js";
export {
  RoutineScheduler,
  previousScheduledTime,
  type FireOptions,
  type FireResult,
  type FireReason,
} from "./routines/scheduler.js";
export { planStartupService, type StartupServicePlan } from "./routines/osIntegration.js";
export { ConnectorRegistry, ConnectorSchema, type Connector } from "./connectors/registry.js";
export {
  runAudit,
  discoverMcpServers,
  homeConfigFilesOf,
  type AuditReport,
  type DiscoveredMcpServer,
} from "./connectors/auditor.js";
export { SyncCompiler, type SyncPlan, type SyncAction, type SyncApplyResult } from "./sync/compiler.js";
export { unifiedDiff } from "./sync/diff.js";
export {
  BackupVerificationError,
  RESTORE_PENDING_DIR,
  applyPendingRestore,
  clearRestorePending,
  createBackup,
  isSealed,
  listBackups,
  pruneBackups,
  readRestorePending,
  recoverInterruptedRestore,
  restoreBackup,
  restorePendingDir,
  verifyBackup,
  writeRestorePending,
  type BackupInfo,
  type BackupOptions,
  type RestoreOptions,
  type RestorePending,
} from "./backup.js";
export {
  NotificationStore,
  NOTIFICATION_KINDS,
  DEDUPE_MS,
  type NotificationKind,
  type NotificationTone,
  type NotificationRecord,
  type NotificationInput,
} from "./notifications/store.js";
export {
  installNotificationRecorder,
  toNotification,
  budgetDedupeKey,
  localDay,
  type BudgetCrossedPayload,
  type NotificationRecorderOptions,
} from "./notifications/recorder.js";
export * from "./events.js";
export { InvalidIdError, ID_PATTERN, isValidId, assertValidId, resolveInsideDir } from "./security/ids.js";
export { isInsideAny } from "./security/paths.js";
export {
  HARD_BLOCKED_DIRS,
  HOME_PRIVATE_DIRS,
  isHardBlockedPath,
  isBinaryBuffer,
  makeWorkspaceFilter,
  type WorkspaceFilter,
  type WorkspaceFilterOptions,
} from "./memory/excludes.js";
export {
  checkWorkspacePath,
  resolveOpenablePath,
  workspaceScope,
  type WorkspacePathCheck,
  type WorkspaceAccessOptions,
} from "./memory/preview.js";
export {
  FileTooLargeError,
  NotRegularFileError,
  assertWritablePath,
  grantedReadScope,
  homeReadScope,
  findPrivateLink,
  inspectPath,
  listWorkspaceDir,
  openWorkspaceFile,
  readScope,
  readWorkspaceFile,
  readWorkspaceText,
  resolveReadable,
  resolveWorkspaceCwd,
  statWorkspacePath,
  type BytesRead,
  type PathVerdict,
  type ReadOptions,
  type ReadScope,
  type ReadScopeOptions,
  type TextRead,
  type WorkspaceEntry,
  type WorkspaceFile,
} from "./security/safeFs.js";
export {
  DEFAULT_COPY_LIMITS,
  FolderTooLargeError,
  copyTreeWithoutLinks,
  writeWorkspaceFile,
  type CopyLimits,
  type WriteMode,
  type WriteOptions,
} from "./security/safeWrite.js";
export { parseSkillFile, type ParsedSkillFile } from "./skills/parse.js";
export { rotateFile, pruneRotated } from "./logs/jsonl.js";
export { type StoreProblem } from "./routines/store.js";
export { deepMergeSettings, type SettingsPatch } from "./config/store.js";
export {
  EngineLockedError,
  OwnerLock,
  lockIsStale,
  readLock,
  realProbe,
  type LockRecord,
  type ProcessProbe,
} from "./ownerLock.js";
export { pidAlive, processStartMarker, realProbeIo, type ProbeIo } from "./processIdentity.js";
export { INDEX_CHUNK_SIZE, type IndexProgress } from "./memory/indexer.js"; // B3 exports
export {
  ProviderRegistry,
  ProviderRegistryError,
  versionStatus,
  installedVersion,
  type ProviderManifest,
  type ProviderCapabilities,
  type TestedVersions,
  type VersionStatus,
  type ProviderNativeLayout,
  type AdapterFactory,
  type AdapterFactoryOptions,
} from "./agents/registry.js";
export * from "./memory/v2.js"; // F-MEMORY: recall, journal, hygiene, facts, inline fields
// F-BACKEND: routines v2 (schedule kinds, runner, summary) + read-only connector data client
export {
  ScheduleKind,
  RoutineRunner,
  RoutineContext,
  RoutineDelivery,
  validateRoutine,
  type Every,
  type OnExit,
  type ActiveHours,
  type Heartbeat,
  type RoutineSummary,
  type SilentRoutine,
  type RoutineValidationOptions,
} from "./routines/types.js";
export {
  nextRunFor,
  nextAtRun,
  nextEveryRun,
  nextHeartbeatRun,
  nextIntervalSlot,
  intervalMs,
  isWithinActiveHours,
  startOfDayIn,
  isHeartbeatOk,
  wallMinutes,
} from "./routines/schedule.js";
export { cronNextAfter } from "./routines/store.js";
export { isStartupServiceInstalled } from "./routines/osIntegration.js";
export type { HistoryEntry, SchedulerOptions } from "./routines/scheduler.js";
export {
  DataMappingSchema,
  ToolMappingSchema,
  type DataMapping,
  type ToolMapping,
  type ItemFields,
  type FieldSpec,
} from "./connectors/registry.js";
export {
  fetchConnectorData,
  setupChecklist,
  ConnectorDataCache,
  McpStdioClient,
  McpProtocolError,
  ReadOnlyViolationError,
  isWriteLikeTool,
  allowedTools,
  parseToolText,
  itemsFromParsed,
  resolvePath,
  renderArgs,
  substituteEnv,
  minimalEnv,
  allowPathsFrom,
  resolveCommand,
  type ConnectorData,
  type ConnectorItem,
  type FetchOptions,
  type McpTool,
} from "./connectors/client.js";
// Onda 2: sentinels (cheap observers), their triage run and the Telegram channel
export {
  SENTINEL_IDS,
  emitSentinel,
  sentinelDay,
  sentinelDedupeKey,
  type SentinelId,
  type SentinelSeverity,
  type SentinelFiredPayload,
  type DedupeLookup,
} from "./sentinels/types.js";
export { readMetaJson, writeMetaJson } from "./sentinels/meta.js";
export { SentinelRunner, type SentinelRunnerDeps, type HourlyReport } from "./sentinels/runner.js";
export {
  checkRepeatedFailure,
  repeatedFailureAlert,
  recentFailures,
  failureKey,
  failureLabel,
  type FailureRun,
  type RepeatedFailureDeps,
} from "./sentinels/repeatedFailure.js";
export {
  checkSilentRoutines,
  silentRoutineAlerts,
  candidatesFromStatus,
  expectedIntervalMs,
  type SilentRoutineCandidate,
  type SilentRoutineDeps,
} from "./sentinels/silentRoutine.js";
export {
  checkConnectorDeltas,
  diffConnectorItems,
  connectorDeltaPayload,
  connectorMetaKey,
  hashId,
  hashIds,
  type ConnectorDelta,
  type ConnectorDeltaMark,
  type ConnectorDeltaDeps,
} from "./sentinels/connectorDelta.js";
export { FsWatchSentinel, fsWatchPayload, type FsWatchDeps } from "./sentinels/fsWatch.js";
export {
  installSentinelTriage,
  triageSentinel,
  triageSpendToday,
  buildTriagePrompt,
  parseTriageDecision,
  triageNotification,
  type TriageAction,
  type TriageDecision,
  type TriageOutcome,
  type TriageDeps,
  type TriageRunner,
  type TriageInbox,
} from "./sentinels/triage.js";
export {
  detectRepeatedPrompts,
  groupPrompts,
  normalizeTokens,
  jaccard,
  hashTokens,
  skillCoversGroup,
  isoWeek,
  repeatDedupeKey,
  repeatNotification,
  promptHead,
  manualPromptRuns,
  MAX_COMPARED_TOKENS,
  DEFAULT_SIMILARITY,
  SKILL_OVERLAP_TOKENS,
  type RepeatRun,
  type RepeatGroup,
  type RepeatDetectorDeps,
} from "./skills/repeatDetector.js";
export {
  installTelegramChannel,
  deliverToTelegram,
  sendTelegramMessage,
  formatNotification,
  localLink,
  telegramToken,
  toneAtLeast,
  sendMessageUrl,
  TELEGRAM_API_HOST,
  TELEGRAM_API_ORIGIN,
  TELEGRAM_TIMEOUT_MS,
  type TelegramChannelDeps,
  type TelegramSendOptions,
  type TelegramSendResult,
} from "./channels/telegram.js";
export {
  SentinelSettingsSchema,
  ChannelSettingsSchema,
  type SentinelSettings,
  type ChannelSettings,
} from "./config/schema.js";
export {
  DeviceStore,
  hashToken,
  PAIRING_TTL_MS,
  PAIRING_MAX_ATTEMPTS,
  type DeviceRecord,
  type PairingCode,
} from "./security/devices.js";
export {
  SkillRegistry,
  parseIndex,
  type RegistryEntry,
  type RegistryIndex,
  type RegistrySkill,
  type Fetcher,
} from "./skills/registry.js";
export {
  TelegramPoller,
  approvalKeyboard,
  parseCommand,
  type InboundDeps,
  type PendingApprovalView,
  type TelegramUpdate,
} from "./channels/telegramInbound.js";
export {
  b64url,
  decryptPayload,
  encryptPayload,
  generateVapidKeys,
  sendWebPush,
  vapidAuthorization,
  verifyVapidToken,
  type PushSubscriptionJson,
  type VapidKeys,
} from "./channels/webpush.js";
export {
  deliverPush,
  installPushChannel,
  pushPayload,
  type PushChannelDeps,
} from "./channels/pushChannel.js";
export { PushStore, type PushSubscriptionRecord } from "./notifications/pushStore.js";
export {
  MetricsHistory,
  dailyPoints,
  localDay as metricsLocalDay,
  HOUR_MS,
  type MetricsSample,
  type DailyPoint,
  type SampleSource,
} from "./metrics/history.js";
export {
  canonicalJson,
  ensureSigningKeys,
  generateSigningKeys,
  publishRegistry,
  signIndex,
  verifyIndex,
  type PublishOptions,
  type PublishResult,
  type SigningKeys,
} from "./skills/publish.js";
export { splitRegistryUrl } from "./skills/registry.js";
export {
  certificateHosts,
  createSelfSignedCertificate,
  ensureTlsMaterial,
  fingerprintOf,
  type TlsMaterial,
} from "./security/tls.js";
export {
  MordomoEngine,
  createEngine,
  ignoredBinaryPaths,
  promptRunFields,
  type EngineOptions,
  type GatedRunPayload,
  type IgnoredBinaryPath,
  type PromptRunInput,
  type SkillRunInput,
  type WriteGate,
} from "./engine.js";
export { UiPreferencesStore } from "./config/preferences.js";
export {
  SETTINGS_MIGRATIONS,
  migrateSettings,
  settingsVersion,
  type SettingsMigration,
} from "./config/migrations.js";
