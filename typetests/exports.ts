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
  TestedVersions,
  VersionStatus,
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
