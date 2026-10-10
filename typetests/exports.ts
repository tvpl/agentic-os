/**
 * Contracts (.specs/features/contratos, C2): every wire type is importable from
 * @mordomo/contracts. Compiled by `npm run typecheck` against the built .d.ts.
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
} from "@mordomo/contracts";
import type { CreateRunInput } from "@mordomo/core";

export type ContractExports = [
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
];

/**
 * adaptadores-tipados, door 5: a `tool_use` event may list the files it wrote
 * (`paths`, additive and optional); anything but a list of strings is a type error.
 */
type ToolUse = Extract<RunEvent, { type: "tool_use" }>;
export const toolUseBase: ToolUse = { type: "tool_use", ts: 1, tool: "Write", detail: "{}" };
export const toolUseWithPaths: ToolUse = { ...toolUseBase, paths: ["/repo/a.ts", "C:\\work\\b.ts"] };
// @ts-expect-error `paths` is a list of strings, not one string
export const toolUsePathsString: ToolUse = { ...toolUseBase, paths: "/repo/a.ts" };
// @ts-expect-error `paths` is a list of strings, not of numbers
export const toolUsePathsNumbers: ToolUse = { ...toolUseBase, paths: [1] };

/**
 * escopos-dispositivo, door 4: a manifest must say where its provider's reads stop. A provider written before the
 * field existed does not compile, so it cannot be mistaken for one that keeps reads in the working folder.
 */
// @ts-expect-error `readConfinement` is required
export const noReadConfinement: ProviderCapabilities = {
  enforcesReadOnly: true,
  supportsEffort: true,
  promptTransport: "stdin",
  streaming: true,
  resume: "flag",
  writeConfinement: "broker",
};
export const withReadConfinement: ProviderCapabilities = { ...noReadConfinement, readConfinement: "workdir" };
// @ts-expect-error only `workdir` and `none`
export const unknownConfinement: ProviderCapabilities = { ...withReadConfinement, readConfinement: "some" };

/** escopos-dispositivo, door 1: a device holds scopes from the four names, and the record says which. */
export const heldScopes: DeviceScope[] = ["monitor", "content", "run", "approve"];
// @ts-expect-error `manage` is not a device scope
export const unknownScope: DeviceScope = "manage";
// @ts-expect-error a device record always lists its scopes
export const deviceWithoutScopes: DeviceRecord = {
  id: "d",
  name: "n",
  createdAt: 1,
  lastSeenAt: null,
  expiresAt: null,
  revokedAt: null,
};

/**
 * escopos-dispositivo, round 1: who asked is part of creating a run. A caller that leaves `startedBy` out does not
 * compile, so it cannot start a run as nobody by forgetting; `null` (a routine, a sentinel, the CLI) is written down.
 */
const runFields = {
  origin: "manual",
  provider: "claude",
  prompt: "p",
  cwd: "/w",
  model: null,
  effort: "default",
  mode: "read_only",
  timeoutMs: 1000,
  profile: "read_only",
} as const;
// @ts-expect-error `startedBy` is required
export const runWithoutStartedBy: CreateRunInput = { ...runFields };
export const runByNobody: CreateRunInput = { ...runFields, startedBy: null };
export const runByDevice: CreateRunInput = { ...runFields, startedBy: "device:d1" };
