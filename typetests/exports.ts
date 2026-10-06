/**
 * Contracts (.specs/features/contratos, C2): every wire type is importable from
 * @mordomo/contracts. Compiled by `npm run typecheck` against the built .d.ts.
 */
import type {
  Approval,
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
} from "@mordomo/contracts";

export type ContractExports = [
  Approval,
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
];
