/**
 * Contracts (.specs/features/contratos, C14): the core keeps exporting every wire
 * type it re-exports from @mordomo/contracts, under the same names.
 */
import type {
  Approval,
  DeviceRecord,
  DeviceScope,
  NotificationRecord,
  OsEvent,
  OsEventMap,
  OsEventType,
  ProviderCapabilities,
  RunEvent,
  RunRecord,
  RunUsage,
  SessionRecord,
  Settings,
  TestedVersions,
  VersionStatus,
} from "@mordomo/core";
import type * as Contracts from "@mordomo/contracts";

// Strict identity (an `any` on either side fails it), not mutual assignability.
type Same<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;

export const sameAsContract: [
  Same<Approval, Contracts.Approval>,
  Same<DeviceRecord, Contracts.DeviceRecord>,
  Same<DeviceScope, Contracts.DeviceScope>,
  Same<NotificationRecord, Contracts.NotificationRecord>,
  Same<OsEvent, Contracts.OsEvent>,
  Same<OsEventMap, Contracts.OsEventMap>,
  Same<OsEventType, Contracts.OsEventType>,
  Same<ProviderCapabilities, Contracts.ProviderCapabilities>,
  Same<RunEvent, Contracts.RunEvent>,
  Same<RunRecord, Contracts.RunRecord>,
  Same<RunUsage, Contracts.RunUsage>,
  Same<SessionRecord, Contracts.SessionRecord>,
  Same<Settings, Contracts.Settings>,
  Same<TestedVersions, Contracts.TestedVersions>,
  Same<VersionStatus, Contracts.VersionStatus>,
] = [true, true, true, true, true, true, true, true, true, true, true, true, true, true, true];
