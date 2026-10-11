/**
 * `@mordomo/core`: run an agent from a program.
 *
 * This is the public, documented surface (`docs/sdk.md`): `createEngine` and the types around it. Everything else the
 * package contains is in `@mordomo/core/internal`, which has no stability promise.
 */
export { createEngine } from "./sdk.js";
export type { Engine, EngineOptions, ReadonlyProviders } from "./sdk.js";

export type {
  Execution,
  ResolveApprovalOptions,
  ResolvedApproval,
  RetryInput,
  RunFilter,
  SmokeResult,
  StartOptions,
  StartPromptInput,
  StartSkillInput,
  StartedRun,
  WaitOptions,
} from "./execution/types.js";
export type { EventFeed } from "./events.js";

export {
  ENGINE_ERROR_CODES,
  EngineLockedError,
  MordomoError,
  PathAccessError,
  RestoreInProgressError,
  type EngineErrorCode,
} from "./errors.js";
export { DbNewerVersionError, MigrationError } from "./db/errors.js";

export {
  ProviderRegistry,
  ProviderRegistryError,
  type AdapterFactory,
  type AdapterFactoryOptions,
  type ProviderManifest,
} from "./agents/registry.js";
export { SpawnPolicy, type DropEnv } from "./spawn/policy.js";
export type {
  AgentAdapter,
  AgentRun,
  AuthStatus,
  DetectionResult,
  HealthStatus,
  ModelOption,
  PermissionBroker,
  SafeInvocation,
  ValidationResult,
} from "./agents/types.js";

export type { SettingsUpdate } from "./config/store.js";

// The shapes that cross the boundary of the engine are the contracts' (`@mordomo/contracts`), named here so a program
// needs one import.
export type {
  Approval,
  ApprovalKind,
  EffortLevel,
  NotificationRecord,
  OsEvent,
  OsEventMap,
  OsEventType,
  ProviderCapabilities,
  ProviderId,
  RunEvent,
  RunMode,
  RunRecord,
  RunStatus,
  RunUsage,
  SecurityProfile,
  SessionRecord,
  Settings,
} from "@mordomo/contracts";
