export { resolvePaths, ensureDirs, type MordomoPaths } from "./paths.js";
export {
  SettingsSchema,
  ProviderId,
  SecurityProfile,
  EffortLevel,
  ProviderSettingsSchema,
  IndexedFolderSchema,
  DEFAULT_EXCLUDES,
  defaultSettings,
  type Settings,
  type ProviderSettings,
  type IndexedFolder,
} from "./config/schema.js";
export { SettingsStore, atomicWrite } from "./config/store.js";
export { openDb, type Db, type MigrationResult } from "./db/db.js";
export { redactSecrets, redactObject } from "./security/redact.js";
export {
  isInside,
  resolveInsideRoots,
  PathAccessError,
  makeExcludeMatcher,
  isSecretFile,
  SECRET_FILE_PATTERNS,
} from "./security/paths.js";
export { PROFILES, type ProfileCapabilities, type ApprovalKind } from "./security/profiles.js";
export { ApprovalStore, type Approval } from "./security/approvals.js";
export {
  safeSpawn,
  probe,
  assertAllowed,
  ExecutableNotAllowedError,
  type SpawnOptions,
  type SpawnResult,
  type SpawnHandle,
} from "./spawn/safeSpawn.js";
export type {
  AgentAdapter,
  AgentRun,
  RunEvent,
  RunMode,
  SafeInvocation,
  DetectionResult,
  AuthStatus,
  ModelOption,
  ValidationResult,
  HealthStatus,
} from "./agents/types.js";
export { executeInvocation, cancelRunProcess, type LineParser } from "./agents/baseExec.js";
export { findOnPath, parseHelpFlags } from "./spawn/which.js";
export { JsonlLogger } from "./logs/jsonl.js";
export {
  RunManager,
  type RunRecord,
  type RunStatus,
  type RunOrigin,
  type CreateRunInput,
} from "./runs/runManager.js";
export { MemoryIndexer, fileRowFromDb, type IndexStats, type FileRow } from "./memory/indexer.js";
export { searchFiles, listFacets, type SearchFilters, type SearchHit } from "./memory/search.js";
export { buildGraph, relatedFiles, type GraphData, type GraphNode, type GraphEdge } from "./memory/graph.js";
export { previewFile, type PreviewResult } from "./memory/preview.js";
export { generateRouters, checkRouters, areaSlug, type RouterIssue } from "./memory/routers.js";
export {
  SkillCatalog,
  THICK_LINE_THRESHOLD,
} from "./skills/catalog.js";
export {
  SkillFrontmatterSchema,
  SkillInputSchema,
  type Skill,
  type SkillFrontmatter,
  type SkillInput,
} from "./skills/types.js";
export { RoutineSchema, type Routine, type RoutineStatus } from "./routines/types.js";
export { RoutineStore, validateCron, nextRunAt } from "./routines/store.js";
export { RoutineScheduler } from "./routines/scheduler.js";
export { planStartupService, type StartupServicePlan } from "./routines/osIntegration.js";
export { ConnectorRegistry, ConnectorSchema, type Connector } from "./connectors/registry.js";
export {
  runAudit,
  discoverMcpServers,
  type AuditReport,
  type DiscoveredMcpServer,
} from "./connectors/auditor.js";
export {
  SyncCompiler,
  type SyncPlan,
  type SyncAction,
  type SyncApplyResult,
} from "./sync/compiler.js";
export { unifiedDiff } from "./sync/diff.js";
export { createBackup, listBackups, restoreBackup, type BackupInfo } from "./backup.js";
export * from "./events.js";
